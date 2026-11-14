// 假 ACP agent：给 src/agent-side/adapters/acp/ 的离线回归当对端。
//
// 为什么不是 mock 传输而是真子进程：ACP 的契约有一半在「进程边界」上 ——
// 关 stdin 即断开、进程退出时挂起请求必须失败、Agent 会反向发请求。把传输
// mock 掉，这三点就全测不到。
//
// 行为全部由请求驱动，用例通过环境变量挑分支：
//   FAKE_ACP_BAD_STDOUT=1   在 initialize 前打一行非 JSON（模拟 Agent 把日志写进 stdout）
//   FAKE_ACP_FAIL_NEW=1     session/new 回错误（测「拒绝受理」而不是抛异常的路径）
//   FAKE_ACP_FAIL_PROMPT=1  session/prompt 回 JSON-RPC 错误（测受理制的 ok:false 分支）
//   FAKE_ACP_NO_LIST=1      不声明 sessionCapabilities.list
//   FAKE_ACP_NO_CLOSE=1     不声明 sessionCapabilities.close
//   FAKE_ACP_PERMISSION=1   session/prompt 期间反向请求 session/request_permission
//   FAKE_ACP_TOOL=1         session/prompt 期间发 tool_call / tool_call_update
//   FAKE_ACP_SLOW=1         session/prompt 延迟 500ms 才返回（测不阻塞受理）
//   FAKE_ACP_NO_REPLY=1     收到 session/prompt 后不回任何东西（测「进程退出时挂起请求失败」）
//   FAKE_ACP_UNKNOWN_CALL=1 prompt 期间反向请求一个客户端没注册的方法（测 -32601 回执）
//
// 所有非协议输出一律走 stderr —— stdout 只允许 NDJSON，这是 ACP 的硬约束。

import { createInterface } from 'node:readline';

const env = process.env;
const out = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`);
const note = (text) => process.stderr.write(`[fake-acp] ${text}\n`);

const sessions = [];
const pending = new Map(); // 本 agent 发出的请求，等客户端回
let serverSeq = 1;
let promptCount = 0;

const reply = (id, result) => out({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => out({ jsonrpc: '2.0', id, error: { code, message } });
const emitUpdate = (sessionId, update) => out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } });

/** Agent → Client 的反向请求。客户端不回，它会一直等；这正是要测的点。 */
function ask(method, params) {
  const id = `srv-${serverSeq}`;
  serverSeq += 1;
  return new Promise((resolve, reject) => {
    pending.set(String(id), { resolve, reject });
    out({ jsonrpc: '2.0', id, method, params });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function onPrompt(id, params) {
  const sessionId = String(params?.sessionId ?? '');
  promptCount += 1;
  const text = (params?.prompt ?? [])
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('');
  note(`prompt #${promptCount} session=${sessionId} text=${text.slice(0, 40)}`);

  if (env.FAKE_ACP_NO_REPLY === '1') {
    note('FAKE_ACP_NO_REPLY：不回 session/prompt，等客户端断开');
    return;
  }

  if (env.FAKE_ACP_FAIL_PROMPT === '1') {
    fail(id, -32000, 'session/prompt rejected by policy');
    return;
  }

  if (env.FAKE_ACP_SLOW === '1') await sleep(500);

  emitUpdate(sessionId, {
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: '先想一想' },
  });
  emitUpdate(sessionId, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: `收到：${text}` },
  });

  if (env.FAKE_ACP_TOOL === '1') {
    emitUpdate(sessionId, {
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: '读一个文件',
      kind: 'read',
      status: 'pending',
    });
    emitUpdate(sessionId, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
    });
  }

  if (env.FAKE_ACP_UNKNOWN_CALL === '1') {
    try {
      await ask('session/definitely_not_implemented', { sessionId });
    } catch (error) {
      // 客户端回 -32601 就是这条路的正确结果；记在 stderr 上供断言。
      note(`unknown-method rejected: ${error?.code}`);
    }
  }

  if (env.FAKE_ACP_PERMISSION === '1') {
    const outcome = await ask('session/request_permission', {
      sessionId,
      toolCall: { toolCallId: 't1', title: '改一个文件', kind: 'edit', status: 'pending' },
      options: [
        { optionId: 'allow-once', name: '允许一次', kind: 'allow_once' },
        { optionId: 'reject-once', name: '拒绝', kind: 'reject_once' },
        { optionId: 'allow-always', name: '总是允许', kind: 'allow_always' },
      ],
    });
    emitUpdate(sessionId, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: `权限结果 ${JSON.stringify(outcome)}` },
    });
  }

  reply(id, { stopReason: 'end_turn' });
}

