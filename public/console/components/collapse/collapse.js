// 折叠面板：统一 <details class="settings-group"> 的结构、箭头与可选展开记忆。
// 用法：collapseHtml({ id: 'slang-config', title: '黑话配置', body: html, open: true, persist: true })
// 需要记住展开状态时传 persist（存 localStorage 'qq-console:collapse:<id>'）。

const TEXT_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => TEXT_ESCAPES[c]);

export function collapseHtml({ id = '', title = '', body = '', open = false, persist = false, className = '', elementId = '' } = {}) {
  const classes = ['settings-group', className].filter(Boolean).join(' ');
  const attrs = [
    `class="${classes}"`,
    elementId ? `id="${esc(elementId)}"` : '',
    id ? `data-collapse-id="${esc(id)}"` : '',
    persist && id ? `data-collapse-persist="${esc(id)}"` : '',
    open ? 'open' : '',
  ].filter(Boolean).join(' ');
  return `<details ${attrs}><summary>${esc(title)}</summary><div class="settings-content">${body}</div></details>`;
}

/** 恢复已记忆的展开状态，并监听后续 toggle（幂等）。 */
export function hydrateCollapses(root = document) {
  root.querySelectorAll('details[data-collapse-persist]').forEach((el) => {
    const id = el.dataset.collapsePersist;
    if (!id || el.dataset.collapseBound === '1') return;
    el.dataset.collapseBound = '1';
    const key = `qq-console:collapse:${id}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) el.open = saved === '1';
    } catch { /* ignore */ }
    el.addEventListener('toggle', () => {
      try { localStorage.setItem(key, el.open ? '1' : '0'); } catch { /* ignore */ }
    });
  });
}
