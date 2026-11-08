// MCP 页：内置 server 概览 + 外部 MCP 管理 + 工具参考。
// 外部 MCP 的配置表单复用 form 组件，不另造一套控件样式。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { bindSwitches, getSwitch, renderFields, setSwitch } from '../../components/form/form.js';
import { closeModal, modalHtml, openModal, wireModal } from '../../components/modal/modal.js';
import { MCP_FIELDS } from './fields.js';

let editorOverlay = null;
let editingId = null;

function toolName(tool) {
  return typeof tool === 'string' ? tool : String(tool?.name ?? '');
}

function toolDescription(tool) {
  return typeof tool === 'string' ? '' : String(tool?.description ?? '');
}

function sourceBadge(server) {
  return server.source === 'external'
    ? '<span class="status-badge is-pill">外部</span>'
    : '<span class="status-badge is-pill">内置</span>';
}

function actionButtons(server) {
  const id = esc(server.id);
  const parts = [];
  if (server.source === 'external') {
    parts.push(`<button class="btn small" type="button" data-mcp-act="edit" data-id="${id}">编辑</button>`);
    parts.push(`<button class="btn small" type="button" data-mcp-act="test" data-id="${id}">测试</button>`);
    parts.push(`<button class="btn small" type="button" data-mcp-act="refresh" data-id="${id}">刷新</button>`);
    parts.push(`<button class="btn small" type="button" data-mcp-act="logs" data-id="${id}">日志</button>`);
    parts.push(`<button class="btn small danger" type="button" data-mcp-act="delete" data-id="${id}">删除</button>`);
  }
  return parts.join(' ') || '<span class="meta">—</span>';
}

