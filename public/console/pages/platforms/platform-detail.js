// 平台详情：左侧选中的平台在右栏按标签页展开。
//
// 标签按「这一侧真有的东西」给，不给空壳：
//   用户侧 概览 / 配置 / 话术与工具 / 行为（有档案目录才有）
//   Agent 侧 概览 / 能力（有声明的能力档才有） / 配置
// 数据来自统一注册表的那一份快照（page.js 传进来的条目），只有需要正文的面板
// （平台提示词、行为档案、能力预设）才各自去请求自己的接口。
//
// 两处有意留白，界面上写明原因而不是造数据：
//   · 用户侧「配置」只读：连接参数由活着的传输手柄持有，热写的语义与 Agent 侧不同，
//     这一版只给 Agent 侧开写口；
//   · Agent 侧没有「健康」标签：探活结论显示在概览的「执行体」里（按钮 + 上次结果），
//     不开一块和后台轮询重复展示的面板。
import { esc, showConsoleToast } from '../../js/ui.js';
import { api } from '../../js/api.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { bindSwitches, inlineActions, renderFields } from '../../components/form/form.js';
import { hasSchemaFields, readSchemaPatch, schemaFields } from '../../components/form/schema.js';
import { mountPromptCard } from '../../components/prompt-card/prompt-card.js';
import { createCapabilityPanel } from '../../components/capability-panel/capability-panel.js';
import { capabilityLabel, conversationTypeLabel, conversationTypeTone } from '../../js/registry.js';
import { mountBehaviorsPanel } from './behaviors-panel.js';

const SIDE_LABEL = { user: '用户侧', agent: 'Agent 侧' };
const SOURCE_LABEL = { builtin: '内置', plugin: '插件', 'profile-only': '只有配置目录' };
const SOURCE_HINT = {
  builtin: '随桥接一起装配的平台适配器。',
  plugin: '由插件在运行期注册的平台，没有配置目录。',
  'profile-only': '磁盘上有配置目录，但运行期没装配：在这里改的配置不会生效。',
};
const LEVEL_LABEL = { error: '错误', warn: '警告' };
const LEVEL_TONE = { error: 'tag--danger', warn: 'tag--warning' };

let root = null; // 详情根节点（[data-split-detail]）
let entry = null; // 当前平台条目（注册表快照里的一份）
let tab = 'overview';
let mountedKey = ''; // 上一次挂载的平台 key：同一平台重挂时保留当前标签
let onChanged = null; // 写成功后的刷新回调（由 page.js 提供：重拉注册表并重画）
let promptCard = null; // 平台提示词卡，只属于「话术与工具」
let behaviorsPanel = null; // 行为档案面板，只属于「行为」
let capabilityPanel = null; // 能力档面板，只属于「能力」

/** 这一侧该有哪些标签：判断依据是注册表条目里有没有对应资产，不是平台 id。 */
function tabsOf(item) {
  const tabs = [{ id: 'overview', label: '概览' }];
  if (item.side === 'agent' && (item.assets?.capabilityProfiles ?? []).length) {
    tabs.push({ id: 'capabilities', label: '能力' });
  }
  tabs.push({ id: 'config', label: '配置' });
  if (item.side === 'user') {
    tabs.push({ id: 'voice', label: '话术与工具' });
    if ((item.assets?.behaviors ?? []).length) tabs.push({ id: 'behaviors', label: '行为' });
  }
  return tabs;
}

function tagsOf(list, render) {
  const items = list.filter(Boolean).map(render);
  return items.length ? items.join(' ') : '<span class="meta">—</span>';
}

