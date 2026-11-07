// 令牌与花费 / 上下文压缩。页面只留说明与宿主；指标块、图表控件、表格宿主与压缩设置都在这里生成，
// id 与迁移前一致（page.js 按 id 取值）。图表是手写 SVG，控件保持 data-usage-* 属性契约不变。

const SUMMARY_HTML = `<div class="overview-summary" id="usageSummary">
  <div class="metric"><span>总花费</span><strong id="metricUsageCost">—</strong><small id="metricUsageCostHint">读取中…</small></div>
  <div class="metric"><span>累计 token</span><strong id="metricUsageTokens">—</strong><small id="metricUsageTokensHint">输入 / 输出</small></div>
  <div class="metric"><span>缓存命中率</span><strong id="metricUsageHitRate">—</strong><small id="metricUsageHitHint">命中输入 ÷ 总输入</small></div>
  <div class="metric"><span>平均每轮</span><strong id="metricUsagePerTurn">—</strong><small id="metricUsagePerTurnHint">按已归属回合</small></div>
</div>`;

const CHART_HTML = `<h3 class="usage-h3">消耗走势</h3>
<div class="row usage-chart-controls" id="usageChartControls">
  <span class="meta">时间范围</span>
  <button type="button" class="tag active" data-usage-hours="24">近 24 小时</button>
  <button type="button" class="tag" data-usage-hours="72">近 3 天</button>
  <button type="button" class="tag" data-usage-hours="168">近 7 天</button>
  <button type="button" class="tag" data-usage-hours="720">近 30 天</button>
  <span class="meta">纵轴</span>
  <button type="button" class="tag active" data-usage-metric="cost">花费</button>
  <button type="button" class="tag" data-usage-metric="tokens">token</button>
</div>
<div class="usage-chart-head">
  <strong id="usageChartTotal">—</strong>
  <span class="meta" id="usageChartHint">读取中…</span>
</div>
<div class="usage-chart" id="usageChart">加载中…</div>
<div class="usage-legend">
  <span><i class="off"></i>空闲时段</span>
  <span><i class="peak"></i>高峰时段（单价 ×2）</span>
  <span><i class="mixed"></i>跨时段</span>
</div>
<div class="meta u-mt-6" id="usageChartNote"></div>`;

const CONVERSATIONS_HTML = `<h3 class="usage-h3">按会话（群 / 私聊）</h3>
<div class="tool-log-table" id="usageConversations">加载中…</div>`;

const TURNS_CONTROLS_HTML = `<div class="row usage-controls">
  <label class="sr-only" for="usageKeySelect">选择要查看逐轮明细的会话</label>
  <select id="usageKeySelect"></select>
  <button class="btn small" type="button" id="usageTurnsLoad">加载逐轮明细</button>
</div>`;

const TURNS_HEAD_HTML = `<h3 class="usage-h3">逐轮花费 <span class="meta" id="usageTurnScope">—</span></h3>`;

const TURNS_BODY_HTML = `<div class="tool-log-table" id="usageTurns">选择会话后加载逐轮明细…</div>`;

const RECENT_HTML = `<details class="settings-group"><summary>最近调用流水（实时，最新 40 条）</summary><div class="settings-content">
<div class="tool-log-table" id="usageRecent">（空）</div>
</div></details>`;

const PRICES_HTML = `<details class="settings-group"><summary>当前生效的价目表</summary><div class="settings-content">
<div id="usagePrices" class="meta">读取中…</div>
</div></details>`;

const COMPACT_MODE_HTML = `<div class="usage-compact">
  <div class="field-block">
    <div class="field-row">
      <span class="field-label">压缩方式</span>
      <div class="field-control">
        <div class="field-inline">
          <label><input type="radio" name="compactMode" value="early"> 提前压缩（桥接自己压，最省）</label>
          <label><input type="radio" name="compactMode" value="dsh"> 交给 DSH 自己压缩</label>
        </div>
      </div>
    </div>
  </div>
  <div class="field-block">
    <div class="field-row">
      <span class="field-label">提前压缩阈值</span>
      <div class="field-control">
        <span class="field-inline">
          <input id="compactWan" type="number" min="5" max="80" step="1" aria-label="提前压缩阈值（万 token）">
          <span class="field-unit">万 token</span>
        </span>
      </div>
    </div>
    <div class="field-notes"><p class="field-hint">默认 30；数字越小越省钱，很早的聊天细节也越早变成摘要（可填 5～80）。</p></div>
  </div>
  <p class="meta usage-compact-note">提前压缩：桥接把较早的历史换成一段摘要，最近约 15 万 token 原样保留；每个会话两次自动压缩至少隔 2 小时，会话正忙时不压，等它空下来。交给 DSH：deepseek-flash 的窗口是 100 万，DSH 在窗口的 80% 左右自己压缩，保留细节最多，但每一步读得最多、最贵。</p>
</div>`;

export const USAGE_FIELDS = {
  summary: { html: SUMMARY_HTML },
  actions: {
    fields: [
      {
        type: 'action',
        items: [
          { id: 'usageRefresh', label: '刷新', small: true },
          { id: 'usageClear', label: '清空账本', variant: 'danger', small: true },
        ],
        status: 'usageMsg',
        statusText: '读取中…',
      },
    ],
  },
  chart: { html: CHART_HTML },
  conversations: { html: CONVERSATIONS_HTML },
  turnsHead: { html: TURNS_HEAD_HTML },
  turnsControls: { html: TURNS_CONTROLS_HTML },
  turnsBody: { html: TURNS_BODY_HTML },
  recent: { html: RECENT_HTML },
  prices: { html: PRICES_HTML },
  compactMode: { html: COMPACT_MODE_HTML },
  compactActions: {
    html: '<div class="row u-mt-10-between"><span class="meta u-m-0" id="compactSessions">—</span><div id="compactActionMount"></div></div>',
    fields: [
      {
        type: 'action',
        items: [{ id: 'compactSave', label: '保存压缩设置', variant: 'primary' }],
        status: 'compactMsg',
      },
    ],
    mount: 'compactActionMount',
    columns: 1,
  },
};
