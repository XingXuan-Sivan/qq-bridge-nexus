// 调度内核（src/scheduling/）的回归：合批、预算、收尾判据、策略解析、溢出交代。
//
// 前四组是纯函数（无 IO、无时钟依赖），第五组走夹具验证桥接侧的接线：
// 「合批窗口真的排上了定时器」「direct 打空真的照常投递」「积压真的会触达」「溢出真的被交代」。
import assert from 'node:assert/strict';
import { batchDelayMs, tighterTier } from '../src/scheduling/batching.mjs';
import { PACING_TIERS, createPacingState, normalizePacingState, pacingSnapshot, refundToken, takeToken } from '../src/scheduling/pacing.mjs';
import { classifyPendingWake, clearAcknowledgedOverflow, noteOverflow } from '../src/scheduling/cursor.mjs';
import { SCHEDULING_DEFAULTS, batchLimits, resolveSchedulingPolicy, tierOf } from '../src/scheduling/policy.mjs';
import { bridgeHarness } from './audit-bridge-harness.mjs';

let failures = 0;
async function test(name, run) {
  try { await run(); console.log('PASS', name); }
  catch (error) { failures++; console.error('FAIL', name, '—', error?.stack ?? error); }
}

// ── 1. 合批：等多久 ─────────────────────────────────────────────────────────
await test('合批：关闭动态合批时等价于「等满窗口剩余时间」', () => {
  // 首条：等满 maxWait
  assert.equal(batchDelayMs({ now: 1000, firstAt: 1000, prevAt: 0, baseMs: 1200, maxWaitMs: 3000, adaptive: false }), 3000);
  // 窗口已过 2 秒：只剩 1 秒
  assert.equal(batchDelayMs({ now: 3000, firstAt: 1000, prevAt: 0, baseMs: 1200, maxWaitMs: 3000, adaptive: false }), 1000);
  // 窗口已过完：立刻发
  assert.equal(batchDelayMs({ now: 5000, firstAt: 1000, prevAt: 0, baseMs: 1200, maxWaitMs: 3000, adaptive: false }), 0);
});

await test('合批：动态合批按「距上一条入站」的间隔收缩等待，但受 base 与 maxWait 夹住', () => {
  // 连发（间隔 100ms）→ 至少等 base
  assert.equal(batchDelayMs({ now: 1100, firstAt: 1000, prevAt: 1000, baseMs: 1200, maxWaitMs: 3000, adaptive: true }), 1200);
  // 间隔 1.5 秒：0.8 * 1500 = 1200，且窗口还剩 1500 → 取 1200
  assert.equal(batchDelayMs({ now: 2500, firstAt: 1000, prevAt: 1000, baseMs: 1200, maxWaitMs: 3000, adaptive: true }), 1200);
  // 间隔 3 秒：0.8 * 3000 = 2400，但窗口只剩 500 → 取 500
  assert.equal(batchDelayMs({ now: 3500, firstAt: 1000, prevAt: 500, baseMs: 1200, maxWaitMs: 3000, adaptive: true }), 500);
  // 没有上一条（首条）→ 不缩
  assert.equal(batchDelayMs({ now: 1000, firstAt: 1000, prevAt: 0, baseMs: 1200, maxWaitMs: 3000, adaptive: true }), 1200);
  // maxWait 为 0 表示不等待
  assert.equal(batchDelayMs({ now: 1000, firstAt: 1000, prevAt: 0, baseMs: 1200, maxWaitMs: 0, adaptive: true }), 0);
});

await test('合批：合并窗口里出现更急的一档时整体升为 direct', () => {
  assert.equal(tighterTier('ambient', 'direct'), 'direct');
  assert.equal(tighterTier('direct', 'ambient'), 'direct');
  assert.equal(tighterTier('ambient', 'ambient'), 'ambient');
  assert.equal(tighterTier(undefined, 'ambient'), 'ambient');
});

