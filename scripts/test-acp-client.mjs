// ACP stdio 传输层（C6-c）：NDJSON 编解码 + 双向分发 + 子进程生命周期。
//
// 这条回归钉住传输层的五件事：
//   1. 一行一条 JSON-RPC 报文，四种形态（响应 / 请求 / 通知 / 畸形）判别正确；
//   2. **反向请求**能走通：Agent 发 `session/request_permission`，客户端处理函数回执，
//      Agent 拿到 `{ outcome: ... }` 继续跑；
//   3. `DEFERRED` 让处理函数把回执推迟到内核决策之后，而不是立刻自动回；
//   4. 进程退出时**所有挂起请求立即失败**（不是挂到超时 —— 那是最难查的一类故障）；
//   5. 未注册的方法回 `-32601`，不沉默（沉默会让 Agent 无限等）。
//
// 用真子进程而不是 mock 传输：上面第 2/4 条的契约就在进程边界上。

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFERRED,
  RPC_ERRORS,
  createAcpClient,
  decodeFrame,
  toRpcError,
} from '../src/agent-side/adapters/acp/client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'scripts', 'fixtures', 'fake-acp-agent.mjs');

/** 起一个假 ACP agent。`env` 决定它演哪一出。 */
const agent = (env = {}) => createAcpClient({
  command: process.execPath,
  args: [FIXTURE],
  env,
  requestTimeoutMs: 5000,
});

const INIT = { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: true } }, clientInfo: { name: 'test', version: '0' } };

/** 先探一次活；受限沙箱里 spawn 会被拒，这时整组跳过而不是误报失败。 */
let spawnBlocked = null;
async function preflight() {
  if (spawnBlocked === null) {
    const probe = agent();
    try {
      await probe.request('initialize', INIT);
      spawnBlocked = false;
    } catch (error) {
      spawnBlocked = error?.code === 'EPERM' || /EPERM|not permitted/i.test(String(error?.message ?? ''));
    } finally {
      await probe.stop();
    }
  }
  return spawnBlocked;
}

// ── 纯函数 ──────────────────────────────────────────────────────────────────

test('decodeFrame：四种报文形态与畸形输入', () => {
  assert.deepEqual(decodeFrame('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'), {
    kind: 'response', id: 1, result: { ok: true }, error: null,
  });
  assert.deepEqual(decodeFrame('{"jsonrpc":"2.0","id":"a","error":{"code":-32000,"message":"x"}}'), {
    kind: 'response', id: 'a', result: null, error: { code: -32000, message: 'x' },
  });
  assert.deepEqual(decodeFrame('{"jsonrpc":"2.0","id":7,"method":"session/new","params":{"cwd":"/w"}}'), {
    kind: 'request', id: 7, method: 'session/new', params: { cwd: '/w' },
  });
  assert.deepEqual(decodeFrame('{"jsonrpc":"2.0","method":"session/update","params":{"a":1}}'), {
    kind: 'notification', method: 'session/update', params: { a: 1 },
  });
  // 空白行不是错误报文（readline 会给出空行）。
  assert.equal(decodeFrame('').kind, 'invalid');
  assert.equal(decodeFrame('   ').reason, 'empty');
  assert.equal(decodeFrame('not json').reason, 'not-json');
  assert.equal(decodeFrame('[1,2]').reason, 'not-object');
  // 既没 method 也没有 result/error：认不出，必须显式判 invalid 而不是当响应。
  assert.equal(decodeFrame('{"jsonrpc":"2.0","id":1}').reason, 'unclassifiable');
});

test('toRpcError：带上 code 与 method，内核能按 code 分类', () => {
  const error = toRpcError({ code: RPC_ERRORS.methodNotFound, message: 'nope' }, 'session/new');
  assert.equal(error.code, RPC_ERRORS.methodNotFound);
  assert.equal(error.method, 'session/new');
  assert.match(error.message, /session\/new failed: -32601: nope/);
  // 没有 code 时也要能构造（不能因为缺字段就抛 TypeError）。
  assert.equal(toRpcError({}, 'x').code, undefined);
});

// ── 端到端 ──────────────────────────────────────────────────────────────────

test('initialize：拿到协议版本与能力位', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const client = agent();
  try {
    const result = await client.request('initialize', INIT);
    assert.equal(result.protocolVersion, 1);
    assert.equal(result.agentCapabilities.sessionCapabilities.list, true);
    assert.equal(result.agentCapabilities.loadSession, true);
    assert.equal(client.alive, true);
    assert.ok(client.pid > 0);
  } finally {
    await client.stop();
  }
});

test('session/new + session/list：请求与响应按 id 配对', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const client = agent();
  try {
    await client.request('initialize', INIT);
    const created = await client.request('session/new', { cwd: '/w', mcpServers: [] });
    assert.equal(created.sessionId, 'sess-1');
    assert.equal(created.modes.availableModes.length, 3);

    const listed = await client.request('session/list', {});
    assert.deepEqual(listed.sessions.map((s) => s.sessionId), ['sess-1']);
  } finally {
    await client.stop();
  }
});

