// AgentPort 契约（C5 / C6）：中立动词 + 能力位闸门 + DSH 适配器。
//
// 这条回归钉住六件事：
//   1. 能力缺失是 fail-closed 且**可诊断**：抛 `capability_unsupported`，
//      而不是让调用方撞上 `port.x is not a function`（那种错分不清平台不支持还是名字写错）；
//   2. 未声明的能力方法**仍然存在**（只是调用时抛错），`supports()` 能提前问；
//   3. `capabilities` 可以是**函数**（协商制平台用：ACP 的能力位来自 initialize 回执），
//      而且必须每次现算 —— 缓存下来会让「连接后获得的能力」永远不可用；
//   4. DSH 适配器把每个中立动词落到正确的 RPC 上，且**不判断策略**：
//      `applyPermission` 只交回已解包、未判定的回执，成功与否留给桥接的 permissionCommandSucceeded；
//   5. `prompt()` 返回**中立受理形状** `{ ok, isCommand, commandText, error, raw }`：
//      DSH 的 `{result:{ok,value,error}}` 信封不得泄漏给内核；
//   6. 声明面 `dsh.capabilities` 必须覆盖 port 能力位（否则控制台画出来的能力没有实现）；
//   7. ACP（C6 的第二实现）走同一套契约：能力位是**协商值**，声明面不多画 v1 里没有的
//      组，级别计划在模式名单对不上时 fail-closed 而不是降级到更宽的模式。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_PORT_CAPABILITIES,
  AGENT_PORT_CORE_METHODS,
  AGENT_PORT_GROUPS,
  AGENT_EVENT_KINDS,
  AgentCapabilityError,
  CAPABILITY_UNSUPPORTED,
  createAgentPort,
  isAgentEvent,
  methodCapabilityOf,
  normalizeSessionRef,
} from '../src/agent-side/port.mjs';
import { createDshPort, DSH_AGENT_CAPABILITIES } from '../src/agent-side/adapters/dsh/port.mjs';
import * as dshDeclaration from '../profiles/agent-platforms/dsh/adapters/runtime.mjs';
import { ACP_PORT_CAPABILITIES, createAcpPort } from '../src/agent-side/adapters/acp/port.mjs';
import * as acpDeclaration from '../profiles/agent-platforms/acp/adapters/runtime.mjs';
import { BUILTIN_AGENT_PLATFORMS } from '../src/agent-side/builtin.mjs';
import {
  registerAgentPlatform,
  unregisterAgentPlatform,
  useAgentPlatform,
} from '../src/agent-side/runtime-registry.mjs';
import { agentRuntime, resetAgentRuntime } from '../src/agent-side/runtime.mjs';

// ── 夹具 ────────────────────────────────────────────────────────────────────

/** 把值包成 DSH 的 RpcResponse 形状（unwrap 认得的那种）。 */
const ok = (value) => ({ result: { ok: true, value } });

/**
 * 假 RPC 客户端：记录每次调用，按需返回。
 *
 * `calls` 里存 `{ method, args }`，断言「中立动词落到了哪个平台方法」用它，
 * 比断言返回值更能钉住契约（返回值形状将来可能变）。
 */
