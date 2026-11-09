// 人格与角色页：人格增删改、按会话设置、人格来源、默认人格恢复与仿真提示词。
// 结构照搬迁移前 index.html 的 #section-persona；公共辅助函数都从 ../../js/ 走。
import { api } from '../../js/api.js';
import { esc } from '../../js/ui.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { setMsg } from '../../components/message/message.js';
import { renderFields } from '../../components/form/form.js';
import { closeModal, modalHtml, openModal, wireModal } from '../../components/modal/modal.js';
import { PERSONA_FIELDS } from './fields.js';

/** 把 fields.js 的规格渲染进每个 `<div data-persona-fields="…">`。init() 里第一件事。 */
function renderPersonaFieldGroups() {
  document.querySelectorAll('[data-persona-fields]').forEach((host) => {
    const spec = PERSONA_FIELDS[host.dataset.personaFields];
    if (!spec) return;
    renderFields(host, spec.fields, { columns: Number(host.dataset.personaColumns) || 2 });
  });
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

// 列表状态：默认人格、会话分配、搜索与筛选。恢复初始已并进每一行，不再单独一组。
let roleDefaults = [];
let roleAssignments = {};
let roleCurrent = null;
let roleQuery = '';
let roleFilter = 'all';

async function refreshRoleDefaultsState() {
  try {
    const r = await api('/api/roles/defaults');
    roleDefaults = r.ok ? (r.defaults || []) : [];
  } catch { roleDefaults = []; }
}

async function restoreRoleDefault(name) {
  const d = roleDefaults.find((x) => x.name === name) || { name, exists: true, modified: true };
  if (d.exists && !confirm(`把「${d.name}」恢复成原版？你改过的那份会先备份到 state/role-backups/。`)) return;
  const apply = (document.querySelector('input[name="roleSaveApply"]:checked') || {}).value || 'nextWake';
  const x = await api('/api/roles/restore-default', 'POST', { name: d.name, apply });
  if (!x.ok) { setRoleMsg('❌ ' + (x.error || '恢复失败'), false); return; }
  setRoleMsg(x.unchanged ? `「${d.name}」本来就是原版`
    : `✅ 已恢复「${d.name}」` + (x.backup ? `（改过的那份备份为 state/role-backups/${x.backup}）` : '（原来被删了，已重新放回）'), true);
  if (roleEditorState.mode === 'edit' && roleEditorState.name === d.name) {
    const c = await api('/api/roles/content?name=' + encodeURIComponent(d.name));
    if (c.ok) { document.getElementById('newRoleContent').value = c.content; updateRoleEditorWarnings(); }
  }
  refreshRoles();
}

async function refreshRoles() {
  await refreshRoleDefaultsState();
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
    roleCurrent = r.current ?? null;
    roleAssignments = Array.isArray(r.assignments) ? r.assignments
      : Object.entries(r.assignments ?? {}).map(([key, role]) => ({ key, role, source: 'key' }));
    renderRoleList();
    const hint = document.getElementById('roleListHint');
    if (hint) hint.textContent = roleCache.length ? `共 ${roleCache.length} 个 · 点卡片编辑` : '';
    renderRoleEditor();
  } catch (error) {
    document.getElementById('roleList').textContent = '加载失败：' + (error?.message ?? error);
  }
}

