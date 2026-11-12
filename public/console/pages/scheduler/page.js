// 定时任务页：规则计算、限额、到点执行都在桥接（src/scheduler/），这里只负责编辑与展示。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { onPageRefresh } from '../../js/router.js';
import { cardHtml } from '../../components/card/card.js';
import { tzOptionsHtml, tzSet } from '../../js/timezone.js';
import { bindSwitches, getSwitch, renderFields, setSwitch } from '../../components/form/form.js';
import { initDateFields } from '../../components/date/date.js';
import { initTimeFields } from '../../components/time/time.js';
import { closeModal, modalHtml, openModal, wireModal } from '../../components/modal/modal.js';
import { checkCellHtml, dataTableHtml, initDataTables, selectCellHtml } from '../../components/table/table.js';
import { SCHED_FIELDS } from './fields.js';
import { alertBox, confirmBox } from '../../components/message-box/message-box.js';

// ── 定时任务 ────────────────────────────────────────────────────────────────
// 规则的计算、限额、到点执行都在桥接（src/scheduler/）；这里只负责编辑和展示。
const SCHED_LIMIT_FIELDS = [
  ['maxTasks', '同时任务上限', '个'], ['perTaskPerDay', '单任务每天最多', '次'], ['totalPerDay', '全部每天最多', '条'],
  ['perGroupPerDay', '每个群每天最多', '条'], ['maxTargets', '单任务最多对象', '个'], ['minIntervalMin', '两次最小间隔', '分钟'],
  ['missedGraceMin', '错过多久内补发', '分钟'], ['jitterMin', '固定时间随机偏移', '± 分钟'], ['maxTextChars', '文字最长', '字'], ['maxInstructionChars', 'AI 说明最长', '字'],
];
const SCHED_WEEK = ['', '一', '二', '三', '四', '五', '六', '日'];
const SCHED_STATUS = { sent: ['已发送', 'tag tag--success'], partial: ['部分发送', 'tag tag--primary'], skipped: ['已跳过', 'tag tag--primary'], failed: ['失败', 'tag tag--danger'], missed: ['错过', 'tag'], finished: ['已结束', 'tag'], invalid: ['规则无效', 'tag tag--danger'] };

let schedState = null;
let schedEditingId = null;
let schedPreviewTimer = null;
const schedEl = (id) => document.getElementById(id);
// 编辑器在 body 级弹窗里（index.html 的 #schedEditorOverlay）：片段被注入 .card 内，
// .card 的动画/滤镜会给 position:fixed 造包含块，所以遮罩必须挂在 document.body 上。
const schedEditorOverlay = () => schedEl('schedEditorOverlay');
const schedSplit = (v) => String(v ?? '').split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);
// 状态位有两种宿主：动作条里的是 .form-actions-status，弹窗脚里的是 .modal-status。
// 基础类跟着元素现有 class 走，避免「换了个位置样式就全丢」。
function schedMsg(id, text, ok) {
  const el = schedEl(id);
  el.textContent = text;
  const base = el.classList.contains('modal-status') ? 'modal-status' : 'form-actions-status';
  el.className = ok == null ? base : `${base} ${ok ? 'ok' : 'err'}`;
}

// 卡片外壳统一由 card 组件生成（page.html 只留 #schedulerCards 宿主）。
// 标题原样保留为 <h3>（cardHtml 只产出 h2），所以放在 body 顶部，字号仍由 .card h3 决定。
function renderCards() {
  const host = schedEl('schedulerCards');
  if (!host) return;
  host.innerHTML = [
    cardHtml({
      body: `<h3>定时任务</h3>
  <div class="meta">总开关和安全限制只能在这里或管理员命令里改，AI 改不了。时间一律按任务的时区计算，和这台电脑的时区无关。</div>

  <div class="form-inline-bar u-mt-10">
    <div class="form-inline-fields" data-sched-fields="header" data-sched-layout="inline"></div>
    <div class="form-inline-tail">
      <span class="tag tag--info" id="schedStatePill">—</span>
      <div data-sched-fields="headerActions"></div>
    </div>
  </div>`,
    }),
    cardHtml({
      body: `<h3>谁可以登记</h3>
  <div class="meta">AI 只能在下面允许的范围里登记任务；登记后先暂停，需要你确认。</div>
  <div data-sched-fields="policy" data-sched-columns="1"></div>`,
    }),
    cardHtml({
      body: `<h3>安全限制</h3>
  <div class="meta">每个账号最多能挂多少任务、多久跑一次，防止失控；免打扰只拦定时任务发往群的消息。</div>
  <div data-sched-fields="limits"></div>
  <div data-sched-fields="limitsActions"></div>`,
    }),
    cardHtml({
      body: `<h3>任务列表</h3>
  <div data-sched-fields="taskList"></div>`,
    }),
    cardHtml({
      body: `<h3>执行记录</h3>
  <div class="meta">最近 100 条；管理员私聊里也可以用 <code>/remind</code> 管理。在二代仿真里也可以直接跟 AI 说「每天六点给我发个早安」，AI 登记后桥接会另发一条确认给你。</div>
  <div data-sched-fields="history"></div>`,
    }),
  ].join('');
}

