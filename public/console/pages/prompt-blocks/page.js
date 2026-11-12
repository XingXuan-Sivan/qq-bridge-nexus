// 注入块页：读注入块注册表（/api/prompt-blocks），改开关/上限/预算，按会话预览渲染结果。
//
// 约定：表格只用 table 组件产出，字段只用 renderFields；页面不自拼工具栏、分页与空态。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { dataTableHtml, initDataTables, tableHtml } from '../../components/table/table.js';
import { bindSwitches, getSwitch, renderFields } from '../../components/form/form.js';
import { onPageRefresh } from '../../js/router.js';
import { cardHtml } from '../../components/card/card.js';
import { PROMPT_BLOCK_FIELDS } from './fields.js';

const SLOT_LABEL = {
  head: '前置通知',
  identity: '角色与身份',
  behavior: '行为约束',
  resources: '资源',
  situation: '此刻情境',
  action: '行动',
  tail: '尾巴',
  core: '未分槽',
};

const TIMING_LABEL = {
  'every-wake': '每次唤醒',
  reason: '按原因',
  'on-event': '事件后',
  'on-change': '变化时',
};

const STATUS_LABEL = {
  injected: ['正常', 'tag tag--success'],
  truncated: ['截断', 'tag tag--danger'],
  budget: ['超预算跳过', 'tag tag--danger'],
  error: ['失败', 'tag tag--danger'],
  off: ['已关闭', 'tag'],
  empty: ['空', 'tag'],
  idle: ['未调用', 'tag'],
};

const PROFILE_LABEL = { wake: '唤醒', reminder: '收尾提醒', context: '前置上下文' };

let payload = null;
let sessions = [];

function el(id) {
  return document.getElementById(id);
}

function slotLabel(slot) {
  return SLOT_LABEL[slot] || slot || '未分槽';
}

function summaryHtml() {
  const blocks = Array.isArray(payload?.blocks) ? payload.blocks : [];
  const enabled = blocks.filter((block) => block.enabled).length;
  const limits = payload?.limits ?? {};
  const perProfile = (payload?.profiles ?? []).map((profile) => {
    const count = blocks.filter((block) => (block.profiles ?? ['wake']).includes(profile)).length;
    return `<span class="tag">${esc(PROFILE_LABEL[profile] || profile)} ${count} 块</span>`;
  }).join('');
  const budget = Number(limits.total) > 0 ? `${Number(limits.total)} 字` : '不限';
  const blockBudget = Number(limits.perBlockDefault) > 0 ? `${Number(limits.perBlockDefault)} 字` : '不限';
  const stats = payload?.stats ?? {};
  return `${perProfile}
    <span class="tag">启用 ${enabled}/${blocks.length}</span>
    <span class="tag">总预算 ${esc(budget)}</span>
    <span class="tag">单块默认 ${esc(blockBudget)}</span>
    <span class="tag">人格卡注入上限 ${Number(limits.roleInjectMaxChars) || 0} 字</span>
    <span class="tag">渲染 ${Number(stats.renders) || 0} 次 · 注入 ${Number(stats.injected) || 0} 次 · 跳过 ${Number(stats.skipped) || 0} 块</span>`;
}

