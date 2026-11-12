// 能力预设：列表 + 内联编辑（平台工具 / Agent 模块 / MCP 服务器与工具 / 技能）。
// 结构约定：每个分组是一张独立卡片（编辑器容器用 display:contents 落到页面栅格），
// 表格一律用 dataTableHtml/initDataTables（工具栏、分页、多选列都由组件提供，不手写）。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { renderFields } from '../form/form.js';
import { modalHtml, openModal, closeModal } from '../modal/modal.js';
import { checkCellHtml, dataTableHtml, initDataTables, selectCellHtml } from '../table/table.js';

const PLATFORM_RISK_TEXT = { read: '读取', send: '发送', state: '会话状态', write: '写入', exec: '执行', admin: '管理' };
const EDITOR_TABLES = ['capEditorPlatform', 'capEditorServers', 'capEditorTools', 'capEditorSkills'];

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

  function extensionSummary(cap) {
    const mcp = Array.isArray(cap.tools?.mcp) ? cap.tools.mcp : [];
    const servers = mcp.some((item) => item.server === '*') ? '全部' : String(mcp.length);
    const tools = mcp.length && mcp.every((item) => item.tools === '*')
      ? '全部'
      : String(new Set(mcp.flatMap((item) => (Array.isArray(item.tools) ? item.tools : []))).size);
    const skills = cap.tools?.skills ?? [];
    const count = (list) => (list.includes('*') ? '全部' : String(list.length));
    return `<span class="meta">MCP ${servers} · 工具 ${tools} · 技能 ${count(skills)}</span>`;
  }

  function visibleSummary(cap) {
    const allowed = (cap.platformVisible ?? []).length;
    const total = platformTools().length || 0;
    const modules = (cap.agentModules ?? []).length;
    const moduleTotal = agentModules().length || 0;
    return `<span class="meta">允许 ${allowed}/${total} · 模块 ${modules}/${moduleTotal}</span>`;
  }

  function listMarkup() {
    const rows = capabilities.map((cap) => ({
      cells: [
        `<code>${esc(cap.id)}</code><div class="meta">${esc(cap.label || '')}</div>`,
        `<span class="pill">${esc(String(cap.agentPlatform || 'dsh').toUpperCase())}</span>`,
        visibleSummary(cap),
        extensionSummary(cap),
        `<div class="row-actions">
          <button class="btn small" type="button" data-cap-edit="${esc(cap.id)}">编辑</button>
          <button class="btn small" type="button" data-cap-clone="${esc(cap.id)}">克隆</button>
          ${cap.builtin ? '' : `<button class="btn small danger" type="button" data-cap-delete="${esc(cap.id)}">删除</button>`}
        </div>`,
      ],
    }));
    return dataTableHtml({
      columns: [{ label: '能力预设' }, { label: 'Agent 平台', width: '100px' }, { label: '工具' }, { label: 'MCP · 技能', width: '220px' }, { label: '操作', width: '160px' }],
      rows,
      pageSize: 20,
      search: { placeholder: '搜索能力预设 / id' },
      refresh: true,
      meta: `${capabilities.length} 个能力`,
      actions: '<button class="btn small primary" type="button" id="capabilityCreate">新建</button><span class="meta" id="capabilityListMsg" role="status"></span>',
    });
  }

  function renderList() {
    if (!listHost) return;
    listHost.innerHTML = listMarkup();
    initDataTables(listHost, { onRefresh: () => void load() });
  }

  // ---- 编辑区 ----

  function loadDraft(cap) {
    const mcp = Array.isArray(cap.tools?.mcp) ? cap.tools.mcp : [];
    const known = new Set((extensions?.mcp ?? []).map((server) => server.id));
    const servers = new Set();
    const serverTools = new Map(); // server id → '*' | Set(工具名)
    // 通配服务器（`- server: "*"`）表示「以后新增的服务器也允许」；没改动就原样写回，
    // 不能因为界面上只认识当前这几台服务器就把它悄悄收窄成显式清单。
    const mcpAll = mcp.some((item) => item.server === '*');
    for (const item of mcp) {
      if (item.server === '*') {
        // 目录为空时保留 *；有目录时展开成已知服务器供勾选。
        if (!known.size) { servers.add('*'); serverTools.set('*', '*'); continue; }
        for (const id of known) {
          servers.add(id);
          serverTools.set(id, item.tools === '*' ? '*' : new Set(Array.isArray(item.tools) ? item.tools : []));
        }
        continue;
      }
      servers.add(item.server);
      serverTools.set(item.server, item.tools === '*' ? '*' : new Set(Array.isArray(item.tools) ? item.tools : []));
    }
    const skills = Array.isArray(cap.tools?.skills) ? cap.tools.skills : [];
    draft = {
      id: cap.id,
      builtin: Boolean(cap.builtin),
      label: cap.label || '',
      note: cap.note || '',
      notes: cap.note || '',
      platform: new Set(cap.platformVisible ?? []),
      agent: new Set(cap.agentModules ?? []),
      servers,
      serverTools,
      mcpAll,
      skills: new Set(skills.filter((name) => name !== '*')),
      skillsAll: skills.includes('*'),
    };
  }

  // 平台工具与 Agent 模块合在一张表：两者的「允许」都指向同一套能力预设，
  // 拆成两张表只会让人以为它们是两种开关。类型列用标签区分来源与风险。
  function platformTable() {
    const rows = [];
    for (const entry of platformTools()) {
      rows.push({
        attrs: { 'data-filter-kind': 'platform' },
        cells: [
          selectCellHtml({ value: entry.flag, checked: draft.platform.has(entry.flag), label: `允许 ${entry.label}`, attrs: { 'data-cap-platform': entry.flag, 'data-select-group': 'tools' } }),
          `${esc(entry.label)}<div class="meta"><code>${esc(entry.flag)}</code></div>`,
          (entry.names ?? []).length
            ? `<span class="cap-tool-names">${entry.names.map((name) => `<code>${esc(name)}</code>`).join('')}</span>`
            : '<span class="meta">—</span>',
          `<span class="cap-pill-row"><span class="pill">平台</span>${riskPill(entry.risk)}</span>`,
        ],
      });
    }
    for (const entry of agentModules()) {
      rows.push({
        attrs: { 'data-filter-kind': 'agent' },
        cells: [
          selectCellHtml({ value: entry.id, checked: draft.agent.has(entry.id), label: `允许 ${entry.label}`, attrs: { 'data-cap-agent': entry.id, 'data-select-group': 'tools', disabled: 'disabled' } }),
          `${esc(entry.label)}<div class="meta"><code>${esc(entry.id)}</code></div>`,
          esc(entry.desc || 'Agent 运行时模块'),
          `<span class="cap-pill-row"><span class="pill">Agent</span>${riskPill(entry.risk)}</span>`,
        ],
      });
    }
    return dataTableHtml({
      columns: [{ label: '允许', select: true, selectAttrs: { 'data-select-group': 'tools' } }, { label: '工具', width: '220px' }, { label: '说明' }, { label: '类型', width: '150px' }],
      rows,
      pageSize: 20,
      search: { placeholder: '搜索工具 / 模块 / 宿主工具名' },
      refresh: true,
      filters: [{ id: 'kind', label: '类型', value: '', options: [{ value: '', label: '全部类型' }, { value: 'platform', label: '平台工具' }, { value: 'agent', label: 'Agent 模块' }] }],
      meta: `${platformTools().length} 个平台工具 · ${agentModules().length} 个 Agent 模块`,
    });
  }

  function allowedServers() {
    const servers = extensions?.mcp ?? [];
    return servers.filter((server) => draft.servers.has(server.id));
  }

  function serverTable() {
    const known = extensions?.mcp ?? [];
    const knownIds = new Set(known.map((server) => server.id));
    // 目录里已经没有、但 capability.yml 仍写着的服务器也要显示出来，否则无从取消。
    const missing = [...draft.servers]
      .filter((id) => id !== '*' && !knownIds.has(id))
      .map((id) => ({ id, source: 'external', status: 'offline', tools: [], missing: true }));
    const servers = [...known, ...missing];
    if (!servers.length) {
      return draft.servers.has('*')
        ? '<p class="meta">当前为「全部服务器」；扩展目录为空，保存时保留通配。</p>'
        : '<p class="meta">还没有 MCP 服务器目录（重启桥接后刷新）。</p>';
    }
    const rows = servers.map((server) => ({
      attrs: { 'data-filter-status': server.status === 'online' ? 'online' : 'offline' },
      cells: [
        selectCellHtml({ value: server.id, checked: draft.servers.has(server.id), label: `允许 ${server.id}`, attrs: { 'data-cap-server': server.id } }),
        `<code>${esc(server.id)}</code>`,
        server.missing ? '<span class="meta">已不在目录</span>' : server.source === 'external' ? '外部' : '内置',
        server.missing ? '不可用' : server.status === 'online' ? '在线' : '不可用',
        String((server.tools ?? []).length || server.toolCount || 0),
      ],
    }));
    return dataTableHtml({
      columns: [{ label: '允许', select: true, selectAttrs: { 'data-select-group': 'servers' } }, { label: '服务器' }, { label: '来源', width: '80px' }, { label: '状态', width: '90px' }, { label: '工具数', width: '80px' }],
      rows,
      pageSize: 10,
      search: { placeholder: '搜索服务器' },
      refresh: true,
      filters: [{ id: 'status', label: '状态', value: '', options: [{ value: '', label: '全部状态' }, { value: 'online', label: '在线' }, { value: 'offline', label: '不可用' }] }],
      meta: `${servers.length} 个服务器`,
    });
  }

  function toolNamesOf(serverId) {
    const server = (extensions?.mcp ?? []).find((item) => item.id === serverId);
    return (server?.tools ?? []).map((tool) => tool.name);
  }

  function toolTable() {
    const servers = allowedServers().filter((server) => server.id !== '*');
    if (!servers.length) return '<p class="meta">先允许 MCP 服务器，再逐个勾选它的工具。</p>';
    const rows = [];
    for (const server of servers) {
      const selection = draft.serverTools.get(server.id);
      for (const tool of server.tools ?? []) {
        const id = `${server.id}::${tool.name}`;
        const checked = selection === '*' || (selection instanceof Set && selection.has(tool.name));
        rows.push({
          attrs: { 'data-filter-server': server.id },
          cells: [
            checkCellHtml({ value: id, checked, attrs: { 'data-cap-tool': id }, label: `允许 ${id}` }),
            `<code>${esc(server.id)}</code>`,
            `<code>${esc(tool.name)}</code>`,
            `<span class="preset-tool-desc">${esc(tool.description || '—')}</span>`,
          ],
        });
      }
    }
    if (!rows.length) return '<p class="meta">这些服务器没有上报工具。</p>';
    return dataTableHtml({
      columns: [{ label: '允许', width: '60px' }, { label: '服务器', width: '180px' }, { label: '工具', width: '220px' }, { label: '说明' }],
      rows,
      pageSize: 10,
      search: { placeholder: '搜索工具' },
      refresh: true,
      filters: [{ id: 'server', label: '服务器', value: '', options: [{ value: '', label: '全部服务器' }, ...servers.map((server) => ({ value: server.id, label: server.id }))] }],
      meta: `${rows.length} 个工具`,
    });
  }

  function skillTable() {
    const skills = extensions?.skills ?? [];
    if (!skills.length) return '<p class="meta">还没有技能目录。</p>';
    const rows = skills.map((skill) => ({
      cells: [
        selectCellHtml({ value: skill.id, checked: draft.skillsAll || draft.skills.has(skill.id), label: `允许 ${skill.id}`, attrs: { 'data-cap-skill': skill.id } }),
        `<code>${esc(skill.id)}</code>`,
        `<span class="preset-tool-desc">${esc(skill.description || '—')}</span>`,
      ],
    }));
    return dataTableHtml({
      columns: [{ label: '允许', select: true, selectAttrs: { 'data-select-group': 'skills' } }, { label: '技能', width: '220px' }, { label: '说明' }],
      rows,
      pageSize: 10,
      search: { placeholder: '搜索技能' },
      refresh: true,
      meta: `${skills.length} 个技能`,
    });
  }

  const TABLE_RENDERERS = {
    capEditorPlatform: platformTable,
    capEditorServers: serverTable,
    capEditorTools: toolTable,
    capEditorSkills: skillTable,
  };

  function mountTable(hostId) {
    const host = editorHost?.querySelector(`#${hostId}`);
    if (!host) return;
    host.innerHTML = TABLE_RENDERERS[hostId]();
    initDataTables(host, { onRefresh: () => mountTable(hostId) });
  }

  function renderEditorTables() {
    for (const hostId of EDITOR_TABLES) mountTable(hostId);
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
      <section class="card span-all">
        <div class="card-head">
          <div>
            <h2>基本信息 · <code>${esc(draft.id)}</code></h2>
            <div class="meta">保存后写回 <code>profiles/agent-platforms/dsh/capabilities/${esc(draft.id)}.yml</code>；方案引用与工具清单立即生效。</div>
          </div>
          <div class="row-actions">
            <button class="btn primary" type="button" id="capabilitySave">保存</button>
            <button class="btn" type="button" id="capabilityReset" ${draft.builtin ? '' : 'hidden'}>重置</button>
            <button class="btn ghost" type="button" id="capabilityCancel">取消</button>
            <span class="meta" id="capabilitySaveMsg" role="status"></span>
          </div>
        </div>
        <div id="capabilityEditorFields"></div>
      </section>
      <section class="card span-all"><h2>平台工具</h2><p class="meta">「平台」是 QQ 桥接提供的工具，由这张表决定是否暴露；「Agent」模块由 Agent 预设决定，这里只读展示。</p><div id="capEditorPlatform"></div></section>
      <section class="card span-all"><h2>MCP 服务器</h2><p class="meta">勾选服务器后，下面的「MCP 工具」只列出这些服务器的工具。</p><div id="capEditorServers"></div></section>
      <section class="card span-all"><h2>MCP 工具</h2><p class="meta">只列出已允许服务器的工具；在这里取消勾选等于把该服务器收窄到具体工具。</p><div id="capEditorTools"></div></section>
      <section class="card span-all"><h2>技能</h2><div id="capEditorSkills"></div></section>`;
    renderFields(editorHost.querySelector('#capabilityEditorFields'), [
      { name: 'capabilityLabel', type: 'text', label: '名称', value: draft.label },
      { name: 'capabilityNote', type: 'text', label: '备注', value: draft.note, hint: '给选方案的人看的说明，不进提示词。' },
    ], { columns: 1 });
    if (draft.builtin) {
      for (const id of ['capabilityLabel', 'capabilityNote']) {
        const input = editorHost.querySelector(`#${id}`);
        if (input) { input.readOnly = true; input.classList.add('is-readonly'); }
      }
    }
    renderEditorTables();
  }

  function syncFromEvents(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
    const { capPlatform, capAgent, capServer, capSkill, capTool } = target.dataset;
    if (capPlatform) { target.checked ? draft.platform.add(capPlatform) : draft.platform.delete(capPlatform); return; }
    if (capAgent) { target.checked ? draft.agent.add(capAgent) : draft.agent.delete(capAgent); return; }
    if (capServer) {
      draft.mcpAll = false; // 手动增删服务器即放弃通配
      if (target.checked) {
        draft.servers.add(capServer);
        if (!draft.serverTools.has(capServer)) draft.serverTools.set(capServer, '*');
      } else {
        draft.servers.delete(capServer);
        draft.serverTools.delete(capServer);
      }
      mountTable('capEditorTools');
      return;
    }
    if (capSkill) {
      // 通配状态下第一次改动要把 '*' 展开成目录里所有技能，再按本次勾选增减。
      if (draft.skillsAll) {
        draft.skills = new Set((extensions?.skills ?? []).map((skill) => skill.id));
        draft.skillsAll = false;
      }
      target.checked ? draft.skills.add(capSkill) : draft.skills.delete(capSkill);
      return;
    }
    if (capTool) {
      draft.mcpAll = false; // 收窄到具体工具后就不能再写通配
      const [serverId, toolName] = capTool.split('::');
      let selection = draft.serverTools.get(serverId);
      // '*' 表示该服务器下全部工具：先展开成显式集合，再按本次勾选增减。
      if (selection === '*' || selection === undefined) selection = new Set(toolNamesOf(serverId));
      else selection = new Set(selection);
      if (target.checked) selection.add(toolName); else selection.delete(toolName);
      draft.serverTools.set(serverId, selection);
    }
  }

  async function save() {
    if (!draft) return;
    const msg = editorHost.querySelector('#capabilitySaveMsg');
    if (msg) msg.textContent = '保存中…';
    const platform = {};
    for (const entry of platformTools()) platform[entry.flag] = draft.platform.has(entry.flag);
    // Agent 模块由 Agent 预设决定，能力预设不再保存 tools.agent。
    // capability.yml 的 tools.mcp 是 [{server, tools: '*' | [名称]}] 列表，按这个形状写回。
    // 没改过的通配配置保持 `- server: "*"`，避免把「以后新增的服务器也允许」悄悄收窄。
    const mcp = draft.mcpAll
      ? [{ server: '*', tools: '*' }]
      : [...draft.servers].map((server) => {
        const selection = draft.serverTools.get(server);
        return { server, tools: selection === '*' || selection === undefined ? '*' : [...selection] };
      });
    const payload = {
      label: editorHost.querySelector('#capabilityLabel')?.value?.trim() ?? '',
      note: editorHost.querySelector('#capabilityNote')?.value?.trim() ?? '',
      tools: {
        platform,
        mcp,
        skills: draft.skillsAll ? ['*'] : [...draft.skills],
      },
    };
    try {
      const result = await api(`/api/runtime/capabilities/${encodeURIComponent(draft.id)}`, 'PATCH', payload);
      if (!result?.ok) throw new Error(result?.error || '保存失败');
      draft.label = payload.label;
      draft.note = payload.note;
      showConsoleToast('能力预设已保存');
      if (msg) msg.textContent = '✅ 已保存';
      await load();
      onSaved?.();
    } catch (error) {
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
    if (event.target.closest('#capabilityReset')) { void resetCapability(); return; }
    if (event.target.closest('#capabilityCancel')) { draft = null; renderEditor(); }
  });

  /** 内置能力重置：用 .defaults/<id>.yml 覆盖当前文件（后端校验只允许内置）。 */
  async function resetCapability() {
    if (!draft?.builtin) return;
    if (!window.confirm(`把「${draft.label || draft.id}」重置为出厂内容？`)) return;
    const msg = editorHost.querySelector('#capabilitySaveMsg');
    try {
      const r = await api(`/api/runtime/capabilities/${encodeURIComponent(draft.id)}/reset`, 'POST', {});
      if (!r?.ok) throw new Error(r?.error || '重置失败');
      showConsoleToast('已重置为出厂内容');
      await load();
      const fresh = capabilities.find((item) => item.id === draft.id);
      if (fresh) { loadDraft(fresh); renderEditor(); }
    } catch (error) {
      if (msg) msg.textContent = `重置失败：${error?.message ?? error}`;
    }
  }

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
    if (!window.confirm(`删除能力预设 ${id}？对应的 capability.yml 会一并删除。`)) return;
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
