// 页面入口：装配各个模块，再启动首屏。所有「能力」都在 ./api.js、./ui.js、./router.js 里，
// 这个文件只负责把数据、页面、事件接起来。
import { api, bootstrapConsoleToken } from './api.js';
import { esc, showConsoleToast, simpleTable } from './ui.js';
import { consolePages, getCurrentPage, initRouter, onPageRefresh, setConsolePage, setSearchCloser } from './router.js';
import { initPluginsPage } from './pages/plugins.js';
import { initSkillsPage } from './pages/skills.js';
import { initMcpPage } from './pages/mcp.js';

bootstrapConsoleToken();

// ── 一键补表情说明 ─────────────────────────────────────────────
let stickerDescribeTimer = null;
function renderStickerDescribe(r) {
  const el = document.getElementById('stickerDescribeStatus');
  const btn = document.getElementById('stickerDescribeBtn');
  if (!el || !r || !r.ok) { if (el) el.textContent = (r && r.error) || '读取失败'; return; }
  let text = `共 ${r.total} 张收藏表情，其中 ${r.undescribed} 张没有说明`;
  if (r.running) text = `⏳ 正在看图补说明：${r.progress.done}/${r.progress.total}…`;
  else if (r.last) text = (r.last.ok ? '✅ ' : '⚠️ ') + r.last.text;
  if (!r.running && r.blocker && r.undescribed) text += `（现在不能运行：${r.blocker}）`;
  el.textContent = text;
  btn.disabled = !!r.running || !r.undescribed || !!r.blocker;
  btn.textContent = r.undescribed ? `让 AI 看图补表情说明（${Math.min(r.undescribed, r.max)} 张）` : '所有表情都有说明了';
  clearTimeout(stickerDescribeTimer);
  if (r.running) stickerDescribeTimer = setTimeout(refreshStickerDescribe, 2500);
}
async function refreshStickerDescribe() {
  try { renderStickerDescribe(await api('/api/stickers/describe')); } catch {}
}
document.addEventListener('click', async (e) => {
  if (!e.target || e.target.id !== 'stickerDescribeBtn') return;
  const r = await api('/api/stickers/describe', 'POST', {});
  if (!r.ok) { alert(r.error || '启动失败'); refreshStickerDescribe(); return; }
  renderStickerDescribe(r);
});
setTimeout(refreshStickerDescribe, 800);

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

