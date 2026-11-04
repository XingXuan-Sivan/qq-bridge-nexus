// /api/commands 的响应体（P7 第二步从 bridge.js 抽出的组装逻辑）。
//
// 三个来源分开返回，页面自己标来源；桥接不假装能管 DSH 的命令与工具（见 docs/COMMAND_REGISTRY.md）。
// 这里只做分组与常量清单，不碰注册表的内部结构——入参就是 registry.list() 的结果数组。

/** DSH 自己的斜杠命令：桥接只在特定时机调用，执行方是 DSH。 */
const DSH_COMMANDS = Object.freeze([
  Object.freeze({ name: '/compact', note: '桥接在上下文压缩时调用，由 DSH 执行' }),
  Object.freeze({ name: '/permission', note: 'closed-agent 会话钉权限预设时调用，由 DSH 执行' }),
]);

/** 桥接自带的 MCP server 暴露给 DSH 的工具：只读展示，启停归 DSH。 */
const BRIDGE_TOOLS = Object.freeze([
  Object.freeze({ name: 'web_search', source: 'src/mcp-web-search-safe.js', managed: 'dsh' }),
  Object.freeze({ name: 'web_fetch', source: 'src/mcp-web-search-safe.js', managed: 'dsh' }),
  Object.freeze({ name: 'snowluma_status', source: 'src/mcp-host-server.js', managed: 'dsh' }),
]);

/**
 * @param {{ list: () => Array<object> }} registry
 * @returns {{ ok: true, bridge: { builtin: object[], plugin: object[] }, dsh: object[], tools: object[] }}
 */
export function buildCommandsPayload(registry) {
  const entries = registry.list();
  return {
    ok: true,
    bridge: {
      builtin: entries.filter((entry) => entry.source === 'bridge'),
      plugin: entries.filter((entry) => entry.source === 'plugin'),
    },
    dsh: [...DSH_COMMANDS],
    tools: [...BRIDGE_TOOLS],
  };
}