/** 按搜索词与筛选渲染人格卡片；每行带「设为默认 / 恢复初始」两个行内操作。 */
function renderRoleList() {
  const box = document.getElementById('roleList');
  if (!box) return;
  box.replaceChildren();
  const used = new Set((roleAssignments || [])
    .filter((row) => row && row.role && row.source !== 'global' && row.source !== 'off')
    .map((row) => row.role));
  const defaultNames = new Set((roleDefaults || []).map((d) => d.name));
  const q = roleQuery.trim().toLowerCase();
  const rows = roleCache.filter((role) => {
    if (q && !`${role.name} ${role.excerpt ?? ''}`.toLowerCase().includes(q)) return false;
    const isUsed = role.name === roleCurrent || used.has(role.name);
    if (roleFilter === 'used') return isUsed;
    if (roleFilter === 'unused') return !isUsed;
    return true;
  });
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = roleCache.length
      ? '<strong>没有匹配的人格</strong><p>换个搜索词或筛选条件试试。</p>'
      : '<strong>还没有人格</strong><p>点右上角「新建人格」，或在下方编辑区填名称与内容。</p>';
    box.appendChild(empty);
    return;
  }
  for (const role of rows) {
    const item = document.createElement('div');
    item.className = 'tile' + (role.name === roleCurrent ? ' active' : '');
    item.dataset.role = role.name;

    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'tile-body';
    const head = document.createElement('span');
    head.className = 'tile-head';
    const title = document.createElement('strong');
    title.textContent = role.name;
    head.appendChild(title);
    if (role.name === roleCurrent) {
      const badge = document.createElement('span');
      badge.className = 'persona-badge';
      badge.textContent = '默认';
      head.appendChild(badge);
    }
    if (used.has(role.name)) {
      const badge = document.createElement('span');
      badge.className = 'persona-badge';
      badge.textContent = '用于会话';
      head.appendChild(badge);
    }
    if (role.truncated) {
      const badge = document.createElement('span');
      badge.className = 'persona-badge warn';
      badge.textContent = '超出上限';
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
    body.append(head, meta);
    body.addEventListener('click', () => openRoleForEdit(role.name));

    const actions = document.createElement('div');
    actions.className = 'tile-actions';
    if (role.name !== roleCurrent) {
      const setDefault = document.createElement('button');
      setDefault.type = 'button';
      setDefault.className = 'btn small';
      setDefault.dataset.roleDefault = role.name;
      setDefault.textContent = '设为默认';
      actions.appendChild(setDefault);
    }
    if (defaultNames.has(role.name)) {
      const d = (roleDefaults || []).find((x) => x.name === role.name);
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'btn small';
      restore.dataset.roleRestore = role.name;
      restore.textContent = '恢复初始';
      restore.disabled = Boolean(d && d.exists && !d.modified);
      actions.appendChild(restore);
    }
    item.append(body, actions);
    box.appendChild(item);
  }
}

async function refreshPersonaStatus() {
  try {
    const s = await api('/api/status');
    document.getElementById('roleText').textContent = s.role || '无';
    const pill = document.getElementById('roleModeText');
    const silent = s.roleMode === 'silent';
    pill.textContent = silent ? '静默' : '正常';
    pill.className = `status-badge is-pill ${silent ? 'warn' : 'ok'}`;
  } catch {}
}

// ── 外部人格：soulkit provider 的角色卡 ──────────────────────────────────────
// 只开放「覆盖 + 角色追加」两个可写面（soul 与角色本身由 soulkit 管理）；
// 断连时用桥接缓存兜底，卡片仍可看、可另存为内部人格。
let externalCards = [];
let externalMeta = { provider: null, stale: false, error: null, listable: true };
let externalState = { name: null, stale: false, text: '' };

function setExtMsg(text, kind = 'info') {
  const el = document.getElementById('extMsg');
  if (el) setMsg(el, text || '', kind);
}

async function refreshExternalPersonas() {
  try {
    const r = await api('/api/persona/external');
    externalCards = Array.isArray(r?.cards) ? r.cards : [];
    externalMeta = {
      provider: r?.provider ?? null,
      stale: Boolean(r?.stale),
      error: r?.error ?? null,
      listable: r?.listable !== false,
    };
  } catch (error) {
    externalCards = [];
    externalMeta = { provider: null, stale: true, error: String(error?.message ?? error), listable: false };
  }
  renderExternalRoles();
}

function renderExternalRoles() {
  const host = document.getElementById('externalRoles');
  const hint = document.getElementById('externalHint');
  if (!host) return;
  if (hint) {
    hint.textContent = !externalMeta.listable
      ? '当前没有可用的外部人格 provider；下面是上次缓存。'
      : externalMeta.stale
        ? '外部 provider 暂不可用，显示上次缓存；仍可另存为内部人格。'
        : '来自 soulkit 的角色卡；可编辑覆盖与角色追加，或另存为内部人格。';
  }
  host.replaceChildren();
  if (!externalCards.length) {
    const empty = document.createElement('p');
    empty.className = 'meta';
    empty.textContent = externalMeta.error ? `读取失败：${externalMeta.error}` : '没有外部人格卡。';
    host.appendChild(empty);
    return;
  }
  for (const card of externalCards) {
    const item = document.createElement('div');
    item.className = 'tile tile-external';
    item.dataset.ext = card.name;

    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'tile-body';
    body.dataset.extOpen = card.name;
    const head = document.createElement('span');
    head.className = 'tile-head';
    const title = document.createElement('strong');
    title.textContent = card.name;
    head.appendChild(title);
    const badge = document.createElement('span');
    badge.className = 'persona-badge';
    badge.textContent = '外部';
    head.appendChild(badge);
    if (card.stale) {
      const stale = document.createElement('span');
      stale.className = 'persona-badge warn';
      stale.textContent = '缓存';
      head.appendChild(stale);
    }
    const meta = document.createElement('small');
    meta.textContent = `${card.description || 'soulkit 角色卡'} · 覆盖 ${card.overlayChars ?? 0} 字 · 追加 ${card.systemAppendChars ?? 0} 字`;
    body.append(head, meta);

    const actions = document.createElement('div');
    actions.className = 'tile-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn small';
    edit.dataset.extOpen = card.name;
    edit.textContent = '编辑';
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'btn small';
    use.dataset.extUse = card.name;
    use.textContent = '选用';
    use.title = '另存为内部人格并设为全局默认';
    const saveAs = document.createElement('button');
    saveAs.type = 'button';
    saveAs.className = 'btn small';
    saveAs.dataset.extSaveas = card.name;
    saveAs.textContent = '另存为内部';
    actions.append(edit, use, saveAs);

    item.append(body, actions);
    host.appendChild(item);
  }
}

