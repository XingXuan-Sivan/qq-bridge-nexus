// 外部 MCP 运行时：懒连接、单飞、超时、错误隔离、stderr 环形日志。
// 只和外部 server 通信，不读 bridge 内存；授权由 hub 在调用前完成。
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const INIT_TIMEOUT_MS = 30000;
const MAX_TIMER_MS = 300000;
const LOG_MAX_BYTES = 200000;

export class McpRuntimeError extends Error {
  constructor(message, code = 'runtime') {
    super(message);
    this.name = 'McpRuntimeError';
    this.code = code;
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new McpRuntimeError(message, 'timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function redact(line) {
  return String(line)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(token|secret|password|authorization)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted-key]');
}

function normalizeTool(tool) {
  return {
    name: String(tool?.name ?? ''),
    description: String(tool?.description ?? ''),
    inputSchema: tool?.inputSchema && typeof tool.inputSchema === 'object'
      ? tool.inputSchema
      : { type: 'object', properties: {} },
    annotations: tool?.annotations && typeof tool.annotations === 'object' ? tool.annotations : {},
  };
}

function typeMatches(type, value) {
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  return true;
}

export function validateToolArgs(schema, value, pathText = 'arguments', depth = 0) {
  if (depth > 6) return value;
  if (!schema || typeof schema !== 'object') return value;
  if (schema.anyOf || schema.oneOf) {
    const list = schema.anyOf || schema.oneOf;
    const errors = [];
    for (const item of list) {
      try { validateToolArgs(item, value, pathText, depth + 1); return value; } catch (error) { errors.push(error.message); }
    }
    throw new McpRuntimeError(`${pathText} 不符合任何允许的结构：${errors.slice(0, 2).join(' / ')}`, 'invalid_args');
  }
  if (Array.isArray(schema.type)) {
    if (!schema.type.some((type) => typeMatches(type, value))) throw new McpRuntimeError(`${pathText} 类型不符合 ${schema.type.join('|')}`, 'invalid_args');
  } else if (schema.type && !typeMatches(schema.type, value)) {
    throw new McpRuntimeError(`${pathText} 类型不符合 ${schema.type}`, 'invalid_args');
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    throw new McpRuntimeError(`${pathText} 不在允许的枚举值内`, 'invalid_args');
  }
  if (schema.type === 'object' || (schema.properties && typeof schema.properties === 'object')) {
    const obj = value ?? {};
    if (!typeMatches('object', obj)) throw new McpRuntimeError(`${pathText} 必须是对象`, 'invalid_args');
    for (const key of Array.isArray(schema.required) ? schema.required : []) {
      if (!Object.hasOwn(obj, key)) throw new McpRuntimeError(`${pathText}.${key} 是必填项`, 'invalid_args');
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(obj, key)) validateToolArgs(child, obj[key], `${pathText}.${key}`, depth + 1);
    }
  }
  return value;
}

function defaultCreateConnection(config, { secretStore, onStderr }) {
  const env = secretStore ? secretStore.materialize(config.env ?? {}) : {};
  const headers = secretStore ? secretStore.materialize(config.headers ?? {}) : {};
  if (config.transport === 'stdio') {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      cwd: config.cwd || undefined,
      env: Object.fromEntries(Object.entries({ ...process.env, ...env }).filter(([, v]) => typeof v === 'string')),
      stderr: 'pipe',
    });
    if (transport.stderr) transport.stderr.on('data', (chunk) => onStderr(String(chunk)));
    const client = new Client({ name: 'qq-bridge-ext', version: '1.0.0' });
    return { client, transport };
  }
  const url = new URL(config.url);
  const options = { requestInit: { headers } };
  const transport = config.transport === 'sse'
    ? new SSEClientTransport(url, options)
    : new StreamableHTTPClientTransport(url, options);
  const client = new Client({ name: 'qq-bridge-ext', version: '1.0.0' });
  return { client, transport };
}

