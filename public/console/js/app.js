// 页面入口：装配各个模块，再启动首屏。所有「能力」都在 ./api.js、./ui.js、./router.js 里，
// 这个文件只负责把数据、页面、事件接起来。
import { api, bootstrapConsoleToken } from './api.js';
import { esc, showConsoleToast, simpleTable, applyPageA11y } from './ui.js';
import { tzOptionsHtml, tzSet } from './timezone.js';
import { consolePages, getCurrentPage, initRouter, refreshCurrentPage, setConsolePage, setSearchCloser } from './router.js';
import { initPluginsPage } from './pages/plugins.js';

bootstrapConsoleToken();

// 上游静默时长的人话渲染：只用于 SnowLuma 健康提示（秒 / 分钟 / 小时）。
function fmtAgoMs(ms) {
  if (ms === null || ms === undefined || ms === '') return '未知';
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return '未知';
  if (n < 1000) return '刚刚';
  if (n < 60_000) return Math.round(n / 1000) + ' 秒';
  if (n < 3_600_000) return Math.round(n / 60_000) + ' 分钟';
  if (n < 86_400_000) return Math.round(n / 3_600_000) + ' 小时';
  return Math.round(n / 86_400_000) + ' 天';
}
// SnowLuma 上游健康：控制台是唯一的可视化出口（桥接侧只有日志）。
// 旧版桥接的 /api/status 没有 snowluma 字段，一律当「未知」处理，不抛错。
function renderSnowlumaHealth(sl) {
  const el = document.getElementById('snowlumaWarn');
  const strong = document.getElementById('metricSnowluma');
  const hint = document.getElementById('metricSnowlumaHint');
  if (!el || !strong || !hint) return;
  if (!sl || typeof sl !== 'object') {
    el.style.display = 'none';
    strong.textContent = '未知';
    strong.className = '';
    hint.textContent = '桥接未上报上游健康（旧版桥接）';
    return;
  }
  const degraded = sl.degraded === true;
  const connected = sl.connected === true;
  const ago = sl.lastPacketAgoMs;
  const receiving = Number.isFinite(ago);
  const goodText = sl.good === true ? 'good=true' : sl.good === false ? 'good=false' : 'good 未知';
  if (degraded) {
    strong.textContent = '已连接 · 未接收';
    strong.className = 'err';
    hint.textContent = '网关连着，但 QQ 侧数据没到';
  } else if (!connected) {
    strong.textContent = '未连接';
    strong.className = 'err';
    hint.textContent = '连不上 QQ 网关，请先启动 SnowLuma';
  } else {
    strong.textContent = '正常 · 接收中';
    strong.className = 'ok';
    hint.textContent = (receiving ? '最近一份上游事件包在 ' + fmtAgoMs(ago) + '前 · ' : '')
      + (sl.good === false ? 'good=false' : sl.good === true ? 'good=true' : 'good 未上报');
  }
  if (!degraded) { el.style.display = 'none'; return; }
  document.getElementById('snowlumaWarnHint').textContent = sl.hint
    || '桥接与 QQ 网关的 WebSocket 连着，但一直收不到 QQ 侧的数据。';
  document.getElementById('snowlumaWarnPkt').textContent = (receiving ? fmtAgoMs(ago) + '前' : '从未收到')
    + (sl.lastPacketKind ? '（' + sl.lastPacketKind + '）' : '');
  document.getElementById('snowlumaWarnGood').textContent = goodText;
  el.style.display = '';
}

