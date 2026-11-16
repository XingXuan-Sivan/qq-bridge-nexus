// Agent 侧能力档：profiles/agent-platforms/<Agent 平台 id>/capabilities/<id>.yml，
// 外加跨平台共用的 profiles/capabilities/<id>.yml（直通档这类与执行体无关的档位）。
//
// 一个能力档是**唯一档位真源**，五段各管一件事：
//   tools      拿到什么（平台工具开关 / Agent 模块 / MCP 服务器与工具 / 技能）
//   runtime    怎么生效（装不装预设 / 提示怎么注入 / 建会话时要不要钉对端权限档）
//   audience   谁能用（`access` = 受准入名单约束的普通会话，`owner` = 仅主人与管理员私聊）
//   preset     Agent 平台预设的元信息（名字 / 描述 / 顺序 / 绑定行为）
//   rows       预设正文（Agent 平台的插件行列表，由该平台的 build 适配器渲染成产物）
//   extensions 扩展授权（MCP / 技能白名单，Hub 读取）
// 能力档 id 与 Agent 预设 id 同名：会话只引用能力，不再另写 preset 名。
// `runtime.apply: passthrough` 的能力档不装预设（rows 允许为空），
// 此时 preset 段只作为「建议值」供界面展示，不参与构建。
import fs from 'node:fs';
import path from 'node:path';
import YAML, { parseDocument } from 'yaml';
import { copyFactory, hasFactory } from '../profiles/factory.mjs';
import { capabilityCovers, PLATFORM_TOOLS } from '../tools/catalog.mjs';

/**
 * 能力档目录只属于某个 Agent 平台（`agentCapabilitiesDir(id)`），这里不自带默认值：
 * 缺 root 就报错，免得下一个平台的工具面被默默读成别的平台的。
 * `sharedRoot` 是跨平台共用目录：平台目录里的同名档优先，共用档只读。
 */
function requireRoot(root) {
  if (!root) throw new Error('能力档目录未指定：调用方要传当前 Agent 平台的 capabilities 目录');
  return root;
}

const CAPABILITY_HEADER = '# 能力档（Agent 侧）：tools = 工具面，runtime = 生效方式，audience = 可用受众，preset = 预设元信息，rows = 插件行列表。\n'
  + '# 由控制台平台详情的「能力」维护；保存 tools 不会重写 preset / rows。';

const PRESET_KEYS = Object.freeze(['name', 'description', 'order', 'behavior']);

/** 生效方式：装预设，还是交给执行体自己（直通）。 */
export const CAPABILITY_APPLY = Object.freeze(['preset', 'passthrough']);
/** 提示注入通道：不注入 / 系统提示 / 首轮前缀 / 只靠工具拉取。 */
export const CAPABILITY_PROMPT = Object.freeze(['none', 'system', 'prefix', 'tool']);
/** 可用受众：普通准入会话，还是仅主人 / 管理员私聊。 */
export const CAPABILITY_AUDIENCE = Object.freeze(['access', 'owner']);

const RUNTIME_KEYS = Object.freeze(['apply', 'prompt', 'peerPermission', 'narrow']);

/** `runtime` 段缺省值：不写这一段的能力档行为与引入前完全一致。 */
export const CAPABILITY_RUNTIME_DEFAULTS = Object.freeze({
  apply: 'preset',
  prompt: 'none',
  peerPermission: '',
  narrow: [],
});

/** `audience` 段缺省值：不写时等于「受准入名单约束」，与引入前一致。 */
export const CAPABILITY_AUDIENCE_DEFAULT = 'access';

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
  if (!Array.isArray(value)) return [];
  // 去重：控制台表单会整批回写，重复项在 YAML 里看不出来却会让授权面板显示成两条。
  return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
}

/** 扩展授权（Hub 读取）：与能力档同文件，缺省 = 全部拒绝。 */
export function normalizeExtensions(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const mcp = source.mcp && typeof source.mcp === 'object' ? source.mcp : {};
  const tools = mcp.tools && typeof mcp.tools === 'object' ? mcp.tools : {};
  const skills = source.skills && typeof source.skills === 'object' ? source.skills : {};
  return {
    mcp: {
      allow: stringList(mcp.allow),
      tools: { allow: stringList(tools.allow), deny: stringList(tools.deny) },
    },
    skills: { allow: stringList(skills.allow) },
  };
}

