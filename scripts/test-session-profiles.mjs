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
      assert.equal(got.json.behavior, 'inherit');
      assert.equal(got.json.effectiveMode, 'chat');
      assert.equal(got.json.access.passive, 'allow');
      assert.equal(got.json.access.passiveMode, 'allow');
      assert.equal(got.json.access.proactive, 'allow');
      assert.equal(typeof got.json.prompt.maxChars, 'number');
      // `presets` 与顶层 `apply` 已从读口移除：能力档的生效方式随每一项 `capabilities[]` 下发。
      assert.equal(got.json.presets, undefined, '读口不再下发 presets');
      assert.equal(got.json.apply, undefined, '读口不再下发顶层 apply');
      assert.equal(got.json.dsh, undefined, '执行体字段统一叫 health');
      assert.equal(got.json.health.status, 'online');
      assert.equal(got.json.model, null, '会话没选模型就是 null');
      // 会话没选时生效值来自平台配置的现价，不再拿 deepseek-* 写死当兜底。
      assert.deepEqual(got.json.effectiveModel, { provider: 'deepseek-official', model: 'deepseek-flash', reasoning: 'max' });
      const active = got.json.capabilities.find((item) => item.id === got.json.defaultCapability);
      assert.ok(active, '默认能力档必须出现在 capabilities[] 里');
      assert.equal(active.isDefault, true, '默认能力档由 isDefault 标出');
      assert.equal(typeof active.apply, 'string', '每一项带自己的生效方式');
      assert.equal(got.json.capabilities.filter((item) => item.isDefault).length, 1, '只有一项是默认能力档');

      const list = await call(port, '/api/sessions', { headers: ADMIN });
      const row = list.json.sessions.find((item) => item.key === KEY);
      assert.ok(row, '列表必须包含并集行');
      assert.equal(row.hasProfile, true);
      assert.equal(row.sessionId, sessionId);
    });
  } finally { await h.close(); }
});

test('profile：PATCH 保存准入/人格/提示词并落盘', async () => {
  const h = await bridgeHarness();
  try {
    await h.ensureSession(KEY);
    await withServer(h, async (port) => {
      const patched = await call(port, `/api/sessions/${ENCODED}/profile`, {
        method: 'PATCH', headers: ADMIN,
        body: {
          access: { passive: 'deny', proactive: 'allow' },
          persona: { mode: 'card', name: '测试角色' },
          prompt: { text: '这是测试提示词。' },
        },
      });
      assert.equal(patched.status, 200, JSON.stringify(patched.json));
      assert.equal(patched.json.ok, true);

      const got = await call(port, `/api/sessions/${ENCODED}/profile`, { headers: ADMIN });
      assert.equal(got.json.access.passive, 'deny');
      assert.equal(got.json.access.proactive, 'allow');
      assert.equal(got.json.persona.mode, 'card');
      assert.equal(got.json.persona.name, '测试角色');
      assert.equal(got.json.prompt.text, '这是测试提示词。');

      const file = JSON.parse(fs.readFileSync(`${h.temp}/state/sessions/qq/group/456.json`, 'utf8'));
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
      const renamed = await call(port, `/api/sessions/${ENCODED}/profile`, {
        method: 'PATCH', headers: ADMIN, body: { displayName: 'x'.repeat(61) },
      });
      assert.equal(renamed.status, 400, '显示名只有一个写口：/api/session/rename');
      const asAgent = { ...ADMIN, 'x-agent-token': 'fixture-agent-token', 'x-agent-call': '1' };
      const read = await call(port, `/api/sessions/${ENCODED}/profile`, { headers: asAgent });
      assert.equal(read.status, 403, 'agent token 读档案必须 403');
      const write = await call(port, `/api/sessions/${ENCODED}/profile`, { method: 'PATCH', headers: asAgent, body: { prompt: { text: 'AI 改的' } } });
      assert.equal(write.status, 403, 'agent token 改档案必须 403');
      assert.equal(h.state.profiles[KEY].displayName ?? '', '', '被拒的请求不得改动任何字段');
    });
  } finally { await h.close(); }
});

test('profile：模型目录不可用时按原值保存并回 warning', async () => {
  const h = await bridgeHarness();
  try {
    await h.ensureSession(KEY);
    await withServer(h, async (port) => {
      // 夹具里的模型目录恒不可用：目录读不到是环境问题，不是选择错误，不能把请求打回 400。
      const model = { provider: 'fixture-provider', model: 'fixture-model', reasoning: 'high' };
      const patched = await call(port, `/api/sessions/${ENCODED}/profile`, { method: 'PATCH', headers: ADMIN, body: { model } });
      assert.equal(patched.status, 200, JSON.stringify(patched.json));
      assert.deepEqual(patched.json.warnings, ['模型未校验：目录不可用']);
      assert.deepEqual(patched.json.profile.model, model);

      const got = await call(port, `/api/sessions/${ENCODED}/profile`, { headers: ADMIN });
      assert.deepEqual(got.json.model, model, '目录不可用也要按原值落盘');
      // 生效值取会话值：选了模型就不该再落到平台默认。
      assert.equal(got.json.effectiveModel.provider, model.provider);
      assert.equal(got.json.effectiveModel.model, model.model);

      const cleared = await call(port, `/api/sessions/${ENCODED}/profile`, { method: 'PATCH', headers: ADMIN, body: { model: null } });
      assert.equal(cleared.status, 200);
      assert.equal(cleared.json.warnings, undefined, '跟随平台默认不需要 warning');
      assert.equal(cleared.json.profile.model, null);
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
