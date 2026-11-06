// 运行总览：六块里的交互与首次加载都归本页；摘要指标、活动日志、模式按钮的
// 「当前状态」仍由 app.js 的全局 refresh() 写入（见 docs/PLUGIN_ROADMAP.md §8.7）。
// 页面只在进入 / 写操作成功后用 console:refresh-status 请 app 立刻补一次，
// 不自己重复实现状态读取，避免两套轮询互相覆盖。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { tzOptionsHtml, tzSet } from '../../js/timezone.js';
import { setMsg } from '../../components/message/message.js';
import { bindSwitches, getSwitch, renderFields, setSwitch } from '../../components/form/form.js';
import { OVERVIEW_FIELDS } from './fields.js';

const $ = (id) => document.getElementById(id);
const requestStatusRefresh = () => document.dispatchEvent(new Event('console:refresh-status'));

// 静态块按字段规格渲染：页面只留卡片与宿主，控件不再手写。
// bare 块（摘要指标）自带卡片外观，直接灌 HTML，不套字段外壳。
function renderOverviewFieldGroups() {
  document.querySelectorAll('[data-overview-fields]').forEach((host) => {
    const spec = OVERVIEW_FIELDS[host.dataset.overviewFields];
    if (!spec) return;
    if (spec.bare) { host.innerHTML = spec.html; return; }
    renderFields(host, spec.fields, { columns: 2 });
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

function readSilenceRows() {
  return [...document.querySelectorAll('#silenceRanges [data-sil-row]')].map((row) => {
    const q = (sel) => row.querySelector(sel);
    const days = q('[data-sil="days"]').value;
    return {
      id: row.dataset.silRow,
      enabled: q('[data-sil="enabled"]').checked,
      name: q('[data-sil="name"]').value.trim(),
      start: q('[data-sil="start"]').value,
      end: q('[data-sil="end"]').value,
      days,
      weekdays: [...row.querySelectorAll('[data-sil-wd]')].filter((c) => c.checked).map((c) => Number(c.dataset.silWd)),
      skipHolidays: q('[data-sil="skipHolidays"]').checked,
    };
  });
}

function renderSilenceRanges() {
  const box = $('silenceRanges');
  if (!silenceDraft.length) { box.innerHTML = '<div class="meta">还没有时间段。点「＋ 添加时间段」，或者「一键填入 DeepSeek 高峰时段」。</div>'; return; }
  box.innerHTML = `<div class="silence-row h"><span>启用</span><span>名称</span><span>时间段</span><span>哪些天</span><span></span></div>` + silenceDraft.map((r) => `
    <div class="silence-row ${r.enabled ? '' : 'off'}" data-sil-row="${esc(r.id || '')}">
      <label class="sched-chip u-m-0"><input type="checkbox" data-sil="enabled" ${r.enabled ? 'checked' : ''}> 启用</label>
      <input type="text" data-sil="name" value="${esc(r.name || '')}" placeholder="上午高峰">
      <div class="row u-gap-6-nowrap"><input type="time" data-sil="start" value="${esc(r.start)}"><span>–</span><input type="time" data-sil="end" value="${esc(r.end)}"></div>
      <div class="row u-gap-6">
        <select data-sil="days">${[['every', '每天'], ['workdays', '工作日'], ['weekend', '周末'], ['custom', '自选']].map(([v, l]) => `<option value="${v}" ${r.days === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span data-sil-custom ${r.days === 'custom' ? '' : 'hidden'}>${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="sched-chip ${(r.weekdays || []).includes(d) ? 'on' : ''} tight"><input type="checkbox" data-sil-wd="${d}" ${(r.weekdays || []).includes(d) ? 'checked' : ''}> ${SILENCE_W[d]}</label>`).join('')}</span>
        <label class="sched-chip u-m-0"><input type="checkbox" data-sil="skipHolidays" ${r.skipHolidays ? 'checked' : ''}> 跳过法定节假日</label>
      </div>
      <button class="small danger" data-sil-del aria-label="删除这个时间段">删</button>
    </div>`).join('');
  box.querySelectorAll('[data-sil-row]').forEach((row) => {
    row.querySelector('[data-sil="days"]').addEventListener('change', (e) => { row.querySelector('[data-sil-custom]').hidden = e.target.value !== 'custom'; });
    row.querySelector('[data-sil="enabled"]').addEventListener('change', (e) => row.classList.toggle('off', !e.target.checked));
    row.querySelectorAll('[data-sil-wd]').forEach((c) => c.addEventListener('change', () => c.parentElement.classList.toggle('on', c.checked)));
    row.querySelector('[data-sil-del]').addEventListener('click', () => { silenceDraft = readSilenceRows().filter((x) => x.id !== row.dataset.silRow); renderSilenceRanges(); });
  });
}

function renderSilence() {
  const r = silenceState;
  if (!r) return;
  setSwitch($('silenceEnabled'), !!r.config.enabled);
  tzSet($('silenceTz'), r.config.timezone);
  document.querySelectorAll('[data-silence-opt]').forEach((c) => { c.checked = !!r.config.options[c.dataset.silenceOpt]; });
  const tier = r.config.options.stopWakes === false ? 'normal' : (r.config.options.directWakes ? 'direct' : 'stop');
  document.querySelectorAll('input[name="silenceWakeTier"]').forEach((c) => { c.checked = c.value === tier; });
  renderSilenceRanges();
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
  const r = await api('/api/socialV2/config');
  const send = (r && (r.config || r).send) || {};
  for (const [id, k, d] of [['sendLimitMin', 'maxSendPerMinute', 8], ['sendLimitHour', 'maxSendPerHour', 60]]) {
    const el = $(id);
    if (el && document.activeElement !== el) el.value = send[k] ?? d;
  }
}

// ── 初始化 ──────────────────────────────────────────────────────────────────
export function init() {
  // 先把字段规格渲染成 DOM，后面所有 $(id) 才取得到节点。
  renderOverviewFieldGroups();
  // 开关是 <button role="switch">，点击委托要显式绑（不绑就点不动、值也读不对）。
  bindSwitches(document.getElementById('section-overview'));
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
  $('dshEffortSave').addEventListener('click', async () => {
    const msg = $('dshEffortMsg');
    const payload = {
      provider: $('dshProviderSelect').value,
      model: $('dshModelSelect').value,
      reasoningEffort: $('dshEffortSelect').value,
      vision: $('dshVisionSelect').value,
    };
    // 第一次换到第三方提供方：保存前再确认一次隐私
    if (!DSH_FIRST_PARTY.includes(payload.provider) && payload.provider !== dshModelState?.provider
      && !confirm(`${payload.provider} 不是 DeepSeek 自家的提供方。保存后，QQ 里的聊天内容（群友消息、图片、人格卡、记忆）会发给它处理。确定要切换吗？`)) return;
    msg.textContent = '保存中…';
    msg.className = 'meta';
    const r = await api('/api/dsh/model', 'POST', payload);
    msg.textContent = r.ok ? `✅ 已设为 ${r.provider}/${r.model}（${r.reasoningEffort || '模型默认强度'}），下一条消息生效` : ('❌ ' + (r.error || '保存失败'));
    msg.className = r.ok ? 'meta ok' : 'meta err';
    if (r.ok) { await refreshDshModel(); setMsg(msg, `✅ 已设为 ${r.provider}/${r.model}（${r.reasoningEffort || '模型默认强度'}），下一条消息生效`, 'ok'); }
  });

  // 静默开关（手动优先）
  $('silentOn').addEventListener('click', async () => {
    await api('/api/role-mode', 'POST', { mode: 'silent' });
    refreshSilence();
    requestStatusRefresh();
  });
  $('silentOff').addEventListener('click', async () => {
    const r = await api('/api/role-mode', 'POST', { mode: 'active' });
    if (r.resumedScheduled) showConsoleToast(`定时静默「${r.resumedScheduled.name}」这一段临时恢复，到 ${r.resumedScheduled.untilText}；下一段照常静默`);
    refreshSilence();
    requestStatusRefresh();
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
    const options = {};
    document.querySelectorAll('[data-silence-opt]').forEach((c) => { options[c.dataset.silenceOpt] = c.checked; });
    const tier = document.querySelector('input[name="silenceWakeTier"]:checked')?.value || 'stop';
    options.stopWakes = tier !== 'normal';
    options.directWakes = tier === 'direct';
    const r = await api('/api/silence', 'POST', { enabled: getSwitch($('silenceEnabled')), timezone: $('silenceTz').value, ranges: readSilenceRows(), options });
    $('silenceMsg').textContent = r.ok ? '✅ 已保存' : '❌ ' + (r.error || '保存失败');
    $('silenceMsg').className = r.ok ? 'meta ok' : 'meta err';
    if (r.ok) { silenceState = r; silenceDraft = r.config.ranges.map((x) => ({ ...x })); renderSilence(); }
  });

  // 发言上限
  $('sendLimitSave').addEventListener('click', async () => {
    const send = { maxSendPerMinute: Math.max(0, Math.round(Number($('sendLimitMin').value) || 0)), maxSendPerHour: Math.max(0, Math.round(Number($('sendLimitHour').value) || 0)) };
    const r = await api('/api/socialV2/config', 'POST', { send });
    const msg = $('sendLimitMsg');
    msg.textContent = r.ok === false ? '❌ ' + (r.error || '保存失败') : '✅ 已保存';
    msg.className = r.ok === false ? 'meta err' : 'meta ok';
    requestStatusRefresh();
  });

  // 进入本页 / 切回来：重读本页负责的配置型数据；摘要与活动日志仍由 app.js 写。
  const refreshOverviewPage = () => setTimeout(() => {
    refreshPresets();
    refreshDshModel();
    refreshSilence();
    loadSendLimit().catch(() => {});
    requestStatusRefresh();
  }, 0);
  onPageRefresh('overview', refreshOverviewPage);
  refreshOverviewPage();

  // 静默状态每分钟对一次表；只在本页可见时发请求（与 sessions 页的约定一致）。
  setInterval(() => { if (getCurrentPage() === 'overview') refreshSilence(); }, 60_000);
}
