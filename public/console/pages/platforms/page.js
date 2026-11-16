// 平台页：卡片清单（用户平台 / Agent 平台两个折叠组）+ 二级详情页。
//
// 数据只有一个来源：js/registry.js 里那份 /api/platforms/registry 快照（两侧是同一份
// 响应）。清单页自己不发任何平台请求；详情里的提示词 / 行为档案 / 能力预设各自去拉
// 正文（那些是资产，不是清单）。
//
// 路由：#platforms 是清单，#platforms/<side>:<id>[/<tab>] 是某个平台的详情页。清单与
// 详情都常驻本页 DOM，切子段只切显隐 —— 折叠组的展开状态不会因为来回切而丢。
import { esc } from '../../js/ui.js';
import { onPageRefresh, onPageRoute, setConsolePage } from '../../js/router.js';
import { cardHtml } from '../../components/card/card.js';
import { collapseHtml } from '../../components/collapse/collapse.js';
import { tileHtml } from '../../components/tile/tile.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { diagnosticsOf, inboundStateLabel, inboundStateTone, loadPlatforms, registryMeta } from '../../js/registry.js';
import { mountPlatformDetail, unmountPlatformDetail } from './platform-detail.js';

const SIDE_ORDER = ['user', 'agent'];
const SIDE_LABEL = { user: '用户平台', agent: 'Agent 平台' };
const SIDE_HINT = {
  user: '一条条目 = 一个实例（平台 + 账号），各有自己的入站管线。点卡片看连接、平台选项、话术与行为。',
  agent: '桥接启动时装配的那个 Agent 平台。点卡片看能力档、平台选项与诊断。',
};
const SIDE_EMPTY = {
  user: '还没有装配用户平台：在 <code>profiles/platforms</code> 下加目录后重启桥接。',
  agent: '还没有装配 Agent 平台：在 <code>profiles/agent-platforms</code> 下加目录后重启桥接。',
};
const SOURCE_LABEL = { builtin: '内置', plugin: '插件', 'profile-only': '仅配置', 'config-only': '仅条目' };
const SOURCE_HINT = {
  builtin: '随桥接一起装配的平台适配器。',
  plugin: '由插件在运行期注册的平台，没有配置目录。',
  'profile-only': '磁盘上有配置目录，但运行期没装配：在这里改的配置不会生效。',
  'config-only': '配置里有这条实例，但没有声明目录也没有实现：它不会被装配。',
};
const LEVEL_LABEL = { error: '错误', warn: '警告' };
const LEVEL_TONE = { error: 'tag--danger', warn: 'tag--warning' };

// 当前画出来的二级路由；`sub` 为空表示在清单页。
let route = { sub: '', tab: '' };
// 已挂载详情的平台 key（空 = 详情面板是空的）。
let detailKey = '';

function keyOf(item) {
  return `${item.side}:${item.id}`;
}

function findPlatform(meta, key) {
  if (!key) return null;
  return (meta.platforms ?? []).find((item) => keyOf(item) === key) ?? null;
}

function detailView() {
  return document.querySelector('#platformHost [data-platform-view="detail"]');
}

function setView(name) {
  const host = document.getElementById('platformHost');
  if (!host) return;
  for (const view of host.querySelectorAll('[data-platform-view]')) {
    view.hidden = view.dataset.platformView !== name;
  }
}

// ── 清单 ────────────────────────────────────────────────────────────────────