function formatValue(value) {
  if (value === undefined || value === null || value === '') return '（未设置）';
  if (typeof value === 'boolean') return value ? '开' : '关';
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ── 概览 ────────────────────────────────────────────────────────────────────

/** 运行期状态：「装配的是哪个」（active）与「配置面选的是哪个」（configured）是两件事。 */
function runtimeStateCell(item) {
  if (item.active) return '<span class="tag tag--success">当前启用</span>';
  if (item.configured) return '<span class="tag tag--warning">已设为默认，重启后生效</span>';
  const where = item.side === 'user'
    ? '改 <code>config.json</code> 的 <code>platforms.active.user</code>'
    : '在下面的「执行体」里设为默认';
  return `<span class="tag">未启用</span><div class="meta">${where}</div>`;
}

/** Agent 侧「执行体」：探活与设为默认都在这里，不新开数据源（写口就是注册表那个）。 */
function executorHtml(item) {
  const probe = item.probe ?? null;
  const probeHtml = probe
    ? (probe.ok
      ? `<span class="tag tag--success">上次探活通过</span><span class="meta">${esc(probe.at || '')}${probe.url ? ` · ${esc(probe.url)}` : ''}</span>`
      : `<span class="tag tag--danger">上次探活未通过</span><span class="meta">${esc(probe.error || '未响应')}</span>`)
    : '<span class="meta">本次运行里还没探活过。</span>';
  return `
    <section class="platform-section">
      <h3>执行体</h3>
      <p class="meta">默认执行体是桥接启动时装配的那个 Agent 平台（<code>config.json</code> 的 <code>platforms.active.agent</code>）。
        连接层句柄在启动时就绑定了，所以换执行体要重启桥接；设为默认前会先探活，探不通不落盘。</p>
      <div class="row">${runtimeStateCell(item)}${probeHtml}</div>
      ${inlineActions({
    items: [
      { id: 'platformProbe', label: '探活' },
      // 已经设为默认就不必再点一次：重启后它会变成「当前启用」。
      ...(item.configured ? [] : [{ id: 'platformSetDefault', label: '设为默认执行体', variant: 'primary' }]),
    ],
    status: 'platformAgentMsg',
  })}
    </section>`;
}

function overviewHtml(item) {
  const rows = [
    ['所在侧', esc(SIDE_LABEL[item.side] ?? item.side)],
    ['来源', `<code>${esc(item.source)}</code><div class="meta">${esc(SOURCE_HINT[item.source] ?? '')}</div>`],
    ['运行期', runtimeStateCell(item)],
  ];
  if (item.owner) rows.push(['所有者', `<code>${esc(item.owner)}</code>`]);
  if (item.side === 'user') {
    rows.push(['入站', item.inbound ? '可收可发' : '<span class="tag tag--warning">只出不进</span><div class="meta">平台没提供 connect()：入站消息不会进入准入与唤醒</div>']);
  }
  if ((item.conversationTypes ?? []).length) {
    rows.push(['会话类型', tagsOf(item.conversationTypes, (type) => `<span class="tag ${conversationTypeTone(type)}">${esc(conversationTypeLabel(type))}</span>`)]);
  }
  const limits = item.limits ?? {};
  const limitText = [
    limits.chunkChars ? `单条上限 ${limits.chunkChars} 字` : '',
    limits.markdown === true ? '允许 Markdown' : limits.markdown === false ? '只发纯文本' : '',
  ].filter(Boolean).join(' · ');
  if (limitText) rows.push(['发送限制', esc(limitText)]);

  const assets = item.assets ?? {};
  const assetTags = [
    `<span class="tag">提示词 ${assets.prompt?.active ? '自定义' : assets.prompt?.hasDefault ? '出厂' : '无'}</span>`,
    `<span class="tag">工具 ${(assets.tools ?? []).length}</span>`,
    `<span class="tag">行为 ${(assets.behaviors ?? []).length}</span>`,
    `<span class="tag">能力档 ${(assets.capabilityProfiles ?? []).length}</span>`,
  ].join(' ');

  const diags = Array.isArray(item.diagnostics) ? item.diagnostics : [];
  const diagHtml = diags.length
    ? dataTableHtml({
      columns: [{ label: '级别', width: '80px' }, { label: '代码', width: '180px' }, { label: '说明' }],
      rows: diags.map((diag) => ({
        cells: [
          `<span class="tag ${LEVEL_TONE[diag.level] ?? ''}">${esc(LEVEL_LABEL[diag.level] ?? diag.level)}</span>`,
          `<code>${esc(diag.code)}</code>`,
          esc(diag.message || ''),
        ],
      })),
      pageSize: 10,
      empty: '这个平台没有诊断。',
    })
    : '<p class="meta">这个平台没有诊断。</p>';

  return `
    <section class="platform-section">
      <h3>属性</h3>
      ${dataTableHtml({
    columns: [{ label: '项目', width: '120px' }, { label: '值' }],
    rows: rows.map(([label, value]) => ({ cells: [esc(label), value] })),
    pageSize: 20,
  })}
    </section>
    ${item.side === 'agent' ? executorHtml(item) : ''}
    <section class="platform-section">
      <h3>这个平台有什么</h3>
      <p class="meta">资产都在 ${item.side === 'user' ? 'profiles/platforms' : 'profiles/agent-platforms'}/<code>${esc(item.id)}</code> 下，改完重启桥接生效。</p>
      <div class="row">${assetTags}</div>
    </section>
    <section class="platform-section">
      <h3>能力位</h3>
      <p class="meta">平台声明的能力位决定表单与适配器能做什么；没声明的能力不会出现在任何界面里。</p>
      <div class="row">${tagsOf(item.capabilities ?? [], (name) => `<span class="tag">${esc(capabilityLabel(name))}</span>`)}</div>
    </section>
    <section class="platform-section">
      <h3>诊断</h3>
      ${diagHtml}
    </section>`;
}

// ── 配置 ────────────────────────────────────────────────────────────────────
function configValueCell(spec, value) {
  const shown = value === undefined ? spec?.default : value;
  const isArray = Array.isArray(shown);
  const code = formatValue(shown);
  return `<code class="${isArray ? 'platform-config-code' : ''}">${esc(code)}</code>`;
}

/** 用户侧：连接参数由活着的传输手柄持有，这一版只读。 */
function userConfigHtml(item, where) {
  const schema = item.configSchema;
  const config = item.config ?? {};
  const required = new Set(schema.required ?? []);
  const rows = Object.entries(schema.properties).map(([key, spec]) => ({
    cells: [
      `<code>${esc(key)}</code>${required.has(key) ? ' <span class="tag tag--sm">必填</span>' : ''}`,
      `<span class="meta">${esc(spec?.title || key)}</span>`,
      configValueCell(spec, config[key]),
      `<span class="meta">${esc(spec?.description || '')}</span>`,
    ],
  }));
  return `
    <section class="platform-section">
      <h3>配置</h3>
      <p class="meta">这一页只读：参数改在 ${where}，重启桥接生效。</p>
      ${dataTableHtml({
    columns: [{ label: '字段', width: '180px' }, { label: '名称', width: '160px' }, { label: '当前值', width: '200px' }, { label: '说明' }],
    rows,
    pageSize: 20,
  })}
    </section>`;
}

function configHtml(item) {
  const file = item.side === 'user' ? 'profiles/platforms' : 'profiles/agent-platforms';
  const where = `<code>${file}/${esc(item.id)}/${item.side === 'user' ? 'platform.yml' : 'agent-platform.yml'}</code>`;
  if (!hasSchemaFields(item.configSchema)) {
    return `
      <section class="platform-section">
        <h3>配置</h3>
        <p class="meta">这个平台没有声明 <code>configSchema</code>，因此没有可编辑的配置项。</p>
        <p class="meta">平台参数写在 ${where}，改完重启桥接生效。</p>
      </section>`;
  }
  if (item.side === 'user') return userConfigHtml(item, where);
  return `
    <section class="platform-section">
      <h3>配置</h3>
      <p class="meta">表单字段就是 <code>config.json</code> 里 <code>platforms.agents.${esc(item.id)}</code> 那一份：
        端点（地址、令牌、鉴权头）改完要重启桥接才重新连接，其余选项下一次调用就生效。
        配置文件 ${where} 只声明字段，不再存值。</p>
      <div id="platformConfigMount"></div>
    </section>`;
}

/** 挂载 Agent 侧可写表单：字段由 configSchema 生成，保存只发给写口。 */
function mountConfig(item) {
  const host = root?.querySelector('#platformConfigMount');
  if (!host) return;
  renderFields(host, schemaFields(item.configSchema, item.config ?? {}), { columns: 1 });
  bindSwitches(host);
  // 动作条不参与取值：保存按钮与状态位跟在最后一个字段后面（与插件详情同构）。
  host.insertAdjacentHTML('beforeend', inlineActions({
    items: [{ id: 'platformConfigSave', label: '保存配置', variant: 'primary' }],
    status: 'platformConfigMsg',
  }));
}

// ── 话术与工具（用户侧） ────────────────────────────────────────────────────
function voiceHtml(item) {
  const tools = item.assets?.tools ?? [];
  return `
    <section class="platform-section">
      <div class="prompt-card" id="platformPromptCard"></div>
    </section>
    <section class="platform-section">
      <h3>平台工具</h3>
      <p class="meta">这一层工具由平台适配器提供；某套能力档能用哪些，在「方案」页的能力档里勾。</p>
      ${tools.length
    ? dataTableHtml({
      columns: [{ label: '工具' }, { label: '工具名', width: '180px' }, { label: '说明' }, { label: '风险', width: '90px' }, { label: '默认', width: '90px' }],
      rows: tools.map((tool) => ({
        cells: [
          esc(tool.label || tool.flag),
          `<code>${esc(tool.flag)}</code>`,
          esc(tool.desc || '—'),
          `<span class="tag">${esc(tool.risk)}</span>`,
          tool.defaultOff ? '<span class="tag">默认关闭</span>' : '<span class="tag">默认开启</span>',
        ],
      })),
      pageSize: 12,
      empty: '这个平台没有声明工具清单。',
    })
    : '<p class="meta">这个平台没有声明工具清单。</p>'}
    </section>`;
}

/** 平台提示词：正文来自 /api/platform/prompts/<id>，保存与还原都由提示词卡自己收口。 */
async function mountVoice(item) {
  const host = root?.querySelector('#platformPromptCard');
  if (!host) return;
  const resp = await api(`/api/platform/prompts/${encodeURIComponent(item.id)}`);
  const doc = resp?.prompt ?? resp;
  if (!resp?.ok || !doc) throw new Error(resp?.error || '读取平台提示词失败');
  promptCard = mountPromptCard(host, {
    title: '平台提示词',
    hint: '这一层只写「在这个平台怎么当人」：群聊礼仪、引用与分条、该说不该说、发送禁令。占位符 {platform}、{displayName}、{owner} 由适配器渲染；保存写入 prompt.md，下一轮唤醒生效。',
    value: doc.text ?? '',
    factory: doc.factoryText ?? '',
    onSave: async () => {
      const r = await api(`/api/platform/prompts/${encodeURIComponent(item.id)}`, 'PUT', { text: promptCard.getValue() });
      if (!r?.ok) throw new Error(r?.error || '保存失败');
      showConsoleToast('平台提示词已保存');
      return { text: r.prompt?.text ?? promptCard.getValue(), factory: doc.factoryText ?? '' };
    },
    onRestore: async () => {
      const r = await api(`/api/platform/prompts/${encodeURIComponent(item.id)}/restore`, 'POST', {});
      if (!r?.ok) throw new Error(r?.error || '还原失败');
      showConsoleToast('已还原出厂');
      return { text: r.prompt?.text ?? '', factory: r.prompt?.factoryText ?? '' };
    },
  });
}

// ── 行为（用户侧，有档案目录才有） ──────────────────────────────────────────
function mountBehaviors(item) {
  const host = root?.querySelector('[data-platform-panel-body]');
  if (!host) return;
  behaviorsPanel = mountBehaviorsPanel(host, { platformId: item.id });
  void behaviorsPanel.load().catch((error) => {
    host.innerHTML = `<p class="meta err">读取行为档案失败：${esc(error?.message ?? error)}</p>`;
  });
}

// ── 能力（Agent 侧，有声明的能力档才有） ────────────────────────────────────
function capabilitiesHtml(item) {
  const count = (item.assets?.capabilityProfiles ?? []).length;
  return `
    <section class="platform-section">
      <h3>能力档</h3>
      <p class="meta">这套 Agent 平台声明了 ${count} 套能力档：方案里的「能力档」字段就是从这里选。
        能力档的正文（工具可见集、MCP 与技能范围）在 <code>profiles/agent-platforms/${esc(item.id)}/capabilities/</code>。</p>
      <div id="platformCapabilityList"></div>
    </section>
    <!-- 编辑器自己带 .platform-stack，与行为档案面板那块同构；这里不再包一层 section。 -->
    <div id="platformCapabilityEditor"></div>`;
}

function mountCapabilities() {
  const listHost = root?.querySelector('#platformCapabilityList');
  const editorHost = root?.querySelector('#platformCapabilityEditor');
  if (!listHost) return;
  capabilityPanel = createCapabilityPanel({ listHost, editorHost, platformId: entry?.id ?? '' });
  void capabilityPanel.load();
}

// ── 写口（Agent 侧） ─────────────────────────────────────────────────────────

/** 状态位文字就写在该面板的动作条里；面板已重画时什么也不做。 */
function setStatus(id, text) {
  const el = root?.querySelector(`#${id}`);
  if (el) el.textContent = text;
}

/** 探活当前平台：结论记在服务端的 `agentProbes` 里，重拉快照就能看到。 */
async function probeCurrent() {
  if (!entry) return;
  const id = entry.id;
  setStatus('platformAgentMsg', '探活中…');
  try {
    const r = await api(`/api/platforms/registry/agent/${encodeURIComponent(id)}/probe`, 'POST', {});
    if (!r?.ok) throw new Error(r?.error || '未知错误');
    const ok = r.probe?.ok === true;
    setStatus('platformAgentMsg', ok ? '探活通过' : `未通过：${r.probe?.error || '未响应'}`);
    showConsoleToast(ok ? `${id} 探活通过` : `${id} 探活未通过`);
  } catch (error) {
    setStatus('platformAgentMsg', `探活失败：${error?.message ?? error}`);
    return;
  }
  onChanged?.();
}

/** 设为默认执行体：先探活（服务端预检），过关才落盘；换执行体要重启。 */
async function setDefaultCurrent() {
  if (!entry) return;
  const id = entry.id;
  setStatus('platformAgentMsg', '预检中…');
  try {
    const r = await api('/api/config/runtime', 'POST', { defaultAgent: id });
    if (!r?.ok) throw new Error(r?.error || '未知错误');
    setStatus('platformAgentMsg', r.requiresRestart ? '已设为默认，重启桥接后装配' : '已经是当前执行体');
    showConsoleToast(`默认执行体已改为 ${id}${r.requiresRestart ? '，重启桥接后生效' : ''}`);
  } catch (error) {
    setStatus('platformAgentMsg', `设定失败：${error?.message ?? error}`);
    return;
  }
  onChanged?.();
}

/** 保存配置：只发给写口，不直写 config.json。 */
async function saveCurrentConfig() {
  if (!entry) return;
  const host = root?.querySelector('#platformConfigMount');
  let patch;
  try {
    patch = readSchemaPatch(entry.configSchema, host);
  } catch (error) {
    setStatus('platformConfigMsg', `配置不是合法 JSON：${error?.message ?? '解析失败'}`);
    return;
  }
  setStatus('platformConfigMsg', '保存中…');
  try {
    const r = await api(`/api/platforms/registry/agent/${encodeURIComponent(entry.id)}/config`, 'PATCH', patch);
    if (!r?.ok) throw new Error(r?.error || '未知错误');
    setStatus('platformConfigMsg', r.requiresRestart ? '已保存，重启桥接后重连' : '已保存');
    showConsoleToast(r.requiresRestart ? '已保存，重启桥接后生效' : '平台配置已保存');
  } catch (error) {
    setStatus('platformConfigMsg', `保存失败：${error?.message ?? error}`);
    return;
  }
  onChanged?.();
}

/** 写口按钮的事件委托：面板重画后不需要重新绑定。 */
function onActionClick(event) {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest('#platformProbe')) { void probeCurrent(); return; }
  if (event.target.closest('#platformSetDefault')) { void setDefaultCurrent(); return; }
  if (event.target.closest('#platformConfigSave')) void saveCurrentConfig();
}

