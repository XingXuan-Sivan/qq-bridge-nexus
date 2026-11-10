// MCP 页：内置 server 概览 + 外部 MCP 管理 + 工具清单（主从布局）。
// 左右分栏复用 split-view 组件；编辑弹窗复用 form / modal / terminal。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { bindSwitches, getSwitch, renderFields, setSwitch } from '../../components/form/form.js';
import { attachTextareaEditor } from '../../components/code-editor/code-editor.js';
import { closeModal, modalHtml, openModal, wireModal } from '../../components/modal/modal.js';
import { initSplitView, splitItemHtml, splitViewHtml } from '../../components/split-view/split-view.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { MCP_FIELDS } from './fields.js';
import { renderTerminalLines, terminalHtml, textToLines } from '../../components/terminal/terminal.js';

const TRANSPORT_LABEL = {
  stdio: 'stdio',
  streamable_http: 'Streamable HTTP',
  sse: 'SSE',
};

const CONFIG_TEMPLATES = {
  stdio: {
    command: 'node',
    args: ['src/mcp-host-server.js'],
    env: { API_KEY: 'secret:apiKey' },
  },
  streamable_http: {
    url: 'https://example.com/mcp',
    headers: { Authorization: 'secret:authorization' },
  },
  sse: {
    url: 'https://example.com/sse',
    headers: { Authorization: 'secret:authorization' },
  },
};

let editorOverlay = null;
let editingId = null;
let transportDrafts = new Map();
let editorTransport = 'stdio';

function toolName(tool) {
  return typeof tool === 'string' ? tool : String(tool?.name ?? '');
}

function toolDescription(tool) {
  return typeof tool === 'string' ? '' : String(tool?.description ?? '');
}

function sourceTag(server) {
  const external = server.source === 'external';
  return `<span class="pill${external ? ' b' : ' n'}">${external ? '外部' : '内置'}</span>`;
}

function statusTag(server) {
  if (server.status === 'error') return '<span class="pill r">读取失败</span>';
  if (server.status === 'running' || server.status === 'online') return '<span class="pill g">在线</span>';
  if (server.status === 'disabled') return '<span class="pill">已停用</span>';
  return `<span class="pill">${esc(server.status === 'stopped' ? '已停止' : server.status ?? '已停止')}</span>`;
}

// 列表筛选与选中态都放在这里：refresh 只换数据，不重置用户的筛选与选择。
const MCP_STATE = { servers: [], skills: 0, summary: {}, query: '', source: 'all', status: 'all', selected: null, toolQuery: '' };

function serverHaystack(server) {
  const tools = Array.isArray(server.tools) ? server.tools : [];
  return [
    server.name, server.id, server.description, server.note, server.file,
    ...tools.map((tool) => `${toolName(tool)} ${toolDescription(tool)}`),
  ].filter(Boolean).join(' ').toLowerCase();
}

function isOnline(server) {
  return server.status === 'running' || server.status === 'online';
}

function visibleServers() {
  const q = MCP_STATE.query.trim().toLowerCase();
  return MCP_STATE.servers.filter((server) => {
    if (MCP_STATE.source !== 'all' && (server.source === 'external' ? 'external' : 'builtin') !== MCP_STATE.source) return false;
    if (MCP_STATE.status === 'running' && !isOnline(server)) return false;
    if (MCP_STATE.status === 'error' && server.status !== 'error') return false;
    if (MCP_STATE.status === 'stopped' && (isOnline(server) || server.status === 'error')) return false;
    if (q && !serverHaystack(server).includes(q)) return false;
    return true;
  });
}

