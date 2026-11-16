#!/usr/bin/env node
// profiles/ 资源契约自检：平台、行为引擎、行为类型、行为档案、能力档。
//
// 统一契约在这里变成可执行的门禁：
//   1. `<dir>/<id>.yml` 与 `<dir>/.defaults/<id>.yml` 成对：副本存在即内置，副本悬空即失败；
//   2. 出厂副本只放内容：行为副本不写 config；
//   3. 字段表与默认值只有引擎定义一份，行为类型只写按名覆盖；
//   4. 行为档案写全量快照（config 键集 = 引擎字段集）；
//   5. 能力档的 tools.platform 显式写全（缺键即不可见，不许猜默认）；
//   6. 能力档 audience 只认 access / owner，Agent 平台申报的 defaultCapability 必须真实存在。
// 用法：node scripts/check-profiles.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  listPlatforms, loadPlatform, readPlatformTools, PLATFORM_TOOL_RISKS,
} from '../src/platforms/index.mjs';
import { createCapabilityStore } from '../src/capabilities/store.mjs';
import { PLATFORM_TOOLS } from '../src/tools/catalog.mjs';
import { loadBehaviorProfiles, validateBehaviorText } from '../src/behaviors/index.mjs';
import { loadBehaviorTypes, typeFields } from '../src/behaviors/types.mjs';
import { flattenConfig, getEngine, listEngines } from '../src/behaviors/engines.mjs';
import { factoryDir, listFactoryIds, readFactoryText } from '../src/profiles/factory.mjs';
import { PLATFORMS_ROOT, AGENT_PLATFORMS_ROOT, agentCapabilitiesDir } from '../src/profiles/paths.mjs';

const problems = [];
const warnings = [];
const note = (message) => problems.push(message);

function dirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function ymlFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function readYaml(file) {
  return YAML.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) ?? {};
}

/** 出厂副本与生效文件成对：副本存在即内置，所以副本必须有对应的生效文件。 */
function checkFactoryPairs(dir, label) {
  const target = factoryDir(dir);
  if (!fs.existsSync(target)) return;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      note(`${label} 的 .defaults/ 里不应有子目录：${entry.name}`);
      continue;
    }
    if (!/\.ya?ml$/i.test(entry.name)) continue;
    const id = entry.name.replace(/\.ya?ml$/i, '');
    if (!fs.existsSync(path.join(dir, `${id}.yml`))) note(`${label} 的出厂副本 ${id} 没有生效文件（${id}.yml）`);
  }
}

const BEHAVIOR_TYPE_KEYS = new Set(['label', 'platform', 'engine', 'fields']);
const BEHAVIOR_FACTORY_KEYS = new Set(['version', 'platform', 'kind', 'label', 'description', 'prompt']);

// 0) 行为引擎定义：字段清单与默认值的唯一来源
try {
  const engines = listEngines();
  if (!engines.length) note('profiles/behavior-engines 里没有任何引擎定义');
} catch (error) {
  note(`行为引擎定义加载失败：${error?.message ?? error}`);
}

// 1) 平台：platform.yml / tools.yml / prompt.md / prompt.default.md / behavior-types / behaviors
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

  const typesDir = path.join(dir, 'behavior-types');
  let types = [];
  for (const name of ymlFiles(typesDir)) {
    const raw = readYaml(path.join(typesDir, name));
    for (const key of Object.keys(raw)) {
      if (!BEHAVIOR_TYPE_KEYS.has(key)) note(`行为类型 ${name} 含未知字段 ${key}（字段表归引擎定义，类型只写 label/platform/engine/fields）`);
    }
  }
  try {
    types = loadBehaviorTypes({ root: dir });
    if (types.length === 0) note(`平台 ${platform.id} 没有 behavior-types/`);
    for (const type of types) {
      try {
        getEngine(type.engine);
      } catch (error) {
        note(`行为类型 ${type.id} 的引擎无法解析：${error?.message ?? error}`);
        continue;
      }
      try {
        typeFields(type);
      } catch (error) {
        note(`行为类型 ${type.id} 的字段覆盖无效：${error?.message ?? error}`);
      }
    }
  } catch (error) {
    note(`平台 ${platform.id} 行为类型加载失败：${error?.message ?? error}`);
  }

  const behaviorsRoot = path.join(dir, 'behaviors');
  if (!fs.existsSync(behaviorsRoot)) {
    note(`平台 ${platform.id} 缺 behaviors/ 目录`);
  } else {
    // 实例档案是「默认值 + 覆盖」的全量快照：文件里缺键就说明表单写回还在跳过默认值。
    for (const name of ymlFiles(behaviorsRoot)) {
      const id = name.replace(/\.ya?ml$/i, '');
      const raw = readYaml(path.join(behaviorsRoot, name));
      const type = types.find((entry) => entry.id === String(raw?.kind ?? ''));
      if (!type) continue;
      try {
        const fields = typeFields(type);
        const written = Object.keys(flattenConfig(raw?.config ?? {}, fields));
        const total = fields.filter((field) => field?.name).length;
        if (written.length !== total) note(`行为档案 ${id} 的 config 不是全量快照：写入 ${written.length}/${total} 个字段（保存会补齐）`);
      } catch (error) {
        note(`行为档案 ${id} 的 config 校验失败：${error?.message ?? error}`);
      }
    }
    try {
      const behaviors = loadBehaviorProfiles({ root: behaviorsRoot });
      for (const behavior of behaviors.values()) {
        if (behavior.platform !== platform.id) note(`行为档案 ${behavior.id} 的 platform=${behavior.platform} 与目录 ${platform.id} 不一致`);
        if (!types.some((type) => type.id === behavior.kind)) note(`行为档案 ${behavior.id} 的 kind=${behavior.kind} 没有对应的行为类型`);
      }
    } catch (error) {
      note(`平台 ${platform.id} 行为档案加载失败：${error?.message ?? error}`);
    }
    // 出厂副本只放文案：config 是实例的事，默认值在引擎定义里。
    for (const id of listFactoryIds(behaviorsRoot)) {
      const text = readFactoryText(behaviorsRoot, id);
      for (const key of Object.keys(readYaml(path.join(factoryDir(behaviorsRoot), `${id}.yml`)))) {
        if (!BEHAVIOR_FACTORY_KEYS.has(key)) note(`行为出厂副本 ${id} 只能放文案（多出 ${key}）`);
      }
      try {
        validateBehaviorText({ id, text });
      } catch (error) {
        note(`行为出厂副本 ${id} 校验失败：${error?.message ?? error}`);
      }
    }
    checkFactoryPairs(behaviorsRoot, `平台 ${platform.id} 的 behaviors`);
  }

  // 平台装载入口本身也要能跑通（缺 platform.yml 字段会在这里抛）。
  try { loadPlatform({ root: PLATFORMS_ROOT, id: platform.id }); }
  catch (error) { note(`平台 ${platform.id} 装载失败：${error?.message ?? error}`); }
}

