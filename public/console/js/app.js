// 页面入口：装配各个模块，再启动首屏。所有「能力」都在 ./api.js、./ui.js、./router.js 里，
// 这个文件只负责把数据、页面、事件接起来。
import { api, bootstrapConsoleToken } from './api.js';
import { esc, showConsoleToast, simpleTable, applyPageA11y } from './ui.js';
import { tzOptionsHtml, tzSet } from './timezone.js';
import { consolePages, getCurrentPage, initRouter, onPageRefresh, refreshCurrentPage, setConsolePage, setSearchCloser } from './router.js';
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
    document.getElementById('roleText').textContent = s.role || '无';
    document.getElementById('roleModeText').textContent = s.roleMode === 'silent' ? '静默' : '正常';
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

// ── 人格管理 ────────────────────────────────────────────────────────────────
// 人格提示词 = roles/<名称>.md，桥接每条消息注入，保存即生效。
let roleEditorState = { mode: 'new', name: '' };
let roleCache = [];
let roleInjectMax = 6000;

/** 保存人格后，描述二代会话什么时候读到新卡。 */
function roleSaveRefreshText(x) {
  if (!x || x.notActive) return '';
  if (x.note) return '；' + x.note;
  if (x.apply === 'immediate') return '；已唤醒 ' + x.woke + ' 个会话重新读卡' + (x.pending ? '，' + x.pending + ' 个在定时静默里，静默结束后再读' : '') + (x.woke || x.pending ? '' : '（都已是新卡）');
  return x.pending ? '；' + x.pending + ' 个会话会在下一次唤醒时读到新卡' : '';
}
function setRoleMsg(text, ok) {
  const el = document.getElementById('roleCreateMsg');
  el.textContent = text;
  el.className = ok === undefined ? 'meta' : (ok ? 'meta ok' : 'meta err');
}

function renderRoleEditor() {
  const editing = roleEditorState.mode === 'edit';
  document.getElementById('roleEditorMeta').textContent = editing
    ? `正在编辑「${roleEditorState.name}」：改完点「保存修改」；改名字会同时重命名文件。`
    : '当前是「新建」模式：填好名称与内容后点「新建人格」；名称与已有的人格同名则会改为保存修改。';
  document.getElementById('roleCreate').textContent = editing ? '保存修改' : '新建人格';
}

function roleEditorWarnings(text) {
  const value = String(text ?? '');
  const warns = [];
  if (value.length > roleInjectMax) warns.push(`超出注入上限：当前 ${value.length} 字符，只有前 ${roleInjectMax} 字符会进入提示词（多余 ${value.length - roleInjectMax} 字符不会生效）`);
  if (/\[SILENT\]|空格分隔|按空格|用空格|空格分句|空格代表|自动转发|回复会自动|输出\s*\[SILENT\]/i.test(value)) {
    warns.push('含一代仿真专用指令（[SILENT] / 空格分句 / 自动转发），二代仿真下这些行会被自动过滤');
  }
  return warns;
}

function updateRoleEditorWarnings() {
  const warns = roleEditorWarnings(document.getElementById('newRoleContent').value);
  document.getElementById('roleEditorWarnings').textContent = warns.length ? '⚠️ ' + warns.join('；') : '';
}

async function openRoleForEdit(name) {
  setRoleMsg('读取中…');
  const res = await api('/api/roles/content?name=' + encodeURIComponent(name));
  if (!res.ok) { setRoleMsg(res.error || '读取失败', false); return; }
  document.getElementById('newRoleName').value = name;
  document.getElementById('newRoleContent').value = res.content;
  roleEditorState = { mode: 'edit', name };
  renderRoleEditor();
  updateRoleEditorWarnings();
  setRoleMsg(`已载入「${name}」（${res.chars} 字符）`, true);
}

function resetRoleForm() {
  document.getElementById('newRoleName').value = '';
  document.getElementById('newRoleContent').value = '';
  roleEditorState = { mode: 'new', name: '' };
  renderRoleEditor();
  updateRoleEditorWarnings();
  setRoleMsg('');
}

/** 按会话设置人格：下拉框选项（跟随全局 / 不挂卡 / 各人格）。value 形如 default、off、role:名字。 */
function roleAssignOptions(select, current, globalRole) {
  select.replaceChildren();
  const add = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; select.appendChild(o); };
  add('default', '跟随全局默认' + (globalRole ? '（' + globalRole + '）' : '（不挂卡）'));
  add('off', '不挂角色卡');
  for (const role of roleCache) add('role:' + role.name, role.name);
  if (current && current.startsWith('role:') && ![...select.options].some((o) => o.value === current)) add(current, current.slice(5) + '（文件不存在）');
  select.value = current || 'default';
}
function roleAssignApplyMode() {
  const el = document.querySelector('input[name="roleAssignApply"]:checked');
  return el ? el.value : 'nextWake';
}
function roleAssignBody(key, value) {
  const apply = roleAssignApplyMode();
  if (value === 'default' || value === 'off') return { key, use: value, apply };
  return { key, use: 'role', role: value.slice(5), apply };
}
// 下拉框改了还没点「保存」的会话：key -> 选的值。列表重新加载时保留这些选择，并标出「未保存」。
const roleAssignDirty = new Map();
async function saveRoleAssign(key, value) {
  const x = await api('/api/roles/assign', 'POST', roleAssignBody(key, value));
  if (x.ok) roleAssignDirty.delete(x.key);
  const msg = document.getElementById('roleAssignMsg');
  msg.className = x.ok ? 'meta ok' : 'meta err';
  msg.textContent = !x.ok ? '❌ ' + (x.error || '保存失败')
    : '✅ ' + x.key + (x.source === 'global' ? ' 跟随全局默认' : x.source === 'off' ? ' 不挂角色卡' : ' 单独使用「' + x.role + '」') + roleSaveRefreshText(x.refresh);
  if (x.ok) refreshRoles();
  return x.ok;
}
function renderRoleAssignments(r) {
  const box = document.getElementById('roleAssignList');
  if (!box) return;
  const globalRole = r.current || null;
  const list = Array.isArray(r.assignments) ? r.assignments : [];
  box.replaceChildren();
  if (!list.length) box.textContent = '还没有会话。有群或私聊和 AI 聊过之后会出现在这里，也可以在下面直接填会话添加。';
  for (const a of list) {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.marginTop = '4px';
    row.dataset.roleAssignKey = a.key;
    const label = document.createElement('code');
    label.style.flex = '0 0 auto';
    label.style.minWidth = '170px';
    label.textContent = a.key;
    row.appendChild(label);
    const sel = document.createElement('select');
    sel.style.flex = '0 1 220px';
    const saved = a.source === 'off' ? 'off' : a.source === 'key' ? 'role:' + a.role : 'default';
    roleAssignOptions(sel, saved, globalRole);
    // 之前改了没保存：保留那个选择（选项还在的话）
    const pending = roleAssignDirty.get(a.key);
    if (pending !== undefined) {
      if (pending !== saved && [...sel.options].some((o) => o.value === pending)) sel.value = pending;
      else roleAssignDirty.delete(a.key);
    }
    row.appendChild(sel);
    if (a.source !== 'global') { const p = document.createElement('span'); p.className = 'pill b'; p.textContent = '单独设置'; row.appendChild(p); }
    if (a.missing) { const p = document.createElement('span'); p.className = 'pill r'; p.textContent = '人格文件不存在，现在不挂卡'; row.appendChild(p); }
    const dirtyPill = document.createElement('span');
    dirtyPill.className = 'pill r';
    dirtyPill.textContent = '未保存';
    dirtyPill.dataset.roleAssignDirty = '1';
    dirtyPill.hidden = !roleAssignDirty.has(a.key);
    row.appendChild(dirtyPill);
    sel.addEventListener('change', () => {
      if (sel.value === saved) roleAssignDirty.delete(a.key); else roleAssignDirty.set(a.key, sel.value);
      dirtyPill.hidden = !roleAssignDirty.has(a.key);
    });
    const btn = document.createElement('button');
    btn.className = 'small';
    btn.textContent = '保存';
    btn.addEventListener('click', () => saveRoleAssign(a.key, sel.value));
    row.appendChild(btn);
    box.appendChild(row);
  }
  const newSel = document.getElementById('roleAssignNewUse');
  if (newSel) {
    const keep = newSel.value;
    const valid = (v) => v === 'default' || v === 'off' || roleCache.some((role) => 'role:' + role.name === v);
    roleAssignOptions(newSel, valid(keep) ? keep : (roleCache[0] ? 'role:' + roleCache[0].name : 'off'), globalRole);
  }
}