function serverSummary(server) {
  const status = server.status === 'error'
    ? `<span class="status-badge is-pill err">读取失败</span>`
    : server.status === 'running'
      ? `<span class="status-badge is-pill ok">在线</span>`
      : `<span class="status-badge is-pill">${esc(server.status ?? '停止')}</span>`;
  const count = Number(server.toolCount) || (server.tools ?? []).length;
  const error = server.error ? `<div class="field-warn">${esc(server.error)}</div>` : '';
  return [
    `<strong>${esc(server.name || server.id)}</strong><div class="meta">${esc(server.id)} ${sourceBadge(server)}</div>`,
    status,
    String(count),
    `<code>${esc(server.file || server.transport || '')}</code>`,
    `${esc(server.note || server.description || '')}${error}`,
    actionButtons(server),
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
        `<strong>${esc(server.name || server.id)}</strong>`,
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

  if (!servers.length) {
    list.innerHTML = '<div class="meta">没有登记 MCP server。</div>';
    return;
  }

  const overview = dataTableHtml({
    columns: [
      { label: '服务器', width: '230px' },
      { label: '状态', width: '96px' },
      { label: '工具', width: '64px' },
      { label: '入口', width: '190px' },
      { label: '说明' },
      { label: '操作', width: '310px' },
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

function field(id) {
  return document.getElementById(id);
}

function lines(text) {
  return String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function pairs(text) {
  const out = {};
  for (const line of lines(text)) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

function overlay() {
  if (editorOverlay) return editorOverlay;
  const html = modalHtml({
    id: 'mcpEditor',
    title: '外部 MCP',
    wide: true,
    body: '<div data-mcp-fields="edit"></div>',
    footer: '<span class="modal-status" id="mcpEditMsg"></span>'
      + '<button class="btn" type="button" data-modal-close>取消</button>'
      + '<button class="btn primary" type="button" id="mcpEditSave">保存</button>',
  });
  const host = document.createElement('div');
  host.innerHTML = html;
  editorOverlay = host.firstElementChild;
  document.body.appendChild(editorOverlay);
  return editorOverlay;
}

function fillEditor(config = null) {
  editingId = config?.id ?? null;
  const idInput = field('mcpEditId');
  if (idInput) {
    idInput.value = config?.id ?? '';
    idInput.disabled = Boolean(config?.id);
  }
  field('mcpEditName').value = config?.name ?? '';
  field('mcpEditDescription').value = config?.description ?? '';
  mcpSelect('mcpEditTransport').value = config?.transport ?? 'stdio';
  field('mcpEditCommand').value = config?.command ?? '';
  field('mcpEditArgs').value = (config?.args ?? []).join('\n');
  field('mcpEditUrl').value = config?.url ?? '';
  field('mcpEditTimeout').value = String(config?.timeoutMs ?? 60000);
  setSwitch(field('mcpEditEnabled'), config?.enabled !== false);
  setSwitch(field('mcpEditAllowArbitrary'), config?.allowArbitraryCommand === true);
  setSwitch(field('mcpEditAllowPrivate'), config?.allowPrivateNetwork === true);
  field('mcpEditSecrets').value = '';
  field('mcpEditEnv').value = Object.entries(config?.env ?? {}).map(([key, value]) => `${key}=${value}`).join('\n');
  field('mcpEditHeaders').value = Object.entries(config?.headers ?? {}).map(([key, value]) => `${key}=${value}`).join('\n');
  field('mcpEditMsg').textContent = config ? `编辑 ${config.id}` : '新建外部 MCP';
}

function mcpSelect(id) {
  return field(id);
}

function parseEditor() {
  const id = editingId || String(field('mcpEditId').value ?? '').trim();
  const transport = mcpSelect('mcpEditTransport').value;
  const command = String(field('mcpEditCommand').value ?? '').trim();
  const url = String(field('mcpEditUrl').value ?? '').trim();
  if (!id) throw new Error('ID 不能为空');
  if (transport === 'stdio' && !command) throw new Error('stdio 需要命令');
  if (transport !== 'stdio' && !url) throw new Error('HTTP/SSE 需要 URL');
  const args = lines(field('mcpEditArgs').value);
  const env = pairs(field('mcpEditEnv').value);
  const headers = pairs(field('mcpEditHeaders').value);
  const secrets = pairs(field('mcpEditSecrets').value);
  return {
    id,
    name: String(field('mcpEditName').value ?? '').trim() || id,
    description: String(field('mcpEditDescription').value ?? '').trim(),
    transport,
    command: transport === 'stdio' ? command : '',
    args,
    url: transport === 'stdio' ? '' : url,
    timeoutMs: Number(field('mcpEditTimeout').value) || 60000,
    enabled: getSwitch(field('mcpEditEnabled')),
    allowArbitraryCommand: getSwitch(field('mcpEditAllowArbitrary')),
    allowPrivateNetwork: getSwitch(field('mcpEditAllowPrivate')),
    env,
    headers,
    secrets,
  };
}

async function openEditor(id = '') {
  const layer = overlay();
  let config = null;
  try {
    if (id) {
      const data = await api(`/api/extensions/mcp/${encodeURIComponent(id)}`);
      config = data.config;
    }
  } catch (error) {
    showConsoleToast(`读取失败：${error.message}`);
    return;
  }
  fillEditor(config);
  openModal(layer);
  bindSwitches(layer);
}

function openLogs(id) {
  const layer = document.createElement('div');
  layer.innerHTML = modalHtml({
    id: 'mcpLogs',
    title: `日志 · ${id}`,
    wide: true,
    body: '<pre class="log-pre" id="mcpLogText">读取中…</pre>',
    footer: '<button class="btn" type="button" data-modal-close>关闭</button>',
  });
  const overlayEl = layer.firstElementChild;
  document.body.appendChild(overlayEl);
  openModal(overlayEl);
  wireModal(overlayEl, { onClose: () => overlayEl.remove() });
  api(`/api/extensions/mcp/${encodeURIComponent(id)}/logs?limit=300`).then((data) => {
    const pre = document.getElementById('mcpLogText');
    if (pre) pre.textContent = (data.lines ?? []).join('\n') || '（没有日志）';
  }).catch((error) => {
    const pre = document.getElementById('mcpLogText');
    if (pre) pre.textContent = `读取失败：${error.message}`;
  });
}

async function handleAction(action, id) {
  try {
    if (action === 'edit') {
      await openEditor(id);
      return;
    }
    if (action === 'logs') {
      openLogs(id);
      return;
    }
    if (action === 'test') {
      const data = await api(`/api/extensions/mcp/${encodeURIComponent(id)}/test`, 'POST', {});
      showConsoleToast(data.ok !== false ? `测试通过：${(data.tools ?? []).length} 个工具` : `测试失败：${data.error ?? '未知错误'}`);
      return;
    }
    if (action === 'refresh') {
      await api(`/api/extensions/mcp/${encodeURIComponent(id)}/refresh`, 'POST', {});
      showConsoleToast('已刷新');
      refreshMcp(false).catch(() => {});
      return;
    }
    if (action === 'delete') {
      if (!window.confirm(`删除外部 MCP「${id}」？`)) return;
      await api(`/api/extensions/mcp/${encodeURIComponent(id)}`, 'DELETE');
      showConsoleToast('已删除');
      refreshMcp(false).catch(() => {});
    }
  } catch (error) {
    showConsoleToast(`操作失败：${error.message}`);
  }
}

function bindEditor() {
  const layer = overlay();
  layer.querySelector('[data-mcp-fields="edit"]')?.replaceChildren();
  renderFields(layer.querySelector('[data-mcp-fields="edit"]'), MCP_FIELDS.edit.fields, { columns: 2 });
  bindSwitches(layer);
  wireModal(layer, { onClose: () => { editingId = null; } });
  layer.querySelector('#mcpEditSave')?.addEventListener('click', async () => {
    const msg = field('mcpEditMsg');
    let payload;
    try {
      payload = parseEditor();
    } catch (error) {
      msg.textContent = `❌ ${error.message}`;
      return;
    }
    try {
      const path = editingId ? `/api/extensions/mcp/${encodeURIComponent(editingId)}` : '/api/extensions/mcp';
      const data = await api(path, editingId ? 'PATCH' : 'POST', payload);
      if (data.ok === false) throw new Error(data.error || '保存失败');
      closeModal(layer);
      showConsoleToast('已保存');
      refreshMcp(false).catch(() => {});
    } catch (error) {
      msg.textContent = `❌ ${error.message}`;
    }
  });
}

export function init() {
  // 先把字段规格渲染出来，后面 getElementById('mcpRefresh'/'mcpMeta'/'mcpList') 才取得到。
  document.querySelectorAll('[data-mcp-fields]').forEach((host) => {
    const spec = MCP_FIELDS[host.dataset.mcpFields];
    if (spec && host.dataset.mcpFields !== 'edit') renderFields(host, spec.fields, { columns: 2 });
  });
  bindEditor();
  document.getElementById('mcpRefresh')?.addEventListener('click', () => { refreshMcp(true).catch(() => {}); });
  document.getElementById('mcpNew')?.addEventListener('click', () => { openEditor('').catch(() => {}); });
  document.getElementById('mcpList')?.addEventListener('click', (event) => {
    const hit = event.target instanceof Element ? event.target.closest('[data-mcp-act]') : null;
    if (!hit) return;
    handleAction(hit.dataset.mcpAct, hit.dataset.id).catch(() => {});
  });
  onPageRefresh('mcp', () => { refreshMcp(false).catch(() => {}); });
  setInterval(() => { if (getCurrentPage() === 'mcp' && !document.hidden) refreshMcp(false).catch(() => {}); }, 30_000);
  refreshMcp(false).catch(() => {});
}