// ── 挂载 / 切换 ────────────────────────────────────────────────────────────
function shell(item) {
  const tabs = tabsOf(item);
  if (!tabs.some((t) => t.id === tab)) tab = 'overview';
  // 三态与列表徽标、概览里的「运行期」行同源：配置面已改但本进程没装配，不能显示成「未启用」。
  const stateTag = item.active
    ? '<span class="tag tag--success">运行期</span>'
    : item.configured
      ? '<span class="tag tag--warning">待重启</span>'
      : '<span class="tag">未启用</span>';
  const sourceTag = `<span class="tag">${esc(SOURCE_LABEL[item.source] ?? item.source)}</span>`;
  return `
    <div class="platform-detail">
      <header class="platform-head">
        <div class="platform-head-main">
          <h3>${esc(item.label || item.id)} <code>${esc(item.id)}</code></h3>
          <p class="meta">${esc(SIDE_LABEL[item.side] ?? item.side)} · ${esc(item.source)}${item.active ? ' · 运行期平台' : ''}</p>
        </div>
        <div class="row">${stateTag}${sourceTag}</div>
      </header>
      <div class="page-tabs" role="tablist">
        ${tabs.map((t) => `<button class="page-tab${t.id === tab ? ' active' : ''}" type="button" role="tab" aria-selected="${t.id === tab}" data-platform-tab="${t.id}">${esc(t.label)}</button>`).join('')}
      </div>
      <div class="platform-stack" data-platform-panel-body></div>
    </div>`;
}

