// 扩展 catalog（P1）：MCP 与技能的只读统一视图。
//
// 现在只负责“看到真实条目”，不做安装/启用/权限；这些动作在 P2+ 接 Hub。
// 返回值固定带 version，页面与测试可以按版本演进，不再依赖散落的字面量。

/**
 * @param {object} opts
 * @param {{ list: () => Array<object> }} opts.skillIndex
 * @param {{ snapshot: (opts?: object) => Promise<{ at: number, servers: Array<object> }> }} opts.mcpInventory
 * @param {() => number} [opts.now]
 */
export function createExtensionCatalog({ skillIndex, mcpInventory, now = Date.now } = {}) {
  if (!skillIndex || typeof skillIndex.list !== 'function') throw new Error('createExtensionCatalog 需要 skillIndex.list');
  if (!mcpInventory || typeof mcpInventory.snapshot !== 'function') throw new Error('createExtensionCatalog 需要 mcpInventory.snapshot');

  async function snapshot({ refresh = false } = {}) {
    const skills = skillIndex.list().map((entry) => ({
      id: String(entry?.id ?? entry?.name ?? ''),
      name: String(entry?.name ?? entry?.id ?? ''),
      description: String(entry?.description ?? ''),
      path: String(entry?.dir ?? entry?.path ?? ''),
    })).filter((entry) => entry.id);

    const inventory = await mcpInventory.snapshot({ refresh });
    const mcp = (inventory?.servers ?? []).map((server) => ({
      id: String(server?.id ?? server?.name ?? ''),
      name: String(server?.name ?? server?.id ?? ''),
      file: String(server?.file ?? ''),
      note: String(server?.note ?? ''),
      status: server?.status === 'error' ? 'error' : 'online',
      error: server?.error ? String(server.error) : '',
      toolCount: Number(server?.toolCount) || 0,
      tools: Array.isArray(server?.tools)
        ? server.tools.map((tool) => ({
          name: String(tool?.name ?? ''),
          description: String(tool?.description ?? ''),
        })).filter((tool) => tool.name)
        : [],
    }));

    const totalTools = mcp.reduce((sum, server) => sum + server.toolCount, 0);
    const errors = mcp.filter((server) => server.status === 'error').length;
    return {
      version: 2,
      generatedAt: now(),
      scannedAt: Number(inventory?.at) > 0 ? Number(inventory.at) : null,
      skills,
      mcp,
      summary: {
        servers: mcp.length,
        online: mcp.length - errors,
        errors,
        tools: totalTools,
        skills: skills.length,
      },
    };
  }

  return { snapshot };
}
