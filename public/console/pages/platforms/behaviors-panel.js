// 行为档案面板：平台详情 ›「行为」标签（仅用户侧平台、且该平台确实有档案目录时出现）。
//
// 权威存储：profiles/platforms/<平台>/behaviors/<id>.yml（C7 之前这里是独立整页）。
// 档案是平台的子资源：列表按「档案所属平台」过滤，新建时直接落到当前平台，不再让人选平台。
// 字段规格仍由后端 kind 注册表下发（GET /api/behaviors/kinds），页面不自带一份。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { renderFields } from '../../components/form/form.js';
import { confirmBox } from '../../components/message-box/message-box.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { modalHtml, openModal, closeModal } from '../../components/modal/modal.js';
import { mountPromptCard } from '../../components/prompt-card/prompt-card.js';
import { platformLabel } from '../../js/registry.js';
import { behaviorFields, fillBehaviorForm, readBehaviorForm } from './behavior-form.js';
import { BEHAVIOR_FIELDS } from './fields.js';

let behaviorDoc = null;
let behaviorItems = [];
let busy = false;
let kindSpecs = new Map();
let kindMetas = new Map();
let kindsPromise = null;
let promptCard = null;
let platformId = '';
let host = null;

function fieldsOf(kind) {
  return kindSpecs.get(kind) ?? [];
}

