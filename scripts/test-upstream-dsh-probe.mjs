// `src/upstream/dsh-probe.mjs`：探活 + 自动识别地址的重试/节流策略。
//
// 这段逻辑以前长在 checkDsh 的闭包里，只能起整桥接、再把 DSH 关掉才能验证；而它要保证的
// 恰恰是几件很容易写错的事：
//   · 地址留空（自动识别）时，DSH 重启换了随机端口要能重新识别 —— 否则「DSH 重启后桥接
//     再也连不上」；
//   · 重新识别不能每 5 秒来一次（要扫进程/端口），失败期间按 10s 节流；
//   · 识别到地址但探活仍失败时，不能把「改了地址」当成「已恢复」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDshProbe } from '../src/upstream/dsh-probe.mjs';

function harness({ auto = true, probeResults = [], endpoints = [], interval = 10_000 } = {}) {
  let clock = 0;
  let probeCalls = 0;
  const applied = [];
  const logs = [];
  const probeQueue = [...probeResults];
  const endpointQueue = [...endpoints];
  const h = {
    applied,
    logs,
    tick(ms) { clock += ms; },
    get probeCalls() { return probeCalls; },
    probe: createDshProbe({
      now: () => clock,
      rediscoverIntervalMs: interval,
      isAutoBaseUrl: () => auto,
      probe: async () => {
        probeCalls += 1;
        const next = probeQueue.shift();
        if (next instanceof Error) throw next;
        if (next === 'ok' || next === undefined && probeCalls === 1) return;
        if (next === 'fail') throw new Error('connect ECONNREFUSED');
        return;
      },
      rediscover: async () => {
        const next = endpointQueue.shift();
        if (next instanceof Error) throw next;
        return next ?? null;
      },
      applyUrl: (url) => applied.push(url),
      log: (message) => logs.push(message),
    }),
  };
  return h;
}

test('探活成功：不触发重新识别', async () => {
  const h = harness({ probeResults: ['ok'] });
  const r = await h.probe.check();
  assert.deepEqual({ ok: r.ok, rediscovered: r.rediscovered }, { ok: true, rediscovered: false });
  assert.equal(h.probeCalls, 1);
  assert.deepEqual(h.applied, []);
});

test('探活失败但地址不是自动识别：不重新识别（用户写死的地址不该被改）', async () => {
  const h = harness({ auto: false, probeResults: ['fail'] });
  const r = await h.probe.check();
  assert.equal(r.ok, false);
  assert.equal(r.rediscovered, false);
  assert.deepEqual(h.applied, []);
  assert.equal(h.probeCalls, 1);
});

test('自动识别 + 探活失败：重新识别到地址、应用、重试成功', async () => {
  const h = harness({
    probeResults: ['fail', 'ok'],
    endpoints: [{ reachable: true, url: 'http://127.0.0.1:54321' }],
  });
  const r = await h.probe.check();
  assert.equal(r.ok, true);
  assert.equal(r.rediscovered, true);
  assert.equal(r.url, 'http://127.0.0.1:54321');
  assert.deepEqual(h.applied, ['http://127.0.0.1:54321']);
  assert.equal(h.probeCalls, 2);
});

test('首次即可重识别，随后按节流窗口抑制（不是每轮都扫端口）', async () => {
  const h = harness({
    probeResults: ['fail', 'ok', 'fail', 'fail', 'ok'],
    endpoints: [{ reachable: true, url: 'http://a' }, { reachable: true, url: 'http://b' }],
    interval: 10_000,
  });
  await h.probe.check();             // 第一轮：重识别 → 成功
  h.tick(1_000);
  const second = await h.probe.check(); // 1s 后失败：窗口内，不重识别
  assert.equal(second.rediscovered, false);
  assert.equal(h.applied.length, 1);
  h.tick(9_500);                     // 累计 10.5s，窗口外
  const third = await h.probe.check();
  assert.equal(third.rediscovered, true);
  assert.deepEqual(h.applied, ['http://a', 'http://b']);
});

test('识别到的地址不可达：不应用、不重试', async () => {
  const h = harness({ probeResults: ['fail'], endpoints: [{ reachable: false }] });
  const r = await h.probe.check();
  assert.equal(r.ok, false);
  assert.equal(r.rediscovered, false);
  assert.deepEqual(h.applied, []);
  assert.equal(h.probeCalls, 1);
});

test('识别过程抛错：当作没识别到，保留原始探活错误', async () => {
  const h = harness({ probeResults: ['fail'], endpoints: [new Error('scan failed')] });
  const r = await h.probe.check();
  assert.equal(r.ok, false);
  assert.match(r.error.message, /ECONNREFUSED/);
  assert.deepEqual(h.applied, []);
});

test('识别到地址但重试仍失败：如实报失败，不把「改了地址」当恢复', async () => {
  const h = harness({
    probeResults: ['fail', 'fail'],
    endpoints: [{ reachable: true, url: 'http://c' }],
  });
  const r = await h.probe.check();
  assert.equal(r.ok, false);
  assert.equal(r.rediscovered, true);
  assert.equal(r.url, 'http://c');
  assert.deepEqual(h.applied, ['http://c']);
});

test('探活抛非 Error 值也能归一成 Error（日志里不会是 [object Object]）', async () => {
  const h = harness({ probeResults: ['fail'], endpoints: [{ reachable: false }] });
  const r = await h.probe.check();
  assert.ok(r.error instanceof Error);
});