async function refreshWhitelist() {
  try {
    const w = await api('/api/whitelist');
    document.getElementById('wlGroups').value = (w.allow.groups || []).join(', ');
    document.getElementById('wlPrivate').value = (w.allow.private || []).join(', ');
    document.getElementById('ownerQQ').value = w.ownerQQ != null ? String(w.ownerQQ) : '';
    document.getElementById('dnGroups').value = (w.deny.groups || []).join(', ');
    document.getElementById('dnPrivate').value = (w.deny.private || []).join(', ');
  } catch {}
}

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
document.getElementById('wlSave').addEventListener('click', async () => {
  const parse = (s) => s.split(/[,，\s]+/).map(x => x.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
  const r = await api('/api/whitelist', 'POST', {
    allow: { private: parse(document.getElementById('wlPrivate').value), groups: parse(document.getElementById('wlGroups').value) },
    deny: { private: parse(document.getElementById('dnPrivate').value), groups: parse(document.getElementById('dnGroups').value) },
    ownerQQ: document.getElementById('ownerQQ').value.trim()
  });
  if (r.ok) { refreshWhitelist(); refresh(); alert('白名单已保存并生效'); }
  else alert(r.error || '保存失败');
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

// ── 语音库与语音发送（调试面板） ───────────────────────────────────────────
// 试发走 /api/voice/send（操作者通道，凭控制台令牌），与 CLI 同一条路径 ——
// 所以这里能验证「白名单 / 时长体积上限 / 限流 / 文件名审计」是不是真的生效。
let voiceEntries = [];
let voiceLibraryLoaded = false;
// 只在首次进入/手动刷新时拉取：语音库会逐个 ffprobe 探测时长，放进 3 秒轮询会白白压网关。
async function loadVoiceLibrary(force) {
  if (voiceLibraryLoaded && force !== true) return;
  const box = document.getElementById('voiceList');
  const msg = document.getElementById('voiceMsg');
  try {
    const r = await api('/api/voice/list?probe=1');
    voiceEntries = Array.isArray(r.voices) ? r.voices : [];
    voiceLibraryLoaded = true;
    if (!voiceEntries.length) {
      box.innerHTML = '语音库是空的：把音频文件放进 <code>qq-bridge/audio/</code> 后点「刷新语音库」。';
      return;
    }
    const limits = r.limits || {};
    box.innerHTML = '共 ' + voiceEntries.length + ' 个（上限：' + (limits.maxSeconds || '?') + ' 秒 / '
      + Math.round((limits.maxBytes || 0) / 1024 / 1024) + ' MiB / ' + (limits.maxPerMinute || '?') + ' 每分钟）：<br>'
      + voiceEntries.map((v, i) => {
        const bad = v.ok === false;
        // v.name / v.error / v.detail 来自语音库的文件名与探测结果，属于**外部数据**：
        // 语音库目录里放一个名为 `x<img src=x onerror=...>.mp3` 的文件即可注入脚本
        // （CSP 允许 unsafe-inline，拦不住内联事件处理器）。所有插值都必须过 esc()。
        return '<label style="display:block;margin:2px 0">'
          + '<input type="radio" name="voicePick" value="' + i + '"' + (i === 0 ? ' checked' : '') + '> '
          + '<code>' + esc(v.name) + '</code> ' + (bad ? '❌ ' + esc(v.error || '不可用') : esc(v.detail || ''))
          + '</label>';
      }).join('');
  } catch (error) {
    box.textContent = '加载失败：' + (error && error.message ? error.message : error);
  }
  if (msg) msg.textContent = '';
}

async function sendVoiceFromConsole() {
  const msg = document.getElementById('voiceMsg');
  const target = document.getElementById('voiceSendTarget').value.trim();
  const dryRun = document.getElementById('voiceSendDryRun').checked;
  const pick = document.querySelector('input[name="voicePick"]:checked');
  if (!target) { msg.textContent = '❌ 请填发送目标（如 group:100005）'; msg.className = 'meta err'; return; }
  if (!pick) { msg.textContent = '❌ 先刷新语音库并选中一个音频'; msg.className = 'meta err'; return; }
  const entry = voiceEntries[Number(pick.value)];
  msg.textContent = '发送中…'; msg.className = 'meta';
  try {
    const r = await api('/api/voice/send', 'POST', { target, file: entry.name, dryRun });
    if (r.dryRun) {
      msg.textContent = '✅ 校验通过（未发送）：' + (r.detail || '');
      msg.className = 'meta ok';
    } else if (r.ok) {
      msg.textContent = '✅ 已发出 messageId=' + (r.messageId ?? '?')
        + (r.detail ? '（' + r.detail + '）' : '')
        + (r.verified ? '，已回读校验为语音段' : '，未能回读校验');
      msg.className = 'meta ok';
    } else {
      msg.textContent = '❌ ' + (r.error || '失败');
      msg.className = 'meta err';
    }
  } catch (error) {
    msg.textContent = '❌ ' + (error && error.message ? error.message : error);
    msg.className = 'meta err';
  }
}

// ── 二代仿真模式（reserved2）配置 ─────────────────────────────────────────
async function loadV2Config() {
  try {
    const r = await api('/api/socialV2/config');
    const c = r.config || {};
    document.getElementById('v2Enabled').checked = c.enabled !== false;
    document.getElementById('v2AgentPreset').value = c.agentPreset || '';
    document.getElementById('v2ProvideRecommendations').checked = c.provideRecommendations !== false;
    document.querySelectorAll('[data-v2-tool]').forEach(el => {
      el.checked = (c.tools && c.tools[el.dataset.v2Tool] !== false);
    });
    const w = c.wake || {};
    document.getElementById('v2WakeDefaultMode').value = w.defaultMode === 'active' ? 'active' : 'diving';
    document.getElementById('v2RecDefaultInfinite').checked = w.recommendedDefaultInfinite !== false;
    document.getElementById('v2RecSleepMin').value = Math.round((w.recommendedSleepMinMs || 300000) / 60000);
    document.getElementById('v2RecSleepMax').value = Math.round((w.recommendedSleepMaxMs || 7200000) / 60000);
    document.getElementById('v2RecProb').value = w.recommendedProbability ?? 0.05;
    document.getElementById('v2RecKeywords').value = (w.recommendedKeywords || []).join(', ');
    document.getElementById('v2RecAt').checked = w.recommendedAtMention !== false;
    document.getElementById('v2RecName').checked = w.recommendedNameMention !== false;
    document.getElementById('v2RecQuestion').checked = w.recommendedQuestion !== false;
    document.getElementById('v2RecPoke').checked = w.recommendedPoke !== false;
    document.getElementById('v2WakeHint').value = w.recommendedHint || '';
    document.getElementById('v2SleepMinMs').value = Math.round((w.sleepMinMs || 60000) / 1000);
    document.getElementById('v2SleepMaxMs').value = Math.round((w.sleepMaxMs || 0) / 1000);
    document.getElementById('v2MaxWakeMin').value = w.maxWakePerMinute ?? 1;
    document.getElementById('v2MaxWakeHour').value = w.maxWakePerHour ?? 12;
    document.getElementById('v2BatchWindowMs').value = w.batchWindowMs ?? 8000;
    document.getElementById('v2NoActionLimit').value = w.noActionLimit ?? 3;
    document.getElementById('v2MaxWakeConfigReminders').value = w.maxWakeConfigReminders ?? 2;
    document.getElementById('v2PreSleepWaitEnabled').checked = w.preSleepWaitEnabled !== false;
    document.getElementById('v2PreSleepWaitMin').value = Number.isFinite(Number(w.preSleepWaitMs)) ? Math.round(Number(w.preSleepWaitMs) / 60000) : 5;
    const s = c.send || {};
    document.getElementById('v2BurstEnabled').checked = s.burstEnabled !== false;
    document.getElementById('v2BurstMax').value = s.burstMaxMessages ?? 8;
    document.getElementById('v2BurstMin').value = s.burstIntervalMinMs ?? 1000;
    document.getElementById('v2BurstMaxMs').value = s.burstIntervalMaxMs ?? 3000;
    document.getElementById('v2LongGapProb').value = s.longGapProbability ?? 0.2;
    document.getElementById('v2LongGapMin').value = s.longGapMinMs ?? 5000;
    document.getElementById('v2LongGapMax').value = s.longGapMaxMs ?? 10000;
    document.getElementById('v2MaxSendMin').value = s.maxSendPerMinute ?? 8;
    document.getElementById('v2MaxSendHour').value = s.maxSendPerHour ?? 60;
    document.getElementById('v2MaxMsgChars').value = s.maxMessageChars ?? 500;
    document.getElementById('v2MaxGapMs').value = s.maxGapMs ?? 10000;
    document.getElementById('v2GapBaseMs').value = s.gapBaseMs ?? 800;
    document.getElementById('v2GapPerCharMs').value = s.gapPerCharMs ?? 20;
    document.getElementById('v2SendHint').value = s.recommendedHint || '';
    const wt = c.wait || {};
    document.getElementById('v2WaitDefaultMs').value = wt.defaultMs ?? 30000;
    document.getElementById('v2WaitMinMs').value = wt.minMs ?? 5000;
    document.getElementById('v2WaitMaxMs').value = wt.maxMs ?? 600000;
    document.getElementById('v2WaitDefaultQuietMs').value = wt.defaultQuietMs ?? 8000;
    document.getElementById('v2MinQuietAfterNewMs').value = wt.minQuietAfterNewMs ?? 10000;
    document.getElementById('v2AutoReplyCheckSec').value = Math.round((c.autoReplyCheckMs || 30000) / 1000);
    const pa = c.proactive || {};
    document.getElementById('v2ProactiveEnabled').checked = pa.enabled !== false;
    document.getElementById('v2ProactiveIntervalMin').value = Math.round((pa.checkIntervalMinMs || 1800000) / 60000);
    document.getElementById('v2ProactiveIntervalMax').value = Math.round((pa.checkIntervalMaxMs || 5400000) / 60000);
    document.getElementById('v2ProactiveIdleThreshold').value = Math.round((pa.idleThresholdMs || 900000) / 60000);
    document.getElementById('v2ProactiveProbability').value = pa.probability ?? 0.3;
    const stk = c.sticker || {};
    document.getElementById('v2StickerEnabled').checked = stk.enabled !== false;
    document.getElementById('v2StickerSyncTtlSec').value = Math.round((stk.syncTtlMs || 60000) / 1000);
    document.getElementById('v2StickerMaxList').value = stk.maxListCount ?? 100;
    document.getElementById('v2StickerPromptMax').value = stk.promptMaxStickers ?? 8;
    document.getElementById('v2StickerIncludePrompt').checked = stk.includeInPrompt !== false;
    const stkCollect = stk.collect || {};
    document.getElementById('v2StickerCollectEnabled').checked = stkCollect.enabled !== false;
    document.getElementById('v2StickerCollectPerMin').value = stkCollect.maxPerMinute ?? 2;
    document.getElementById('v2StickerCollectPerHour').value = stkCollect.maxPerHour ?? 10;
    document.getElementById('v2StickerCollectRemarkMax').value = stkCollect.maxRemarkChars ?? 20;
    const ctx = c.context || {};
    document.getElementById('v2ContextRecentLimit').value = ctx.recentLimit ?? 100;
    document.getElementById('v2ContextUnreadLimit').value = ctx.unreadLimit ?? 30;
    document.getElementById('v2ContextWindow').value = ctx.contextWindow ?? 20;
    const fb = c.feedback || {};
    document.getElementById('v2FeedbackMaxLength').value = fb.maxLength ?? 500;
    document.getElementById('v2FeedbackNotifyOwner').checked = fb.notifyOwnerOnError === true;
  } catch {}
}

async function saveV2Config() {
  const tools = {};
  document.querySelectorAll('[data-v2-tool]').forEach(el => { tools[el.dataset.v2Tool] = el.checked; });
  const body = {
    enabled: document.getElementById('v2Enabled').checked,
    agentPreset: document.getElementById('v2AgentPreset').value.trim(),
    provideRecommendations: document.getElementById('v2ProvideRecommendations').checked,
    autoReplyCheckMs: Math.round(Number(document.getElementById('v2AutoReplyCheckSec').value) || 30) * 1000,
    tools,
    wake: {
      defaultMode: document.getElementById('v2WakeDefaultMode').value,
      recommendedDefaultInfinite: document.getElementById('v2RecDefaultInfinite').checked,
      preSleepWaitEnabled: document.getElementById('v2PreSleepWaitEnabled').checked,
      preSleepWaitMs: (Number.isFinite(Number(document.getElementById('v2PreSleepWaitMin').value)) && Number(document.getElementById('v2PreSleepWaitMin').value) >= 0 ? Math.round(Number(document.getElementById('v2PreSleepWaitMin').value)) : 5) * 60000,
      recommendedSleepMinMs: (Math.round(Number(document.getElementById('v2RecSleepMin').value) || 5)) * 60000,
      recommendedSleepMaxMs: (Math.round(Number(document.getElementById('v2RecSleepMax').value) || 120)) * 60000,
      recommendedProbability: Number(document.getElementById('v2RecProb').value) || 0,
      recommendedKeywords: document.getElementById('v2RecKeywords').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      recommendedAtMention: document.getElementById('v2RecAt').checked,
      recommendedNameMention: document.getElementById('v2RecName').checked,
      recommendedQuestion: document.getElementById('v2RecQuestion').checked,
      recommendedPoke: document.getElementById('v2RecPoke').checked,
      recommendedHint: document.getElementById('v2WakeHint').value,
      sleepMinMs: (Math.round(Number(document.getElementById('v2SleepMinMs').value) || 0)) * 1000,
      sleepMaxMs: (Math.round(Number(document.getElementById('v2SleepMaxMs').value) || 0)) * 1000,
      maxWakePerMinute: Math.round(Number(document.getElementById('v2MaxWakeMin').value) || 0),
      maxWakePerHour: Math.round(Number(document.getElementById('v2MaxWakeHour').value) || 0),
      batchWindowMs: Math.round(Number(document.getElementById('v2BatchWindowMs').value) || 8000),
      noActionLimit: Math.round(Number(document.getElementById('v2NoActionLimit').value) || 3),
      maxWakeConfigReminders: Math.round(Number(document.getElementById('v2MaxWakeConfigReminders').value) || 2)
    },
    send: {
      burstEnabled: document.getElementById('v2BurstEnabled').checked,
      burstMaxMessages: Math.round(Number(document.getElementById('v2BurstMax').value) || 8),
      burstIntervalMinMs: Math.round(Number(document.getElementById('v2BurstMin').value) || 1000),
      burstIntervalMaxMs: Math.round(Number(document.getElementById('v2BurstMaxMs').value) || 3000),
      longGapProbability: Number(document.getElementById('v2LongGapProb').value) || 0,
      longGapMinMs: Math.round(Number(document.getElementById('v2LongGapMin').value) || 5000),
      longGapMaxMs: Math.round(Number(document.getElementById('v2LongGapMax').value) || 10000),
      maxSendPerMinute: Math.round(Number(document.getElementById('v2MaxSendMin').value) || 0),
      maxSendPerHour: Math.round(Number(document.getElementById('v2MaxSendHour').value) || 0),
      maxMessageChars: Math.round(Number(document.getElementById('v2MaxMsgChars').value) || 500),
      maxGapMs: Math.round(Number(document.getElementById('v2MaxGapMs').value) || 10000),
      gapBaseMs: Math.round(Number(document.getElementById('v2GapBaseMs').value) || 800),
      gapPerCharMs: Math.round(Number(document.getElementById('v2GapPerCharMs').value) || 20),
      recommendedHint: document.getElementById('v2SendHint').value
    },
    wait: {
      defaultMs: Math.round(Number(document.getElementById('v2WaitDefaultMs').value) || 5000),
      minMs: Math.round(Number(document.getElementById('v2WaitMinMs').value) || 1000),
      maxMs: Math.round(Number(document.getElementById('v2WaitMaxMs').value) || 10000),
      defaultQuietMs: Number.isFinite(Number(document.getElementById('v2WaitDefaultQuietMs').value)) ? Math.max(0, Math.round(Number(document.getElementById('v2WaitDefaultQuietMs').value))) : 8000,
      minQuietAfterNewMs: Number.isFinite(Number(document.getElementById('v2MinQuietAfterNewMs').value)) ? Math.max(0, Math.round(Number(document.getElementById('v2MinQuietAfterNewMs').value))) : 10000
    },
    proactive: {
      enabled: document.getElementById('v2ProactiveEnabled').checked,
      checkIntervalMinMs: Math.round(Number(document.getElementById('v2ProactiveIntervalMin').value) || 30) * 60000,
      checkIntervalMaxMs: Math.round(Number(document.getElementById('v2ProactiveIntervalMax').value) || 90) * 60000,
      idleThresholdMs: Math.round(Number(document.getElementById('v2ProactiveIdleThreshold').value) || 15) * 60000,
      probability: Number(document.getElementById('v2ProactiveProbability').value) || 0
    },
    sticker: {
      enabled: document.getElementById('v2StickerEnabled').checked,
      syncTtlMs: Math.max(1000, Math.round(Number(document.getElementById('v2StickerSyncTtlSec').value) || 60) * 1000),
      maxListCount: Math.min(500, Math.max(1, Math.round(Number(document.getElementById('v2StickerMaxList').value) || 100))),
      includeInPrompt: document.getElementById('v2StickerIncludePrompt').checked,
      promptMaxStickers: Math.min(30, Math.max(1, Math.round(Number(document.getElementById('v2StickerPromptMax').value) || 8))),
      collect: {
        enabled: document.getElementById('v2StickerCollectEnabled').checked,
        maxPerMinute: Math.max(0, Math.round(Number(document.getElementById('v2StickerCollectPerMin').value) || 0)),
        maxPerHour: Math.max(0, Math.round(Number(document.getElementById('v2StickerCollectPerHour').value) || 0)),
        maxRemarkChars: Math.min(50, Math.max(1, Math.round(Number(document.getElementById('v2StickerCollectRemarkMax').value) || 20)))
      }
    },
    context: {
      recentLimit: Math.round(Number(document.getElementById('v2ContextRecentLimit').value) || 100),
      unreadLimit: Math.round(Number(document.getElementById('v2ContextUnreadLimit').value) || 30),
      contextWindow: Math.round(Number(document.getElementById('v2ContextWindow').value) || 20)
    },
    feedback: {
      maxLength: Math.round(Number(document.getElementById('v2FeedbackMaxLength').value) || 500),
      notifyOwnerOnError: document.getElementById('v2FeedbackNotifyOwner').checked
    }
  };
  const r = await api('/api/socialV2/config', 'POST', body);
  const msg = document.getElementById('v2ConfigMsg');
  msg.textContent = r.ok ? '✅ 已保存' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) loadV2Config();
}

async function viewV2State() {
  const key = document.getElementById('v2StateKey').value.trim();
  if (!key) { alert('请输入会话 key'); return; }
  const r = await api('/api/socialV2/state?key=' + encodeURIComponent(key));
  document.getElementById('v2StateOutput').textContent = JSON.stringify(r, null, 2);
}

function v2ToolLogStatus(entry) {
  if (entry.type === 'result') {
    const ok = entry.ok !== false;
    return `<span class="pill ${ok ? 'g' : 'r'}">${ok ? '成功' : '失败'}</span>`;
  }
  return '<span class="pill b">调用</span>';
}
function summarizeToolArgs(tool, args) {
  let obj = args;
  if (typeof args === 'string') {
    try { obj = JSON.parse(args); } catch { return args || ''; }
  }
  if (!obj || typeof obj !== 'object') return String(obj ?? '');
  const parts = [];
  const push = (k, v) => {
    if (v === undefined || v === null || v === '') return;
    parts.push(`${k}=${v}`);
  };
  const t = String(tool || '');
  if (t.includes('qq_set_wake_config')) {
    const cfg = (obj.config && typeof obj.config === 'object') ? obj.config : obj;
    push('mode', cfg.mode);
    push('infinite', cfg.infinite);
    const sleepUntil = cfg.sleepUntil || obj.sleepUntil;
    const sleepMs = cfg.sleepMs !== undefined ? cfg.sleepMs : obj.sleepMs;
    if (sleepUntil) push('sleepUntil', sleepUntil);
    else if (sleepMs !== undefined) push('sleepMs', sleepMs + 'ms');
    else push('sleep', '未设置时间');
    const tr = (cfg.triggers && typeof cfg.triggers === 'object') ? cfg.triggers : {};
    const trigs = [];
    if (tr.atMention) trigs.push('@');
    if (tr.nameMention) trigs.push('名字');
    if (tr.question) trigs.push('提问');
    if (tr.poke) trigs.push('拍一拍');
    if (Array.isArray(tr.keywords) && tr.keywords.length) trigs.push('关键词:' + tr.keywords.join(','));
    if (Array.isArray(tr.speakerIds) && tr.speakerIds.length) trigs.push('指定成员:' + tr.speakerIds.join(','));
    if (tr.anyMessage) trigs.push('anyMessage');
    if (Number(tr.probability) > 0) trigs.push('概率:' + tr.probability);
    if (trigs.length) push('triggers', trigs.join('|'));
  } else if (t.includes('qq_wait_for_messages')) {
    push('timeoutMs', obj.timeoutMs != null ? obj.timeoutMs : '默认30000');
    push('minNewMessages', obj.minNewMessages != null ? obj.minNewMessages : 1);
    push('quietMs', obj.quietMs != null ? obj.quietMs : '默认8000');
  } else if (t.includes('qq_send_message')) {
    const msgs = Array.isArray(obj.messages) ? obj.messages : (obj.messages != null ? [obj.messages] : []);
    push('条数', msgs.length);
    if (msgs.length) push('首条', String(msgs[0]).slice(0, 30));
    push('gapMode', obj.gapMode || 'auto');
    if (obj.gapMs != null) push('gapMs', obj.gapMs);
    if (Array.isArray(obj.gaps) && obj.gaps.length) push('gaps', obj.gaps.join(','));
    if (obj.replyToMessageId != null && obj.replyToMessageId !== '') push('引用id', obj.replyToMessageId);
  } else if (t.includes('qq_send_burst')) {
    const msgs = Array.isArray(obj.messages) ? obj.messages : [];
    push('条数', msgs.length);
    if (msgs.length) push('首条', String(msgs[0]).slice(0, 30));
  } else if (t.includes('qq_send_poke')) {
    push('key', obj.key);
    if (obj.targetUserId != null && obj.targetUserId !== '') push('target', obj.targetUserId);
  } else if (t.includes('qq_get_forward_msg')) {
    push('key', obj.key);
    if (obj.id != null && obj.id !== '') push('id', String(obj.id).slice(0, 40));
  } else if (t.includes('qq_mark_read')) {
    push('key', obj.key);
  } else if (t.includes('qq_get_prompt') || t.includes('qq_get_unread_messages') || t.includes('qq_get_recent_messages') || t.includes('qq_social_state') || t.includes('qq_get_my_recent_messages') || t.includes('qq_get_message_detail') || t.includes('qq_get_active_members')) {
    push('key', obj.key);
    if (obj.messageId != null) push('messageId', obj.messageId);
    if (obj.limit != null) push('limit', obj.limit);
  } else {
    push('key', obj.key);
  }
  return parts.join(' | ') || JSON.stringify(obj);
}
function v2ToolLogCell(value, tool) {
  const text = value == null ? '' : String(value);
  if (!text) return '<span class="meta">-</span>';
  const summary = tool ? summarizeToolArgs(tool, text) : text;
  const short = summary.length > 100 ? summary.slice(0, 100) + '…' : summary;
  return `<span class="tool-log-cell" data-full="${esc(text)}" data-short="${esc(short)}" title="点击查看完整 JSON">${esc(short)}</span>`;
}
function renderV2ToolLog(entries) {
  const box = document.getElementById('v2ToolLogOutput');
  const list = entries || [];
  if (!list.length) { box.innerHTML = '<span class="meta">（空）</span>'; return; }
  let html = '<table><tr><th>时间</th><th>会话 key</th><th>工具名</th><th>状态</th><th>参数</th><th>错误信息</th></tr>';
  for (const e of list) {
    const time = e.time ? new Date(e.time).toLocaleString() : '-';
    const key = esc(e.key || '');
    const tool = esc(e.tool || '-');
    const status = v2ToolLogStatus(e);
    const params = e.type === 'call' ? v2ToolLogCell(e.args, e.tool) : '<span class="meta">-</span>';
    const error = e.type === 'result' ? v2ToolLogCell(e.error) : '<span class="meta">-</span>';
    html += `<tr><td>${esc(time)}</td><td>${key}</td><td>${tool}</td><td>${status}</td><td>${params}</td><td>${error}</td></tr>`;
  }
  html += '</table>';
  box.innerHTML = html;
}
function loadV2ToolLog() {
  return api('/api/socialV2/tool-log?limit=200')
    .then(r => { renderV2ToolLog(r.entries || []); })
    .catch(() => { renderV2ToolLog([]); });
}
document.getElementById('v2ToolLogOutput').addEventListener('click', (ev) => {
  const cell = ev.target.closest('.tool-log-cell');
  if (!cell) return;
  const full = cell.dataset.full;
  const short = cell.dataset.short;
  if (cell.classList.contains('expanded')) {
    cell.classList.remove('expanded');
    cell.textContent = short;
  } else {
    cell.classList.add('expanded');
    cell.textContent = full;
  }
});

function renderV2Memory(data) {
  const box = document.getElementById('v2MemoryOutput');
  if (!data || !data.ok) {
    box.innerHTML = '<span class="meta">加载失败</span>';
    return;
  }
  const raw = data.raw || {};
  const topics = Array.isArray(raw.activeTopics) ? raw.activeTopics : [];
  const thoughts = Array.isArray(raw.pendingThoughts) ? raw.pendingThoughts : [];
  const impressions = raw.memberImpressions && typeof raw.memberImpressions === 'object' ? raw.memberImpressions : {};
  let html = '<div style="padding:8px">';
  html += '<div class="memory-section"><b>进行中的话题</b> <button class="small" data-action="clear" data-cat="activeTopic">清空</button>';
  if (!topics.length) html += '<div class="meta">（空）</div>';
  for (const t of topics) {
    const text = esc(String(t?.text || ''));
    const extra = t?.pendingQuestion ? `；待追问：${esc(String(t.pendingQuestion))}` : '';
    html += `<div style="margin:4px 0">📌 ${text}${extra} <button class="small" data-action="edit" data-cat="activeTopic" data-content="${esc(String(t?.text || ''))}">编辑</button> <button class="small" data-action="remove" data-cat="activeTopic" data-content="${esc(String(t?.text || ''))}">删除</button></div>`;
  }
  html += '</div>';
  html += '<div class="memory-section"><b>你想说但还没说的</b> <button class="small" data-action="clear" data-cat="pendingThought">清空</button>';
  if (!thoughts.length) html += '<div class="meta">（空）</div>';
  for (const t of thoughts) {
    html += `<div style="margin:4px 0">💭 ${esc(String(t?.text || ''))}${t?.motivation ? `（${esc(String(t.motivation))}）` : ''} <button class="small" data-action="edit" data-cat="pendingThought" data-content="${esc(String(t?.text || ''))}">编辑</button> <button class="small" data-action="remove" data-cat="pendingThought" data-content="${esc(String(t?.text || ''))}">删除</button></div>`;
  }
  html += '</div>';
  html += '<div class="memory-section"><b>对群友的印象</b> <button class="small" data-action="clear" data-cat="memberImpression">清空</button>';
  const names = Object.keys(impressions);
  if (!names.length) html += '<div class="meta">（空）</div>';
  for (const name of names) {
    const im = impressions[name] || {};
    const traits = Array.isArray(im.traits) ? im.traits : [];
    html += `<div style="margin:4px 0">👤 ${esc(name)}：${traits.length ? esc(traits.join('、')) : '暂无记录'}（互动 ${Number(im.interactionCount) || 0} 次） <button class="small" data-action="edit" data-cat="memberImpression" data-target="${esc(name)}" data-traits="${esc(traits.join(', '))}">编辑</button> <button class="small" data-action="remove" data-cat="memberImpression" data-target="${esc(name)}">删除</button></div>`;
  }
  html += '</div></div>';
  box.innerHTML = html;
}
function loadV2Memory() {
  const key = document.getElementById('v2MemoryKey').value.trim();
  const msg = document.getElementById('v2MemoryMsg');
  if (!key) { msg.textContent = '请输入会话 key'; msg.className = 'meta err'; return; }
  msg.textContent = '加载中…';
  msg.className = 'meta';
  return api('/api/socialV2/memory?key=' + encodeURIComponent(key))
    .then(r => {
      renderV2Memory(r);
      msg.textContent = r.ok ? '✅ 已加载' : ('❌ ' + (r.error || '失败'));
      msg.className = r.ok ? 'meta ok' : 'meta err';
    })
    .catch(e => {
      msg.textContent = '❌ ' + (e.message || e);
      msg.className = 'meta err';
    });
}
document.getElementById('v2MemoryLoad').addEventListener('click', loadV2Memory);
document.getElementById('v2MemoryClearAll').addEventListener('click', async () => {
  const key = document.getElementById('v2MemoryKey').value.trim();
  const msg = document.getElementById('v2MemoryMsg');
  if (!key) { msg.textContent = '请输入会话 key'; msg.className = 'meta err'; return; }
  if (!confirm('确定清空该会话全部轻量记忆？')) return;
  const r = await api('/api/socialV2/memory-clear', 'POST', { key, category: '' });
  msg.textContent = r.ok ? '✅ 已清空全部记忆' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) loadV2Memory();
});
document.getElementById('v2MemoryOutput').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const key = document.getElementById('v2MemoryKey').value.trim();
  const msg = document.getElementById('v2MemoryMsg');
  if (!key) { msg.textContent = '请输入会话 key'; msg.className = 'meta err'; return; }
  const cat = btn.dataset.cat;
  const action = btn.dataset.action;
  let r;
  if (action === 'clear') {
    r = await api('/api/socialV2/memory-clear', 'POST', { key, category: cat });
  } else if (action === 'edit') {
    let newContent;
    let newExtra = {};
    if (cat === 'memberImpression') {
      const input = prompt(`编辑对 ${btn.dataset.target} 的印象特质（逗号分隔）：`, btn.dataset.traits || '');
      if (input === null) return;
      newContent = input;
    } else {
      const input = prompt(`编辑${cat === 'activeTopic' ? '话题' : '想法'}内容：`, btn.dataset.content || '');
      if (input === null) return;
      newContent = input;
    }
    r = await api('/api/socialV2/memory-update', 'POST', { key, category: cat, oldContent: btn.dataset.content || '', target: btn.dataset.target || '', newContent, newExtra });
  } else {
    r = await api('/api/socialV2/memory-remove', 'POST', { key, category: cat, content: btn.dataset.content || '', target: btn.dataset.target || '' });
  }
  msg.textContent = r.ok ? '✅ 已更新' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) loadV2Memory();
});

