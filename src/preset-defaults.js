// 仿真提示词的「初始版本」：发布包自带的一份只读副本，随包分发，用户不该直接改它。
//
// 目的与 assets/default-roles 一致：用户把预设里的 persona.prefix 改坏了，可以在控制台一键还原，
// 不必回仓库找原文件。源文件仍是 dsh/agent-presets/<preset>/agent.cordis.yml，这里只存提示词正文。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PROMPTS_DIR = fileURLToPath(new URL('../assets/default-prompts/', import.meta.url));

/** 支持「还原初始版本」的预设（与 PRESET_NAMES 一致）。 */
export const DEFAULT_PROMPT_PRESETS = ['qq-chat', 'qq-chat-v2'];

const norm = (text) => String(text ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, '');

export function listDefaultPrompts(dir = DEFAULT_PROMPTS_DIR) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
  } catch {
    return [];
  }
}

/** 读取某个预设的初始提示词；没有这份文件时返回 null。 */
export function readDefaultPrompt(preset, dir = DEFAULT_PROMPTS_DIR) {
  const name = String(preset ?? '').trim();
  if (!name || !listDefaultPrompts(dir).includes(name)) return null;
  return fs.readFileSync(path.join(dir, `${name}.md`), 'utf8');
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
