// 技能页：只读来源 + 外部技能管理（新增/导入/编辑/启停/删除）。
// 表格、弹窗、表单都复用 console 组件；技能正文保留完整 SKILL.md，不在前端重排 YAML。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { renderFields } from '../../components/form/form.js';
import { closeModal, modalHtml, openModal, wireModal } from '../../components/modal/modal.js';
import { SKILLS_FIELDS } from './fields.js';

const SOURCE_LABEL = {
  user: '外部',
  external: '外部目录',
  dsh: 'DSH',
  repo: '仓库',
  builtin: '内置',
};

let skillsCache = [];

function sourcePill(source) {
  const label = SOURCE_LABEL[source] ?? source ?? '内置';
  return `<span class="pill ${source === 'user' ? 'b' : 'n'}">${esc(label)}</span>`;
}

function activePill(active) {
  return active
    ? '<span class="pill g">启用</span>'
    : '<span class="pill n">停用</span>';
}

function actionButtons(skill) {
  const id = esc(skill.id);
  if (skill.editable !== true) return '<button class="btn small" type="button" data-skill-act="view" data-skill-id="' + id + '">查看</button>';
  const toggle = skill.active === false
    ? '<button class="btn small" type="button" data-skill-act="enable" data-skill-id="' + id + '">启用</button>'
    : '<button class="btn small" type="button" data-skill-act="disable" data-skill-id="' + id + '">停用</button>';
  return '<div class="skill-row-actions">'
    + '<button class="btn small" type="button" data-skill-act="edit" data-skill-id="' + id + '">编辑</button>'
    + toggle
    + '<button class="btn small danger" type="button" data-skill-act="delete" data-skill-id="' + id + '">删除</button>'
    + '</div>';
}

function skillRow(skill) {
  return {
    attrs: {
      'data-filter-source': skill.source ?? 'builtin',
      'data-filter-status': skill.active === false ? 'inactive' : 'active',
    },
    cells: [
      `<strong>${esc(skill.name || skill.id)}</strong><div class="meta">${esc(skill.id)}</div>`,
      sourcePill(skill.source),
      activePill(skill.active !== false),
      `<div class="skill-desc">${esc(skill.description || '—')}</div>`,
      `<code class="skill-path">${esc(skill.path || '')}</code>`,
      actionButtons(skill),
    ],
  };
}

async function refreshSkills() {
  const list = document.getElementById('skillsList');
  if (!list) return;
  try {
    const data = await api('/api/extensions/skills');
    skillsCache = Array.isArray(data.skills) ? data.skills : [];
    if (!skillsCache.length) {
      list.innerHTML = '<div class="meta">还没有技能。把 SKILL.md 放到技能目录，或点「新增技能」「导入 ZIP」。</div>';
      return;
    }
    const active = skillsCache.filter((skill) => skill.active !== false).length;
    list.innerHTML = dataTableHtml({
      columns: [
        { label: '技能', width: '230px' },
        { label: '来源', width: '110px' },
        { label: '状态', width: '90px' },
        { label: '说明' },
        { label: '路径', width: '260px' },
        { label: '操作', width: '210px' },
      ],
      rows: skillsCache.map(skillRow),
      pageSize: 20,
      search: { placeholder: '搜索技能名、说明或路径…' },
      refresh: true,
      filters: [
        {
          id: 'source',
          label: '来源',
          options: [
            { value: 'all', label: '全部来源' },
            { value: 'user', label: '外部' },
            { value: 'external', label: '外部目录' },
            { value: 'dsh', label: 'DSH' },
            { value: 'repo', label: '仓库' },
          ],
        },
        {
          id: 'status',
          label: '状态',
          options: [
            { value: 'all', label: '全部状态' },
            { value: 'active', label: '启用' },
            { value: 'inactive', label: '停用' },
          ],
        },
      ],
      meta: `${skillsCache.length} 个技能 · ${active} 个启用`,
      actions: '<button class="btn" type="button" data-skill-import>导入 ZIP</button>'
        + '<button class="btn primary" type="button" data-skill-new>新增技能</button>',
    });
    initDataTables(list, { onRefresh: () => refreshSkills().catch(() => {}) });
  } catch (error) {
    list.innerHTML = `<div class="meta">读取失败：${esc(error.message)}</div>`;
  }
}

function overlayFor(kind) {
  const isImport = kind === 'import';
  const layer = document.createElement('div');
  layer.innerHTML = modalHtml({
    id: isImport ? 'skillImport' : 'skillEditor',
    title: isImport ? '导入技能 ZIP' : '技能',
    wide: true,
    body: `<div data-skills-fields="${isImport ? 'import' : 'edit'}"></div>`,
    footer: '<span class="modal-status" id="skillEditMsg"></span>'
      + '<button class="btn" type="button" data-modal-close>取消</button>'
      + `<button class="btn primary" type="button" id="${isImport ? 'skillImportSave' : 'skillEditSave'}">${isImport ? '导入' : '保存'}</button>`,
  });
  const el = layer.firstElementChild;
  document.body.appendChild(el);
  const host = el.querySelector(`[data-skills-fields="${isImport ? 'import' : 'edit'}"]`);
  renderFields(host, isImport ? SKILLS_FIELDS.import.fields : SKILLS_FIELDS.edit.fields, { columns: 2 });
  return el;
}