function toolbarMarkup(servers, summary) {
  const toolCount = Number(summary.tools) || servers.reduce((sum, server) => sum + (Number(server.toolCount) || (server.tools ?? []).length), 0);
  const errors = Number(summary.errors) || servers.filter((server) => server.status === 'error').length;
  const warning = errors ? `<span class="pill r" title="部分 server 连接失败；打开详情可查看原因">${errors} 个读取失败</span>` : '';
  return `<div class="table-toolbar">
    <div class="table-toolbar-main">
      <input id="mcpServerSearch" class="search-input" type="search" placeholder="搜索服务器、工具、说明…" aria-label="搜索 MCP 服务器">
      <select id="mcpFilterSource" class="u-w-190" aria-label="按来源筛选">
        <option value="all">全部来源</option><option value="builtin">内置</option><option value="external">外部</option>
      </select>
      <select id="mcpFilterStatus" class="u-w-190" aria-label="按状态筛选">
        <option value="all">全部状态</option><option value="running">在线</option><option value="error">读取失败</option><option value="stopped">已停止</option>
      </select>
    </div>
    <div class="table-toolbar-side">
      <span class="meta" id="mcpSummary">${servers.length} 个 server · ${toolCount} 个工具 · ${MCP_STATE.skills} 个技能</span>
      ${warning}
      <button class="btn small" type="button" data-mcp-refresh>刷新</button>
      <button class="btn primary" type="button" data-mcp-new>新增 MCP</button>
    </div>
  </div>`;
}

function detailMarkup(server) {
  if (!server) return '<div class="split-empty">从左侧选一个 server 查看工具清单</div>';
  const tools = Array.isArray(server.tools) ? server.tools : [];
  const external = server.source === 'external';
  const description = server.status === 'error' ? (server.error || '读取失败') : (server.note || server.description || '');
  const actions = external
    ? `<button class="btn small" type="button" data-mcp-act="edit" data-id="${esc(server.id)}">编辑</button>
       <button class="btn small" type="button" data-mcp-act="test" data-id="${esc(server.id)}">测试</button>
       <button class="btn small" type="button" data-mcp-act="logs" data-id="${esc(server.id)}">日志</button>
       <button class="btn small danger" type="button" data-mcp-act="delete" data-id="${esc(server.id)}">删除</button>`
    : '<span class="meta">内置 server 由桥接仓库提供，不能在这里修改。</span>';
  const toolRows = tools.map((tool) => ({
    cells: [
      `<code>${esc(toolName(tool))}</code>`,
      esc(toolDescription(tool) || '—'),
    ],
  }));
  return `<div class="mcp-detail" data-mcp-detail="${esc(server.id)}">
    <header class="mcp-detail-head">
      <div class="mcp-detail-title">
        <h3>${esc(server.name || server.id)}<span class="mcp-title-tags">${sourceTag(server)}${statusTag(server)}</span></h3>
        <div class="mcp-detail-sub"><code>${esc(server.id)}</code><span class="meta">${esc(server.file || TRANSPORT_LABEL[server.transport] || '')}</span></div>
      </div>
      <div class="mcp-detail-actions">${actions}</div>
    </header>
    ${description ? `<p class="meta mcp-detail-note">${esc(description)}</p>` : ''}
    <section class="mcp-tools">
      ${dataTableHtml({
        columns: [{ label: '工具', width: 260 }, { label: '说明' }],
        rows: toolRows,
        pageSize: 10,
        search: { placeholder: '筛选工具名或说明…' },
        meta: `共 ${tools.length} 个工具`,
        empty: tools.length ? '没有匹配的工具。' : '没有注册工具。',
      })}
    </section>
  </div>`;
}

function paintList() {
  const host = document.querySelector('#mcpSplit .split-list');
  if (!host) return;
  const servers = visibleServers();
  if (!servers.length) {
    host.innerHTML = `<div class="split-empty">${MCP_STATE.servers.length ? '没有匹配的 server' : '没有登记 MCP server'}</div>`;
    return;
  }
  host.innerHTML = servers.map((server) => {
    const online = isOnline(server);
    const badges = `${sourceTag(server)}${statusTag(server)}`;
    const count = Number(server.toolCount) || (server.tools ?? []).length;
    const meta = [server.file || TRANSPORT_LABEL[server.transport] || '', `${count} 个工具`].filter(Boolean).join(' · ');
    const item = splitItemHtml({
      key: server.id,
      title: server.name || server.id,
      badges,
      meta,
      active: server.id === MCP_STATE.selected,
      attrs: !online ? 'data-offline="1"' : '',
    });
    // 内置 server 改不了，也不该给删除入口；外部 server 悬停时在行尾露出一个删除按钮。
    if (server.source !== 'external') return item;
    return `<div class="mcp-split-row">${item}<button class="mcp-split-del" type="button" data-mcp-del="${esc(server.id)}" title="删除这个 server" aria-label="删除 ${esc(server.name || server.id)}">×</button></div>`;
  }).join('');
}

