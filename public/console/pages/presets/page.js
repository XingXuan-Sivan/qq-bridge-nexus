// 预设页：列表 + 内联编辑（元数据 / extensions.yml / agent.cordis.yml）。
// 保存只改权威源；「应用」才调用 build-agent-preset-patches + setup-dsh。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { dataTableHtml, initDataTables, selectCellHtml } from '../../components/table/table.js';
import { onPageRefresh } from '../../js/router.js';
import { bindSwitches, renderFields } from '../../components/form/form.js';
import { attachTextareaEditor } from '../../components/code-editor/code-editor.js';
import { PRESETS_FIELDS } from './fields.js';
import { modalHtml, openModal, wireModal } from '../../components/modal/modal.js';

let presetsCache = [];
let editingId = '';
let busy = false;
let extensionCatalog = null;

// 授权草稿：复选框/下拉只改这里，保存时整体写回 extensions.yml。
// 用 Set 而不是每次从 DOM 反推，目录里暂时没有的旧条目（stale）才不会在保存时丢掉。
const auth = {
  mcpWild: false,
  servers: new Set(),
  toolsWild: false,
  toolAllow: new Set(),
  toolDeny: new Set(),
  skillsWild: false,
  skills: new Set(),
};

function lines(value) {
  return String(value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
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

// ── 授权草稿 ────────────────────────────────────────────────────────────────
function allServerIds() {
  return [...new Set([...(extensionCatalog?.mcp ?? []).map((server) => server.id), ...auth.servers])];
}

function allSkillIds() {
  return [...new Set([...(extensionCatalog?.skills ?? []).map((skill) => skill.id), ...auth.skills])];
}

function resetAuthDraft(extensions = {}) {
  const mcp = unique(extensions.mcp?.allow ?? []);
  const toolAllow = unique(extensions.mcp?.tools?.allow ?? []);
  const toolDeny = unique(extensions.mcp?.tools?.deny ?? []);
  const skills = unique(extensions.skills?.allow ?? []);
  auth.mcpWild = mcp.includes('*');
  auth.servers = new Set(mcp.filter((value) => value !== '*'));
  auth.toolsWild = toolAllow.includes('*');
  auth.toolAllow = new Set(toolAllow.filter((value) => value !== '*'));
  auth.toolDeny = new Set(toolDeny.filter((value) => value !== '*'));
  auth.skillsWild = skills.includes('*');
  auth.skills = new Set(skills.filter((value) => value !== '*'));
}

// 写回时按目录顺序排：勾选顺序不该影响 extensions.yml 的 diff。
function catalogOrder(values, ids) {
  const order = new Map(ids.map((id, index) => [id, index]));
  return [...values].sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
}

export function authExtensions() {
  const serverIds = (extensionCatalog?.mcp ?? []).map((server) => server.id);
  const skillIds = (extensionCatalog?.skills ?? []).map((skill) => skill.id);
  const toolLabels = catalogTools(extensionCatalog).map((tool) => tool.label);
  return {
    mcp: {
      allow: auth.mcpWild ? ['*'] : catalogOrder(auth.servers, serverIds),
      tools: {
        allow: auth.toolsWild ? ['*'] : catalogOrder(auth.toolAllow, toolLabels),
        deny: catalogOrder(auth.toolDeny, toolLabels),
      },
    },
    skills: { allow: auth.skillsWild ? ['*'] : catalogOrder(auth.skills, skillIds) },
  };
}

function catalogMissing(host) {
  host.innerHTML = `<p class="meta">目录读取失败，授权表暂不可用。<button class="btn small" type="button" data-auth-refresh>重试</button></p>`;
}

function tableOf(rows, columns, meta, select = null, actions = '', refresh = false) {
  // 固定每页 10 条：授权表里工具可能有几十个，之前按 rows.length 当页大小导致「总是全显示」。
  return dataTableHtml({ columns, rows, pageSize: 10, meta, select, actions, refresh });
}

function renderServers() {
  const host = document.getElementById('presetMcpServers');
  if (!host) return;
  if (!extensionCatalog) { catalogMissing(host); return; }
  const servers = extensionCatalog.mcp ?? [];
  const known = new Set(servers.map((server) => server.id));
  const rows = servers.map((server) => ({
    cells: [
      selectCellHtml({
        value: server.id,
        checked: auth.mcpWild || auth.servers.has(server.id),
        label: `允许 ${server.id}`,
        attrs: { 'data-auth-server': server.id },
      }),
      `<code>${esc(server.id)}</code>`,
      server.source === 'external' ? '外部' : '内置',
      server.status === 'online' ? '在线' : '不可用',
      String(server.toolCount ?? server.tools?.length ?? 0),
    ],
  }));
  // 目录里已经没有、但文件里仍写着的 server：保留显示，取消勾选即删除。
  for (const value of auth.servers) {
    if (known.has(value)) continue;
    rows.push({
      cells: [
        selectCellHtml({
          value,
          checked: true,
          label: `允许 ${value}`,
          attrs: { 'data-auth-server': value },
        }),
        `<code>${esc(value)}</code>`,
        '<span class="meta">目录中未找到</span>',
        '<span class="meta">保留原值</span>',
        '—',
      ],
    });
  }
  host.innerHTML = rows.length
    ? tableOf(rows, [
      { label: '服务器' },
      { label: '来源', width: '90px' },
      { label: '状态', width: '110px' },
      { label: '工具数', width: '80px' },
    ], `${servers.length} 个 server`, {
      label: '授权',
      attrs: { 'data-select-group': 'servers' },
    }, '', { label: '刷新目录', attrs: { 'data-auth-refresh': '' } })
    : '<p class="meta">目录里没有 MCP 服务器。</p>';
  initDataTables(host);
}

function allowedServers() {
  return (extensionCatalog?.mcp ?? []).filter((server) => auth.mcpWild || auth.servers.has(server.id));
}

function renderStaleTools() {
  const known = new Set(catalogTools(extensionCatalog).map((tool) => tool.label));
  const stale = [...new Set([...auth.toolAllow, ...auth.toolDeny])].filter((value) => !known.has(value));
  if (!stale.length) return '';
  const rows = stale.map((value) => {
    const state = auth.toolAllow.has(value) ? '允许' : '拒绝';
    return {
      cells: [
        `<code>${esc(value)}</code>`,
        `<span class="meta">${state}</span>`,
        `<button class="btn small danger" type="button" data-auth-tool-remove="${esc(value)}">移除</button>`,
      ],
    };
  });
  return `<div class="preset-auth-stale"><p class="meta">下面这些工具在当前目录里找不到（server 离线或已卸载），保存时会原样保留；点「移除」才会删掉。</p>`
    + tableOf(rows, [{ label: '工具条目', width: '320px' }, { label: '状态', width: '90px' }, { label: '操作', width: '90px' }], `${rows.length} 个保留项`)
    + '</div>';
}

// 工具表：只列「上面已允许的 server」的工具；勾上=允许，不勾=拒绝（拒绝优先于允许）。
function renderTools() {
  const host = document.getElementById('presetMcpTools');
  if (!host) return;
  if (!extensionCatalog) { catalogMissing(host); return; }
  const servers = allowedServers();
  const rows = [];
  for (const server of servers) {
    for (const tool of server.tools ?? []) {
      const label = `${server.id}__${tool.name}`;
      rows.push({
        cells: [
          selectCellHtml({
            value: label,
            checked: auth.toolsWild ? !auth.toolDeny.has(label) : auth.toolAllow.has(label) && !auth.toolDeny.has(label),
            label: `允许 ${label}`,
            attrs: { 'data-auth-tool': label, 'data-auth-server': server.id },
          }),
          `<code>${esc(server.id)}</code>`,
          `<code>${esc(tool.name)}</code>`,
          `<span class="preset-tool-desc">${esc(tool.description || '—')}</span>`,
        ],
      });
    }
  }
  host.innerHTML = (rows.length
    ? tableOf(rows, [
      { label: '服务器' },
      { label: '工具', width: '220px' },
      { label: '说明' },
    ], `${rows.length} 个工具`, { label: '授权', attrs: { 'data-select-group': 'tools' } })
    : `<p class="meta">${servers.length ? '这些 server 没有暴露工具。' : '还没有允许任何 MCP 服务器。'}</p>`)
    + renderStaleTools();
  initDataTables(host);
}

function renderSkills() {
  const host = document.getElementById('presetSkills');
  if (!host) return;
  if (!extensionCatalog) { catalogMissing(host); return; }
  const skills = extensionCatalog.skills ?? [];
  const known = new Set(skills.map((skill) => skill.id));
  const rows = skills.map((skill) => ({
    cells: [
      selectCellHtml({
        value: skill.id,
        checked: auth.skillsWild || auth.skills.has(skill.id),
        label: `允许 ${skill.id}`,
        attrs: { 'data-auth-skill': skill.id },
      }),
      `<code>${esc(skill.id)}</code>`,
      skill.source === 'dsh' ? 'DSH' : skill.source === 'repo' ? '仓库' : '外部',
      `<span class="preset-tool-desc">${esc(skill.description || '—')}</span>`,
    ],
  }));
  for (const value of auth.skills) {
    if (known.has(value)) continue;
    rows.push({
      cells: [
        selectCellHtml({ value, checked: true, label: `允许 ${value}`, attrs: { 'data-auth-skill': value } }),
        `<code>${esc(value)}</code>`,
        '<span class="meta">目录中未找到</span>',
        '<span class="meta">保留原值</span>',
      ],
    });
  }
  host.innerHTML = rows.length
    ? tableOf(rows, [
      { label: '技能', width: '220px' },
      { label: '来源', width: '90px' },
      { label: '说明' },
    ], `${skills.length} 个技能`, { label: '授权', attrs: { 'data-select-group': 'skills' } })
    : '<p class="meta">目录里没有技能。</p>';
  initDataTables(host);
}

function renderAuth() {
  renderServers();
  renderTools();
  renderSkills();
}

async function refreshExtensionCatalog({ quiet = false } = {}) {
  try {
    const data = await api('/api/extensions');
    if (!data.ok) throw new Error(data.error || '读取扩展目录失败');
    extensionCatalog = data;
    if (!quiet) showConsoleToast('扩展目录已刷新');
    renderAuth();
  } catch (error) {
    if (!quiet) showConsoleToast(error?.message ?? '读取扩展目录失败', { tone: 'error' });
    extensionCatalog = null;
    renderAuth();
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
  const remove = preset.builtin
    ? `<button class="btn small" type="button" data-preset-act="clone" data-preset-id="${id}">克隆</button>`
    : `<button class="btn small danger" type="button" data-preset-act="delete" data-preset-id="${id}">删除</button>`;
  const edit = preset.builtin
    ? `<button class="btn small" type="button" data-preset-act="edit" data-preset-id="${id}" title="内置只读，编辑会提示先克隆">查看</button>`
    : `<button class="btn small" type="button" data-preset-act="edit" data-preset-id="${id}">编辑</button>`;
  return '<div class="preset-row-actions">'
    + edit
    + `<button class="btn small primary" type="button" data-preset-act="apply" data-preset-id="${id}">应用</button>`
    + remove
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
    search: { placeholder: '搜索预设 id、名称或说明…' },
    refresh: true,
    meta: `${presetsCache.length} 个预设（内置 ${presetsCache.filter((p) => p.builtin).length} 个）`,
    empty: '没有可管理的预设',
    actions: '<button class="btn primary" type="button" id="presetNewOpen">新建预设</button>',
  });
  initDataTables(host, { onRefresh: () => refreshPresets(true) });
  host.querySelector('#presetNewOpen')?.addEventListener('click', () => openCreatePresetModal());
}

function setField(name, value) {
  const el = document.getElementById(name);
  if (!el) return;
  el.value = value ?? '';
}

// ── 仿真提示词（预设内置 persona.prefix；保存后需重启 DSH）────────────────
// 从人格页搬过来：它属于预设而不是人格，放在 YAML 高级编辑上方，改的是同一份源文件。
// 所有预设都能编辑（qq-agent-* 与自建预设的 persona.prefix 可能很短甚至是空的）。
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
  if (!id) { card.hidden = true; promptPreset = ''; delete card.dataset.preset; return; }
  card.hidden = false;
  promptPreset = id;
  setPromptMsg('读取中…');
  try {
    const r = await api('/api/preset/sim-prompt?preset=' + encodeURIComponent(id));
    // 连续点不同预设时，慢的响应不能覆盖后选中的那个。
    if (promptPreset !== id) return;
    if (!r.ok) { setPromptMsg(r.error || '读取失败', 'err'); return; }
    promptOriginal = r.content ?? '';
    promptEditor?.setValue(promptOriginal);
    setPromptEditing(false);
    setPromptMsg('');
    promptEl('presetPromptStatus').textContent =
      `${r.status?.label ?? '预设'} · ${r.chars} 字符 · ${r.status?.installed ? '已同步到 DSH' : '尚未同步到 DSH'}`
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

// ── 插件配置（agent.cordis.yml 全文）──────────────────────────────────────
// 配置项数量多、还会随插件版本变化，逐项表单化成本高且容易漏；改成整份 YAML 编辑器，
// 后端保存时仍走同一套校验（非空数组、每行 id/name、必须含 persona 与 qq-tool-restrict）。
let agentYamlEditor = null;
let agentYamlPreset = '';
let agentYamlOriginal = '';

function agentYamlEl(id) { return document.getElementById(id); }

function setAgentYamlMsg(text, tone) {
  const el = agentYamlEl('agentYamlMsg');
  if (!el) return;
  el.textContent = text;
  el.className = tone === 'ok' ? 'meta ok' : tone === 'err' ? 'meta err' : 'meta';
}

function setAgentYamlEditing(editing) {
  agentYamlEl('agentYamlEdit').disabled = editing;
  agentYamlEl('agentYamlSave').disabled = !editing;
  agentYamlEl('agentYamlCancel').disabled = !editing;
  agentYamlEditor?.setReadOnly(!editing);
}

function mountAgentYamlEditor() {
  const textarea = agentYamlEl('presetAgentYamlText');
  if (!textarea || agentYamlEditor) return;
  agentYamlEditor = attachTextareaEditor(textarea, { language: 'yaml', height: '460px', readOnly: true });
}

function fillAgentYaml(preset) {
  agentYamlPreset = preset.id;
  agentYamlOriginal = preset.agentYaml ?? '';
  agentYamlEditor?.setValue(agentYamlOriginal);
  setAgentYamlEditing(false);
  agentYamlEl('presetAgentYamlStatus').textContent = preset.validation?.ok
    ? `${preset.validation.rows} 个插件行 · dsh/agent-presets/${preset.id}/agent.cordis.yml`
    : `配置有问题：${preset.validation?.error ?? '未知错误'}`;
  setAgentYamlMsg('');
}

async function saveAgentYaml() {
  if (!agentYamlPreset || busy) return;
  const yaml = agentYamlEditor?.getValue() ?? '';
  if (yaml.trim() === agentYamlOriginal.trim()) {
    setAgentYamlMsg('内容没有变化');
    setAgentYamlEditing(false);
    return;
  }
  busy = true;
  setAgentYamlMsg('保存中…');
  try {
    const r = await api(`/api/extensions/presets/${encodeURIComponent(agentYamlPreset)}/yaml`, 'PUT', { yaml });
    if (!r.ok) { setAgentYamlMsg(r.error || '保存失败', 'err'); return; }
    agentYamlOriginal = yaml;
    setAgentYamlEditing(false);
    setAgentYamlMsg(`已保存（${r.validation?.rows ?? '?'} 个插件行），重启 DSH 生效`, 'ok');
    showConsoleToast('插件配置已保存');
    await refreshPresets(true);
  } catch (error) {
    setAgentYamlMsg('保存失败：' + (error?.message ?? error), 'err');
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
    extensions: authExtensions(),
  };
}

async function fillEditor(preset) {
  editingId = preset.id;
  setField('presetEditName', preset.meta?.name ?? '');
  setField('presetEditDescription', preset.meta?.description ?? '');
  setField('presetEditOrder', preset.meta?.order ?? '');
  resetAuthDraft(preset.extensions ?? {});
  fillAgentYaml(preset);
  await refreshExtensionCatalog({ quiet: true });
  document.getElementById('presetEditorTitle').textContent = `编辑预设 · ${preset.id}`;
  document.getElementById('presetEditorPath').textContent = `dsh/agent-presets/${preset.id}`;
  document.getElementById('presetEditMsg').textContent = preset.validation?.ok
    ? `插件配置已载入（${preset.validation.rows} 个插件行）`
    : `插件配置有问题：${preset.validation?.error ?? '未知错误'}`;
  document.getElementById('presetEditor').hidden = false;
  // 自建预设没有出厂版本：还原按钮只对系统自带预设展示。
  const builtin = Boolean(presetsCache.find((item) => item.id === preset.id)?.builtin);
  const factoryButton = document.getElementById('presetFactory');
  if (factoryButton) factoryButton.hidden = !builtin;
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

function setCreateMsg(text, tone = 'info') {
  const el = document.getElementById('presetNewMsg');
  if (!el) return;
  el.textContent = text;
  el.className = tone === 'error' ? 'meta err' : (tone === 'ok' ? 'meta ok' : 'meta');
}

// 新建预设：与其它页面同一套字段规格 + 同一套弹窗排版（.field-block / .field-row / .field-notes）。
function newPresetFields() {
  const options = [{ value: '', label: '空白预设（不复制，含最小骨架）' }].concat(
    presetsCache.map((preset) => ({ value: preset.id, label: `${preset.id} · ${preset.name || preset.id}` })),
  );
  return [
    {
      name: 'presetNewId',
      type: 'text',
      label: '预设 id',
      placeholder: 'my-preset',
      hint: '只能用小写字母、数字与连字符，且以字母或数字开头；它就是目录名。',
    },
    {
      name: 'presetNewName',
      type: 'text',
      label: '名称',
      placeholder: '留空则用「来源名（副本）」',
      hint: '空白预设必须填写名称。',
    },
    {
      name: 'presetNewFrom',
      type: 'select',
      label: '创建方式',
      options,
      hint: '选一个现有预设会整份复制它的 preset.yml / extensions.yml / agent.cordis.yml。',
    },
  ];
}

function openCreatePresetModal(source = null) {
  const existing = document.getElementById('presetCreateModal');
  if (existing) { openModal(existing); return; }
  document.body.insertAdjacentHTML('beforeend', modalHtml({
    id: 'presetCreateModal',
    title: '新建预设',
    wide: true,
    body: '<div class="form-stack" id="presetNewFields"></div><p class="meta" id="presetNewMsg" role="status"></p>',
    footer: '<button class="btn" type="button" data-modal-close>取消</button><button class="btn primary" type="button" id="presetNewCreate">创建</button>',
  }));
  const overlay = document.getElementById('presetCreateModal');
  renderFields(overlay.querySelector('#presetNewFields'), newPresetFields(), { layout: 'inline', columns: 1 });
  if (source) {
    const idInput = overlay.querySelector('#presetNewId');
    const nameInput = overlay.querySelector('#presetNewName');
    const fromSelect = overlay.querySelector('#presetNewFrom');
    if (idInput) idInput.value = `${source.id}-copy`;
    if (nameInput) nameInput.value = `${source.name || source.id}（副本）`;
    if (fromSelect) fromSelect.value = source.id;
  }
  wireModal(overlay, { onClose: () => overlay.remove() });
  overlay.querySelector('#presetNewCreate').addEventListener('click', () => void createPresetFromForm());
  openModal(overlay);
  overlay.querySelector('#presetNewId').focus();
}

async function createPresetFromForm() {
  if (busy) return;
  const id = document.getElementById('presetNewId')?.value.trim() ?? '';
  const name = document.getElementById('presetNewName')?.value.trim() ?? '';
  const from = document.getElementById('presetNewFrom')?.value ?? '';
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
    setCreateMsg('id 只能用小写字母、数字与连字符，且以字母或数字开头', 'error');
    return;
  }
  if (!from && !name) {
    setCreateMsg('空白预设需要填写名称；也可以选一个现有预设作为模板', 'error');
    return;
  }
  busy = true;
  setCreateMsg('正在创建…');
  try {
    const result = await api('/api/extensions/presets/create', 'POST', {
      id,
      from: from || undefined,
      name: name || undefined,
    });
    if (!result.ok) throw new Error(result.error || '创建失败');
    setCreateMsg(`已创建 ${result.id}；正在打开编辑…`, 'ok');
    document.getElementById('presetCreateModal')?.remove();
    await refreshPresets(true);
    await openPreset(result.id);
  } catch (error) {
    setCreateMsg(error?.message ?? '创建失败', 'error');
  } finally {
    busy = false;
  }
}

// 删除自建预设：先确认，后端会先整份备份再删目录；自带预设后端直接拒绝。
async function deletePreset(id) {
  const preset = presetsCache.find((item) => item.id === id);
  if (!preset || preset.builtin) return;
  if (!confirm(`删除预设「${preset.name || id}」（${id}）？删除前会自动备份到 state/preset-editor-backups。`)) return;
  busy = true;
  try {
    const result = await api(`/api/extensions/presets/${encodeURIComponent(id)}`, 'DELETE');
    if (!result.ok) throw new Error(result.error || '删除失败');
    showConsoleToast(`已删除 ${id}`);
    if (editingId === id) {
      editingId = '';
      document.getElementById('presetEditor').hidden = true;
    }
    await refreshPresets(true);
  } catch (error) {
    showConsoleToast(error?.message ?? '删除失败', { tone: 'error' });
  } finally {
    busy = false;
  }
}

async function restoreFactoryPreset() {
  if (!editingId || busy) return;
  if (!confirm(`把 ${editingId} 还原为出厂版本？当前源文件会先备份到 state/preset-editor-backups。`)) return;
  busy = true;
  document.getElementById('presetEditMsg').textContent = '正在还原出厂版本…';
  try {
    const result = await api(`/api/extensions/presets/${encodeURIComponent(editingId)}/factory`, 'POST', {});
    if (!result.ok) throw new Error(result.error || '还原失败');
    showConsoleToast('已还原出厂版本；点「应用并安装」后生效');
    await refreshPresets(true);
    await openPreset(editingId);
  } catch (error) {
    document.getElementById('presetEditMsg').textContent = `还原失败：${error?.message ?? error}`;
    showConsoleToast(error?.message ?? '还原失败', { tone: 'error' });
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

// ── 授权区事件（委托到编辑容器：卡里的表格会整块重渲染）────────────────────
function onAuthChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  // 表头全选框（组件已把它管辖的行勾好，这里按 DOM 的最终勾选态回写草稿）。
  if (target.matches('[data-select-all]')) {
    const group = target.dataset.selectGroup;
    const on = target.checked;
    if (group === 'servers') {
      auth.mcpWild = on;
      auth.servers = new Set(on ? allServerIds() : []);
      renderServers();
      renderTools();
    } else if (group === 'tools') {
      auth.toolsWild = on;
      auth.toolAllow.clear();
      auth.toolDeny.clear();
      renderTools();
    } else if (group === 'skills') {
      auth.skillsWild = on;
      auth.skills = new Set(on ? allSkillIds() : []);
      renderSkills();
    }
    return;
  }
  if (target.matches('input[data-auth-tool]')) {
    const label = target.dataset.authTool;
    if (target.checked) {
      auth.toolDeny.delete(label);
      auth.toolAllow.add(label);
    } else if (auth.toolsWild) {
      // allow 仍是 *：用 deny 表达「这一个不要」，新加的工具仍然默认允许。
      auth.toolDeny.add(label);
    } else {
      auth.toolAllow.delete(label);
    }
    return;
  }
  // 注意：工具行的复选框同时带 data-auth-server（用于级联），必须先判 data-auth-tool。
  if (target.matches('input[data-auth-server]:not([data-auth-tool])')) {
    const id = target.dataset.authServer;
    // 原来写的是 *：第一次手动取消某一行时，把 * 展开成当时的完整列表再删这一项。
    if (auth.mcpWild) {
      auth.mcpWild = false;
      auth.servers = new Set(allServerIds());
    }
    if (target.checked) auth.servers.add(id); else auth.servers.delete(id);
    renderServers();
    renderTools();
    return;
  }
  if (target.matches('input[data-auth-skill]')) {
    const id = target.dataset.authSkill;
    if (auth.skillsWild) {
      auth.skillsWild = false;
      auth.skills = new Set(allSkillIds());
    }
    if (target.checked) auth.skills.add(id); else auth.skills.delete(id);
  }
}

function onAuthClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('[data-auth-refresh]')) { void refreshExtensionCatalog(); return; }
  const remove = target.closest('[data-auth-tool-remove]');
  if (remove) {
    const value = remove.dataset.authToolRemove;
    auth.toolAllow.delete(value);
    auth.toolDeny.delete(value);
    renderTools();
  }
}

// ── 页面入口 ────────────────────────────────────────────────────────────────
export function init() {
  const main = document.querySelector('[data-presets-fields="main"]');
  const edit = document.querySelector('[data-presets-fields="edit"]');
  // 页面里的开关都是动态渲染的 role=switch 按钮，统一挂一次点击委托即可。
  bindSwitches(document.querySelector('.presets-page'));
  if (main) renderFields(main, PRESETS_FIELDS.main.fields);
  if (edit) renderFields(edit, PRESETS_FIELDS.edit.fields);
  const promptSlot = document.querySelector('[data-presets-fields="simPrompt"]');
  if (promptSlot) renderFields(promptSlot, PRESETS_FIELDS.simPrompt.fields);
  // 仿真提示词是独立卡片：字段规格里只留一个占位槽，渲染后把卡片内容搬进去。
  const promptMount = document.getElementById('presetPromptMount');
  const promptCard = document.getElementById('presetPrompt');
  if (promptMount && promptCard) promptMount.appendChild(promptCard);
  mountPromptEditor();
  mountAgentYamlEditor();
  document.getElementById('simPromptEdit')?.addEventListener('click', () => setPromptEditing(true));
  document.getElementById('simPromptSave')?.addEventListener('click', () => void savePresetPrompt());
  document.getElementById('simPromptCancel')?.addEventListener('click', () => {
    promptEditor?.setValue(promptOriginal);
    setPromptEditing(false);
    setPromptMsg('已取消编辑');
  });
  document.getElementById('simPromptReset')?.addEventListener('click', () => void resetPresetPrompt());
  document.getElementById('agentYamlEdit')?.addEventListener('click', () => setAgentYamlEditing(true));
  document.getElementById('agentYamlSave')?.addEventListener('click', () => void saveAgentYaml());
  document.getElementById('agentYamlCancel')?.addEventListener('click', () => {
    agentYamlEditor?.setValue(agentYamlOriginal);
    setAgentYamlEditing(false);
    setAgentYamlMsg('已取消编辑');
  });

  document.getElementById('presetList')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-preset-act]');
    if (!button) return;
    const id = button.dataset.presetId;
    if (button.dataset.presetAct === 'clone') openCreatePresetModal(presetsCache.find((item) => item.id === id) ?? null);
    else if (button.dataset.presetAct === 'edit') void openPreset(id);
    else if (button.dataset.presetAct === 'apply') void applyPreset(id);
    else if (button.dataset.presetAct === 'delete') void deletePreset(id);
  });
  document.getElementById('presetSave')?.addEventListener('click', () => void savePreset());
  document.getElementById('presetApply')?.addEventListener('click', () => void savePreset({ apply: true }));
  document.getElementById('presetFactory')?.addEventListener('click', () => void restoreFactoryPreset());
  document.getElementById('presetRollback')?.addEventListener('click', () => {
    if (editingId) void rollbackPreset(editingId);
  });
  document.getElementById('presetCancelEdit')?.addEventListener('click', () => {
    document.getElementById('presetEditor').hidden = true;
    editingId = '';
  });
  const editor = document.getElementById('presetEditor');
  editor?.addEventListener('change', onAuthChange);
  editor?.addEventListener('click', onAuthClick);
  onPageRefresh('presets', () => refreshPresets(true));
  void refreshPresets();
}
