// MCP 页：只读列出桥接登记的 MCP server 与各自工具。
import { api } from '../api.js';
import { esc, simpleTable } from '../ui.js';
import { getCurrentPage, onPageRefresh } from '../router.js';

async function refreshMcp() {
  const meta = document.getElementById('mcpMeta');
  const list = document.getElementById('mcpList');
  try {
    const data = await api('/api/extensions');
    const servers = data.mcp ?? [];
    meta.textContent = servers.length ? `桥接自带 ${servers.length} 个 MCP server` : '没有登记 MCP server';
    list.innerHTML = servers.length
      ? `<div class="tool-log-table">${simpleTable([{ label: '服务器', width: '200px' }, { label: '说明' }, { label: '入口与工具' }],
        servers.map(server => [`<strong>${esc(server.name)}</strong>`, esc(server.note || ''), `<code>${esc(server.file)}</code>${(server.tools ?? []).length ? ` · 工具 ${esc(server.tools.join('、'))}` : ''}`]))}</div>`
      : '<div class="meta">没有登记 MCP server。</div>';
  } catch (error) {
    meta.textContent = `读取失败：${error.message}`;
  }
}

export function initMcpPage() {
  document.getElementById('mcpRefresh')?.addEventListener('click', () => { refreshMcp().catch(() => {}); });
  onPageRefresh('mcp', () => { refreshMcp().catch(() => {}); });
  setInterval(() => { if (getCurrentPage() === 'mcp' && !document.hidden) refreshMcp().catch(() => {}); }, 30_000);
  refreshMcp().catch(() => {});
}
