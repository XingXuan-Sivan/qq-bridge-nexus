// 行为档案页：三个标签 —— 运行方案（组合层）、行为档案（配置 + 提示词）、能力预设。
// 权威存储：profiles/platforms/qq/behaviors/<id>.yml、profiles/agent-platforms/dsh/capabilities/<id>.yml、
// profiles/plans/<id>.yml。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { onPageRefresh } from '../../js/router.js';
import { renderFields } from '../../components/form/form.js';
import { confirmBox } from '../../components/message-box/message-box.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { modalHtml, openModal, closeModal } from '../../components/modal/modal.js';
import { mountPromptCard } from '../../components/prompt-card/prompt-card.js';
import { cardHtml } from '../../components/card/card.js';
import { behaviorFields, fillBehaviorForm, readBehaviorForm } from './behavior-form.js';
import { BEHAVIOR_FIELDS } from './fields.js';
import { createCapabilityPanel } from '../../components/capability-panel/capability-panel.js';
import { init as initPlansPanel } from '../runtime/page.js';
import { initPlatformPanel } from '../../components/platform-panel/platform-panel.js';

let behaviorDoc = null;
let behaviorItems = [];
let busy = false;
let kindSpecs = new Map();
let kindMetas = new Map();
let kindsPromise = null;
let capabilityPanel = null;
let promptCard = null;
let plansReady = false;
let platformReady = false;

/** 字段规格由后端 kind 注册表下发，页面不再自带一份（避免两处漂移）。 */
async function ensureKinds() {
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

function fieldsOf(kind) {
  return kindSpecs.get(kind) ?? [];
}

function setMsg(text, tone = 'info', id = 'behaviorFormMsg') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || '';
  el.className = `meta ${tone === 'ok' ? 'ok' : tone === 'err' ? 'err' : ''}`.trim();
}

/** 平台 id 显示名：当前只有 QQ，其余按大写 id 兜底。 */
function platformLabel(id) {
  if (!id) return '—';
  return id === 'qq' ? 'QQ' : String(id).toUpperCase();
}

