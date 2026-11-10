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
import { askLeaveWithUnsaved, createSaveDock } from '../../components/action-dock/save-dock.js';
import { DOCK_ICONS } from '../../components/action-dock/action-dock.js';
import { CONFIG_FIELDS } from './fields.js';
import { init as initAccessPage, loadSecurity, securitySection, tokenSection } from './access-section.js';
import { globalAccessSection, mountGlobalAccess, refreshGlobalAccess } from '../sessions/page.js';
import { initToolsSection } from './tools-section.js';
import { mountCompact } from './compact.js';

const $ = (id) => document.getElementById(id);
const requestStatusRefresh = () => document.dispatchEvent(new Event('console:refresh-status'));
// 页面级保存条：init() 里创建；模块级只是为了 refreshOverviewPage 也能看到它。
let saveBar = null;
let compactPanel = null;

// 丢弃未保存的修改后，必须把控件恢复成服务端的值——只重置基线的话，用户切回来仍会看到刚才丢弃的编辑。
// 重读完成后 saveBar.adoptIfPristine() 会用服务端值重拍基线（reset() 已清掉 touched 标记）。
async function reloadConfigSections() {
  await Promise.allSettled([loadSecurity(), loadSendLimit(), refreshDshModel(), loadRoleDefault(), loadPersonaSettings(), loadBehaviorDefault(), refreshGlobalAccess()]);
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

const personaSettingsSection = {
  id: 'personaSettings',
  label: '人格提示词',
  read: () => ({
    maxInjectChars: Math.round(Number($('personaInjectMax').value) || 6000),
    saveApply: document.querySelector('input[name="personaSaveApply"]:checked')?.value || 'nextWake',
  }),
  save: async (value) => {
    const r = await api('/api/roles/limit', 'POST', value);
    if (r.ok === false) return { ok: false, message: r.error || '保存失败' };
    const applyText = r.saveApply === 'immediate' ? '立即生效' : '下次唤醒时生效';
    return { ok: true, message: `已保存：上限 ${r.maxInjectChars} 字符，人格卡保存后${applyText}` };
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

// ── 运行模式 ────────────────────────────────────────────────────────────────
function setActiveMode(mode) {
  document.querySelectorAll('#modeRow button').forEach((b) => {
    const active = b.dataset.mode === mode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
}

async function refreshPresets() {
  try {
    const r = await api('/api/presets');
    const sel = $('closedPreset');
    sel.innerHTML = '';
    // 空值 = 使用 DSH 自己声明的默认 preset（closed-agent 的推荐选择）
    const defOpt = document.createElement('option');
    defOpt.value = '';
    defOpt.textContent = '（DSH 默认 preset）';
    sel.appendChild(defOpt);
    for (const p of r.presets) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.id + (p.trust === 'user' ? '（用户）' : '');
      sel.appendChild(opt);
    }
  } catch {} finally {
    // 选项填好后再让 app.js 刷新一次状态：refresh() 会带回 closedAgentPreset，
    // 否则它可能在空选项上先跑，选中的 preset 看起来「丢了」。
    requestStatusRefresh();
  }
}

async function saveMode(mode) {
  // 不再硬编码 'router-standard'（DSH 0.1.5 已无此 preset）；
  // 留空表示让桥接使用 DSH 自己声明的默认 preset。
  const preset = $('closedPreset').value || '';
  const body = { mode, closedAgentPreset: preset };
  if (mode === 'closed-agent') {
    body.level = $('closedLevel').value || 'L2';
    if (body.level === 'L3') {
      const code = prompt('L3 高权限需要验证器上的 6 位动态码（TOTP）：');
      if (!code) return { ok: false };
      body.totp = code.trim();
    }
  }
  const r = await api('/api/mode', 'POST', body);
  if (r.ok) {
    // 先把按钮切过去给即时反馈；随后 app.js 的 refresh() 以服务端状态为准。
    setActiveMode(mode);
    requestStatusRefresh();
    // 桥接会把模式写穿到 DSH 设置；写穿失败时本地值会在下一次 5 秒轮询被覆盖回滚。
    // 不提示的话用户只会看到「刚切过去又自己变回来了」，无从判断原因。
    if (r.dshSynced === false) {
      alert('模式已写入本地，但未能同步到 DSH 设置（DSH 未运行？）——\n下一次轮询（约 5 秒）会把模式改回去。请检查 DSH 与桥接日志。');
    }
  } else {
    alert(r.error || '切换失败');
  }
  return r;
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

function renderSilenceRanges() {
  const box = $('silenceRanges');
  if (!silenceDraft.length) { box.innerHTML = '<div class="meta">还没有时间段。点「＋ 添加时间段」，或者「一键填入 DeepSeek 高峰时段」。</div>'; return; }
  // 用表格而不是 grid：窄屏时各列不会互相挤成三行，列宽也随表头固定下来（2026-11-07 用户反馈）。
  const head = '<thead><tr><th>启用</th><th>名称</th><th>开始</th><th>结束</th><th>哪些天</th><th>跳过节假日</th><th>操作</th></tr></thead>';
  const body = silenceDraft.map((r) => `
      <tr class="${r.enabled ? '' : 'off'}" data-sil-row="${esc(r.id || '')}">
        <td>${silenceSwitch('silEnabled', 'enabled', !!r.enabled, '开', '关')}</td>
        <td><input type="text" data-sil="name" value="${esc(r.name || '')}" placeholder="上午高峰" aria-label="时段名称"></td>
        <td>${silenceTime(`silStart_${r.id}`, 'start', r.start, '开始时间')}</td>
        <td>${silenceTime(`silEnd_${r.id}`, 'end', r.end, '结束时间')}</td>
        <td>
          <div class="silence-days">
            <select data-sil="days" aria-label="哪些天">${[['every', '每天'], ['workdays', '工作日'], ['weekend', '周末'], ['custom', '自选']].map(([v, l]) => `<option value="${v}" ${r.days === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <span data-sil-custom ${r.days === 'custom' ? '' : 'hidden'}>${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="sched-chip ${(r.weekdays || []).includes(d) ? 'on' : ''} tight"><input type="checkbox" data-sil-wd="${d}" ${(r.weekdays || []).includes(d) ? 'checked' : ''}> ${SILENCE_W[d]}</label>`).join('')}</span>
          </div>
        </td>
        <td>${silenceSwitch('silSkipHolidays', 'skipHolidays', !!r.skipHolidays, '跳过节假日', '不跳过')}</td>
        <td><button type="button" class="btn-icon" data-sil-del aria-label="删除这个时间段" title="删除这个时间段">${SILENCE_TRASH}</button></td>
      </tr>`).join('');
  box.innerHTML = `<div class="table-wrap"><table class="silence-table">
      <colgroup><col class="c-enable"><col class="c-name"><col class="c-time"><col class="c-time"><col class="c-days"><col class="c-skip"><col class="c-act"></colgroup>
      ${head}<tbody>${body}</tbody></table></div>`;
  initTimeFields(box);
  box.querySelectorAll('[data-sil-row]').forEach((row) => {
    row.querySelector('[data-sil="days"]').addEventListener('change', (e) => { row.querySelector('[data-sil-custom]').hidden = e.target.value !== 'custom'; });
    // 开关的 aria-checked 由 bindSwitches 切换；这里只在点击瞬间读旧值，决定整行要不要变灰。
    const enabled = row.querySelector('[data-sil="enabled"]');
    enabled.addEventListener('click', () => row.classList.toggle('off', getSwitch(enabled)));
    row.querySelectorAll('[data-sil-wd]').forEach((c) => c.addEventListener('change', () => c.parentElement.classList.toggle('on', c.checked)));
    row.querySelector('[data-sil-del]').addEventListener('click', () => { silenceDraft = readSilenceRows().filter((x) => x.id !== row.dataset.silRow); renderSilenceRanges(); });
  });
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

// ── 人格提示词：注入上限 + 保存人格卡后的生效方式（两项一起保存）──────────────
async function loadPersonaSettings() {
  const r = await api('/api/roles/limit');
  const max = $('personaInjectMax');
  if (max && document.activeElement !== max) max.value = r?.limits?.injectMaxChars ?? 6000;
  const apply = r?.persona?.saveApply === 'immediate' ? 'immediate' : 'nextWake';
  document.querySelectorAll('input[name="personaSaveApply"]').forEach((el) => {
    el.checked = el.value === apply;
  });
}

// ── 默认人格（config.json 的 role.default）────────────────────────────────────
async function loadRoleDefault() {
  const select = $('roleDefaultSelect');
  if (!select) return;
  const r = await api('/api/config/role-default');
  const current = r?.value ?? '';
  const options = Array.isArray(r?.options) ? r.options : [];
  const external = Array.isArray(r?.external) ? r.external : [];
  select.innerHTML = '<option value="">不挂人格卡</option>'
    + options.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('')
    + (external.length
      ? '<optgroup label="外部人格（选中后另存为内部人格）">'
        + external.map((name) => `<option value="${esc(name)}">${esc(name)}（外部）</option>`).join('')
        + '</optgroup>'
      : '');
  select.value = options.includes(current) || external.includes(current) ? current : '';
}

const roleDefaultSection = {
  id: 'roleDefault',
  label: '默认人格',
  read: () => ({ value: $('roleDefaultSelect')?.value ?? '' }),
  save: async (value) => {
    const r = await api('/api/config/role-default', 'POST', { value: value?.value ?? '' });
    if (!r?.ok) return { ok: false, message: r?.error || '保存失败' };
    await loadRoleDefault();
    return { ok: true, message: r.message || '已保存，下一条消息生效' };
  },
};

// ── 默认行为档案（config.json 的 behavior.default）──────────────────────────────
async function loadBehaviorDefault() {
  const select = $('behaviorDefaultSelect');
  if (!select) return;
  const r = await api('/api/config/behavior-default');
  const current = r?.value ?? '';
  const options = Array.isArray(r?.options) ? r.options : [];
  select.innerHTML = '<option value="">（未设置，预设必须自带 behavior）</option>'
    + options.map((item) => '<option value="' + esc(item.id) + '">' + esc(item.label || item.id) + '（' + esc(item.kind) + '）</option>').join('');
  select.value = options.some((item) => item.id === current) ? current : '';
}

const behaviorDefaultSection = {
  id: 'behaviorDefault',
  label: '默认行为档案',
  read: () => ({ value: $('behaviorDefaultSelect')?.value ?? '' }),
  save: async (value) => {
    const r = await api('/api/config/behavior-default', 'POST', { value: value?.value ?? '' });
    if (!r?.ok) return { ok: false, message: r?.error || '保存失败' };
    await loadBehaviorDefault();
    return { ok: true, message: r.message || '已保存，下一条消息生效' };
  },
};

function showConfigSection(name) {
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
  // 页面级保存：安全、全局准入、DSH 模型、发言上限、令牌。令牌放最后——它换的是后续请求的凭据。
  saveBar = createSaveDock({
    page: 'config',
    sections: [securitySection, globalAccessSection, behaviorDefaultSection, roleDefaultSection, personaSettingsSection, dshModelSection, sendLimitSection, tokenSection],
    actions: [{
      id: 'discard',
      label: '撤销未保存的修改',
      icon: DOCK_ICONS.undo,
      primary: true,
      disabled: true,
      onClick: () => { saveBar?.reset(); void reloadConfigSections(); },
    }],
  });
  setPageLeaveGuard((from, to) => {
    if (from !== 'config' || !saveBar?.isDirty()) return true;
    // 只有用户真的改过才拦：首次进入时字段值是异步回填的，这期间快照可能暂时有差异，
    // 那不是「未保存的修改」，不该弹窗也不该把假脏值当真。
    if (!saveBar.isTouched()) { saveBar.refresh(); return true; }
    void askLeaveWithUnsaved({ bar: saveBar }).then((answer) => {
      if (answer === 'cancel') return;
      if (answer === 'discard') { saveBar.reset(); void reloadConfigSections(); }
      // skipGuard：确认已经做过，直接切；否则会再次弹窗。
      setConsolePage(to, { skipGuard: true });
    });
    return false;
  });
  // 准入：复用会话页的全局名单组件（上面已挂载）；工具与语音：系统层工具开关 + 语音库调试
  initToolsSection();
  // 上下文压缩：从运行总览搬来，跟运行与模型放同一分区。
  compactPanel = mountCompact(document.querySelector('[data-config-compact]'));
  // 时区下拉必须在 refreshSilence / tzSet 之前填好，否则 select.value 设不进去。
  $('silenceTz').innerHTML = tzOptionsHtml(false);

  // 运行模式
  const modeHeading = document.querySelector('#section-mode h2');
  if (modeHeading) modeHeading.dataset.note = '选择后即时生效';
  document.querySelectorAll('#modeRow button').forEach((b) => b.addEventListener('click', async () => {
    if (b.disabled) return;
    await saveMode(b.dataset.mode);
  }));
  $('adminPanic').addEventListener('click', async () => {
    if (!confirm('立即回到安全模式（L0 群友模式）？进行中的高权限会话会被停止。')) return;
    const r = await api('/api/admin/panic', 'POST', {});
    if (!r.ok) alert(r.error || '紧急关闭失败，请直接停止桥接进程');
    requestStatusRefresh();
  });
  $('closedPreset').addEventListener('change', async () => {
    // 切换预设立即保存（若当前是 closed-agent 则即时生效，否则供下次切换使用）
    const active = document.querySelector('#modeRow button.active');
    const mode = active ? active.dataset.mode : 'chat';
    await saveMode(mode);
  });

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

  // 定时静默排期
  $('silenceAdd').addEventListener('click', () => {
    silenceDraft = readSilenceRows();
    silenceDraft.push({ id: '', name: '', enabled: true, start: '12:00', end: '14:00', days: 'every', weekdays: [], skipHolidays: false });
    renderSilenceRanges();
  });
  $('silencePeak').addEventListener('click', () => {
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
  });
  $('silenceSave').addEventListener('click', async () => {
    const r = await api('/api/silence', 'POST', { enabled: getSwitch($('silenceEnabled')), timezone: $('silenceTz').value, ranges: readSilenceRows() });
    $('silenceMsg').textContent = r.ok ? '✅ 已保存' : '❌ ' + (r.error || '保存失败');
    $('silenceMsg').className = r.ok ? 'meta ok' : 'meta err';
    if (r.ok) { silenceState = r; silenceDraft = r.config.ranges.map((x) => ({ ...x })); renderSilence(); }
  });

  // 发言上限：保存入口在页面级保存条（见 init 里的 saveBar）；这里只留数据读取。

  // 进入本页 / 切回来：重读本页负责的配置型数据；摘要与活动日志仍由 app.js 写。
  const refreshOverviewPage = () => setTimeout(async () => {
    refreshPresets();
    refreshSilence();
    await reloadConfigSections();
  }, 0);
  onPageRefresh('config', refreshOverviewPage);
  refreshOverviewPage();

  // 静默状态每分钟对一次表；只在本页可见时发请求（与 sessions 页的约定一致）。
  setInterval(() => { if (getCurrentPage() === 'config') refreshSilence(); }, 60_000);
}