// ── 2. 预算：两档令牌桶 ─────────────────────────────────────────────────────
const PACING = { direct: { capacity: 3, refillMs: 20000 }, ambient: { capacity: 6, refillMs: 300000 } };

await test('预算：连发三次后 direct 桶打空，不再放行', () => {
  let state = createPacingState(PACING, 0);
  for (let i = 0; i < 3; i += 1) {
    const took = takeToken(state, 'direct', PACING, 0);
    assert.equal(took.allowed, true, `第 ${i + 1} 次应放行`);
    state = took.state;
  }
  const blocked = takeToken(state, 'direct', PACING, 0);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.waitMs, 20000, '还差一整个回填间隔');
  assert.equal(blocked.tokens, 0);
});

await test('预算：回填按经过时间连续计息，差一点就满也会恢复', () => {
  const t0 = 1_700_000_000_000;
  let state = createPacingState(PACING, t0);
  state = takeToken(state, 'direct', PACING, t0).state;
  state = takeToken(state, 'direct', PACING, t0).state;
  state = takeToken(state, 'direct', PACING, t0).state; // 空
  const half = takeToken(state, 'direct', PACING, t0 + 10000);
  assert.equal(half.allowed, false);
  assert.equal(half.tokens, 0.5, '半个回填间隔回填半个 token');
  assert.equal(half.waitMs, 10000);
  const full = takeToken(half.state, 'direct', PACING, t0 + 20000);
  assert.equal(full.allowed, true, '满一个回填间隔后必须能再取一个');
});

await test('预算：两档物理隔离，ambient 打空不影响 direct', () => {
  let state = createPacingState(PACING, 0);
  for (let i = 0; i < 6; i += 1) state = takeToken(state, 'ambient', PACING, 0).state;
  assert.equal(takeToken(state, 'ambient', PACING, 0).allowed, false);
  assert.equal(takeToken(state, 'direct', PACING, 0).allowed, true);
});

await test('预算：容量 <= 0 视为不限额（配置写坏不能把会话锁死）', () => {
  const unlimited = { direct: { capacity: 0, refillMs: 20000 }, ambient: { capacity: 0, refillMs: 0 } };
  const state = createPacingState(unlimited, 0);
  for (let i = 0; i < 10; i += 1) assert.equal(takeToken(state, 'direct', unlimited, 0).allowed, true);
});

await test('预算：投递失败退回 token，不白扣额度', () => {
  let state = createPacingState(PACING, 0);
  state = takeToken(state, 'direct', PACING, 0).state;
  assert.equal(state.direct.tokens, 2);
  state = refundToken(state, 'direct', PACING, 0);
  assert.equal(state.direct.tokens, 3);
  // 满桶再退不越界
  assert.equal(refundToken(state, 'direct', PACING, 0).direct.tokens, 3);
});

await test('预算：落盘状态归一补齐缺档、夹紧越界、时间戳异常按此刻', () => {
  const t0 = 1_700_000_000_000;
  const restored = normalizePacingState({ direct: { tokens: 99, at: 0 } }, PACING, t0);
  assert.deepEqual(PACING_TIERS, ['direct', 'ambient']);
  assert.equal(restored.direct.tokens, 3, '越界夹到容量');
  assert.equal(restored.direct.at, t0, '时间戳缺失按此刻');
  assert.equal(restored.ambient.tokens, 6, '缺档补满');
  const snapshot = pacingSnapshot({ direct: { tokens: 1, at: t0 } }, PACING, t0 + 20000);
  assert.equal(snapshot.direct.tokens, 2, '读侧视图算上回填');
  assert.equal(snapshot.direct.capacity, 3);
});

