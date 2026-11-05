// 会话与审批页：会话清单（桥接会话 → DSH 会话）与只读的挂起审批 / 提问，两块在同一页用标签页切换。
//
// 页面目录约定（docs/PLUGIN_ROADMAP.md §8.7）：page.js 导出 init()，路由器在片段注入后调用。
// 数据来源只有两个接口：/api/sessions（会话清单，已含模式/人格/未读/最近唤醒）与 /api/pending。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { closeModal, openModal, wireModal } from '../../js/components/modal.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';

const MODE_LABEL = {
  chat: '聊天模式',
  'closed-agent': '封闭 Agent',
  reserved: '一代仿真',
  reserved2: '二代仿真',
};

let activeTab = 'sessions';
let sessionsCache = [];
let renameTarget = null;

function kindPill(entry) {
  return entry.kind === 'group' ? '<span class="pill g">群</span>' : '<span class="pill b">私聊</span>';
}

function modeCell(entry) {
  if (!entry.mode) return '<span class="meta">—</span>';
  const label = MODE_LABEL[entry.mode] || entry.mode;
  const level = entry.mode === 'closed-agent' && entry.level ? ` <span class="meta">${esc(entry.level)}</span>` : '';
  return `${esc(label)}${level}`;
}

function personaCell(entry) {
  const p = entry.persona || {};
  if (!p.source || p.source === 'none') return '<span class="meta">未挂卡</span>';
  const name = p.name ? esc(p.name) : '<span class="meta">（未命名）</span>';
  const source = p.source === 'provider' ? '<span class="pill b">provider</span>' : '<span class="pill">全局卡</span>';
  const stale = p.stale ? ' <span class="pill r">缓存</span>' : '';
  return `${name} ${source}${stale}`;
}

