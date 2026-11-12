// 人格与角色页：内部卡（roles/*.md）与外部 provider 卡合成一面卡片墙；
// 编辑走弹窗（人格名 + 提示词编辑器），注入上限与生效方式在「全局配置 › 人格与行为」。
import { tableToolbarHtml } from '../../components/table/table.js';
import { modalHtml, openModal, closeModal, wireModal } from '../../components/modal/modal.js';
import { renderFields } from '../../components/form/form.js';
import { attachTextareaEditor } from '../../components/code-editor/code-editor.js';
import { confirmBox } from '../../components/message-box/message-box.js';
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { onPageRefresh } from '../../js/router.js';

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
  const items = model.items.filter((item) => {
    if (roleFilter === 'local' && item.source !== 'local') return false;
    if (roleFilter === 'provider' && item.source !== 'provider') return false;
    if (roleFilter === 'cached' && !item.stale) return false;
    if (!q) return true;
    return `${item.name} ${item.description ?? ''} ${item.provider ?? ''}`.toLowerCase().includes(q);
  });
  // 排序：默认卡置顶，其次内部卡，再外部在线卡，最后离线的缓存卡；同组按名字排。
  const rank = (item) => (item.default ? 0 : item.stale ? 3 : item.source === 'local' ? 1 : 2);
  return items.sort((a, b) => rank(a) - rank(b)
    || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
}

function badgesHtml(item) {
  // 与插件卡保持同一套标签：.pill / .tag tag--success / .tag tag--primary / .tag tag--danger
  const badges = [];
  if (item.default) badges.push('<span class="tag tag--success">默认</span>');
  badges.push(item.source === 'local'
    ? '<span class="tag">内部</span>'
    : `<span class="tag tag--primary">外部 · ${esc(item.provider)}</span>`);
  if (item.stale) badges.push('<span class="tag tag--danger">缓存</span>');
  return badges.join('');
}

function actionsHtml(item) {
  const caps = item.capabilities ?? {};
  const canDelete = item.source === 'local' ? Boolean(item.deletable) : Boolean(caps.remove);
  const deleteTitle = canDelete ? '删除这张人格卡'
    : (item.source === 'local' ? '内置人格不能删除，可点「重置」恢复出厂' : `${item.provider ?? '外部服务'} 还没有实现删除`);
  return `
    <div class="tile-actions">
      <button class="btn small" type="button" data-act="edit" data-uid="${esc(item.uid)}">编辑</button>
      <button class="btn small" type="button" data-act="default" data-uid="${esc(item.uid)}"${item.default ? ' disabled title="当前就是默认人格"' : ''}>设为默认</button>
      ${item.source === 'provider' ? `<button class="btn small" type="button" data-act="save-as" data-uid="${esc(item.uid)}">另存为内部</button>` : ''}
      ${item.resettable ? `<button class="btn small" type="button" data-act="restore" data-uid="${esc(item.uid)}">重置</button>` : ''}
      <button class="btn small danger" type="button" data-act="delete" data-uid="${esc(item.uid)}"${canDelete ? '' : ' disabled'} title="${esc(deleteTitle)}">删除</button>
    </div>`;
}