/**
 * 生效方式（`runtime` 段）。任何一项取值非法都直接报错 —— 猜一个默认值会把
 * 「不装预设」的能力悄悄装成预设，安全边界与档位权威都会跟着错位。
 *
 * `peerPermission` 是**执行体那一侧**的权限档名（空 = 不碰，用平台默认）：只在建会话时
 * 钉一次，之后随能力档走。它与会话权限级别无关 —— 那个只过滤桥接自己的工具。
 */
export function normalizeRuntime(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const apply = value.apply === undefined || value.apply === '' ? CAPABILITY_RUNTIME_DEFAULTS.apply : String(value.apply).trim();
  if (!CAPABILITY_APPLY.includes(apply)) throw new Error(`runtime.apply 只能是 ${CAPABILITY_APPLY.join(' / ')}：${apply}`);
  const prompt = value.prompt === undefined || value.prompt === '' ? CAPABILITY_RUNTIME_DEFAULTS.prompt : String(value.prompt).trim();
  if (!CAPABILITY_PROMPT.includes(prompt)) throw new Error(`runtime.prompt 只能是 ${CAPABILITY_PROMPT.join(' / ')}：${prompt}`);
  return { apply, prompt, peerPermission: String(value.peerPermission ?? '').trim(), narrow: stringList(value.narrow) };
}

/** 预设元信息：没有 name = 该能力档不渲染 Agent 预设（纯工具档）。 */
export function normalizePreset(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = String(raw.name ?? '').trim();
  if (!name) return null;
  const order = Number(raw.order);
  return {
    name,
    description: String(raw.description ?? '').trim(),
    order: Number.isInteger(order) ? order : 999,
    behavior: String(raw.behavior ?? '').trim(),
  };
}

/** 预设正文：只做“是对象数组”的降级过滤，行内容由 Agent 平台的 build 适配器校验。 */
function normalizeRows(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
}

/** 归一并校验一份能力档；id 来自文件名。 */
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
      agent: boolMap(value.tools?.agent),
      mcp: mcpList(value.tools?.mcp),
      skills: stringList(value.tools?.skills),
    },
    runtime: normalizeRuntime(value.runtime),
    audience: CAPABILITY_AUDIENCE.includes(String(value.audience ?? '').trim())
      ? String(value.audience).trim()
      : CAPABILITY_AUDIENCE_DEFAULT,
    preset: normalizePreset(value.preset),
    extensions: normalizeExtensions(value.extensions),
    rows: normalizeRows(value.rows),
  };
}

/** 该能力档是否要装预设（passthrough 不装、不产 patch）。 */
export function appliesPreset(capability) {
  return (capability?.runtime?.apply ?? CAPABILITY_RUNTIME_DEFAULTS.apply) === 'preset';
}

function capabilityText(capability) {
  const body = {
    version: capability.version,
    id: capability.id,
    label: capability.label,
    note: capability.note,
    tools: capability.tools,
  };
  // 只在偏离缺省时写这一段：新建的普通能力档不必为「和以前一样」多背四行。
  const runtime = capability.runtime ?? CAPABILITY_RUNTIME_DEFAULTS;
  if (RUNTIME_KEYS.some((key) => JSON.stringify(runtime[key]) !== JSON.stringify(CAPABILITY_RUNTIME_DEFAULTS[key]))) {
    body.runtime = Object.fromEntries(RUNTIME_KEYS.map((key) => [key, runtime[key]]));
  }
  if (capability.audience && capability.audience !== CAPABILITY_AUDIENCE_DEFAULT) body.audience = capability.audience;
  if (capability.preset) {
    body.preset = Object.fromEntries(PRESET_KEYS.filter((key) => capability.preset[key] !== '').map((key) => [key, capability.preset[key]]));
  }
  if (capability.rows.length) body.rows = capability.rows;
  const text = YAML.stringify(body, { lineWidth: 0, singleQuote: true });
  return `${CAPABILITY_HEADER}\n\n${text}`;
}

