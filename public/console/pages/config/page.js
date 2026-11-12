// 运行总览：六块里的交互与首次加载都归本页；摘要指标、活动日志、模式按钮的
// 「当前状态」仍由 app.js 的全局 refresh() 写入（见 docs/PLUGIN_ROADMAP.md §8.7）。
// 页面只在进入 / 写操作成功后用 console:refresh-status 请 app 立刻补一次，
// 不自己重复实现状态读取，避免两套轮询互相覆盖。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { getCurrentPage, onPageRefresh, setConsolePage, setPageLeaveGuard } from '../../js/router.js';
import { tzOptionsHtml, tzSet } from '../../js/timezone.js';
import { setMsg } from '../../components/message/message.js';
import { getSwitch, renderFields, setSwitch } from '../../components/form/form.js';
import { initTimeFields } from '../../components/time/time.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { askLeaveWithUnsaved, createSaveDock } from '../../components/action-dock/save-dock.js';
import { DOCK_ICONS } from '../../components/action-dock/action-dock.js';
import { CONFIG_FIELDS } from './fields.js';
import { init as initAccessPage, loadSecurity, securitySection, tokenSection } from './access-section.js';
import { globalAccessSection, mountGlobalAccess, refreshGlobalAccess, saveGlobalAccess } from '../sessions/page.js';
import { initVoiceSection } from './voice-section.js';
import { mountCompact, compactSection } from './compact.js';

const $ = (id) => document.getElementById(id);
const requestStatusRefresh = () => document.dispatchEvent(new Event('console:refresh-status'));
// 页面级保存条：init() 里创建；模块级只是为了 refreshOverviewPage 也能看到它。
let saveBar = null;
let compactPanel = null;

// 丢弃未保存的修改后，必须把控件恢复成服务端的值——只重置基线的话，用户切回来仍会看到刚才丢弃的编辑。
// 重读完成后 saveBar.adoptIfPristine() 会用服务端值重拍基线（reset() 已清掉 touched 标记）。
async function reloadConfigSections() {
  await Promise.allSettled([loadSecurity(), loadSendLimit(), refreshDshModel(), loadRoleDefault(), loadPersonaSettings(), loadRuntimeDefault(), loadPermission(), refreshGlobalAccess()]);
  compactPanel?.load();
  requestStatusRefresh();
  if (saveBar) saveBar.adoptIfPristine();
}

// ── 页面级保存分区 ──────────────────────────────────────────────────────────
// 只有「改完该整页一起保存」的表单才注册到这里；表格型数据（管理员、定时静默、
// 工具开关、行为档案）单独保存，不跟页面级保存绑在一起——否则一项失败就得全部重来。
const dshModelSection = {
  id: 'dshModel',
  label: 'DSH 模型',
  read: () => ({
    provider: $('dshProviderSelect').value,
    model: $('dshModelSelect').value,
    reasoningEffort: $('dshEffortSelect').value,
    vision: $('dshVisionSelect').value,
  }),
  save: async (payload) => {
    // 第一次换到第三方提供方：保存前再确认一次隐私（与按钮时代同一道闸）。
    if (!DSH_FIRST_PARTY.includes(payload.provider) && payload.provider !== dshModelState?.provider
      && !confirm(`${payload.provider} 不是 DeepSeek 自家的提供方。保存后，QQ 里的聊天内容（群友消息、图片、人格卡、记忆）会发给它处理。确定要切换吗？`)) {
      return { ok: true, skipped: true, message: '已取消（未切换提供方）' };
    }
    const r = await api('/api/dsh/model', 'POST', payload);
    if (!r.ok) return { ok: false, message: r.error || '保存失败' };
    await refreshDshModel();
    return { ok: true, message: `已设为 ${r.provider}/${r.model}（${r.reasoningEffort || '模型默认强度'}），下一条消息生效` };
  },
};

async function loadPermission() {
  try {
    const r = await api('/api/config/permission');
    if (r.ok === false) throw new Error(r.error || '读取失败');
    const p = r.permission ?? {};
    const def = document.getElementById('permissionDefault');
    if (def) def.value = p.default || 'read-only';
    const ttl = document.getElementById('permissionTtl');
    if (ttl) ttl.value = String(p.fullTtlMin || 30);
    const allow = document.getElementById('permissionAllowFull');
    if (allow) setSwitch(allow, p.allowFull === true);
    setMsg('permissionMsg', '');
    if (saveBar) saveBar.adoptIfPristine();
  } catch (error) {
    setMsg('permissionMsg', `读取权限配置失败：${error?.message ?? error}`, 'err');
  }
}

