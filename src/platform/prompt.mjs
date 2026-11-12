// 平台话术：平台侧的提示词源，位于 profiles/platforms/<platform>/prompt.md。
//
// 为什么单独一层：能力（Agent 侧）只写「我是谁、边界在哪」，平台话术写「在这个平台上
// 怎么说话、怎么发消息」。前者换成别的 Agent 运行时仍然成立，后者换成别的平台就作废。
// 同目录的 prompt.default.md 是出厂副本；「还原出厂」只把默认文件抄回去。
import fs from 'node:fs';
import path from 'node:path';
import { PLATFORMS_ROOT, REPO_ROOT } from '../profiles/paths.mjs';
import { renderPlatformPrompt } from '../runtime/prompt-compose.mjs';

export const PLATFORM_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
export const PLATFORM_PROMPT_MAX = 40000;

function platformDir(root, id) {
  const value = String(id ?? '').trim();
  if (!PLATFORM_ID_RE.test(value)) throw new Error(`平台 id 不合法：${value || '(空)'}`);
  return path.join(root, value);
}

export function ensurePlatformFactory({ root = PLATFORMS_ROOT, id } = {}) {
  const dir = platformDir(root, id);
  const target = path.join(dir, 'prompt.default.md');
  if (fs.existsSync(target)) return false;
  const source = path.join(dir, 'prompt.md');
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(source, target);
  return true;
}

export function readPlatformPrompt({ root = PLATFORMS_ROOT, id } = {}) {
  const dir = platformDir(root, id);
  const file = path.join(dir, 'prompt.md');
  if (!fs.existsSync(file)) throw new Error(`没有这个平台话术：${id}`);
  ensurePlatformFactory({ root, id });
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  if (text.length > PLATFORM_PROMPT_MAX) throw new Error(`prompt 超过 ${PLATFORM_PROMPT_MAX} 字`);
  const factoryFile = path.join(dir, 'prompt.default.md');
  const factoryText = fs.existsSync(factoryFile)
    ? fs.readFileSync(factoryFile, 'utf8').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '')
    : '';
  return {
    id: String(id),
    platform: String(id),
    text,
    chars: text.length,
    factoryText,
    isFactory: text === factoryText,
  };
}

export function listPlatformPrompts({ root = PLATFORMS_ROOT } = {}) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
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
  const file = path.join(platformDir(root, id), 'prompt.md');
  if (!fs.existsSync(file)) return;
  const dir = path.join(REPO_ROOT, 'state', 'platform-backups', String(id));
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, path.join(dir, `${stamp}.md`));
}

/** 写平台话术。保留末尾换行；写前备份到 state/platform-backups/。 */
export function writePlatformPrompt({ root = PLATFORMS_ROOT, id, text } = {}) {
  const value = String(text ?? '').replace(/\r\n/g, '\n');
  if (value.length > PLATFORM_PROMPT_MAX) throw new Error(`prompt 超过 ${PLATFORM_PROMPT_MAX} 字`);
  const dir = platformDir(root, id);
  ensurePlatformFactory({ root, id });
  backup(root, id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'prompt.md');
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, value.endsWith('\n') ? value : `${value}\n`, 'utf8');
  fs.renameSync(temp, file);
  return readPlatformPrompt({ root, id });
}

export function restorePlatformPrompt({ root = PLATFORMS_ROOT, id } = {}) {
  const dir = platformDir(root, id);
  const factoryFile = path.join(dir, 'prompt.default.md');
  if (!fs.existsSync(factoryFile)) throw new Error('没有出厂副本可还原');
  const factoryText = fs.readFileSync(factoryFile, 'utf8');
  return writePlatformPrompt({ root, id, text: factoryText });
}

/** 渲染占位符，给注入块用。 */
export function renderPlatformText(text, vars) {
  return renderPlatformPrompt(String(text ?? ''), vars);
}
