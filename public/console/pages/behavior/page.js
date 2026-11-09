// 行为档案页：选择 + 按 schema 表单编辑 v1/v2。
// 权威存储是 config/behaviors/<id>.yml；后端 GET 返回结构化 data，PUT 收 {data}。
import { api } from '../../js/api.js';
import { esc } from '../../js/ui.js';
import { onPageRefresh } from '../../js/router.js';
import { renderFields } from '../../components/form/form.js';
import { behaviorFields, fillBehaviorForm, readBehaviorForm } from '../presets/behavior-form.js';

let behaviorDoc = null;
let busy = false;

function setMsg(text, tone = 'info') {
  const el = document.getElementById('behaviorFormMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = `meta ${tone === 'ok' ? 'ok' : tone === 'err' ? 'err' : ''}`.trim();
}

async function refreshList(preferred) {
  const select = document.getElementById('behaviorFormSelect');
  if (!select) return;
  const list = await api('/api/config/behaviors');
  const items = Array.isArray(list?.behaviors) ? list.behaviors : [];
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
    renderFields(panel, behaviorFields(doc.kind), { columns: 2 });
    fillBehaviorForm(panel, doc.kind, doc.data?.config ?? {});
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
  const config = readBehaviorForm(panel, behaviorDoc.kind);
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
  document.getElementById('behaviorFormSelect')?.addEventListener('change', (event) => {
    if (event.target.value) void loadDoc(event.target.value);
  });
  document.getElementById('behaviorFormRefresh')?.addEventListener('click', () => void refreshList());
  document.getElementById('behaviorFormSave')?.addEventListener('click', () => void saveDoc());
  onPageRefresh('behavior', () => setTimeout(() => void refreshList(), 0));
  void refreshList();
}
