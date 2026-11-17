// 平台详情：二级页（#platforms/<side>:<id>[/<tab>]）的正文，按标签页展开。
//
// 标签按「看什么」切，两侧基本盘一致，用户平台多一页话术与行为：
//   概览          这条实例此刻是什么状态（运行期、入站出站、探活、设为默认）+ 资产计数 + 诊断
//   配置          可写项（条目开关、configSchema 生成的表单、Agent 平台的模型与思考强度）
//   能力          能做什么（一句话结论 + 只读分组）+ 工具表或能力档 + 原始声明（折叠）
//   话术与行为    平台提示词与行为档案（只有用户平台有）
// 页头下面那句结论由注册表下发（`entry.promise.text`）：前端不拼「能发 / 不能发」，
// 也不在这层维护第二张中文表 —— 否则接口与界面会对同一件事给出两个答案。
//
// 数据来自统一注册表的那一份快照（page.js 传进来的条目），只有需要正文的面板
// （平台提示词、行为档案、能力档）才各自去请求自己的接口。
//
// 两侧的「运行期」语义不同，界面上分开说：
//   · 用户平台每一条条目就是一个实例（平台 + 账号），各有自己的入站管线：`enabled`
//     决定它装配不装配，`inboundState` 是它此刻的连接结论，`outbound` 是它发消息
//     会走的实现；`active` 只是默认实例（出站没有地址上下文时的兜底）；
//   · Agent 平台装配的是同一个单例，`active` 就是当前在跑的那个。
//
// 版面：页头（返回 + 平台名 + 徽标，components/detail-head）/ 结论行 / 标签条 / 面板；
// 面板是整页一张大卡（components/detail-panel），卡内按分区排，需要描边的小内容用小卡。
import { esc, showConsoleToast } from '../../js/ui.js';
import { api } from '../../js/api.js';
import { collapseHtml } from '../../components/collapse/collapse.js';
import { detailHeadHtml } from '../../components/detail-head/detail-head.js';
import { detailCardsHtml, detailPanelHtml, detailSectionHtml } from '../../components/detail-panel/detail-panel.js';
import { keyValueHtml } from '../../components/key-value/key-value.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { bindSwitches, getSwitch, inlineActions, renderFields } from '../../components/form/form.js';
import { hasSchemaFields, readSchemaPatch, schemaFields } from '../../components/form/schema.js';
import { mountPromptCard } from '../../components/prompt-card/prompt-card.js';
import { createCapabilityPanel } from '../../components/capability-panel/capability-panel.js';
import { mountAgentModel } from '../../components/agent-model/agent-model.js';
import { capabilityLabel, conversationTypeLabel, conversationTypeTone, inboundStateLabel, inboundStateTone, outboundViaLabel, registryLabel } from '../../js/registry.js';
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
/** 条目开关在表单里的字段名：它不是 configSchema 的字段，由页面自己读。 */
const ENABLED_FIELD = 'platformEnabled';
/** 条目级默认行为：同样不是 configSchema 的字段（只用户平台有）。 */
const DEFAULT_BEHAVIOR_FIELD = 'platformDefaultBehavior';
/** 配置表单的挂载点：两侧共用同一个 id（同一时刻只挂一个平台），字面量只写一处。 */
const CONFIG_MOUNT = '<div id="platformConfigMount"></div>';
/** 模型卡的挂载点：只有声明了 models 能力位的 Agent 平台才有这张卡。 */
const MODEL_MOUNT = '<div id="platformModelMount"></div>';

let root = null; // 详情根节点（[data-platform-view="detail"]）
let entry = null; // 当前平台条目（注册表快照里的一份）
let tab = 'connect';
let onChanged = null; // 写成功后的刷新回调（由 page.js 提供：重拉注册表并重画）
let onTab = null; // 切标签：由 page.js 把 sub/tab 写进地址栏
let onBack = null; // 返回清单：由 page.js 切回 #platforms
let promptCard = null; // 平台提示词卡，只属于「话术与行为」
let behaviorsPanel = null; // 行为档案面板，只属于「话术与行为」
let capabilityPanel = null; // 能力档面板，只属于「能力」

/** 标签：两侧共前三页，用户平台多一页话术与行为。 */
const TABS_COMMON = Object.freeze([
  { id: 'overview', label: '概览' },
  { id: 'config', label: '配置' },
  { id: 'capabilities', label: '能力' },
]);
const TAB_VOICE = Object.freeze({ id: 'voice', label: '话术与行为' });

function tabsOf(item) {
  return item?.side === 'user' ? [...TABS_COMMON, TAB_VOICE] : TABS_COMMON;
}

