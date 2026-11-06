// 表格组件：
// 1) tableHtml：纯静态表格（只需要表体的地方用它，例如卡片里嵌一张小表）；
// 2) dataTableHtml + initDataTables：带「工具栏 + 表体 + 分页」的完整表格。
// 样式同住本目录 table.css（.table-wrap 表体容器、.table-toolbar、.table-footer/.pager）。
//
// 分页口径：**只隐藏行，不重建 DOM**（`<tr hidden>`）。这样表单里的 checkbox 始终在
// 文档里，翻页不会丢取值；折叠行、勾选态、行内事件也不用重新绑定。
import { esc } from '../../js/ui.js';

const PAGE_SIZES = [10, 20, 50];

/**
 * @param {Array<{label:string, width?:number|string}>} columns
 * @param {Array<Array<string>>} rows 单元格已是 HTML 片段，调用方自己 esc
 */
export function tableHtml(columns, rows) {
  const head = `<thead><tr>${columns.map((column) => `<th${column.width ? ` data-w="${String(column.width).replace('px', '')}"` : ''}>${esc(column.label)}</th>`).join('')}</tr></thead>`;
  const body = rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

/** 页码序列：页数少时全列，多时首尾 + 当前页 ±1，中间用省略号。 */
function pageNumbers(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const wanted = [...new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages))].sort((a, b) => a - b);
  const out = [];
  let previous = 0;
  for (const n of wanted) {
    if (previous && n - previous > 1) out.push('…');
    out.push(n);
    previous = n;
  }
  return out;
}

function pagerHtml(page, pages) {
  const button = (n) => `<button type="button" class="pager-btn${n === page ? ' is-current' : ''}" data-page="${n}"${n === page ? ' aria-current="page"' : ''}>${n}</button>`;
  const steps = pageNumbers(page, pages).map((n) => (n === '…' ? '<span class="pager-gap" aria-hidden="true">…</span>' : button(n))).join('');
  return `<button type="button" class="pager-btn pager-step" data-page="${page - 1}"${page <= 1 ? ' disabled' : ''} aria-label="上一页">‹</button>`
    + steps
    + `<button type="button" class="pager-btn pager-step" data-page="${page + 1}"${page >= pages ? ' disabled' : ''} aria-label="下一页">›</button>`;
}

/**
 * 完整表格骨架：工具栏（刷新 / 筛选 / 搜索 / 统计）+ 表体 + 分页。
 * 传 `pager: false` 时不渲染分页（短表、或只需要表体）。
 *
 * @param {object} options
 * @param {Array<{label:string,width?:number|string}>} options.columns
 * @param {Array<Array<string>>} options.rows
 * @param {number} [options.pageSize=20]
 * @param {number[]} [options.sizes=[10,20,50]]
 * @param {{placeholder?:string}} [options.search] 给了就渲染搜索框
 * @param {boolean} [options.refresh] 渲染「刷新」按钮（点击回调由页面接）
 * @param {Array<{id:string,label:string,options:Array<{value:string,label:string}>,value?:string}>} [options.filters]
 * @param {string} [options.meta] 工具栏右侧的统计文案
 * @param {string} [options.empty] 无数据/无匹配时的提示
 * @param {boolean} [options.pager=true]
 */