/** 把 fields.js 的规格渲染进每个 `<div data-sched-fields="…">`。init() 里第一件事。 */
function renderSchedFieldGroups() {
  document.querySelectorAll('[data-sched-fields]').forEach((host) => {
    const spec = SCHED_FIELDS[host.dataset.schedFields];
    if (!spec) return;
    renderFields(host, spec.fields, { columns: Number(host.dataset.schedColumns) || 2, layout: host.dataset.schedLayout || 'grid' });
  });
}

async function refreshScheduler() {
  try {
    const r = await api('/api/scheduler');
    if (!r.ok) { schedEl('schedList').innerHTML = `<div class="meta">读取失败：${esc(r.error || '')}</div>`; return; }
    schedState = r;
    renderScheduler();
  } catch (error) {
    schedEl('schedList').innerHTML = `<div class="meta">读取失败：${esc(error?.message ?? error)}</div>`;
  }
}

function renderScheduler() {
  const r = schedState;
  if (!r) return;
  const st = r.settings;
  setSwitch(schedEl('schedEnabled'), st.enabled);
  setSwitch(schedEl('schedAllowAiPrivate'), st.allowAiPrivate);
  setSwitch(schedEl('schedAllowAiGroup'), st.allowAiGroup);
  const pill = schedEl('schedStatePill');
  pill.textContent = st.enabled ? (r.writable === false ? '只读（数据文件读取失败）' : '运行中') : '已关闭';
  pill.className = st.enabled && r.writable !== false ? 'tag tag--success' : 'tag tag--danger';
  schedEl('schedLimits').innerHTML = SCHED_LIMIT_FIELDS.map(([k, label, unit]) => `<div><label for="schedLim_${k}">${esc(label)}（${esc(unit)}）</label><input type="number" id="schedLim_${k}" min="0" value="${esc(st.limits[k])}" title="默认 ${esc(r.defaults?.limits?.[k] ?? '')}"></div>`).join('');
  setSwitch(schedEl('schedQuietEnabled'), st.limits.quietEnabled);
  schedEl('schedQuietStart').value = st.limits.quietStart;
  schedEl('schedQuietEnd').value = st.limits.quietEnd;
  renderSchedPluginKinds();
  const targetLabel = (k) => (r.targets.find((t) => t.key === k)?.label) || k;
  const taskRows = r.tasks.map((t) => {
    const badges = [t.kindLabel ? `<span class="tag tag--primary">${esc(t.kindLabel)}</span>` : (t.kind === 'ai' ? '<span class="tag tag--primary">AI 来说</span>' : '<span class="tag">固定文字</span>'),
      `<span class="tag">来源：${esc({ console: '控制台', 'owner-command': '管理员命令', 'owner-chat-ai': '私聊 AI' }[t.createdBy] || t.createdBy)}</span>`,
      t.pendingConfirm ? '<span class="tag tag--danger">待你确认</span>' : ''].join(' ');
    const last = t.lastResult ? `<span class="${(SCHED_STATUS[t.lastResult] || ['', 'tag'])[1]}">${esc((SCHED_STATUS[t.lastResult] || [t.lastResult])[0])}</span>${t.lastReason ? `<div class="meta u-mt-2">${esc(t.lastReason)}</div>` : ''}` : '<span class="meta">—</span>';
    return [
      checkCellHtml({ value: String(t.id), checked: Boolean(t.enabled), label: `启用 #${t.id}`, attrs: { 'data-sched-toggle': t.id } }),
      `<b>#${t.id} ${esc(t.name)}</b><div class="u-mt-4">${badges}</div><div class="meta u-mt-4">${esc(t.kind === 'ai' ? t.instruction : (t.kind === 'text' ? t.text : JSON.stringify(t.payload ?? {})))}</div>`,
      `${esc(t.scheduleText)}<div class="meta u-mt-2">${t.nextRunText ? '下次：' + esc(t.nextRunText) : '没有下一次'}${t.maxRuns ? `；已执行 ${t.runs} / ${t.maxRuns}` : ''}</div>`,
      t.targets.map((k) => `<span class="sched-chip u-cursor-default">${esc(targetLabel(k))}</span>`).join(''),
      last,
      `<div class="row-actions"><button type="button" class="btn small" data-sched-run="${t.id}" title="立即执行一次（计入今天的限额）">试发</button><button type="button" class="btn small" data-sched-edit="${t.id}">编辑</button><button type="button" class="btn small danger" data-sched-del="${t.id}">删</button></div>`,
    ];
  });
  schedEl('schedList').innerHTML = dataTableHtml({
    columns: [{ label: '启用', width: 64 }, { label: '任务' }, { label: '时间', width: 220 }, { label: '发给', width: 160 }, { label: '上次', width: 160 }, { label: '操作', width: 190 }],
    rows: taskRows,
    search: { placeholder: '搜索任务名或内容…' },
    refresh: true,
    meta: `${r.tasks.length} / ${st.limits.maxTasks}`,
    actions: '<button class="btn primary small" type="button" id="schedNew">＋ 新建任务</button>',
    empty: '还没有定时任务。点「＋ 新建任务」，或者在管理员私聊里发 /remind 看用法。',
  });
  initDataTables(schedEl('schedList'), { onRefresh: () => refreshScheduler() });
  const historyRows = r.history.map((h) => {
    const [label, cls] = SCHED_STATUS[h.status] || [h.status, 'tag'];
    const when = new Date(h.at).toLocaleString('zh-CN', { hour12: false, timeZone: st.timezone });
    return [
      esc(when),
      `<span class="${cls}">${esc(label)}</span>`,
      `#${esc(h.taskId)} ${esc(h.name || '')}${h.manual ? '（试发）' : ''}`,
      h.target ? esc(targetLabel(h.target)) : '<span class="meta">—</span>',
      h.reason ? `<span class="meta">${esc(h.reason)}</span>` : '<span class="meta">—</span>',
    ];
  });
  schedEl('schedHistory').innerHTML = historyRows.length
    ? dataTableHtml({
      columns: [{ label: '时间', width: 190 }, { label: '状态', width: 110 }, { label: '任务', width: 240 }, { label: '目标', width: 160 }, { label: '说明' }],
      rows: historyRows,
      pageSize: 10,
      empty: '暂无执行记录。',
    })
    : '<div class="meta">暂无执行记录。</div>';
  if (historyRows.length) initDataTables(schedEl('schedHistory'));
  schedEl('schedList').querySelectorAll('[data-sched-toggle]').forEach((cb) => cb.addEventListener('change', async () => {
    const res = await api(`/api/scheduler/tasks/${cb.dataset.schedToggle}/${cb.checked ? 'enable' : 'disable'}`, 'POST', {});
    if (!res.ok) await alertBox({ message: res.error || '操作失败', type: 'danger' });
    refreshScheduler();
  }));
  schedEl('schedList').querySelectorAll('[data-sched-run]').forEach((b) => b.addEventListener('click', async () => {
    const res = await api(`/api/scheduler/tasks/${b.dataset.schedRun}/run`, 'POST', {});
    if (!res.ok) await alertBox({ message: res.error || '试发失败', type: 'danger' });
    else showConsoleToast(`#${b.dataset.schedRun} 试发：` + res.outcomes.map((o) => `${targetLabel(o.target)} ${(SCHED_STATUS[o.status] || [o.status])[0]}${o.reason ? '（' + o.reason + '）' : ''}`).join('；'));
    refreshScheduler();
  }));
  schedEl('schedList').querySelectorAll('[data-sched-edit]').forEach((b) => b.addEventListener('click', () => openSchedEditor(r.tasks.find((t) => String(t.id) === b.dataset.schedEdit))));
  schedEl('schedList').querySelectorAll('[data-sched-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmBox({
      title: '删除定时任务',
      message: `确定删除任务 #${b.dataset.schedDel}？`,
      confirmText: '删除',
      danger: true,
    }))) return;
    const res = await api(`/api/scheduler/tasks/${b.dataset.schedDel}`, 'DELETE', {});
    if (!res.ok) await alertBox({ message: res.error || '删除失败', type: 'danger' });
    refreshScheduler();
  }));
}

