// 行为档案页：两标签 —— 行为档案（清单 + 参数 + 两层提示词）、能力预设。
// 权威存储：config/behaviors/<id>.yml、dsh/agent-presets/<id>/capability.yml、config/platform/<id>.yml。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { onPageRefresh } from '../../js/router.js';
import { renderFields } from '../../components/form/form.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { mountCodeEditor } from '../../components/code-editor/code-editor.js';
import { modalHtml, openModal, closeModal } from '../../components/modal/modal.js';
import { behaviorFields, fillBehaviorForm, readBehaviorForm } from './behavior-form.js';
import { BEHAVIOR_FIELDS } from './fields.js';
import { createCapabilityPanel } from '../../components/capability-panel/capability-panel.js';

let behaviorDoc = null;
let behaviorItems = [];
let busy = false;
let kindSpecs = new Map();
let kindsPromise = null;
let capabilityPanel = null;
let promptEditor = null;
let platformEditor = null;
let platformPrompts = [];

/** 字段规格由后端 kind 注册表下发，页面不再自带一份（避免两处漂移）。 */
async function ensureKinds() {
  if (kindsPromise) return kindsPromise;
  kindsPromise = api('/api/behaviors/kinds')
    .then((r) => {
      kindSpecs = new Map((Array.isArray(r?.kinds) ? r.kinds : []).map((entry) => [entry.kind, entry.fields]));
    })
    .catch(() => {
      kindsPromise = null;
      throw new Error('读取行为类型失败');
    });
  return kindsPromise;
}

function fieldsOf(kind) {
  return kindSpecs.get(kind) ?? [];
}

function setMsg(text, tone = 'info', id = 'behaviorFormMsg') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || '';
  el.className = `meta ${tone === 'ok' ? 'ok' : tone === 'err' ? 'err' : ''}`.trim();
}

/** 代码编辑器：容器由页面提供，编辑器用项目组件挂载（不手写 textarea 外观）。 */
function editorInto(container, value, { language = 'markdown', height = '360px' } = {}) {
  if (!container) return null;
  return mountCodeEditor(container, {
    value: value ?? '',
    language,
    height,
    onChange: null,
  });
}

function renderBehaviorTable(items) {
  const host = document.getElementById('behaviorTable');
  if (!host) return;
  const rows = items.map((item) => ({
    attrs: { 'data-filter-kind': item.kind || '' },
    cells: [
      `<code>${esc(item.id)}</code><div class="meta">${esc(item.label || '')}</div>`,
      `<span class="pill">${esc(item.kind || '?')}</span>`,
      Array.isArray(item.usedBy) && item.usedBy.length
        ? item.usedBy.map((id) => `<code>${esc(id)}</code>`).join(' ')
        : '<span class="meta">未被方案引用</span>',
      `<div class="row-actions">
        <button class="btn small" type="button" data-behavior-edit="${esc(item.id)}">编辑</button>
        <button class="btn small" type="button" data-behavior-clone="${esc(item.id)}">克隆</button>
        <button class="btn small danger" type="button" data-behavior-delete="${esc(item.id)}">删除</button>
      </div>`,
    ],
  }));
  const kindOptions = [...kindSpecs.keys()].map((kind) => ({ value: kind, label: kind }));
  host.innerHTML = dataTableHtml({
    columns: [{ label: '档案' }, { label: '类型', width: '90px' }, { label: '被引用' }, { label: '操作', width: '190px' }],
    rows,
    pageSize: 10,
    search: { placeholder: '搜索档案 / id' },
    refresh: true,
    filters: [{ id: 'kind', label: '类型', value: '', options: [{ value: '', label: '全部类型' }, ...kindOptions] }],
    actions: '<button class="btn small primary" type="button" id="behaviorCreate">新建</button>',
    empty: '还没有行为档案。',
  });
  initDataTables(host, { onRefresh: () => void refreshList() });
}