function formatWakeStatus(r) {
  if (!r || !r.ok) return '<span class="meta">加载失败</span>';
  const wc = r.wakeConfig || {};
  const lines = [];
  const mode = wc.mode === 'active' ? '活跃（任何消息都会唤醒）' : (wc.mode === 'diving' ? '潜水' : (wc.mode || '未知'));
  lines.push(`<div><b>模式：</b>${esc(mode)}</div>`);
  lines.push(`<div><b>无限期：</b>${wc.infinite ? '是' : '否'}</div>`);
  const safety = r.wakeSafety || {};
  const badge = safety.guaranteed ? '🟢 已保证' : '🔴 无保证';
  lines.push(`<div><b>唤醒保证：</b>${badge}${safety.stale ? '（配置较旧，未确认）' : ''}</div>`);
  let next = '';
  if (wc.mode === 'active' || wc.triggers?.anyMessage) {
    next = '任何新消息都会唤醒';
  } else if (wc.sleepUntil) {
    const until = new Date(wc.sleepUntil).getTime();
    const remain = until - Date.now();
    if (!Number.isFinite(remain)) next = '时间格式无效';
    else if (remain > 0) next = `约 ${Math.max(1, Math.round(remain / 1000))} 秒后（${new Date(wc.sleepUntil).toLocaleString()}）`;
    else next = '已到期，等待下一次唤醒';
  } else if (wc.infinite) {
    next = '无限期潜水，等待指定条件';
  } else {
    next = '未设置时间';
  }
  lines.push(`<div><b>下次唤醒：</b>${esc(next)}</div>`);
  const tr = wc.triggers || {};
  const conds = [];
  if (tr.atMention) conds.push('@');
  if (tr.nameMention) conds.push('名字');
  if (Array.isArray(tr.keywords) && tr.keywords.length) conds.push('关键词：' + tr.keywords.join('、'));
  if (Array.isArray(tr.speakerIds) && tr.speakerIds.length) conds.push('指定成员：' + tr.speakerIds.join('、'));
  if (tr.question) conds.push('提问');
  if (tr.poke) conds.push('拍一拍');
  if (tr.anyMessage) conds.push('任何消息');
  if (Number(tr.probability) > 0) conds.push('普通消息概率 ' + Number(tr.probability));
  lines.push(`<div><b>提前唤醒条件：</b>${conds.length ? esc(conds.join('；')) : '（无）'}</div>`);
  lines.push(`<div><b>最近唤醒原因：</b>${esc(r.lastWakeReason || '-')}</div>`);
  lines.push(`<div><b>唤醒次数：</b>${Number(wc.wakeCount) || 0}</div>`);
  if (wc.confirmedAt) {
    const ago = Math.max(0, Math.round((Date.now() - wc.confirmedAt) / 60000));
    lines.push(`<div><b>配置确认：</b>${ago} 分钟前（${esc(wc.confirmedBy || 'unknown')}）</div>`);
  }
  if (r.lastAiReplyAt) {
    const ago = Math.max(0, Math.round((Date.now() - r.lastAiReplyAt) / 60000));
    lines.push(`<div><b>上次发言：</b>${ago} 分钟前</div>`);
  }
  lines.push(`<div><b>未读：</b>${Number(r.unreadCount) || 0} 条</div>`);
  return '<div style="padding:8px">' + lines.join('') + '</div>';
}
function loadV2WakeStatus() {
  const key = document.getElementById('v2WakeKey').value.trim();
  const msg = document.getElementById('v2WakeStatusMsg');
  if (!key) { msg.textContent = '请输入会话 key'; msg.className = 'meta err'; return; }
  msg.textContent = '加载中…';
  msg.className = 'meta';
  return api('/api/socialV2/state?key=' + encodeURIComponent(key))
    .then(r => {
      document.getElementById('v2WakeStatusOutput').innerHTML = formatWakeStatus(r);
      msg.textContent = r.ok ? '✅ 已加载' : ('❌ ' + (r.error || '失败'));
      msg.className = r.ok ? 'meta ok' : 'meta err';
    })
    .catch(e => {
      msg.textContent = '❌ ' + (e.message || e);
      msg.className = 'meta err';
    });
}
document.getElementById('v2WakeStatusLoad').addEventListener('click', loadV2WakeStatus);

// ── 初始提示词（每个会话一份，只在 AI 首次唤醒时注入一次） ────────────────────
const v2InitPromptTextEl = document.getElementById('v2InitPromptText');
function v2InitPromptKeyValue() { return document.getElementById('v2InitPromptKey').value.trim(); }
function setV2InitPromptMsg(text, kind) {
  const msg = document.getElementById('v2InitPromptMsg');
  msg.textContent = text;
  msg.className = 'meta' + (kind ? ' ' + kind : '');
}
function updateV2InitPromptCount() {
  document.getElementById('v2InitPromptCount').textContent = String(v2InitPromptTextEl.value.length);
}
function applyV2InitPromptMax(maxChars) {
  const max = Math.round(Number(maxChars));
  if (!Number.isFinite(max) || max <= 0) return;
  document.getElementById('v2InitPromptMax').textContent = String(max);
  v2InitPromptTextEl.maxLength = max;
}
function renderV2InitPromptEntries(entries) {
  const box = document.getElementById('v2InitPromptList');
  if (!Array.isArray(entries) || !entries.length) { box.textContent = '（还没有任何会话设置初始提示词）'; return; }
  box.innerHTML = entries.map((e) => {
    const when = Number(e.updatedAt) > 0 ? new Date(Number(e.updatedAt)).toLocaleString() : '未知时间';
    return `<div style="margin:3px 0"><code>${esc(e.key)}</code> · ${Number(e.chars) || 0} 字符 · ${esc(when)} <button class="small" data-init-prompt-key="${esc(e.key)}">编辑</button></div>`;
  }).join('');
}
async function loadV2InitialPrompt() {
  const key = v2InitPromptKeyValue();
  setV2InitPromptMsg('加载中…');
  try {
    const r = await api('/api/socialV2/initial-prompt' + (key ? '?key=' + encodeURIComponent(key) : ''));
    if (!r.ok) { setV2InitPromptMsg('❌ ' + (r.error || '失败'), 'err'); return; }
    applyV2InitPromptMax(r.maxChars);
    const readOnly = r.writable === false;
    if (!key) {
      renderV2InitPromptEntries(r.entries);
      setV2InitPromptMsg(readOnly ? '⚠️ 文件不可写（只读降级），只显示已有内容' : `✅ 共 ${(r.entries || []).length} 条`, readOnly ? 'err' : 'ok');
      return;
    }
    v2InitPromptTextEl.value = r.text || '';
    updateV2InitPromptCount();
    document.getElementById('v2InitPromptList').textContent = r.exists
      ? '该会话已设置初始提示词；再点「保存」会覆盖。'
      : '该会话还没有设置初始提示词；填写后点「保存」新建。';
    if (readOnly) setV2InitPromptMsg('⚠️ 文件不可写（只读降级）：能看不能存', 'err');
    else setV2InitPromptMsg(r.exists ? '✅ 已加载' : '（空）', r.exists ? 'ok' : '');
  } catch (e) {
    setV2InitPromptMsg('❌ ' + (e.message || e), 'err');
  }
}
async function saveV2InitialPrompt() {
  const key = v2InitPromptKeyValue();
  if (!key) { setV2InitPromptMsg('请输入会话 key（group:群号 或 private:QQ号）', 'err'); return; }
  setV2InitPromptMsg('保存中…');
  try {
    const r = await api('/api/socialV2/initial-prompt', 'POST', { key, text: v2InitPromptTextEl.value });
    if (!r.ok) { setV2InitPromptMsg('❌ ' + (r.error || '失败'), 'err'); return; }
    applyV2InitPromptMax(r.maxChars);
    if (r.deleted) {
      v2InitPromptTextEl.value = '';
      updateV2InitPromptCount();
      setV2InitPromptMsg('✅ 内容为空，已删除该会话的初始提示词', 'ok');
    } else {
      setV2InitPromptMsg(`✅ 已保存（${r.chars} 字符），该会话下一次首次唤醒时注入`, 'ok');
    }
  } catch (e) {
    setV2InitPromptMsg('❌ ' + (e.message || e), 'err');
  }
}
document.getElementById('v2InitPromptLoad').addEventListener('click', loadV2InitialPrompt);
document.getElementById('v2InitPromptSave').addEventListener('click', saveV2InitialPrompt);
document.getElementById('v2InitPromptClear').addEventListener('click', async () => {
  const key = v2InitPromptKeyValue();
  if (!key) { setV2InitPromptMsg('请输入会话 key', 'err'); return; }
  if (!confirm(`确定删除 ${key} 的初始提示词？`)) return;
  try {
    const r = await api('/api/socialV2/initial-prompt', 'POST', { key, delete: true });
    if (!r.ok) { setV2InitPromptMsg('❌ ' + (r.error || '失败'), 'err'); return; }
    v2InitPromptTextEl.value = '';
    updateV2InitPromptCount();
    setV2InitPromptMsg('✅ 已删除', 'ok');
  } catch (e) {
    setV2InitPromptMsg('❌ ' + (e.message || e), 'err');
  }
});
v2InitPromptTextEl.addEventListener('input', updateV2InitPromptCount);
document.getElementById('v2InitPromptList').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-init-prompt-key]');
  if (!btn) return;
  document.getElementById('v2InitPromptKey').value = btn.dataset.initPromptKey || '';
  loadV2InitialPrompt();
});