function schedFieldsHtml(type, s = {}) {
  const v = (x, d = '') => esc(x ?? d);
  // 日期字段：可见的是文本框（能整段粘贴/键入），日历按钮背后挂隐藏的原生 date 输入。
  // 与 index.html 里的有效期两个框、以及 components/date/date.js 的约定保持一致。
  const CAL = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.2" y="3.4" width="11.6" height="10.2" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.4 6.6h11.2M5.4 2.2v2.4M10.6 2.2v2.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const dateField = (id, value = '', label = '日期') => `<span class="date-field">`
    + `<input type="text" class="date-field-text" id="${id}" value="${v(value)}" placeholder="YYYY-MM-DD" inputmode="numeric" autocomplete="off" aria-label="${label}">`
    + `<button type="button" class="date-field-btn btn-icon" aria-label="选择${label}">${CAL}</button>`
    + `<input type="date" class="date-field-native" data-date-native="${id}" tabindex="-1" aria-hidden="true">`
    + `</span>`;
  // 时间字段：同上，文本框可整段键入 HH:mm，时钟按钮调起原生面板。
  const CLOCK = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.6V8l2.4 1.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const timeField = (id, value = '', label = '时间') => `<span class="time-field">`
    + `<input type="text" class="time-field-text" id="${id}" value="${v(value)}" placeholder="HH:mm" inputmode="numeric" autocomplete="off" aria-label="${label}">`
    + `<button type="button" class="time-field-btn btn-icon" aria-label="选择${label}">${CLOCK}</button>`
    + `<input type="time" data-time-native="${id}" tabindex="-1" aria-hidden="true">`
    + `</span>`;
  const times = (s.times || ['09:00']).join(', ');
  // 统一行结构：标签在左、控件在右，和 fields.js 渲染出来的行完全一致。
  // 动态编辑器最容易写成「标签在上」，那样看起来和弹窗其它行不是一套表单。
  const row = (label, control, hint = '') => `<div class="field-block"><div class="field-row">`
    + `<span class="field-label">${label}</span>`
    + `<div class="field-control field-inline">${control}</div>`
    + `</div>${hint ? `<div class="field-notes"><p class="field-hint">${hint}</p></div>` : ''}</div>`;
  const timesRow = row('时间', `<input type="text" id="sf_times" value="${v(times)}" placeholder="06:00, 22:00">`);
  const windowRow = (w) => row('时间段', timeField('sf_w0', (w || [])[0] ?? '09:00', '开始时间') + '<span class="field-unit">到</span>' + timeField('sf_w1', (w || [])[1] ?? '22:00', '结束时间'));
  switch (type) {
    case 'once': return row('日期和时间', dateField('sf_date', s.date, '日期') + timeField('sf_time', s.time ?? '09:00', '时间'));
    case 'daily': case 'workdays': return timesRow;
    case 'weekly': return row('星期', [1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="sched-chip u-m-0"><input type="checkbox" data-sf-wd="${d}" ${(s.weekdays || [1]).includes(d) ? 'checked' : ''}> 周${SCHED_WEEK[d]}</label>`).join('')) + timesRow;
    case 'monthly': return row('几号', `<input type="text" id="sf_days" value="${v((s.days || [1]).join(', '))}" placeholder="1, 15, -1（-1 = 最后一天）">`) + timesRow;
    case 'monthlyWeekday': return row('每月', `<select id="sf_nth">${[[1, '第 1 个'], [2, '第 2 个'], [3, '第 3 个'], [4, '第 4 个'], [5, '第 5 个'], [-1, '最后一个']].map(([n, l]) => `<option value="${n}" ${Number(s.nth ?? 1) === n ? 'selected' : ''}>${l}</option>`).join('')}</select><select id="sf_weekday">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}" ${Number(s.weekday ?? 6) === d ? 'selected' : ''}>周${SCHED_WEEK[d]}</option>`).join('')}</select>`) + timesRow;
    case 'yearly': return row('日期', `<input type="text" id="sf_dates" value="${v((s.dates || ['01-01']).join(', '))}" placeholder="10-21, 12-25（MM-DD）">`) + timesRow;
    case 'dates': return row('日期列表', `<textarea id="sf_items" rows="3">${v((s.items || []).map((x) => `${x.date} ${x.time}`).join('\n'))}</textarea>`, '每行一条：YYYY-MM-DD HH:mm');
    case 'everyNDays': return row('每隔', dateField('sf_start', s.startDate, '开始日期') + '<span class="field-unit">起，每</span><input type="number" id="sf_every" min="2" value="' + v(s.every, 3) + '"><span class="field-unit">天</span>') + timesRow;
    case 'interval': return row('间隔', `<input type="number" id="sf_everyMin" min="10" value="${v(s.everyMinutes, 240)}"><span class="field-unit">分钟一次</span>`) + windowRow(s.window || ['08:00', '23:00']);
    case 'dailyRandom': return row('随机次数', `<input type="number" id="sf_count" min="1" value="${v(s.count, 3)}"><span class="field-unit">次，至少隔</span><input type="number" id="sf_gap" min="0" value="${v(s.minGapMin, 60)}"><span class="field-unit">分钟</span>`) + windowRow(s.window);
    case 'cron': return row('表达式', `<input class="u-flex-basis-220-mono" type="text" id="sf_cron" value="${v(s.expr, '0 9 * * 1-5')}" placeholder="0 9 * * 1-5">`, '5 段：分 时 日 月 周（周 0 和 7 都是周日，也可以写 MON-FRI）。例子：<code>0 9 * * 1-5</code> 工作日 9:00；<code>30 8 1 * *</code> 每月 1 号 8:30；<code>0 10,15 * * 6,0</code> 周末 10:00 和 15:00；<code>*/30 9-18 * * *</code> 9～18 点每半小时。日和周都限定时按「任一满足」。下面会实时显示接下来几次，写错会直接提示。cron 只能在控制台设置，AI 不能用。');
    case 'monthlyRandom': return row('随机次数', `<input type="number" id="sf_mcount" min="1" value="${v(s.count, 4)}"><span class="field-unit">次，限</span><input type="number" id="sf_d0" min="1" max="31" value="${v((s.dayRange || [])[0], 1)}"><span class="field-unit">～</span><input type="number" id="sf_d1" min="1" max="31" value="${v((s.dayRange || [])[1], 28)}"><span class="field-unit">号</span>`) + windowRow(s.window);
    default: return '';
  }
}

function readSchedFields(type) {
  const val = (id) => schedEl(id)?.value ?? '';
  const s = { type };
  if (['daily', 'workdays', 'weekly', 'monthly', 'monthlyWeekday', 'yearly', 'everyNDays'].includes(type)) s.times = schedSplit(val('sf_times'));
  if (type === 'once') { s.date = val('sf_date'); s.time = val('sf_time'); }
  if (type === 'weekly') s.weekdays = [...document.querySelectorAll('[data-sf-wd]')].filter((c) => c.checked).map((c) => Number(c.dataset.sfWd));
  if (type === 'monthly') s.days = schedSplit(val('sf_days')).map(Number);
  if (type === 'monthlyWeekday') { s.nth = Number(val('sf_nth')); s.weekday = Number(val('sf_weekday')); }
  if (type === 'yearly') s.dates = schedSplit(val('sf_dates'));
  if (type === 'dates') s.items = val('sf_items').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [date, time] = l.split(/\s+/); return { date, time }; });
  if (type === 'everyNDays') { s.startDate = val('sf_start'); s.every = Number(val('sf_every')); }
  if (type === 'interval') { s.everyMinutes = Number(val('sf_everyMin')); s.window = [val('sf_w0'), val('sf_w1')]; }
  if (type === 'dailyRandom' || type === 'monthlyRandom') { s.count = Number(val(type === 'dailyRandom' ? 'sf_count' : 'sf_mcount')); s.window = [val('sf_w0'), val('sf_w1')]; }
  if (type === 'dailyRandom') s.minGapMin = Number(val('sf_gap'));
  if (type === 'monthlyRandom') s.dayRange = [Number(val('sf_d0')), Number(val('sf_d1'))];
  if (type === 'cron') s.expr = val('sf_cron').trim();
  return s;
}

