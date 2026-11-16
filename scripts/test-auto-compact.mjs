// QQ 会话上下文太长时自动压缩（让 Agent 平台执行 /compact）。全部离线、假数据（假 Agent 平台，不发任何模型请求）。
//   ① 模块：配置规范化、读了多少 token、是否压缩（交给平台 / 未超阈值 / 冷却 / 超阈值）、阈值怎么取；
//   ② 端到端：回合结束且超过阈值 → 空闲后执行 /compact → 下次唤醒重新完整给表情块与角色卡；
//      冷却期内不再压；会话忙时不压；没超阈值不压；非二代模式不压；
//   ③ 手动压缩接口只给控制台用；
//   ④ 控制台改压缩方式（提前压缩填几万 / 交给 Agent 平台）：校验、写进 config.json、马上按新阈值判断、AI 改不了；
//   ⑤ 控制台卡片。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeCompactConfig, inputTokensOf, decideCompact, effectiveCompactThreshold, COMPACT_DEFAULTS, compactConfigFromConsole, COMPACT_THRESHOLD_MIN } from '../src/auto-compact.js';
import { bridgeHarness } from './audit-bridge-harness.mjs';
import { readConsoleSource } from './console-source.mjs';

const GROUP = 'qq:group:456';
const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));

test('① 模块', () => {
  assert.deepEqual(normalizeCompactConfig({}), { ...COMPACT_DEFAULTS });
  assert.equal(normalizeCompactConfig({ thresholdTokens: 10 }).thresholdTokens, COMPACT_DEFAULTS.thresholdTokens, '太小的阈值回到「跟随平台」');
  assert.equal(normalizeCompactConfig({ thresholdTokens: 200_000 }).thresholdTokens, 200_000);
  assert.equal(normalizeCompactConfig({ mode: 'agent' }).mode, 'agent');
  assert.equal(normalizeCompactConfig({ mode: 'later' }).mode, 'early', '不认识的压缩方式回到默认');
  assert.equal(inputTokensOf({ cacheHit: 100, cacheMiss: 20, cacheWrite: 5, output: 999 }), 125, '不算输出');
  const cfg = { thresholdTokens: 100_000, cooldownMinutes: 60 };
  assert.equal(decideCompact({ inputTokens: 90_000, config: cfg }).compact, false);
  assert.equal(decideCompact({ inputTokens: 150_000, config: cfg }).compact, true);
  assert.match(decideCompact({ inputTokens: 150_000, config: cfg }).reason, /150k/);
  assert.equal(decideCompact({ inputTokens: 150_000, lastAttemptAt: 1_000, now: 1_000 + 30 * 60_000, config: cfg }).compact, false, '冷却中');
  assert.equal(decideCompact({ inputTokens: 150_000, lastAttemptAt: 1_000, now: 1_000 + 61 * 60_000, config: cfg }).compact, true);
  assert.equal(decideCompact({ inputTokens: 999_999, config: { mode: 'agent' } }).compact, false, '交给平台就不压');
  // 阈值来自平台申报：没填就用申报点，填得比它还晚按申报点算。
  assert.equal(effectiveCompactThreshold({}, 800_000), 800_000);
  assert.equal(effectiveCompactThreshold({ thresholdTokens: 400_000 }, 800_000), 400_000);
  assert.equal(effectiveCompactThreshold({ thresholdTokens: 900_000 }, 800_000), 800_000, '晚于平台自己的动作没有意义');
  assert.equal(effectiveCompactThreshold({}, null), null, '平台没申报、自己也没填：没有阈值');
  assert.equal(decideCompact({ inputTokens: 999_999, config: {} }).compact, false);
  assert.match(decideCompact({ inputTokens: 999_999, config: {} }).reason, /没申报/);
});

async function withHarness(run, compact = { thresholdTokens: 100_000, idleDelayMs: 0, cooldownMinutes: 60 }) {
  const h = await bridgeHarness({ config: { compact } });
  h.setMode('reserved2');
  try { await run(h); } finally { await h.close(); }
}
// DSH 的用量桶：cacheReadTokens = 命中，inputTokens = 未命中（见 model-prices.js 的 normalizeUsage）
const recordUsage = (h, sessionId, hit, miss) => h.recordSessionUsage({
  kind: 'usage',
  sessionId,
  turn: 1,
  step: 1,
  usage: { cacheReadTokens: hit, inputTokens: miss, outputTokens: 10 }
});
const compactCalls = (h) => h.calls.commands.filter((c) => c.line === '/compact');

