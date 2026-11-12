#!/usr/bin/env node
// profiles/ 结构与引用自检：平台、Agent 平台、能力预设、运行方案、行为档案。
//
// 这是「四条数据链只认 profiles/」的门禁：目录缺失、引用悬空、内置方案被改名或
// 自定义方案抢占内置 id，都在这里失败。用法：node scripts/check-profiles.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listPlatforms, loadPlatform, readPlatformTools, PLATFORM_TOOL_RISKS,
} from '../src/platforms/index.mjs';
import { createCapabilityStore, CAPABILITIES_ROOT } from '../src/capabilities/store.mjs';
import { createPlanStore, validatePlanReferences, BUILTIN_PLAN_ORDER } from '../src/runtime/plans.mjs';
import { loadBehaviorProfiles } from '../src/behaviors/index.mjs';
import { loadBehaviorTypes } from '../src/behaviors/types.mjs';
import { PLATFORMS_ROOT, AGENT_PLATFORMS_ROOT, PLANS_ROOT } from '../src/profiles/paths.mjs';

const problems = [];
const note = (message) => problems.push(message);

function dirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

// 1) 平台：platform.yml / tools.yml / prompt.md / prompt.default.md / behaviors/*.yml
const platforms = listPlatforms({ root: PLATFORMS_ROOT });
if (platforms.length === 0) note('profiles/platforms 为空');
for (const platform of platforms) {
  const dir = path.join(PLATFORMS_ROOT, platform.id);
  for (const name of ['platform.yml', 'tools.yml', 'prompt.md', 'prompt.default.md']) {
    if (!fs.existsSync(path.join(dir, name))) note(`平台 ${platform.id} 缺 ${name}`);
  }
  const tools = readPlatformTools({ root: PLATFORMS_ROOT, id: platform.id });
  if (tools.length === 0) note(`平台 ${platform.id} 的 tools.yml 为空`);
  for (const tool of tools) {
    if (!tool.flag || !tool.label) note(`平台 ${platform.id} 工具缺少 flag/label：${JSON.stringify(tool)}`);
    if (!PLATFORM_TOOL_RISKS.includes(tool.risk)) note(`平台 ${platform.id} 工具 ${tool.flag} 风险值不合法：${tool.risk}`);
  }
  const behaviorsRoot = path.join(dir, 'behaviors');
  let types = [];
  try {
    types = loadBehaviorTypes({ root: dir });
    if (types.length === 0) note(`平台 ${platform.id} 没有 behavior-types/`);
    for (const type of types) {
      if (!['v1', 'v2'].includes(type.engine)) note(`行为类型 ${type.id} 的 engine 不合法：${type.engine}`);
      if (!Array.isArray(type.schema?.fields) || type.schema.fields.length === 0) note(`行为类型 ${type.id} 缺 schema.fields`);
    }
  } catch (error) {
    note(`平台 ${platform.id} 行为类型加载失败：${error?.message ?? error}`);
  }
  if (!fs.existsSync(behaviorsRoot)) {
    note(`平台 ${platform.id} 缺 behaviors/ 目录`);
  } else {
    try {
      const behaviors = loadBehaviorProfiles({ root: behaviorsRoot });
      for (const behavior of behaviors.values()) {
        if (behavior.platform !== platform.id) note(`行为档案 ${behavior.id} 的 platform=${behavior.platform} 与目录 ${platform.id} 不一致`);
        if (!types.some((type) => type.id === behavior.kind)) note(`行为档案 ${behavior.id} 的 kind=${behavior.kind} 没有对应的行为类型`);
      }
    } catch (error) {
      note(`平台 ${platform.id} 行为档案加载失败：${error?.message ?? error}`);
    }
  }
  // 平台装载入口本身也要能跑通（缺 platform.yml 字段会在这里抛）。
  try { loadPlatform({ root: PLATFORMS_ROOT, id: platform.id }); }
  catch (error) { note(`平台 ${platform.id} 装载失败：${error?.message ?? error}`); }
}