async function refresh() {
  try {
    const s = await api('/api/status');
    document.querySelectorAll('#modeRow button').forEach(b => (b.classList.toggle('active', b.dataset.mode === s.mode), b.setAttribute('aria-pressed', String(b.dataset.mode === s.mode))));
    const modeLabel = s.mode === 'reserved' ? '一代仿真模式' : s.mode === 'reserved2' ? '二代仿真模式' : s.mode === 'closed-agent' ? '封闭 Agent' : '聊天模式';
    updateOverview(s, s.mode === 'closed-agent' && s.level ? `${modeLabel}（${s.level}）` : modeLabel);
    const adminEl = document.getElementById('adminStatus');
    if (adminEl) adminEl.textContent = `当前级别 ${s.level || 'L0'}；待确认申请 ${s.adminPendingRequests ?? 0}；待审批 ${s.pendingApprovals ?? 0}`;
    const levelSel = document.getElementById('closedLevel');
    if (levelSel && s.mode === 'closed-agent' && s.level && document.activeElement !== levelSel) levelSel.value = s.level;
    document.getElementById('activity').textContent = s.activity || '（空）';
    renderSendLimitHits(s.sendLimit);
    const presetSel = document.getElementById('closedPreset');
    if (presetSel && document.activeElement !== presetSel) presetSel.value = s.closedAgentPreset || '';
  } catch (e) { document.getElementById('statusText').textContent = '连接中断 · 请检查桥接服务'; setConnectionError(e); }
}

async function refreshPresets() {
  try {
    const r = await api('/api/presets');
    const sel = document.getElementById('closedPreset');
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
    refresh();
  } catch {}
}

