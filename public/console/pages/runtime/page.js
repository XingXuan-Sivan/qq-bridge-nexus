// 运行方案页：读 /api/runtime/plans，展示当前指针与方案清单，切换走 /api/runtime/switch。
// 自定义方案（新建/克隆/编辑/删除）只在页内弹窗里改，内置方案只读——要改先克隆。
// 约定：表格只用 table 组件，字段只用 renderFields，页面不自拼工具栏与空态。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { renderFields } from '../../components/form/form.js';
import { modalHtml, openModal, wireModal } from '../../components/modal/modal.js';
import { onPageRefresh } from '../../js/router.js';
import { RUNTIME_FIELDS } from './fields.js';

const MODE_LABEL = { chat: '聊天模式', reserved: '一代仿真', reserved2: '二代仿真', 'closed-agent': '封闭 Agent' };
const BEHAVIOR_LABEL = { none: '不带行为', inherit: '跟随默认行为' };
const AUDIENCE_LABEL = { owner: '仅管理员', access: '按准入名单' };

let payload = null;
let presets = [];
let behaviors = [];

function el(id) {
  return document.getElementById(id);
}

function planById(id) {
  return (payload?.plans ?? []).find((plan) => plan.id === id) ?? null;
}

function behaviorLabel(value) {
  if (BEHAVIOR_LABEL[value]) return BEHAVIOR_LABEL[value];
  const found = behaviors.find((item) => item.id === value);
  return found?.label || value;
}

function summaryHtml() {
  if (!payload) return '<span class="meta">读取中…</span>';
  const plan = payload.activePlan ?? planById(payload.active);
  if (!plan) return '<span class="meta">还没有激活任何方案。</span>';
  const legacy = payload.legacy ?? {};
  return `
    <span class="pill g">${esc(plan.label)}</span>
    <span class="pill">能力预设 ${esc(plan.tools)}</span>
    <span class="pill">${esc(behaviorLabel(plan.behavior))}</span>
    <span class="pill">${esc(AUDIENCE_LABEL[plan.audience] ?? plan.audience)}</span>
    <span class="pill">旧模式 ${esc(MODE_LABEL[legacy.mode] ?? legacy.mode ?? '—')}${legacy.level && legacy.level !== 'L0' ? ` / ${esc(legacy.level)}` : ''}</span>
    <span class="pill">${payload.resetOnRestart ? '重启回到当前方案' : '重启不继承'}</span>`;
}

function fillPlanOptions() {
  const select = el('runtimePlan');
  if (!select) return;
  const active = payload?.active ?? '';
  select.innerHTML = (payload?.plans ?? []).map((plan) => {
    const suffix = plan.builtin ? '' : '（自定义）';
    return `<option value="${esc(plan.id)}">${esc(plan.label)}${suffix}</option>`;
  }).join('');
  if (active && planById(active)) select.value = active;
}

function rowHtml(plan) {
  return [
    `<code>${esc(plan.id)}</code><div class="meta">${esc(plan.label)}</div>`,
    `<span class="meta">${esc(plan.tools)}</span>`,
    `<span class="meta">${esc(behaviorLabel(plan.behavior))}</span>`,
    `<span class="meta">${esc(AUDIENCE_LABEL[plan.audience] ?? plan.audience)}</span>`,
    `<span class="pill">${plan.builtin ? '内置' : '自定义'}</span>`,
    `<span class="meta">${esc(plan.note || '')}</span>`,
    `<div class="row">
      <button class="btn small" type="button" data-plan-edit="${esc(plan.id)}">${plan.builtin ? '克隆' : '编辑'}</button>
      ${plan.builtin ? '' : `<button class="btn small danger" type="button" data-plan-del="${esc(plan.id)}">删除</button>`}
    </div>`,
  ];
}

function tableMarkup() {
  const plans = payload?.plans ?? [];
  if (!plans.length) return '<div class="meta">还没有可用的运行方案。</div>';
  return dataTableHtml({
    columns: [
      { label: '方案', width: '210' },
      { label: '能力预设', width: '170' },
      { label: '行为', width: '140' },
      { label: '受众', width: '110' },
      { label: '来源', width: '80' },
      { label: '说明' },
      { label: '操作', width: '130' },
    ],
    rows: plans.map(rowHtml),
    pageSize: 20,
    meta: `共 ${plans.length} 套方案`,
    empty: '没有匹配的方案。',
    actions: '<div class="row"><button class="btn small primary" type="button" id="runtimeNew">新建方案</button><button class="btn small" type="button" id="runtimeExport">导出 JSON</button><button class="btn small" type="button" id="runtimeImport">导入 JSON</button></div>',
  });
}

function renderTable() {
  const host = el('runtimeTable');
  if (!host) return;
  host.innerHTML = tableMarkup();
  initDataTables(host);
}

function renderSummary() {
  const host = el('runtimeSummary');
  if (host) host.innerHTML = summaryHtml();
}