async function loadV2SessionOptions() {
  const sel = document.getElementById('v2SessionSelect');
  const prev = sel.value;
  try {
    const r = await api('/api/status');
    const groups = Array.isArray(r.allowGroups) ? r.allowGroups : [];
    const privates = Array.isArray(r.allowPrivate) ? r.allowPrivate : [];
    const options = [{ value: '', label: '选择白名单群/私聊…' }];
    for (const g of groups) options.push({ value: 'group:' + g, label: '群 ' + g });
    for (const p of privates) options.push({ value: 'private:' + p, label: '私聊 ' + p });
    sel.innerHTML = options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    if (prev && options.some((o) => o.value === prev)) sel.value = prev;
  } catch (e) {
    sel.innerHTML = '<option value="">无法加载白名单</option>';
  }
}
document.getElementById('v2SessionRefresh').addEventListener('click', loadV2SessionOptions);
document.getElementById('v2SessionSelect').addEventListener('change', (ev) => {
  const key = ev.target.value;
  if (!key) return;
  document.getElementById('v2StateKey').value = key;
  document.getElementById('v2MemoryKey').value = key;
  document.getElementById('v2WakeKey').value = key;
  document.getElementById('v2InitPromptKey').value = key;
});

document.getElementById('v2ConfigSave').addEventListener('click', saveV2Config);
document.getElementById('v2ConfigSaveTop').addEventListener('click', saveV2Config);
document.getElementById('voiceRefreshBtn').addEventListener('click', () => loadVoiceLibrary(true));
document.getElementById('voiceSendBtn').addEventListener('click', sendVoiceFromConsole);
async function refreshV2Activity() {
  try {
    const r = await api('/api/socialV2/activity');
    const el = document.getElementById('v2ActivityStatus');
    el.textContent = r.paused ? '已暂停' : '运行中';
    el.className = r.paused ? 'meta err' : 'meta ok';
  } catch {}
}
document.getElementById('v2PauseBtn').addEventListener('click', async () => {
  await api('/api/socialV2/activity', 'POST', { paused: true });
  refreshV2Activity();
});
document.getElementById('v2ResumeBtn').addEventListener('click', async () => {
  await api('/api/socialV2/activity', 'POST', { paused: false });
  refreshV2Activity();
});
document.getElementById('v2ResetBtn').addEventListener('click', async () => {
  if (!confirm('确定重置二代 AI 状态？\n将清空所有二代会话、唤醒配置、未读消息和定时器；工具调用日志会保留。')) return;
  const r = await api('/api/socialV2/reset', 'POST', {});
  const msg = document.getElementById('v2ConfigMsg');
  msg.textContent = r.ok ? '✅ 已重置二代状态' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  refreshV2Activity();
  document.getElementById('v2AllStatesOutput').textContent = '（全部会话状态：空）';
  document.getElementById('v2StateOutput').textContent = '（空）';
});
document.getElementById('v2StateView').addEventListener('click', viewV2State);
document.getElementById('v2ForceWake').addEventListener('click', async () => {
  const key = document.getElementById('v2StateKey').value.trim();
  if (!key) { alert('请输入会话 key'); return; }
  const r = await api('/api/socialV2/wake', 'POST', { key, reason: 'admin' });
  const msg = document.getElementById('v2ConfigMsg');
  msg.textContent = r.ok ? '✅ 已发送唤醒' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
});
document.getElementById('v2StatesList').addEventListener('click', async () => {
  const r = await api('/api/socialV2/states');
  document.getElementById('v2AllStatesOutput').textContent = JSON.stringify(r.conversations || [], null, 2);
});
document.getElementById('v2FeedbackLoad').addEventListener('click', async () => {
  const r = await api('/api/socialV2/feedback');
  document.getElementById('v2FeedbackOutput').textContent = JSON.stringify(r.entries || [], null, 2);
});
document.getElementById('v2FeedbackClear').addEventListener('click', async () => {
  if (!confirm('确定清空全部 AI 反馈？')) return;
  const r = await api('/api/socialV2/feedback-clear', 'POST', {});
  const msg = document.getElementById('v2FeedbackMsg');
  msg.textContent = r.ok ? '✅ 已清空' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) document.getElementById('v2FeedbackOutput').textContent = '（空）';
});
document.getElementById('v2ToolLogLoad').addEventListener('click', async () => {
  const msg = document.getElementById('v2ToolLogMsg');
  msg.textContent = '';
  await loadV2ToolLog();
});
document.getElementById('v2ToolLogClear').addEventListener('click', async () => {
  if (!confirm('确定清空全部工具调用日志？')) return;
  const r = await api('/api/socialV2/tool-log/clear', 'POST', {});
  const msg = document.getElementById('v2ToolLogMsg');
  msg.textContent = r.ok ? '✅ 已清空' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  renderV2ToolLog([]);
});

// 只在页面加载/保存成功后填充输入框（避免自动刷新覆盖用户正在编辑的值）
async function loadSocialForm() {
  try {
    const s = await api('/api/social');
    const c = s.config;
    document.getElementById('sTrigger').value = c.triggerProbability;
    document.getElementById('sCheckMin').value = Math.round((c.activeCheckMinMs || 0) / 1000);
    document.getElementById('sCheckMax').value = Math.round((c.activeCheckMaxMs || 0) / 1000);
    document.getElementById('sActiveDelayMin').value = Math.round((c.activeReplyDelayMinMs || 0) / 1000);
    document.getElementById('sActiveDelayMax').value = Math.round((c.activeReplyDelayMaxMs || 0) / 1000);
    document.getElementById('sActiveDurationEnabled').checked = c.activeDurationEnabled !== false;
    document.getElementById('sActiveDurationMin').value = Math.round((c.activeDurationMinMs || 0) / 60000);
    document.getElementById('sActiveDurationMax').value = Math.round((c.activeDurationMaxMs || 0) / 60000);
    document.getElementById('sIdleWindow').value = Math.round((c.idleWindowMs || 0) / 60000);
    document.getElementById('sIdleRetry').value = c.idleRetryProbability;
    document.getElementById('sIdleWait').value = Math.round((c.idleRetryWaitMs || 0) / 60000);
    document.getElementById('sSkipProb').value = c.skipProbability ?? 0.15;
    document.getElementById('sSurrenderProb').value = c.surrenderProbability ?? 0.08;
    document.getElementById('sContextWindow').value = c.contextWindow;
    document.getElementById('sMaxChars').value = c.maxReplyChars ?? 500;
    document.getElementById('sBurstEnabled').checked = c.burstEnabled !== false;
    document.getElementById('sBurstIntervalMin').value = c.burstIntervalMinMs ?? 1000;
    document.getElementById('sBurstIntervalMax').value = c.burstIntervalMaxMs ?? 3000;
    document.getElementById('sLongGapProb').value = c.longGapProbability ?? 0.1;
    document.getElementById('sLongGapMin').value = c.longGapMinMs ?? 2500;
    document.getElementById('sLongGapMax').value = c.longGapMaxMs ?? 5000;
    document.getElementById('sKeywords').value = (c.mustReplyKeywords || []).join(', ');
    document.getElementById('sProactiveEnabled').checked = c.proactiveEnabled !== false;
    document.getElementById('sProactiveIdle').value = Math.round((c.proactiveIdleThresholdMs || 0) / 60000);
    document.getElementById('sProactiveCheckMin').value = Math.round((c.proactiveCheckMinMs || 0) / 60000);
    document.getElementById('sProactiveCheckMax').value = Math.round((c.proactiveCheckMaxMs || 0) / 60000);
    document.getElementById('sProactiveProb').value = c.proactiveProbability;
  } catch {}
}

// 每 3 秒只刷新状态徽章/摘要缓冲，不碰输入框
async function refreshSocialStatus() {
  try {
    const s = await api('/api/social');
    const buff = Object.entries(s.pendingSummaries || {}).map(([k, n]) => k + ':' + n).join('  ') || '无';
    const phaseLabel = { idle: '观望', active: '活跃', probing: '试探', exiting: '退场中' };
    const phaseClass = { idle: 'pill g', active: 'pill b', probing: 'pill r', exiting: 'pill' };
    const stateEntries = Object.entries(s.states || {});
    const sel = document.getElementById('sStateKey');
    const prevSel = sel.value;
    sel.innerHTML = '<option value="">选择会话</option>';
    for (const [k] of stateEntries) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      sel.appendChild(opt);
    }
    if (prevSel && [...sel.options].some(o => o.value === prevSel)) sel.value = prevSel;
    let html = '摘要缓冲: ' + esc(buff) + '<br>状态:';
    if (!stateEntries.length) html += ' 暂无（发过消息的群会显示状态）';
    for (const [k, v] of stateEntries) {
      html += ` <span class="${phaseClass[v.phase] || 'pill'}">${esc(k)} · ${phaseLabel[v.phase] || esc(v.phase)}</span>`;
    }
    document.getElementById('socialStatus').innerHTML = html;
  } catch {}
}

document.getElementById('socialSave').addEventListener('click', async () => {
  const n = (id) => Number(document.getElementById(id).value);
  const r = await api('/api/social', 'POST', {
    triggerProbability: Math.min(1, Math.max(0, n('sTrigger'))),
    activeCheckMinMs: Math.max(5, n('sCheckMin')) * 1000,
    activeCheckMaxMs: Math.max(5, n('sCheckMax')) * 1000,
    activeReplyDelayMinMs: Math.max(0, n('sActiveDelayMin')) * 1000,
    activeReplyDelayMaxMs: Math.max(0, n('sActiveDelayMax')) * 1000,
    activeDurationEnabled: document.getElementById('sActiveDurationEnabled').checked,
    activeDurationMinMs: Math.max(1, n('sActiveDurationMin')) * 60000,
    activeDurationMaxMs: Math.max(1, n('sActiveDurationMax')) * 60000,
    idleWindowMs: Math.max(1, n('sIdleWindow')) * 60000,
    idleRetryProbability: Math.min(1, Math.max(0, n('sIdleRetry'))),
    idleRetryWaitMs: Math.max(1, n('sIdleWait')) * 60000,
    skipProbability: Math.min(1, Math.max(0, n('sSkipProb'))),
    surrenderProbability: Math.min(1, Math.max(0, n('sSurrenderProb'))),
    contextWindow: Math.min(100, Math.max(1, n('sContextWindow'))),
    maxReplyChars: Math.max(1, n('sMaxChars')),
    burstEnabled: document.getElementById('sBurstEnabled').checked,
    burstIntervalMinMs: Math.max(0, n('sBurstIntervalMin')),
    burstIntervalMaxMs: Math.max(0, n('sBurstIntervalMax')),
    longGapProbability: Math.min(1, Math.max(0, n('sLongGapProb'))),
    longGapMinMs: Math.max(0, n('sLongGapMin')),
    longGapMaxMs: Math.max(0, n('sLongGapMax')),
    mustReplyKeywords: document.getElementById('sKeywords').value.split(/[,，]/).map(x => x.trim()).filter(Boolean),
    proactiveEnabled: document.getElementById('sProactiveEnabled').checked,
    proactiveIdleThresholdMs: Math.max(1, n('sProactiveIdle')) * 60000,
    proactiveCheckMinMs: Math.max(1, n('sProactiveCheckMin')) * 60000,
    proactiveCheckMaxMs: Math.max(1, n('sProactiveCheckMax')) * 60000,
    proactiveProbability: Math.min(1, Math.max(0, n('sProactiveProb')))
  });
  document.getElementById('socialMsg').textContent = r.ok ? '✅ 已保存' : ('❌ ' + (r.error || '失败'));
  document.getElementById('socialMsg').className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) { loadSocialForm(); refreshSocialStatus(); }
});
document.getElementById('socialFlush').addEventListener('click', async () => {
  const r = await api('/api/social/flush', 'POST', {});
  document.getElementById('socialMsg').textContent = r.ok ? '✅ 已触发摘要投喂' : ('❌ ' + (r.error || '失败'));
  document.getElementById('socialMsg').className = r.ok ? 'meta ok' : 'meta err';
});
async function setSocialPhase(phase) {
  const key = document.getElementById('sStateKey').value;
  if (!key) { alert('请先选择会话'); return; }
  const r = await api('/api/social/state', 'POST', { key, phase });
  document.getElementById('socialMsg').textContent = r.ok ? ('✅ 已设为' + (phase === 'active' ? '活跃' : '观望')) : ('❌ ' + (r.error || '失败'));
  document.getElementById('socialMsg').className = r.ok ? 'meta ok' : 'meta err';
  refreshSocialStatus();
}
document.getElementById('sStateActive').addEventListener('click', () => setSocialPhase('active'));
document.getElementById('sStateIdle').addEventListener('click', () => setSocialPhase('idle'));

let slangEntriesCache = [];
let slangSelected = new Set();
let slangActiveTab = 'candidate';
let slangModalId = null;
let slangModalMode = 'confirm'; // confirm | edit