const sendLimitSection = {
  id: 'sendLimit',
  label: '发言上限',
  read: () => ({
    maxSendPerMinute: Math.max(0, Math.round(Number($('sendLimitMin').value) || 0)),
    maxSendPerHour: Math.max(0, Math.round(Number($('sendLimitHour').value) || 0)),
  }),
  save: async (value) => {
    const r = await api('/api/config/send-limit', 'POST', value);
    if (r.ok === false) return { ok: false, message: r.error || '保存失败' };
    requestStatusRefresh();
    return { ok: true, message: '已保存，立即生效' };
  },
};

const permissionSection = {
  id: 'permission',
  label: '权限级别',
  read: () => ({
    default: document.getElementById('permissionDefault')?.value || 'read-only',
    allowFull: getSwitch(document.getElementById('permissionAllowFull')) === true,
    fullTtlMin: Math.round(Number(document.getElementById('permissionTtl')?.value) || 30),
  }),
  save: async (value) => {
    const r = await api('/api/config/permission', 'POST', value);
    if (r.ok === false) return { ok: false, message: r.error || '保存失败' };
    requestStatusRefresh();
    return { ok: true, message: '已保存，立即生效' };
  },
};

const personaSettingsSection = {
  id: 'personaSettings',
  label: '人格提示词',
  // 注入上限已经归「注入块」页管（core-persona 块），这里只剩「保存人格卡后怎么生效」。
  read: () => ({
    saveApply: document.querySelector('input[name="personaSaveApply"]:checked')?.value || 'nextWake',
  }),
  save: async (value) => {
    const r = await api('/api/roles/limit', 'POST', value);
    if (r.ok === false) return { ok: false, message: r.error || '保存失败' };
    const applyText = r.saveApply === 'immediate' ? '立即生效' : '下次唤醒时生效';
    return { ok: true, message: `已保存：人格卡保存后${applyText}` };
  },
};

// 静态块按字段规格渲染：页面只留卡片与宿主，控件不再手写。
// bare 块（摘要指标）自带卡片外观，直接灌 HTML，不套字段外壳。
function renderOverviewFieldGroups() {
  document.querySelectorAll('[data-overview-fields]').forEach((host) => {
    const spec = CONFIG_FIELDS[host.dataset.overviewFields];
    if (!spec) return;
    if (spec.bare) { host.innerHTML = spec.html; return; }
    renderFields(host, spec.fields, { columns: 1 });
  });
}

