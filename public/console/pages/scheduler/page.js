// 定时任务页：规则计算、限额、到点执行都在桥接（src/scheduler/），这里只负责编辑与展示。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { onPageRefresh } from '../../js/router.js';
import { tzOptionsHtml, tzSet } from '../../js/timezone.js';
import { bindSwitches, getSwitch, renderFields, setSwitch } from '../../components/form/form.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { SCHED_FIELDS } from './fields.js';

// ── 定时任务 ────────────────────────────────────────────────────────────────
// 规则的计算、限额、到点执行都在桥接（src/scheduler/）；这里只负责编辑和展示。
const SCHED_LIMIT_FIELDS = [
  ['maxTasks', '同时任务上限', '个'], ['perTaskPerDay', '单任务每天最多', '次'], ['totalPerDay', '全部每天最多', '条'],
  ['perGroupPerDay', '每个群每天最多', '条'], ['maxTargets', '单任务最多对象', '个'], ['minIntervalMin', '两次最小间隔', '分钟'],
  ['missedGraceMin', '错过多久内补发', '分钟'], ['jitterMin', '固定时间随机偏移', '± 分钟'], ['maxTextChars', '文字最长', '字'], ['maxInstructionChars', 'AI 说明最长', '字'],
];
const SCHED_WEEK = ['', '一', '二', '三', '四', '五', '六', '日'];
const SCHED_STATUS = { sent: ['已发送', 'pill g'], partial: ['部分发送', 'pill b'], skipped: ['已跳过', 'pill b'], failed: ['失败', 'pill r'], missed: ['错过', 'pill'], finished: ['已结束', 'pill'], invalid: ['规则无效', 'pill r'] };

