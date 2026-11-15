// 方案页：一次组合，决定一段对话怎么跑。
//
// 方案 = 能力档 + 行为档案 + 受众 +（可选）执行体。方案**不绑用户平台**：平台话术与行为档案
// 天然按平台走，方案只引用它们的 id。全局默认方案在「全局配置」里，会话可以在「会话与审批 ›
// 详情」里单独指定；本页只管方案本身，不切换全局指针（全局只留「默认方案」一个指针）。
//
// 内置方案只读，要改先克隆；自定义方案的增删改都在页内弹窗里（字段用 renderFields，
// 表格用表格组件，卡片用 cardHtml）。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { cardHtml } from '../../components/card/card.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { renderFields } from '../../components/form/form.js';
import { modalHtml, openModal, wireModal } from '../../components/modal/modal.js';
import { alertBox, confirmBox } from '../../components/message-box/message-box.js';
import { onPageRefresh, setConsolePage } from '../../js/router.js';
import { loadPlatforms, registryMeta } from '../../js/registry.js';
import { focusPlatform } from '../platforms/page.js';

let payload = null;
let presets = []; // 能力档（= /api/runtime/capabilities 的 capabilities）
let behaviors = []; // 行为档案（= /api/config/behaviors 的 behaviors）

function el(id) {
  return document.getElementById(id);
}

function planById(id) {
  return (payload?.plans ?? []).find((plan) => plan.id === id) ?? null;
}

// ── 执行体口径 ──────────────────────────────────────────────────────────────
// 执行体（Agent 平台）决定「能力档从哪来」。只有真的声明了能力档的平台才能进下拉：
// plan.capability 必须是它的档，否则保存时后端会以「能力档不存在」拒掉。这不是白名单，
// 是数据约束——平台接上 capabilities/ 目录后自动出现在下拉里。
// 默认 auto：跟随全局 platforms.active.agent，换执行体时不会被方案拉回旧平台。
function planAgentPlatforms() {
  return (registryMeta().platforms ?? [])
    .filter((item) => item.side === 'agent' && (item.assets?.capabilityProfiles ?? []).length > 0);
}

function platformNameOf(side, id) {
  const list = (registryMeta().platforms ?? []).filter((item) => item.side === side);
  const found = list.find((item) => item.id === id);
  return found?.label || id || '未注册';
}

/** `auto` 是方案的常态：显示实际跟随的执行体，不假装它是某一侧。 */
function agentPlatformText(plan) {
  if (!plan?.agentPlatform || plan.agentPlatform === 'auto') return `跟随全局（${platformNameFor('agent')}）`;
  return platformNameOf('agent', plan.agentPlatform);
}

const BEHAVIOR_LABEL = { none: '不带行为', inherit: '跟随默认行为' };
const AUDIENCE_LABEL = { owner: '仅管理员', access: '按准入名单' };
// 生效方式与权限权威都取自能力档的 `runtime` 段：方案只是引用能力档，不另存一份。
const APPLY_LABEL = { preset: '装预设', passthrough: '直通（不装预设）' };
const AUTHORITY_LABEL = { bridge: '桥接钉档', agent: '执行体自身' };

function capabilityOf(id) {
  return presets.find((item) => item.id === id) ?? null;
}

function applyOf(plan) {
  const cap = capabilityOf(plan?.capability);
  return cap ? (cap.runtime?.apply ?? 'preset') : '';
}

function authorityOf(plan) {
  const cap = capabilityOf(plan?.capability);
  return cap ? (cap.runtime?.permission ?? 'bridge') : '';
}

/** 声明了这套能力档的执行体（能力档是 Agent 平台的资产，改它要去那一侧）。 */
function capabilityPlatformId(capabilityId) {
  if (!capabilityId) return '';
  const owners = planAgentPlatforms()
    .filter((item) => (item.assets?.capabilityProfiles ?? []).includes(capabilityId));
  return owners[0]?.id || registryMeta().active?.agent || '';
}

