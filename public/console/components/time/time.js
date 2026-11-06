/* 时间字段：文本框（可直接键入 HH:mm）+ 右侧时钟按钮（调起浏览器自带的时间面板）。
 *
 * 与 components/date 同一套思路：原生 <input type="time"> 是「时 / 分」两段式，
 * 连续键入 0900 需要靠段位自动进位，用户想「整段输入 09:00」时体验很差；
 * 所以可见控件是文本框，时钟按钮背后挂一个隐藏的原生 time 输入，只用来 showPicker()。
 *
 * 约定：文本框的 id 就是业务 id，页面照常读它的 value（HH:mm）；
 * 隐藏的原生输入用 data-time-native="<业务 id>" 关联，不参与表单读取。
 */

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function nativeFor(text) {
  const id = text?.id;
  if (!id) return null;
  return text.closest('.time-field')?.querySelector(`input[data-time-native="${id}"]`) || null;
}

function toHhmm(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  // 09:00 / 9:5 / 09：00 / 0900
  let m = raw.match(/^(\d{1,2})\s*[:：]\s*(\d{1,2})$/);
  if (!m) m = raw.match(/^(\d{2})(\d{2})$/);
  if (!m) return '';
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function openPicker(text) {
  const native = nativeFor(text);
  if (!native) return;
  native.value = toHhmm(text.value);
  if (typeof native.showPicker === 'function') {
    try { native.showPicker(); return; } catch (error) { /* 未获得用户手势时回退到点击 */ }
  }
  native.style.pointerEvents = 'auto';
  native.click();
  native.style.pointerEvents = '';
}

function bind(text) {
  if (!text || text.dataset.timeReady === '1') return;
  text.dataset.timeReady = '1';
  const native = nativeFor(text);
  if (!native) return;
  const button = text.closest('.time-field')?.querySelector('.time-field-btn');

  button?.addEventListener('click', () => openPicker(text));
  text.addEventListener('blur', () => {
    const hhmm = toHhmm(text.value);
    if (hhmm && hhmm !== text.value) text.value = hhmm;
    if (native) native.value = hhmm;
  });
  text.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const hhmm = toHhmm(text.value);
    if (hhmm) text.value = hhmm;
    text.blur();
  });
  native.addEventListener('change', () => {
    if (!native.value) return;
    text.value = native.value;
    text.dispatchEvent(new Event('input', { bubbles: true }));
    text.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

export function initTimeFields(root = document) {
  const scope = root instanceof Element ? root : document;
  if (scope.matches?.('.time-field-text')) bind(scope);
  scope.querySelectorAll?.('.time-field-text').forEach(bind);
}
