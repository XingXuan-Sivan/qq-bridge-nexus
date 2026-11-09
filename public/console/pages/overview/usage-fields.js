// 令牌与花费 / 上下文压缩。页面只留说明与宿主；指标块、图表控件、表格宿主与压缩设置都在这里生成，
// id 与迁移前一致（page.js 按 id 取值）。图表是手写 SVG，控件保持 data-usage-* 属性契约不变。

// 四个指标直接作为「花费概览」卡片的网格项（卡片外壳与顶部的连接指标卡共用 .overview-summary 样式）。
const SUMMARY_HTML = `
  <div class="metric"><span>总花费</span><strong id="metricUsageCost">—</strong><small id="metricUsageCostHint">读取中…</small></div>
  <div class="metric"><span>累计 token</span><strong id="metricUsageTokens">—</strong><small id="metricUsageTokensHint">输入 / 输出</small></div>
  <div class="metric"><span>缓存命中率</span><strong id="metricUsageHitRate">—</strong><small id="metricUsageHitHint">命中输入 ÷ 总输入</small></div>
  <div class="metric"><span>平均每轮</span><strong id="metricUsagePerTurn">—</strong><small id="metricUsagePerTurnHint">按已归属回合</small></div>`;

const CHART_HTML = `<div class="row usage-chart-controls" id="usageChartControls">
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

const CONVERSATIONS_HTML = `<div id="usageConversations">加载中…</div>`;

const TURNS_BODY_HTML = `<div id="usageTurns">加载中…</div>`;

const RECENT_HTML = `<details class="settings-group"><summary>最近调用流水（实时，最新 40 条）</summary><div class="settings-content">
<div id="usageRecent">（空）</div>
</div></details>`;

const PRICES_HTML = `<details class="settings-group"><summary>当前生效的价目表</summary><div class="settings-content">
<div id="usagePrices">读取中…</div>
</div></details>`;

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
  turnsBody: { html: TURNS_BODY_HTML },
  recent: { html: RECENT_HTML },
  prices: { html: PRICES_HTML },
};