function rowHtml(block) {
  const [label, cls] = STATUS_LABEL[block.lastStatus] || [block.lastStatus || '未调用', 'tag'];
  const owner = block.owner || (block.pluginId === 'core' ? 'core' : `plugin:${block.pluginId}`);
  const when = block.lastRunAt ? new Date(block.lastRunAt).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
  const chars = block.lastRunAt ? (block.maxChars ? `${Number(block.lastChars) || 0} / ${block.maxChars}` : `${Number(block.lastChars) || 0}`) : '—';
  const detail = [block.lastError ? `错误：${block.lastError}` : '', Number(block.calls) ? `调用 ${Number(block.calls)} 次` : ''].filter(Boolean).join('\n');
  const reasons = Array.isArray(block.reasons) ? block.reasons : [];
  const timing = block.timing === 'reason' && reasons.length
    ? `按原因 · ${reasons.slice(0, 2).join(' / ')}${reasons.length > 2 ? ` 等 ${reasons.length} 个` : ''}`
    : (TIMING_LABEL[block.timing] || block.timing || '每次唤醒');
  const profiles = (block.profiles ?? ['wake']).map((profile) => `<span class="tag">${esc(PROFILE_LABEL[profile] || profile)}</span>`).join('');
  const title = detail ? ` title="${esc(detail)}"` : '';
  // 人格卡这类「不经过注册表」的虚拟块没有真正的开关键：人格卡始终注入，只让它配上限。
  const enabledCell = block.synthetic
    ? '<span class="tag">常开</span>'
    : `<button class="field-switch" type="button" role="switch" data-field data-block-enabled="${esc(block.id)}" aria-checked="${block.enabled ? 'true' : 'false'}"><span class="field-switch-track"></span><span>${block.enabled ? '开' : '关'}</span></button>`;
  return {
    // 行属性给工具栏的两个筛选器用：槽位 + 来源（核心 / 插件 / 人格卡虚拟块）。
    attrs: {
      'data-filter-slot': block.slot || 'core',
      'data-filter-source': block.synthetic ? 'persona' : (block.pluginId === 'core' ? 'core' : 'plugin'),
    },
    cells: [
      enabledCell,
      `<code>${esc(block.id)}</code><div class="meta">${esc(block.label || '')}</div>`,
      `<span class="tag">${esc(slotLabel(block.slot))}</span>`,
      `<div class="meta"${title}>${esc(timing)}</div><div class="row">${profiles}</div>`,
      `<span class="meta">${esc(owner)}</span>`,
      `<input type="number" data-block-max="${esc(block.id)}" min="0" max="200000" step="100" value="${block.maxChars ?? ''}" placeholder="跟随默认" aria-label="${esc(block.id)} 上限（留空跟随默认）">`,
      `<span class="meta">${esc(chars)}</span>`,
      `<span class="${cls}"${title}>${esc(label)}</span>`,
      `<span class="meta">${esc(when)}</span>`,
    ],
  };
}

const SLOT_ORDER = ['head', 'identity', 'behavior', 'resources', 'situation', 'action', 'tail', 'core'];
function slotFilterOptions(blocks) {
  const present = new Set(blocks.map((block) => block.slot || 'core'));
  return [{ value: '', label: '全部槽位' }].concat(
    SLOT_ORDER.filter((slot) => present.has(slot)).map((slot) => ({ value: slot, label: slotLabel(slot) })),
  );
}

function tableMarkup() {
  const blocks = Array.isArray(payload?.blocks) ? payload.blocks : [];
  if (!blocks.length) return '<div class="meta">还没有注册任何注入块。</div>';
  return dataTableHtml({
    columns: [
      { label: '启用', width: '76' },
      { label: '块', width: '220' },
      { label: '槽位', width: '92' },
      { label: '时机', width: '180' },
      { label: '来源', width: '78' },
      { label: '上限', width: '170' },
      { label: '最近字数', width: '90' },
      { label: '状态' },
      { label: '最近', width: '96' },
    ],
    rows: blocks.map(rowHtml),
    pageSize: 20,
    search: { placeholder: '搜索块名 / id' },
    refresh: { label: '重新读取' },
    filters: [
      { id: 'slot', label: '槽位', options: slotFilterOptions(blocks) },
      {
        id: 'source',
        label: '来源',
        options: [
          { value: '', label: '全部来源' },
          { value: 'core', label: '核心' },
          { value: 'plugin', label: '插件' },
          { value: 'persona', label: '人格卡' },
        ],
      },
    ],
    meta: `共 ${blocks.length} 块`,
    actions: '<button class="btn primary" type="button" id="pbSave">保存修改</button>',
    empty: '没有匹配的注入块。',
  });
}

function renderTable() {
  const host = el('pbTable');
  if (!host) return;
  host.innerHTML = tableMarkup();
  bindSwitches(host);
  initDataTables(host, { onRefresh: () => { void load(); } });
}