/** 状态徽标：运行期 / 待重启 / 停用 / 入站结论 / 诊断结论，与详情页同一套说法。 */
function tileBadges(meta, item) {
  const diags = diagnosticsOf(item.side, item.id, meta);
  const hasError = diags.some((diag) => diag.level === 'error');
  return [
    item.active ? '<span class="tag tag--success tag--sm">运行中</span>' : '',
    // 配置面已改为默认、本进程还没装配：重启后才会变成「运行中」。
    item.configured && !item.active ? '<span class="tag tag--warning tag--sm">待重启</span>' : '',
    // 用户平台多两态：停用的实例不会装配；入站结论是这个实例此刻的真实状态
    // （停用的实例已经有「已停用」徽标，不再叠一枚同名的入站徽标）。
    item.side === 'user' && item.enabled === false ? '<span class="tag tag--warning tag--sm">已停用</span>' : '',
    item.side === 'user' && item.enabled !== false && item.inboundState?.state
      ? `<span class="tag ${inboundStateTone(item.inboundState.state)} tag--sm">${esc(inboundStateLabel(item.inboundState.state))}</span>`
      : '',
    hasError ? '<span class="tag tag--danger tag--sm">错误</span>' : '',
    !hasError && diags.length ? '<span class="tag tag--warning tag--sm">警告</span>' : '',
  ].filter(Boolean);
}

function tileHtmlOf(meta, item) {
  const assets = item.assets ?? {};
  return tileHtml({
    id: keyOf(item),
    title: item.label || item.id,
    badges: tileBadges(meta, item),
    description: SOURCE_HINT[item.source] ?? '',
    tags: [
      `<span class="tag">${esc(item.id)}</span>`,
      `<span class="tag">${esc(SOURCE_LABEL[item.source] ?? item.source)}</span>`,
      item.side === 'user' ? `<span class="tag">${item.inbound ? '可收发' : '只出不进'}</span>` : '',
      item.side === 'user' ? `<span class="tag">行为 ${(assets.behaviors ?? []).length}</span>` : '',
      item.side === 'agent' ? `<span class="tag">能力档 ${(assets.capabilityProfiles ?? []).length}</span>` : '',
    ].filter(Boolean),
    interactive: true,
  });
}

/** 诊断汇总卡：只有 error 时才占地方（warning 在各平台的详情里看）。每条都能指到具体平台。 */
function diagnosticsCardHtml(meta) {
  const diags = (meta.diagnostics ?? []).filter((diag) => diag.level === 'error');
  if (!diags.length) return '';
  return cardHtml({
    id: 'platformDiagnosticsCard',
    title: '诊断',
    description: '两侧平台的装配与配置错误都在这里；点一行进对应平台。',
    body: dataTableHtml({
      columns: [{ label: '级别', width: '80px' }, { label: '平台', width: '180px' }, { label: '代码', width: '180px' }, { label: '说明' }],
      rows: diags.map((diag) => ({
        attrs: { 'data-diag-key': `${diag.side}:${diag.platformId}` },
        cells: [
          `<span class="tag ${LEVEL_TONE[diag.level] ?? ''}">${esc(LEVEL_LABEL[diag.level] ?? diag.level)}</span>`,
          `<code>${esc(diag.platformId)}</code><div class="meta">${esc(SIDE_LABEL[diag.side] ?? diag.side)}</div>`,
          `<code>${esc(diag.code)}</code>`,
          esc(diag.message || ''),
        ],
      })),
      pageSize: 10,
      empty: '没有诊断。',
    }),
  });
}

/** 一侧的折叠组：卡壳由 cardHtml 给，可见标题是 <summary>（is-group 的既有写法）。 */
function groupHtml(side) {
  return cardHtml({
    className: 'is-group',
    body: collapseHtml({
      elementId: `platformGroup-${side}`,
      title: SIDE_LABEL[side],
      body: `<p class="meta">${SIDE_HINT[side]}</p>
        <div class="tile-list" data-platform-list="${side}"></div>
        <p class="meta" data-platform-empty="${side}" hidden>${SIDE_EMPTY[side]}</p>`,
    }),
  });
}

/** 重画清单：卡片网格按快照刷新，诊断卡按需出现/消失；折叠组本身不动（保住展开状态）。 */
function paintList(meta) {
  const view = document.querySelector('#platformHost [data-platform-view="list"]');
  if (!view) return;
  const diag = diagnosticsCardHtml(meta);
  const current = view.querySelector('#platformDiagnosticsCard');
  if (!diag) current?.remove();
  else if (current) current.outerHTML = diag;
  else view.insertAdjacentHTML('afterbegin', diag);
  for (const side of SIDE_ORDER) {
    const items = (meta.platforms ?? []).filter((item) => item.side === side);
    const list = view.querySelector(`[data-platform-list="${side}"]`);
    const empty = view.querySelector(`[data-platform-empty="${side}"]`);
    if (list) {
      list.hidden = !items.length;
      list.innerHTML = items.map((item) => tileHtmlOf(meta, item)).join('');
    }
    if (empty) empty.hidden = items.length > 0;
    const summary = view.querySelector(`#platformGroup-${side} summary`);
    if (summary) summary.textContent = `${SIDE_LABEL[side]} · ${items.length}`;
  }
  initDataTables(view);
}

