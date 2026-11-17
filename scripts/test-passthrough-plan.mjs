// 直通运行期（§7）：不装预设、提示注入四通道、能力档钉对端权限档，
// 以及「会话详情 › 执行体与权限」「会话档案保存」两个端点。
//
// 这里钉的是**直通的承诺**：直通只做追加（提示注入、会话编排），不装预设；
// 需要沙箱与审批的档位只在建会话时钉一次对端权限档。任何一条被「顺手恢复」成
// 装预设或每轮回钉，都会在这里红。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const PRIVATE = 'qq:private:123';
const GROUP = 'qq:group:456';
const CONSOLE = { 'x-console-token': 'fixture-console-token' };
const DIRECT = { capability: 'direct' };

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
  narrow: []
preset:
  name: 直通 · 工具拉取
  description: 测试用
  order: 21
  behavior: none
rows: []
`;

// 声明了对端权限档的直通档：建会话时必须把它钉下去。
const PIN_CAPABILITY = `version: 1
id: pt-pin
label: 直通 · 钉档
note: 测试用：建会话时钉对端权限档
tools:
  platform: {}
  agent:
    host: true
  mcp: []
  skills: []
runtime:
  apply: passthrough
  prompt: none
  peerPermission: workspace-write
  narrow: []
rows: []
`;
const PIN_FILE = { 'profiles/agent-platforms/dsh/capabilities/pt-pin.yml': PIN_CAPABILITY };

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
  const h = await bridgeHarness({ files: PROMPT_FILE });
  try {
    h.state.profiles[PRIVATE] = { ...DIRECT };
    await h.ensureSession(PRIVATE);

    assert.equal(h.runtimeOf(PRIVATE).apply, 'passthrough');
    assert.equal(h.runtimeOf(PRIVATE).peerPermission, '', '直通不钉对端权限档');

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
  const h = await bridgeHarness({ files: PROMPT_FILE });
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

test('tool 通道：完全不带平台话术，靠模型自己调 admin（op=get_prompt）', async () => {
  const h = await bridgeHarness({
    files: { 'profiles/agent-platforms/dsh/capabilities/pt-tool.yml': TOOL_CAPABILITY },
  });
  try {
    h.state.profiles[PRIVATE] = { capability: 'pt-tool' };
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

test('能力档钉对端权限档：建会话时钉一次并记基线，回执不符就丢弃这条会话', async () => {
  const h = await bridgeHarness({ files: PIN_FILE });
  try {
    h.state.profiles[PRIVATE] = { capability: 'pt-pin' };
    await h.ensureSession(PRIVATE);
    const mirror = h.state.profiles[PRIVATE].permissionMirror;
    assert.equal(mirror?.preset, 'workspace-write', '钉成功要把实际档位记成基线');
    assert.ok(mirror.at > 0);
    assert.ok(h.calls.commands.some((c) => c.line.trim() === '/permission workspace-write'), '钉的动作就是那条命令');
    assert.ok(h.ext.audit.tail(20).some((e) => e.event === 'permission.pin'));

    // 对端回执说「preset read-only」：与能力档要求不符 ⇒ 失败，且不得把假档位记成基线。
    h.api.commands.execute = async () => ({
      result: { ok: true, value: { commandId: 'c', result: { kind: 'success', text: 'preset read-only' } } }
    });
    h.state.profiles[GROUP] = { capability: 'pt-pin' };
    await assert.rejects(() => h.ensureSession(GROUP), /对端权限档设置失败/);
    assert.equal(h.state.profiles[GROUP].permissionMirror, undefined, '失败不能记基线');
    assert.ok(!h.sessions.get(GROUP), '钉不上的会话必须丢掉');
    assert.ok(h.ext.audit.tail(20).some((e) => e.event === 'permission.pin_failed'));
  } finally {
    await h.close();
  }
});

test('GET /api/sessions/:key/agent：直通给能力档的生效方式，对端权限档不钉就不读', async () => {
  const h = await bridgeHarness();
  try {
    h.state.profiles[PRIVATE] = { ...DIRECT };
    await h.ensureSession(PRIVATE);

    await withServer(h, async (port) => {
      const res = await call(port, sessionPath('/agent'));
      assert.equal(res.status, 200, res.body);
      const payload = res.json;
      assert.equal(payload.ok, true);
      assert.equal(payload.sessionId, h.sessions.get(PRIVATE));
      assert.equal(payload.instanceForeign, false);
      assert.equal(payload.agentPlatform.id, 'dsh');

      assert.equal(payload.capability.id, 'direct');
      assert.equal(payload.capability.apply, 'passthrough');
      assert.equal(payload.capability.prompt, 'system');
      assert.equal(payload.capability.peerPermission, '', '直通不要求对端权限档');
      assert.equal(payload.behavior, 'none');

      assert.equal(payload.promptChannel.requested, 'system');
      assert.equal(payload.promptChannel.channel, 'prefix');

      // 权限段：级别是档案值（inherit = 跟随全局默认），对端那一档只读展示。
      const permission = payload.permission;
      assert.equal(permission.value, 'inherit');
      assert.equal(permission.effective, 'read-only', '没设级别就跟随全局默认');
      assert.deepEqual(
        permission.options.map((item) => item.value),
        ['inherit', 'read-only', 'workspace-write', 'full-ask', 'full'],
      );
      assert.equal(permission.peerPermission, '');
      assert.equal(permission.peerPin, null, '没钉过就没有基线');
      assert.equal(permission.peer, null, '不钉档就不去读对端');
      assert.deepEqual(h.calls.commands.map((item) => item.line.trim()), [], '读详情不发任何命令');

      // 档案没选能力档就落到 Agent 平台申报的默认档；那一档也不要求对端权限档。
      h.state.profiles[GROUP] = { behavior: 'none' };
      const chat = await call(port, `/api/sessions/${encodeURIComponent(GROUP)}/agent`);
      assert.equal(chat.status, 200, chat.body);
      assert.ok(chat.json.capability, '没选档也会有平台默认档');
      assert.equal(chat.json.capability.peerPermission, '');
      assert.equal(chat.json.permission.value, 'inherit');
      assert.equal(chat.json.permission.effective, 'read-only', '没设级别就跟随全局默认');

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

test('PATCH /api/sessions/:key/profile：级别只改过滤档，能力档可随时换（换了连对端档都不再要）', async () => {
  const h = await bridgeHarness();
  try {
    h.state.profiles[PRIVATE] = { ...DIRECT };
    await h.ensureSession(PRIVATE);

    await withServer(h, async (port) => {
      const bad = await call(port, sessionPath('/profile'), { method: 'PATCH', body: { permission: 'L2' } });
      assert.equal(bad.status, 400, '级别只有四项固定取值，旧的级别名一律不接');
      assert.match(bad.json.error, /权限级别无效/);

      const ok = await call(port, sessionPath('/profile'), { method: 'PATCH', body: { permission: 'full-ask' } });
      assert.equal(ok.status, 200, ok.body);
      assert.equal(ok.json.profile.permission, 'full-ask');
      assert.equal(ok.json.permission.value, 'full-ask');
      assert.equal(ok.json.permission.effective, 'full-ask');
      assert.equal(h.state.profiles[PRIVATE].permissionMirror, null, '改级别不碰对端权限档');

      // 换能力档就是换执行体环境：换档不改级别，级别留在这里等用户自己改。
      const plain = await call(port, sessionPath('/profile'), { method: 'PATCH', body: { capability: '' } });
      assert.equal(plain.status, 200, plain.body);
      assert.equal(plain.json.profile.capability, null, '清空 = 跟随平台默认档');
      assert.equal(plain.json.permission.value, 'full-ask', '换档不动级别');
      assert.equal(plain.json.permission.peerPermission, '', '平台默认档不要求对端权限档');

      // 没建档的会话不接 PATCH：先建会话，再谈改什么都没意义。
      const missing = await call(port, `/api/sessions/${encodeURIComponent('qq:private:999')}/profile`, { method: 'PATCH', body: { permission: 'full' } });
      assert.equal(missing.status, 404);
    });
  } finally {
    await h.close();
  }
});