function tagsOf(list, render) {
  const items = list.filter(Boolean).map(render);
  return items.length ? items.join(' ') : '<span class="meta">—</span>';
}

// ── 连接 ────────────────────────────────────────────────────────────────────

/**
 * 原始声明矩阵：能力位与三个「这个 Agent 平台支不支持」的声明（应用方式、
 * 提示注入通道、对端权限档）。它只在「能力 › 原始声明」里出现：主标签给小结论，
 * 逐条声明留给要对照 yml 的人。
 */
function capabilityMatrix(item) {
  const rows = [['能力位', tagsOf(item.capabilities ?? [], (name) => `<span class="tag">${esc(capabilityLabel(name))}</span>`)]];
  if (item.side !== 'agent') return rows;
  // 没有中文名的取值原样显示：对端权限档是平台自己的预设名，控制台不另维护一份表。
  const declared = (list, table) => tagsOf(list ?? [], (name) => `<span class="tag">${esc(registryLabel(table, name))}</span>`);
  rows.push(['应用方式', declared(item.applies, 'apply')]);
  rows.push(['提示注入通道', declared(item.promptChannels, 'prompt')]);
  // 对端权限档：取值域由平台声明；空表示「由对端决定」，建立会话后现读现校。
  rows.push(['对端权限档', item.peerPermissions?.length ? tagsOf(item.peerPermissions, (id) => `<span class="tag">${esc(id)}</span>`) : '<span class="muted">由对端决定</span>']);
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
  return '<span class="tag">非默认</span>';
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

/** 来源：正常来源（内置 / 插件）不用解释，只有「只有一半」的两种才要一行说明。 */
function sourceCell(item) {
  const hint = SOURCE_HINT[item.source] ?? '';
  const needHint = item.source === 'profile-only' || item.source === 'config-only';
  return `<code>${esc(item.source)}</code>${needHint && hint ? `<div class="meta">${esc(hint)}</div>` : ''}`;
}

/** 出站：走哪个实现（用户平台的 connect() 与 send() 是两回事）。 */
function outboundCell(item) {
  const out = item.outbound ?? {};
  return `${esc(outboundViaLabel(out.via))}${out.owner ? `<div class="meta">插件 ${esc(out.owner)}</div>` : ''}`;
}

/** 探活结论：结论本身 + 时间与地址，与页头徽标同一个来源。 */
function probeCell(item) {
  const probe = item.probe ?? null;
  if (!probe) return '<span class="meta">本次运行里还没探活过</span>';
  if (probe.ok) {
    return `<span class="tag tag--success">通过</span><div class="meta">${esc(probe.at || '')}${probe.url ? ` · ${esc(probe.url)}` : ''}</div>`;
  }
  return `<span class="tag tag--danger">未通过</span><div class="meta">${esc(probe.error || '未响应')}</div>`;
}

/** 状态卡上的动作：探活与设为默认（两条写口都在注册表上，不新开数据源）。 */
function stateActions(item) {
  if (item.side === 'agent') {
    return [
      { id: 'platformProbe', label: '探活' },
      // 已经设为默认就不必再点一次：重启后它会变成「当前启用」。
      ...(item.configured ? [] : [{ id: 'platformSetDefault', label: '设为默认平台', variant: 'primary' }]),
    ];
  }
  return item.configured ? [] : [{ id: 'platformSetUserDefault', label: '设为默认实例', variant: 'primary' }];
}

/**
 * 概览 ›「运行状态」分区：事实用键值网格横着铺（两对一行），操作跟在下面。
 *
 * 字段按侧给：Agent 平台没有「条目开关」与「出站」这两个概念，多一个默认能力档与探活结论。
 */
function stateSectionHtml(item) {
  const rows = [
    ['所在侧', esc(SIDE_LABEL[item.side] ?? item.side)],
    ['来源', sourceCell(item)],
    ['运行期', runtimeStateCell(item)],
  ];
  if (item.owner) rows.push(['所有者', `<code>${esc(item.owner)}</code>`]);
  if (item.side === 'user') {
    rows.push(['条目开关', item.enabled === false
      ? '<span class="tag tag--warning">已停用</span>'
      : '<span class="tag tag--success">已启用</span>']);
    rows.push(['入站', item.inbound ? inboundCell(item) : '<span class="tag tag--warning">只出不进</span><div class="meta">平台没提供 connect()：入站消息不会进入准入与唤醒</div>']);
    rows.push(['出站', outboundCell(item)]);
  }
  if (item.side === 'agent') {
    if (item.defaultCapability) rows.push(['默认能力档', `<code>${esc(item.defaultCapability)}</code>`]);
    rows.push(['上次探活', probeCell(item)]);
  }
  return detailSectionHtml({
    title: '运行状态',
    note: item.side === 'user'
      ? '默认实例只决定没有地址上下文时出站用哪个账号（<code>config.json</code> 的 <code>platforms.active.user</code>）。'
      : '默认 Agent 平台是桥接启动时装配的那个（<code>config.json</code> 的 <code>platforms.active.agent</code>）：连接层句柄在启动时就绑定了，所以换平台要重启。',
    body: `${keyValueHtml({ rows })}
      ${inlineActions({ items: stateActions(item), status: item.side === 'user' ? 'platformUserMsg' : 'platformAgentMsg' })}`,
  });
}

/** 资产计数：磁盘上有什么，一项一张小卡。路径写在脚注里，不在这里铺开。 */
function assetCardsHtml(item) {
  const assets = item.assets ?? {};
  const prompt = assets.prompt?.active ? '自定义' : assets.prompt?.hasDefault ? '出厂' : '无';
  return detailCardsHtml([
    { title: '平台提示词', value: prompt, text: true, hint: 'prompt.md' },
    { title: '平台工具', value: String((assets.tools ?? []).length), hint: 'tools.yml' },
    { title: '行为档案', value: String((assets.behaviors ?? []).length), hint: 'behaviors/' },
    { title: '能力档', value: String((assets.capabilityProfiles ?? []).length), hint: 'capabilities/' },
  ]);
}

/** 诊断列表：结论是注册表判好的，页面只按级别上色。 */
function diagnosticsHtml(item) {
  const diags = Array.isArray(item.diagnostics) ? item.diagnostics : [];
  if (!diags.length) return '';
  return dataTableHtml({
    columns: [{ label: '级别', width: '80px' }, { label: '代码', width: '180px' }, { label: '说明' }],
    rows: diags.map((diag) => ({
      cells: [
        `<span class="tag ${LEVEL_TONE[diag.level] ?? ''}">${esc(LEVEL_LABEL[diag.level] ?? diag.level)}</span>`,
        `<code>${esc(diag.code)}</code>`,
        esc(diag.message || ''),
      ],
    })),
    pageSize: 10,
    empty: '没有诊断。',
  });
}

/** 诊断分区：有问题才占地方（全部正常时概览就是「状态 + 资产」两段）。 */
function diagnosticsSectionHtml(item) {
  const body = diagnosticsHtml(item);
  return body ? detailSectionHtml({ title: '诊断', note: '注册表判好的结论：级别、代码与说明。', body }) : '';
}

/**
 * 概览：这条实例此刻是什么状态（+ 能力可做的事），后面跟资产与诊断。
 *
 * 先答「能不能用」（运行期 / 入站 / 出站 / 默认），再说「磁盘上有什么」。
 * 三段同在一张大卡里，资产段再用小卡分层：一张卡一个数字。
 */
function overviewHtml(item) {
  return [
    stateSectionHtml(item),
    detailSectionHtml({ title: '资产', body: assetCardsHtml(item) }),
    diagnosticsSectionHtml(item),
  ].join('');
}

// ── 能力（两侧同构） ────────────────────────────────────────────────────────

/**
 * 结论 + 只读分组：每组一张小卡，卡头右上角标来源，卡里是一排「名字 + id」的药丸。
 *
 * 清单与那句结论都由注册表算好（`entry.promise`）：这里只摆版式，不做「支持不支持」的
 * 判断，也不给勾选框 —— 能不能做是平台声明的**事实**，不是控制台能改的开关；
 * 真要改，改的是平台的声明文件或能力档。
 */
function promiseCardsHtml(item) {
  const groups = item.promise?.groups ?? [];
  if (!groups.length) {
    return '<p class="meta">注册表没有给出这个平台的能力结论：先看「概览」里的诊断。</p>';
  }
  return detailCardsHtml(groups.map((group) => {
    const pills = group.items.length
      ? `<div class="cap-pill-row">${group.items.map((entryItem) => `<span class="cap-pill"><span>${esc(entryItem.label)}</span><code>${esc(entryItem.id)}</code></span>`).join('')}</div>`
      : '';
    const note = group.note ? `<p class="meta">${esc(group.note)}</p>` : '';
    return {
      title: group.label,
      // 来源放卡头：它不是内容，只是「这句话从哪来」。
      actions: `<span class="tag">${esc(group.source || '平台声明')}</span>`,
      body: pills ? `${pills}${note}` : (note || '<p class="meta">这个平台没有声明这一组。</p>'),
    };
  }), { wide: true });
}

/** 用户平台的工具分区：适配器提供的那一层工具（能力档能用哪些在 Agent 平台那边勾）。 */
function toolsSectionHtml(item) {
  const tools = item.assets?.tools ?? [];
  return detailSectionHtml({
    title: '平台工具',
    note: '工具由平台适配器提供；某套能力档能用哪些，在对应 Agent 平台详情的「能力」里勾。',
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
        pageSize: 10,
        search: { placeholder: '搜索工具名或说明…' },
        refresh: true,
        meta: `${tools.length} 个工具`,
        empty: '这个平台没有声明工具清单。',
      })
      : '<p class="meta">这个平台没有声明工具清单。</p>',
  });
}

