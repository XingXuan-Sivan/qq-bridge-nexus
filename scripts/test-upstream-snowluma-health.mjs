#!/usr/bin/env node
/**
 * SnowLuma 上游健康（`src/upstream/snowluma-health.mjs`）。
 *
 * 守两件事：
 *   1. 「自报 good=false」与「长时间没有事件包」是两个**不同**的故障面，hint 措辞与判定不能串；
 *   2. 告警是边沿触发——同一状态持续不重复刷日志。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnowlumaHealth } from '../src/upstream/snowluma-health.mjs';

function setup(extra = {}) {
  const logs = [];
  let clock = 1_000_000;
  const timers = { intervals: [], timeouts: [] };
  const health = createSnowlumaHealth({
    log: (msg) => logs.push(msg),
    now: () => clock,
    silenceWarnMs: 10 * 60_000,
    timers: {
      setInterval: (fn, ms) => { const h = { fn, ms }; timers.intervals.push(h); return h; },
      setTimeout: (fn, ms) => { const h = { fn, ms }; timers.timeouts.push(h); return h; },
    },
    ...extra,
  });
  return { health, logs, timers, advance: (ms) => { clock += ms; } };
}

test('初始快照：未连接、未降级、无 hint', () => {
  const { health } = setup();
  const snap = health.snapshot();
  assert.equal(snap.connected, false);
  assert.equal(snap.degraded, false);
  assert.equal(snap.hint, null);
  assert.equal(snap.lastPacketAgoMs, null);
});

test('非布尔 good 被忽略（老版本 SnowLuma 不报这个字段）', () => {
  const { health } = setup();
  health.noteReceiveHealth(undefined, 'heartbeat');
  health.noteReceiveHealth('false', 'heartbeat');
  assert.equal(health.snapshot().good, null);
});

test('good=false ⇒ 确认坏，hint 指向 [Hook] 接收链路', () => {
  const { health, logs } = setup();
  health.noteReceiveHealth(false, 'heartbeat');
  const snap = health.snapshot();
  assert.equal(snap.degraded, true);
  assert.equal(snap.silent, false);
  assert.match(snap.hint, /\[Hook\]/);
  health.report();
  assert.match(logs.join('\n'), /上游不健康/);
});

test('有包但超时无包 ⇒ 静默，hint 指向 OneBot 服务/进程', () => {
  const { health, advance } = setup();
  health.notePacket('meta_event');
  health.noteReceiveHealth(true, 'heartbeat');
  advance(11 * 60_000);
  const snap = health.snapshot();
  assert.equal(snap.silent, true);
  assert.equal(snap.degraded, true);
  assert.equal(snap.good, true, '自报 good 不能因为静默被改写');
  assert.match(snap.hint, /OneBot 服务\/进程/);
});

test('两种故障同时存在时优先报「确认坏」', () => {
  const { health, advance } = setup();
  health.notePacket('meta_event');
  health.noteReceiveHealth(false, 'heartbeat');
  advance(30 * 60_000);
  assert.match(health.snapshot().hint, /\[Hook\]/);
});

test('边沿触发：同一状态不重复刷告警，恢复时只报一次', () => {
  const { health, logs } = setup();
  health.noteReceiveHealth(false, 'heartbeat');
  health.report();
  health.report();
  health.report();
  assert.equal(logs.filter((l) => l.includes('上游不健康')).length, 1);
  health.noteReceiveHealth(true, 'heartbeat');
  health.report();
  health.report();
  assert.equal(logs.filter((l) => l.includes('已恢复正常')).length, 1);
});

test('pollStatus 成功时采用 get_status 的 good/online', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ status: 'ok', data: { good: true, online: true } }) };
  };
  const { health } = setup({ fetchImpl });
  await health.pollStatus({ httpUrl: 'http://127.0.0.1:3000/', accessToken: 'tok' });
  const snap = health.snapshot();
  assert.equal(snap.good, true);
  assert.equal(snap.goodSource, 'get_status');
  assert.equal(snap.accountOnline, true);
  assert.equal(calls[0].url, 'http://127.0.0.1:3000/get_status', '尾部斜杠要归一');
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
});

test('pollStatus 非 ok 与抛错都记进 goodError，不改 good', async () => {
  const { health: h1 } = setup({ fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ wording: 'busy' }) }) });
  await h1.pollStatus();
  assert.match(h1.snapshot().goodError, /HTTP 503 busy/);
  assert.equal(h1.snapshot().good, null);
  const { health: h2 } = setup({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await h2.pollStatus();
  assert.match(h2.snapshot().goodError, /ECONNREFUSED/);
});

test('startWatch 只启动一次，首轮延后 5 秒并按 statusPollMs 轮询', () => {
  const { health, timers } = setup();
  assert.equal(health.startWatch(() => ({})), true);
  assert.equal(health.startWatch(() => ({})), false);
  assert.equal(timers.timeouts.length, 1);
  assert.equal(timers.timeouts[0].ms, 5000);
  assert.deepEqual(timers.intervals.map((i) => i.ms).sort((a, b) => a - b), [30000, 60000]);
});

test('setConnected / setAccountOnline 只接受布尔', () => {
  const { health } = setup();
  health.setConnected(true);
  health.setAccountOnline(false);
  assert.equal(health.snapshot().connected, true);
  assert.equal(health.snapshot().accountOnline, false);
  health.setAccountOnline('yes');
  assert.equal(health.snapshot().accountOnline, false);
});