async function saveMode(mode) {
  // 不再硬编码 'router-standard'（DSH 0.1.5 已无此 preset）；
  // 留空表示让桥接使用 DSH 自己声明的默认 preset。
  const preset = document.getElementById('closedPreset').value || '';
  const body = { mode, closedAgentPreset: preset };
  if (mode === 'closed-agent') {
    body.level = document.getElementById('closedLevel').value || 'L2';
    if (body.level === 'L3') {
      const code = prompt('L3 高权限需要验证器上的 6 位动态码（TOTP）：');
      if (!code) return { ok: false };
      body.totp = code.trim();
    }
  }
  const r = await api('/api/mode', 'POST', body);
  if (r.ok) {
    refresh();
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
function dshSelectedProvider() { return dshProviders().find((p) => p.id === document.getElementById('dshProviderSelect').value) || null; }
function dshSelectedEntry() {
  const p = dshSelectedProvider();
  return p ? (p.models || []).find((m) => m.id === document.getElementById('dshModelSelect').value) || null : null;
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
  dshFillSelect(document.getElementById('dshModelSelect'), items, preferred ?? r.model);
}
function dshFillEfforts(preferred) {
  const r = dshModelState || {};
  const select = document.getElementById('dshEffortSelect');
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
  const provider = document.getElementById('dshProviderSelect').value;
  const entry = dshSelectedEntry();
  const effort = document.getElementById('dshEffortSelect').value;
  const vision = document.getElementById('dshVisionSelect').value;
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
  const box = document.getElementById('dshModelNotices');
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
    document.getElementById('dshModelText').textContent = r.model || '-';
    document.getElementById('dshProviderText').textContent = r.provider || '-';
    const providers = dshProviders();
    const providerItems = providers.length
      ? providers.map((p) => ({ value: p.id, label: `${p.name}${p.name !== p.id ? `（${p.id}）` : ''}${p.thirdParty ? ' · 第三方' : ''}` }))
      : [{ value: r.provider || '', label: r.provider || '-' }];
    dshFillSelect(document.getElementById('dshProviderSelect'), providerItems, r.provider);
    dshFillModels(r.model);
    dshFillEfforts(r.reasoningEffort);
    document.getElementById('dshVisionSelect').value = r.vision || 'auto';
    dshRenderNotices(r.notices || dshPreviewNotices());
    const modelCount = providers.reduce((n, p) => n + (p.models || []).length, 0);
    const parts = [];
    if (r.catalogSource === 'dsh') parts.push(`选项取自 DSH 的模型目录（${providers.length} 个提供方 / ${modelCount} 个模型）`);
    else parts.push(`目录不可用${r.catalogError ? '（' + r.catalogError + '）' : ''}：只显示当前配置和内置档位，暂时不能切换模型`);
    if (r.providerDefault) parts.push(`当前模型的默认强度是 ${r.providerDefault}`);
    if ((r.failures || []).length) parts.push('读取失败的提供方：' + r.failures.map((f) => `${f.name || f.id}（${f.message}）`).join('、'));
    document.getElementById('dshEffortNote').textContent = parts.join('；') + '。';
    document.getElementById('dshEffortSideEffect').textContent = r.globalSideEffect
      ? '注意：切换会同时写入 DSH 的全局默认（~/.dsh/settings.yaml 的 agent-default-model），也就是 Web GUI 里新建会话的默认模型和强度也会跟着变。'
      : '';
    document.getElementById('dshEffortMsg').textContent = '';
  } catch (error) {
    document.getElementById('dshEffortMsg').textContent = '读取失败：' + (error?.message ?? error);
  }
}
document.getElementById('dshProviderSelect').addEventListener('change', () => { dshFillModels(); dshFillEfforts(); dshRenderNotices(dshPreviewNotices()); });
document.getElementById('dshModelSelect').addEventListener('change', () => { dshFillEfforts(); dshRenderNotices(dshPreviewNotices()); });
document.getElementById('dshEffortSelect').addEventListener('change', () => dshRenderNotices(dshPreviewNotices()));
document.getElementById('dshVisionSelect').addEventListener('change', () => dshRenderNotices(dshPreviewNotices()));
document.getElementById('dshCatalogRefresh').addEventListener('click', () => refreshDshModel(true));

async function refreshSessions() {
  try {
    const s = await api('/api/sessions');
    const box = document.getElementById('sessionList');
    document.getElementById('metricSessions').textContent = s.sessions.length;
    if (!s.sessions.length) { box.innerHTML = '<div class="empty-state"><strong>还没有会话</strong><p>白名单中的群或好友发来消息后，会话会显示在这里。</p></div>'; return; }
    let html = '<table><tr><th>QQ 会话</th><th>DSH 会话 ID</th><th>类型</th><th></th></tr>';
    for (const x of s.sessions) {
      const isP = x.key.startsWith('private:');
      const type = isP ? '<span class="pill b">私聊</span>' : '<span class="pill g">群</span>';
      const ownerTag = x.owner ? ' <span class="pill r">管理员</span>' : '';
      html += `<tr><td>${esc(x.key)}${ownerTag}</td><td><code>${esc(x.sessionId)}</code></td><td>${type}</td><td><button class="small" data-reset-key="${esc(x.key)}">清除上下文</button></td></tr>`;
    }
    box.innerHTML = html + '</table>';
    box.querySelectorAll('[data-reset-key]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('确定清除该会话的上下文？下次消息将开新会话。')) return;
      const r = await api('/api/session/reset', 'POST', { key: btn.dataset.resetKey });
      alert(r.ok ? '✅ 已清除上下文' : ('❌ ' + (r.error || '失败')));
      refreshSessions();
    }));
  } catch {}
}

async function refreshPending() {
  try {
    const p = await api('/api/pending');
    const box = document.getElementById('pendingList');
    document.getElementById('metricPending').textContent = p.pending.length;
    document.getElementById('pendingCount').textContent = p.pending.length;
    if (!p.pending.length) { box.innerHTML = '<div class="empty-state"><strong>暂时没有待处理请求</strong><p>AI 的提问或工具审批会出现在这里，请前往对应 QQ 会话回复。</p></div>'; return; }
    let html = '<table><tr><th>会话</th><th>类型</th><th>详情</th></tr>';
    for (const x of p.pending) {
      const kind = x.kind === 'approval' ? '<span class="pill r">审批</span>' : '<span class="pill b">提问</span>';
      let detail = '';
      if (x.kind === 'approval') detail = `${esc(x.toolName)}${x.reason ? '：' + esc(x.reason) : ''}`;
      else if (x.questions) detail = x.questions.map(q => esc(q.question)).join(' / ');
      html += `<tr><td>${esc(x.key)}</td><td>${kind}</td><td>${detail}</td></tr>`;
    }
    box.innerHTML = html + '</table>';
  } catch {}
}

