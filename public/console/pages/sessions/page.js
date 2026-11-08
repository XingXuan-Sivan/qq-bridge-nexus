// 会话与审批页：会话映射（平台侧身份 → DSH 会话）与只读的挂起审批 / 提问，两块在同一页用标签页切换。
//
// 页面目录约定（docs/PLUGIN_ROADMAP.md §8.7）：page.js 导出 init()，路由器在片段注入后调用。
// 数据来源只有两个接口：/api/sessions（会话清单，已含平台/模式/人格/未读/最近唤醒）与 /api/pending。
// 会话 key 形如 `qq:group:123`、`qq:private:456`：平台前缀用于筛选，页面不假设只有一个平台。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { closeModal, openModal, wireModal } from '../../components/modal/modal.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { bindSwitches, getSwitch, renderFields, setSwitch } from '../../components/form/form.js';
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

function accessPill(value) {
  return value === 'allow'
    ? '<span class="pill g">允许</span>'
    : '<span class="pill r">拒绝</span>';
}

function accessCell(entry) {
  const access = entry.access || {};
  return `<span class="meta">被动</span> ${accessPill(access.passive)}`
    + ` <span class="meta">主动</span> ${accessPill(access.proactive)}`;
}

function nameCell(entry) {
  const ownerTag = entry.owner ? ' <span class="pill r">管理员</span>' : '';
  const platformTag = `<span class="pill">${esc(platformOf(entry))}</span>`;
  const name = entry.displayName
    ? `<strong>${esc(entry.displayName)}</strong> <span class="meta">${esc(entry.key)}</span>`
    : `<strong>${esc(entry.key)}</strong>`;
  return `${name} ${platformTag}${kindPill(entry)}${ownerTag}`;
}

function dshCell(entry) {
  if (!entry.sessionId) return '<span class="pill">未建</span> <span class="meta">只有档案</span>';
  const health = entry.dsh || {};
  const status = health.status || 'unknown';
  const label = { online: '在线', missing: '缺失', unknown: '未知' }[status] || status;
  const pill = status === 'online' ? 'pill g' : status === 'missing' ? 'pill r' : 'pill';
  const when = health.checkedAt ? ` <span class="meta">${whenCell(health.checkedAt)}</span>` : '';
  return `<span class="${pill}">${esc(label)}</span>${when}`;
}


// 平台下拉按数据现算：出现哪些平台就列哪些，不写死 qq。筛选本身交给 dataTableHtml 的 filters。
function platformOptions() {
  const platforms = [...new Set(sessionsCache.map(platformOf))].sort();
  return [{ value: 'all', label: '全部平台' }, ...platforms.map((p) => ({ value: p, label: p }))];
}

// ── 全局准入：两态单源名单 ──────────────────────────────────────────────────
// 白名单 = 默认拒绝 + 名单内允许；黑名单 = 默认允许 + 名单内拒绝。会话详情的开关
// 改的也是同一份名单，所以这里不再维护第二套「全局/局部」配置。
const ACCESS_AXES = [['passive', '被动'], ['proactive', '主动']];
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

function accessInvalidLines(lines) {
  return lines.filter((line) => !/^(?:qq:)?(?:group|private):[1-9]\d*$/.test(line));
}

