// 运行总览的字段规格：静态块全部搬进来，页面只留卡片与宿主 div。
// 动态部分（模型目录等）仍由 page.js 渲染；活动日志已移到「调试与运维」首张卡。
import { permissionLevelOptions } from '../../js/permission-levels.js';

const METRICS_HTML = `<div class="overview-summary" id="overviewSummaryMetrics">
  <div class="metric"><span>DSH 连接</span><strong id="metricDsh">连接中</strong><small id="metricDshHint">等待服务响应</small></div>
  <div class="metric"><span>SnowLuma 上游</span><strong id="metricSnowluma">读取中</strong><small id="metricSnowlumaHint">等待网关健康上报</small></div>
  <div class="metric"><span>当前运行方案</span><strong id="metricMode">—</strong><small id="metricRole">正在读取角色</small></div>
  <button class="metric metric-link" data-view="sessions"><span>已建立会话</span><strong id="metricSessions">—</strong><small>查看会话映射 <span aria-hidden="true">↗</span></small></button>
  <button class="metric metric-link" data-view="sessions" data-target="section-pending"><span>待处理请求</span><strong id="metricPending">—</strong><small>提问与工具审批 <span aria-hidden="true">↗</span></small></button>
</div>`;

const SEND_LIMIT_HTML = `<div class="field-inline">
  <label class="field-inline-label" for="sendLimitMin">每分钟最多</label>
  <input class="u-w-80" type="number" id="sendLimitMin" min="0" max="999" step="1">
  <span class="field-unit">条</span>
  <label class="field-inline-label" for="sendLimitHour">每小时最多</label>
  <input class="u-w-80" type="number" id="sendLimitHour" min="0" max="9999" step="1">
  <span class="field-unit">条</span>
</div>
<div class="meta" id="sendLimitHits">最近 24 小时没有被拦过</div>`;

const SILENCE_HEAD = `<div class="control-row">
  <span class="tag tag--info" id="silenceStatePill">—</span>
  <button type="button" id="silentToggle" class="btn">开启手动静默</button>
  <button type="button" id="silentApply" class="btn" disabled>保存静默策略</button>
  <span class="control-note" id="manualSilenceNote">开启后 AI 按下面的策略停手，直到你关闭手动静默。</span>
</div>
<div class="meta" id="manualSilenceElapsed">—</div>`;

const MANUAL_SILENCE_MODE = `<div class="field-checklist" id="manualSilenceMode" data-columns="2">
  <label class="field-check-item"><input type="radio" name="manualSilenceMode" value="full" checked><span><b>完全静默</b><span class="field-check-desc">按下面勾选的范围停掉唤醒与发送；owner 私聊始终不受影响。</span></span></label>
  <label class="field-check-item"><input type="radio" name="manualSilenceMode" value="sendOnly"><span><b>只静默发送</b><span class="field-check-desc">AI 仍会被唤醒、仍会消耗 token，只是不把话发出去；不会省 token。</span></span></label>
</div>`;

const MANUAL_SILENCE_STAGES = [
  { value: 'passive', label: '被动行为', desc: '群友发消息、@、私聊触发的唤醒与回复。' },
  { value: 'proactive', label: '主动行为', desc: '主动冒泡、潜水超时、回复检查等无人触发的唤醒。' },
  { value: 'scheduledAi', label: '定时任务·叫 AI 来说', desc: '到点唤醒 AI 生成内容；固定文字不受这一项影响。' },
  { value: 'scheduledText', label: '定时任务·固定文字', desc: '到点直接发送的预写文字，不经过 AI；与「叫 AI 来说」共用管理员开关和 owner 豁免。' },
  { value: 'pluginTasks', label: '插件任务', desc: '插件自行注册并执行的定时任务。' },
];


const SILENCE_RANGES = `<div class="silence-block">
  <div id="silenceRanges"></div>
  <div class="meta" id="silenceUpcoming">—</div>
  <div class="meta" id="silencePeakNote">高峰时段：北京时间工作日 09:00–12:00、14:00–18:00，单价 ×2（取自「令牌与花费」的价目表）</div>
  <div class="meta" id="silenceMsg" role="status"></div>
</div>`;


const DSH_NOTES = `<div id="dshModelNotices"></div>
<div class="meta" id="dshEffortNote"></div>
<div class="meta" id="dshEffortSideEffect"></div>`;