function fakeClient(overrides = {}) {
  const calls = [];
  const record = (method, result) => async (...args) => {
    calls.push({ method, args });
    return typeof result === 'function' ? result(...args) : result;
  };
  const client = {
    settings: {
      describe: record('settings.describe', ok({ namespaces: [{ ns: 'agent-presets', values: { default: 'chat' } }] })),
      update: record('settings.update', ok({ applied: 1 })),
    },
    sessions: {
      list: record('sessions.list', ok({ items: [{ sessionId: 's1', title: 'T1', cwd: '/w', origin: 'bridge' }] })),
      create: record('sessions.create', ok({ sessionId: 's-new' })),
      prompt: record('sessions.prompt', { result: { ok: true, value: { accepted: true } } }),
      selectModel: record('sessions.selectModel', ok({ selected: { provider: 'p', model: 'm' } })),
    },
    workspace: {
      create: record('workspace.create', ok({ created: true, workspace: { workspaceId: 'w1' } })),
      rename: record('workspace.rename', {}),
      archiveSession: record('workspace.archiveSession', {}),
    },
    agentPresets: { list: record('agentPresets.list', ok({ presets: ['chat', 'readonly'] })) },
    permissionPresets: { catalog: record('permissionPresets.catalog', ok({ options: ['read-only', 'qq-full-ask'], defaultPreset: 'workspace-write' })) },
    commands: {
      execute: record('commands.execute', (_sessionId, line) => {
        // 斜杠命令回执：查询 / 压缩 / 设置三种形状不同，按 line 分流。
        if (line === '/permission') {
          return ok({ commandId: 'q1', result: { kind: 'success', text: 'current preset workspace-write' } });
        }
        if (line === '/compact') {
          return ok({ commandId: 'c1', result: { kind: 'success', text: '已压缩 12 条消息' } });
        }
        return ok({ changed: true });
      }),
    },
    respond: record('respond', {}),
    stopSessionWork: record('stopSessionWork', {}),
    callUnary: record('callUnary', (method) => {
      if (method === 'session.modelCatalog') return ok({ catalog: ['a'] });
      return ok({});
    }),
    ...overrides,
  };
  return { client, calls, of: (method) => calls.filter((c) => c.method === method) };
}

/** 一份最小可用实现（只满足核心方法）。 */
const coreOnly = () => ({
  probe: async () => ({ ok: true }),
  listSessions: async () => ({ sessions: [] }),
  ensureSession: async () => ({ sessionId: 's1' }),
  prompt: async () => ({}),
  cancel: async () => ({}),
});

// ── 契约本身 ────────────────────────────────────────────────────────────────

test('createAgentPort：缺 id / 缺实现 / 缺核心方法都直接抛', () => {
  assert.throws(() => createAgentPort({ impl: coreOnly() }), /缺少 id/);
  assert.throws(() => createAgentPort({ id: 'x' }), /缺少实现/);
  const impl = coreOnly();
  delete impl.prompt;
  assert.throws(() => createAgentPort({ id: 'x', impl }), /缺少核心方法 prompt/);
});

test('createAgentPort：声明面与 port 能力位同名，未知能力位直接拒', () => {
  assert.deepEqual([...AGENT_PORT_CAPABILITIES], Object.keys(AGENT_PORT_GROUPS));
  assert.deepEqual([...AGENT_PORT_CAPABILITIES], ['session', 'rename', 'permission', 'models', 'settings', 'workspace', 'compact', 'maintenance']);
  // 声明面里的每一组都必须是「声明了就有方法」的组，否则拼错一个字母会静默少一个能力。
  assert.throws(
    () => createAgentPort({ id: 'x', capabilities: ['sessions'], impl: coreOnly() }),
    /未知能力 sessions/,
  );
});

test('createAgentPort：未声明的能力调用抛 capability_unsupported，方法本身仍在', () => {
  const port = createAgentPort({ id: 'mini', capabilities: [], impl: { ...coreOnly(), healSession: async () => ({}) } });
  assert.deepEqual(port.supports(), []);
  assert.equal(port.supports('maintenance'), false);
  // 方法存在：报错能说清缺哪个能力，而不是 TypeError。同步抛（调用点一眼能看出是能力问题）。
  assert.equal(typeof port.healSession, 'function');
  assert.throws(() => port.healSession('s1'), (error) => {
    assert.ok(error instanceof AgentCapabilityError);
    assert.equal(error.code, CAPABILITY_UNSUPPORTED);
    assert.equal(error.capability, 'maintenance');
    assert.equal(error.method, 'healSession');
    assert.equal(error.agentPlatform, 'mini');
    return true;
  });
  // 声明了但没实现 —— 是装配错误，必须在建 port 时就炸。
  assert.throws(
    () => createAgentPort({ id: 'broken', capabilities: ['session'], impl: coreOnly() }),
    /声明了能力但没实现 session\.archiveSession/,
  );
});