function accessReason(axis, summary) {
  const mode = summary?.[`${axis}Mode`] || 'allow';
  const member = summary?.[`${axis}Member`] === true;
  if (mode === 'allow') return member ? '白名单成员：允许' : '不在白名单：拒绝';
  return member ? '黑名单成员：拒绝' : '不在黑名单：允许';
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

async function refreshGlobalAccess() {
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

async function saveGlobalAccess() {
  const msg = document.getElementById('accessMsg');
  const done = (text) => { if (msg) msg.textContent = text; showConsoleToast(text); };
  readAccessDraft();
  if (!accessDraft) return;
  const invalid = ACCESS_AXES.flatMap(([axis]) => accessInvalidLines(accessDraft[axis].entries));
  if (invalid.length) {
    if (msg) msg.textContent = `有 ${invalid.length} 行不是合法会话`;
    return;
  }
  const body = {
    passive: { mode: accessDraft.passive.mode, entries: accessDraft.passive.entries },
    proactive: { mode: accessDraft.proactive.mode, entries: accessDraft.proactive.entries },
  };
  try {
    let r = await api('/api/access', 'PATCH', body);
    if (!r?.ok && r?.requiresConfirm) {
      const ok = window.confirm(r.error || `切换名单模式会翻转所有会话的生效结果（影响 ${r.affected} 个会话），确定保存？`);
      if (!ok) return;
      r = await api('/api/access', 'PATCH', { ...body, confirmFlip: true });
    }
    if (!r?.ok) throw new Error(r?.error || '保存失败');
    applyAccessPayload(r);
    const affected = Number(r.affected);
    done(affected > 0 ? `全局准入已保存（影响 ${affected} 个会话）` : '全局准入已保存');
  } catch (error) {
    if (msg) msg.textContent = String(error?.message ?? error);
  }
}

function renderSessions() {
  const box = document.getElementById('sessionList');
  if (!box) return;
  const platforms = platformOptions();
  const rows = sessionsCache.map((entry) => {
    const unread = entry.unread ? `<span class="pill r">${entry.unread}</span>` : '<span class="meta">0</span>';
    const rebuild = entry.sessionId
      ? ` <button type="button" class="btn small" data-rebuild-key="${esc(entry.key)}">重建</button>`
      : '';
    const delProfile = entry.hasProfile
      ? ` <button type="button" class="btn small danger" data-drop-key="${esc(entry.key)}">删档案</button>`
      : '';
    return {
      cells: [
        nameCell(entry),
        modeCell(entry),
        accessCell(entry),
        personaCell(entry),
        dshCell(entry),
        unread,
        whenCell(entry.lastWakeAt),
        `<button type="button" class="btn small primary" data-manage-key="${esc(entry.key)}">管理</button>`
          + ` <button type="button" class="btn small" data-rename-key="${esc(entry.key)}">改名</button>${rebuild}${delProfile}`,
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
      { label: 'DSH', width: '120px' },
      { label: '未读', width: '60px' },
      { label: '最近唤醒', width: '95px' },
      { label: '操作', width: '290px' },
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
    empty: '还没有会话：全局准入名单里的群或好友发来消息、或被唤醒后，会话会显示在这里。',
  });
  initDataTables(box, { onRefresh: refreshSessions });

  box.querySelectorAll('[data-manage-key]').forEach((btn) => btn.addEventListener('click', () => {
    openDetail(btn.dataset.manageKey);
  }));
  box.querySelectorAll('[data-rename-key]').forEach((btn) => btn.addEventListener('click', () => {
    openRename(btn.dataset.renameKey);
  }));
  box.querySelectorAll('[data-rebuild-key]').forEach((btn) => btn.addEventListener('click', () => {
    void rebuildSession(btn.dataset.rebuildKey);
  }));
  box.querySelectorAll('[data-drop-key]').forEach((btn) => btn.addEventListener('click', () => {
    void dropProfile(btn.dataset.dropKey);
  }));
}

async function rebuildSession(key) {
  if (!window.confirm(`重建会归档当前 DSH 会话并新建一个（${key}），继续？`)) return;
  try {
    const r = await api(`/api/sessions/${encodeURIComponent(key)}/rebuild`, 'POST');
    if (!r?.ok) throw new Error(r?.error || '重建失败');
    showConsoleToast('已重建 DSH 会话');
    await refreshSessions();
  } catch (error) {
    showConsoleToast(`重建失败：${error?.message ?? error}`);
  }
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

// ── 详情（P1） ────────────────────────────────────────────────────────────
// 一卡一件事、每卡独立保存：改准入不会顺手把没保存的提示词一起写掉。
let detailKey = null;
let detailCache = null;
let detailDirty = false;

function detailRow(label, control, hint = '') {
  return `<div class="control-row"><span class="control-label">${esc(label)}</span>`
    + `<div class="control-grow">${control}${hint ? `<div class="field-hint">${esc(hint)}</div>` : ''}</div></div>`;
}

function detailSelect(id, value, options) {
  return `<select id="${esc(id)}">${options.map(([v, label]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
}

function detailCheck(id, label, checked) {
  return `<label class="field-check-item"><input type="checkbox" id="${esc(id)}"${checked ? ' checked' : ''}>${esc(label)}</label>`;
}

function detailAccessRow(axis, label, summary) {
  const allowed = summary?.[axis] === 'allow';
  const reason = accessReason(axis, summary);
  return `<div class="control-row">`
    + `<span class="control-label">${esc(label)}</span>`
    + `<div class="control-grow detail-access-inline">`
    + `<button type="button" class="field-switch" role="switch" aria-checked="${allowed}" data-detail-access="${axis}">`
    + `<span class="field-switch-track" aria-hidden="true"></span><span data-detail-access-label>${allowed ? '允许' : '拒绝'}</span></button>`
    + `<span class="meta" data-detail-access-state>${esc(reason)}</span>`
    + '</div></div>';
}

function detailAccessCard(access) {
  const passiveMode = access?.passiveMode === 'deny' ? 'deny' : 'allow';
  const proactiveMode = access?.proactiveMode === 'deny' ? 'deny' : 'allow';
  return `<div class="detail-card">
        <h4>准入</h4>
        <div class="meta">这份名单是全局总闸门，会话内的开关改的也是它。白名单默认拒绝、名单内允许；黑名单默认允许、名单内拒绝。管理命令和审批不受这里影响。</div>
        <div class="detail-access-list">
          ${detailAccessRow('passive', '被动', access)}
          ${detailAccessRow('proactive', '主动', access)}
        </div>
        <div class="field-hint">被动 ${accessModeLabel(passiveMode)} · 主动 ${accessModeLabel(proactiveMode)}　<button class="access-link" type="button" data-open-global-access>调整全局准入</button></div>
        <div class="detail-actions"><button class="btn small primary" type="button" data-detail-save="access">保存准入</button></div>
      </div>`;
}
function detailDshLabel(health, sessionId) {
  if (!sessionId) return '<span class="pill">未建</span>';
  const status = health?.status || 'unknown';
  const label = { online: '在线', missing: '缺失', unknown: '未知' }[status] || status;
  return `<span class="${status === 'online' ? 'pill g' : status === 'missing' ? 'pill r' : 'pill'}">${esc(label)}</span>`;
}

// 详情弹窗的 DSH 模型目录：打开时取一次，供运行卡的提供方/模型/思考强度下拉使用。
let detailCatalog = null;
async function ensureDetailCatalog() {
  if (detailCatalog) return detailCatalog;
  try {
    const r = await api('/api/dsh/model');
    detailCatalog = Array.isArray(r?.providers) ? r.providers : [];
  } catch {
    detailCatalog = [];
  }
  return detailCatalog;
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
    modelEl.innerHTML = '<option value="">跟随全局</option>';
    modelEl.disabled = true;
    reasonEl.innerHTML = '<option value="">跟随全局</option>';
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

function renderDetail(data) {
  const body = document.getElementById('sessionDetailBody');
  if (!body) return;
  detailDirty = false; // 重新渲染后表单与缓存一致，脏标记清零
  const wake = data.wake && typeof data.wake === 'object' ? data.wake : {};
  const triggers = wake.triggers && typeof wake.triggers === 'object' ? wake.triggers : {};
  const access = data.access || {};
  const persona = data.persona || {};
  const prompt = data.prompt || {};
  body.innerHTML = `
    <div class="session-detail-head">
      <span class="session-detail-key">${esc(data.key)}</span>
      ${detailDshLabel(data.dsh, data.sessionId)}
      <span class="meta">${data.sessionId ? esc(data.sessionId) : '还没有 DSH 会话，下一条消息到达时会自动创建'}</span>
    </div>
    <div class="session-detail-grid">
      <div class="detail-card">
        <h4>显示名</h4>
        <div class="meta">自定义名会同步写 DSH 侧栏标题；留空则用默认的「QQ·群 / QQ·私聊 + ID」。</div>
        ${detailRow('名称', `<input id="detailDisplayName" type="text" maxlength="60" value="${esc(data.displayName || '')}" placeholder="留空使用默认名">`)}
        <div class="detail-actions"><button class="btn small primary" type="button" data-detail-save="displayName">保存名称</button></div>
      </div>

      ${detailAccessCard(access)}

      <div class="detail-card">
        <h4>运行</h4>
        <div class="meta">默认跟随全局模式；单独指定后只影响这个会话。closed-agent 不能按会话切换。</div>
        ${detailRow('模式', detailSelect('detailMode', data.mode || 'inherit', [['inherit', '跟随全局'], ['chat', '聊天模式'], ['reserved', '一代仿真'], ['reserved2', '二代仿真']]), `当前生效：${esc(data.effectiveMode || '—')}`)}
        ${detailRow('DSH 预设', detailSelect('detailPresetId', data.presetId || '', [['', '跟随模式默认'], ...(Array.isArray(data.presets) ? data.presets : []).map((id) => [id, id])]), '只影响这个会话的 DSH 会话；保存后下次唤醒按指纹自动重建。')}
        ${detailRow('模型', detailSelect('detailModelProvider', data.model?.provider || '', [['', '跟随全局'], ...(detailCatalog || []).map((p) => [p.id, p.name || p.id])]), `当前生效：${esc(data.effectiveModel?.provider || '—')} / ${esc(data.effectiveModel?.model || '—')}`)}
        ${detailRow('具体模型', detailSelect('detailModel', data.model?.model || '', []))}
        ${detailRow('思考强度', detailSelect('detailModelReasoning', data.model?.reasoning || '', []), '保存会话模型会同步写 DSH 全局默认，Web GUI 里新建会话也会用这个模型；本会话按自己的模型能力决定能否看图。')}
        <div class="detail-actions"><button class="btn small primary" type="button" data-detail-save="run">保存运行</button></div>
      </div>

      <div class="detail-card">
        <h4>人格</h4>
        <div class="meta">继承=跟随全局当前人格；指定=这个会话固定用一张卡；关闭=不挂卡。</div>
        ${detailRow('模式', detailSelect('detailPersonaMode', persona.mode || 'inherit', [['inherit', '继承全局'], ['card', '指定人格卡'], ['off', '不挂卡']]))}
        ${detailRow('人格名', `<input id="detailPersonaName" type="text" value="${esc(persona.name || '')}" placeholder="例如：猫娘">`, persona.resolved?.name && persona.mode === 'inherit' ? `当前实际使用：${persona.resolved.name}` : '')}
        <div class="detail-actions"><button class="btn small primary" type="button" data-detail-save="persona">保存人格</button></div>
      </div>

      <div class="detail-card">
        <h4>初始提示词</h4>
        <div class="meta">只在 AI 第一次进入这个会话时读一次；留空表示没有初始提示词。</div>
        <textarea id="detailPrompt" maxlength="${Number(prompt.maxChars) || 2000}" placeholder="例如：这是一个偏技术的闲聊群…">${esc(prompt.text || '')}</textarea>
        <div class="field-hint"><span id="detailPromptCount">${String(prompt.text || '').length}</span> / ${Number(prompt.maxChars) || 2000} 字</div>
        <div class="detail-actions"><button class="btn small primary" type="button" data-detail-save="prompt">保存提示词</button></div>
      </div>

      <div class="detail-card">
        <h4>唤醒</h4>
        <div class="meta">这里只改最常见的触发条件；更细的批次窗口等参数仍在「二代仿真」页。</div>
        ${detailRow('模式', detailSelect('detailWakeMode', wake.mode === 'active' ? 'active' : 'diving', [['diving', '潜水'], ['active', '活跃']]))}
        <div class="control-row"><span class="control-label">触发</span><div class="control-grow"><div class="detail-readonly">
          ${detailCheck('detailWakeAt', '@ 唤醒', triggers.atMention === true)}
          ${detailCheck('detailWakeName', '名字唤醒', triggers.nameMention === true)}
          ${detailCheck('detailWakeQuestion', '提问唤醒', triggers.question === true)}
          ${detailCheck('detailWakePoke', '拍一拍', triggers.poke === true)}
        </div></div></div>
        ${detailRow('关键词', `<input id="detailWakeKeywords" type="text" value="${esc(Array.isArray(triggers.keywords) ? triggers.keywords.join(', ') : '')}" placeholder="逗号分隔">`)}
        <div class="detail-actions"><button class="btn small primary" type="button" data-detail-save="wake">保存唤醒</button></div>
      </div>

      <div class="detail-card">
        <h4>记忆</h4>
        <div class="meta">本机轻量记忆按会话隔离；这里只显示计数与清空入口，编辑在「记忆」页。</div>
        <div class="detail-readonly" id="detailMemory"><span class="meta">读取中…</span></div>
        <div class="detail-actions">
          <button class="btn small danger" type="button" data-detail-clear-memory>清空本会话记忆</button>
          <a class="btn small" href="#memory">去记忆页</a>
        </div>
      </div>

      <div class="detail-card">
        <h4>定时任务</h4>
        <div class="meta">指向这个会话的定时任务（只读）；增删改仍在「定时任务」页。</div>
        <div class="detail-readonly" id="detailTasks"><span class="meta">读取中…</span></div>
        <div class="detail-actions"><a class="btn small" href="#scheduler">去定时任务</a></div>
      </div>

      <div class="detail-card detail-card--wide detail-danger">
        <h4>危险操作</h4>
        <div class="meta">重建会归档当前 DSH 会话并新建一个（上下文清空，人格/提示词/准入保留）；重置会清掉唤醒、未读、队列和审批，下一条消息重新建会话。</div>
        <div class="detail-actions">
          ${data.sessionId
            ? `<button class="btn small" type="button" data-detail-rebuild>重建 DSH 会话</button>
               <button class="btn small danger" type="button" data-detail-reset>重置会话状态</button>`
            : '<span class="meta">还没有 DSH 会话：下一条消息到达时会自动创建，无需重建或重置。</span>'}
        </div>
      </div>
    </div>`;
  body.querySelectorAll('select').forEach((el) => el.dispatchEvent(new Event('change', { bubbles: true })));
  syncDetailModelSelects(data.model?.model || data.effectiveModel?.model || '', data.model?.reasoning || '');
  document.getElementById('detailModelProvider')?.addEventListener('change', () => syncDetailModelSelects('', ''));
  document.getElementById('detailModel')?.addEventListener('change', () => {
    const modelEl = document.getElementById('detailModel');
    syncDetailModelSelects(modelEl?.value || '', '');
  });
  const promptEl = document.getElementById('detailPrompt');
  promptEl?.addEventListener('input', () => {
    const counter = document.getElementById('detailPromptCount');
    if (counter) counter.textContent = String(promptEl.value.length);
  });
  void loadDetailMemory(data.key);
  void loadDetailTasks(data.key);
}

async function loadDetailTasks(key) {
  const box = document.getElementById('detailTasks');
  if (!box) return;
  try {
    const r = await api('/api/scheduler');
    const tasks = (r?.tasks || []).filter((t) => Array.isArray(t.targets) && t.targets.includes(key));
    if (!tasks.length) { box.innerHTML = '<span class="meta">没有指向这个会话的定时任务</span>'; return; }
    box.innerHTML = tasks.slice(0, 10).map((t) => `<div class="u-mt-2">`
      + `<span class="pill ${t.enabled === false ? '' : 'g'}">${t.enabled === false ? '暂停' : '启用'}</span> `
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

async function openDetail(key) {
  const overlay = document.getElementById('sessionDetailOverlay');
  if (!overlay) return;
  detailKey = key;
  detailCache = null;
  const body = document.getElementById('sessionDetailBody');
  if (body) body.innerHTML = '<div class="meta">读取中…</div>';
  const msg = document.getElementById('sessionDetailMsg');
  if (msg) msg.textContent = '';
  openModal(overlay);
  try {
    const [data] = await Promise.all([
      api(`/api/sessions/${encodeURIComponent(key)}/profile`),
      ensureDetailCatalog(),
    ]);
    if (!data?.ok) throw new Error(data?.error || '读取失败');
    detailCache = data;
    renderDetail(data);
  } catch (error) {
    if (body) body.innerHTML = `<div class="empty-state"><strong>读取会话失败</strong><p>${esc(String(error?.message ?? error))}</p></div>`;
  }
}

async function saveDetail(kind) {
  if (!detailKey) return;
  const msg = document.getElementById('sessionDetailMsg');
  const done = (text) => { if (msg) msg.textContent = text; showConsoleToast(text); };
  try {
    if (kind === 'wake') {
      const wake = detailCache?.wake && typeof detailCache.wake === 'object' ? detailCache.wake : {};
      const triggers = { ...(wake.triggers || {}) };
      for (const [id, field] of [['detailWakeAt', 'atMention'], ['detailWakeName', 'nameMention'], ['detailWakeQuestion', 'question'], ['detailWakePoke', 'poke']]) {
        triggers[field] = document.getElementById(id)?.checked === true;
      }
      triggers.keywords = String(document.getElementById('detailWakeKeywords')?.value || '')
        .split(/[,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 50);
      const config = {
        ...wake,
        mode: document.getElementById('detailWakeMode')?.value === 'active' ? 'active' : 'diving',
        triggers,
      };
      const r = await api('/api/socialV2/wake-config', 'POST', { key: detailKey, config });
      if (!r?.ok) throw new Error(r?.error || '保存失败');
      await openDetail(detailKey);
      if (msg) msg.textContent = '唤醒已保存';
      showConsoleToast('唤醒已保存');
      return;
    }
    let patch = {};
    if (kind === 'displayName') {
      patch = { displayName: document.getElementById('detailDisplayName')?.value || '' };
    } else if (kind === 'access') {
      const verdict = (axis) => document.querySelector(`[data-detail-access="${axis}"]`)?.getAttribute('aria-checked') === 'true' ? 'allow' : 'deny';
      patch = { access: { passive: verdict('passive'), proactive: verdict('proactive') } };
    } else if (kind === 'run') {
      const provider = document.getElementById('detailModelProvider')?.value || '';
      patch = {
        mode: document.getElementById('detailMode')?.value || 'inherit',
        presetId: document.getElementById('detailPresetId')?.value || '',
        model: provider
          ? {
            provider,
            model: document.getElementById('detailModel')?.value || '',
            reasoning: document.getElementById('detailModelReasoning')?.value || '',
          }
          : null,
      };
    } else if (kind === 'persona') {
      patch = {
        persona: {
          mode: document.getElementById('detailPersonaMode')?.value || 'inherit',
          name: document.getElementById('detailPersonaName')?.value || '',
        },
      };
    } else if (kind === 'prompt') {
      patch = { prompt: { text: document.getElementById('detailPrompt')?.value || '' } };
    }
    const r = await api(`/api/sessions/${encodeURIComponent(detailKey)}/profile`, 'PATCH', patch);
    if (!r?.ok) throw new Error(r?.error || '保存失败');
    await refreshSessions();
    if (detailKey) await openDetail(detailKey);
    if (msg) msg.textContent = '已保存';
    showConsoleToast('已保存');
  } catch (error) {
    if (msg) msg.textContent = `失败：${String(error?.message ?? error)}`;
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
  refreshGlobalAccess();
}

function toggleDetailAccess(axis) {
  const btn = document.querySelector(`[data-detail-access="${axis}"]`);
  if (!btn) return;
  const allowed = btn.getAttribute('aria-checked') === 'true';
  const next = !allowed;
  const mode = detailCache?.access?.[`${axis}Mode`] === 'deny' ? 'deny' : 'allow';
  const member = mode === 'allow' ? next : !next;
  btn.setAttribute('aria-checked', next ? 'true' : 'false');
  const label = btn.querySelector('[data-detail-access-label]');
  if (label) label.textContent = next ? '允许' : '拒绝';
  const state = document.querySelector(`[data-detail-access-state="${axis}"]`)
    || btn.parentElement?.querySelector('[data-detail-access-state]');
  if (state) {
    state.textContent = mode === 'allow'
      ? (member ? '白名单成员：允许（保存后生效）' : '不在白名单：拒绝（保存后生效）')
      : (member ? '黑名单成员：拒绝（保存后生效）' : '不在黑名单：允许（保存后生效）');
  }
  detailDirty = true;
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

  const detailOverlay = document.getElementById('sessionDetailOverlay');
  if (detailOverlay && detailOverlay.parentElement !== document.body) document.body.appendChild(detailOverlay);
  wireModal(detailOverlay, {
    onBeforeClose: () => !detailDirty || window.confirm('详情里有未保存的改动，确定关闭？'),
    onClose: () => { detailKey = null; detailCache = null; detailDirty = false; },
  });

  document.getElementById('sessionDetailBody')?.addEventListener('input', () => { detailDirty = true; });
  document.getElementById('sessionDetailBody')?.addEventListener('change', () => { detailDirty = true; });
  document.getElementById('sessionDetailBody')?.addEventListener('click', (event) => {
    const accessToggle = event.target.closest('[data-detail-access]');
    if (accessToggle) { toggleDetailAccess(accessToggle.dataset.detailAccess); return; }
    if (event.target.closest('[data-open-global-access]')) {
      if (detailDirty && !window.confirm('详情里有未保存的改动，先去改全局准入？')) return;
      closeModal(detailOverlay);
      const panel = document.querySelector('[data-sessions-fields="access"]');
      panel?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      document.getElementById('accessPassiveEntries')?.focus();
      return;
    }
    const save = event.target.closest('[data-detail-save]');
    if (save) { void saveDetail(save.dataset.detailSave); return; }
    if (event.target.closest('[data-detail-rebuild]')) { void detailRebuild(); return; }
    if (event.target.closest('[data-detail-reset]')) { void detailReset(); return; }
    if (event.target.closest('[data-detail-clear-memory]')) { void detailClearMemory(); }
  });

  const accessHost = document.querySelector('[data-sessions-fields="access"]');
  if (accessHost) bindSwitches(accessHost);
  accessHost?.addEventListener('click', (event) => {
    if (!event.target.closest('[role="switch"]')) return;
    queueMicrotask(() => { readAccessDraft(); renderAccessSummary(); });
  });
  accessHost?.addEventListener('input', (event) => {
    if (!event.target.matches('textarea')) return;
    readAccessDraft();
    renderAccessSummary();
  });
  document.getElementById('accessSave')?.addEventListener('click', () => { void saveGlobalAccess(); });

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
