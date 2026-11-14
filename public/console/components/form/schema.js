// configSchema（JSON Schema 子集）→ 表单字段规格，以及从渲染好的表单读回补丁。
//
// 插件配置与平台配置都是「字段由 schema 声明、值存在别处」，如果两页各写一份映射，
// 以后新增一种字段类型必然只改一处。所以映射只在这里：`schemaFields()` 铺给
// renderFields，`readSchemaPatch()` 把 DOM 值还原成带类型的对象交给写口。
//
// 值的取法统一是「配置里有就用配置的，没有就用 schema 的 default」：控制台显示的就是
// 保存后会被写入的那一份，不出现「框里空着、保存后其实有值」。
import { getSwitch } from './form.js';

/** 字段 id 前缀：与页面自己的字段区分开（`cfg__<key>`）。 */
export const SCHEMA_FIELD_PREFIX = 'cfg__';

/** 单个字段的规格；`name` 同时是控件 id 与取值键。 */
function fieldOf(name, key, property, value) {
  const label = property?.title || key;
  const hint = property?.description || '';
  if (property?.type === 'boolean') {
    return { type: 'switch', name, label, hint, checked: value === true, onLabel: '开', offLabel: '关' };
  }
  if (property?.type === 'enum') {
    return {
      type: 'select', name, label, hint,
      value: value === undefined ? '' : String(value),
      options: (property.enum ?? []).map((item) => ({ value: String(item), label: String(item) })),
    };
  }
  // 数组与自由对象没有对应的控件：用等宽文本域装 JSON，读回时再解析。
  if (property?.type === 'array' || property?.type === 'object') {
    return { type: 'textarea', name, label, hint, rows: 4, mono: true, value: JSON.stringify(value ?? (property.type === 'array' ? [] : {}), null, 2) };
  }
  if (property?.type === 'number' || property?.type === 'integer') {
    return {
      type: 'number', name, label, hint,
      value: value === undefined ? '' : value,
      min: property.minimum, max: property.maximum,
      step: property.type === 'integer' ? 1 : 'any',
      integer: property.type === 'integer',
    };
  }
  if (property?.format === 'textarea') {
    return { type: 'textarea', name, label, hint, rows: 4, value: value === undefined ? '' : String(value) };
  }
  return { type: 'text', name, label, hint, value: value === undefined ? '' : String(value) };
}

/**
 * schema → `renderFields` 字段规格（按 properties 的声明顺序）。
 * @param {object|null} schema   平台 / 插件的 configSchema（已归一）
 * @param {object} [config]      当前配置（扁平）
 * @param {{prefix?: string}} [options]
 */
export function schemaFields(schema, config = {}, { prefix = SCHEMA_FIELD_PREFIX } = {}) {
  return Object.entries(schema?.properties ?? {}).map(([key, property]) => (
    fieldOf(`${prefix}${key}`, key, property, config?.[key] ?? property?.default)
  ));
}

/** 该 schema 是否声明了任何字段（没声明就不画表单，也不该给保存按钮）。 */
export function hasSchemaFields(schema) {
  return Object.keys(schema?.properties ?? {}).length > 0;
}

/**
 * 从渲染好的表单读回补丁：控件值按 schema 的类型还原（布尔、数字、枚举、JSON）。
 *
 * `host` 限定查询范围 —— 页面里可能同时存在插件表单与平台表单，按 id 全局查会串。
 * JSON 解析失败直接抛错，由调用方提示「配置不是合法 JSON」。
 */
export function readSchemaPatch(schema, host, { prefix = SCHEMA_FIELD_PREFIX } = {}) {
  const patch = {};
  for (const [key, property] of Object.entries(schema?.properties ?? {})) {
    const el = host?.querySelector?.(`[data-field="${prefix}${key}"]`);
    if (!el) continue;
    if (property.type === 'boolean') { patch[key] = getSwitch(el); continue; }
    if (property.type === 'array' || property.type === 'object') {
      const raw = String(el.value ?? '').trim();
      if (!raw) { patch[key] = property.type === 'array' ? [] : {}; continue; }
      patch[key] = JSON.parse(raw);
      continue;
    }
    if (property.type === 'number' || property.type === 'integer') {
      const raw = String(el.value ?? '').trim();
      if (raw !== '') patch[key] = Number(raw);
      continue;
    }
    if (property.type === 'enum') {
      patch[key] = property.enum.find((item) => String(item) === String(el.value)) ?? el.value;
      continue;
    }
    patch[key] = String(el.value ?? '');
  }
  return patch;
}
