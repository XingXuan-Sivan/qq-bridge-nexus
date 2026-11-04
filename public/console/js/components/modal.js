// 弹窗组件：统一「.open 类 + Esc 关闭 + 点遮罩关闭」这套行为。
// 约定：遮罩节点由页面 HTML 提供（id 自定），且必须挂在 document.body 上——
// 片段被注入在 section.card 里，.card 的动画/滤镜会给 position:fixed 造包含块。

export function openModal(overlay) {
  if (!overlay) return false;
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  return true;
}

export function closeModal(overlay) {
  if (!overlay) return false;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  return true;
}

export function isModalOpen(overlay) {
  return Boolean(overlay?.classList.contains('open'));
}

/**
 * 绑定一次关闭行为（Esc、点遮罩）。
 * @param {Element} overlay
 * @param {{ onClose?: () => void, closeOnBackdrop?: boolean, closeOnEscape?: boolean }} options
 * @returns {() => void} 手动关闭函数（内部会跑 onClose）
 */
export function wireModal(overlay, { onClose = null, closeOnBackdrop = true, closeOnEscape = true } = {}) {
  if (!overlay) return () => {};
  const close = () => {
    if (!isModalOpen(overlay)) return;
    closeModal(overlay);
    onClose?.();
  };
  if (closeOnBackdrop) {
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  }
  if (closeOnEscape) {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isModalOpen(overlay)) { event.preventDefault(); close(); }
    });
  }
  return close;
}
