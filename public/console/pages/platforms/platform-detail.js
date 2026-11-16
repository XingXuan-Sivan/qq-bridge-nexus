// 平台详情：二级页（#platforms/<side>:<id>[/<tab>]）的正文，按标签页展开。
//
// 标签按「这一侧真有的东西」给，不给空壳：
//   用户平台 概览 / 配置 / 话术与工具 / 行为（有档案目录才有）
//   Agent 平台 概览 / 能力（有声明的能力档才有） / 配置
// 数据来自统一注册表的那一份快照（page.js 传进来的条目），只有需要正文的面板
// （平台提示词、行为档案、能力预设）才各自去请求自己的接口。
//
// 两侧的「运行期」语义不同，界面上分开说：
//   · 用户平台每一条条目就是一个实例（平台 + 账号），各有自己的入站管线：`enabled`
//     决定它装配不装配，`inboundState` 是它此刻的连接结论，`outbound` 是它发消息
//     会走的实现；`active` 只是默认实例（出站没有地址上下文时的兜底）；
//   · Agent 平台装配的是同一个单例，`active` 就是当前在跑的那个。
//
// 版面：页头（返回 + 平台名 + 徽标，components/detail-head）/ 标签条 / 面板，
// 面板里每一段是一张 card。
import { esc, showConsoleToast } from '../../js/ui.js';
import { api } from '../../js/api.js';
import { cardHtml } from '../../components/card/card.js';
import { detailHeadHtml } from '../../components/detail-head/detail-head.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { bindSwitches, getSwitch, inlineActions, renderFields, setSelectOptions } from '../../components/form/form.js';
import { hasSchemaFields, readSchemaPatch, schemaFields } from '../../components/form/schema.js';
import { mountAlert } from '../../components/alert/alert.js';
import { confirmBox } from '../../components/message-box/message-box.js';
import { mountPromptCard } from '../../components/prompt-card/prompt-card.js';
import { createCapabilityPanel } from '../../components/capability-panel/capability-panel.js';
import { capabilityLabel, conversationTypeLabel, conversationTypeTone, declaredModelCatalog, inboundStateLabel, inboundStateTone, loadModelCatalog, outboundViaLabel } from '../../js/registry.js';
import { mountBehaviorsPanel } from './behaviors-panel.js';

const SIDE_LABEL = { user: '用户平台', agent: 'Agent 平台' };
const SOURCE_LABEL = { builtin: '内置', plugin: '插件', 'profile-only': '只有配置目录', 'config-only': '只有配置条目' };
const SOURCE_HINT = {
  builtin: '随桥接一起装配的平台适配器。',
  plugin: '由插件在运行期注册的平台，没有配置目录。',
  'profile-only': '磁盘上有配置目录，但运行期没装配：在这里改的配置不会生效。',
  'config-only': '配置里有这条实例，但没有声明目录也没有实现：它不会被装配。',
};
const LEVEL_LABEL = { error: '错误', warn: '警告' };
const LEVEL_TONE = { error: 'tag--danger', warn: 'tag--warning' };
/** 能力位矩阵里的三个声明面：应用方式、提示注入通道、对端权限档。 */
const APPLY_KIND_LABEL = { preset: '装预设', passthrough: '直通（不装预设）' };
const PROMPT_CHANNEL_LABEL = { none: '不注入', system: '系统提示', prefix: '首轮前缀', tool: '工具拉取' };
/** 条目开关在表单里的字段名：它不是 configSchema 的字段，由页面自己读。 */
const ENABLED_FIELD = 'platformEnabled';
/** 默认运行方案在表单里的字段名：同样不是 configSchema 的字段（用户平台条目级）。 */
const DEFAULT_PLAN_FIELD = 'platformDefaultPlan';
/** 配置表单的挂载点：两侧共用同一个 id（同一时刻只挂一个平台），字面量只写一处。 */
const CONFIG_MOUNT = '<div id="platformConfigMount"></div>';
/** 模型卡的挂载点：只有声明了 models 能力位的 Agent 平台才有这张卡。 */
const MODEL_MOUNT = '<div id="platformModelMount"></div>';

let root = null; // 详情根节点（[data-platform-view="detail"]）
let entry = null; // 当前平台条目（注册表快照里的一份）
let tab = 'overview';
let onChanged = null; // 写成功后的刷新回调（由 page.js 提供：重拉注册表并重画）
let onTab = null; // 切标签：由 page.js 把 sub/tab 写进地址栏
let onBack = null; // 返回清单：由 page.js 切回 #platforms
let promptCard = null; // 平台提示词卡，只属于「话术与工具」
let behaviorsPanel = null; // 行为档案面板，只属于「行为」
let capabilityPanel = null; // 能力档面板，只属于「能力」
let modelCatalog = null; // 模型目录（声明 + 实时），只属于「配置」里的模型卡

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

