// 页面统一的操作反馈：
//   1) setMsg / clearMsg：表单行内状态文案（不弹窗）。
//   2) toast：右上角浮层提示（旧 showConsoleToast 的底层实现）。
// 约定：setMsg 的元素必须已在 DOM 里（片段页的 init 之后才调），kind 决定配色（ok / err / info）。

/**
 * @param {Element|string|null} target 元素或元素 id
 * @param {string} text 文案（可以自带 ✅/❌ 图标）
 * @param {'ok'|'err'|'info'} kind
 */
export function setMsg(target, text, kind = 'info') {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return null;
  el.textContent = text ?? '';
  el.className = kind === 'ok' ? 'meta ok' : (kind === 'err' ? 'meta err' : 'meta');
  return el;
}

/** 清空一条反馈（保留配色类，避免布局跳动）。 */
export function clearMsg(target) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (el) el.textContent = '';
  return el;
}

const TEXT_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => TEXT_ESCAPES[c]);

const TONE_ICON = { success: '✓', warning: '!', danger: '×', info: 'i' };
let stack = null;

function ensureStack() {
  if (stack?.isConnected) return stack;
  stack = document.createElement('div');
  stack.className = 'message-stack';
  stack.setAttribute('aria-live', 'polite');
  document.body.appendChild(stack);
  return stack;
}

/**
 * @param {{
 *   type?: 'info'|'success'|'warning'|'danger',
 *   title?: string, message?: string, duration?: number
 * }} spec
 */
export function toast({ type = 'info', title = '', message = '', duration = 3200 } = {}) {
  if (!message && !title) return null;
  const tone = ['success', 'warning', 'danger'].includes(type) ? type : 'info';
  const host = ensureStack();
  const node = document.createElement('div');
  node.className = `message message--${tone}`;
  node.innerHTML = [
    `<span class="message-icon" aria-hidden="true">${TONE_ICON[tone] ?? 'i'}</span>`,
    '<div class="message-body">',
    title ? `<strong class="message-title">${esc(title)}</strong>` : '',
    message ? `<p class="message-text">${esc(message)}</p>` : '',
    '</div>',
    '<button class="message-close" type="button" aria-label="关闭提示">×</button>',
  ].join('');
  host.appendChild(node);
  requestAnimationFrame(() => node.classList.add('is-in'));

  let timer = null;
  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    node.classList.remove('is-in');
    node.classList.add('is-out');
    window.setTimeout(() => node.remove(), 200);
  };
  const arm = () => {
    window.clearTimeout(timer);
    if (duration > 0) timer = window.setTimeout(remove, duration);
  };
  node.addEventListener('mouseenter', () => window.clearTimeout(timer));
  node.addEventListener('mouseleave', arm);
  node.querySelector('.message-close')?.addEventListener('click', remove);
  arm();
  return node;
}

/** 清掉当前所有浮层提示（切页时可用）。 */
export function clearToasts() {
  if (stack) stack.innerHTML = '';
}
