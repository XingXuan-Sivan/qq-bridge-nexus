// 卡片骨架：header / body / footer，header 与 footer 可选。
// 静态页仍保留 <section class="card span-all"> 结构，但统一由这里生成，避免每页手写。
//
// 用法：host.innerHTML = cardHtml({ title: '运行方案', description: '…', actions: '<button …>', body: '…' })

const TEXT_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => TEXT_ESCAPES[c]);

/**
 * @param {{
 *   id?: string, title?: string, note?: string, description?: string,
 *   actions?: string, body?: string, footer?: string,
 *   className?: string, headId?: string, bodyId?: string
 * }} spec
 */
export function cardHtml({
  id = '',
  title = '',
  note = '',
  description = '',
  actions = '',
  body = '',
  footer = '',
  className = '',
  headId = '',
  bodyId = '',
} = {}) {
  const classes = ['card', 'span-all', className].filter(Boolean).join(' ');
  const idAttr = id ? ` id="${esc(id)}"` : '';
  const headClasses = actions ? 'card-head' : 'card-head card-head--plain';
  const head = title
    ? `<div class="${headClasses}"${headId ? ` id="${esc(headId)}"` : ''}>
        <h2${note ? ` data-note="${esc(note)}"` : ''}>${esc(title)}</h2>
        ${actions ? `<div class="row">${actions}</div>` : ''}
      </div>`
    : '';
  const desc = description ? `<p class="meta">${description}</p>` : '';
  const bodyInner = body ? `<div class="card-body"${bodyId ? ` id="${esc(bodyId)}"` : ''}>${body}</div>` : '';
  const foot = footer ? `<div class="card-foot">${footer}</div>` : '';
  return `<section class="${classes}"${idAttr}>${head}${desc}${bodyInner}${foot}</section>`;
}

/** 直接替换宿主内容并返回新建的 section。 */
export function mountCard(host, spec) {
  if (!host) return null;
  host.innerHTML = cardHtml(spec);
  return host.firstElementChild;
}