/** 只刷新「按会话设置人格」列表（进入人格页、以及停在人格页时定时调用）；正在操作下拉框时不打断。 */
async function refreshRoleAssignments() {
  const box = document.getElementById('roleAssignList');
  if (!box || box.contains(document.activeElement)) return;
  const r = await api('/api/roles');
  if (!r || !Array.isArray(r.assignments)) return;
  if (Array.isArray(r.summaries) && r.summaries.length === (r.roles || []).length) roleCache = r.summaries;
  renderRoleAssignments(r);
}

const PERSONA_SOURCE_LABEL = { session: '会话', provider: '外部', global: '全局', off: '不挂卡', none: '无' };

// 只读：每个会话实际落在哪一层（会话覆盖 → provider → 全局）。不改任何状态。
async function refreshPersonaSources() {
  const box = document.getElementById('personaSourceList');
  if (!box) return;
  const r = await api('/api/persona/sources');
  if (!r || !r.ok) { box.textContent = '❌ ' + ((r && r.error) || '读取失败'); return; }
  const rows = Array.isArray(r.rows) ? r.rows : [];
  const meta = document.getElementById('personaSourceMeta');
  if (meta) meta.textContent = `${r.provider ? 'provider：' + r.provider : '当前没有启用 provider'} · ${rows.length} 个会话`;
  box.replaceChildren();
  if (!rows.length) { box.textContent = '还没有会话'; return; }
  let html = '<table><tr><th>会话</th><th>来源</th><th>人格</th><th>备注</th></tr>';
  for (const row of rows) {
    const label = PERSONA_SOURCE_LABEL[row.source] || row.source;
    html += `<tr><td><code>${esc(row.key)}</code></td><td>${esc(label)}</td><td>${row.name ? esc(row.name) : '—'}</td><td class="meta">${row.stale ? '缓存已过期，正在用旧卡' : ''}</td></tr>`;
  }
  box.innerHTML = html + '</table>';
}

async function refreshRoleDefaults() {
  const box = document.getElementById('roleDefaultsList');
  if (!box) return;
  const r = await api('/api/roles/defaults');
  if (!r.ok) { box.textContent = '❌ ' + (r.error || '读取失败'); return; }
  box.replaceChildren();
  if (!(r.defaults || []).length) { box.textContent = '发布包里没有找到默认人格（assets/default-roles/）'; return; }
  for (const d of r.defaults) {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.marginTop = '4px';
    const state = !d.exists ? '已被删除' : (d.modified ? '改过' : '和原版一样');
    row.innerHTML = `<span style="flex:0 0 auto"><b>${esc(d.name)}</b>${d.name === r.current ? '（当前启用）' : ''}</span><span class="pill ${!d.exists ? 'r' : (d.modified ? 'b' : 'g')}">${state}</span>`;
    const btn = document.createElement('button');
    btn.className = 'small';
    btn.textContent = d.exists ? '恢复成原版' : '重新放回';
    btn.dataset.roleRestore = d.name;
    btn.disabled = d.exists && !d.modified;
    btn.addEventListener('click', async () => {
      if (d.exists && !confirm(`把「${d.name}」恢复成原版？你改过的那份会先备份到 state/role-backups/。`)) return;
      const apply = (document.querySelector('input[name="roleSaveApply"]:checked') || {}).value || 'nextWake';
      const x = await api('/api/roles/restore-default', 'POST', { name: d.name, apply });
      const msg = document.getElementById('roleDefaultsMsg');
      msg.className = x.ok ? 'meta ok' : 'meta err';
      msg.textContent = !x.ok ? '❌ ' + (x.error || '恢复失败')
        : x.unchanged ? `「${d.name}」本来就是原版`
        : `✅ 已恢复「${d.name}」` + (x.backup ? `（改过的那份备份为 state/role-backups/${x.backup}）` : '（原来被删了，已重新放回）') + roleSaveRefreshText(x.refresh);
      if (x.ok && roleEditorState.mode === 'edit' && roleEditorState.name === d.name) {
        const c = await api('/api/roles/content?name=' + encodeURIComponent(d.name));
        if (c.ok) { document.getElementById('newRoleContent').value = c.content; updateRoleEditorWarnings(); }
      }
      refreshRoles();
    });
    row.appendChild(btn);
    box.appendChild(row);
  }
}