function whenCell(ts) {
  if (!ts) return '<span class="meta">—</span>';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return esc(`${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
}

function filteredSessions() {
  const kind = document.getElementById('sessionsKind')?.value || 'all';
  const keyword = (document.getElementById('sessionsSearch')?.value || '').trim().toLowerCase();
  return sessionsCache.filter((entry) => {
    if (kind !== 'all' && entry.kind !== kind) return false;
    if (!keyword) return true;
    return [entry.key, entry.id, entry.mode, entry.persona?.name, MODE_LABEL[entry.mode]]
      .filter(Boolean).some((x) => String(x).toLowerCase().includes(keyword));
  });
}

function renderSessions() {
  const box = document.getElementById('sessionList');
  const meta = document.getElementById('sessionsMeta');
  if (!box) return;
  const rows = filteredSessions();
  if (meta) meta.textContent = `共 ${sessionsCache.length} 个会话，显示 ${rows.length} 个`;
  if (!sessionsCache.length) {
    box.innerHTML = '<div class="empty-state"><strong>还没有会话</strong><p>白名单中的群或好友发来消息、或被唤醒后，会话会显示在这里。</p></div>';
    return;
  }
  if (!rows.length) {
    box.innerHTML = '<div class="empty-state"><strong>没有匹配的会话</strong><p>换个类型或关键词试试。</p></div>';
    return;
  }
  const head = '<thead><tr><th data-w="230">会话</th><th data-w="150">模式</th>'
    + '<th data-w="170">人格</th><th data-w="70">未读</th><th data-w="90">最近唤醒</th>'
    + '<th>DSH 会话</th><th data-w="150">操作</th></tr></thead>';
  const body = rows.map((entry) => {
    const ownerTag = entry.owner ? ' <span class="pill r">管理员</span>' : '';
    const unread = entry.unread ? `<span class="pill r">${entry.unread}</span>` : '<span class="meta">0</span>';
    return `<tr>`
      + `<td><strong>${esc(entry.key)}</strong> ${kindPill(entry)}${ownerTag}</td>`
      + `<td>${modeCell(entry)}</td>`
      + `<td>${personaCell(entry)}</td>`
      + `<td>${unread}</td>`
      + `<td>${whenCell(entry.lastWakeAt)}</td>`
      + `<td><code>${esc(entry.sessionId)}</code></td>`
      + `<td><button class="small" data-rename-key="${esc(entry.key)}">改名</button>`
      + ` <button class="small" data-reset-key="${esc(entry.key)}">清除上下文</button></td>`
      + `</tr>`;
  }).join('');
  box.innerHTML = `<table>${head}<tbody>${body}</tbody></table>`;

  box.querySelectorAll('[data-rename-key]').forEach((btn) => btn.addEventListener('click', () => {
    openRename(btn.dataset.renameKey);
  }));
  box.querySelectorAll('[data-reset-key]').forEach((btn) => btn.addEventListener('click', async () => {
    const key = btn.dataset.resetKey;
    if (!confirm(`确定清除会话 ${key} 的上下文？下次消息将开新会话，本地记忆与人物库不受影响。`)) return;
    const r = await api('/api/session/reset', 'POST', { key });
    if (r.ok) showConsoleToast('已清除上下文');
    else showConsoleToast(`清除失败：${r.error || '未知原因'}`);
    refreshSessions();
  }));
}

async function refreshSessions() {
  try {
    const s = await api('/api/sessions');
    sessionsCache = Array.isArray(s.sessions) ? s.sessions : [];
    const metric = document.getElementById('metricSessions');
    if (metric) metric.textContent = sessionsCache.length;
    const tabCount = document.getElementById('sessionsTabCount');
    if (tabCount) tabCount.textContent = String(sessionsCache.length);
    renderSessions();
  } catch (error) {
    const box = document.getElementById('sessionList');
    if (box) box.innerHTML = `<div class="empty-state"><strong>读取会话失败</strong><p>${esc(String(error?.message ?? error))}</p></div>`;
  }
}

function renderPending(rows) {
  const box = document.getElementById('pendingList');
  const meta = document.getElementById('pendingMeta');
  if (!box) return;
  if (meta) meta.textContent = rows.length ? `共 ${rows.length} 条待处理` : '没有待处理请求';
  if (!rows.length) {
    box.innerHTML = '<div class="empty-state"><strong>暂时没有待处理请求</strong><p>AI 的提问或工具审批会出现在这里，请前往对应 QQ 会话回复。</p></div>';
    return;
  }
  const head = '<thead><tr><th data-w="230">会话</th><th data-w="90">类型</th><th>详情</th></tr></thead>';
  const body = rows.map((x) => {
    const kind = x.kind === 'approval' ? '<span class="pill r">审批</span>' : '<span class="pill b">提问</span>';
    let detail = '';
    if (x.kind === 'approval') detail = `${esc(x.toolName || '')}${x.reason ? '：' + esc(x.reason) : ''}`;
    else if (Array.isArray(x.questions)) detail = x.questions.map((q) => esc(q.question)).join(' / ');
    return `<tr><td><strong>${esc(x.key)}</strong></td><td>${kind}</td><td>${detail || '<span class="meta">—</span>'}</td></tr>`;
  }).join('');
  box.innerHTML = `<table>${head}<tbody>${body}</tbody></table>`;
}

async function refreshPending() {
  try {
    const p = await api('/api/pending');
    const rows = Array.isArray(p.pending) ? p.pending : [];
    const metric = document.getElementById('metricPending');
    if (metric) metric.textContent = rows.length;
    const navCount = document.getElementById('pendingCount');
    if (navCount) navCount.textContent = rows.length;
    const tabCount = document.getElementById('pendingTabCount');
    if (tabCount) tabCount.textContent = rows.length ? String(rows.length) : '';
    renderPending(rows);
  } catch (error) {
    const box = document.getElementById('pendingList');
    if (box) box.innerHTML = `<div class="empty-state"><strong>读取待处理失败</strong><p>${esc(String(error?.message ?? error))}</p></div>`;
  }
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('[data-sessions-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.sessionsTab === tab);
  });
  document.querySelectorAll('[data-sessions-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.sessionsPanel !== tab;
  });
}

function openRename(key) {
  const entry = sessionsCache.find((x) => x.key === key);
  const overlay = document.getElementById('sessionRenameOverlay');
  const input = document.getElementById('sessionRenameInput');
  if (!overlay || !input || !entry) return;
  renameTarget = entry;
  input.value = '';
  input.placeholder = entry.sessionId;
  const who = document.getElementById('sessionRenameWho');
  if (who) who.textContent = `${entry.key} → ${entry.sessionId}`;
  const msg = document.getElementById('sessionRenameMsg');
  if (msg) msg.textContent = '';
  openModal(overlay);
  input.focus();
}

async function saveRename() {
  const input = document.getElementById('sessionRenameInput');
  const msg = document.getElementById('sessionRenameMsg');
  if (!renameTarget || !input) return;
  const title = input.value.trim();
  if (!title) { if (msg) msg.textContent = '请先填标题'; return; }
  const btn = document.getElementById('sessionRenameSave');
  if (btn) btn.disabled = true;
  try {
    const r = await api('/api/session/rename', 'POST', { key: renameTarget.key, title });
    if (r.ok) {
      closeModal(document.getElementById('sessionRenameOverlay'));
      showConsoleToast('已重命名');
      refreshSessions();
    } else if (msg) {
      msg.textContent = `失败：${r.error || '未知原因'}`;
    }
  } catch (error) {
    if (msg) msg.textContent = `失败：${String(error?.message ?? error)}`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function refreshActive() {
  refreshSessions();
  refreshPending();
}

export function init() {
  // 弹窗必须挂在 body 上：片段在 section.card 内，.card 的滤镜会给 position:fixed 造包含块。
  const overlay = document.getElementById('sessionRenameOverlay');
  if (overlay && overlay.parentElement !== document.body) document.body.appendChild(overlay);
  wireModal(overlay, { onClose: () => { renameTarget = null; } });

  document.querySelectorAll('[data-sessions-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.sessionsTab));
  });
  document.getElementById('sessionsRefresh')?.addEventListener('click', refreshSessions);
  document.getElementById('pendingRefresh')?.addEventListener('click', refreshPending);
  document.getElementById('sessionsKind')?.addEventListener('change', renderSessions);
  document.getElementById('sessionsSearch')?.addEventListener('input', renderSessions);
  document.getElementById('sessionRenameSave')?.addEventListener('click', saveRename);
  document.getElementById('sessionRenameCancel')?.addEventListener('click', () => closeModal(overlay));
  document.getElementById('sessionRenameInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); saveRename(); }
  });
  switchTab(activeTab);

  // 只在本页可见时轮询：离开页面就停，避免在别的页白白打接口。
  setInterval(() => {
    if (getCurrentPage() !== 'sessions') return;
    if (activeTab === 'pending') refreshPending();
    else refreshSessions();
  }, 5000);

  onPageRefresh('sessions', () => setTimeout(refreshActive, 0));
  setTimeout(refreshActive, 0);
}
