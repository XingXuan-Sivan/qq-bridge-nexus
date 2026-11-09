// 运行总览只保留摘要指标与活动日志；运行模式、模型、发言上限、静默等已迁到「全局配置」。
// 指标与日志仍由 app.js 的全局 refresh 写入，本页只负责渲染字段外壳与请求一次同步。
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { renderFields, bindSwitches } from '../../components/form/form.js';
import { OVERVIEW_FIELDS } from './fields.js';

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
  renderOverviewFieldGroups();
  bindSwitches(document.getElementById('section-overview') || document);
  onPageRefresh('overview', () => {
    if (getCurrentPage() === 'overview') requestStatusRefresh();
  });
  requestStatusRefresh();
}