function behaviorLabel(value) {
  if (BEHAVIOR_LABEL[value]) return BEHAVIOR_LABEL[value];
  const found = behaviors.find((item) => item.id === value);
  return found?.label || value;
}

function platformNameFor(side) {
  const active = registryMeta().active?.[side] ?? '';
  return platformNameOf(side, active) || '未注册';
}

// ── 渲染 ────────────────────────────────────────────────────────────────────
function summaryHtml() {
  if (!payload) return '<span class="meta">读取中…</span>';
  const plan = payload.activePlan ?? planById(payload.active);
  if (!plan) return '<span class="meta">还没有激活任何方案。</span>';
  return `
    <span class="tag tag--success">${esc(plan.label)}</span>
    <span class="tag">能力档 ${esc(plan.capability || '—')}</span>
    <span class="tag">${esc(behaviorLabel(plan.behavior))}</span>
    <span class="tag">${esc(AUDIENCE_LABEL[plan.audience] ?? plan.audience)}</span>
    <span class="tag">平台 ${esc(platformNameFor('user'))}</span>
    <span class="tag">Agent ${esc(platformNameFor('agent'))}</span>
    <span class="tag">${payload.resetOnRestart ? '重启沿用默认方案' : '重启不继承'}</span>`;
}

function rowHtml(plan) {
  const apply = applyOf(plan);
  const authority = authorityOf(plan);
  return [
    `<code>${esc(plan.id)}</code><div class="meta">${esc(plan.label)}</div>`,
    `<span class="meta">${esc(agentPlatformText(plan))}</span>`,
    `<span class="meta">${esc(plan.capability || '')}</span>`,
    // 直通不装预设、也不做工具级限制：这一行要能一眼看出它和「装预设」的方案不是一回事。
    apply === 'passthrough'
      ? '<span class="tag tag--primary">直通</span><div class="meta">不做工具级限制</div>'
      : apply === 'preset'
        ? '<span class="tag">装预设</span>'
        : '<span class="meta">—</span>',
    authority === 'agent'
      ? '<span class="tag tag--warning">执行体自身</span>'
      : authority === 'bridge'
        ? '<span class="tag">桥接钉档</span>'
        : '<span class="meta">—</span>',
    `<span class="meta">${esc(behaviorLabel(plan.behavior))}</span>`,
    `<span class="meta">${esc(AUDIENCE_LABEL[plan.audience] ?? plan.audience)}</span>`,
    `<span class="tag">${plan.builtin ? '内置' : '自定义'}</span>`,
    `<span class="meta">${esc(plan.note || '')}</span>`,
    `<div class="row">
      <button class="btn small" type="button" data-plan-edit="${esc(plan.id)}">${plan.builtin ? '克隆' : '编辑'}</button>
      ${plan.builtin ? '' : `<button class="btn small danger" type="button" data-plan-del="${esc(plan.id)}">删除</button>`}
    </div>`,
  ];
}

function tableCardHtml() {
  const plans = payload?.plans ?? [];
  const body = plans.length
    ? dataTableHtml({
      columns: [
        { label: '方案', width: '190' },
        { label: '执行体', width: '170' },
        { label: '能力档', width: '130' },
        { label: '应用方式', width: '130' },
        { label: '权限权威', width: '120' },
        { label: '行为', width: '120' },
        { label: '受众', width: '100' },
        { label: '来源', width: '80' },
        { label: '说明' },
        { label: '操作', width: '130' },
      ],
      rows: plans.map(rowHtml),
      pageSize: 20,
      meta: `共 ${plans.length} 套方案`,
      empty: '没有匹配的方案。',
    })
    : '<p class="meta">还没有可用的运行方案。</p>';
  return cardHtml({
    id: 'planCard',
    title: '方案清单',
    description: '方案把两侧平台、能力档与行为档案组合成一种运行方式；内置方案只读，要改先克隆。',
    actions: '<div class="row"><button class="btn small primary" type="button" id="planNew">新建方案</button><button class="btn small" type="button" id="planExport">导出 JSON</button><button class="btn small" type="button" id="planImport">导入 JSON</button></div>',
    body,
  });
}

