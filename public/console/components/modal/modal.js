// 弹窗组件：统一「.open 类 + Esc 关闭 + 点遮罩关闭」这套行为。
// 约定：遮罩节点由页面 HTML 提供（id 自定），且必须挂在 document.body 上——
// 片段被注入在 section.card 里，.card 的动画/滤镜会给 position:fixed 造包含块。
// 样式同住本目录 modal.css（.modal-overlay / .modal 系列）。
//
// 标准结构（三段式，主体滚动、头尾固定）：
//   .modal-overlay#id > .modal[data-modal-panel]
//     > header.modal-head > h3 + button.modal-close[data-modal-close]
//     > div.modal-body        （只有这段滚动）
//     > footer.modal-foot     （左侧 .modal-status + 右侧 .btn）
// 只要把 .modal 标记成 data-modal-panel，样式就会启用；不标记则是旧的整块滚动弹窗。

export function openModal(overlay) {
  if (!overlay) return false;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  // 焦点移进弹窗，Esc/空格等键盘操作才有落点；关闭时交还给原来的元素。
  const panel = overlay.querySelector('.modal');
  const active = document.activeElement;
  if (panel) {
    panel.__returnFocus = active instanceof HTMLElement ? active : null;
    panel.focus({ preventScroll: true });
  }
  return true;
}

export function closeModal(overlay) {
  if (!overlay) return false;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  const panel = overlay.querySelector('.modal');
  const back = panel?.__returnFocus;
  if (back && document.contains(back)) back.focus({ preventScroll: true });
  if (panel) panel.__returnFocus = null;
  return true;
}

export function isModalOpen(overlay) {
  return Boolean(overlay?.classList.contains('open'));
}

/**
 * 生成三段式弹窗的 HTML（供 JS 动态建弹窗的页面复用）。
 * @param {{ id: string, title: string, body?: string, footer?: string, wide?: boolean, titleId?: string }} spec
 */
export function modalHtml({ id, title, body = '', footer = '', wide = false, titleId = '' }) {
  const headingId = titleId || `${id}-title`;
  return `<div class="modal-overlay" id="${id}" aria-hidden="true">
  <div class="modal${wide ? ' modal--wide' : ''}" data-modal-panel role="dialog" aria-modal="true" aria-labelledby="${headingId}" tabindex="-1">
    <header class="modal-head">
      <h3 id="${headingId}">${title}</h3>
      <button class="modal-close" type="button" data-modal-close aria-label="关闭">×</button>
    </header>
    <div class="modal-body">${body}</div>
    ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
  </div>
</div>`;
}

/**
 * 绑定一次关闭行为（Esc、点遮罩、右上角 ×、任何 [data-modal-close]）。
 * @param {Element} overlay
 * @param {{ onClose?: () => void, onBeforeClose?: () => boolean, closeOnBackdrop?: boolean, closeOnEscape?: boolean }} options
 * @returns {() => void} 手动关闭函数（内部会跑 onClose）
 */
export function wireModal(overlay, { onClose = null, onBeforeClose = null, closeOnBackdrop = true, closeOnEscape = true } = {}) {
  if (!overlay) return () => {};
  const close = () => {
    if (!isModalOpen(overlay)) return;
    // onBeforeClose 返回 false 时保持打开（例如详情里还有未保存的改动）。
    if (typeof onBeforeClose === 'function' && onBeforeClose() === false) return;
    closeModal(overlay);
    onClose?.();
  };
  if (closeOnBackdrop) {
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  }
  overlay.addEventListener('click', (event) => {
    const hit = event.target instanceof Element ? event.target.closest('[data-modal-close]') : null;
    if (hit && overlay.contains(hit)) close();
  });
  if (closeOnEscape) {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isModalOpen(overlay)) { event.preventDefault(); close(); }
    });
  }
  return close;
}