// 「候选词-待研究 / 已研究」只是页面上的分栏：数据里都还是 status=candidate（确认、拒绝、研究接口都不变）。
// 有含义、用法或示例之一就算已研究（DSH 研究结果或手填都算）。
function slangIsResearched(e) {
  return !!(String(e?.meaning ?? '').trim() || String(e?.usage ?? '').trim() || String(e?.example ?? '').trim());
}
function slangTabStatus(tab) { return tab === 'researched' ? 'candidate' : tab; }
function slangInTab(e, tab) {
  if (e.status !== slangTabStatus(tab)) return false;
  if (tab === 'candidate') return !slangIsResearched(e);
  if (tab === 'researched') return slangIsResearched(e);
  return true;
}
function slangStatusLabel(status) {
  return { candidate: '候选', confirmed: '已确认', rejected: '已拒绝' }[status] || esc(status);
}
function slangStatusClass(status) {
  return { candidate: 'pill b', confirmed: 'pill g', rejected: 'pill r' }[status] || 'pill';
}
function slangSourceLabel(e) {
  if (e.source === 'manual') return '手动';
  if (Array.isArray(e.evidence) && e.evidence.some((ev) => ev.sender === 'AI提交')) return 'AI提交';
  return '自动提取';
}
function slangEvidenceHtml(e) {
  return Array.isArray(e.evidence) && e.evidence.length
    ? e.evidence.slice(-2).map((ev) => `<span class="meta">${esc(String(ev.sender || '未知'))}：${esc(String(ev.text || '').slice(0, 30))}</span>`).join('<br>')
    : '<span class="meta">—</span>';
}
function slangSourcesHtml(e) {
  return Array.isArray(e.sources) && e.sources.length
    ? e.sources.slice(0, 5).map((s) => `<span class="meta">🔗 ${esc(s)}</span>`).join('<br>')
    : '';
}
// 研究「未确认」时 AI 给的推测（lastGuess）：只是给管理员参考，不是含义——
// 不算「已研究」、不能凭它确认，也不会注入提示词；「采用为含义」只是填进编辑框，保存仍由管理员点。
function slangGuessHtml(e) {
  const g = e?.lastGuess;
  if (!g || !(g.meaning || g.usage || g.example)) return '';
  const when = g.at ? new Date(g.at).toLocaleString('zh-CN', { hour12: false }) : '';
  return `<span class="meta slang-guess">AI 推测（未确认${when ? '，' + esc(when) : ''}）：${esc(g.meaning || '—')}`
    + (g.usage ? '；用法：' + esc(g.usage) : '') + (g.example ? '；例：' + esc(g.example) : '') + '</span>';
}
function slangSearchFields(e) {
  return [e.content, e.meaning, e.usage, e.example, e.risk, e.lastGuess?.meaning || '', Array.isArray(e.sources) ? e.sources.join(' ') : '', Array.isArray(e.evidence) ? e.evidence.map((x) => x.text || '').join(' ') : ''].join(' ').toLowerCase();
}
function getSlangLimit() {
  const id = slangTabStatus(slangActiveTab) === 'candidate' ? 'slangLimitCand' : slangActiveTab === 'confirmed' ? 'slangLimitConfirmed' : 'slangLimitRejected';
  return Math.max(10, Number(document.getElementById(id)?.value) || 100);
}
function getSlangSearch() {
  const id = slangTabStatus(slangActiveTab) === 'candidate' ? 'slangSearchCand' : slangActiveTab === 'confirmed' ? 'slangSearchConfirmed' : 'slangSearchRejected';
  return String(document.getElementById(id)?.value || '').trim().toLowerCase();
}
function selectedIdsForStatus(status) {
  return [...slangSelected].filter((id) => slangEntriesCache.some((e) => e.id === id && e.status === status && (status !== 'candidate' || slangInTab(e, slangActiveTab))));
}
function setSlangMsg(text, ok = true) {
  const msg = document.getElementById('slangMsg');
  if (!msg) return;
  msg.textContent = text;
  msg.className = ok ? 'meta ok' : 'meta err';
}
function setSlangTab(tab) {
  slangActiveTab = tab;
  // 两个候选分栏共用一套批量按钮：切换时丢掉另一栏里看不见的勾选，批量操作只作用于当前栏
  for (const id of [...slangSelected]) {
    const e = slangEntriesCache.find((x) => x.id === id);
    if (e && e.status === 'candidate' && !slangInTab(e, tab)) slangSelected.delete(id);
  }
  const panelKey = slangTabStatus(tab);
  document.querySelectorAll('.slang-tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.slangTab === tab));
  document.querySelectorAll('.slang-panel').forEach((panel) => panel.classList.toggle('active', panel.id === 'slangPanel' + panelKey[0].toUpperCase() + panelKey.slice(1)));
  renderSlangPanel();
}
function updateSlangSelectAll(status) {
  const id = status === 'candidate' ? 'slangCandidateSelectAll' : status === 'confirmed' ? 'slangConfirmedSelectAll' : 'slangRejectedSelectAll';
  const el = document.getElementById(id);
  if (!el) return;
  const list = slangEntriesCache.filter((e) => slangInTab(e, slangActiveTab));
  const q = getSlangSearch();
  const filtered = q ? list.filter((e) => slangSearchFields(e).includes(q)) : list;
  el.checked = filtered.length > 0 && filtered.every((e) => slangSelected.has(e.id));
  el.indeterminate = filtered.some((e) => slangSelected.has(e.id)) && !el.checked;
}

function renderSlangPanel() {
  const tab = slangActiveTab;
  const status = slangTabStatus(tab);
  const pendingN = slangEntriesCache.filter((e) => slangInTab(e, 'candidate')).length;
  const researchedN = slangEntriesCache.filter((e) => slangInTab(e, 'researched')).length;
  const cp = document.getElementById('slangCountPending'); if (cp) cp.textContent = pendingN ? `(${pendingN})` : '';
  const cr = document.getElementById('slangCountResearched'); if (cr) cr.textContent = researchedN ? `(${researchedN})` : '';
  const containerId = status === 'candidate' ? 'slangCandidateList' : status === 'confirmed' ? 'slangConfirmedList' : 'slangRejectedList';
  const box = document.getElementById(containerId);
  if (!box) return;
  const list = slangEntriesCache.filter((e) => slangInTab(e, tab));
  const q = getSlangSearch();
  const filtered = q ? list.filter((e) => slangSearchFields(e).includes(q)) : list;
  if (!filtered.length) {
    box.innerHTML = '<div class="meta" style="padding:8px">' + (list.length ? '没有符合条件的词条' : (tab === 'researched' ? '暂无已研究的候选：送 DSH 深度研究、或在「编辑」里填写含义后会出现在这里' : status === 'candidate' ? '暂无待研究的候选，等 DSH 自动提取、AI 提交或手动添加' : status === 'confirmed' ? '暂无已确认黑话' : '暂无已拒绝词条')) + '</div>';
    updateSlangSelectAll(status);
    return;
  }
  const limit = getSlangLimit();
  const shown = filtered.slice(0, limit);
  let html = `<div class="meta" style="padding:6px 8px">共 ${filtered.length} 条，显示 ${shown.length} 条（可滚动查找）</div>`;
  html += '<table><tr><th>选择</th><th>词条</th><th>次数</th><th>来源</th><th>含义 / 用法 / 示例</th><th>参考来源</th><th>语境证据</th><th>操作</th></tr>';
  for (const e of shown) {
    const guessHtml = status === 'candidate' && !e.meaning ? slangGuessHtml(e) : '';
    const meaning = e.meaning ? esc(e.meaning) : (status === 'candidate'
      ? '<span class="meta">待研究</span>' + (guessHtml ? `<br>${guessHtml}<br><button class="small" data-slang-adopt="${esc(e.id)}" title="把推测填进编辑框，改好后再保存">采用为含义</button>` : '')
      : '<span class="meta">无</span>');
    const checked = slangSelected.has(e.id) ? ' checked' : '';
    const actions = [];
    if (status === 'candidate') {
      actions.push(`<button class="small" data-slang-confirm="${esc(e.id)}">确认</button>`);
      actions.push(`<button class="small" data-slang-edit="${esc(e.id)}">编辑</button>`);
      actions.push(`<button class="small" data-slang-reject="${esc(e.id)}">拒绝</button>`);
    } else if (status === 'confirmed') {
      actions.push(`<button class="small" data-slang-edit="${esc(e.id)}">编辑</button>`);
    } else {
      actions.push(`<button class="small" data-slang-restore="${esc(e.id)}">恢复候选</button>`);
    }
    actions.push(`<button class="small danger" data-slang-del="${esc(e.id)}">删</button>`);
    html += `<tr>
      <td><input type="checkbox" data-slang-select="${esc(e.id)}"${checked}></td>
      <td><b>${esc(e.content)}</b><br><span class="${slangStatusClass(status)}">${slangStatusLabel(status)}</span></td>
      <td>${esc(e.count)}</td>
      <td>${esc(slangSourceLabel(e))}</td>
      <td>${meaning}${e.usage ? '<br><span class="meta">用法：' + esc(e.usage) + '</span>' : ''}${e.example ? '<br><span class="meta">例：' + esc(e.example) + '</span>' : ''}${e.risk ? '<br><span class="meta">风险：' + esc(e.risk) + '</span>' : ''}</td>
      <td>${slangSourcesHtml(e) || '<span class="meta">—</span>'}</td>
      <td>${slangEvidenceHtml(e)}</td>
      <td class="row">${actions.join('')}</td>
    </tr>`;
  }
  box.innerHTML = html + '</table>';
  box.querySelectorAll('[data-slang-select]').forEach((cb) => cb.addEventListener('change', () => {
    const id = cb.dataset.slangSelect;
    if (cb.checked) slangSelected.add(id); else slangSelected.delete(id);
    updateSlangSelectAll(status);
  }));
  box.querySelectorAll('[data-slang-confirm]').forEach((btn) => btn.addEventListener('click', () => openSlangModal(btn.dataset.slangConfirm, 'confirm')));
  box.querySelectorAll('[data-slang-edit]').forEach((btn) => btn.addEventListener('click', () => openSlangModal(btn.dataset.slangEdit, 'edit')));
  box.querySelectorAll('[data-slang-adopt]').forEach((btn) => btn.addEventListener('click', () => openSlangModal(btn.dataset.slangAdopt, 'edit', { adoptGuess: true })));
  box.querySelectorAll('[data-slang-reject]').forEach((btn) => btn.addEventListener('click', async () => {
    const r2 = await api('/api/slang/' + btn.dataset.slangReject + '/reject', 'POST', {});
    if (!r2.ok) alert(r2.error || '拒绝失败');
    setSlangMsg(r2.ok ? '✅ 已拒绝' : ('❌ ' + (r2.error || '失败')), r2.ok);
    refreshSlang();
  }));
  box.querySelectorAll('[data-slang-restore]').forEach((btn) => btn.addEventListener('click', async () => {
    const e = slangEntriesCache.find((x) => x.id === btn.dataset.slangRestore);
    if (!e) return;
    const r2 = await api('/api/slang/' + e.id, 'PATCH', { status: 'candidate' });
    if (!r2.ok) alert(r2.error || '恢复失败');
    setSlangMsg(r2.ok ? '✅ 已恢复为候选' : ('❌ ' + (r2.error || '失败')), r2.ok);
    refreshSlang();
  }));
  box.querySelectorAll('[data-slang-del]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('确定删除该黑话？')) return;
    const r2 = await api('/api/slang/' + btn.dataset.slangDel, 'DELETE', {});
    if (!r2.ok) alert(r2.error || '删除失败');
    setSlangMsg(r2.ok ? '✅ 已删除' : ('❌ ' + (r2.error || '失败')), r2.ok);
    slangSelected.delete(btn.dataset.slangDel);
    refreshSlang();
  }));
  updateSlangSelectAll(status);
}

async function refreshSlang() {
  try {
    const r = await api('/api/slang');
    slangEntriesCache = r.entries || [];
    renderSlangPanel();
  } catch (e) {
    const box = document.getElementById('slangCandidateList');
    if (box) box.innerHTML = '<span class="meta">加载失败</span>';
  }
}

function openSlangModal(id, mode, { adoptGuess = false } = {}) {
  const e = slangEntriesCache.find((x) => x.id === id);
  if (!e) return;
  slangModalId = id;
  slangModalMode = mode;
  document.getElementById('slangModalTitle').textContent = mode === 'confirm' ? `确认黑话：${e.content}` : `编辑黑话：${e.content}`;
  document.getElementById('slangModalContent').textContent = mode === 'confirm'
    ? '你可以直接填写含义/用法并转正，也可以先送 DSH 深度联网研究，研究结果回来后在此处删改再确认。'
    : '修改后保存；候选不会转正，已确认仍保持已确认。';
  document.getElementById('slangModalMeaning').value = e.meaning || '';
  document.getElementById('slangModalUsage').value = e.usage || '';
  document.getElementById('slangModalExample').value = e.example || '';
  document.getElementById('slangModalRisk').value = e.risk || '';
  document.getElementById('slangModalSources').value = Array.isArray(e.sources) ? e.sources.join('\n') : '';
  const guessBox = document.getElementById('slangModalGuess');
  const guessHtml = !e.meaning ? slangGuessHtml(e) : '';
  guessBox.innerHTML = guessHtml ? guessHtml + '<br>' + (adoptGuess ? '已把推测填进空着的栏位：请核对、修改后再保存（推测不一定对）。' : '可以参考它填写含义。') : '';
  guessBox.style.display = guessHtml ? '' : 'none';
  if (adoptGuess && guessHtml) {
    // 只填空着的栏位，不覆盖管理员已经写的内容
    for (const [field, inputId] of [['meaning', 'slangModalMeaning'], ['usage', 'slangModalUsage'], ['example', 'slangModalExample']]) {
      const input = document.getElementById(inputId);
      if (!input.value.trim() && e.lastGuess[field]) input.value = e.lastGuess[field];
    }
  }
  document.getElementById('slangModalDirectConfirm').textContent = mode === 'confirm' ? '直接确认（转正）' : '保存修改';
  document.getElementById('slangModalSendResearch').style.display = mode === 'confirm' && e.status === 'candidate' ? '' : 'none';
  document.getElementById('slangModalOverlay').classList.add('open');
}
function closeSlangModal() {
  document.getElementById('slangModalOverlay').classList.remove('open');
  slangModalId = null;
}
function readSlangModalPayload() {
  return {
    meaning: document.getElementById('slangModalMeaning').value.trim(),
    usage: document.getElementById('slangModalUsage').value.trim(),
    example: document.getElementById('slangModalExample').value.trim(),
    risk: document.getElementById('slangModalRisk').value.trim(),
    sources: document.getElementById('slangModalSources').value.split(/\n/).map((s) => s.trim()).filter(Boolean)
  };
}

