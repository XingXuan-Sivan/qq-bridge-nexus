// 会话重置清理序列的回归（docs/COMMAND_REGISTRY.md §9 / src/session/reset.mjs）。
//
// 这个测试的价值在「漏清」：resetSession 以前写在 bridge.js 里，清理项散落在 58 行中，
// 新增缓存时很容易只清一部分。现在所有要清的桶都由 deps 显式登记，这里逐桶断言，
// 少登记一个桶就会立刻红。
import assert from 'node:assert/strict';
import test from 'node:test';

import { createSessionResetter } from '../src/session/reset.mjs';

const KEY = 'group:100012';
const OLD = 'sid-old';

function makeHarness(overrides = {}) {
  const calls = [];
  const buckets = {
    modelAppliedSessions: new Map([[OLD, 1]]),
    reverse: new Map([[OLD, 2]]),
    collectors: new Map([[OLD, 3]]),
    sendToolSucceededSessions: new Map([[OLD, 4]]),
    pendingSendToolCalls: new Map([[OLD, 5]]),
    v2TurnStartAt: new Map([[OLD, 6]]),
    turnLeaseNoted: new Map([[OLD, 7]]),
    toolCallNames: new Map([[OLD, 8]]),
  };
  const social = {
    silentTurns: new Map([[KEY, 1]]),
    exitingSessions: new Set([KEY]),
    recentMessages: new Map([[KEY, []]]),
    pendingSummaries: new Map([[KEY, 'x']]),
    states: new Map([[KEY, 'idle']]),
    silentContext: new Map([[KEY, {}]]),
  };
  const slang = {
    windows: new Map([[KEY, []]]),
    extractionCooldowns: new Map([[KEY, 1]]),
    submitTimes: new Map([[KEY, 2]]),
  };
  const wake = {
    pending: new Set([KEY]),
    updated: new Set([KEY]),
    markRead: new Set([KEY]),
    missCount: new Map([[KEY, 3]]),
  };
  const state = {
    sessions: { [KEY]: OLD },
    sessionPolicies: { [KEY]: { mode: 'x' } },
  };

  const deps = {
    state,
    bumpEpoch: () => calls.push('bumpEpoch'),
    bySessionId: buckets,
    pending: new Map([[KEY, { timer: null }]]),
    cancelPendingEntry: async () => { calls.push('cancelPendingEntry'); },
    queued: new Map([[KEY, 1]]),
    queuedHintAt: new Map([[KEY, 1]]),
    sessionPromises: new Map([[KEY, Promise.resolve()]]),
    drainPromptQueue: (key, reason) => calls.push(`drain:${key}:${reason}`),
    approvals: {
      removeKey: (key) => { calls.push(`approvals.removeKey:${key}`); return []; },
      forgetSession: (sid) => calls.push(`approvals.forgetSession:${sid}`),
    },
    social,
    socialV2: { conversations: new Map([[KEY, { turns: 1 }]]) },
    slang,
    wake,
    mediaStore: new Map([[KEY, []]]),
    seenForwardIds: new Set([KEY]),
    cancelSocialTimers: (key) => calls.push(`cancelSocialTimers:${key}`),
    clearSocialV2Timers: (key) => calls.push(`clearSocialV2Timers:${key}`),
    forgetAgentToken: (key) => calls.push(`forgetAgentToken:${key}`),
    forgetConversationCaches: (key) => calls.push(`forgetConversationCaches:${key}`),
    discardDormantForReset: (key) => calls.push(`discardDormant:${key}`),
    saveSocialV2State: () => calls.push('saveSocialV2State'),
    saveState: () => calls.push('saveState'),
    send: async (key, text) => { calls.push(`send:${key}:${text}`); return { ok: true }; },
    api: {
      stopSessionWork: async (sid) => { calls.push(`stopSessionWork:${sid}`); },
      archiveSession: async ({ sessionId }) => { calls.push(`archiveSession:${sessionId}`); },
    },
    withTimeout: (promise) => promise,
    dshControlTimeoutMs: 1000,
    log: (line) => calls.push(`log:${line}`),
    ...overrides,
  };

  return {
    calls, buckets, social, slang, wake, state, deps,
    reset: createSessionResetter(deps),
  };
}