export function createMcpRuntime({
  store,
  secretStore = null,
  logsDir,
  log = () => {},
  createConnection = defaultCreateConnection,
  now = Date.now,
} = {}) {
  if (!store) throw new Error('createMcpRuntime: 缺少 store');
  if (!logsDir) throw new Error('createMcpRuntime: 缺少 logsDir');
  fs.mkdirSync(logsDir, { recursive: true });
  const states = new Map();
  const starting = new Map();

  function logFile(id) {
    return path.join(logsDir, `${id}.log`);
  }

  function appendLog(id, line) {
    const text = redact(line).trim();
    if (!text) return;
    const file = logFile(id);
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      try {
        const stat = fs.statSync(file);
        if (stat.size > LOG_MAX_BYTES) fs.truncateSync(file, 0);
      } catch {}
      fs.appendFileSync(file, `${new Date(now()).toISOString()} ${text}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      log(`[extensions] 写 MCP 日志失败 ${id}: ${error?.message ?? error}`);
    }
  }

  function stateOf(id, config) {
    let state = states.get(id);
    if (!state) {
      state = { status: 'stopped', tools: [], error: null, client: null, transport: null, connectedAt: 0, lastUsedAt: 0 };
      states.set(id, state);
    }
    if (config?.enabled === false && state.status !== 'disabled') {
      state.status = 'disabled';
      state.tools = [];
    }
    return state;
  }

  function snapshot(id, config, state) {
    return {
      id,
      name: config?.name ?? id,
      description: config?.description ?? '',
      trust: config?.trust ?? 'owner',
      enabled: config?.enabled !== false,
      transport: config?.transport ?? 'stdio',
      status: state.status,
      error: state.error,
      toolCount: state.status === 'running' ? state.tools.length : 0,
      connectedAt: state.connectedAt || 0,
      lastUsedAt: state.lastUsedAt || 0,
      tools: state.status === 'running' ? state.tools.map((tool) => ({ name: tool.name, description: tool.description })) : [],
    };
  }

  async function closeState(state, id) {
    try { await state.client?.close?.(); } catch (error) {
      log(`[extensions] 关闭 MCP ${id} 失败: ${error?.message ?? error}`);
    }
    try { await state.transport?.close?.(); } catch {}
    state.client = null;
    state.transport = null;
    state.tools = [];
  }

  async function start(id) {
    const config = store.get(id);
    if (config.enabled === false) {
      const state = stateOf(id, config);
      state.status = 'disabled';
      state.tools = [];
      return state;
    }
    const current = stateOf(id, config);
    if (current.status === 'running') return current;
    if (starting.has(id)) return starting.get(id);
    const task = (async () => {
      const state = stateOf(id, config);
      state.status = 'connecting';
      state.error = null;
      appendLog(id, `connect ${config.transport}`);
      try {
        const connection = await withTimeout(
          Promise.resolve(createConnection(config, { secretStore, onStderr: (line) => appendLog(id, `stderr ${line}`) })),
          INIT_TIMEOUT_MS,
          '初始化连接超时',
        );
        state.client = connection.client;
        state.transport = connection.transport;
        await withTimeout(connection.client.connect(connection.transport), INIT_TIMEOUT_MS, '连接超时');
        const listed = await withTimeout(connection.client.listTools(), INIT_TIMEOUT_MS, 'tools/list 超时');
        state.tools = (listed?.tools ?? []).map(normalizeTool).filter((tool) => tool.name);
        state.status = 'running';
        state.connectedAt = now();
        state.error = null;
        appendLog(id, `connected tools=${state.tools.length}`);
        return state;
      } catch (error) {
        state.status = 'error';
        state.error = error?.message ?? String(error);
        state.tools = [];
        appendLog(id, `connect failed: ${state.error}`);
        await closeState(state, id);
        throw new McpRuntimeError(`外部 MCP「${id}」连接失败：${state.error}`, error?.code === 'timeout' ? 'timeout' : 'connect');
      } finally {
        starting.delete(id);
      }
    })();
    starting.set(id, task);
    return task;
  }

  async function ensure(id) {
    const config = store.get(id);
    const state = stateOf(id, config);
    if (config.enabled === false) throw new McpRuntimeError(`外部 MCP「${id}」已停用`, 'disabled');
    if (state.status !== 'running') await start(id);
    return { config, state: stateOf(id, config) };
  }

  async function listTools(id, { refresh = false } = {}) {
    const { state } = await ensure(id);
    if (refresh) {
      const listed = await withTimeout(state.client.listTools(), INIT_TIMEOUT_MS, 'tools/list 超时');
      state.tools = (listed?.tools ?? []).map(normalizeTool).filter((tool) => tool.name);
    }
    return state.tools;
  }

  async function call(id, toolName, args = {}) {
    const { config, state } = await ensure(id);
    const tool = state.tools.find((item) => item.name === toolName);
    if (!tool) throw new McpRuntimeError(`外部 MCP「${id}」没有工具 ${toolName}`, 'not_found');
    const payload = validateToolArgs(tool.inputSchema, args);
    state.lastUsedAt = now();
    appendLog(id, `call ${toolName}`);
    try {
      const result = await withTimeout(
        state.client.callTool({ name: toolName, arguments: payload }, undefined, { timeout: config.timeoutMs }),
        Math.min(config.timeoutMs, MAX_TIMER_MS),
        '工具调用超时',
      );
      if (result?.isError) appendLog(id, `tool error ${toolName}`);
      return result;
    } catch (error) {
      state.status = 'error';
      state.error = error?.message ?? String(error);
      appendLog(id, `call failed ${toolName}: ${state.error}`);
      await closeState(state, id);
      throw new McpRuntimeError(`外部 MCP「${id}」调用 ${toolName} 失败：${state.error}`, error?.code === 'timeout' ? 'timeout' : 'call');
    }
  }

  async function test(config) {
    const state = { status: 'stopped', tools: [], client: null, transport: null };
    try {
      const connection = await withTimeout(
        Promise.resolve(createConnection(config, { secretStore, onStderr: (line) => appendLog(config.id, `stderr ${line}`) })),
        INIT_TIMEOUT_MS,
        '初始化连接超时',
      );
      state.client = connection.client;
      state.transport = connection.transport;
      await withTimeout(connection.client.connect(connection.transport), INIT_TIMEOUT_MS, '连接超时');
      const listed = await withTimeout(connection.client.listTools(), INIT_TIMEOUT_MS, 'tools/list 超时');
      state.tools = (listed?.tools ?? []).map(normalizeTool).filter((tool) => tool.name);
      appendLog(config.id, `test ok tools=${state.tools.length}`);
      return { ok: true, tools: state.tools };
    } catch (error) {
      appendLog(config.id, `test failed: ${error?.message ?? error}`);
      return { ok: false, error: error?.message ?? String(error) };
    } finally {
      await closeState(state, config.id);
    }
  }

  async function stop(id) {
    const state = states.get(id);
    if (!state) return { id, status: 'stopped' };
    await closeState(state, id);
    state.status = 'stopped';
    state.error = null;
    return { id, status: 'stopped' };
  }

  async function invalidate(id) {
    await stop(id);
    states.delete(id);
  }

  function list() {
    return store.list().map((config) => {
      const state = stateOf(config.id, config);
      return snapshot(config.id, config, state);
    });
  }

  function logs(id, { limit = 200 } = {}) {
    const file = logFile(id);
    try {
      const text = fs.readFileSync(file, 'utf8');
      return text.split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(1000, Number(limit) || 200)));
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function shutdown() {
    await Promise.all([...states.keys()].map((id) => stop(id)));
  }

  return { start, ensure, listTools, call, test, stop, invalidate, list, logs, shutdown };
}