async function refreshRoles() {
  refreshRoleDefaults().catch(() => {});
  try {
    const r = await api('/api/roles');
    if (r.limits?.injectMaxChars) {
      roleInjectMax = Number(r.limits.injectMaxChars) || roleInjectMax;
      const input = document.getElementById('roleInjectMax');
      if (input && document.activeElement !== input) input.value = String(roleInjectMax);
    }
    const names = Array.isArray(r.roles) ? r.roles : [];
    roleCache = Array.isArray(r.summaries) && r.summaries.length === names.length
      ? r.summaries
      : names.map((name) => ({ name, chars: 0, bytes: 0, excerpt: '', truncated: false }));
    renderRoleAssignments(r);
    const box = document.getElementById('roleList');
    box.replaceChildren();
    if (!roleCache.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<strong>还没有人格</strong><p>在「编辑人格提示词」里填名称与内容，点「新建人格」创建第一个。</p>';
      box.appendChild(empty);
    }
    for (const role of roleCache) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'tile' + (role.name === r.current ? ' active' : '');
      item.setAttribute('aria-pressed', String(role.name === r.current));
      const head = document.createElement('span');
      head.className = 'tile-head';
      const title = document.createElement('strong');
      title.textContent = role.name;
      head.appendChild(title);
      if (role.name === r.current) {
        const badge = document.createElement('span');
        badge.className = 'persona-badge';
        badge.textContent = '启用中';
        head.appendChild(badge);
      }
      if (role.truncated) {
        const badge = document.createElement('span');
        badge.className = 'persona-badge warn';
        badge.textContent = `超出上限`;
        badge.title = `按模式筛选后仍有超出：二代 ${role.charsV2} 字符 / 一代 ${role.charsV1} 字符，上限 ${roleInjectMax}`;
        head.appendChild(badge);
      }
      if (role.hasModeTags) {
        const badge = document.createElement('span');
        badge.className = 'persona-badge';
        badge.textContent = '分代内容';
        badge.title = '该人格含 〔一代〕/〔二代〕 专属小节，只在对应仿真模式下注入';
        head.appendChild(badge);
      }
      const meta = document.createElement('small');
      const split = Number.isFinite(role.charsV1) && role.charsV1 !== role.charsV2;
      const injection = split
        ? `按模式注入：二代 ${role.injectedV2} / 一代 ${role.injectedV1} 字符`
        : `注入 ${role.injectedV2 ?? role.chars} 字符`;
      meta.textContent = `共 ${role.chars} 字符 · ${injection}${role.excerpt ? ' · ' + role.excerpt : ''}`;
      item.append(head, meta);
      item.addEventListener('click', () => openRoleForEdit(role.name));
      box.appendChild(item);
    }
    const hint = document.getElementById('roleListHint');
    if (hint) hint.textContent = roleCache.length ? `共 ${roleCache.length} 个 · 点任意一个载入编辑` : '';
    renderRoleEditor();
  } catch (error) {
    document.getElementById('roleList').textContent = '加载失败：' + (error?.message ?? error);
  }
}

// ── 仿真提示词（预设内置，需重启 DSH 生效）──────────────────────────────────
let simPromptOriginal = '';
let simPromptPreset = 'qq-chat-v2';

function setSimMsg(text, ok) {
  const el = document.getElementById('simPromptMsg');
  el.textContent = text;
  el.className = ok === undefined ? 'meta' : (ok ? 'meta ok' : 'meta err');
}

function setSimEditing(editing) {
  const area = document.getElementById('simPromptText');
  area.readOnly = !editing;
  area.classList.toggle('editing', editing);
  document.getElementById('simPromptEdit').disabled = editing;
  document.getElementById('simPromptSave').disabled = !editing;
  document.getElementById('simPromptCancel').disabled = !editing;
}

async function refreshSimPrompt() {
  simPromptPreset = document.getElementById('simPromptPreset').value || 'qq-chat-v2';
  setSimMsg('读取中…');
  try {
    const r = await api('/api/preset/sim-prompt?preset=' + encodeURIComponent(simPromptPreset));
    const area = document.getElementById('simPromptText');
    if (!r.ok) {
      area.value = '';
      setSimMsg(r.error || '读取失败', false);
      document.getElementById('simPromptStatus').textContent = '不可用';
      return;
    }
    simPromptOriginal = r.content;
    area.value = r.content;
    setSimEditing(false);
    setSimMsg('');
    const status = r.status || {};
    document.getElementById('simPromptStatus').textContent =
      `${status.label || simPromptPreset} · ${r.chars} 字符${status.installed ? ' · 已同步到 DSH' : ' · 尚未同步到 DSH'}`;
    document.getElementById('simPromptWarnings').textContent = (r.warnings || []).length
      ? '⚠️ ' + r.warnings.join('；') : '';
    document.getElementById('simPromptRestart').textContent =
      '改动写入该代预设的源文件并同步到 DSH 的 preset 目录；preset 由 DSH 在会话创建时装配，因此新会话会自动用新版，正在进行的 QQ 会话需重置该会话或重启 DSH。';
  } catch (error) {
    setSimMsg('读取失败：' + (error?.message ?? error), false);
  }
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
// 人格快捷选择：只按「开头」匹配、不区分大小写；空输入列出全部。手动输入新名字仍然可以。
function filterRoleSuggestions(names, query) {
  const q = String(query ?? '').trim().toLowerCase();
  return names.filter((name) => String(name).toLowerCase().startsWith(q));
}
(() => {
  const input = document.getElementById('roleInput');
  const list = document.getElementById('roleSuggest');
  let items = [];
  let active = -1;
  const close = () => { list.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const highlight = (i) => {
    active = i;
    [...list.children].forEach((li, idx) => li.setAttribute('aria-selected', String(idx === i)));
    const li = list.children[i];
    if (li && li.id) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
  };
  const pick = (name) => { input.value = name; close(); input.focus(); };
  const open = () => {
    items = filterRoleSuggestions(roleCache.map((role) => role.name), input.value);
    list.replaceChildren();
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'role-suggest-empty';
      li.textContent = roleCache.length ? '没有以此开头的人格（可直接输入新名字）' : '还没有人格';
      list.appendChild(li);
    }
    items.forEach((name, i) => {
      const li = document.createElement('li');
      li.id = 'roleSuggest-' + i;
      li.setAttribute('role', 'option');
      li.textContent = name;
      // mousedown 而不是 click：避免输入框先失焦把菜单关掉
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(name); });
      list.appendChild(li);
    });
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(-1);
  };
  input.addEventListener('focus', open);
  input.addEventListener('input', open);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (e) => {
    if (list.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { open(); e.preventDefault(); return; }
    if (list.hidden) return;
    if (e.key === 'ArrowDown' && items.length) { highlight((active + 1) % items.length); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && items.length) { highlight(active <= 0 ? items.length - 1 : active - 1); e.preventDefault(); }
    else if (e.key === 'Enter' && active >= 0) { pick(items[active]); e.preventDefault(); }
    else if (e.key === 'Escape') { close(); e.preventDefault(); }
  });
})();
function roleApplyMode() {
  const el = document.querySelector('input[name="roleApply"]:checked');
  return el ? el.value : 'nextWake';
}
function showRoleApplyResult(r) {
  const box = document.getElementById('roleApplyResult');
  const x = r && r.refresh;
  if (!x) { box.hidden = true; return; }
  let text;
  if (x.note) text = '✅ ' + x.note;
  else if (x.apply === 'immediate') text = '✅ 已唤醒 ' + x.woke + ' 个会话重新读卡' + (x.pending ? '；' + x.pending + ' 个在定时静默里，静默结束后的下一次唤醒再读' : '') + (x.woke || x.pending ? '' : '（所有会话都已是新卡）');
  else text = '✅ 已切换；' + (x.pending ? x.pending + ' 个会话会在下一次唤醒时读到新卡' : '所有会话都已是新卡');
  box.textContent = text;
  box.hidden = false;
}
document.getElementById('roleSet').addEventListener('click', async () => {
  const r = await api('/api/role', 'POST', { role: document.getElementById('roleInput').value.trim(), apply: roleApplyMode() });
  if (r.ok) { showRoleApplyResult(r); refreshRoles(); } else alert(r.error || '设置失败');
});
document.getElementById('roleAssignAdd').addEventListener('click', async () => {
  const input = document.getElementById('roleAssignKey');
  const key = input.value.trim();
  if (!key) { input.focus(); return; }
  if (await saveRoleAssign(key, document.getElementById('roleAssignNewUse').value)) input.value = '';
});
document.getElementById('roleClear').addEventListener('click', async () => { const r = await api('/api/role', 'POST', { role: null, apply: roleApplyMode() }); showRoleApplyResult(r); refreshRoles(); refresh(); });
document.getElementById('roleCreate').addEventListener('click', async () => {
  const name = document.getElementById('newRoleName').value.trim();
  const content = document.getElementById('newRoleContent').value.trim();
  if (!name) { setRoleMsg('请先填人格名', false); return; }
  const editing = roleEditorState.mode === 'edit';
  const exists = roleCache.some((role) => role.name === name);
  // 编辑模式下改了名字 → 先重命名文件，再保存内容
  if (editing && roleEditorState.name !== name) {
    const renamed = await api('/api/roles/rename', 'POST', { from: roleEditorState.name, to: name });
    if (!renamed.ok) { setRoleMsg('❌ ' + (renamed.error || '重命名失败'), false); return; }
  }
  const endpoint = editing || exists ? '/api/roles/update' : '/api/roles/create';
  const saveApply = (document.querySelector('input[name="roleSaveApply"]:checked') || {}).value || 'nextWake';
  const r = await api(endpoint, 'POST', { name, content, apply: saveApply });
  setRoleMsg(r.ok ? `✅ 已保存「${name}」` + roleSaveRefreshText(r.refresh) : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) {
    roleEditorState = { mode: 'edit', name };
    document.getElementById('roleEditorWarnings').textContent = (r.warnings || []).length ? '⚠️ ' + r.warnings.join('；') : '';
    await refreshRoles();
  }
});
document.getElementById('roleDuplicate').addEventListener('click', async () => {
  const source = document.getElementById('newRoleName').value.trim();
  const content = document.getElementById('newRoleContent').value.trim();
  const target = (prompt('把当前内容另存为新的人格，名称：', source ? source + '-副本' : '') || '').trim();
  if (!target) return;
  const r = await api('/api/roles/create', 'POST', { name: target, content });
  if (!r.ok) { setRoleMsg('❌ ' + (r.error || '另存失败'), false); return; }
  document.getElementById('newRoleName').value = target;
  roleEditorState = { mode: 'edit', name: target };
  renderRoleEditor();
  setRoleMsg(`✅ 已另存为「${target}」`, true);
  refreshRoles();
});
document.getElementById('roleDelete').addEventListener('click', async () => {
  const name = document.getElementById('newRoleName').value.trim();
  if (!name) { setRoleMsg('请先选择或填写要删除的人格名', false); return; }
  if (!confirm(`确定删除人格「${name}」？该操作不可撤销（roles/${name}.md）。`)) return;
  const r = await api('/api/roles/delete', 'POST', { name });
  if (!r.ok) { setRoleMsg('❌ ' + (r.error || '删除失败'), false); return; }
  resetRoleForm();
  setRoleMsg(r.clearedCurrent ? `已删除「${name}」，并清除了当前启用的人格` : `已删除「${name}」`, true);
  refreshRoles();
  refresh();
});
document.getElementById('roleFormReset').addEventListener('click', () => resetRoleForm());
document.getElementById('newRoleContent').addEventListener('input', updateRoleEditorWarnings);

