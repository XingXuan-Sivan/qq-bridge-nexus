/* 下拉框装饰：把每个原生 <select> 包进 .select-wrap，并在右侧放一个自绘箭头。
   原生箭头方向固定、贴边缘、也没有展开动画；包一层之后箭头可以随焦点翻转。
   用法：页面里什么都不用改 —— initSelects() 在启动时装一次，之后动态插入的 select
   由 MutationObserver 自动补上（表单 renderFields、scheduler 的重复方式编辑器都会动态建 select）。 */

const READY = 'selectReady';

function decorate(select) {
  if (!select || select.dataset[READY] === '1') return;
  const parent = select.parentElement;
  if (parent?.classList.contains('select-wrap')) {
    select.dataset[READY] = '1';
    return;
  }
  const wrap = document.createElement('span');
  wrap.className = 'select-wrap';
  parent.insertBefore(wrap, select);
  wrap.appendChild(select);
  const chevron = document.createElement('span');
  chevron.className = 'select-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  wrap.appendChild(chevron);
  select.dataset[READY] = '1';

  const open = () => wrap.classList.add('is-open');
  const close = () => wrap.classList.remove('is-open');
  // pointerdown 比 click 早：原生下拉在 pointerdown 时就展开了，箭头要同步转。
  select.addEventListener('pointerdown', open);
  select.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') open();
    if (event.key === 'Escape' || event.key === 'Tab') close();
  });
  select.addEventListener('change', close);
  select.addEventListener('blur', close);
}

export function decorateSelects(root = document) {
  const scope = root instanceof Element ? root : document;
  if (scope.matches?.('select')) decorate(scope);
  scope.querySelectorAll?.('select').forEach(decorate);
}

let observer = null;

/** 启动时调用一次：装饰现有 select，并持续观察后续插入的。 */
export function initSelects() {
  decorateSelects(document);
  if (observer) return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('select')) decorate(node);
        node.querySelectorAll?.('select').forEach(decorate);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