document.querySelectorAll('.slang-tab').forEach((btn) => btn.addEventListener('click', () => setSlangTab(btn.dataset.slangTab)));
document.getElementById('slangSearchCand').addEventListener('input', renderSlangPanel);
document.getElementById('slangSearchConfirmed').addEventListener('input', renderSlangPanel);
document.getElementById('slangSearchRejected').addEventListener('input', renderSlangPanel);
document.getElementById('slangLimitCand').addEventListener('change', renderSlangPanel);
document.getElementById('slangLimitConfirmed').addEventListener('change', renderSlangPanel);
document.getElementById('slangLimitRejected').addEventListener('change', renderSlangPanel);
document.getElementById('slangCandidateSelectAll').addEventListener('change', (e) => {
  const list = slangEntriesCache.filter((x) => slangInTab(x, slangActiveTab));
  const q = getSlangSearch();
  const filtered = q ? list.filter((x) => slangSearchFields(x).includes(q)) : list;
  for (const x of filtered) { if (e.target.checked) slangSelected.add(x.id); else slangSelected.delete(x.id); }
  renderSlangPanel();
});
document.getElementById('slangConfirmedSelectAll').addEventListener('change', (e) => {
  const list = slangEntriesCache.filter((x) => x.status === 'confirmed');
  const q = getSlangSearch();
  const filtered = q ? list.filter((x) => slangSearchFields(x).includes(q)) : list;
  for (const x of filtered) { if (e.target.checked) slangSelected.add(x.id); else slangSelected.delete(x.id); }
  renderSlangPanel();
});
document.getElementById('slangRejectedSelectAll').addEventListener('change', (e) => {
  const list = slangEntriesCache.filter((x) => x.status === 'rejected');
  const q = getSlangSearch();
  const filtered = q ? list.filter((x) => slangSearchFields(x).includes(q)) : list;
  for (const x of filtered) { if (e.target.checked) slangSelected.add(x.id); else slangSelected.delete(x.id); }
  renderSlangPanel();
});
document.getElementById('slangBatchResearch').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('candidate');
  if (!ids.length) { alert('请先勾选要研究的候选词'); return; }
  const r = await api('/api/slang/research', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已送 ${r.count} 条候选到 DSH 深度联网研究，完成后刷新查看结果` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) refreshSlang();
});
document.getElementById('slangBatchConfirm').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('candidate');
  if (!ids.length) { alert('请先勾选要确认的候选词'); return; }
  if (!confirm(`确定批量确认 ${ids.length} 条候选？缺少含义的会被跳过。`)) return;
  const r = await api('/api/slang/batch-confirm', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已确认 ${r.confirmedCount} 条，跳过 ${r.skippedCount} 条` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangBatchReject').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('candidate');
  if (!ids.length) { alert('请先勾选要拒绝的候选词'); return; }
  if (!confirm(`确定拒绝 ${ids.length} 条候选？`)) return;
  const r = await api('/api/slang/batch-reject', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已拒绝 ${r.rejectedCount} 条` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangBatchDeleteCand').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('candidate');
  if (!ids.length) { alert('请先勾选要删除的候选词'); return; }
  if (!confirm(`确定删除 ${ids.length} 条候选？此操作不可恢复！`)) return;
  const r = await api('/api/slang/batch-delete', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已删除 ${r.removedCount} 条候选` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangBatchDeleteConfirmed').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('confirmed');
  if (!ids.length) { alert('请先勾选要删除的已确认词条'); return; }
  if (!confirm(`确定删除 ${ids.length} 条已确认黑话？此操作不可恢复！`)) return;
  const r = await api('/api/slang/batch-delete', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已删除 ${r.removedCount} 条已确认` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangBatchDeleteRejected').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('rejected');
  if (!ids.length) { alert('请先勾选要删除的已拒绝词条'); return; }
  if (!confirm(`确定删除 ${ids.length} 条已拒绝词条？此操作不可恢复！`)) return;
  const r = await api('/api/slang/batch-delete', 'POST', { ids });
  setSlangMsg(r.ok ? `✅ 已删除 ${r.removedCount} 条已拒绝` : ('❌ ' + (r.error || '失败')), r.ok);
  if (r.ok) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangBatchRestore').addEventListener('click', async () => {
  const ids = selectedIdsForStatus('rejected');
  if (!ids.length) { alert('请先勾选要恢复的已拒绝词条'); return; }
  let okCount = 0;
  for (const id of ids) {
    const r = await api('/api/slang/' + id, 'PATCH', { status: 'candidate' });
    if (r.ok) okCount++;
  }
  setSlangMsg(`✅ 已恢复 ${okCount}/${ids.length} 条为候选`);
  if (okCount) { slangSelected.clear(); refreshSlang(); }
});
document.getElementById('slangModalDirectConfirm').addEventListener('click', async () => {
  if (!slangModalId) return;
  const payload = readSlangModalPayload();
  if (!payload.meaning) { alert('请先填写含义，确认后才会注入 AI 上下文'); return; }
  const e = slangEntriesCache.find((x) => x.id === slangModalId);
  if (!e) return;
  const path = slangModalMode === 'confirm' ? `/api/slang/${e.id}/confirm` : `/api/slang/${e.id}`;
  const r2 = await api(path, slangModalMode === 'confirm' ? 'POST' : 'PATCH', payload);
  if (!r2.ok) alert(r2.error || '保存失败');
  setSlangMsg(r2.ok ? (slangModalMode === 'confirm' ? '✅ 已确认转正' : '✅ 已保存') : ('❌ ' + (r2.error || '失败')), r2.ok);
  closeSlangModal();
  refreshSlang();
});
document.getElementById('slangModalSendResearch').addEventListener('click', async () => {
  if (!slangModalId) return;
  const r = await api('/api/slang/research', 'POST', { ids: [slangModalId] });
  setSlangMsg(r.ok ? `✅ 已送「${slangEntriesCache.find((x) => x.id === slangModalId)?.content || ''}」到 DSH 深度联网研究，稍后刷新查看结果` : ('❌ ' + (r.error || '失败')), r.ok);
  closeSlangModal();
  refreshSlang();
});
document.getElementById('slangModalCancel').addEventListener('click', closeSlangModal);
document.getElementById('slangModalOverlay').addEventListener('click', (e) => { if (e.target.id === 'slangModalOverlay') closeSlangModal(); });

document.getElementById('slangAdd').addEventListener('click', async () => {
  const content = document.getElementById('slangContent').value.trim();
  const meaning = document.getElementById('slangMeaning').value.trim();
  const usage = document.getElementById('slangUsage').value.trim();
  const example = document.getElementById('slangExample').value.trim();
  if (!content) { alert('词条不能为空'); return; }
  const r = await api('/api/slang', 'POST', { content, meaning, usage, example });
  document.getElementById('slangMsg').textContent = r.ok ? '✅ 已添加' : ('❌ ' + (r.error || '失败'));
  document.getElementById('slangMsg').className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) {
    document.getElementById('slangContent').value = '';
    document.getElementById('slangMeaning').value = '';
    document.getElementById('slangUsage').value = '';
    document.getElementById('slangExample').value = '';
    refreshSlang();
  }
});
document.getElementById('slangExtract').addEventListener('click', async () => {
  const r = await api('/api/slang/extract', 'POST', {});
  setSlangMsg(r.ok ? '✅ 已触发提取' : ('❌ ' + (r.error || '失败')), r.ok);
});
document.getElementById('slangResearch').addEventListener('click', async () => {
  const r = await api('/api/slang/research', 'POST', {});
  setSlangMsg(r.ok ? ('✅ 已触发研究 ' + r.count + ' 条') : ('❌ ' + (r.error || '失败')), r.ok);
});
function loadSlangConfig() {
  api('/api/slang').then(r => {
    const c = r.config || {};
    document.getElementById('slangEnabled').checked = c.enabled !== false;
    document.getElementById('slangExtractMin').value = c.extractMinMessages ?? 10;
    document.getElementById('slangCooldown').value = c.extractCooldownMs ?? 300000;
    document.getElementById('slangThresholds').value = (c.inferenceThresholds || [2, 4, 8]).join(', ');
    document.getElementById('slangInjectMax').value = c.injectMax ?? 8;
    document.getElementById('slangLearnerPreset').value = c.learnerPreset || 'qq-chat';
    document.getElementById('slangWorkspaceTitle').value = c.workspaceTitle || 'QQ 黑话学习';
    document.getElementById('slangAutoResearch').checked = c.autoResearch !== false;
  }).catch(() => {});
}
document.getElementById('slangConfigSave').addEventListener('click', async () => {
  const r = await api('/api/slang/config', 'POST', {
    enabled: document.getElementById('slangEnabled').checked,
    extractMinMessages: Number(document.getElementById('slangExtractMin').value) || 10,
    extractCooldownMs: Number(document.getElementById('slangCooldown').value) || 300000,
    inferenceThresholds: document.getElementById('slangThresholds').value.split(/[,，\s]+/).map(Number).filter(Boolean),
    injectMax: Number(document.getElementById('slangInjectMax').value) || 8,
    learnerPreset: document.getElementById('slangLearnerPreset').value.trim(),
    workspaceTitle: document.getElementById('slangWorkspaceTitle').value.trim(),
    autoResearch: document.getElementById('slangAutoResearch').checked
  });
  const msg = document.getElementById('slangConfigMsg');
  msg.textContent = r.ok ? '✅ 已保存' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) loadSlangConfig();
});

function loadSecurity() {
  api('/api/security').then(r => {
    document.getElementById('secInterceptNotify').checked = r.security?.interceptNotify !== false;
    // state/ 的 ACL 是否收紧（Windows 上需要管理员权限，未提权时会失败）。
    // 明确警示 + 给出可复制的命令，而不是让用户以为已经安全。
    const warn = document.getElementById('stateDirWarn');
    const hardened = r.stateDir?.hardened;
    if (hardened === false) {
      document.getElementById('stateDirPath').textContent = r.stateDir?.path || 'state/';
      document.getElementById('stateDirCmd').textContent = r.stateDir?.manualCommand || '';
      warn.style.display = '';
    } else {
      warn.style.display = 'none';
    }
  }).catch(() => {});
}
document.getElementById('secSave').addEventListener('click', async () => {
  const r = await api('/api/security', 'POST', { interceptNotify: document.getElementById('secInterceptNotify').checked });
  const msg = document.getElementById('secMsg');
  msg.textContent = r.ok ? '✅ 已保存' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) loadSecurity();
});
document.getElementById('stateDirReharden').addEventListener('click', async () => {
  const msg = document.getElementById('stateDirMsg');
  msg.textContent = '检测中…';
  const r = await api('/api/security', 'POST', { rehardenStateDir: true });
  msg.textContent = r.hardened === true ? '✅ 权限已收紧' : '❌ 仍未收紧（改 ACL 需要管理员权限；请按上面两种做法之一操作后复检）';
  msg.className = r.hardened === true ? 'meta ok' : 'meta err';
  loadSecurity();
});

async function changeConsoleToken(generate) {
  const input = document.getElementById('consoleTokenInput');
  const msg = document.getElementById('consoleTokenMsg');
  const token = generate ? '' : input.value.trim();
  if (!generate && token && token.length < 16) {
    msg.textContent = '❌ 令牌至少需要 16 位';
    msg.className = 'meta err';
    return;
  }
  const r = await api('/api/console/token', 'POST', { token });
  if (!r.ok) {
    msg.textContent = '❌ ' + (r.error || '修改失败');
    msg.className = 'meta err';
    return;
  }
  // 保存到 localStorage，当前页面继续使用新令牌
  localStorage.setItem('consoleToken', r.token);
  input.value = r.token;
  msg.textContent = r.generated ? '已生成随机令牌，当前页面已自动使用。可点击显示后复制。' : '已保存新令牌';
  msg.className = 'meta ok';
}
document.getElementById('consoleTokenSave').addEventListener('click', () => changeConsoleToken(false));
document.getElementById('consoleTokenRandom').addEventListener('click', () => changeConsoleToken(true));

// 页面被切进来时要做什么：路由器只负责切页，具体刷新由各页面在这里注册。
onPageRefresh('social-v2', () => { if (typeof loadVoiceLibrary === 'function') loadVoiceLibrary(); });
onPageRefresh('persona', () => {
  // 每次进入都重读一次：全局人格可能在别处改过、新会话可能刚建好。
  refreshRoleAssignments().catch(() => {});
  refreshPersonaSources().catch(() => {});
});
onPageRefresh('behaviors', () => refreshBehaviors().catch(() => {}));
// 直接打开 #scheduler 时路由器可能先于定时任务那段脚本执行：推到下一个宏任务再刷新。
onPageRefresh('scheduler', () => setTimeout(() => refreshScheduler(), 0));
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
  await Promise.allSettled([refresh(), refreshSessions(), refreshPending(), refreshSocialStatus(), refreshV2Activity()]);
  this.disabled = false;
  if (document.getElementById('connectionAlert').hidden) showConsoleToast('运行状态已刷新');
});

// Attach real accessible names to the original form controls, including paired min/max inputs.
document.querySelectorAll('input,select,textarea').forEach(input => {
  if (input.labels?.length || input.hasAttribute('aria-label')) return;
  let label = input.previousElementSibling;
  while (label && label.tagName !== 'LABEL') label = label.previousElementSibling;
  if (label) {
    const siblings = [];
    let next = label.nextElementSibling;
    while (next && next.tagName !== 'LABEL') {
      if (next.matches('input,select,textarea')) siblings.push(next);
      next = next.nextElementSibling;
    }
    input.setAttribute('aria-label', label.textContent.trim() + (siblings.length > 1 ? (siblings.indexOf(input) === 0 ? '（下限）' : '（上限）') : ''));
  } else {
    const names = { consoleTokenInput: '新的控制台访问令牌', closedPreset: '封闭 Agent 使用的 DSH 预设', tsKind: '测试消息目标类型', aiNotifyKind: '后台提醒目标类型', sStateKey: '一代仿真会话', v2SessionSelect: '二代仿真白名单会话', slangLimitCand: '候选词显示数量', slangLimitConfirmed: '已确认词显示数量', slangLimitRejected: '已拒绝词显示数量' };
    input.setAttribute('aria-label', names[input.id] || input.placeholder || input.closest('section')?.querySelector('h2')?.textContent || '设置');
  }
});
const primaryActions = ['roleSet','roleCreate','socialSave','v2ConfigSave','v2ConfigSaveTop','wlSave','secSave','consoleTokenSave','tsSend','aiNotifySend','slangAdd','slangConfigSave','slangModalDirectConfirm'];
primaryActions.forEach(id => document.getElementById(id)?.classList.add('primary'));
document.querySelectorAll('.meta[id$="Msg"], .meta[id$="Msg2"]').forEach(el => el.setAttribute('role','status'));
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
const featureIndex = [];
document.querySelectorAll('section[data-page]').forEach(section => {
  const page = section.dataset.page;
  featureIndex.push({ page, label: section.querySelector('h2').textContent, target: section });
  section.querySelectorAll('details.settings-group>summary,input,textarea,select').forEach(el => {
    let label = el.tagName === 'SUMMARY' ? el.textContent : (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.placeholder);
    if (label) featureIndex.push({ page, label: label.trim(), target: el });
  });
});
function closeConsoleSearch() { searchResults.hidden = true; searchInput.setAttribute('aria-expanded','false'); }
setSearchCloser(closeConsoleSearch);
searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim().toLowerCase();
  searchResults.replaceChildren();
  if (!query) return closeConsoleSearch();
  const matches = featureIndex.filter(entry => (consolePages[entry.page][0] + entry.label + entry.target.id).toLowerCase().includes(query)).slice(0,12);
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
      if (entry.target.closest('.slang-panel')) {
        const panels = { slangPanelCandidate: 'candidate', slangPanelConfirmed: 'confirmed', slangPanelRejected: 'rejected' };
        setSlangTab(panels[entry.target.closest('.slang-panel').id]);
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

// Keyboard support for the existing editor dialog without replacing its save flow.
let modalPreviousFocus;
const slangOverlay = document.getElementById('slangModalOverlay');
new MutationObserver(() => {
  if (slangOverlay.classList.contains('open')) {
    modalPreviousFocus = document.activeElement;
    document.getElementById('slangModalMeaning').focus();
  } else modalPreviousFocus?.focus();
}).observe(slangOverlay, { attributes:true, attributeFilter:['class'] });
slangOverlay.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeSlangModal(); }
  if (event.key === 'Tab') {
    const controls = [...slangOverlay.querySelectorAll('button,input,textarea,select')].filter(el => !el.disabled && el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
const tokenToggle = document.createElement('button');
tokenToggle.id = 'consoleTokenToggle'; tokenToggle.className = 'small'; tokenToggle.textContent = '显示令牌'; tokenToggle.type = 'button'; tokenToggle.setAttribute('aria-pressed','false');
tokenToggle.addEventListener('click', () => {
  const input = document.getElementById('consoleTokenInput');
  const visible = input.type === 'password';
  input.type = visible ? 'text' : 'password';
  tokenToggle.textContent = visible ? '隐藏令牌' : '显示令牌';
  tokenToggle.setAttribute('aria-pressed',String(visible));
});
document.getElementById('consoleTokenInput').after(tokenToggle);
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


// ── 定时任务 ────────────────────────────────────────────────────────────────
// 规则的计算、限额、到点执行都在桥接（src/scheduler/）；这里只负责编辑和展示。
const SCHED_LIMIT_FIELDS = [
  ['maxTasks', '同时任务上限', '个'], ['perTaskPerDay', '单任务每天最多', '次'], ['totalPerDay', '全部每天最多', '条'],
  ['perGroupPerDay', '每个群每天最多', '条'], ['maxTargets', '单任务最多对象', '个'], ['minIntervalMin', '两次最小间隔', '分钟'],
  ['missedGraceMin', '错过多久内补发', '分钟'], ['jitterMin', '固定时间随机偏移', '± 分钟'], ['maxTextChars', '文字最长', '字'], ['maxInstructionChars', 'AI 说明最长', '字'],
];
const SCHED_WEEK = ['', '一', '二', '三', '四', '五', '六', '日'];
const SCHED_STATUS = { sent: ['已发送', 'pill g'], partial: ['部分发送', 'pill b'], skipped: ['已跳过', 'pill b'], failed: ['失败', 'pill r'], missed: ['错过', 'pill'], finished: ['已结束', 'pill'], invalid: ['规则无效', 'pill r'] };
// 时区下拉：浏览器认得的全部时区，每项后面带当前的 UTC 偏移（有夏令时的地区会随季节变）；常用的放最前。
const SCHED_TZ_COMMON = [
  ['Asia/Shanghai', '北京时间'], ['Asia/Hong_Kong', '香港'], ['Asia/Taipei', '台北'], ['Asia/Singapore', '新加坡'], ['Asia/Tokyo', '东京'], ['Asia/Seoul', '首尔'],
  ['Asia/Kolkata', '印度'], ['Europe/London', '伦敦'], ['Europe/Paris', '巴黎'], ['Europe/Berlin', '柏林'], ['Europe/Moscow', '莫斯科'],
  ['America/New_York', '美东'], ['America/Chicago', '美中'], ['America/Denver', '美山地'], ['America/Los_Angeles', '美西'], ['Australia/Sydney', '悉尼'], ['UTC', '协调世界时'],
];
function schedTzOffset(tz) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || '';
    return name === 'GMT' || name === 'UTC' ? 'UTC+0' : name.replace(/^GMT/, 'UTC');
  } catch { return ''; }
}
function schedTzMinutes(label) {
  const m = /^UTC([+-])(\d+)(?::(\d+))?$/.exec(label);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
}
function schedTzOptionsHtml(withFollow) {
  const all = (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : SCHED_TZ_COMMON.map(([z]) => z));
  const common = new Set(SCHED_TZ_COMMON.map(([z]) => z));
  const opt = (z, extra = '') => { const off = schedTzOffset(z); return `<option value="${esc(z)}">${esc(z)}（${esc(off)}${extra ? '，' + esc(extra) : ''}）</option>`; };
  const rest = all.filter((z) => !common.has(z)).map((z) => [z, schedTzOffset(z)]).sort((a, b) => schedTzMinutes(a[1]) - schedTzMinutes(b[1]) || a[0].localeCompare(b[0]));
  return (withFollow ? '<option value="">跟随默认时区</option>' : '')
    + `<optgroup label="常用">${SCHED_TZ_COMMON.map(([z, n]) => opt(z, n)).join('')}</optgroup>`
    + `<optgroup label="全部时区（按 UTC 偏移排序）">${rest.map(([z]) => opt(z)).join('')}</optgroup>`;
}
function schedSetTz(select, tz) {
  if (tz && ![...select.options].some((o) => o.value === tz)) select.insertAdjacentHTML('afterbegin', `<option value="${esc(tz)}">${esc(tz)}（${esc(schedTzOffset(tz))}）</option>`);
  select.value = tz || '';
}
// 这里还在 schedEl 定义之前，直接用 getElementById
document.getElementById('schedTimezone').innerHTML = schedTzOptionsHtml(false);
document.getElementById('schedTaskTz').innerHTML = schedTzOptionsHtml(true);

let schedState = null;
let schedEditingId = null;
let schedPreviewTimer = null;
const schedEl = (id) => document.getElementById(id);
const schedSplit = (v) => String(v ?? '').split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);
function schedMsg(id, text, ok) { const el = schedEl(id); el.textContent = text; el.className = ok == null ? 'meta' : (ok ? 'meta ok' : 'meta err'); }

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
  schedEl('schedEnabled').checked = !!st.enabled;
  schedEl('schedAllowAiPrivate').checked = !!st.allowAiPrivate;
  schedEl('schedAllowAiGroup').checked = !!st.allowAiGroup;
  if (document.activeElement !== schedEl('schedTimezone')) schedSetTz(schedEl('schedTimezone'), st.timezone);
  const pill = schedEl('schedStatePill');
  pill.textContent = st.enabled ? (r.writable === false ? '只读（数据文件读取失败）' : '运行中') : '已关闭';
  pill.className = st.enabled && r.writable !== false ? 'pill g' : 'pill r';
  schedEl('schedLimits').innerHTML = SCHED_LIMIT_FIELDS.map(([k, label, unit]) => `<div><label for="schedLim_${k}">${esc(label)}（${esc(unit)}）</label><input type="number" id="schedLim_${k}" min="0" value="${esc(st.limits[k])}" title="默认 ${esc(r.defaults?.limits?.[k] ?? '')}"></div>`).join('');
  schedEl('schedQuietEnabled').checked = !!st.limits.quietEnabled;
  schedEl('schedQuietStart').value = st.limits.quietStart;
  schedEl('schedQuietEnd').value = st.limits.quietEnd;
  schedEl('schedCount').textContent = `${r.tasks.length} / ${st.limits.maxTasks}`;
  renderSchedPluginKinds();
  const targetLabel = (k) => (r.targets.find((t) => t.key === k)?.label) || k;
  schedEl('schedList').innerHTML = r.tasks.length ? `<table class="sched-table"><tr><th>启用</th><th>任务</th><th>时间</th><th>发给</th><th>上次</th><th>操作</th></tr>${r.tasks.map((t) => {
    const badges = [t.kindLabel ? `<span class="pill b">${esc(t.kindLabel)}</span>` : (t.kind === 'ai' ? '<span class="pill b">AI 来说</span>' : '<span class="pill">固定文字</span>'),
      `<span class="pill">来源：${esc({ console: '控制台', 'owner-command': '管理员命令', 'owner-chat-ai': '私聊 AI' }[t.createdBy] || t.createdBy)}</span>`,
      t.pendingConfirm ? '<span class="pill r">待你确认</span>' : ''].join(' ');
    const last = t.lastResult ? `<span class="${(SCHED_STATUS[t.lastResult] || ['', 'pill'])[1]}">${esc((SCHED_STATUS[t.lastResult] || [t.lastResult])[0])}</span>${t.lastReason ? `<div class="meta" style="margin:2px 0 0">${esc(t.lastReason)}</div>` : ''}` : '<span class="meta">—</span>';
    return `<tr>
      <td><input type="checkbox" data-sched-toggle="${t.id}" ${t.enabled ? 'checked' : ''} aria-label="启用 #${t.id}"></td>
      <td><b>#${t.id} ${esc(t.name)}</b><div style="margin-top:4px">${badges}</div><div class="meta" style="margin:4px 0 0">${esc(t.kind === 'ai' ? t.instruction : (t.kind === 'text' ? t.text : JSON.stringify(t.payload ?? {})))}</div></td>
      <td>${esc(t.scheduleText)}<div class="meta" style="margin:2px 0 0">${t.nextRunText ? '下次：' + esc(t.nextRunText) : '没有下一次'}${t.maxRuns ? `；已执行 ${t.runs} / ${t.maxRuns}` : ''}</div></td>
      <td>${t.targets.map((k) => `<span class="sched-chip" style="cursor:default">${esc(targetLabel(k))}</span>`).join('')}</td>
      <td>${last}</td>
      <td class="row"><button class="small" data-sched-run="${t.id}" title="立即执行一次（计入今天的限额）">试发</button><button class="small" data-sched-edit="${t.id}">编辑</button><button class="small danger" data-sched-del="${t.id}">删</button></td>
    </tr>`;
  }).join('')}</table>` : '<div class="meta">还没有定时任务。点「＋ 新建任务」，或者在管理员私聊里发 /remind 看用法。</div>';
  schedEl('schedHistory').innerHTML = r.history.length ? r.history.map((h) => {
    const [label, cls] = SCHED_STATUS[h.status] || [h.status, 'pill'];
    return `<div><span class="${cls}">${esc(label)}</span> ${esc(new Date(h.at).toLocaleString('zh-CN', { hour12: false, timeZone: st.timezone }))} #${esc(h.taskId)} ${esc(h.name || '')}${h.target ? ' → ' + esc(targetLabel(h.target)) : ''}${h.manual ? '（试发）' : ''}${h.reason ? '：' + esc(h.reason) : ''}</div>`;
  }).join('') + `<div>（时间按 ${esc(st.timezone === 'Asia/Shanghai' ? '北京时间' : st.timezone)} 显示）</div>` : '<div>暂无</div>';
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
  const timesRow = `<div class="row"><span class="meta" style="margin:0">时间</span><input type="text" id="sf_times" value="${v(times)}" placeholder="06:00, 22:00" style="flex:1 1 200px"></div>`;
  const windowRow = (w) => `<div class="row"><span class="meta" style="margin:0">时间段</span><input type="time" id="sf_w0" value="${v((w || [])[0], '09:00')}"> 到 <input type="time" id="sf_w1" value="${v((w || [])[1], '22:00')}"></div>`;
  switch (type) {
    case 'once': return `<div class="row"><span class="meta" style="margin:0">日期和时间</span><input type="date" id="sf_date" value="${v(s.date)}"><input type="time" id="sf_time" value="${v(s.time, '09:00')}"></div>`;
    case 'daily': case 'workdays': return timesRow;
    case 'weekly': return `<div class="row">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label class="sched-chip" style="margin:0"><input type="checkbox" data-sf-wd="${d}" ${(s.weekdays || [1]).includes(d) ? 'checked' : ''}> 周${SCHED_WEEK[d]}</label>`).join('')}</div>${timesRow}`;
    case 'monthly': return `<div class="row"><span class="meta" style="margin:0">几号</span><input type="text" id="sf_days" value="${v((s.days || [1]).join(', '))}" placeholder="1, 15, -1（-1 = 最后一天）" style="flex:1 1 200px"></div>${timesRow}`;
    case 'monthlyWeekday': return `<div class="row"><span class="meta" style="margin:0">每月</span><select id="sf_nth">${[[1, '第 1 个'], [2, '第 2 个'], [3, '第 3 个'], [4, '第 4 个'], [5, '第 5 个'], [-1, '最后一个']].map(([n, l]) => `<option value="${n}" ${Number(s.nth ?? 1) === n ? 'selected' : ''}>${l}</option>`).join('')}</select><select id="sf_weekday">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<option value="${d}" ${Number(s.weekday ?? 6) === d ? 'selected' : ''}>周${SCHED_WEEK[d]}</option>`).join('')}</select></div>${timesRow}`;
    case 'yearly': return `<div class="row"><span class="meta" style="margin:0">日期</span><input type="text" id="sf_dates" value="${v((s.dates || ['01-01']).join(', '))}" placeholder="10-21, 12-25（MM-DD）" style="flex:1 1 200px"></div>${timesRow}`;
    case 'dates': return `<div class="meta">每行一条：YYYY-MM-DD HH:mm</div><textarea id="sf_items" rows="3" style="width:100%">${v((s.items || []).map((x) => `${x.date} ${x.time}`).join('\n'))}</textarea>`;
    case 'everyNDays': return `<div class="row"><span class="meta" style="margin:0">从</span><input type="date" id="sf_start" value="${v(s.startDate)}"><span class="meta" style="margin:0">起，每</span><input type="number" id="sf_every" min="2" value="${v(s.every, 3)}" style="flex:0 1 80px"><span class="meta" style="margin:0">天</span></div>${timesRow}`;
    case 'interval': return `<div class="row"><span class="meta" style="margin:0">每</span><input type="number" id="sf_everyMin" min="10" value="${v(s.everyMinutes, 240)}" style="flex:0 1 90px"><span class="meta" style="margin:0">分钟</span></div>${windowRow(s.window || ['08:00', '23:00'])}`;
    case 'dailyRandom': return `<div class="row"><span class="meta" style="margin:0">每天</span><input type="number" id="sf_count" min="1" value="${v(s.count, 3)}" style="flex:0 1 80px"><span class="meta" style="margin:0">次，至少隔</span><input type="number" id="sf_gap" min="0" value="${v(s.minGapMin, 60)}" style="flex:0 1 80px"><span class="meta" style="margin:0">分钟</span></div>${windowRow(s.window)}`;
    case 'cron': return `<div class="row"><span class="meta" style="margin:0">表达式</span><input type="text" id="sf_cron" value="${v(s.expr, '0 9 * * 1-5')}" placeholder="0 9 * * 1-5" style="flex:1 1 220px;font-family:var(--mono, monospace)"></div>
      <div class="meta">5 段：分 时 日 月 周（周 0 和 7 都是周日，也可以写 MON-FRI）。例子：<code>0 9 * * 1-5</code> 工作日 9:00；<code>30 8 1 * *</code> 每月 1 号 8:30；<code>0 10,15 * * 6,0</code> 周末 10:00 和 15:00；<code>*/30 9-18 * * *</code> 9～18 点每半小时。日和周都限定时按「任一满足」。下面会实时显示接下来几次，写错会直接提示。cron 只能在控制台设置，AI 不能用。</div>`;
    case 'monthlyRandom': return `<div class="row"><span class="meta" style="margin:0">每月</span><input type="number" id="sf_mcount" min="1" value="${v(s.count, 4)}" style="flex:0 1 80px"><span class="meta" style="margin:0">次，限</span><input type="number" id="sf_d0" min="1" max="31" value="${v((s.dayRange || [])[0], 1)}" style="flex:0 1 70px"><span class="meta" style="margin:0">～</span><input type="number" id="sf_d1" min="1" max="31" value="${v((s.dayRange || [])[1], 28)}" style="flex:0 1 70px"><span class="meta" style="margin:0">号</span></div>${windowRow(s.window)}`;
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
  schedEl('schedPayloadJson').style.display = custom ? '' : 'none';
  schedEl('schedContent').style.display = custom ? 'none' : '';
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
  row.style.display = kinds.length ? '' : 'none';
  const current = select.value;
  select.innerHTML = `<option value="">— 用上面的固定文字 / AI —</option>${kinds.map((k) => `<option value="${esc(k.id)}">${esc(k.label)}${k.pluginId ? `（${esc(k.pluginId)}）` : ''}</option>`).join('')}`;
  if (kinds.some((k) => k.id === current)) select.value = current;
}

