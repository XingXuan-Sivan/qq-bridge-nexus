// 平台话术：每个平台一份文件 `config/platform/<platform>.yml`，是平台侧的提示词源。
//
// 为什么单独一层：能力（Agent 侧）只写「我是谁、边界在哪」，平台话术写「在这个平台上
// 怎么说话、怎么发消息」。前者换成别的 Agent 运行时仍然成立，后者换成别的平台就作废。
// 桥接只读这一份文件的 `prompt` 正文，经注入块 `core-platform-prompt` 每轮下发；
// 文件的 `.factory/` 子目录存出厂副本，「还原出厂」只复制回来。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { renderPlatformPrompt } from '../runtime/prompt-compose.mjs';

export const PLATFORM_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
export const PLATFORM_PROMPT_MAX = 40000;

function promptPath(root, id) {
  const value = String(id ?? '').trim();
  if (!PLATFORM_ID_RE.test(value)) throw new Error(`平台 id 不合法：${value || '(空)'}`);
  return path.join(root, `${value}.yml`);
}

function factoryPath(root, id) {
  return path.join(root, '.factory', `${String(id).trim()}.yml`);
}

function readText(file) {
  const raw = YAML.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) ?? {};
  const platform = String(raw.platform ?? '').trim();
  const text = String(raw.prompt ?? '');
  if (text.length > PLATFORM_PROMPT_MAX) throw new Error(`prompt 超过 ${PLATFORM_PROMPT_MAX} 字`);
  return { platform, text };
}

function serialize({ platform, text }) {
  const body = YAML.stringify({ version: 1, platform, prompt: text }, { lineWidth: 0, aliasDuplicateObjects: false, singleQuote: true });
  return `# 平台话术：由「行为档案 › 平台话术」维护。改动后重启桥接，下一轮唤醒生效。\n${body}`;
}

/** 确保出厂副本存在（首次读取时把当前文件复制进去）。 */
export function ensurePlatformFactory({ root, id } = {}) {
  const target = factoryPath(root, id);
  if (fs.existsSync(target)) return false;
  const source = promptPath(root, id);
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return true;
}

export function readPlatformPrompt({ root, id } = {}) {
  const file = promptPath(root, id);
  if (!fs.existsSync(file)) throw new Error(`没有这个平台话术：${id}`);
  ensurePlatformFactory({ root, id });
  const parsed = readText(file);
  const factoryFile = factoryPath(root, id);
  const factoryText = fs.existsSync(factoryFile) ? readText(factoryFile).text : '';
  return {
    id: String(id),
    platform: parsed.platform || String(id),
    text: parsed.text,
    chars: parsed.text.length,
    factoryText,
    isFactory: parsed.text === factoryText,
  };
}

export function listPlatformPrompts({ root } = {}) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name.replace(/\.ya?ml$/i, ''))
    .sort()
    .map((id) => {
      try {
        const prompt = readPlatformPrompt({ root, id });
        return { id, platform: prompt.platform, chars: prompt.chars, isFactory: prompt.isFactory };
      } catch (error) {
        return { id, platform: id, chars: 0, isFactory: true, error: String(error?.message ?? error) };
      }
    });
}

function backup(root, id) {
  const file = promptPath(root, id);
  if (!fs.existsSync(file)) return;
  const dir = path.join(root, '..', '..', 'state', 'platform-backups', String(id));
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, path.join(dir, `${stamp}.yml`));
}

export function writePlatformPrompt({ root, id, text, platform } = {}) {
  const value = String(text ?? '').replace(/\r\n/g, '\n');
  if (value.length > PLATFORM_PROMPT_MAX) throw new Error(`prompt 超过 ${PLATFORM_PROMPT_MAX} 字`);
  const file = promptPath(root, id);
  const current = fs.existsSync(file) ? readText(file) : { platform: String(id), text: '' };
  fs.mkdirSync(root, { recursive: true });
  ensurePlatformFactory({ root, id });
  backup(root, id);
  const body = serialize({ platform: String(platform ?? current.platform ?? id), text: value });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, body, 'utf8');
  fs.renameSync(temp, file);
  return readPlatformPrompt({ root, id });
}

export function restorePlatformPrompt({ root, id } = {}) {
  const factoryFile = factoryPath(root, id);
  if (!fs.existsSync(factoryFile)) throw new Error('没有出厂副本可还原');
  const factory = readText(factoryFile);
  return writePlatformPrompt({ root, id, text: factory.text, platform: factory.platform });
}

/** 渲染占位符，给注入块用。 */
export function renderPlatformText(text, vars) {
  return renderPlatformPrompt(String(text ?? ''), vars);
}
