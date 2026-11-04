// 插件页：加载状态、启停/重载/卸载、安装与运行设置、详情弹窗。
//
// 本页自己负责数据与事件：路由器注入片段后调一次 init()。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';

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

async function openPluginDetail(id) {
  const body = document.getElementById('pluginDetailBody');
  const overlay = document.getElementById('pluginDetailOverlay');
  if (!body || !overlay) return;
  body.textContent = '加载中…';
  overlay.classList.add('open');
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
      `注入块：${(plugin.blocks || []).join(', ') || '—'}`,,
      `入口：${plugin.source?.dir || '—'} / ${plugin.source?.main || '—'}`,
      `调用 ${plugin.counters?.hookCalls ?? 0} 次 · 失败 ${plugin.counters?.hookErrors ?? 0} 次 · 重载 ${plugin.counters?.reloads ?? 0} 次`,
      plugin.updatedAt ? `最近变更：${plugin.updatedAt}` : '',
      plugin.error ? `最近错误：${plugin.error}` : '',
      '',
      '最近审计：',
      ...audit.map((item) => {
        const fields = Object.entries(item)
          .filter(([key]) => key !== 'ts' && key !== 'event')
          .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
          .join(' ');
        return `  ${item.ts || ''} ${item.event || ''} ${fields}`.trimEnd();
      }),
    ].filter((line) => line !== '');
    body.textContent = lines.join('\n');
    pluginDetailId = plugin.id;
    const persist = document.getElementById('pluginPersistEnabled');
    if (persist) persist.checked = plugin.config?.enabled !== false;
    const persistMsg = document.getElementById('pluginPersistMsg');
    if (persistMsg) persistMsg.textContent = '';
  } catch (error) {
    body.textContent = `读取失败：${error?.message || '未知错误'}`;
  }
}

function closePluginDetail() {
  document.getElementById('pluginDetailOverlay')?.classList.remove('open');
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
    const coreBlocks = Array.isArray(data?.coreBlocks?.blocks) ? data.coreBlocks.blocks : [];
    const coreText = coreBlocks.length ? ` · 内置注入块：${coreBlocks.map((block) => `${block.id}（上限 ${block.maxChars} 字）`).join('、')}` : '';
    meta.textContent = `启用：${data?.enabled === false ? '否' : '是'} · 目录：${data?.dir || 'plugins'} · 人格来源：${personaSource}${coreText}`;
    renderPluginSettings(data);
    if (!plugins.length) {
      list.innerHTML = '<div class="meta">没有发现插件。把插件放到 <code>plugins/&lt;id&gt;/</code> 后重启桥接，或在下面安装。</div>';
      return;
    }
    list.innerHTML = `<div class="tile-list">${plugins.map((plugin) => {
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
    }).join('')}</div>`;
  } catch (error) {
    meta.textContent = '';
    list.innerHTML = `<div class="meta err">读取失败：${esc(error?.message || '未知错误')}</div>`;
  }
}

// 把 /api/plugins 的配置节填进「内置注入块」「运行设置」两块表单；
// 正在编辑的输入框不覆盖，避免 15 秒自动刷新把用户刚敲的数字冲掉。
function renderPluginSettings(data) {
  const rows = document.getElementById('promptBlockRows');
  const catalog = Array.isArray(data?.coreBlocks?.catalog) ? data.coreBlocks.catalog : [];
  if (rows && !document.activeElement?.closest('#promptBlockRows')) {
    rows.innerHTML = catalog.length
      ? catalog.map((item) => `
        <div class="row" style="align-items:center;gap:12px">
          <label class="field" style="display:flex;align-items:center;gap:6px;min-width:180px">
            <input type="checkbox" data-core-enabled="${esc(item.id)}" ${item.enabled ? 'checked' : ''}> ${esc(item.label)}
          </label>
          <label class="field">上限 <input type="number" data-core-max="${esc(item.id)}" min="1" max="100000" step="100" style="width:130px" value="${item.maxChars ?? ''}" placeholder="默认"></label>
          <span class="meta">${item.registered ? `已注册 · 调用 ${Number(item.calls) || 0} 次` : '已关闭'}</span>
        </div>`).join('')
      : '<div class="meta">没有可配置的内置块。</div>';
  }

  const group = document.getElementById('pluginRuntimeGroup');
  if (group && !document.activeElement?.closest('#pluginRuntimeGroup')) {
    const filter = document.getElementById('pluginFilterInbound');
    const watch = document.getElementById('pluginWatch');
    const timeout = document.getElementById('pluginHookTimeout');
    const append = document.getElementById('pluginAppendLimit');
    const install = document.getElementById('pluginInstallEnabled');
    if (filter) filter.checked = data?.filters?.inbound === true;
    if (watch) watch.checked = data?.watch === true;
    if (timeout) timeout.value = data?.limits?.hookTimeoutMs ?? '';
    if (append) append.value = data?.limits?.maxPromptAppendChars ?? '';
    if (install) install.checked = data?.install?.enabled !== false;
  }
}

async function savePromptBlockSettings() {
  const msg = document.getElementById('promptBlockMsg');
  const promptBlocks = {};
  document.querySelectorAll('[data-core-enabled]').forEach((input) => {
    const id = input.dataset.coreEnabled;
    const maxInput = document.querySelector(`[data-core-max="${CSS.escape(id)}"]`);
    const raw = maxInput?.value?.trim() ?? '';
    promptBlocks[id] = { enabled: input.checked, maxChars: raw === '' ? null : Number(raw) };
  });
  if (!Object.keys(promptBlocks).length) { if (msg) msg.textContent = '没有可保存的块'; return; }
  if (msg) msg.textContent = '保存中…';
  try {
    await api('/api/config/promptBlocks', 'PATCH', { promptBlocks });
    if (msg) msg.textContent = '已保存，立即生效';
    showConsoleToast('内置注入块设置已保存');
    refreshPlugins().catch(() => {});
  } catch (error) {
    if (msg) msg.textContent = `保存失败：${error?.message || '未知错误'}`;
  }
}

async function savePluginRuntimeSettings() {
  const msg = document.getElementById('pluginSettingsMsg');
  if (msg) msg.textContent = '保存中…';
  const patch = {
    filters: { inbound: document.getElementById('pluginFilterInbound')?.checked === true },
    watch: document.getElementById('pluginWatch')?.checked === true,
    install: { enabled: document.getElementById('pluginInstallEnabled')?.checked === true },
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
  const enabled = document.getElementById('pluginPersistEnabled')?.checked === true;
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
  document.getElementById('pluginDetailOverlay').addEventListener('click', (event) => {
    if (event.target.id === 'pluginDetailOverlay') closePluginDetail();
  });
  document.getElementById('pluginInstallZipBtn').addEventListener('click', () => { installPluginFromZip().catch(() => {}); });
  document.getElementById('pluginInstallPathBtn').addEventListener('click', () => { installPluginFromPath().catch(() => {}); });
  document.getElementById('promptBlockSave').addEventListener('click', () => { savePromptBlockSettings().catch(() => {}); });
  document.getElementById('pluginSettingsSave').addEventListener('click', () => { savePluginRuntimeSettings().catch(() => {}); });
  document.getElementById('pluginPersistSave').addEventListener('click', () => { savePluginPersistEnabled().catch(() => {}); });
  onPageRefresh('plugins', () => { refreshPlugins().catch(() => {}); });
  setInterval(() => { if (getCurrentPage() === 'plugins' && !document.hidden) refreshPlugins().catch(() => {}); }, 15_000);
  refreshPlugins().catch(() => {});
}