// ── 仿真提示词 ──────────────────────────────────────────────────────────────
document.getElementById('simPromptEdit').addEventListener('click', () => {
  setSimEditing(true);
  setSimMsg('编辑中：改完点「保存并同步到 DSH」。保存会先备份，并做 YAML 与安全不变量校验。');
});
document.getElementById('simPromptCancel').addEventListener('click', () => {
  document.getElementById('simPromptText').value = simPromptOriginal;
  setSimEditing(false);
  setSimMsg('已放弃修改');
});
document.getElementById('simPromptPreset').addEventListener('change', () => { refreshSimPrompt(); });
document.getElementById('simPromptSave').addEventListener('click', async () => {
  const content = document.getElementById('simPromptText').value;
  if (!confirm('保存会改写该代预设的源文件并同步到 DSH 的 preset 目录（新会话生效，进行中的会话需重置或重启 DSH）。确定继续？')) return;
  setSimMsg('保存中…');
  const r = await api('/api/preset/sim-prompt', 'POST', { preset: simPromptPreset, content });
  if (!r.ok) { setSimMsg('❌ ' + (r.error || '保存失败'), false); return; }
  if (r.unchanged) {
    simPromptOriginal = content;
    setSimEditing(false);
    setSimMsg('内容没有变化，未写入文件（避免无谓地重排预设格式）', true);
    return;
  }
  simPromptOriginal = content;
  setSimEditing(false);
  setSimMsg(`✅ 已保存${r.synced ? '并同步到 DSH' : ''}；重启 DSH 后生效`, true);
  document.getElementById('simPromptWarnings').textContent = (r.warnings || []).length ? '⚠️ ' + r.warnings.join('；') : '';
  document.getElementById('simPromptStatus').textContent = `${r.status?.label || simPromptPreset} · ${content.length} 字符 · 已保存，待重启 DSH`;
});
document.getElementById('simPromptRestore').addEventListener('click', async () => {
  if (!confirm('还原到该代预设上一次保存前的备份？当前改动会丢失（原文件会先自动备份）。')) return;
  const r = await api('/api/preset/sim-prompt/restore', 'POST', { preset: simPromptPreset });
  if (!r.ok) { setSimMsg('❌ ' + (r.error || '还原失败'), false); return; }
  setSimMsg(`✅ 已还原（${r.restoredFrom}）；重启 DSH 后生效`, true);
  refreshSimPrompt();
});