test('createAgentPort：返回值冻结，核心方法与能力方法都在', () => {
  const port = createAgentPort({ id: 'full', impl: { ...coreOnly() }, capabilities: [] });
  assert.ok(Object.isFrozen(port));
  for (const name of AGENT_PORT_CORE_METHODS) assert.equal(typeof port[name], 'function', name);
  for (const methods of Object.values(AGENT_PORT_GROUPS)) {
    for (const name of methods) assert.equal(typeof port[name], 'function', name);
  }
  assert.throws(() => { port.probe = () => {}; }, TypeError);
});

test('createAgentPort：capabilities 可以是函数，且每次现算（协商制平台）', () => {
  // 模拟 ACP：进程启动时还没 initialize，能力集为空；协商完成后才有 models。
  let declared = [];
  const port = createAgentPort({
    id: 'acp:probe',
    capabilities: () => declared,
    impl: {
      ...coreOnly(),
      listModels: async () => ({ models: [] }),
      selectModel: async () => ({ selected: null }),
    },
  });

  assert.deepEqual(port.supports(), [], '连接前应当没有能力位');
  assert.equal(port.supports('models'), false);
  assert.throws(() => port.listModels(), (error) => {
    assert.equal(error.code, CAPABILITY_UNSUPPORTED);
    assert.equal(error.capability, 'models');
    return true;
  });

  declared = ['models'];
  // getter：拿到的是当前值，不是构造那一刻的快照。
  assert.deepEqual(port.capabilities, ['models']);
  assert.equal(port.supports('models'), true);
  assert.deepEqual(port.supports(), ['models']);
  // 同一个 port 对象，能力位从空到有 —— 这正是「协商后获得能力」的形态。
  return port.listModels().then((got) => assert.deepEqual(got, { models: [] }));
});

test('createAgentPort：函数形态的能力位也会做未知位与缺实现校验', () => {
  assert.throws(
    () => createAgentPort({ id: 'x', capabilities: () => ['sessions'], impl: coreOnly() }).supports(),
    /未知能力 sessions/,
  );
  assert.throws(
    () => createAgentPort({ id: 'x', capabilities: () => ['session'], impl: coreOnly() }).supports(),
    /声明了能力但没实现 session\.archiveSession/,
  );
});

test('会话引用归一：对象、裸字符串、空值', () => {
  assert.deepEqual(normalizeSessionRef('s1', 'dsh'), { instance: 'dsh', sessionId: 's1' });
  assert.deepEqual(normalizeSessionRef({ sessionId: 's2' }, 'dsh'), { instance: 'dsh', sessionId: 's2' });
  assert.deepEqual(normalizeSessionRef({ instance: 'acp:claude', sessionId: 's3' }, 'dsh'), { instance: 'acp:claude', sessionId: 's3' });
  assert.throws(() => normalizeSessionRef(''), /会话引用为空/);
  assert.throws(() => normalizeSessionRef({}), /缺少 sessionId/);
});

test('事件 kind 表与控制台诊断共用一份；methodCapabilityOf 反查', () => {
  assert.ok(AGENT_EVENT_KINDS.includes('turn-end'));
  assert.equal(isAgentEvent({ kind: 'turn-end' }), true);
  assert.equal(isAgentEvent({ kind: 'turn/end' }), false, 'DSH 的原始类型必须先归一');
  assert.equal(isAgentEvent(null), false);
  assert.equal(methodCapabilityOf('selectModel'), 'models');
  assert.equal(methodCapabilityOf('probe'), '');
  assert.equal(methodCapabilityOf('nope'), null);
});

// ── DSH 适配器 ──────────────────────────────────────────────────────────────

test('DSH：声明面覆盖 port 能力位（否则控制台画的能力没有实现）', () => {
  for (const capability of DSH_AGENT_CAPABILITIES) {
    assert.ok(dshDeclaration.capabilities.includes(capability), `声明面缺 ${capability}`);
  }
  // events 是非调用面，不该被当成 port 能力位。
  assert.equal(DSH_AGENT_CAPABILITIES.includes('events'), false);
  // compact 对应 `/compact`，是真实存在的平台操作，在榜上。
  assert.equal(DSH_AGENT_CAPABILITIES.includes('compact'), true);
  // 没有 maintenance：DSH 0.2.0 没有「重建/自愈会话」RPC，声明了会画出不存在的按钮。
  assert.equal(DSH_AGENT_CAPABILITIES.includes('maintenance'), false);
});

