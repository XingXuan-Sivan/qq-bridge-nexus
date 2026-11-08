// 插件页：加载状态、启停/重载/卸载、安装与运行设置、详情弹窗。
//
// 本页自己负责数据与事件：路由器注入片段后调一次 init()。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { closeModal, openModal, wireModal } from '../../components/modal/modal.js';
import { bindSwitches, getSwitch, renderFields, setSwitch } from '../../components/form/form.js';
import { PLUGINS_FIELDS } from './fields.js';

// 渲染工具行、设置块与详情弹窗的控件；开关由 bindSwitches 统一接管（值在 aria-checked 上）。
// 必须在 init() 最前面跑：下面的 getElementById 依赖这些节点。
function renderPluginsFields() {
  document.querySelectorAll('[data-plugins-fields]').forEach((host) => {
    const spec = PLUGINS_FIELDS[host.dataset.pluginsFields];
    if (!spec) return;
    if (spec.html) host.innerHTML = spec.html;
    if (!spec.fields) return;
    const mount = spec.mount ? document.getElementById(spec.mount) : host;
    if (!mount) return;
    renderFields(mount, spec.fields, { columns: spec.columns || 2 });
    bindSwitches(mount);
  });
}

// ── 桥接插件 ────────────────────────────────────────────────────────────────
// 只读视图：加载/校验/失败都在桥接启动时决定，这里不做「伪热重载」。
const PLUGIN_STATUS_LABELS = {
  active: ['已加载', 'pill g'],
  disabled: ['已禁用', 'pill'],
  invalid: ['清单无效', 'pill r'],
  failed: ['加载失败', 'pill r'],
  stopped: ['已停止', 'pill']
};
const PLUGIN_ACTION_LABELS = { enable: '启用', disable: '停用', reload: '重载', uninstall: '卸载' };

async function runPluginAction(id, action, button) {
  const label = PLUGIN_ACTION_LABELS[action] || action;
  if (action === 'uninstall' && !window.confirm(`卸载 ${id}？目录会移到 state/_trash，不会硬删。`)) return;
  if (button) button.disabled = true;
  try {
    const data = action === 'uninstall'
      ? await api(`/api/plugins/${encodeURIComponent(id)}`, 'DELETE')
      : await api(`/api/plugins/${encodeURIComponent(id)}/${action}`, 'POST');
    if (!data?.ok) throw new Error(data?.error || '未知错误');
    showConsoleToast(`${id} 已${label}`);
  } catch (error) {
    showConsoleToast(`${id} ${label}失败：${error?.message || '未知错误'}`);
  } finally {
    if (button) button.disabled = false;
  }
  refreshPlugins().catch(() => {});
}

let pluginDetailId = null;
let pluginDetailSchema = null;

function pluginConfigField(key, property, value) {
  const name = `cfg__${key}`;
  const label = property.title || key;
  const hint = property.description || '';
  if (property.type === 'boolean') {
    return { type: 'switch', name, label, hint, checked: value === true, onLabel: '开', offLabel: '关' };
  }
  if (property.type === 'enum') {
    return {
      type: 'select', name, label, hint,
      value: value === undefined ? '' : String(value),
      options: property.enum.map((item) => ({ value: String(item), label: String(item) })),
    };
  }
  if (property.type === 'array') {
    return { type: 'textarea', name, label, hint, rows: 4, mono: true, value: JSON.stringify(value ?? [], null, 2) };
  }
  if (property.type === 'number' || property.type === 'integer') {
    return {
      type: 'number', name, label, hint,
      value: value === undefined ? '' : value,
      min: property.minimum, max: property.maximum,
      step: property.type === 'integer' ? 1 : 'any',
      integer: property.type === 'integer',
    };
  }
  if (property.format === 'textarea') {
    return { type: 'textarea', name, label, hint, rows: 4, value: value === undefined ? '' : String(value) };
  }
  return { type: 'text', name, label, hint, value: value === undefined ? '' : String(value) };
}

