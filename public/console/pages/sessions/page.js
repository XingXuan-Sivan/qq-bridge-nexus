// 会话与审批页：会话映射（平台侧身份 → DSH 会话）与只读的挂起审批 / 提问，两块在同一页用标签页切换。
//
// 页面目录约定（docs/PLUGIN_ROADMAP.md §8.7）：page.js 导出 init()，路由器在片段注入后调用。
// 数据来源只有两个接口：/api/sessions（会话清单，已含平台/模式/人格/未读/最近唤醒）与 /api/pending。
// 会话 key 形如 `qq:group:123`、`qq:private:456`：平台前缀用于筛选，页面不假设只有一个平台。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { closeModal, openModal, wireModal } from '../../components/modal/modal.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { renderFields } from '../../components/form/form.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { SESSIONS_FIELDS } from './fields.js';

const MODE_LABEL = {
  chat: '聊天模式',
  'closed-agent': '封闭 Agent',
  reserved: '一代仿真',
  reserved2: '二代仿真',
};

let activeTab = 'sessions';
let sessionsCache = [];
let renameTarget = null;

function platformOf(entry) {
  return String(entry.key || '').split(':')[0] || 'unknown';
}

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

// 平台下拉按数据现算：出现哪些平台就列哪些，不写死 qq。筛选本身交给 dataTableHtml 的 filters。
function platformOptions() {
  const platforms = [...new Set(sessionsCache.map(platformOf))].sort();
  return [{ value: 'all', label: '全部平台' }, ...platforms.map((p) => ({ value: p, label: p }))];
}

function renderSessions() {
  const box = document.getElementById('sessionList');
  if (!box) return;
  const platforms = platformOptions();
  const rows = sessionsCache.map((entry) => {
    const ownerTag = entry.owner ? ' <span class="pill r">管理员</span>' : '';
    const platformTag = `<span class="pill">${esc(platformOf(entry))}</span>`;
    const unread = entry.unread ? `<span class="pill r">${entry.unread}</span>` : '<span class="meta">0</span>';
    return {
      cells: [
        `<strong>${esc(entry.key)}</strong> ${platformTag}${kindPill(entry)}${ownerTag}`,
        modeCell(entry),
        personaCell(entry),
        unread,
        whenCell(entry.lastWakeAt),
        `<button type="button" class="btn small" data-rename-key="${esc(entry.key)}">改名</button>`,
      ],
      attrs: { 'data-filter-platform': platformOf(entry), 'data-filter-kind': entry.kind || '' },
    };
  });
  box.innerHTML = dataTableHtml({
    columns: [
      { label: '会话', width: '250px' },
      { label: '模式', width: '150px' },
      { label: '人格', width: '170px' },
      { label: '未读', width: '70px' },
      { label: '最近唤醒', width: '100px' },
      { label: '操作', width: '110px' },
    ],
    rows,
    pageSize: 20,
    search: { placeholder: '搜索会话、模式或人格…' },
    refresh: true,
    filters: [
      {
        id: 'platform',
        label: '平台',
        options: platforms,
      },
      {
        id: 'kind',
        label: '类型',
        options: [
          { value: 'all', label: '全部类型' },
          { value: 'group', label: '仅群聊' },
          { value: 'private', label: '仅私聊' },
        ],
      },
    ],
    empty: '还没有会话：白名单中的群或好友发来消息、或被唤醒后，会话会显示在这里。',
  });
  initDataTables(box, { onRefresh: refreshSessions });

  box.querySelectorAll('[data-rename-key]').forEach((btn) => btn.addEventListener('click', () => {
    openRename(btn.dataset.renameKey);
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
  if (!box) return;
  const body = rows.map((x) => {
    const kind = x.kind === 'approval' ? '<span class="pill r">审批</span>' : '<span class="pill b">提问</span>';
    let detail = '';
    if (x.kind === 'approval') detail = `${esc(x.toolName || '')}${x.reason ? '：' + esc(x.reason) : ''}`;
    else if (Array.isArray(x.questions)) detail = x.questions.map((q) => esc(q.question)).join(' / ');
    return [`<strong>${esc(x.key)}</strong>`, kind, detail || '<span class="meta">—</span>'];
  });
  box.innerHTML = dataTableHtml({
    columns: [{ label: '会话', width: '250px' }, { label: '类型', width: '90px' }, { label: '详情' }],
    rows: body,
    pageSize: 20,
    refresh: true,
    empty: '暂时没有待处理请求：AI 的提问或工具审批会出现在这里，请前往对应 QQ 会话回复。',
  });
  initDataTables(box, { onRefresh: refreshPending });
}

async function refreshPending() {
  try {
    const p = await api('/api/pending');
    const rows = Array.isArray(p.pending) ? p.pending : [];
    const metric = document.getElementById('metricPending');
    if (metric) metric.textContent = rows.length;
    const navCount = document.getElementById('pendingCount');
    // 侧栏角标只表示「有待处理」，为 0 时不显示 0，回到占位符。
    if (navCount) { navCount.textContent = rows.length ? String(rows.length) : '—'; navCount.dataset.empty = rows.length ? '0' : '1'; }
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
  // 先渲染字段规格（标签条 / 两个面板宿主 / 改名弹窗），下面取节点才不会拿到空。
  document.querySelectorAll('[data-sessions-fields]').forEach((host) => {
    const spec = SESSIONS_FIELDS[host.dataset.sessionsFields];
    if (spec?.html) host.innerHTML = spec.html;
    else if (spec?.fields) renderFields(host, spec.fields, { columns: 1 });
  });

  // 弹窗必须挂在 body 上：片段在 section.card 内，.card 的滤镜会给 position:fixed 造包含块。
  const overlay = document.getElementById('sessionRenameOverlay');
  if (overlay && overlay.parentElement !== document.body) document.body.appendChild(overlay);
  wireModal(overlay, { onClose: () => { renameTarget = null; } });

  document.querySelectorAll('[data-sessions-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.sessionsTab));
  });
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
