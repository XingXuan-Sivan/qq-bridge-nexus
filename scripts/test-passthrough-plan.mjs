// 直通运行期（§7）：不装预设、提示注入四通道、权限档代改后的回读与漂移、
// 以及「会话详情 › 执行体与权限」两个端点（§7.6）。
//
// 这里钉的是**直通的承诺**：直通只做追加（提示注入、会话编排），不碰执行体的
// 预设 / 沙箱 / 权限档。任何一条被「顺手恢复」成装预设或回钉，都会在这里红。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const PRIVATE = 'qq:private:123';
const GROUP = 'qq:group:456';
const CONSOLE = { 'x-console-token': 'fixture-console-token' };
const DIRECT = { planId: 'direct', mode: 'inherit' };

// 只有一条「完全不带」的能力档：用来验证 `tool` 通道不是 `none` 的别名。
const TOOL_CAPABILITY = `version: 1
id: pt-tool
label: 直通 · 工具拉取
note: 测试用：提示词只靠 qq_get_prompt
tools:
  platform: {}
  agent:
    host: true
  mcp: []
  skills:
    - '*'
runtime:
  apply: passthrough
  prompt: tool
  permission: agent
  narrow: []
preset:
  name: 直通 · 工具拉取
  description: 测试用
  order: 21
  behavior: none
rows: []
`;

const TOOL_PLAN = { id: 'pt-tool', label: '直通 · 工具拉取', capability: 'pt-tool', audience: 'owner' };

// 夹具只抄平台声明，不抄平台话术（那份是给人改的内容）。用到话术的两条用例自己给一份，
// 否则 `platformPromptFor` 读不到文件会退回空串，前缀通道的断言就变成了「断言空串」。
const PROMPT_FILE = { 'profiles/platforms/qq/prompt.md': '【测试平台话术】在 QQ 里用工具说话。\n' };