function renderLimits() {
  const limits = payload?.limits ?? {};
  const total = el('pbTotalLimit');
  const block = el('pbBlockLimit');
  if (total && document.activeElement !== total) total.value = String(Number(limits.total) || 0);
  if (block && document.activeElement !== block) block.value = String(Number(limits.perBlockDefault) || 0);
}

function renderSummary() {
  const host = el('pbSummaryRow');
  if (host) host.innerHTML = summaryHtml();
}

function fillSessionOptions() {
  const select = el('pbPreviewKey');
  if (!select) return;
  const current = select.value;
  select.innerHTML = sessions.map((entry) => {
    const name = entry.displayName || entry.key;
    const label = name === entry.key ? entry.key : `${name}（${entry.key}）`;
    return `<option value="${esc(entry.key)}">${esc(label)}</option>`;
  }).join('');
  if (current && sessions.some((entry) => entry.key === current)) select.value = current;
}

async function load() {
  try {
    const [blockData, sessionData] = await Promise.all([api('/api/prompt-blocks'), api('/api/sessions')]);
    payload = blockData;
    sessions = Array.isArray(sessionData?.sessions) ? sessionData.sessions : [];
    renderSummary();
    renderLimits();
    renderTable();
    fillSessionOptions();
  } catch (error) {
    const host = el('pbTable');
    if (host) host.innerHTML = `<div class="meta err">读取失败：${esc(error?.message || '未知错误')}</div>`;
  }
}

function collectOverrides() {
  const overrides = {};
  document.querySelectorAll('[data-block-max]').forEach((maxInput) => {
    const id = maxInput.dataset.blockMax;
    const switchEl = document.querySelector(`[data-block-enabled="${CSS.escape(id)}"]`);
    const raw = maxInput.value.trim();
    overrides[id] = { enabled: switchEl ? getSwitch(switchEl) : true, maxChars: raw === '' ? null : Number(raw) };
  });
  return overrides;
}

async function save() {
  const msg = el('pbSaveMsg');
  const overrides = collectOverrides();
  if (!Object.keys(overrides).length) {
    if (msg) msg.textContent = '没有可保存的块';
    return;
  }
  const total = Number(el('pbTotalLimit')?.value || 0) || 0;
  const perBlockDefault = Number(el('pbBlockLimit')?.value || 0) || 0;
  if (msg) msg.textContent = '保存中…';
  try {
    const result = await api('/api/config/promptBlocks', 'PATCH', {
      promptBlocks: overrides,
      limits: { total, perBlockDefault },
    });
    if (msg) msg.textContent = '已保存，下一轮唤醒生效';
    showConsoleToast('注入块设置已保存');
    // 重新读取：PATCH 只回 coreBlocks.status()，不含插件块和人格卡的虚拟块，
    // 直接拿它覆盖会把整张表换成一小部分。
    if (result?.ok === false) throw new Error(result?.error || '保存失败');
    await load();
  } catch (error) {
    if (msg) msg.textContent = `保存失败：${error?.message || '未知错误'}`;
  }
}

function previewBlocksTable(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return '';
  const rows = blocks.map((block) => [
    `<span class="tag">${esc(slotLabel(block.slot))}</span>`,
    `<code>${esc(block.id)}</code>`,
    `<span class="${(STATUS_LABEL[block.status] || ['', 'tag'])[1]}">${esc((STATUS_LABEL[block.status] || [block.status || ''])[0])}</span>`,
    `<span class="meta">${Number(block.chars) || 0}</span>`,
  ]);
  return `<div class="u-mt-12">${tableHtml([
    { label: '槽位', width: '110' },
    { label: '块', width: '260' },
    { label: '状态', width: '120' },
    { label: '字数', width: '90' },
  ], rows)}</div>`;
}