export const OVERVIEW_FIELDS = {
  // 摘要指标自带卡片外观（.overview-summary 本身就是一张卡），不能再套 .card 或字段外壳。
  metrics: { bare: true, html: METRICS_HTML },
  runtimeDefault: {
    fields: [
      {
        name: 'runtimeDefaultSelect',
        type: 'select',
        label: '默认运行方案',
        options: [],
        hint: '新建、未单独设置和重建的会话都用这个方案；某个会话要换方案，在「会话与审批 › 详情」里单独指定。',
      },
    ],
  },
  roleDefault: {
    fields: [
      {
        name: 'roleDefaultSelect',
        type: 'select',
        label: '默认人格',
        placeholder: '不挂人格卡',
        options: [],
        hint: '没有单独指定人格的会话都用这张卡；按会话的设置在「人格与角色」页。改完下一条消息生效。',
      },
    ],
  },
  permission: {
    fields: [
      {
        name: 'permissionDefault',
        type: 'select',
        label: '默认级别',
        // 档位措辞与「会话详情 › 权限级别」共用一份，避免两处文案漂移。
        options: permissionLevelOptions(false),
        hint: '没单独设置权限的会话用这个级别；会话详情里可逐条覆盖。',
      },
      {
        name: 'permissionAllowFull',
        type: 'switch',
        label: '允许 full 档',
        hint: '打开后才能在会话里用一次性授权换取 danger-full-access；关闭时所有 full 授权立刻收回并回落 qq-full-ask。',
      },
      {
        name: 'permissionTtl',
        type: 'select',
        label: '授权时长',
        options: [
          { value: '10', label: '10 分钟' },
          { value: '30', label: '30 分钟' },
          { value: '60', label: '60 分钟' },
        ],
        hint: 'full 授权到期自动回落 qq-full-ask；重启桥接也会收回。',
      },
      { name: 'permissionMsg', type: 'custom', span: 2, html: '<div class="meta" id="permissionMsg" role="status"></div>' },
    ],
  },
  sendLimit: {
    fields: [
      { name: 'overviewSendLimit', type: 'custom', span: 2, html: SEND_LIMIT_HTML },
      { name: 'sendLimitStatus', type: 'custom', span: 2, html: '<div class="meta" id="sendLimitMsg" role="status"></div>' },
    ],
  },
  personaSettings: {
    fields: [
      {
        name: 'personaSaveApply',
        type: 'radio',
        label: '生效方式',
        options: [
          { value: 'nextWake', label: '下次唤醒时重新读卡' },
          { value: 'immediate', label: '立即生效（现在就唤醒各会话说新卡）' },
        ],
        hint: '保存人格卡（新建 / 编辑 / 重置 / 按会话指定）后默认怎么生效；只作用于正在启用的会话。人格卡的注入上限在「注入块」页统一配置。',
      },
    ],
  },
  silence: {
    fields: [
      { name: 'overviewSilenceHead', type: 'custom', span: 2, html: SILENCE_HEAD },
      { name: 'manualSilenceMode', type: 'custom', label: '手动静默模式', span: 2, html: MANUAL_SILENCE_MODE },
      {
        name: 'manualSilenceStages',
        type: 'checkList',
        label: '静默范围',
        columns: 2,
        span: 2,
        options: MANUAL_SILENCE_STAGES,
        value: MANUAL_SILENCE_STAGES.map((x) => x.value),
        hint: '勾选表示该环节在静默期间停止；不勾选则照常。固定文字与「叫 AI 来说」共用下面的管理员开关，owner 私聊始终例外。',
      },
      {
        name: 'manualAdminApplies',
        type: 'switch',
        label: '对管理员生效',
        hint: '开启后管理员按普通用户处理；owner 始终不受影响。',
      },
      {
        name: 'manualRecordMessages',
        type: 'switch',
        label: '静默期间记录群消息',
        checked: true,
        hint: '不唤醒 AI，只把消息记进会话；解除静默后 AI 能补看。',
      },
      {
        name: 'manualCatchUp',
        type: 'switch',
        label: '解除后补一次唤醒',
        checked: true,
        hint: '静默期间有人直接找过 AI 时，恢复后补一次唤醒；跳过的定时任务不补跑。',
      },
      {
        name: 'silenceEnabled',
        type: 'switch',
        label: '定时静默',
        hint: '按时间段自动静默，用来避开高峰价、省 token。',
      },
      {
        name: 'silenceTimezone',
        type: 'custom',
        label: '时区',
        html: `<select id="silenceTz" aria-label="定时静默的时区"></select>`,
      },
      { name: 'overviewSilenceRanges', type: 'custom', span: 2, html: SILENCE_RANGES },
    ],
  },
  dsh: {
    fields: [
      {
        name: 'dshProviderSelect',
        type: 'select',
        label: '提供方',
        options: [],
        hint: '下一条消息生效。当前：见下方说明。',
      },
      { name: 'dshModelSelect', type: 'select', label: '模型', options: [] },
      { name: 'dshEffortSelect', type: 'select', label: '思考强度', options: [] },
      {
        name: 'dshVisionSelect',
        type: 'select',
        label: '看图能力',
        value: 'auto',
        options: [
          { value: 'auto', label: '自动（未知的按不能看图）' },
          { value: 'yes', label: '能看图' },
          { value: 'no', label: '不能看图' },
        ],
        hint: 'DSH 的模型目录不说明模型能不能看图：自动 = 只有核实过的模型才把图片交给它，其余把图片改成文字占位。',
      },
      {
        type: 'action',
        id: 'dshActions',
        items: [
          { id: 'dshCatalogRefresh', label: '刷新目录' },
        ],
        status: 'dshEffortMsg',
      },
      { name: 'overviewDshNotes', type: 'custom', span: 2, html: DSH_NOTES },
    ],
  },
};
