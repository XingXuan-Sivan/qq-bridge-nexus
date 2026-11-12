// 标签组件：状态/分类/来源等短标记。语义色统一走 --pill-* / --warn-* token，
// 页面不再直接写 class="tag tag--xxx" 之外的临时样式。
//
// 用法：tag('内置')、tag('失败', { type: 'danger' })、tag('v1.2', { type: 'primary', size: 'sm' })
// 返回 HTML 字符串，便于 dataTableHtml / 行模板直接拼接。

const TYPES = new Set(['default', 'primary', 'success', 'warning', 'danger', 'info']);

function escapeAttr(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * @param {string} text
 * @param {{ type?: 'default'|'primary'|'success'|'warning'|'danger'|'info', size?: ''|'sm', title?: string }} [options]
 */
export function tag(text, { type = 'default', size = '', title = '' } = {}) {
  const safeType = TYPES.has(type) ? type : 'default';
  const classes = ['tag'];
  if (safeType !== 'default') classes.push(`tag--${safeType}`);
  if (size === 'sm') classes.push('tag--sm');
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
  return `<span class="${classes.join(' ')}"${titleAttr}>${escapeText(text)}</span>`;
}