// ── 3. 收尾判据：显式回执 → 未读还在 → 已被挤出 ────────────────────────────
await test('收尾判据：显式回执优先于「未读里还有」', () => {
  const item = { reason: 'atMention', seq: 2 };
  const unread = [{ seq: 1 }, { seq: 2 }];
  assert.equal(classifyPendingWake({ item, unread, lastReadThroughSeq: 2, overflow: null }), 'explicitAck');
  assert.equal(classifyPendingWake({ item, unread, lastReadThroughSeq: 0, overflow: null }), 'unreadStill');
  assert.equal(
    classifyPendingWake({ item, unread: [], lastReadThroughSeq: 0, overflow: { count: 3, fromSeq: 1, toSeq: 5 } }),
    'overflowed',
  );
  // seq 不在溢出范围内：仍然算未读还在（不猜）
  assert.equal(
    classifyPendingWake({ item: { reason: 'atMention', seq: 9 }, unread: [], lastReadThroughSeq: 0, overflow: { count: 3, fromSeq: 1, toSeq: 5 } }),
    'unreadStill',
  );
});

await test('溢出：多次裁剪合并成一个区间，读水位越过末条就销账', () => {
  const first = noteOverflow(null, [{ seq: 1 }, { seq: 2 }], 10);
  assert.deepEqual([first.count, first.fromSeq, first.toSeq], [2, 1, 2]);
  const second = noteOverflow(first, [{ seq: 3 }], 20);
  assert.deepEqual([second.count, second.fromSeq, second.toSeq], [3, 1, 3], '同一次唤醒内继续合并');
  assert.equal(clearAcknowledgedOverflow(second, 2), second, '没读到头不清');
  assert.equal(clearAcknowledgedOverflow(second, 3), null, '读水位覆盖到末条即销账');
});

// ── 4. 策略解析：默认值、覆盖、档位归属 ─────────────────────────────────────
await test('策略：空配置落到核心默认值，覆盖值只改自己', () => {
  const fallback = resolveSchedulingPolicy({});
  assert.equal(fallback.adaptiveDebounce, SCHEDULING_DEFAULTS.adaptiveDebounce);
  assert.deepEqual(fallback.batching.direct, {
    baseMs: SCHEDULING_DEFAULTS.directBaseMs,
    maxWaitMs: SCHEDULING_DEFAULTS.directMaxWaitMs,
  });
  assert.equal(fallback.pacing.ambient.capacity, SCHEDULING_DEFAULTS.ambientBudgetCapacity);
  const tuned = resolveSchedulingPolicy({ directMaxWaitMs: 500, ambientBaseMs: 'bad', ambientBudgetCapacity: -1 });
  assert.equal(tuned.batching.direct.maxWaitMs, 500);
  assert.equal(tuned.batching.ambient.baseMs, SCHEDULING_DEFAULTS.ambientBaseMs, '非法值回落默认');
  assert.equal(tuned.pacing.ambient.capacity, SCHEDULING_DEFAULTS.ambientBudgetCapacity, '越界值回落默认');
});

await test('策略：档位归属 —— 点名走 direct，时钟不耗预算，其余 ambient', () => {
  assert.equal(tierOf('atMention'), 'direct');
  assert.equal(tierOf('private'), 'direct');
  assert.equal(tierOf('ownerRelay'), 'direct');
  assert.equal(tierOf('speaker:张三'), 'direct');
  assert.equal(tierOf('timeout'), 'clock');
  assert.equal(tierOf('replyCheck'), 'clock');
  assert.equal(tierOf('bootstrap'), 'clock');
  assert.equal(tierOf('scheduled'), 'clock');
  assert.equal(tierOf('question'), 'ambient');
  assert.equal(tierOf('keyword:小鲸鱼'), 'ambient');
  assert.equal(tierOf('backlog'), 'ambient');
  assert.equal(tierOf('memberJoin'), 'ambient', '没登记的定时器类也不许抢 direct 额度');
  assert.equal(tierOf(''), 'ambient');
});