// 2) Agent 平台：agent-platform.yml / tools.yml / capabilities/ / agents/<id>/preset.yml
for (const id of dirs(AGENT_PLATFORMS_ROOT)) {
  const dir = path.join(AGENT_PLATFORMS_ROOT, id);
  for (const name of ['agent-platform.yml', 'tools.yml']) {
    if (!fs.existsSync(path.join(dir, name))) note(`Agent 平台 ${id} 缺 ${name}`);
  }
  const capsDir = path.join(dir, 'capabilities');
  if (!fs.existsSync(capsDir)) note(`Agent 平台 ${id} 缺 capabilities/`);
  const agents = dirs(path.join(dir, 'agents'));
  if (agents.length === 0) note(`Agent 平台 ${id} 没有 agents/`);
  for (const agent of agents) {
    for (const name of ['preset.yml', 'agent.cordis.yml']) {
      if (!fs.existsSync(path.join(dir, 'agents', agent, name))) note(`Agent ${id}/${agent} 缺 ${name}`);
    }
  }
}

// 3) 能力预设：内置四条的 id 必须存在，引用只能在同 Agent 平台内
const capabilities = createCapabilityStore({ root: CAPABILITIES_ROOT }).list();
const capabilityIds = new Set(capabilities.map((item) => item.id));
for (const id of ['agent-chat', 'agent-readonly', 'agent-workspace', 'agent-full']) {
  if (!capabilityIds.has(id)) note(`缺少内置能力预设 ${id}`);
}
if (!fs.existsSync(CAPABILITIES_ROOT)) note(`能力预设目录不存在：${CAPABILITIES_ROOT}`);

// 4) 运行方案：内置六条齐全且只读，引用必须能解析
const plans = createPlanStore({ root: PLANS_ROOT }).list();
const agentIds = new Set();
for (const id of dirs(AGENT_PLATFORMS_ROOT)) {
  for (const agent of dirs(path.join(AGENT_PLATFORMS_ROOT, id, 'agents'))) agentIds.add(agent);
}
const platformIds = new Set(platforms.map((item) => item.id));
const agentPlatformIds = new Set(dirs(AGENT_PLATFORMS_ROOT));
const behaviorIds = new Set();
for (const platform of platforms) {
  const root = path.join(PLATFORMS_ROOT, platform.id, 'behaviors');
  if (!fs.existsSync(root)) continue;
  for (const behavior of loadBehaviorProfiles({ root }).keys()) behaviorIds.add(behavior);
}
for (const id of BUILTIN_PLAN_ORDER) {
  const plan = plans.find((item) => item.id === id);
  if (!plan) { note(`缺少内置方案 ${id}`); continue; }
  if (!plan.builtin) note(`内置方案 ${id} 被改成了非内置（builtin 必须为 true）`);
}
for (const plan of plans) {
  if (!BUILTIN_PLAN_ORDER.includes(plan.id) && plan.builtin) note(`自定义方案 ${plan.id} 不应带 builtin: true`);
  const issues = validatePlanReferences(plan, {
    behaviors: behaviorIds,
    capabilities: capabilityIds,
    agents: agentIds,
    platforms: platformIds,
    agentPlatforms: agentPlatformIds,
  });
  for (const issue of issues) note(`方案 ${plan.id}：${issue}`);
}

// 5) 旧目录残留：绕过 profiles/ 的第二套数据源必须不存在
for (const legacy of ['config/behaviors', 'config/platform', 'dsh/agent-presets']) {
  if (fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', legacy))) {
    note(`检测到旧数据目录 ${legacy}（四层模型只认 profiles/）`);
  }
}

if (problems.length) {
  console.error(`❌ profiles 自检失败（${problems.length} 项）：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`✅ profiles 自检通过：${platforms.length} 个平台、${capabilities.length} 个能力预设、${plans.length} 个方案、${agentIds.size} 个 Agent。`);
