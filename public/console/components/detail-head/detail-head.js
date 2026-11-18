// 二级页页头：返回 + 标题（可带次级标识）+ 一行说明 + 右侧徽标（可带动作）。
// 平台详情与插件详情共用这一份结构（样式在 detail-head.css）：
//   host.innerHTML = `${detailHeadHtml({ title: '插件名', code: 'plugin-id', meta, badges, actions })}
//                     ${cardHtml({ … })}`
// 「返回」只输出 data-detail-back，点击由各页的事件委托接住（页面知道该回到哪一层路由）；
// actions 同理：只输出调用方给的按钮片段，点击交给页面自己的委托。

const TEXT_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => TEXT_ESCAPES[c]);

/**
 * @param {{
 *   title?: string, code?: string, meta?: string, badges?: string[],
 *   actions?: string, backLabel?: string
 * }} spec
 *   title / code / backLabel 由这里转义；meta、badges 与 actions 是已渲染的片段（调用方负责转义）。
 *   actions 排在徽标下面一行；不传 actions 时页头与原来完全一致，不传 badges 时动作行落在标题那一行。
 */
export function detailHeadHtml({
  title = '',
  code = '',
  meta = '',
  badges = [],
  actions = '',
  backLabel = '返回清单',
} = {}) {
  const badgeHtml = badges.filter(Boolean).join('');
  // 只有动作时 aside 少了一行徽标，靠 --solo 把动作行压在标题那一行，而不是跟着页头顶端上移。
  const asideClass = ['detail-head-aside', actions && !badgeHtml ? 'detail-head-aside--solo' : ''].filter(Boolean).join(' ');
  const aside = actions
    ? `<div class="${asideClass}">${badgeHtml ? `<div class="row">${badgeHtml}</div>` : ''}<div class="row detail-head-actions">${actions}</div></div>`
    : `<div class="row">${badgeHtml}</div>`;
  return `<header class="detail-head">
    <div class="detail-head-main">
      <button class="btn small detail-back" type="button" data-detail-back>← ${esc(backLabel)}</button>
      <h3>${esc(title)}${code ? ` <code>${esc(code)}</code>` : ''}</h3>
      ${meta ? `<p class="meta">${meta}</p>` : ''}
    </div>
    ${aside}
  </header>`;
}