// ── 概览 ────────────────────────────────────────────────────────────────────

/**
 * 能力位矩阵：能力位之外还有三个「这个 Agent 平台支不支持」的声明——
 * 应用方式（能力档能不能不装预设）、提示注入通道（话术怎么进去）、
 * 对端权限档（能力档能把它钉成哪些值；空 = 由对端决定）。
 */
function capabilityMatrix(item) {
  const rows = [{
    cells: [
      '能力位',
      tagsOf(item.capabilities ?? [], (name) => `<span class="tag">${esc(capabilityLabel(name))}</span>`),
    ],
  }];
  if (item.side !== 'agent') return rows;
  const declared = (list, labels) => tagsOf(list ?? [], (name) => `<span class="tag">${esc(labels[name] ?? name)}</span>`);
  rows.push({ cells: ['应用方式', declared(item.applies, APPLY_KIND_LABEL)] });
  rows.push({ cells: ['提示注入通道', declared(item.promptChannels, PROMPT_CHANNEL_LABEL)] });
  // 对端权限档：取值域由平台声明；空表示「由对端决定」，建立会话后现读现校。
  rows.push({ cells: ['对端权限档', item.peerPermissions?.length ? declared(item.peerPermissions) : '<span class="muted">由对端决定</span>'] });
  return rows;
}

/** 运行期状态：「装配的是哪个」（active）与「配置面选的是哪个」（configured）是两件事。 */
function runtimeStateCell(item) {
  if (item.active) {
    return item.side === 'user'
      ? '<span class="tag tag--success">默认实例</span>'
      : '<span class="tag tag--success">当前启用</span>';
  }
  if (item.configured) return '<span class="tag tag--warning">已设为默认，重启后生效</span>';
  const where = item.side === 'user'
    ? '在「实例」卡里设为默认'
    : '在「默认与探活」卡里设为默认';
  return `<span class="tag">非默认</span><div class="meta">${where}</div>`;
}

/** 入站结论：结论本身、它的细节，以及平台能不能把事件交给业务体。 */
function inboundCell(item) {
  const state = item.inboundState ?? null;
  const tone = inboundStateTone(state?.state);
  const tag = `<span class="tag ${tone}">${esc(inboundStateLabel(state?.state))}</span>`;
  const detail = state?.detail ? `<div class="meta">${esc(state.detail)}</div>` : '';
  // 正文契约：没声明 rawEvent 的平台只能进到准入与会话映射，管线会把事件按
  // `body_unsupported` 丢弃 —— 与其让人猜「为什么收到了却没回应」，不如写出来。
  const body = item.rawEvent
    ? ''
    : '<div class="meta">未声明正文契约（rawEvent）：入站事件会在唤醒前被丢弃</div>';
  return `${tag}${detail}${body}`;
}

/** 用户平台「实例」：条目开关与设为默认都在这里（入站 / 出站事实放在「属性」表里）。 */
function instanceHtml(item) {
  return cardHtml({
    title: '实例',
    description: '一条条目 = 一个实例（平台 + 账号），各有自己的入站管线。默认实例只决定没有地址上下文时出站用哪个账号（<code>config.json</code> 的 <code>platforms.active.user</code>）。',
    body: `<div class="row">${runtimeStateCell(item)}${item.enabled === false ? '<span class="tag tag--warning">条目已停用</span>' : ''}</div>
      ${inlineActions({
    items: item.configured ? [] : [{ id: 'platformSetUserDefault', label: '设为默认实例', variant: 'primary' }],
    status: 'platformUserMsg',
  })}`,
  });
}

/** Agent 平台「默认与探活」：探活与设为默认都在这里，不新开数据源（写口就是注册表那个）。 */
function executorHtml(item) {
  const probe = item.probe ?? null;
  const probeHtml = probe
    ? (probe.ok
      ? `<span class="tag tag--success">上次探活通过</span><span class="meta">${esc(probe.at || '')}${probe.url ? ` · ${esc(probe.url)}` : ''}</span>`
      : `<span class="tag tag--danger">上次探活未通过</span><span class="meta">${esc(probe.error || '未响应')}</span>`)
    : '<span class="meta">本次运行里还没探活过。</span>';
  return cardHtml({
    title: '默认与探活',
    description: '默认 Agent 平台是桥接启动时装配的那个（<code>config.json</code> 的 <code>platforms.active.agent</code>）。连接层句柄在启动时就绑定了，所以换平台要重启桥接；设为默认前会先探活，探不通不落盘。',
    body: `<div class="row">${runtimeStateCell(item)}${probeHtml}</div>
      ${inlineActions({
    items: [
      { id: 'platformProbe', label: '探活' },
      // 已经设为默认就不必再点一次：重启后它会变成「当前启用」。
      ...(item.configured ? [] : [{ id: 'platformSetDefault', label: '设为默认平台', variant: 'primary' }]),
    ],
    status: 'platformAgentMsg',
  })}`,
  });
}