test('② 端到端：超过阈值 → 空闲后压缩 → 重新完整给关键内容；冷却 / 忙 / 未超 / 非二代都不压', async () => {
  await withHarness(async (h) => {
    const sid = await h.ensureSession(GROUP);
    recordUsage(h, sid, 140_000, 2_000);
    assert.ok(h.sessionLastInput.get(sid) >= 140_000, '记下最近一步读了多少');
    h.roleRefresh.markSeen(GROUP, sid, h.currentRoleFingerprintV2());
    h.promptBlocks.delivered(GROUP, sid, 'sticker', h.promptBlocks.decide(GROUP, sid, 'sticker', 'X'));

    h.maybeAutoCompact(GROUP, sid);
    await settle();
    assert.equal(compactCalls(h).length, 1, '执行了 /compact');
    assert.equal(compactCalls(h)[0].sessionId, sid);
    assert.equal(h.promptBlocks.get(GROUP), null, '下次唤醒重新完整给表情块和黑话表');
    assert.equal(h.roleRefresh.needsRefresh(GROUP, sid, h.currentRoleFingerprintV2()), true, '下次唤醒重新给角色卡');

    recordUsage(h, sid, 150_000, 0);
    h.maybeAutoCompact(GROUP, sid);
    await settle();
    assert.equal(compactCalls(h).length, 1, '冷却期内不再压');
  });

  await withHarness(async (h) => {
    const sid = await h.ensureSession(GROUP);
    recordUsage(h, sid, 50_000, 0);
    h.maybeAutoCompact(GROUP, sid);
    await settle();
    assert.equal(compactCalls(h).length, 0, '没超阈值不压');

    recordUsage(h, sid, 200_000, 0);
    h.v2TurnStartAt.set(sid, Date.now());
    h.maybeAutoCompact(GROUP, sid);
    await settle();
    assert.equal(compactCalls(h).length, 0, '会话正忙不压');
    h.v2TurnStartAt.delete(sid);

    h.setMode('chat');
    h.maybeAutoCompact(GROUP, sid);
    await settle();
    assert.equal(compactCalls(h).length, 0, '非二代模式不压');
  });

  await withHarness(async (h) => {
    const sid = await h.ensureSession(GROUP);
    recordUsage(h, sid, 900_000, 0);
    h.maybeAutoCompact(GROUP, sid);
    await settle();
    assert.equal(compactCalls(h).length, 0, '交给平台后桥接不压');
  }, { mode: 'agent' });
});

const CONSOLE = { 'x-console-token': 'fixture-console-token' };
function call(port, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { 'content-type': 'application/json', ...CONSOLE, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch {} resolve({ status: res.statusCode, json, body: data }); });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('③ 手动压缩接口只给控制台', async () => {
  await withHarness(async (h) => {
    await h.ensureSession(GROUP);
    const server = h.startConsoleServer();
    if (!server.listening) await new Promise((r) => server.once('listening', r));
    const port = server.address().port;
    try {
      const token = h.getSocialV2State(GROUP).agentToken;
      const byAgent = await call(port, '/api/session/compact', { method: 'POST', body: { key: GROUP }, headers: { 'x-agent-call': '1', 'x-agent-token': token } });
      assert.equal(byAgent.status, 403, 'AI 不能自己压缩');
      const ok = await call(port, '/api/session/compact', { method: 'POST', body: { key: GROUP } });
      assert.equal(ok.status, 200, ok.body);
      assert.equal(compactCalls(h).length, 1);
      const missing = await call(port, '/api/session/compact', { method: 'POST', body: { key: 'group:999' } });
      assert.equal(missing.status, 404);
    } finally { await new Promise((r) => server.close(r)); }
  });
});

