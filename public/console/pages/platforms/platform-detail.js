// 平台详情：左侧选中的平台在右栏按标签页展开。
//
// 标签按「这一侧真有的东西」给，不给空壳：
//   用户侧 概览 / 配置 / 话术与工具 / 行为（有档案目录才有）
//   Agent 侧 概览 / 能力（有声明的能力档才有） / 配置
// 数据来自统一注册表的那一份快照（page.js 传进来的条目），只有需要正文的面板
// （平台提示词、行为档案、能力预设）才各自去请求自己的接口。
//
// 两处有意留白，界面上写明原因而不是造数据：
//   · 没有「健康」标签：注册表不带 health 字段，POST .../probe 端点也还没实现；
//   · 「配置」只读：PATCH /api/platforms/registry/:side/:id/config 还没实现，
//     写入口仍是 platform.yml / agent-platform.yml + 重启。
import { esc, showConsoleToast } from '../../js/ui.js';
import { api } from '../../js/api.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
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
let promptCard = null; // 平台提示词卡，只属于「话术与工具」
let behaviorsPanel = null; // 行为档案面板，只属于「行为」
let capabilityPanel = null; // 能力预设面板，只属于「能力」

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
function overviewHtml(item) {
  const rows = [
    ['所在侧', esc(SIDE_LABEL[item.side] ?? item.side)],
    ['来源', `<code>${esc(item.source)}</code><div class="meta">${esc(SOURCE_HINT[item.source] ?? '')}</div>`],
    [
      '运行期',
      item.active
        ? '<span class="tag tag--success">当前启用</span>'
        : '<span class="tag">未启用</span><div class="meta">在 platform.yml / agent-platform.yml 的 active 里切换</div>',
    ],
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

// ── 配置（只读） ────────────────────────────────────────────────────────────
function configValueCell(spec, value) {
  const shown = value === undefined ? spec?.default : value;
  const isArray = Array.isArray(shown);
  const code = formatValue(shown);
  return `<code class="${isArray ? 'platform-config-code' : ''}">${esc(code)}</code>`;
}

function configHtml(item) {
  const schema = item.configSchema;
  const properties = schema?.properties ?? null;
  const file = item.side === 'user' ? 'profiles/platforms' : 'profiles/agent-platforms';
  const where = `<code>${file}/${esc(item.id)}/${item.side === 'user' ? 'platform.yml' : 'agent-platform.yml'}</code>`;
  if (!properties || !Object.keys(properties).length) {
    return `
      <section class="platform-section">
        <h3>配置</h3>
        <p class="meta">这个平台没有声明 <code>configSchema</code>，因此没有可展示的配置项。</p>
        <p class="meta">平台参数写在 ${where}，改完重启桥接生效。</p>
      </section>`;
  }
  const config = item.config ?? {};
  const required = new Set(schema.required ?? []);
  const rows = Object.entries(properties).map(([key, spec]) => ({
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
      <p class="meta">这一页只读：控制台还没有写平台配置的端点，参数改在 ${where}，重启桥接生效。</p>
      ${dataTableHtml({
    columns: [{ label: '字段', width: '180px' }, { label: '名称', width: '160px' }, { label: '当前值', width: '200px' }, { label: '说明' }],
    rows,
    pageSize: 20,
  })}
    </section>`;
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
    <section class="platform-section">
      <div id="platformCapabilityEditor"></div>
    </section>`;
}

function mountCapabilities() {
  const listHost = root?.querySelector('#platformCapabilityList');
  const editorHost = root?.querySelector('#platformCapabilityEditor');
  if (!listHost) return;
  capabilityPanel = createCapabilityPanel({ listHost, editorHost, platformId: entry?.id ?? '' });
  void capabilityPanel.load();
}

// ── 挂载 / 切换 ────────────────────────────────────────────────────────────
function shell(item) {
  const tabs = tabsOf(item);
  if (!tabs.some((t) => t.id === tab)) tab = 'overview';
  const stateTag = item.active
    ? '<span class="tag tag--success">运行期</span>'
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
 */
export function mountPlatformDetail(target, item) {
  root = target;
  entry = item;
  tab = 'overview';
  resetPanels();
  root.innerHTML = shell(item);
  root.addEventListener('click', onTabClick);
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
  resetPanels();
  root.innerHTML = '';
  root = null;
  entry = null;
  tab = 'overview';
}
