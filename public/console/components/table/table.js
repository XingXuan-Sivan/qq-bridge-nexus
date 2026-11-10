// 表格组件：
// 1) tableHtml：纯静态表格（只需要表体的地方用它，例如卡片里嵌一张小表）；
// 2) dataTableHtml + initDataTables：带「工具栏 + 表体 + 分页」的完整表格。
// 样式同住本目录 table.css（.table-wrap 表体容器、.table-toolbar、.table-footer/.pager）。
//
// 分页口径：**只隐藏行，不重建 DOM**（`<tr hidden>`）。这样表单里的 checkbox 始终在
// 文档里，翻页不会丢取值；折叠行、勾选态、行内事件也不用重新绑定。
import { esc } from '../../js/ui.js';

const PAGE_SIZES = [10, 20, 50];

/** 多选列的表头单元格：勾上即全选本表所有行（Element Plus 式三段态）。 */
function selectHeadCell(column) {
  const attrs = Object.entries(column.selectAttrs || {})
    .map(([name, value]) => ` ${esc(name)}="${esc(String(value))}"`).join('');
  return `<label class="table-check"><input type="checkbox" data-select-all${attrs} aria-label="${esc(column.label || '全选')}"></label>`;
}

/**
 * 多选列的行内单元格（与 dataTableHtml 的 `select` 选项配套）。
 * 勾上=选中；表头全选框由 initDataTables 自动维护。
 * @param {{value:string, checked?:boolean, disabled?:boolean, label?:string, attrs?:object}} options
 */
export function selectCellHtml({ value, checked = false, disabled = false, label = '', attrs = {} }) {
  const extra = Object.entries(attrs).map(([name, val]) => ` ${esc(name)}="${esc(String(val))}"`).join('');
  return `<label class="table-check"><input type="checkbox" value="${esc(value)}" data-select-row${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}${label ? ` aria-label="${esc(label)}"` : ''}${extra}></label>`;
}

/**
 * @param {Array<{label:string, width?:number|string, select?:boolean, selectAttrs?:object}>} columns
 * @param {Array<Array<string>>} rows 单元格已是 HTML 片段，调用方自己 esc
 */
