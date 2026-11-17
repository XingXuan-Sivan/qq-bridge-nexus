// 详情页版面：整页是一张大卡，卡里按分区排；分区之间只用一条分隔线，不再「一段一张卡」。
//
// 用法：
//   detailPanelHtml({ body: detailHeadHtml(...) + 标签条
//     + '<div class="detail-body" data-xxx-panel-body></div>' })
//   面板按标签填 detailSectionHtml(...)；分区里需要单独描边的小内容用
//   detailCardHtml / detailCardsHtml（数字卡给 value，内容卡给 body）。
//
// 文本与标记的分工：title / hint / 数值由组件转义；note / actions / body 是已渲染的
// HTML 片段（说明里常带 <code>），由调用方负责转义其中来自接口的部分。
import { esc } from '../../js/ui.js';

/**
 * 整页的大卡：页头、标签条与面板都放进去，页面只剩这一张卡。
 * @param {{id?: string, className?: string, body?: string}} [spec]
 */
export function detailPanelHtml({ id = '', className = '', body = '' } = {}) {
  const classes = ['detail-panel', className].filter(Boolean).join(' ');
  return `<section class="${classes}"${id ? ` id="${esc(id)}"` : ''}>${body}</section>`;
}

/**
 * 分区：标题行（右侧可放动作或徽标）+ 说明 + 正文。没给标题时只出说明与正文。
 * @param {{id?: string, title?: string, note?: string, actions?: string, body?: string, className?: string}} [spec]
 *   note 允许 HTML（说明里常带 <code> 与链接），actions 是标题行右侧的按钮或标签。
 */
export function detailSectionHtml({ id = '', title = '', note = '', actions = '', body = '', className = '' } = {}) {
  const classes = ['detail-section', className].filter(Boolean).join(' ');
  const head = title
    ? `<div class="detail-section-head"><h2>${esc(title)}</h2>${actions ? `<div class="row">${actions}</div>` : ''}</div>`
    : '';
  const noteHtml = note ? `<p class="detail-section-note">${note}</p>` : '';
  return `<section class="${classes}"${id ? ` id="${esc(id)}"` : ''}>${head}${noteHtml}${body}</section>`;
}

/**
 * 带边框小卡：给了 value 就是数字卡，否则是「标题 + 说明 + 正文」的内容卡。
 * @param {{id?: string, title?: string, note?: string, value?: string, text?: boolean,
 *   hint?: string, actions?: string, body?: string, className?: string}} [spec]
 *   text 给「一长串名字」这类文字值：字号收小，与数字区分开。
 */
export function detailCardHtml({
  id = '',
  title = '',
  note = '',
  value,
  text = false,
  hint = '',
  actions = '',
  body = '',
  className = '',
} = {}) {
  const idAttr = id ? ` id="${esc(id)}"` : '';
  if (value !== undefined) {
    const classes = ['detail-panel-card', 'detail-panel-card--metric', className].filter(Boolean).join(' ');
    return `<div class="${classes}"${idAttr}>`
      + `<span>${esc(title)}</span>`
      + `<strong${text ? ' class="is-text"' : ''}>${esc(value)}</strong>`
      + (hint ? `<small>${esc(hint)}</small>` : '')
      + '</div>';
  }
  const classes = ['detail-panel-card', className].filter(Boolean).join(' ');
  const head = title || actions
    ? `<div class="detail-panel-card-head"><h4>${esc(title)}</h4>${actions ? `<div class="row">${actions}</div>` : ''}</div>`
    : '';
  const noteHtml = note ? `<p class="meta">${note}</p>` : '';
  return `<div class="${classes}"${idAttr}>${head}${noteHtml}${body}</div>`;
}

/**
 * 一组小卡：网格按可用宽度铺开，卡多会自动换行。
 * @param {Array<object>} [cards] 每项是 detailCardHtml 的参数
 * @param {{wide?: boolean, className?: string}} [options]
 *   wide 用于内容较多的一组（药丸清单、带表单的卡）：单卡放宽，窄屏落到一列。
 */
export function detailCardsHtml(cards = [], { wide = false, className = '' } = {}) {
  const items = (cards ?? []).filter(Boolean);
  if (!items.length) return '';
  const classes = ['detail-panel-cards', wide ? 'detail-panel-cards--wide' : '', className].filter(Boolean).join(' ');
  return `<div class="${classes}">${items.map((card) => detailCardHtml(card)).join('')}</div>`;
}
