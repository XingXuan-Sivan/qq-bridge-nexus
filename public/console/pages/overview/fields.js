// 运行总览的字段规格：静态块全部搬进来，页面只留卡片与宿主 div。
// 动态部分（静默时段行、活动日志、模型目录）仍由 page.js 渲染。

const METRICS_HTML = `<div class="overview-summary" id="overviewSummaryMetrics">
  <div class="metric"><span>DSH 连接</span><strong id="metricDsh">连接中</strong><small id="metricDshHint">等待服务响应</small></div>
  <div class="metric"><span>SnowLuma 上游</span><strong id="metricSnowluma">读取中</strong><small id="metricSnowlumaHint">等待网关健康上报</small></div>
  <div class="metric"><span>当前运行模式</span><strong id="metricMode">—</strong><small id="metricRole">正在读取角色</small></div>
  <button class="metric metric-link" data-view="sessions"><span>已建立会话</span><strong id="metricSessions">—</strong><small>查看会话映射 <span aria-hidden="true">↗</span></small></button>
  <button class="metric metric-link" data-view="sessions" data-target="section-pending"><span>待处理请求</span><strong id="metricPending">—</strong><small>提问与工具审批 <span aria-hidden="true">↗</span></small></button>
</div>`;

const MODE_HTML = `<div class="mode-row" id="modeRow">
  <button data-mode="chat" aria-pressed="false"><span class="mode-indicator" aria-hidden="true"></span><strong>聊天模式</strong><small>白名单内，随时对话</small></button>
  <button data-mode="closed-agent" aria-pressed="false"><span class="mode-indicator" aria-hidden="true"></span><strong>封闭 Agent</strong><small>仅管理员私聊，L1/L2/L3 分级</small></button>
  <button data-mode="reserved" aria-pressed="false"><span class="mode-indicator" aria-hidden="true"></span><strong>一代仿真</strong><small>按策略自然参与群聊</small></button>
  <button data-mode="reserved2" aria-pressed="false"><span class="mode-indicator" aria-hidden="true"></span><strong>二代仿真</strong><small>自主阅读、发言与潜水</small></button>
</div>`;

// 管理通道状态：只读一行。紧急关闭按钮已挪到「调试与运维 › 桥接控制」，与重启/清空工作区同组，
// 避免在运行模式卡里误点（这里本来就是低频破坏性操作）。
const ADMIN_ROW = `<div class="control-row">
  <span class="meta control-grow" id="adminStatus">管理通道状态读取中…</span>
</div>
<div class="meta">切换后即时保存。仿真参数可在左侧对应页面调整；封闭 Agent 仅允许管理员私聊。v0.3.0 起所有模式变更都会私聊通知管理员，并写入 state/admin/audit.jsonl；高权限闲置超时自动回落。</div>`;

const ACTIVITY_HTML = `<pre id="activity" class="activity-log">（空）</pre>`;

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
  <span class="pill n" id="silenceStatePill">—</span>
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
  <div class="control-row">
    <button id="silenceAdd" class="btn small">＋ 添加时间段</button>
    <button id="silencePeak" class="btn small">一键填入 DeepSeek 高峰时段</button>
    <span class="control-note" id="silencePeakNote">高峰：北京时间工作日 09:00–12:00、14:00–18:00，单价 ×2（取自「令牌与花费」的价目表）</span>
  </div>
  <div class="meta" id="silenceUpcoming">—</div>
</div>`;


const DSH_NOTES = `<div id="dshModelNotices"></div>
<div class="meta" id="dshEffortNote"></div>
<div class="meta" id="dshEffortSideEffect"></div>`;

export const OVERVIEW_FIELDS = {
  // 摘要指标自带卡片外观（.overview-summary 本身就是一张卡），不能再套 .card 或字段外壳。
  metrics: { bare: true, html: METRICS_HTML },
  mode: {
    fields: [
      { name: 'overviewMode', type: 'custom', span: 2, html: MODE_HTML },
      {
        name: 'closedPreset',
        type: 'select',
        label: 'DSH 预设',
        options: [{ value: '', label: '（DSH 默认 preset）' }],
        hint: '封闭 Agent 自选 DSH 预设（仅 admin.allowCustomAgentPreset=true 时对 L2/L3 生效，且没有审批闸门）。',
      },
      {
        name: 'closedLevel',
        type: 'select',
        label: '权限级别',
        value: 'L2',
        options: [
          { value: 'L1', label: 'L1 本地只读（只读工具白名单）' },
          { value: 'L2', label: 'L2 工作区读写（危险操作需审批）' },
          { value: 'L3', label: 'L3 高权限（需 TOTP 动态码 + 每次审批）' },
        ],
      },
      { name: 'overviewAdmin', type: 'custom', span: 2, html: ADMIN_ROW },
    ],
  },
  activity: {
    fields: [{ name: 'overviewActivity', type: 'custom', span: 2, html: ACTIVITY_HTML }],
  },
  behaviorDefault: {
    fields: [
      {
        name: 'behaviorDefaultPanel',
        type: 'custom',
        span: 2,
        html: `<div class="field-row">
  <span class="field-label">默认行为档案</span>
  <div class="field-control"><div class="role-default-control">
    <select id="behaviorDefaultSelect" class="u-w-190"><option value="">（未设置，预设必须自带 behavior）</option></select>
    <div class="field-hint">预设在 <code>preset.yml</code> 里绑定 <code>behavior</code> 时以预设为准；这里只在预设未绑定时兜底。档案 kind 必须与运行模式一致。</div>
  </div></div>
</div>`,
      },
    ],
  },
  roleDefault: {
    fields: [
      {
        name: 'roleDefaultPanel',
        type: 'custom',
        span: 2,
        html: `<div class="field-row">
  <span class="field-label">默认人格</span>
  <div class="field-control"><div class="role-default-control">
    <select id="roleDefaultSelect" class="u-w-190"><option value="">不挂人格卡</option></select>
    <div class="field-hint">没有单独指定人格的会话都用这张卡；按会话的设置在「人格与角色」页。改完下一条消息生效。</div>
  </div></div>
</div>`,
      },
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
        name: 'personaInjectMax',
        type: 'number',
        label: '注入上限',
        min: 1000,
        max: 20000,
        step: 100,
        unit: '字符',
        hint: '按模式筛完小节后再截断，约 4~6k token 的成本护栏；范围 1000~20000，改完下一条消息生效。',
      },
      {
        name: 'personaSaveApply',
        type: 'radio',
        label: '生效方式',
        options: [
          { value: 'nextWake', label: '下次唤醒时重新读卡' },
          { value: 'immediate', label: '立即生效（现在就唤醒各会话说新卡）' },
        ],
        hint: '保存人格卡（新建 / 编辑 / 重置 / 按会话指定）后默认怎么生效；只作用于正在启用的会话。',
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
      {
        type: 'action',
        id: 'silenceActions',
        items: [{ id: 'silenceSave', label: '保存定时静默', variant: 'primary' }],
        status: 'silenceMsg',
      },
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
