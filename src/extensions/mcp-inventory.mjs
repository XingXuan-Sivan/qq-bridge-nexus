// MCP 清单（扩展平台 P1）：不再手写工具名，直接按 DSH 的用法启动 server、
// 走完 initialize → tools/list 后关闭。结果缓存，刷新按钮可强制重扫。
//
// 约束：
// - 只允许清单里的仓库内置 server，路径固定在 ROOT 下，不接收外部路径；
// - 单个 server 连不上/超时只影响自己，返回 error 状态，不拖垮整页；
// - stdio 子进程用当前 node 启动，env 只继承当前进程；
// - 关闭 client 有超时兜底，避免异常 server 把控制台请求挂住。

import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** 桥接仓库自带的三个 stdio MCP server；工具清单由 tools/list 实测。 */
export const BUILTIN_MCP_SERVERS = [
  {
    id: 'snowluma-host',
    name: 'snowluma-host',
    file: 'src/mcp-host-server.js',
    note: 'SnowLuma 网关状态，只读',
  },
  {
    id: 'web-search-safe',
    name: 'web-search-safe',
    file: 'src/mcp-web-search-safe.js',
    note: '只读联网，禁内网地址',
  },
  {
    id: 'snowluma-safe',
    name: 'snowluma-safe',
    file: 'src/mcp-snowluma-safe.js',
    note: '安全版 SnowLuma 工具集；工具名以 server 实际注册为准',
  },
];

function timeout(promise, ms, label) {
  let timer = null;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} opts
 * @param {string} opts.root 仓库根目录
 * @param {Array<object>} [opts.servers] 只允许这些 server（测试可注入假清单）
 * @param {number} [opts.ttlMs] 缓存时长，默认 5 分钟
 * @param {number} [opts.timeoutMs] 单次连接/列工具超时，默认 15s
 * @param {() => number} [opts.now]
 * @param {object} [opts.log]
 * @param {(server: object) => Promise<object>} [opts.readServer] 测试注入；默认真实 stdio
 */
export function createMcpInventory({
  root,
  servers = BUILTIN_MCP_SERVERS,
  ttlMs = 5 * 60_000,
  timeoutMs = 15_000,
  now = Date.now,
  log = () => {},
  readServer = null,
} = {}) {
  if (!root) throw new Error('createMcpInventory 需要 root');
  const list = servers.map((server) => ({ ...server }));
  let cache = null; // { at, servers }
  let inflight = null;

  async function readViaStdio(server) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, server.file)],
      cwd: root,
      env: process.env,
    });
    const client = new Client({ name: 'qq-bridge-extension-catalog', version: '0.1.0' });
    try {
      await timeout(client.connect(transport), timeoutMs, `${server.name} initialize`);
      const result = await timeout(client.listTools(), timeoutMs, `${server.name} tools/list`);
      const tools = (result?.tools ?? []).map((tool) => ({
        name: String(tool?.name ?? ''),
        description: String(tool?.description ?? ''),
      })).filter((tool) => tool.name);
      return { ...server, status: 'online', toolCount: tools.length, tools };
    } catch (error) {
      const message = String(error?.message ?? error);
      log(`[extensions] ${server.name} tools/list 失败：${message}`);
      return { ...server, status: 'error', toolCount: 0, tools: [], error: message };
    } finally {
      try { await timeout(client.close(), 3_000, `${server.name} close`); } catch {}
    }
  }

  const read = readServer ?? readViaStdio;

  async function scan() {
    const results = await Promise.all(list.map(async (server) => {
      try {
        const row = await read(server);
        return {
          ...server,
          ...row,
          toolCount: Number(row?.toolCount) || 0,
          tools: Array.isArray(row?.tools) ? row.tools : [],
          status: row?.status === 'error' ? 'error' : 'online',
        };
      } catch (error) {
        const message = String(error?.message ?? error);
        log(`[extensions] ${server.name} 读取异常：${message}`);
        return { ...server, status: 'error', toolCount: 0, tools: [], error: message };
      }
    }));
    return results;
  }

  async function snapshot({ refresh = false } = {}) {
    if (refresh) cache = null;
    if (cache && now() - cache.at < ttlMs) return cache;
    if (inflight) return inflight;
    inflight = scan()
      .then((rows) => {
        cache = { at: now(), servers: rows };
        return cache;
      })
      .finally(() => { inflight = null; });
    return inflight;
  }

  return { snapshot, invalidate: () => { cache = null; } };
}
