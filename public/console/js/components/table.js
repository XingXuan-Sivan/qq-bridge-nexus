// 静态表格组件：返回 HTML 字符串，调用方把它塞进容器（数据版用 DOM 的见页面内的 renderTable）。
import { esc } from '../ui.js';

/**
 * @param {Array<{label:string, width?:number|string}>} columns
 * @param {Array<Array<string>>} rows 单元格已是 HTML 片段，调用方自己 esc
 */
export function tableHtml(columns, rows) {
  const head = `<thead><tr>${columns.map((column) => `<th${column.width ? ` data-w="${String(column.width).replace('px', '')}"` : ''}>${esc(column.label)}</th>`).join('')}</tr></thead>`;
  const body = rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}
