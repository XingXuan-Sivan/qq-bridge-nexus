// 提示条（Alert）：页面级/表单级的说明、警告与错误。
// 结构对齐 Element Plus：图标 + 标题 + 描述，可带关闭按钮。
//
// 关闭状态的持久化：
//   persist: 'local' | 'session' | 'none'（默认 'local'）
//   - local：localStorage，刷新后仍然关闭（适合「一次性公告」）
//   - session：sessionStorage，本次会话关闭（适合「已知晓的警告」）
//   - none：仅当次页面关闭（默认行为更安全，刷新会重新出现）
// 想重新显示：调用 resetAlert(id)；或在控制台执行
//   localStorage.removeItem('qq-console:alert-dismissed')

const STORAGE_KEY = 'qq-console:alert-dismissed';

const TEXT_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => TEXT_ESCAPES[c]);

function readDismissed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function writeDismissed(set) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/**
 * @param {{
 *   id?: string, type?: 'info'|'success'|'warning'|'danger',
 *   title?: string, description?: string, closable?: boolean,
 *   persist?: 'local'|'session'|'none', actions?: string, className?: string
 * }} spec
 */
export function alertHtml({
  id = '',
  type = 'info',
  title = '',
  description = '',
  closable = false,
  persist = 'local',
  actions = '',
  className = '',
} = {}) {
  const tone = ['success', 'warning', 'danger'].includes(type) ? type : 'info';
  const classes = ['alert', `alert--${tone}`, closable ? 'alert--closable' : '', className].filter(Boolean).join(' ');
  const attrs = [
    `class="${classes}"`,
    'role="status"',
    id ? `data-alert-id="${esc(id)}"` : '',
    closable ? `data-alert-persist="${esc(persist)}"` : '',
  ].filter(Boolean).join(' ');
  const closeBtn = closable
    ? '<button class="alert-close" type="button" data-alert-close aria-label="关闭提示">×</button>'
    : '';
  const head = title ? `<strong class="alert-title">${esc(title)}</strong>` : '';
  const desc = description ? `<p class="alert-desc">${esc(description)}</p>` : '';
  const foot = actions ? `<div class="alert-actions">${actions}</div>` : '';
  return `<div ${attrs}>${closeBtn}<div class="alert-body">${head}${desc}${foot}</div></div>`;
}

export function dismissAlert(id, persist = 'local') {
  if (!id) return;
  if (persist === 'session') {
    try { sessionStorage.setItem(`qq-console:alert-dismissed:${id}`, '1'); } catch { /* ignore */ }
    return;
  }
  if (persist === 'local') {
    const set = readDismissed();
    set.add(id);
    writeDismissed(set);
  }
}

export function resetAlert(id) {
  if (!id) return;
  const set = readDismissed();
  set.delete(id);
  writeDismissed(set);
  try { sessionStorage.removeItem(`qq-console:alert-dismissed:${id}`); } catch { /* ignore */ }
}

/** 隐藏已记录为关闭的提示条，并绑定关闭按钮（幂等）。 */
export function hydrateAlerts(root = document) {
  const dismissed = readDismissed();
  root.querySelectorAll('[data-alert-id]').forEach((el) => {
    const id = el.dataset.alertId;
    if (!id) return;
    const persist = el.dataset.alertPersist || 'local';
    let hidden = dismissed.has(id);
    if (!hidden && persist === 'session') {
      try { hidden = sessionStorage.getItem(`qq-console:alert-dismissed:${id}`) === '1'; } catch { hidden = false; }
    }
    if (hidden) {
      el.hidden = true;
      return;
    }
    if (el.dataset.alertBound === '1') return;
    el.dataset.alertBound = '1';
    el.querySelector('[data-alert-close]')?.addEventListener('click', () => {
      dismissAlert(id, persist);
      el.hidden = true;
    });
  });
}

/** 把一条 alert 插入宿主末尾并立即完成持久化/关闭绑定。 */
export function mountAlert(host, spec) {
  if (!host) return null;
  host.insertAdjacentHTML('beforeend', alertHtml(spec));
  const el = host.lastElementChild;
  hydrateAlerts(host);
  return el;
}