function schedPluginKinds() { return schedState?.taskTypes || []; }

function schedSyncKindUi() {
  const plugin = schedEl('schedPluginKind')?.value || '';
  const custom = Boolean(plugin);
  document.querySelectorAll('input[name="schedKind"]').forEach((r) => { r.disabled = custom; });
  schedEl('schedPayloadJson').hidden = !custom;
  schedEl('schedContent').hidden = custom;
}

function schedPayload() {
  const type = schedEl('schedType').value;
  const schedule = readSchedFields(type);
  if (schedEl('schedStartDate').value.trim() && type !== 'everyNDays') schedule.startDate = schedEl('schedStartDate').value.trim();
  if (schedEl('schedEndDate').value.trim()) schedule.endDate = schedEl('schedEndDate').value.trim();
  schedule.excludeDates = schedSplit(schedEl('schedExclude').value);
  schedule.excludeHolidays = getSwitch(schedEl('schedSkipHolidays'));
  const pluginKind = schedEl('schedPluginKind')?.value || '';
  const kind = pluginKind || document.querySelector('input[name="schedKind"]:checked')?.value || 'text';
  const content = schedEl('schedContent').value.trim();
  let payload = null;
  if (pluginKind) {
    const raw = schedEl('schedPayloadJson').value.trim();
    if (raw) {
      try { payload = JSON.parse(raw); } catch { schedMsg('schedEditorMsg', '❌ payload 不是合法 JSON', false); return null; }
    }
  }
  return {
    name: schedEl('schedName').value.trim(),
    timezone: schedEl('schedTaskTz').value.trim() || null,
    schedule,
    maxRuns: schedEl('schedMaxRuns').value ? Number(schedEl('schedMaxRuns').value) : null,
    missedPolicy: schedEl('schedMissed').value,
    runDuringSilence: schedEl('schedSilence').value === 'run',
    targets: [...schedTargetKeys],
    kind,
    ...(pluginKind ? { payload } : (kind === 'ai' ? { instruction: content } : { text: content })),
  };
}

