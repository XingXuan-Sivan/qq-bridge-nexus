// ACP 的 stdio 传输：NDJSON 编解码 + JSON-RPC 2.0 双向分发 + 子进程生命周期。
//
// 与 DSH 的根本差异（PLATFORM_UNIFICATION §9.1）：**谁是 server 反过来了**。
// DSH 是桥接连一个常驻 HTTP 服务；ACP 是桥接 spawn 一个子进程，而且**必须自己也当
// server** —— Agent 会反向发 `session/request_permission` 请求过来，不回它 Agent
// 就永远卡在那一步。所以这个文件里有两套表：
//   · `pending`  —— 我方发出的请求，等对端响应；
//   · `handlers` —— 对端发来的请求，由适配器注册处理函数。
//
// 传输本身只有一种：stdio，每行一条 JSON-RPC 报文。没有「地址」、没有 Cookie、
// 没有会话级鉴权 —— 进程边界就是信任边界。这也是为什么 ACP 的配置只需要
// `command` / `args` / `cwd` / `env` 四项。
//
// 三条硬规则：
//   1. stdout **只能**是 NDJSON。混进半行日志就说明对端实现有问题，必须记下来
//      （打不出提示的话，排查时会误以为是「请求没回」）；
//   2. 子进程一退出，所有挂起请求立刻失败 —— 让它们挂到超时是最难查的一类故障；
//   3. 反向请求未注册处理函数时回 `-32601`，**不能**沉默：沉默会让 Agent 无限等。

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** JSON-RPC 2.0 标准错误码（对端按这个判别，改不得）。 */
export const RPC_ERRORS = Object.freeze({
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
});

/**
 * 处理函数返回这个值表示「我先不回，稍后自己调 respond()/fail()」。
 *
 * 典型用途：`session/request_permission` 要等内核（也就是 QQ 侧）批准，
 * 可能是几十秒之后的事；自动回复会立刻把 Agent 的等待判死。
 */
export const DEFERRED = Symbol('acp.deferred');

/**
 * 把一行文本解成一条 JSON-RPC 报文。纯函数，便于单测覆盖畸形输入。
 *
 * @param {string} line
 * @returns {{kind:'response', id:(string|number), result:any, error:any}
 *   | {kind:'request', id:(string|number), method:string, params:any}
 *   | {kind:'notification', method:string, params:any}
 *   | {kind:'invalid', reason:string, raw:string}}
 */
export function decodeFrame(line) {
  const text = String(line ?? '').trim();
  if (!text) return { kind: 'invalid', reason: 'empty', raw: '' };
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return { kind: 'invalid', reason: 'not-json', raw: text.slice(0, 200) };
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return { kind: 'invalid', reason: 'not-object', raw: text.slice(0, 200) };
  }
  const hasId = msg.id !== undefined && msg.id !== null;
  if (typeof msg.method === 'string' && msg.method) {
    if (!hasId) return { kind: 'notification', method: msg.method, params: msg.params ?? null };
    return { kind: 'request', id: msg.id, method: msg.method, params: msg.params ?? null };
  }
  if (hasId && ('result' in msg || 'error' in msg)) {
    return { kind: 'response', id: msg.id, result: msg.result ?? null, error: msg.error ?? null };
  }
  return { kind: 'invalid', reason: 'unclassifiable', raw: text.slice(0, 200) };
}

/** 把 JSON-RPC 的 error 对象翻成带 `code` / `method` 的 Error（内核按 code 分类）。 */
export function toRpcError(error, method = '') {
  const code = error?.code;
  const message = String(error?.message ?? error ?? 'ACP 调用失败');
  const wrapped = new Error(method ? `${method} failed: ${code ?? ''}: ${message}` : message);
  if (code !== undefined) wrapped.code = code;
  if (method) wrapped.method = method;
  if (error?.data !== undefined) wrapped.data = error.data;
  return wrapped;
}

/**
 * 建一份 ACP stdio 客户端。**不会**在构造时 spawn —— 调用方（适配器）第一次发请求
 * 时才起进程，这样「没配 ACP」的部署完全不受影响。
 *
 * @param {object} spec
 * @param {string} spec.command  可执行文件（Windows 下若是 `.cmd`/`.bat` 需显式开 `shell`）
 * @param {string[]} [spec.args]
 * @param {string} [spec.cwd]
 * @param {object} [spec.env]    追加到 `process.env` 之上
 * @param {boolean} [spec.shell]
 * @param {number} [spec.requestTimeoutMs]  缺省请求的超时；0 = 不超时（prompt 会跑很久）
 * @param {(level:string,text:string)=>void} [spec.logger]
 * @param {number} [spec.maxStderrLines]
 */