function render() {
  const host = el('planHost');
  if (!host) return;
  host.innerHTML = cardHtml({
    id: 'planSummaryCard',
    title: '当前方案',
    description: '会话实际在跑的组合；全局默认方案在「全局配置」，会话可在「会话与审批」里单独指定。',
    body: `<div class="row" id="planSummary">${summaryHtml()}</div>`,
  }) + tableCardHtml();
  initDataTables(host);
}

// ── 方案编辑器（新建 / 克隆 / 编辑） ─────────────────────────────────────────
/** 能力档的生效方式与权限权威：只读展示，要改得去能力档本体（它不属于方案）。 */
function runtimeSummaryHtml(capabilityId) {
  const cap = capabilityOf(capabilityId);
  if (!cap) {
    return '<span class="meta">这套能力档不在目录里：应用方式与权限权威都读不出来。</span>';
  }
  const apply = cap.runtime?.apply ?? 'preset';
  const authority = cap.runtime?.permission ?? 'bridge';
  const passthrough = apply === 'passthrough';
  return `<div class="row">
      <span class="tag${passthrough ? ' tag--primary' : ''}">应用方式 ${esc(APPLY_LABEL[apply] ?? apply)}</span>
      <span class="tag${authority === 'agent' ? ' tag--warning' : ''}">权限权威 ${esc(AUTHORITY_LABEL[authority] ?? authority)}</span>
      <button class="btn small" type="button" data-plan-cap-jump>改能力档</button>
    </div>
    <div class="meta">${passthrough
    ? '直通：不装预设、使用宿主环境（不做工具级限制），权限档由执行体自身管理。'
    : '装预设：能力档的插件行会渲染进 Agent 预设，权限档由桥接钉住并自动改回。'}
      两者都只读展示——改它们等于改能力档，不能在方案里各说各话。</div>`;
}

function editorFields(plan) {
  const agents = planAgentPlatforms();
  const behaviorOptions = [
    { value: 'none', label: '不带行为（纯工具/对话）' },
    ...behaviors.filter((item) => item.id !== 'none' && item.id !== 'inherit')
      .map((item) => ({
        value: item.id,
        label: `${item.label || item.id}（${item.platform || '未知平台'} · ${item.kind || '行为'}）`,
      })),
  ];
  return [
    {
      name: 'planEditId', type: 'text', label: '方案 id', value: plan?.id || '',
      placeholder: '小写字母、数字与连字符', maxlength: 40,
      hint: '创建后不可改名；内置方案要改先克隆。',
    },
    { name: 'planEditLabel', type: 'text', label: '名称', value: plan?.label || '', maxlength: 40 },
    {
      name: 'planEditAgentPlatform', type: 'select', label: '执行体',
      value: plan?.agentPlatform || 'auto',
      options: [
        { value: 'auto', label: `跟随全局（${platformNameFor('agent')}）` },
        ...agents.map((item) => ({
          value: item.id,
          label: `${item.label || item.id}（${(item.assets?.capabilityProfiles ?? []).length} 套能力档）`,
        })),
      ],
      hint: agents.length
        ? '默认跟随全局 platforms.active.agent；只有「这个方案必须跑在某个执行体上」时才钉具体 id（钉住后换全局执行体不会带走它）。'
        : '还没有 Agent 平台声明能力档：先在 profiles/agent-platforms/<id>/capabilities 下放能力档。',
    },
    {
      name: 'planEditTools', type: 'select', label: '能力档', value: plan?.capability || '',
      options: presets.map((item) => ({ value: item.id, label: `${item.id} · ${item.label || item.id}` })),
      hint: '能力档决定拿到哪些工具（正文与工具面在「平台 › 能力」里维护）；会话权限级别再决定实际能用哪些。'
        + '选定的是直通档时，方案只引用，不限制工具。',
    },
    // 应用方式 / 权限权威跟着上面那套能力档走：只读展示 + 跳转到能力档本体。
    {
      name: 'planRuntimeSummary', type: 'custom', label: '生效方式', span: 2,
      html: `<div id="planRuntimeSummary">${runtimeSummaryHtml(plan?.capability || presets[0]?.id || '')}</div>`,
    },
    {
      name: 'planEditBehavior', type: 'select', label: '行为档案', value: plan?.behavior || 'none',
      options: behaviorOptions,
      hint: '行为档案描述「在会话里怎么说话、怎么等」；在「平台 › 行为」里维护。',
    },
    {
      name: 'planEditAudience', type: 'select', label: '受众', value: plan?.audience || 'access',
      options: [
        { value: 'access', label: '按准入名单（群/私聊白名单）' },
        { value: 'owner', label: '仅管理员私聊' },
      ],
    },
    { name: 'planEditNote', type: 'text', label: '说明', value: plan?.note || '', maxlength: 200 },
  ];
}

