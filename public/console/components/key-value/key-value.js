// 键值网格：把「项目 / 值」两列表格摊成「两对一行」的紧凑版式。
//
// 两列表格一屏只放得下十行左右，剩下的都是留白；同一份事实换成标签在左、值在右的
// 网格，长度减半，也不再给人「这是可排序的数据」的错觉（属性本来就不是数据集）。
// 值允许是 HTML 片段（标签、代码、补充说明），由调用方自己转义；标签一律按纯文本转义。
//
// 用法：keyValueHtml({ rows: [['来源', '<code>builtin</code>'], ['入站', '<span class="tag">…</span>']] })
// 值很长（路径、说明）时给 row 加 wide：{ label: '配置目录', value: …, wide: true }，独占一整行。

const TEXT_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => TEXT_ESCAPES[c]);

/**
 * @param {object} [options]
 * @param {Array<[string, string]|{label:string, value:string, wide?:boolean}>} [options.rows]
 *   一行一个 `[标签, 值]`；对象形式可标 wide（独占整行）。
 * @param {1|2|3} [options.columns=2] 一行放几对；值长的用 1。
 * @param {string} [options.className]
 */
export function keyValueHtml({ rows = [], columns = 2, className = '' } = {}) {
  const items = (rows ?? []).filter(Boolean);
  if (!items.length) return '';
  const cells = items.map((row) => {
    const wide = !Array.isArray(row) && row.wide === true;
    const label = Array.isArray(row) ? row[0] : row.label;
    const value = Array.isArray(row) ? row[1] : row.value;
    return `<div class="kv-grid__row${wide ? ' kv-grid__row--wide' : ''}">`
      + `<dt>${esc(label)}</dt><dd>${value ?? '<span class="meta">—</span>'}</dd></div>`;
  }).join('');
  const cols = [1, 2, 3].includes(Number(columns)) ? Number(columns) : 2;
  const classes = ['kv-grid', `kv-grid--${cols}`, className].filter(Boolean).join(' ');
  return `<dl class="${classes}">${cells}</dl>`;
}