/**
 * 原始声明：逐条能力位、会话类型与发送限制，默认折叠。
 *
 * 主标签给的是结论（能做什么），这里给的是「那句话从哪一行来的」：
 * 排查「为什么它不支持图片」时能直接对上声明文件。
 */
function rawDeclarationHtml(item) {
  const rows = capabilityMatrix(item);
  if ((item.conversationTypes ?? []).length) {
    rows.push(['会话类型', tagsOf(item.conversationTypes, (type) => `<span class="tag ${conversationTypeTone(type)}">${esc(conversationTypeLabel(type))}</span>`)]);
  }
  const limits = item.limits ?? {};
  const limitText = [
    limits.chunkChars ? `单条上限 ${limits.chunkChars} 字` : '',
    limits.markdown === true ? '允许 Markdown' : limits.markdown === false ? '只发纯文本' : '',
  ].filter(Boolean).join(' · ');
  if (limitText) rows.push(['发送限制', esc(limitText)]);
  return collapseHtml({
    id: `platform-raw-${item.side}-${item.id}`,
    title: '原始声明',
    plain: true,
    body: keyValueHtml({ rows, columns: 1 }),
  });
}

/**
 * 能力：注册表给的分组 + 工具表（用户平台）或能力档（Agent 平台），最后是折叠的原始声明。
 */
