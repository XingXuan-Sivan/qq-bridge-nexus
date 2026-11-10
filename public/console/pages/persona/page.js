// 人格与角色页：内部卡（roles/*.md）与外部 provider 卡合成一面卡片墙；
// 编辑走弹窗（人格名 + 提示词编辑器），配置项放在「人格提示词配置」卡里。
import { renderFields } from '../../components/form/form.js';
import { modalHtml, openModal, closeModal, wireModal } from '../../components/modal/modal.js';
import { attachTextareaEditor } from '../../components/code-editor/code-editor.js';
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { onPageRefresh } from '../../js/router.js';
import { PERSONA_FIELDS } from './fields.js';

const model = { items: [], providers: [], providerErrors: {}, default: null, limits: null };
let roleFilter = 'all';
let roleQuery = '';
let editing = null; // { mode:'create'|'edit', item }
let editor = null; // { overlay, title, name, note, text, msg, deleteBtn, saveAsBtn, saveBtn }
let codeHandle = null;
let busy = false;

const listEl = () => document.getElementById('roleList');

function applyValue() {
  const picked = document.querySelector('input[name="roleSaveApply"]:checked');
  return picked?.value === 'immediate' ? 'immediate' : 'nextWake';
}

function visibleItems() {
  const q = roleQuery.trim().toLowerCase();
  return model.items.filter((item) => {
    if (roleFilter === 'local' && item.source !== 'local') return false;
    if (roleFilter === 'provider' && item.source !== 'provider') return false;
    if (roleFilter === 'cached' && !item.stale) return false;
    if (!q) return true;
    return `${item.name} ${item.description ?? ''} ${item.provider ?? ''}`.toLowerCase().includes(q);
  });
}

function badgesHtml(item) {
  // 与插件卡保持同一套标签：.pill / .pill g / .pill b / .pill r
  const badges = [];
  if (item.default) badges.push('<span class="pill g">默认</span>');
  badges.push(item.source === 'local'
    ? '<span class="pill">内部</span>'
    : `<span class="pill b">外部 · ${esc(item.provider)}</span>`);
  if (item.stale) badges.push('<span class="pill r">缓存</span>');
  return badges.join('');
}

function actionsHtml(item) {
  const caps = item.capabilities ?? {};
  const canDelete = item.source === 'local' ? Boolean(item.deletable) : Boolean(caps.remove);
  return `
    <div class="tile-actions">
      ${item.default ? '' : `<button class="btn small" type="button" data-act="default" data-uid="${esc(item.uid)}">设为默认</button>`}
      ${item.source === 'provider' ? `<button class="btn small" type="button" data-act="save-as" data-uid="${esc(item.uid)}">另存为内部</button>` : ''}
      ${item.resettable ? `<button class="btn small" type="button" data-act="restore" data-uid="${esc(item.uid)}">重置</button>` : ''}
      ${canDelete ? `<button class="btn small danger" type="button" data-act="delete" data-uid="${esc(item.uid)}">删除</button>` : ''}
    </div>`;
}

function cardHtml(item) {
  const sub = item.source === 'local'
    ? `${item.chars ?? 0} 字符`
    : `${item.chars ?? '—'} 字符 · ${esc(item.description || '外部人格卡')}`;
  return `
    <div class="tile${item.default ? ' active' : ''}" data-uid="${esc(item.uid)}">
      <button class="tile-body" type="button" data-act="edit" data-uid="${esc(item.uid)}">
        <div class="tile-head"><strong>${esc(item.name)}</strong>${badgesHtml(item)}</div>
        <small>${sub}</small>
      </button>
      ${actionsHtml(item)}
    </div>`;
}

