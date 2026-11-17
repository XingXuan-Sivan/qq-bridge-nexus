// Agent 侧能力档：profiles/agent-platforms/<Agent 平台 id>/capabilities/<id>.yml，
// 外加跨平台共用的 profiles/capabilities/<id>.yml（直通档这类与执行体无关的档位）。
//
// 能力档只写**意图**，六段各管一件事：
//   effects    要哪些 Agent 侧效果（fs.read / shell.exec …，词表见 docs/CAPABILITY_CONTRACT.md §3.4.2）
//   behavior   绑定哪个行为档案
//   runtime    怎么生效（装不装预设 / 提示怎么注入 / 建会话时要不要钉对端权限档）
//   audience   谁能用（`access` = 受准入名单约束的普通会话，`owner` = 仅主人与管理员私聊）
//   mcp/skills 扩展授权（Hub 读取；缺省 = 全部拒绝）
//
// 插件名、行序、默认 config、人格文案都不在这里：那是执行体的渲染层
// （profiles/agent-platforms/<id>/adapters/render.yml）的事。同一份意图换一个执行体，
// 由那个执行体渲染成它自己的形状 —— 能力档不认识任何平台的插件。
// 能力档 id 与 Agent 预设 id 同名：会话只引用能力，不再另写预设名。
// `runtime.apply: passthrough` 的能力档不装预设，渲染层不产出行。
import fs from 'node:fs';
import path from 'node:path';
import YAML, { parseDocument } from 'yaml';
import { copyFactory, hasFactory } from '../profiles/factory.mjs';
import { declaredToolFlags } from '../tools/catalog.mjs';

/**
 * 能力档目录只属于某个 Agent 平台（`agentCapabilitiesDir(id)`），这里不自带默认值：
 * 缺 root 就报错，免得下一个平台的工具面被默默读成别的平台的。
 * `sharedRoot` 是跨平台共用目录：平台目录里的同名档优先，共用档只读。
 */
function requireRoot(root) {
  if (!root) throw new Error('能力档目录未指定：调用方要传当前 Agent 平台的 capabilities 目录');
  return root;
}

const CAPABILITY_HEADER = '# 能力档（Agent 侧）：effects = 要哪些效果，behavior = 绑定的行为档案，\n'
  + '# runtime = 生效方式，audience = 可用受众，mcp / skills = 扩展授权。\n'
  + '# 由控制台平台详情的「能力」维护；插件行由该平台的渲染层生成，不在能力档里写。';

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

/** 效果名文法：`域.动作`（fs.read / web.access / approval.gate）。 */
const EFFECT_NAME_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/;
/** 效果取值里的变体名（web.access 的 mcp / builtin）。 */
const EFFECT_VARIANT_RE = /^[a-z][a-z0-9-]*$/;
/** 行为档案 id 文法（与行为档案文件名同一条）。 */
const BEHAVIOR_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

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
 * 效果段：键是效果名，值是 `true`（缺省变体）/ `false`（显式关掉）/ 变体名。
 * 不校验效果名是否存在于某个执行体 —— 那是渲染层的事（装了才知道），
 * 这里只保证形状合法，免得能力档里出现 `fs:read` 这种拼错的键一路带到产物里。
 */
export function normalizeEffects(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!EFFECT_NAME_RE.test(key)) throw new Error(`effects 的键必须是「域.动作」形式：${key}`);
    if (value === true || value === false) {
      out[key] = value;
      continue;
    }
    const variant = String(value ?? '').trim();
    if (!EFFECT_VARIANT_RE.test(variant)) {
      throw new Error(`effects.${key} 只能写 true / false / 变体名：${JSON.stringify(value)}`);
    }
    out[key] = variant;
  }
  return out;
}

/** 该能力档要哪些效果（true 与变体名都算「要」，false 不算）。 */
export function capabilityEffects(capability) {
  return Object.entries(capability?.effects ?? {})
    .filter(([, value]) => value !== false)
    .map(([effect, value]) => ({ effect, variant: value === true ? 'default' : value }));
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

/** 归一并校验一份能力档；id 来自文件名。 */
export function normalizeCapability(raw, { id, source = 'capability' } = {}) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!value) throw new Error(`${source} 必须是对象`);
  const name = String(id ?? value.id ?? '').trim();
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(name)) throw new Error(`${source}.id 不合法：${name || '(空)'}`);
  const label = String(value.label ?? '').trim() || name;
  const behavior = String(value.behavior ?? '').trim();
  if (behavior && !BEHAVIOR_RE.test(behavior)) throw new Error(`${source}.behavior 必须是行为档案 id：${behavior}`);
  // 顶层 mcp / skills 与 Hub 授权同形（allow / tools.allow / tools.deny），复用同一份归一。
  const grants = normalizeExtensions({ mcp: value.mcp, skills: value.skills });
  return {
    version: Number.isInteger(Number(value.version)) ? Number(value.version) : 1,
    id: name,
    label,
    note: String(value.note ?? '').trim(),
    behavior,
    effects: normalizeEffects(value.effects),
    runtime: normalizeRuntime(value.runtime),
    audience: CAPABILITY_AUDIENCE.includes(String(value.audience ?? '').trim())
      ? String(value.audience).trim()
      : CAPABILITY_AUDIENCE_DEFAULT,
    mcp: grants.mcp,
    skills: grants.skills,
  };
}

/** 该能力档是否要装预设（passthrough 不装、不产 patch）。 */
export function appliesPreset(capability) {
  return (capability?.runtime?.apply ?? CAPABILITY_RUNTIME_DEFAULTS.apply) === 'preset';
}

