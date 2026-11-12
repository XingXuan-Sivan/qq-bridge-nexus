// Agent 侧能力预设：profiles/agent-platforms/dsh/capabilities/<id>.yml。
//
// 能力预设只描述「这个 Agent 拿到什么」——平台工具开关、Agent 工具模块、MCP 服务器/工具、
// 技能；不再包含提示词底稿、安全段、排序或风险上限（那些由 Agent 平台适配器与系统提供）。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { AGENT_PLATFORMS_ROOT } from '../profiles/paths.mjs';
import { capabilityCovers, capabilityDefaults, PLATFORM_TOOLS, AGENT_MODULES, BUILTIN_CAPABILITY_IDS } from '../tools/catalog.mjs';

export const CAPABILITIES_ROOT = path.join(AGENT_PLATFORMS_ROOT, 'dsh', 'capabilities');

const CAPABILITY_HEADER = '# 能力预设（Agent 侧）：只描述拿到什么工具与能力，不写提示词/安全段。\n'
  + '# 由控制台「行为档案 › 能力预设」维护；保存即写回本文件，无需重建产物。';

function boolMap(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, item] of Object.entries(value)) {
    if (item === true || item === false) out[key] = item;
  }
  return out;
}

function mcpList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const server = String(item?.server ?? '').trim();
    if (!server) return null;
    const tools = item?.tools;
    return {
      server,
      tools: tools === '*' || tools === undefined || tools === null ? '*' : (Array.isArray(tools) ? tools.map(String) : '*'),
    };
  }).filter(Boolean);
}

function stringList(value) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

/** 归一并校验一份能力预设；id 来自文件名。Agent 模块不在这里（由 Agent 预设计决定）。 */
export function normalizeCapability(raw, { id, source = 'capability' } = {}) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!value) throw new Error(`${source} 必须是对象`);
  const name = String(id ?? value.id ?? '').trim();
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(name)) throw new Error(`${source}.id 不合法：${name || '(空)'}`);
  const label = String(value.label ?? '').trim() || name;
  return {
    version: Number.isInteger(Number(value.version)) ? Number(value.version) : 1,
    id: name,
    label,
    note: String(value.note ?? '').trim(),
    tools: {
      platform: boolMap(value.tools?.platform),
      mcp: mcpList(value.tools?.mcp),
      skills: stringList(value.tools?.skills),
    },
  };
}

function capabilityText(capability) {
  const body = YAML.stringify({
    version: capability.version,
    id: capability.id,
    label: capability.label,
    note: capability.note,
    tools: capability.tools,
  }, { lineWidth: 0, singleQuote: true }).replace(/\n+$/, '');
  return `${CAPABILITY_HEADER}\n\n${body}\n`;
}

export function capabilityFile(root, id) {
  const name = String(id ?? '').trim();
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(name)) throw new Error(`能力预设 id 不合法：${name || '(空)'}`);
  return path.join(root, `${name}.yml`);
}

/** 平台工具可见集：显式写了按显式，没写按能力的默认模板（defaultOff 默认不进）。 */
export function visiblePlatformFlags(capability) {
  const preset = capabilityDefaults(capability?.id) ?? capabilityDefaults('agent-chat');
  const allVisible = preset?.platform === true;
  const defaults = new Set(Array.isArray(preset?.platform) ? preset.platform : []);
  const explicit = capability?.tools?.platform ?? {};
  const visible = [];
  for (const tool of PLATFORM_TOOLS) {
    const value = explicit[tool.flag];
    const byDefault = defaults.has(tool.flag) || (allVisible && tool.defaultOff !== true);
    if (value === true || (value === undefined && byDefault)) visible.push(tool.flag);
  }
  return visible;
}

/** 这套能力允许该工具吗？只对可收紧的副作用工具有意义（读类恒 true）。 */
export function capabilityAllowsFlag(capability, flag) {
  if (!capabilityCovers(flag)) return true;
  if (!capability) return true;
  return visiblePlatformFlags(capability).includes(flag);
}

/** 能力的 Agent 模块 id 列表（历史字段，已不再由能力决定）。 */
export function agentModulesOf() {
  return [];
}