async function refreshList(preferred) {
  const select = document.getElementById('behaviorFormSelect');
  if (!select) return;
  await ensureKinds();
  const list = await api('/api/config/behaviors');
  const items = Array.isArray(list?.behaviors) ? list.behaviors : [];
  behaviorItems = items;
  renderBehaviorTable(items);
  select.innerHTML = items.length
    ? items.map((item) => `<option value="${esc(item.id)}">${esc(item.label || item.id)}（${esc(item.kind || '?')}）</option>`).join('')
    : '<option value="">（没有行为档案）</option>';
  if (!items.length) {
    document.getElementById('behaviorFormPanel').innerHTML = '<p class="meta">config/behaviors 下没有可用的行为档案。</p>';
    behaviorDoc = null;
    if (promptEditor) promptEditor.setValue('');
    return;
  }
  const want = preferred || behaviorDoc?.id || items[0].id;
  if (items.some((item) => item.id === want)) select.value = want;
  await loadDoc(select.value);
}

async function loadDoc(id) {
  const panel = document.getElementById('behaviorFormPanel');
  if (!panel || !id) return;
  setMsg('读取中…');
  try {
    const doc = await api(`/api/config/behaviors/${encodeURIComponent(id)}`);
    if (!doc?.ok) throw new Error(doc?.error || '读取失败');
    behaviorDoc = doc;
    panel.innerHTML = '';
    renderFields(panel, behaviorFields(fieldsOf(doc.kind)), { columns: 2 });
    fillBehaviorForm(panel, fieldsOf(doc.kind), doc.data?.config ?? {});
    const label = document.getElementById('behaviorFormLabel');
    if (label) label.value = doc.data?.label ?? '';
    if (!promptEditor) promptEditor = editorInto(document.getElementById('behaviorPromptEditor'), doc.data?.prompt ?? '');
    else promptEditor.setValue(doc.data?.prompt ?? '');
    setMsg('');
  } catch (error) {
    panel.innerHTML = '';
    setMsg(String(error?.message ?? error), 'err');
  }
}

async function saveDoc() {
  if (!behaviorDoc || busy) return;
  const panel = document.getElementById('behaviorFormPanel');
  if (!panel) return;
  const config = readBehaviorForm(panel, fieldsOf(behaviorDoc.kind));
  const label = String(document.getElementById('behaviorFormLabel')?.value ?? '').trim() || behaviorDoc.data?.label || behaviorDoc.id;
  const prompt = promptEditor?.getValue?.() ?? behaviorDoc.data?.prompt ?? '';
  busy = true;
  setMsg('保存中…');
  try {
    const r = await api(`/api/config/behaviors/${encodeURIComponent(behaviorDoc.id)}`, 'PUT', {
      data: { version: 1, kind: behaviorDoc.kind, label, description: behaviorDoc.data?.description ?? '', config, prompt },
    });
    if (!r?.ok) throw new Error(r?.error || '保存失败');
    setMsg('✅ 已保存；重启桥接后生效', 'ok');
    await loadDoc(behaviorDoc.id);
  } catch (error) {
    setMsg(`❌ ${String(error?.message ?? error)}`, 'err');
  } finally {
    busy = false;
  }
}