function renderSchedPluginKinds() {
  const kinds = schedPluginKinds();
  const row = schedEl('schedPluginKindRow');
  const select = schedEl('schedPluginKind');
  if (!row || !select) return;
  row.hidden = !kinds.length;
  const current = select.value;
  select.innerHTML = `<option value="">— 用上面的固定文字 / AI —</option>${kinds.map((k) => `<option value="${esc(k.id)}">${esc(k.label)}${k.pluginId ? `（${esc(k.pluginId)}）` : ''}</option>`).join('')}`;
  if (kinds.some((k) => k.id === current)) select.value = current;
}

// 「发给谁」不再把好友/群铺成一排 chip：单元格只显示摘要，点「选择对象」开弹窗，
// 弹窗里管理员私聊是开关，其余对象用表格组件的多选列。
let schedTargetKeys = new Set();
let schedTargetOverlay = null;

function schedTargetList() {
  return (schedState?.targets || []).filter((t) => t.kind !== 'owner');
}

function schedTargetSummary() {
  const all = schedState?.targets || [];
  const picked = all.filter((t) => schedTargetKeys.has(t.key));
  if (!picked.length) return '未选择';
  const owner = picked.some((t) => t.kind === 'owner');
  const rest = picked.filter((t) => t.kind !== 'owner');
  return [owner ? '管理员私聊' : '', rest.length ? `${rest.length} 个对象` : ''].filter(Boolean).join(' + ');
}