async function preview() {
  const key = el('pbPreviewKey')?.value?.trim();
  const profile = el('pbPreviewProfile')?.value || 'wake';
  const reason = el('pbPreviewReason')?.value || 'atMention';
  const msg = el('pbPreviewMsg');
  const body = el('pbPreviewBody');
  if (!body) return;
  if (!key) {
    if (msg) msg.textContent = '还没有可预览的会话';
    return;
  }
  if (msg) msg.textContent = '生成中…';
  try {
    const result = await api('/api/prompt-preview', 'POST', { key, profile, reason });
    if (msg) msg.textContent = `已生成：${Number(result.chars) || 0} 字`;
    const budget = Number(result.maxTotalChars) > 0 ? `${Number(result.maxTotalChars)} 字` : '不限';
    body.innerHTML = `<div class="row"><span class="tag">${esc(PROFILE_LABEL[result.profile] || result.profile)}</span><span class="tag">${Number(result.chars) || 0} 字</span><span class="tag">预算 ${esc(budget)}</span><span class="tag">${esc(result.key)}</span></div>
      <pre class="code-area pb-preview-text">${esc(result.text || '')}</pre>
      ${previewBlocksTable(result.blocks)}`;
  } catch (error) {
    if (msg) msg.textContent = `生成失败：${error?.message || '未知错误'}`;
    body.innerHTML = `<div class="meta err">${esc(error?.message || '未知错误')}</div>`;
  }
}

function hostFor(name) {
  return document.querySelector(`[data-prompt-blocks-fields="${name}"]`);
}

// 卡片外壳统一由 card 组件生成（page.html 只留 #promptBlocksCards 宿主）。
// 说明文字走 description（<p class="meta">，与原来的 <div class="meta"> 视觉一致）。
function renderCards() {
  const host = document.getElementById('promptBlocksCards');
  if (!host) return;
  host.innerHTML = [
    cardHtml({
      title: '注入块',
      description: '每次唤醒的提示词由这些块按「槽位 → 优先级」拼成，块之间统一空一行。关掉一块，当轮就不带它、预算立即回收；单块上限留空表示跟随「单块默认上限」（0 = 不限）。改完点「保存修改」，下一轮唤醒生效。',
      body: '<div data-prompt-blocks-fields="summary"></div>',
    }),
    cardHtml({
      title: '块清单',
      description: '表格按渲染顺序排列。预算填 0 表示不限：总预算用完时，排在后面的块整块跳过；单块默认上限只兜底「没有单独配过上限」的内置块。',
      body: `<div data-prompt-blocks-fields="limits"></div>
      <div data-prompt-blocks-fields="table"></div>`,
    }),
    cardHtml({
      title: '按会话预览',
      description: '用真实会话拼一遍完整提示词，只读：不会取走托付与定时说明，也不记账。',
      body: `<div data-prompt-blocks-fields="preview"></div>
      <div data-prompt-blocks-fields="previewOut"></div>`,
    }),
  ].join('');
}

function renderAll() {
  renderFields(hostFor('summary'), PROMPT_BLOCK_FIELDS.summary, { columns: 2 });
  renderFields(hostFor('limits'), PROMPT_BLOCK_FIELDS.limits, { columns: 2 });
  renderFields(hostFor('table'), PROMPT_BLOCK_FIELDS.table, { columns: 2 });
  renderFields(hostFor('preview'), PROMPT_BLOCK_FIELDS.preview, { columns: 2 });
  renderFields(hostFor('previewOut'), PROMPT_BLOCK_FIELDS.previewOut, { columns: 2 });
}

export function init() {
  // 先拼卡片外壳：renderAll() 与下面的 host 查询都依赖这些 [data-prompt-blocks-fields] 宿主。
  renderCards();
  renderAll();
  // 表格每轮 load() 都会重建内部 DOM，所以监听挂在不重建的容器上。
  const host = hostFor('table');
  if (host) {
    host.addEventListener('click', (event) => {
      if (event.target.closest('#pbSave')) { void save(); }
    });
  }
  const previewGo = document.getElementById('pbPreviewGo');
  if (previewGo) previewGo.addEventListener('click', () => { void preview(); });
  onPageRefresh('prompt-blocks', () => { void load(); });
  void load();
}