function readPluginConfig(schema) {
  const patch = {};
  for (const [key, property] of Object.entries(schema?.properties ?? {})) {
    const el = document.getElementById(`cfg__${key}`);
    if (!el) continue;
    if (property.type === 'boolean') { patch[key] = getSwitch(el); continue; }
    if (property.type === 'array') {
      const raw = String(el.value ?? '').trim();
      patch[key] = raw ? JSON.parse(raw) : [];
      continue;
    }
    if (property.type === 'number' || property.type === 'integer') {
      const raw = String(el.value ?? '').trim();
      if (raw !== '') patch[key] = Number(raw);
      continue;
    }
    if (property.type === 'enum') {
      patch[key] = property.enum.find((item) => String(item) === String(el.value)) ?? el.value;
      continue;
    }
    patch[key] = String(el.value ?? '');
  }
  return patch;
}

function renderPluginConfig(plugin) {
  const host = document.getElementById('pluginConfigMount');
  if (!host) return;
  pluginDetailSchema = plugin.configSchema ?? null;
  if (!pluginDetailSchema) {
    host.innerHTML = `<div class="plugin-config-none">该插件未声明配置项。${Object.keys(plugin.config ?? {}).length ? '下面是 plugins.json 里的原始配置。' : ''}</div>`;
    if (Object.keys(plugin.config ?? {}).length) {
      const pre = document.createElement('pre');
      pre.className = 'plugin-log-pre';
      pre.id = 'pluginConfigRaw';
      pre.textContent = JSON.stringify(plugin.config, null, 2);
      host.appendChild(pre);
    }
    return;
  }
  const fields = [{ type: 'section', label: '插件配置', card: true, hint: '由插件清单的 configSchema 生成；保存后写入 plugins.json 并重载该插件。' }];
  for (const [key, property] of Object.entries(pluginDetailSchema.properties ?? {})) {
    fields.push(pluginConfigField(key, property, plugin.config?.[key] ?? property.default));
  }
  fields.push({
    type: 'action',
    items: [
      { id: 'pluginConfigSave', label: '保存配置', variant: 'primary' },
      { id: 'pluginConfigTest', label: '测试配置' },
    ],
    status: 'pluginConfigMsg',
  });
  renderFields(host, fields, { columns: 1 });
  bindSwitches(host);
  host.querySelector('#pluginConfigSave')?.addEventListener('click', () => { savePluginConfig(false).catch(() => {}); });
  host.querySelector('#pluginConfigTest')?.addEventListener('click', () => { savePluginConfig(true).catch(() => {}); });
}

async function savePluginConfig(testOnly) {
  if (!pluginDetailId || !pluginDetailSchema) return;
  const msg = document.getElementById('pluginConfigMsg');
  let patch;
  try {
    patch = readPluginConfig(pluginDetailSchema);
  } catch (error) {
    if (msg) msg.textContent = `配置不是合法 JSON：${error?.message || '解析失败'}`;
    return;
  }
  if (msg) msg.textContent = testOnly ? '测试中…' : '保存中…';
  try {
    const data = testOnly
      ? await api(`/api/plugins/${encodeURIComponent(pluginDetailId)}/test`, 'POST', { config: patch })
      : await api(`/api/plugins/${encodeURIComponent(pluginDetailId)}/config`, 'PATCH', { config: patch });
    if (!data?.ok) throw new Error(data?.error || '未知错误');
    if (msg) msg.textContent = testOnly ? '配置校验通过' : (data.warning || '已保存并重载');
    showConsoleToast(testOnly ? '配置校验通过' : `${pluginDetailId} 配置已保存`);
    if (!testOnly) refreshPlugins().catch(() => {});
  } catch (error) {
    if (msg) msg.textContent = `${testOnly ? '测试' : '保存'}失败：${error?.message || '未知错误'}`;
  }
}

