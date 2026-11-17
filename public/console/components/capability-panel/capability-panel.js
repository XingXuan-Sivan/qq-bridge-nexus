// 能力档：列表 + 内联编辑（效果 / 执行体工具面 / MCP 服务器与工具 / 技能）。
// 能力档只写意图：`effects` 是「要什么」，插件行与工具面由渲染层从当前执行体的
// tools.yml + render.yml 编出来，所以后两张表一律只读 —— 换执行体，清单跟着换。
// 结构约定：每个分组是一张独立卡片（编辑器容器用 display:contents 落到页面栅格），
// 表格一律用 dataTableHtml/initDataTables（工具栏、分页、多选列都由组件提供，不手写）。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { cardHtml } from '../card/card.js';
import { renderFields } from '../form/form.js';
import { confirmBox } from '../message-box/message-box.js';
import { modalHtml, openModal, closeModal } from '../modal/modal.js';
import { checkCellHtml, dataTableHtml, initDataTables, selectCellHtml } from '../table/table.js';

const PLATFORM_RISK_TEXT = { read: '读取', send: '发送', state: '会话状态', write: '写入', exec: '执行', admin: '管理' };
const EDITOR_TABLES = ['capEditorEffects', 'capEditorAgent', 'capEditorServers', 'capEditorTools', 'capEditorSkills'];
const AUDIENCE_TEXT = { access: '受准入名单约束的会话', owner: '仅主人与管理员私聊' };

function riskPill(risk) {
  const text = PLATFORM_RISK_TEXT[risk] ?? risk ?? '—';
  const tone = risk === 'admin' ? 'tag--danger' : risk === 'send' ? 'tag--primary' : 'tag--success';
  return `<span class="tag ${tone}">${esc(text)}</span>`;
}

/** 效果名的两种写法：`fs.read: true`（默认变体）与 `web.access: mcp`（变体名）。 */
function effectRows(cap) {
  return Object.entries(cap?.effects ?? {}).filter(([, value]) => value !== false);
}

/**
 * 能力档面板：列表 + 内联编辑器。
 * @param {{listHost: HTMLElement, editorHost?: HTMLElement, onSaved?: () => void, platformId?: string}} opts
 *   platformId 只用来把「写回哪份文件」说准：面板挂在哪个 Agent 平台下，就写回那个平台的目录。
 */
