// ACP 的 `AgentPort` 实现（C6-d）+ 事件映射（C6-e）：离线夹具回归。
//
// 钉住的都是**结构性的**东西，不是实现细节：
//   1. 能力位在 `initialize` 之后才出现，且只声明对端真的声明支持的那几位；
//   2. `prompt` 的受理制（v1 阻塞到回合结束）：首条 update / 响应 / 宽限期三条信号
//      先到的那个判受理，`turn-end` 一律补发（否则内核永久判忙）；
//   3. 权限是反向请求：挂起 → 内核决策 → 按 requestId 回执；**不映射 allow_always**；
//   4. 名单是会话级的：没有会话时建一个探测会话去读，而不是返回空表让控制台看不见按钮；
//   5. ACP 的缺口（工作区 / 设置 / 压缩 / 改名）**不伪造**：能力位不声明，调用 fail-closed。

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CAPABILITY_UNSUPPORTED, createAgentPort } from '../src/agent-side/port.mjs';
import { createAcpClient } from '../src/agent-side/adapters/acp/client.mjs';
import { ACP_PORT_CAPABILITIES, createAcpPort } from '../src/agent-side/adapters/acp/port.mjs';
import { UPDATE_KINDS, mapPermissionRequest, mapSessionUpdate } from '../src/agent-side/adapters/acp/events.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'scripts', 'fixtures', 'fake-acp-agent.mjs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 轮询等待（事件是异步到的，用固定 sleep 会在慢机器上假红）。 */
async function waitFor(probe, { timeout = 5000, step = 20 } = {}) {
  const startedAt = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() - startedAt > timeout) throw new Error('等待超时');
    await sleep(step);
  }
}

/**
 * 一份装好的 ACP port：传输层是真子进程（ACP 的契约有一半在进程边界上），
 * 但 `onEvent` 换成数组，事件断言直接读它。
 */
function harness({ env = {}, acceptGraceMs = 250 } = {}) {
  const client = createAcpClient({
    command: process.execPath,
    args: [FIXTURE],
    env,
    requestTimeoutMs: 5000,
  });
  const events = [];
  const logs = [];
  const { impl, capabilities } = createAcpPort({
    client,
    instance: 'acp',
    acceptGraceMs,
    logger: (level, text) => logs.push(`${level}: ${text}`),
    onEvent: (event) => events.push(event),
  });
  const port = createAgentPort({ id: 'acp', label: 'ACP', capabilities, impl });
  return { client, port, impl, events, logs };
}

/** 受限沙箱里 spawn 会被拒：整组跳过，而不是误报失败。 */
let spawnBlocked = null;
async function preflight() {
  if (spawnBlocked === null) {
    const probe = harness();
    try {
      await probe.port.probe();
      spawnBlocked = false;
    } catch (error) {
      spawnBlocked = error?.code === 'EPERM' || /EPERM|not permitted/i.test(String(error?.message ?? ''));
    } finally {
      await probe.client.stop();
    }
  }
  return spawnBlocked;
}

// ── 纯函数：事件映射 ────────────────────────────────────────────────────────

