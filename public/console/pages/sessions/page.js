// 会话与审批页：会话映射（平台侧身份 → DSH 会话）与只读的挂起审批 / 提问，两块在同一页用标签页切换。
//
// 页面目录约定（docs/PLUGIN_ROADMAP.md §8.7）：page.js 导出 init()，路由器在片段注入后调用。
// 数据来源只有两个接口：/api/sessions（会话清单，已含平台/模式/人格/未读/最近唤醒）与 /api/pending。
// 会话 key 形如 `qq:group:123`、`qq:private:456`：平台前缀用于筛选，页面不假设只有一个平台。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { closeModal, openModal, wireModal } from '../../components/modal/modal.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { collapseHtml } from '../../components/collapse/collapse.js';
import { bindCounters, bindSwitches, getSwitch, renderFields, setSwitch } from '../../components/form/form.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { permissionLevelLabel } from '../../js/permission-levels.js';
import { SESSIONS_FIELDS } from './fields.js';
import { cardHtml } from '../../components/card/card.js';
// 平台名、会话类型与上限都从运行期元数据读（B7）：这里是唯一一处「页面认识平台」的地方，
// 而且认识的方式是查表，不是写死 qq。
import {
  activeAgentPlatformId,
  conversationTypeLabel,
  conversationTypeTone,
  listPlatforms,
  loadModelCatalog,
  platformFilterOptions,
  platformLabel,
  registryLabel,
} from '../../js/registry.js';

const MODE_LABEL = {
  chat: '聊天模式',
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
  const tone = conversationTypeTone(entry.kind);
  const cls = tone ? `tag ${tone}` : 'tag';
  return `<span class="${cls}">${esc(conversationTypeLabel(entry.kind))}</span>`;
}

function modeCell(entry) {
  if (!entry.mode) return '<span class="meta">—</span>';
  return esc(MODE_LABEL[entry.mode] || entry.mode);
}

function personaCell(entry) {
  const p = entry.persona || {};
  if (!p.source || p.source === 'none') return '<span class="meta">未挂卡</span>';
  const name = p.name ? esc(p.name) : '<span class="meta">（未命名）</span>';
  const source = p.source === 'provider' ? '<span class="tag tag--primary">provider</span>' : '<span class="tag">全局卡</span>';
  const stale = p.stale ? '<span class="tag tag--danger">缓存</span>' : '';
  return `<div class="persona-name">${name}</div><div class="session-tags">${source}${stale}</div>`;
}

