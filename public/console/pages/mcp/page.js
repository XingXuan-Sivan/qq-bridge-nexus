// MCP 页：只读展示桥接自带的 MCP server 与真实 tools/list 结果。
// 工具参考已并入本页；不再维护另一份手写表。
import { api } from '../../js/api.js';
import { esc } from '../../js/ui.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { renderFields } from '../../components/form/form.js';
import { MCP_FIELDS } from './fields.js';

function toolName(tool) {
  return typeof tool === 'string' ? tool : String(tool?.name ?? '');
}

function toolDescription(tool) {
  return typeof tool === 'string' ? '' : String(tool?.description ?? '');
}

function serverSummary(server) {
  const status = server.status === 'error'
    ? `<span class="status-badge is-pill err">读取失败</span>`
    : `<span class="status-badge is-pill ok">在线</span>`;
  const count = Number(server.toolCount) || (server.tools ?? []).length;
  return [
    `<strong>${esc(server.name)}</strong>`,
    status,
    String(count),
    `<code>${esc(server.file || '')}</code>`,
    esc(server.note || ''),
  ];
}

function toolRows(servers) {
  const rows = [];
  for (const server of servers) {
    const tools = Array.isArray(server.tools) ? server.tools : [];
    if (!tools.length) {
      const note = server.status === 'error'
        ? `读取失败：${server.error || '未知错误'}`
        : '没有注册工具';
      rows.push([`<strong>${esc(server.name)}</strong>`, '<span class="meta">—</span>', `<span class="meta">${esc(note)}</span>`]);
      continue;
    }
    for (const tool of tools) {
      rows.push([
        `<strong>${esc(server.name)}</strong>`,
        `<code>${esc(toolName(tool))}</code>`,
        esc(toolDescription(tool) || '—'),
      ]);
    }
  }
  return rows;
}

function render(data) {
  const list = document.getElementById('mcpList');
  if (!list) return;
  const servers = Array.isArray(data.mcp) ? data.mcp : [];
  const summary = data.summary ?? {};
  const toolCount = Number(summary.tools) || servers.reduce((sum, server) => sum + (Number(server.toolCount) || (server.tools ?? []).length), 0);
  const skillCount = Number(summary.skills) || (Array.isArray(data.skills) ? data.skills.length : 0);
  const errors = Number(summary.errors) || servers.filter((server) => server.status === 'error').length;
  const generated = Number(data.generatedAt) > 0
    ? new Date(Number(data.generatedAt)).toLocaleTimeString('zh-CN', { hour12: false })
    : '—';

  if (!servers.length) {
    list.innerHTML = '<div class="meta">没有登记 MCP server。</div>';
    return;
  }

  const overview = dataTableHtml({
    columns: [
      { label: '服务器', width: '200px' },
      { label: '状态', width: '100px' },
      { label: '工具', width: '72px' },
      { label: '入口', width: '250px' },
      { label: '说明' },
    ],
    rows: servers.map(serverSummary),
    pager: false,
    meta: `${servers.length} 个 server · ${toolCount} 个工具 · ${skillCount} 个技能`,
  });

  const tools = toolRows(servers);
  const reference = dataTableHtml({
    columns: [
      { label: '服务器', width: '190px' },
      { label: '工具', width: '260px' },
      { label: '说明' },
    ],
    rows: tools,
    pageSize: 20,
    search: { placeholder: '搜索工具或说明…' },
    meta: `共 ${tools.length} 个工具`,
    empty: '没有匹配的工具。',
  });

  list.innerHTML = `${errors ? `<div class="field-warn">${errors} 个 server 读取失败，工具清单可能不完整。</div>` : ''}`
    + `${overview}`
    + '<h3 class="mcp-section-title">工具参考</h3>'
    + `${reference}`;
  initDataTables(list);
}

async function refreshMcp(force = false) {
  const meta = document.getElementById('mcpMeta');
  const list = document.getElementById('mcpList');
  const button = document.getElementById('mcpRefresh');
  if (button) button.disabled = true;
  if (!list?.innerHTML) meta.textContent = '读取中…';
  try {
    const data = await api(`/api/extensions${force ? '?refresh=1' : ''}`);
    const count = data.summary?.servers ?? (data.mcp ?? []).length;
    const tools = data.summary?.tools ?? 0;
    meta.textContent = count ? `${count} 个 server · ${tools} 个工具` : '没有登记 MCP server';
    render(data);
  } catch (error) {
    meta.textContent = `读取失败：${error.message}`;
  } finally {
    if (button) button.disabled = false;
  }
}

export function init() {
  // 先把字段规格渲染出来，后面 getElementById('mcpRefresh'/'mcpMeta'/'mcpList') 才取得到。
  document.querySelectorAll('[data-mcp-fields]').forEach((host) => {
    const spec = MCP_FIELDS[host.dataset.mcpFields];
    if (spec) renderFields(host, spec.fields, { columns: 2 });
  });
  document.getElementById('mcpRefresh')?.addEventListener('click', () => { refreshMcp(true).catch(() => {}); });
  onPageRefresh('mcp', () => { refreshMcp(false).catch(() => {}); });
  setInterval(() => { if (getCurrentPage() === 'mcp' && !document.hidden) refreshMcp(false).catch(() => {}); }, 30_000);
  refreshMcp(false).catch(() => {});
}