await test('策略：clock 与 ambient 共用同一套合批窗口', () => {
  const policy = resolveSchedulingPolicy({ ambientBaseMs: 1000, ambientMaxWaitMs: 2000, directBaseMs: 10, directMaxWaitMs: 20 });
  assert.deepEqual(batchLimits(policy, 'clock'), batchLimits(policy, 'ambient'));
  assert.deepEqual(batchLimits(policy, 'direct'), { baseMs: 10, maxWaitMs: 20 });
});

// ── 5. 桥接侧接线 ──────────────────────────────────────────────────────────
// 行为档案的 `wake:` 段会整段替掉 cfg.socialV2.wake，所以节奏与触发条件必须写在
// behavior 里才能到运行期（写在 config 里会被档案覆盖，测试会变成随机的）。
const QUIET = {
  v2: {
    proactive: { enabled: false },
    wake: {
      adaptiveDebounce: false,
      ambientMaxWaitMs: 1000,
      recommendedAtMention: false,
      recommendedNameMention: false,
      recommendedQuestion: false,
      recommendedPoke: false,
      recommendedProbability: 0,
      recommendedKeywords: [],
      backlogEnabled: true,
      backlogWakeAfter: 3,
      backlogQuietMs: 0,
    },
  },
};
const groupEvent = (messageId, text) => ({
  self_id: 999, user_id: 123, group_id: 456, message_id: messageId,
  message: [{ type: 'text', data: { text } }], raw_message: text,
  sender: { nickname: '测试群友', card: '测试群友' },
});

await test('接线：无人点名的消息不进唤醒，积压到阈值才补一次', async () => {
  const h = await bridgeHarness({ behavior: QUIET });
  try {
    h.setMode('reserved2');
    const st = h.getSocialV2State('qq:group:456');
    st.bootstrapSent = true; // 跳过首次引导，只看积压
    await h.handleIncoming('group', '456', groupEvent(7001, '今天天气不错'), h.cfg);
    assert.equal(st.pendingWakeTimer, null, '第 1 条不触发');
    await h.handleIncoming('group', '456', groupEvent(7002, '确实'), h.cfg);
    assert.equal(st.pendingWakeTimer, null, '第 2 条不触发');
    assert.equal(st.backlogSinceWake, 2);
    await h.handleIncoming('group', '456', groupEvent(7003, '嗯嗯'), h.cfg);
    assert.equal(st.pendingWakeReason, 'backlog', '第 3 条到达阈值，补一次积压唤醒');
    assert.ok(st.pendingWakeTimer, '走合批窗口，不插队');
    clearTimeout(st.pendingWakeTimer);
    st.pendingWakeTimer = null;
  } finally { await h.close(); }
});

await test('接线：积压唤醒计数在投递后归零', async () => {
  const h = await bridgeHarness({ behavior: QUIET });
  try {
    h.setMode('reserved2');
    const st = h.getSocialV2State('qq:group:456');
    st.bootstrapSent = true;
    for (const [id, text] of [[7101, '一'], [7102, '二'], [7103, '三']]) {
      await h.handleIncoming('group', '456', groupEvent(id, text), h.cfg);
    }
    assert.equal(st.backlogSinceWake, 3);
    // 合批窗口开着时投递会被暂存（窗口本身就是「忙」的来源），先让它落地。
    clearTimeout(st.pendingWakeTimer);
    st.pendingWakeTimer = null;
    st.pendingWakeBatch = null;
    st.pendingWakeReason = null;
    await h.sendWakePromptV2('qq:group:456', 'backlog');
    assert.equal(h.calls.prompts.length, 1, '积压唤醒必须真的投递');
    assert.equal(st.backlogSinceWake, 0, '投递后重新计时');
  } finally { await h.close(); }
});