test('事件映射：v1 判别值 → 归一 kind，未知值不丢弃', () => {
  // 表里的每个值都必须落到 AGENT_EVENT_KINDS（空串是「确定丢弃」）。
  assert.deepEqual(Object.keys(UPDATE_KINDS).sort(), [
    'agent_message_chunk', 'agent_thought_chunk', 'available_commands_update',
    'current_mode_update', 'plan', 'session_info_update', 'tool_call', 'tool_call_update',
    'user_message_chunk',
  ]);

  assert.deepEqual(
    mapSessionUpdate('s1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '你好' } }),
    { kind: 'text', sessionId: 's1', delta: '你好' },
  );
  assert.equal(mapSessionUpdate('s1', { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'x' } }), null, '回声必须丢弃');

  const started = mapSessionUpdate('s1', { sessionUpdate: 'tool_call', toolCallId: 't1', title: '读文件', kind: 'read', status: 'pending' });
  assert.equal(started.kind, 'tool');
  assert.equal(started.phase, 'start');
  assert.equal(started.callId, 't1');
  const ended = mapSessionUpdate('s1', { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'failed', content: [{ type: 'diff', path: 'a.txt' }] });
  assert.equal(ended.phase, 'end');
  assert.match(ended.summary, /a\.txt/);

  const unknown = mapSessionUpdate('s1', { sessionUpdate: 'from_the_future', payload: 1 });
  assert.equal(unknown.kind, 'notice');
  assert.equal(unknown.notice, 'unknown-update');

  const plan = mapSessionUpdate('s1', { sessionUpdate: 'plan', entries: [{ content: '第一步', priority: 'high', status: 'pending' }] });
  assert.equal(plan.kind, 'plan');
  assert.equal(plan.entries[0].content, '第一步');
});

test('权限事件：requestId / 选项 kinds 原样交出（allow_always 也在，只是不会被选）', () => {
  const event = mapPermissionRequest('srv-1', {
    sessionId: 's1',
    toolCall: { toolCallId: 't1', title: '改文件', kind: 'edit' },
    options: [
      { optionId: 'allow-once', name: '允许一次', kind: 'allow_once' },
      { optionId: 'allow-always', name: '总是允许', kind: 'allow_always' },
    ],
  });
  assert.equal(event.kind, 'permission');
  assert.equal(event.requestId, 'srv-1');
  assert.equal(event.callId, 't1');
  assert.deepEqual(event.options.map((option) => option.kind), ['allow_once', 'allow_always']);
});

// ── 端到端：能力位 ──────────────────────────────────────────────────────────

test('能力位：未连接时按 v1 方法面乐观声明，之后按对端回执裁', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const { client, port } = harness();
  try {
    // 未连接就返回空集会把「读名单」锁死：闸门在方法之前，初始化只能在方法里发生。
    assert.deepEqual(port.capabilities, [...ACP_PORT_CAPABILITIES]);
    assert.equal(port.supports('permission'), true);

    const probed = await port.probe();
    assert.equal(probed.ok, true);
    assert.equal(probed.version, '0.0.1');
    // fake 声明了 close:true ⇒ session 组保留。
    assert.deepEqual(port.capabilities, [...ACP_PORT_CAPABILITIES]);

    // ACP 的缺口不伪造：rename 不在声明的能力位里，调用必须 fail-closed。
    assert.throws(() => port.renameSession('s1', 'x'), (error) => error.code === CAPABILITY_UNSUPPORTED && error.capability === 'rename');
  } finally {
    await client.stop();
  }
});

test('session/list：游标分页与归档（session/close）', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const { client, port } = harness();
  try {
    const created = await port.ensureSession({ cwd: ROOT });
    assert.equal(created.sessionId, 'sess-1');

    const listed = await port.listSessions();
    assert.deepEqual(listed.sessions.map((item) => item.sessionId), ['sess-1']);
    assert.equal(listed.sessions[0].origin, '', 'ACP 没有来源概念，不能编一个值');

    const archived = await port.archiveSession('sess-1');
    assert.ok(archived.raw !== undefined);
    const after = await port.listSessions();
    assert.deepEqual(after.sessions, []);
  } finally {
    await client.stop();
  }
});

test('session/list 未声明时抛 capability_unsupported（不能返回空表）', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const { client, port } = harness({ env: { FAKE_ACP_NO_LIST: '1' } });
  try {
    // 空表会被会话对账当成「全都归档了」，比报错贵得多。
    await assert.rejects(() => port.listSessions(), (error) => error.code === CAPABILITY_UNSUPPORTED);
  } finally {
    await client.stop();
  }
});