export function createCapabilityPanel({ listHost, editorHost, onSaved, platformId = '' }) {
  let catalog = null;
  let capabilities = [];
  let extensions = null; // /api/extensions：MCP 服务器与技能目录
  let draft = null;

  const byId = (id) => capabilities.find((item) => item.id === id) ?? null;
  // 执行体的工具模块由它自己的 tools.yml 声明（快照里的 agent 段），每个模块带自己承担的效果。
  const agentModules = () => (catalog?.agent ?? []);

  function extensionSummary(cap) {
    const servers = cap.mcp?.allow ?? [];
    const tools = cap.mcp?.tools?.allow ?? [];
    const deny = cap.mcp?.tools?.deny ?? [];
    const skills = cap.skills?.allow ?? [];
    const count = (list) => (list.includes('*') ? '全部' : String(list.length));
    return `<span class="meta">MCP ${count(servers)} · 工具 ${count(tools)}${deny.length ? ` · 拒绝 ${deny.length}` : ''} · 技能 ${count(skills)}</span>`;
  }

  function effectSummary(cap) {
    const rows = effectRows(cap);
    if (!rows.length) return '<span class="meta">不声明效果</span>';
    return `<span class="meta">${rows.length} 项</span><div class="meta">${rows.map(([key]) => `<code>${esc(key)}</code>`).join(' ')}</div>`;
  }

  function listMarkup() {
    const rows = capabilities.map((cap) => ({
      cells: [
        `<code>${esc(cap.id)}</code><div class="meta">${esc(cap.label || '')}</div>`,
        effectSummary(cap),
        extensionSummary(cap),
        `<div class="row-actions">
          <button class="btn small" type="button" data-cap-edit="${esc(cap.id)}">编辑</button>
          <button class="btn small" type="button" data-cap-clone="${esc(cap.id)}">克隆</button>
          ${cap.builtin ? '' : `<button class="btn small danger" type="button" data-cap-delete="${esc(cap.id)}">删除</button>`}
        </div>`,
      ],
    }));
    return dataTableHtml({
      columns: [{ label: '能力档' }, { label: '效果' }, { label: 'MCP · 技能', width: '220px' }, { label: '操作', width: '160px' }],
      rows,
      pageSize: 20,
      search: { placeholder: '搜索能力档 / id' },
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
    const known = new Set((extensions?.mcp ?? []).map((server) => server.id));
    const allow = Array.isArray(cap.mcp?.allow) ? cap.mcp.allow : [];
    const toolAllow = Array.isArray(cap.mcp?.tools?.allow) ? cap.mcp.tools.allow : [];
    const servers = new Set();
    const serverTools = new Map(); // server id → '*' | Set(工具名)
    // 通配服务器（`- '*'`）表示「以后新增的服务器也允许」；没改动就原样写回，
    // 不能因为界面上只认识当前这几台服务器就把它悄悄收窄成显式清单。
    const mcpAll = allow.includes('*');
    for (const server of allow) {
      if (server === '*') {
        // 目录为空时保留 *；有目录时展开成已知服务器供勾选。
        if (!known.size) { servers.add('*'); continue; }
        for (const id of known) servers.add(id);
        continue;
      }
      servers.add(server);
    }
    // 工具清单：`server__tool` 落到对应服务器的勾选集合；界面表达不了的通配
    // （裸工具名、`prefix*`）原样收进 toolPatterns，保存时写回，不做静默收窄。
    const toolPatterns = [];
    for (const entry of toolAllow) {
      if (entry === '*') {
        if (!known.size) serverTools.set('*', '*');
        for (const id of servers) if (id !== '*') serverTools.set(id, '*');
        continue;
      }
      if (entry.includes('__')) {
        const [serverId, toolName] = entry.split('__');
        if (toolName === '*') { serverTools.set(serverId, '*'); continue; }
        const current = serverTools.get(serverId);
        if (current === '*') continue;
        const set = current ?? new Set();
        set.add(toolName);
        serverTools.set(serverId, set);
        continue;
      }
      toolPatterns.push(entry);
    }
    const skillsAllow = Array.isArray(cap.skills?.allow) ? cap.skills.allow : [];
    draft = {
      id: cap.id,
      builtin: Boolean(cap.builtin),
      label: cap.label || '',
      note: cap.note || '',
      effects: { ...(cap.effects ?? {}) },
      runtime: { ...(cap.runtime ?? {}) },
      audience: cap.audience || 'access',
      servers,
      serverTools,
      toolPatterns,
      mcpAll,
      deny: Array.isArray(cap.mcp?.tools?.deny) ? [...cap.mcp.tools.deny] : [],
      skills: new Set(skillsAllow.filter((name) => name !== '*')),
      skillsAll: skillsAllow.includes('*'),
    };
  }

  /** 这张表问的是「要什么」：效果 → 当前执行体里哪几个模块承担它。 */
  function effectTable() {
    const modules = agentModules();
    const rows = effectRows(draft).map(([effect, value]) => {
      const hosts = modules.filter((entry) => (entry.effects ?? []).includes(effect));
      return {
        cells: [
          `<code>${esc(effect)}</code>`,
          esc(value === true ? '默认' : String(value)),
          hosts.length ? hosts.map((entry) => `<code>${esc(entry.id)}</code>`).join(' ') : '<span class="meta">当前执行体没有模块承担</span>',
          `<span class="cap-pill-row">${hosts.length ? '<span class="tag tag--success">可装</span>' : '<span class="tag tag--danger">装不出</span>'}</span>`,
        ],
      };
    });
    if (!rows.length) return '<p class="meta">这份能力档不声明任何效果：不产生插件行，工具面交给执行体自己。</p>';
    return dataTableHtml({
      columns: [{ label: '效果', width: '180px' }, { label: '变体', width: '100px' }, { label: '承担它的模块' }, { label: '状态', width: '90px' }],
      rows,
      pageSize: 20,
      search: { placeholder: '搜索效果' },
      refresh: true,
      meta: `${rows.length} 项效果`,
    });
  }

  // 执行体工具面：模块清单来自 profiles/agent-platforms/<id>/tools.yml，能力档不保存它，
  // 所以这一列是只读的；能用到哪一档由会话权限级别收紧。
  function agentTable() {
    const modules = agentModules();
    if (!modules.length) return '<p class="meta">当前执行体没有声明工具模块（tools.yml 缺失或 modules 为空）。</p>';
    const rows = modules.map((entry) => ({
      cells: [
        `${esc(entry.label || entry.id)}<div class="meta"><code>${esc(entry.id)}</code></div>`,
        esc(entry.desc || '—'),
        (entry.effects ?? []).map((effect) => `<code>${esc(effect)}</code>`).join(' ') || '<span class="meta">—</span>',
        `<span class="cap-pill-row">${riskPill(entry.risk)}</span>`,
      ],
    }));
    return dataTableHtml({
      columns: [{ label: '模块', width: '220px' }, { label: '说明' }, { label: '效果' }, { label: '风险', width: '110px' }],
      rows,
      pageSize: 20,
      search: { placeholder: '搜索模块 / 效果' },
      refresh: true,
      meta: `${modules.length} 个模块 · 由 tools.yml 声明`,
    });
  }

  function allowedServers() {
    const servers = extensions?.mcp ?? [];
    return servers.filter((server) => draft.servers.has(server.id));
  }

  function serverTable() {
    const known = extensions?.mcp ?? [];
    const knownIds = new Set(known.map((server) => server.id));
    // 目录里已经没有、但能力档仍写着的服务器也要显示出来，否则无从取消。
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
    capEditorEffects: effectTable,
    capEditorAgent: agentTable,
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

  // 写回路径按当前 Agent 平台算：面板挂在哪个平台的详情里，就写回那个平台的目录。
  const platformDir = platformId ? `profiles/agent-platforms/${esc(platformId)}/capabilities` : 'profiles/agent-platforms/<Agent 平台>/capabilities';

  function renderEditor() {
    if (!editorHost) return;
    if (!draft) {
      editorHost.hidden = true;
      editorHost.innerHTML = '';
      return;
    }
    editorHost.hidden = false;
    // 版面与「行为档案」面板同构：每一段是一张 card（标题 + meta + 字段 + 左下动作条）。
    editorHost.innerHTML = `
      <div class="detail-stack">
        ${cardHtml({
    title: '基本信息',
    description: `能力档 <code>${esc(draft.id)}</code>：保存后写回 <code>${platformDir}/${esc(draft.id)}.yml</code>；受众「${esc(AUDIENCE_TEXT[draft.audience] ?? draft.audience)}」、生效方式「${esc(draft.runtime?.apply === 'passthrough' ? '直通（不装预设）' : '装预设')}」由运行时读取，要在后端改。`,
    body: `<div class="form-stack" id="capabilityEditorFields"></div>
          <div class="form-actions">
            <button class="btn primary" type="button" id="capabilitySave">保存</button>
            <button class="btn" type="button" id="capabilityReset" ${draft.builtin ? '' : 'hidden'}>重置</button>
            <button class="btn ghost" type="button" id="capabilityCancel">取消</button>
            <span class="meta" id="capabilitySaveMsg" role="status"></span>
          </div>`,
  })}
        ${cardHtml({
    title: '效果',
    description: '这一侧写「要什么」：插件行由当前执行体的渲染层按效果声明生成，这里只读。',
    body: '<div id="capEditorEffects"></div>',
  })}
        ${cardHtml({
    title: '执行体工具面',
    description: '模块清单来自当前执行体的 tools.yml：换执行体，这张表跟着换。会话能用到哪一档由权限级别收紧。',
    body: '<div id="capEditorAgent"></div>',
  })}
        ${cardHtml({
    title: 'MCP 服务器',
    description: '勾选服务器后，下面的「MCP 工具」只列出这些服务器的工具。',
    body: '<div id="capEditorServers"></div>',
  })}
        ${cardHtml({
    title: 'MCP 工具',
    description: '只列出已允许服务器的工具；在这里取消勾选等于把该服务器收窄到具体工具。',
    body: '<div id="capEditorTools"></div>',
  })}
        ${cardHtml({ title: '技能', body: '<div id="capEditorSkills"></div>' })}
      </div>`;
    renderFields(editorHost.querySelector('#capabilityEditorFields'), [
      { name: 'capabilityLabel', type: 'text', label: '名称', value: draft.label },
      { name: 'capabilityNote', type: 'text', label: '备注', value: draft.note, hint: '给选能力档的人看的说明，不进提示词。' },
    ], { columns: 1, layout: 'inline' });
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
    const { capServer, capSkill, capTool } = target.dataset;
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
    // 效果与执行体工具面不在这里写：效果属于意图（由后端能力档维护），工具面属于执行体。
    // 这里只回写扩展授权，形状与 Hub 读取的那份一致：mcp.allow / mcp.tools.allow / skills.allow。
    // 没改过的通配配置保持 `- '*'`，避免把「以后新增的服务器也允许」悄悄收窄。
    const allow = draft.mcpAll
      ? ['*']
      : [...draft.servers].filter((server) => server !== '*');
    const toolAllow = draft.mcpAll
      ? ['*']
      : [
        ...allow.flatMap((server) => {
          const selection = draft.serverTools.get(server);
          if (selection === '*' || selection === undefined) return [`${server}__*`];
          return [...selection].map((toolName) => `${server}__${toolName}`);
        }),
        ...draft.toolPatterns,
      ];
    const mcp = { allow, tools: { allow: [...new Set(toolAllow)], deny: draft.deny } };
    const skills = { allow: draft.skillsAll ? ['*'] : [...draft.skills] };
    const payload = {
      label: editorHost.querySelector('#capabilityLabel')?.value?.trim() ?? '',
      note: editorHost.querySelector('#capabilityNote')?.value?.trim() ?? '',
      mcp,
      skills,
    };
    try {
      const result = await api(`/api/runtime/capabilities/${encodeURIComponent(draft.id)}`, 'PATCH', payload);
      if (!result?.ok) throw new Error(result?.error || '保存失败');
      draft.label = payload.label;
      draft.note = payload.note;
      showConsoleToast('能力档已保存');
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
      if (listHost) listHost.innerHTML = `<div class="meta">读取能力档失败：${esc(error?.message ?? error)}</div>`;
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
    if (!(await confirmBox({ message: `把「${draft.label || draft.id}」重置为出厂内容？`, confirmText: '重置' }))) return;
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
    const title = source ? `克隆能力档 · ${source.id}` : '新建能力档';
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
        showConsoleToast(source ? '已克隆能力档' : '已新建能力档');
        await load();
      } catch (error) {
        if (listHost) listHost.querySelector('#capabilityListMsg')?.replaceChildren(String(error?.message ?? error));
      }
    });
  }

  async function deleteCapability(id) {
    if (!(await confirmBox({ message: `删除能力档 ${id}？对应的能力档文件会一并删除。`, danger: true, confirmText: '删除' }))) return;
    try {
      const r = await api(`/api/capabilities/${encodeURIComponent(id)}`, 'DELETE');
      if (!r?.ok) throw new Error(r?.error || '删除失败');
      showConsoleToast('已删除能力档');
      await load();
    } catch (error) {
      if (listHost) listHost.querySelector('#capabilityListMsg')?.replaceChildren(String(error?.message ?? error));
    }
  }

  return { load, render: renderList };
}
