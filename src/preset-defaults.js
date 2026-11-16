// 预设正文的「初始版本」：直接读能力档的出厂副本
// profiles/agent-platforms/<Agent 平台 id>/capabilities/.defaults/<id>.yml 的 rows 段里 persona.config.prefix。
//
// 能力档是唯一真源，出厂快照也只有这一份。「还原出厂预设」用的正是 .defaults/，
// 所以这里的读法必须与它一致，否则控制台的「已修改 / 已还原」判断会和实际还原结果对不上。
// 目录属于某个 Agent 平台，由调用方传进来（`agentCapabilitiesDir(id)` 下的 `.defaults/`）。
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

/** 出厂副本目录：能力档目录下的 `.defaults/`。 */
export function defaultPromptsDir(capabilitiesRoot) {
  if (!capabilitiesRoot) throw new Error('出厂副本目录未指定：调用方要传当前 Agent 平台的能力档目录');
  return path.join(capabilitiesRoot, '.defaults');
}

const norm = (text) => String(text ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, '');

/** 列出出厂目录里的能力档 id（每个 <id>.yml 是一份快照）。 */
export function listDefaultPrompts(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => entry.name.replace(/\.ya?ml$/i, ''))
      .sort();
  } catch {
    return [];
  }
}

/** 读取某个预设的初始提示词；没有出厂文件或没有 persona.prefix 时返回 null。 */
export function readDefaultPrompt(preset, dir) {
  const name = String(preset ?? '').trim();
  if (!name || !listDefaultPrompts(dir).includes(name)) return null;
  let loaded;
  try {
    loaded = parse(fs.readFileSync(path.join(dir, `${name}.yml`), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  const rows = Array.isArray(loaded?.rows) ? loaded.rows : [];
  const persona = rows.find((row) => row && row.id === 'persona');
  const prefix = persona?.config?.prefix;
  return typeof prefix === 'string' && prefix.trim() ? prefix : null;
}

/** 当前内容与初始版本的关系（只比较正文，忽略行尾与结尾换行）。 */
export function defaultPromptState(preset, current, dir) {
  const original = readDefaultPrompt(preset, dir);
  if (original === null) return { hasDefault: false, modified: false, chars: 0 };
  return {
    hasDefault: true,
    modified: norm(current) !== norm(original),
    chars: norm(original).length,
  };
}