let schedState = null;
let schedEditingId = null;
let schedPreviewTimer = null;
const schedEl = (id) => document.getElementById(id);
const schedSplit = (v) => String(v ?? '').split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);
function schedMsg(id, text, ok) { const el = schedEl(id); el.textContent = text; el.className = ok == null ? 'form-actions-status' : (ok ? 'form-actions-status ok' : 'form-actions-status err'); }

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
  if (document.activeElement !== schedEl('schedTimezone')) tzSet(schedEl('schedTimezone'), st.timezone);
  const pill = schedEl('schedStatePill');
  pill.textContent = st.enabled ? (r.writable === false ? '只读（数据文件读取失败）' : '运行中') : '已关闭';
  pill.className = st.enabled && r.writable !== false ? 'status-badge is-pill ok' : 'status-badge is-pill err';
  schedEl('schedLimits').innerHTML = SCHED_LIMIT_FIELDS.map(([k, label, unit]) => `<div><label for="schedLim_${k}">${esc(label)}（${esc(unit)}）</label><input type="number" id="schedLim_${k}" min="0" value="${esc(st.limits[k])}" title="默认 ${esc(r.defaults?.limits?.[k] ?? '')}"></div>`).join('');
  setSwitch(schedEl('schedQuietEnabled'), st.limits.quietEnabled);
  schedEl('schedQuietStart').value = st.limits.quietStart;
  schedEl('schedQuietEnd').value = st.limits.quietEnd;
  schedEl('schedCount').textContent = `${r.tasks.length} / ${st.limits.maxTasks}`;
  renderSchedPluginKinds();
  const targetLabel = (k) => (r.targets.find((t) => t.key === k)?.label) || k;
  const taskRows = r.tasks.map((t) => {
    const badges = [t.kindLabel ? `<span class="pill b">${esc(t.kindLabel)}</span>` : (t.kind === 'ai' ? '<span class="pill b">AI 来说</span>' : '<span class="pill">固定文字</span>'),
      `<span class="pill">来源：${esc({ console: '控制台', 'owner-command': '管理员命令', 'owner-chat-ai': '私聊 AI' }[t.createdBy] || t.createdBy)}</span>`,
      t.pendingConfirm ? '<span class="pill r">待你确认</span>' : ''].join(' ');
    const last = t.lastResult ? `<span class="${(SCHED_STATUS[t.lastResult] || ['', 'pill'])[1]}">${esc((SCHED_STATUS[t.lastResult] || [t.lastResult])[0])}</span>${t.lastReason ? `<div class="meta u-mt-2">${esc(t.lastReason)}</div>` : ''}` : '<span class="meta">—</span>';
    return [
      `<input type="checkbox" data-sched-toggle="${t.id}" ${t.enabled ? 'checked' : ''} aria-label="启用 #${t.id}">`,
      `<b>#${t.id} ${esc(t.name)}</b><div class="u-mt-4">${badges}</div><div class="meta u-mt-4">${esc(t.kind === 'ai' ? t.instruction : (t.kind === 'text' ? t.text : JSON.stringify(t.payload ?? {})))}</div>`,
      `${esc(t.scheduleText)}<div class="meta u-mt-2">${t.nextRunText ? '下次：' + esc(t.nextRunText) : '没有下一次'}${t.maxRuns ? `；已执行 ${t.runs} / ${t.maxRuns}` : ''}</div>`,
      t.targets.map((k) => `<span class="sched-chip u-cursor-default">${esc(targetLabel(k))}</span>`).join(''),
      last,
      `<div class="row-actions"><button type="button" class="btn small" data-sched-run="${t.id}" title="立即执行一次（计入今天的限额）">试发</button><button type="button" class="btn small" data-sched-edit="${t.id}">编辑</button><button type="button" class="btn small danger" data-sched-del="${t.id}">删</button></div>`,
    ];
  });
  schedEl('schedList').innerHTML = taskRows.length
    ? dataTableHtml({
      columns: [{ label: '启用', width: 64 }, { label: '任务' }, { label: '时间', width: 220 }, { label: '发给', width: 160 }, { label: '上次', width: 160 }, { label: '操作', width: 190 }],
      rows: taskRows,
      search: { placeholder: '搜索任务名或内容…' },
      refresh: true,
      empty: '没有匹配的任务。',
    })
    : '<div class="meta">还没有定时任务。点「＋ 新建任务」，或者在管理员私聊里发 /remind 看用法。</div>';
  if (taskRows.length) initDataTables(schedEl('schedList'), { onRefresh: () => refreshScheduler() });
  const historyRows = r.history.map((h) => {
    const [label, cls] = SCHED_STATUS[h.status] || [h.status, 'pill'];
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
    if (!res.ok) alert(res.error || '操作失败');
    refreshScheduler();
  }));
  schedEl('schedList').querySelectorAll('[data-sched-run]').forEach((b) => b.addEventListener('click', async () => {
    const res = await api(`/api/scheduler/tasks/${b.dataset.schedRun}/run`, 'POST', {});
    if (!res.ok) alert(res.error || '试发失败');
    else showConsoleToast(`#${b.dataset.schedRun} 试发：` + res.outcomes.map((o) => `${targetLabel(o.target)} ${(SCHED_STATUS[o.status] || [o.status])[0]}${o.reason ? '（' + o.reason + '）' : ''}`).join('；'));
    refreshScheduler();
  }));
  schedEl('schedList').querySelectorAll('[data-sched-edit]').forEach((b) => b.addEventListener('click', () => openSchedEditor(r.tasks.find((t) => String(t.id) === b.dataset.schedEdit))));
  schedEl('schedList').querySelectorAll('[data-sched-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`确定删除任务 #${b.dataset.schedDel}？`)) return;
    const res = await api(`/api/scheduler/tasks/${b.dataset.schedDel}`, 'DELETE', {});
    if (!res.ok) alert(res.error || '删除失败');
    refreshScheduler();
  }));
}