// ── 人格注入上限 ────────────────────────────────────────────────────────────
document.getElementById('roleInjectMaxSave').addEventListener('click', async () => {
  const msg = document.getElementById('roleInjectMaxMsg');
  const value = Number(document.getElementById('roleInjectMax').value);
  if (!Number.isFinite(value) || value < 1000 || value > 20000) { msg.textContent = '请输入 1000~20000 之间的整数'; msg.className = 'meta err'; return; }
  const r = await api('/api/roles/limit', 'POST', { maxInjectChars: value });
  msg.textContent = r.ok ? `✅ 已设为 ${r.maxInjectChars} 字符，下一条消息生效` : ('❌ ' + (r.error || '保存失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) refreshRoles();
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
document.getElementById('tsSend').addEventListener('click', async () => {
  const r = await api('/api/test-send', 'POST', {
    kind: document.getElementById('tsKind').value,
    id: document.getElementById('tsId').value.trim(),
    message: document.getElementById('tsMsg').value
  });
  document.getElementById('tsMsg2').textContent = r.ok ? ('✅ 已发送 message_id=' + r.message_id) : ('❌ ' + (r.error || '失败'));
  document.getElementById('tsMsg2').className = r.ok ? 'meta ok' : 'meta err';
});
document.getElementById('restartBtn').addEventListener('click', async () => {
  if (!confirm('确定重启桥接？')) return;
  const r = await api('/api/restart', 'POST', {});
  document.getElementById('restartMsg').textContent = r.message || '正在重启…';
});
document.getElementById('clearWsBtn').addEventListener('click', async () => {
  if (!confirm('确定清空整个「QQ 聊天」工作区？\n将归档全部 QQ 会话、清除所有上下文映射、清空活动日志。\n此操作不可撤销。')) return;
  const r = await api('/api/workspace/reset', 'POST', {});
  document.getElementById('clearWsMsg').textContent = r.ok ? (`✅ 已归档 ${r.archivedCount} 个会话，工作区已清空`) : ('❌ ' + (r.error || '失败'));
  document.getElementById('clearWsMsg').className = r.ok ? 'meta ok' : 'meta err';
  refreshSessions(); refresh();
});
document.getElementById('aiNotifySend').addEventListener('click', async () => {
  const kind = document.getElementById('aiNotifyKind').value;
  const id = document.getElementById('aiNotifyId').value.trim();
  const message = document.getElementById('aiNotifyMessage').value.trim();
  if (!id || !message) { alert('请填写群号/QQ 号和提醒内容'); return; }
  const r = await api('/api/console/notify-ai', 'POST', { key: kind + ':' + id, message });
  const msg = document.getElementById('aiNotifyMsg');
  msg.textContent = r.ok ? ('✅ 已投递到 DSH：' + r.sessionId) : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
});

// 页面被切进来时要做什么：路由器只负责切页，具体刷新由各页面在这里注册。
onPageRefresh('persona', () => {
  // 每次进入都重读一次：全局人格可能在别处改过、新会话可能刚建好。
  refreshRoleAssignments().catch(() => {});
  refreshPersonaSources().catch(() => {});
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
// ── 消耗走势图（手写 SVG） ───────────────────────────────────────────────
// 为什么不用图表库：控制台 CSP 是 default-src 'self'，不能引外部脚本；
// 而 SVG 用 document.createElementNS 生成既没有 innerHTML 转义风险，
// 也能直接用 CSS 变量跟随深浅主题。
let usageChartHours = 24;
let usageChartMetric = 'cost';
let usageChartData = null;

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}
function usageBucketValue(b, metric) {
  return metric === 'tokens' ? (Number(b.tokens) || 0) : (Number(b.cost) || 0);
}
function usageMetricLabel(metric) {
  return metric === 'tokens' ? 'token' : '花费';
}
function usageAxisValue(v, metric, sym) {
  if (metric === 'tokens') return usageNum(v);
  if (v === 0) return sym + '0';
  return v < 0.01 ? sym + v.toFixed(4) : sym + v.toFixed(2);
}
function usageBucketClock(ms, bucketMs) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  // 桶宽 ≥ 1 天时只显示日期，否则显示「日 时:分」，跨天也能分辨。
  if (bucketMs >= 24 * 3600 * 1000) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderUsageChart(series) {
  const box = document.getElementById('usageChart');
  const totalEl = document.getElementById('usageChartTotal');
  const hintEl = document.getElementById('usageChartHint');
  const noteEl = document.getElementById('usageChartNote');
  usageChartData = series;
  const sym = series?.symbol || '¥';
  const buckets = Array.isArray(series?.buckets) ? series.buckets : [];
  if (!buckets.length) {
    box.innerHTML = '';
    box.textContent = '暂无数据';
    totalEl.textContent = '—';
    hintEl.textContent = '还没有用量记录';
    noteEl.textContent = '';
    return;
  }
  const metric = usageChartMetric;
  const values = buckets.map((b) => usageBucketValue(b, metric));
  const max = Math.max(...values, 0);
  // 全零时给一个假上限，避免除零；同时让空图看起来是"平"的而不是报错。
  const scaleMax = max > 0 ? max : 1;

  const W = 960;
  const H = 240;
  const padL = 62;
  const padR = 12;
  const padT = 12;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const step = plotW / buckets.length;
  const barW = Math.max(2, step * 0.72);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${usageMetricLabel(metric)}随时间的走势图` });

  // 横向网格 + 纵轴刻度（3 条线即可：0 / 一半 / 最大）
  // 窗口内完全没有用量时（max === 0）三条刻度都写 0：不能编出一个 ¥1 的假量程，
  // 那会让人以为"有量但很小"。
  for (let i = 0; i <= 2; i += 1) {
    const y = padT + plotH - (plotH * i) / 2;
    svg.appendChild(svgEl('line', { class: 'usage-grid', x1: padL, y1: y, x2: W - padR, y2: y }));
    const label = svgEl('text', { class: 'usage-axis', x: padL - 8, y: y + 3, 'text-anchor': 'end' });
    label.textContent = usageAxisValue(max > 0 ? (scaleMax * i) / 2 : 0, metric, sym);
    svg.appendChild(label);
  }

  // 柱：颜色 = 该桶的峰谷档位，所以"什么时候贵"是一眼可见的
  for (let i = 0; i < buckets.length; i += 1) {
    const b = buckets[i];
    const v = values[i];
    const x = padL + i * step + (step - barW) / 2;
    const h = v > 0 ? Math.max(1.5, (v / scaleMax) * plotH) : 0;
    const tooltip = svgEl('title');
    tooltip.textContent = `${usageBucketClock(b.t, series.bucketMs)}\n${usageMetricLabel(metric)}：${usageAxisValue(v, metric, sym)}`
      + `\n未命中输入：${usageNum(b.cacheMiss)} ｜ 命中输入：${usageNum(b.cacheHit)} ｜ 输出：${usageNum(b.output)}`
      + `\n步数：${usageNum(b.steps)} ｜ 轮次：${usageNum(b.turns)}`
      + `\n时段：${b.tier === 'peak' ? '高峰（单价 ×2）' : (b.tier === 'mixed' ? '跨时段' : '空闲')}`
      + (b.keys?.length ? `\n会话：${b.keys.join('、')}` : '');
    if (h > 0) {
      const rect = svgEl('rect', { x, y: padT + plotH - h, width: barW, height: h, rx: 2, class: `usage-bar-${b.tier === 'peak' ? 'peak' : (b.tier === 'mixed' ? 'mixed' : 'off')}` });
      rect.appendChild(tooltip);
      svg.appendChild(rect);
    }
    // 透明命中区：0 值的桶也能 hover（鼠标移到空白处也要能看出那一刻是空闲还是高峰）
    const hit = svgEl('rect', { x: padL + i * step, y: padT, width: step, height: plotH, class: 'usage-hit' });
    hit.appendChild(tooltip.cloneNode(true));
    svg.appendChild(hit);
  }

  // 横轴：最多 6 个刻度，避免挤在一起
  const tickEvery = Math.max(1, Math.ceil(buckets.length / 6));
  for (let i = 0; i < buckets.length; i += tickEvery) {
    const label = svgEl('text', { class: 'usage-axis', x: padL + i * step + step / 2, y: H - padB + 16, 'text-anchor': 'middle' });
    label.textContent = usageBucketClock(buckets[i].t, series.bucketMs);
    svg.appendChild(label);
  }

  box.innerHTML = '';
  box.appendChild(svg);

  const windowTotal = buckets.reduce((sum, b) => sum + usageBucketValue(b, metric), 0);
  totalEl.textContent = metric === 'tokens' ? `${usageNum(windowTotal)} token` : usageMoney(windowTotal, sym);
  const busiest = series.busiest;
  hintEl.textContent = `窗口内合计 ｜ 每格 ${Math.round(series.bucketMs / 60000)} 分钟`
    + (busiest && metric === 'cost' ? ` ｜ 最贵一格：${usageBucketClock(busiest.t, series.bucketMs)} ${usageMoney(busiest.cost, sym)}` : '')
    + (series.estimated ? ' ｜ ⚠️ 含按兜底价估算的模型' : '');

  // 图上一定要能看出"还有多少没画进来"：投影基线覆盖的更早历史没有逐时明细。
  const notes = [];
  if (Number(series.offChartCost) > 0.0001) {
    notes.push(`另有 ${usageMoney(series.offChartCost, sym)}（约 ${usageNum(series.offChartTokens)} token）属于更早的历史，只有累计值、没有逐时明细，因此不在上图里；所以本图合计会小于「总花费」。`);
  }
  if (series.countedSamples === 0) {
    notes.push('所选时间窗内没有采样：要么这段时间真的没调用，要么逐轮明细已被容量上限淘汰（累计总量仍然准确）。');
  }
  noteEl.textContent = notes.join(' ');
}

async function refreshUsageChart() {
  try {
    const r = await api(`/api/tokens/series?hours=${usageChartHours}`);
    renderUsageChart(r);
  } catch (error) {
    document.getElementById('usageChart').textContent = `走势读取失败：${error?.message || '未知错误'}`;
  }
}

document.getElementById('usageChartControls').addEventListener('click', (ev) => {
  const hoursBtn = ev.target.closest('[data-usage-hours]');
  const metricBtn = ev.target.closest('[data-usage-metric]');
  if (hoursBtn) {
    usageChartHours = Number(hoursBtn.dataset.usageHours) || 24;
    document.querySelectorAll('#usageChartControls [data-usage-hours]').forEach((b) => b.classList.toggle('active', b === hoursBtn));
    refreshUsageChart();
  } else if (metricBtn) {
    usageChartMetric = metricBtn.dataset.usageMetric === 'tokens' ? 'tokens' : 'cost';
    document.querySelectorAll('#usageChartControls [data-usage-metric]').forEach((b) => b.classList.toggle('active', b === metricBtn));
    // 只换纵轴：不重新请求，直接重画现有数据。
    if (usageChartData) renderUsageChart(usageChartData);
  }
});

// ── 令牌与花费 ───────────────────────────────────────────────────────────
// 数据分三层：累计总量（DSH tokenUsage 投影，权威）→ 按会话归并 → 逐轮明细。
// 金额一律在渲染时算，价目表改了不需要重算历史。
let usageSelectedKey = '';
let usageConversationsCache = [];

function usageNum(n) {
  const v = Number(n) || 0;
  if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 亿';
  if (v >= 1e5) return (v / 1e4).toFixed(0) + ' 万';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + ' 万';
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function usageMoney(n, sym) {
  const s = sym || '¥';
  const v = Number(n) || 0;
  if (v === 0) return s + '0';
  if (v < 0.01) return s + v.toFixed(4);
  return s + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function usagePct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return (v * 100).toFixed(1) + '%';
}
function usageRate(buckets) {
  const b = buckets || {};
  const input = (b.cacheMiss || 0) + (b.cacheHit || 0) + (b.cacheWrite || 0);
  return input > 0 ? (b.cacheHit || 0) / input : 0;
}
function usageTime(ms) {
  if (!ms) return '—';
  try { return new Date(ms).toLocaleString('zh-CN', { hour12: false }); } catch (error) { return '—'; }
}
function usageBar(share) {
  const ratio = Math.max(0, Math.min(1, Number(share) || 0));
  const width = Math.max(2, Math.round(ratio * 100));
  return `<span class="usage-bar-wrap"><span class="usage-bar-track"><span class="usage-bar-fill" style="width:${width}%"></span></span><span class="meta">${(ratio * 100).toFixed(1)}%</span></span>`;
}
function usageTierTag(tier) {
  if (tier === 'peak') return '<span class="pill r usage-tier">高峰</span>';
  if (tier === 'off') return '<span class="pill g usage-tier">空闲</span>';
  if (tier === 'mixed') return '<span class="pill b usage-tier">跨时段</span>';
  return '<span class="meta">—</span>';
}

function syncUsageKeySelect(keys) {
  const sel = document.getElementById('usageKeySelect');
  if (!sel) return;
  if (!keys.includes(usageSelectedKey)) usageSelectedKey = keys[0] || '';
  const signature = keys.join('\u0000');
  if (sel.dataset.signature !== signature) {
    sel.dataset.signature = signature;
    sel.innerHTML = keys.length
      ? keys.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('')
      : '<option value="">（暂无会话）</option>';
  }
  // 每 3 秒的轮询不得覆盖用户正在操作的控件。
  if (document.activeElement !== sel) sel.value = usageSelectedKey;
}

function renderUsageConversations(r) {
  const box = document.getElementById('usageConversations');
  const list = r.conversations || [];
  const sym = r.symbol || '¥';
  usageConversationsCache = list;
  if (!list.length) {
    box.innerHTML = '<div class="empty-state"><strong>还没有用量记录</strong><p>QQ 会话产生一次 LLM 调用后，这里会按群 / 好友列出 token 与花费。新账本从桥接重启后开始记账。</p></div>';
    return;
  }
  const maxCost = Math.max(...list.map(x => Number(x.cost) || 0), 0);
  let html = '<table><tr><th>会话</th><th>类型</th><th class="num">轮数</th><th class="num">步数</th><th class="num">未命中输入</th><th class="num">命中输入</th><th class="num">命中率</th><th class="num">输出</th><th class="num">花费</th><th>占比</th></tr>';
  for (const c of list) {
    const key = String(c.key ?? '');
    const isInternal = key.startsWith('internal:');
    const type = isInternal ? '<span class="pill b">内部</span>'
      : (key.startsWith('private:') ? '<span class="pill b">私聊</span>' : '<span class="pill g">群</span>');
    const b = c.buckets || {};
    html += '<tr>'
      + `<td class="usage-key"><button class="usage-key-button" data-usage-key="${esc(key)}" aria-pressed="${key === usageSelectedKey}">${esc(key)}</button></td>`
      + `<td>${type}</td>`
      + `<td class="num">${usageNum(c.turns)}</td>`
      + `<td class="num">${usageNum(c.steps)}</td>`
      + `<td class="num">${usageNum(b.cacheMiss)}</td>`
      + `<td class="num">${usageNum(b.cacheHit)}</td>`
      + `<td class="num">${usagePct(usageRate(b))}</td>`
      + `<td class="num">${usageNum(b.output)}</td>`
      + `<td class="num">${usageMoney(c.cost, sym)}</td>`
      + `<td>${usageBar(maxCost > 0 ? (Number(c.cost) || 0) / maxCost : 0)}</td>`
      + '</tr>';
  }
  html += '</table>';
  const totals = r.totals || {};
  if (Number(totals.unattributedCost) > 0) {
    html += `<div class="meta" style="padding:8px 10px">其中 ${usageMoney(totals.unattributedCost, sym)} 来自更早的回合：它们只剩累计值（在逐轮快照窗口之外），无法再拆到具体某一轮。</div>`;
  }
  if (totals.estimated) {
    html += '<div class="meta" style="padding:8px 10px">⚠️ 有模型未登记在价目表里，这部分按 <code>deepseek-flash</code> 兜底价估算，可在 <code>config.json</code> 的 <code>pricing.models</code> 补充。</div>';
  }
  box.innerHTML = html;
  box.querySelectorAll('[data-usage-key]').forEach(btn => btn.addEventListener('click', () => {
    usageSelectedKey = btn.dataset.usageKey;
    box.querySelectorAll('[data-usage-key]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.usageKey === usageSelectedKey)));
    const sel = document.getElementById('usageKeySelect');
    if (sel) sel.value = usageSelectedKey;
    refreshUsageTurns();
  }));
}

function renderUsageTurns(r) {
  const box = document.getElementById('usageTurns');
  const scope = document.getElementById('usageTurnScope');
  const rows = r.turns || [];
  const sym = r.symbol || '¥';
  if (scope) {
    scope.textContent = `${esc(r.key || '')} ｜ 共 ${rows.length} 轮可追溯 ｜ 已归属 ${usageMoney(r.attributedCost, sym)}`
      + (Number(r.unattributedCost) > 0 ? ` ｜ 未逐轮归属 ${usageMoney(r.unattributedCost, sym)}` : '');
  }
  if (!rows.length) {
    box.innerHTML = '<span class="meta">该会话还没有可追溯的逐轮记录（只有累计值）。</span>';
    return;
  }
  let html = '<table><tr><th class="num">轮次</th><th>结束时间</th><th class="num">步数</th><th class="num">未命中输入</th><th class="num">命中输入</th><th class="num">命中率</th><th class="num">输出</th><th class="num">花费</th><th>时段</th></tr>';
  for (const t of rows) {
    const b = t.buckets || {};
    html += '<tr>'
      + `<td class="num">#${esc(t.turn)}</td>`
      + `<td>${esc(usageTime(t.endedAt))}</td>`
      + `<td class="num">${usageNum(t.steps)}</td>`
      + `<td class="num">${usageNum(b.cacheMiss)}</td>`
      + `<td class="num">${usageNum(b.cacheHit)}</td>`
      + `<td class="num">${usagePct(usageRate(b))}</td>`
      + `<td class="num">${usageNum(b.output)}</td>`
      + `<td class="num">${usageMoney(t.cost, sym)}</td>`
      + `<td>${usageTierTag(t.tier)}</td>`
      + '</tr>';
  }
  box.innerHTML = html + '</table>';
}

function renderUsageRecent(r) {
  const box = document.getElementById('usageRecent');
  const list = r.entries || [];
  const sym = r.symbol || '¥';
  if (!list.length) { box.innerHTML = '<span class="meta">（空）</span>'; return; }
  let html = '<table><tr><th>时间</th><th>会话</th><th class="num">轮</th><th class="num">步</th><th class="num">未命中</th><th class="num">命中</th><th class="num">输出</th><th class="num">花费</th><th>时段</th></tr>';
  for (const e of list) {
    html += '<tr>'
      + `<td>${esc(usageTime(e.time))}</td>`
      + `<td>${esc(e.key || '未归属')}</td>`
      + `<td class="num">#${esc(e.turn)}</td>`
      + `<td class="num">${esc(e.step)}</td>`
      + `<td class="num">${usageNum(e.cacheMiss)}</td>`
      + `<td class="num">${usageNum(e.cacheHit)}</td>`
      + `<td class="num">${usageNum(e.output)}</td>`
      + `<td class="num">${usageMoney(e.cost, sym)}</td>`
      + `<td>${usageTierTag(e.tier)}</td>`
      + '</tr>';
  }
  box.innerHTML = html + '</table>';
}

function renderUsagePrices(pt) {
  const box = document.getElementById('usagePrices');
  if (!pt || !pt.models) { box.textContent = '（价目表不可用）'; return; }
  const sym = pt.symbol || '¥';
  const tier = pt.nowTier;
  let html = `<div style="margin-bottom:6px">价目表版本 <code>${esc(pt.version)}</code> ｜ 高峰时段为北京时间的 2 倍价（周一至周五 9:00-12:00、14:00-18:00，法定节假日除外，已内置 ${esc(pt.holidayCount)} 天假期）</div>`;
  html += '<table><tr><th>模型</th><th class="num">缓存命中</th><th class="num">缓存未命中</th><th class="num">输出</th></tr>';
  for (const [name, m] of Object.entries(pt.models)) {
    // 单价与货币符号都可能来自 config.json 的 pricing 覆盖项（运维可写），
    // 不能直接拼进 innerHTML：这里统一走 esc() （数字原样显示仍然是数字）。
    const price = (v) => esc(sym + (Number.isFinite(Number(v)) ? Number(v) : (v ?? '')));
    html += `<tr><td><code>${esc(name)}</code><div class="meta">${esc(m.label)}</div></td>`
      + `<td class="num">${price(m.off?.cacheHit)}</td>`
      + `<td class="num">${price(m.off?.cacheMiss)}</td>`
      + `<td class="num">${price(m.off?.output)}</td></tr>`;
  }
  html += '</table>';
  html += `<div class="meta" style="padding:8px 10px">上表为<b>空闲时段</b>单价（元 / 百万 token）。当前时刻属于 <b>${tier ? esc(tier.tierLabel) : '—'}</b>${tier?.estimated ? '，且价目表里没有 <code>' + esc(tier.model) + '</code>，按兜底价估算' : ''}。</div>`;
  box.innerHTML = html;
}

async function refreshUsage() {
  const msg = document.getElementById('usageMsg');
  try {
    const r = await api('/api/tokens/summary?limit=200');
    const t = r.totals || {};
    const b = t.buckets || {};
    const sym = r.symbol || '¥';
    document.getElementById('metricUsageCost').textContent = usageMoney(t.cost, sym);
    document.getElementById('metricUsageCostHint').textContent =
      `高峰 ${usageMoney(t.byTier?.peak, sym)} ｜ 空闲 ${usageMoney(t.byTier?.off, sym)}`;
    document.getElementById('metricUsageTokens').textContent = usageNum(t.totalTokens);
    document.getElementById('metricUsageTokensHint').textContent =
      `输入 ${usageNum(t.inputTokens)} ｜ 输出 ${usageNum(b.output)}`;
    document.getElementById('metricUsageHitRate').textContent = usagePct(t.cacheHitRate);
    document.getElementById('metricUsageHitHint').textContent =
      `命中 ${usageNum(b.cacheHit)} ｜ 未命中 ${usageNum(b.cacheMiss)}`;
    document.getElementById('metricUsagePerTurn').textContent = usageMoney(t.avgCostPerTurn, sym);
    document.getElementById('metricUsagePerTurnHint').textContent =
      `${usageNum(t.turns)} 轮 ｜ ${usageNum(t.steps)} 步 ｜ 当前${r.nowTier?.tier === 'peak' ? '高峰' : '空闲'}时段`;
    renderUsageConversations(r);
    renderUsagePrices(r.priceTable ? { ...r.priceTable, nowTier: r.nowTier } : null);
    syncUsageKeySelect((r.conversations || []).map(c => String(c.key ?? '')));
    if (!document.getElementById('usageTurns').dataset.loaded && usageSelectedKey) refreshUsageTurns();
    msg.textContent = `✅ 已同步于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
    msg.className = 'meta ok';
  } catch (error) {
    msg.textContent = `❌ 读取失败：${error?.message || '未知错误'}`;
    msg.className = 'meta err';
  }
}

async function refreshUsageTurns() {
  const box = document.getElementById('usageTurns');
  if (!usageSelectedKey) {
    box.innerHTML = '<span class="meta">选择一个会话后加载逐轮明细…</span>';
    box.dataset.loaded = '';
    return;
  }
  try {
    const r = await api('/api/tokens/turns?key=' + encodeURIComponent(usageSelectedKey) + '&limit=200');
    renderUsageTurns(r);
    box.dataset.loaded = '1';
  } catch (error) {
    box.innerHTML = `<span class="meta err">读取失败：${esc(error?.message || '未知错误')}</span>`;
    box.dataset.loaded = '';
  }
}

async function refreshUsageRecent() {
  try {
    renderUsageRecent(await api('/api/tokens/recent?limit=40'));
  } catch (error) {
    document.getElementById('usageRecent').innerHTML = '<span class="meta">（读取失败）</span>';
  }
}

// 插件页见 ./pages/plugins.js（initPluginsPage）。

document.getElementById('usageRefresh').addEventListener('click', () => {
  refreshUsage();
  refreshUsageChart();
  refreshUsageTurns();
  refreshUsageRecent();
  showConsoleToast('用量已刷新');
});
document.getElementById('usageTurnsLoad').addEventListener('click', () => refreshUsageTurns());
document.getElementById('usageKeySelect').addEventListener('change', (ev) => {
  usageSelectedKey = ev.target.value;
  refreshUsageTurns();
});
document.getElementById('usageClear').addEventListener('click', async () => {
  if (!confirm('确定清空 token 用量账本？累计花费与逐轮明细都会被删除，且不可恢复（下一次同步会从 DSH 重新拉取会话累计值）。')) return;
  const msg = document.getElementById('usageMsg');
  try {
    const r = await api('/api/tokens/reset', 'POST', {});
    msg.textContent = r.ok ? '✅ 账本已清空' : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'meta ok' : 'meta err';
  } catch (error) {
    msg.textContent = '❌ ' + (error?.message || '失败');
    msg.className = 'meta err';
  }
  usageSelectedKey = '';
  document.getElementById('usageTurnScope').textContent = '—';
  document.getElementById('usageTurns').dataset.loaded = '';
  refreshUsage();
  refreshUsageRecent();
});

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

// ── 上下文压缩（socialV2.compact）───────────────────────────────────────────
async function loadCompactConfig() {
  const r = await api('/api/compact/config');
  if (!r.ok) return;
  document.querySelectorAll('input[name="compactMode"]').forEach((c) => { c.checked = c.value === r.mode; });
  const wan = document.getElementById('compactWan');
  if (document.activeElement !== wan) wan.value = Math.round(r.thresholdTokens / 10_000);
  const list = (r.sessions || []).sort((a, b) => b.inputTokens - a.inputTokens).slice(0, 6);
  document.getElementById('compactSessions').textContent = list.length
    ? '上一步读了多少：' + list.map((x) => `${x.key} ${Math.round(x.inputTokens / 10_000)} 万`).join('，')
    : '桥接这次启动后还没有会话跑过，暂时看不到每个会话读了多少';
}
document.getElementById('compactSave').addEventListener('click', async () => {
  const mode = (document.querySelector('input[name="compactMode"]:checked') || {}).value;
  const msg = document.getElementById('compactMsg');
  if (!mode) { msg.textContent = '请先选一种压缩方式'; msg.className = 'meta err'; return; }
  const r = await api('/api/compact/config', 'POST', { mode, thresholdWan: Number(document.getElementById('compactWan').value) });
  msg.textContent = r.ok ? '✅ 已保存' : '❌ ' + (r.error || '保存失败');
  msg.className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) loadCompactConfig();
});
document.getElementById('compactWan').addEventListener('focus', () => { const e = document.querySelector('input[name="compactMode"][value="early"]'); if (e) e.checked = true; });
loadCompactConfig();
setInterval(() => { if (getCurrentPage() === 'usage') loadCompactConfig(); }, 60_000);
// 停在人格页时，每 15 秒同步一次「按会话设置人格」（QQ 里发了 /role、新群建了会话都能看到；没保存的选择会保留）
setInterval(() => { if (getCurrentPage() === 'persona' && !document.hidden) refreshRoleAssignments().catch(() => {}); }, 15_000);
setInterval(() => { if (getCurrentPage() === 'persona' && !document.hidden) refreshPersonaSources().catch(() => {}); }, 15_000);
document.getElementById('personaSourceRefresh')?.addEventListener('click', () => refreshPersonaSources().catch(() => {}));

// 「扩展」下的三个只读页：技能 / MCP / 管理行为。数据都来自只读接口，页面不做任何写操作。
refresh(); refreshRoles(); refreshSessions(); refreshPending(); refreshPresets(); refreshSimPrompt(); refreshDshModel(); refreshSilence(); refreshUsage(); refreshUsageChart(); refreshUsageRecent();
setInterval(() => { refresh(); refreshSessions(); refreshPending(); }, 3000);
// 用量看板只在本页可见时轮询：既保证「实时」，又不让其它页白白多打两份接口。
setInterval(() => { if (getCurrentPage() !== 'usage') return; refreshUsage(); refreshUsageChart(); refreshUsageRecent(); }, 3000);
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
