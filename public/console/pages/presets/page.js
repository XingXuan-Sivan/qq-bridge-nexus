// 预设页：列表 + 内联编辑（元数据 / extensions.yml / agent.cordis.yml）。
// 保存只改权威源；「应用」才调用 build-agent-preset-patches + setup-dsh。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { renderFields } from '../../components/form/form.js';
import { PRESETS_FIELDS } from './fields.js';

let presetsCache = [];
let editingId = '';
let originalYaml = '';
let busy = false;
let extensionCatalog = null;
let yamlEditor = null;

function setYamlEditorValue(value) {
  if (!yamlEditor) return;
  const current = yamlEditor.state.doc.toString();
  if (current === value) return;
  yamlEditor.dispatch({ changes: { from: 0, to: current.length, insert: value } });
}

function mountYamlEditor() {
  const textarea = document.getElementById('presetEditYaml');
  if (!textarea || yamlEditor || !window.ConsoleCM?.createEditor) return;
  const mount = document.createElement('div');
  mount.className = 'preset-yaml-mount';
  mount.id = 'presetYamlMount';
  textarea.parentNode.insertBefore(mount, textarea);
  textarea.hidden = true;
  yamlEditor = window.ConsoleCM.createEditor(mount, textarea.value, (value) => {
    textarea.value = value;
  });
}