test('DSH：核心动词落到正确的 RPC 上', async () => {
  const { client, calls, of } = fakeClient();
  const port = createAgentPort({ id: 'dsh', capabilities: DSH_AGENT_CAPABILITIES, impl: createDshPort({ client }) });

  const probed = await port.probe();
  assert.equal(probed.ok, true);
  assert.equal(probed.version, '');

  const listed = await port.listSessions();
  assert.deepEqual(listed.sessions.map((s) => s.sessionId), ['s1']);
  assert.equal(listed.sessions[0].cwd, '/w');

  const created = await port.ensureSession({ workspaceId: 'w1', agentPreset: 'chat' });
  assert.equal(created.sessionId, 's-new');
  assert.deepEqual(of('sessions.create')[0].args[0], { workspaceId: 'w1', agentPreset: 'chat' });

  await port.prompt('s1', { content: [{ type: 'text', text: 'hi' }] });
  const promptArg = of('sessions.prompt')[0].args[0];
  assert.deepEqual(promptArg, { sessionId: 's1', mode: 'queue', content: [{ type: 'text', text: 'hi' }] });
  // requestId 只在给了的时候才出现：凭空生成一个会让 DSH 的幂等去重失效。
  await port.prompt({ sessionId: 's1' }, { content: [], requestId: 'r1' });
  assert.equal(of('sessions.prompt')[1].args[0].requestId, 'r1');

  await port.cancel({ instance: 'dsh', sessionId: 's9' });
  assert.equal(of('stopSessionWork')[0].args[0], 's9');

  assert.equal(calls.length > 0, true);
});

test('DSH：prompt 返回中立受理形状（平台信封不外泄）', async () => {
  const content = [{ type: 'text', text: 'hi' }];

  // 1. 受理：没有 command ⇒ isCommand=false，commandText 为空串。
  const { client } = fakeClient();
  const accepted = await createDshPort({ client }).prompt('s1', { content });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.isCommand, false);
  assert.equal(accepted.commandText, '');
  assert.equal(accepted.error, null);
  // raw 仍是平台原话：日志里要能看一眼真回执。
  assert.deepEqual(accepted.raw, { result: { ok: true, value: { accepted: true } } });
  assert.equal('result' in accepted, false, 'result 信封不得出现在中立形状里');

  // 2. 斜杠命令直通：command 存在即 isCommand=true，文本在 commandText。
  const { client: cmd } = fakeClient({
    sessions: { prompt: async () => ok({ command: { text: '/help 的输出' } }) },
  });
  const direct = await createDshPort({ client: cmd }).prompt('s1', { content });
  assert.equal(direct.ok, true);
  assert.equal(direct.isCommand, true);
  assert.equal(direct.commandText, '/help 的输出');

  // 3. 拒绝受理：不抛错（要走桥接的自愈路径），error 归一成 { code, message }。
  const { client: rejected } = fakeClient({
    sessions: { prompt: async () => ({ result: { ok: false, error: { code: 'session/not-found', message: 'gone' } } }) },
  });
  const refused = await createDshPort({ client: rejected }).prompt('s1', { content });
  assert.equal(refused.ok, false);
  assert.equal(refused.isCommand, false);
  assert.equal(refused.commandText, '');
  assert.deepEqual(refused.error, { code: 'session/not-found', message: 'gone' });

  // 4. 形状不认识：显式失败，不静默当成功。
  const { client: weird } = fakeClient({ sessions: { prompt: async () => ({}) } });
  const unknown = await createDshPort({ client: weird }).prompt('s1', { content });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'UNEXPECTED_RESPONSE');
});

test('DSH：prompt 的传输级失败照旧抛错（不是「平台拒绝受理」）', async () => {
  const { client } = fakeClient({
    sessions: { prompt: async () => { throw new Error('fetch failed'); } },
  });
  await assert.rejects(() => createDshPort({ client }).prompt('s1', { content: [] }), /fetch failed/);
});