function openEditor(plan, { clone = false } = {}) {
  const source = plan ? { ...plan } : null;
  if (clone && source) {
    source.id = `${source.id}-copy`;
    source.label = `${source.label}（副本）`;
  }
  const existing = el('planEditor');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml({
    id: 'planEditor',
    title: clone ? '克隆运行方案' : plan ? '编辑运行方案' : '新建运行方案',
    wide: true,
    body: '<div class="form-stack" id="planEditFields"></div><p class="meta" id="planEditMsg" role="status"></p>',
    footer: '<button class="btn" type="button" data-modal-close>取消</button><button class="btn primary" type="button" id="planEditSave">保存</button>',
  }));
  const overlay = el('planEditor');
  renderFields(overlay.querySelector('#planEditFields'), editorFields(source), { layout: 'inline', columns: 1 });
  // 换能力档就重画只读块：应用方式与权限权威随之变，但不往保存体里加字段。
  overlay.querySelector('#planEditTools')?.addEventListener('change', (event) => {
    const host = overlay.querySelector('#planRuntimeSummary');
    if (host) host.innerHTML = runtimeSummaryHtml(event.target.value);
  });
  overlay.querySelector('#planEditFields')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-plan-cap-jump]')) void jumpToCapability();
  });
  wireModal(overlay, { onClose: () => overlay.remove() });
  overlay.querySelector('#planEditSave').addEventListener('click', () => void savePlan());
  openModal(overlay);
}

function setEditorMsg(text) {
  const msg = el('planEditMsg');
  if (msg) msg.textContent = text;
}

/** 「改能力档」：应用方式与权限权威住在能力档里，跳过去改，不在方案里开第二个写口。 */
async function jumpToCapability() {
  const capabilityId = el('planEditTools')?.value || '';
  const platformId = capabilityPlatformId(capabilityId);
  if (!capabilityId || !platformId) {
    setEditorMsg('还没有 Agent 平台声明这套能力档，先去「平台」里接上一个执行体。');
    return;
  }
  if (!(await confirmBox({
    title: '去改能力档',
    message: `应用方式与权限权威由能力档 ${capabilityId} 决定，得在「平台 › 能力」里改。当前编辑器里没保存的内容会丢掉。`,
    confirmText: '去改',
  }))) return;
  el('planEditor')?.remove();
  // 先把目标平台与标签摆好，再切页：平台页首次注入时靠这两个参数直接落到「能力」。
  focusPlatform(`agent:${platformId}`, { tab: 'capabilities' });
  setConsolePage('platforms', { updateHash: true });
}

async function savePlan() {
  const body = {
    id: el('planEditId')?.value.trim() ?? '',
    label: el('planEditLabel')?.value.trim() ?? '',
    agentPlatform: el('planEditAgentPlatform')?.value || 'auto',
    capability: el('planEditTools')?.value ?? '',
    behavior: el('planEditBehavior')?.value ?? 'none',
    audience: el('planEditAudience')?.value ?? 'access',
    note: el('planEditNote')?.value ?? '',
  };
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(body.id)) {
    setEditorMsg('方案 id 只能用小写字母、数字与连字符，且以字母开头（2–40 字符）');
    return;
  }
  if (!body.capability) {
    setEditorMsg('先选一套能力档');
    return;
  }
  setEditorMsg('保存中…');
  try {
    await api('/api/plans', 'POST', body);
    el('planEditor')?.remove();
    showConsoleToast('运行方案已保存');
    await load();
  } catch (error) {
    setEditorMsg(`保存失败：${error?.message || '未知错误'}`);
  }
}

