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

/** 卡片列表（与人格页/插件页共用 .tile-list + .tile 的间距与内距）。 */export function renderTileList(items) {
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

/**
 * 生成一张静态表格的 HTML 字符串（单元格已经是 HTML 片段，调用方自己 esc）。
 * 与 renderTable 的区别：这个返回字符串、可直接塞 innerHTML；renderTable 返回节点。
 * @param {Array<{label:string, width?:string}>} columns
 * @param {Array<Array<string>>} rows
 */
export function simpleTable(columns, rows) {
  const head = `<thead><tr>${columns.map((column) => `<th${column.width ? ` style="width:${column.width}"` : ''}>${esc(column.label)}</th>`).join('')}</tr></thead>`;
  const body = rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

export function applyPageA11y(root = document) {
// 把可访问名称/主次按钮/状态角色补到页面元素上：根层一次，片段页注入后再补一次（router 调用）。
root.querySelectorAll('input,select,textarea').forEach(input => {
  if (input.labels?.length || input.hasAttribute('aria-label')) return;
  let label = input.previousElementSibling;
  while (label && label.tagName !== 'LABEL') label = label.previousElementSibling;
  if (label) {
    const siblings = [];
    let next = label.nextElementSibling;
    while (next && next.tagName !== 'LABEL') {
      if (next.matches('input,select,textarea')) siblings.push(next);
      next = next.nextElementSibling;
    }
    input.setAttribute('aria-label', label.textContent.trim() + (siblings.length > 1 ? (siblings.indexOf(input) === 0 ? '（下限）' : '（上限）') : ''));
  } else {
    const names = { consoleTokenInput: '新的控制台访问令牌', closedPreset: '封闭 Agent 使用的 DSH 预设', tsKind: '测试消息目标类型', aiNotifyKind: '后台提醒目标类型', sStateKey: '一代仿真会话', v2SessionSelect: '二代仿真白名单会话', slangLimitCand: '候选词显示数量', slangLimitConfirmed: '已确认词显示数量', slangLimitRejected: '已拒绝词显示数量' };
    input.setAttribute('aria-label', names[input.id] || input.placeholder || input.closest('section')?.querySelector('h2')?.textContent || '设置');
  }
});
const primaryActions = ['roleSet','roleCreate','socialSave','v2ConfigSave','v2ConfigSaveTop','wlSave','secSave','consoleTokenSave','tsSend','aiNotifySend','slangAdd','slangConfigSave','slangModalDirectConfirm'];
primaryActions.forEach(id => root.querySelector('#' + id)?.classList.add('primary'));
root.querySelectorAll('.meta[id$="Msg"], .meta[id$="Msg2"]').forEach(el => el.setAttribute('role','status'));
}
