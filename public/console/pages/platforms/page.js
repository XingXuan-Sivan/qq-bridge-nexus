// 平台页：一眼看清两侧接了谁、哪里坏了，点进右栏改。
//
// 数据只有一个来源：js/registry.js 里那份 /api/platforms/registry 快照（用户侧与 Agent 侧
// 是同一份响应）。页面自己不发任何「平台清单」请求，避免第二张表；只有右栏的
// 提示词 / 行为档案 / 能力预设各自去拉正文（那些是资产，不是清单）。
//
// 布局：诊断汇总卡（只有真有诊断时才出现）+ 主从卡（左列表按两侧分组，右详情见
// platform-detail.js）。列表与详情都是 split-view 组件，卡片是 cardHtml，表格是表格组件。
import { esc } from '../../js/ui.js';
import { onPageRefresh } from '../../js/router.js';
import { cardHtml } from '../../components/card/card.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { initSplitView, setSplitActive, splitItemHtml, splitViewHtml } from '../../components/split-view/split-view.js';
import { loadPlatforms, registryMeta, inboundStateLabel, inboundStateTone } from '../../js/registry.js';
import { mountPlatformDetail, unmountPlatformDetail } from './platform-detail.js';

const SIDE_ORDER = ['user', 'agent'];
const SIDE_LABEL = { user: '用户侧', agent: 'Agent 侧' };
const SOURCE_LABEL = { builtin: '内置', plugin: '插件', 'profile-only': '仅配置', 'config-only': '仅条目' };
const LEVEL_LABEL = { error: '错误', warn: '警告' };
const LEVEL_TONE = { error: 'tag--danger', warn: 'tag--warning' };

// 选中项跨刷新保留：「user:qq」这种 key 同时说明是哪一侧，避免两侧同名 id 串位。
let selected = '';

function keyOf(item) {
  return `${item.side}:${item.id}`;
}

function diagnosticsOf(meta, side, id) {
  return (meta.diagnostics ?? []).filter((item) => item.side === side && item.platformId === id);
}

/** 首次进来（或那个平台被删掉）时选谁：优先「用户侧 + 运行期」，其次任一运行期，最后第一个。 */
function ensureSelection(meta) {
  const list = meta.platforms ?? [];
  if (selected && list.some((item) => keyOf(item) === selected)) return;
  const active = list.find((item) => item.active && item.side === 'user')
    ?? list.find((item) => item.active)
    ?? list[0];
  selected = active ? keyOf(active) : '';
}

function summaryChips(meta) {
  const summary = meta.summary ?? { total: (meta.platforms ?? []).length, errors: 0, warnings: 0 };
  const chips = [`<span class="tag">${summary.total ?? 0} 个平台</span>`];
  if (summary.errors) chips.push(`<span class="tag tag--danger">${summary.errors} 个错误</span>`);
  if (summary.warnings) chips.push(`<span class="tag tag--warning">${summary.warnings} 个警告</span>`);
  if (!summary.errors && !summary.warnings) chips.push('<span class="tag tag--success">没有诊断</span>');
  return chips.join(' ');
}

function listItemHtml(meta, item) {
  const diags = diagnosticsOf(meta, item.side, item.id);
  const hasError = diags.some((diag) => diag.level === 'error');
  const badges = [
    item.active ? '<span class="tag tag--success tag--sm">运行期</span>' : '',
    // 配置面已改为默认、本进程还没装配：重启后才会变成「运行期」。
    item.configured && !item.active ? '<span class="tag tag--warning tag--sm">待重启</span>' : '',
    // 用户侧多两态：停用的实例不会装配；入站结论是这个实例此刻的真实状态
    // （停用的实例已经有了「已停用」徽标，不再叠一枚同名的入站徽标）。
    item.side === 'user' && item.enabled === false ? '<span class="tag tag--warning tag--sm">已停用</span>' : '',
    item.side === 'user' && item.enabled !== false && item.inboundState?.state
      ? `<span class="tag ${inboundStateTone(item.inboundState.state)} tag--sm">${esc(inboundStateLabel(item.inboundState.state))}</span>`
      : '',
    hasError ? '<span class="tag tag--danger tag--sm">错误</span>' : '',
    !hasError && diags.length ? '<span class="tag tag--warning tag--sm">警告</span>' : '',
  ].filter(Boolean).join('');
  const metaLine = [
    item.id,
    SOURCE_LABEL[item.source] ?? item.source,
    item.side === 'user' ? (item.inbound ? '可收发' : '只出不进') : null,
  ].filter(Boolean).join(' · ');
  return splitItemHtml({
    key: keyOf(item),
    title: item.label || item.id,
    meta: metaLine,
    badges,
    active: keyOf(item) === selected,
  });
}

