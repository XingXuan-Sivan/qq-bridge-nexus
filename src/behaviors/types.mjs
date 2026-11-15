// 行为类型注册表：`profiles/platforms/<platform>/behavior-types/<kind>.yml`。
//
// 类型只描述「这是什么行为」：label、所属平台、用哪个引擎（profiles/behavior-engines/<engine>.yml）。
// 字段清单与默认值的真源在引擎定义里；类型文件可以用 `fields:` 按名字覆盖表现（文案、取值域），
// 但不能新增字段 —— 新增字段属于引擎的职责。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { PLATFORMS_ROOT, platformDir } from '../profiles/paths.mjs';
import { getEngine } from './engines.mjs';

const KINDS_DIR = 'behavior-types';

function parseType(file, id, platform) {
  const parsed = YAML.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) ?? {};
  const engine = String(parsed.engine ?? '').trim();
  if (!engine) throw new Error(`行为类型 ${id} 缺少 engine`);
  return {
    id,
    kind: id,
    label: String(parsed.label ?? id).trim(),
    platform: String(parsed.platform ?? platform ?? '').trim(),
    engine,
    overrides: Array.isArray(parsed.fields) ? parsed.fields : [],
  };
}

/** 读一个平台的全部行为类型；目录不存在时返回空数组（调用方决定要不要兜底）。 */
export function loadBehaviorTypes({ root } = {}) {
  const dir = path.join(root, KINDS_DIR);
  if (!fs.existsSync(dir)) return [];
  const platform = path.basename(path.resolve(root));
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()
    .map((name) => parseType(path.join(dir, name), name.replace(/\.ya?ml$/, ''), platform));
}

export function findBehaviorType(types, kind) {
  return types.find((entry) => entry.id === kind) ?? null;
}

/** 某个平台上的某个行为类型；未注册返回 null。 */
export function findTypeIn(platform, kind) {
  return findBehaviorType(loadBehaviorTypes({ root: platformDir(platform) }), String(kind ?? '').trim());
}

/**
 * 类型的字段规格：引擎定义 + 该类型按名字写的覆盖。
 * 覆盖只改表现（文案/取值域/顺序无关的属性），改不到的字段名直接报错 —— 免得覆盖静默失效。
 */
export function typeFields(type) {
  const engine = getEngine(type.engine);
  const overrides = new Map(type.overrides.filter((item) => item?.name).map((item) => [item.name, item]));
  for (const name of overrides.keys()) {
    if (!engine.fields.some((field) => field?.name === name)) {
      throw new Error(`行为类型 ${type.id} 覆盖了引擎 ${type.engine} 没有的字段：${name}`);
    }
  }
  return engine.fields.map((field) => (field?.name && overrides.has(field.name)
    ? { ...field, ...overrides.get(field.name) }
    : field));
}

/**
 * 所有平台的行为类型（GET /api/behaviors/kinds 的唯一实现）。
 * 按平台聚合：同名 kind 可以在不同平台各写一份，页面用 (platform, kind) 索引。
 */
export function listBehaviorTypes({ root = PLATFORMS_ROOT } = {}) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .flatMap((platform) => loadBehaviorTypes({ root: path.join(root, platform) })
      .map((type) => ({
        platform: type.platform || platform,
        kind: type.id,
        label: type.label,
        engine: type.engine,
        fields: typeFields(type),
      })))
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.kind.localeCompare(b.kind));
}
