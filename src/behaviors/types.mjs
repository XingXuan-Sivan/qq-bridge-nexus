// 行为类型注册表：`profiles/platforms/<platform>/behavior-types/<kind>.yml`。
// 类型只描述「这是什么行为」（label）、用哪个引擎校验与渲染（engine）以及字段规格（schema.fields）；
// 引擎模块在 src/behaviors/kinds/<engine>.mjs，负责默认值与校验。新增平台行为类型 = 加一个 yml。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

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