async function load() {
  try {
    const [plans, presetList, behaviorList] = await Promise.allSettled([
      api('/api/runtime/plans'),
      api('/api/presets'),
      api('/api/config/behaviors'),
    ]);
    if (plans.status !== 'fulfilled') throw plans.reason;
    payload = plans.value;
    presets = presetList.status === 'fulfilled' ? (presetList.value?.presets ?? []) : [];
    behaviors = behaviorList.status === 'fulfilled' ? (behaviorList.value?.behaviors ?? []) : [];
    renderSummary();
    fillPlanOptions();
    renderTable();
  } catch (error) {
    const host = el('runtimeSummary');
    if (host) host.innerHTML = `<span class="meta err">读取失败：${esc(error?.message || '未知错误')}</span>`;
  }
}

async function switchPlan() {
  const msg = el('runtimeMsg');
  const planId = el('runtimePlan')?.value || '';
  const totp = el('runtimeTotp')?.value?.trim() || '';
  if (!planId) {
    if (msg) msg.textContent = '先选择一个方案';
    return;
  }
  if (msg) msg.textContent = '切换中…';
  try {
    const result = await api('/api/runtime/switch', 'POST', { planId, totp });
    if (msg) msg.textContent = `已切到「${result?.plan?.label ?? planId}」`;
    showConsoleToast('运行方案已切换');
    const totpInput = el('runtimeTotp');
    if (totpInput) totpInput.value = '';
    await load();
  } catch (error) {
    if (msg) msg.textContent = `切换失败：${error?.message || '未知错误'}`;
  }
}

// ── 方案编辑器（新建 / 克隆 / 编辑） ─────────────────────────────────────────
function editorFields(plan) {
  const behaviorOptions = [
    { value: 'none', label: '不带行为（纯工具/对话）' },
    { value: 'inherit', label: '跟随默认行为' },
    ...behaviors.filter((item) => item.id !== 'none' && item.id !== 'inherit')
      .map((item) => ({ value: item.id, label: `${item.label || item.id}（${item.kind || '行为'}）` })),
  ];
  return [
    {
      name: 'runtimeEditId', type: 'text', label: '方案 id', value: plan?.id || '',
      placeholder: '小写字母、数字与连字符', maxlength: 40,
      hint: '创建后不可改名；内置方案要改先克隆。',
    },
    { name: 'runtimeEditLabel', type: 'text', label: '名称', value: plan?.label || '', maxlength: 40 },
    {
      name: 'runtimeEditTools', type: 'select', label: '能力预设', value: plan?.tools || '',
      options: presets.map((item) => ({ value: item.id, label: `${item.id}${item.trust === 'user' ? '（用户）' : ''}` })),
      hint: '能力预设决定工具授权与沙箱；在「能力预设」页维护。',
    },
    {
      name: 'runtimeEditBehavior', type: 'select', label: '行为档案', value: plan?.behavior || 'none',
      options: behaviorOptions,
      hint: '行为档案描述「在 QQ 里怎么说话、怎么等」；在「行为档案」页维护。',
    },
    {
      name: 'runtimeEditAudience', type: 'select', label: '受众', value: plan?.audience || 'access',
      options: [
        { value: 'access', label: '按准入名单（群/私聊白名单）' },
        { value: 'owner', label: '仅管理员私聊' },
      ],
    },
    { name: 'runtimeEditNote', type: 'text', label: '说明', value: plan?.note || '', maxlength: 200 },
  ];
}

function openEditor(plan, { clone = false } = {}) {
  const source = plan ? { ...plan } : null;
  if (clone && source) {
    source.id = `${source.id}-copy`;
    source.label = `${source.label}（副本）`;
  }
  const existing = el('runtimePlanEditor');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml({
    id: 'runtimePlanEditor',
    title: clone ? '克隆运行方案' : plan ? '编辑运行方案' : '新建运行方案',
    wide: true,
    body: '<div class="form-stack" id="runtimeEditFields"></div><p class="meta" id="runtimeEditMsg" role="status"></p>',
    footer: '<button class="btn" type="button" data-modal-close>取消</button><button class="btn primary" type="button" id="runtimeEditSave">保存</button>',
  }));
  const overlay = el('runtimePlanEditor');
  renderFields(overlay.querySelector('#runtimeEditFields'), editorFields(source), { layout: 'inline', columns: 1 });
  wireModal(overlay, { onClose: () => overlay.remove() });
  overlay.querySelector('#runtimeEditSave').addEventListener('click', () => void savePlan());
  openModal(overlay);
}

function setEditorMsg(text) {
  const msg = el('runtimeEditMsg');
  if (msg) msg.textContent = text;
}

async function savePlan() {
  const body = {
    id: el('runtimeEditId')?.value.trim() ?? '',
    label: el('runtimeEditLabel')?.value.trim() ?? '',
    tools: el('runtimeEditTools')?.value ?? '',
    behavior: el('runtimeEditBehavior')?.value ?? 'none',
    audience: el('runtimeEditAudience')?.value ?? 'access',
    note: el('runtimeEditNote')?.value ?? '',
  };
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(body.id)) {
    setEditorMsg('方案 id 只能用小写字母、数字与连字符，且以字母开头（2–40 字符）');
    return;
  }
  if (!body.tools) {
    setEditorMsg('先选一套能力预设');
    return;
  }
  setEditorMsg('保存中…');
  try {
    await api('/api/runtime/plans', 'POST', body);
    el('runtimePlanEditor')?.remove();
    showConsoleToast('运行方案已保存');
    await load();
  } catch (error) {
    setEditorMsg(`保存失败：${error?.message || '未知错误'}`);
  }
}