test('DSH：探活失败不抛错（探活是查询，不是操作）', async () => {
  const { client } = fakeClient({
    settings: { describe: async () => ({ result: { ok: false, error: { code: 'unauthorized', message: 'bad cookie' } } }) },
  });
  const impl = createDshPort({ client });
  const probed = await impl.probe();
  assert.equal(probed.ok, false);
  assert.match(probed.detail, /bad cookie/);
});

test('DSH：会话 / 命名 / 归档 / preset 清单', async () => {
  const { client, of } = fakeClient();
  const impl = createDshPort({ client });

  await impl.renameSession('s1', 'QQ·群 123');
  assert.deepEqual(of('callUnary')[0].args, ['session.rename', { sessionId: 's1', title: 'QQ·群 123' }]);

  await impl.archiveSession('s1');
  assert.deepEqual(of('workspace.archiveSession')[0].args[0], { sessionId: 's1' });

  const presets = await impl.listPresets();
  assert.deepEqual(presets.presets, ['chat', 'readonly']);

  const catalog = await impl.listPermissionPresets();
  assert.deepEqual(catalog.options, ['read-only', 'qq-full-ask']);
  assert.equal(catalog.defaultPreset, 'workspace-write');
});

test('DSH：权限只转发不判定（策略归桥接）', async () => {
  const { client, of } = fakeClient();
  const approvals = new Map();
  const impl = createDshPort({ client, approvals });

  const applied = await impl.applyPermission('s1', 'workspace-write');
  assert.deepEqual(of('commands.execute')[0].args, ['s1', '/permission workspace-write']);
  // 不带 ok 字段 —— 判定留给 permissionCommandSucceeded；value 是解包后的回执，
  // raw 是平台原始响应（两者都交出去，是 port 的返回值约定）。
  assert.equal('ok' in applied, false);
  assert.deepEqual(applied.value, { changed: true });
  assert.deepEqual(applied.raw, { result: { ok: true, value: { changed: true } } });

  // 审批回执：内核只持有归一引用，DSH 要的 clientId + eventId 从挂起表取。
  approvals.set('e1', { clientId: 'c1', eventId: 'e1', sessionId: 's1', at: Date.now() });
  await impl.respondPermission({ sessionId: 's1', requestId: 'e1' }, 'allowed-once');
  assert.deepEqual(of('respond')[0].args[0], {
    clientId: 'c1',
    eventId: 'e1',
    outcome: { kind: 'result', value: 'allowed-once' },
  });
  assert.equal(approvals.has('e1'), false);
  // 提问回执同样是「原样送 value」。
  approvals.set('e2', { clientId: 'c1', eventId: 'e2', sessionId: 's1', at: Date.now() });
  await impl.respondPermission({ sessionId: 's1', requestId: 'e2' }, { answers: [{ id: 'q1', selected: ['是'] }] });
  assert.deepEqual(of('respond')[1].args[0].outcome.value, { answers: [{ id: 'q1', selected: ['是'] }] });
});

test('DSH：readPermission 只读核对当前预设，解不出时为空格', async () => {
  const { client, of } = fakeClient();
  const impl = createDshPort({ client });

  const got = await impl.readPermission('s1');
  assert.deepEqual(of('commands.execute')[0].args, ['s1', '/permission']);
  assert.equal(got.preset, 'workspace-write');
  assert.match(got.text, /current preset/);

  // 回执格式变了 / 认不出来：preset 给空串而不抛错，由调用方按 fail-closed 处理。
  const { client: odd } = fakeClient({
    commands: { execute: async () => ok({ commandId: 'q2', result: { kind: 'success', text: '??? ' } }) },
  });
  const weird = await createDshPort({ client: odd }).readPermission('s1');
  assert.equal(weird.preset, '');
  assert.equal(weird.text, '??? ');
});

