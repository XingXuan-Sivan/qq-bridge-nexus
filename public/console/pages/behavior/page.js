// 行为档案页：选择 + 按 schema 表单编辑 v1/v2。
// 权威存储是 config/behaviors/<id>.yml；后端 GET 返回结构化 data，PUT 收 {data}。
import { api } from '../../js/api.js';
import { esc } from '../../js/ui.js';
import { onPageRefresh } from '../../js/router.js';
import { renderFields } from '../../components/form/form.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { behaviorFields, fillBehaviorForm, readBehaviorForm } from '../presets/behavior-form.js';
import { BEHAVIOR_FIELDS } from './fields.js';

let behaviorDoc = null;
let busy = false;
let kindSpecs = new Map();
let kindsPromise = null;

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

function setMsg(text, tone = 'info') {
  const el = document.getElementById('behaviorFormMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = `meta ${tone === 'ok' ? 'ok' : tone === 'err' ? 'err' : ''}`.trim();
}

function renderBehaviorTable(items) {
  const host = document.getElementById('behaviorTable');
  if (!host) return;
  const rows = items.map((item) => ({
    cells: [
      `<code>${esc(item.id)}</code><div class="meta">${esc(item.label || '')}</div>`,
      `<span class="pill">${esc(item.kind || '?')}</span>`,
      Array.isArray(item.usedBy) && item.usedBy.length
        ? item.usedBy.map((id) => `<code>${esc(id)}</code>`).join(' ')
        : '<span class="meta">未被方案引用</span>',
      `<button class="btn" type="button" data-behavior-edit="${esc(item.id)}">编辑</button>`,
    ],
  }));
  host.innerHTML = dataTableHtml({
    columns: [{ label: '档案', width: '38%' }, { label: '类型', width: '120px' }, { label: '被引用', width: '26%' }, { label: '操作', width: '110px' }],
    rows,
    pageSize: 10,
    search: { placeholder: '搜索档案 / id' },
    empty: '还没有行为档案。',
  });
  initDataTables(host);
}

async function refreshList(preferred) {
  const select = document.getElementById('behaviorFormSelect');
  if (!select) return;
  await ensureKinds();
  const list = await api('/api/config/behaviors');
  const items = Array.isArray(list?.behaviors) ? list.behaviors : [];
  renderBehaviorTable(items);
  select.innerHTML = items.length
    ? items.map((item) => `<option value="${esc(item.id)}">${esc(item.label || item.id)}（${esc(item.kind || '?')}）</option>`).join('')
    : '<option value="">（没有行为档案）</option>';
  if (!items.length) {
    document.getElementById('behaviorFormPanel').innerHTML = '<p class="meta">config/behaviors 下没有可用的行为档案。</p>';
    behaviorDoc = null;
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
  const description = behaviorDoc.data?.description ?? '';
  busy = true;
  setMsg('保存中…');
  try {
    const r = await api(`/api/config/behaviors/${encodeURIComponent(behaviorDoc.id)}`, 'PUT', {
      data: { version: 1, kind: behaviorDoc.kind, label, description, config },
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

export function init() {
  const listHost = document.querySelector('[data-behavior-fields="list"]');
  if (listHost) renderFields(listHost, BEHAVIOR_FIELDS.list.fields, { columns: 1 });
  const host = document.querySelector('[data-behavior-fields="main"]');
  if (host) renderFields(host, BEHAVIOR_FIELDS.main.fields, { columns: 1, layout: 'inline' });
  document.getElementById('behaviorFormSelect')?.addEventListener('change', (event) => {
    if (event.target.value) void loadDoc(event.target.value);
  });
  document.getElementById('behaviorFormRefresh')?.addEventListener('click', () => void refreshList());
  // 表格每轮重建，编辑按钮走宿主上的事件委托。
  document.querySelector('[data-behavior-fields="list"]')?.addEventListener('click', (event) => {
    const id = event.target.closest('[data-behavior-edit]')?.dataset.behaviorEdit;
    if (!id) return;
    const select = document.getElementById('behaviorFormSelect');
    if (select) select.value = id;
    void loadDoc(id);
  });
  document.getElementById('behaviorFormSave')?.addEventListener('click', () => void saveDoc());
  onPageRefresh('behavior', () => setTimeout(() => void refreshList(), 0));
  void refreshList();
}
