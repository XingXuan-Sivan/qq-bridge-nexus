// 令牌与花费 / 上下文压缩：已并入运行总览页，本模块由 overview/page.js 调 init()。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { getCurrentPage, onPageRefresh, setConsolePage } from '../../js/router.js';
import { setMsg } from '../../components/message/message.js';
import { renderFields } from '../../components/form/form.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { USAGE_FIELDS } from './usage-fields.js';

// ── 消耗走势图（手写 SVG） ───────────────────────────────────────────────
// 为什么不用图表库：控制台 CSP 是 default-src 'self'，不能引外部脚本；
// 而 SVG 用 document.createElementNS 生成既没有 innerHTML 转义风险，
// 也能直接用 CSS 变量跟随深浅主题。
let usageChartHours = 24;
let usageChartMetric = 'cost';
let usageChartData = null;

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}
function usageBucketValue(b, metric) {
  return metric === 'tokens' ? (Number(b.tokens) || 0) : (Number(b.cost) || 0);
}
function usageMetricLabel(metric) {
  return metric === 'tokens' ? 'token' : '花费';
}
function usageAxisValue(v, metric, sym) {
  if (metric === 'tokens') return usageNum(v);
  if (v === 0) return sym + '0';
  return v < 0.01 ? sym + v.toFixed(4) : sym + v.toFixed(2);
}
function usageBucketClock(ms, bucketMs) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  // 桶宽 ≥ 1 天时只显示日期，否则显示「日 时:分」，跨天也能分辨。
  if (bucketMs >= 24 * 3600 * 1000) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderUsageChart(series) {
  const box = document.getElementById('usageChart');
  const totalEl = document.getElementById('usageChartTotal');
  const hintEl = document.getElementById('usageChartHint');
  const noteEl = document.getElementById('usageChartNote');
  usageChartData = series;
  const sym = series?.symbol || '¥';
  const buckets = Array.isArray(series?.buckets) ? series.buckets : [];
  if (!buckets.length) {
    box.innerHTML = '';
    box.textContent = '暂无数据';
    totalEl.textContent = '—';
    hintEl.textContent = '还没有用量记录';
    noteEl.textContent = '';
    return;
  }
  const metric = usageChartMetric;
  const values = buckets.map((b) => usageBucketValue(b, metric));
  const max = Math.max(...values, 0);
  // 全零时给一个假上限，避免除零；同时让空图看起来是"平"的而不是报错。
  const scaleMax = max > 0 ? max : 1;

  const W = 960;
  const H = 240;
  const padL = 62;
  const padR = 12;
  const padT = 12;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const step = plotW / buckets.length;
  const barW = Math.max(2, step * 0.72);

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${usageMetricLabel(metric)}随时间的走势图` });

  // 横向网格 + 纵轴刻度（3 条线即可：0 / 一半 / 最大）
  // 窗口内完全没有用量时（max === 0）三条刻度都写 0：不能编出一个 ¥1 的假量程，
  // 那会让人以为"有量但很小"。
  for (let i = 0; i <= 2; i += 1) {
    const y = padT + plotH - (plotH * i) / 2;
    svg.appendChild(svgEl('line', { class: 'usage-grid', x1: padL, y1: y, x2: W - padR, y2: y }));
    const label = svgEl('text', { class: 'usage-axis', x: padL - 8, y: y + 3, 'text-anchor': 'end' });
    label.textContent = usageAxisValue(max > 0 ? (scaleMax * i) / 2 : 0, metric, sym);
    svg.appendChild(label);
  }

  // 柱：颜色 = 该桶的峰谷档位，所以"什么时候贵"是一眼可见的
  for (let i = 0; i < buckets.length; i += 1) {
    const b = buckets[i];
    const v = values[i];
    const x = padL + i * step + (step - barW) / 2;
    const h = v > 0 ? Math.max(1.5, (v / scaleMax) * plotH) : 0;
    const tooltip = svgEl('title');
    tooltip.textContent = `${usageBucketClock(b.t, series.bucketMs)}\n${usageMetricLabel(metric)}：${usageAxisValue(v, metric, sym)}`
      + `\n未命中输入：${usageNum(b.cacheMiss)} ｜ 命中输入：${usageNum(b.cacheHit)} ｜ 输出：${usageNum(b.output)}`
      + `\n步数：${usageNum(b.steps)} ｜ 轮次：${usageNum(b.turns)}`
      + `\n时段：${b.tier === 'peak' ? '高峰（单价 ×2）' : (b.tier === 'mixed' ? '跨时段' : '空闲')}`
      + (b.keys?.length ? `\n会话：${b.keys.join('、')}` : '');
    if (h > 0) {
      const rect = svgEl('rect', { x, y: padT + plotH - h, width: barW, height: h, rx: 2, class: `usage-bar-${b.tier === 'peak' ? 'peak' : (b.tier === 'mixed' ? 'mixed' : 'off')}` });
      rect.appendChild(tooltip);
      svg.appendChild(rect);
    }
    // 透明命中区：0 值的桶也能 hover（鼠标移到空白处也要能看出那一刻是空闲还是高峰）
    const hit = svgEl('rect', { x: padL + i * step, y: padT, width: step, height: plotH, class: 'usage-hit' });
    hit.appendChild(tooltip.cloneNode(true));
    svg.appendChild(hit);
  }

  // 横轴：最多 6 个刻度，避免挤在一起
  const tickEvery = Math.max(1, Math.ceil(buckets.length / 6));
  for (let i = 0; i < buckets.length; i += tickEvery) {
    const label = svgEl('text', { class: 'usage-axis', x: padL + i * step + step / 2, y: H - padB + 16, 'text-anchor': 'middle' });
    label.textContent = usageBucketClock(buckets[i].t, series.bucketMs);
    svg.appendChild(label);
  }

  box.innerHTML = '';
  box.appendChild(svg);

  const windowTotal = buckets.reduce((sum, b) => sum + usageBucketValue(b, metric), 0);
  totalEl.textContent = metric === 'tokens' ? `${usageNum(windowTotal)} token` : usageMoney(windowTotal, sym);
  const busiest = series.busiest;
  hintEl.textContent = `窗口内合计 ｜ 每格 ${Math.round(series.bucketMs / 60000)} 分钟`
    + (busiest && metric === 'cost' ? ` ｜ 最贵一格：${usageBucketClock(busiest.t, series.bucketMs)} ${usageMoney(busiest.cost, sym)}` : '')
    + (series.estimated ? ' ｜ ⚠️ 含按兜底价估算的模型' : '');

  // 图上一定要能看出"还有多少没画进来"：投影基线覆盖的更早历史没有逐时明细。
  const notes = [];
  if (Number(series.offChartCost) > 0.0001) {
    notes.push(`另有 ${usageMoney(series.offChartCost, sym)}（约 ${usageNum(series.offChartTokens)} token）属于更早的历史，只有累计值、没有逐时明细，因此不在上图里；所以本图合计会小于「总花费」。`);
  }
  if (series.countedSamples === 0) {
    notes.push('所选时间窗内没有采样：要么这段时间真的没调用，要么逐轮明细已被容量上限淘汰（累计总量仍然准确）。');
  }
  noteEl.textContent = notes.join(' ');
}

async function refreshUsageChart() {
  try {
    const r = await api(`/api/tokens/series?hours=${usageChartHours}`);
    renderUsageChart(r);
  } catch (error) {
    document.getElementById('usageChart').textContent = `走势读取失败：${error?.message || '未知错误'}`;
  }
}

// ── 令牌与花费 ───────────────────────────────────────────────────────────
// 数据分三层：累计总量（DSH tokenUsage 投影，权威）→ 按会话归并 → 逐轮明细。
// 金额一律在渲染时算，价目表改了不需要重算历史。
let usageSelectedKey = '';
let usageConversationsCache = [];

function usageNum(n) {
  const v = Number(n) || 0;
  if (v >= 1e8) return (v / 1e8).toFixed(2) + ' 亿';
  if (v >= 1e5) return (v / 1e4).toFixed(0) + ' 万';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + ' 万';
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function usageMoney(n, sym) {
  const s = sym || '¥';
  const v = Number(n) || 0;
  if (v === 0) return s + '0';
  if (v < 0.01) return s + v.toFixed(4);
  return s + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function usagePct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return (v * 100).toFixed(1) + '%';
}
function usageRate(buckets) {
  const b = buckets || {};
  const input = (b.cacheMiss || 0) + (b.cacheHit || 0) + (b.cacheWrite || 0);
  return input > 0 ? (b.cacheHit || 0) / input : 0;
}
function usageTime(ms) {
  if (!ms) return '—';
  try { return new Date(ms).toLocaleString('zh-CN', { hour12: false }); } catch (error) { return '—'; }
}
function applyUsageBarWidths(root) {
  root.querySelectorAll('.usage-bar-fill[data-pct]').forEach((el) => {
    el.style.width = `${el.dataset.pct}%`;
  });
}
function usageBar(share) {
  const ratio = Math.max(0, Math.min(1, Number(share) || 0));
  const width = Math.max(2, Math.round(ratio * 100));
  return `<span class="usage-bar-wrap"><span class="usage-bar-track"><span class="usage-bar-fill" data-pct="${width}"></span></span><span class="meta">${(ratio * 100).toFixed(1)}%</span></span>`;
}
function usageTierTag(tier) {
  if (tier === 'peak') return '<span class="pill r usage-tier">高峰</span>';
  if (tier === 'off') return '<span class="pill g usage-tier">空闲</span>';
  if (tier === 'mixed') return '<span class="pill b usage-tier">跨时段</span>';
  return '<span class="meta">—</span>';
}

function usageTable(box, { sig, ...opts }) {
  // 3 秒轮询不得打断用户正在用的搜索/筛选/分页：数据没变就不重建。
  if (box.dataset.usageSig === sig) return false;
  box.dataset.usageSig = sig;
  box.innerHTML = dataTableHtml(opts);
  initDataTables(box);
  return true;
}

function usageKeyFilterOptions(selected) {
  return usageConversationsCache.length
    ? usageConversationsCache.map((c) => ({ value: String(c.key ?? ''), label: String(c.key ?? '') }))
    : [{ value: selected || '', label: selected || '（暂无会话）' }];
}

function renderUsageConversations(r) {
  const box = document.getElementById('usageConversations');
  const list = r.conversations || [];
  const sym = r.symbol || '¥';
  usageConversationsCache = list;
  if (!list.length) {
    box.dataset.usageSig = 'empty';
    box.innerHTML = '<div class="empty-state"><strong>还没有用量记录</strong><p>QQ 会话产生一次 LLM 调用后，这里会按群 / 好友列出 token 与花费。新账本从桥接重启后开始记账。</p></div>';
    return;
  }
  const maxCost = Math.max(...list.map((x) => Number(x.cost) || 0), 0);
  const rows = list.map((c) => {
    const key = String(c.key ?? '');
    const isInternal = key.startsWith('internal:');
    const type = isInternal ? '<span class="pill b">内部</span>'
      : (key.startsWith('private:') ? '<span class="pill b">私聊</span>' : '<span class="pill g">群</span>');
    const b = c.buckets || {};
    return {
      cells: [
        '<a class="usage-key-link" href="#sessions" data-open-session="' + esc(key) + '">' + esc(key) + '</a>',
        type,
        usageNum(c.turns),
        usageNum(c.steps),
        usageNum(b.cacheMiss),
        usageNum(b.cacheHit),
        usagePct(usageRate(b)),
        usageNum(b.output),
        usageMoney(c.cost, sym),
        usageBar(maxCost > 0 ? (Number(c.cost) || 0) / maxCost : 0),
      ],
    };
  });
  const sig = 'conv:' + list.map((c) => [c.key, c.cost, c.turns, c.steps, c.buckets?.cacheHit, c.buckets?.cacheMiss].join(',')).join('|');
  const changed = usageTable(box, {
    sig,
    columns: [
      { label: '会话', width: 260 }, { label: '类型', width: 80 }, { label: '轮数', width: 70 }, { label: '步数', width: 70 },
      { label: '未命中输入', width: 110 }, { label: '命中输入', width: 110 }, { label: '命中率', width: 80 }, { label: '输出', width: 90 },
      { label: '花费', width: 90 }, { label: '占比', width: 150 },
    ],
    rows,
    pageSize: 10,
    search: { placeholder: '搜索会话…' },
    meta: '共 ' + list.length + ' 个会话',
    empty: '没有匹配的会话。',
  });
  if (!changed) return;
  applyUsageBarWidths(box);
  const totals = r.totals || {};
  if (Number(totals.unattributedCost) > 0) {
    box.insertAdjacentHTML('beforeend', '<div class="meta u-p-8-10">其中 ' + usageMoney(totals.unattributedCost, sym) + ' 来自更早的回合：它们只剩累计值（在逐轮快照窗口之外），无法再拆到具体某一轮。</div>');
  }
  if (totals.estimated) {
    box.insertAdjacentHTML('beforeend', '<div class="meta u-p-8-10">⚠️ 有模型未登记在价目表里，这部分按 <code>deepseek-flash</code> 兜底价估算，可在 <code>config.json</code> 的 <code>pricing.models</code> 补充。</div>');
  }
  // 会话名直接跳到「会话与审批」，并把搜索框预填成这个 key。
  box.querySelectorAll('[data-open-session]').forEach((link) => link.addEventListener('click', (ev) => {
    ev.preventDefault();
    const key = link.dataset.openSession;
    setConsolePage('sessions');
    setTimeout(() => {
      const input = document.querySelector('[data-sessions-panel="sessions"] [data-table-search]');
      if (!input) return;
      input.value = key;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, 150);
  }));
}

function renderUsageTurns(r) {
  const box = document.getElementById('usageTurns');
  const scope = document.getElementById('usageTurnScope');
  const rowsData = r.turns || [];
  const sym = r.symbol || '¥';
  const key = String(r.key || usageSelectedKey || '');
  if (scope) {
    scope.textContent = key
      ? key + ' ｜ 共 ' + rowsData.length + ' 轮可追溯 ｜ 已归属 ' + usageMoney(r.attributedCost, sym)
        + (Number(r.unattributedCost) > 0 ? ' ｜ 未逐轮归属 ' + usageMoney(r.unattributedCost, sym) : '')
      : '—';
  }
  if (!rowsData.length) {
    box.dataset.usageSig = 'empty:' + key;
    box.innerHTML = '<span class="meta">该会话还没有可追溯的逐轮记录（只有累计值）。</span>';
    return;
  }
  const rows = rowsData.map((t) => {
    const b = t.buckets || {};
    return {
      attrs: key ? { 'data-filter-key': key } : {},
      cells: [
        '#' + esc(t.turn),
        esc(usageTime(t.endedAt)),
        usageNum(t.steps),
        usageNum(b.cacheMiss),
        usageNum(b.cacheHit),
        usagePct(usageRate(b)),
        usageNum(b.output),
        usageMoney(t.cost, sym),
        usageTierTag(t.tier),
      ],
    };
  });
  const sig = 'turns:' + key + ':' + rowsData.length + ':' + rowsData.reduce((s, t) => s + (Number(t.cost) || 0), 0).toFixed(4);
  const changed = usageTable(box, {
    sig,
    columns: [
      { label: '轮次', width: 80 }, { label: '结束时间', width: 190 }, { label: '步数', width: 70 },
      { label: '未命中输入', width: 110 }, { label: '命中输入', width: 110 }, { label: '命中率', width: 80 },
      { label: '输出', width: 90 }, { label: '花费', width: 90 }, { label: '时段', width: 90 },
    ],
    rows,
    filters: [{ id: 'key', label: '会话', value: key, options: usageKeyFilterOptions(key) }],
    pageSize: 10,
    meta: '共 ' + rowsData.length + ' 轮',
    empty: '没有匹配的轮次。',
  });
  if (!changed) return;
  // 筛选即加载：换会话后直接拉该会话的逐轮明细（不再有单独的「加载」按钮）。
  const sel = box.querySelector('[data-filter="key"]');
  if (sel) sel.addEventListener('change', () => {
    usageSelectedKey = sel.value;
    refreshUsageTurns();
  });
}

function renderUsageRecent(r) {
  const box = document.getElementById('usageRecent');
  const list = r.entries || [];
  const sym = r.symbol || '¥';
  if (!list.length) {
    box.dataset.usageSig = 'empty';
    box.innerHTML = '<span class="meta">（还没有调用记录）</span>';
    return;
  }
  const rows = list.map((e) => {
    const b = e.buckets || {};
    return {
      cells: [
        esc(usageTime(e.at)),
        esc(e.key || '—'),
        '#' + esc(e.turn),
        usageNum(e.steps),
        usageNum(b.cacheMiss),
        usageNum(b.cacheHit),
        usageNum(b.output),
        usageMoney(e.cost, sym),
        usageTierTag(e.tier),
      ],
    };
  });
  const sig = 'recent:' + list.map((e) => [e.at, e.key, e.turn, e.cost].join(',')).join('|');
  usageTable(box, {
    sig,
    columns: [
      { label: '时间', width: 190 }, { label: '会话', width: 200 }, { label: '轮', width: 70 }, { label: '步', width: 70 },
      { label: '未命中', width: 100 }, { label: '命中', width: 100 }, { label: '输出', width: 90 }, { label: '花费', width: 90 }, { label: '时段', width: 90 },
    ],
    rows,
    pageSize: 20,
    meta: '最新 ' + list.length + ' 条',
    empty: '没有匹配的调用。',
  });
}

function renderUsagePrices(pt) {
  const box = document.getElementById('usagePrices');
  if (!pt || !pt.models) { box.dataset.usageSig = ''; box.textContent = '（价目表不可用）'; return; }
  const sym = pt.symbol || '¥';
  const tier = pt.nowTier;
  const rows = Object.entries(pt.models).map(([name, m]) => {
    // 单价与货币符号都可能来自 config.json 的 pricing 覆盖项（运维可写），统一走 esc()。
    const price = (v) => esc(sym + (Number.isFinite(Number(v)) ? Number(v) : (v ?? '')));
    return {
      cells: [
        '<code>' + esc(name) + '</code><div class="meta">' + esc(m.label) + '</div>',
        price(m.off?.cacheHit),
        price(m.off?.cacheMiss),
        price(m.off?.output),
      ],
    };
  });
  const sig = 'prices:' + String(pt.version) + ':' + (tier?.tier || '') + ':' + (tier?.estimated ? '1' : '0');
  const changed = usageTable(box, {
    sig,
    columns: [{ label: '模型', width: 300 }, { label: '缓存命中', width: 140 }, { label: '缓存未命中', width: 160 }, { label: '输出', width: 120 }],
    rows,
    pager: false,
    meta: '价目表版本 ' + pt.version + ' ｜ 高峰时段为北京时间的 2 倍价（周一至周五 9:00-12:00、14:00-18:00，法定节假日除外，已内置 ' + pt.holidayCount + ' 天假期）',
    empty: '（价目表为空）',
  });
  if (!changed) return;
  box.insertAdjacentHTML('beforeend', '<div class="meta u-p-8-10">上表为<b>空闲时段</b>单价（元 / 百万 token）。当前时刻属于 <b>' + (tier ? esc(tier.tierLabel) : '—') + '</b>' + (tier?.estimated ? '，且价目表里没有 <code>' + esc(tier.model) + '</code>，按兜底价估算' : '') + '。</div>');
}

async function refreshUsage() {
  const msg = document.getElementById('usageMsg');
  try {
    const r = await api('/api/tokens/summary?limit=200');
    const t = r.totals || {};
    const b = t.buckets || {};
    const sym = r.symbol || '¥';
    document.getElementById('metricUsageCost').textContent = usageMoney(t.cost, sym);
    document.getElementById('metricUsageCostHint').textContent =
      `高峰 ${usageMoney(t.byTier?.peak, sym)} ｜ 空闲 ${usageMoney(t.byTier?.off, sym)}`;
    document.getElementById('metricUsageTokens').textContent = usageNum(t.totalTokens);
    document.getElementById('metricUsageTokensHint').textContent =
      `输入 ${usageNum(t.inputTokens)} ｜ 输出 ${usageNum(b.output)}`;
    document.getElementById('metricUsageHitRate').textContent = usagePct(t.cacheHitRate);
    document.getElementById('metricUsageHitHint').textContent =
      `命中 ${usageNum(b.cacheHit)} ｜ 未命中 ${usageNum(b.cacheMiss)}`;
    document.getElementById('metricUsagePerTurn').textContent = usageMoney(t.avgCostPerTurn, sym);
    document.getElementById('metricUsagePerTurnHint').textContent =
      `${usageNum(t.turns)} 轮 ｜ ${usageNum(t.steps)} 步 ｜ 当前${r.nowTier?.tier === 'peak' ? '高峰' : '空闲'}时段`;
    renderUsageConversations(r);
    renderUsagePrices(r.priceTable ? { ...r.priceTable, nowTier: r.nowTier } : null);
    if (!usageSelectedKey) usageSelectedKey = String((r.conversations || [])[0]?.key ?? '');
    if (usageSelectedKey) refreshUsageTurns();
    setMsg(msg, '每 3 秒自动同步', 'ok');
  } catch (error) {
    setMsg(msg, `❌ 读取失败：${error?.message || '未知错误'}`, 'err');
  }
}

async function refreshUsageTurns() {
  const box = document.getElementById('usageTurns');
  if (!usageSelectedKey) {
    box.dataset.usageSig = '';
    box.innerHTML = '<span class="meta">（还没有会话）</span>';
    return;
  }
  try {
    const r = await api('/api/tokens/turns?key=' + encodeURIComponent(usageSelectedKey) + '&limit=200');
    renderUsageTurns({ ...r, key: usageSelectedKey });
  } catch (error) {
    box.dataset.usageSig = '';
    box.innerHTML = '<span class="meta err">读取失败：' + esc(error?.message || '未知错误') + '</span>';
  }
}

async function refreshUsageRecent() {
  try {
    renderUsageRecent(await api('/api/tokens/recent?limit=40'));
  } catch (error) {
    document.getElementById('usageRecent').innerHTML = '<span class="meta">（读取失败）</span>';
  }
}

// ── 页面数据 ────────────────────────────────────────────────────────────────
// 切进本页时三块数据一起刷；首次注入也走同一条路径。
function refreshUsagePage() {
  refreshUsage();
  refreshUsageChart();
  refreshUsageRecent();
}

// 渲染指标块、图表控件、表格宿主与压缩设置。必须在 init() 最前面跑：
// 下面的标题 note 与各处 getElementById 都依赖这些节点。
function renderUsageFields() {
  document.querySelectorAll('[data-usage-fields]').forEach((host) => {
    const spec = USAGE_FIELDS[host.dataset.usageFields];
    if (!spec) return;
    if (spec.html) host.innerHTML = spec.html;
    if (!spec.fields) return;
    const mount = spec.mount ? document.getElementById(spec.mount) : host;
    if (!mount) return;
    renderFields(mount, spec.fields, { columns: spec.columns || 2 });
  });
}

export function init() {
  renderUsageFields();
  // 标题旁的小字提示原先是 index.html 里的 data-note；片段化后在这里补（与 app.js 对静态 section 的做法一致）。
  document.querySelector('#section-usage-summary h2')?.setAttribute('data-note', '每 3 秒自动同步');

  document.getElementById('usageChartControls').addEventListener('click', (ev) => {
    const hoursBtn = ev.target.closest('[data-usage-hours]');
    const metricBtn = ev.target.closest('[data-usage-metric]');
    if (hoursBtn) {
      usageChartHours = Number(hoursBtn.dataset.usageHours) || 24;
      document.querySelectorAll('#usageChartControls [data-usage-hours]').forEach((b) => b.classList.toggle('active', b === hoursBtn));
      refreshUsageChart();
    } else if (metricBtn) {
      usageChartMetric = metricBtn.dataset.usageMetric === 'tokens' ? 'tokens' : 'cost';
      document.querySelectorAll('#usageChartControls [data-usage-metric]').forEach((b) => b.classList.toggle('active', b === metricBtn));
      // 只换纵轴：不重新请求，直接重画现有数据。
      if (usageChartData) renderUsageChart(usageChartData);
    }
  });

  document.getElementById('usageRefresh').addEventListener('click', () => {
    refreshUsage();
    refreshUsageChart();
    refreshUsageTurns();
    refreshUsageRecent();
    showConsoleToast('用量已刷新');
  });
  document.getElementById('usageClear').addEventListener('click', async () => {
    if (!confirm('确定清空 token 用量账本？累计花费与逐轮明细都会被删除，且不可恢复（下一次同步会从 DSH 重新拉取会话累计值）。')) return;
    const msg = document.getElementById('usageMsg');
    try {
      const r = await api('/api/tokens/reset', 'POST', {});
      msg.textContent = r.ok ? '✅ 账本已清空' : ('❌ ' + (r.error || '失败'));
      msg.className = r.ok ? 'form-actions-status ok' : 'form-actions-status err';
    } catch (error) {
      setMsg(msg, '❌ ' + (error?.message || '失败'), 'err');
    }
    usageSelectedKey = '';
    document.getElementById('usageTurnScope').textContent = '—';
    document.getElementById('usageTurns').dataset.usageSig = '';
    refreshUsage();
    refreshUsageRecent();
  });

  // 用量看板只在运行总览可见时轮询：既保证「实时」，又不让其它页白白多打两份接口。
  setInterval(() => { if (getCurrentPage() !== 'overview') return; refreshUsage(); refreshUsageChart(); refreshUsageRecent(); }, 3000);

  onPageRefresh('overview', () => setTimeout(() => refreshUsagePage(), 0));
  // 首次进入时片段刚注入，延后一拍再刷，避免在 DOM / 样式就绪前空转。
  setTimeout(() => refreshUsagePage(), 0);
}
