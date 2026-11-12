// 仿真提示词的「初始版本」：直接从出厂预设 assets/default-presets/<preset>/agent.cordis.yml
// 的 persona.prefix 读，不再单独维护一份 .md 副本。
//
// 与 assets/default-roles 同一思路：用户把预设里的 persona.prefix 改坏了，可以在控制台一键还原，
// 不必回仓库找原文件。权威源仍是 profiles/agent-platforms/dsh/agents/<preset>/agent.cordis.yml，
// assets/default-presets/ 是它的出厂快照（「还原出厂预设」用的也是这一份）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/** 出厂预设目录（每个预设一个子目录，内含 agent.cordis.yml）。 */
export const DEFAULT_PROMPTS_DIR = fileURLToPath(new URL('../assets/default-presets/', import.meta.url));

/** 支持「还原初始版本」的预设（与 PRESET_NAMES 一致）。 */
export const DEFAULT_PROMPT_PRESETS = ['qq-chat', 'qq-chat-v2'];

const AGENT_FILE = 'agent.cordis.yml';

const norm = (text) => String(text ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, '');

/** 列出出厂目录里带 agent.cordis.yml 的预设 id。 */
export function listDefaultPrompts(dir = DEFAULT_PROMPTS_DIR) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, AGENT_FILE)))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** 读取某个预设的初始提示词；没有出厂文件或没有 persona.prefix 时返回 null。 */
export function readDefaultPrompt(preset, dir = DEFAULT_PROMPTS_DIR) {
  const name = String(preset ?? '').trim();
  if (!name || !listDefaultPrompts(dir).includes(name)) return null;
  let rows;
  try {
    rows = parse(fs.readFileSync(path.join(dir, name, AGENT_FILE), 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  const persona = Array.isArray(rows) ? rows.find((row) => row && row.id === 'persona') : null;
  const prefix = persona?.config?.prefix;
  return typeof prefix === 'string' && prefix.trim() ? prefix : null;
}

/** 当前内容与初始版本的关系（只比较正文，忽略行尾与结尾换行）。 */
export function defaultPromptState(preset, current, dir = DEFAULT_PROMPTS_DIR) {
  const original = readDefaultPrompt(preset, dir);
  if (original === null) return { hasDefault: false, modified: false, chars: 0 };
  return {
    hasDefault: true,
    modified: norm(current) !== norm(original),
    chars: norm(original).length,
  };
}
