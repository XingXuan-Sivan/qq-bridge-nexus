// P0 会话稳定性：DSH 会话的确定性命名、启动对账、not-found 自愈与熔断。
// 全部离线：DSH RPC 由 audit-bridge-harness 的 api 桩提供，测试按需覆盖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const GROUP = 'qq:group:456';

test('P0：新建会话写入确定性标题，重建后标题一致', async () => {
  const h = await bridgeHarness();
  h.setReady(true);
  const sessionId = await h.ensureSession(GROUP);
  assert.equal(sessionId, 'fixture-1');
  assert.equal(h.calls.created.length, 1);
  assert.equal(h.calls.renames.length, 1, '创建后应调用 session.rename');
  assert.equal(h.calls.renames[0].sessionId, sessionId);
  assert.equal(h.calls.renames[0].title, 'QQ·群 456');
  assert.equal(h.getDshHealth(GROUP, sessionId).status, 'online');

  const rebuilt = await h.rebuildSession(GROUP);
  assert.equal(rebuilt.oldSessionId, 'fixture-1');
  assert.equal(rebuilt.sessionId, 'fixture-2');
  assert.equal(h.calls.renames.at(-1).title, 'QQ·群 456');
  assert.equal(h.getDshHealth(GROUP, 'fixture-2').status, 'online');
});

test('P0：启动对账把 DSH 侧缺失的绑定标成 missing，且不主动解绑', async () => {
  const h = await bridgeHarness();
  h.setReady(true);
  const sessionId = await h.ensureSession(GROUP);
  h.api.sessions.list = async () => ({ result: { ok: true, value: { items: [{ sessionId }] } } });
  let r = await h.reconcileDshSessions();
  assert.equal(r.ok, true);
  assert.equal(r.online, 1);
  assert.equal(r.missing, 0);
  assert.equal(h.getDshHealth(GROUP, sessionId).status, 'online');

  h.api.sessions.list = async () => ({ result: { ok: true, value: { items: [] } } });
  r = await h.reconcileDshSessions();
  assert.equal(r.ok, true);
  assert.equal(r.online, 0);
  assert.equal(r.missing, 1);
  const health = h.getDshHealth(GROUP, sessionId);
  assert.equal(health.status, 'missing');
  assert.match(health.error, /找不到/);
  // 对账只标记，不拆绑定：用户还能在详情页看到它并点重建。
  assert.equal(h.sessions.get(GROUP), sessionId);
});

test('P0：prompt 返回 session/not-found 时退役重建并重试一次', async () => {
  const h = await bridgeHarness();
  h.setReady(true);
  await h.ensureSession(GROUP);
  let attempts = 0;
  const promptSessions = [];
  h.api.sessions.prompt = async (params) => {
    attempts += 1;
    promptSessions.push(params.sessionId);
    if (attempts === 1) throw new Error('session/prompt failed: session/not-found: session gone');
    return { result: { ok: true, value: {} } };
  };
  const r = await h.deliverPrompt(GROUP, '你好', { silent: true });
  assert.equal(r.ok, true);
  assert.equal(attempts, 2, '首次失败后应重试一次');
  assert.equal(h.calls.created.length, 2, '应重建一个新 DSH 会话');
  assert.equal(promptSessions.at(-1), 'fixture-2');
  assert.equal(h.getDshHealth(GROUP, 'fixture-2').status, 'online');
});

test('P0：60 秒内连续 3 次自愈后熔断，第 4 次不再重建', async () => {
  const h = await bridgeHarness();
  h.setReady(true);
  await h.ensureSession(GROUP);
  let attempts = 0;
  h.api.sessions.prompt = async () => {
    attempts += 1;
    throw new Error('session/prompt failed: session/not-found: still gone');
  };
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(h.deliverPrompt(GROUP, `第 ${i + 1} 次`, { silent: true }), /not-found/i);
  }
  assert.equal(h.calls.created.length, 4, '首次创建 + 3 次自愈重建');
  const createdBefore = h.calls.created.length;
  const attemptsBefore = attempts;
  await assert.rejects(
    h.deliverPrompt(GROUP, '第 4 次', { silent: true }),
    /not-found/i,
    '熔断后不再重建，原错误抛给调用方',
  );
  assert.equal(attempts, attemptsBefore + 1, '熔断后只尝试一次 prompt');
  assert.equal(h.calls.created.length, createdBefore, '熔断后不应继续重建');
});
