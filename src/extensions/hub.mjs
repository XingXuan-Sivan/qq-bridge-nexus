// 扩展 Hub 的授权与聚合逻辑：只把当前会话 preset 允许的外部 MCP/工具暴露给模型。
// 真正的连接与调用在 mcp-runtime；这里不碰文件、不执行命令。
import { mcpServerAllowed, mcpToolAllowed, skillAllowed } from './preset-policy.mjs';

export class HubError extends Error {
  constructor(message, code = 'hub_error') {
    super(message);
    this.name = 'HubError';
    this.code = code;
  }
}

function allowedTools(policy, serverId, tools) {
  return (tools ?? []).filter((tool) => mcpToolAllowed(policy, serverId, tool.name));
}

export function createExtensionHub({ catalog, runtime, policyFor, readSkill = null }) {
  if (!catalog) throw new Error('createExtensionHub: 缺少 catalog');
  if (!runtime) throw new Error('createExtensionHub: 缺少 runtime');
  if (typeof policyFor !== 'function') throw new Error('createExtensionHub: 缺少 policyFor');

  function policyOf(preset) {
    try {
      return policyFor(preset);
    } catch (error) {
      throw new HubError(`预设策略不可用：${error?.message ?? error}`, 'policy');
    }
  }

  function mcpView(policy, item) {
    const tools = allowedTools(policy, item.id, item.tools);
    return {
      id: item.id,
      name: item.name,
      description: item.description ?? '',
      source: 'external',
      transport: item.transport,
      enabled: item.enabled !== false,
      status: item.status,
      error: item.error ?? null,
      toolCount: tools.length,
      tools,
    };
  }

  async function list({ preset, kind = 'all', query = '' } = {}) {
    if (!preset) throw new HubError('缺少 preset', 'invalid');
    const policy = policyOf(preset);
    const snapshot = await catalog.snapshot();
    const q = String(query ?? '').trim().toLowerCase();
    const servers = runtime.list()
      .filter((item) => mcpServerAllowed(policy, item.id))
      .map((item) => mcpView(policy, item))
      .filter((item) => !q
        || item.id.toLowerCase().includes(q)
        || item.name.toLowerCase().includes(q)
        || item.description.toLowerCase().includes(q));
    const skills = (snapshot.skills ?? [])
      .filter((item) => skillAllowed(policy, item.id))
      .filter((item) => !q || item.id.toLowerCase().includes(q) || item.name.toLowerCase().includes(q));
    const out = {
      preset,
      mcp: kind === 'skills' ? [] : servers,
      skills: kind === 'mcp' ? [] : skills,
      summary: {
        servers: kind === 'skills' ? 0 : servers.length,
        tools: kind === 'skills' ? 0 : servers.reduce((sum, item) => sum + item.toolCount, 0),
        skills: kind === 'mcp' ? 0 : skills.length,
      },
    };
    return out;
  }

  function findServer(preset, id) {
    const policy = policyOf(preset);
    if (!mcpServerAllowed(policy, id)) throw new HubError(`当前预设不允许外部 MCP「${id}」`, 'forbidden');
    const item = runtime.list().find((server) => server.id === id);
    if (!item) throw new HubError(`外部 MCP「${id}」不存在`, 'not_found');
    return { policy, item };
  }

  async function describe({ preset, server, tool, skill } = {}) {
    const policy = policyOf(preset);
    if (skill) {
      const id = String(skill).trim();
      if (!id || !skillAllowed(policy, id)) throw new HubError(`当前预设不允许技能「${id}」`, 'forbidden');
      const snapshot = await catalog.snapshot();
      const entry = (snapshot.skills ?? []).find((item) => item.id === id);
      if (!entry || entry.active === false) throw new HubError(`技能「${id}」不存在或已停用`, 'not_found');
      if (typeof readSkill !== 'function') throw new HubError('技能正文读取未配置', 'unavailable');
      const content = await readSkill(id);
      return { preset, skill: { ...entry, content } };
    }
    const { policy: resolvedPolicy, item } = findServer(preset, server);
    // 描述必须拿到真实 schema：未连接时按需拉起一次，不能把 stopped 的空工具表当成“没有工具”。
    await runtime.listTools(server);
    const connected = runtime.list().find((entry) => entry.id === server) ?? item;
    const view = mcpView(resolvedPolicy, connected);
    if (!tool) {
      return {
        preset,
        server: {
          ...view,
          tools: view.tools,
        },
      };
    }
    if (!mcpToolAllowed(resolvedPolicy, server, tool)) throw new HubError(`当前预设不允许工具「${tool}」`, 'forbidden');
    await runtime.listTools(server);
    const after = runtime.list().find((entry) => entry.id === server);
    const detail = mcpView(resolvedPolicy, after ?? item).tools.find((entry) => entry.name === tool);
    if (!detail) throw new HubError(`外部 MCP「${server}」没有工具「${tool}」`, 'not_found');
    return { preset, server: server, tool: detail };
  }

  async function call({ preset, server, tool, args = {}, token = '' } = {}) {
    if (!preset) throw new HubError('缺少 preset', 'invalid');
    if (!server || !tool) throw new HubError('缺少 server 或 tool', 'invalid');
    const { policy } = findServer(preset, server);
    if (!mcpToolAllowed(policy, server, tool)) throw new HubError(`当前预设不允许工具「${tool}」`, 'forbidden');
    const result = await runtime.call(server, tool, args ?? {});
    return {
      preset,
      server,
      tool,
      isError: Boolean(result?.isError),
      content: result?.content ?? [],
      structuredContent: result?.structuredContent ?? null,
    };
  }

  return { list, describe, call };
}
