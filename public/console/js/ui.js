// 控制台通用小部件：toast、表格、空态。页面代码不再各写一份 innerHTML 模板。
//
// 约定：只生成 DOM 结构，不拼样式字符串；样式集中在 css/app.css，通过既有类名生效。

let toastTimer = null;

/** 右下角的短提示（错误也用同一条通道，文案里自己带 ❌/✅）。 */
export function showConsoleToast(message) {
  const toast = document.getElementById('consoleToast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
}

/** HTML 转义：所有从接口拿到的文本进模板前都要过这里。 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * 生成一张表格（thead + tbody）。
 * @param {{ columns: Array<{label:string, width?:string}>, rows: Array<Array<string|Node>>, empty?: string }} options
 */
export function renderTable({ columns, rows, empty = '暂无数据' }) {
  const table = document.createElement('table');
  table.className = 'tool-log-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const column of columns) {
    const th = document.createElement('th');
    th.textContent = column.label;
    if (column.width) th.style.width = column.width;
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);
  const tbody = document.createElement('tbody');
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = columns.length;
    td.className = 'meta';
    td.textContent = empty;
    tr.append(td);
    tbody.append(tr);
  } else {
    for (const cells of rows) {
      const tr = document.createElement('tr');
      for (const cell of cells) {
        const td = document.createElement('td');
        if (cell instanceof Node) td.append(cell);
        else td.textContent = String(cell ?? '');
        tr.append(td);
      }
      tbody.append(tr);
    }
  }
  table.append(tbody);
  return table;
}

/** 卡片列表（与人格页/插件页共用 .tile-list + .tile 的间距与内距）。 */
export function renderTileList(items) {
  const list = document.createElement('div');
  list.className = 'tile-list';
  for (const item of items) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    if (item.title) {
      const title = document.createElement('div');
      title.className = 'tile-head';
      title.textContent = item.title;
      tile.append(title);
    }
    if (item.body) {
      const body = document.createElement('p');
      body.className = 'meta';
      body.textContent = item.body;
      tile.append(body);
    }
    if (item.actions?.length) {
      const actions = document.createElement('div');
      actions.className = 'row';
      for (const action of item.actions) actions.append(action);
      tile.append(actions);
    }
    list.append(tile);
  }
  return list;
}
