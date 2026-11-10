// 页面级保存：在 action-dock 上加一个「保存」动作，负责脏值比对与逐项保存结果。
//
// 用法（页面自己决定注册哪些分区）：
//   const dock = createSaveDock({
//     page: 'config',
//     sections: [
//       { id: 'security', label: '安全设置', read: () => ({ interceptNotify: getSwitch($('secInterceptNotify')) }),
//         save: (value) => api('/api/security', 'POST', value) },
//     ],
//   });
//   dock.refresh();   // 数据加载完成后重拍基线（否则刚打开就显示「有未保存修改」）
//
// 约定：
// - 分区 = 一次 POST 能独立完成的表单；表格型分区（管理员、静默、工具开关）留在表格工具栏，
//   不进这里——它们的保存只对本部分生效，混进页面级保存会让「失败一项、全部重来」。
// - 脏 = 当前值与最近一次基线（成功保存 / refresh）不同；改回原值会自动变干净。
// - 保存是串行的：前一项失败不影响后一项，结果逐项列出，失败项保持脏。
import { createActionDock, DOCK_ICONS } from './action-dock.js';
import { getCurrentPage } from '../../js/router.js';

function snapshotOf(value) {
  try { return JSON.stringify(value ?? null); } catch { return String(value); }
}

/**
 * @param {{
 *   sections: Array<{id:string,label:string,read:Function,save:Function,restart?:string}>,
 *   scope?: Element,
 *   page?: string,
 *   shape?: 'circle'|'square',
 *   autoHide?: boolean,
 *   actions?: Array<object>,
 * }} options
 */
