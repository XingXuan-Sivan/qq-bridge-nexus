// 页面入口：装配各个模块，再启动首屏。所有「能力」都在 ./api.js、./ui.js、./router.js 里，
// 这个文件只负责把数据、页面、事件接起来。
import { api, bootstrapConsoleToken } from './api.js';
import { showConsoleToast, applyPageA11y } from './ui.js';
import { consolePages, getCurrentPage, initRouter, refreshCurrentPage, setConsolePage, setSearchCloser } from './router.js';
import { setMsg } from '../components/message/message.js';

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
  // 这三个节点分属不同的页面片段：#snowlumaWarn 在 access，两个指标卡在 overview。
  // 谁在就更新谁，不能因为另一个页面没打开就整体早退（否则指标卡永远停在「读取中」）。
  const el = document.getElementById('snowlumaWarn');
  const strong = document.getElementById('metricSnowluma');
  const hint = document.getElementById('metricSnowlumaHint');
  if (!strong && !hint && !el) return;
  let strongText;
  let strongClass = '';
  let hintText;
  if (!sl || typeof sl !== 'object') {
    strongText = '未知';
    hintText = '桥接未上报上游健康（旧版桥接）';
  } else {
    const degraded = sl.degraded === true;
    const connected = sl.connected === true;
    const ago = sl.lastPacketAgoMs;
    const receiving = Number.isFinite(ago);
    if (degraded) {
      strongText = '已连接 · 未接收';
      strongClass = 'err';
      hintText = '网关连着，但 QQ 侧数据没到';
    } else if (!connected) {
      strongText = '未连接';
      strongClass = 'err';
      hintText = '连不上 QQ 网关，请先启动 SnowLuma';
    } else {
      strongText = '正常 · 接收中';
      strongClass = 'ok';
      hintText = (receiving ? '最近一份上游事件包在 ' + fmtAgoMs(ago) + '前 · ' : '')
        + (sl.good === false ? 'good=false' : sl.good === true ? 'good=true' : 'good 未上报');
    }
    if (strong) { strong.textContent = strongText; strong.className = strongClass; }
    if (hint) hint.textContent = hintText;
    if (!el) return;
    if (!degraded) { el.hidden = true; return; }
    el.hidden = false;
    const warnHint = document.getElementById('snowlumaWarnHint');
    if (warnHint) warnHint.textContent = sl.hint || '桥接与 QQ 网关的 WebSocket 连着，但一直收不到 QQ 侧的数据。';
    const warnPkt = document.getElementById('snowlumaWarnPkt');
    if (warnPkt) warnPkt.textContent = (receiving ? fmtAgoMs(ago) + '前' : '从未收到') + (sl.lastPacketKind ? '（' + sl.lastPacketKind + '）' : '');
    const warnGood = document.getElementById('snowlumaWarnGood');
    if (warnGood) warnGood.textContent = sl.good === true ? 'good=true' : sl.good === false ? 'good=false' : 'good 未知';
    return;
  }
  if (strong) { strong.textContent = strongText; strong.className = strongClass; }
  if (hint) hint.textContent = hintText;
  if (el) el.hidden = true;
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
    const activityEl = document.getElementById('activity');
    if (activityEl) activityEl.textContent = s.activity || '（空）';
    renderSendLimitHits(s.sendLimit);
    const presetSel = document.getElementById('closedPreset');
    if (presetSel && document.activeElement !== presetSel) presetSel.value = s.closedAgentPreset || '';
  } catch (e) {
    const status = document.getElementById('statusText');
    if (status) status.textContent = '连接中断 · 请检查桥接服务';
    setConnectionError(e);
  }
}


// 会话映射与挂起审批的详情已搬进 pages/sessions/。这里只保留概览指标与导航角标的全局轮询：
// 会话页可见时由页面模块刷新（避免重复请求）；其它页面由这里补上，且元素不存在时安全跳过。
async function refreshSessionMetrics() {
  if (getCurrentPage() === 'sessions') return;
  try {
    const [s, p] = await Promise.all([api('/api/sessions'), api('/api/pending')]);
    const sessionsEl = document.getElementById('metricSessions');
    if (sessionsEl) sessionsEl.textContent = s.sessions.length;
    const pendingEl = document.getElementById('metricPending');
    if (pendingEl) pendingEl.textContent = p.pending.length;
    const countEl = document.getElementById('pendingCount');
    if (countEl) countEl.textContent = p.pending.length;
  } catch {}
}