await test('接线：被挤出缓冲的消息在提示词里交代条数与 seq', async () => {
  const h = await bridgeHarness({ behavior: QUIET });
  try {
    h.setMode('reserved2');
    const st = h.getSocialV2State('qq:group:456');
    st.bootstrapSent = true;
    st.wakeOverflow = { count: 5, fromSeq: 11, toSeq: 15, at: Date.now() };
    await h.sendWakePromptV2('qq:group:456', 'question');
    assert.equal(h.calls.prompts.length, 1);
    const text = h.calls.prompts[0].content.map((c) => String(c?.text ?? '')).join('\n');
    assert.match(text, /调度说明/);
    assert.match(text, /5 条消息/);
    assert.match(text, /11~15/);
  } finally { await h.close(); }
});

await test('接线：积压唤醒来由写进提示词，并允许不接话', async () => {
  const h = await bridgeHarness({ behavior: QUIET });
  try {
    h.setMode('reserved2');
    const st = h.getSocialV2State('qq:group:456');
    st.bootstrapSent = true;
    await h.sendWakePromptV2('qq:group:456', 'backlog');
    assert.equal(h.calls.prompts.length, 1);
    const text = h.calls.prompts[0].content.map((c) => String(c?.text ?? '')).join('\n');
    assert.match(text, /【补看积压】/);
    assert.match(text, /不必接话/);
  } finally { await h.close(); }
});

await test('接线：合批窗口里升级唤醒原因时按 direct 重算等待', async () => {
  const h = await bridgeHarness({ behavior: QUIET });
  try {
    h.setMode('reserved2');
    const st = h.getSocialV2State('qq:group:456');
    st.bootstrapSent = true;
    for (const [id, text] of [[7201, '闲聊一句'], [7202, '又一句'], [7203, '再来一句']]) {
      await h.handleIncoming('group', '456', groupEvent(id, text), h.cfg);
    }
    assert.equal(st.pendingWakeReason, 'backlog');
    assert.equal(st.pendingWakeBatch?.tier, 'ambient');
    // 窗口内有人点名：原因升级、档位变 direct
    st.wakeConfig.mode = 'active';
    st.wakeConfig.triggers.atMention = true;
    const atEvent = {
      ...groupEvent(7204, '你好'),
      message: [{ type: 'at', data: { qq: '999' } }, { type: 'text', data: { text: '你好' } }],
    };
    await h.handleIncoming('group', '456', atEvent, h.cfg);
    assert.equal(st.pendingWakeReason, 'atMention', '原因升级到更高优先级');
    assert.equal(st.pendingWakeBatch?.tier, 'direct', '档位随原因收紧');
    clearTimeout(st.pendingWakeTimer);
    st.pendingWakeTimer = null;
  } finally { await h.close(); }
});

await test('接线：唤醒先等在途入站记账，不从一个还在解析引用的消息身上跨过去', async () => {
  const h = await bridgeHarness({ behavior: QUIET, fetchDelay: { get_msg: 400 } });
  try {
    h.setMode('reserved2');
    const st = h.getSocialV2State('qq:group:456');
    st.bootstrapSent = true;
    // 带引用段：入站要等网关回 get_msg（这里人为拖 400ms）才能把消息记进未读，
    // 那就是真实的「已收到、还没入账」窗口。
    const quoted = {
      ...groupEvent(7301, '你看这个'),
      message: [{ type: 'reply', data: { id: '5555' } }, { type: 'text', data: { text: '你看这个' } }],
    };
    const ingest = h.handleIncoming('group', '456', quoted, h.cfg);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(st.unread.length, 0, '引用还没解析完，这条消息还没入账');
    const wake = h.sendWakePromptV2('qq:group:456', 'question');
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(h.calls.prompts.length, 0, '有在途入站时唤醒要等它落地，不能先投出去');
    await ingest;
    await wake;
    assert.equal(h.calls.prompts.length, 1, '入站落地后照常投递');
    assert.equal(st.unread.length, 1, '这一枪必须带上那条消息');
  } finally { await h.close(); }
});

if (failures) {
  console.error(`\n${failures} 条调度回归失败`);
  process.exit(1);
}
console.log('\n调度回归全部通过');