function setMsg(text, tone = 'info') {
  const el = host?.querySelector('#behaviorFormMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = `meta ${tone === 'ok' ? 'ok' : tone === 'err' ? 'err' : ''}`.trim();
}

/** 档案所属平台：档案自己写了就用自己的，否则取 kind 注册表里的平台。 */
function platformOfBehavior(item) {
  return String(item?.platform || kindMetas.get(item?.kind)?.platform || '');
}

/** 字段规格由后端 kind 注册表下发，页面不再自带一份（避免两处漂移）。 */
function ensureKinds() {
  if (kindsPromise) return kindsPromise;
  kindsPromise = api('/api/behaviors/kinds')
    .then((r) => {
      kindSpecs = new Map((Array.isArray(r?.kinds) ? r.kinds : []).map((entry) => [entry.kind, entry.fields]));
      kindMetas = new Map((Array.isArray(r?.kinds) ? r.kinds : []).map((entry) => [entry.kind, entry]));
    })
    .catch(() => {
      kindsPromise = null;
      throw new Error('读取行为类型失败');
    });
  return kindsPromise;
}

function renderBehaviorTable(items) {
  const tableHost = host?.querySelector('#behaviorTable');
  if (!tableHost) return;
  const rows = items.map((item) => ({
    attrs: { 'data-filter-kind': item.kind || '' },
    cells: [
      `<code>${esc(item.id)}</code><div class="meta">${esc(item.label || '')}</div>`,
      `<span class="meta">${esc(kindMetas.get(item.kind)?.label || item.kind || '?')}</span>`,
      Array.isArray(item.usedBy) && item.usedBy.length
        ? item.usedBy.map((id) => `<code>${esc(id)}</code>`).join(' ')
        : '<span class="meta">未被方案引用</span>',
      `<div class="row-actions">
        <button class="btn small" type="button" data-behavior-edit="${esc(item.id)}">编辑</button>
        <button class="btn small" type="button" data-behavior-clone="${esc(item.id)}">克隆</button>
        ${item.builtin ? '' : `<button class="btn small danger" type="button" data-behavior-delete="${esc(item.id)}">删除</button>`}
      </div>`,
    ],
  }));
  const kindOptions = [...kindSpecs.keys()].map((kind) => ({ value: kind, label: kindMetas.get(kind)?.label || kind }));
  tableHost.innerHTML = dataTableHtml({
    columns: [{ label: '档案' }, { label: '类型', width: '110px' }, { label: '被引用' }, { label: '操作', width: '190px' }],
    rows,
    pageSize: 10,
    search: { placeholder: '搜索档案 / 备注 / id' },
    refresh: true,
    filters: [{ id: 'kind', label: '类型', value: '', options: [{ value: '', label: '全部类型' }, ...kindOptions] }],
    actions: '<button class="btn small primary" type="button" id="behaviorCreate">新建</button>',
    empty: '这个平台还没有行为档案。',
  });
  initDataTables(tableHost, { onRefresh: () => void refreshList() });
}

async function refreshList(preferred) {
  await ensureKinds();
  const list = await api('/api/config/behaviors');
  const all = Array.isArray(list?.behaviors) ? list.behaviors : [];
  // 只显示属于当前平台的档案：档案是平台的子资源，别的平台的档案在这里点了也存不回去。
  const items = all.filter((item) => !platformId || platformOfBehavior(item) === platformId);
  behaviorItems = items;
  renderBehaviorTable(items);
  const panel = host?.querySelector('#behaviorFormPanel');
  if (!items.length) {
    if (panel) panel.innerHTML = `<p class="meta">${esc(platformLabel(platformId))} 还没有行为档案。</p>`;
    behaviorDoc = null;
    promptCard = null;
    const cardHost = host?.querySelector('#behaviorPromptCard');
    if (cardHost) cardHost.innerHTML = '';
    return;
  }
  const want = preferred || behaviorDoc?.id || items[0].id;
  await loadDoc(items.some((item) => item.id === want) ? want : items[0].id);
}

function mountBasics(doc) {
  const basicsHost = host?.querySelector('[data-behavior-fields="basics"]');
  if (!basicsHost || basicsHost.dataset.mounted === '1') return;
  basicsHost.dataset.mounted = '1';
  renderFields(basicsHost, BEHAVIOR_FIELDS.basics.fields, { columns: 1, layout: 'inline' });
  const input = host.querySelector('#behaviorFormLabel');
  if (input) {
    input.value = doc.data?.label ?? '';
    input.readOnly = Boolean(doc.builtin);
    input.closest('.field-row')?.classList.toggle('is-readonly', Boolean(doc.builtin));
  }
  const reset = host.querySelector('#behaviorFormReset');
  if (reset) reset.hidden = !doc.builtin;
}

async function loadDoc(id) {
  const panel = host?.querySelector('#behaviorFormPanel');
  if (!panel || !id) return;
  setMsg('读取中…');
  try {
    const doc = await api(`/api/config/behaviors/${encodeURIComponent(id)}`);
    if (!doc?.ok) throw new Error(doc?.error || '读取失败');
    behaviorDoc = doc;
    mountBasics(doc);
    const label = host.querySelector('#behaviorFormLabel');
    if (label) label.value = doc.data?.label ?? '';
    panel.innerHTML = '';
    renderFields(panel, behaviorFields(fieldsOf(doc.kind)), { columns: 2 });
    fillBehaviorForm(panel, fieldsOf(doc.kind), doc.data?.config ?? {});
    const cardHost = host?.querySelector('#behaviorPromptCard');
    const factory = doc.factoryPrompt ?? doc.data?.prompt ?? '';
    if (!promptCard) {
      promptCard = mountPromptCard(cardHost, {
        title: '行为提示词',
        hint: '描述 QQ 里怎么说话、怎么等待；提示词与上面的配置一起保存，写入同一份档案 YAML。',
        value: doc.data?.prompt ?? '',
        factory,
        onSave: async () => { await saveDoc(); },
        onRestore: async () => {
          const restored = await api(`/api/config/behaviors/${encodeURIComponent(behaviorDoc.id)}/reset`, 'POST', {});
          if (!restored?.ok) throw new Error(restored?.error || '重置失败');
          await loadDoc(behaviorDoc.id);
          return { text: restored.data?.prompt ?? '', factory: restored.factoryPrompt ?? '' };
        },
      });
    } else {
      promptCard.setValue(doc.data?.prompt ?? '');
      promptCard.setFactory(factory);
    }
    setMsg('');
  } catch (error) {
    panel.innerHTML = '';
    setMsg(String(error?.message ?? error), 'err');
  }
}

async function saveDoc() {
  if (!behaviorDoc || busy) return;
  const panel = host?.querySelector('#behaviorFormPanel');
  if (!panel) return;
  const config = readBehaviorForm(panel, fieldsOf(behaviorDoc.kind));
  const label = behaviorDoc.builtin
    ? behaviorDoc.data?.label || behaviorDoc.id
    : String(host.querySelector('#behaviorFormLabel')?.value ?? '').trim() || behaviorDoc.data?.label || behaviorDoc.id;
  const prompt = promptCard?.getValue?.() ?? behaviorDoc.data?.prompt ?? '';
  busy = true;
  setMsg('保存中…');
  try {
    const r = await api(`/api/config/behaviors/${encodeURIComponent(behaviorDoc.id)}`, 'PUT', {
      data: { version: 1, kind: behaviorDoc.kind, label, description: behaviorDoc.data?.description ?? '', config, prompt },
    });
    if (!r?.ok) throw new Error(r?.error || '保存失败');
    setMsg('✅ 已保存；重启桥接后生效', 'ok');
    showConsoleToast('行为档案已保存');
    await loadDoc(behaviorDoc.id);
  } catch (error) {
    setMsg(`❌ ${String(error?.message ?? error)}`, 'err');
  } finally {
    busy = false;
  }
}

/** 新建 / 克隆 / 删除：都用项目弹窗 + renderFields（不手写控件）。 */
function openArchiveModal({ mode, source = null }) {
  const overlayId = 'behaviorArchiveModal';
  document.getElementById(overlayId)?.remove();
  const title = mode === 'create' ? '新建行为档案' : mode === 'clone' ? '克隆行为档案' : '删除行为档案';
  const fieldsId = `behaviorArchiveFields${mode}`;
  const body = mode === 'delete'
    ? `<div class="form-stack" id="${fieldsId}"></div><div class="meta">删除会先备份到 <code>state/behavior-backups/</code>；被运行方案引用时不允许删除。</div>`
    : `<div class="form-stack" id="${fieldsId}"></div>`;
  const footer = `<button class="btn" type="button" data-modal-close>取消</button><button class="btn ${mode === 'delete' ? 'danger' : 'primary'}" type="button" id="behaviorArchiveSave">${mode === 'delete' ? '删除' : '保存'}</button>`;
  document.body.insertAdjacentHTML('beforeend', modalHtml({ id: overlayId, title, body, footer }));
  const overlay = document.getElementById(overlayId);
  const fieldsHost = overlay.querySelector(`#${fieldsId}`);
  if (mode === 'delete') {
    renderFields(fieldsHost, [{ name: 'behaviorArchiveId', type: 'static', label: '档案', value: source?.id ?? '' }], { columns: 1, layout: 'inline' });
  } else if (mode === 'clone') {
    renderFields(fieldsHost, [
      { name: 'behaviorArchiveId', type: 'text', label: '新档案 id', placeholder: '小写字母、数字、连字符', value: `${source?.id ?? 'behavior'}-copy` },
      { name: 'behaviorArchiveLabel', type: 'text', label: '备注', value: `${source?.label ?? source?.id ?? ''}（副本）` },
    ], { columns: 1, layout: 'inline' });
  } else {
    const typeOptions = [...kindMetas.values()].map((meta) => ({ value: meta.kind, label: meta.label || meta.kind }));
    const templateOptions = [{ value: '', label: '空白（按类型默认值）' }, ...behaviorItems.map((item) => ({ value: item.id, label: `${item.label || item.id}（${item.id}）` }))];
    renderFields(fieldsHost, [
      { name: 'behaviorArchiveId', type: 'text', label: '档案 id', placeholder: '小写字母、数字、连字符', hint: `创建在 ${platformId || '当前平台'} 的档案目录里，创建后不可改名` },
      { name: 'behaviorArchiveKind', type: 'select', label: '类型', options: typeOptions, value: typeOptions[0]?.value ?? 'social-v2' },
      { name: 'behaviorArchiveLabel', type: 'text', label: '备注', placeholder: '一句话说明' },
      { name: 'behaviorArchiveFrom', type: 'select', label: '以现有档案为模板', options: templateOptions, value: '' },
    ], { columns: 1, layout: 'inline' });
  }
  openModal(overlay);
  overlay.querySelectorAll('[data-modal-close]').forEach((btn) => btn.addEventListener('click', () => closeModal(overlay)));
  overlay.querySelector('#behaviorArchiveSave')?.addEventListener('click', async () => {
    const value = (name) => String(overlay.querySelector(`[name="${name}"]`)?.value ?? '').trim();
    setMsg('');
    try {
      if (mode === 'delete') {
        const r = await api(`/api/config/behaviors/${encodeURIComponent(source.id)}`, 'DELETE');
        if (!r?.ok) throw new Error(r?.error || '删除失败');
        showConsoleToast('行为档案已删除');
      } else if (mode === 'clone') {
        const r = await api(`/api/config/behaviors/${encodeURIComponent(source.id)}/clone`, 'POST', { toId: value('behaviorArchiveId'), label: value('behaviorArchiveLabel') });
        if (!r?.ok) throw new Error(r?.error || '克隆失败');
        showConsoleToast('已克隆');
      } else {
        const from = value('behaviorArchiveFrom');
        const r = from
          ? await api(`/api/config/behaviors/${encodeURIComponent(from)}/clone`, 'POST', { toId: value('behaviorArchiveId'), label: value('behaviorArchiveLabel') })
          : await api('/api/config/behaviors', 'POST', { id: value('behaviorArchiveId'), label: value('behaviorArchiveLabel'), kind: value('behaviorArchiveKind') });
        if (!r?.ok) throw new Error(r?.error || '创建失败');
        showConsoleToast('已创建');
      }
      closeModal(overlay);
      await refreshList();
    } catch (error) {
      setMsg(`❌ ${String(error?.message ?? error)}`, 'err');
    }
  });
}

/** 面板骨架：三块（清单 / 基本信息 / 提示词），标题用 h3 —— 详情本身已经在卡片里，不再套一层卡。 */
function markup() {
  return `
    <div class="platform-stack">
      <section class="platform-section">
        <h3>档案清单</h3>
        <p class="meta">档案是资源，被运行方案的行为字段引用；改名不影响引用，删除前先确认没有被方案使用。</p>
        <div data-behavior-fields="list"></div>
      </section>
      <section class="platform-section">
        <h3>基本信息</h3>
        <p class="meta">写入 <code>profiles/platforms/${esc(platformId)}/behaviors</code>，重启桥接后生效。</p>
        <div class="form-stack" data-behavior-fields="basics"></div>
        <div class="form-actions">
          <button class="btn primary" type="button" id="behaviorFormSave">保存</button>
          <button class="btn" type="button" id="behaviorFormReset" hidden>重置</button>
          <span class="meta" id="behaviorFormMsg" role="status"></span>
        </div>
        <div class="behavior-groups" id="behaviorFormPanel"></div>
      </section>
      <section class="platform-section">
        <div class="prompt-card" id="behaviorPromptCard"></div>
      </section>
    </div>`;
}

/**
 * 在 host 里挂载某个平台的行为档案面板。
 * @param {HTMLElement} target 详情标签里的宿主
 * @param {{platformId: string}} opts 当前平台（用户侧）
 * @returns {{load: () => Promise<void>}}
 */
export function mountBehaviorsPanel(target, { platformId: id } = {}) {
  host = target;
  platformId = String(id ?? '');
  behaviorDoc = null;
  promptCard = null;
  host.innerHTML = markup();
  const listHost = host.querySelector('[data-behavior-fields="list"]');
  if (listHost) renderFields(listHost, BEHAVIOR_FIELDS.list.fields, { columns: 1 });

  host.addEventListener('click', (event) => {
    const edit = event.target.closest('[data-behavior-edit]');
    if (edit) { void loadDoc(edit.dataset.behaviorEdit); return; }
    const clone = event.target.closest('[data-behavior-clone]');
    if (clone) {
      const item = behaviorItems.find((entry) => entry.id === clone.dataset.behaviorClone);
      openArchiveModal({ mode: 'clone', source: { id: clone.dataset.behaviorClone, label: item?.label ?? clone.dataset.behaviorClone } });
      return;
    }
    const remove = event.target.closest('[data-behavior-delete]');
    if (remove) { openArchiveModal({ mode: 'delete', source: { id: remove.dataset.behaviorDelete } }); return; }
    if (event.target.closest('#behaviorCreate')) { openArchiveModal({ mode: 'create' }); return; }
    if (event.target.closest('#behaviorFormSave')) { void saveDoc(); return; }
    if (event.target.closest('#behaviorFormReset')) {
      void (async () => {
        if (!behaviorDoc?.builtin) return;
        if (!(await confirmBox({ message: `把「${behaviorDoc.data?.label || behaviorDoc.id}」重置为出厂内容？`, confirmText: '重置' }))) return;
        try {
          const r = await api(`/api/config/behaviors/${encodeURIComponent(behaviorDoc.id)}/reset`, 'POST', {});
          if (!r?.ok) throw new Error(r?.error || '重置失败');
          showConsoleToast('已重置为出厂内容');
          await loadDoc(behaviorDoc.id);
        } catch (error) {
          setMsg(`❌ ${String(error?.message ?? error)}`, 'err');
        }
      })();
    }
  });

  return { load: () => refreshList() };
}