function renderRoleList() {
  const host = listEl();
  if (!host) return;
  const items = visibleItems();
  const hint = document.getElementById('roleListHint');
  const externalDown = Object.entries(model.providerErrors ?? {})
    .map(([id, error]) => `${id}：${error}`).join('；');
  if (hint) {
    const active = model.items.find((item) => item.default || item.uid === model.default);
    hint.textContent = `共 ${model.items.length} 张 · 当前默认：${active?.name ?? '未设置'}`
      + (externalDown ? ` · 外部服务异常（${externalDown}）` : '');
  }
  if (!items.length) {
    host.innerHTML = '<div class="empty-state">没有符合条件的人格卡。外部服务离线时，只有「用过的缓存卡」会显示出来。</div>';
    return;
  }
  host.innerHTML = items.map(cardHtml).join('');
}

function renderStatus() {
  const active = model.items.find((item) => item.default);
  const roleText = document.getElementById('roleText');
  const modeText = document.getElementById('roleModeText');
  if (roleText) roleText.textContent = active ? active.name : '未设置';
  if (modeText) {
    modeText.textContent = active
      ? (active.source === 'local' ? '内部人格' : `${active.provider}${active.stale ? ' · 缓存' : ' · 在线'}`)
      : '跟随仿真提示词';
  }
}

async function refresh() {
  try {
    const data = await api('/api/personas');
    model.items = data.items ?? [];
    model.providers = data.providers ?? [];
    model.providerErrors = data.providerErrors ?? {};
    model.default = data.default ?? null;
    renderRoleList();
    renderStatus();
  } catch (error) {
    const host = listEl();
    if (host) host.innerHTML = `<div class="empty-state">人格列表加载失败：${esc(error?.message ?? error)}</div>`;
  }
}

// ── 编辑弹窗 ────────────────────────────────────────────────────────────────
function ensureEditor() {
  if (editor) return editor;
  const wrap = document.createElement('div');
  wrap.innerHTML = modalHtml({
    id: 'personaEditor',
    title: '编辑人格',
    wide: true,
    body: `
      <div class="form-stack">
        <div class="field-block" id="personaNameBlock">
          <label class="field-label" for="personaName">人格名</label>
          <div class="field-control">
            <input class="input" id="personaName" type="text" maxlength="40" autocomplete="off">
          </div>
          <div class="meta" id="personaNameNote"></div>
        </div>
        <div class="field-block">
          <label class="field-label" for="personaText">人格提示词</label>
          <div class="field-control">
            <textarea class="code-editor-field" id="personaText" rows="16"></textarea>
          </div>
          <div class="meta" id="personaTextNote">这一段会拼在仿真提示词之后，决定「AI 是谁、怎么说话」。保存即生效。</div>
        </div>
        <div class="field-block" id="personaSaveAsBlock" hidden>
          <label class="field-label" for="personaSaveAsName">另存为内部人格</label>
          <div class="field-control">
            <input class="input" id="personaSaveAsName" type="text" maxlength="40" autocomplete="off">
          </div>
          <div class="meta">点下面「另存为内部」时写入 roles/&lt;名字&gt;.md；同名文件会先备份。</div>
        </div>
      </div>`,
    footer: `
      <span class="status-badge" id="personaEditMsg"></span>
      <span class="grow"></span>
      <button class="btn danger" id="personaDelete" type="button" hidden>删除</button>
      <button class="btn" id="personaSaveAs" type="button" hidden>另存为内部</button>
      <button class="btn" id="personaCancel" type="button">取消</button>
      <button class="btn primary" id="personaSave" type="button">保存</button>`,
  });
  const overlay = wrap.firstElementChild;
  document.body.appendChild(overlay);
  wireModal(overlay, { onClose: () => { editing = null; } });
  const textarea = overlay.querySelector('#personaText');
  codeHandle = attachTextareaEditor(textarea, { language: 'text', height: '380px' });
  editor = {
    overlay,
    title: overlay.querySelector('.modal-head h3'),
    name: overlay.querySelector('#personaName'),
    nameBlock: overlay.querySelector('#personaNameBlock'),
    nameNote: overlay.querySelector('#personaNameNote'),
    text: textarea,
    msg: overlay.querySelector('#personaEditMsg'),
    saveAsBlock: overlay.querySelector('#personaSaveAsBlock'),
    saveAsName: overlay.querySelector('#personaSaveAsName'),
    deleteBtn: overlay.querySelector('#personaDelete'),
    saveAsBtn: overlay.querySelector('#personaSaveAs'),
    saveBtn: overlay.querySelector('#personaSave'),
  };
  overlay.querySelector('#personaCancel').addEventListener('click', () => closeModal(overlay));
  overlay.querySelector('#personaSave').addEventListener('click', () => { void saveEditor(); });
  overlay.querySelector('#personaDelete').addEventListener('click', () => { void deleteCurrent(); });
  overlay.querySelector('#personaSaveAs').addEventListener('click', () => { void saveAsInternal(); });
  return editor;
}