test('session/prompt：流式通知与阻塞响应可同时进行', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const client = agent();
  const updates = [];
  client.on('protocol-error', (frame) => updates.push({ bad: frame }));
  // Agent → Client 的通知：客户端只收不发，用 handle 之外的方式注册不了，
  // 所以这里用「反向请求」的同一张表注册一个永不被调用的方法占位，
  // 真正的通知观察走 handle('session/update') 不成立（通知没有 id）。
  // 传输层的职责只是把行解析出来；通知的语义归 C6-e 的适配器。
  try {
    await client.request('initialize', INIT);
    await client.request('session/new', { cwd: '/w' });
    const done = await client.request('session/prompt', {
      sessionId: 'sess-1',
      prompt: [{ type: 'text', text: '你好' }],
    });
    assert.equal(done.stopReason, 'end_turn');
    assert.deepEqual(updates, [], 'stdout 里不该出现非 NDJSON 内容');
    // 假 agent 把「收到什么」写在 stderr 上，顺带证明 stderr 尾巴可用。
    assert.ok(client.stderrTail.some((line) => /prompt #1/.test(line)), client.stderrTail.join(' | '));
  } finally {
    await client.stop();
  }
});

test('反向请求：Agent 问权限，客户端回执后它继续跑', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const client = agent({ FAKE_ACP_PERMISSION: '1' });
  const seen = [];
  client.handle('session/request_permission', (params) => {
    seen.push(params);
    return { outcome: { outcome: 'selected', optionId: 'allow-once' } };
  });
  try {
    await client.request('initialize', INIT);
    await client.request('session/new', { cwd: '/w' });
    await client.request('session/prompt', { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'x' }] });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].sessionId, 'sess-1');
    assert.equal(seen[0].options.length, 3);
    assert.ok(client.stderrTail.some((line) => /权限结果/.test(line)) === false, '权限结果只走 session/update');
  } finally {
    await client.stop();
  }
});

test('DEFERRED：回执推迟到内核决策之后', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const client = agent({ FAKE_ACP_PERMISSION: '1' });
  let deferredId = null;
  client.handle('session/request_permission', (_params, ctx) => {
    deferredId = ctx.id;
    // 立刻回会让 Agent 的等待提前结束，模拟「等 QQ 侧批准」必须能拖住。
    setTimeout(() => client.respond(ctx.id, { outcome: { outcome: 'selected', optionId: 'reject-once' } }), 30);
    return DEFERRED;
  });
  try {
    await client.request('initialize', INIT);
    await client.request('session/new', { cwd: '/w' });
    const done = await client.request('session/prompt', { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'x' }] });
    assert.equal(done.stopReason, 'end_turn');
    assert.ok(deferredId !== null, '处理函数应当拿到请求 id');
  } finally {
    await client.stop();
  }
});

test('未注册的方法回 -32601，不沉默', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const client = agent({ FAKE_ACP_UNKNOWN_CALL: '1' });
  const warnings = [];
  client.on('protocol-error', () => {});
  try {
    await client.request('initialize', INIT);
    await client.request('session/new', { cwd: '/w' });
    await client.request('session/prompt', { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'x' }] });
    // 假 agent 把「被拒」记在 stderr：说明它收到的是错误响应而不是一直挂着。
    assert.ok(
      client.stderrTail.some((line) => /unknown-method rejected: -32601/.test(line)),
      client.stderrTail.join(' | '),
    );
    assert.deepEqual(warnings, []);
  } finally {
    await client.stop();
  }
});

test('进程退出时挂起请求立即失败（不是挂到超时）', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const client = agent({ FAKE_ACP_NO_REPLY: '1' });
  try {
    await client.request('initialize', INIT);
    await client.request('session/new', { cwd: '/w' });
    // 这条请求永远等不到响应；stop() 之后必须立刻 reject。
    const hanging = client.request('session/prompt', { sessionId: 'sess-1', prompt: [{ type: 'text', text: 'x' }] });
    hanging.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 100));
    await client.stop();
    await assert.rejects(hanging, /已停止|已退出/);
    assert.equal(client.alive, false);
  } finally {
    await client.stop();
  }
});

test('stdout 混入非 NDJSON：记事件但不影响后续请求', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const client = agent({ FAKE_ACP_BAD_STDOUT: '1' });
  const bad = [];
  client.on('protocol-error', (frame) => bad.push(frame));
  try {
    const result = await client.request('initialize', INIT);
    assert.equal(result.protocolVersion, 1, '坏行之后的正常报文仍要能处理');
    assert.equal(bad.length, 1);
    assert.equal(bad[0].reason, 'not-json');
  } finally {
    await client.stop();
  }
});

test('spawn 失败：请求立刻 reject，且不是超时', async () => {
  const client = createAcpClient({ command: path.join(ROOT, 'no-such-acp-agent-binary'), requestTimeoutMs: 5000 });
  await assert.rejects(() => client.request('initialize', INIT), (error) => {
    assert.notEqual(error.code, RPC_ERRORS.internal);
    assert.doesNotMatch(error.message, /超时/);
    return true;
  });
  assert.equal(client.alive, false);
  // 已经死了之后 stop 不该抛错。
  await client.stop();
});

test('notify 在未启动时返回 false 而不是抛错（cancel 不该因对端已死而失败）', () => {
  const client = agent();
  assert.equal(client.notify('session/cancel', { sessionId: 'x' }), false);
});

test('stop 幂等：重复调用不抛错', async (t) => {
  if (await preflight()) return t.skip('本环境不允许 spawn 子进程（EPERM）');
  const client = agent();
  await client.request('initialize', INIT);
  await client.stop();
  await client.stop();
  assert.equal(client.alive, false);
  assert.ok(client.exit, 'stop 之后要能拿到退出信息');
});
