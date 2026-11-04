// 人格与角色页：人格增删改、按会话设置、人格来源、默认人格恢复与仿真提示词。
// 结构照搬迁移前 index.html 的 #section-persona；公共辅助函数都从 ../../js/ 走。
import { api } from '../../js/api.js';
import { esc } from '../../js/ui.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';

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
    row.innerHTML = `<span class="u-flex-none"><b>${esc(d.name)}</b>${d.name === r.current ? '（当前启用）' : ''}</span><span class="pill ${!d.exists ? 'r' : (d.modified ? 'b' : 'g')}">${state}</span>`;
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

async function refreshPersonaStatus() {
  try {
    const s = await api('/api/status');
    document.getElementById('roleText').textContent = s.role || '无';
    document.getElementById('roleModeText').textContent = s.roleMode === 'silent' ? '静默' : '正常';
  } catch {}
}

// 人格快捷选择：只按「开头」匹配、不区分大小写；空输入列出全部。手动输入新名字仍然可以。
function filterRoleSuggestions(names, query) {
  const q = String(query ?? '').trim().toLowerCase();
  return names.filter((name) => String(name).toLowerCase().startsWith(q));
}
function setupRoleSuggest() {
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
}
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

export function init() {
  setupRoleSuggest();

  document.getElementById('roleSet').addEventListener('click', async () => {
    const r = await api('/api/role', 'POST', { role: document.getElementById('roleInput').value.trim(), apply: roleApplyMode() });
    if (r.ok) { showRoleApplyResult(r); refreshRoles(); refreshPersonaStatus(); } else alert(r.error || '设置失败');
  });
  document.getElementById('roleAssignAdd').addEventListener('click', async () => {
    const input = document.getElementById('roleAssignKey');
    const key = input.value.trim();
    if (!key) { input.focus(); return; }
    if (await saveRoleAssign(key, document.getElementById('roleAssignNewUse').value)) input.value = '';
  });
  document.getElementById('roleClear').addEventListener('click', async () => { const r = await api('/api/role', 'POST', { role: null, apply: roleApplyMode() }); showRoleApplyResult(r); refreshRoles(); refreshPersonaStatus(); });
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
    refreshPersonaStatus();
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
    refreshPersonaStatus();
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

  document.getElementById('personaSourceRefresh').addEventListener('click', () => refreshPersonaSources().catch(() => {}));

  // 停在人格页时，每 15 秒同步一次「按会话设置人格」和「人格来源」。
  setInterval(() => { if (getCurrentPage() === 'persona' && !document.hidden) refreshRoleAssignments().catch(() => {}); }, 15_000);
  setInterval(() => { if (getCurrentPage() === 'persona' && !document.hidden) refreshPersonaSources().catch(() => {}); }, 15_000);

  onPageRefresh('persona', () => {
    // 每次进入都重读一次：全局人格可能在别处改过、新会话可能刚建好。
    refreshPersonaStatus();
    refreshRoleAssignments().catch(() => {});
    refreshPersonaSources().catch(() => {});
  });
  // 首次进入时片段刚注入，延后一拍再拉数据，避免在 DOM 就绪前空转。
  setTimeout(() => {
    refreshPersonaStatus();
    refreshRoles();
    refreshRoleAssignments().catch(() => {});
    refreshPersonaSources().catch(() => {});
    refreshSimPrompt();
  }, 0);
}