function setEditorText(text) {
  const value = String(text ?? '');
  editor.text.value = value;
  if (codeHandle?.setValue) codeHandle.setValue(value);
}

async function openEditor(item) {
  ensureEditor();
  editing = { mode: item ? 'edit' : 'create', item: item ?? null };
  const isProvider = item?.source === 'provider';
  editor.title.textContent = item ? (isProvider ? '编辑外部人格' : '编辑人格') : '新建人格';
  editor.msg.textContent = '';
  editor.msg.className = 'status-badge';
  editor.name.value = item ? item.name : '';
  editor.name.readOnly = Boolean(item);
  editor.nameBlock.hidden = false;
  editor.deleteBtn.hidden = !item;
  editor.saveAsBtn.hidden = !isProvider;
  editor.saveAsBlock.hidden = !isProvider;
  editor.saveAsName.value = isProvider ? `${item.name}-内部` : '';
  editor.saveBtn.disabled = false;
  editor.nameNote.textContent = item
    ? (isProvider ? `来自外部服务 ${item.provider}；人格名由插件管理，改名请到插件侧操作。` : '内部人格：改名会同时重命名 roles/ 里的文件。')
    : '内部人格名：中文 / 字母 / 数字 / 横线，保存后写入 roles/。';
  setEditorText('');
  if (item?.source === 'local') {
    editor.text.readOnly = false;
    codeHandle?.setReadOnly?.(false);
    try {
      const r = await api('/api/roles/content?name=' + encodeURIComponent(item.id));
      setEditorText(r.content ?? '');
    } catch (error) {
      editor.msg.textContent = `读取失败：${error?.message ?? error}`;
    }
  } else if (item) {
    try {
      const r = await api('/api/persona/external/card', 'POST', { name: item.id });
      setEditorText(r.text ?? '');
      if (r.stale) editor.msg.textContent = '外部服务离线，显示的是缓存副本';
      const caps = item.capabilities ?? {};
      editor.text.readOnly = !caps.update;
      codeHandle?.setReadOnly?.(!caps.update);
      editor.saveBtn.disabled = !caps.update;
    } catch (error) {
      editor.msg.textContent = `读取失败：${error?.message ?? error}`;
      editor.saveBtn.disabled = true;
    }
  }
  openModal(editor.overlay);
}

async function saveEditor() {
  if (busy) return;
  const text = String(editor.text.value ?? '').trim();
  if (!text) { editor.msg.textContent = '提示词不能为空'; return; }
  busy = true;
  editor.saveBtn.disabled = true;
  try {
    if (editing.mode === 'create') {
      const name = String(editor.name.value ?? '').trim();
      if (!name) { editor.msg.textContent = '请填写人格名'; return; }
      await api('/api/roles/create', 'POST', { name, content: text });
      showConsoleToast(`已新建人格「${name}」`);
    } else if (editing.item.source === 'local') {
      await api('/api/roles/update', 'POST', { name: editing.item.id, content: text });
    } else {
      await api('/api/personas/update', 'POST', { uid: editing.item.uid, text });
    }
    closeModal(editor.overlay);
    await refresh();
  } catch (error) {
    editor.msg.textContent = String(error?.message ?? error);
  } finally {
    busy = false;
    editor.saveBtn.disabled = false;
  }
}

