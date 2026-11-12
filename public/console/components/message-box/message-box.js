// 消息弹窗（确认 / 提示）：替代控制台页面里的 window.confirm / window.alert。
// 表单弹窗仍用 ../modal/modal.js；这里复用它生成的遮罩与三段式结构，只做轻量确认框。
//
// 用法：
//   if (await confirmBox({ message: '确定删除？', danger: true })) { … }
//   await alertBox({ title: '已保存', message: '刷新后生效。', type: 'success' });

import { modalHtml, openModal, closeModal } from '../modal/modal.js';

const TEXT_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => TEXT_ESCAPES[c]);

const ICON = { info: 'i', success: '✓', warning: '!', danger: '×' };
let seq = 0;

function boxHtml({ title, message, type, confirmText, cancelText, danger }) {
  const tone = ['success', 'warning', 'danger'].includes(type) ? type : 'info';
  const confirmClass = danger || tone === 'danger' ? 'btn primary danger' : 'btn primary';
  const cancel = cancelText ? `<button class="btn" type="button" data-box-cancel>${esc(cancelText)}</button>` : '';
  const body = `<div class="message-box-body">
      <span class="message-box-icon message-box-icon--${tone}" aria-hidden="true">${ICON[tone]}</span>
      <p class="message-box-text">${esc(message)}</p>
    </div>`;
  const footer = `${cancel}<button class="${confirmClass}" type="button" data-box-confirm>${esc(confirmText)}</button>`;
  return modalHtml({ id: `message-box-${++seq}`, title, body, footer });
}

function showBox(spec, { allowCancel }) {
  return new Promise((resolve) => {
    const holder = document.createElement('div');
    holder.innerHTML = boxHtml(spec);
    const overlay = holder.firstElementChild;
    document.body.append(overlay);
    openModal(overlay);
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey, true);
      closeModal(overlay);
      overlay.remove();
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      done(allowCancel ? false : true);
    };
    overlay.querySelector('[data-box-confirm]')?.addEventListener('click', () => done(true));
    overlay.querySelector('[data-box-cancel]')?.addEventListener('click', () => done(false));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) done(allowCancel ? false : true);
    });
    document.addEventListener('keydown', onKey, true);
    overlay.querySelector('[data-box-confirm]')?.focus();
  });
}

export function confirmBox({
  title = '确认操作',
  message = '',
  type = 'warning',
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
} = {}) {
  return showBox({ title, message, type, confirmText, cancelText, danger }, { allowCancel: true });
}

export function alertBox({
  title = '提示',
  message = '',
  type = 'info',
  confirmText = '知道了',
} = {}) {
  return showBox({ title, message, type, confirmText, cancelText: '' }, { allowCancel: false }).then(() => undefined);
}