async function savePrompt() {
  if (!behaviorDoc || busy) return;
  const prompt = promptEditor?.getValue?.() ?? '';
  busy = true;
  setMsg('保存中…', 'info', 'behaviorPromptMsg');
  try {
    const r = await api(`/api/config/behaviors/${encodeURIComponent(behaviorDoc.id)}`, 'PUT', {
      data: { version: 1, kind: behaviorDoc.kind, label: behaviorDoc.data?.label ?? behaviorDoc.id, description: behaviorDoc.data?.description ?? '', config: behaviorDoc.data?.config ?? {}, prompt },
    });
    if (!r?.ok) throw new Error(r?.error || '保存失败');
    setMsg(`✅ 已保存（${prompt.length} 字）；下一轮唤醒注入`, 'ok', 'behaviorPromptMsg');
    showConsoleToast('行为提示词已保存');
    behaviorDoc = { ...behaviorDoc, data: { ...behaviorDoc.data, prompt } };
  } catch (error) {
    setMsg(`❌ ${String(error?.message ?? error)}`, 'err', 'behaviorPromptMsg');
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
  const host = overlay.querySelector(`#${fieldsId}`);
  if (mode === 'delete') {
    renderFields(host, [{ name: 'behaviorArchiveId', type: 'static', label: '档案', value: source?.id ?? '' }], { columns: 1, layout: 'inline' });
  } else if (mode === 'clone') {
    renderFields(host, [
      { name: 'behaviorArchiveId', type: 'text', label: '新档案 id', placeholder: '小写字母、数字、连字符', value: `${source?.id ?? 'behavior'}-copy` },
      { name: 'behaviorArchiveLabel', type: 'text', label: '名称', value: `${source?.label ?? source?.id ?? ''}（副本）` },
    ], { columns: 1, layout: 'inline' });
  } else {
    renderFields(host, [
      { name: 'behaviorArchiveId', type: 'text', label: '档案 id', placeholder: '小写字母、数字、连字符', hint: '创建后不可改名' },
      { name: 'behaviorArchiveLabel', type: 'text', label: '名称' },
      { name: 'behaviorArchiveKind', type: 'select', label: '类型', options: [...kindSpecs.keys()].map((k) => ({ value: k, label: k })), value: 'v2' },
      { name: 'behaviorArchiveFrom', type: 'select', label: '以现有档案为模板', options: [{ value: '', label: '空白（按类型默认值）' }, { value: source?.id ?? '', label: source?.id ?? '' }].filter((o) => o.value !== '' || o.label), value: '' },
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

// ── 平台话术 ────────────────────────────────────────────────
async function loadPlatform(id) {
  if (!platformPrompts.length) {
    const list = await api('/api/platform/prompts');
    platformPrompts = Array.isArray(list?.prompts) ? list.prompts : [];
  }
  const select = document.getElementById('platformPromptId');
  const want = id || select?.value || platformPrompts[0]?.id;
  if (select && !select.dataset.filled) {
    select.innerHTML = platformPrompts
      .map((p) => `<option value="${esc(p.id)}">${esc(p.platform || p.id)}（${p.chars} 字）</option>`)
      .join('');
    select.dataset.filled = '1';
    select.addEventListener('change', () => void loadPlatform(select.value));
  }
  if (select && want) select.value = want;
  if (!want) return;
  const resp = await api(`/api/platform/prompts/${encodeURIComponent(want)}`);
  const doc = resp?.prompt ?? resp;
  if (!resp?.ok || !doc) {
    setMsg(resp?.error || '读取失败', 'err', 'platformMsg');
    return;
  }
  if (!platformEditor) platformEditor = editorInto(document.getElementById('platformPromptEditor'), doc.text ?? '');
  else platformEditor.setValue(doc.text ?? '');
  setMsg(`${doc.chars ?? 0} 字${doc.isFactory ? '（与出厂一致）' : ''}`, 'info', 'platformMsg');
}

async function savePlatform() {
  const id = document.getElementById('platformPromptId')?.value;
  if (!id) return;
  setMsg('保存中…', 'info', 'platformMsg');
  try {
    const r = await api(`/api/platform/prompts/${encodeURIComponent(id)}`, 'PUT', { text: platformEditor?.getValue?.() ?? '' });
    if (!r?.ok) throw new Error(r?.error || '保存失败');
    setMsg(`✅ 已保存（${r.prompt?.chars ?? 0} 字）；下一轮唤醒生效`, 'ok', 'platformMsg');
    showConsoleToast('平台话术已保存');
  } catch (error) {
    setMsg(`❌ ${String(error?.message ?? error)}`, 'err', 'platformMsg');
  }
}

async function restorePlatform() {
  const id = document.getElementById('platformPromptId')?.value;
  if (!id) return;
  if (!window.confirm('还原为出厂话术？当前内容会先备份到 state/platform-backups/。')) return;
  setMsg('还原中…', 'info', 'platformMsg');
  try {
    const r = await api(`/api/platform/prompts/${encodeURIComponent(id)}/restore`, 'POST', {});
    if (!r?.ok) throw new Error(r?.error || '还原失败');
    await loadPlatform(id);
    showConsoleToast('已还原出厂');
  } catch (error) {
    setMsg(`❌ ${String(error?.message ?? error)}`, 'err', 'platformMsg');
  }
}

export function init() {
  const listHost = document.querySelector('[data-behavior-fields="list"]');
  if (listHost) renderFields(listHost, BEHAVIOR_FIELDS.list.fields, { columns: 1 });
  const host = document.querySelector('[data-behavior-fields="main"]');
  if (host) renderFields(host, BEHAVIOR_FIELDS.main.fields, { columns: 1, layout: 'inline' });
  const promptHost = document.querySelector('[data-behavior-fields="prompt"]');
  if (promptHost) renderFields(promptHost, BEHAVIOR_FIELDS.prompt.fields, { columns: 1 });
  const platformHost = document.querySelector('[data-behavior-fields="platform"]');
  if (platformHost) renderFields(platformHost, BEHAVIOR_FIELDS.platform.fields, { columns: 1, layout: 'inline' });
  document.getElementById('behaviorFormSelect')?.addEventListener('change', (event) => {
    if (event.target.value) void loadDoc(event.target.value);
  });
  document.getElementById('behaviorFormRefresh')?.addEventListener('click', () => void refreshList());
  document.querySelector('[data-behavior-fields="list"]')?.addEventListener('click', (event) => {
    const edit = event.target.closest('[data-behavior-edit]');
    if (edit) {
      const id = edit.dataset.behaviorEdit;
      const select = document.getElementById('behaviorFormSelect');
      if (select) select.value = id;
      void loadDoc(id);
      return;
    }
    const clone = event.target.closest('[data-behavior-clone]');
    if (clone) {
      const item = behaviorItems.find((entry) => entry.id === clone.dataset.behaviorClone);
      openArchiveModal({ mode: 'clone', source: { id: clone.dataset.behaviorClone, label: item?.label ?? clone.dataset.behaviorClone } });
      return;
    }
    const remove = event.target.closest('[data-behavior-delete]');
    if (remove) openArchiveModal({ mode: 'delete', source: { id: remove.dataset.behaviorDelete } });
  });
  document.getElementById('behaviorFormSave')?.addEventListener('click', () => void saveDoc());
  // 动作按钮由 renderFields 生成、重建后失效，统一在 document 上委托。
  document.addEventListener('click', (event) => {
    const id = event.target.closest('[id]')?.id;
    if (id === 'behaviorPromptSave') { void savePrompt(); return; }
    if (id === 'behaviorCreate') { openArchiveModal({ mode: 'create' }); return; }
    if (id === 'platformSave') { void savePlatform(); return; }
    if (id === 'platformRestore') { void restorePlatform(); }
  });

  const capabilityHost = document.getElementById('capabilityTable');
  const capabilityEditorHost = document.getElementById('capabilityEditor');
  if (capabilityHost) capabilityPanel = createCapabilityPanel({ listHost: capabilityHost, editorHost: capabilityEditorHost });

  const tabs = [...document.querySelectorAll('[data-behavior-tab]')];
  const panels = [...document.querySelectorAll('[data-behavior-panel]')];
  // 记住停留的标签页：刷新/切走再回来都回到同一页，而不是永远弹回第一个。
  const TAB_KEY = 'qq-console:tab:behavior';
  const TAB_NAMES = ['behaviors', 'capabilities'];
  function readTab() {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      return TAB_NAMES.includes(saved) ? saved : 'behaviors';
    } catch {
      return 'behaviors';
    }
  }
  function showTab(name, { persist = true } = {}) {
    const next = TAB_NAMES.includes(name) ? name : 'behaviors';
    for (const tab of tabs) {
      const active = tab.dataset.behaviorTab === next;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    }
    for (const panel of panels) panel.hidden = panel.dataset.behaviorPanel !== next;
    if (persist) {
      try { localStorage.setItem(TAB_KEY, next); } catch { /* 隐身模式忽略 */ }
    }
    if (next === 'capabilities') void capabilityPanel?.load();
  }
  for (const tab of tabs) tab.addEventListener('click', () => showTab(tab.dataset.behaviorTab));

  void loadPlatform();
  onPageRefresh('behavior', () => {
    setTimeout(() => void refreshList(), 0);
    showTab(readTab(), { persist: false });
  });
  showTab(readTab(), { persist: false });
  void refreshList();
}
