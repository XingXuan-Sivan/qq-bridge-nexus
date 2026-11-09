// 主从布局（左右分栏）：左边是可选列表，右边是选中项的详情。
// 只提供「外壳 + 选中态 + 键盘」三件事，条目与详情的内容由页面自己决定；
// 默认不限高（内容多就整页滚动），需要固定高度时给 height 参数。
import { esc } from '../../js/ui.js';

/**
 * @param {object} opts
 * @param {string} opts.id 根节点 id
 * @param {string} [opts.listLabel] 列表无障碍名称
 * @param {string} [opts.listHtml] 列表条目 HTML（一般用 splitItemHtml 生成）
 * @param {string} [opts.detailHtml] 右侧详情 HTML
 * @param {string} [opts.empty] 没有选中项时的占位文案
 * @param {string} [opts.height] 固定高度（如 '520px'）；不传则随内容
 * @param {string} [opts.className]
 */
export function splitViewHtml({ id, listLabel = '列表', listHtml = '', detailHtml = '', empty = '从左侧选择一个条目', height = '', className = '' } = {}) {
  const dims = height ? ` style="--split-height:${esc(height)}" data-fixed-height="1"` : '';
  return `<div class="split-view${className ? ' ' + className : ''}" id="${esc(id)}" data-split-view${dims}>
  <div class="split-list" role="listbox" aria-label="${esc(listLabel)}">${listHtml}</div>
  <div class="split-detail" data-split-detail>${detailHtml || `<div class="split-empty">${esc(empty)}</div>`}</div>
</div>`;
}

/**
 * 一个列表条目。badges 是已转义的 HTML（调用方拼 pill）。
 */
export function splitItemHtml({ key, title, meta = '', badges = '', active = false, attrs = '' } = {}) {
  return `<button class="split-item${active ? ' is-active' : ''}" type="button" role="option"
    aria-selected="${active ? 'true' : 'false'}" data-split-key="${esc(key)}"${attrs ? ' ' + attrs : ''}>
    <span class="split-item-main"><span class="split-item-title">${esc(title)}</span>${badges ? `<span class="split-item-badges">${badges}</span>` : ''}</span>
    ${meta ? `<span class="split-item-meta">${esc(meta)}</span>` : ''}
  </button>`;
}

/** 选中某个条目（只改 class / aria，不重建 DOM）。 */
export function setSplitActive(root, key) {
  if (!root) return;
  for (const item of root.querySelectorAll('[data-split-key]')) {
    const on = item.dataset.splitKey === key;
    item.classList.toggle('is-active', on);
    item.setAttribute('aria-selected', on ? 'true' : 'false');
  }
}

/**
 * 绑定点击与键盘（↑↓ 在条目间移动并触发 onSelect）。
 * @returns {() => void} 解绑函数
 */
export function initSplitView(root, { onSelect, onEnter } = {}) {
  if (!root) return () => {};
  const list = root.querySelector('.split-list');
  const pick = (key) => {
    if (!key) return;
    setSplitActive(root, key);
    onSelect?.(key);
  };
  const onClick = (event) => {
    const hit = event.target instanceof Element ? event.target.closest('[data-split-key]') : null;
    if (!hit) return;
    pick(hit.dataset.splitKey);
  };
  const onKey = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
    const items = [...root.querySelectorAll('[data-split-key]')];
    if (!items.length) return;
    if (event.key === 'Enter') {
      const hit = event.target instanceof Element ? event.target.closest('[data-split-key]') : null;
      if (hit) { event.preventDefault(); onEnter?.(hit.dataset.splitKey); }
      return;
    }
    event.preventDefault();
    const active = items.findIndex((item) => item.classList.contains('is-active'));
    const next = active < 0 ? 0 : Math.min(items.length - 1, Math.max(0, active + (event.key === 'ArrowDown' ? 1 : -1)));
    items[next]?.focus();
    pick(items[next]?.dataset.splitKey);
  };
  list?.addEventListener('click', onClick);
  list?.addEventListener('keydown', onKey);
  return () => {
    list?.removeEventListener('click', onClick);
    list?.removeEventListener('keydown', onKey);
  };
}