async function saveExternalAsRole(name, text, asArg) {
  const target = String(asArg ?? `${name}-内部`).trim();
  if (!target) { setRoleMsg('请填写内部人格名', false); return ''; }
  const r = await api('/api/persona/external/save-as-role', 'POST', { name, as: target, text: text || undefined });
  if (!r?.ok) { setRoleMsg('❌ ' + (r?.error || '另存失败'), false); return ''; }
  setRoleMsg(`✅ 已另存为内部人格「${target}」（${r.chars} 字符）`, true);
  await refreshRoles();
  return target;
}

async function useExternalAsDefault(name) {
  const target = await saveExternalAsRole(name);
  if (!target) return;
  const r = await api('/api/config/role-default', 'POST', { value: target });
  if (r?.ok) {
    setRoleMsg(r.message || `已把「${target}」设为默认人格`, true);
    await refreshRoles();
    refreshPersonaStatus();
  } else {
    setRoleMsg('❌ ' + (r?.error || '设为默认失败'), false);
  }
}

async function openExternal(name) {
  let detail = null;
  let card = null;
  try {
    [detail, card] = await Promise.all([
      api('/api/persona/external/detail', 'POST', { name }),
      api('/api/persona/external/card', 'POST', { name }),
    ]);
  } catch (error) {
    setRoleMsg('❌ ' + String(error?.message ?? error), false);
    return;
  }
  if (!detail?.ok) { setRoleMsg('❌ ' + (detail?.error || '读取外部人格失败'), false); return; }
  externalState = { name, stale: Boolean(detail.stale), text: card?.text || '' };

  document.getElementById('externalEditor')?.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml({
    id: 'externalEditor',
    title: `外部人格 · ${name}`,
    body: '<div id="externalForm"></div>',
    wide: true,
  }));
  const overlay = document.getElementById('externalEditor');
  renderFields(document.getElementById('externalForm'), PERSONA_FIELDS.externalEditor.fields, { columns: 1 });

  const character = detail.character || {};
  document.getElementById('extName').value = name;
  document.getElementById('extSaveAsName').value = `${name}-内部`;
  document.getElementById('extDescription').value = character.description || '';
  document.getElementById('extOverlay').value = character.overlay || '';
  document.getElementById('extSystemAppend').value = character.systemAppend || '';
  if (detail.stale) setExtMsg('当前显示的是缓存；改动会先在本地，连上 soulkit 后再保存。');

  document.getElementById('extSave').addEventListener('click', async () => {
    const body = {
      name: externalState.name,
      description: document.getElementById('extDescription').value,
      overlay: document.getElementById('extOverlay').value,
      systemAppend: document.getElementById('extSystemAppend').value,
    };
    const r = await api('/api/persona/external/save', 'POST', body);
    if (!r?.ok) { setExtMsg('❌ ' + (r?.error || '保存失败'), 'err'); return; }
    setExtMsg('✅ 已保存到 soulkit；下一条消息生效', 'ok');
    const fresh = await api('/api/persona/external/card', 'POST', { name: externalState.name }).catch(() => null);
    if (fresh?.text) externalState.text = fresh.text;
    refreshExternalPersonas();
  });

  document.getElementById('extRename').addEventListener('click', async () => {
    const nextName = document.getElementById('extNewName').value.trim();
    if (!nextName) { setExtMsg('先填「新名字」', 'err'); return; }
    const r = await api('/api/persona/external/rename', 'POST', { name: externalState.name, nextName });
    if (!r?.ok) { setExtMsg('❌ ' + (r?.error || '改名失败'), 'err'); return; }
    externalState.name = nextName;
    document.getElementById('extName').value = nextName;
    document.getElementById('extNewName').value = '';
    setExtMsg(`✅ 已改名为「${nextName}」`, 'ok');
    refreshExternalPersonas();
  });

  document.getElementById('extSaveAs').addEventListener('click', () => {
    saveExternalAsRole(externalState.name, externalState.text, document.getElementById('extSaveAsName').value);
  });
  const closeExternal = wireModal(overlay, { onClose: () => overlay.remove() });
  document.getElementById('extClose').addEventListener('click', () => closeExternal());
  openModal(overlay);
}