async function onRequest(frame) {
  const { id, method, params } = frame;
  switch (method) {
    case 'initialize': {
      if (env.FAKE_ACP_BAD_STDOUT === '1') process.stdout.write('fake-acp: 这行不是 JSON\n');
      const wanted = Number(params?.protocolVersion ?? 1);
      // 契约：回选「≤ 请求版本的自己支持的最高版本」。
      reply(id, {
        protocolVersion: Math.min(Number.isFinite(wanted) ? wanted : 1, 1),
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: {
            list: env.FAKE_ACP_NO_LIST !== '1',
            close: env.FAKE_ACP_NO_CLOSE !== '1',
            resume: true,
            delete: false,
          },
          promptCapabilities: { image: true, audio: false, embeddedContext: false },
        },
        authMethods: [],
        info: { name: 'fake-acp', version: '0.0.1' },
      });
      return;
    }
    case 'session/new': {
      if (env.FAKE_ACP_FAIL_NEW === '1') {
        fail(id, -32000, 'session/new rejected by policy');
        return;
      }
      const sessionId = `sess-${sessions.length + 1}`;
      sessions.push({ sessionId, title: '', cwd: String(params?.cwd ?? ''), updatedAt: new Date().toISOString() });
      reply(id, {
        sessionId,
        modes: {
          currentModeId: 'default',
          availableModes: [
            { id: 'default', name: 'Default' },
            { id: 'read-only', name: '只读' },
            { id: 'workspace-write', name: '工作区可写' },
          ],
        },
        configOptions: [
          {
            id: 'model',
            name: '模型',
            category: 'model',
            type: 'select',
            currentValue: 'm1',
            options: [{ value: 'm1', name: 'M1' }, { value: 'm2', name: 'M2' }],
          },
          {
            id: 'agent',
            name: 'Agent',
            type: 'select',
            currentValue: 'chat',
            options: [{ value: 'chat', name: 'Chat' }, { value: 'readonly', name: '只读' }],
          },
        ],
      });
      return;
    }
    case 'session/list': {
      reply(id, { sessions, nextCursor: null });
      return;
    }
    case 'session/load': {
      const sessionId = String(params?.sessionId ?? '');
      if (!sessions.some((s) => s.sessionId === sessionId)) {
        fail(id, -32000, 'session not found');
        return;
      }
      reply(id, { modes: { currentModeId: 'default', availableModes: [] }, configOptions: [] });
      return;
    }
    case 'session/set_mode': {
      const sessionId = String(params?.sessionId ?? '');
      emitUpdate(sessionId, { sessionUpdate: 'current_mode_update', currentModeId: String(params?.modeId ?? '') });
      reply(id, {});
      return;
    }
    case 'session/set_config_option':
    case 'session/set_model': {
      reply(id, {});
      return;
    }
    case 'session/close': {
      const sessionId = String(params?.sessionId ?? '');
      const index = sessions.findIndex((s) => s.sessionId === sessionId);
      if (index >= 0) sessions.splice(index, 1);
      reply(id, {});
      return;
    }
    case 'session/prompt': {
      await onPrompt(id, params);
      return;
    }
    default: {
      note(`未实现的方法：${method}`);
      fail(id, -32601, `unsupported method: ${method}`);
    }
  }
}

function onNotification(frame) {
  const { method, params } = frame;
  if (method === 'session/cancel') {
    note(`cancel session=${params?.sessionId}`);
    return;
  }
  note(`通知：${method}`);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    note(`无法解析：${text.slice(0, 120)}`);
    return;
  }
  // 客户端回的响应：唤醒对应的反向请求。
  if (msg.id !== undefined && msg.method === undefined) {
    const entry = pending.get(String(msg.id));
    if (!entry) {
      note(`无人认领的响应 id=${msg.id}`);
      return;
    }
    pending.delete(String(msg.id));
    if (msg.error) entry.reject(Object.assign(new Error(msg.error.message ?? 'error'), { code: msg.error.code }));
    else entry.resolve(msg.result ?? null);
    return;
  }
  if (typeof msg.method !== 'string') {
    note('报文缺少 method');
    return;
  }
  if (msg.id === undefined) {
    onNotification(msg);
    return;
  }
  onRequest(msg).catch((error) => fail(msg.id, -32603, String(error?.message ?? error)));
});

rl.on('close', () => {
  note('stdin 已关闭，退出');
  for (const [, entry] of pending) entry.reject(new Error('连接已关闭'));
  pending.clear();
  process.exit(0);
});