export function createSaveDock({ sections = [], scope = null, page = '', shape = 'circle', autoHide = true, actions = [] } = {}) {
  const list = sections.filter((s) => s && s.id && typeof s.read === 'function' && typeof s.save === 'function');
  const baseline = new Map();
  const watchScope = scope || document.getElementById('mainContent') || document.body;
  let busy = false;
  // 正在跑的是保存还是撤销：按钮文案要跟着变，别把「正在撤销」写成「保存中」。
  let busyKind = '';
  let scheduled = 0;
  let hideTimer = 0;
  // 浮层只在真的有东西可看时出现：有未保存修改、正在保存、或刚出了保存结果。
  // 平时什么都不显示，页面也就不需要给它在底部留高度。
  let contentVisible = false;
  // 用户是否在本页动过任何字段。异步数据回填不算「动过」，
  // 所以首次加载完成后可以安全地把当前值重拍成基线。
  let touched = false;

  const results = document.createElement('div');
  results.className = 'action-dock-results';
  results.id = 'actionDockResults';
  results.hidden = true;
  results.setAttribute('role', 'status');
  results.setAttribute('aria-live', 'polite');

  const dock = createActionDock({
    page,
    shape,
    autoHide,
    visibleWhen: () => contentVisible,
    actions: [
      ...actions,
      { id: 'save', label: '保存修改', icon: DOCK_ICONS.save, primary: true, onClick: () => { void saveAll(); } },
    ],
  });
  // 结果面板放在按钮组顶部，随按钮组一起显示/隐藏。
  dock.el.prepend(results);

  function readSection(section) {
    try { return section.read(); } catch { return null; }
  }

  function dirtySections() {
    return list.filter((section) => snapshotOf(readSection(section)) !== baseline.get(section.id));
  }

  function paint() {
    const dirty = dirtySections();
    // 先收空的结果面板，再算可见性：否则浮层会多留一拍才消失。
    if (!busy && !dirty.length && elsResultsEmpty()) results.hidden = true;
    contentVisible = busy || !results.hidden || dirty.length > 0;
    dock.paint();
    dock.update('save', {
      badge: busy ? null : (dirty.length || null),
      disabled: busy || dirty.length === 0,
      label: busy ? (busyKind === 'discard' ? '正在撤销…' : '保存中…') : (dirty.length ? `保存 ${dirty.length} 项修改` : '已保存'),
    });
    // 页面可以额外挂一个「撤销未保存的修改」动作：没有脏值时同样禁用。
    if (dock.button('discard')) dock.update('discard', { disabled: busy || dirty.length === 0 });
  }

  function elsResultsEmpty() {
    return results.childElementCount === 0;
  }

  function refresh() {
    for (const section of list) baseline.set(section.id, snapshotOf(readSection(section)));
    results.hidden = true;
    paint();
  }

  /**
   * 数据异步回填后调用：只要用户还没动过本页字段，就把当前值当成新基线。
   * 返回是否真的重拍了（用户已经改过东西时不动，避免把他的修改当基线吞掉）。
   */
  function adoptIfPristine() {
    if (touched || busy) return false;
    refresh();
    return true;
  }

  function reset(sectionId) {
    if (sectionId) {
      const section = list.find((s) => s.id === sectionId);
      if (section) baseline.set(section.id, snapshotOf(readSection(section)));
    } else {
      // 整页丢弃：先清「用户改过」标记，随后调用方会重读服务端数据；
      // 重读完成后 adoptIfPristine() 会用最新值重拍基线。
      // 重读可能失败、adoptIfPristine() 也可能因为 busy/touched 跳过——需要「点了就一定变干净」
      // 的调用方请用 discard()。
      touched = false;
    }
    paint();
  }

  /**
   * 丢弃未保存修改：先让调用方重读服务端数据（restore），完成后无条件把当前值重拍成基线。
   * 不依赖重读成功、也不受 touched/busy 影响：用户点「丢弃」后浮层必须立刻变回「已保存」并收起。
   */
  async function discard(restore) {
    if (busy) return false;
    busy = true;
    busyKind = 'discard';
    touched = false;
    clearTimeout(hideTimer);
    paint();
    try {
      await restore?.();
    } finally {
      for (const section of list) baseline.set(section.id, snapshotOf(readSection(section)));
      results.replaceChildren();
      results.hidden = true;
      busy = false;
      busyKind = '';
      touched = false;
      paint();
    }
    return true;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = setTimeout(() => { scheduled = 0; paint(); }, 60);
  }

  function renderResults(items) {
    results.replaceChildren();
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'action-dock-item ' + (item.ok ? 'ok' : (item.skipped ? 'skip' : 'err'));
      const icon = document.createElement('span');
      icon.className = 'action-dock-item-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = item.ok ? '✅' : (item.skipped ? '⏸️' : '❌');
      const body = document.createElement('span');
      body.className = 'action-dock-item-body';
      const name = document.createElement('b');
      name.textContent = item.label;
      const msg = document.createElement('span');
      msg.textContent = ' ' + item.message;
      body.append(name, msg);
      row.append(icon, body);
      results.appendChild(row);
    }
    results.hidden = false;
    clearTimeout(hideTimer);
    // 全部成功才自动收；有失败项就留着，让用户能看到原因。
    if (items.every((r) => r.ok || r.skipped)) hideTimer = setTimeout(() => { results.hidden = true; paint(); }, 6000);
  }

  /** 逐项保存当前脏分区；返回是否全部成功（失败的保持脏）。 */
  async function saveAll() {
    if (busy) return false;
    const pending = dirtySections();
    if (!pending.length) {
      results.hidden = true;
      paint();
      return true;
    }
    busy = true;
    busyKind = 'save';
    paint();
    const items = [];
    for (const section of pending) {
      const value = readSection(section);
      try {
        const r = await section.save(value);
        const ok = r?.ok !== false;
        const skipped = r?.skipped === true;
        if (ok && !skipped) baseline.set(section.id, snapshotOf(readSection(section)));
        items.push({
          ok,
          skipped,
          label: section.label || section.id,
          message: r?.message || (ok ? '已保存' : (r?.error || '保存失败')),
        });
      } catch (error) {
        items.push({ ok: false, label: section.label || section.id, message: String(error?.message ?? error) });
      }
    }
    busy = false;
    busyKind = '';
    renderResults(items);
    paint();
    return items.every((r) => r.ok || r.skipped);
  }

  const onEdit = () => { touched = true; schedule(); };
  watchScope.addEventListener('input', onEdit);
  watchScope.addEventListener('change', onEdit);
  // role=switch 的 aria-checked 由点击处理器自己改，且不发 input/change：
  // 这里既标记「用户动过」，也等一拍再算脏。
  const onClick = (event) => {
    if (event.target instanceof Element && event.target.closest('[role="switch"]')) touched = true;
    setTimeout(schedule, 0);
  };
  watchScope.addEventListener('click', onClick);

  const onKey = (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
    if (page && getCurrentPage() !== page) return;
    event.preventDefault();
    void saveAll();
  };
  document.addEventListener('keydown', onKey);

  const onUnload = (event) => {
    if (!dirtySections().length) return;
    event.preventDefault();
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', onUnload);

  // 创建时先拍一次基线：否则「基线为空」会让所有分区一上来就算脏，
  // 后面的 refresh（数据加载完）也会因为 isDirty() 为真而被跳过。
  refresh();

  return {
    refresh,
    adoptIfPristine,
    reset,
    discard,
    paint,
    saveAll,
    isDirty: () => dirtySections().length > 0,
    // 「用户真的动过」：只有为真时才值得弹离开确认。数据回填造成的假脏不该拦住切页。
    isTouched: () => touched,
    dirtyCount: () => dirtySections().length,
    dirtyLabels: () => dirtySections().map((s) => s.label || s.id),
    destroy() {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
      watchScope.removeEventListener('input', onEdit);
      watchScope.removeEventListener('change', onEdit);
      watchScope.removeEventListener('click', onClick);
      dock.destroy();
    },
  };
}