async function deletePlan(planId) {
  if (!planId) return;
  if (!(await confirmBox({
    title: '删除运行方案',
    message: `删除运行方案「${planId}」？正在使用的方案需要先切走。`,
    confirmText: '删除',
    danger: true,
  }))) return;
  try {
    await api(`/api/plans/${encodeURIComponent(planId)}`, 'DELETE');
    showConsoleToast('运行方案已删除');
    await load();
  } catch (error) {
    await alertBox({ message: error?.message || '删除失败', type: 'danger' });
  }
}

// ── 导入 / 导出 ────────────────────────────────────────────────────────────
function jsonModal({ id, title, value, readonly, confirmLabel, onConfirm }) {
  el(id)?.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml({
    id,
    title,
    wide: true,
    body: `<div class="form-stack"><label class="field-row"><span class="field-label">方案 JSON</span><div class="field-control"><textarea class="code-area" id="${id}Text" rows="16" spellcheck="false"${readonly ? ' readonly' : ''}></textarea><div class="field-hint">数组，元素字段：id / label / note / agentPlatform / capability / behavior / audience。内置方案也会导出，但导入时只能作为自定义方案的同 id 覆盖名称与说明。</div></div></label></div><p class="meta" id="${id}Msg" role="status"></p>`,
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
    id: plan.id,
    label: plan.label,
    note: plan.note,
    agentPlatform: plan.agentPlatform,
    capability: plan.capability,
    behavior: plan.behavior,
    audience: plan.audience,
  }));
  jsonModal({
    id: 'planExportModal',
    title: '导出运行方案',
    value: JSON.stringify(plans, null, 2),
    readonly: true,
    confirmLabel: '复制到剪贴板',
    onConfirm: async (overlay, text) => {
      const msg = overlay.querySelector('#planExportModalMsg');
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
    id: 'planImportModal',
    title: '导入运行方案',
    value: '',
    readonly: false,
    confirmLabel: '导入',
    onConfirm: async (overlay, text) => {
      const msg = overlay.querySelector('#planImportModalMsg');
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
          await api('/api/plans', 'POST', item);
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

// ── 数据 ────────────────────────────────────────────────────────────────────
async function load() {
  try {
    // 注册表是同步查询的（app.js 启动时预热），这里 force 一次拿最新装配结果：
    // Agent 平台的能力档数量决定编辑器里有哪些选项。
    await loadPlatforms({ force: true });
    const [plans, caps, behs] = await Promise.allSettled([
      api('/api/plans'),
      api('/api/runtime/capabilities'),
      api('/api/config/behaviors'),
    ]);
    if (plans.status !== 'fulfilled') throw plans.reason;
    payload = plans.value;
    presets = caps.status === 'fulfilled' ? (caps.value?.capabilities ?? []) : [];
    behaviors = behs.status === 'fulfilled' ? (behs.value?.behaviors ?? []) : [];
    render();
  } catch (error) {
    const host = el('planHost');
    if (host) host.innerHTML = `<div class="card span-all"><p class="meta err">读取失败：${esc(error?.message || '未知错误')}</p></div>`;
  }
}

export function init() {
  const host = el('planHost');
  if (!host) return;
  // 委托挂在宿主上：卡片每次刷新都重建，监听只绑一次。
  host.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('button');
    if (!button) return;
    if (button.id === 'planNew') { openEditor(null); return; }
    if (button.id === 'planExport') { exportPlans(); return; }
    if (button.id === 'planImport') { importPlans(); return; }
    const editId = button.dataset.planEdit;
    if (editId) {
      const plan = planById(editId);
      if (plan) openEditor(plan, { clone: plan.builtin });
      return;
    }
    const delId = button.dataset.planDel;
    if (delId) void deletePlan(delId);
  });
  onPageRefresh('plans', () => void load());
  void load();
}