function overviewHtml(item) {
  const rows = [
    ['所在侧', esc(SIDE_LABEL[item.side] ?? item.side)],
    ['来源', `<code>${esc(item.source)}</code><div class="meta">${esc(SOURCE_HINT[item.source] ?? '')}</div>`],
    ['运行期', runtimeStateCell(item)],
  ];
  if (item.owner) rows.push(['所有者', `<code>${esc(item.owner)}</code>`]);
  if (item.side === 'user') {
    rows.push(['条目开关', item.enabled === false
      ? '<span class="tag tag--warning">已停用</span><div class="meta">不会装配：这条不再收消息</div>'
      : '<span class="tag tag--success">已启用</span>']);
    rows.push(['入站', item.inbound ? inboundCell(item) : '<span class="tag tag--warning">只出不进</span><div class="meta">平台没提供 connect()：入站消息不会进入准入与唤醒</div>']);
    const out = item.outbound ?? {};
    rows.push(['出站', `${esc(outboundViaLabel(out.via))}${out.owner ? `<div class="meta">插件 ${esc(out.owner)}</div>` : ''}`]);
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

  return [
    cardHtml({
      title: '属性',
      body: dataTableHtml({
        columns: [{ label: '项目', width: '120px' }, { label: '值' }],
        rows: rows.map(([label, value]) => ({ cells: [esc(label), value] })),
        pageSize: 20,
        fit: true,
      }),
    }),
    item.side === 'agent' ? executorHtml(item) : instanceHtml(item),
    cardHtml({
      title: '这个平台有什么',
      description: `资产都在 ${item.side === 'user' ? 'profiles/platforms' : 'profiles/agent-platforms'}/<code>${esc(item.id)}</code> 下，改完重启桥接生效。`,
      body: `<div class="row">${assetTags}</div>`,
    }),
    cardHtml({
      title: '能力位',
      description: '平台声明的能力位决定表单与适配器能做什么；没声明的能力不会出现在任何界面里。',
      body: dataTableHtml({
        columns: [{ label: '项目', width: '160px' }, { label: '声明' }],
        rows: capabilityMatrix(item),
        pageSize: 10,
        fit: true,
      }),
    }),
    cardHtml({ title: '诊断', body: diagHtml }),
  ].join('');
}

// ── 配置 ────────────────────────────────────────────────────────────────────
/** 模型与思考强度只属于声明了 `models` 能力位的 Agent 平台：没声明的平台在它自己的界面里改。 */
function hasModels(item) {
  return item.side === 'agent' && (item.capabilities ?? []).includes('models');
}

/**
 * 两侧的配置页：字段都是 `configSchema` 生成的，保存只发给写口。
 *
 * 用户平台多一个「启用」开关：`enabled` 是**条目级**字段（这条实例装配不装配），不在
 * `configSchema` 里，由页面自己渲染与读取；即使平台没声明 schema，这个开关照样能改。
 * Agent 平台的模型选择（提供方 / 模型 / 档位 / 看图）单独一张卡：它的选项来自模型目录，
 * 不是静态 schema 能表达的。
 */
function configHtml(item) {
  const file = item.side === 'user' ? 'profiles/platforms' : 'profiles/agent-platforms';
  const where = `<code>${file}/${esc(item.id)}/${item.side === 'user' ? 'platform.yml' : 'agent-platform.yml'}</code>`;
  const hasFields = hasSchemaFields(item.configSchema);
  const model = hasModels(item)
    ? cardHtml({
      title: '模型与思考强度',
      description: '选项取自平台自己声明的模型目录（实时目录优先）。改完下一条消息生效：已经在跑的会话会在下一条消息重新选模型。',
      body: MODEL_MOUNT,
    })
    : '';
  if (item.side === 'agent' && !hasFields) {
    return model + cardHtml({
      title: '配置',
      description: `这个平台没有声明 <code>configSchema</code>，因此没有可编辑的配置项。平台参数写在 ${where}，改完重启桥接生效。`,
    });
  }
  if (!hasFields) {
    return cardHtml({
      title: '配置',
      description: `这个平台没有声明 <code>configSchema</code>：只能改「启用」与条目字段（账号）。平台参数写在 ${where}，改完重启桥接生效。`,
      body: CONFIG_MOUNT,
    }) + model;
  }
  return cardHtml({
    title: '配置',
    description: `表单字段就是 <code>config.json</code> 里 <code>platforms.${item.side === 'user' ? 'users' : 'agents'}.${esc(item.id)}</code> 那一份：连接参数（地址、令牌…）改完要重启桥接才重新连接，其余选项下一次调用就生效。配置文件 ${where} 只声明字段，不再存值。`,
    body: CONFIG_MOUNT,
  }) + model;
}

/** 挂载可写表单：字段由 configSchema 生成，保存只发给写口。 */
function mountConfig(item) {
  const host = root?.querySelector('#platformConfigMount');
  if (!host) return;
  const fields = [];
  if (item.side === 'user') {
    // 停用只是「下次启动不装配它」：已经跑着的连接不会因此断开，界面上要写清楚。
    fields.push({
      type: 'switch',
      name: ENABLED_FIELD,
      label: '启用这条实例',
      hint: '停用后重启桥接就不再装配它（不再收消息）；已在运行的连接不会即时断开。',
      checked: item.enabled !== false,
      onLabel: '开',
      offLabel: '关',
    });
    // 默认方案：这条平台新建的会话用哪套（条目级，与配置选项不同层）。
    fields.push({
      name: DEFAULT_PLAN_FIELD,
      type: 'select',
      label: '默认运行方案',
      value: item.defaultPlan || '',
      options: [],
      hint: '这个平台新建、且没单独指定方案的会话用它；某个会话要换方案，在「会话与审批 › 详情」里单独指定。',
    });
  }
  fields.push(...schemaFields(item.configSchema, item.config ?? {}));
  renderFields(host, fields, { columns: 1 });
  bindSwitches(host);
  if (item.side === 'user') void fillDefaultPlanOptions(item);
  // 动作条不参与取值：保存按钮与状态位跟在最后一个字段后面（与插件详情同构）。
  host.insertAdjacentHTML('beforeend', inlineActions({
    items: [{ id: 'platformConfigSave', label: '保存配置', variant: 'primary' }],
    status: 'platformConfigMsg',
  }));
}

/** 默认运行方案下拉：选项来自方案目录；空值 = 不设置，回退内置方案。 */
async function fillDefaultPlanOptions(item) {
  const select = root?.querySelector(`#${DEFAULT_PLAN_FIELD}`);
  if (!select) return;
  let plans = [];
  try {
    plans = (await api('/api/plans'))?.plans ?? [];
  } catch (error) {
    setStatus('platformConfigMsg', `方案目录读取失败：${error?.message ?? error}`);
  }
  setSelectOptions(select, [
    { value: '', label: '不设置（回退内置方案）' },
    ...plans.map((plan) => ({ value: plan.id, label: plan.label || plan.id })),
  ], item.defaultPlan || '');
}

// ── 模型与思考强度（Agent 平台，声明了 models 能力位才有） ────────────────────
/**
 * 选项来自平台自己声明的模型目录，两处来源分工不同：
 *   · `view`（从实时目录整理）给出提供方 → 模型 → 各模型支持的思考档位；
 *   · `declared`（agent-platform.yml 的 modelCatalog）给出档位中文名与看图声明。
 * 读不到实时目录时只把当前配置画成只读并写明原因，`declared` 仍参与提示。
 * 写口与「配置」同一个（PATCH …/config），模型类选项只是那一份配置的一部分。
 */
const MODEL_FIELDS = [
  {
    name: 'platformModelProvider',
    type: 'select',
    label: '提供方',
    options: [],
    hint: '模型凭据方式：要与 Agent 平台里的登录方式一致，不一致会报缺少凭据。',
  },
  { name: 'platformModel', type: 'select', label: '模型', options: [] },
  { name: 'platformModelEffort', type: 'select', label: '思考强度', options: [] },
  {
    name: 'platformModelVision',
    type: 'select',
    label: '看图能力',
    value: 'auto',
    options: [
      { value: 'auto', label: '自动（按目录判断）' },
      { value: 'yes', label: '能看图' },
      { value: 'no', label: '不能看图' },
    ],
    hint: '自动 = 只有目录里标明能看图的模型才把图片交给它，其余改成文字占位，不去下载。',
  },
  {
    type: 'action',
    id: 'platformModelActions',
    items: [
      { id: 'platformModelRefresh', label: '刷新目录' },
      { id: 'platformModelSave', label: '保存模型设置', variant: 'primary' },
    ],
    status: 'platformModelMsg',
  },
  { name: 'platformModelNotices', type: 'custom', span: 2, html: '<div id="platformModelNotices"></div>' },
];

const modelControl = (id) => root?.querySelector(`#${id}`) ?? null;

/** 当前选中的提供方 / 模型在目录里的条目（目录取不到时是 null）。 */
function selectedModel() {
  const providers = modelCatalog?.view?.providers ?? [];
  const provider = providers.find((p) => p.id === modelControl('platformModelProvider')?.value) ?? null;
  const entryOfProvider = provider?.models?.find((m) => m.id === modelControl('platformModel')?.value) ?? null;
  return { provider, model: entryOfProvider };
}

/** 模型下拉：选项随提供方变，保住能保住的选中值。 */
function fillModelOptions(preferred = '') {
  const select = modelControl('platformModel');
  const { provider } = selectedModel();
  const items = (provider?.models ?? []).map((m) => ({
    value: m.id,
    label: `${m.name}${m.name !== m.id ? `（${m.id}）` : ''}${m.vision === 'yes' ? ' · 能看图' : ''}`,
  }));
  const want = [preferred, select?.value, provider?.models?.[0]?.id].find((v) => v && items.some((x) => x.value === v)) ?? '';
  setSelectOptions(select, items, want);
}

/** 档位下拉：档位是模型的属性，目录取不到时用声明里的内置档。 */
function fillEffortOptions(preferred = '') {
  const select = modelControl('platformModelEffort');
  if (!select) return;
  const { model } = selectedModel();
  const fallback = modelCatalog?.declared?.effortFallback ?? [];
  const efforts = model ? (model.efforts ?? []) : fallback.map((id) => ({ id, name: id }));
  if (!efforts.length) {
    setSelectOptions(select, [{ value: '', label: model ? '该模型没有思考档位' : '目录不可用' }], '');
    select.disabled = true;
    return;
  }
  select.disabled = false;
  const labels = new Map((modelCatalog?.declared?.efforts ?? []).map((item) => [item.id, item.label]));
  const items = efforts.map((effort) => ({
    value: effort.id,
    label: `${labels.get(effort.id) || effort.name || effort.id}${effort.id === model?.defaultEffort ? '（默认）' : ''}${effort.id === 'off' ? ' · 关闭思考' : ''}`,
  }));
  const want = [preferred, select.value, model?.defaultEffort, items[0]?.value].find((v) => v && items.some((x) => x.value === v)) ?? '';
  setSelectOptions(select, items, want);
}

/** 提示条：目录状态、第三方提供方、关思考、看图降级——都是「改之前该知道」的事实。 */
function renderModelNotices() {
  const host = modelControl('platformModelNotices');
  if (!host) return;
  host.replaceChildren();
  const { provider, model } = selectedModel();
  const vision = modelControl('platformModelVision')?.value ?? 'auto';
  const effort = modelControl('platformModelEffort')?.value ?? '';
  const declared = modelCatalog?.declared ?? null;
  if (modelCatalog?.error) {
    mountAlert(host, {
      type: 'warning',
      title: '实时目录不可用',
      description: `${modelCatalog.error}。模型与档位暂时改不了，看图能力照常可改。`,
    });
  }
  if ((modelCatalog?.view?.failures ?? []).length) {
    mountAlert(host, {
      type: 'info',
      title: '有提供方没读到',
      description: modelCatalog.view.failures.map((item) => `${item.name || item.id}（${item.message || '未说明'}）`).join('、'),
    });
  }
  if (provider?.thirdParty) {
    mountAlert(host, {
      type: 'warning',
      title: '第三方提供方',
      description: `${provider.name || provider.id} 不是平台自己的提供方：会话内容（群友消息、图片、人格卡、记忆）会发给它处理，切换前先确认它的隐私政策。`,
    });
  }
  if (effort === 'off') {
    mountAlert(host, { type: 'warning', title: '思考已关闭', description: '回复更快，但工具调用、读群判断和人格一致性可能变差。' });
  }
  const declaredVision = (declared?.models ?? []).find((item) => item.id === (model?.id ?? entry?.config?.model))?.vision === true;
  const sees = vision === 'yes' || (vision === 'auto' && (model?.vision === 'yes' || (!model && declaredVision)));
  if (!sees) {
    mountAlert(host, {
      type: 'info',
      title: '图片会变成文字占位',
      description: vision === 'no'
        ? '已设为不能看图：会话里的图片、表情会改成文字占位。'
        : '这个模型能不能看图未知，按不能看图处理：图片、表情会改成文字占位；确认它能看图就选「能看图」。',
    });
  }
}

/** 用目录重新铺一遍四个控件；目录取不到时前三个只读，只有看图能力还能改。 */
function fillModelFields(catalog, config) {
  const providerSelect = modelControl('platformModelProvider');
  const modelSelect = modelControl('platformModel');
  const visionSelect = modelControl('platformModelVision');
  if (!providerSelect || !modelSelect || !visionSelect) return;
  const providers = catalog?.view?.providers ?? [];
  const wantProvider = String(config.provider ?? '');
  providerSelect.disabled = !providers.length;
  modelSelect.disabled = !providers.length;
  if (!providers.length) {
    setSelectOptions(providerSelect, [{ value: wantProvider, label: wantProvider || '（未设置）' }], wantProvider);
    setSelectOptions(modelSelect, [{ value: String(config.model ?? ''), label: String(config.model ?? '') || '（未设置）' }], String(config.model ?? ''));
  } else {
    setSelectOptions(providerSelect, providers.map((p) => ({
      value: p.id,
      label: `${p.name}${p.name !== p.id ? `（${p.id}）` : ''}${p.thirdParty ? ' · 第三方' : ''}`,
    })), providers.some((p) => p.id === wantProvider) ? wantProvider : providers[0].id);
    fillModelOptions(String(config.model ?? ''));
  }
  fillEffortOptions(String(config.reasoningEffort ?? ''));
  const vision = String(config.vision ?? 'auto');
  visionSelect.value = ['yes', 'no', 'auto'].includes(vision) ? vision : 'auto';
  renderModelNotices();
}

/** 拉（或强制刷新）模型目录：读不到也是结论，靠提示条说明原因。 */
async function refreshModelCatalog({ announce = true } = {}) {
  if (!entry) return;
  if (announce) setStatus('platformModelMsg', '读取目录中…');
  try {
    modelCatalog = await loadModelCatalog(entry.id, { force: announce });
  } catch (error) {
    modelCatalog = { declared: declaredModelCatalog(entry.id), live: null, view: null, error: String(error?.message ?? error), unsupported: false };
  }
  // 等网络回来时面板可能已经被重画（切标签 / 换平台）：那时不再改 DOM。
  if (!root?.querySelector('#platformModelMount')) return;
  fillModelFields(modelCatalog, entry.config ?? {});
  if (announce) setStatus('platformModelMsg', modelCatalog.live ? '目录已刷新' : '目录不可用');
}

async function mountModel(item) {
  const host = root?.querySelector('#platformModelMount');
  if (!host) return;
  modelCatalog = { declared: declaredModelCatalog(item.id), live: null, view: null, error: '', unsupported: false };
  renderFields(host, MODEL_FIELDS, { columns: 1 });
  // 声明面先画（档位中文名、看图声明立即有），实时目录回来再补提供方与模型。
  fillModelFields(modelCatalog, item.config ?? {});
  setStatus('platformModelMsg', '读取目录中…');
  await refreshModelCatalog({ announce: false });
  setStatus('platformModelMsg', '');
}

/** 保存模型选项：与「配置」同一个写口，服务端按实时目录再校验一次。 */
async function saveModelSettings() {
  if (!entry) return;
  const provider = modelControl('platformModelProvider');
  const model = modelControl('platformModel');
  const effort = modelControl('platformModelEffort');
  const vision = modelControl('platformModelVision');
  const patch = {
    provider: provider?.value ?? '',
    model: model?.value ?? '',
    // 无档位的模型不带 reasoningEffort：空值就是「用模型默认」。
    reasoningEffort: effort?.disabled ? '' : (effort?.value ?? ''),
    vision: vision?.value ?? 'auto',
  };
  // 换到第三方提供方：保存前再确认一次（会话内容会发给它处理）。
  const thirdParty = (modelCatalog?.view?.providers ?? []).find((p) => p.id === patch.provider)?.thirdParty === true;
  if (thirdParty && patch.provider !== String(entry.config?.provider ?? '')
    && !(await confirmBox({
      title: '切换第三方提供方',
      message: `${patch.provider} 不是平台自己的提供方。保存后，会话里的聊天内容（群友消息、图片、人格卡、记忆）会发给它处理。确定要切换吗？`,
      confirmText: '切换',
    }))) {
    setStatus('platformModelMsg', '已取消（未切换提供方）');
    return;
  }
  setStatus('platformModelMsg', '保存中…');
  try {
    const r = await api(`/api/platforms/registry/agent/${encodeURIComponent(entry.id)}/config`, 'PATCH', patch);
    if (!r?.ok) throw new Error(r?.error || '未知错误');
    setStatus('platformModelMsg', `已设为 ${patch.provider}/${patch.model}（${patch.reasoningEffort || '模型默认强度'}），下一条消息生效`);
    showConsoleToast('模型设置已保存');
  } catch (error) {
    setStatus('platformModelMsg', `保存失败：${error?.message ?? error}`);
    return;
  }
  onChanged?.();
}

// ── 话术与工具（用户平台） ────────────────────────────────────────────────────
function voiceHtml(item) {
  const tools = item.assets?.tools ?? [];
  // 提示词卡自带 .prompt-card 外壳（与「行为」标签里那张同构），不再套一层 card。
  return `
    <div class="prompt-card" id="platformPromptCard"></div>
    ${cardHtml({
    title: '平台工具',
    description: '这一层工具由平台适配器提供；某套能力档能用哪些，在「方案」页的能力档里勾。',
    body: tools.length
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
      : '<p class="meta">这个平台没有声明工具清单。</p>',
  })}`;
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

// ── 行为（用户平台，有档案目录才有） ──────────────────────────────────────────
function mountBehaviors(item) {
  const host = root?.querySelector('[data-platform-panel-body]');
  if (!host) return;
  behaviorsPanel = mountBehaviorsPanel(host, { platformId: item.id });
  void behaviorsPanel.load().catch((error) => {
    host.innerHTML = `<p class="meta err">读取行为档案失败：${esc(error?.message ?? error)}</p>`;
  });
}

// ── 能力（Agent 平台，有声明的能力档才有） ────────────────────────────────────
function capabilitiesHtml(item) {
  const count = (item.assets?.capabilityProfiles ?? []).length;
  return `
    ${cardHtml({
    title: '能力档',
    description: `这套 Agent 平台声明了 ${count} 套能力档：方案里的「能力档」字段就是从这里选。能力档的正文（工具可见集、MCP 与技能范围）在 <code>profiles/agent-platforms/${esc(item.id)}/capabilities/</code>。`,
    body: '<div id="platformCapabilityList"></div>',
  })}
    <!-- 编辑器里的每一段自己是一张 card；这里只给宿主，不再包一层。 -->
    <div id="platformCapabilityEditor"></div>`;
}

function mountCapabilities() {
  const listHost = root?.querySelector('#platformCapabilityList');
  const editorHost = root?.querySelector('#platformCapabilityEditor');
  if (!listHost) return;
  capabilityPanel = createCapabilityPanel({ listHost, editorHost, platformId: entry?.id ?? '' });
  void capabilityPanel.load();
}

// ── 写口（两侧共用） ───────────────────────────────────────────────────────

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

/** 设为默认 Agent 平台：先探活（服务端预检），过关才落盘；换平台要重启。 */
async function setDefaultCurrent() {
  if (!entry) return;
  const id = entry.id;
  setStatus('platformAgentMsg', '预检中…');
  try {
    const r = await api('/api/config/runtime', 'POST', { defaultAgent: id });
    if (!r?.ok) throw new Error(r?.error || '未知错误');
    setStatus('platformAgentMsg', r.requiresRestart ? '已设为默认，重启桥接后装配' : '已经是当前 Agent 平台');
    showConsoleToast(`默认 Agent 平台已改为 ${id}${r.requiresRestart ? '，重启桥接后生效' : ''}`);
  } catch (error) {
    setStatus('platformAgentMsg', `设定失败：${error?.message ?? error}`);
    return;
  }
  onChanged?.();
}

/** 设为默认用户实例：只改 `platforms.active.user`，两侧的条目都能改，不存在「探不过不放行」。 */
async function setDefaultUserCurrent() {
  if (!entry) return;
  const id = entry.id;
  setStatus('platformUserMsg', '保存中…');
  try {
    const r = await api('/api/config/runtime', 'POST', { defaultUser: id });
    if (!r?.ok) throw new Error(r?.error || '未知错误');
    setStatus('platformUserMsg', r.requiresRestart ? '已设为默认，重启桥接后装配' : '已经是默认实例');
    showConsoleToast(`默认实例已改为 ${id}${r.requiresRestart ? '，重启桥接后生效' : ''}`);
  } catch (error) {
    setStatus('platformUserMsg', `设定失败：${error?.message ?? error}`);
    return;
  }
  onChanged?.();
}

/** 保存配置：只发给写口，不直写 config.json。用户平台多一个条目级「启用」开关。 */
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
  if (entry.side === 'user') {
    const el = host?.querySelector(`[data-field="${ENABLED_FIELD}"]`);
    if (el) patch.enabled = getSwitch(el);
    const planSelect = host?.querySelector(`#${DEFAULT_PLAN_FIELD}`);
    if (planSelect) patch.defaultPlan = planSelect.value;
  }
  setStatus('platformConfigMsg', '保存中…');
  try {
    const r = await api(`/api/platforms/registry/${entry.side}/${encodeURIComponent(entry.id)}/config`, 'PATCH', patch);
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
  if (event.target.closest('[data-detail-back]')) { onBack?.(); return; }
  if (event.target.closest('#platformProbe')) { void probeCurrent(); return; }
  if (event.target.closest('#platformSetDefault')) { void setDefaultCurrent(); return; }
  if (event.target.closest('#platformSetUserDefault')) { void setDefaultUserCurrent(); return; }
  if (event.target.closest('#platformModelRefresh')) { void refreshModelCatalog(); return; }
  if (event.target.closest('#platformModelSave')) { void saveModelSettings(); return; }
  if (event.target.closest('#platformConfigSave')) void saveCurrentConfig();
}

/** 模型卡里的下拉联动：换提供方重算模型与档位，换模型重算档位，其余只重算提示条。 */
function onModelChange(event) {
  const select = event.target instanceof HTMLSelectElement ? event.target : null;
  if (!select) return;
  if (select.id === 'platformModelProvider') { fillModelOptions(); fillEffortOptions(); renderModelNotices(); }
  else if (select.id === 'platformModel') { fillEffortOptions(); renderModelNotices(); }
  else if (select.id === 'platformModelEffort' || select.id === 'platformModelVision') renderModelNotices();
}

// ── 挂载 / 切换 ────────────────────────────────────────────────────────────
function shell(item) {
  const tabs = tabsOf(item);
  if (!tabs.some((t) => t.id === tab)) tab = 'overview';
  // 三态与列表徽标、概览里的「运行期」行同源：配置面已改但本进程没装配，不能显示成「未启用」。
  const runningLabel = item.side === 'user' ? '默认实例' : '运行期';
  const stateTag = item.active
    ? `<span class="tag tag--success">${runningLabel}</span>`
    : item.configured
      ? '<span class="tag tag--warning">待重启</span>'
      : '<span class="tag">非默认</span>';
  // 停用是「这条不装配」，与默认实例是两回事：两个徽标可以同时出现（默认但停用）。
  const enabledTag = item.side === 'user' && item.enabled === false
    ? '<span class="tag tag--warning">已停用</span>'
    : '';
  const sourceTag = `<span class="tag">${esc(SOURCE_LABEL[item.source] ?? item.source)}</span>`;
  const headMeta = [
    esc(SIDE_LABEL[item.side] ?? item.side),
    item.owner ? `所有者 ${esc(item.owner)}` : '',
    item.active ? (item.side === 'user' ? '默认实例' : '当前在跑') : '',
  ].filter(Boolean).join(' · ');
  return `
    <div class="platform-detail">
      ${detailHeadHtml({
      title: item.label || item.id,
      code: item.id,
      meta: headMeta,
      badges: [stateTag, enabledTag, sourceTag],
      backLabel: '返回平台清单',
    })}
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
  modelCatalog = null;
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
    if (hasModels(entry)) void mountModel(entry);
  } else if (tab === 'voice') {
    host.innerHTML = voiceHtml(entry);
    void mountVoice(entry).catch((error) => {
      const card = root?.querySelector('#platformPromptCard');
      if (card) card.innerHTML = `<p class="meta err">读取平台提示词失败：${esc(error?.message ?? error)}</p>`;
    });
  } else if (tab === 'behaviors') {
    // 面板自己带 .platform-stack（每一段是一张 card），这里只清空宿主。
    host.innerHTML = '';
    mountBehaviors(entry);
  } else if (tab === 'capabilities') {
    host.innerHTML = capabilitiesHtml(entry);
    mountCapabilities();
  }
  // 面板里的表格一律交给表格组件（工具栏 / 分页 / 筛选都在组件里）。
  initDataTables(host);
}

/**
 * 在二级页的宿主里挂载某个平台的详情。
 * @param {HTMLElement} target 详情视图容器（page.js 的 [data-platform-view="detail"]）
 * @param {object} item 注册表条目（含 diagnostics 时一并展示）
 * @param {{onChanged?: () => void, onTab?: (tab: string) => void, onBack?: () => void, tab?: string}} [options]
 *   onChanged 写成功后的刷新；onTab / onBack 把标签与返回交给路由；tab 是当前路由里的标签
 */
export function mountPlatformDetail(target, item, options = {}) {
  root = target;
  entry = item;
  onChanged = options.onChanged ?? null;
  onTab = options.onTab ?? null;
  onBack = options.onBack ?? null;
  // 标签来自路由（深链里带着它）：没给或不认识就回概览。
  tab = tabsOf(item).some((entryTab) => entryTab.id === options.tab) ? options.tab : 'overview';
  resetPanels();
  root.innerHTML = shell(item);
  root.addEventListener('click', onTabClick);
  root.addEventListener('click', onActionClick);
  root.addEventListener('change', onModelChange);
  paintPanel();
}

function onTabClick(event) {
  const button = event.target instanceof Element ? event.target.closest('[data-platform-tab]') : null;
  if (!button) return;
  const next = button.dataset.platformTab;
  if (!next || next === tab) return;
  // 标签是路由的一部分（深链与前进/后退都靠它）：交给页面写进地址栏，再按新路由重挂。
  onTab?.(next);
}

/** 拆掉详情（换平台 / 回清单时调）：清掉组件状态与委托监听。 */
export function unmountPlatformDetail() {
  if (!root) return;
  root.removeEventListener('click', onTabClick);
  root.removeEventListener('click', onActionClick);
  root.removeEventListener('change', onModelChange);
  resetPanels();
  root.innerHTML = '';
  root = null;
  entry = null;
  onChanged = null;
  onTab = null;
  onBack = null;
}
