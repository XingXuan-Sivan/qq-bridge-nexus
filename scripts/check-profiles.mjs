#!/usr/bin/env node
// profiles/ 资源契约自检：平台、行为引擎、行为类型、行为档案、能力档。
//
// 统一契约在这里变成可执行的门禁：
//   1. `<dir>/<id>.yml` 与 `<dir>/.defaults/<id>.yml` 成对：副本存在即内置，副本悬空即失败；
//   2. 出厂副本只放内容：行为副本不写 config；
//   3. 字段表与默认值只有引擎定义一份，行为类型只写按名覆盖；
//   4. 行为档案写全量快照（config 键集 = 引擎字段集）；
//   5. 工具面只住平台声明（tools.yml）：能力档只写效果，不得再存 tools / rows / preset；
//   6. 能力档 audience 只认 access / owner，Agent 平台申报的 defaultCapability 必须真实存在；
//   7. 渲染闭环：每份能力档都能被该平台的 render.yml 编译成行，不让效果默默装不出；
//   8. tools.yml 的模块要声明它承担的效果，且效果必须是渲染层认识的。
// 用法：node scripts/check-profiles.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YAML from 'yaml';
import {
  listPlatforms, loadPlatform, readPlatformTools, readAgentPlatformTools, PLATFORM_TOOL_RISKS,
} from '../src/platforms/index.mjs';
import { appliesPreset, createCapabilityStore } from '../src/capabilities/store.mjs';
import { PLATFORM_TOOLS } from '../src/tools/catalog.mjs';
import { loadBehaviorProfiles, validateBehaviorText } from '../src/behaviors/index.mjs';
import { loadBehaviorTypes, typeFields } from '../src/behaviors/types.mjs';
import { flattenConfig, getEngine, listEngines } from '../src/behaviors/engines.mjs';
import { factoryDir, listFactoryIds, readFactoryText } from '../src/profiles/factory.mjs';
import { PLATFORMS_ROOT, AGENT_PLATFORMS_ROOT, SHARED_CAPABILITIES_DIR, agentCapabilitiesDir } from '../src/profiles/paths.mjs';

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
    // 声明是工具面的唯一源：写了目录里没有的 flag 会让注册面与目录漂移。
    if (!PLATFORM_TOOLS.some((item) => item.flag === tool.flag)) note(`平台 ${platform.id} 的工具 ${tool.flag} 不在目录里（src/tools/catalog.mjs）`);
  }
  for (const tool of PLATFORM_TOOLS) {
    if (!tools.some((item) => item.flag === tool.flag)) note(`平台 ${platform.id} 的 tools.yml 缺 ${tool.flag}（工具面必须显式写全）`);
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

// 2) Agent 平台：agent-platform.yml / tools.yml / render.yml / capabilities/
//    render.yml 只在有自己那批能力档时必需：没有能力档就没有行要编译，
//    这时缺渲染层是「不渲染」，不是「忘了写」（ACP 就属于这种）。
const agentPlatformIds = dirs(AGENT_PLATFORMS_ROOT);
for (const id of agentPlatformIds) {
  const dir = path.join(AGENT_PLATFORMS_ROOT, id);
  const capsDir = path.join(dir, 'capabilities');
  const ownCapabilityFiles = ymlFiles(capsDir);
  const required = ['agent-platform.yml', 'tools.yml'];
  if (ownCapabilityFiles.length > 0) required.push('render.yml');
  for (const name of required) {
    if (!fs.existsSync(path.join(dir, name))) note(`Agent 平台 ${id} 缺 ${name}`);
  }
  if (!fs.existsSync(capsDir)) note(`Agent 平台 ${id} 缺 capabilities/`);
  if (fs.existsSync(path.join(dir, 'agents'))) {
    note(`Agent 平台 ${id} 还留着 agents/（能力档已吸收预设，正文由 build 适配器渲染）`);
  }
  // 模块声明本身要合法：readAgentPlatformTools 会静默丢掉非法条目，所以这里读原文对账。
  // `modules: []` 是合法声明（这台执行体的工具面由 Agent 自己定，桥接不渲染任何行）。
  const rawModules = readYaml(path.join(dir, 'tools.yml')).modules;
  if (!Array.isArray(rawModules)) {
    note(`Agent 平台 ${id} 的 tools.yml 缺 modules（没有模块也要显式写 modules: []）`);
  } else {
    for (const module of rawModules) {
      const moduleId = String(module?.id ?? '').trim();
      if (!moduleId) { note(`Agent 平台 ${id} 的 modules 里有一条没有 id`); continue; }
      if (!PLATFORM_TOOL_RISKS.includes(String(module?.risk ?? 'read'))) {
        note(`Agent 平台 ${id} 的模块 ${moduleId} 风险值不合法：${module.risk}`);
      }
      if (!Array.isArray(module?.effects) || module.effects.length === 0) {
        note(`Agent 平台 ${id} 的模块 ${moduleId} 必须声明它承担的效果（effects）`);
      }
    }
  }
}

// 3) 能力档：只写意图（effects / runtime / audience / mcp / skills），出厂副本成对
//    （各 Agent 平台一批 + 一批跨平台共用）
const capabilities = [];
const capabilityIds = new Set();
const declaredCapabilities = new Map();
/** 各 Agent 平台自己的那批档（共用档不参与它的渲染闭环）。 */
const platformCapabilities = new Map();

/** 能力档允许出现的字段：normalizeCapability 会静默丢掉不认识的键，旧形状的残留只能在这里发现。 */
const CAPABILITY_KEYS = new Set([
  'version', 'id', 'label', 'note', 'behavior', 'effects', 'runtime', 'audience', 'mcp', 'skills',
]);

/** 一批能力档的字段约定；返回这批档的归一结果。 */
function checkCapabilityDir(capsRoot, label) {
  checkFactoryPairs(capsRoot, label);
  const shapeRoots = [
    { root: capsRoot, suffix: '' },
    { root: factoryDir(capsRoot), suffix: '（出厂副本）' },
  ];
  for (const { root, suffix } of shapeRoots) {
    for (const name of ymlFiles(root)) {
      const raw = readYaml(path.join(root, name));
      const id = name.replace(/\.ya?ml$/i, '');
      for (const key of Object.keys(raw)) {
        if (!CAPABILITY_KEYS.has(key)) {
          note(`能力档 ${label}/${name}${suffix} 含未知字段 ${key}（能力档只写意图：effects / runtime / audience / mcp / skills）`);
        }
      }
      if (raw.id !== undefined && String(raw.id).trim() !== id) {
        note(`能力档 ${label}/${name}${suffix} 的 id=${raw.id} 与文件名不一致`);
      }
      if (raw.audience !== undefined && !['access', 'owner'].includes(String(raw.audience))) {
        note(`能力档 ${label}/${name}${suffix} 的 audience 只能是 access 或 owner（现在 ${raw.audience}）`);
      }
      if (raw.effects !== undefined && (typeof raw.effects !== 'object' || Array.isArray(raw.effects))) {
        note(`能力档 ${label}/${name}${suffix} 的 effects 必须是「效果: 变体」的映射`);
      }
    }
  }
  const list = createCapabilityStore({ root: capsRoot }).list();
  for (const capability of list) {
    if (capabilityIds.has(capability.id)) continue;
    capabilityIds.add(capability.id);
    capabilities.push(capability);
  }
  return list;
}

// 跨平台共用的能力档：任何 Agent 平台都能选，平台目录里的同名档优先。
const sharedCapabilities = checkCapabilityDir(SHARED_CAPABILITIES_DIR, '共用能力档');
for (const agentId of agentPlatformIds) {
  const own = checkCapabilityDir(agentCapabilitiesDir(agentId), `Agent 平台 ${agentId}`);
  platformCapabilities.set(agentId, own);
  declaredCapabilities.set(agentId, new Set([...own.map((item) => item.id), ...sharedCapabilities.map((item) => item.id)]));
}

// 4) 渲染闭环：能力档只写意图，行由该平台的渲染层生成。
//    「这份意图在这台执行体上装得出什么」必须现在就能算出来，不能等建会话时才报错，
//    更不能默默装不出（degraded）——那就等于能力档写了个不存在的效果。
for (const agentId of agentPlatformIds) {
  const dir = path.join(AGENT_PLATFORMS_ROOT, agentId);
  const renderFile = path.join(dir, 'render.yml');
  if (!fs.existsSync(renderFile)) continue;
  const renderCfg = readYaml(renderFile);
  const order = Array.isArray(renderCfg.order) ? renderCfg.order.map(String) : [];
  if (order.length === 0) note(`render.yml（${agentId}）缺 order（行序就是装配顺序）`);
  for (const slot of ['persona', 'guard']) {
    if (!renderCfg.structure?.[slot]) note(`render.yml（${agentId}）缺 structure.${slot}`);
  }
  for (const effect of Object.keys(renderCfg.effects ?? {})) {
    if (!order.includes(effect)) note(`render.yml（${agentId}）的 effects.${effect} 不在 order 里：声明了也永远装不上`);
  }
  for (const slot of order) {
    if (!renderCfg.structure?.[slot] && !renderCfg.effects?.[slot]) {
      note(`render.yml（${agentId}）的 order 槽位 ${slot} 既不是结构行也没有效果模板`);
    }
  }
  // tools.yml 声明的效果必须被渲染层认识，否则控制台里「谁承担这个效果」与产物对不上。
  for (const module of readAgentPlatformTools({ root: AGENT_PLATFORMS_ROOT, id: agentId })) {
    for (const effect of module.effects) {
      if (!renderCfg.effects?.[effect]) {
        note(`tools.yml（${agentId}）的模块 ${module.id} 声明了渲染层不认识的效果 ${effect}`);
      }
    }
  }
  const render = await import(pathToFileURL(path.join(dir, 'adapters', 'render.mjs')).href);
  const own = platformCapabilities.get(agentId) ?? [];
  for (const capability of own) {
    let rendered;
    try {
      rendered = render.renderPresetRows(capability, renderCfg);
    } catch (error) {
      note(`能力档 ${agentId}/${capability.id} 渲染失败：${error?.message ?? error}`);
      continue;
    }
    for (const item of rendered.degraded) {
      note(`能力档 ${agentId}/${capability.id} 的 ${item.effect} 装不出：${item.reason}`);
    }
    // 要装预设的能力档必须有预设元信息（名称 / 描述 / 序号），否则预设列表也列不出来。
    if (!appliesPreset(capability)) continue;
    try { render.renderPresetMeta(capability.id, renderCfg); }
    catch (error) { note(`能力档 ${agentId}/${capability.id} 没有预设元信息：${error?.message ?? error}`); }
  }
  // 反向：render.yml 声明了元信息的能力档必须真实存在，否则预设列表点了也装不上。
  for (const id of Object.keys(renderCfg.presets ?? {})) {
    if (!own.some((capability) => capability.id === id)) {
      note(`render.yml（${agentId}）的 presets.${id} 没有对应的能力档`);
    }
  }
}

// 5) 引用面：Agent 平台申报的默认能力档必须真实存在。
//    声明面与运行期同一份 agent-platform.yml，静态检查不另建一套判断依据。
await import('../src/agent-side/builtin.mjs');
for (const agentId of agentPlatformIds) {
  const declared = String(readYaml(path.join(AGENT_PLATFORMS_ROOT, agentId, 'agent-platform.yml')).defaultCapability ?? '').trim();
  if (!declared) continue;
  if (!(declaredCapabilities.get(agentId) ?? new Set()).has(declared)) {
    note(`Agent 平台 ${agentId} 的 defaultCapability「${declared}」不是已申报的能力档`);
  }
}

// 6) 旧目录残留：绕过 profiles/ 的第二套数据源必须不存在
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
