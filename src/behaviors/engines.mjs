// 行为引擎定义：profiles/behavior-engines/<engine>.yml。
//
// 一个引擎 = 一套可直接落盘的字段（名称、控件、取值域、默认值）。平台行为类型只写覆盖，
// 实例档案只写「默认值 + 覆盖」的全量快照。默认值只在这一处：新增平台不需要抄字段表，
// 新增引擎只需要加一份 yml。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { BEHAVIOR_ENGINES_ROOT } from '../profiles/paths.mjs';

const ENGINES = new Map();
const GROUPS = new Map();

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function parseEngine(file) {
  const raw = YAML.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) ?? {};
  const engine = String(raw.engine ?? path.basename(file).replace(/\.ya?ml$/, '')).trim();
  const fields = Array.isArray(raw.fields) ? raw.fields : [];
  if (!engine) throw new Error(`行为引擎定义 ${file} 缺少 engine`);
  if (!fields.length) throw new Error(`行为引擎定义 ${engine} 没有字段`);
  const seen = new Set();
  for (const item of fields) {
    if (!item?.name) continue;
    if (seen.has(item.name)) throw new Error(`行为引擎定义 ${engine} 字段重复：${item.name}`);
    seen.add(item.name);
    if (item.default === undefined) throw new Error(`行为引擎定义 ${engine} 的字段 ${item.name} 缺 default`);
  }
  return { engine, label: String(raw.label ?? engine), fields };
}

export function listEngines({ root = BEHAVIOR_ENGINES_ROOT } = {}) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort()
    .map((name) => parseEngine(path.join(root, name)));
}

/** 引擎定义（带缓存；测试换 root 时直接 listEngines）。 */
export function getEngine(name, { root = BEHAVIOR_ENGINES_ROOT } = {}) {
  const key = `${root}::${String(name ?? '')}`;
  if (!ENGINES.has(key)) {
    const file = path.join(root, `${String(name ?? '')}.yml`);
    if (!fs.existsSync(file)) throw new Error(`未注册的行为引擎：${name || '(空)'}`);
    ENGINES.set(key, parseEngine(file));
  }
  return ENGINES.get(key);
}

export function engineFields(name, options) {
  return getEngine(name, options).fields;
}

/**
 * 某个前缀下的默认值（键名去掉前缀）：调度策略这类「按段注入默认值」的消费方用它，
 * 免得在代码里抄第二份数字。`wake_adaptiveDebounce` → `adaptiveDebounce`。
 */
export function groupDefaults(name, group, options = {}) {
  const engine = getEngine(name, options);
  const key = `${options.root ?? BEHAVIOR_ENGINES_ROOT}::${engine.engine}::${group}`;
  if (!GROUPS.has(key)) {
    const prefix = `${group}_`;
    const out = {};
    for (const item of engine.fields) {
      if (item?.name?.startsWith(prefix)) out[item.name.slice(prefix.length)] = clone(item.default);
    }
    GROUPS.set(key, out);
  }
  return GROUPS.get(key);
}

/** 字段名里的下划线段数 = 嵌套深度：`sticker_collect_enabled` → config.sticker.collect.enabled。 */
export function pathOf(name) {
  return String(name ?? '').split('_').filter(Boolean);
}

function setPath(node, parts, value) {
  let cursor = node;
  for (const key of parts.slice(0, -1)) {
    if (cursor[key] === undefined || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

export function readPath(value, parts) {
  let node = value;
  for (const key of parts) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined;
    node = node[key];
  }
  return node;
}

/** 按字段定义生成本地默认值（全量嵌套 config）。 */
export function materialize(fields) {
  const out = {};
  for (const item of fields ?? []) {
    if (!item?.name) continue;
    if (item.default === undefined) throw new Error(`字段 ${item.name} 没有默认值`);
    setPath(out, pathOf(item.name), clone(item.default));
  }
  return out;
}

/** 把嵌套 config 展平成「字段名 → 值」，顺带校验键集：多出来的键一律报错。 */
export function flattenConfig(config, fields) {
  const known = new Set((fields ?? []).filter((item) => item?.name).map((item) => item.name));
  const out = {};
  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node ?? {})) {
      const name = prefix ? `${prefix}_${key}` : key;
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        walk(value, name);
        continue;
      }
      if (!known.has(name)) throw new Error(`未知配置键：${name}`);
      out[name] = value;
    }
  };
  walk(config ?? {}, '');
  return out;
}

function checkValue(item, value, label) {
  const name = `${label}.${item.name}`;
  if (item.type === 'switch') {
    if (typeof value !== 'boolean') throw new Error(`${name} 必须是布尔值`);
    return;
  }
  if (item.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} 必须是有限数字`);
    if (item.min !== undefined && value < item.min) throw new Error(`${name} 不能小于 ${item.min}`);
    if (item.max !== undefined && value > item.max) throw new Error(`${name} 不能大于 ${item.max}`);
    return;
  }
  if (item.list) {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new Error(`${name} 必须是字符串数组`);
    return;
  }
  if (item.type === 'select') {
    const allowed = (item.options ?? []).map((option) => option.value);
    if (allowed.length && !allowed.includes(value)) throw new Error(`${name} 取值不合法：${String(value)}`);
    return;
  }
  if (typeof value !== 'string') throw new Error(`${name} 必须是字符串`);
}

/**
 * 全量 config：默认值铺底，再叠加「字段名 → 值」的覆盖（缺的键取默认值）。
 * 覆盖里的未知键直接报错；每个值都按字段类型校验。
 */
export function buildConfig(fields, values = {}, { label = 'config' } = {}) {
  const known = new Map((fields ?? []).filter((item) => item?.name).map((item) => [item.name, item]));
  const out = materialize(fields);
  for (const [name, value] of Object.entries(values ?? {})) {
    const item = known.get(name);
    if (!item) throw new Error(`未知配置键：${name}`);
    checkValue(item, value, label);
    setPath(out, pathOf(name), clone(value));
  }
  return out;
}

/** 校验一份嵌套 config，返回展平后的「字段名 → 值」。 */
export function validateConfig(config, fields, { label = 'config' } = {}) {
  const values = flattenConfig(config, fields);
  buildConfig(fields, values, { label });
  return values;
}