function schedFieldsHtml(type, s = {}) {
  const v = (x, d = '') => esc(x ?? d);
  const times = (s.times || ['09:00']).join(', ');
  const timesRow = `<div class="row"><span class="meta u-m-0">时间</span><input class="u-flex-basis-200" type="text" id="sf_times" value="${v(times)}" placeholder="06:00, 22:00"></div>`;
  const windowRow = (w) => `<div class="row"><span class="meta u-m-0">时间段</span><input type="time" id="sf_w0" value="${v((w || [])[0], '09:00')}"> 到 <input type="time" id="sf_w1" value="${v((w || [])[1], '22:00')}"></div>`;
  switch (type) {
    case 'once': return `<div class="row"><span class="meta u-m-0">日期和时间</span><input type="date" id="sf_date" value="${v(s.date)}"><input type="time" id="sf_time" value="${v(s.time, '09:00')}"></div>`;
    case 'daily': case 'workdays': return timesRow;
    case 'weekly': return `<div class="row">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="sched-chip u-m-0"><input type="checkbox" data-sf-wd="${d}" ${(s.weekdays || [1]).includes(d) ? 'checked' : ''}> 周${SCHED_WEEK[d]}</label>`).join('')}</div>${timesRow}`;
    case 'monthly': return `<div class="row"><span class="meta u-m-0">几号</span><input class="u-flex-basis-200" type="text" id="sf_days" value="${v((s.days || [1]).join(', '))}" placeholder="1, 15, -1（-1 = 最后一天）"></div>${timesRow}`;
    case 'monthlyWeekday': return `<div class="row"><span class="meta u-m-0">每月</span><select id="sf_nth">${[[1, '第 1 个'], [2, '第 2 个'], [3, '第 3 个'], [4, '第 4 个'], [5, '第 5 个'], [-1, '最后一个']].map(([n, l]) => `<option value="${n}" ${Number(s.nth ?? 1) === n ? 'selected' : ''}>${l}</option>`).join('')}</select><select id="sf_weekday">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}" ${Number(s.weekday ?? 6) === d ? 'selected' : ''}>周${SCHED_WEEK[d]}</option>`).join('')}</select></div>${timesRow}`;
    case 'yearly': return `<div class="row"><span class="meta u-m-0">日期</span><input class="u-flex-basis-200" type="text" id="sf_dates" value="${v((s.dates || ['01-01']).join(', '))}" placeholder="10-21, 12-25（MM-DD）"></div>${timesRow}`;
    case 'dates': return `<div class="meta">每行一条：YYYY-MM-DD HH:mm</div><textarea id="sf_items" rows="3" class="u-w-full">${v((s.items || []).map((x) => `${x.date} ${x.time}`).join('\n'))}</textarea>`;
    case 'everyNDays': return `<div class="row"><span class="meta u-m-0">从</span><input type="date" id="sf_start" value="${v(s.startDate)}"><span class="meta u-m-0">起，每</span><input class="u-flex-basis-max-80" type="number" id="sf_every" min="2" value="${v(s.every, 3)}"><span class="meta u-m-0">天</span></div>${timesRow}`;
    case 'interval': return `<div class="row"><span class="meta u-m-0">每</span><input class="u-flex-basis-max-90" type="number" id="sf_everyMin" min="10" value="${v(s.everyMinutes, 240)}"><span class="meta u-m-0">分钟</span></div>${windowRow(s.window || ['08:00', '23:00'])}`;
    case 'dailyRandom': return `<div class="row"><span class="meta u-m-0">每天</span><input class="u-flex-basis-max-80" type="number" id="sf_count" min="1" value="${v(s.count, 3)}"><span class="meta u-m-0">次，至少隔</span><input class="u-flex-basis-max-80" type="number" id="sf_gap" min="0" value="${v(s.minGapMin, 60)}"><span class="meta u-m-0">分钟</span></div>${windowRow(s.window)}`;
    case 'cron': return `<div class="row"><span class="meta u-m-0">表达式</span><input class="u-flex-basis-220-mono" type="text" id="sf_cron" value="${v(s.expr, '0 9 * * 1-5')}" placeholder="0 9 * * 1-5"></div>
      <div class="meta">5 段：分 时 日 月 周（周 0 和 7 都是周日，也可以写 MON-FRI）。例子：<code>0 9 * * 1-5</code> 工作日 9:00；<code>30 8 1 * *</code> 每月 1 号 8:30；<code>0 10,15 * * 6,0</code> 周末 10:00 和 15:00；<code>*/30 9-18 * * *</code> 9～18 点每半小时。日和周都限定时按「任一满足」。下面会实时显示接下来几次，写错会直接提示。cron 只能在控制台设置，AI 不能用。</div>`;
    case 'monthlyRandom': return `<div class="row"><span class="meta u-m-0">每月</span><input class="u-flex-basis-max-80" type="number" id="sf_mcount" min="1" value="${v(s.count, 4)}"><span class="meta u-m-0">次，限</span><input class="u-flex-basis-max-70" type="number" id="sf_d0" min="1" max="31" value="${v((s.dayRange || [])[0], 1)}"><span class="meta u-m-0">～</span><input class="u-flex-basis-max-70" type="number" id="sf_d1" min="1" max="31" value="${v((s.dayRange || [])[1], 28)}"><span class="meta u-m-0">号</span></div>${windowRow(s.window)}`;
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
  schedule.excludeHolidays = schedEl('schedSkipHolidays').checked;
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
    targets: [...document.querySelectorAll('[data-sched-target]')].filter((c) => c.checked).map((c) => c.dataset.schedTarget),
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

function renderSchedTargets(selected) {
  const r = schedState;
  schedEl('schedTargets').innerHTML = (r?.targets || []).map((t) => `<label class="sched-chip ${selected.includes(t.key) ? 'on' : ''} spaced"><input type="checkbox" data-sched-target="${esc(t.key)}" ${selected.includes(t.key) ? 'checked' : ''}> ${esc(t.label)}</label>`).join('')
    || '<span class="meta">没有可选的发送对象（白名单为空，且没配 ownerQQ）</span>';
  schedEl('schedTargets').querySelectorAll('[data-sched-target]').forEach((c) => c.addEventListener('change', () => c.parentElement.classList.toggle('on', c.checked)));
}

