// 搜索框组件：外观见同目录 search-box.css（input.search-box），行为收在这里。
// 页面 HTML 只写一行契约：<input type="search" class="search-box" id="…">；
// 需要动态生成时用 searchBoxHtml()，输入监听统一用 bindSearchBox()。
import { esc } from '../../js/ui.js';

/**
 * @param {{id:string, placeholder?:string, value?:string, className?:string, label?:string}} options
 * @returns {string} 搜索框的 HTML 片段
 */
export function searchBoxHtml({ id, placeholder = '', value = '', className = '', label = '搜索' } = {}) {
  if (!id) throw new Error('searchBoxHtml 需要 id');
  const classes = className ? `search-box ${className}` : 'search-box';
  return `<input type="search" class="${classes}" id="${esc(id)}" placeholder="${esc(placeholder)}" value="${esc(value)}" aria-label="${esc(label)}" autocomplete="off">`;
}

/**
 * 绑定输入：input/search 事件都回调，Enter 立即回调，Esc 清空。
 * @param {Element|string} input 元素或元素 id
 * @param {(value:string) => void} onQuery
 * @param {{onEnter?:(value:string)=>void}} [options]
 * @returns {() => void} 解绑函数
 */
export function bindSearchBox(input, onQuery, { onEnter = null } = {}) {
  const el = typeof input === 'string' ? document.getElementById(input) : input;
  if (!el) return () => {};
  const emit = () => onQuery?.(el.value);
  const onInput = () => emit();
  const onKeydown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (onEnter) onEnter(el.value); else emit();
    }
    if (event.key === 'Escape' && el.value) {
      el.value = '';
      emit();
    }
  };
  el.addEventListener('input', onInput);
  el.addEventListener('search', onInput);
  el.addEventListener('keydown', onKeydown);
  return () => {
    el.removeEventListener('input', onInput);
    el.removeEventListener('search', onInput);
    el.removeEventListener('keydown', onKeydown);
  };
}
