// 竖向浮动操作组：右下角一列图标按钮，任何页面都能用（保存只是其中一种动作）。
//
// 用法：
//   const dock = createActionDock({
//     page: 'config',
//     actions: [
//       { id: 'reset', label: '重新加载', icon: ICONS.refresh, onClick: () => reload() },
//       { id: 'save', label: '保存修改', icon: ICONS.save, onClick: () => save(), primary: true },
//     ],
//   });
//   dock.update('save', { disabled: false, badge: 2, label: '保存 2 项修改' });
//
// 约定：
// - 组件只管「一组按钮长什么样、怎么摆」，不关心保存语义；需要脏值跟踪的页面用 save-dock.js。
// - 默认常驻（只在本页显示，不随滚动/空闲隐藏），形状由 `shape`（circle / square）决定，
//   颜色一律取主题令牌，不写死品牌色。
// - 每个按钮都必须有 label：它是 aria-label 与原生 title，图标本身对读屏隐藏。
import { getCurrentPage } from '../../js/router.js';

const $ = (id) => document.getElementById(id);

function escAttr(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function buildButton(action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'action-dock-btn' + (action.primary ? ' is-primary' : '');
  button.dataset.action = action.id;
  button.id = `actionDock-${action.id}`;
  if (action.tone) button.dataset.tone = action.tone;

  const icon = document.createElement('span');
  icon.className = 'action-dock-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = action.icon || '';
  button.appendChild(icon);

  const badge = document.createElement('span');
  badge.className = 'action-dock-badge';
  badge.hidden = true;
  button.appendChild(badge);

  button.addEventListener('click', (event) => {
    if (button.disabled) return;
    action.onClick?.(event);
  });
  return button;
}

/**
 * @param {{
 *   actions: Array<{id:string,label:string,icon?:string,onClick?:Function,disabled?:boolean,hidden?:boolean,
 *     badge?:number|string,primary?:boolean,tone?:string}>,
 *   page?: string,
 *   shape?: 'circle'|'square',
 *   id?: string,
 *   className?: string,
 * }} options
 */
export function createActionDock({ actions = [], page = '', shape = 'circle', id = 'actionDock', className = '' } = {}) {
  const root = document.createElement('div');
  root.className = 'action-dock' + (className ? ' ' + className : '');
  root.id = id;
  root.dataset.shape = shape;
  root.hidden = true;

  const buttons = new Map();
  for (const action of actions) {
    if (!action || !action.id) continue;
    const button = buildButton(action);
    buttons.set(action.id, { action, button });
    root.appendChild(button);
  }

  function paintVisibility() {
    root.hidden = page ? getCurrentPage() !== page : false;
  }

  function update(actionId, patch = {}) {
    const entry = buttons.get(actionId);
    if (!entry) return;
    const { button, action } = entry;
    Object.assign(action, patch);
    if ('label' in patch) {
      button.setAttribute('aria-label', patch.label);
      button.title = patch.label;
    }
    if ('disabled' in patch) button.disabled = Boolean(patch.disabled);
    if ('hidden' in patch) button.hidden = Boolean(patch.hidden);
    if ('badge' in patch) {
      const text = patch.badge == null ? '' : String(patch.badge);
      const badge = button.querySelector('.action-dock-badge');
      badge.hidden = !text;
      badge.textContent = text;
    }
    if ('primary' in patch) button.classList.toggle('is-primary', Boolean(patch.primary));
  }

  for (const [actionId, entry] of buttons) {
    entry.button.setAttribute('aria-label', entry.action.label || actionId);
    entry.button.title = entry.action.label || actionId;
    if (entry.action.disabled) entry.button.disabled = true;
    if (entry.action.hidden) entry.button.hidden = true;
    if (entry.action.badge != null) update(actionId, { badge: entry.action.badge });
  }

  document.body.appendChild(root);
  paintVisibility();
  return {
    el: root,
    button: (actionId) => buttons.get(actionId)?.button || null,
    update,
    paint: paintVisibility,
    destroy() { root.remove(); },
  };
}

// 常用图标（16–20px 线性图标，stroke 取 currentColor）
export const DOCK_ICONS = {
  save: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
