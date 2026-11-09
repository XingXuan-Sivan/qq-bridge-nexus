// 页面级保存条：底部右侧一个悬浮按钮，负责「哪些表单改过」与「保存后逐项结果」。
//
// 用法（页面自己决定注册哪些分区）：
//   const bar = createSaveBar({
//     sections: [
//       { id: 'security', label: '安全设置', read: () => ({ interceptNotify: getSwitch($('secInterceptNotify')) }),
//         save: (value) => api('/api/security', 'POST', value) },
//     ],
//   });
//   bar.refresh();   // 数据加载完成后重拍基线（否则刚打开就显示「有未保存修改」）
//
// 约定：
// - 分区 = 一次 POST 能独立完成的表单；表格型分区（管理员、静默、工具开关）留在表格工具栏，
//   不进这里——它们的保存只对本部分生效，混进页面级保存会让「失败一项、全部重来」。
// - 脏 = 当前值与最近一次基线（成功保存 / refresh）不同；改回原值会自动变干净。
// - 保存是串行的：前一项失败不影响后一项，结果逐项列出，失败项保持脏。
import { getCurrentPage } from '../../js/router.js';

const $ = (id) => document.getElementById(id);

function snapshotOf(value) {
  try { return JSON.stringify(value ?? null); } catch { return String(value); }
}

function buildDom() {
  const root = document.createElement('div');
  root.className = 'save-bar';
  root.id = 'saveBar';
  root.hidden = true;

  const results = document.createElement('div');
  results.className = 'save-bar-results';
  results.id = 'saveBarResults';
  results.hidden = true;
  results.setAttribute('role', 'status');
  results.setAttribute('aria-live', 'polite');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'save-bar-button';
  button.id = 'saveBarButton';
  const badge = document.createElement('span');
  badge.className = 'save-bar-badge';
  badge.id = 'saveBarBadge';
  badge.textContent = '0';
  const text = document.createElement('span');
  text.className = 'save-bar-text';
  text.id = 'saveBarText';
  text.textContent = '保存修改';
  button.append(badge, text);

  root.append(results, button);
  return { root, results, button, badge, text };
}

/**
 * @param {{ sections: Array<{id:string,label:string,read:Function,save:Function,restart?:string}>, scope?:Element, page?:string }} options
 */
export function createSaveBar({ sections = [], scope = null, page = '' } = {}) {
  const list = sections.filter((s) => s && s.id && typeof s.read === 'function' && typeof s.save === 'function');
  const baseline = new Map();
  const els = buildDom();
  const watchScope = scope || document.getElementById('mainContent') || document.body;
  let busy = false;
  let scheduled = 0;
  let hideTimer = 0;
  // 用户是否在本页动过任何字段。异步数据回填不算「动过」，
  // 所以首次加载完成后可以安全地把当前值重拍成基线。
  let touched = false;

  function readSection(section) {
    try { return section.read(); } catch { return null; }
  }

  function dirtySections() {
    return list.filter((section) => snapshotOf(readSection(section)) !== baseline.get(section.id));
  }

  function paint() {
    const dirty = busy ? list.filter((s) => snapshotOf(readSection(s)) !== baseline.get(s.id)) : dirtySections();
    // 按钮常驻（只在本页显示），没有修改时禁用并显示「已保存」——避免用户找不到保存入口。
    els.root.hidden = page ? getCurrentPage() !== page : false;
    els.badge.hidden = dirty.length === 0;
    els.badge.textContent = String(dirty.length);
    els.button.disabled = busy || dirty.length === 0;
    els.text.textContent = busy ? '保存中…' : (dirty.length ? `保存 ${dirty.length} 项修改` : '已保存');
    els.button.setAttribute('aria-label', dirty.length ? `保存 ${dirty.length} 项未保存的修改` : '没有未保存的修改');
  }

  function refresh() {
    for (const section of list) baseline.set(section.id, snapshotOf(readSection(section)));
    els.results.hidden = true;
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
    const section = list.find((s) => s.id === sectionId);
    if (section) baseline.set(section.id, snapshotOf(readSection(section)));
    paint();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = setTimeout(() => { scheduled = 0; paint(); }, 60);
  }

  function renderResults(results) {
    els.results.replaceChildren();
    for (const item of results) {
      const row = document.createElement('div');
      row.className = 'save-bar-item ' + (item.ok ? 'ok' : (item.skipped ? 'skip' : 'err'));
      const icon = document.createElement('span');
      icon.className = 'save-bar-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = item.ok ? '✅' : (item.skipped ? '⏸️' : '❌');
      const body = document.createElement('span');
      body.className = 'save-bar-item-body';
      const name = document.createElement('b');
      name.textContent = item.label;
      const msg = document.createElement('span');
      msg.textContent = ' ' + item.message;
      body.append(name, msg);
      row.append(icon, body);
      els.results.appendChild(row);
    }
    els.results.hidden = false;
    clearTimeout(hideTimer);
    // 全部成功才自动收；有失败项就留着，让用户能看到原因。
    if (results.every((r) => r.ok || r.skipped)) hideTimer = setTimeout(() => { els.results.hidden = true; paint(); }, 6000);
  }

  /** 逐项保存当前脏分区；返回是否全部成功（失败的保持脏）。 */
  async function saveAll() {
    if (busy) return false;
    const pending = dirtySections();
    if (!pending.length) {
      els.results.hidden = true;
      paint();
      return true;
    }
    busy = true;
    paint();
    const results = [];
    for (const section of pending) {
      const value = readSection(section);
      try {
        const r = await section.save(value);
        const ok = r?.ok !== false;
        const skipped = r?.skipped === true;
        if (ok && !skipped) baseline.set(section.id, snapshotOf(readSection(section)));
        results.push({
          ok,
          skipped,
          label: section.label || section.id,
          message: r?.message || (ok ? '已保存' : (r?.error || '保存失败')),
        });
      } catch (error) {
        results.push({ ok: false, label: section.label || section.id, message: String(error?.message ?? error) });
      }
    }
    busy = false;
    renderResults(results);
    paint();
    return results.every((r) => r.ok || r.skipped);
  }

  els.button.addEventListener('click', () => { void saveAll(); });
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
    if (els.root.hidden && !els.results.hidden) return;
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

  document.body.appendChild(els.root);
  // 创建时先拍一次基线：否则「基线为空」会让所有分区一上来就算脏，
  // 后面的 refresh（数据加载完）也会因为 isDirty() 为真而被跳过。
  refresh();

  return {
    refresh,
    adoptIfPristine,
    reset,
    paint,
    saveAll,
    isDirty: () => dirtySections().length > 0,
    dirtyCount: () => dirtySections().length,
    dirtyLabels: () => dirtySections().map((s) => s.label || s.id),
    destroy() {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onUnload);
      watchScope.removeEventListener('input', onEdit);
      watchScope.removeEventListener('change', onEdit);
      watchScope.removeEventListener('click', onClick);
      els.root.remove();
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
