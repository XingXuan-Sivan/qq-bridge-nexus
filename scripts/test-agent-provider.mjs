// Agent 侧插件化（P1）：注册表归属、装配结论、诊断透出、内核接线。
//
// 钉住四类只在集成时才会炸的契约：
//   1. owner 决定一切：同 owner 覆盖、换 owner 拒绝、内置不可被顶替、按 owner 只清自己的；
//   2. 装配失败必须留下结论（执行体不可用 / 实现不合契约 / 自证失败），且能用控制台看见；
//   3. 统一注册表把结论翻成诊断码，并把「探过但没连上」与「还没探」分开；
//   4. 插件内核只在拿到 agent-provider:provide 时才给 ctx.agentPlatforms，停用即按 owner 注销。
//
// 全部离线：不 import 任何 adapters/，插件夹具写在临时目录，状态与审计也落在临时目录。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CAPABILITY_OVERCLAIMED, createAgentPort } from '../src/agent-side/port.mjs';
import { RUNTIME_MEMBERS, agentRuntime, resetAgentRuntime } from '../src/agent-side/runtime.mjs';
import { agentPlatformMetadata } from '../src/agent-side/metadata.mjs';
import {
  agentPlatform,
  agentPlatformIssues,
  agentProviderRegistry,
  listAgentPlatforms,
  registerAgentPlatform,
  unregisterAgentPlatform,
  unregisterAgentPlatformsByOwner,
  useAgentPlatform,
} from '../src/agent-side/runtime-registry.mjs';
import { DIAGNOSTIC_CODES, buildPlatformRegistry } from '../src/platforms/registry.mjs';
import { createPluginKernel } from '../src/plugins/kernel.mjs';

// ── 夹具 ────────────────────────────────────────────────────────────────────

/** 只实现核心方法的最小 port 实现：能力位为空时不缺任何东西，声明了 session 就缺。 */
function corePortImpl() {
  return {
    probe: async () => ({ ok: true }),
    listSessions: async () => ({ sessions: [] }),
    ensureSession: async () => ({ sessionId: 's1' }),
    prompt: async () => ({ ok: true }),
    cancel: async () => ({ ok: true }),
  };
}

/** 12 个成员齐全的连接层实现（与 src/agent-side/adapters 下的 createRuntime 返回同形）。 */
function runtimeStub(overrides = {}) {
  const id = overrides.id ?? 'stub';
  const stub = {
    id,
    label: 'Stub',
    mode: 'http',
    prepareAuth: () => ({}),
    prepareEndpoint: async () => ({ baseUrl: '', auto: false, discovered: false, reachable: false }),
    client: () => ({}),
    events: () => ({ follow() {}, forget() {}, mux: async function* empty() {} }),
    port: () => createAgentPort({ id, capabilities: [], impl: corePortImpl() }),
    collector: () => ({}),
    health: () => ({ ok: () => ({ recoveredFrom: 0 }), fail: () => ({ failures: 1, reason: null }) }),
    probe: () => ({ check: async () => ({ ok: true, error: null, rediscovered: false, url: null }) }),
    authHint: () => null,
    authRecentlyFailed: () => false,
    resetAuthHint: () => {},
    close: async () => {},
  };
  return { ...stub, ...overrides };
}

/** 一份可注册的平台实现（声明面 + 连接面）。 */
function makeImpl(id, overrides = {}) {
  return {
    id,
    label: `平台 ${id}`,
    capabilities: ['session'],
    createRuntime: () => runtimeStub({ id, label: `平台 ${id}` }),
    ...overrides,
  };
}

const SCHEMA = Object.freeze({
  type: 'object',
  properties: { token: { type: 'string' } },
  required: ['token'],
});

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-provider-'));
  const pluginsDir = path.join(root, 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  return { root, pluginsDir, stateDir };
}

