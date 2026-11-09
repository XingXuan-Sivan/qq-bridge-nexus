// 预设页：列表 + 内联编辑（元数据 / extensions.yml / agent.cordis.yml）。
// 保存只改权威源；「应用」才调用 build-agent-preset-patches + setup-dsh。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { renderFields } from '../../components/form/form.js';
import { attachTextareaEditor } from '../../components/code-editor/code-editor.js';
import { PRESETS_FIELDS } from './fields.js';

let presetsCache = [];
let editingId = '';
let originalYaml = '';
let busy = false;
let extensionCatalog = null;
let yamlEditor = null;

function setYamlEditorValue(value) {
  if (!yamlEditor) return;
  yamlEditor.setValue(value);
}

function mountYamlEditor() {
  const textarea = document.getElementById('presetEditYaml');
  if (!textarea || yamlEditor) return;
  // 共享编辑器组件：整行铺满，编辑结果写回 textarea，保存/校验逻辑不用改。
  yamlEditor = attachTextareaEditor(textarea, { language: 'yaml', height: '460px' });
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

// MCP 工具按 server 分组：server 行是「全选该 server 的工具」的三态复选框，
// 工具行单独勾选；写回时仍是一个扁平 allow 列表（server__tool），与旧数据结构兼容。
function toolPickerGroup(items, values) {
  const groups = new Map();
  for (const item of items) {
    const server = item.value.includes('__') ? item.value.slice(0, item.value.indexOf('__')) : '（未分组）';
    if (!groups.has(server)) groups.set(server, []);
    groups.get(server).push(item);
  }
  const known = new Set(items.map((item) => item.value));
  const stale = values.filter((value) => value !== '*' && !known.has(value));
  const body = [...groups.entries()].map(([server, list]) => {
    const rows = list.map((item) => {
      const short = item.value.includes('__') ? item.value.slice(item.value.indexOf('__') + 2) : item.value;
      return `<label class="preset-picker-item preset-picker-tool">
        <input type="checkbox" data-picker-group="tools" data-picker-owner="${esc(server)}" value="${esc(item.value)}"${pickerChecked(values, item.value) ? ' checked' : ''}>
        <span><code>${esc(short)}</code>${item.note ? ` <span class="meta">${esc(item.note)}</span>` : ''}</span>
      </label>`;
    }).join('');
    return `<div class="preset-picker-server">
      <label class="preset-picker-server-head">
        <input type="checkbox" data-picker-server-all="${esc(server)}">
        <strong>${esc(server)}</strong><span class="meta">${list.length} 个工具</span>
      </label>
      <div class="preset-picker-tools">${rows}</div>
    </div>`;
  }).join('');
  const staleRows = stale.map((value) => `
    <label class="preset-picker-item preset-picker-stale">
      <input type="checkbox" data-picker-group="tools" value="${esc(value)}" checked>
      <span><code>${esc(value)}</code> <span class="meta">工具当前未安装，保留</span></span>
    </label>`).join('');
  return `
    <div class="preset-picker-group">
      <div class="preset-picker-head"><strong>MCP 工具</strong>${`<label class="preset-picker-wild"><input type="checkbox" data-picker-wild="tools"${values.includes('*') ? ' checked' : ''}> 全部允许（写入 *）</label>`}</div>
      <div class="preset-picker-list">${body || '<span class="meta">没有可选项</span>'}${staleRows}</div>
      <div class="meta preset-picker-note">按 server 勾选会级联到它下面的工具；deny 仍走 YAML/文本框。</div>
    </div>`;
}

// 勾了「全部允许（*）」时细分勾选不生效：直接禁用并压暗，避免「勾了却没用」。
function syncToolDisabled(host = document.getElementById('presetAuthPicker')) {
  if (!host) return;
  const wild = host.querySelector('[data-picker-wild="tools"]');
  const locked = Boolean(wild?.checked);
  host.querySelectorAll('[data-picker-group="tools"], [data-picker-server-all]').forEach((input) => { input.disabled = locked; });
  host.querySelectorAll('.preset-picker-tools').forEach((box) => box.classList.toggle('is-disabled', locked));
}

// 让每个 server 的三态复选框跟上工具勾选状态。
function syncToolServerChecks(host = document.getElementById('presetAuthPicker')) {
  if (!host) return;
  host.querySelectorAll('[data-picker-server-all]').forEach((box) => {
    const owner = box.dataset.pickerServerAll;
    const tools = [...host.querySelectorAll(`[data-picker-owner="${CSS.escape(owner)}"]`)];
    const checked = tools.filter((tool) => tool.checked).length;
    box.checked = tools.length > 0 && checked === tools.length;
    box.indeterminate = checked > 0 && checked < tools.length;
  });
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
    toolPickerGroup(tools, toolValues),
    pickerGroup('技能', 'skills', skills, skillValues, { stalePrefix: '技能' }),
  ].join('');
  syncToolServerChecks(host);
  syncToolDisabled(host);
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

// ── 仿真提示词（预设内置 persona.prefix；保存后需重启 DSH）────────────────
// 从人格页搬过来：它属于预设而不是人格，放在 YAML 高级编辑上方，改的是同一份源文件。
const PROMPT_PRESETS = new Set(['qq-chat', 'qq-chat-v2']);
let promptEditor = null;
let promptPreset = '';
let promptOriginal = '';

function promptEl(id) { return document.getElementById(id); }

function setPromptMsg(text, tone) {
  const el = promptEl('simPromptMsg');
  if (!el) return;
  el.textContent = text;
  el.className = tone === 'ok' ? 'meta ok' : tone === 'err' ? 'meta err' : 'meta';
}

function setPromptEditing(editing) {
  promptEl('simPromptEdit').disabled = editing;
  promptEl('simPromptSave').disabled = !editing;
  promptEl('simPromptCancel').disabled = !editing;
  promptEditor?.setReadOnly(!editing);
}

function mountPromptEditor() {
  const textarea = promptEl('simPromptText');
  if (!textarea || promptEditor) return;
  promptEditor = attachTextareaEditor(textarea, { language: 'text', height: '420px', readOnly: true });
}

async function refreshPresetPrompt(id) {
  const card = promptEl('presetPrompt');
  if (!card) return;
  const supported = PROMPT_PRESETS.has(id);
  card.hidden = !supported;
  if (!supported) { promptPreset = ''; delete card.dataset.preset; return; }
  promptPreset = id;
  setPromptMsg('读取中…');
  try {
    const r = await api('/api/preset/sim-prompt?preset=' + encodeURIComponent(id));
    if (!r.ok) { setPromptMsg(r.error || '读取失败', 'err'); return; }
    promptOriginal = r.content ?? '';
    promptEditor?.setValue(promptOriginal);
    setPromptEditing(false);
    setPromptMsg('');
    promptEl('presetPromptStatus').textContent =
      `${r.chars} 字符 · ${r.status?.installed ? '已同步到 DSH' : '尚未同步到 DSH'}`
      + (r.hasDefault && !r.modified ? ' · 初始版本' : '');
    promptEl('simPromptWarnings').textContent = (r.warnings ?? []).length
      ? '⚠️ ' + r.warnings.join('；') : '';
    promptEl('simPromptReset').disabled = !r.hasDefault || !r.modified;
    // 给测试与样式一个「这次卡片内容属于哪个预设」的确定信号（异步回填完成才置位）。
    card.dataset.preset = id;
  } catch (error) {
    setPromptMsg('读取失败：' + (error?.message ?? error), 'err');
  }
}

async function savePresetPrompt() {
  if (!promptPreset || busy) return;
  busy = true;
  setPromptMsg('保存中…');
  try {
    const r = await api('/api/preset/sim-prompt', 'POST', { preset: promptPreset, content: promptEditor?.getValue() ?? '' });
    if (!r.ok) { setPromptMsg(r.error || '保存失败', 'err'); return; }
    const preset = promptPreset;
    await refreshPresetPrompt(preset);
    setPromptMsg(r.unchanged ? '内容没有变化' : `已保存（${r.chars} 字符），重启 DSH 生效`, 'ok');
  } catch (error) {
    setPromptMsg('保存失败：' + (error?.message ?? error), 'err');
  } finally {
    busy = false;
  }
}

async function resetPresetPrompt() {
  if (!promptPreset || busy) return;
  const ok = window.confirm('还原成发布包自带的初始提示词？当前内容会先备份到 state/preset-backups/，可再回滚。');
  if (!ok) return;
  busy = true;
  setPromptMsg('还原中…');
  try {
    const preset = promptPreset;
    const r = await api('/api/preset/sim-prompt/reset', 'POST', { preset });
    if (!r.ok) { setPromptMsg(r.error || '还原失败', 'err'); return; }
    await refreshPresetPrompt(preset);
    setPromptMsg(`已还原初始版本（${r.chars} 字符），重启 DSH 生效`, 'ok');
  } catch (error) {
    setPromptMsg('还原失败：' + (error?.message ?? error), 'err');
  } finally {
    busy = false;
  }
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
  await refreshPresetPrompt(preset.id);
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
  const promptSlot = document.querySelector('[data-presets-fields="simPrompt"]');
  if (promptSlot) renderFields(promptSlot, PRESETS_FIELDS.simPrompt.fields);
  mountYamlEditor();
  // 仿真提示词卡在字段规格里只是一个占位（presetPromptSlot），渲染后把卡片搬进去，
  // 位置就固定在「YAML 高级编辑」区块上方。
  const promptMount = document.getElementById('presetPromptMount');
  const promptCard = document.getElementById('presetPrompt');
  if (promptMount && promptCard) promptMount.appendChild(promptCard);
  mountPromptEditor();
  document.getElementById('simPromptEdit')?.addEventListener('click', () => setPromptEditing(true));
  document.getElementById('simPromptSave')?.addEventListener('click', () => void savePresetPrompt());
  document.getElementById('simPromptCancel')?.addEventListener('click', () => {
    promptEditor?.setValue(promptOriginal);
    setPromptEditing(false);
    setPromptMsg('已取消编辑');
  });
  document.getElementById('simPromptReset')?.addEventListener('click', () => void resetPresetPrompt());

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
    const target = event.target;
    const host = document.getElementById('presetAuthPicker');
    if (!host) return;
    // 勾 server 行 = 级联勾选它下面的所有工具；再统一刷新三态与 allow 列表。
    if (target.matches('[data-picker-server-all]')) {
      const owner = target.dataset.pickerServerAll;
      host.querySelectorAll(`[data-picker-owner="${CSS.escape(owner)}"]`).forEach((input) => { input.checked = target.checked; });
    }
    if (target.matches('[data-picker-group], [data-picker-wild], [data-picker-server-all]')) {
      syncAuthPicker();
      syncToolServerChecks(host);
      syncToolDisabled(host);
    }
  });
  document.getElementById('presetAuthPicker')?.addEventListener('click', (event) => {
    if (event.target.closest('#presetAuthRefresh')) void refreshExtensionCatalog();
  });
  onPageRefresh('presets', () => refreshPresets(true));
  void refreshPresets();
}

