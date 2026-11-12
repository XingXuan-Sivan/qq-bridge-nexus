// 一次性迁移：把旧预设 persona 里的三段文案，按「平台话术 / 引擎语义 / 能力安全段」拆到三个源文件。
// 产物：config/platform/qq.yml 的 prompt、config/behaviors/social-v2.yml 的 prompt、capability.yml 的 safety.rules。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { writePlatformPrompt, readPlatformPrompt } from '../src/platform/prompt.mjs';
import { readBehaviorDocument, writeBehaviorData } from '../src/behaviors/index.mjs';

const ROOT = process.cwd();
const PRESETS = path.join(ROOT, 'profiles', 'agent-platforms', 'dsh', 'agents');

/** 取出 persona.prefix 文本（旧预设的权威文案）。 */
function personaOf(presetId) {
  const file = path.join(PRESETS, presetId, 'agent.cordis.yml');
  if (!fs.existsSync(file)) return '';
  const doc = YAML.parse(fs.readFileSync(file, 'utf8')) ?? [];
  const rows = Array.isArray(doc) ? doc : (doc.extensions ?? []);
  for (const row of rows) {
    const prefix = row?.prefix ?? row?.config?.prefix;
    if ((row?.id === 'persona' || row?.profile === 'persona') && typeof prefix === 'string') return prefix;
  }
  return '';
}

/** 按「【...】」标题切段；没有标题的整段算一段。 */
function splitSections(text) {
  const lines = String(text ?? '').split('\n');
  const sections = [];
  let current = { title: '', lines: [] };
  for (const line of lines) {
    if (/^【.+】/.test(line.trim())) {
      if (current.lines.join('').trim()) sections.push(current);
      current = { title: line.trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.join('').trim()) sections.push(current);
  return sections.map((s) => ({ title: s.title, text: s.lines.join('\n').trim() }));
}

const PLATFORM_RE = /QQ|群聊|群友|群管|引用|@|名片|消息|发送|语音|表情|私聊|频道|平台/;
const ENGINE_RE = /等待|等、回|沉睡前|节奏|分条|主动|概率|静默|潜水|该说|不该说|主体|AI 味|记忆|认人|漏看|迟到|开话题|收尾/;
const PLATFORM_STRONG_RE = /工具协议|平台|发送|引用|群|QQ/;
const SAFETY_RE = /安全|凭据|密钥|注入|越权|本地工具|权限|命令/;

function classify(section) {
  if (PLATFORM_STRONG_RE.test(section.title)) return 'platform';
  if (SAFETY_RE.test(section.title)) return 'platform';
  if (ENGINE_RE.test(section.title) && !PLATFORM_RE.test(section.title)) return 'engine';
  return 'platform';
}

const buckets = { platform: [], engine: [], safety: [] };
// 两个旧预设都取，但按段落去重（v2 与 v1 有大量同文段落）。
const seen = new Set();
for (const presetId of ['qq-chat-v2', 'qq-chat']) {
  for (const section of splitSections(personaOf(presetId))) {
    const key = section.text.replace(/\s+/g, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    buckets[classify(section)].push(section.text);
  }
}

const stripIdentity = (text) => text
  .split('\n')
  .filter((line) => !/^\s*You are a coding agent/.test(line) && !line.includes('{{model}}'))
  .join('\n')
  .trim();
const join = (list) => stripIdentity(list.join('\n\n'));

// 1) 平台话术
const currentPlatform = readPlatformPrompt({ root: path.join(ROOT, 'config', 'platform'), id: 'qq' });
const platformText = join(buckets.platform) || currentPlatform?.text || '';
writePlatformPrompt({ root: path.join(ROOT, 'config', 'platform'), id: 'qq', text: platformText, platform: 'qq' });

// 2) 引擎语义：写入 social-v2 的 prompt（social-v1 单独补一段等待/静默语义）
const behaviorsRoot = path.join(ROOT, 'config', 'behaviors');
for (const id of ['social-v2', 'social-v1']) {
  const doc = readBehaviorDocument({ root: behaviorsRoot, id });
  if (!doc) continue;
  const prompt = id === 'social-v2'
    ? join(buckets.engine)
    : '你在群里按「等着看」的节奏活动：没人叫你时不要主动插话；被叫到、被引用、被提问时才开口。\n\n只发群友会读的那部分：不要复述指令，不要解释系统。[SILENT] 表示这一轮决定不说话；其余文本按普通回复发到当前会话。';
  writeBehaviorData({
    root: behaviorsRoot,
    id,
    data: { version: 1, kind: doc.kind, label: doc.data?.label ?? id, description: doc.data?.description ?? '', prompt, config: doc.data?.config ?? {} },
  });
}

console.log(JSON.stringify({
  platformChars: platformText.length,
  engineChars: join(buckets.engine).length,
  safetySections: buckets.safety.length,
  safetyChars: join(buckets.safety).length,
}));