/** 面板切换时先拆掉上一个面板的组件实例：提示词卡与能力面板都持有模块级状态。 */
function resetPanels() {
  promptCard = null;
  behaviorsPanel = null;
  capabilityPanel = null;
}

function paintPanel() {
  const host = root?.querySelector('[data-platform-panel-body]');
  if (!host || !entry) return;
  resetPanels();
  host.innerHTML = '';
  if (tab === 'overview') {
    host.innerHTML = overviewHtml(entry);
  } else if (tab === 'config') {
    host.innerHTML = configHtml(entry);
    mountConfig(entry);
  } else if (tab === 'voice') {
    host.innerHTML = voiceHtml(entry);
    void mountVoice(entry).catch((error) => {
      const card = root?.querySelector('#platformPromptCard');
      if (card) card.innerHTML = `<p class="meta err">读取平台提示词失败：${esc(error?.message ?? error)}</p>`;
    });
  } else if (tab === 'behaviors') {
    host.innerHTML = '<div class="platform-stack" data-behaviors-host></div>';
    mountBehaviors(entry);
  } else if (tab === 'capabilities') {
    host.innerHTML = capabilitiesHtml(entry);
    mountCapabilities();
  }
  // 面板里的表格一律交给表格组件（工具栏 / 分页 / 筛选都在组件里）。
  initDataTables(host);
}

