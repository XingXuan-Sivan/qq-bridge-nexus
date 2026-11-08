// 会话档案（profile）端点：列表并集、读改、校验、agent 隔离、删除档案不动绑定。
// 全部离线：bridgeHarness 起 VM + 内存夹具，HTTP 用 startConsoleServer。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { test } from 'node:test';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const KEY = 'qq:group:456';
const ENCODED = encodeURIComponent(KEY);
const ADMIN = { 'x-console-token': 'fixture-console-token' };

function call(port, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path: pathname, method, headers: { 'content-type': 'application/json', ...headers } },
      (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch { json = { raw: data }; }
          resolve({ status: response.statusCode, json });
        });
      },
    );
    request.setTimeout(5000, () => request.destroy(new Error(`timeout ${method} ${pathname}`)));
    request.on('error', reject);
    if (body !== undefined) request.write(JSON.stringify(body));
    request.end();
  });
}

async function withServer(h, run) {
  const server = h.startConsoleServer();
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  try { await run(server.address().port); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('profile：无档案 404；建绑后返回默认档案与并集列表', async () => {
  const h = await bridgeHarness();
  try {
    await withServer(h, async (port) => {
      const missingKey = encodeURIComponent('qq:group:999');
      const missing = await call(port, `/api/sessions/${missingKey}/profile`, { headers: ADMIN });
      assert.equal(missing.status, 404, '未绑定且无档案必须 404');

      const sessionId = await h.ensureSession(KEY);
      // 新夹具默认是黑名单空名单：没有显式名单时两根轴都允许。
      const got = await call(port, `/api/sessions/${ENCODED}/profile`, { headers: ADMIN });
      assert.equal(got.status, 200);
      assert.equal(got.json.key, KEY);
      assert.equal(got.json.sessionId, sessionId);
      assert.equal(got.json.mode, 'inherit');
      assert.equal(got.json.access.passive, 'allow');
      assert.equal(got.json.access.passiveMode, 'allow');
      assert.equal(got.json.access.proactive, 'allow');
      assert.equal(typeof got.json.prompt.maxChars, 'number');
      assert.ok(Array.isArray(got.json.presets));
      assert.equal(got.json.dsh.status, 'online');

      const list = await call(port, '/api/sessions', { headers: ADMIN });
      const row = list.json.sessions.find((item) => item.key === KEY);
      assert.ok(row, '列表必须包含并集行');
      assert.equal(row.hasProfile, true);
      assert.equal(row.sessionId, sessionId);
    });
  } finally { await h.close(); }
});

test('profile：PATCH 保存显示名/准入/人格/提示词并落盘', async () => {
  const h = await bridgeHarness();
  try {
    await h.ensureSession(KEY);
    await withServer(h, async (port) => {
      const patched = await call(port, `/api/sessions/${ENCODED}/profile`, {
        method: 'PATCH', headers: ADMIN,
        body: {
          displayName: '测试群',
          access: { passive: 'deny', proactive: 'allow' },
          persona: { mode: 'card', name: '测试角色' },
          prompt: { text: '这是测试提示词。' },
        },
      });
      assert.equal(patched.status, 200, JSON.stringify(patched.json));
      assert.equal(patched.json.ok, true);

      const got = await call(port, `/api/sessions/${ENCODED}/profile`, { headers: ADMIN });
      assert.equal(got.json.displayName, '测试群');
      assert.equal(got.json.access.passive, 'deny');
      assert.equal(got.json.access.proactive, 'allow');
      assert.equal(got.json.persona.mode, 'card');
      assert.equal(got.json.persona.name, '测试角色');
      assert.equal(got.json.prompt.text, '这是测试提示词。');

      const file = JSON.parse(fs.readFileSync(`${h.temp}/state/sessions/qq/group/456.json`, 'utf8'));
      assert.equal(file.displayName, '测试群');
      assert.equal(file.access, undefined, '档案里不再保存三态准入');
      assert.equal(file.persona.name, '测试角色');
      assert.equal(file.prompt.initialText, '这是测试提示词。');
      const defaults = JSON.parse(fs.readFileSync(`${h.temp}/state/sessions/defaults.json`, 'utf8')).defaults;
      assert.ok(!defaults.passive.entries.includes(KEY), 'deny 应把会话从被动白名单移除');
      assert.ok(defaults.proactive.entries.includes(KEY), 'allow 应把会话留在主动白名单');
    });
  } finally { await h.close(); }
});

test('profile：非法值与越权都被拒，且不改变已存内容', async () => {
  const h = await bridgeHarness();
  try {
    await h.ensureSession(KEY);
    await withServer(h, async (port) => {
      for (const body of [
        { access: { passive: 'nope' } },
        { mode: 'closed-agent' },
        { presetId: 'not-in-list' },
        { prompt: { text: 'y'.repeat(99999) } },
      ]) {
        const res = await call(port, `/api/sessions/${ENCODED}/profile`, { method: 'PATCH', headers: ADMIN, body });
        assert.equal(res.status, 400, `非法 PATCH 必须 400：${JSON.stringify(body)}`);
      }
      const longName = await call(port, `/api/sessions/${ENCODED}/profile`, {
        method: 'PATCH', headers: ADMIN, body: { displayName: 'x'.repeat(61) },
      });
      assert.equal(longName.status, 200, '超长显示名应截断而不是报错');
      assert.equal(longName.json.profile.displayName, 'x'.repeat(60));
      const asAgent = { ...ADMIN, 'x-agent-token': 'fixture-agent-token', 'x-agent-call': '1' };
      const read = await call(port, `/api/sessions/${ENCODED}/profile`, { headers: asAgent });
      assert.equal(read.status, 403, 'agent token 读档案必须 403');
      const write = await call(port, `/api/sessions/${ENCODED}/profile`, { method: 'PATCH', headers: asAgent, body: { displayName: 'AI 改的' } });
      assert.equal(write.status, 403, 'agent token 改档案必须 403');
      assert.equal(h.state.profiles[KEY].displayName, 'x'.repeat(60), '被拒的请求不得改动其它字段，只有长名被截断');
    });
  } finally { await h.close(); }
});

test('profile：DELETE 只删档案，绑定与列表行保留', async () => {
  const h = await bridgeHarness();
  try {
    const sessionId = await h.ensureSession(KEY);
    await withServer(h, async (port) => {
      const dropped = await call(port, `/api/sessions/${ENCODED}/profile`, { method: 'DELETE', headers: ADMIN });
      assert.equal(dropped.status, 200);
      assert.equal(dropped.json.key, KEY);
      const after = await call(port, `/api/sessions/${ENCODED}/profile`, { headers: ADMIN });
      assert.equal(after.status, 200, '只有绑定、无档案时返回默认档案');
      assert.equal(after.json.sessionId, sessionId);
      assert.equal(after.json.displayName, null);
      assert.equal(h.sessions.get(KEY), sessionId, '绑定不得被删');

      const list = await call(port, '/api/sessions', { headers: ADMIN });
      const row = list.json.sessions.find((item) => item.key === KEY);
      assert.ok(row, '绑定仍在，列表仍须出现该会话');
      assert.equal(row.hasProfile, false);

      const patchGone = await call(port, `/api/sessions/${ENCODED}/profile`, { method: 'PATCH', headers: ADMIN, body: { displayName: 'x' } });
      assert.equal(patchGone.status, 404, '无档案时 PATCH 必须 404');
      const deleteGone = await call(port, `/api/sessions/${ENCODED}/profile`, { method: 'DELETE', headers: ADMIN });
      assert.equal(deleteGone.status, 404, '重复删档必须 404');
    });
  } finally { await h.close(); }
});
