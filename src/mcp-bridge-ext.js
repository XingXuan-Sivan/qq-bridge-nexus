// 扩展 Hub 的 MCP stdio server（由 DSH 的 MCP 客户端 spawn）。
//
// 只暴露三个稳定元工具：
//   ext_list     —— 当前会话可见的外部 MCP / 技能
//   ext_describe —— 某个 server 的工具/schema，或某个技能的正文
//   ext_call     —— 调一个已授权的外部 MCP 工具
//
// 真正的授权、连接和调用都在 bridge（读会话令牌 → 预设策略 → runtime）。
// 本进程只持 Hub 凭据，不拿控制台全权；也不直接读 extensions/ 或 secrets。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadConfig() {
  try {
    let text = fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function hubToken() {
  try {
    return fs.readFileSync(path.join(ROOT, 'state', 'extensions', 'hub-token'), 'utf8').trim();
  } catch {
    return '';
  }
}

function bridgeBase() {
  const port = Number(loadConfig().consolePort) || 3111;
  return `http://127.0.0.1:${port}`;
}

async function hubRequest(action, token, payload) {
  if (!token) throw new Error('缺少会话令牌：请把唤醒提示里的【会话令牌】作为 token 参数传入');
  const headers = {
    'content-type': 'application/json',
    'x-hub-token': hubToken(),
    'x-agent-token': token,
    'x-agent-call': '1',
  };
  const res = await fetch(`${bridgeBase()}/api/extensions/hub/${action}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ token, ...payload }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { ok: false, error: text.slice(0, 500) }; }
  if (!res.ok || body?.ok === false) {
    const error = new Error(body?.error ?? `Hub 请求失败（HTTP ${res.status}）`);
    error.code = body?.code;
    throw error;
  }
  return body;
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

const server = new McpServer({ name: 'bridge-ext', version: '0.1.0' });

server.tool(
  'ext_list',
  '列出当前会话可见的扩展（外部 MCP server 与技能）。需要把唤醒提示中的会话令牌作为 token 传入。',
  {
    token: z.string().describe('当前会话令牌（唤醒提示中的【会话令牌】）'),
    kind: z.enum(['all', 'mcp', 'skills']).optional().describe('只看某一类；默认全部'),
    query: z.string().optional().describe('按 id/名称/说明过滤'),
  },
  async ({ token, kind, query }) => textResult(await hubRequest('list', token, { kind, query }))
);

server.tool(
  'ext_describe',
  '查看一个外部 MCP server 的工具与参数 schema，或读取一个技能的正文。需要会话令牌。',
  {
    token: z.string().describe('当前会话令牌'),
    server: z.string().optional().describe('外部 MCP server id'),
    tool: z.string().optional().describe('只看该 server 下的某个工具'),
    skill: z.string().optional().describe('技能 id；传了就返回 SKILL.md 正文'),
  },
  async ({ token, server: serverId, tool, skill }) => textResult(await hubRequest('describe', token, { server: serverId, tool, skill }))
);

server.tool(
  'ext_call',
  '调用一个已授权的外部 MCP 工具。参数必须符合 ext_describe 返回的 schema；需要会话令牌。',
  {
    token: z.string().describe('当前会话令牌'),
    server: z.string().describe('外部 MCP server id'),
    tool: z.string().describe('工具名'),
    args: z.record(z.string(), z.unknown()).optional().describe('工具参数对象'),
  },
  async ({ token, server: serverId, tool, args }) => textResult(await hubRequest('call', token, { server: serverId, tool, args }))
);

await server.connect(new StdioServerTransport());