/**
 * 在右栏挂载某个平台的详情。
 * @param {HTMLElement} target [data-split-detail] 容器
 * @param {object} item 注册表条目（含 diagnostics 时一并展示）
 * @param {{onChanged?: () => void}} [options] 写成功后的刷新回调（重拉注册表并重画页面）
 */
export function mountPlatformDetail(target, item, options = {}) {
  root = target;
  entry = item;
  onChanged = options.onChanged ?? null;
  // 同一平台重挂（保存 / 探活 / 切默认后的整页刷新）时保留当前标签：改完配置不该跳回概览。
  const key = `${item.side}:${item.id}`;
  if (key !== mountedKey) tab = 'overview';
  mountedKey = key;
  resetPanels();
  root.innerHTML = shell(item);
  root.addEventListener('click', onTabClick);
  root.addEventListener('click', onActionClick);
  paintPanel();
}

function onTabClick(event) {
  const button = event.target instanceof Element ? event.target.closest('[data-platform-tab]') : null;
  if (!button) return;
  const next = button.dataset.platformTab;
  if (!next || next === tab) return;
  tab = next;
  for (const el of root.querySelectorAll('[data-platform-tab]')) {
    const on = el.dataset.platformTab === tab;
    el.classList.toggle('active', on);
    el.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  paintPanel();
}

/** 拆掉详情（切平台 / 离开页面时调）：清掉组件状态与委托监听。 */
export function unmountPlatformDetail() {
  if (!root) return;
  root.removeEventListener('click', onTabClick);
  root.removeEventListener('click', onActionClick);
  resetPanels();
  root.innerHTML = '';
  root = null;
  entry = null;
  onChanged = null;
}