async function deletePlan(planId) {
  if (!planId) return;
  if (!confirm(`删除运行方案「${planId}」？正在使用的方案需要先切走。`)) return;
  try {
    await api(`/api/runtime/plans/${encodeURIComponent(planId)}`, 'DELETE');
    showConsoleToast('运行方案已删除');
    await load();
  } catch (error) {
    alert(error?.message || '删除失败');
  }
}

function jsonModal({ id, title, value, readonly, confirmLabel, onConfirm }) {
  const existing = el(id);
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml({
    id,
    title,
    wide: true,
    body: `<div class="form-stack"><label class="field-row"><span class="field-label">方案 JSON</span><div class="field-control"><textarea class="code-area" id="${id}Text" rows="16" spellcheck="false"${readonly ? ' readonly' : ''}></textarea><div class="field-hint">数组，元素字段：id / label / note / tools / behavior / audience。内置方案也会导出，但导入时只能作为自定义方案的同 id 覆盖名称与说明。</div></div></label></div><p class="meta" id="${id}Msg" role="status"></p>`,
    footer: `<button class="btn" type="button" data-modal-close>关闭</button><button class="btn primary" type="button" id="${id}Go">${confirmLabel}</button>`,
  }));
  const overlay = el(id);
  const text = overlay.querySelector(`#${id}Text`);
  text.value = value ?? '';
  wireModal(overlay, { onClose: () => overlay.remove() });
  overlay.querySelector(`#${id}Go`).addEventListener('click', () => void onConfirm(overlay, text));
  openModal(overlay);
}

function exportPlans() {
  const plans = (payload?.plans ?? []).map((plan) => ({
    id: plan.id, label: plan.label, note: plan.note, tools: plan.tools, behavior: plan.behavior, audience: plan.audience,
  }));
  jsonModal({
    id: 'runtimeExportModal',
    title: '导出运行方案',
    value: JSON.stringify(plans, null, 2),
    readonly: true,
    confirmLabel: '复制到剪贴板',
    onConfirm: async (overlay, text) => {
      const msg = overlay.querySelector('#runtimeExportModalMsg');
      try {
        await navigator.clipboard.writeText(text.value);
        if (msg) msg.textContent = '已复制';
      } catch {
        text.select();
        if (msg) msg.textContent = '已全选，按 Ctrl+C 复制（浏览器不允许直接写剪贴板）';
      }
    },
  });
}

function importPlans() {
  jsonModal({
    id: 'runtimeImportModal',
    title: '导入运行方案',
    value: '',
    readonly: false,
    confirmLabel: '导入',
    onConfirm: async (overlay, text) => {
      const msg = overlay.querySelector('#runtimeImportModalMsg');
      let list;
      try {
        list = JSON.parse(text.value);
      } catch {
        if (msg) msg.textContent = '不是合法的 JSON';
        return;
      }
      if (!Array.isArray(list) || !list.length) {
        if (msg) msg.textContent = '需要一个非空数组';
        return;
      }
      if (msg) msg.textContent = `导入 ${list.length} 套…`;
      let done = 0;
      const failed = [];
      for (const item of list) {
        try {
          await api('/api/runtime/plans', 'POST', item);
          done += 1;
        } catch (error) {
          failed.push(`${item?.id ?? '?'}：${error?.message || '失败'}`);
        }
      }
      if (msg) msg.textContent = `已导入 ${done} 套${failed.length ? `；失败：${failed.join('；')}` : ''}`;
      await load();
      if (!failed.length) overlay.remove();
    },
  });
}

function hostFor(name) {
  return document.querySelector(`[data-runtime-fields="${name}"]`);
}

export function init() {
  renderFields(hostFor('summary'), RUNTIME_FIELDS.summary.fields, { columns: 2 });
  renderFields(hostFor('switch'), RUNTIME_FIELDS.switch.fields, { columns: 2 });
  renderFields(hostFor('table'), RUNTIME_FIELDS.table.fields, { columns: 2 });
  const btn = el('runtimeSwitch');
  if (btn) btn.addEventListener('click', () => { void switchPlan(); });
  const host = hostFor('table');
  if (host) {
    host.addEventListener('click', (event) => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.id === 'runtimeNew') { openEditor(null); return; }
      if (target.id === 'runtimeExport') { exportPlans(); return; }
      if (target.id === 'runtimeImport') { importPlans(); return; }
      const editId = target.dataset.planEdit;
      if (editId) {
        const plan = planById(editId);
        if (plan) openEditor(plan, { clone: plan.builtin });
        return;
      }
      const delId = target.dataset.planDel;
      if (delId) void deletePlan(delId);
    });
  }
  onPageRefresh('runtime', () => { void load(); });
  void load();
}