// ── 详情 ────────────────────────────────────────────────────────────────────

function showDetail(meta, item, tab) {
  const view = detailView();
  if (!view) return;
  unmountPlatformDetail();
  mountPlatformDetail(view, { ...item, diagnostics: diagnosticsOf(item.side, item.id, meta) }, {
    tab,
    // 写口成功后重拉注册表：清单、诊断与详情同属一份快照。
    onChanged: () => void refresh(),
    onBack: () => { setConsolePage('platforms', { sub: '' }); },
    onTab: (next) => { setConsolePage('platforms', { sub: keyOf(item), tab: next }); },
  });
}

/**
 * 按路由画页面（清单常画，详情按需挂）。
 * @param {{sub?: string, tab?: string, force?: boolean}} [options] force 用于数据刷新：
 *   同一个平台同一标签也重挂面板，否则只更新清单（避免切标签时重复拉资产）。
 */
function paint({ sub = '', tab = '', force = false } = {}) {
  const meta = registryMeta();
  paintList(meta);
  const item = findPlatform(meta, sub);
  if (!item) {
    unmountPlatformDetail();
    detailKey = '';
    route = { sub: '', tab: '' };
    setView('list');
    // 深链指向一个不存在的平台：把地址栏归一到清单，别让 URL 与界面对不上。
    if (sub) setConsolePage('platforms', { sub: '' });
    return;
  }
  setView('detail');
  const key = keyOf(item);
  const nextTab = String(tab ?? '');
  if (!force && detailKey === key && route.sub === key && route.tab === nextTab) return;
  route = { sub: key, tab: nextTab };
  detailKey = key;
  showDetail(meta, item, nextTab);
}

async function refresh({ force = true } = {}) {
  await loadPlatforms({ force });
  paint({ ...route, force: true });
}

// ── 事件与入口 ──────────────────────────────────────────────────────────────

function openPlatform(key) {
  if (!key) return;
  setConsolePage('platforms', { sub: key });
}

function onClick(event) {
  if (!(event.target instanceof Element)) return;
  const diagRow = event.target.closest('[data-diag-key]');
  if (diagRow?.dataset.diagKey) { openPlatform(diagRow.dataset.diagKey); return; }
  const tile = event.target.closest('[data-tile-id]');
  // 卡片里的按钮/链接自己处理点击，不把整卡当跳转。
  if (tile?.dataset.tileId && !event.target.closest('button, a')) openPlatform(tile.dataset.tileId);
}

/** 卡片是 role="button"：回车/空格与点击等价（与 split-view 的条目一致）。 */
function onKey(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (!(event.target instanceof Element) || event.target.dataset.tileId === undefined) return;
  event.preventDefault();
  openPlatform(event.target.dataset.tileId);
}

export function init() {
  const host = document.getElementById('platformHost');
  if (!host) return;
  host.innerHTML = `
    <div class="page-stack" data-platform-view="list">
      ${SIDE_ORDER.map(groupHtml).join('')}
    </div>
    <div class="page-stack" data-platform-view="detail" hidden></div>`;
  // 事件委托挂在宿主上：清单每次刷新都重建，监听只绑一次。
  host.addEventListener('click', onClick);
  host.addEventListener('keydown', onKey);
  onPageRefresh('platforms', () => void refresh());
  onPageRoute('platforms', ({ sub, tab }) => paint({ sub, tab }));
  // 首屏先用启动时预热的快照，不把页面挂在网络上；再强制拉一次拿最新的装配结果。
  paint();
  void refresh();
}