function openSchedEditor(task = null) {
  schedEditingId = task ? task.id : null;
  schedEl('schedEditor').hidden = false;
  schedEl('schedEditorTitle').textContent = task ? `编辑任务 #${task.id}` : '新建任务';
  const s = task?.schedule || { type: 'daily', times: ['09:00'] };
  schedEl('schedName').value = task?.name || '';
  tzSet(schedEl('schedTaskTz'), task?.timezone || '');
  schedEl('schedType').value = s.type;
  schedEl('schedFields').innerHTML = schedFieldsHtml(s.type, s);
  schedEl('schedStartDate').value = s.type === 'everyNDays' ? '' : (s.startDate || '');
  schedEl('schedEndDate').value = s.endDate || '';
  schedEl('schedExclude').value = (s.excludeDates || []).join(', ');
  schedEl('schedSkipHolidays').checked = !!s.excludeHolidays;
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
  schedEl('schedEditor').scrollIntoView({ block: 'nearest' });
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
  // 先按规格把控件渲染出来，后面所有 schedEl(id) 才取得到节点。
  renderSchedFieldGroups();
  // 开关是 <button role="switch">，点击委托必须显式绑；不绑就点不动（form.js 只在 createForm 里绑）。
  bindSwitches(document.getElementById('section-scheduler'));
  document.getElementById('schedTimezone').innerHTML = tzOptionsHtml(false);
  document.getElementById('schedTaskTz').innerHTML = tzOptionsHtml(true);

  schedEl('schedType').addEventListener('change', () => { schedEl('schedFields').innerHTML = schedFieldsHtml(schedEl('schedType').value); schedPreview(); });
schedEl('schedEditor').addEventListener('input', (e) => { if (e.target.id !== 'schedContent' && e.target.id !== 'schedName') schedPreview(); });
schedEl('schedEditor').addEventListener('change', (e) => {
  if (e.target.name === 'schedKind') schedEl('schedContent').placeholder = e.target.value === 'ai' ? '随便跟我聊一句，或者发个可爱的表情包' : '早上好';
  if (e.target.id === 'schedPluginKind') schedSyncKindUi();
  if (e.target.id !== 'schedContent' && e.target.id !== 'schedName') schedPreview();
});
schedEl('schedNew').addEventListener('click', () => openSchedEditor(null));
schedEl('schedCancel').addEventListener('click', () => { schedEl('schedEditor').hidden = true; schedEditingId = null; });
schedEl('schedSave').addEventListener('click', async () => {
  const payload = schedPayload();
  if (!payload) return;
  const r = schedEditingId == null
    ? await api('/api/scheduler/tasks', 'POST', payload)
    : await api(`/api/scheduler/tasks/${schedEditingId}`, 'PATCH', payload);
  if (!r.ok) { schedMsg('schedEditorMsg', '❌ ' + (r.error || '保存失败'), false); return; }
  schedMsg('schedEditorMsg', `✅ 已保存 #${r.task.id}${r.task.nextRunText ? '，下次 ' + r.task.nextRunText : ''}`, true);
  schedEl('schedEditor').hidden = true;
  schedEditingId = null;
  showConsoleToast(`定时任务 #${r.task.id} 已保存${r.task.nextRunText ? '，下次 ' + r.task.nextRunText : ''}`);
  refreshScheduler();
});
schedEl('schedSettingsSave').addEventListener('click', async () => {
  const r = await api('/api/scheduler/settings', 'POST', {
    enabled: getSwitch(schedEl('schedEnabled')),
    timezone: schedEl('schedTimezone').value || 'Asia/Shanghai',
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
  if (!confirm('把安全限制恢复成默认值？')) return;
  const r = await api('/api/scheduler/settings', 'POST', { limits: schedState?.defaults?.limits || {} });
  schedMsg('schedLimitsMsg', r.ok ? '✅ 已恢复默认' : '❌ ' + (r.error || '失败'), r.ok);
  if (r.ok) refreshScheduler();
});

  // 直接打开 #scheduler 时，片段注入完成前路由器可能已经触发过一次 refresh。
  onPageRefresh('scheduler', () => setTimeout(() => refreshScheduler(), 0));
  setTimeout(() => refreshScheduler(), 0);
}