export function init() {
  // 先把控件渲染出来：后面所有 getElementById 都要取到它们。
  renderPersonaFieldGroups();

  // 列表工具栏：搜索 / 筛选 / 刷新 / 新建（新建 = 清空编辑区并聚焦名称）。
  const search = document.getElementById('roleSearch');
  if (search) search.addEventListener('input', (e) => { roleQuery = e.target.value; renderRoleList(); });
  const filter = document.getElementById('roleFilter');
  if (filter) filter.addEventListener('change', (e) => { roleFilter = e.target.value; renderRoleList(); });
  document.getElementById('roleRefresh')?.addEventListener('click', () => refreshRoles());
  document.getElementById('roleNew')?.addEventListener('click', () => {
    resetRoleForm?.();
    document.getElementById('newRoleName')?.focus();
  });
  // 行内操作：设为默认 / 恢复初始。
  document.getElementById('roleList')?.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const restore = target?.closest('[data-role-restore]');
    if (restore) { e.preventDefault(); await restoreRoleDefault(restore.dataset.roleRestore); return; }
    const setDefault = target?.closest('[data-role-default]');
    if (setDefault) {
      e.preventDefault();
      const r = await api('/api/config/role-default', 'POST', { value: setDefault.dataset.roleDefault });
      if (r?.ok) { setRoleMsg(r.message || '已设为默认人格', true); await refreshRoles(); refreshPersonaStatus(); }
      else setRoleMsg('❌ ' + (r?.error || '设置失败'), false);
    }
  });
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

  // ── 外部人格 ────────────────────────────────────────────────────────────────
  document.getElementById('externalRoles')?.addEventListener('click', async (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const open = target?.closest('[data-ext-open]');
    if (open) { await openExternal(open.dataset.extOpen); return; }
    const use = target?.closest('[data-ext-use]');
    if (use) { await useExternalAsDefault(use.dataset.extUse); return; }
    const saveAs = target?.closest('[data-ext-saveas]');
    if (saveAs) { await saveExternalAsRole(saveAs.dataset.extSaveas); return; }
  });
  document.getElementById('roleFormReset').addEventListener('click', () => resetRoleForm());
  document.getElementById('newRoleContent').addEventListener('input', updateRoleEditorWarnings);

  // ── 人格注入上限 ────────────────────────────────────────────────────────────
  document.getElementById('roleInjectMaxSave').addEventListener('click', async () => {
    const msg = document.getElementById('roleInjectMaxMsg');
    const value = Number(document.getElementById('roleInjectMax').value);
    if (!Number.isFinite(value) || value < 1000 || value > 20000) { setMsg(msg, '请输入 1000~20000 之间的整数', 'err'); return; }
    const r = await api('/api/roles/limit', 'POST', { maxInjectChars: value });
    msg.textContent = r.ok ? `✅ 已设为 ${r.maxInjectChars} 字符，下一条消息生效` : ('❌ ' + (r.error || '保存失败'));
    msg.className = r.ok ? 'control-note ok' : 'control-note err';
    if (r.ok) refreshRoles();
  });

  document.getElementById('personaSourceRefresh').addEventListener('click', () => refreshPersonaSources().catch(() => {}));

  // 停在人格页时，每 15 秒同步一次「人格来源」。
  setInterval(() => { if (getCurrentPage() === 'persona' && !document.hidden) refreshPersonaSources().catch(() => {}); }, 15_000);

  onPageRefresh('persona', () => {
    // 每次进入都重读一次：全局人格可能在别处改过、新会话可能刚建好。
    refreshPersonaStatus();
    refreshPersonaSources().catch(() => {});
    refreshExternalPersonas().catch(() => {});
  });
  // 首次进入时片段刚注入，延后一拍再拉数据，避免 DOM 就绪前空转。
  setTimeout(() => {
    refreshPersonaStatus();
    refreshRoles();
    refreshPersonaSources().catch(() => {});
    refreshExternalPersonas().catch(() => {});
  }, 0);
}