function renderSchedTargets(selected) {
  schedTargetKeys = new Set(selected || []);
  const host = schedEl('schedTargets');
  if (!host) return;
  const all = schedState?.targets || [];
  host.textContent = schedTargetSummary();
  host.dataset.empty = schedTargetKeys.size ? '' : '1';
  host.title = all.filter((t) => schedTargetKeys.has(t.key)).map((t) => t.label).join('\n');
}

function ensureSchedTargetModal() {
  if (schedTargetOverlay) return schedTargetOverlay;
  const wrap = document.createElement('div');
  wrap.innerHTML = modalHtml({
    id: 'schedTargetOverlay',
    title: '选择发送对象',
    wide: true,
    body: '<div class="form-stack"><div id="schedTargetSwitch"></div><div id="schedTargetTable"></div></div>',
    footer: '<span class="modal-status" id="schedTargetMsg"></span>'
      + '<button class="btn" type="button" id="schedTargetCancel">取消</button>'
      + '<button class="btn primary" type="button" id="schedTargetApply">确定</button>',
  });
  const overlay = wrap.firstElementChild;
  document.body.appendChild(overlay);
  renderFields(overlay.querySelector('#schedTargetSwitch'), [
    { name: 'schedTargetOwner', type: 'switch', label: '发送到管理员私聊', hint: '只发给 ownerQQ；和其它对象可以同时选。' },
  ], { layout: 'inline', columns: 1 });
  bindSwitches(overlay);
  wireModal(overlay, {});
  overlay.querySelector('#schedTargetCancel').addEventListener('click', () => closeModal(overlay));
  overlay.querySelector('#schedTargetApply').addEventListener('click', () => applySchedTargets());
  schedTargetOverlay = overlay;
  return overlay;
}

function renderSchedTargetTable() {
  const host = schedTargetOverlay?.querySelector('#schedTargetTable');
  if (!host) return;
  const rows = schedTargetList();
  host.innerHTML = dataTableHtml({
    columns: [
      { label: '类型', width: 90 },
      { label: '对象', width: 260 },
      { label: '对象 ID' },
    ],
    rows: rows.map((t) => [
      selectCellHtml({ value: t.key, checked: schedTargetKeys.has(t.key), label: `选择 ${t.label}` }),
      t.kind === 'group' ? '群' : '好友',
      `<b>${esc(t.label)}</b>`,
      `<span class="meta">${esc(t.key)}</span>`,
    ]),
    pageSize: 10,
    select: { label: '选择', width: 60 },
    search: { placeholder: '搜索名称或 ID…' },
    empty: '白名单里没有可选的好友或群。',
  });
  initDataTables(host);
}

function openSchedTargetPicker() {
  const overlay = ensureSchedTargetModal();
  const owner = (schedState?.targets || []).find((t) => t.kind === 'owner');
  const ownerSwitch = overlay.querySelector('#schedTargetOwner');
  ownerSwitch.disabled = !owner;
  setSwitch(ownerSwitch, !!owner && schedTargetKeys.has(owner.key));
  renderSchedTargetTable();
  schedMsg('schedTargetMsg', owner ? '' : '没有配置 ownerQQ，只能发给好友或群。');
  openModal(overlay);
}