// ── DSH 模型与思考强度 ──────────────────────────────────────────────────────
// 提供方 / 模型 / 思考强度三个下拉联动，选项全部来自桥接转发的 DSH 模型目录（GET /api/dsh/model 的 providers）；
// 目录取不到时只显示当前配置（保存会被服务端拒绝）。服务端会再校验一次，页面只负责好用。
const DSH_FIRST_PARTY = ['deepseek-official', 'deepseek-account'];
let dshModelState = null;
function dshProviders() { return Array.isArray(dshModelState?.providers) ? dshModelState.providers : []; }
function dshSelectedProvider() { return dshProviders().find((p) => p.id === $('dshProviderSelect').value) || null; }
function dshSelectedEntry() {
  const p = dshSelectedProvider();
  return p ? (p.models || []).find((m) => m.id === $('dshModelSelect').value) || null : null;
}
function dshFillSelect(select, items, value) {
  select.replaceChildren();
  for (const item of items) {
    const el = document.createElement('option');
    el.value = item.value;
    el.textContent = item.label;
    if (item.title) el.title = item.title;
    select.appendChild(el);
  }
  if (items.some((x) => x.value === value)) select.value = value;
}
function dshFillModels(preferred) {
  const r = dshModelState || {};
  const p = dshSelectedProvider();
  const models = p ? (p.models || []) : [];
  const items = models.length
    ? models.map((m) => ({ value: m.id, label: `${m.name}${m.name !== m.id ? `（${m.id}）` : ''}${m.vision === 'yes' ? ' · 能看图' : ''}${m.priced ? '' : ' · 价格未覆盖'}`, title: m.description || '' }))
    : [{ value: r.model || '', label: r.model || '-' }];
  dshFillSelect($('dshModelSelect'), items, preferred ?? r.model);
}
function dshFillEfforts(preferred) {
  const r = dshModelState || {};
  const select = $('dshEffortSelect');
  const entry = dshSelectedEntry();
  if (entry && !(entry.efforts || []).length) {
    // 无档位模型：强度下拉置灰，保存时不带档位
    dshFillSelect(select, [{ value: '', label: '该模型没有思考档位' }], '');
    select.disabled = true;
    return;
  }
  select.disabled = false;
  const efforts = entry ? entry.efforts : (r.options || []).map((id) => ({ id, name: r.labels?.[id]?.name || id, description: r.labels?.[id]?.description || '' }));
  const def = entry ? entry.defaultEffort : (r.providerDefault || null);
  const items = efforts.map((e) => ({ value: e.id, label: `${e.id}${e.id === def ? '（默认）' : ''}${e.id === 'off' ? ' · 关闭思考' : ''}`, title: e.description || '' }));
  const want = [preferred, r.reasoningEffort, def].find((v) => v && items.some((x) => x.value === v));
  dshFillSelect(select, items, want || items[0]?.value);
}
// 保存前的预览提示（措辞与服务端 selectionNotices 一致；保存后以服务端返回的为准）
function dshPreviewNotices() {
  const provider = $('dshProviderSelect').value;
  const entry = dshSelectedEntry();
  const effort = $('dshEffortSelect').value;
  const vision = $('dshVisionSelect').value;
  const notices = [];
  if (provider && !DSH_FIRST_PARTY.includes(provider)) notices.push({ level: 'warn', text: `${provider} 不是 DeepSeek 自家的提供方：QQ 里的聊天内容（群友消息、图片、人格卡、记忆）会发给它处理，请先确认它的隐私政策。` });
  if (effort === 'off') notices.push({ level: 'warn', text: '思考已关闭：回复更快，但二代仿真里的工具调用、读群判断和人格一致性可能变差。' });
  const sees = vision === 'yes' || (vision === 'auto' && entry?.vision === 'yes') || (vision === 'auto' && !entry && dshModelState?.visionKnown === 'yes');
  if (!sees) notices.push({ level: 'info', text: vision === 'no'
    ? '已设为不能看图：QQ 里的图片、表情会改成文字占位（例如「[图片1：当前模型不能看图，已省略]」）。'
    : '这个模型能不能看图未知：按不能看图处理，图片、表情会改成文字占位；确认它能看图的话，把「看图能力」改成「能看图」。' });
  const priced = entry ? entry.priced : dshModelState?.priced;
  if (priced === false) notices.push({ level: 'info', text: '价格表没有覆盖这个模型：令牌与花费页的金额按 DeepSeek-V4.1-Flash 估算，并标「估算」。' });
  return notices;
}
function dshRenderNotices(notices) {
  const box = $('dshModelNotices');
  box.replaceChildren();
  for (const n of notices || []) {
    const el = document.createElement('div');
    el.className = n.level === 'warn' ? 'dsh-notice warn' : 'dsh-notice';
    el.textContent = (n.level === 'warn' ? '⚠️ ' : 'ℹ️ ') + n.text;
    box.appendChild(el);
  }
}
async function refreshDshModel(force = false) {
  try {
    const r = await api('/api/dsh/model' + (force ? '?refresh=1' : ''));
    dshModelState = r;
    $('dshModelText').textContent = r.model || '-';
    $('dshProviderText').textContent = r.provider || '-';
    const providers = dshProviders();
    const providerItems = providers.length
      ? providers.map((p) => ({ value: p.id, label: `${p.name}${p.name !== p.id ? `（${p.id}）` : ''}${p.thirdParty ? ' · 第三方' : ''}` }))
      : [{ value: r.provider || '', label: r.provider || '-' }];
    dshFillSelect($('dshProviderSelect'), providerItems, r.provider);
    dshFillModels(r.model);
    dshFillEfforts(r.reasoningEffort);
    $('dshVisionSelect').value = r.vision || 'auto';
    dshRenderNotices(r.notices || dshPreviewNotices());
    const modelCount = providers.reduce((n, p) => n + (p.models || []).length, 0);
    const parts = [];
    if (r.catalogSource === 'dsh') parts.push(`选项取自 DSH 的模型目录（${providers.length} 个提供方 / ${modelCount} 个模型）`);
    else parts.push(`目录不可用${r.catalogError ? '（' + r.catalogError + '）' : ''}：只显示当前配置和内置档位，暂时不能切换模型`);
    if (r.providerDefault) parts.push(`当前模型的默认强度是 ${r.providerDefault}`);
    if ((r.failures || []).length) parts.push('读取失败的提供方：' + r.failures.map((f) => `${f.name || f.id}（${f.message}）`).join('、'));
    $('dshEffortNote').textContent = parts.join('；') + '。';
    $('dshEffortSideEffect').textContent = r.globalSideEffect
      ? '注意：切换会同时写入 DSH 的全局默认（~/.dsh/settings.yaml 的 agent-default-model），也就是 Web GUI 里新建会话的默认模型和强度也会跟着变。'
      : '';
    $('dshEffortMsg').textContent = '';
  } catch (error) {
    $('dshEffortMsg').textContent = '读取失败：' + (error?.message ?? error);
  }
}

// ── 定时静默（运行总览 → 静默开关） ─────────────────────────────────────────
// 判断、执行都在桥接（src/silence-schedule.js）；这里只负责编辑和展示。
const SILENCE_W = ['', '一', '二', '三', '四', '五', '六', '日'];
let silenceState = null;
let silenceDraft = [];