test('DSH：compactSession 读回执 kind 与文案（失败不抛错）', async () => {
  const { client, of } = fakeClient();
  const impl = createDshPort({ client });

  const done = await impl.compactSession('s1');
  assert.deepEqual(of('commands.execute')[0].args, ['s1', '/compact']);
  assert.equal(done.ok, true);
  assert.equal(done.kind, 'success');
  assert.match(done.text, /已压缩/);

  const { client: failing } = fakeClient({
    commands: { execute: async () => ok({ commandId: 'c2', result: { kind: 'error', text: '会话正在运行' } }) },
  });
  const busy = await createDshPort({ client: failing }).compactSession('s1');
  assert.equal(busy.ok, false);
  assert.equal(busy.kind, 'error');
  assert.equal(busy.text, '会话正在运行');
});

test('DSH：缺 commands.execute 时 applyPermission 明确报能力缺失', async () => {
  const { client } = fakeClient({ commands: undefined });
  const impl = createDshPort({ client });
  await assert.rejects(() => impl.applyPermission('s1', 'read-only'), (error) => {
    assert.equal(error.code, CAPABILITY_UNSUPPORTED);
    assert.equal(error.method, 'applyPermission');
    return true;
  });
});

test('DSH：respondPermission 没有挂起请求或引用不全就报错（回执发不出去会一直挂到超时）', async () => {
  const { client } = fakeClient();
  const impl = createDshPort({ client });
  await assert.rejects(
    () => impl.respondPermission({ sessionId: 's1', requestId: 'e-missing' }, 'rejected'),
    /没有挂起的请求/,
  );
  await assert.rejects(() => impl.respondPermission({ sessionId: 's1' }, 'rejected'), /缺少 requestId/);
});

test('DSH：模型目录优先 modelCatalog，not found 时回落 models', async () => {
  const seen = [];
  const { client } = fakeClient({
    callUnary: async (method) => {
      seen.push(method);
      if (method === 'session.modelCatalog') {
        const error = new Error('session/modelCatalog failed: not_found: unknown method');
        throw error;
      }
      return ok({ models: [] });
    },
  });
  const impl = createDshPort({ client });
  const got = await impl.listModels();
  assert.deepEqual(seen, ['session.modelCatalog', 'session.models']);
  assert.deepEqual(got.raw.result.value, { models: [] });

  // 其它错误不回落：真故障不能被当成「老版本」吞掉。
  const { client: strict } = fakeClient({
    callUnary: async () => { throw new Error('network down'); },
  });
  await assert.rejects(() => createDshPort({ client: strict }).listModels(), /network down/);
});

test('DSH：selectModel 拼会话 id，返回 selected 与原始回执', async () => {
  const { client, of } = fakeClient();
  const impl = createDshPort({ client });
  const got = await impl.selectModel({ instance: 'dsh', sessionId: 's1' }, { provider: 'deepseek', model: 'x' });
  assert.deepEqual(of('sessions.selectModel')[0].args[0], { sessionId: 's1', provider: 'deepseek', model: 'x' });
  assert.deepEqual(got.selected, { provider: 'p', model: 'm' });
});

test('DSH：readSettings 不传 ns 给原始表，传 ns 只给那一个命名空间', async () => {
  const { client, of } = fakeClient();
  const impl = createDshPort({ client });
  const all = await impl.readSettings();
  assert.ok(Array.isArray(all.value.namespaces));
  const one = await impl.readSettings('agent-presets');
  assert.equal(one.value.ns, 'agent-presets');
  assert.equal((await impl.readSettings('missing')).value, null);
  // 两次读都只打一次 describe（逐个 ns 查会多打几次 RPC）。
  assert.equal(of('settings.describe').length, 3);

  await impl.writeSettings({ ns: 'bridge-mode', patch: { mode: 'social' } });
  assert.deepEqual(of('settings.update')[0].args[0], { ns: 'bridge-mode', patch: { mode: 'social' } });
});

test('DSH：工作区创建与改名', async () => {
  const { client, of } = fakeClient();
  const impl = createDshPort({ client });
  const ws = await impl.createWorkspace({ path: 'state/qq-workspace' });
  assert.equal(ws.workspaceId, 'w1');
  assert.equal(ws.created, true);
  assert.deepEqual(of('workspace.create')[0].args[0], { path: 'state/qq-workspace' });

  await impl.renameWorkspace({ workspaceId: 'w1', title: 'QQ 桥接' });
  assert.deepEqual(of('workspace.rename')[0].args[0], { workspaceId: 'w1', title: 'QQ 桥接' });
});