/** 授权段是否全空（控制台据此显示「全部拒绝」）。 */
export function hasGrants(capability) {
  const mcp = capability?.mcp ?? { allow: [], tools: { allow: [], deny: [] } };
  const skills = capability?.skills ?? { allow: [] };
  return Boolean(mcp.allow.length || mcp.tools.allow.length || mcp.tools.deny.length || skills.allow.length);
}

function capabilityText(capability) {
  const body = {
    version: capability.version,
    id: capability.id,
    label: capability.label,
    note: capability.note,
  };
  if (capability.behavior) body.behavior = capability.behavior;
  if (Object.keys(capability.effects).length) body.effects = capability.effects;
  // 只在偏离缺省时写这一段：新建的普通能力档不必为「和以前一样」多背四行。
  const runtime = capability.runtime ?? CAPABILITY_RUNTIME_DEFAULTS;
  if (RUNTIME_KEYS.some((key) => JSON.stringify(runtime[key]) !== JSON.stringify(CAPABILITY_RUNTIME_DEFAULTS[key]))) {
    body.runtime = Object.fromEntries(RUNTIME_KEYS.map((key) => [key, runtime[key]]));
  }
  if (capability.audience && capability.audience !== CAPABILITY_AUDIENCE_DEFAULT) body.audience = capability.audience;
  if (hasGrants({ mcp: capability.mcp, skills: capability.skills })) {
    body.mcp = capability.mcp;
    body.skills = capability.skills;
  }
  const text = YAML.stringify(body, { lineWidth: 0, singleQuote: true });
  return `${CAPABILITY_HEADER}\n\n${text}`;
}

export function capabilityFile(root, id) {
  const name = String(id ?? '').trim();
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(name)) throw new Error(`能力预设 id 不合法：${name || '(空)'}`);
  return path.join(root, `${name}.yml`);
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

  function decorate(capability, source) {
    return {
      ...capability,
      builtin: hasFactory(source.dir, capability.id),
      shared: source.shared === true,
      hasGrants: hasGrants(capability),
    };
  }

  function readFile({ dir, file, id }) {
    const raw = YAML.parse(fs.readFileSync(path.join(dir, file), 'utf8').replace(/^\uFEFF/, ''));
    return normalizeCapability(raw, { id, source: `capabilities/${file}` });
  }

  function list() {
    return sources().map((source) => decorate(readFile(source), source));
  }

  function get(id) {
    const source = sourceOf(id);
    if (!source) return null;
    return decorate(readFile(source), source);
  }

  function docFor(id) {
    const source = writableSource(id);
    const file = path.join(source.dir, source.file);
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const doc = parseDocument(text);
    if (doc.errors.length) throw new Error(`capabilities/${source.id}.yml 不是合法 YAML：${doc.errors[0].message}`);
    return { file, doc };
  }

  /** 局部写回：只改指定段，其余文本（包括注释）保持原样。 */
  function mutate(id, apply) {
    const { file, doc } = docFor(id);
    apply(doc);
    fs.writeFileSync(file, `${String(doc).replace(/\n+$/, '')}\n`, 'utf8');
    log(`[capabilities] 已保存 ${id}`);
    return get(id);
  }

  /**
   * 保存意图（控制台能力面板）：新建时写完整能力档，已有文件只改提供的段。
   * 提示词与插件行不在这里 —— 它们是执行体渲染层的产物。
   */
  function save(id, patch = {}) {
    const current = get(id);
    if (current?.shared) throw new Error(`${current.id} 是跨 Agent 平台共用的能力档（只读）：请先克隆一份到当前平台再改`);
    const base = current ?? normalizeCapability({ label: id, note: '' }, { id });
    const builtin = current?.builtin === true;
    const next = normalizeCapability({
      ...base,
      // 内置能力档的名称/备注是固定文案，只允许改效果与授权。
      label: builtin ? base.label : (patch.label ?? base.label),
      note: builtin ? base.note : (patch.note ?? base.note),
      effects: patch.effects ?? base.effects,
      runtime: patch.runtime ?? base.runtime,
      audience: patch.audience ?? base.audience,
      mcp: patch.mcp ?? base.mcp,
      skills: patch.skills ?? base.skills,
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
      if (Object.keys(next.effects).length) doc.set('effects', next.effects);
      else doc.delete('effects');
      if (next.behavior) doc.set('behavior', next.behavior);
      const runtime = next.runtime;
      if (RUNTIME_KEYS.some((key) => JSON.stringify(runtime[key]) !== JSON.stringify(CAPABILITY_RUNTIME_DEFAULTS[key]))) {
        for (const key of RUNTIME_KEYS) doc.setIn(['runtime', key], runtime[key]);
      }
      if (next.audience !== CAPABILITY_AUDIENCE_DEFAULT) doc.set('audience', next.audience);
      else doc.delete('audience');
      if (hasGrants(next)) {
        doc.set('mcp', next.mcp);
        doc.set('skills', next.skills);
      } else {
        doc.delete('mcp');
        doc.delete('skills');
      }
    });
  }

  /** 扩展授权（MCP / 技能白名单）整段覆盖。 */
  function setGrants(id, patch = {}) {
    const next = normalizeExtensions(patch);
    return mutate(id, (doc) => {
      doc.set('mcp', next.mcp);
      doc.set('skills', next.skills);
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

  return { root, list, get, save, setGrants, remove, reset };
}

/**
 * 平台工具的注册开关：由平台声明（profiles/platforms/<id>/tools.yml）决定。
 * 声明了就是「这个平台有」，`defaultOff: true` 的不默认注册 —— 工具面不再抄进能力档。
 * 桥接与 MCP 脚本共用这一个函数，避免两份配置产生分歧。
 */
export function platformFlags(declared = []) {
  return declaredToolFlags(declared);
}