function cardHtml(item) {
  const sub = item.source === 'local'
    ? `${item.chars ?? 0} 字符`
    : `${item.chars ?? '—'} 字符 · ${esc(item.description || '外部人格卡')}`;
  return `
    <div class="tile" data-uid="${esc(item.uid)}">
      <button class="tile-body" type="button" data-open="1" data-uid="${esc(item.uid)}">
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
    modeText.className = active && active.source !== 'local' && !active.stale ? 'tag tag--success' : (active?.stale ? 'tag tag--danger' : 'tag tag--info');
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
    body: '<div class="form-stack" id="personaEditorBody"></div>',
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
  renderFields(overlay.querySelector('#personaEditorBody'), [
    {
      type: 'text',
      name: 'personaName',
      label: '人格名',
      maxlength: 40,
      required: true,
      hint: '内部人格名：中文 / 字母 / 数字 / 横线，保存后写入 roles/。',
    },
    {
      type: 'custom',
      name: 'personaTextSlot',
      label: '人格提示词',
      className: 'field-block--stacked',
      html: '<textarea class="code-editor-field" id="personaText" rows="16"></textarea>',
      hint: '这一段会拼在仿真提示词之后，决定「AI 是谁、怎么说话」。保存即生效。',
    },
    {
      type: 'text',
      name: 'personaSaveAsName',
      label: '另存为内部人格',
      maxlength: 40,
      hint: '点下面「另存为内部」时写入 roles/<名字>.md；同名文件会先备份。',
    },
  ], { columns: 1 });
  // 兼容既有测试与外部脚本：保留原来的块级 id（组件用 data-field-wrap 标记外层）。
  overlay.querySelector('[data-field-wrap="personaName"]')?.setAttribute('id', 'personaNameBlock');
  overlay.querySelector('[data-field-wrap="personaSaveAsName"]')?.setAttribute('id', 'personaSaveAsBlock');
  wireModal(overlay, { onClose: () => { editing = null; } });
  const textarea = overlay.querySelector('#personaText');
  codeHandle = attachTextareaEditor(textarea, { language: 'text', height: '380px' });
  editor = {
    overlay,
    title: overlay.querySelector('.modal-head h3'),
    name: overlay.querySelector('#personaName'),
    nameBlock: overlay.querySelector('#personaNameBlock'),
    nameNote: overlay.querySelector('#personaName-hint'),
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
  if (!(await confirmBox({ message: `确定删除人格「${item.name}」？此操作不可撤销。`, danger: true, confirmText: '删除' }))) return;
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
  if (!(await confirmBox({ message: `把「${item.name}」恢复成出厂内容？当前内容会先备份。`, confirmText: '恢复默认' }))) return;
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
  if (!(await confirmBox({ message: `确定删除人格「${item.name}」？此操作不可撤销。`, danger: true, confirmText: '删除' }))) return;
  try {
    if (item.source === 'local') await api('/api/roles/delete', 'POST', { name: item.id });
    else await api('/api/personas/delete', 'POST', { uid });
    showConsoleToast(`已删除「${item.name}」`);
    await refresh();
  } catch (error) {
    showConsoleToast(`删除失败：${error?.message ?? error}`);
  }
}

/** 工具栏统一由表格组件生成（与预设/定时任务页同一套控件与顺序）。 */
function renderToolbar() {
  const host = document.getElementById('roleToolbar');
  if (!host) return;
  host.innerHTML = tableToolbarHtml({
    refresh: true,
    filters: [{
      id: 'roleFilter',
      domId: 'roleFilter',
      label: '按来源筛选',
      value: roleFilter,
      options: [
        { value: 'all', label: '全部人格' },
        { value: 'local', label: '内部人格' },
        { value: 'provider', label: '外部人格' },
        { value: 'cached', label: '仅缓存' },
      ],
    }],
    search: { id: 'roleSearch', placeholder: '搜索人格名或说明…', value: roleQuery },
    meta: '共 0 张',
    metaId: 'roleListHint',
    actions: '<button class="btn primary" id="roleNew" type="button">新建人格</button>',
  });
}

function bind() {
  const root = document.getElementById('roleList');
  root?.addEventListener('click', (e) => {
    const body = e.target.closest('[data-open]');
    if (body) {
      const item = model.items.find((entry) => entry.uid === body.dataset.uid) ?? null;
      void openEditor(item);
      return;
    }
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
  const toolbar = document.getElementById('roleToolbar');
  toolbar?.addEventListener('input', (e) => {
    if (!e.target.closest('#roleSearch')) return;
    roleQuery = e.target.value;
    renderRoleList();
  });
  toolbar?.addEventListener('change', (e) => {
    if (!e.target.closest('#roleFilter')) return;
    roleFilter = e.target.value;
    renderRoleList();
  });
  toolbar?.addEventListener('click', (e) => {
    if (e.target.closest('#roleNew')) { void openEditor(null); return; }
    if (e.target.closest('[data-table-refresh]')) void refresh();
  });
}

export function init() {
  renderToolbar();
  bind();
  void refresh();
  onPageRefresh('persona', () => { void refresh(); });
}
