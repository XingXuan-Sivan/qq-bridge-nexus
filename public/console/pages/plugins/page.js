// 插件页：清单（三张卡）+ 二级详情页（#plugins/<id>）。
//
// 清单只放摘要与运行期动作（启停 / 重载 / 卸载）：点卡片进详情改配置、写落盘开关、看审计。
// 路由：#plugins 是清单，#plugins/<id> 是某个插件的详情。两个视图都常驻本页 DOM，
// 切子段只切显隐 —— 来回切不会丢掉清单的滚动位置。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { getCurrentPage, onPageRefresh, onPageRoute, setConsolePage } from '../../js/router.js';
import { cardHtml } from '../../components/card/card.js';
import { collapseHtml } from '../../components/collapse/collapse.js';
import { tag } from '../../components/tag/tag.js';
import { tileHtml } from '../../components/tile/tile.js';
import { bindSwitches, getSwitch, renderFields, setSwitch } from '../../components/form/form.js';
import { confirmBox } from '../../components/message-box/message-box.js';
import { PLUGINS_FIELDS, pluginStatusTag } from './fields.js';
import { mountPluginDetail, unmountPluginDetail } from './plugin-detail.js';

const ACTION_LABELS = { enable: '启用', disable: '停用', reload: '重载', uninstall: '卸载' };

// 当前画出来的子路由；空表示在清单页。详情只在换插件时重挂：重画会丢掉表单草稿与状态位。
let routeSub = '';

// 卡片外壳统一由 card 组件生成（page.html 只留 #pluginsHost 宿主）。
// 两张 .is-group 卡本来就没有标题（可见标题是 <summary>），所以只给 className 与 body。
function listCardsHtml() {
  return [
    cardHtml({
      title: '桥接插件',
      description: '可以启用 / 停用 / 重载单个插件；这两个开关只改本次运行，不改 <code>plugins.json</code>——改配置或想永久生效仍需重启桥接（文件监听见路线图 P2c）。插件放在 <code>plugins/&lt;id&gt;/</code>，设计与权限见 <code>docs/PLUGIN_KERNEL.md</code>；首个示例是 <code>soulkit-persona</code>（人格 provider，默认关闭）。',
      body: `<div data-plugins-fields="toolbar"></div>
      <div data-plugins-fields="list"></div>`,
    }),
    cardHtml({
      className: 'is-group',
      body: collapseHtml({
        elementId: 'pluginRuntimeGroup',
        title: '运行设置',
        body: '<div data-plugins-fields="runtime"></div>',
      }),
    }),
    cardHtml({
      className: 'is-group',
      body: collapseHtml({
        title: '安装插件',
        body: `<div class="meta">安装即执行代码：只在本机控制台操作，每次安装 / 卸载都写审计。zip 里必须恰好有一个含 <code>plugin.json</code> 的目录；上限 5MB，不允许符号链接。</div>
          <div data-plugins-fields="install"></div>
          <div data-plugins-fields="installPath"></div>`,
      }),
    }),
  ].join('');
}

// 渲染工具行与设置块的控件；开关由 bindSwitches 统一接管（值在 aria-checked 上）。
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