function listHtml(meta) {
  const groups = SIDE_ORDER.map((side) => {
    const items = (meta.platforms ?? []).filter((item) => item.side === side);
    if (!items.length) return '';
    return `<div class="split-group">${SIDE_LABEL[side]}</div>${items.map((item) => listItemHtml(meta, item)).join('')}`;
  }).filter(Boolean);
  return groups.join('');
}

/** 诊断汇总卡：没有诊断就不占地方。每条都能指到具体平台，点行会选中它。 */
function diagnosticsCardHtml(meta) {
  const diags = meta.diagnostics ?? [];
  if (!diags.length) return '';
  return cardHtml({
    id: 'platformDiagnosticsCard',
    title: '诊断',
    description: '两侧平台的装配与配置问题都在这里；点一行跳到对应平台。',
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

function platformCardHtml(meta) {
  const platforms = meta.platforms ?? [];
  return cardHtml({
    id: 'platformCard',
    title: '平台',
    description: '用户侧与 Agent 侧都在这一张表里：左边是清单，右边是这一侧的资产、配置与诊断。',
    actions: `${summaryChips(meta)}<button class="btn small" type="button" data-platform-refresh>刷新</button>`,
    body: platforms.length
      ? splitViewHtml({
        id: 'platformSplit',
        listLabel: '平台清单',
        listHtml: listHtml(meta),
        empty: '从左侧选一个平台',
      })
      : '<div class="split-empty">还没有装配任何平台。用户侧在 profiles/platforms 下加目录，Agent 侧在 profiles/agent-platforms 下加目录，然后重启桥接。</div>',
  });
}

function paintDetail() {
  const root = document.getElementById('platformSplit');
  if (!root) return;
  const panel = root.querySelector('[data-split-detail]');
  if (!panel) return;
  const meta = registryMeta();
  setSplitActive(root, selected);
  unmountPlatformDetail();
  panel.innerHTML = '';
  const item = (meta.platforms ?? []).find((entry) => keyOf(entry) === selected) ?? null;
  if (!item) {
    panel.innerHTML = '<div class="split-empty">这一侧还没有可选平台。</div>';
    return;
  }
  // 诊断按平台切好一起交给详情：详情只认「这一个平台」，不再回头查全局。
  // onChanged：写口成功后重拉注册表并重画（列表、诊断卡、详情同属一份快照）。
  mountPlatformDetail(panel, { ...item, diagnostics: diagnosticsOf(meta, item.side, item.id) }, { onChanged: () => void refresh() });
}

function render() {
  const host = document.getElementById('platformHost');
  if (!host) return;
  const meta = registryMeta();
  ensureSelection(meta);
  host.innerHTML = diagnosticsCardHtml(meta) + platformCardHtml(meta);
  initDataTables(host);
  const root = document.getElementById('platformSplit');
  if (root) initSplitView(root, { onSelect: (key) => select(key) });
  paintDetail();
}

function select(key) {
  if (!key || key === selected) return;
  selected = key;
  paintDetail();
}

async function refresh({ force = true } = {}) {
  await loadPlatforms({ force });
  render();
}

export function init() {
  const host = document.getElementById('platformHost');
  if (!host) return;
  // 事件委托挂在宿主上：卡片每次刷新都重建，监听只绑一次。
  host.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('[data-platform-refresh]')) { void refresh(); return; }
    const diagRow = event.target.closest('[data-diag-key]');
    if (diagRow) {
      const key = diagRow.dataset.diagKey;
      const root = document.getElementById('platformSplit');
      if (root && key) { select(key); root.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    }
  });
  onPageRefresh('platforms', () => void refresh());
  // 首屏先用启动时预热的快照，不把页面挂在网络上；再强制拉一次拿最新的装配结果。
  render();
  void refresh();
}
