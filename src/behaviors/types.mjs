// 行为类型注册表：`profiles/platforms/<platform>/behavior-types/<kind>.yml`。
// 类型只描述「这是什么行为」（label）、用哪个引擎校验与渲染（engine）以及字段规格（schema.fields）；
// 引擎模块在 src/behaviors/kinds/<engine>.mjs，负责默认值与校验。新增平台行为类型 = 加一个 yml。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { getKind, defaultsForEngine } from './kinds/index.mjs';

const KINDS_DIR = 'behavior-types';

function parseType(file, id) {
  const parsed = YAML.parse(fs.readFileSync(file, 'utf8')) ?? {};
  const engine = String(parsed.engine ?? '').trim();
  if (!engine) throw new Error(`行为类型 ${id} 缺少 engine`);
  return {
    id,
    kind: id,
    label: String(parsed.label ?? id).trim(),
    platform: String(parsed.platform ?? '').trim(),
    engine,
    schema: parsed.schema ?? null,
  };
}

/** 读一个平台的全部行为类型；目录不存在时返回空数组（调用方决定要不要兜底）。 */
export function loadBehaviorTypes({ root } = {}) {
  const dir = path.join(root, KINDS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()
    .map((name) => parseType(path.join(dir, name), name.replace(/\.ya?ml$/, '')));
}

export function findBehaviorType(types, kind) {
  return types.find((entry) => entry.id === kind) ?? null;
}

/**
 * 类型 yml 的字段规格 + 引擎那边的默认值。
 *
 * yml 写了 schema.fields 就**整体**盖掉引擎字段表（顺序/文案可随平台变），默认值也跟着没了：
 * 界面会把默认开着的开关画成关、把缺省的数字画成空，一保存还可能把它们固化成 false/0。
 * 默认值的真源只能是引擎（`SCHEDULING_DEFAULTS` 之类），所以这里按名字补回去。
 *
 * @param {{schema?: {fields?: unknown[]}}} type
 * @param {{fields?: Array<{name?: string, default?: unknown}>} | null} engine
 */
export function typeFields(type, engine) {
  const source = Array.isArray(type?.schema?.fields) ? type.schema.fields : (engine?.fields ?? []);
  const engineDefaults = new Map((engine?.fields ?? []).map((field) => [field?.name, field?.default]));
  return source.map((field) => {
    if (!field?.name || field.default !== undefined) return field;
    const fallback = engineDefaults.get(field.name);
    return fallback === undefined ? field : { ...field, default: fallback };
  });
}

/** 平台的行为类型 → 控制台用的字段规格（GET /api/behaviors/kinds 的唯一实现）。 */
export function listBehaviorKinds({ root, platform = 'qq' } = {}) {
  return loadBehaviorTypes({ root }).map((type) => ({
    kind: type.id,
    label: type.label,
    platform: type.platform || platform,
    engine: type.engine,
    fields: typeFields(type, getKind(type.engine)),
    defaults: defaultsForEngine(type.engine),
  }));
}