export function createAcpClient({
  command,
  args = [],
  cwd = '',
  env = {},
  shell = false,
  requestTimeoutMs = 0,
  logger = () => {},
  maxStderrLines = 200,
} = {}) {
  if (!String(command ?? '').trim()) throw new Error('createAcpClient: 缺少 command');

  let child = null;
  let reader = null;
  let nextId = 1;
  let stopping = false;
  let exitInfo = null; // { code, signal, at }
  let spawnError = null;
  let startedAt = 0;

  /** 我方发出、等响应的请求。key 是 String(id)：JSON-RPC 允许 id 是数字或字符串。 */
  const pending = new Map();
  /** 对端发来的请求的方法名 → 处理函数。 */
  const handlers = new Map();
  /** 生命周期事件（exit / stderr / protocol-error / spawn）。 */
  const listeners = new Map();
  /** stderr 环形缓冲：Agent 起不来时唯一的线索通常只在这里。 */
  const stderrLines = [];

  const emit = (event, payload) => {
    for (const fn of listeners.get(event) ?? []) {
      try { fn(payload); } catch (error) { logger('error', `ACP 事件处理抛错（${event}）：${error?.message ?? error}`); }
    }
  };

  const on = (event, fn) => {
    if (typeof fn !== 'function') return () => {};
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(fn);
    return () => {
      const list = listeners.get(event) ?? [];
      const index = list.indexOf(fn);
      if (index >= 0) list.splice(index, 1);
    };
  };

  /** 写一行 NDJSON。进程已死时抛错，而不是让 JSON 悄悄写进一个已关闭的管道。 */
  const writeLine = (payload) => {
    if (!child?.stdin || child.stdin.destroyed || child.stdin.writableEnded) {
      throw new Error('ACP agent 未运行（stdin 不可写）');
    }
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  };

  const settleAll = (error) => {
    for (const [key, entry] of pending) {
      pending.delete(key);
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(error);
    }
  };

  const respondRaw = (id, payload) => {
    try {
      writeLine({ jsonrpc: '2.0', id, ...payload });
    } catch (error) {
      logger('warn', `ACP 回执失败（id=${id}）：${error?.message ?? error}`);
    }
  };

  /** 主动回一条挂起请求（供 DEFERRED 的处理函数稍后调用）。 */
  const respond = (id, result = null) => respondRaw(id, { result });
  const fail = (id, code, message, data) => respondRaw(id, {
    error: { code: code ?? RPC_ERRORS.internal, message: String(message ?? 'error'), ...(data === undefined ? {} : { data }) },
  });

  const runHandler = (frame) => {
    const handler = handlers.get(frame.method);
    if (!handler) {
      // 沉默会让 Agent 永远等下去；必须明确拒绝。
      logger('warn', `ACP 收到未处理的请求：${frame.method}`);
      if (frame.kind === 'request') fail(frame.id, RPC_ERRORS.methodNotFound, `unsupported method: ${frame.method}`);
      return;
    }
    const ctx = { id: frame.id, method: frame.method, deferred: frame.kind === 'request' };
    Promise.resolve()
      .then(() => handler(frame.params, ctx))
      .then((result) => {
        if (result === DEFERRED || frame.kind !== 'request') return;
        respond(frame.id, result ?? null);
      })
      .catch((error) => {
        logger('warn', `ACP 处理 ${frame.method} 失败：${error?.message ?? error}`);
        if (frame.kind === 'request') fail(frame.id, error?.code ?? RPC_ERRORS.internal, error?.message ?? error);
      });
  };

  const handleLine = (line) => {
    const frame = decodeFrame(line);
    if (frame.kind === 'invalid') {
      // 常见成因：Agent 把日志打到了 stdout。记下来，否则表现为「请求不回」。
      emit('protocol-error', frame);
      logger('warn', `ACP stdout 出现非 NDJSON 内容（${frame.reason}）：${frame.raw}`);
      return;
    }
    if (frame.kind === 'response') {
      const key = String(frame.id);
      const entry = pending.get(key);
      if (!entry) {
        emit('protocol-error', { kind: 'invalid', reason: 'orphan-response', raw: key });
        logger('warn', `ACP 收到无人认领的响应 id=${key}（可能已超时）`);
        return;
      }
      pending.delete(key);
      if (entry.timer) clearTimeout(entry.timer);
      if (frame.error) entry.reject(toRpcError(frame.error, entry.method));
      else entry.resolve(frame.result);
      return;
    }
    runHandler(frame);
  };

  const start = () => {
    if (spawnError) return Promise.reject(spawnError);
    if (child) return Promise.resolve({ pid: child.pid });
    stopping = false;
    exitInfo = null;
    const proc = spawn(command, args, {
      cwd: cwd || undefined,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      // Windows 下不加这个会弹一个黑框；桥接是后台进程，用户不该看见它。
      windowsHide: true,
      shell: !!shell,
    });
    child = proc;
    startedAt = Date.now();
    const ready = new Promise((resolve, reject) => {
      proc.once('spawn', () => {
        logger('info', `ACP agent 已启动（PID ${proc.pid}）：${command} ${args.join(' ')}`.trim());
        emit('spawn', { pid: proc.pid });
        resolve({ pid: proc.pid });
      });
      proc.once('error', (error) => {
        spawnError = error instanceof Error ? error : new Error(String(error));
        child = null;
        logger('error', `ACP agent 启动失败：${spawnError.message}`);
        settleAll(spawnError);
        reject(spawnError);
      });
    });

    reader = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    reader.on('line', handleLine);

    proc.stderr.on('data', (chunk) => {
      const text = String(chunk).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        stderrLines.push(line);
        if (stderrLines.length > maxStderrLines) stderrLines.splice(0, stderrLines.length - maxStderrLines);
        emit('stderr', line);
      }
      logger('insight', `[acp] ${text.trimEnd()}`);
    });

    proc.on('exit', (code, signal) => {
      exitInfo = { code, signal, at: Date.now() };
      child = null;
      try { reader?.close(); } catch { /* 已关闭 */ }
      reader = null;
      // 立刻失败所有挂起请求：挂到超时是最难查的一类故障。
      const reason = stopping
        ? new Error('ACP agent 已停止')
        : new Error(`ACP agent 已退出（code=${code ?? 'null'}${signal ? `, signal=${signal}` : ''}）`);
      settleAll(reason);
      if (!stopping) {
        const tail = stderrLines.slice(-5).join(' | ');
        logger('warn', `ACP agent 意外退出（code=${code ?? 'null'}），stderr 尾部：${tail || '（空）'}`);
      }
      emit('exit', { code, signal, stopping, stderrTail: [...stderrLines] });
    });

    return ready;
  };

  /**
   * 发一条请求并等响应。
   *
   * `timeoutMs` 缺省取构造参数；`0` 表示不超时（`session/prompt` 会阻塞到回合结束，
   * 给它设超时等于给「用户回得慢」判死）。
   */
  const request = async (method, params = {}, { timeoutMs = requestTimeoutMs, signal } = {}) => {
    await start();
    signal?.throwIfAborted?.();
    const id = nextId;
    nextId += 1;
    const promise = new Promise((resolve, reject) => {
      const entry = { resolve, reject, method, timer: null };
      if (timeoutMs > 0) {
        entry.timer = setTimeout(() => {
          if (!pending.has(String(id))) return;
          pending.delete(String(id));
          reject(toRpcError({ code: RPC_ERRORS.internal, message: `请求超时（${timeoutMs}ms）` }, method));
        }, timeoutMs);
        entry.timer.unref?.();
      }
      if (signal) {
        const abort = () => {
          if (!pending.has(String(id))) return;
          pending.delete(String(id));
          if (entry.timer) clearTimeout(entry.timer);
          reject(signal.reason ?? new Error('ACP 请求已取消'));
        };
        signal.addEventListener('abort', abort, { once: true });
        // 响应先到时解绑，避免监听器泄漏（长连接上会累积成内存增长）。
        const wrapResolve = entry.resolve;
        const wrapReject = entry.reject;
        entry.resolve = (value) => { signal.removeEventListener('abort', abort); wrapResolve(value); };
        entry.reject = (error) => { signal.removeEventListener('abort', abort); wrapReject(error); };
      }
      pending.set(String(id), entry);
    });
    try {
      writeLine({ jsonrpc: '2.0', id, method, params });
    } catch (error) {
      const entry = pending.get(String(id));
      pending.delete(String(id));
      if (entry?.timer) clearTimeout(entry.timer);
      throw error;
    }
    return promise;
  };

  /** 发一条通知（无 id，不等响应）。 */
  const notify = (method, params = {}) => {
    // 通知只用于「停止这类事」，进程没起来时静默丢弃比抛错合理：
    // 调用方（cancel / stop）不该因为对端已死而失败。
    if (!child?.stdin || child.stdin.destroyed || child.stdin.writableEnded) return false;
    writeLine({ jsonrpc: '2.0', method, params });
    return true;
  };

  const handle = (method, fn) => {
    const name = String(method ?? '').trim();
    if (!name) throw new Error('createAcpClient.handle: 缺少方法名');
    if (typeof fn !== 'function') throw new Error(`createAcpClient.handle: ${name} 的处理函数必须是函数`);
    handlers.set(name, fn);
    return () => { if (handlers.get(name) === fn) handlers.delete(name); };
  };

  /** 停掉子进程：关 stdin（ACP 约定这等于断开）→ SIGTERM → SIGKILL。 */
  const stop = async ({ timeoutMs = 3000 } = {}) => {
    const proc = child;
    if (!proc) return { already: true };
    stopping = true;
    const exited = new Promise((resolve) => proc.once('exit', () => resolve(true)));
    try { proc.stdin.end(); } catch { /* 已关闭 */ }
    // ACP 要求「关闭 stdin 即断开」，给它一点时间自己收尾再上信号。
    const soft = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(false), Math.min(500, timeoutMs)))]);
    if (!soft) {
      try { proc.kill('SIGTERM'); } catch { /* 已死 */ }
      const hard = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))]);
      if (!hard) {
        try { proc.kill('SIGKILL'); } catch { /* 已死 */ }
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
      }
    }
    return { already: false, exit: exitInfo };
  };

  return {
    start,
    request,
    notify,
    handle,
    respond,
    fail,
    stop,
    on,
    get pid() { return child?.pid ?? null; },
    get alive() { return Boolean(child) && !child.killed && !exitInfo; },
    get startedAt() { return startedAt; },
    get exit() { return exitInfo; },
    get stderrTail() { return [...stderrLines]; },
  };
}