function renderSchedTargets(selected) {
  const r = schedState;
  schedEl('schedTargets').innerHTML = (r?.targets || []).map((t) => `<label class="sched-chip ${selected.includes(t.key) ? 'on' : ''}" style="margin:2px 4px 2px 0"><input type="checkbox" data-sched-target="${esc(t.key)}" ${selected.includes(t.key) ? 'checked' : ''}> ${esc(t.label)}</label>`).join('')
    || '<span class="meta">没有可选的发送对象（白名单为空，且没配 ownerQQ）</span>';
  schedEl('schedTargets').querySelectorAll('[data-sched-target]').forEach((c) => c.addEventListener('change', () => c.parentElement.classList.toggle('on', c.checked)));
}

function openSchedEditor(task = null) {
  schedEditingId = task ? task.id : null;
  schedEl('schedEditor').hidden = false;
  schedEl('schedEditorTitle').textContent = task ? `编辑任务 #${task.id}` : '新建任务';
  const s = task?.schedule || { type: 'daily', times: ['09:00'] };
  schedEl('schedName').value = task?.name || '';
  schedSetTz(schedEl('schedTaskTz'), task?.timezone || '');
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
    enabled: schedEl('schedEnabled').checked,
    timezone: schedEl('schedTimezone').value || 'Asia/Shanghai',
    allowAiPrivate: schedEl('schedAllowAiPrivate').checked,
    allowAiGroup: schedEl('schedAllowAiGroup').checked,
  });
  schedMsg('schedSettingsMsg', r.ok ? '✅ 已保存' : '❌ ' + (r.error || '保存失败'), r.ok);
  if (r.ok) refreshScheduler();
});
schedEl('schedLimitsSave').addEventListener('click', async () => {
  const limits = {};
  for (const [k] of SCHED_LIMIT_FIELDS) { const v = schedEl('schedLim_' + k).value; if (v !== '') limits[k] = Number(v); }
  limits.quietEnabled = schedEl('schedQuietEnabled').checked;
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

// ── 定时静默（运行总览 → 静默开关） ─────────────────────────────────────────
// 判断、执行都在桥接（src/silence-schedule.js）；这里只负责编辑和展示。
const SILENCE_W = ['', '一', '二', '三', '四', '五', '六', '日'];
let silenceState = null;
let silenceDraft = [];
document.getElementById('silenceTz').innerHTML = schedTzOptionsHtml(false);
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
  schedSetTz(silEl('silenceTz'), r.config.timezone);
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
  if (silEl('silenceTz').value !== 'Asia/Shanghai') schedSetTz(silEl('silenceTz'), 'Asia/Shanghai');
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
  if (r.ok !== false && typeof loadV2Config === 'function') loadV2Config(); // 二代仿真页「发送限制」里的同一组数字跟着刷新
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
setInterval(() => { if (getCurrentPage() === 'behaviors' && !document.hidden) refreshBehaviors().catch(() => {}); }, 30_000);
document.getElementById('personaSourceRefresh')?.addEventListener('click', () => refreshPersonaSources().catch(() => {}));

// 「扩展」下的三个只读页：技能 / MCP / 管理行为。数据都来自只读接口，页面不做任何写操作。
const BEHAVIOR_PERMISSION_LABEL = { all: '所有人', admin: 'admin', owner: 'owner' };
const BEHAVIOR_SCOPE_LABEL = { all: '全部会话', group: '仅群聊', private: '仅私聊' };

function behaviorGroupName(entry) {
  if (entry.group) return entry.group;
  return entry.source === 'plugin' ? `插件 ${entry.pluginId || '未命名'}` : '其他';
}

// 命令按 group 聚成指令组；组行可折叠，子行缩进——层级完全由注册时的 group 派生，不手工维护。
function behaviorTable(rows) {
  const groups = new Map();
  for (const entry of rows) {
    const name = behaviorGroupName(entry);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(entry);
  }
  const head = '<thead><tr><th style="width:200px">指令</th><th style="width:92px">类型</th>'
    + '<th style="width:118px">所属</th><th>描述</th><th style="width:84px">权限</th>'
    + '<th style="width:84px">状态</th><th style="width:70px">操作</th></tr></thead>';
  const body = [...groups.entries()].map(([name, items], index) => {
    const open = index === 0;
    const groupRow = `<tr class="group-row${open ? ' open' : ''}" data-group="${esc(name)}">`
      + `<td colspan="7"><span class="caret">▸</span> ${esc(name)} <span class="meta">${items.length} 条</span></td></tr>`;
    const childRows = items.map((entry) => {
      const migrated = entry.migrated ? '<span class="pill b">注册表</span>' : '<span class="pill">旧链</span>';
      const source = entry.source === 'plugin' ? `插件 ${entry.pluginId || ''}` : '内置';
      const status = entry.source === 'plugin' ? '<span class="pill">随插件</span>' : '<span class="pill g">常开</span>';
      const action = entry.source === 'plugin'
        ? `<button class="small" data-plugin-action="detail" data-plugin-id="${esc(entry.pluginId || '')}">详情</button>`
        : '<span class="meta">—</span>';
      const aliases = (entry.aliases || []).length ? ` <span class="meta">别名 ${esc(entry.aliases.join('、'))}</span>` : '';
      return `<tr class="group-child${open ? '' : ' hidden'}" data-group="${esc(name)}">`
        + `<td><code>${esc(entry.name)}</code>${aliases}</td>`
        + `<td>${migrated}</td><td>${esc(source)}</td>`
        + `<td>${esc(entry.help || '（没有说明）')} <span class="meta">· ${esc(BEHAVIOR_SCOPE_LABEL[entry.scope] || entry.scope || '')}</span></td>`
        + `<td>${esc(BEHAVIOR_PERMISSION_LABEL[entry.permission] || entry.permission)}</td>`
        + `<td>${status}</td><td>${action}</td></tr>`;
    }).join('');
    return groupRow + childRows;
  }).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

async function refreshBehaviors() {
  const meta = document.getElementById('behaviorsMeta');
  const bridgeBox = document.getElementById('behaviorsBridge');
  const empty = document.getElementById('behaviorsEmpty');
  const dshBox = document.getElementById('behaviorsDsh');
  const toolsBox = document.getElementById('behaviorsTools');
  if (!meta || !bridgeBox) return;
  try {
    const data = await api('/api/commands');
    const filter = document.getElementById('behaviorsFilter').value;
    const permission = document.getElementById('behaviorsPermission').value;
    const keyword = (document.getElementById('behaviorsSearch').value || '').trim().toLowerCase();
    const all = [...(data.bridge?.builtin ?? []), ...(data.bridge?.plugin ?? [])];
    const rows = all.filter((entry) => {
      if (filter !== 'all' && entry.source !== filter) return false;
      if (permission && entry.permission !== permission) return false;
      if (!keyword) return true;
      return [entry.name, entry.help, ...(entry.aliases ?? [])].join(' ').toLowerCase().includes(keyword);
    });
    meta.textContent = `注册表 ${data.bridge?.builtin?.length ?? 0} 条内置 + ${data.bridge?.plugin?.length ?? 0} 条插件；显示 ${rows.length} 条`;
    bridgeBox.hidden = rows.length === 0;
    empty.hidden = rows.length !== 0;
    empty.textContent = '没有匹配的命令，换个筛选或关键词试试。';
    bridgeBox.innerHTML = rows.length ? behaviorTable(rows) : '';
    dshBox.innerHTML = (data.dsh ?? []).length
      ? simpleTable([{ label: '命令', width: '200px' }, { label: '说明' }], (data.dsh ?? []).map((item) => [`<code>${esc(item.name)}</code>`, esc(item.note || '')]))
      : '<div class="meta">桥接没有记录到会调用的 DSH 命令。</div>';
    toolsBox.innerHTML = (data.tools ?? []).length
      ? simpleTable([{ label: '工具', width: '220px' }, { label: '来源', width: '260px' }, { label: '管理方式' }],
        (data.tools ?? []).map((item) => [`<code>${esc(item.name)}</code>`, esc(item.source), esc(item.managed)]))
      : '<div class="meta">没有已登记的 Agent 工具。</div>';
  } catch (error) {
    meta.textContent = '';
    bridgeBox.hidden = true;
    bridgeBox.innerHTML = '';
    empty.hidden = false;
    empty.textContent = `读取失败：${error?.message || '未知错误'}`;
  }
}
document.getElementById('behaviorsRefresh')?.addEventListener('click', () => refreshBehaviors().catch(() => {}));
document.getElementById('behaviorsFilter')?.addEventListener('change', () => refreshBehaviors().catch(() => {}));
document.getElementById('behaviorsPermission')?.addEventListener('change', () => refreshBehaviors().catch(() => {}));
let behaviorsSearchTimer = null;
document.getElementById('behaviorsSearch')?.addEventListener('input', () => {
  clearTimeout(behaviorsSearchTimer);
  behaviorsSearchTimer = setTimeout(() => refreshBehaviors().catch(() => {}), 180);
});
document.getElementById('behaviorsBridge')?.addEventListener('click', (event) => {
  const row = event.target.closest?.('tr.group-row');
  if (!row) return;
  row.classList.toggle('open');
  const name = row.dataset.group;
  document.querySelectorAll(`#behaviorsBridge tr.group-child[data-group="${CSS.escape(name)}"]`)
    .forEach((child) => child.classList.toggle('hidden'));
});
refresh(); refreshRoles(); refreshWhitelist(); refreshSessions(); refreshPending(); refreshPresets(); loadSocialForm(); loadV2Config(); refreshV2Activity(); loadV2ToolLog(); loadV2SessionOptions(); refreshSocialStatus(); refreshSlang(); loadSlangConfig(); loadSecurity(); refreshSimPrompt(); refreshDshModel(); refreshSilence(); refreshUsage(); refreshUsageChart(); refreshUsageRecent();
setInterval(() => { refresh(); refreshSessions(); refreshPending(); refreshSocialStatus(); refreshSlang(); }, 3000);
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
initSkillsPage();
initMcpPage();
// 所有页面模块就绪后再接管路由（首屏恢复也在这里）。
initRouter();
