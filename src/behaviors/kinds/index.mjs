// 行为档案 kind 注册表：控制台与后端共用同一份字段规格（GET /api/behaviors/kinds）。
// 新增一种行为只需要在这里挂一个 kind 模块，页面与校验自动跟上。
import * as v1 from './v1.mjs';
import * as v2 from './v2.mjs';

const KINDS = new Map([v1, v2].map((entry) => [entry.kind, entry]));

export const KIND_IDS = [...KINDS.keys()];

/** 字段名里的 `a_b` 表示嵌套段，默认值也要还原成嵌套结构。 */
function defaultsOf(fields) {
  const out = {};
  for (const item of fields) {
    if (!item?.name) continue;
    const value = item.type === 'switch' ? false : item.type === 'number' ? 0 : item.list ? [] : '';
    if (!item.name.includes('_')) {
      out[item.name] = value;
      continue;
    }
    const [group, key] = item.name.split('_');
    out[group] = out[group] ?? {};
    out[group][key] = value;
  }
  return out;
}

export function getKind(kind) {
  return KINDS.get(String(kind ?? '')) ?? null;
}

export function listKinds() {
  return [...KINDS.values()].map((entry) => ({
    kind: entry.kind,
    label: entry.label,
    platform: entry.platform,
    fields: entry.fields,
    defaults: defaultsOf(entry.fields),
  }));
}
