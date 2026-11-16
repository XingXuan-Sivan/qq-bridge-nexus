// 二级页页头：返回 + 标题（可带次级标识）+ 一行说明 + 右侧徽标。
// 平台详情与插件详情共用这一份结构（样式在 detail-head.css）：
//   host.innerHTML = `${detailHeadHtml({ title: '插件名', code: 'plugin-id', meta, badges })}
//                     ${cardHtml({ … })}`
// 「返回」只输出 data-detail-back，点击由各页的事件委托接住（页面知道该回到哪一层路由）。

const TEXT_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => TEXT_ESCAPES[c]);

/**
 * @param {{
 *   title?: string, code?: string, meta?: string, badges?: string[], backLabel?: string
 * }} spec
 *   title / code / backLabel 由这里转义；meta 与 badges 是已渲染的片段（调用方负责转义）。
 */
export function detailHeadHtml({
  title = '',
  code = '',
  meta = '',
  badges = [],
  backLabel = '返回清单',
} = {}) {
  const badgeHtml = badges.filter(Boolean).join('');
  return `<header class="detail-head">
    <div class="detail-head-main">
      <button class="btn small detail-back" type="button" data-detail-back>← ${esc(backLabel)}</button>
      <h3>${esc(title)}${code ? ` <code>${esc(code)}</code>` : ''}</h3>
      ${meta ? `<p class="meta">${meta}</p>` : ''}
    </div>
    <div class="row">${badgeHtml}</div>
  </header>`;
}