test('无会话：直接返回 no-session，不动任何东西', async () => {
  const h = makeHarness({ state: { sessions: {}, sessionPolicies: {} } });
  const result = await h.reset(KEY);
  assert.deepEqual(result, { ok: true, note: 'no-session' });
  assert.deepEqual(h.calls, []);
});

test('全量清理：所有按键/按旧 sessionId 记账的桶都被清空', async () => {
  const h = makeHarness();
  const result = await h.reset(KEY);
  assert.deepEqual(result, { ok: true });

  assert.equal(h.state.sessions[KEY], undefined);
  assert.equal(h.state.sessionPolicies[KEY], undefined);
  for (const [name, map] of Object.entries(h.buckets)) {
    assert.equal(map.has(OLD), false, `${name} 还留着旧 sessionId`);
  }
  for (const [name, map] of Object.entries(h.social)) {
    assert.equal(map.has(KEY), false, `social.${name} 还留着会话`);
  }
  for (const [name, map] of Object.entries(h.slang)) {
    assert.equal(map.has(KEY), false, `slang.${name} 还留着会话`);
  }
  assert.equal(h.wake.pending.has(KEY), false);
  assert.equal(h.wake.updated.has(KEY), false);
  assert.equal(h.wake.markRead.has(KEY), false);
  assert.equal(h.wake.missCount.has(KEY), false);
  assert.equal(h.deps.pending.has(KEY), false);
  assert.equal(h.deps.queued.has(KEY), false);
  assert.equal(h.deps.queuedHintAt.has(KEY), false);
  assert.equal(h.deps.sessionPromises.has(KEY), false);
  assert.equal(h.deps.mediaStore.has(KEY), false);
  assert.equal(h.deps.seenForwardIds.has(KEY), false);
  assert.equal(h.deps.socialV2.conversations.has(KEY), false);

  assert.equal(h.calls.filter((c) => c === 'bumpEpoch').length, 1, 'epoch 只自增一次');
  assert.ok(h.calls.includes(`approvals.removeKey:${KEY}`));
  assert.ok(h.calls.includes(`approvals.forgetSession:${OLD}`));
  assert.ok(h.calls.includes(`drain:${KEY}:会话已重置`));
  assert.ok(h.calls.includes(`cancelSocialTimers:${KEY}`));
  assert.ok(h.calls.includes(`clearSocialV2Timers:${KEY}`));
  assert.ok(h.calls.includes(`forgetAgentToken:${KEY}`));
  assert.ok(h.calls.includes(`forgetConversationCaches:${KEY}`));
  assert.ok(h.calls.includes(`discardDormant:${KEY}`));
  assert.ok(h.calls.includes('saveSocialV2State'));
  assert.ok(h.calls.includes('saveState'));
  assert.ok(h.calls.includes(`stopSessionWork:${OLD}`));
  assert.ok(h.calls.includes(`archiveSession:${OLD}`));
  assert.ok(h.calls.some((c) => c.startsWith(`send:${KEY}:已重置会话`)));
});

test('顺序：先落盘再调 DSH，最后才回执', async () => {
  const h = makeHarness();
  await h.reset(KEY);
  const index = (needle) => h.calls.findIndex((c) => c.startsWith(needle));
  const save = Math.max(index('saveSocialV2State'), index('saveState'));
  const stop = index('stopSessionWork:');
  const archive = index('archiveSession:');
  const send = index('send:');
  assert.ok(save > 0 && save < stop, '落盘必须在停止 DSH 之前');
  assert.ok(stop < archive, '先停工作再归档');
  assert.ok(archive < send, '回执必须在最后');
});

test('停止旧会话失败：记日志但继续归档并回执', async () => {
  const h = makeHarness({
    api: {
      stopSessionWork: async () => { throw new Error('dsh 掉线'); },
      archiveSession: async ({ sessionId }) => h.calls.push(`archiveSession:${sessionId}`),
    },
  });
  const result = await h.reset(KEY);
  assert.deepEqual(result, { ok: true });
  assert.ok(h.calls.some((c) => c.startsWith('log:⚠️ 停止旧会话失败') && c.includes('dsh 掉线')));
  assert.ok(h.calls.includes(`archiveSession:${OLD}`));
  assert.ok(h.calls.some((c) => c.startsWith(`send:${KEY}:`)));
});