test('④ 控制台改压缩方式：提前压缩（填几万）或交给 Agent 平台', async () => {
  assert.equal(COMPACT_THRESHOLD_MIN, 50_000);
  // 上限由平台申报点决定（dsh 申报 80 万），桥接自己不内置数字。
  assert.deepEqual(compactConfigFromConsole({}, { mode: 'early', thresholdWan: 40 }, { approxTokens: 800_000 }), { ...COMPACT_DEFAULTS, mode: 'early', thresholdTokens: 400_000 });
  assert.equal(compactConfigFromConsole({ thresholdTokens: 400_000 }, { mode: 'agent' }).mode, 'agent');
  assert.equal(compactConfigFromConsole({ thresholdTokens: 400_000 }, { mode: 'agent' }).thresholdTokens, 400_000, '交给平台时记住原来填的数');
  assert.equal(compactConfigFromConsole({}, { mode: 'early', thresholdWan: '' }, { approxTokens: 800_000 }).thresholdTokens, null, '留空 = 跟随平台申报点');
  for (const bad of [4, 81, 'abc', 0, -1]) assert.throws(() => compactConfigFromConsole({}, { mode: 'early', thresholdWan: bad }, { approxTokens: 800_000 }), /5～80 万/);
  // 平台没申报自动压缩点：只能自己定，下限仍是 5 万。
  assert.throws(() => compactConfigFromConsole({}, { mode: 'early', thresholdWan: 4 }, {}), /不能小于 5 万/);
  assert.throws(() => compactConfigFromConsole({}, { mode: 'later' }), /压缩方式/);

  await withHarness(async (h) => {
    const sid = await h.ensureSession(GROUP);
    recordUsage(h, sid, 420_000, 1_000);
    const server = h.startConsoleServer();
    if (!server.listening) await new Promise((r) => server.once('listening', r));
    const port = server.address().port;
    try {
      const got = await call(port, '/api/compact/config');
      assert.equal(got.status, 200, got.body);
      assert.deepEqual([got.json.mode, got.json.thresholdTokens, got.json.approxTokens], ['early', 100_000, 800_000]);
      assert.equal(got.json.sessions.find((x) => x.key === GROUP).inputTokens, 421_000, '看得到每个会话上一步读了多少');

      const token = h.getSocialV2State(GROUP).agentToken;
      const byAgent = await call(port, '/api/compact/config', { method: 'POST', body: { mode: 'agent' }, headers: { 'x-agent-call': '1', 'x-agent-token': token } });
      assert.equal(byAgent.status, 403, 'AI 改不了');

      const set = await call(port, '/api/compact/config', { method: 'POST', body: { mode: 'early', thresholdWan: 50 } });
      assert.equal(set.status, 200, set.body);
      assert.equal(JSON.parse(fs.readFileSync(path.join(h.temp, 'config.json'), 'utf8')).compact.thresholdTokens, 500_000, '写进 config.json 的顶层 compact');
      h.maybeAutoCompact(GROUP, sid);
      await settle(30);
      assert.equal(compactCalls(h).length, 0, '42 万 < 新阈值 50 万：不压');

      const agent = await call(port, '/api/compact/config', { method: 'POST', body: { mode: 'agent' } });
      assert.equal(agent.json.mode, 'agent');
      recordUsage(h, sid, 780_000, 0);
      h.maybeAutoCompact(GROUP, sid);
      await settle(30);
      assert.equal(compactCalls(h).length, 0, '交给平台：桥接不提前压');

      const follow = await call(port, '/api/compact/config', { method: 'POST', body: { mode: 'early', thresholdWan: '' } });
      assert.equal(follow.json.thresholdTokens, null, '留空 = 跟随平台申报点');
      assert.equal(JSON.parse(fs.readFileSync(path.join(h.temp, 'config.json'), 'utf8')).compact.thresholdTokens, null);

      const bad = await call(port, '/api/compact/config', { method: 'POST', body: { mode: 'early', thresholdWan: 100 } });
      assert.equal(bad.status, 400);
      assert.match(bad.json.error, /5～80 万/);
    } finally { await new Promise((r) => server.close(r)); }
  });
});

test('⑤ 控制台：全局配置的「行为与模型」有上下文压缩卡片', () => {
  const html = readConsoleSource();
  // 卡片外壳由 pages/config/page.js 的 cardHtml({ id: 'section-compact-config' }) 生成，page.html 只留宿主。
  assert.match(html, /id="section-compact-config"|id: 'section-compact-config'/, '压缩卡片（JS 生成或静态）应存在');
  assert.match(html, /data-config-compact/);
  assert.match(html, /行为与模型/);
  // 控件已改成字段规格（compact.js 的 fieldsOf），源文件里不再有拼好的 input HTML；
  // 这里按规格字段断言：两种压缩方式、阈值下限固定 5 万、上限取平台申报点。
  assert.match(html, /name: 'compactMode'/);
  for (const v of ['early', 'agent']) assert.match(html, new RegExp(`value: '${v}'`), v);
  assert.match(html, /name: 'compactWan'[\s\S]*?min: 5[\s\S]*?max: pointWan/);
  assert.match(html, /approxTokens/);
  // 保存统一走页面保存栏：压缩卡导出 compactSection，不再有自己的保存按钮。
  assert.match(html, /export const compactSection/);
  assert.ok(!/compactSave/.test(html), '压缩卡不应再有自己的保存按钮');
  // 运行总览不再保留压缩卡（整块已搬到全局配置）。
  assert.ok(!/id="section-compact"/.test(html), '总览不应再有上下文压缩卡');
});