export function dataTableHtml({
  columns,
  rows = [],
  pageSize = 20,
  sizes = PAGE_SIZES,
  search = null,
  refresh = false,
  filters = [],
  meta = '',
  empty = '没有匹配的数据。',
  pager = true,
}) {
  const hasToolbar = Boolean(search || refresh || filters.length || meta);
  const filterHtml = filters.map((filter) => `<select class="table-filter" data-filter="${esc(filter.id)}" aria-label="${esc(filter.label)}">`
    + filter.options.map((option) => `<option value="${esc(option.value)}"${String(option.value) === String(filter.value ?? '') ? ' selected' : ''}>${esc(option.label)}</option>`).join('')
    + '</select>').join('');
  const toolbar = hasToolbar
    ? `<div class="table-toolbar">
    <div class="table-toolbar-main">
      ${refresh ? '<button type="button" class="btn" data-table-refresh>刷新</button>' : ''}
      ${filterHtml}
      ${search ? `<input type="search" class="search-box search-box--w240" data-table-search placeholder="${esc(search.placeholder || '搜索…')}" aria-label="${esc(search.placeholder || '搜索')}">` : ''}
    </div>
    ${meta ? `<span class="table-toolbar-meta" data-table-meta>${esc(meta)}</span>` : ''}
  </div>`
    : '';
  const footer = pager
    ? `<div class="table-footer" data-table-footer>
    <span class="table-footer-summary" data-table-summary></span>
    <nav class="pager" data-pager role="navigation" aria-label="分页"></nav>
    <label class="pager-size">每页
      <select data-table-size aria-label="每页条数">${sizes.map((size) => `<option value="${size}"${size === pageSize ? ' selected' : ''}>${size}</option>`).join('')}</select>
      条
    </label>
  </div>`
    : '';
  return `<div class="data-table" data-table data-page-size="${esc(String(pageSize))}" data-empty="${esc(empty)}">
  ${toolbar}
  <div class="table-wrap">${tableHtml(columns, rows)}<div class="table-empty" data-table-empty hidden>${esc(empty)}</div></div>
  ${footer}
</div>`;
}

/**
 * 绑定页面上所有 `[data-table]`（幂等：绑过的打 data-ready）。
 * 行为：搜索/筛选 → 重新算可见行；分页 → 只切换 `tr.hidden`；每页条数 → 重算。
 * 行上可加 `data-filter-<id>="值"` 参与筛选（缺省按整行文本匹配）。
 *
 * @param {ParentNode} [root=document]
 * @param {{onRefresh?:(table:HTMLElement)=>void}} [hooks]
 */
export function initDataTables(root = document, hooks = {}) {
  root.querySelectorAll('[data-table]:not([data-ready])').forEach((table) => setupDataTable(table, hooks));
}

function setupDataTable(table, hooks) {
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  table.dataset.ready = '1';
  const allRows = [...tbody.rows];
  const emptyBox = table.querySelector('[data-table-empty]');
  const searchInput = table.querySelector('[data-table-search]');
  const filterEls = [...table.querySelectorAll('[data-filter]')];
  const summary = table.querySelector('[data-table-summary]');
  const pager = table.querySelector('[data-pager]');
  const sizeSelect = table.querySelector('[data-table-size]');
  const meta = table.querySelector('[data-table-meta]');
  const state = {
    page: 1,
    pageSize: Number(table.dataset.pageSize) || 20,
    keyword: '',
    filters: Object.fromEntries(filterEls.map((el) => [el.dataset.filter, el.value])),
  };

  const matches = (row) => {
    if (state.keyword && !row.textContent.toLowerCase().includes(state.keyword)) return false;
    return filterEls.every((el) => {
      const wanted = state.filters[el.dataset.filter];
      if (!wanted || wanted === 'all') return true;
      const own = row.getAttribute(`data-filter-${el.dataset.filter}`);
      return own === null ? true : own === wanted;
    });
  };

  function render() {
    const visible = allRows.filter(matches);
    const pages = Math.max(1, Math.ceil(visible.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * state.pageSize;
    const pageRows = new Set(visible.slice(start, start + state.pageSize));
    allRows.forEach((row) => { row.hidden = !pageRows.has(row); });
    if (emptyBox) emptyBox.hidden = visible.length > 0;
    if (summary) {
      summary.textContent = visible.length
        ? `第 ${start + 1}–${Math.min(start + state.pageSize, visible.length)} 条，共 ${visible.length} 条`
        : '共 0 条';
    }
    if (meta) meta.textContent = `共 ${visible.length} 条`;
    if (pager) pager.innerHTML = pagerHtml(state.page, pages);
  }

  searchInput?.addEventListener('input', () => {
    state.keyword = searchInput.value.trim().toLowerCase();
    state.page = 1;
    render();
  });
  filterEls.forEach((el) => el.addEventListener('change', () => {
    state.filters[el.dataset.filter] = el.value;
    state.page = 1;
    render();
  }));
  pager?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    state.page = Number(button.dataset.page);
    render();
  });
  sizeSelect?.addEventListener('change', () => {
    state.pageSize = Number(sizeSelect.value) || state.pageSize;
    state.page = 1;
    render();
  });
  table.querySelector('[data-table-refresh]')?.addEventListener('click', () => {
    hooks.onRefresh?.(table);
  });

  render();
}