function writePlugin(pluginsDir, id, indexSource, overrides = {}) {
  const dir = path.join(pluginsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({
    id,
    name: id,
    version: '1.0.0',
    main: 'index.mjs',
    apiVersion: 1,
    ...overrides,
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'index.mjs'), indexSource);
  return dir;
}

// ── 注册表：归属与覆盖 ──────────────────────────────────────────────────────

test('注册表：同 owner 可覆盖、换 owner 拒绝、内置不可被顶替、id 与形状在注册时就判', () => {
  registerAgentPlatform(makeImpl('tpl-a'), { owner: 'plug-1' });
  // 同 owner 覆盖是热重载的正常路径，不该抛。
  registerAgentPlatform(makeImpl('tpl-a', { label: '改过名字' }), { owner: 'plug-1' });
  assert.equal(agentPlatform('tpl-a').label, '改过名字');

  assert.throws(() => registerAgentPlatform(makeImpl('tpl-a'), { owner: 'plug-2' }), /已被占用：tpl-a（plug-1）/);
  assert.throws(() => registerAgentPlatform(makeImpl('dsh'), { owner: 'plug-1' }), /插件不得顶替别人的平台/);

  assert.throws(() => registerAgentPlatform(makeImpl('Bad_Id')), /id 不合法/);
  // 连接层是唯一必填项：没有 createRuntime 的平台永远不能被选为当前执行体，注册时就判。
  assert.throws(() => registerAgentPlatform({ id: 'tpl-b' }), /缺少 createRuntime/);

  unregisterAgentPlatform('tpl-a');
  assert.equal(agentPlatform('tpl-a'), null);
});

test('注册表：按 owner 注销只动自己的，内置与「正在使用」的两类都拒绝', () => {
  registerAgentPlatform(makeImpl('tpl-o1'), { owner: 'plug-o' });
  registerAgentPlatform(makeImpl('tpl-o2'), { owner: 'plug-o' });
  const removed = unregisterAgentPlatformsByOwner('plug-o');
  assert.deepEqual(removed.map((impl) => impl.id).sort(), ['tpl-o1', 'tpl-o2']);
  assert.equal(agentPlatform('tpl-o1'), null);
  assert.ok(agentPlatform('dsh'), '内置平台不受影响');

  assert.throws(() => unregisterAgentPlatformsByOwner('builtin'), /不能按 owner 批量注销内置平台/);

  registerAgentPlatform(makeImpl('tpl-act'), { owner: 'plug-act' });
  useAgentPlatform('tpl-act');
  // 会话落盘里的 agentRef.instance 指着它：运行期悄悄换掉会让「谁在跑这个会话」变成猜谜。
  assert.throws(() => unregisterAgentPlatformsByOwner('plug-act'), /正在作为当前执行体使用/);
  useAgentPlatform('dsh');
  assert.deepEqual(unregisterAgentPlatformsByOwner('plug-act').map((impl) => impl.id), ['tpl-act']);
});

test('注册表：描述面带 owner / source / configSchema / issues，metadata 原样透出', () => {
  registerAgentPlatform({ ...makeImpl('tpl-m'), configSchema: SCHEMA }, { owner: 'plug-m' });
  const item = listAgentPlatforms().find((impl) => impl.id === 'tpl-m');
  assert.equal(item.owner, 'plug-m');
  assert.equal(item.source, 'plugin');
  assert.deepEqual(item.configSchema, SCHEMA);
  assert.deepEqual(item.issues, []);

  const builtin = listAgentPlatforms().find((impl) => impl.id === 'dsh');
  assert.equal(builtin.source, 'builtin');
  assert.equal(builtin.owner, 'builtin');

  const meta = agentPlatformMetadata();
  assert.equal(meta.platforms.find((impl) => impl.id === 'tpl-m').owner, 'plug-m');
  assert.equal(meta.platforms.filter((impl) => impl.active).length, 1, '只有当前平台带 active');

  unregisterAgentPlatform('tpl-m');
});

// ── 连接层：装配失败要留下结论 ──────────────────────────────────────────────

test('连接层：createRuntime 抛错记 agent_instance_offline，成员缺失记 agent_provider_invalid', async () => {
  await resetAgentRuntime();

  registerAgentPlatform(makeImpl('tpl-down', { createRuntime: () => { throw new Error('对端没起'); } }), { owner: 'plug-down' });
  useAgentPlatform('tpl-down');
  assert.throws(() => agentRuntime({ config: {} }), /对端没起/);
  assert.deepEqual(agentPlatformIssues('tpl-down'), [{ code: 'agent_instance_offline', message: '对端没起' }]);

  const thin = runtimeStub({ id: 'tpl-thin', collector: undefined });
  registerAgentPlatform(makeImpl('tpl-thin', { createRuntime: () => thin }), { owner: 'plug-thin' });
  useAgentPlatform('tpl-thin');
  assert.throws(() => agentRuntime({ config: {} }), /缺少 collector/);
  assert.deepEqual(
    agentPlatformIssues('tpl-thin').map((issue) => issue.code),
    ['agent_provider_invalid'],
    '形状不完整是「实现不合契约」，不是「暂时连不上」',
  );

  useAgentPlatform('dsh');
  await resetAgentRuntime();
  unregisterAgentPlatform('tpl-down');
  unregisterAgentPlatform('tpl-thin');
});

test('连接层：port 装配失败记 capability_overclaimed，装配成功后清账', async () => {
  await resetAgentRuntime();

  // 声明了 session，却只实现了核心方法：createAgentPort 的闸门会抛（自证失败）。
  const overclaim = () => runtimeStub({
    id: 'tpl-over',
    label: 'Over',
    port: () => createAgentPort({ id: 'tpl-over', capabilities: ['session'], impl: corePortImpl() }),
  });
  registerAgentPlatform(makeImpl('tpl-over', { createRuntime: overclaim }), { owner: 'plug-over' });
  useAgentPlatform('tpl-over');
  const broken = agentRuntime({ config: {} });
  assert.equal(typeof broken.port, 'function', '句柄本身建得起来：问题出在调用面');
  assert.throws(() => broken.port(), /声明了能力但没实现 session\.archiveSession/);
  assert.deepEqual(
    agentPlatformIssues('tpl-over').map((issue) => issue.code),
    [CAPABILITY_OVERCLAIMED],
    '自证失败要能在控制台诊断里看见',
  );

  // 同 owner 换一份能装起来的实现：重建后 port() 成功，旧账要清掉。
  registerAgentPlatform(makeImpl('tpl-over'), { owner: 'plug-over' });
  await resetAgentRuntime();
  const fixed = agentRuntime({ config: {} });
  assert.equal(fixed.port().id, 'tpl-over');
  assert.deepEqual(agentPlatformIssues('tpl-over'), []);

  useAgentPlatform('dsh');
  await resetAgentRuntime();
  unregisterAgentPlatform('tpl-over');
});

// ── 统一注册表：结论翻成诊断码 ──────────────────────────────────────────────

test('统一注册表：issues 与探活结论各自成为独立诊断，未探过（null）不判离线', () => {
  const platform = {
    id: 'ghost-agent',
    label: 'Ghost',
    capabilities: [],
    configSchema: SCHEMA,
    owner: 'plug-g',
    source: 'plugin',
    issues: [{ code: CAPABILITY_OVERCLAIMED, message: '声明了能力但没实现 session.archiveSession' }],
  };
  const base = {
    agentRuntime: { active: 'ghost-agent', platforms: [platform] },
    config: { agents: { 'ghost-agent': { token: 'ok' } } },
  };

  const offline = buildPlatformRegistry({ ...base, agentConnected: false });
  assert.deepEqual(
    offline.diagnostics.map((item) => item.code).sort(),
    [DIAGNOSTIC_CODES.AGENT_INSTANCE_OFFLINE, DIAGNOSTIC_CODES.CAPABILITY_OVERCLAIMED].sort(),
  );
  assert.equal(offline.summary.errors, 1, '自证失败是 error');
  assert.equal(offline.summary.warnings, 1, '连不上是 warn');
  const entry = offline.platforms.find((item) => item.side === 'agent');
  assert.equal(entry.source, 'plugin');
  assert.equal(entry.owner, 'plug-g');
  assert.equal(entry.configSchema?.properties?.token?.type, 'string', '插件平台的配置模型来自实现本身');
  assert.deepEqual(entry.configSchema?.required, ['token']);

  const unknown = buildPlatformRegistry(base);
  assert.equal(unknown.diagnostics.some((item) => item.code === DIAGNOSTIC_CODES.AGENT_INSTANCE_OFFLINE), false);

  // 配置不合 schema 与装配结论是两码事，各自一条。
  const badConfig = buildPlatformRegistry({ ...base, config: { agents: { 'ghost-agent': { token: 1 } } } });
  assert.ok(badConfig.diagnostics.some((item) => item.code === DIAGNOSTIC_CODES.CONFIG_INVALID));
});

// ── 插件内核：权限、注册、停用即注销 ────────────────────────────────────────

const AGENT_PLUGIN = `
export function activate(ctx) {
  ctx.agentPlatforms.register({
    id: 'demo-agent',
    label: '演示执行体',
    capabilities: ['session'],
    configSchema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] },
    createRuntime: () => ({ id: 'demo-agent', label: '演示执行体', mode: 'http' }),
  });
  // 顶替内置平台：注册表拒绝，插件其余部分照常跑。
  ctx.agentPlatforms.register({ id: 'dsh', label: '冒名', createRuntime: () => ({}) });
  return {};
}
`;

const NO_PERMISSION_PLUGIN = `
export function activate(ctx) {
  return { seen: typeof ctx.agentPlatforms };
}
`;

test('插件内核：agent-provider:provide 注册进同一张表，冲突留审计，停用即按 owner 注销', async () => {
  const { root, pluginsDir, stateDir } = makeTempRoot();
  writePlugin(pluginsDir, 'agentplug', AGENT_PLUGIN, { permissions: ['state', 'agent-provider:provide'], hooks: [] });
  writePlugin(pluginsDir, 'noperm', NO_PERMISSION_PLUGIN, { permissions: ['state'], hooks: [] });
  const kernel = await createPluginKernel({
    rootDir: root,
    stateDir,
    log: () => {},
    deps: { agentRegistry: agentProviderRegistry },
  });
  await kernel.init();
  try {
    const entry = kernel.status().plugins.find((item) => item.id === 'agentplug');
    assert.deepEqual(entry.agentProviders, ['demo-agent']);
    assert.equal(entry.status, 'active');

    const registered = agentPlatform('demo-agent');
    assert.equal(registered.owner, 'agentplug');
    assert.equal(registered.source, 'plugin');
    assert.deepEqual(registered.capabilities, ['session']);
    assert.equal(typeof registered.createRuntime, 'function', '连接层由内核在切换执行体时再调');

    const auditText = fs.readFileSync(path.join(stateDir, 'plugin-audit.jsonl'), 'utf8');
    assert.match(auditText, /"agent-provider-denied"/);
    assert.equal(agentPlatform('dsh').owner, 'builtin', '内置平台没有被顶替');

    assert.equal(kernel.status().plugins.find((item) => item.id === 'noperm').status, 'active');

    assert.equal((await kernel.disable('agentplug')).ok, true);
    assert.equal(agentPlatform('demo-agent'), null, '停用后按 owner 注销');
    assert.ok(agentPlatform('dsh'), '内置平台照旧');

    assert.equal((await kernel.enable('agentplug')).ok, true);
    assert.equal(agentPlatform('demo-agent')?.owner, 'agentplug', '启用后重新注册');
  } finally {
    await kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('插件内核：没申请 agent-provider:provide 时 ctx.agentPlatforms 不存在', async () => {
  const { root, pluginsDir, stateDir } = makeTempRoot();
  writePlugin(pluginsDir, 'noperm', NO_PERMISSION_PLUGIN, { permissions: ['state'], hooks: [] });
  const kernel = await createPluginKernel({
    rootDir: root,
    stateDir,
    log: () => {},
    deps: { agentRegistry: agentProviderRegistry },
  });
  await kernel.init();
  try {
    const entry = kernel.status().plugins.find((item) => item.id === 'noperm');
    assert.equal(entry.status, 'active');
    assert.deepEqual(entry.agentProviders, []);
  } finally {
    await kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('连接层契约：RUNTIME_MEMBERS 仍是 12 个成员，且门面不吞掉任何一个', async () => {
  assert.equal(RUNTIME_MEMBERS.length, 12);
  await resetAgentRuntime();
  useAgentPlatform('dsh');
  const handle = agentRuntime({ config: {} });
  for (const name of RUNTIME_MEMBERS) {
    assert.equal(typeof handle[name], 'function', `${name} 必须透出`);
  }
  assert.ok(handle.id && handle.label && handle.mode);
  await resetAgentRuntime();
});