export function tableHtml(columns, rows) {
  const head = `<thead><tr>${columns.map((column) => `<th${column.width ? ` data-w="${String(column.width).replace('px', '')}"` : ''}${column.select ? ' class="table-select"' : ''}>${column.select ? selectHeadCell(column) : esc(column.label)}</th>`).join('')}</tr></thead>`;
  // 行可以只给单元格数组，也可以给 `{ cells, attrs }`：attrs 落到 <tr> 上，
  // 供工具栏的筛选器按 data-filter-<id> 读取（例如会话页按平台 / 类型筛）。
  const body = rows.map((row) => {
    const cells = Array.isArray(row) ? row : row.cells;
    const attrs = Array.isArray(row) ? '' : Object.entries(row.attrs || {})
      .map(([name, value]) => ` ${esc(name)}="${esc(String(value))}"`).join('');
    return `<tr${attrs}>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
  }).join('');
  return `<table${columns.some((column) => column.select) ? ' data-select' : ''}>${head}<tbody>${body}</tbody></table>`;
}

/**
 * 分组可折叠表格：一个组 = 一行组头（整行 colspan）+ 若干子行。
 * 组头点击/回车折叠，子行用 hidden 属性显隐（不重建 DOM，筛选后重新渲染仍然可用）。
 * @param {{columns: Array<{label:string, width?:number|string}>, groups: Array<{label:string, key?:string, rows: Array<Array<string>>}>, openIndex?: number}} options
 */
export function groupedTableHtml({ columns = [], groups = [], openIndex = 0 } = {}) {
  const width = (column) => (column.width ? ` data-w="${String(column.width).replace('px', '')}"` : '');
  const head = `<thead><tr>${columns.map((column) => `<th${width(column)}>${esc(column.label)}</th>`).join('')}</tr></thead>`;
  const body = groups.map((group, index) => {
    const key = group.key ?? group.label ?? String(index);
    const open = index === openIndex;
    const groupRow = `<tr class="group-row${open ? ' open' : ''}" data-group="${esc(key)}" tabindex="0" role="button" aria-expanded="${open ? 'true' : 'false'}">`
      + `<td colspan="${columns.length}"><span class="caret" aria-hidden="true">▸</span> ${esc(group.label || '')}`
      + `${group.rows.length ? ` <span class="meta">${group.rows.length} 条</span>` : ''}</td></tr>`;
    const childRows = group.rows.map((cells) => `<tr class="group-child" data-group="${esc(key)}"${open ? '' : ' hidden'}>`
      + cells.map((cell) => `<td>${cell}</td>`).join('') + '</tr>').join('');
    return groupRow + childRows;
  }).join('');
  return `<div class="table-wrap"><table class="table-grouped">${head}<tbody>${body}</tbody></table></div>`;
}

/**
 * 给 groupedTableHtml 生成的组头绑定折叠：点击或回车/空格切换。
 * 返回解绑函数；同一个容器只绑一次即可（重新渲染 innerHTML 不影响委托）。
 */
export function initGroupedTables(root = document) {
  if (!root) return () => {};
  const toggle = (row) => {
    const open = !row.classList.contains('open');
    row.classList.toggle('open', open);
    row.setAttribute('aria-expanded', open ? 'true' : 'false');
    const key = row.dataset.group;
    root.querySelectorAll('tr.group-child').forEach((child) => {
      if (child.dataset.group === key) child.hidden = !open;
    });
  };
  const onClick = (event) => {
    const row = event.target.closest?.('tr.group-row');
    if (!row || !root.contains(row)) return;
    toggle(row);
  };
  const onKey = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest?.('tr.group-row');
    if (!row || !root.contains(row)) return;
    event.preventDefault();
    toggle(row);
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKey);
  };
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
  const button = (n) => `<button type="button" class="pager-btn${n === page ? ' is-current' : ''}" data-pager-page="${n}"${n === page ? ' aria-current="page"' : ''}>${n}</button>`;
  const steps = pageNumbers(page, pages).map((n) => (n === '…' ? '<span class="pager-gap" aria-hidden="true">…</span>' : button(n))).join('');
  return `<button type="button" class="pager-btn pager-step" data-pager-page="${page - 1}"${page <= 1 ? ' disabled' : ''} aria-label="上一页">‹</button>`
    + steps
    + `<button type="button" class="pager-btn pager-step" data-pager-page="${page + 1}"${page >= pages ? ' disabled' : ''} aria-label="下一页">›</button>`;
}

/**
 * 表格工具栏：刷新 / 筛选 / 搜索在左，统计与动作在右。
 * 单独导出是给「不是表格、但要有同款工具栏」的页面用（人格卡片墙等），
 * 避免各页手写 input/select 导致顺序、控件样式各写一套。
 *
 * @param {object} [options]
 * @param {boolean} [options.refresh] 渲染「刷新」按钮（点击回调由页面接 `[data-table-refresh]`）
 * @param {Array<{id?:string,label:string,options:Array<{value:string,label:string}>,value?:string}>} [options.filters]
 * @param {{placeholder?:string,id?:string,value?:string}} [options.search]
 * @param {string} [options.meta] 右侧统计文案
 * @param {string} [options.metaId] 统计文案的 id（需要动态改文案时用）
 * @param {string} [options.actions] 右侧动作按钮 HTML
 */
export function tableToolbarHtml({ refresh = false, filters = [], search = null, meta = '', metaId = '', actions = '' } = {}) {
  const hasToolbar = Boolean(search || refresh || filters.length || meta || actions);
  if (!hasToolbar) return '';
  const filterHtml = filters.map((filter) => `<select class="table-filter"${filter.domId ? ` id="${esc(filter.domId)}"` : ''} data-filter="${esc(filter.id || filter.label)}" aria-label="${esc(filter.label)}">`
    + filter.options.map((option) => `<option value="${esc(option.value)}"${String(option.value) === String(filter.value ?? '') ? ' selected' : ''}>${esc(option.label)}</option>`).join('')
    + '</select>').join('');
  const searchHtml = search
    ? `<input type="search" class="search-box search-box--w240"${search.id ? ` id="${esc(search.id)}"` : ''} data-table-search${search.value ? ` value="${esc(search.value)}"` : ''} placeholder="${esc(search.placeholder || '搜索…')}" aria-label="${esc(search.placeholder || '搜索')}">`
    : '';
  const refreshHtml = refresh
    ? (() => {
      const label = typeof refresh === 'object' && refresh.label ? refresh.label : '刷新';
      const attrs = typeof refresh === 'object' && refresh.attrs
        ? Object.entries(refresh.attrs).map(([name, value]) => ` ${esc(name)}="${esc(String(value))}"`).join('')
        : '';
      return `<button type="button" class="btn" data-table-refresh${attrs}>${esc(label)}</button>`;
    })()
    : '';
  return `<div class="table-toolbar">
    <div class="table-toolbar-main">
      ${refreshHtml}
      ${filterHtml}
      ${searchHtml}
    </div>
    <div class="table-toolbar-side">
      ${meta ? `<span class="table-toolbar-meta"${metaId ? ` id="${esc(metaId)}"` : ''} data-table-meta data-table-meta-fixed>${esc(meta)}</span>` : ''}
      ${actions}
    </div>
  </div>`;
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
 * @param {string} [options.actions] 工具栏右侧的动作按钮 HTML（例如「新增」）
 * @param {string} [options.empty] 无数据/无匹配时的提示
 * @param {boolean} [options.pager=true]
 * @param {{label?:string, width?:number|string, attrs?:object}} [options.select] 给了就在最前面加一列多选（表头即全选）
 *   多选列默认 44px（只容纳一个复选框）。表体是 table-layout:fixed，若所有列都写了 width，
 *   剩余宽度会按比例摊到每一列，把多选列也撑宽——所以用了 select 的表要留一列不写 width 来吸收剩余宽度。
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
  actions = '',
  empty = '没有匹配的数据。',
  pager = true,
  select = null,
}) {
  const toolbar = tableToolbarHtml({ refresh, filters, search, meta, actions });
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
  const allColumns = select
    ? [{ label: select.label || '全选', width: select.width || '44px', select: true, selectAttrs: select.attrs || {} }, ...columns]
    : columns;
  return `<div class="data-table" data-table data-page-size="${esc(String(pageSize))}" data-empty="${esc(empty)}">
  ${toolbar}
  <div class="table-wrap">${tableHtml(allColumns, rows)}<div class="table-empty" data-table-empty hidden>${esc(empty)}</div></div>
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

  // 多选列：表头勾上 = 全选（不分页/筛选，按整表算，与 Element Plus 一致），
  // 行勾选变化时回写三段态（全选 / 不确定 / 未选）。
  const selectAll = table.querySelector('thead [data-select-all]');
  if (selectAll) {
    const allBoxes = () => [...table.querySelectorAll('tbody input[data-select-row]')];
    const rowBoxes = () => allBoxes().filter((box) => !box.disabled);
    const syncSelectAll = () => {
      const boxes = allBoxes();
      const checked = boxes.filter((box) => box.checked).length;
      // 整表都禁用（例如「全部允许 *」时逐项不可改）时，表头仍显示「全勾」但不可点。
      selectAll.disabled = boxes.length === 0 || rowBoxes().length === 0;
      selectAll.checked = boxes.length > 0 && checked === boxes.length;
      selectAll.indeterminate = checked > 0 && checked < boxes.length;
    };
    selectAll.addEventListener('change', () => {
      for (const box of rowBoxes()) box.checked = selectAll.checked;
      syncSelectAll();
    });
    table.addEventListener('change', (event) => {
      if (event.target?.matches?.('input[data-select-row]')) syncSelectAll();
    });
    syncSelectAll();
  }
  const rows = [...tbody.rows];
  const emptyBox = table.querySelector('[data-table-empty]');
  const searchInput = table.querySelector('[data-table-search]');
  const filterEls = [...table.querySelectorAll('[data-filter]')];
  const summary = table.querySelector('[data-table-summary]');
  const pager = table.querySelector('[data-pager]');
  const sizeSelect = table.querySelector('[data-table-size]');
  const meta = table.querySelector('[data-table-meta]');
  const state = {
    page: 1,
    // 不分页的表（pager:false）一次显示全部：分页只是「隐藏行」，这里的 pageSize 决定隐藏多少。
    pageSize: pager ? (Number(table.dataset.pageSize) || 20) : rows.length,
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
    const visible = rows.filter(matches);
    const pages = Math.max(1, Math.ceil(visible.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * state.pageSize;
    const pageRows = new Set(visible.slice(start, start + state.pageSize));
    rows.forEach((row) => { row.hidden = !pageRows.has(row); });
    if (emptyBox) emptyBox.hidden = visible.length > 0;
    if (summary) {
      summary.textContent = visible.length
        ? `第 ${start + 1}–${Math.min(start + state.pageSize, visible.length)} 条，共 ${visible.length} 条`
        : '共 0 条';
    }
    if (meta && !meta.hasAttribute('data-table-meta-fixed')) meta.textContent = `共 ${visible.length} 条`;
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
    const button = event.target.closest('[data-pager-page]');
    if (!button || button.disabled) return;
    state.page = Number(button.dataset.pagerPage);
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