function paintDetail() {
  const host = document.querySelector('#mcpSplit [data-split-detail]');
  if (!host) return;
  const server = MCP_STATE.servers.find((item) => item.id === MCP_STATE.selected) || null;
  host.innerHTML = detailMarkup(server);
  initDataTables(host);
}

function selectServer(id) {
  if (!id || id === MCP_STATE.selected) return;
  MCP_STATE.selected = id;
  paintDetail();
}

function render(data) {
  const host = document.getElementById('mcpList');
  if (!host) return;
  const servers = Array.isArray(data.mcp) ? data.mcp : [];
  MCP_STATE.servers = servers;
  MCP_STATE.summary = data.summary ?? {};
  MCP_STATE.skills = Number(MCP_STATE.summary.skills) || (Array.isArray(data.skills) ? data.skills.length : 0);
  if (!MCP_STATE.selected || !servers.some((server) => server.id === MCP_STATE.selected)) {
    MCP_STATE.selected = servers[0]?.id ?? null;
    MCP_STATE.toolQuery = '';
  }
  host.innerHTML = toolbarMarkup(servers, MCP_STATE.summary)
    + splitViewHtml({ id: 'mcpSplit', listLabel: 'MCP 服务器', listHtml: '', detailHtml: '', empty: '从左侧选一个 server 查看工具清单' });
  paintList();
  paintDetail();
  initSplitView(document.getElementById('mcpSplit'), { onSelect: selectServer });
}