export function createCapabilityStore({ root = CAPABILITIES_ROOT, log = () => {} } = {}) {
  function files() {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => entry.name)
      .filter((name) => name !== 'example.yml')
      .sort();
  }

  function decorate(capability) {
    return {
      ...capability,
      builtin: BUILTIN_CAPABILITY_IDS.includes(capability.id),
      platformVisible: visiblePlatformFlags(capability),
      agentModules: agentModulesOf(capability),
    };
  }

  function readFile(file) {
    const id = file.replace(/\.ya?ml$/i, '');
    const raw = YAML.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
    return normalizeCapability(raw, { id, source: `capabilities/${file}` });
  }

  function list() {
    return files().map(readFile).map(decorate).sort((a, b) => a.id.localeCompare(b.id));
  }

  function get(id) {
    const name = String(id ?? '').trim();
    if (!name) return null;
    const capability = list().find((item) => item.id === name);
    return capability ?? null;
  }

  /** 保存 = 只写这一个 YAML；不再生成 DSH 产物（工具面由 Agent 平台在装配时读取）。 */
  function save(id, patch = {}) {
    const current = get(id);
    const base = current ?? normalizeCapability({ label: id, note: '', tools: {} }, { id });
    const builtin = BUILTIN_CAPABILITY_IDS.includes(base.id);
    const next = normalizeCapability({
      ...base,
      // 内置预设的名称/备注是固定文案，只允许改工具面。
      label: builtin ? base.label : (patch.label ?? base.label),
      note: builtin ? base.note : (patch.note ?? base.note),
      tools: {
        platform: patch.tools?.platform ?? base.tools.platform,
        mcp: patch.tools?.mcp ?? base.tools.mcp,
        skills: patch.tools?.skills ?? base.tools.skills,
      },
    }, { id });
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(capabilityFile(root, id), capabilityText(next), 'utf8');
    log(`[capabilities] 已保存 ${id}`);
    return decorate(next);
  }

  /** 删除自定义能力；内置四条不允许删（只能克隆改）。 */
  function remove(id) {
    const name = String(id ?? '').trim();
    const current = get(name);
    if (!current) throw new Error('没有这个能力预设');
    if (current.builtin) throw new Error('内置能力预设只读：请先克隆一份再改');
    fs.rmSync(capabilityFile(root, name), { force: true });
    log(`[capabilities] 已删除 ${name}`);
    return { id: name };
  }

  /** 内置能力重置：把 .defaults/<id>.yml 抄回当前文件（自定义能力没有出厂副本）。 */
  function reset(id) {
    const name = String(id ?? '').trim();
    if (!BUILTIN_CAPABILITY_IDS.includes(name)) throw new Error('只有内置能力预设可以重置');
    const factory = path.join(root, '.defaults', `${name}.yml`);
    if (!fs.existsSync(factory)) throw new Error('缺少出厂副本，无法重置');
    fs.mkdirSync(root, { recursive: true });
    fs.copyFileSync(factory, capabilityFile(root, name));
    log(`[capabilities] 已重置 ${name}`);
    return decorate(readFile(`${name}.yml`));
  }

  return { root, list, get, save, remove, reset };
}

/**
 * 平台工具注册开关：所有能力预设 platformVisible 的并集。
 * 桥接与 MCP 脚本共用这一个函数，避免两份配置产生分歧。
 */
export function platformFlags({ root = CAPABILITIES_ROOT, log = () => {} } = {}) {
  const flags = Object.fromEntries(PLATFORM_TOOLS.map((tool) => [tool.flag, false]));
  try {
    const capabilities = createCapabilityStore({ root, log }).list();
    if (!capabilities.length) {
      for (const tool of PLATFORM_TOOLS) flags[tool.flag] = tool.defaultOff !== true;
      log('[capabilities] 没有能力预设，平台工具按目录默认值注册');
      return flags;
    }
    for (const capability of capabilities) {
      for (const flag of capability.platformVisible ?? []) flags[flag] = true;
    }
  } catch (error) {
    log(`[capabilities] 平台工具开关推导失败，按全部关闭处理：${error?.message ?? error}`);
  }
  return flags;
}