async function openPluginDetail(id) {
  const body = document.getElementById('pluginDetailBody');
  const logs = document.getElementById('pluginDetailLogs');
  const overlay = document.getElementById('pluginDetailOverlay');
  if (!body || !overlay) return;
  body.textContent = '加载中…';
  if (logs) logs.textContent = '读取中…';
  openModal(overlay);
  try {
    const data = await api(`/api/plugins/${encodeURIComponent(id)}`);
    const plugin = data?.plugin;
    if (!plugin) throw new Error('插件不存在');
    const audit = Array.isArray(plugin.audit) ? plugin.audit.slice(-12) : [];
    const lines = [
      `ID：${plugin.id}    状态：${plugin.status}`,
      `名称：${plugin.name}    版本：${plugin.version || '—'}`,
      `权限：${(plugin.permissions || []).join(', ') || '—'}`,
      `钩子：${(plugin.hooks || []).join(', ') || '—'}`,
      `命令：${(plugin.commands || []).join(', ') || '—'}`,
      `注入块：${(plugin.blocks || []).join(', ') || '—'}`,
      `入口：${plugin.source?.dir || '—'} / ${plugin.source?.main || '—'}`,
      `调用 ${plugin.counters?.hookCalls ?? 0} 次 · 失败 ${plugin.counters?.hookErrors ?? 0} 次 · 重载 ${plugin.counters?.reloads ?? 0} 次`,
      plugin.updatedAt ? `最近变更：${plugin.updatedAt}` : '',
      plugin.error ? `最近错误：${plugin.error}` : '',
    ].filter((line) => line !== '');
    body.textContent = lines.join('\n');
    if (logs) {
      logs.textContent = audit.length
        ? audit.map((item) => {
          const fields = Object.entries(item)
            .filter(([key]) => key !== 'ts' && key !== 'event')
            .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
            .join(' ');
          return `${item.ts || ''} ${item.event || ''} ${fields}`.trimEnd();
        }).join('\n')
        : '暂无审计记录';
    }
    pluginDetailId = plugin.id;
    renderPluginConfig(plugin);
    const persist = document.getElementById('pluginPersistEnabled');
    if (persist) setSwitch(persist, plugin.config?.enabled !== false);
    const persistMsg = document.getElementById('pluginPersistMsg');
    if (persistMsg) persistMsg.textContent = '';
  } catch (error) {
    body.textContent = `读取失败：${error?.message || '未知错误'}`;
    if (logs) logs.textContent = '—';
    const host = document.getElementById('pluginConfigMount');
    if (host) host.innerHTML = '';
  }
}

function closePluginDetail() {
  closeModal(document.getElementById('pluginDetailOverlay'));
}

async function installPluginFromZip() {
  const input = document.getElementById('pluginInstallZip');
  const msg = document.getElementById('pluginInstallMsg');
  const file = input?.files?.[0];
  if (!file) { if (msg) msg.textContent = '先选择一个 zip 文件'; return; }
  if (msg) msg.textContent = `正在上传 ${file.name}…`;
  try {
    const headers = { 'content-type': 'application/zip' };
    const token = localStorage.getItem('consoleToken');
    if (token) headers['x-console-token'] = token;
    const res = await fetch('/api/plugins/install', { method: 'POST', headers, body: file });
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    if (msg) msg.textContent = `已安装 ${data.plugin.id}@${data.plugin.version || '?'}`;
    if (input) input.value = '';
    showConsoleToast(`已安装 ${data.plugin.id}`);
    refreshPlugins().catch(() => {});
  } catch (error) {
    if (msg) msg.textContent = `安装失败：${error?.message || '未知错误'}`;
  }
}

async function installPluginFromPath() {
  const input = document.getElementById('pluginInstallPath');
  const msg = document.getElementById('pluginInstallMsg');
  const dir = String(input?.value || '').trim();
  if (!dir) { if (msg) msg.textContent = '先填服务器本地目录'; return; }
  if (msg) msg.textContent = `正在安装 ${dir}…`;
  try {
    const data = await api('/api/plugins/install', 'POST', { path: dir });
    if (!data?.ok) throw new Error(data?.error || '未知错误');
    if (msg) msg.textContent = `已安装 ${data.plugin.id}@${data.plugin.version || '?'}`;
    if (input) input.value = '';
    showConsoleToast(`已安装 ${data.plugin.id}`);
    refreshPlugins().catch(() => {});
  } catch (error) {
    if (msg) msg.textContent = `安装失败：${error?.message || '未知错误'}`;
  }
}

