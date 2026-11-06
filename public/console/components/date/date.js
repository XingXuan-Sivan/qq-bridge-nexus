/* 日期字段：文本框（可直接键入 YYYY-MM-DD）+ 右侧日历按钮（调起浏览器自带的日期面板）。
 *
 * 为什么不直接用 <input type="date">：原生日期框的「年 / 月 / 日」是三段式输入，
 * 连续键入 20261225 会被年份段吃掉（得到 202612-02-05），用户会觉得「打不进去」。
 * 所以可见控件是文本框（可粘贴、可整段输入），日历按钮背后挂一个隐藏的原生 date 输入，
 * 需要面板时把它 showPicker() 出来，选完再回填文本。
 *
 * 约定（见 docs/CONSOLE_FORMS.md）：文本框的 id 就是业务 id，页面照常读它的 value（YYYY-MM-DD）；
 * 隐藏的原生输入用 data-date-native="<业务 id>" 关联，不参与表单读取。
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function nativeFor(text) {
  const id = text?.id;
  if (!id) return null;
  return text.closest('.date-field')?.querySelector(`input[data-date-native="${id}"]`) || null;
}

function toIso(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (ISO_DATE.test(raw)) return raw;
  // 容忍 2026/12/25、2026.12.25、2026年12月25日
  const m = raw.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function openPicker(text) {
  const native = nativeFor(text);
  if (!native) return;
  const iso = toIso(text.value);
  native.value = iso;
  if (typeof native.showPicker === 'function') {
    try { native.showPicker(); return; } catch (error) { /* 未获得用户手势时回退到点击 */ }
  }
  native.style.pointerEvents = 'auto';
  native.click();
  native.style.pointerEvents = '';
}

function bind(text) {
  if (!text || text.dataset.dateReady === '1') return;
  text.dataset.dateReady = '1';
  const native = nativeFor(text);
  if (!native) return;
  const button = text.closest('.date-field')?.querySelector('.date-field-btn');

  button?.addEventListener('click', () => openPicker(text));
  // 键入过程中允许「2026/12/25」这类写法，失焦时归一化；不合法就留原样让用户继续改。
  text.addEventListener('blur', () => {
    const iso = toIso(text.value);
    if (iso && iso !== text.value) text.value = iso;
    if (native) native.value = iso;
  });
  text.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const iso = toIso(text.value);
    if (iso) text.value = iso;
    text.blur();
  });
  native.addEventListener('change', () => {
    if (!native.value) return;
    text.value = native.value;
    text.dispatchEvent(new Event('input', { bubbles: true }));
    text.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

export function initDateFields(root = document) {
  const scope = root instanceof Element ? root : document;
  if (scope.matches?.('input[data-date-native], .date-field-text')) bind(scope);
  scope.querySelectorAll?.('.date-field-text').forEach(bind);
}
