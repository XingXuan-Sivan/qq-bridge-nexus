// 唤醒提示词的逐字节回归。
//
// P1 把散落在 buildWakePromptV2Core 里的硬编码段落搬进注入块系统，搬迁只允许
// 改变「谁来拼」，不允许改变「拼出什么」：同一份夹具、同一个原因，重构前后的
// 文本必须完全一致（时间、令牌这类易变片段先规范化）。
//
// 夹具 scripts/fixtures/wake-prompt-golden.json 是重构前用 `--capture` 生成的；
// 之后任何段落顺序、分隔符、措辞的意外变化都会让这里失败。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'wake-prompt-golden.json');
const CAPTURE = process.argv.includes('--capture');
const KEY = 'group:1047096216';

// 覆盖 buildWakePromptV2Core 的每一个 reason 分支，外加默认尾巴。
const REASONS = [
  'bootstrap',
  'timeout',
  'replyCheck',
  'proactiveCheck',
  'memberJoin:member_start',
  'roleRefresh',
  'silenceEnded',
  'scheduled',
  'ownerRelay',
  'poke',
  'atMention',
  'question',
  'proactive'
];

// 同一份提示词里会随时间变化的片段：只抹掉值，保留形状与位置。
function normalize(text) {
  return String(text ?? '')
    .replace(/【当前时间】[^\n]*/g, '【当前时间】<TIME>')
    .replace(/【会话令牌】[^\n]*/g, '【会话令牌】<TOKEN>')
    .replace(/\d{4}\/\d{1,2}\/\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2})?/g, '<TS>')
    .replace(/还差约 \d+ 秒/g, '还差约 <N> 秒')
    .replace(/约 \d+ 秒后/g, '约 <N> 秒后')
    .replace(/\d+ 秒前/g, '<N> 秒前')
    .replace(/\d+ 分钟前/g, '<N> 分钟前')
    .replace(/\d+ 小时前/g, '<N> 小时前')
    .replace(/\d+ 天前/g, '<N> 天前');
}

const VARIANTS = {
  default: {},
  // 关块：验证块被关掉时不会留下空行或残留分隔符。
  'blocks-off': { promptBlocks: { 'core-memory': { enabled: false }, 'core-stickers': { enabled: false } } },
  // 块级上限：验证截断只影响该块。
  'blocks-clipped': { promptBlocks: { 'core-memory': { maxChars: 120 } } },
  // 黑话关闭：验证 withSlangContext 摘除后前导段仍一致。
  'slang-off': { slang: { enabled: false } }
};

async function captureVariant(config) {
  const bridge = await bridgeHarness({
    config: { socialV2: { enabled: true }, ...config },
    savedState: { sessions: {}, socialV2: { conversations: {} } }
  });
  try {
    bridge.localMemory.add({ key: KEY, category: 'topic', content: '周末去哪玩' });
    bridge.localMemory.add({ key: KEY, category: 'impression', content: '', extra: { target: '小明', traits: ['爱迟到'] } });
    const out = {};
    for (const reason of REASONS) out[reason] = normalize(bridge.buildWakePromptV2(KEY, reason));
    out['reminder'] = normalize(bridge.buildWakeReminderPromptV2(KEY));
    return out;
  } finally {
    await bridge.close();
  }
}

async function captureAll() {
  const out = {};
  for (const [name, config] of Object.entries(VARIANTS)) out[name] = await captureVariant(config);
  return out;
}

if (CAPTURE) {
  const snapshot = await captureAll();
  await mkdir(path.dirname(FIXTURE), { recursive: true });
  await writeFile(FIXTURE, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(`已写入 ${path.relative(process.cwd(), FIXTURE)}`);
} else {
  test('唤醒提示词与基线夹具逐字节一致', async () => {
    const expected = JSON.parse(await readFile(FIXTURE, 'utf8'));
    const actual = await captureAll();
    for (const variant of Object.keys(expected)) {
      for (const reason of Object.keys(expected[variant])) {
        assert.equal(
          actual[variant]?.[reason],
          expected[variant][reason],
          `${variant} / ${reason} 的提示词与基线不一致`
        );
      }
    }
  });
}
