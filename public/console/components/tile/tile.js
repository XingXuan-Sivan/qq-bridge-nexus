// 插件 / 人格列表共用的卡片（tile）：标题 + 状态标签 + 描述 + 标签行 + 错误 + 操作行。
// 两个页面原先各写一套模板，这里统一结构，样式沿用 .tile / .tile-head / .tile-actions。

const TEXT_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => TEXT_ESCAPES[c]);

/**
 * @param {{
 *   id?: string, title: string, badges?: string[], description?: string,
 *   tags?: string[], error?: string, actions?: string,
 *   interactive?: boolean, className?: string
 * }} spec
 */
export function tileHtml({
  id = '',
  title = '',
  badges = [],
  description = '',
  tags = [],
  error = '',
  actions = '',
  interactive = false,
  className = '',
} = {}) {
  const classes = ['tile', interactive ? 'tile--interactive' : '', className].filter(Boolean).join(' ');
  const attrs = [id ? `data-tile-id="${esc(id)}"` : '', interactive ? 'role="button" tabindex="0"' : '']
    .filter(Boolean)
    .join(' ');
  const badgeHtml = badges.filter(Boolean).join('');
  const tagHtml = tags.filter(Boolean).join('');
  return `<div class="${classes}"${attrs ? ` ${attrs}` : ''}>
    <div class="tile-head"><strong>${esc(title)}</strong>${badgeHtml}</div>
    ${description ? `<div class="meta">${esc(description)}</div>` : ''}
    ${tagHtml ? `<div class="row tile-tags">${tagHtml}</div>` : ''}
    ${error ? `<div class="meta err">${esc(error)}</div>` : ''}
    ${actions ? `<div class="row tile-actions">${actions}</div>` : ''}
  </div>`;
}