export function capabilityFile(root, id) {
  const name = String(id ?? '').trim();
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(name)) throw new Error(`能力预设 id 不合法：${name || '(空)'}`);
  return path.join(root, `${name}.yml`);
}

/**
 * 平台工具可见集：只看能力档自己写的 tools.platform，缺的键就是不可见。
 * 白名单不许猜：没写的不当成「默认开」，也不回落某条内置能力档的模板。
 */
export function visiblePlatformFlags(capability) {
  const explicit = capability?.tools?.platform ?? {};
  return PLATFORM_TOOLS.filter((tool) => explicit[tool.flag] === true).map((tool) => tool.flag);
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

export function createCapabilityStore({ root, sharedRoot = null, log = () => {} } = {}) {
  requireRoot(root);
  /**
   * 能力档来源：先平台目录、后共用目录，同一个 id 只认第一个 —— 平台可以覆盖共用档，
   * 但共用档自身不会被写成两份。返回顺序即列表顺序。
   */
  function sources() {
    const out = new Map();
    for (const [dir, shared] of [[root, false], [sharedRoot, true]]) {
      if (!dir || !fs.existsSync(dir)) continue;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
        const id = entry.name.replace(/\.ya?ml$/i, '');
        if (id === 'example' || out.has(id)) continue;
        out.set(id, { dir, file: entry.name, id, shared });
      }
    }
    return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  function sourceOf(id) {
    const name = String(id ?? '').trim();
    return sources().find((item) => item.id === name) ?? null;
  }

  /** 共用档只读：改动会波及所有 Agent 平台，只能克隆到平台目录后再改。 */
  function writableSource(id) {
    const source = sourceOf(id);
    if (!source) throw new Error(`没有这个能力档：${id}`);
    if (source.shared) throw new Error(`${source.id} 是跨 Agent 平台共用的能力档（只读）：请先克隆一份到当前平台再改`);
    return source;
  }

  function decorate(capability, source, { withRows = false } = {}) {
    const { rows, ...rest } = capability;
    return {
      ...rest,
      builtin: hasFactory(source.dir, capability.id),
      shared: source.shared === true,
      platformVisible: visiblePlatformFlags(capability),
      agentModules: agentModulesOf(capability),
      hasRows: rows.length > 0,
      rowsCount: rows.length,
      ...(withRows ? { rows } : {}),
    };
  }

  function readFile({ dir, file, id }) {
    const raw = YAML.parse(fs.readFileSync(path.join(dir, file), 'utf8').replace(/^\uFEFF/, ''));
    return normalizeCapability(raw, { id, source: `capabilities/${file}` });
  }

  /** 列表不带 rows（一个预设正文就是几千字符，5 份一起回会把控制台接口撞到几百 KB）。 */
  function list() {
    return sources().map((source) => decorate(readFile(source), source));
  }

  function get(id) {
    const source = sourceOf(id);
    if (!source) return null;
    return decorate(readFile(source), source, { withRows: true });
  }

  function docFor(id) {
    const source = writableSource(id);
    const file = path.join(source.dir, source.file);
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const doc = parseDocument(text);
    if (doc.errors.length) throw new Error(`capabilities/${source.id}.yml 不是合法 YAML：${doc.errors[0].message}`);
    return { file, doc };
  }

  /** 局部写回：只改指定段，其余文本（包括 rows 里的注释）保持原样。 */
  function mutate(id, apply) {
    const { file, doc } = docFor(id);
    apply(doc);
    fs.writeFileSync(file, `${String(doc).replace(/\n+$/, '')}\n`, 'utf8');
    log(`[capabilities] 已保存 ${id}`);
    return get(id);
  }

  /**
   * 保存工具面（控制台能力面板）。新建时写出完整能力档；已有文件只改 tools / label / note。
   */
  function save(id, patch = {}) {
    const current = get(id);
    if (current?.shared) throw new Error(`${current.id} 是跨 Agent 平台共用的能力档（只读）：请先克隆一份到当前平台再改`);
    const base = current ?? normalizeCapability({ label: id, note: '', tools: {} }, { id });
    const builtin = current?.builtin === true;
    const next = normalizeCapability({
      ...base,
      // 内置预设的名称/备注是固定文案，只允许改工具面。
      label: builtin ? base.label : (patch.label ?? base.label),
      note: builtin ? base.note : (patch.note ?? base.note),
      tools: {
        platform: patch.tools?.platform ?? base.tools.platform,
        agent: patch.tools?.agent ?? base.tools.agent,
        mcp: patch.tools?.mcp ?? base.tools.mcp,
        skills: patch.tools?.skills ?? base.tools.skills,
      },
    }, { id });
    if (!current) {
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(capabilityFile(root, id), capabilityText(next), 'utf8');
      log(`[capabilities] 已创建 ${id}`);
      return get(id);
    }
    return mutate(id, (doc) => {
      doc.set('label', next.label);
      doc.set('note', next.note);
      doc.setIn(['tools', 'platform'], next.tools.platform);
      doc.setIn(['tools', 'agent'], next.tools.agent);
      doc.setIn(['tools', 'mcp'], next.tools.mcp);
      doc.setIn(['tools', 'skills'], next.tools.skills);
    });
  }

  /** 预设元信息（Agent 平台预设的名字/描述/顺序/绑定行为）。传 null 删除该段。 */
  function setPreset(id, patch = null) {
    const next = normalizePreset(patch);
    if (!next) throw new Error('预设元信息缺少 name');
    return mutate(id, (doc) => {
      for (const key of PRESET_KEYS) {
        if (!next[key]) doc.deleteIn(['preset', key]);
        else doc.setIn(['preset', key], next[key]);
      }
    });
  }

  /** 预设正文（插件行列表）：整段覆盖；高级编辑与表单编辑都走这里。 */
  function setRows(id, rows) {
    const next = normalizeRows(rows);
    // 直通不装预设，行列表为空是它的正常形态；装预设的空正文才是错误。
    if (!next.length && appliesPreset(get(id))) throw new Error('插件行列表不能为空');
    return mutate(id, (doc) => { doc.set('rows', next); });
  }

  /** 生效方式（apply / prompt / permission / narrow）。 */
  function setRuntime(id, patch = {}) {
    const current = get(id);
    if (!current) throw new Error(`没有这个能力档：${id}`);
    const next = normalizeRuntime({ ...current.runtime, ...(patch ?? {}) });
    return mutate(id, (doc) => {
      for (const key of RUNTIME_KEYS) doc.setIn(['runtime', key], next[key]);
    });
  }

  /** 扩展授权（MCP / 技能白名单）。 */
  function setExtensions(id, patch = {}) {
    const next = normalizeExtensions(patch);
    return mutate(id, (doc) => {
      doc.set('extensions', next);
    });
  }

  /** 删除自定义能力；内置与跨平台共用的能力档不允许删（只能克隆改）。 */
  function remove(id) {
    const name = String(id ?? '').trim();
    const current = get(name);
    if (!current) throw new Error('没有这个能力档');
    if (current.shared) throw new Error('跨 Agent 平台共用的能力档不能删除');
    if (current.builtin) throw new Error('内置能力档只读：请先克隆一份再改');
    fs.rmSync(capabilityFile(root, name), { force: true });
    log(`[capabilities] 已删除 ${name}`);
    return { id: name };
  }

  /** 重置：把所在目录的 .defaults/<id>.yml 抄回当前文件（没有出厂副本的能力档不可重置）。 */
  function reset(id) {
    const name = String(id ?? '').trim();
    const source = sourceOf(name);
    if (!source) throw new Error('没有这个能力档');
    if (!hasFactory(source.dir, name)) throw new Error('只有带出厂副本的能力档可以重置');
    copyFactory(source.dir, name);
    log(`[capabilities] 已重置 ${name}`);
    return get(name);
  }

  return { root, list, get, save, setPreset, setRows, setRuntime, setExtensions, remove, reset };
}

/**
 * 平台工具注册开关：所有能力预设 platformVisible 的并集。
 * 桥接与 MCP 脚本共用这一个函数，避免两份配置产生分歧。
 */
export function platformFlags({ root, sharedRoot = null, log = () => {} } = {}) {
  requireRoot(root);
  const flags = Object.fromEntries(PLATFORM_TOOLS.map((tool) => [tool.flag, false]));
  try {
    const capabilities = createCapabilityStore({ root, sharedRoot, log }).list();
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