function call(port, pathname, { method = 'GET', headers = {}, body, token } = {}) {
  const h = { 'content-type': 'application/json', ...CONSOLE, ...headers };
  if (token) h['x-agent-token'] = token;
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: h }, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: response.statusCode, json, body: data });
      });
    });
    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('request hung')));
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function withServer(h, run) {
  const server = h.startConsoleServer();
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  try { await run(server.address().port); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

const sessionPath = (suffix) => `/api/sessions/${encodeURIComponent(PRIVATE)}${suffix}`;

test('直通建会话：不挂 preset，system 通道降级为首轮前缀并只记一条审计', async () => {
  const h = await bridgeHarness({ config: { runtime: { defaultPlan: 'direct' } }, files: PROMPT_FILE });
  try {
    h.state.profiles[PRIVATE] = { ...DIRECT };
    await h.ensureSession(PRIVATE);

    assert.equal(h.runtimeOf(PRIVATE).apply, 'passthrough');
    assert.equal(h.permissionAuthorityOf(PRIVATE), 'agent', '直通下权限档归执行体');

    const created = h.calls.created.at(-1);
    assert.ok(created, '建了会话');
    assert.equal(created.agentPreset, undefined, '直通不向执行体装预设');
    assert.equal(created.systemPrompt, undefined, 'DSH 没有 system 通道：降级后不能往 create 里塞');

    const resolved = h.promptChannelOf(PRIVATE);
    assert.equal(resolved.requested, 'system');
    assert.equal(resolved.channel, 'prefix', '没有 system 通道就降到首轮前缀');
    assert.equal(resolved.degraded, true);
    assert.match(resolved.reason, /dsh/, '降级理由要点名执行体');

    const degrades = () => h.ext.audit.tail(200).filter((e) => e.event === 'passthrough_degraded').length;
    assert.equal(degrades(), 1, '建会话时记一条降级审计');
    h.promptChannelOf(PRIVATE);
    h.platformPromptTextFor(PRIVATE);
    assert.equal(degrades(), 1, '降级是静态事实：重复解析不再刷审计');
    assert.equal(h.calls.created.length, 1, '没有因为解析通道而额外建会话');
  } finally {
    await h.close();
  }
});

test('prefix 通道：首轮带一次平台话术，重建会话后重新带', async () => {
  const h = await bridgeHarness({ config: { runtime: { defaultPlan: 'direct' } }, files: PROMPT_FILE });
  try {
    h.state.profiles[PRIVATE] = { ...DIRECT };
    const sessionId = await h.ensureSession(PRIVATE);

    const first = h.platformPromptTextFor(PRIVATE);
    assert.ok(first.length > 0, '首轮要把平台话术带进去');
    assert.equal(h.promptInjectedFor(PRIVATE), false, '还没投递，不算带过');

    h.markPromptInjected(PRIVATE, sessionId);
    assert.equal(h.promptInjectedFor(PRIVATE), true);
    assert.equal(h.platformPromptTextFor(PRIVATE), '', '带过的会话不再重复注入');

    // 对端会话换了（重建/自愈）：旧的「带过」记录不适用于新会话，要再带一次。
    h.sessions.bindSession(PRIVATE, 'fixture-rebuilt');
    assert.equal(h.promptInjectedFor(PRIVATE), false);
    assert.equal(h.platformPromptTextFor(PRIVATE), first);
  } finally {
    await h.close();
  }
});

test('tool 通道：完全不带平台话术，靠模型自己调 qq_get_prompt', async () => {
  const h = await bridgeHarness({
    config: { runtime: { defaultPlan: 'pt-tool' } },
    plans: [TOOL_PLAN],
    files: { 'profiles/agent-platforms/dsh/capabilities/pt-tool.yml': TOOL_CAPABILITY },
  });
  try {
    h.state.profiles[PRIVATE] = { planId: 'pt-tool', mode: 'inherit' };
    assert.equal(h.runtimeOf(PRIVATE).apply, 'passthrough');
    assert.equal(h.runtimeOf(PRIVATE).prompt, 'tool');

    const resolved = h.promptChannelOf(PRIVATE);
    assert.equal(resolved.channel, 'tool');
    assert.equal(resolved.degraded, false, 'tool 是被认领的通道，不算降级');
    assert.equal(h.platformPromptTextFor(PRIVATE), '', 'tool 通道不注入');
    assert.equal(h.promptInjectedFor(PRIVATE), false, '不从唤醒块注入就不该记「带过」');
  } finally {
    await h.close();
  }
});

test('权限代改：写后回读一致才算成功，不一致时报错且不覆盖基线', async () => {
  const h = await bridgeHarness({ config: { runtime: { defaultPlan: 'direct' } } });
  try {
    h.state.profiles[PRIVATE] = { ...DIRECT };
    await h.ensureSession(PRIVATE);

    const ok = await h.applySessionPermission(PRIVATE, 'workspace-write', { reason: 'console' });
    assert.equal(ok.ok, true);
    assert.equal(ok.preset, 'workspace-write');
    const mirror = h.state.profiles[PRIVATE].permissionMirror;
    assert.equal(mirror.preset, 'workspace-write', '写成功要记下基线');
    assert.ok(mirror.at > 0);
    assert.ok(h.ext.audit.tail(20).some((e) => e.event === 'permission.change'));

    // 夹具的对端回读恒为 workspace-write：写别的档位立刻变成「写了但没生效」。
    const failed = await h.applySessionPermission(PRIVATE, 'read-only', { reason: 'console' });
    assert.equal(failed.ok, false);
    assert.equal(failed.current, 'workspace-write');
    assert.match(failed.error, /workspace-write/);
    assert.equal(h.state.profiles[PRIVATE].permissionMirror.preset, 'workspace-write', '失败不能污染基线');
    assert.ok(h.ext.audit.tail(20).some((e) => e.event === 'permission.write_failed'));
  } finally {
    await h.close();
  }
});

test('GET /api/sessions/:key/agent：直通下给对端档位、过滤免审批档并标出漂移', async () => {
  const h = await bridgeHarness({ config: { runtime: { defaultPlan: 'direct' } } });
  try {
    h.state.profiles[PRIVATE] = { ...DIRECT };
    await h.ensureSession(PRIVATE);

    await withServer(h, async (port) => {
      let res = await call(port, sessionPath('/agent'));
      assert.equal(res.status, 200, res.body);
      const payload = res.json;
      assert.equal(payload.ok, true);
      assert.equal(payload.sessionId, h.sessions.get(PRIVATE));
      assert.equal(payload.instanceForeign, false);
      assert.equal(payload.agentPlatform.id, 'dsh');

      assert.equal(payload.plan.id, 'direct');
      assert.equal(payload.plan.apply, 'passthrough');
      assert.equal(payload.plan.authority, 'agent');
      assert.equal(payload.plan.prompt, 'system');
      assert.equal(payload.capability.id, 'direct');

      assert.equal(payload.promptChannel.requested, 'system');
      assert.equal(payload.promptChannel.channel, 'prefix');

      const permission = payload.permission;
      assert.equal(permission.authority, 'agent');
      assert.equal(permission.readable, true);
      assert.equal(permission.current, 'workspace-write');
      assert.deepEqual(permission.options.map((item) => item.value), ['read-only', 'workspace-write', 'qq-full-ask'], '免审批档不列');
      assert.equal(permission.mirror, null, '没代改过就没有基线');
      assert.equal(permission.drift, null);

      // 基线在、对端又对不上 ⇒ 报漂移；但桥接**不能**自动改回（改回是用户点按钮的事）。
      h.state.profiles[PRIVATE].permissionMirror = { preset: 'qq-full-ask', at: 111 };
      const commandsBefore = h.calls.commands.length;
      res = await call(port, sessionPath('/agent'));
      assert.equal(res.status, 200);
      assert.deepEqual(res.json.permission.drift, { expected: 'qq-full-ask', actual: 'workspace-write', at: 111 });
      const added = h.calls.commands.slice(commandsBefore).map((item) => item.line);
      assert.ok(added.every((line) => line.trim() === '/permission'), `读详情只查询、不写档：${added.join(' | ')}`);
      assert.equal(h.state.profiles[PRIVATE].permissionMirror.preset, 'qq-full-ask', '读详情不得改基线');

      // 会话不存在 ⇒ 404；带会话令牌 ⇒ 只允许控制台。
      const missing = await call(port, `/api/sessions/${encodeURIComponent('qq:group:999')}/agent`);
      assert.equal(missing.status, 404);
      const asAgent = await call(port, sessionPath('/agent'), { token: 'fixture-agent-token' });
      assert.equal(asAgent.status, 403, 'AI 不能读会话详情');
    });
  } finally {
    await h.close();
  }
});

test('POST /api/sessions/:key/permission：直通可代改，桥接权威下拒绝，免审批档一律不接', async () => {
  const h = await bridgeHarness({ config: { runtime: { defaultPlan: 'direct' } } });
  try {
    h.state.profiles[PRIVATE] = { ...DIRECT };
    await h.ensureSession(PRIVATE);
    // 桥接权威的会话：没有能力档 ⇒ runtime 段按缺省（permission: bridge）。
    h.state.profiles[GROUP] = { mode: 'inherit' };

    await withServer(h, async (port) => {
      const groupPath = `/api/sessions/${encodeURIComponent(GROUP)}/permission`;

      const bridgeOwned = await call(port, groupPath, { method: 'POST', body: { preset: 'read-only' } });
      assert.equal(bridgeOwned.status, 409, '桥接权威下不接这个写口');
      assert.match(bridgeOwned.json.error, /权限级别/);

      const forbidden = await call(port, sessionPath('/permission'), { method: 'POST', body: { preset: 'danger-full-access' } });
      assert.equal(forbidden.status, 403);
      assert.match(forbidden.json.error, /不弹审批/);

      const empty = await call(port, sessionPath('/permission'), { method: 'POST', body: {} });
      assert.equal(empty.status, 400);

      const ok = await call(port, sessionPath('/permission'), { method: 'POST', body: { preset: 'workspace-write' } });
      assert.equal(ok.status, 200, ok.body);
      assert.equal(ok.json.permission.current, 'workspace-write');
      assert.equal(ok.json.permission.mirror, 'workspace-write', '写成功要回新的基线');
      assert.ok(ok.json.permission.setAt > 0);

      // 回读对不上 ⇒ 502，并把对端实际档位带回去（界面上要能解释为什么没成）。
      const failed = await call(port, sessionPath('/permission'), { method: 'POST', body: { preset: 'read-only' } });
      assert.equal(failed.status, 502);
      assert.equal(failed.json.current, 'workspace-write');
    });
  } finally {
    await h.close();
  }
});