async function refreshMcp(force = false) {
  const list = document.getElementById('mcpList');
  if (!list) return;
  if (!list.innerHTML.trim()) list.innerHTML = '<div class="meta">读取中…</div>';
  try {
    const data = await api(`/api/extensions${force ? '?refresh=1' : ''}`);
    render(data);
  } catch (error) {
    list.innerHTML = `<div class="field-warn">读取失败：${esc(error.message)}</div>`;
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

function templateFor(transport) {
  return JSON.stringify(CONFIG_TEMPLATES[transport] ?? CONFIG_TEMPLATES.stdio, null, 2);
}

function connectionConfig(config) {
  if (!config) return CONFIG_TEMPLATES.stdio;
  if (config.transport === 'stdio') {
    return {
      command: config.command ?? '',
      args: Array.isArray(config.args) ? config.args : [],
      ...(config.env && Object.keys(config.env).length ? { env: config.env } : {}),
    };
  }
  return {
    url: config.url ?? '',
    ...(config.headers && Object.keys(config.headers).length ? { headers: config.headers } : {}),
  };
}

function syncTransportFields() {
  const select = field('mcpEditTransport');
  const transport = select?.value ?? 'stdio';
  const arbitrary = field('mcpEditAllowArbitrary')?.closest('.form-cols > div')
    ?? field('mcpEditAllowArbitrary')?.closest('.field-block');
  const privateNet = field('mcpEditAllowPrivate')?.closest('.form-cols > div')
    ?? field('mcpEditAllowPrivate')?.closest('.field-block');
  if (arbitrary) arbitrary.hidden = transport !== 'stdio';
  if (privateNet) privateNet.hidden = transport === 'stdio';
  const logs = field('mcpEditLogs');
  if (logs) logs.hidden = !editingId;
}

function fillEditor(config = null) {
  editingId = config?.id ?? null;
  transportDrafts = new Map();
  const idInput = field('mcpEditId');
  if (idInput) {
    idInput.value = config?.id ?? '';
    idInput.disabled = Boolean(config?.id);
  }
  field('mcpEditName').value = config?.name ?? '';
  field('mcpEditDescription').value = config?.description ?? '';
  const transport = config?.transport ?? 'stdio';
  editorTransport = transport;
  field('mcpEditTransport').value = transport;
  field('mcpEditTimeout').value = String(config?.timeoutMs ?? 60000);
  setSwitch(field('mcpEditEnabled'), config?.enabled !== false);
  setSwitch(field('mcpEditAllowArbitrary'), config?.allowArbitraryCommand === true);
  setSwitch(field('mcpEditAllowPrivate'), config?.allowPrivateNetwork === true);
  field('mcpEditSecrets').value = '';
  const configText = JSON.stringify(connectionConfig(config), null, 2);
  transportDrafts.set(transport, configText);
  const configField = field('mcpEditConfig');
  configField.value = configText;
  // 编辑器是把 textarea 遮住的 CodeMirror；重新打开弹窗时要把新内容同步过去。
  configField._codeEditorHandle?.setValue(configText);
  field('mcpEditMsg').textContent = '';
  syncTransportFields();
}

function parseEditor() {
  const id = editingId || String(field('mcpEditId').value ?? '').trim();
  const transport = field('mcpEditTransport').value;
  if (!id) throw new Error('ID 不能为空');
  let parsed;
  try {
    parsed = JSON.parse(String(field('mcpEditConfig').value ?? '') || '{}');
  } catch (error) {
    throw new Error(`连接配置不是合法 JSON：${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('连接配置必须是 JSON 对象');
  }
  const config = {
    ...parsed,
    id,
    name: String(field('mcpEditName').value ?? '').trim() || id,
    description: String(field('mcpEditDescription').value ?? '').trim(),
    transport,
    timeoutMs: Number(field('mcpEditTimeout').value) || 60000,
    enabled: getSwitch(field('mcpEditEnabled')),
    allowArbitraryCommand: transport === 'stdio' && getSwitch(field('mcpEditAllowArbitrary')),
    allowPrivateNetwork: transport !== 'stdio' && getSwitch(field('mcpEditAllowPrivate')),
  };
  if (transport === 'stdio' && !String(config.command ?? '').trim()) throw new Error('stdio 需要 command');
  if (transport !== 'stdio' && !String(config.url ?? '').trim()) throw new Error(`${TRANSPORT_LABEL[transport]} 需要 url`);
  return { config, secrets: pairs(field('mcpEditSecrets').value) };
}

function overlay() {
  if (editorOverlay) return editorOverlay;
  const html = modalHtml({
    id: 'mcpEditor',
    title: '外部 MCP',
    wide: true,
    body: '<div data-mcp-fields="edit"></div>',
    footer: '<span class="modal-status" id="mcpEditMsg"></span>'
      + '<button class="btn" type="button" id="mcpEditLogs">日志</button>'
      + '<button class="btn" type="button" id="mcpEditTest">测试连接</button>'
      + '<button class="btn" type="button" data-modal-close>取消</button>'
      + '<button class="btn primary" type="button" id="mcpEditSave">保存</button>',
  });
  const host = document.createElement('div');
  host.innerHTML = html;
  editorOverlay = host.firstElementChild;
  document.body.appendChild(editorOverlay);
  return editorOverlay;
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
  // 连接配置用项目自带编辑器；textarea 本身仍保存内容，提交时照旧读它。
  const configField = field('mcpEditConfig');
  if (configField) {
    const handle = attachTextareaEditor(configField, { language: 'json', height: '320px' });
    handle?.setValue?.(configField.value);
  }
  syncTransportFields();
}

function openLogs(id) {
  if (!id) return;
  const layer = document.createElement('div');
  layer.innerHTML = modalHtml({
    id: 'mcpLogs',
    title: `日志 · ${id}`,
    wide: true,
    body: terminalHtml({ id: 'mcpLogText', height: 420, label: `${id} 日志`, placeholder: '读取中…' }),
    footer: '<button class="btn" type="button" data-modal-close>关闭</button>',
  });
  const overlayEl = layer.firstElementChild;
  document.body.appendChild(overlayEl);
  openModal(overlayEl);
  wireModal(overlayEl, { onClose: () => overlayEl.remove() });
  api(`/api/extensions/mcp/${encodeURIComponent(id)}/logs?limit=300`).then((data) => {
    const term = document.getElementById('mcpLogText');
    if (term) renderTerminalLines(term, textToLines((data.lines ?? []).join('\n')), { placeholder: '（没有日志）' });
  }).catch((error) => {
    renderTerminalLines(document.getElementById('mcpLogText'), [`读取失败：${error.message}`], { scroll: false });
  });
}

async function handleAction(action, id) {
  try {
    if (action === 'edit') {
      await openEditor(id);
      return;
    }
    if (action === 'test') {
      const data = await api(`/api/extensions/mcp/${encodeURIComponent(id)}/test`, 'POST', {});
      showConsoleToast(data.ok !== false ? `测试通过：${(data.tools ?? []).length} 个工具` : `测试失败：${data.error ?? '未知错误'}`);
      return;
    }
    if (action === 'delete') {
      if (!window.confirm(`删除外部 MCP「${id}」？`)) return;
      const data = await api(`/api/extensions/mcp/${encodeURIComponent(id)}`, 'DELETE');
      if (data.ok === false) throw new Error(data.error || '删除失败');
      showConsoleToast('已删除');
      refreshMcp(false).catch(() => {});
    }
  } catch (error) {
    showConsoleToast(`操作失败：${error.message}`);
  }
}

function bindEditor() {
  const layer = overlay();
  const host = layer.querySelector('[data-mcp-fields="edit"]');
  renderFields(host, MCP_FIELDS.edit.fields, { columns: 2 });
  bindSwitches(layer);
  wireModal(layer, {
    onClose: () => {
      editingId = null;
      transportDrafts.clear();
    },
  });

  field('mcpEditTransport')?.addEventListener('change', () => {
    const select = field('mcpEditTransport');
    const textarea = field('mcpEditConfig');
    transportDrafts.set(editorTransport, textarea.value);
    const next = select.value;
    textarea.value = transportDrafts.get(next) ?? templateFor(next);
    textarea._codeEditorHandle?.setValue(textarea.value);
    editorTransport = next;
    syncTransportFields();
  });
  field('mcpEditLogs')?.addEventListener('click', () => openLogs(editingId));

  field('mcpEditTest')?.addEventListener('click', async () => {
    const msg = field('mcpEditMsg');
    let payload;
    try {
      payload = parseEditor();
    } catch (error) {
      msg.textContent = `❌ ${error.message}`;
      return;
    }
    msg.textContent = '测试中…';
    try {
      const data = await api('/api/extensions/mcp/test', 'POST', payload);
      if (data.ok === false) throw new Error(data.error || '连接失败');
      msg.textContent = `✅ 连接成功：${(data.tools ?? []).length} 个工具`;
    } catch (error) {
      msg.textContent = `❌ ${error.message}`;
    }
  });

  field('mcpEditSave')?.addEventListener('click', async () => {
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
      const data = await api(path, editingId ? 'PATCH' : 'POST', { ...payload.config, secrets: payload.secrets });
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
  document.querySelectorAll('[data-mcp-fields]').forEach((host) => {
    const spec = MCP_FIELDS[host.dataset.mcpFields];
    if (spec && host.dataset.mcpFields !== 'edit') renderFields(host, spec.fields, { columns: 2 });
  });
  bindEditor();
  document.getElementById('mcpList')?.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-mcp-new]')) {
      openEditor('').catch(() => {});
      return;
    }
    if (target.closest('[data-mcp-refresh]')) {
      refreshMcp(true).catch(() => {});
      return;
    }
    const hit = target.closest('[data-mcp-act]');
    if (!hit) {
      // 左栏行尾的删除按钮：和详情里的「删除」走同一条确认 + 删除流程。
      const del = target.closest('[data-mcp-del]');
      if (del) handleAction('delete', del.dataset.mcpDel).catch(() => {});
      return;
    }
    if (hit.dataset.mcpAct === 'logs') { openLogs(hit.dataset.id); return; }
    handleAction(hit.dataset.mcpAct, hit.dataset.id).catch(() => {});
  });
  // 搜索与筛选只重画左栏，不打断右侧正在看的详情。
  document.getElementById('mcpList')?.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.id === 'mcpServerSearch') { MCP_STATE.query = target.value; paintList(); }
  });
  document.getElementById('mcpList')?.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    if (target.id === 'mcpFilterSource') { MCP_STATE.source = target.value; paintList(); }
    else if (target.id === 'mcpFilterStatus') { MCP_STATE.status = target.value; paintList(); }
  });
  onPageRefresh('mcp', () => { refreshMcp(false).catch(() => {}); });
  setInterval(() => { if (getCurrentPage() === 'mcp' && !document.hidden) refreshMcp(false).catch(() => {}); }, 30_000);
  refreshMcp(false).catch(() => {});
}