function capabilityHtml(item) {
  const profiles = (item.assets?.capabilityProfiles ?? []).length;
  return [
    detailSectionHtml({ title: '能力清单', body: promiseCardsHtml(item) }),
    item.side === 'user' ? toolsSectionHtml(item) : (profiles ? capabilitySectionHtml(item) : ''),
    rawDeclarationHtml(item),
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
    ? detailSectionHtml({
      title: '模型与思考强度',
      note: '选项取自平台的模型目录（实时目录优先）；改完下一条消息生效。',
      body: MODEL_MOUNT,
    })
    : '';
  const optionsNote = !hasFields
    ? `这个平台没有声明 <code>configSchema</code>：${item.side === 'user' ? '只能改「启用」与条目字段（账号）；' : ''}参数写在 ${where}，改完重启桥接生效。`
    : `表单字段就是 <code>config.json</code> 里 <code>platforms.${item.side === 'user' ? 'users' : 'agents'}.${esc(item.id)}</code> 那一份：连接参数改完要重启才重连，其余选项下一次调用生效。`;
  // Agent 平台没有 schema 时没有可写的字段：这一节只留说明，参数在文件里。
  const options = item.side === 'agent' && !hasFields
    ? detailSectionHtml({ title: '配置', note: optionsNote })
    : detailSectionHtml({ title: '配置', note: optionsNote, body: CONFIG_MOUNT });
  return options + model;
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
    // 条目级默认行为：会话的行为档案选「跟随平台默认」时用它，空 = 不挂行为（聊天模式）。
    fields.push({
      type: 'select',
      name: DEFAULT_BEHAVIOR_FIELD,
      label: '默认行为',
      value: item.defaultBehavior || '',
      options: [
        { value: '', label: '不设置（聊天模式）' },
        ...(item.assets?.behaviors ?? []).map((id) => ({ value: id, label: id })),
      ],
      hint: '会话的行为档案选「跟随平台默认」时读它；行为档案正文在「话术与行为」里改。',
    });
  }
  fields.push(...schemaFields(item.configSchema, item.config ?? {}));
  renderFields(host, fields, { columns: 1 });
  bindSwitches(host);
  // 动作条不参与取值：保存按钮与状态位跟在最后一个字段后面（与插件详情同构）。
  host.insertAdjacentHTML('beforeend', inlineActions({
    items: [{ id: 'platformConfigSave', label: '保存配置', variant: 'primary' }],
    status: 'platformConfigMsg',
  }));
}

// ── 话术与行为（用户平台） ──────────────────────────────────────────────────
/**
 * 话术与行为：两段自带标题的内容（平台提示词 / 行为档案），与能力页同一种「大卡里分节」的版式。
 * 行为档案面板自己出两块分区，这里只给它一个分节容器，不再套一层卡。
 */