async function saveAsInternal() {
  if (!editing?.item) return;
  const as = String(editor.saveAsName.value ?? '').trim();
  if (!as) { editor.msg.textContent = '请填写内部人格名'; return; }
  try {
    const r = await api('/api/persona/external/save-as-role', 'POST', {
      name: editing.item.id,
      as,
      text: String(editor.text.value ?? ''),
    });
    showConsoleToast(`已另存为内部人格「${r.name}」`);
    closeModal(editor.overlay);
    await refresh();
  } catch (error) {
    editor.msg.textContent = String(error?.message ?? error);
  }
}

async function deleteCurrent() {
  if (!editing?.item) return;
  const item = editing.item;
  if (!window.confirm(`确定删除人格「${item.name}」？此操作不可撤销。`)) return;
  try {
    if (item.source === 'local') await api('/api/roles/delete', 'POST', { name: item.id });
    else await api('/api/personas/delete', 'POST', { uid: item.uid });
    showConsoleToast(`已删除「${item.name}」`);
    closeModal(editor.overlay);
    await refresh();
  } catch (error) {
    editor.msg.textContent = String(error?.message ?? error);
  }
}

// ── 卡片操作 ────────────────────────────────────────────────────────────────
async function setDefault(uid) {
  try {
    await api('/api/personas/default', 'POST', { uid });
    await refresh();
  } catch (error) {
    showConsoleToast(`设置默认人格失败：${error?.message ?? error}`);
  }
}

async function restoreDefault(uid) {
  const item = model.items.find((entry) => entry.uid === uid);
  if (!item) return;
  if (!window.confirm(`把「${item.name}」恢复成出厂内容？当前内容会先备份。`)) return;
  try {
    const r = await api('/api/roles/restore-default', 'POST', { name: item.id });
    showConsoleToast(r.unchanged ? `「${item.name}」已是出厂内容` : `已重置「${item.name}」`);
    await refresh();
  } catch (error) {
    showConsoleToast(`重置失败：${error?.message ?? error}`);
  }
}

async function deleteCard(uid) {
  const item = model.items.find((entry) => entry.uid === uid);
  if (!item) return;
  if (!window.confirm(`确定删除人格「${item.name}」？此操作不可撤销。`)) return;
  try {
    if (item.source === 'local') await api('/api/roles/delete', 'POST', { name: item.id });
    else await api('/api/personas/delete', 'POST', { uid });
    showConsoleToast(`已删除「${item.name}」`);
    await refresh();
  } catch (error) {
    showConsoleToast(`删除失败：${error?.message ?? error}`);
  }
}

function bind() {
  const root = document.getElementById('roleList');
  root?.addEventListener('click', (e) => {
    const button = e.target.closest('[data-act]');
    if (!button) return;
    const uid = button.dataset.uid;
    const item = model.items.find((entry) => entry.uid === uid) ?? null;
    switch (button.dataset.act) {
      case 'edit': void openEditor(item); break;
      case 'default': void setDefault(uid); break;
      case 'restore': void restoreDefault(uid); break;
      case 'save-as':
        void openEditor(item).then(() => { if (editor) editor.saveAsBtn.hidden = false; });
        break;
      case 'delete': void deleteCard(uid); break;
      default: break;
    }
  });
  document.getElementById('roleSearch')?.addEventListener('input', (e) => {
    roleQuery = e.target.value;
    renderRoleList();
  });
  document.getElementById('roleFilter')?.addEventListener('change', (e) => {
    roleFilter = e.target.value;
    renderRoleList();
  });
  document.getElementById('roleRefresh')?.addEventListener('click', () => { void refresh(); });
  document.getElementById('roleNew')?.addEventListener('click', () => { void openEditor(null); });
}

export function init() {
  const toolbar = document.querySelector('[data-persona-fields="toolbar"]');
  if (toolbar) renderFields(toolbar, PERSONA_FIELDS.toolbar.fields, { layout: 'inline' });
  bind();
  void refresh();
  onPageRefresh('persona', () => { void refresh(); });
}
