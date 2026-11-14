// P2 平台配置写口（docs/EXECUTION_BODY_GENERALIZATION.md §9）。
//
// 这一批新增的能力都是「配置面能改」，所以这里钉住的是写口语义而不是表单：
//   · 按 id 写：控制台选中的实例不一定是 active，补丁必须落到那一条；
//   · 白名单切分：端点键进 endpoint（改完要重启），其余进 options（下一次调用就生效）；
//   · 校验一致：写口与 `config_invalid` 诊断用同一个 vetPlatformConfig；
//   · 切换默认执行体只改指针，条目原样保留 —— 而且不能连下一个请求一起改。
// 以及注册表为控制台补的两个读视图：`configured`（配置面选的）与 `probe`（上次探活）。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_ENDPOINT_KEYS,
  patchPlatformConfig,
  setActivePlatform,
} from '../src/config/platforms.mjs';
import {
  DIAGNOSTIC_CODES,
  buildPlatformRegistry,
  findRegistryPlatform,
  vetPlatformConfig,
} from '../src/platforms/registry.mjs';

/** 两条 Agent 平台：dsh 是 active，acp 只是「也配了」。 */
const twoAgents = () => ({
  active: { user: 'qq', agent: 'dsh' },
  users: { qq: { transport: {}, options: {} } },
  agents: {
    dsh: { endpoint: { baseUrl: 'http://127.0.0.1:3080' }, options: { model: 'deepseek-flash' } },
    acp: { endpoint: {}, options: {} },
  },
});

const agentProfiles = [
  { id: 'dsh', label: 'DeepSeek Harness', capabilities: [] },
  { id: 'acp', label: 'ACP 执行体', capabilities: [] },
];

test('补丁按 id 落到那一条：active 与其它条目都不动', () => {
  const next = patchPlatformConfig(twoAgents(), 'agent', 'acp', { model: 'deepseek-pro' });
  assert.equal(next.active.agent, 'dsh', '写非 active 的实例不改默认执行体');
  assert.equal(next.agents.acp.options.model, 'deepseek-pro');
  assert.equal(next.agents.dsh.options.model, 'deepseek-flash', '另一条条目的值不受影响');
});

test('端点键进 endpoint，其余进 options（改完要不要重启由这条分界线决定）', () => {
  const next = patchPlatformConfig(twoAgents(), 'agent', 'dsh', { baseUrl: 'http://127.0.0.1:3999', model: 'deepseek-pro' });
  assert.equal(next.agents.dsh.endpoint.baseUrl, 'http://127.0.0.1:3999');
  assert.equal(next.agents.dsh.options.model, 'deepseek-pro');
  assert.equal('baseUrl' in next.agents.dsh.options, false);
  assert.deepEqual(
    Object.keys(next.agents.dsh.options).filter((key) => AGENT_ENDPOINT_KEYS.includes(key)),
    [],
    '端点白名单里的键不得落进 options',
  );
});

test('写盘只落补丁给出的键，不把 schema 默认值固化成设置', () => {
  const next = patchPlatformConfig(twoAgents(), 'agent', 'acp', { model: 'deepseek-pro' });
  assert.deepEqual(Object.keys(next.agents.acp), ['endpoint', 'options']);
  assert.equal('provider' in next.agents.acp.options, false);
  assert.equal('baseUrl' in next.agents.acp.endpoint, false);
});

test('空 id 表示「写当前平台」：选模型、token 自愈这类写正在用的那条', () => {
  const next = patchPlatformConfig(twoAgents(), 'agent', '', { model: 'deepseek-pro' });
  assert.equal(next.active.agent, 'dsh');
  assert.equal(next.agents.dsh.options.model, 'deepseek-pro');
  assert.equal('model' in next.agents.acp.options, false);
});

test('非法 id 原表返回，不猜也不新建', () => {
  const base = twoAgents();
  assert.deepEqual(patchPlatformConfig(base, 'agent', 'Bad Id', { model: 'x' }), patchPlatformConfig(base, 'agent', '', {}));
  assert.equal(Object.keys(patchPlatformConfig(base, 'agent', 'Bad Id', { model: 'x' }).agents).length, 2);
});