async function refreshPlugins() {
  const meta = document.getElementById('pluginsMeta');
  const list = document.getElementById('pluginsList');
  if (!meta || !list) return;
  try {
    const data = await api('/api/plugins');
    const plugins = Array.isArray(data?.plugins) ? data.plugins : [];
    const personaSource = data?.persona?.plugin ? `插件 ${data.persona.plugin}` : 'roles/*.md';
    const blockList = Array.isArray(data?.promptBlocks?.blocks) ? data.promptBlocks.blocks : [];
    const blockText = blockList.length ? ` · 注入块：${blockList.length} 个（总预算 ${Number(data.promptBlocks?.maxTotalChars) || 0} 字）` : '';
    meta.textContent = `启用：${data?.enabled === false ? '否' : '是'} · 目录：${data?.dir || 'plugins'} · 人格来源：${personaSource}${blockText}`;
    renderPluginSettings(data);
    if (!plugins.length) {
      list.innerHTML = '<div class="meta">没有发现插件。把插件放到 <code>plugins/&lt;id&gt;/</code> 后重启桥接，或在下面安装。</div>';
      return;
    }
    // #pluginsList 本身已是 .tile-list（grid 容器），卡片直接作为它的子项；
    // 再包一层 .tile-list 会让内层只占外层的一个网格列，卡片被迫单列。
    list.innerHTML = plugins.map((plugin) => {
      const [label, cls] = PLUGIN_STATUS_LABELS[plugin.status] || [plugin.status || '未知', 'pill'];
      const hooks = (plugin.hooks || []).length ? plugin.hooks.join(' / ') : '无';
      const counters = plugin.counters || {};
      const commands = (plugin.commands || []).length;
      const blocks = (plugin.blocks || []).length;
      const permissions = (plugin.permissions || []).map((permission) => `<span class="pill">${esc(permission)}</span>`).join('');
      const error = plugin.error ? `<div class="meta err">${esc(plugin.error)}</div>` : '';
      const toggle = plugin.status === 'active'
        ? `<button class="small" data-plugin-action="disable" data-plugin-id="${esc(plugin.id)}">停用</button>`
        : `<button class="small" data-plugin-action="enable" data-plugin-id="${esc(plugin.id)}">启用</button>`;
      const failures = Number(counters.hookErrors) || 0;
      return `<div class="tile">
        <div class="tile-head"><strong>${esc(plugin.name || plugin.id)}</strong><span class="${cls}">${esc(label)}</span><span class="pill b">v${esc(plugin.version || '—')}</span></div>
        <div class="meta">${esc(plugin.description || '这个插件没有写说明。')}</div>
        <div class="row">
          <span class="pill">${esc(plugin.id)}</span>${permissions}
          <span class="pill">钩子 ${esc(hooks)}</span>${commands ? `<span class="pill">命令 ${commands}</span>` : ''}${blocks ? `<span class="pill">注入块 ${blocks}</span>` : ''}
          <span class="pill">调用 ${Number(counters.hookCalls) || 0}</span>${failures ? `<span class="pill r">失败 ${failures}</span>` : ''}
        </div>
        ${error}
        <div class="row">${toggle}<button class="small" data-plugin-action="reload" data-plugin-id="${esc(plugin.id)}">重载</button><button class="small" data-plugin-action="detail" data-plugin-id="${esc(plugin.id)}">详情</button><button class="small" data-plugin-action="uninstall" data-plugin-id="${esc(plugin.id)}">卸载</button></div>
      </div>`;
    }).join('');
  } catch (error) {
    meta.textContent = '';
    list.innerHTML = `<div class="meta err">读取失败：${esc(error?.message || '未知错误')}</div>`;
  }
}

// 把 /api/plugins 的配置节填进「注入块」「运行设置」两块表单；
// 正在编辑的输入框不覆盖，避免 15 秒自动刷新把用户刚敲的数字冲掉。
const BLOCK_STATUS_TEXT = {
  injected: ['正常', 'pill g'],
  truncated: ['截断', 'pill r'],
  budget: ['超预算跳过', 'pill r'],
  error: ['失败', 'pill r'],
  off: ['已关闭', 'pill'],
  empty: ['空', 'pill'],
  idle: ['未调用', 'pill'],
};

