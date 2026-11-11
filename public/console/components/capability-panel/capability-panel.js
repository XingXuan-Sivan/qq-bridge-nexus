// 能力预设：列表 + 内联编辑（平台工具 / Agent 模块 / MCP 服务器与工具 / 技能）。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { renderFields } from '../form/form.js';
import { modalHtml, openModal, closeModal } from '../modal/modal.js';
import { checkCellHtml, dataTableHtml, initDataTables, selectCellHtml } from '../table/table.js';

const PLATFORM_RISK_TEXT = { read: '读取', send: '发送', state: '会话状态', admin: '管理' };

function riskPill(risk) {
  const text = PLATFORM_RISK_TEXT[risk] ?? risk ?? '—';
  const tone = risk === 'admin' ? 'r' : risk === 'send' ? 'b' : 'g';
  return `<span class="pill ${tone}">${esc(text)}</span>`;
}

export function createCapabilityPanel({ listHost, editorHost, onSaved }) {
  let catalog = null;
  let capabilities = [];
  let extensions = null; // /api/extensions：MCP 服务器与技能目录
  let draft = null;

  const byId = (id) => capabilities.find((item) => item.id === id) ?? null;
  const platformTools = () => (catalog?.entries ?? []).filter((entry) => entry.side === 'platform');
  const agentModules = () => (catalog?.entries ?? []).filter((entry) => entry.side === 'agent');

  function presetExtensions(id) {
    const preset = extensions?.presets?.find?.((item) => item.id === id);
    return preset?.extensions ?? null;
  }

  function extensionSummary(cap) {
    const mcp = cap.tools?.mcp?.allow ?? [];
    const tools = cap.tools?.mcp?.tools?.allow ?? [];
    const skills = cap.tools?.skills ?? [];
    const count = (list) => (list.includes('*') ? '全部' : String(list.length));
    return `<span class="meta">MCP ${count(mcp)} · 工具 ${count(tools)} · 技能 ${count(skills)}</span>`;
  }

  function visibleSummary(cap) {
    const allowed = (cap.platformVisible ?? []).length;
    const total = platformTools().length || 0;
    return `<span class="meta">允许 ${allowed} / ${total}</span>`;
  }

  function listMarkup() {
    const rows = capabilities.map((cap) => ({
      cells: [
        `<code>${esc(cap.id)}</code><div class="meta">${esc(cap.label || '')}</div>`,
        visibleSummary(cap),
        (cap.agentModules ?? []).length ? (cap.agentModules).map((m) => `<code>${esc(m)}</code>`).join(' ') : '<span class="meta">—</span>',
        extensionSummary(cap),
        [
          `<button class="btn small" type="button" data-cap-edit="${esc(cap.id)}">编辑</button>`,
          `<button class="btn small" type="button" data-cap-clone="${esc(cap.id)}">克隆</button>`,
          cap.builtin ? '' : `<button class="btn small danger" type="button" data-cap-delete="${esc(cap.id)}">删除</button>`,
        ].filter(Boolean).join(' '),
      ],
    }));
    return dataTableHtml({
      columns: [{ label: '能力预设' }, { label: '平台工具', width: '200px' }, { label: 'Agent 模块', width: '260px' }, { label: 'MCP · 技能', width: '160px' }, { label: '操作', width: '190px' }],
      rows,
      pageSize: 20,
      meta: `${capabilities.length} 个能力`,
      actions: '<button class="btn" type="button" id="capabilityCreate">新建</button><span class="meta" id="capabilityListMsg" role="status"></span>',
    });
  }

  function renderList() {
    if (!listHost) return;
    listHost.innerHTML = listMarkup();
    initDataTables(listHost);
  }

  // ---- 编辑区 ----

  function loadDraft(cap) {
    const mcp = cap.tools?.mcp ?? {};
    const toolAllow = mcp.tools?.allow ?? [];
    const toolDeny = mcp.tools?.deny ?? [];
    draft = {
      id: cap.id,
      label: cap.label || '',
      note: cap.note || '',
      notes: cap.safety?.notes || '',
      platform: new Set(cap.platformVisible ?? []),
      agent: new Set(cap.agentModules ?? []),
      servers: new Set(mcp.allow ?? []),
      toolAllow: new Set(toolAllow),
      toolDeny: new Set(toolDeny),
      skills: new Set(cap.tools?.skills ?? []),
    };
  }

  function platformTable() {
    const rows = platformTools().map((entry) => ({
      cells: [
        selectCellHtml({ value: entry.flag, checked: draft.platform.has(entry.flag), label: `允许 ${entry.label}`, attrs: { 'data-cap-platform': entry.flag } }),
        `${esc(entry.label)}<div class="meta"><code>${esc(entry.flag)}</code></div>`,
        riskPill(entry.risk),
      ],
    }));
    return dataTableHtml({
      columns: [{ label: '允许', width: '64px', select: true, selectAttrs: { 'data-select-group': 'platform' } }, { label: '工具' }, { label: '风险', width: '90px' }],
      rows,
      pageSize: 40,
      meta: `${rows.length} 个平台工具`,
    });
  }

  function agentTable() {
    const rows = agentModules().map((entry) => ({
      cells: [
        selectCellHtml({ value: entry.id, checked: draft.agent.has(entry.id), label: `允许 ${entry.label}`, attrs: { 'data-cap-agent': entry.id } }),
        esc(entry.label),
        `<code>${esc(entry.id)}</code>`,
        riskPill(entry.risk),
      ],
    }));
    return rows.length
      ? dataTableHtml({
        columns: [{ label: '允许', width: '64px', select: true, selectAttrs: { 'data-select-group': 'agent' } }, { label: '模块' }, { label: 'id', width: '220px' }, { label: '风险', width: '90px' }],
        rows,
        pageSize: 10,
        meta: `${rows.length} 个 Agent 模块`,
      })
      : '<p class="meta">后端没有返回 Agent 模块目录。</p>';
  }

  function allowedServers() {
    const servers = extensions?.mcp ?? [];
    return servers.filter((server) => draft.servers.has(server.id));
  }

  function serverTable() {
    const servers = extensions?.mcp ?? [];
    if (!servers.length) return '<p class="meta">还没有 MCP 服务器目录（重启桥接后刷新）。</p>';
    const rows = servers.map((server) => ({
      cells: [
        selectCellHtml({ value: server.id, checked: draft.servers.has(server.id), label: `允许 ${server.id}`, attrs: { 'data-cap-server': server.id } }),
        `<code>${esc(server.id)}</code>`,
        server.source === 'external' ? '外部' : '内置',
        server.status === 'online' ? '在线' : '不可用',
        String((server.tools ?? []).length || server.toolCount || 0),
      ],
    }));
    return dataTableHtml({
      columns: [{ label: '允许', width: '64px', select: true, selectAttrs: { 'data-select-group': 'servers' } }, { label: '服务器' }, { label: '来源', width: '80px' }, { label: '状态', width: '90px' }, { label: '工具数', width: '80px' }],
      rows,
      pageSize: 10,
      meta: `${servers.length} 个服务器`,
    });
  }

  function toolTable() {
    const servers = allowedServers();
    const rows = [];
    for (const server of servers) {
      for (const tool of server.tools ?? []) {
        const id = `${server.id}__${tool.name}`;
        rows.push({
          cells: [
            checkCellHtml({ value: id, checked: draft.toolAllow.has(id), attrs: { 'data-cap-tool-allow': id }, label: `允许 ${id}` }),
            checkCellHtml({ value: id, checked: draft.toolDeny.has(id), attrs: { 'data-cap-tool-deny': id }, label: `拒绝 ${id}` }),
            `<code>${esc(server.id)}</code>`,
            `<code>${esc(tool.name)}</code>`,
            `<span class="preset-tool-desc">${esc(tool.description || '—')}</span>`,
          ],
        });
      }
    }
    if (!rows.length) return '<p class="meta">先允许 MCP 服务器，再逐个勾选它的工具。</p>';
    return dataTableHtml({
      columns: [{ label: '允许', width: '60px' }, { label: '拒绝', width: '60px' }, { label: '服务器', width: '180px' }, { label: '工具', width: '220px' }, { label: '说明' }],
      rows,
      pageSize: 20,
      meta: `${rows.length} 个工具（拒绝优先于允许）`,
    });
  }

  function skillTable() {
    const skills = extensions?.skills ?? [];
    if (!skills.length) return '<p class="meta">还没有技能目录。</p>';
    const rows = skills.map((skill) => ({
      cells: [
        selectCellHtml({ value: skill.id, checked: draft.skills.has(skill.id), label: `允许 ${skill.id}`, attrs: { 'data-cap-skill': skill.id } }),
        `<code>${esc(skill.id)}</code>`,
        `<span class="preset-tool-desc">${esc(skill.description || '—')}</span>`,
      ],
    }));
    return dataTableHtml({
      columns: [{ label: '允许', width: '64px', select: true, selectAttrs: { 'data-select-group': 'skills' } }, { label: '技能', width: '220px' }, { label: '说明' }],
      rows,
      pageSize: 10,
      meta: `${skills.length} 个技能`,
    });
  }

  function renderEditor() {
    if (!editorHost) return;
    if (!draft) {
      editorHost.hidden = true;
      editorHost.innerHTML = '';
      return;
    }
    editorHost.hidden = false;
    editorHost.innerHTML = `
      <div class="card span-all">
        <div class="card-head">
          <h2>编辑能力 · <code>${esc(draft.id)}</code></h2>
          <div class="meta" id="capabilitySaveMsg" role="status"></div>
        </div>
        <div class="meta">保存后重写 <code>capability.yml</code> 并重建 preset / agent / extensions 三份产物。</div>
        <div id="capabilityEditorFields"></div>
        <h3>平台工具</h3>
        <div id="capEditorPlatform"></div>
        <h3>Agent 模块</h3>
        <div id="capEditorAgent"></div>
        <h3>MCP 服务器</h3>
        <div id="capEditorServers"></div>
        <h3>MCP 工具</h3>
        <div id="capEditorTools"></div>
        <h3>技能</h3>
        <div id="capEditorSkills"></div>
        <div class="form-actions">
          <button class="btn" type="button" id="capabilitySave">保存</button>
          <button class="btn ghost" type="button" id="capabilityCancel">取消</button>
        </div>
      </div>`;
    renderFields(editorHost.querySelector('#capabilityEditorFields'), [
      { name: 'capabilityLabel', type: 'text', label: '名称', value: draft.label },
      { name: 'capabilitySafetyNotes', type: 'textarea', label: '安全补充', value: draft.notes, hint: '拼在 persona 安全段末尾；只写这套能力特有的约束。' },
      { name: 'capabilityNote', type: 'text', label: '备注', value: draft.note, hint: '给选方案的人看的说明，不进提示词。' },
    ], { columns: 1 });
    editorHost.querySelector('#capEditorPlatform').innerHTML = platformTable();
    editorHost.querySelector('#capEditorAgent').innerHTML = agentTable();
    editorHost.querySelector('#capEditorServers').innerHTML = serverTable();
    editorHost.querySelector('#capEditorTools').innerHTML = toolTable();
    editorHost.querySelector('#capEditorSkills').innerHTML = skillTable();
    for (const host of editorHost.querySelectorAll('#capEditorPlatform, #capEditorAgent, #capEditorServers, #capEditorTools, #capEditorSkills')) {
      initDataTables(host);
    }
  }

  function syncFromEvents(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
    const { capPlatform, capAgent, capServer, capSkill, capToolAllow, capToolDeny } = target.dataset;
    if (capPlatform) { target.checked ? draft.platform.add(capPlatform) : draft.platform.delete(capPlatform); return; }
    if (capAgent) { target.checked ? draft.agent.add(capAgent) : draft.agent.delete(capAgent); return; }
    if (capServer) {
      target.checked ? draft.servers.add(capServer) : draft.servers.delete(capServer);
      editorHost.querySelector('#capEditorTools').innerHTML = toolTable();
      initDataTables(editorHost.querySelector('#capEditorTools'));
      return;
    }
    if (capSkill) { target.checked ? draft.skills.add(capSkill) : draft.skills.delete(capSkill); return; }
    if (capToolAllow) {
      if (target.checked) { draft.toolAllow.add(capToolAllow); draft.toolDeny.delete(capToolAllow); }
      else draft.toolAllow.delete(capToolAllow);
      editorHost.querySelector('#capEditorTools').innerHTML = toolTable();
      initDataTables(editorHost.querySelector('#capEditorTools'));
      return;
    }
    if (capToolDeny) {
      if (target.checked) { draft.toolDeny.add(capToolDeny); draft.toolAllow.delete(capToolDeny); }
      else draft.toolDeny.delete(capToolDeny);
      editorHost.querySelector('#capEditorTools').innerHTML = toolTable();
      initDataTables(editorHost.querySelector('#capEditorTools'));
    }
  }

  async function save() {
    if (!draft) return;
    const platform = {};
    for (const entry of platformTools()) platform[entry.flag] = draft.platform.has(entry.flag);
    const agent = {};
    for (const entry of agentModules()) agent[entry.id] = draft.agent.has(entry.id);
    const payload = {
      label: editorHost.querySelector('#capabilityLabel')?.value?.trim() ?? '',
      note: editorHost.querySelector('#capabilityNote')?.value?.trim() ?? '',
      safety: { notes: editorHost.querySelector('#capabilitySafetyNotes')?.value?.trim() ?? '' },
      tools: {
        platform,
        agent,
        mcp: { allow: [...draft.servers], tools: { allow: [...draft.toolAllow], deny: [...draft.toolDeny] } },
        skills: [...draft.skills],
      },
    };
    try {
      const result = await api(`/api/runtime/capabilities/${encodeURIComponent(draft.id)}`, 'PATCH', payload);
      if (!result?.ok) throw new Error(result?.error || '保存失败');
      showConsoleToast('能力预设已保存');
      draft = null;
      await load();
      onSaved?.();
    } catch (error) {
      const msg = editorHost.querySelector('#capabilitySaveMsg');
      if (msg) msg.textContent = `保存失败：${error?.message ?? error}`;
    }
  }

  async function load() {
    try {
      const [caps, ext] = await Promise.all([
        api('/api/runtime/capabilities'),
        api('/api/extensions').catch(() => null),
      ]);
      catalog = caps?.catalog ?? null;
      capabilities = caps?.capabilities ?? [];
      extensions = ext ?? null;
      renderList();
      renderEditor();
    } catch (error) {
      if (listHost) listHost.innerHTML = `<div class="meta">读取能力预设失败：${esc(error?.message ?? error)}</div>`;
    }
  }

  listHost?.addEventListener('click', (event) => {
    if (event.target.closest('#capabilityCreate')) { void createCapability(null); return; }
    const cloneTrigger = event.target.closest('[data-cap-clone]');
    if (cloneTrigger) { void createCapability(byId(cloneTrigger.dataset.capClone)); return; }
    const deleteTrigger = event.target.closest('[data-cap-delete]');
    if (deleteTrigger) { void deleteCapability(deleteTrigger.dataset.capDelete); return; }
    const trigger = event.target.closest('[data-cap-edit]');
    if (!trigger) return;
    const cap = byId(trigger.dataset.capEdit);
    if (!cap) return;
    loadDraft(cap);
    renderEditor();
    editorHost?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  editorHost?.addEventListener('change', syncFromEvents);
  editorHost?.addEventListener('click', (event) => {
    if (event.target.closest('#capabilitySave')) { void save(); return; }
    if (event.target.closest('#capabilityCancel')) { draft = null; renderEditor(); }
  });

  /** 新建 / 克隆：id + 名称两个字段，克隆时带模板。 */
  async function createCapability(source) {
    const overlayId = 'capabilityCreateModal';
    document.getElementById(overlayId)?.remove();
    const title = source ? `克隆能力预设 · ${source.id}` : '新建能力预设';
    document.body.insertAdjacentHTML('beforeend', modalHtml({
      id: overlayId,
      title,
      body: '<div class="form-stack" id="capabilityCreateFields"></div>',
      footer: '<button class="btn" type="button" data-modal-close>取消</button><button class="btn primary" type="button" id="capabilityCreateSave">保存</button>',
    }));
    const overlay = document.getElementById(overlayId);
    renderFields(overlay.querySelector('#capabilityCreateFields'), [
      { name: 'capabilityNewId', type: 'text', label: '能力 id', placeholder: '小写字母、数字、连字符', value: source ? `${source.id}-copy` : '', hint: '创建后不可改名' },
      { name: 'capabilityNewLabel', type: 'text', label: '名称', value: source ? `${source.label || source.id}（副本）` : '' },
    ], { columns: 1, layout: 'inline' });
    openModal(overlay);
    overlay.querySelectorAll('[data-modal-close]').forEach((btn) => btn.addEventListener('click', () => closeModal(overlay)));
    overlay.querySelector('#capabilityCreateSave')?.addEventListener('click', async () => {
      const id = String(overlay.querySelector('[name="capabilityNewId"]')?.value ?? '').trim();
      const label = String(overlay.querySelector('[name="capabilityNewLabel"]')?.value ?? '').trim();
      try {
        const r = await api('/api/capabilities', 'POST', { id, label, from: source?.id ?? '' });
        if (!r?.ok) throw new Error(r?.error || '创建失败');
        closeModal(overlay);
        showConsoleToast(source ? '已克隆能力预设' : '已新建能力预设');
        await load();
      } catch (error) {
        if (listHost) listHost.querySelector('#capabilityListMsg')?.replaceChildren(String(error?.message ?? error));
      }
    });
  }

  async function deleteCapability(id) {
    if (!window.confirm(`删除能力预设 ${id}？目录会被移除，产物一并删除。`)) return;
    try {
      const r = await api(`/api/capabilities/${encodeURIComponent(id)}`, 'DELETE');
      if (!r?.ok) throw new Error(r?.error || '删除失败');
      showConsoleToast('已删除能力预设');
      await load();
    } catch (error) {
      if (listHost) listHost.querySelector('#capabilityListMsg')?.replaceChildren(String(error?.message ?? error));
    }
  }

  return { load, render: renderList };
}
