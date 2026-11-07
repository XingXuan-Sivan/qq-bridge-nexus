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

function accessPill(value, explicit) {
  const label = value === 'allow' ? '允许' : '拒绝';
  const cls = value === 'allow' ? 'pill g' : 'pill r';
  const inherit = explicit === 'inherit' ? ' <span class="meta">继承</span>' : '';
  return `<span class="${cls}">${label}</span>${inherit}`;
}

function accessCell(entry) {
  const access = entry.access || {};
  return `<span class="meta">被动</span> ${accessPill(access.passive, access.passiveValue)}`
    + ` <span class="meta">主动</span> ${accessPill(access.proactive, access.proactiveValue)}`;
}

function nameCell(entry) {
  const ownerTag = entry.owner ? ' <span class="pill r">管理员</span>' : '';
  const platformTag = `<span class="pill">${esc(platformOf(entry))}</span>`;
  const blocked = entry.blocked ? ' <span class="pill r">黑名单</span>' : '';
  const name = entry.displayName
    ? `<strong>${esc(entry.displayName)}</strong> <span class="meta">${esc(entry.key)}</span>`
    : `<strong>${esc(entry.key)}</strong>`;
  return `${name} ${platformTag}${kindPill(entry)}${ownerTag}${blocked}`;
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
    empty: '还没有会话：白名单中的群或好友发来消息、或被唤醒后，会话会显示在这里。',
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

function detailDshLabel(health, sessionId) {
  if (!sessionId) return '<span class="pill">未建</span>';
  const status = health?.status || 'unknown';
  const label = { online: '在线', missing: '缺失', unknown: '未知' }[status] || status;
  return `<span class="${status === 'online' ? 'pill g' : status === 'missing' ? 'pill r' : 'pill'}">${esc(label)}</span>`;
}

function renderDetail(data) {
  const body = document.getElementById('sessionDetailBody');
  if (!body) return;
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

      <div class="detail-card">
        <h4>准入</h4>
        <div class="meta">被动=普通消息是否回复；主动=定时任务与 AI 主动发言是否允许。这里的值只影响本会话。</div>
        ${detailRow('被动', detailSelect('detailPassive', access.passiveValue || 'inherit', [['inherit', '继承默认'], ['allow', '允许'], ['deny', '拒绝']]), `当前生效：${access.passive === 'allow' ? '允许' : '拒绝'}（默认 ${access.defaults?.passive === 'allow' ? '允许' : '拒绝'}）`)}
        ${detailRow('主动', detailSelect('detailProactive', access.proactiveValue || 'inherit', [['inherit', '继承默认'], ['allow', '允许'], ['deny', '拒绝']]), `当前生效：${access.proactive === 'allow' ? '允许' : '拒绝'}（默认 ${access.defaults?.proactive === 'allow' ? '允许' : '拒绝'}）`)}
        ${detailRow('黑名单', `<label class="field-check-item"><input type="checkbox" id="detailBlocked"${data.blocked ? ' checked' : ''}>把这个会话加入黑名单（两根轴一律拒绝）</label>`)}
        <div class="detail-actions"><button class="btn small primary" type="button" data-detail-save="access">保存准入</button></div>
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
  const promptEl = document.getElementById('detailPrompt');
  promptEl?.addEventListener('input', () => {
    const counter = document.getElementById('detailPromptCount');
    if (counter) counter.textContent = String(promptEl.value.length);
  });
  void loadDetailMemory(data.key);
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
    const data = await api(`/api/sessions/${encodeURIComponent(key)}/profile`);
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
      patch = {
        access: {
          passive: document.getElementById('detailPassive')?.value || 'inherit',
          proactive: document.getElementById('detailProactive')?.value || 'inherit',
        },
        blocked: document.getElementById('detailBlocked')?.checked === true,
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
  wireModal(detailOverlay, { onClose: () => { detailKey = null; detailCache = null; } });

  document.getElementById('sessionDetailBody')?.addEventListener('click', (event) => {
    const save = event.target.closest('[data-detail-save]');
    if (save) { void saveDetail(save.dataset.detailSave); return; }
    if (event.target.closest('[data-detail-rebuild]')) { void detailRebuild(); return; }
    if (event.target.closest('[data-detail-reset]')) { void detailReset(); return; }
    if (event.target.closest('[data-detail-clear-memory]')) { void detailClearMemory(); }
  });

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