test('切换默认执行体只改指针；指向没配过的 id 时补一条空壳（否则报 active_unregistered）', () => {
  const next = setActivePlatform(twoAgents(), 'agent', 'acp');
  assert.equal(next.active.agent, 'acp');
  assert.equal(next.agents.dsh.endpoint.baseUrl, 'http://127.0.0.1:3080', '条目是「怎么连」，与「默认用谁」无关');
  const added = setActivePlatform(twoAgents(), 'agent', 'newbie');
  assert.equal(added.active.agent, 'newbie');
  assert.deepEqual(added.agents.newbie, { endpoint: {}, options: {} });
});

test('注册表把「配置面选的」与「本进程装配的」分成两个字段，不一致时报 active_pending_restart', () => {
  const snapshot = buildPlatformRegistry({
    profileAgentPlatforms: agentProfiles,
    agentRuntime: { active: 'dsh', platforms: [{ id: 'dsh', label: 'DeepSeek Harness', source: 'builtin' }] },
    config: { active: { agent: 'acp' }, agents: { acp: {} } },
  });
  const dsh = findRegistryPlatform(snapshot, 'agent', 'dsh');
  const acp = findRegistryPlatform(snapshot, 'agent', 'acp');
  assert.equal(dsh.active, true);
  assert.equal(dsh.configured, false);
  assert.equal(acp.active, false);
  assert.equal(acp.configured, true, '刚设为默认的那个必须能看出来，不能显示成「未启用」');
  const diag = snapshot.diagnostics.find((item) => item.code === DIAGNOSTIC_CODES.ACTIVE_PENDING_RESTART);
  assert.ok(diag, '刚改过、还没重启这件事必须看得见');
  assert.equal(diag.level, 'warn');
  assert.equal(diag.platformId, 'acp');
  assert.match(diag.message, /重启/);
});

test('显式探活的结论按 id 进注册表条目；没探过的平台是 null 而不是「失败」', () => {
  const snapshot = buildPlatformRegistry({
    profileAgentPlatforms: agentProfiles,
    agentRuntime: { active: 'dsh', platforms: [{ id: 'dsh', label: 'DeepSeek Harness', source: 'builtin' }] },
    config: { active: { agent: 'dsh' }, agents: { dsh: {} } },
    agentProbes: { dsh: { ok: false, error: 'ECONNREFUSED', url: 'http://127.0.0.1:3080', at: '2026-11-15 10:00:00' } },
  });
  assert.equal(findRegistryPlatform(snapshot, 'agent', 'dsh').probe.error, 'ECONNREFUSED');
  assert.equal(findRegistryPlatform(snapshot, 'agent', 'acp').probe, null);
});

test('写口校验与 config_invalid 诊断同一套规则：校的是「旧值 + 补丁」合并后的整份', () => {
  const schema = {
    type: 'object',
    properties: { baseUrl: { type: 'string', minLength: 8 }, model: { type: 'string' } },
    required: ['baseUrl'],
    additionalProperties: false,
  };
  const stored = { baseUrl: 'http://127.0.0.1:3080', model: 'deepseek-flash' };
  const patch = { model: 'deepseek-pro' };
  assert.equal(vetPlatformConfig(schema, { ...stored, ...patch }).error, '', '补丁不带必填项，靠旧值补齐后仍然合法');
  assert.notEqual(vetPlatformConfig(schema, patch).error, '', '只拿补丁去校会误判，写法必须合并');
  assert.notEqual(vetPlatformConfig(schema, { ...stored, baseUrl: 'x' }).error, '', '落盘的整份不合法就要拒绝');

  // 同一个非法值，注册表也必须报 config_invalid —— 控制台不能「保存成功但带一条错误诊断」。
  const snapshot = buildPlatformRegistry({
    profileAgentPlatforms: [{ id: 'dsh', label: 'DeepSeek Harness', configSchema: schema, capabilities: [] }],
    agentRuntime: { active: 'dsh', platforms: [{ id: 'dsh', label: 'DeepSeek Harness', source: 'builtin' }] },
    config: { active: { agent: 'dsh' }, agents: { dsh: { baseUrl: 'x' } } },
  });
  const diag = snapshot.diagnostics.find((item) => item.code === DIAGNOSTIC_CODES.CONFIG_INVALID);
  assert.ok(diag);
  assert.equal(diag.level, 'error');
});