function voiceHtml(item) {
  const hasBehaviors = (item.assets?.behaviors ?? []).length > 0;
  return `<div class="prompt-card" id="platformPromptCard"></div>
    ${hasBehaviors ? '<div class="detail-sections" id="platformBehaviorsHost"></div>' : ''}`;
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

// ── 行为（用户平台，有档案目录才有） ──────────────────────────────
function mountBehaviors(item) {
  const host = root?.querySelector('#platformBehaviorsHost');
  if (!host) return;
  behaviorsPanel = mountBehaviorsPanel(host, { platformId: item.id });
  void behaviorsPanel.load().catch((error) => {
    host.innerHTML = `<p class="meta err">读取行为档案失败：${esc(error?.message ?? error)}</p>`;
  });
}

// ── 能力档（Agent 平台，有声明的能力档才有） ─────────────────────
function capabilitySectionHtml(item) {
  const count = (item.assets?.capabilityProfiles ?? []).length;
  // 编辑器里的每一段自己是一张 card（组件按 cardHtml 出），在大卡里统一降成小卡。
  return detailSectionHtml({
    title: '能力档',
    note: `这套 Agent 平台声明了 ${count} 套能力档：会话详情里的「能力档」就是从这里选。能力档的正文（效果、MCP 与技能范围）在 <code>profiles/agent-platforms/${esc(item.id)}/capabilities/</code>。`,
    body: '<div id="platformCapabilityList"></div><div id="platformCapabilityEditor"></div>',
  });
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
    const behaviorSelect = host?.querySelector(`#${DEFAULT_BEHAVIOR_FIELD}`);
    if (behaviorSelect) patch.defaultBehavior = behaviorSelect.value;
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
  if (event.target.closest('#platformConfigSave')) { void saveCurrentConfig(); return; }
  // 表格工具栏上的刷新：重画当前面板（数据源仍是注册表快照与各自的读口）。
  if (event.target.closest('[data-table-refresh]')) paintPanel();
}

/** 模型卡的事件由组件自己收口：换提供方重算模型与档位，换模型重算档位，其余只重算提示条。 */
function mountModel(item) {
  const host = root?.querySelector('#platformModelMount');
  if (!host) return;
  mountAgentModel(host, { agentId: item.id, config: item.config ?? {}, prefix: 'platform', onSaved: () => onChanged?.() });
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
  // 一句话结论由注册表下发：能发什么 / 能不能收 / 效果与权限档，前端不拼字符串。
  const promiseText = String(item.promise?.text ?? '').trim();
  const headMeta = [
    esc(SIDE_LABEL[item.side] ?? item.side),
    item.owner ? `所有者 ${esc(item.owner)}` : '',
    item.active ? (item.side === 'user' ? '默认实例' : '当前在跑') : '',
  ].filter(Boolean).join(' · ');
  // 整页是一张大卡：页头、结论句、标签条与面板都在卡内，卡外不留裸露的页面底色。
  return `
    <div class="platform-detail detail-view">
      ${detailPanelHtml({
      body: `${detailHeadHtml({
        title: item.label || item.id,
        code: item.id,
        meta: headMeta,
        badges: [stateTag, enabledTag, sourceTag],
        backLabel: '返回平台清单',
      })}
      ${promiseText ? `<p class="platform-promise">${esc(promiseText)}</p>` : ''}
      <div class="page-tabs" role="tablist">
        ${tabs.map((t) => `<button class="page-tab${t.id === tab ? ' active' : ''}" type="button" role="tab" aria-selected="${t.id === tab}" data-platform-tab="${t.id}">${esc(t.label)}</button>`).join('')}
      </div>
      <div class="detail-body" data-platform-panel-body></div>`,
    })}
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
    if (hasModels(entry)) void mountModel(entry);
  } else if (tab === 'capabilities') {
    host.innerHTML = capabilityHtml(entry);
    if (entry.side === 'agent' && (entry.assets?.capabilityProfiles ?? []).length) mountCapabilities();
  } else if (tab === 'voice') {
    host.innerHTML = voiceHtml(entry);
    void mountVoice(entry).catch((error) => {
      const card = root?.querySelector('#platformPromptCard');
      if (card) card.innerHTML = `<p class="meta err">读取平台提示词失败：${esc(error?.message ?? error)}</p>`;
    });
    if ((entry.assets?.behaviors ?? []).length) mountBehaviors(entry);
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
  resetPanels();
  root.innerHTML = '';
  root = null;
  entry = null;
  onChanged = null;
  onTab = null;
  onBack = null;
}