function applySchedTargets() {
  const overlay = schedTargetOverlay;
  if (!overlay) return;
  const picked = [...overlay.querySelectorAll('input[data-select-row]:checked')].map((c) => c.value);
  const owner = (schedState?.targets || []).find((t) => t.kind === 'owner');
  if (owner && getSwitch(overlay.querySelector('#schedTargetOwner'))) picked.unshift(owner.key);
  const limit = Number(schedState?.limits?.maxTargets) || 0;
  if (limit && picked.length > limit) {
    schedMsg('schedTargetMsg', `最多选 ${limit} 个对象（当前 ${picked.length} 个）`, false);
    return;
  }
  renderSchedTargets(picked);
  closeModal(overlay);
  schedPreview();
}

function openSchedEditor(task = null) {
  schedEditingId = task ? task.id : null;
  openModal(schedEditorOverlay());
  schedEl('schedEditorTitle').textContent = task ? `编辑任务 #${task.id}` : '新建任务';
  const s = task?.schedule || { type: 'daily', times: ['09:00'] };
  schedEl('schedName').value = task?.name || '';
  tzSet(schedEl('schedTaskTz'), task?.timezone || '');
  schedEl('schedType').value = s.type;
  schedEl('schedFields').innerHTML = schedFieldsHtml(s.type, s);
  // 动态行里也有日期/时间字段，插入后要重新装一次组件（否则只有原生输入、没有按钮）。
  initDateFields(schedEl('schedFields'));
  initTimeFields(schedEl('schedFields'));
  schedEl('schedStartDate').value = s.type === 'everyNDays' ? '' : (s.startDate || '');
  schedEl('schedEndDate').value = s.endDate || '';
  schedEl('schedExclude').value = (s.excludeDates || []).join(', ');
  setSwitch(schedEl('schedSkipHolidays'), !!s.excludeHolidays);
  schedEl('schedMaxRuns').value = task?.maxRuns ?? '';
  schedEl('schedMissed').value = task?.missedPolicy || 'grace';
  schedEl('schedSilence').value = task?.runDuringSilence ? 'run' : 'skip';
  const owner = (schedState?.targets || []).find((t) => t.kind === 'owner')?.key;
  renderSchedTargets(task?.targets || (owner ? [owner] : []));
  const kind = task?.kind || 'text';
  document.querySelectorAll('input[name="schedKind"]').forEach((r) => { r.checked = r.value === kind; });
  const isPluginKind = !['text', 'ai'].includes(kind);
  renderSchedPluginKinds();
  schedEl('schedPluginKind').value = isPluginKind ? kind : '';
  schedEl('schedPayloadJson').value = isPluginKind ? JSON.stringify(task?.payload ?? {}, null, 2) : '';
  schedEl('schedContent').value = task ? (task.kind === 'ai' ? task.instruction : (task.kind === 'text' ? task.text : '')) : '';
  schedEl('schedContent').placeholder = kind === 'ai' ? '随便跟我聊一句，或者发个可爱的表情包' : '早上好';
  schedSyncKindUi();
  schedMsg('schedEditorMsg', '');
  schedPreview();
}

function schedPreview() {
  clearTimeout(schedPreviewTimer);
  schedPreviewTimer = setTimeout(async () => {
    const p = schedPayload();
    if (!p) return;
    if (!['text', 'ai'].includes(p.kind)) {
      schedEl('schedPreview').textContent = '插件任务：到点由插件执行，这里只校验时间规则';
      schedEl('schedPreview').className = 'meta';
      return;
    }
    const r = await api('/api/scheduler/preview', 'POST', { schedule: p.schedule, timezone: p.timezone, count: 5, kind: p.kind, targets: p.targets, runDuringSilence: p.runDuringSilence });
    schedEl('schedPreview').textContent = r.ok
      ? `${r.scheduleText}。接下来：${r.next.length ? r.next.map((x) => x.text + (x.silenced ? `（处在定时静默「${x.silenced}」里，会跳过）` : '')).join('、') : '没有了（时间已过或规则不会再触发）'}`
      : '规则有问题：' + (r.error || '');
    schedEl('schedPreview').className = r.ok ? 'meta' : 'meta err';
  }, 250);
}