// ── 清单 ────────────────────────────────────────────────────────────────────
// 只读视图：加载/校验/失败都在桥接启动时决定，这里不做「伪热重载」。
async function runPluginAction(id, action, button) {
  const label = ACTION_LABELS[action] || action;
  if (action === 'uninstall' && !(await confirmBox({ message: `卸载 ${id}？目录会移到 state/_trash，不会硬删。`, danger: true, confirmText: '卸载' }))) return;
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

function setView(name) {
  const host = document.getElementById('pluginsHost');
  if (!host) return;
  for (const view of host.querySelectorAll('[data-plugins-view]')) {
    view.hidden = view.dataset.pluginsView !== name;
  }
}

function detailView() {
  return document.querySelector('#pluginsHost [data-plugins-view="detail"]');
}

/**
 * 按路由画页面：清单常驻，详情按需挂载。
 * 深链（刷新后直接落 #plugins/<id>）不等清单接口——详情自己会拉 /api/plugins/<id>。
 */
function paint({ sub = '' } = {}) {
  const next = String(sub ?? '');
  if (!next) {
    unmountPluginDetail();
    routeSub = '';
    setView('list');
    return;
  }
  setView('detail');
  if (routeSub === next) return;
  routeSub = next;
  mountPluginDetail(detailView(), next, {
    onBack: () => { setConsolePage('plugins', { sub: '' }); },
    // 写成功只刷新清单：详情保持原样，状态位文案与用户刚敲的值都还在。
    onChanged: () => { refreshPlugins().catch(() => {}); },
  });
}

async function refreshPlugins() {
  const meta = document.getElementById('pluginsMeta');
  const list = document.getElementById('pluginsList');
  if (!meta || !list) return;
  try {
    const data = await api('/api/plugins');
    const plugins = Array.isArray(data?.plugins) ? data.plugins : [];
    const personaSource = data?.persona?.plugin ? `插件 ${data.persona.plugin}` : 'roles/*.md';
    meta.textContent = `启用：${data?.enabled === false ? '否' : '是'} · 目录：${data?.dir || 'plugins'} · 人格来源：${personaSource}`;
    renderPluginSettings(data);
    if (!plugins.length) {
      list.innerHTML = '<div class="meta">没有发现插件。把插件放到 <code>plugins/&lt;id&gt;/</code> 后重启桥接，或在下面安装。</div>';
      return;
    }
    // #pluginsList 本身已是 .tile-list（grid 容器），卡片直接作为它的子项；
    // 再包一层 .tile-list 会让内层只占外层的一个网格列，卡片被迫单列。
    list.innerHTML = plugins.map((plugin) => {
      const hooks = (plugin.hooks || []).length ? plugin.hooks.join(' / ') : '无';
      const counters = plugin.counters || {};
      const commands = (plugin.commands || []).length;
      const blocks = (plugin.blocks || []).length;
      const failures = Number(counters.hookErrors) || 0;
      const toggle = plugin.status === 'active'
        ? `<button class="btn small" data-plugin-action="disable" data-plugin-id="${esc(plugin.id)}">停用</button>`
        : `<button class="btn small" data-plugin-action="enable" data-plugin-id="${esc(plugin.id)}">启用</button>`;
      return tileHtml({
        id: plugin.id,
        title: plugin.name || plugin.id,
        badges: [pluginStatusTag(plugin.status), tag(`v${plugin.version || '—'}`, { type: 'primary' })],
        description: plugin.description || '这个插件没有写说明。',
        tags: [
          tag(plugin.id),
          ...(plugin.permissions || []).map((permission) => tag(permission)),
          tag(`钩子 ${hooks}`),
          commands ? tag(`命令 ${commands}`) : '',
          blocks ? tag(`注入块 ${blocks}`) : '',
          tag(`调用 ${Number(counters.hookCalls) || 0}`),
          failures ? tag(`失败 ${failures}`, { type: 'danger' }) : '',
        ],
        error: plugin.error || '',
        actions: `${toggle}<button class="btn small" data-plugin-action="reload" data-plugin-id="${esc(plugin.id)}">重载</button><button class="btn small" data-plugin-action="uninstall" data-plugin-id="${esc(plugin.id)}">卸载</button>`,
        interactive: true,
      });
    }).join('');
  } catch (error) {
    meta.textContent = '';
    list.innerHTML = `<div class="meta err">读取失败：${esc(error?.message || '未知错误')}</div>`;
  }
}

// 把 /api/plugins 的配置节填进「运行设置」表单；
// 正在编辑的输入框不覆盖，避免 15 秒自动刷新把用户刚敲的数字冲掉。
function renderPluginSettings(data) {
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

// ── 安装 ────────────────────────────────────────────────────────────────────
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

// ── 事件与入口 ──────────────────────────────────────────────────────────────

function openPlugin(id) {
  if (!id) return;
  setConsolePage('plugins', { sub: id });
}

function onClick(event) {
  if (!(event.target instanceof Element)) return;
  const action = event.target.closest('[data-plugin-action]');
  if (action) {
    runPluginAction(action.dataset.pluginId, action.dataset.pluginAction, action);
    return;
  }
  const tile = event.target.closest('[data-tile-id]');
  // 卡片里的按钮自己处理点击，不把整卡当跳转。
  if (tile?.dataset.tileId && !event.target.closest('button, a')) openPlugin(tile.dataset.tileId);
}

/** 卡片是 role="button"：回车/空格与点击等价（与平台清单一致）。 */
function onKey(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (!(event.target instanceof Element) || event.target.dataset.tileId === undefined) return;
  event.preventDefault();
  openPlugin(event.target.dataset.tileId);
}

/** 绑定事件、注册刷新回调，并做首次加载。入口脚本启动时调一次。 */
export function init() {
  const host = document.getElementById('pluginsHost');
  if (!host) return;
  host.innerHTML = `
    <div class="page-stack" data-plugins-view="list">${listCardsHtml()}</div>
    <div class="page-stack" data-plugins-view="detail" hidden></div>`;
  // 先拼卡片外壳：下面 renderPluginsFields 与各处 getElementById 都依赖这些节点。
  renderPluginsFields();
  // 事件委托挂在宿主上：清单每次刷新都重建，监听只绑一次。
  host.addEventListener('click', onClick);
  host.addEventListener('keydown', onKey);
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
  document.getElementById('pluginInstallZipBtn').addEventListener('click', () => { installPluginFromZip().catch(() => {}); });
  document.getElementById('pluginInstallPathBtn').addEventListener('click', () => { installPluginFromPath().catch(() => {}); });
  document.getElementById('pluginSettingsSave').addEventListener('click', () => { savePluginRuntimeSettings().catch(() => {}); });
  onPageRefresh('plugins', () => { refreshPlugins().catch(() => {}); });
  onPageRoute('plugins', ({ sub }) => paint({ sub }));
  setInterval(() => { if (getCurrentPage() === 'plugins' && !document.hidden) refreshPlugins().catch(() => {}); }, 15_000);
  refreshPlugins().catch(() => {});
}
