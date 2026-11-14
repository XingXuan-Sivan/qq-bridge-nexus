// DSH 探活判定（src/agent-side/adapters/dsh/health.mjs）离线测试：连续 2 次失败才算不可用；失败原因分类用真实的 fetch 错误形状验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyDshError, createDshHealth } from '../src/agent-side/adapters/dsh/health.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

test('连续失败计数：第 1 次不算不可用，第 2 次才算；恢复时报告之前失败了几次和原因', () => {
  const h = createDshHealth();
  assert.equal(h.threshold, 2);
  const a = h.fail(new Error('HTTP 503'));
  assert.equal(a.unavailable, false);
  assert.equal(a.failures, 1);
  const r1 = h.ok();
  assert.deepEqual([r1.recoveredFrom, r1.reason.kind], [1, 'http'], '偶发失败一次后恢复：记下原因');
  assert.equal(h.ok().recoveredFrom, 0, '一直正常时不报');
  h.fail(new Error('x'));
  const b = h.fail(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
  assert.equal(b.unavailable, true);
  assert.equal(b.reason.kind, 'refused', '用最后一次的原因');
  assert.equal(h.fail(new Error('x')).unavailable, true, '之后继续算不可用');
  assert.equal(createDshHealth({ threshold: 1 }).fail(null).unavailable, true);
  assert.equal(createDshHealth({ threshold: 0 }).threshold, 2, '非法阈值回到默认');
});

test('原因分类：真实的「连接被拒」与「超时」fetch 错误', async () => {
  const closed = await freePort();
  const refused = await fetch(`http://127.0.0.1:${closed}/`).catch((e) => e);
  assert.equal(classifyDshError(refused).kind, 'refused', String(refused?.cause?.code ?? refused));

  const server = http.createServer(() => {}); // 收到请求但永远不回应
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const slow = await fetch(`http://127.0.0.1:${server.address().port}/`, { signal: AbortSignal.timeout(200) }).catch((e) => e);
    assert.equal(classifyDshError(slow).kind, 'timeout', String(slow?.name ?? slow));
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});

test('原因分类：中断、鉴权、HTTP 状态、其他；标签是中文且不超长', () => {
  assert.equal(classifyDshError(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } })).kind, 'reset');
  assert.equal(classifyDshError(new Error('socket hang up')).kind, 'reset');
  assert.equal(classifyDshError(new Error('DSH token exchange failed: HTTP 401')).kind, 'auth');
  assert.equal(classifyDshError(new Error('HTTP 500 Internal')).label, 'HTTP 500');
  assert.equal(classifyDshError(new AggregateError([Object.assign(new Error('a'), { code: 'ECONNREFUSED' })])).kind, 'refused', '多地址时的聚合错误');
  const other = classifyDshError(new Error('x'.repeat(500)));
  assert.equal(other.kind, 'other');
  assert.ok(other.label.length < 100);
  assert.equal(classifyDshError(undefined).kind, 'other');
  assert.match(classifyDshError(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })).label, /超时/);
});

test('桥接接线：健康度与探活都取自连接层，桥接只拿结果记账', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'bridge.js'), 'utf8');
  const fn = src.slice(src.indexOf('const checkDsh = async () => {'), src.indexOf('let controllerInitPromise = null;'));
  assert.match(src, /const agentHealth = agentRuntime\(\)\.health\(\{ threshold: 2 \}\);/);
  assert.match(src, /const agentProbe = agentRuntime\(\)\.probe\(\);/);
  assert.match(fn, /const r = await agentProbe\.check\(\);/);
  assert.match(fn, /不可用（连续 \$\{v\.failures\} 次探活失败，原因：\$\{v\.reason\.label\}/);
  // 日志里的主体名跟着当前执行体走，不写死任何一个平台的简称。
  assert.match(fn, /\$\{agentRuntime\(\)\.label\} 探活偶发失败 \$\{rec\.recoveredFrom\} 次/);
  assert.ok(!fn.includes("log('⚠️ DSH 不可用（重启中？）"), '不再失败一次就报不可用');
  assert.ok(!/createAgentHealth|createDshProbe|dshBaseUrlAuto|resolveAgentBaseUrl/.test(src),
    '桥接不再自己拼装健康度、地址重识别与提示限频：这些都归连接层');
});