export function init() {
  // 先拼卡片外壳，再按规格把控件渲染出来，后面所有 schedEl(id) 才取得到节点。
  renderCards();
  renderSchedFieldGroups();
  // 开关是 <button role="switch">，点击委托必须显式绑；不绑就点不动（form.js 只在 createForm 里绑）。
  bindSwitches(document.getElementById('section-scheduler'));
  bindSwitches(schedEditorOverlay());
  // Esc / 点遮罩关闭时清掉编辑态，避免下次「新建」带着上一个任务的 id 走 PATCH。
  wireModal(schedEditorOverlay(), { onClose: () => { schedEditingId = null; } });
  schedEl('schedTargetPick').addEventListener('click', openSchedTargetPicker);
  document.getElementById('schedTaskTz').innerHTML = tzOptionsHtml(true);

  schedEl('schedType').addEventListener('change', () => {
    schedEl('schedFields').innerHTML = schedFieldsHtml(schedEl('schedType').value);
    initDateFields(schedEl('schedFields'));
    initTimeFields(schedEl('schedFields'));
    schedPreview();
  });
schedEl('schedEditor').addEventListener('input', (e) => { if (e.target.id !== 'schedContent' && e.target.id !== 'schedName') schedPreview(); });
schedEl('schedEditor').addEventListener('change', (e) => {
  if (e.target.name === 'schedKind') schedEl('schedContent').placeholder = e.target.value === 'ai' ? '随便跟我聊一句，或者发个可爱的表情包' : '早上好';
  if (e.target.id === 'schedPluginKind') schedSyncKindUi();
  if (e.target.id !== 'schedContent' && e.target.id !== 'schedName') schedPreview();
});
// 「＋ 新建任务」在表格工具栏里，随每次渲染重建，所以用委托。
schedEl('schedList').addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('#schedNew')) openSchedEditor(null);
});
schedEl('schedCancel').addEventListener('click', () => { closeModal(schedEditorOverlay()); schedEditingId = null; });
schedEl('schedSave').addEventListener('click', async () => {
  const payload = schedPayload();
  if (!payload) return;
  const r = schedEditingId == null
    ? await api('/api/scheduler/tasks', 'POST', payload)
    : await api(`/api/scheduler/tasks/${schedEditingId}`, 'PATCH', payload);
  if (!r.ok) { schedMsg('schedEditorMsg', '❌ ' + (r.error || '保存失败'), false); return; }
  schedMsg('schedEditorMsg', `✅ 已保存 #${r.task.id}${r.task.nextRunText ? '，下次 ' + r.task.nextRunText : ''}`, true);
  closeModal(schedEditorOverlay());
  schedEditingId = null;
  showConsoleToast(`定时任务 #${r.task.id} 已保存${r.task.nextRunText ? '，下次 ' + r.task.nextRunText : ''}`);  refreshScheduler();
});
schedEl('schedSettingsSave').addEventListener('click', async () => {
  const r = await api('/api/scheduler/settings', 'POST', {
    enabled: getSwitch(schedEl('schedEnabled')),
    allowAiPrivate: getSwitch(schedEl('schedAllowAiPrivate')),
    allowAiGroup: getSwitch(schedEl('schedAllowAiGroup')),
  });
  schedMsg('schedSettingsMsg', r.ok ? '✅ 已保存' : '❌ ' + (r.error || '保存失败'), r.ok);
  if (r.ok) refreshScheduler();
});
schedEl('schedLimitsSave').addEventListener('click', async () => {
  const limits = {};
  for (const [k] of SCHED_LIMIT_FIELDS) { const v = schedEl('schedLim_' + k).value; if (v !== '') limits[k] = Number(v); }
  limits.quietEnabled = getSwitch(schedEl('schedQuietEnabled'));
  limits.quietStart = schedEl('schedQuietStart').value.trim() || '00:00';
  limits.quietEnd = schedEl('schedQuietEnd').value.trim() || '07:00';
  const r = await api('/api/scheduler/settings', 'POST', { limits });
  schedMsg('schedLimitsMsg', r.ok ? '✅ 已保存（超出范围的值已自动收敛）' : '❌ ' + (r.error || '保存失败'), r.ok);
  if (r.ok) refreshScheduler();
});
schedEl('schedLimitsReset').addEventListener('click', async () => {
  if (!(await confirmBox({ message: '把安全限制恢复成默认值？', confirmText: '恢复默认' }))) return;
  const r = await api('/api/scheduler/settings', 'POST', { limits: schedState?.defaults?.limits || {} });
  schedMsg('schedLimitsMsg', r.ok ? '✅ 已恢复默认' : '❌ ' + (r.error || '失败'), r.ok);
  if (r.ok) refreshScheduler();
});

  // 直接打开 #scheduler 时，片段注入完成前路由器可能已经触发过一次 refresh。
  onPageRefresh('scheduler', () => setTimeout(() => refreshScheduler(), 0));
  setTimeout(() => refreshScheduler(), 0);
}
