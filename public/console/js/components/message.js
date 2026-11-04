// 页面统一的操作反馈：把「设文本 + 设配色类」这一对动作收在一处。
// 约定：元素必须已在 DOM 里（片段页的 init 之后才调），kind 决定配色（ok / err / info）。

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
