// 内置段落块化（P4 迁移第一批）的端到端测试：
// - core-digest 关掉后，wake prompt 里不再出现记忆摘要；
// - core-digest 的 maxChars 能单独收紧，且不乱码、不截半句以外的内容。
// 这里走 bridgeHarness 真跑 buildWakePromptV2，避免只测注册表而漏掉桥接接线。
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const KEY = 'group:1047096216';

function seedSocial(bridge) {
  const st = bridge.getSocialV2State(KEY);
  assert.ok(st, '社交状态应存在');
  st.activeTopics = [{ text: '周末去哪玩', lastMentionAt: Date.now() - 5 * 60 * 1000 }];
  st.pendingThoughts = [{ text: '想问问他上次说的那家店', motivation: 'curiosity' }];
  st.memberImpressions = { 小明: { traits: ['爱迟到', '会做饭'], interactionCount: 12 } };
  st.ownerRules = ['不要在群里提工作'];
}

async function capture(config) {
  const bridge = await bridgeHarness({
    config: { socialV2: { enabled: true }, ...config },
    savedState: { sessions: {}, socialV2: { conversations: {} } },
  });
  try {
    seedSocial(bridge);
    return bridge.buildWakePromptV2(KEY, 'replyCheck');
  } finally {
    await bridge.close();
  }
}

test('core-digest：默认注入记忆摘要，关掉后整段消失，maxChars 可单独收紧', async () => {
  const enabled = await capture({});
  assert.match(enabled, /【进行中的话题】/, '默认应包含记忆摘要段');
  assert.match(enabled, /周末去哪玩/);

  const disabled = await capture({ promptBlocks: { 'core-digest': { enabled: false } } });
  assert.doesNotMatch(disabled, /【进行中的话题】/, '关掉后不应再出现该段');
  assert.doesNotMatch(disabled, /周末去哪玩/);
  assert.ok(disabled.length < enabled.length, '关掉一块后 prompt 应变短');

  const clipped = await capture({ promptBlocks: { 'core-digest': { maxChars: 20 } } });
  assert.match(clipped, /【进行中的话题】/, '限额只截断，不应整段消失');
  assert.ok(clipped.length < enabled.length, '限额后 prompt 应变短');
  assert.ok(clipped.length > disabled.length, '限额后仍应保留一部分摘要');
});

test('core-stickers：配置可单独关闭该块，关掉后不再出现表情策略段', async () => {
  const marker = '【表情包策略：像真人一样用，不刷屏】';
  const enabled = await capture({});
  assert.ok(enabled.includes(marker), '默认应包含表情策略段');

  const disabled = await capture({ promptBlocks: { 'core-stickers': { enabled: false } } });
  assert.ok(!disabled.includes(marker), '关掉后不应再出现表情策略段');
  assert.match(disabled, /【进行中的话题】/, '关掉表情块不应影响记忆段');
  assert.ok(disabled.length < enabled.length, '关掉一块后 prompt 应变短');
});