function updateOverview(status, modeLabel) {
  // 这里写的节点有的常驻 index.html，有的只在 overview 片段里；逐个判空。
  const connection = document.getElementById('statusText');
  if (connection) {
    connection.textContent = status.dshReady ? 'DSH 已连接' : 'DSH 未连接';
    connection.className = 'status-badge ' + (status.dshReady ? 'online' : 'offline');
  }
  const dsh = document.getElementById('metricDsh');
  if (dsh) {
    dsh.textContent = status.dshReady ? '已连接' : '未连接';
    dsh.className = status.dshReady ? 'ok' : 'err';
  }
  const dshHint = document.getElementById('metricDshHint');
  if (dshHint) dshHint.textContent = status.dshReady ? '桥接状态已同步' : '请检查 DSH 是否运行';
  renderSnowlumaHealth(status.snowluma);
  const mode = document.getElementById('metricMode');
  if (mode) mode.textContent = modeLabel.replace('模式', '');
  const role = document.getElementById('metricRole');
  if (role) role.textContent = '角色 · ' + (status.role || '默认人格');
  const access = document.getElementById('accessSummary');
  if (access) access.textContent = '管理员 ' + (status.ownerQQ || '未设置') + ' · ' + (status.allowGroups || []).length + ' 个白名单群 · ' + (status.allowPrivate || []).length + ' 位白名单好友';
  const updated = document.getElementById('lastUpdated');
  if (updated) updated.textContent = '状态同步于 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const alert = document.getElementById('connectionAlert');
  if (alert) alert.hidden = true;
  const silent = status.roleMode === 'silent';
  for (const [id, active] of [['silentOn', silent], ['silentOff', !silent]]) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}
function setConnectionError(error) {
  const status = document.getElementById('statusText');
  if (status) status.className = 'status-badge offline';
  const dsh = document.getElementById('metricDsh');
  if (dsh) { dsh.textContent = '连接中断'; dsh.className = 'err'; }
  const dshHint = document.getElementById('metricDshHint');
  if (dshHint) dshHint.textContent = '当前状态可能已过期';
  // 上游健康也一起过期：桥接都联系不上时，别让上一次的 SnowLuma 结论继续挂着。
  const snow = document.getElementById('metricSnowluma');
  if (snow) { snow.textContent = '未知'; snow.className = ''; }
  const snowHint = document.getElementById('metricSnowlumaHint');
  if (snowHint) snowHint.textContent = '当前状态可能已过期';
  const warn = document.getElementById('snowlumaWarn');
  if (warn) warn.hidden = true;
  const alert = document.getElementById('connectionAlert');
  if (alert) {
    alert.textContent = error.message === '未授权' ? '访问令牌无效或已取消输入。请使用启动日志中的控制台链接重新打开。' : '无法连接桥接服务，当前显示的是上次同步结果。请检查桥接是否运行，再点击右上角刷新。';
    alert.hidden = false;
  }
}
// 概览页模块在首次进入 / 写操作成功后请求补一次状态：页面管交互，状态刷新仍归这里。
document.addEventListener('console:refresh-status', () => { refresh(); refreshSessionMetrics(); });
document.getElementById('refreshConsole').addEventListener('click', async function () {
  this.disabled = true;
  await Promise.allSettled([refresh(), refreshSessionMetrics(), Promise.resolve(refreshCurrentPage())]);
  this.disabled = false;
  if (document.getElementById('connectionAlert').hidden) showConsoleToast('运行状态已刷新');
});

applyPageA11y();

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


function renderSendLimitHits(x) {
  const el = document.getElementById('sendLimitHits');
  if (!el) return;
  if (!x) { el.textContent = '最近 24 小时没有被拦过'; el.className = 'meta'; return; }
  setMsg(el, `⚠️ 最近 24 小时被拦了 ${x.count} 次（${x.keys} 个会话；最近一次 ${new Date(x.lastAt).toLocaleTimeString()}，${x.lastKey}）。AI 经常一次发好几条的话，可以把上限调高一点`, 'err');
}

// 全局：状态轮询 + 概览指标。各页自己的首次加载由 pages/<id>/page.js 的 init 负责。
refresh(); refreshSessionMetrics();
setInterval(() => { refresh(); refreshSessionMetrics(); }, 3000);
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

// 所有页面模块就绪后再接管路由（首屏恢复也在这里）。
initRouter();
