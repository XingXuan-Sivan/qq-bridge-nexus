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

// 管理通道状态 + 紧急关闭：状态是长文本，单独一行；按钮与它同行右对齐。
const ADMIN_ROW = `<div class="control-row">
  <span class="meta control-grow" id="adminStatus">管理通道状态读取中…</span>
  <button type="button" id="adminPanic" class="btn danger">紧急关闭（回到安全模式）</button>
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
  <span class="status-badge is-pill" id="silenceStatePill">—</span>
  <button type="button" id="silentOn" class="btn">开启静默</button>
  <button type="button" id="silentOff" class="btn">恢复正常</button>
  <span class="control-note">手动开关优先：手动开启后一直静默；定时静默期间点「恢复正常」= 这一段临时恢复，下一段照常。</span>
</div>
<div class="meta">静默时群友消息不投递 agent，仅管理员可对话。</div>`;

const SILENCE_RANGES = `<div class="silence-block">
  <div id="silenceRanges"></div>
  <div class="control-row">
    <button id="silenceAdd" class="btn small">＋ 添加时间段</button>
    <button id="silencePeak" class="btn small">一键填入 DeepSeek 高峰时段</button>
    <span class="control-note" id="silencePeakNote">高峰：北京时间工作日 09:00–12:00、14:00–18:00，单价 ×2（取自「令牌与花费」的价目表）</span>
  </div>
</div>`;

// 静默期间的行为：唤醒档位是单选（互斥），其余是复选。
const SILENCE_OPTIONS = `<div class="silence-options">
  <div class="u-fw-500">静默期间</div>
  <div class="meta u-mt-4">AI 的唤醒</div>
  <label class="sched-chip silence-opt"><input type="radio" name="silenceWakeTier" value="stop"> 全部停止（被 @、主动冒泡、睡醒、回复检查都不唤醒）——最省 token<span class="meta">原来的手动静默只拦发送，AI 仍会被定时唤醒去思考；这一档连唤醒一起停</span></label>
  <label class="sched-chip silence-opt"><input type="radio" name="silenceWakeTier" value="direct"> 只在被 @ 或私聊时唤醒<span class="meta">有人 @ AI、引用回复 AI 或私聊 AI 时，这个群 / 私聊照常放行 10 分钟（能接着聊几句）；主动冒泡、睡醒等其余唤醒照样停，大头的花费照样省下</span></label>
  <label class="sched-chip silence-opt"><input type="radio" name="silenceWakeTier" value="normal"> 照常唤醒，只拦往外发<span class="meta">AI 照样思考、照样花钱，只是说的话不发出去</span></label>
  <label class="sched-chip silence-opt"><input type="checkbox" data-silence-opt="recordMessages"> 群消息照样记下（不唤醒 AI），恢复后 AI 能补看这段时间说了什么</label>
  <label class="sched-chip silence-opt"><input type="checkbox" data-silence-opt="catchUpOnEnd"> 静默期间有人 @ / 叫名字 / 提问 / 拍一拍 AI，结束时补一次唤醒</label>
  <label class="sched-chip silence-opt"><input type="checkbox" data-silence-opt="pauseAiTasks"> 定时任务里「叫 AI 来说」的也暂停（任务里可以单独设「照常执行」）；固定文字照发</label>
  <label class="sched-chip silence-opt"><input type="checkbox" data-silence-opt="includeOwnerPrivate"> 管理员私聊也一起静默（默认不勾：你随时能和 AI 私聊）</label>
</div>
<div class="meta" id="silenceUpcoming">—</div>`;

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
  sendLimit: {
    fields: [
      { name: 'overviewSendLimit', type: 'custom', span: 2, html: SEND_LIMIT_HTML },
      {
        type: 'action',
        id: 'sendLimitActions',
        items: [{ id: 'sendLimitSave', label: '保存发言上限', variant: 'primary' }],
        status: 'sendLimitMsg',
      },
    ],
  },
  silence: {
    fields: [
      { name: 'overviewSilenceHead', type: 'custom', span: 2, html: SILENCE_HEAD },
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
      { name: 'overviewSilenceOptions', type: 'custom', span: 2, html: SILENCE_OPTIONS },
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
          { id: 'dshEffortSave', label: '保存', variant: 'primary' },
          { id: 'dshCatalogRefresh', label: '刷新目录' },
        ],
        status: 'dshEffortMsg',
      },
      { name: 'overviewDshNotes', type: 'custom', span: 2, html: DSH_NOTES },
    ],
  },
};
