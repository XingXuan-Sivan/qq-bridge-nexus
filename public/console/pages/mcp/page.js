// MCP 页：内置 server 概览 + 外部 MCP 管理 + 工具参考。
// 表格与弹窗都复用 console 的共享组件；连接配置按 AstrBot 的方式用一份 JSON + 模板。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { bindSwitches, getSwitch, renderFields, setSwitch } from '../../components/form/form.js';
import { closeModal, modalHtml, openModal, wireModal } from '../../components/modal/modal.js';
import { MCP_FIELDS } from './fields.js';

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

function actionButtons(server) {
  if (server.source !== 'external') return '<span class="meta">—</span>';
  const id = esc(server.id);
  return `<div class="mcp-row-actions">
    <button class="btn small" type="button" data-mcp-act="edit" data-id="${id}">编辑</button>
    <button class="btn small" type="button" data-mcp-act="test" data-id="${id}">测试</button>
    <button class="btn small danger" type="button" data-mcp-act="delete" data-id="${id}">删除</button>
  </div>`;
}

function serverRow(server) {
  const count = Number(server.toolCount) || (server.tools ?? []).length;
  const online = server.status === 'running' || server.status === 'online';
  const description = server.status === 'error'
    ? ''
    : esc(server.note || server.description || '');
  return {
    attrs: {
      'data-filter-source': server.source === 'external' ? 'external' : 'builtin',
      'data-filter-status': online ? 'running' : server.status === 'error' ? 'error' : 'stopped',
    },
    cells: [
      `<strong>${esc(server.name || server.id)}</strong><div class="meta">${esc(server.id)}</div>`,
      `<div class="mcp-status-cell">${sourceTag(server)}${statusTag(server)}</div>`,
      String(count),
      `<code>${esc(server.file || TRANSPORT_LABEL[server.transport] || '')}</code>`,
      description,
      actionButtons(server),
    ],
  };
}

function toolRows(servers) {
  const rows = [];
  for (const server of servers) {
    const tools = Array.isArray(server.tools) ? server.tools : [];
    if (!tools.length) {
      rows.push({
        attrs: { 'data-filter-server': server.id },
        cells: [
          `<strong>${esc(server.name || server.id)}</strong>`,
          '<span class="meta">—</span>',
          server.status === 'error' ? '' : '<span class="meta">没有注册工具</span>',
        ],
      });
      continue;
    }
    for (const tool of tools) {
      rows.push({
        attrs: { 'data-filter-server': server.id },
        cells: [
          `<strong>${esc(server.name || server.id)}</strong>`,
          `<code>${esc(toolName(tool))}</code>`,
          esc(toolDescription(tool) || '—'),
        ],
      });
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

  const warning = errors
    ? `<span class="pill r" title="部分 server 连接失败；展开日志可查看原因">${errors} 个 server 读取失败</span>`
    : '';
  const overview = dataTableHtml({
    columns: [
      { label: '服务器', width: '220px' },
      { label: '状态', width: '150px' },
      { label: '工具', width: '64px' },
      { label: '入口', width: '190px' },
      { label: '说明' },
      { label: '操作', width: '230px' },
    ],
    rows: servers.map(serverRow),
    pager: false,
    search: { placeholder: '搜索服务器、说明…' },
    refresh: true,
    filters: [
      {
        id: 'source',
        label: '来源',
        options: [
          { value: 'all', label: '全部来源' },
          { value: 'builtin', label: '内置' },
          { value: 'external', label: '外部' },
        ],
      },
      {
        id: 'status',
        label: '状态',
        options: [
          { value: 'all', label: '全部状态' },
          { value: 'running', label: '在线' },
          { value: 'error', label: '读取失败' },
          { value: 'stopped', label: '已停止' },
        ],
      },
    ],
    meta: `${servers.length} 个 server · ${toolCount} 个工具 · ${skillCount} 个技能`,
    actions: `${warning}<button class="btn primary" type="button" data-mcp-new>新增 MCP</button>`,
  });

  const tools = toolRows(servers);
  const reference = dataTableHtml({
    columns: [
      { label: '服务器', width: '190px' },
      { label: '工具', width: '250px' },
      { label: '说明' },
    ],
    rows: tools,
    pageSize: 20,
    search: { placeholder: '搜索工具或说明…' },
    refresh: true,
    filters: [
      {
        id: 'server',
        label: '服务器',
        options: [
          { value: 'all', label: '全部 server' },
          ...servers.map((server) => ({ value: server.id, label: server.name || server.id })),
        ],
      },
    ],
    meta: `共 ${tools.length} 个工具`,
    empty: '没有匹配的工具。',
  });

  list.innerHTML = `${overview}<h3 class="mcp-section-title">工具参考</h3>${reference}`;
  initDataTables(list, { onRefresh: () => { refreshMcp(true).catch(() => {}); } });
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
  field('mcpEditConfig').value = configText;
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
      + '<button class="btn" type="button" id="mcpEditLogs">查看连接日志</button>'
      + '<button class="btn" type="button" data-modal-close>取消</button>'
      + '<button class="btn" type="button" id="mcpEditTest">测试连接</button>'
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
  syncTransportFields();
}

function openLogs(id) {
  if (!id) return;
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
    const hit = target.closest('[data-mcp-act]');
    if (!hit) return;
    handleAction(hit.dataset.mcpAct, hit.dataset.id).catch(() => {});
  });
  onPageRefresh('mcp', () => { refreshMcp(false).catch(() => {}); });
  setInterval(() => { if (getCurrentPage() === 'mcp' && !document.hidden) refreshMcp(false).catch(() => {}); }, 30_000);
  refreshMcp(false).catch(() => {});
}