function blockRowsHtml(blocks) {
  return `<div class="table-wrap"><table class="table-block-settings">
    <thead><tr><th data-w="64">启用</th><th data-w="210">块</th><th data-w="120">来源</th><th data-w="70">优先级</th><th data-w="130">上限</th><th data-w="90">最近字数</th><th>状态</th><th data-w="130">最近</th></tr></thead>
    <tbody>${blocks.map((block) => {
      const [label, cls] = BLOCK_STATUS_TEXT[block.lastStatus] || [block.lastStatus || '未调用', 'pill'];
      const owner = block.owner || (block.pluginId === 'core' ? 'core' : `plugin:${block.pluginId}`);
      const detail = block.lastError ? ` title="${esc(block.lastError)}"` : '';
      const when = block.lastRunAt ? new Date(block.lastRunAt).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
      const chars = block.lastRunAt ? (block.maxChars ? `${Number(block.lastChars) || 0} / ${block.maxChars}` : `${Number(block.lastChars) || 0}`) : '—';
      return `<tr data-block-row="${esc(block.id)}">
        <td><button class="field-switch" type="button" role="switch" data-field data-block-enabled="${esc(block.id)}" aria-checked="${block.enabled ? 'true' : 'false'}"><span class="field-switch-track"></span><span>${block.enabled ? '开' : '关'}</span></button></td>
        <td><code>${esc(block.id)}</code><div class="meta">${esc(block.label || '')}</div></td>
        <td class="meta">${esc(owner)}</td>
        <td class="meta">${Number(block.priority) || 0}</td>
        <td><input type="number" data-block-max="${esc(block.id)}" min="1" max="100000" step="100" value="${block.maxChars ?? ''}" placeholder="不限"${detail}></td>
        <td class="meta">${chars}</td>
        <td><span class="${cls}">${esc(label)}</span>${Number(block.calls) ? `<div class="meta">调用 ${Number(block.calls)} 次</div>` : ''}</td>
        <td class="meta">${esc(when)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function renderPluginSettings(data) {
  const rows = document.getElementById('promptBlockRows');
  const blocks = Array.isArray(data?.promptBlocks?.blocks) ? data.promptBlocks.blocks : [];
  if (rows && !document.activeElement?.closest('#promptBlockRows')) {
    rows.innerHTML = blocks.length ? blockRowsHtml(blocks) : '<div class="meta">还没有注册任何注入块。</div>';
    if (blocks.length) bindSwitches(rows);
  }

  const group = document.getElementById('pluginRuntimeGroup');
  if (group && !document.activeElement?.closest('#pluginRuntimeGroup')) {
    const filter = document.getElementById('pluginFilterInbound');
    const watch = document.getElementById('pluginWatch');
    const timeout = document.getElementById('pluginHookTimeout');
    const append = document.getElementById('pluginAppendLimit');
    const install = document.getElementById('pluginInstallEnabled');
    if (filter) setSwitch(filter, data?.filters?.inbound === true);
    if (watch) setSwitch(watch, data?.watch === true);
    if (timeout) timeout.value = data?.limits?.hookTimeoutMs ?? '';
    if (append) append.value = data?.limits?.maxPromptAppendChars ?? '';
    if (install) setSwitch(install, data?.install?.enabled !== false);
  }
}

async function savePromptBlockSettings() {
  const msg = document.getElementById('promptBlockMsg');
  const promptBlocks = {};
  document.querySelectorAll('[data-block-enabled]').forEach((switchEl) => {
    const id = switchEl.dataset.blockEnabled;
    const maxInput = document.querySelector(`[data-block-max="${CSS.escape(id)}"]`);
    const raw = maxInput?.value?.trim() ?? '';
    promptBlocks[id] = { enabled: getSwitch(switchEl), maxChars: raw === '' ? null : Number(raw) };
  });
  if (!Object.keys(promptBlocks).length) { if (msg) msg.textContent = '没有可保存的块'; return; }
  if (msg) msg.textContent = '保存中…';
  try {
    await api('/api/config/promptBlocks', 'PATCH', { promptBlocks });
    if (msg) msg.textContent = '已保存，立即生效';
    showConsoleToast('注入块设置已保存');
    refreshPlugins().catch(() => {});
  } catch (error) {
    if (msg) msg.textContent = `保存失败：${error?.message || '未知错误'}`;
  }
}

async function savePluginRuntimeSettings() {
  const msg = document.getElementById('pluginSettingsMsg');
  if (msg) msg.textContent = '保存中…';
  const patch = {
    filters: { inbound: getSwitch(document.getElementById('pluginFilterInbound')) },
    watch: getSwitch(document.getElementById('pluginWatch')),
    install: { enabled: getSwitch(document.getElementById('pluginInstallEnabled')) },
  };
  // 空输入不发：内核把 0 当越界并拒绝整份保存，留空应该表示「不改」。
  const timeoutRaw = document.getElementById('pluginHookTimeout')?.value?.trim() ?? '';
  const appendRaw = document.getElementById('pluginAppendLimit')?.value?.trim() ?? '';
  patch.limits = {};
  if (timeoutRaw !== '') patch.limits.hookTimeoutMs = Number(timeoutRaw);
  if (appendRaw !== '') patch.limits.maxPromptAppendChars = Number(appendRaw);
  try {
    const data = await api('/api/plugins/settings', 'PATCH', patch);
    if (msg) msg.textContent = data?.restartRequired ? '已保存，部分设置需重启后生效' : '已保存，立即生效';
    showConsoleToast('运行设置已保存');
    refreshPlugins().catch(() => {});
  } catch (error) {
    if (msg) msg.textContent = `保存失败：${error?.message || '未知错误'}`;
  }
}

async function savePluginPersistEnabled() {
  if (!pluginDetailId) return;
  const msg = document.getElementById('pluginPersistMsg');
  const enabled = getSwitch(document.getElementById('pluginPersistEnabled'));
  if (msg) msg.textContent = '保存中…';
  try {
    const data = await api('/api/plugins/settings', 'PATCH', { plugins: { [pluginDetailId]: { enabled } } });
    if (msg) msg.textContent = data?.restartRequired ? '已写入 plugins.json，重启后生效' : '已保存';
    showConsoleToast('插件配置已写入 plugins.json');
  } catch (error) {
    if (msg) msg.textContent = `保存失败：${error?.message || '未知错误'}`;
  }
}

/** 绑定事件、注册刷新回调，并做首次加载。入口脚本启动时调一次。 */
export function init() {
  renderPluginsFields();
  // 详情弹窗的遮罩必须挂在 body 上：片段注入在 .card 里，而 .card 有动画/滤镜，
  // 会给 position:fixed 造出包含块，遮罩就只盖住卡片、盖不住整页。
  const overlay = document.getElementById('pluginDetailOverlay');
  if (overlay && overlay.parentElement !== document.body) document.body.appendChild(overlay);
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-plugin-action]');
    if (!button) return;
    const { pluginAction, pluginId } = button.dataset;
    if (pluginAction === 'detail') {
      openPluginDetail(pluginId).catch(() => {});
      return;
    }
    runPluginAction(pluginId, pluginAction, button);
  });
  document.getElementById('pluginsRefresh').addEventListener('click', () => {
    refreshPlugins();
    showConsoleToast('插件状态已刷新');
  });
  document.getElementById('pluginsReloadAll').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const data = await api('/api/plugins/reload', 'POST');
      const failed = (data?.results || []).filter((item) => !item.ok);
      showConsoleToast(failed.length ? `重载完成，${failed.length} 个失败` : '全部插件已重载');
    } catch (error) {
      showConsoleToast(`全部重载失败：${error?.message || '未知错误'}`);
    } finally {
      button.disabled = false;
    }
    refreshPlugins().catch(() => {});
  });
  document.getElementById('pluginDetailClose').addEventListener('click', closePluginDetail);
  wireModal(document.getElementById('pluginDetailOverlay'), { onClose: () => { pluginDetailId = null; } });
  document.getElementById('pluginInstallZipBtn').addEventListener('click', () => { installPluginFromZip().catch(() => {}); });
  document.getElementById('pluginInstallPathBtn').addEventListener('click', () => { installPluginFromPath().catch(() => {}); });
  document.getElementById('promptBlockSave').addEventListener('click', () => { savePromptBlockSettings().catch(() => {}); });
  document.getElementById('pluginSettingsSave').addEventListener('click', () => { savePluginRuntimeSettings().catch(() => {}); });
  document.getElementById('pluginPersistSave').addEventListener('click', () => { savePluginPersistEnabled().catch(() => {}); });
  onPageRefresh('plugins', () => { refreshPlugins().catch(() => {}); });
  setInterval(() => { if (getCurrentPage() === 'plugins' && !document.hidden) refreshPlugins().catch(() => {}); }, 15_000);
  refreshPlugins().catch(() => {});
}