// 时段行的三个小图标/开关片段：时间用项目自带的时间组件（文本框 + 时钟按钮 + 隐藏原生输入），
// 启用与「跳过法定节假日」都用 role=switch（点击委托由 init() 里对 #section-overview 的 bindSwitches 负责）。
const SILENCE_CLOCK = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.6V8l2.4 1.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
const SILENCE_TRASH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.6h10M6.3 4.6V3.1h3.4v1.5M4.9 4.6l.6 8.3h5l.6-8.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function silenceSwitch(field, silKey, on, onLabel, offLabel) {
  return `<button type="button" class="field-switch" role="switch" data-field="${field}" data-sil="${silKey}"`
    + ` data-on-label="${esc(onLabel)}" data-off-label="${esc(offLabel)}" aria-checked="${on ? 'true' : 'false'}">`
    + `<span class="field-switch-track" aria-hidden="true"></span><span>${esc(on ? onLabel : offLabel)}</span></button>`;
}

function silenceTime(id, silKey, value, label) {
  return `<span class="time-field">`
    + `<input type="text" class="time-field-text" id="${id}" data-sil="${silKey}" value="${esc(value || '')}" placeholder="HH:mm" inputmode="numeric" autocomplete="off" aria-label="${esc(label)}">`
    + `<button type="button" class="time-field-btn btn-icon" aria-label="选择${esc(label)}">${SILENCE_CLOCK}</button>`
    + `<input type="time" data-time-native="${id}" tabindex="-1" aria-hidden="true">`
    + '</span>';
}

function readSilenceRows() {
  return [...document.querySelectorAll('#silenceRanges [data-sil-row]')].map((row) => {
    const q = (sel) => row.querySelector(sel);
    const days = q('[data-sil="days"]').value;
    return {
      id: row.dataset.silRow,
      enabled: getSwitch(q('[data-sil="enabled"]')),
      name: q('[data-sil="name"]').value.trim(),
      start: q('[data-sil="start"]').value,
      end: q('[data-sil="end"]').value,
      days,
      weekdays: [...row.querySelectorAll('[data-sil-wd]')].filter((c) => c.checked).map((c) => Number(c.dataset.silWd)),
      skipHolidays: getSwitch(q('[data-sil="skipHolidays"]')),
    };
  });
}