function whenText(ts) {
  const value = Number(ts) || 0;
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function whenCell(ts) {
  if (!ts) return '<span class="meta">—</span>';
  return esc(whenText(ts));
}

function accessPill(value) {
  return value === 'allow'
    ? '<span class="tag tag--success">允许</span>'
    : '<span class="tag tag--danger">拒绝</span>';
}

function accessCell(entry) {
  const access = entry.access || {};
  return `<span class="meta">被动</span> ${accessPill(access.passive)}`
    + ` <span class="meta">主动</span> ${accessPill(access.proactive)}`;
}

function nameCell(entry) {
  const ownerTag = entry.owner ? ' <span class="tag tag--danger">管理员</span>' : '';
  const platform = platformOf(entry);
  const platformTag = `<span class="tag" title="${esc(platform)}">${esc(platformLabel(platform))}</span>`;
  const name = `<strong>${esc(entry.displayName || entry.key)}</strong>`;
  const keyLine = entry.displayName ? `<span class="meta">${esc(entry.key)}</span>` : '';
  return `<div class="session-name">${name}</div>`
    + `<div class="session-tags">${keyLine}${platformTag}${kindPill(entry)}${ownerTag}</div>`;
}

/** 健康度：列表行与详情头部共用一份映射（在线 / 缺失 / 未知），还没有会话就写「未建」。 */
function agentHealthTag(health, sessionId) {
  if (!sessionId) return '<span class="tag">未建</span>';
  const status = health?.status || 'unknown';
  const label = { online: '在线', missing: '缺失', unknown: '未知' }[status] || status;
  return `<span class="${status === 'online' ? 'tag tag--success' : status === 'missing' ? 'tag tag--danger' : 'tag'}">${esc(label)}</span>`;
}


// 平台下拉：登记过的平台 + 会话里出现过的（加载前的降级），名字用平台自己的 label。
// 筛选本身交给 dataTableHtml 的 filters。
function platformOptions() {
  return platformFilterOptions(sessionsCache.map(platformOf));
}

// 类型下拉同理：平台声明的会话类型 ∪ 会话里出现的类型。
// 插件平台声明了 channel / thread，这里就会自动多出「仅频道 / 仅帖子」。
function kindFilterOptions() {
  const types = new Set();
  for (const platform of listPlatforms()) {
    for (const type of platform.conversationTypes ?? []) types.add(String(type).toLowerCase());
  }
  for (const entry of sessionsCache) if (entry.kind) types.add(String(entry.kind).toLowerCase());
  return [
    { value: 'all', label: '全部类型' },
    ...[...types].sort().map((type) => ({ value: type, label: `仅${conversationTypeLabel(type)}` })),
  ];
}

// ── 全局准入：两态单源名单 ──────────────────────────────────────────────────
// 白名单 = 默认拒绝 + 名单内允许；黑名单 = 默认允许 + 名单内拒绝。会话详情的开关
// 改的也是同一份名单，所以这里不再维护第二套「全局/局部」配置。
const ACCESS_AXES = [['passive', '被动行为'], ['proactive', '主动行为']];
const ACCESS_MODE_LABEL = { allow: '白名单', deny: '黑名单' };
let accessDraft = null;   // { passive:{mode,entries}, proactive:{mode,entries} }
let accessSaved = null;   // 上次保存的快照，用来提示“模式已改”

function accessModeLabel(mode) {
  return ACCESS_MODE_LABEL[mode] || '白名单';
}

function accessSwitch(axis) {
  return document.getElementById(axis === 'passive' ? 'accessPassiveMode' : 'accessProactiveMode');
}

function accessTextarea(axis) {
  return document.getElementById(axis === 'passive' ? 'accessPassiveEntries' : 'accessProactiveEntries');
}

function accessLines(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

// 粗校验：`<平台>[@账号]:<类型>:<id>` 或旧形态 `<类型>:<id>`。
// 具体合法性（这个平台有没有这种会话、id 字符集）由后端 resolveAccessEntries 判定 ——
// 它读的是平台声明的会话类型。前端不再写死 qq / group / private 与「必须是正整数」，
// 否则插件新增的平台连填都填不进去。
const ACCESS_KEY_RE = /^(?:[a-z][a-z0-9-]{0,15}(?:@[a-z0-9][a-z0-9._-]{0,31})?:)?[a-z][a-z0-9_-]{0,23}:[^\s:]+$/;

function accessInvalidLines(lines) {
  return lines.filter((line) => !ACCESS_KEY_RE.test(line));
}

/** 从表单读回草稿；mode 用开关的 aria-checked，开=白名单，关=黑名单。 */
function readAccessDraft() {
  const draft = {};
  for (const [axis] of ACCESS_AXES) {
    const sw = accessSwitch(axis);
    const area = accessTextarea(axis);
    draft[axis] = {
      mode: sw && getSwitch(sw) ? 'allow' : 'deny',
      entries: accessLines(area?.value),
    };
  }
  accessDraft = draft;
  return draft;
}

function renderAccessSummary() {
  if (!accessDraft) return;
  const summary = document.getElementById('globalAccessSummary');
  const warning = document.getElementById('accessWarning');
  const invalid = ACCESS_AXES.flatMap(([axis, label]) => accessInvalidLines(accessDraft[axis].entries).map((line) => `${label}：${line}`));
  const notes = [];
  const empty = [];
  for (const [axis, label] of ACCESS_AXES) {
    const cfg = accessDraft[axis];
    if (!cfg.entries.length) {
      empty.push(cfg.mode === 'allow' ? `${label}白名单为空：全部拒绝` : `${label}黑名单为空：全部允许`);
    }
    if (accessSaved && accessSaved[axis]?.mode !== cfg.mode) {
      notes.push(`${label}从「${accessModeLabel(accessSaved[axis]?.mode)}」切到「${accessModeLabel(cfg.mode)}」，保存会翻转所有会话的生效结果`);
    }
  }
  if (summary) {
    summary.textContent = ACCESS_AXES
      .map(([axis, label]) => `${label} ${accessModeLabel(accessDraft[axis].mode)} · ${accessDraft[axis].entries.length} 个`)
      .join(' ｜ ');
  }
  if (warning) {
    const messages = [...invalid.map((line) => `不是合法会话：${line}`), ...empty, ...notes];
    warning.hidden = messages.length === 0;
    warning.textContent = messages.join('；');
  }
}

function fillAccessForm() {
  if (!accessDraft) return;
  for (const [axis] of ACCESS_AXES) {
    const sw = accessSwitch(axis);
    if (sw) setSwitch(sw, accessDraft[axis].mode !== 'deny');
    const area = accessTextarea(axis);
    if (area) area.value = accessDraft[axis].entries.join('\n');
  }
  renderAccessSummary();
}

function applyAccessPayload(data) {
  const access = data?.access || {};
  accessDraft = {
    passive: { mode: access.passive?.mode === 'deny' ? 'deny' : 'allow', entries: Array.isArray(access.passive?.entries) ? access.passive.entries.slice() : [] },
    proactive: { mode: access.proactive?.mode === 'deny' ? 'deny' : 'allow', entries: Array.isArray(access.proactive?.entries) ? access.proactive.entries.slice() : [] },
  };
  accessSaved = JSON.parse(JSON.stringify(accessDraft));
  fillAccessForm();
}

export async function refreshGlobalAccess() {
  if (!document.getElementById('accessPassiveMode')) return;
  const msg = document.getElementById('accessMsg');
  try {
    const r = await api('/api/access');
    if (!r?.ok) throw new Error(r?.error || '读取失败');
    applyAccessPayload(r);
    if (msg) msg.textContent = '';
  } catch (error) {
    if (msg) msg.textContent = `读取失败：${String(error?.message ?? error)}`;
  }
}

function accessBody() {
  const draft = readAccessDraft();
  if (!draft) return null;
  return {
    passive: { mode: draft.passive.mode, entries: draft.passive.entries },
    proactive: { mode: draft.proactive.mode, entries: draft.proactive.entries },
  };
}

async function pushGlobalAccess(body) {
  if (!body) return { ok: false, message: '表单还没渲染' };
  const invalid = ACCESS_AXES.flatMap(([axis]) => accessInvalidLines(body[axis].entries));
  if (invalid.length) return { ok: false, message: `有 ${invalid.length} 行不是合法会话` };
  try {
    let r = await api('/api/access', 'PATCH', body);
    if (!r?.ok && r?.requiresConfirm) {
      const ok = window.confirm(r.error || `切换名单模式会翻转所有会话的生效结果（影响 ${r.affected} 个会话），确定保存？`);
      if (!ok) return { ok: true, skipped: true, message: '已取消保存' };
      r = await api('/api/access', 'PATCH', { ...body, confirmFlip: true });
    }
    if (!r?.ok) return { ok: false, message: String(r?.error || '保存失败') };
    applyAccessPayload(r);
    const affected = Number(r.affected);
    return { ok: true, message: affected > 0 ? `已保存，影响 ${affected} 个会话` : '已保存，立即生效' };
  } catch (error) {
    return { ok: false, message: String(error?.message ?? error) };
  }
}

/** 全局准入也走配置页的页面级保存条：read 读当前草稿，save 提交 PATCH /api/access。 */
export const globalAccessSection = {
  id: 'access',
  label: '全局准入',
  read: accessBody,
  save: (value) => pushGlobalAccess(value || accessBody()),
};

export async function saveGlobalAccess(msgId = 'accessMsg') {
  const msg = msgId ? document.getElementById(msgId) : null;
  const done = (text) => {
    if (msg) msg.textContent = text;
    showConsoleToast(text);
  };
  const result = await pushGlobalAccess(accessBody());
  if (result.message) done(result.message);
  return result;
}

function renderSessions() {
  const box = document.getElementById('sessionList');
  if (!box) return;
  const platforms = platformOptions();
  const rows = sessionsCache.map((entry) => {
    const unread = entry.unread ? `<span class="tag tag--danger">${entry.unread}</span>` : '<span class="meta">0</span>';
    // 显示名的唯一写口：对端标题与档案 displayName 由这个弹窗一起写。
    const rename = entry.sessionId
      ? `<button type="button" class="btn small" data-rename-key="${esc(entry.key)}">重命名</button>`
      : '<button type="button" class="btn small" disabled title="还没有 DSH 会话，下一条消息到达后再改">重命名</button>';
    const delProfile = entry.hasProfile
      ? ` <button type="button" class="btn small danger" data-drop-key="${esc(entry.key)}">删档案</button>`
      : '';
    return {
      cells: [
        nameCell(entry),
        modeCell(entry),
        accessCell(entry),
        personaCell(entry),
        agentHealthTag(entry.health, entry.sessionId),
        unread,
        whenCell(entry.lastWakeAt),
        `<button type="button" class="btn small" data-manage-key="${esc(entry.key)}">管理</button>${rename}${delProfile}`,
      ],
      attrs: { 'data-filter-platform': platformOf(entry), 'data-filter-kind': entry.kind || '' },
    };
  });
  box.innerHTML = dataTableHtml({
    columns: [
      { label: '会话', width: '250px' },
      { label: '模式', width: '110px' },
      { label: '准入（被动 / 主动）', width: '180px' },
      { label: '人格', width: '160px' },
      { label: '状态', width: '80px' },
      { label: '未读', width: '60px' },
      { label: '最近唤醒', width: '95px' },
      { label: '操作', width: '210px' },
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
        options: kindFilterOptions(),
      },
    ],
    actions: '<button class="btn small danger" type="button" id="sessionsClearWorkspace">清空所有会话</button>',
    empty: '还没有会话：全局准入名单里的群或好友发来消息、或被唤醒后，会话会显示在这里。',
  });
  initDataTables(box, { onRefresh: refreshSessions });

  const clearButton = box.querySelector('#sessionsClearWorkspace');
  clearButton?.addEventListener('click', async () => {
    if (!window.confirm('确定清空所有会话？\n将归档全部会话、清除所有上下文映射、清空活动日志。\n此操作不可撤销。')) return;
    clearButton.disabled = true;
    try {
      const r = await api('/api/workspace/reset', 'POST', {});
      if (!r?.ok) throw new Error(r?.error || '清空失败');
      showConsoleToast(`已归档 ${r.archivedCount} 个会话，工作区已清空`);
      await refreshSessions();
    } catch (error) {
      showConsoleToast(`清空失败：${String(error?.message ?? error)}`);
    } finally {
      clearButton.disabled = false;
    }
  });

  box.querySelectorAll('[data-manage-key]').forEach((btn) => btn.addEventListener('click', () => {
    openDetail(btn.dataset.manageKey);
  }));
  box.querySelectorAll('[data-rename-key]').forEach((btn) => btn.addEventListener('click', () => {
    openRename(btn.dataset.renameKey);
  }));
  box.querySelectorAll('[data-drop-key]').forEach((btn) => btn.addEventListener('click', () => {
    void dropProfile(btn.dataset.dropKey);
  }));
}

async function dropProfile(key) {
  if (!window.confirm(`删除 ${key} 的会话档案？DSH 绑定、人格文件与记忆都保留，准入恢复默认。`)) return;
  try {
    const r = await api(`/api/sessions/${encodeURIComponent(key)}/profile`, 'DELETE');
    if (!r?.ok) throw new Error(r?.error || '删除失败');
    showConsoleToast('会话档案已删除');
    await refreshSessions();
  } catch (error) {
    showConsoleToast(`删除失败：${error?.message ?? error}`);
  }
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
    const kind = x.kind === 'approval' ? '<span class="tag tag--danger">审批</span>' : '<span class="tag tag--primary">提问</span>';
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
    empty: '暂时没有待处理请求：AI 的提问或工具审批会出现在这里，请前往对应会话回复。',
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
    // 侧栏角标只表示「有待处理」：为 0 时整个藏起来（与 js/app.js 的写法保持一致）。
    if (navCount) {
      navCount.textContent = rows.length ? String(rows.length) : '';
      navCount.hidden = !rows.length;
      navCount.dataset.empty = rows.length ? '0' : '1';
    }
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
  input.value = entry.displayName || '';
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

// ── 详情（P1） ────────────────────────────────────────────────────────────
// 详情里的字段统一由底栏「保存」提交：一次只写变化的字段，没改动就不发请求。
let detailKey = null;
let detailCache = null;
let detailDirty = false;
let detailRendering = false; // 渲染期间会主动派发 change 同步下拉联动，不能把它当成用户编辑
// 会话装到哪个 Agent 实例上（GET /api/sessions/:key/agent）：只用它的 `instanceForeign` ——
// 换过平台才在危险操作里给「在新平台上重开」。执行体与对端权限档的正文在「平台 › 能力」，不在这里复述。
let detailAgent = null;

// 详情弹窗的模型目录：与平台详情页同一个读口（声明 + 实时），打开时取一次，
// 供运行卡的提供方 / 模型 / 思考强度下拉使用。
let detailCatalog = [];
let detailCatalogError = '';
async function ensureDetailCatalog() {
  const id = activeAgentPlatformId();
  const catalog = id ? await loadModelCatalog(id) : null;
  detailCatalog = catalog?.view?.providers ?? [];
  detailCatalogError = catalog?.error ?? '';
  return detailCatalog;
}

/**
 * 会话详情「人格」下拉的数据源：与全局配置同一份 /api/personas（本地卡 + 外部 provider 卡）。
 *
 * 不做模块级缓存：人格页新建/改名/删除角色卡后回到这里必须立刻看到，
 * 以前拿到一次就永不失效，只能刷新页面才有新卡。
 */
let detailPersonas = null;
async function ensurePersonaCatalog() {
  try {
    const r = await api('/api/personas');
    detailPersonas = Array.isArray(r?.items) ? r.items : [];
  } catch {
    // 读取失败沿用上一次结果，别让下拉突然空掉；从没读到过就是空数组。
    detailPersonas ??= [];
  }
  return detailPersonas;
}

/** 人格卡在会话里的存储值：本地卡写名字，外部卡写 `provider:id`。 */
function personaUidOf(item) {
  if (!item) return '';
  if (item.uid) return String(item.uid);
  if (item.source === 'local') return `local:${item.name}`;
  return `${item.provider}:${item.id}`;
}

/**
 * 人格卡下拉的选项：本地卡与外部卡分组交给 select 字段的 `group` 支持；
 * 旧档案里只存外部卡名字时，按名字唯一匹配回 `provider:id`，保存一次就迁移成引用。
 */
function personaSelectOptions(current) {
  const items = Array.isArray(detailPersonas) ? detailPersonas : [];
  let currentUid = current
    ? (String(current).includes(':') ? String(current) : `local:${current}`)
    : '';
  if (currentUid && !items.some((item) => personaUidOf(item) === currentUid)) {
    const byName = items.filter((item) => item.source !== 'local' && item.name === current);
    if (byName.length === 1) currentUid = personaUidOf(byName[0]);
  }
  const groups = new Map();
  for (const item of items) {
    const group = item.source === 'local' ? '本地人格' : `外部人格 · ${item.provider || 'provider'}`;
    if (!groups.has(group)) groups.set(group, []);
    const label = `${item.name || item.id}${item.stale ? '（缓存）' : ''}`;
    groups.get(group).push({ value: personaUidOf(item), label });
  }
  if (currentUid && !items.some((item) => personaUidOf(item) === currentUid)) {
    groups.set('当前值', [{ value: currentUid, label: currentUid }]);
  }
  return {
    uid: currentUid,
    options: [...groups].map(([group, options]) => ({ group, options })),
  };
}

function detailModelOptions(providerId) {
  const provider = (detailCatalog || []).find((p) => p.id === providerId);
  return provider?.models || [];
}

function syncDetailModelSelects(preferredModel = '', preferredReasoning = '') {
  const providerEl = document.getElementById('detailModelProvider');
  const modelEl = document.getElementById('detailModel');
  const reasonEl = document.getElementById('detailModelReasoning');
  if (!providerEl || !modelEl || !reasonEl) return;
  const providerId = providerEl.value;
  if (!providerId) {
    modelEl.innerHTML = '<option value="">跟随平台默认</option>';
    modelEl.disabled = true;
    reasonEl.innerHTML = '<option value="">跟随平台默认</option>';
    reasonEl.disabled = true;
    return;
  }
  const models = detailModelOptions(providerId);
  const modelId = preferredModel || models[0]?.id || '';
  modelEl.disabled = false;
  modelEl.innerHTML = models.map((m) => `<option value="${esc(m.id)}">${esc(m.name || m.id)}</option>`).join('');
  modelEl.value = models.some((m) => m.id === modelId) ? modelId : (models[0]?.id || '');
  const entry = models.find((m) => m.id === modelEl.value);
  const efforts = entry?.efforts || [];
  reasonEl.disabled = !efforts.length;
  reasonEl.innerHTML = '<option value="">模型默认</option>'
    + efforts.map((e) => `<option value="${esc(e.id)}">${esc(e.name || e.id)}</option>`).join('');
  if (preferredReasoning && efforts.some((e) => e.id === preferredReasoning)) reasonEl.value = preferredReasoning;
}

/** 能力档的受众：与能力档 yml 的 runtime 段同一套取值。 */
const AUDIENCE_LABEL = { owner: '仅主人私聊', access: '按准入' };

/** 换过 Agent 平台后，才给「在新平台上重开」（动作在危险操作卡里）。 */
function canReopenOnNewAgent() {
  return detailAgent?.instanceForeign === true;
}

/**
 * 「这个会话能用的工具」：求交结果（平台声明 ∩ 权限级别），默认折叠。
 *
 * 判定不在这里：`/api/sessions/<key>/profile` 的 `tools` 由 src/session/tools.mjs 算好，
 * 页面只把三列摆出来：组 / 能用 / 用不了（原因写在 title 里）。
 */
function toolsCardHtml(tools) {
  if (!tools || !Array.isArray(tools.groups) || !tools.groups.length) return '';
  const tag = (item, cls = '') => `<span class="tag${cls ? ` ${cls}` : ''}"${item.reason ? ` title="${esc(item.reason)}"` : ''}>${esc(item.label)}</span>`;
  const rows = tools.groups.map((group) => ({
    cells: [
      `<strong>${esc(group.label)}</strong>`,
      group.available.length ? group.available.map((item) => tag(item)).join(' ') : '<span class="meta">全都用不了</span>',
      group.unavailable.length ? group.unavailable.map((item) => tag(item, 'tag--warning')).join(' ') : '<span class="meta">—</span>',
    ],
  }));
  return collapseHtml({
    id: 'session-tools',
    title: `这个会话能用的工具（${tools.total}）`,
    body: `<p class="meta">${esc(tools.note || '')}</p>${dataTableHtml({
      columns: [{ label: '工具组', width: '120px' }, { label: '能用' }, { label: '用不了', width: '220px' }],
      rows,
      pageSize: 10,
      fit: true,
    })}`,
  });
}

/**
 * 运行卡底部的一行结论：把四项互相解释的配置拼成一句，缺省写「未设置」。
 * 只拼字符串，不新增字段：能力档的生效方式与受众读 `capabilities[]`，权限读后端下发的 effective。
 */
function runConclusion(data) {
  const capabilities = Array.isArray(data.capabilities) ? data.capabilities : [];
  const activeId = data.capability || data.defaultCapability || '';
  const active = capabilities.find((item) => item.id === activeId) || null;
  const capabilityText = active
    ? `${active.label || active.id}（${registryLabel('apply', active.apply) || active.apply}${active.audience ? ` · ${AUDIENCE_LABEL[active.audience] ?? active.audience}` : ''}）`
    : '无默认能力档';
  const behaviorText = data.behavior === 'inherit'
    ? (data.defaultBehavior || '未绑定')
    : data.behavior === 'none' ? '不绑定' : (data.behavior || '未绑定');
  const model = data.effectiveModel || null;
  const modelText = model?.model
    ? `${model.provider || '—'}/${model.model}${model.reasoning ? ` / ${model.reasoning}` : ''}`
    : '未设置';
  return `生效：能力档 ${capabilityText} · 行为 ${behaviorText} · 权限 ${permissionLevelLabel(data.permission?.effective) || '—'} · 模型 ${modelText}`;
}

function renderDetail(data) {
  const body = document.getElementById('sessionDetailBody');
  if (!body) return;
  // 渲染期间会派发 change 让下拉联动，监听器要忽略这些事件；渲染完成后再清一次脏标记。
  detailRendering = true;
  detailDirty = false;
  const wake = data.wake && typeof data.wake === 'object' ? data.wake : {};
  const triggers = wake.triggers && typeof wake.triggers === 'object' ? wake.triggers : {};
  const access = data.access || {};
  const persona = data.persona || {};
  const prompt = data.prompt || {};
  const personaPick = personaSelectOptions(persona.name);
  const maxPrompt = Number(prompt.maxChars) || 2000;
  const personaMode = persona.mode || 'inherit';
  const accessValue = ACCESS_AXES.filter(([axis]) => access[axis] === 'allow').map(([axis]) => axis);
  const wakeValue = [
    ['atMention', triggers.atMention], ['nameMention', triggers.nameMention],
    ['question', triggers.question], ['poke', triggers.poke],
  ].filter(([, on]) => on === true).map(([id]) => id);
  // 卡片单列排布；卡内的字段宿主交给 renderFields（两列），只读块与按钮行直接写 HTML。
  // 第三参是宿主数组：一张卡可以挂多个表单区（人格 + 提示、唤醒 + 准入）。
  const card = (title, meta, hosts = [], extra = '') => `<div class="detail-card">`
    + `<h4>${esc(title)}</h4>`
    + (meta ? `<div class="meta">${esc(meta)}</div>` : '')
    + hosts.map((host) => `<div data-detail-form="${esc(host)}"></div>`).join('')
    + extra
    + '</div>';

  body.innerHTML = `
    <div class="session-detail-head">
      <span class="session-detail-key" title="${esc(data.key)}">${esc(data.displayName || data.key)}</span>
      ${agentHealthTag(data.health, data.sessionId)}
      <span class="meta">${data.sessionId ? esc(data.sessionId) : '还没有 DSH 会话，下一条消息到达时会自动创建'}</span>
    </div>
    <div class="session-detail-grid">
      ${card('运行', '能力档决定装哪套预设与工具面；行为档案决定会话引擎；权限级别只过滤本会话能调用的平台工具。三项都默认跟随平台或全局。', ['run'],
        `<p class="detail-conclusion">${esc(runConclusion(data))}</p>${toolsCardHtml(data.tools)}`)}
      ${card('人格与提示', '人格决定它用谁的语气；初始提示词只在 AI 第一次进入这个会话时读一次。', ['persona', 'prompt'])}
      ${card('唤醒与准入', '上面是触发条件；下面是这份全局名单，会话内的勾选改的也是它。白名单默认拒绝、名单内允许；黑名单默认允许、名单内拒绝。管理命令和审批不受这里影响。', ['wake', 'access'],
        '<div class="detail-readonly" id="detailScheduling"><span class="meta">读取中…</span></div><div class="detail-actions detail-actions--indent"><button class="btn small" type="button" data-open-global-access>调整全局准入</button></div>')}
      ${collapseHtml({
        id: 'session-links',
        title: '关联（记忆 · 定时任务）',
        body: '<p class="meta">还有什么挂在这个会话上；清空与跳转都在这里。</p>'
          + '<div class="detail-readonly" id="detailMemory"><span class="meta">读取中…</span></div>'
          + '<div class="detail-actions"><button class="btn small danger" type="button" data-detail-clear-memory>清空本会话记忆</button><button class="btn small" type="button" data-detail-nav="memory">去记忆页</button></div>'
          + '<div class="detail-readonly u-mt-12" id="detailTasks"><span class="meta">读取中…</span></div>'
          + '<div class="detail-actions"><button class="btn small" type="button" data-detail-nav="scheduler">去定时任务</button></div>',
      })}
      ${collapseHtml({
        id: 'session-danger',
        title: '危险操作',
        className: 'detail-danger',
        body: '<p class="meta">重建会归档当前 DSH 会话并新建一个（上下文清空，人格/提示词/准入保留）；重置会清掉唤醒、未读、队列和审批，下一条消息重新建会话；换过 Agent 平台后可以用「在新平台上重开」把会话迁到新平台的实例。</p>'
          + '<div class="detail-actions"><button class="btn small" type="button" data-detail-rebuild>重建 DSH 会话</button><button class="btn small danger" type="button" data-detail-reset>重置会话状态</button>'
          + (canReopenOnNewAgent() ? '<button class="btn small" type="button" data-detail-agent-reopen>在新 Agent 平台上重开</button>' : '')
          + '</div>'
          + (data.sessionId ? '' : '<div class="field-hint">还没有 DSH 会话：下一条消息到达时会自动创建；也可以现在重建一次。</div>'),
      })}
    </div>`;

  const formHost = (id) => body.querySelector(`[data-detail-form="${id}"]`);
  const accessHint = `被动行为 ${accessModeLabel(access?.passiveMode === 'deny' ? 'deny' : 'allow')}`
    + ` · 主动行为 ${accessModeLabel(access?.proactiveMode === 'deny' ? 'deny' : 'allow')}`;
  const personaHint = persona.resolved?.name && personaMode === 'inherit'
    ? `当前实际使用：${persona.resolved.name}` : '';

  renderFields(formHost('access'), [
    {
      name: 'detailAccess', type: 'checkboxGroup', label: '允许', inline: true, columns: 2,
      value: accessValue, options: ACCESS_AXES.map(([value, label]) => ({ value, label })), hint: accessHint,
    },
  ], { columns: 2 });

  // 能力档与行为档案的选项：空 / inherit 表示「跟随平台默认」，下拉里把当前默认写进提示。
  const capabilities = Array.isArray(data.capabilities) ? data.capabilities : [];
  const capabilityLabelOf = (id) => (id ? (capabilities.find((c) => c.id === id)?.label || id) : '');
  const defaultCapabilityLabel = capabilityLabelOf(data.defaultCapability) || '无默认能力档';
  const behaviors = Array.isArray(data.behaviors) ? data.behaviors : [];
  // 权限档位与措辞都以后端下发为准，页面不自带一份拷贝。
  const permissionOptions = [
    { value: 'inherit', label: `跟随全局（当前：${permissionLevelLabel(data.permission?.effective)}）` },
    ...(data.permission?.options || [])
      .filter((item) => item.value !== 'inherit')
      .map((item) => ({ value: item.value, label: item.name || item.value })),
  ];

  renderFields(formHost('run'), [
    {
      name: 'detailCapability', type: 'select', label: '能力档', value: data.capability || '',
      options: [
        { value: '', label: `跟随平台默认（当前：${defaultCapabilityLabel}）` },
        ...capabilities.map((c) => ({
          value: c.id,
          label: `${c.label || c.id}${c.audience === 'owner' ? '（仅主人私聊）' : ''}`,
        })),
      ],
      hint: '空着就是平台默认能力档；正文（工具面、对端权限档、注入方式）在「平台 › 该 Agent 平台 › 能力」。',
    },
    {
      name: 'detailBehavior', type: 'select', label: '行为档案', value: data.behavior || 'inherit',
      options: [
        { value: 'inherit', label: `跟随平台默认（当前：${data.defaultBehavior || '未设置'}）` },
        { value: 'none', label: '不绑定行为' },
        ...behaviors.map((id) => ({ value: id, label: id })),
      ],
      hint: '行为档案决定会话引擎与调度参数；平台默认行为在「平台 › 用户平台 › 配置」里改。',
    },
    {
      name: 'detailPermission', type: 'select', label: '权限级别',
      value: data.permission?.value || 'inherit',
      options: permissionOptions,
      hint: `当前生效：${permissionLevelLabel(data.permission?.effective)}；只决定本会话能调用哪些平台工具。`,
    },
    {
      name: 'detailModelProvider', type: 'select', label: '模型', value: data.model?.provider || '',
      options: [
        { value: '', label: '跟随平台默认' },
        ...(detailCatalog || []).map((p) => ({ value: p.id, label: p.name || p.id })),
      ],
      hint: [
        `当前生效：${data.effectiveModel?.provider || '—'} / ${data.effectiveModel?.model || '—'}`,
        detailCatalogError ? `平台模型目录读取失败：${detailCatalogError}` : '',
      ].filter(Boolean).join('；'),
    },
    { name: 'detailModel', type: 'select', label: '具体模型', value: data.model?.model || '', options: [{ value: '', label: '跟随平台默认' }] },
    {
      name: 'detailModelReasoning', type: 'select', label: '思考强度', value: data.model?.reasoning || '',
      options: [{ value: '', label: '跟随平台默认' }],
      hint: '只作用于这个会话：平台默认模型在「平台 › 该 Agent 平台 › 配置」里改；本会话按自己的模型能力决定能否看图。',
    },
  ], { columns: 2 });

  renderFields(formHost('persona'), [
    {
      name: 'detailPersonaMode', type: 'select', label: '模式', value: personaMode,
      options: [['inherit', '继承全局'], ['card', '指定人格卡'], ['off', '不挂卡']]
        .map(([value, label]) => ({ value, label })),
    },
    {
      name: 'detailPersonaName', type: 'select', label: '人格卡', value: personaPick.uid,
      options: personaPick.options, placeholder: '选择人格卡',
      disabled: personaMode !== 'card', hint: personaHint,
    },
  ], { columns: 2 });

  renderFields(formHost('prompt'), [
    {
      name: 'detailPrompt', type: 'textarea', label: '提示词', span: 2, rows: 4,
      maxlength: maxPrompt, counter: true, value: prompt.text || '',
      placeholder: '例如：这是一个偏技术的闲聊群…',
      hint: '只在 AI 第一次进入这个会话时读一次；留空表示没有初始提示词。',
    },
  ], { columns: 2 });

  renderFields(formHost('wake'), [
    {
      name: 'detailWakeMode', type: 'select', label: '模式', value: wake.mode === 'active' ? 'active' : 'diving',
      options: [{ value: 'diving', label: '潜水' }, { value: 'active', label: '活跃' }],
    },
    {
      name: 'detailWakeTriggers', type: 'checkboxGroup', label: '触发', inline: true, columns: 2,
      value: wakeValue,
      options: [
        { value: 'atMention', label: '@ 唤醒' }, { value: 'nameMention', label: '名字唤醒' },
        { value: 'question', label: '提问唤醒' }, { value: 'poke', label: '拍一拍' },
      ],
    },
    {
      name: 'detailWakeKeywords', type: 'text', label: '关键词', span: 2,
      value: Array.isArray(triggers.keywords) ? triggers.keywords.join(', ') : '', placeholder: '逗号分隔',
    },
  ], { columns: 2 });

  bindCounters(body);
  body.querySelectorAll('select').forEach((el) => el.dispatchEvent(new Event('change', { bubbles: true })));
  syncDetailModelSelects(data.model?.model || data.effectiveModel?.model || '', data.model?.reasoning || '');
  document.getElementById('detailModelProvider')?.addEventListener('change', () => syncDetailModelSelects('', ''));
  document.getElementById('detailModel')?.addEventListener('change', () => {
    const modelEl = document.getElementById('detailModel');
    syncDetailModelSelects(modelEl?.value || '', '');
  });
  // 人格卡下拉只在「指定人格卡」模式下可用；其它模式置灰但保留可见，避免整行跳变。
  const personaModeEl = document.getElementById('detailPersonaMode');
  const personaNameEl = document.getElementById('detailPersonaName');
  const syncPersonaSelect = () => {
    if (!personaNameEl) return;
    personaNameEl.disabled = personaModeEl?.value !== 'card';
  };
  personaModeEl?.addEventListener('change', syncPersonaSelect);
  syncPersonaSelect();
  void loadDetailMemory(data.key);
  void loadDetailTasks(data.key);
  void loadDetailScheduling(data.key);
  detailRendering = false;
  detailDirty = false;
  const saveBtn = document.getElementById('sessionDetailSave');
  if (saveBtn) saveBtn.disabled = false;
}

async function loadDetailTasks(key) {
  const box = document.getElementById('detailTasks');
  if (!box) return;
  try {
    const r = await api('/api/scheduler');
    const tasks = (r?.tasks || []).filter((t) => Array.isArray(t.targets) && t.targets.includes(key));
    if (!tasks.length) { box.innerHTML = '<span class="meta">没有指向这个会话的定时任务</span>'; return; }
    box.innerHTML = tasks.slice(0, 10).map((t) => `<div class="u-mt-2">`
      + `<span class="tag${t.enabled === false ? '' : ' tag--success'}">${t.enabled === false ? '暂停' : '启用'}</span> `
      + `<strong>${esc(t.name || t.id || '未命名')}</strong> `
      + `<span class="meta">${esc(t.scheduleText || '')}${t.nextRunText ? ' · 下次 ' + esc(t.nextRunText) : ''}</span>`
      + `</div>`).join('');
  } catch {
    box.innerHTML = '<span class="meta">定时任务读取失败</span>';
  }
}

async function loadDetailMemory(key) {
  const box = document.getElementById('detailMemory');
  if (!box) return;
  try {
    const r = await api('/api/memory/sessions');
    const row = (r.sessions || []).find((x) => x.key === key);
    if (!row) { box.innerHTML = '<span class="meta">这个会话还没有本机记忆</span>'; return; }
    box.innerHTML = [
      ['话题', row.topics], ['想法', row.thoughts], ['印象', row.impressions], ['规则', row.rules],
    ].map(([label, n]) => `<span><span class="meta">${label}</span> <strong>${Number(n) || 0}</strong></span>`).join('');
  } catch {
    box.innerHTML = '<span class="meta">记忆计数读取失败</span>';
  }
}

/**
 * 调度只读行：两档各剩几个 token、暂存与溢出条数。
 *
 * 桶靠投递自然回填，不能手动改；这里只是把「为什么这一枪被拦」变成看得见的事实。
 */
async function loadDetailScheduling(key) {
  const box = document.getElementById('detailScheduling');
  if (!box) return;
  try {
    const r = await api('/api/socialV2/states');
    const row = (r?.conversations || []).find((x) => x.key === key);
    if (!row) { box.innerHTML = '<span class="meta">这个会话还没有调度状态（没收到过消息）</span>'; return; }
    const tokens = (tier) => {
      const p = row.pacing?.[tier] || {};
      const capacity = Number(p.capacity) || 0;
      // capacity 为 0 是「不限额」，不是「没额度」——两者写同一个 0 会让人以为被锁死。
      return capacity ? `${(Number(p.tokens) || 0).toFixed(1)}/${capacity}` : '不限';
    };
    box.innerHTML = [
      ['direct', tokens('direct')],
      ['ambient', tokens('ambient')],
      ['暂存', String(Number(row.pendingWakeCount) || 0)],
      ['未读溢出', String(Number(row.overflowCount) || 0)],
    ].map(([label, value]) => `<span><span class="meta">${label}</span> <strong>${esc(value)}</strong></span>`).join('');
  } catch {
    box.innerHTML = '<span class="meta">调度状态读取失败</span>';
  }
}

async function openDetail(key) {
  const overlay = document.getElementById('sessionDetailOverlay');
  if (!overlay) return;
  detailKey = key;
  detailCache = null;
  const body = document.getElementById('sessionDetailBody');
  if (body) body.innerHTML = '<div class="meta">读取中…</div>';
  const msg = document.getElementById('sessionDetailMsg');
  if (msg) msg.textContent = '';
  const saveBtn = document.getElementById('sessionDetailSave');
  if (saveBtn) saveBtn.disabled = true;
  openModal(overlay);
  try {
    const [data, agent] = await Promise.all([
      api(`/api/sessions/${encodeURIComponent(key)}/profile`),
      // Agent 平台实例归属单独取：它决定危险操作卡里要不要给「在新 Agent 平台上重开」。
      // 读不到只当「没有换过平台」，不能连带整个详情失败。
      api(`/api/sessions/${encodeURIComponent(key)}/agent`).catch(() => null),
      ensureDetailCatalog(),
      ensurePersonaCatalog(),
    ]);
    if (!data?.ok) throw new Error(data?.error || '读取失败');
    detailCache = data;
    detailAgent = agent?.ok === true ? agent : null;
    renderDetail(data);
  } catch (error) {
    if (body) body.innerHTML = `<div class="empty-state"><strong>读取会话失败</strong><p>${esc(String(error?.message ?? error))}</p></div>`;
  }
}

/** 把详情表单与最近一次读取的档案做 diff，只产出生效的字段。 */
function buildDetailPatch() {
  const data = detailCache || {};
  const patch = {};

  const capability = document.getElementById('detailCapability')?.value || '';
  if (capability !== (data.capability || '')) patch.capability = capability;

  const behavior = document.getElementById('detailBehavior')?.value || 'inherit';
  if (behavior !== (data.behavior || 'inherit')) patch.behavior = behavior;

  const permission = document.getElementById('detailPermission')?.value || 'inherit';
  if (permission !== (data.permission?.value || 'inherit')) patch.permission = permission;

  const provider = document.getElementById('detailModelProvider')?.value || '';
  const model = provider
    ? {
      provider,
      model: document.getElementById('detailModel')?.value || '',
      reasoning: document.getElementById('detailModelReasoning')?.value || '',
    }
    : null;
  const cachedModel = data.model?.provider
    ? {
      provider: data.model.provider,
      model: data.model.model || '',
      reasoning: data.model.reasoning || '',
    }
    : null;
  if (JSON.stringify(model) !== JSON.stringify(cachedModel)) patch.model = model;

  const personaMode = document.getElementById('detailPersonaMode')?.value || 'inherit';
  const personaUid = String(document.getElementById('detailPersonaName')?.value ?? '').trim();
  // 本地卡存名字，外部卡存 `provider:id`；后端两种情况都能解析。
  const personaName = personaUid.startsWith('local:') ? personaUid.slice('local:'.length) : personaUid;
  if (personaMode === 'card' && !personaName) throw new Error('指定人格卡时需要在「人格卡」里选一张');
  if (personaMode !== (data.persona?.mode || 'inherit') || personaName !== (data.persona?.name || '')) {
    // 服务端把「name 非空」视为切到 card；继承/关闭只发 mode，由服务端把 name 清空。
    patch.persona = personaMode === 'card'
      ? { mode: 'card', name: personaName }
      : { mode: personaMode };
  }

  const promptText = String(document.getElementById('detailPrompt')?.value ?? '');
  if (promptText !== String(data.prompt?.text || '')) patch.prompt = { text: promptText };

  const accessAllowed = new Set(
    [...document.querySelectorAll('input[name="detailAccess"]:checked')].map((el) => el.value),
  );
  const accessPatch = {};
  for (const [axis] of ACCESS_AXES) {
    const allowed = accessAllowed.has(axis);
    if (allowed !== (data.access?.[axis] === 'allow')) accessPatch[axis] = allowed ? 'allow' : 'deny';
  }
  if (Object.keys(accessPatch).length) patch.access = accessPatch;

  const wake = data.wake && typeof data.wake === 'object' ? data.wake : {};
  const baseTriggers = wake.triggers && typeof wake.triggers === 'object' ? wake.triggers : {};
  const nextMode = document.getElementById('detailWakeMode')?.value === 'active' ? 'active' : 'diving';
  const wakeTriggers = new Set(
    [...document.querySelectorAll('input[name="detailWakeTriggers"]:checked')].map((el) => el.value),
  );
  const triggerState = {
    atMention: wakeTriggers.has('atMention'),
    nameMention: wakeTriggers.has('nameMention'),
    question: wakeTriggers.has('question'),
    poke: wakeTriggers.has('poke'),
    keywords: String(document.getElementById('detailWakeKeywords')?.value || '')
      .split(/[,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 50),
  };
  const cachedTriggers = {
    atMention: baseTriggers.atMention === true,
    nameMention: baseTriggers.nameMention === true,
    question: baseTriggers.question === true,
    poke: baseTriggers.poke === true,
    keywords: Array.isArray(baseTriggers.keywords) ? baseTriggers.keywords : [],
  };
  const wakeChanged = nextMode !== (wake.mode === 'active' ? 'active' : 'diving')
    || JSON.stringify(triggerState) !== JSON.stringify(cachedTriggers);
  const wakeConfig = wakeChanged
    ? { ...wake, mode: nextMode, triggers: { ...baseTriggers, ...triggerState } }
    : null;
  return { patch, wakeChanged, wakeConfig };
}

async function saveDetailAll() {
  if (!detailKey || !detailCache) return;
  const msg = document.getElementById('sessionDetailMsg');
  const btn = document.getElementById('sessionDetailSave');
  try {
    const { patch, wakeChanged, wakeConfig } = buildDetailPatch();
    const hasPatch = Object.keys(patch).length > 0;
    if (!hasPatch && !wakeChanged) {
      detailDirty = false;
      if (msg) msg.textContent = '没有改动';
      return;
    }
    if (btn) btn.disabled = true;
    let warnings = [];
    if (hasPatch) {
      const r = await api(`/api/sessions/${encodeURIComponent(detailKey)}/profile`, 'PATCH', patch);
      if (!r?.ok) throw new Error(r?.error || '保存失败');
      // 目录不可用这类「存下来了但没校验」的提示不由服务端报错，得原样转给用户。
      if (Array.isArray(r.warnings)) warnings = r.warnings;
    }
    if (wakeChanged) {
      const r = await api('/api/socialV2/wake-config', 'POST', { key: detailKey, config: wakeConfig });
      if (!r?.ok) throw new Error(r?.error || '保存唤醒失败');
    }
    detailDirty = false;
    await refreshSessions();
    await openDetail(detailKey);
    const note = warnings.length ? `已保存（${warnings.join('；')}）` : '已保存';
    if (msg) msg.textContent = warnings.length ? `⚠ ${note}` : note;
    showConsoleToast(warnings.length ? `⚠ ${note}` : note);
  } catch (error) {
    if (msg) msg.textContent = `失败：${String(error?.message ?? error)}`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function detailRebuild() {
  if (!detailKey) return;
  if (!window.confirm(`重建会归档当前 DSH 会话并新建一个（${detailKey}），继续？`)) return;
  try {
    const r = await api(`/api/sessions/${encodeURIComponent(detailKey)}/rebuild`, 'POST');
    if (!r?.ok) throw new Error(r?.error || '重建失败');
    showConsoleToast('已重建 DSH 会话');
    await refreshSessions();
    await openDetail(detailKey);
  } catch (error) {
    showConsoleToast(`重建失败：${String(error?.message ?? error)}`);
  }
}

async function detailReset() {
  if (!detailKey) return;
  if (!window.confirm(`重置会清掉这个会话的唤醒、未读、队列和待审批，下一条消息重新建 DSH 会话（人格/提示词/准入保留）。继续？`)) return;
  try {
    const r = await api('/api/session/reset', 'POST', { key: detailKey });
    if (!r?.ok) throw new Error(r?.error || '重置失败');
    showConsoleToast('会话状态已重置');
    await refreshSessions();
    await openDetail(detailKey);
  } catch (error) {
    showConsoleToast(`重置失败：${String(error?.message ?? error)}`);
  }
}

/** 换过 Agent 平台后把会话在新实例上重开：归档旧会话并新建一个，历史不迁移。 */
async function detailAgentReopen() {
  if (!detailKey) return;
  if (!window.confirm(`在新 Agent 平台上重开会归档当前会话并新建一个（${detailKey}）：历史消息不会迁移到新会话，人格/提示词/准入保留。继续？`)) return;
  try {
    const r = await api(`/api/sessions/${encodeURIComponent(detailKey)}/rebuild`, 'POST');
    if (!r?.ok) throw new Error(r?.error || '重开失败');
    showConsoleToast('已在新 Agent 平台上重开');
    await refreshSessions();
    await openDetail(detailKey);
  } catch (error) {
    showConsoleToast(`重开失败：${String(error?.message ?? error)}`);
  }
}

async function detailClearMemory() {
  if (!detailKey) return;
  if (!window.confirm(`清空 ${detailKey} 的本机轻量记忆（话题/想法/印象/规则）？`)) return;
  try {
    const r = await api('/api/memory/entries/clear', 'POST', { key: detailKey });
    if (!r?.ok) throw new Error(r?.error || '清空失败');
    showConsoleToast('本会话记忆已清空');
    void loadDetailMemory(detailKey);
  } catch (error) {
    showConsoleToast(`清空失败：${String(error?.message ?? error)}`);
  }
}

function refreshActive() {
  refreshSessions();
  refreshPending();
}

/** 渲染全局准入到任意宿主；config 页复用，sessions 页仍挂自己的宿主。 */
export function mountGlobalAccess(host) {
  if (!host) return;
  if (!host.querySelector('#accessPassiveMode')) {
    const spec = SESSIONS_FIELDS.access;
    if (spec?.html) host.innerHTML = spec.html;
    else if (spec?.fields) renderFields(host, spec.fields, { columns: 1 });
  }
  if (!host.dataset.accessBound) {
    host.dataset.accessBound = '1';
    bindSwitches(host);
    host.addEventListener('click', (event) => {
      if (!event.target.closest('[role="switch"]')) return;
      queueMicrotask(() => { readAccessDraft(); renderAccessSummary(); });
    });
    host.addEventListener('input', (event) => {
      if (!event.target.matches('textarea')) return;
      readAccessDraft();
      renderAccessSummary();
    });
  }
  void refreshGlobalAccess();
}

// ── 卡片外壳 ────────────────────────────────────────────────────────────────
// 卡片外壳由 components/card 的 cardHtml 生成，page.html 只留 #sessionsCards 宿主；
// body 里是标签条与两个面板的 [data-sessions-fields] 挂载点，弹窗在宿主之外。
const SESSIONS_CARDS = [
  {
    title: '会话与审批',
    description: '「会话映射」是桥接当前握着的全部会话：只显示平台侧身份与状态，改名会写回 DSH 侧栏标题；单独指定人格、仿真模式等配置不在这一页改。「审批 / 提问」只读，批准或回答都要去对应会话里回复。',
    body: '<div data-sessions-fields="tabs"></div>'
      + '<div class="page-panel" data-sessions-panel="sessions">'
      + '<div data-sessions-fields="sessionsPanel"></div>'
      + '</div>'
      + '<div class="page-panel" data-sessions-panel="pending" hidden>'
      + '<div data-sessions-fields="pendingPanel"></div>'
      + '</div>',
  },
];

function renderCards() {
  const host = document.getElementById('sessionsCards');
  if (!host) return;
  host.innerHTML = SESSIONS_CARDS.map((card) => cardHtml(card)).join('');
}

export function init() {
  // 先长出卡片外壳：下面的 [data-sessions-fields] 与弹窗节点都依赖这些节点。
  renderCards();
  // 再渲染字段规格（标签条 / 两个面板宿主 / 改名弹窗），下面取节点才不会拿到空。
  document.querySelectorAll('[data-sessions-fields]').forEach((host) => {
    const spec = SESSIONS_FIELDS[host.dataset.sessionsFields];
    if (spec?.html) host.innerHTML = spec.html;
    else if (spec?.fields) renderFields(host, spec.fields, { columns: 1 });
  });

  // 弹窗必须挂在 body 上：片段在 section.card 内，.card 的滤镜会给 position:fixed 造包含块。
  const overlay = document.getElementById('sessionRenameOverlay');
  if (overlay && overlay.parentElement !== document.body) document.body.appendChild(overlay);
  wireModal(overlay, { onClose: () => { renameTarget = null; } });
  document.getElementById('sessionRenameSave')?.addEventListener('click', () => { void saveRename(); });
  document.getElementById('sessionRenameCancel')?.addEventListener('click', () => closeModal(overlay));
  document.getElementById('sessionRenameInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void saveRename(); }
  });

  const detailOverlay = document.getElementById('sessionDetailOverlay');
  if (detailOverlay && detailOverlay.parentElement !== document.body) document.body.appendChild(detailOverlay);
  wireModal(detailOverlay, {
    onBeforeClose: () => !detailDirty || window.confirm('详情里有未保存的改动，确定关闭？'),
    onClose: () => { detailKey = null; detailCache = null; detailAgent = null; detailDirty = false; },
  });

  document.getElementById('sessionDetailBody')?.addEventListener('input', () => { if (!detailRendering) detailDirty = true; });
  document.getElementById('sessionDetailBody')?.addEventListener('change', () => { if (!detailRendering) detailDirty = true; });
  document.getElementById('sessionDetailSave')?.addEventListener('click', () => { void saveDetailAll(); });

  document.getElementById('sessionDetailBody')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-open-global-access]')) {
      if (detailDirty && !window.confirm('详情里有未保存的改动，先去改全局准入？')) return;
      closeModal(detailOverlay);
      document.querySelector('[data-view="config"]')?.click();
      setTimeout(() => {
        document.querySelector('[data-config-section="access"]')?.click();
        document.getElementById('accessPassiveEntries')?.focus();
      }, 80);
      return;
    }
    if (event.target.closest('[data-detail-rebuild]')) { void detailRebuild(); return; }
    if (event.target.closest('[data-detail-reset]')) { void detailReset(); return; }
    if (event.target.closest('[data-detail-agent-reopen]')) { void detailAgentReopen(); return; }
    if (event.target.closest('[data-detail-clear-memory]')) { void detailClearMemory(); return; }
    const nav = event.target.closest('[data-detail-nav]');
    if (nav) {
      closeModal(detailOverlay);
      window.location.hash = nav.dataset.detailNav || '';
    }
  });

  document.querySelectorAll('[data-sessions-tab]').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.sessionsTab));
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