test('DSH：maintenance 能力缺失时调用即 fail-closed', () => {
  const { client } = fakeClient();
  const port = createAgentPort({ id: 'dsh', capabilities: DSH_AGENT_CAPABILITIES, impl: createDshPort({ client }) });
  assert.equal(port.supports('maintenance'), false);
  assert.throws(() => port.rebuildSession('s1'), (error) => {
    assert.equal(error.code, CAPABILITY_UNSUPPORTED);
    assert.equal(error.capability, 'maintenance');
    return true;
  });
});

test('装配点：端口由连接层装配，能力位与直接装配一致', async () => {
  const { BUILTIN_AGENT_PLATFORMS } = await import('../src/agent-side/builtin.mjs');
  const entry = BUILTIN_AGENT_PLATFORMS.find((impl) => impl.id === 'dsh');
  assert.equal(typeof entry.createRuntime, 'function', '内置平台必须提供连接层');
  const runtime = entry.createRuntime({ config: { baseUrl: 'http://127.0.0.1:1' }, log: () => {} });
  const port = runtime.port();
  assert.equal(port.id, 'dsh');
  for (const capability of DSH_AGENT_CAPABILITIES) {
    assert.equal(port.supports(capability), true, `连接层装出来的端口缺能力位 ${capability}`);
  }
});

// ── ACP 适配器（C6 的第二实现）────────────────────────────────────────────

/**
 * 只满足传输层形状的桩。ACP 的 port 在方法真正跑起来之前不碰管道，
 * 所以装配与能力位查询都不需要真子进程 —— 真实报文由 scripts/test-acp-port.mjs
 * 用离线夹具（scripts/fixtures/fake-acp-agent.mjs）跑。
 */
function fakeAcpClient() {
  return {
    request: async (method) => { throw new Error(`假客户端不应该发出请求 ${method}`); },
    notify: () => true,
    handle: () => {},
    on: () => {},
    respond: () => {},
  };
}

function acpEntry() {
  const entry = BUILTIN_AGENT_PLATFORMS.find((impl) => impl.id === 'acp');
  assert.ok(entry, '内置清单里必须有 acp（C6 的第二实现）');
  return entry;
}

test('ACP：声明面覆盖 port 能力位，且不声明 v1 里没有的组', () => {
  for (const capability of ACP_PORT_CAPABILITIES) {
    assert.ok(acpDeclaration.capabilities.includes(capability), `声明面缺 ${capability}`);
  }
  // events 是事件出口，不是调用面（与 DSH 同一条规矩）。
  assert.equal(ACP_PORT_CAPABILITIES.includes('events'), false);
  // ACP v1 没有改名 / 设置 / 工作区 / 压缩 / 自愈：声明了就会画出点了必报
  // capability_unsupported 的按钮（§十 第 3 条：不为缺口造伪能力）。
  for (const absent of ['rename', 'settings', 'workspace', 'compact', 'maintenance']) {
    assert.equal(ACP_PORT_CAPABILITIES.includes(absent), false, `${absent} 不是 ACP 的能力位`);
    assert.equal(acpDeclaration.capabilities.includes(absent), false, `声明面多画了 ${absent}`);
  }
});

test('ACP：端口能力位是协商值（getter 现算，不是构造时的快照）', () => {
  const { impl, capabilities } = createAcpPort({ client: fakeAcpClient() });
  const port = createAgentPort({ id: acpDeclaration.id, label: acpDeclaration.label, capabilities, impl });
  // 未连接时按 v1 的固定方法面乐观声明：给空集会把 `listPermissionPresets` 锁在闸门外，
  // 而闸门背后正是唯一能做 initialize 与探测会话的地方（死锁）。
  assert.deepEqual([...port.capabilities].sort(), [...ACP_PORT_CAPABILITIES].sort());
  assert.equal(port.supports('permission'), true);
  assert.equal(port.supports('rename'), false);
  // 端口是冻结的：能力位只能经由 getter 演进，不能被调用方改写。
  assert.ok(Object.isFrozen(port));
});