function silenceRowHtml(r, index) {
  return {
    attrs: { 'data-sil-row': r.id || '', 'data-sil-index': String(index), class: r.enabled ? '' : 'off' },
    cells: [
      silenceSwitch('silEnabled', 'enabled', !!r.enabled, '开', '关'),
      `<input type="text" data-sil="name" value="${esc(r.name || '')}" placeholder="上午高峰" aria-label="时段名称">`,
      silenceTime(`silStart_${r.id || index}`, 'start', r.start, '开始时间'),
      silenceTime(`silEnd_${r.id || index}`, 'end', r.end, '结束时间'),
      `<div class="silence-days">
        <select data-sil="days" aria-label="哪些天">${[['every', '每天'], ['workdays', '工作日'], ['weekend', '周末'], ['custom', '自选']].map(([v, l]) => `<option value="${v}" ${r.days === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span data-sil-custom ${r.days === 'custom' ? '' : 'hidden'}>${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="sched-chip ${(r.weekdays || []).includes(d) ? 'on' : ''} tight"><input type="checkbox" data-sil-wd="${d}" ${(r.weekdays || []).includes(d) ? 'checked' : ''}> ${SILENCE_W[d]}</label>`).join('')}</span>
      </div>`,
      silenceSwitch('silSkipHolidays', 'skipHolidays', !!r.skipHolidays, '跳过节假日', '不跳过'),
      `<button type="button" class="btn-icon" data-sil-del aria-label="删除这个时间段" title="删除这个时间段">${SILENCE_TRASH}</button>`,
    ],
  };
}

function renderSilenceRanges() {
  const box = $('silenceRanges');
  if (!box) return;
  // 与其他页一致：统一 data-table（工具栏、搜索、分页、表头样式）。
  // 行内是时间/开关/下拉等活控件，重绘后重新 initDataTables 与时间组件。
  box.innerHTML = dataTableHtml({
    columns: [
      { label: '启用', width: '84' },
      { label: '名称', width: '150' },
      { label: '开始', width: '132' },
      { label: '结束', width: '132' },
      { label: '哪些天' },
      { label: '跳过节假日', width: '124' },
      { label: '操作', width: '64' },
    ],
    rows: silenceDraft.map(silenceRowHtml),
    pageSize: 10,
    search: { placeholder: '搜索时段名称' },
    meta: `共 ${silenceDraft.length} 个时段`,
    actions: '<button type="button" class="btn small" id="silenceAdd">＋ 添加时间段</button>'
      + '<button type="button" class="btn small" id="silencePeak">一键填入高峰时段</button>'
      + '<button type="button" class="btn small primary" id="silenceSave">保存定时静默</button>',
    empty: '还没有时间段。点「＋ 添加时间段」，或者「一键填入高峰时段」。',
  });
  initDataTables(box);
  initTimeFields(box);
}

function renderSilence() {
  const r = silenceState;
  if (!r) return;
  setSwitch($('silenceEnabled'), !!r.config.enabled);
  tzSet($('silenceTz'), r.config.timezone);
  renderSilenceRanges();
  renderManualSilence(r.manualSilence);
  const pill = $('silenceStatePill');
  if (r.manual) { pill.textContent = '静默中 · 手动'; pill.className = 'pill r'; }
  else if (r.active) { pill.textContent = `静默中 · 定时（${r.active.name}），到 ${r.active.untilText}`; pill.className = 'pill r'; }
  else if (r.override) { pill.textContent = `正常 · 本段已临时恢复，到 ${r.override.untilText}`; pill.className = 'pill b'; }
  else { pill.textContent = '正常'; pill.className = 'pill g'; }
  const up = (r.upcoming || []).slice(0, 4).map((x) => `${x.name} ${x.startText.replace(/（.*）/, '')}–${x.endText.slice(11)}`);
  $('silenceUpcoming').textContent = r.config.enabled
    ? (up.length ? `接下来：${up.join('；')}` : '接下来 14 天没有静默时段')
    : '定时静默未开启';
}

const MANUAL_SILENCE_DEFAULT = { mode: 'full', stages: { passive: true, proactive: true, scheduledAi: true, scheduledText: true, pluginTasks: true }, adminApplies: false, recordMessages: true, catchUp: true };

function manualDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '刚刚';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours} 小时 ${minutes % 60} 分钟` : `${hours} 小时`;
}

function readManualSilencePolicy() {
  const mode = document.querySelector('input[name="manualSilenceMode"]:checked')?.value === 'sendOnly' ? 'sendOnly' : 'full';
  const stages = {};
  document.querySelectorAll('#manualSilenceStages input[type="checkbox"]').forEach((c) => { stages[c.value] = c.checked; });
  return {
    mode,
    stages,
    adminApplies: !!getSwitch($('manualAdminApplies')),
    recordMessages: !!getSwitch($('manualRecordMessages')),
    catchUp: !!getSwitch($('manualCatchUp')),
  };
}

function renderManualSilence(silent) {
  const p = silent || MANUAL_SILENCE_DEFAULT;
  document.querySelectorAll('input[name="manualSilenceMode"]').forEach((c) => { c.checked = c.value === (p.mode || 'full'); });
  document.querySelectorAll('#manualSilenceStages input[type="checkbox"]').forEach((c) => { c.checked = (p.stages || MANUAL_SILENCE_DEFAULT.stages)[c.value] !== false; });
  setSwitch($('manualAdminApplies'), p.adminApplies === true);
  setSwitch($('manualRecordMessages'), p.recordMessages !== false);
  setSwitch($('manualCatchUp'), p.catchUp !== false);
  const active = !!silent;
  const toggle = $('silentToggle');
  toggle.textContent = active ? '关闭手动静默' : '开启手动静默';
  toggle.disabled = false;
  $('silentApply').disabled = !active;
  $('manualSilenceNote').textContent = active
    ? '手动静默已锁定：只有 owner 能在控制台关闭；管理员不能开启或关闭。'
    : '开启后 AI 按下面的策略停手，直到你关闭手动静默；owner 私聊始终例外。';
  $('manualSilenceElapsed').textContent = active
    ? `已静默 ${manualDuration(silent.elapsedMs)} · 直到关闭手动静默${silent.locked ? ' · 已锁定' : ''}`
    : '未开启手动静默。';
}


async function refreshSilence() {
  try {
    const r = await api('/api/silence');
    if (!r.ok) return;
    silenceState = r;
    silenceDraft = r.config.ranges.map((x) => ({ ...x }));
    renderSilence();
  } catch {}
}

// ── 发言上限（二代 socialV2.send.maxSendPerMinute / maxSendPerHour）────────────
async function loadSendLimit() {
  const r = await api('/api/config/send-limit');
  const send = (r && r.send) || {};
  for (const [id, k, d] of [['sendLimitMin', 'maxSendPerMinute', 8], ['sendLimitHour', 'maxSendPerHour', 60]]) {
    const el = $(id);
    if (el && document.activeElement !== el) el.value = send[k] ?? d;
  }
}

// ── 人格卡保存后的生效方式（注入上限已移到「注入块」页的 core-persona 块）──────
async function loadPersonaSettings() {
  const r = await api('/api/roles/limit');
  const apply = r?.persona?.saveApply === 'immediate' ? 'immediate' : 'nextWake';
  document.querySelectorAll('input[name="personaSaveApply"]').forEach((el) => {
    el.checked = el.value === apply;
  });
}

// ── 默认人格（config.json 的 role.default）────────────────────────────────────
async function loadRoleDefault() {
  const select = $('roleDefaultSelect');
  if (!select) return;
  const [cfg, catalog] = await Promise.all([
    api('/api/config/role-default'),
    api('/api/personas').catch(() => null),
  ]);
  const current = cfg?.value ?? '';
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  // 统一目录里本地卡的 uid 是 local:<名字>，写回 role.default 只写名字；
  // 外部卡写 provider:id，注入时读缓存。这样默认人格可以直接选外部卡。
  const valueOf = (item) => (item.source === 'local' ? item.id : item.uid);
  const locals = items.filter((item) => item.source === 'local');
  const providers = items.filter((item) => item.source !== 'local');
  const options = locals.length
    ? locals.map((item) => ({ value: valueOf(item), label: item.name }))
    : (cfg?.options ?? []).map((name) => ({ value: name, label: name }));
  const externals = providers.length
    ? providers.map((item) => ({ value: valueOf(item), label: `${item.name}（外部 · ${item.provider}）` }))
    : (cfg?.external ?? []).map((name) => ({ value: name, label: `${name}（外部）` }));
  select.innerHTML = '<option value="">不挂人格卡</option>'
    + options.map((item) => `<option value="${esc(item.value)}">${esc(item.label)}</option>`).join('')
    + (externals.length
      ? '<optgroup label="外部人格">'
        + externals.map((item) => `<option value="${esc(item.value)}">${esc(item.label)}</option>`).join('')
        + '</optgroup>'
      : '');
  if (current && ![...options, ...externals].some((item) => item.value === current)) {
    select.insertAdjacentHTML('beforeend', `<option value="${esc(current)}">${esc(current)}</option>`);
  }
  select.value = current;
}

const roleDefaultSection = {
  id: 'roleDefault',
  label: '默认人格',
  read: () => ({ value: $('roleDefaultSelect')?.value ?? '' }),
  save: async (value) => {
    const next = String(value?.value ?? '').trim();
    // 外部卡走统一目录接口（带 provider:id），本地卡仍走原来的 role-default。
    const r = next.includes(':')
      ? await api('/api/personas/default', 'POST', { uid: next })
      : await api('/api/config/role-default', 'POST', { value: next });
    if (!r?.ok) return { ok: false, message: r?.error || '保存失败' };
    await loadRoleDefault();
    return { ok: true, message: r.message || '已保存，下一条消息生效' };
  },
};

// ── 默认运行方案（config.json 的 runtime.defaultPlan）─────────────────────────
async function loadRuntimeDefault() {
  const select = $('runtimeDefaultSelect');
  if (!select) return;
  const r = await api('/api/config/runtime');
  const current = r?.runtime?.defaultPlan ?? '';
  const plans = Array.isArray(r?.plans) ? r.plans : [];
  select.innerHTML = plans.map((plan) => `<option value="${esc(plan.id)}">${esc(plan.label || plan.id)}</option>`).join('');
  if (current) select.value = current;
}

const runtimeDefaultSection = {
  id: 'runtimeDefault',
  label: '默认运行方案',
  read: () => ({ defaultPlan: $('runtimeDefaultSelect')?.value ?? '' }),
  save: async (value) => {
    const r = await api('/api/config/runtime', 'POST', { defaultPlan: value?.defaultPlan ?? '' });
    if (!r?.ok) return { ok: false, message: r?.error || '保存失败' };
    await loadRuntimeDefault();
    return { ok: true, message: '已保存；新建与未单独设置的会话立即使用该方案' };
  },
};

const CONFIG_TABS = ['runtime', 'access', 'security', 'voice'];
const CONFIG_TAB_KEY = 'qq-console:tab:config';

function readConfigTab() {
  try {
    const saved = localStorage.getItem(CONFIG_TAB_KEY);
    return CONFIG_TABS.includes(saved) ? saved : 'runtime';
  } catch { return 'runtime'; }
}

function showConfigSection(name, { persist = true } = {}) {
  if (!CONFIG_TABS.includes(name)) name = 'runtime';
  document.querySelectorAll('[data-config-section]').forEach((button) => {
    const active = button.dataset.configSection === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-config-panel]').forEach((panel) => {
    const active = panel.dataset.configPanel === name;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
  if (persist) { try { localStorage.setItem(CONFIG_TAB_KEY, name); } catch { /* 隐私模式下不可用 */ } }
  // 权限卡的数据原本没人读：切到「安全」时补一次，避免卡片一会儿空一会儿有值。
  if (name === 'security') void loadPermission();
}

// ── 初始化 ──────────────────────────────────────────────────────────────────
export function init() {
  // 先把字段规格渲染成 DOM，后面所有 $(id) 才取得到节点。
  renderOverviewFieldGroups();
  // 五个水平分区标签（.page-tabs，与记忆页同一套组件）
  document.querySelectorAll('[data-config-section]').forEach((button) => {
    button.addEventListener('click', () => showConfigSection(button.dataset.configSection));
  });
  // 安全与静默：白名单 / 令牌 / 安全拦截由 access-section 统一渲染并绑定开关
  initAccessPage();
  // 准入：复用会话页的全局名单组件；必须先挂载，保存条才能读到它的控件。
  mountGlobalAccess(document.querySelector('[data-sessions-access]'));
  // 卡片自己的保存入口：改完名单不用去页脚浮层找保存，这里直接落盘。
  document.getElementById('globalAccessSave')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const msg = document.getElementById('globalAccessSaveMsg');
    if (msg) msg.textContent = '保存中…';
    button.disabled = true;
    try {
      const result = await saveGlobalAccess('globalAccessSaveMsg');
      if (result?.ok) saveBar?.reset('access');
    } finally {
      button.disabled = false;
    }
  });
  // 刷新后回到上次停留的标签页（默认「行为与模型」）；写入只在用户点击时发生。
  showConfigSection(readConfigTab(), { persist: false });
  // 页面级保存：安全、全局准入、DSH 模型、发言上限、令牌。令牌放最后——它换的是后续请求的凭据。
  saveBar = createSaveDock({
    page: 'config',
    sections: [securitySection, globalAccessSection, runtimeDefaultSection, roleDefaultSection, personaSettingsSection, compactSection, dshModelSection, sendLimitSection, permissionSection, tokenSection],
    actions: [{
      id: 'discard',
      label: '撤销未保存的修改',
      icon: DOCK_ICONS.undo,
      primary: true,
      disabled: true,
      onClick: () => { void saveBar?.discard(reloadConfigSections); },
    }],
  });
  setPageLeaveGuard((from, to) => {
    if (from !== 'config' || !saveBar?.isDirty()) return true;
    // 只有用户真的改过才拦：首次进入时字段值是异步回填的，这期间快照可能暂时有差异，
    // 那不是「未保存的修改」，不该弹窗也不该把假脏值当真。
    if (!saveBar.isTouched()) { saveBar.refresh(); return true; }
    void askLeaveWithUnsaved({ bar: saveBar }).then((answer) => {
      if (answer === 'cancel') return;
      // 丢弃要重读服务端数据，不能等它跑完再切页（那期间守卫会再拦一次）；先放行，
      // 重读完成后 discard() 自己会把基线校准干净。
      if (answer === 'discard') void saveBar.discard(reloadConfigSections);
      // skipGuard：确认已经做过，直接切；否则会再次弹窗。
      setConsolePage(to, { skipGuard: true });
    });
    return false;
  });
  // 准入：复用会话页的全局名单组件（上面已挂载）；拓展功能：语音库调试
  initVoiceSection();
  // 上下文压缩：从运行总览搬来，跟运行与模型放同一分区。
  compactPanel = mountCompact(document.querySelector('[data-config-compact]'));
  // 时区下拉必须在 refreshSilence / tzSet 之前填好，否则 select.value 设不进去。
  $('silenceTz').innerHTML = tzOptionsHtml(false);

  // DSH 模型与思考强度
  $('dshProviderSelect').addEventListener('change', () => { dshFillModels(); dshFillEfforts(); dshRenderNotices(dshPreviewNotices()); });
  $('dshModelSelect').addEventListener('change', () => { dshFillEfforts(); dshRenderNotices(dshPreviewNotices()); });
  $('dshEffortSelect').addEventListener('change', () => dshRenderNotices(dshPreviewNotices()));
  $('dshVisionSelect').addEventListener('change', () => dshRenderNotices(dshPreviewNotices()));
  $('dshCatalogRefresh').addEventListener('click', () => refreshDshModel(true));

  // 手动静默：同一个按钮按当前状态开启或关闭
  $('silentToggle').addEventListener('click', async () => {
    const toggle = $('silentToggle');
    const turningOff = !!silenceState?.manual;
    toggle.disabled = true;
    try {
      if (turningOff) {
        const r = await api('/api/role-mode', 'POST', { mode: 'active' });
        if (!r.ok) { $('manualSilenceNote').textContent = '❌ ' + (r.error || '关闭失败'); return; }
        if (r.resumedScheduled) showConsoleToast(`定时静默「${r.resumedScheduled.name}」这一段临时恢复，到 ${r.resumedScheduled.untilText}；下一段照常静默`);
      } else {
        const r = await api('/api/role-mode', 'POST', { mode: 'silent', silent: readManualSilencePolicy() });
        if (!r.ok) { $('manualSilenceNote').textContent = '❌ ' + (r.error || '开启失败'); return; }
      }
      await refreshSilence();
      requestStatusRefresh();
    } catch (error) {
      console.error(`${turningOff ? '关闭' : '开启'}手动静默失败`, error?.stack || error);
      $('manualSilenceNote').textContent = `❌ 网络错误，未${turningOff ? '关闭' : '开启'}`;
    } finally {
      toggle.disabled = false;
    }
  });
  $('silentApply').addEventListener('click', async () => {
    const r = await api('/api/role-mode', 'POST', { mode: 'silent', silent: readManualSilencePolicy() });
    $('manualSilenceNote').textContent = r.ok ? '✅ 静默策略已保存' : ('❌ ' + (r.error || '保存失败'));
    if (r.ok) { await refreshSilence(); requestStatusRefresh(); }
  });

  // 定时静默排期：表格每次增删都整块重绘，按钮与行内控件一律委托到宿主上。
  const silenceHost = $('silenceRanges');
  silenceHost?.addEventListener('click', async (event) => {
    if (event.target.closest('#silenceAdd')) {
      silenceDraft = readSilenceRows();
      silenceDraft.push({ id: '', name: '', enabled: true, start: '12:00', end: '14:00', days: 'every', weekdays: [], skipHolidays: false });
      renderSilenceRanges();
      return;
    }
    if (event.target.closest('#silencePeak')) {
      const preset = silenceState?.peakPreset || [];
      // 已经有同一时间、同样「哪些天」的时间段就不再重复添加（保存后 id 会变，不能只按 id 判断）
      const keep = readSilenceRows();
      const same = (a, b) => a.start === b.start && a.end === b.end && a.days === b.days;
      const added = preset.filter((p) => !keep.some((x) => same(x, p)));
      silenceDraft = [...keep, ...added.map((p) => ({ ...p }))];
      if ($('silenceTz').value !== 'Asia/Shanghai') tzSet($('silenceTz'), 'Asia/Shanghai');
      renderSilenceRanges();
      $('silenceMsg').textContent = added.length ? `已填入 ${added.length} 个高峰时段（北京时间），确认后点「保存定时静默」` : '高峰时段已经都在列表里了';
      $('silenceMsg').className = 'meta';
      return;
    }
    if (event.target.closest('#silenceSave')) {
      const r = await api('/api/silence', 'POST', { enabled: getSwitch($('silenceEnabled')), timezone: $('silenceTz').value, ranges: readSilenceRows() });
      $('silenceMsg').textContent = r.ok ? '✅ 已保存' : '❌ ' + (r.error || '保存失败');
      $('silenceMsg').className = r.ok ? 'meta ok' : 'meta err';
      if (r.ok) { silenceState = r; silenceDraft = r.config.ranges.map((x) => ({ ...x })); renderSilence(); }
      return;
    }
    const remove = event.target.closest('[data-sil-del]');
    if (remove) {
      const row = remove.closest('[data-sil-row]');
      const index = Number(row?.dataset.silIndex);
      silenceDraft = readSilenceRows().filter((_, i) => i !== index);
      renderSilenceRanges();
      return;
    }
    // 开关的 aria-checked 由 bindSwitches 在父容器上切换；等它切完再按新值决定整行是否变灰。
    const toggle = event.target.closest('[data-sil="enabled"]');
    if (toggle) {
      const row = toggle.closest('tr');
      requestAnimationFrame(() => row?.classList.toggle('off', !getSwitch(toggle)));
    }
  });
  silenceHost?.addEventListener('change', (event) => {
    const days = event.target.closest('[data-sil="days"]');
    if (days) { days.closest('tr').querySelector('[data-sil-custom]').hidden = days.value !== 'custom'; return; }
    const weekday = event.target.closest('[data-sil-wd]');
    if (weekday) weekday.parentElement.classList.toggle('on', weekday.checked);
  });

  // 发言上限：保存入口在页面级保存条（见 init 里的 saveBar）；这里只留数据读取。

  // 进入本页 / 切回来：重读本页负责的配置型数据；摘要与活动日志仍由 app.js 写。
  const refreshOverviewPage = () => setTimeout(async () => {
    refreshSilence();
    await reloadConfigSections();
  }, 0);
  onPageRefresh('config', refreshOverviewPage);
  refreshOverviewPage();

  // 静默状态每分钟对一次表；只在本页可见时发请求（与 sessions 页的约定一致）。
  setInterval(() => { if (getCurrentPage() === 'config') refreshSilence(); }, 60_000);
}
