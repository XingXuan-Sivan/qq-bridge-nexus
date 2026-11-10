/** 折叠分组的统一行为：默认只展开第一组，之后记住用户手动展开/收起了哪些组。
 *
 *  为什么放在组件层而不是各页自己写：
 *  - 长页（persona / social-v1 / plugins / usage / social-v2）都有 3~16 个 `<details class="settings-group">`，
 *    每页复制一遍 toggle 逻辑必然会漂移；
 *  - 用户希望「默认展开第一组，其余收起」，同时下次进页面还记得上次展开过哪些 —— 这是跨页一致的体验，
 *    存储键按页面隔离，互不影响。
 *
 *  存储：localStorage 的 `dsh.console.groups.<pageId>`，值形如 `{ "g0": true, "语音库": false }`；
 *  `data-group` 优先作为键，没有就用序号（顺序变化时以 data-group 为准更稳）。读不到/写不进（隐私模式）时退化为「只展开第一组」。
 */

const PREFIX = 'dsh.console.groups.';

function readState(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeState(key, state) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* 隐私模式/配额满：记忆功能降级，不影响页面本身 */
  }
}

/**
 * 初始化一个页面里的所有折叠分组。
 * @param {HTMLElement} root 页面宿主（`section[data-page]`）
 * @param {{ pageId: string }} options pageId 用于隔离存储
 * @returns {{ destroy: () => void } | null}
 */
export function initGroups(root, { pageId } = {}) {
  if (!root || !pageId) return null;
  const groups = [...root.querySelectorAll('details.settings-group')];
  if (!groups.length) return null;

  const storageKey = PREFIX + pageId;
  const saved = readState(storageKey);
  const isFirstVisit = saved === null;
  /** @type {Record<string, boolean>} */
  const state = {};

  /** 正在按记忆回填，期间的 toggle 事件不应写回存储 */
  let restoring = true;

  groups.forEach((details, index) => {
    const key = details.dataset.group || `g${index}`;
    details.dataset.groupKey = key;
    // 首次访问：只展开第一组；之后完全按记忆（没记过的组默认收起）。
    // data-default-open="closed" 的组即使排在第一位也保持收起（预设页的「高级配置」就是这种）。
    const firstVisitOpen = index === 0 && details.dataset.defaultOpen !== 'closed';
    details.open = isFirstVisit ? firstVisitOpen : saved[key] === true;
    state[key] = details.open;
    details.addEventListener('toggle', () => {
      if (restoring) return;
      state[key] = details.open;
      writeState(storageKey, state);
    });
  });

  // toggle 事件是异步派发的，等这一轮结束后再允许写回
  queueMicrotask(() => {
    restoring = false;
  });

  return {
    destroy() {
      /* 事件随 DOM 一起回收，这里只留接口给未来的动态重渲染 */
    },
  };
}