test('close 未声明时 session 组收缩，archiveSession fail-closed', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const { client, port } = harness({ env: { FAKE_ACP_NO_CLOSE: '1' } });
  try {
    await port.probe();
    assert.deepEqual(port.capabilities, ['permission', 'models'], '对端没有 close 就不该画归档按钮');
    assert.throws(() => port.archiveSession('sess-1'), (error) => error.code === CAPABILITY_UNSUPPORTED);
  } finally {
    await client.stop();
  }
});

// ── 端到端：受理制 ──────────────────────────────────────────────────────────

test('prompt：首条 update 判受理，回合结束后补 turn-end', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const { client, port, events } = harness();
  try {
    await port.ensureSession({ cwd: ROOT });
    const accepted = await port.prompt('sess-1', { content: [{ type: 'text', text: '你好' }] });
    assert.deepEqual(
      { ok: accepted.ok, isCommand: accepted.isCommand, commandText: accepted.commandText, error: accepted.error },
      { ok: true, isCommand: false, commandText: '', error: null },
      'ACP 没有命令回执，isCommand 恒为 false',
    );

    const reasoning = await waitFor(() => events.find((event) => event.kind === 'reasoning'));
    assert.equal(reasoning.delta, '先想一想');
    const text = await waitFor(() => events.find((event) => event.kind === 'text'));
    assert.match(text.delta, /收到：你好/);
    const turnEnd = await waitFor(() => events.find((event) => event.kind === 'turn-end'));
    assert.equal(turnEnd.stopReason, 'end_turn');
  } finally {
    await client.stop();
  }
});

test('prompt：JSON-RPC 拒绝 → ok:false（不抛），且 turn-end 带 error', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const { client, port, events } = harness({ env: { FAKE_ACP_FAIL_PROMPT: '1' } });
  try {
    await port.ensureSession({ cwd: ROOT });
    const accepted = await port.prompt('sess-1', { content: [{ type: 'text', text: 'x' }] });
    assert.equal(accepted.ok, false);
    assert.equal(accepted.error.code, '-32000');
    assert.match(accepted.error.message, /rejected by policy/);
    const turnEnd = await waitFor(() => events.find((event) => event.kind === 'turn-end'));
    assert.equal(turnEnd.stopReason, 'error');
  } finally {
    await client.stop();
  }
});

test('prompt：Agent 迟迟不吐 chunk 时由宽限期判受理（不阻塞整轮）', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const { client, port, events } = harness({ env: { FAKE_ACP_SLOW: '1' }, acceptGraceMs: 100 });
  try {
    await port.ensureSession({ cwd: ROOT });
    const startedAt = Date.now();
    const accepted = await port.prompt('sess-1', { content: [{ type: 'text', text: 'x' }] });
    assert.equal(accepted.ok, true);
    assert.ok(Date.now() - startedAt < 450, '受理不该等到回合结束（夹具要 500ms 才回）');
    assert.equal(events.some((event) => event.kind === 'text'), false, '此时还一条 chunk 都没有');
    await waitFor(() => events.find((event) => event.kind === 'turn-end'));
  } finally {
    await client.stop();
  }
});

test('cancel：发 session/cancel 通知（无响应，回合边界靠 turn-end）', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const { client, port } = harness();
  try {
    await port.ensureSession({ cwd: ROOT });
    const cancelled = await port.cancel('sess-1');
    assert.equal(cancelled.raw.notified, true);
    await waitFor(() => client.stderrTail.some((line) => /cancel session=sess-1/.test(line)));
  } finally {
    await client.stop();
  }
});

// ── 端到端：权限（反向请求）────────────────────────────────────────────────