document.querySelectorAll('#modeRow button').forEach(b => b.addEventListener('click', async () => {
  if (b.disabled) return;
  await saveMode(b.dataset.mode);
}));
document.getElementById('adminPanic').addEventListener('click', async () => {
  if (!confirm('立即回到安全模式（L0 群友模式）？进行中的高权限会话会被停止。')) return;
  const r = await api('/api/admin/panic', 'POST', {});
  if (!r.ok) alert(r.error || '紧急关闭失败，请直接停止桥接进程');
  refresh();
});
document.getElementById('closedPreset').addEventListener('change', async () => {
  // 切换预设立即保存（若当前是 closed-agent 则即时生效，否则供下次切换使用）
  const active = document.querySelector('#modeRow button.active');
  const mode = active ? active.dataset.mode : 'chat';
  await saveMode(mode);
});
// ── DSH 模型保存 ────────────────────────────────────────────────────────────
document.getElementById('dshEffortSave').addEventListener('click', async () => {
  const msg = document.getElementById('dshEffortMsg');
  const payload = {
    provider: document.getElementById('dshProviderSelect').value,
    model: document.getElementById('dshModelSelect').value,
    reasoningEffort: document.getElementById('dshEffortSelect').value,
    vision: document.getElementById('dshVisionSelect').value,
  };
  // 第一次换到第三方提供方：保存前再确认一次隐私
  if (!DSH_FIRST_PARTY.includes(payload.provider) && payload.provider !== dshModelState?.provider
    && !confirm(`${payload.provider} 不是 DeepSeek 自家的提供方。保存后，QQ 里的聊天内容（群友消息、图片、人格卡、记忆）会发给它处理。确定要切换吗？`)) return;
  msg.textContent = '保存中…';
  msg.className = 'meta';
  const r = await api('/api/dsh/model', 'POST', payload);
  msg.textContent = r.ok ? `✅ 已设为 ${r.provider}/${r.model}（${r.reasoningEffort || '模型默认强度'}），下一条消息生效` : ('❌ ' + (r.error || '保存失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) { await refreshDshModel(); msg.textContent = `✅ 已设为 ${r.provider}/${r.model}（${r.reasoningEffort || '模型默认强度'}），下一条消息生效`; msg.className = 'meta ok'; }
});
document.getElementById('silentOn').addEventListener('click', async () => { await api('/api/role-mode', 'POST', { mode: 'silent' }); refresh(); refreshSilence(); });
document.getElementById('silentOff').addEventListener('click', async () => {
  const r = await api('/api/role-mode', 'POST', { mode: 'active' });
  if (r.resumedScheduled) showConsoleToast(`定时静默「${r.resumedScheduled.name}」这一段临时恢复，到 ${r.resumedScheduled.untilText}；下一段照常静默`);
  refresh(); refreshSilence();
});
// 直接打开 #scheduler 时路由器可能先于定时任务那段脚本执行：推到下一个宏任务再刷新。
function updateOverview(status, modeLabel) {
  const connection = document.getElementById('statusText');
  connection.textContent = status.dshReady ? 'DSH 已连接' : 'DSH 未连接';
  connection.className = 'status-badge ' + (status.dshReady ? 'online' : 'offline');
  document.getElementById('metricDsh').textContent = status.dshReady ? '已连接' : '未连接';
  document.getElementById('metricDsh').className = status.dshReady ? 'ok' : 'err';
  document.getElementById('metricDshHint').textContent = status.dshReady ? '桥接状态已同步' : '请检查 DSH 是否运行';
  renderSnowlumaHealth(status.snowluma);
  document.getElementById('metricMode').textContent = modeLabel.replace('模式', '');
  document.getElementById('metricRole').textContent = '角色 · ' + (status.role || '默认人格');
  document.getElementById('accessSummary').textContent = '管理员 ' + (status.ownerQQ || '未设置') + ' · ' + (status.allowGroups || []).length + ' 个白名单群 · ' + (status.allowPrivate || []).length + ' 位白名单好友';
  document.getElementById('lastUpdated').textContent = '状态同步于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
  document.getElementById('connectionAlert').hidden = true;
  const silent = status.roleMode === 'silent';
  for (const [id, active] of [['silentOn', silent], ['silentOff', !silent]]) {
    const button = document.getElementById(id);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
function setConnectionError(error) {
  document.getElementById('statusText').className = 'status-badge offline';
  document.getElementById('metricDsh').textContent = '连接中断';
  document.getElementById('metricDsh').className = 'err';
  document.getElementById('metricDshHint').textContent = '当前状态可能已过期';
  // 上游健康也一起过期：桥接都联系不上时，别让上一次的 SnowLuma 结论继续挂着。
  document.getElementById('metricSnowluma').textContent = '未知';
  document.getElementById('metricSnowluma').className = '';
  document.getElementById('metricSnowlumaHint').textContent = '当前状态可能已过期';
  document.getElementById('snowlumaWarn').style.display = 'none';
  const alert = document.getElementById('connectionAlert');
  alert.textContent = error.message === '未授权' ? '访问令牌无效或已取消输入。请使用启动日志中的控制台链接重新打开。' : '无法连接桥接服务，当前显示的是上次同步结果。请检查桥接是否运行，再点击右上角刷新。';
  alert.hidden = false;
}
document.getElementById('refreshConsole').addEventListener('click', async function () {
  this.disabled = true;
  await Promise.allSettled([refresh(), refreshSessions(), refreshPending(), Promise.resolve(refreshCurrentPage())]);
  this.disabled = false;
  if (document.getElementById('connectionAlert').hidden) showConsoleToast('运行状态已刷新');
});

applyPageA11y();
document.getElementById('section-mode').querySelector('h2').dataset.note = '选择后即时生效';
document.getElementById('section-activity').querySelector('h2').dataset.note = '每 3 秒自动同步';

const searchInput = document.getElementById('consoleSearch');
const searchResults = document.getElementById('searchResults');
// 候选框挂到 body：`.page-heading` 带 transform，会把候选框锁在它的层叠上下文里（B3）。
if (searchResults && searchResults.parentElement !== document.body) document.body.appendChild(searchResults);
function positionConsoleSearch() {
  if (!searchResults || searchResults.hidden) return;
  const rect = searchInput.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 24);
  searchResults.style.width = `${width}px`;
  searchResults.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
  searchResults.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 80)}px`;
}
window.addEventListener('resize', positionConsoleSearch);
document.addEventListener('scroll', positionConsoleSearch, true);
// 搜索索引按需重建：片段页（pages/<id>/page.html）在首次进入时才注入 DOM，
// 启动时扫一次会漏掉它们，也会在空 section 上踩到「没有 h2」。
function buildFeatureIndex() {
  const index = [];
  const seen = new Set();
  document.querySelectorAll('section[data-page]').forEach(section => {
    const heading = section.querySelector('h2');
    if (!heading) return;
    const page = section.dataset.page;
    seen.add(page);
    index.push({ page, label: heading.textContent, target: section });
    section.querySelectorAll('details.settings-group>summary,input,textarea,select').forEach(el => {
      let label = el.tagName === 'SUMMARY' ? el.textContent : (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.placeholder);
      if (label) index.push({ page, label: label.trim(), target: el });
    });
  });
  // 未注入的片段页也要能搜到（否则「没打开过就搜不到」）：用页面表里的大标题与说明兜底，
  // 只是没有字段级条目——点进去后页面加载完，再搜就有细项了。
  for (const [page, meta] of Object.entries(consolePages)) {
    if (seen.has(page)) continue;
    index.push({ page, label: `${meta[1]} ${meta[2]}`, target: document.getElementById(`section-${page}`) });
  }
  return index;
}
function closeConsoleSearch() { searchResults.hidden = true; searchInput.setAttribute('aria-expanded','false'); }
setSearchCloser(closeConsoleSearch);
searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim().toLowerCase();
  searchResults.replaceChildren();
  if (!query) return closeConsoleSearch();
  const matches = buildFeatureIndex().filter(entry => (consolePages[entry.page][0] + entry.label + entry.target.id).toLowerCase().includes(query)).slice(0,12);
  if (!matches.length) { const empty = document.createElement('p'); empty.textContent = '未找到匹配功能，试试「唤醒」「白名单」或「表情」。'; searchResults.append(empty); }
  matches.forEach(entry => {
    const button = document.createElement('button');
    const title = document.createElement('span'); title.textContent = entry.label;
    const caption = document.createElement('small'); caption.textContent = consolePages[entry.page][0];
    button.append(title,caption);
    button.addEventListener('click', () => {
      setConsolePage(entry.page);
      let ancestor = entry.target.closest('details');
      while (ancestor) { ancestor.open = true; ancestor = ancestor.parentElement.closest('details'); }
      // 黑话分栏的切换由 pages/slang/page.js 绑定：这里点对应的 tab，避免 app.js 反向依赖页面模块。
      const slangPanel = entry.target.closest('.slang-panel');
      if (slangPanel) {
        const panels = { slangPanelCandidate: 'candidate', slangPanelConfirmed: 'confirmed', slangPanelRejected: 'rejected' };
        document.querySelector(`.slang-tab[data-slang-tab="${panels[slangPanel.id]}"]`)?.click();
      }
      entry.target.scrollIntoView({ block:'center', behavior:'instant' });
      if (!entry.target.hasAttribute('tabindex') && !entry.target.matches('input,textarea,select,button,summary')) entry.target.tabIndex = -1;
      entry.target.focus({ preventScroll:true });
      entry.target.classList.add('search-highlight');
      setTimeout(() => entry.target.classList.remove('search-highlight'), 2000);
    });
    searchResults.append(button);
  });
  searchResults.hidden = false;
  searchInput.setAttribute('aria-expanded','true');
  positionConsoleSearch();
});
searchInput.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeConsoleSearch();
  if ((event.key === 'ArrowDown' || event.key === 'Enter') && !searchResults.hidden) { event.preventDefault(); searchResults.querySelector('button')?.focus(); }
});
document.addEventListener('click', event => { if (!event.target.closest('.search-wrap') && !searchResults.contains(event.target)) closeConsoleSearch(); });
searchResults.addEventListener('keydown', event => { if (event.key === 'Escape') { closeConsoleSearch(); searchInput.focus(); } });

// 「显示令牌」按钮随访问与安全页一起搬到 pages/access/page.js（它挂在 #consoleTokenInput 后面，
// 而那个输入框现在由页面片段注入——留在这里会在启动时对 null 调 .after()）。
// 首屏恢复在 router.js 的 initRouter() 里（文件末尾统一调用）。


// ── 定时静默（运行总览 → 静默开关） ─────────────────────────────────────────
// 判断、执行都在桥接（src/silence-schedule.js）；这里只负责编辑和展示。
const SILENCE_W = ['', '一', '二', '三', '四', '五', '六', '日'];
let silenceState = null;
let silenceDraft = [];
document.getElementById('silenceTz').innerHTML = tzOptionsHtml(false);
const silEl = (id) => document.getElementById(id);

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
  const box = silEl('silenceRanges');
  if (!silenceDraft.length) { box.innerHTML = '<div class="meta">还没有时间段。点「＋ 添加时间段」，或者「一键填入 DeepSeek 高峰时段」。</div>'; return; }
  box.innerHTML = `<div class="silence-row h"><span>启用</span><span>名称</span><span>时间段</span><span>哪些天</span><span></span></div>` + silenceDraft.map((r) => `
    <div class="silence-row ${r.enabled ? '' : 'off'}" data-sil-row="${esc(r.id || '')}">
      <label class="sched-chip" style="margin:0"><input type="checkbox" data-sil="enabled" ${r.enabled ? 'checked' : ''}> 启用</label>
      <input type="text" data-sil="name" value="${esc(r.name || '')}" placeholder="上午高峰">
      <div class="row" style="gap:6px;flex-wrap:nowrap"><input type="time" data-sil="start" value="${esc(r.start)}"><span>–</span><input type="time" data-sil="end" value="${esc(r.end)}"></div>
      <div class="row" style="gap:6px">
        <select data-sil="days">${[['every', '每天'], ['workdays', '工作日'], ['weekend', '周末'], ['custom', '自选']].map(([v, l]) => `<option value="${v}" ${r.days === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <span data-sil-custom ${r.days === 'custom' ? '' : 'hidden'}>${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="sched-chip ${(r.weekdays || []).includes(d) ? 'on' : ''}" style="margin:0 2px 0 0;padding:2px 7px"><input type="checkbox" data-sil-wd="${d}" ${(r.weekdays || []).includes(d) ? 'checked' : ''}> ${SILENCE_W[d]}</label>`).join('')}</span>
        <label class="sched-chip" style="margin:0"><input type="checkbox" data-sil="skipHolidays" ${r.skipHolidays ? 'checked' : ''}> 跳过法定节假日</label>
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
  silEl('silenceEnabled').checked = !!r.config.enabled;
  tzSet(silEl('silenceTz'), r.config.timezone);
  document.querySelectorAll('[data-silence-opt]').forEach((c) => { c.checked = !!r.config.options[c.dataset.silenceOpt]; });
  const tier = r.config.options.stopWakes === false ? 'normal' : (r.config.options.directWakes ? 'direct' : 'stop');
  document.querySelectorAll('input[name="silenceWakeTier"]').forEach((c) => { c.checked = c.value === tier; });
  renderSilenceRanges();
  const pill = silEl('silenceStatePill');
  if (r.manual) { pill.textContent = '静默中 · 手动'; pill.className = 'pill r'; }
  else if (r.active) { pill.textContent = `静默中 · 定时（${r.active.name}），到 ${r.active.untilText}`; pill.className = 'pill r'; }
  else if (r.override) { pill.textContent = `正常 · 本段已临时恢复，到 ${r.override.untilText}`; pill.className = 'pill b'; }
  else { pill.textContent = '正常'; pill.className = 'pill g'; }
  const up = (r.upcoming || []).slice(0, 4).map((x) => `${x.name} ${x.startText.replace(/（.*）/, '')}–${x.endText.slice(11)}`);
  silEl('silenceUpcoming').textContent = r.config.enabled
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

silEl('silenceAdd').addEventListener('click', () => {
  silenceDraft = readSilenceRows();
  silenceDraft.push({ id: '', name: '', enabled: true, start: '12:00', end: '14:00', days: 'every', weekdays: [], skipHolidays: false });
  renderSilenceRanges();
});
silEl('silencePeak').addEventListener('click', () => {
  const preset = silenceState?.peakPreset || [];
  // 已经有同一时间、同样「哪些天」的时间段就不再重复添加（保存后 id 会变，不能只按 id 判断）
  const keep = readSilenceRows();
  const same = (a, b) => a.start === b.start && a.end === b.end && a.days === b.days;
  const added = preset.filter((p) => !keep.some((x) => same(x, p)));
  silenceDraft = [...keep, ...added.map((p) => ({ ...p }))];
  if (silEl('silenceTz').value !== 'Asia/Shanghai') tzSet(silEl('silenceTz'), 'Asia/Shanghai');
  renderSilenceRanges();
  silEl('silenceMsg').textContent = added.length ? `已填入 ${added.length} 个高峰时段（北京时间），确认后点「保存定时静默」` : '高峰时段已经都在列表里了';
  silEl('silenceMsg').className = 'meta';
});
silEl('silenceSave').addEventListener('click', async () => {
  const options = {};
  document.querySelectorAll('[data-silence-opt]').forEach((c) => { options[c.dataset.silenceOpt] = c.checked; });
  const tier = document.querySelector('input[name="silenceWakeTier"]:checked')?.value || 'stop';
  options.stopWakes = tier !== 'normal';
  options.directWakes = tier === 'direct';
  const r = await api('/api/silence', 'POST', { enabled: silEl('silenceEnabled').checked, timezone: silEl('silenceTz').value, ranges: readSilenceRows(), options });
  silEl('silenceMsg').textContent = r.ok ? '✅ 已保存' : '❌ ' + (r.error || '保存失败');
  silEl('silenceMsg').className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) { silenceState = r; silenceDraft = r.config.ranges.map((x) => ({ ...x })); renderSilence(); }
});
setInterval(() => { if (getCurrentPage() === 'overview') refreshSilence(); }, 60_000);
// ── 发言上限（二代 socialV2.send.maxSendPerMinute / maxSendPerHour）────────────
async function loadSendLimit() {
  const r = await api('/api/socialV2/config');
  const send = (r && (r.config || r).send) || {};
  for (const [id, k, d] of [['sendLimitMin', 'maxSendPerMinute', 8], ['sendLimitHour', 'maxSendPerHour', 60]]) {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = send[k] ?? d;
  }
}
function renderSendLimitHits(x) {
  const el = document.getElementById('sendLimitHits');
  if (!el) return;
  if (!x) { el.textContent = '最近 24 小时没有被拦过'; el.className = 'meta'; return; }
  el.textContent = `⚠️ 最近 24 小时被拦了 ${x.count} 次（${x.keys} 个会话；最近一次 ${new Date(x.lastAt).toLocaleTimeString()}，${x.lastKey}）。AI 经常一次发好几条的话，可以把上限调高一点`;
  el.className = 'meta err';
}
document.getElementById('sendLimitSave').addEventListener('click', async () => {
  const send = { maxSendPerMinute: Math.max(0, Math.round(Number(document.getElementById('sendLimitMin').value) || 0)), maxSendPerHour: Math.max(0, Math.round(Number(document.getElementById('sendLimitHour').value) || 0)) };
  const r = await api('/api/socialV2/config', 'POST', { send });
  const msg = document.getElementById('sendLimitMsg');
  msg.textContent = r.ok === false ? '❌ ' + (r.error || '保存失败') : '✅ 已保存';
  msg.className = r.ok === false ? 'meta err' : 'meta ok';
  // 二代仿真页下次进入时会通过 onPageRefresh 重新读取这组发送限制。
});
loadSendLimit();

// 「扩展」下的三个只读页：技能 / MCP / 管理行为。数据都来自只读接口，页面不做任何写操作。
refresh(); refreshSessions(); refreshPending(); refreshPresets(); refreshDshModel(); refreshSilence();
setInterval(() => { refresh(); refreshSessions(); refreshPending(); }, 3000);
// 主题切换（纯前端，不发任何请求；选择写入 localStorage，未选择时跟随系统）
(function () {
  var root = document.documentElement;
  var button = document.getElementById('themeToggle');
  var media = window.matchMedia('(prefers-color-scheme: dark)');
  function stored() {
    try { return localStorage.getItem('qq-console-theme'); } catch (error) { return null; }
  }
  function apply(theme, persist) {
    root.dataset.theme = theme;
    if (persist) { try { localStorage.setItem('qq-console-theme', theme); } catch (error) {} }
    var dark = theme === 'dark';
    button.textContent = dark ? '☀' : '☾';
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? '切换浅色模式' : '切换深色模式');
    button.title = dark ? '切换到浅色主题' : '切换到深色主题';
  }
  apply(root.dataset.theme === 'dark' ? 'dark' : 'light', false);
  button.addEventListener('click', function () {
    apply(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });
  media.addEventListener('change', function (event) {
    if (!stored()) apply(event.matches ? 'dark' : 'light', false);
  });
})();

initPluginsPage();
// 所有页面模块就绪后再接管路由（首屏恢复也在这里）。
initRouter();