function fillEditor(layer, skill) {
  const idInput = layer.querySelector('#skillEditId');
  const content = layer.querySelector('#skillEditContent');
  const save = layer.querySelector('#skillEditSave');
  const editable = !skill || skill.editable === true;
  idInput.value = skill?.id ?? '';
  idInput.readOnly = Boolean(skill);
  content.value = skill?.content
    ?? '---\nname: 技能名\ndescription: 一句话说明\n---\n\n这里写技能正文。\n';
  content.readOnly = !editable;
  save.hidden = !editable;
  layer.querySelector('.modal-head h3').textContent = skill ? (editable ? `编辑技能 · ${skill.id}` : `查看技能 · ${skill.id}`) : '新增技能';
}

async function openEditor(id = '', viewOnly = false) {
  const layer = overlayFor('edit');
  let skill = null;
  if (id) {
    try {
      const data = await api(`/api/extensions/skills/${encodeURIComponent(id)}`);
      skill = { ...data.entry, content: data.content };
    } catch (error) {
      layer.remove();
      showConsoleToast(`读取技能失败：${error.message}`);
      return;
    }
  }
  fillEditor(layer, skill);
  if (viewOnly && skill) {
    const save = layer.querySelector('#skillEditSave');
    if (save) save.hidden = true;
  }
  openModal(layer);
  wireModal(layer, { onClose: () => layer.remove() });
}

async function saveEditor() {
  const layer = document.getElementById('skillEditor');
  if (!layer) return;
  const id = String(layer.querySelector('#skillEditId')?.value ?? '').trim();
  const content = String(layer.querySelector('#skillEditContent')?.value ?? '');
  if (!id) { showConsoleToast('请填写技能 ID'); return; }
  if (!content.trim()) { showConsoleToast('SKILL.md 不能为空'); return; }
  try {
    const idInput = layer.querySelector('#skillEditId');
    const editing = Boolean(idInput?.readOnly);
    if (editing) await api(`/api/extensions/skills/${encodeURIComponent(id)}`, 'PATCH', { content });
    else await api('/api/extensions/skills', 'POST', { id, content });
    showConsoleToast(editing ? '技能已保存' : '技能已创建');
    closeModal(layer);
    layer.remove();
    await refreshSkills();
  } catch (error) {
    showConsoleToast(`保存失败：${error.message}`);
  }
}

async function createSkill() {
  const layer = overlayFor('edit');
  fillEditor(layer, null);
  openModal(layer);
  wireModal(layer, { onClose: () => layer.remove() });
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function openImport() {
  const layer = overlayFor('import');
  openModal(layer);
  wireModal(layer, { onClose: () => layer.remove() });
  layer.querySelector('#skillImportSave').addEventListener('click', async () => {
    const file = layer.querySelector('#skillImportFile')?.files?.[0];
    if (!file) { showConsoleToast('请选择 ZIP 文件'); return; }
    if (file.size > 5 * 1024 * 1024) { showConsoleToast('ZIP 超过 5MB'); return; }
    try {
      const data = toBase64(await file.arrayBuffer());
      const id = String(layer.querySelector('#skillImportId')?.value ?? '').trim();
      await api('/api/extensions/skills/import', 'POST', { id, data });
      showConsoleToast('技能已导入');
      closeModal(layer);
      layer.remove();
      await refreshSkills();
    } catch (error) {
      showConsoleToast(`导入失败：${error.message}`);
    }
  });
}

async function handleAction(action, id) {
  if (action === 'view') { await openEditor(id, true); return; }
  if (action === 'edit') { await openEditor(id, false); return; }
  if (action === 'delete') {
    if (!confirm(`删除技能 ${id}？此操作不可撤销。`)) return;
    try {
      await api(`/api/extensions/skills/${encodeURIComponent(id)}`, 'DELETE');
      showConsoleToast('技能已删除');
      await refreshSkills();
    } catch (error) {
      showConsoleToast(`删除失败：${error.message}`);
    }
    return;
  }
  if (action === 'enable' || action === 'disable') {
    try {
      await api(`/api/extensions/skills/${encodeURIComponent(id)}`, 'PATCH', { active: action === 'enable' });
      showConsoleToast(action === 'enable' ? '技能已启用' : '技能已停用');
      await refreshSkills();
    } catch (error) {
      showConsoleToast(`操作失败：${error.message}`);
    }
  }
}

export function init() {
  document.querySelectorAll('[data-skills-fields]').forEach((host) => {
    const spec = SKILLS_FIELDS[host.dataset.skillsFields];
    if (spec) renderFields(host, spec.fields, { columns: 2 });
  });
  document.addEventListener('click', (event) => {
    const newBtn = event.target.closest('[data-skill-new]');
    if (newBtn) { createSkill().catch(() => {}); return; }
    const importBtn = event.target.closest('[data-skill-import]');
    if (importBtn) { openImport().catch(() => {}); return; }
    const act = event.target.closest('[data-skill-act]');
    if (act) {
      handleAction(act.dataset.skillAct, act.dataset.skillId).catch(() => {});
    }
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('#skillEditSave')) saveEditor().catch(() => {});
  });
  onPageRefresh('skills', () => { refreshSkills().catch(() => {}); });
  setInterval(() => { if (getCurrentPage() === 'skills' && !document.hidden) refreshSkills().catch(() => {}); }, 30_000);
  refreshSkills().catch(() => {});
}
