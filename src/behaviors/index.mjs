// 全局配置：行为档案（behavior profiles）。
//
// 行为档案描述“QQ 里怎么说话/怎么等待”，不描述运行模式、模型、准入或安全上限。
// 权威源：config/behaviors/<id>.yml；由 dsh/agent-presets/<id>/preset.yml 的
// `behavior` 字段引用。缺失或 kind 不匹配一律失败关闭，不做隐式兜底。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const BEHAVIOR_KINDS = ['v1', 'v2'];
const TOP_KEYS = new Set(['version', 'kind', 'label', 'description', 'v1', 'v2']);
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) throw new Error(`${label} 必须是对象`);
  return value;
}

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} 必须是有限数字`);
}

function walkNumbers(value, label) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} 含非法数字`);
    return;
  }
  if (typeof value === 'boolean' || typeof value === 'string') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkNumbers(item, `${label}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) walkNumbers(item, `${label}.${key}`);
    return;
  }
  throw new Error(`${label} 含不支持的值类型`);
}

/** 校验单个行为档案。id 来自文件名，必须与内容分离。 */
export function normalizeBehavior(id, raw) {
  const value = String(id ?? '').trim();
  if (!ID_RE.test(value)) throw new Error(`行为档案 id 不合法：${value || '(空)'}`);
  const source = assertPlainObject(raw, `${value} 行为档案`);
  for (const key of Object.keys(source)) {
    if (!TOP_KEYS.has(key)) throw new Error(`${value} 含未知顶层字段：${key}`);
  }
  const version = Number(source.version);
  if (!Number.isInteger(version) || version < 1) throw new Error(`${value}.version 必须是正整数`);
  const kind = String(source.kind ?? '').trim();
  if (!BEHAVIOR_KINDS.includes(kind)) throw new Error(`${value}.kind 必须是 ${BEHAVIOR_KINDS.join(' / ')}`);
  const label = String(source.label ?? '').trim();
  if (!label) throw new Error(`${value}.label 不能为空`);
  const description = String(source.description ?? '').trim();
  const bodyKey = kind;
  const config = assertPlainObject(source[bodyKey], `${value}.${bodyKey}`);
  const otherKey = kind === 'v1' ? 'v2' : 'v1';
  if (source[otherKey] !== undefined) throw new Error(`${value} 是 ${kind} 档案，不能同时包含 ${otherKey}`);
  walkNumbers(config, `${value}.${bodyKey}`);
  return { id: value, version, kind, label, description, config, [bodyKey]: config };
}

/** 读取 config/behaviors 下所有 .yml 档案；任何损坏都让启动失败。 */
export function loadBehaviorProfiles({ root, log = () => {} } = {}) {
  const dir = root;
  if (!fs.existsSync(dir)) throw new Error(`行为档案目录不存在：${dir}`);
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) throw new Error(`行为档案目录为空：${dir}`);
  const map = new Map();
  for (const file of files) {
    const id = file.replace(/\.ya?ml$/i, '');
    const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^\uFEFF/, '');
    let raw;
    try {
      raw = YAML.parse(text);
    } catch (error) {
      throw new Error(`行为档案 ${file} YAML 解析失败：${error?.message ?? error}`);
    }
    map.set(id, normalizeBehavior(id, raw));
  }
  log(`行为档案已加载：${[...map.keys()].join('、')}`);
  return map;
}

/** 读取 dsh/agent-presets/<id>/preset.yml 的 behavior 绑定。 */
export function loadPresetBehaviorBindings({ root, presetIds = null, log = () => {} } = {}) {
  if (!fs.existsSync(root)) throw new Error(`预设目录不存在：${root}`);
  const ids = Array.isArray(presetIds) && presetIds.length
    ? presetIds
    : fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const bindings = new Map();
  for (const id of ids) {
    const file = path.join(root, id, 'preset.yml');
    if (!fs.existsSync(file)) continue;
    const raw = YAML.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const behavior = String(raw?.behavior ?? '').trim();
    if (behavior) bindings.set(id, behavior);
  }
  log(`预设行为绑定：${[...bindings.entries()].map(([id, behavior]) => `${id}→${behavior}`).join('、') || '(无)'}`);
  return bindings;
}

/** 校验“聊天预设必须有 behavior、运维预设不得有”的启动契约。 */
export function assertPresetBehaviorBindings({ bindings, behaviors, chatPresetIds = ['qq-chat', 'qq-chat-v2'] }) {
  for (const id of chatPresetIds) {
    if (!bindings.has(id)) throw new Error(`聊天预设 ${id} 未绑定 behavior，拒绝启动`);
    const behavior = behaviors.get(bindings.get(id));
    if (!behavior) throw new Error(`预设 ${id} 引用的行为档案不存在：${bindings.get(id)}`);
  }
  for (const [id, behaviorId] of bindings) {
    if (!behaviors.has(behaviorId)) throw new Error(`预设 ${id} 引用的行为档案不存在：${behaviorId}`);
  }
  return true;
}

/** 按 preset 的 behavior 字段解析；缺失直接报错，不猜测默认值。 */
export function resolveBehavior(behaviors, behaviorId, { presetId = '' } = {}) {
  const id = String(behaviorId ?? '').trim();
  if (!id) {
    const hint = presetId ? `预设 ${presetId}` : '预设';
    throw new Error(`${hint} 未绑定 behavior（行为档案），拒绝启动`);
  }
  const behavior = behaviors?.get?.(id);
  if (!behavior) {
    const hint = presetId ? `预设 ${presetId}` : '预设';
    throw new Error(`${hint} 引用的行为档案不存在：${id}`);
  }
  return behavior;
}

export function behaviorSummary(behavior) {
  if (!behavior) return '';
  return `${behavior.label}（${behavior.kind}）`;
}
