// 插件 / 人格 / 平台列表共用的小卡片（tile）：图标 + 标题 + 状态标签 + 描述 + 标签行 + 错误 + 操作行。
// 样式沿用 .tile / .tile-head / .tile-icon / .tile-actions（都在 css/components.css）。

const TEXT_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => TEXT_ESCAPES[c]);
const ICON_TONES = new Set(['accent', 'ok', 'warn', 'danger']);

/** 没有自定义图标时的默认图案：中文取首字，英文取首字母大写。 */
function defaultGlyph(title) {
  const chars = [...String(title ?? '').trim()];
  return chars.length ? chars[0].toUpperCase() : '·';
}

function iconHtml(icon, title) {
  const tone = ICON_TONES.has(icon?.tone) ? ` tile-icon--${icon.tone}` : '';
  const src = String(icon?.src ?? '').trim();
  if (src) return `<span class="tile-icon${tone}" aria-hidden="true"><img src="${esc(src)}" alt=""></span>`;
  const glyph = String(icon?.glyph ?? '').trim() || defaultGlyph(title);
  const isDefault = String(icon?.glyph ?? '').trim() ? '' : ' is-default';
  return `<span class="tile-icon${isDefault}${tone}" aria-hidden="true">${esc([...glyph][0])}</span>`;
}

/**
 * @param {{
 *   id?: string, title: string,
 *   icon?: { glyph?: string, src?: string, tone?: 'accent'|'ok'|'warn'|'danger' },
 *   badges?: string[], description?: string,
 *   tags?: string[], error?: string, actions?: string,
 *   interactive?: boolean, className?: string
 * }} spec
 */
export function tileHtml({
  id = '',
  title = '',
  icon = null,
  badges = [],
  description = '',
  tags = [],
  error = '',
  actions = '',
  body = '',
  interactive = false,
  className = '',
} = {}) {
  const classes = ['tile', interactive ? 'tile--interactive' : '', className].filter(Boolean).join(' ');
  const attrs = [id ? `data-tile-id="${esc(id)}"` : '', interactive ? 'role="button" tabindex="0"' : '']
    .filter(Boolean)
    .join(' ');
  const badgeHtml = badges.filter(Boolean).join('');
  const tagHtml = tags.filter(Boolean).join('');
  const inner = body || `
    <div class="tile-head">${iconHtml(icon, title)}<div class="tile-head-body"><strong>${esc(title)}</strong>${badgeHtml}</div></div>
    ${description ? `<div class="meta">${esc(description)}</div>` : ''}
    ${tagHtml ? `<div class="row tile-tags">${tagHtml}</div>` : ''}`;
  return `<div class="${classes}"${attrs ? ` ${attrs}` : ''}>
    ${inner}
    ${error ? `<div class="meta err">${esc(error)}</div>` : ''}
    ${actions ? `<div class="row tile-actions">${actions}</div>` : ''}
  </div>`;
}