/**
 * 带未保存修改离开时的三选一弹窗：保存并离开 / 丢弃 / 取消。
 * 返回 Promise<'save'|'discard'|'cancel'>；弹窗结构复用 modal 组件。
 */
export function askLeaveWithUnsaved({ bar, toLabel = '离开本页' } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'unsavedLeaveModal';
    overlay.setAttribute('aria-hidden', 'true');
    const labels = bar?.dirtyLabels?.() || [];
    overlay.innerHTML = `<div class="modal" data-modal-panel role="dialog" aria-modal="true" aria-labelledby="unsavedLeaveTitle" tabindex="-1">
      <header class="modal-head"><h3 id="unsavedLeaveTitle">有未保存的修改</h3><button class="modal-close" type="button" data-modal-close aria-label="关闭">×</button></header>
      <div class="modal-body">
        <p class="u-mb-8">${escHtml(labels.join('、'))} 还没有保存。${escHtml(toLabel)}会丢掉这些修改。</p>
      </div>
      <footer class="modal-foot">
        <button type="button" class="btn" data-leave="cancel">取消</button>
        <button type="button" class="btn danger" data-leave="discard">不保存，直接离开</button>
        <button type="button" class="btn primary" data-leave="save">保存并离开</button>
      </footer>
    </div>`;
    document.body.appendChild(overlay);
    const finish = (answer) => { overlay.remove(); document.removeEventListener('keydown', onKey, true); resolve(answer); };
    const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); finish('cancel'); } };
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) return finish('cancel');
      const hit = event.target instanceof Element ? event.target.closest('[data-leave], [data-modal-close]') : null;
      if (!hit) return;
      if (hit.hasAttribute('data-modal-close')) return finish('cancel');
      const answer = hit.dataset.leave;
      if (answer === 'save') {
        hit.disabled = true;
        const cancelBtn = overlay.querySelector('[data-leave="cancel"]');
        if (cancelBtn) cancelBtn.disabled = true;
        bar.saveAll().then((ok) => finish(ok ? 'save' : 'cancel'));
        return;
      }
      finish(answer);
    });
    document.addEventListener('keydown', onKey, true);
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.querySelector('.modal')?.focus({ preventScroll: true });
  });
}

function escHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