function renderBehaviorTable(items) {
  const host = document.getElementById('behaviorTable');
  if (!host) return;
  const rows = items.map((item) => ({
    attrs: { 'data-filter-kind': item.kind || '', 'data-filter-platform': item.platform || 'qq' },
    cells: [
      `<code>${esc(item.id)}</code><div class="meta">${esc(item.label || '')}</div>`,
      `<span class="tag">${esc(platformLabel(item.platform || kindMetas.get(item.kind)?.platform || 'qq'))}</span>`,
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
  host.innerHTML = dataTableHtml({
    columns: [{ label: '档案' }, { label: '平台', width: '80px' }, { label: '类型', width: '110px' }, { label: '被引用' }, { label: '操作', width: '190px' }],
    rows,
    pageSize: 10,
    search: { placeholder: '搜索档案 / 备注 / id' },
    refresh: true,
    filters: [{ id: 'kind', label: '类型', value: '', options: [{ value: '', label: '全部类型' }, ...kindOptions] }],
    actions: '<button class="btn small primary" type="button" id="behaviorCreate">新建</button>',
    empty: '还没有行为档案。',
  });
  initDataTables(host, { onRefresh: () => void refreshList() });
}

async function refreshList(preferred) {
  await ensureKinds();
  const list = await api('/api/config/behaviors');
  const items = Array.isArray(list?.behaviors) ? list.behaviors : [];
  behaviorItems = items;
  renderBehaviorTable(items);
  if (!items.length) {
    document.getElementById('behaviorFormPanel').innerHTML = '<p class="meta">profiles/platforms/qq/behaviors 下没有可用的行为档案。</p>';
    behaviorDoc = null;
    promptCard = null;
    document.getElementById('behaviorPromptCard').innerHTML = '';
    return;
  }
  const want = preferred || behaviorDoc?.id || items[0].id;
  await loadDoc(items.some((item) => item.id === want) ? want : items[0].id);
}

function mountBasics(doc) {
  const host = document.querySelector('[data-behavior-fields="basics"]');
  if (!host) return;
  renderFields(host, BEHAVIOR_FIELDS.basics.fields, { columns: 1, layout: 'inline' });
  const input = document.getElementById('behaviorFormLabel');
  if (input) {
    input.value = doc.data?.label ?? '';
    input.readOnly = Boolean(doc.builtin);
    input.closest('.field-row')?.classList.toggle('is-readonly', Boolean(doc.builtin));
  }
  const reset = document.getElementById('behaviorFormReset');
  if (reset) reset.hidden = !doc.builtin;
}

async function loadDoc(id) {
  const panel = document.getElementById('behaviorFormPanel');
  if (!panel || !id) return;
  setMsg('读取中…');
  try {
    const doc = await api(`/api/config/behaviors/${encodeURIComponent(id)}`);
    if (!doc?.ok) throw new Error(doc?.error || '读取失败');
    behaviorDoc = doc;
    mountBasics(doc);
    panel.innerHTML = '';
    renderFields(panel, behaviorFields(fieldsOf(doc.kind)), { columns: 2 });
    fillBehaviorForm(panel, fieldsOf(doc.kind), doc.data?.config ?? {});
    const host = document.getElementById('behaviorPromptCard');
    const factory = doc.factoryPrompt ?? doc.data?.prompt ?? '';
    if (!promptCard) {
      promptCard = mountPromptCard(host, {
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
  const panel = document.getElementById('behaviorFormPanel');
  if (!panel) return;
  const config = readBehaviorForm(panel, fieldsOf(behaviorDoc.kind));
  const label = behaviorDoc.builtin
    ? behaviorDoc.data?.label || behaviorDoc.id
    : String(document.getElementById('behaviorFormLabel')?.value ?? '').trim() || behaviorDoc.data?.label || behaviorDoc.id;
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
  const host = overlay.querySelector(`#${fieldsId}`);
  if (mode === 'delete') {
    renderFields(host, [{ name: 'behaviorArchiveId', type: 'static', label: '档案', value: source?.id ?? '' }], { columns: 1, layout: 'inline' });
  } else if (mode === 'clone') {
    renderFields(host, [
      { name: 'behaviorArchiveId', type: 'text', label: '新档案 id', placeholder: '小写字母、数字、连字符', value: `${source?.id ?? 'behavior'}-copy` },
      { name: 'behaviorArchiveLabel', type: 'text', label: '备注', value: `${source?.label ?? source?.id ?? ''}（副本）` },
    ], { columns: 1, layout: 'inline' });
  } else {
    // 平台固定 QQ（当前只有一个用户侧平台）；类型显示类型 yml 的 label，不暴露引擎名。
    const typeOptions = [...kindMetas.values()].map((meta) => ({ value: meta.kind, label: meta.label || meta.kind }));
    const templateOptions = [{ value: '', label: '空白（按类型默认值）' }, ...behaviorItems.map((item) => ({ value: item.id, label: `${item.label || item.id}（${item.id}）` }))];
    renderFields(host, [
      { name: 'behaviorArchiveId', type: 'text', label: '档案 id', placeholder: '小写字母、数字、连字符', hint: '创建后不可改名' },
      { name: 'behaviorArchivePlatform', type: 'select', label: '平台', options: [{ value: 'qq', label: 'QQ' }], value: 'qq' },
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

// ── 卡片外壳 ────────────────────────────────────────────────────────────────
// 九个卡片外壳全部由 components/card 的 cardHtml 生成；page.html 只剩四个标签面板与卡片宿主。
// 面板按顺序拆宿主：#behaviorFormPanel（档案字段组）夹在「基本信息」卡和「行为提示词」卡之间，
// #capabilityEditor 在「能力预设」卡之后，所以 behaviors / capabilities 各用两个宿主。
// 两张提示词卡没有标题和正文：它们只是 mountPromptCard() 的宿主（id 与 className 保持原样）。
const BEHAVIOR_CARDS = {
  behaviorPlatformCards: [
    {
      title: '平台',
      description: '用户侧适配层：行为档案、平台提示词与工具清单都在 <code>profiles/platforms/&lt;id&gt;/</code>。',
      body: '<div id="platformTable"></div>',
    },
    { id: 'platformPromptCard', className: 'prompt-card' },
    {
      title: '平台工具',
      description: '只读清单（<code>tools.yml</code>）；会话实际能用哪些由运行方案与会话权限级别决定。',
      body: '<div id="platformTools"></div>',
    },
  ],
  behaviorPlansCards: [
    {
      title: '运行方案',
      description: '会话可在「会话与审批 › 详情」单独指定；没指定的用「全局配置 › 默认运行方案」。',
      body: '<div data-runtime-fields="summary"></div>',
    },
    {
      title: '方案清单',
      description: '内置方案只读，复制后可改；自定义方案随能力预设一起管理。',
      body: '<div data-runtime-fields="table"></div>',
    },
  ],
  behaviorDocCards: [
    {
      title: '档案清单',
      description: '档案是资源，被运行方案的「行为」字段引用；改名不影响引用，删除前先确认没有被方案使用。',
      body: '<div data-behavior-fields="list"></div>',
    },
    {
      title: '基本信息',
      description: '写入 <code>profiles/platforms/qq/behaviors</code>，重启桥接后生效。',
      body: '<div class="form-stack" data-behavior-fields="basics"></div>'
        + '<div class="form-actions">'
        + '<button class="btn primary" type="button" id="behaviorFormSave">保存</button>'
        + '<button class="btn" type="button" id="behaviorFormReset" hidden>重置</button>'
        + '<span class="meta" id="behaviorFormMsg" role="status"></span>'
        + '</div>',
    },
  ],
  behaviorPromptCards: [
    { id: 'behaviorPromptCard', className: 'prompt-card' },
  ],
  behaviorCapabilityCards: [
    {
      title: '能力预设',
      description: '唯一源：<code>profiles/agent-platforms/dsh/capabilities/&lt;id&gt;.yml</code>；Agent 模块由 Agent 预设决定。',
      body: '<div id="capabilityTable"></div>',
    },
  ],
};

function renderCards() {
  for (const [hostId, cards] of Object.entries(BEHAVIOR_CARDS)) {
    const host = document.getElementById(hostId);
    if (!host) continue;
    host.innerHTML = cards.map((card) => cardHtml(card)).join('');
  }
}

export function init() {
  // 卡片外壳先长出来：下面 [data-behavior-fields]、#capabilityTable、#behaviorFormSave 等都在卡片里。
  renderCards();
  const listHost = document.querySelector('[data-behavior-fields="list"]');
  if (listHost) renderFields(listHost, BEHAVIOR_FIELDS.list.fields, { columns: 1 });

  document.querySelector('[data-behavior-fields="list"]')?.addEventListener('click', (event) => {
    const edit = event.target.closest('[data-behavior-edit]');
    if (edit) { void loadDoc(edit.dataset.behaviorEdit); return; }
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
  document.getElementById('behaviorFormReset')?.addEventListener('click', async () => {
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
  });
  // 动作按钮由 renderFields 生成、重建后失效，统一在 document 上委托。
  document.addEventListener('click', (event) => {
    const id = event.target.closest('[id]')?.id;
    if (id === 'behaviorCreate') { openArchiveModal({ mode: 'create' }); return; }
  });

  const capabilityHost = document.getElementById('capabilityTable');
  const capabilityEditorHost = document.getElementById('capabilityEditor');
  if (capabilityHost) capabilityPanel = createCapabilityPanel({ listHost: capabilityHost, editorHost: capabilityEditorHost });

  const tabs = [...document.querySelectorAll('[data-behavior-tab]')];
  const panels = [...document.querySelectorAll('[data-behavior-panel]')];
  // 记住停留的标签页：刷新/切走再回来都回到同一页，而不是永远弹回第一个。
  const TAB_KEY = 'qq-console:tab:behavior';
  const TAB_NAMES = ['platform', 'plans', 'behaviors', 'capabilities'];
  function readTab() {
    try {
      const saved = localStorage.getItem(TAB_KEY);
      return TAB_NAMES.includes(saved) ? saved : 'platform';
    } catch {
      return 'platform';
    }
  }
  function showTab(name, { persist = true } = {}) {
    const next = TAB_NAMES.includes(name) ? name : 'platform';
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
    if (next === 'platform' && !platformReady) {
      platformReady = true;
      try { initPlatformPanel(); } catch { platformReady = false; }
    }
    if (next === 'plans' && !plansReady) {
      plansReady = true;
      try { initPlansPanel(); } catch { plansReady = false; }
    }
  }
  for (const tab of tabs) tab.addEventListener('click', () => showTab(tab.dataset.behaviorTab));

  onPageRefresh('behavior', () => {
    setTimeout(() => void refreshList(), 0);
    showTab(readTab(), { persist: false });
  });
  showTab(readTab(), { persist: false });
  // 从「平台 › 编辑行为」跳过来：切到行为档案，并定位到该平台下选中的档案。
  document.addEventListener('qq:behavior-focus', () => {
    showTab('behaviors');
    if (!behaviorDoc) {
      const first = document.querySelector('[data-behavior-edit]');
      if (first) void loadDoc(first.dataset.behaviorEdit);
    }
  });
  void refreshList();
}