function lines(value) {
  return String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

function pickerChecked(values, value) {
  return values.includes('*') || values.includes(value);
}

function catalogTools(catalog) {
  return (catalog?.mcp ?? []).flatMap((server) => (server.tools ?? []).map((tool) => ({
    server: server.id,
    name: tool.name,
    label: `${server.id}__${tool.name}`,
    description: tool.description ?? '',
    online: server.status === 'online',
  })));
}

function pickerGroup(title, key, items, values, { stalePrefix = '' } = {}) {
  const known = new Set(items.map((item) => item.value));
  const stale = values.filter((value) => value !== '*' && !known.has(value));
  const rows = items.map((item) => `
    <label class="preset-picker-item">
      <input type="checkbox" data-picker-group="${key}" value="${esc(item.value)}"${pickerChecked(values, item.value) ? ' checked' : ''}>
      <span><code>${esc(item.value)}</code>${item.note ? ` <span class="meta">${esc(item.note)}</span>` : ''}</span>
    </label>`).join('');
  const staleRows = stale.map((value) => `
    <label class="preset-picker-item preset-picker-stale">
      <input type="checkbox" data-picker-group="${key}" value="${esc(value)}" checked>
      <span><code>${esc(value)}</code> <span class="meta">${esc(stalePrefix)}当前未安装，保留</span></span>
    </label>`).join('');
  const wildcard = `
    <label class="preset-picker-wild">
      <input type="checkbox" data-picker-wild="${key}"${values.includes('*') ? ' checked' : ''}>
      全部允许（写入 *）
    </label>`;
  return `
    <div class="preset-picker-group">
      <div class="preset-picker-head"><strong>${esc(title)}</strong>${wildcard}</div>
      <div class="preset-picker-list">${rows || '<span class="meta">没有可选项</span>'}${staleRows}</div>
    </div>`;
}

function renderAuthPicker(extensions = {}) {
  const host = document.getElementById('presetAuthPicker');
  if (!host) return;
  const catalog = extensionCatalog;
  if (!catalog) {
    host.innerHTML = '<span class="meta">目录读取失败，下面仍可手写授权；点「刷新目录」重试。</span>';
    return;
  }
  const mcpValues = unique(extensions.mcp?.allow ?? []);
  const toolValues = unique(extensions.mcp?.tools?.allow ?? []);
  const skillValues = unique(extensions.skills?.allow ?? []);
  const servers = (catalog.mcp ?? []).map((server) => ({
    value: server.id,
    note: server.status === 'online' ? '在线' : '读取失败',
  }));
  const tools = catalogTools(catalog).map((tool) => ({ value: tool.label, note: tool.online ? '' : '服务不可用' }));
  const skills = (catalog.skills ?? []).map((skill) => ({
    value: skill.id,
    note: skill.source === 'dsh' ? 'DSH' : skill.source === 'repo' ? '仓库' : '外部',
  }));
  host.innerHTML = [
    '<div class="preset-picker-note"><span>勾选会写入下面的 allow 列表；<code>*</code> 表示全部。deny 仍走 YAML/文本框。</span><button class="btn small" type="button" id="presetAuthRefresh">刷新目录</button></div>',
    pickerGroup('MCP 服务器', 'mcp', servers, mcpValues),
    pickerGroup('MCP 工具', 'tools', tools, toolValues, { stalePrefix: '工具' }),
    pickerGroup('技能', 'skills', skills, skillValues, { stalePrefix: '技能' }),
  ].join('');
}

function syncAuthPicker() {
  const host = document.getElementById('presetAuthPicker');
  if (!host) return;
  const values = (group) => {
    if (host.querySelector(`[data-picker-wild="${group}"]`)?.checked) return ['*'];
    return unique([...host.querySelectorAll(`input[data-picker-group="${group}"]:checked`)].map((input) => input.value));
  };
  setField('presetEditMcpAllow', values('mcp').join('\n'));
  setField('presetEditMcpToolsAllow', values('tools').join('\n'));
  setField('presetEditSkillsAllow', values('skills').join('\n'));
}

async function refreshExtensionCatalog({ quiet = false } = {}) {
  try {
    const data = await api('/api/extensions');
    if (!data.ok) throw new Error(data.error || '读取扩展目录失败');
    extensionCatalog = data;
    if (!quiet) showConsoleToast('扩展目录已刷新');
    const editor = document.getElementById('presetEditor');
    if (editor && !editor.hidden) renderAuthPicker(readEditor().extensions);
  } catch (error) {
    if (!quiet) showConsoleToast(error?.message ?? '读取扩展目录失败', { tone: 'error' });
    extensionCatalog = null;
    renderAuthPicker();
  }
}

function authSummary(preset) {
  const ext = preset.extensions ?? { mcp: { allow: [], tools: { allow: [], deny: [] } }, skills: { allow: [] } };
  const mcp = ext.mcp?.allow?.length ? ext.mcp.allow.join(', ') : '无';
  const skills = ext.skills?.allow?.length ? ext.skills.allow.join(', ') : '无';
  return `<span class="meta">MCP：${esc(mcp)} · 技能：${esc(skills)}</span>`;
}

function actionButtons(preset) {
  const id = esc(preset.id);
  return '<div class="preset-row-actions">'
    + `<button class="btn small" type="button" data-preset-act="edit" data-preset-id="${id}">编辑</button>`
    + `<button class="btn small primary" type="button" data-preset-act="apply" data-preset-id="${id}">应用</button>`
    + `<button class="btn small danger" type="button" data-preset-act="rollback" data-preset-id="${id}">回滚</button>`
    + '</div>';
}

function row(preset) {
  return {
    cells: [
      `<strong>${esc(preset.id)}</strong>`,
      esc(preset.name || preset.id),
      `<span class="preset-desc">${esc(preset.description || '—')}</span>`,
      authSummary(preset),
      actionButtons(preset),
    ],
  };
}

function renderList() {
  const host = document.getElementById('presetList');
  if (!host) return;
  host.innerHTML = dataTableHtml({
    columns: [
      { label: '预设', width: '150px' },
      { label: '名称', width: '180px' },
      { label: '说明' },
      { label: '授权', width: '170px' },
      { label: '操作', width: '220px' },
    ],
    rows: presetsCache.map(row),
    pageSize: 10,
    search: false,
    refresh: true,
    meta: `${presetsCache.length} 个预设`,
    empty: '没有可管理的预设',
    actions: '',
  });
  initDataTables(host, { onRefresh: () => refreshPresets(true) });
}

function setField(name, value) {
  const el = document.getElementById(name);
  if (!el) return;
  el.value = value ?? '';
}

function readEditor() {
  return {
    meta: {
      name: document.getElementById('presetEditName')?.value.trim() ?? '',
      description: document.getElementById('presetEditDescription')?.value.trim() ?? '',
      order: Number(document.getElementById('presetEditOrder')?.value),
    },
    extensions: {
      mcp: {
        allow: lines(document.getElementById('presetEditMcpAllow')?.value),
        tools: {
          allow: lines(document.getElementById('presetEditMcpToolsAllow')?.value),
          deny: lines(document.getElementById('presetEditMcpToolsDeny')?.value),
        },
      },
      skills: { allow: lines(document.getElementById('presetEditSkillsAllow')?.value) },
    },
    yaml: document.getElementById('presetEditYaml')?.value ?? '',
  };
}

async function fillEditor(preset) {
  editingId = preset.id;
  originalYaml = preset.agentYaml ?? '';
  setField('presetEditName', preset.meta?.name ?? '');
  setField('presetEditDescription', preset.meta?.description ?? '');
  setField('presetEditOrder', preset.meta?.order ?? '');
  setField('presetEditMcpAllow', (preset.extensions?.mcp?.allow ?? []).join('\n'));
  setField('presetEditMcpToolsAllow', (preset.extensions?.mcp?.tools?.allow ?? []).join('\n'));
  setField('presetEditMcpToolsDeny', (preset.extensions?.mcp?.tools?.deny ?? []).join('\n'));
  setField('presetEditSkillsAllow', (preset.extensions?.skills?.allow ?? []).join('\n'));
  setField('presetEditYaml', originalYaml);
  setYamlEditorValue(originalYaml);
  await refreshExtensionCatalog({ quiet: true });
  renderAuthPicker(preset.extensions ?? {});
  document.getElementById('presetEditorTitle').textContent = `编辑预设 · ${preset.id}`;
  document.getElementById('presetEditorPath').textContent = `dsh/agent-presets/${preset.id}`;
  document.getElementById('presetEditMsg').textContent = preset.validation?.ok
    ? `YAML 校验通过（${preset.validation.rows} 个插件行）`
    : `YAML 有问题：${preset.validation?.error ?? '未知错误'}`;
  document.getElementById('presetEditor').hidden = false;
  document.getElementById('presetEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function openPreset(id) {
  if (busy) return;
  busy = true;
  try {
    const data = await api('/api/extensions/presets/' + encodeURIComponent(id));
    if (!data.ok) throw new Error(data.error || '读取预设失败');
    await fillEditor(data.preset);
  } catch (error) {
    showConsoleToast(error?.message ?? '读取预设失败', { tone: 'error' });
  } finally {
    busy = false;
  }
}

async function savePreset({ apply = false } = {}) {
  if (!editingId || busy) return null;
  const draft = readEditor();
  const yamlChanged = draft.yaml !== originalYaml;
  if (yamlChanged) {
    const check = await api('/api/extensions/presets/' + encodeURIComponent(editingId) + '/validate', 'POST', { yaml: draft.yaml });
    if (!check.ok || !check.validation?.ok) {
      document.getElementById('presetEditMsg').textContent = `未保存：${check.validation?.error ?? check.error ?? 'YAML 校验失败'}`;
      return null;
    }
  }
  if (!draft.meta.name || !draft.meta.description || !Number.isInteger(draft.meta.order)) {
    document.getElementById('presetEditMsg').textContent = '未保存：名称、说明、排序都必须填写（排序为整数）';
    return null;
  }
  busy = true;
  document.getElementById('presetEditMsg').textContent = '正在保存…';
  try {
    const meta = await api(`/api/extensions/presets/${encodeURIComponent(editingId)}/meta`, 'PUT', draft.meta);
    if (!meta.ok) throw new Error(meta.error || '保存元数据失败');
    const ext = await api(`/api/extensions/presets/${encodeURIComponent(editingId)}/extensions`, 'PUT', draft.extensions);
    if (!ext.ok) throw new Error(ext.error || '保存授权失败');
    if (yamlChanged) {
      const yaml = await api(`/api/extensions/presets/${encodeURIComponent(editingId)}/yaml`, 'PUT', { yaml: draft.yaml });
      if (!yaml.ok) throw new Error(yaml.error || '保存 YAML 失败');
      originalYaml = draft.yaml;
    }
    document.getElementById('presetEditMsg').textContent = apply ? '源文件已保存，正在应用…' : '源文件已保存；点「应用并安装」才会进入 DSH';
    showConsoleToast('预设源文件已保存');
    if (apply) {
      const result = await api(`/api/extensions/presets/${encodeURIComponent(editingId)}/apply`, 'POST', {});
      if (!result.ok) throw new Error(result.error || '应用失败');
      document.getElementById('presetEditMsg').textContent = '已应用：build + setup-dsh 完成；新会话使用新预设，已开始会话需重建';
      showConsoleToast('预设已应用');
    }
    await refreshPresets(true);
    return draft;
  } catch (error) {
    document.getElementById('presetEditMsg').textContent = `保存失败：${error?.message ?? error}`;
    showConsoleToast(error?.message ?? '保存失败', { tone: 'error' });
    return null;
  } finally {
    busy = false;
  }
}

async function validateYaml() {
  if (!editingId) return;
  const yaml = document.getElementById('presetEditYaml')?.value ?? '';
  try {
    const result = await api(`/api/extensions/presets/${encodeURIComponent(editingId)}/validate`, 'POST', { yaml });
    if (!result.ok) throw new Error(result.error || '校验失败');
    document.getElementById('presetEditMsg').textContent = result.validation?.ok
      ? `YAML 校验通过（${result.validation.rows} 个插件行）`
      : `YAML 有问题：${result.validation?.error}`;
  } catch (error) {
    document.getElementById('presetEditMsg').textContent = `校验失败：${error?.message ?? error}`;
  }
}

async function applyPreset(id) {
  if (busy || !confirm(`应用 ${id}？会重新生成 patch 并安装到 DSH。`)) return;
  busy = true;
  try {
    const result = await api(`/api/extensions/presets/${encodeURIComponent(id)}/apply`, 'POST', {});
    if (!result.ok) throw new Error(result.error || '应用失败');
    showConsoleToast('预设已应用；新会话生效，已开始会话需重建');
  } catch (error) {
    showConsoleToast(error?.message ?? '应用失败', { tone: 'error' });
  } finally {
    busy = false;
  }
}

async function rollbackPreset(id) {
  if (busy || !confirm(`回滚 ${id} 到上一版？会覆盖当前源文件并重新应用。`)) return;
  busy = true;
  try {
    const result = await api(`/api/extensions/presets/${encodeURIComponent(id)}/rollback`, 'POST', {});
    if (!result.ok) throw new Error(result.error || '回滚失败');
    showConsoleToast(`已回滚到 ${result.restored}`);
    await refreshPresets(true);
  } catch (error) {
    showConsoleToast(error?.message ?? '回滚失败', { tone: 'error' });
  } finally {
    busy = false;
  }
}

async function refreshPresets(showError = false) {
  try {
    const data = await api('/api/extensions/presets');
    if (!data.ok) throw new Error(data.error || '读取预设失败');
    presetsCache = data.presets ?? [];
    renderList();
  } catch (error) {
    if (showError) showConsoleToast(error?.message ?? '读取预设失败', { tone: 'error' });
  }
}

export function init() {
  const main = document.querySelector('[data-presets-fields="main"]');
  const edit = document.querySelector('[data-presets-fields="edit"]');
  if (main) renderFields(main, PRESETS_FIELDS.main.fields);
  if (edit) renderFields(edit, PRESETS_FIELDS.edit.fields);
  mountYamlEditor();

  document.getElementById('presetList')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-preset-act]');
    if (!button) return;
    const id = button.dataset.presetId;
    if (button.dataset.presetAct === 'edit') void openPreset(id);
    else if (button.dataset.presetAct === 'apply') void applyPreset(id);
    else if (button.dataset.presetAct === 'rollback') void rollbackPreset(id);
  });
  document.getElementById('presetValidate')?.addEventListener('click', () => void validateYaml());
  document.getElementById('presetSave')?.addEventListener('click', () => void savePreset());
  document.getElementById('presetApply')?.addEventListener('click', () => void savePreset({ apply: true }));
  document.getElementById('presetRollback')?.addEventListener('click', () => {
    if (editingId) void rollbackPreset(editingId);
  });
  document.getElementById('presetCancelEdit')?.addEventListener('click', () => {
    document.getElementById('presetEditor').hidden = true;
    editingId = '';
  });
  document.getElementById('presetAuthPicker')?.addEventListener('change', (event) => {
    if (event.target.matches('[data-picker-group], [data-picker-wild]')) syncAuthPicker();
  });
  document.getElementById('presetAuthPicker')?.addEventListener('click', (event) => {
    if (event.target.closest('#presetAuthRefresh')) void refreshExtensionCatalog();
  });
  onPageRefresh('presets', () => refreshPresets(true));
  void refreshPresets();
}