// 2) Agent 平台：agent-platform.yml / tools.yml / capabilities/
const agentPlatformIds = dirs(AGENT_PLATFORMS_ROOT);
for (const id of agentPlatformIds) {
  const dir = path.join(AGENT_PLATFORMS_ROOT, id);
  for (const name of ['agent-platform.yml', 'tools.yml']) {
    if (!fs.existsSync(path.join(dir, name))) note(`Agent 平台 ${id} 缺 ${name}`);
  }
  const capsDir = path.join(dir, 'capabilities');
  if (!fs.existsSync(capsDir)) note(`Agent 平台 ${id} 缺 capabilities/`);
  else checkFactoryPairs(capsDir, `Agent 平台 ${id} 的 capabilities`);
  if (fs.existsSync(path.join(dir, 'agents'))) {
    note(`Agent 平台 ${id} 还留着 agents/（能力档已吸收预设，正文由 build 适配器渲染）`);
  }
}

// 3) 能力档：工具面显式写全，audience 取值合法，出厂副本成对（每个 Agent 平台各一批）
const capabilities = [];
const declaredCapabilities = new Map();
for (const agentId of agentPlatformIds) {
  const capsRoot = agentCapabilitiesDir(agentId);
  const list = createCapabilityStore({ root: capsRoot }).list();
  capabilities.push(...list);
  declaredCapabilities.set(agentId, new Set(list.map((item) => item.id)));
  for (const name of ymlFiles(capsRoot)) {
    const raw = readYaml(path.join(capsRoot, name));
    if (raw.audience !== undefined && !['access', 'owner'].includes(String(raw.audience))) {
      note(`能力档 ${agentId}/${name} 的 audience 只能是 access 或 owner（现在 ${raw.audience}）`);
    }
  }
  for (const capability of list) {
    const explicit = capability.tools?.platform ?? {};
    for (const tool of PLATFORM_TOOLS) {
      if (typeof explicit[tool.flag] !== 'boolean') note(`能力档 ${agentId}/${capability.id} 的 tools.platform 缺 ${tool.flag}（必须显式写全）`);
    }
    for (const flag of Object.keys(explicit)) {
      if (!PLATFORM_TOOLS.some((tool) => tool.flag === flag)) note(`能力档 ${agentId}/${capability.id} 的 tools.platform 含未知工具 ${flag}`);
    }
  }
}

// 4) 引用面：Agent 平台申报的默认能力档必须真实存在。
//    声明面与运行期同一份 agent-platform.yml，静态检查不另建一套判断依据。
await import('../src/agent-side/builtin.mjs');
for (const agentId of agentPlatformIds) {
  const declared = String(readYaml(path.join(AGENT_PLATFORMS_ROOT, agentId, 'agent-platform.yml')).defaultCapability ?? '').trim();
  if (!declared) continue;
  if (!(declaredCapabilities.get(agentId) ?? new Set()).has(declared)) {
    note(`Agent 平台 ${agentId} 的 defaultCapability「${declared}」不是已申报的能力档`);
  }
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
if (warnings.length) {
  console.warn(`⚠️ profiles 自检提示（${warnings.length} 项，不阻断）：`);
  for (const warning of warnings) console.warn(`  - ${warning}`);
}
console.log(`✅ profiles 自检通过：${platforms.length} 个平台、${capabilities.length} 个能力档。`);
