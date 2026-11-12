// 运行总览只保留摘要指标与活动日志；运行模式、模型、发言上限、静默等已迁到「全局配置」。
// 指标与日志仍由 app.js 的全局 refresh 写入，本页只负责渲染字段外壳与请求一次同步。
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { cardHtml } from '../../components/card/card.js';
import { renderFields, bindSwitches } from '../../components/form/form.js';
import { OVERVIEW_FIELDS } from './fields.js';
import { init as initUsage } from './usage.js';

// 卡片外壳统一由 card 组件生成（page.html 只留 #overviewCards 宿主）。
// 卡片仍留在 #section-usage 里：usage.css 的 .usage-* 规则都以它为作用域。
function renderCards() {
  const host = document.getElementById('overviewCards');
  if (!host) return;
  host.innerHTML = [
    cardHtml({
      id: 'section-usage-chart',
      title: '消耗走势',
      body: '<div data-usage-fields="chart"></div>',
    }),
    cardHtml({
      id: 'section-usage-conversations',
      title: '按会话（群 / 私聊）',
      body: '<div data-usage-fields="conversations"></div>',
    }),
    // 标题右侧的 data-note 走 cardHtml 的 note；#usageTurnScope 带 id，只能放 body。
    cardHtml({
      id: 'section-usage-turns',
      title: '逐轮花费',
      note: '筛选会话后自动加载',
      body: `<p class="meta" id="usageTurnScope">—</p>
        <div data-usage-fields="turnsBody"></div>`,
    }),
    cardHtml({
      className: 'is-group',
      body: '<div data-usage-fields="recent"></div>',
    }),
    cardHtml({
      className: 'is-group',
      body: '<div data-usage-fields="prices"></div>',
    }),
  ].join('');
}

function renderOverviewFieldGroups() {
  document.querySelectorAll('[data-overview-fields]').forEach((host) => {
    const spec = OVERVIEW_FIELDS[host.dataset.overviewFields];
    if (!spec) return;
    if (spec.bare) { host.innerHTML = spec.html; return; }
    renderFields(host, spec.fields, { columns: 2 });
  });
}

function requestStatusRefresh() {
  document.dispatchEvent(new Event('console:refresh-status'));
}

export function init() {
  // 先拼卡片外壳：下面所有 [data-*-fields] 查询都依赖这些节点。
  renderCards();
  renderOverviewFieldGroups();
  bindSwitches(document.getElementById('section-overview') || document);
  initUsage();
  onPageRefresh('overview', () => {
    if (getCurrentPage() === 'overview') requestStatusRefresh();
  });
  requestStatusRefresh();
}