test('权限：Agent 反向请求 → 挂起 → 内核回执后它继续跑', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const { client, port, events } = harness({ env: { FAKE_ACP_PERMISSION: '1' }, acceptGraceMs: 300 });
  try {
    await port.ensureSession({ cwd: ROOT });
    const accepted = await port.prompt('sess-1', { content: [{ type: 'text', text: '改文件' }] });
    assert.equal(accepted.ok, true);

    const permission = await waitFor(() => events.find((event) => event.kind === 'permission'));
    assert.equal(permission.sessionId, 'sess-1');
    assert.equal(permission.options.length, 3);

    // bridge 就是这么拼引用的（`{ clientId, eventId }`）：ACP 的 id 放在 eventId 里。
    const replied = await port.respondPermission({ clientId: '', eventId: permission.requestId }, 'allowed-once');
    assert.equal(replied.raw.optionId, 'allow-once', '只批一次，绝不能落到 allow_always');

    const outcome = await waitFor(() => events.find((event) => event.kind === 'text' && /权限结果/.test(event.delta)));
    assert.match(outcome.delta, /allow-once/);
    await waitFor(() => events.find((event) => event.kind === 'turn-end'));
  } finally {
    await client.stop();
  }
});

test('权限：拒绝落到 reject_once；没有挂起项时明确报错', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const { client, port, events } = harness({ env: { FAKE_ACP_PERMISSION: '1' }, acceptGraceMs: 300 });
  try {
    await port.ensureSession({ cwd: ROOT });
    await port.prompt('sess-1', { content: [{ type: 'text', text: '改文件' }] });
    const permission = await waitFor(() => events.find((event) => event.kind === 'permission'));
    // 用 requestId 直传（另一种调用形状），拒绝走 reject_once。
    const replied = await port.respondPermission({ requestId: permission.requestId }, 'rejected');
    assert.equal(replied.raw.optionId, 'reject-once');
    await assert.rejects(() => port.respondPermission({ requestId: permission.requestId }, 'rejected'), /没有挂起的权限请求/);
  } finally {
    await client.stop();
  }
});

// ── 端到端：模式 / 模型 / agent 名单 ────────────────────────────────────────

test('模式：applyPermission 写 session/set_mode，readPermission 读回当前值', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const { client, port } = harness();
  try {
    await port.ensureSession({ cwd: ROOT });
    const presets = await port.listPermissionPresets();
    assert.deepEqual(presets.options.map((option) => option.value), ['default', 'read-only', 'workspace-write']);
    assert.equal(presets.defaultPreset, 'default');

    const applied = await port.applyPermission('sess-1', 'read-only');
    assert.deepEqual(applied.value, { ok: true, modeId: 'read-only' });
    const read = await port.readPermission('sess-1');
    assert.equal(read.preset, 'read-only');

    // 名单里没有的模式必须拒绝：静默接受会让「已设成只读」成为假象。
    await assert.rejects(() => port.applyPermission('sess-1', 'danger-full-access'), /没有模式 danger-full-access/);
  } finally {
    await client.stop();
  }
});

test('agent 名单与模型目录来自会话 configOptions（没有会话时建探测会话）', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const { client, port, logs } = harness();
  try {
    // 先读名单、后建会话：这正是 bridge 启动时的顺序（刷新权限目录在第一条消息之前）。
    const presets = await port.listPresets();
    assert.deepEqual(presets.presets.map((preset) => preset.id), ['chat', 'readonly']);
    assert.equal(presets.presets[0].isDefault, true);
    assert.ok(logs.some((line) => /探测会话/.test(line)), '探测会话要留痕，不能悄无声息');

    const listed = await port.listModels();
    const group = listed.catalog.groups[0];
    assert.equal(group.id, 'fake-acp', 'provider 用 Agent 自己的名字，不编一个 deepseek-official');
    assert.deepEqual(group.models.map((model) => model.id), ['m1', 'm2']);

    const selected = await port.selectModel('sess-1', { provider: 'fake-acp', model: 'm2' });
    assert.equal(selected.selected.model, 'm2');
    await assert.rejects(() => port.selectModel('sess-1', { model: 'nope' }), /模型目录里没有 nope/);
  } finally {
    await client.stop();
  }
});