test('ACP：连接层成员齐备，成员不齐则 agentRuntime() fail-closed', async () => {
  const entry = acpEntry();
  assert.equal(typeof entry.createRuntime, 'function');
  // 没有 HTTP 客户端可继承：连接就是 spawn 子进程，现场即信任边界。
  assert.equal(entry.NodeApiClient, undefined);
  const runtime = entry.createRuntime({ config: {}, log: () => {} });
  assert.equal(runtime.mode, 'stdio');
  // 事件流出口由 stdio 侧自建：子进程的 stdout 就是事件源，没有可继承的连接对象。
  assert.equal(typeof runtime.events, 'function');
  // 真契约检查（fail-closed）：少一个成员的实现不得当主平台，
  // 否则调用方会撞上 undefined.mux / undefined.port，分不清是没实现还是名字写错。
  await resetAgentRuntime();
  registerAgentPlatform({ ...entry, id: 'acp-thin', createRuntime: () => ({ ...runtime, collector: undefined }) });
  useAgentPlatform('acp-thin');
  assert.throws(() => agentRuntime({ config: {} }), /缺少 collector/);
  unregisterAgentPlatform('acp-thin');
  useAgentPlatform('acp');
  await resetAgentRuntime();
});

test('ACP：级别计划按对端模式名单 fail-closed，绝不降到更宽的模式', () => {
  const base = { presetIds: [], closedAgentPreset: '', allowCustomAgentPreset: false };
  // 读不到名单（null）不在声明面猜：交给 port 拿实时 modes 校（它会抛「没有这个名字」）。
  assert.deepEqual(
    acpDeclaration.resolveLevelPlan('L1', { ...base, permissionCatalog: null }),
    { ok: true, agentPreset: '', permissionPreset: 'read-only' },
  );
  assert.equal(acpDeclaration.resolveLevelPlan('L1', { ...base, permissionCatalog: ['read-only', 'default'] }).ok, true);
  const missing = acpDeclaration.resolveLevelPlan('L1', { ...base, permissionCatalog: ['default', 'yolo'] });
  assert.equal(missing.ok, false);
  // 错误里要写出对端实际提供的模式，否则用户不知道该改哪一边。
  assert.match(missing.error, /default \/ yolo/);
  // L3 只认 full-ask；对端只有 'yolo' 这种更宽的档时拒绝，不许拿它顶替。
  assert.equal(acpDeclaration.resolveLevelPlan('L3', { ...base, permissionCatalog: ['yolo'] }).ok, false);
  // 未知级别与空名单。
  assert.equal(acpDeclaration.resolveLevelPlan('L9', base).ok, false);
  assert.equal(acpDeclaration.resolveLevelPlan('L2', { ...base, permissionCatalog: [] }).ok, false);
  // 自选 agent 只在对端清单里才采用；L1 一律不换档。
  const customCtx = { ...base, presetIds: ['planner'], closedAgentPreset: 'planner', allowCustomAgentPreset: true };
  assert.equal(acpDeclaration.resolveLevelPlan('L2', customCtx).agentPreset, 'planner');
  assert.equal(acpDeclaration.resolveLevelPlan('L1', customCtx).agentPreset, '');
  assert.equal(acpDeclaration.resolveLevelPlan('L2', { ...customCtx, presetIds: [] }).agentPreset, '');
});

test('ACP：applyPermission 的回执判据是「ok 且名字一致」', () => {
  assert.equal(acpDeclaration.permissionCommandSucceeded({ ok: true, modeId: 'read-only' }, 'read-only'), true);
  // set_mode 没有回执值，能确认的只有「RPC 成功 + 请求的就是这个名字」。
  assert.equal(acpDeclaration.permissionCommandSucceeded({ ok: true, modeId: 'full' }, 'read-only'), false);
  assert.equal(acpDeclaration.permissionCommandSucceeded({ ok: false }, 'read-only'), false);
  assert.equal(acpDeclaration.permissionCommandSucceeded(null, 'read-only'), false);
});
