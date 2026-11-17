// Token 用量账本 + 价目表测试。
//
// 覆盖点（每一条都对应一个曾经容易写错的地方）：
// 1. 峰谷分时判定按北京时间，且排除中国法定节假日；
// 2. 四个计费桶互不重叠，金额 = Σ(桶 token × 单价)；
// 3. 没申报价目的模型不报价（只计 token，绝不拿别的模型兜底估算）；
// 4. 同一 (turn, step, retry) 的采样「后到覆盖先到」，不是累加；
// 5. 重连重放同一批 snapshot 记录不会让用量翻倍（幂等）；
// 6. `llm/retry-started` 之后同一步骤的第二次请求另算一次；
// 7. 权威总量 = 投影基线 + 基线之后 seq 的增量；
// 8. 逐轮明细与「未逐轮归属」差额自洽；
// 9. 半行（进程中断）不会让整个账本读不出来；
// 10. 日志行数超上限会压缩重写且不丢数据。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CN_HOLIDAYS_2026,
  beijingParts,
  costOfBuckets,
  isPeakAt,
  normalizeUsage,
  priceTableFromCatalog,
  priceUsage,
  ratesAt,
  totalTokensOf
} from '../src/model-prices.js';
import { createTokenLedger } from '../src/token-ledger.js';
import { DSH_PRICE_TABLE as PRICE } from './dsh-price-fixture.mjs';

let failed = 0;
function assert(cond, label) {
  if (cond) console.log(`✅ ${label}`);
  else { console.error(`❌ ${label}`); failed = 1; }
}
function near(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-token-ledger-'));
const ledgerFile = path.join(tmpDir, 'token-usage.jsonl');
function freshLedger(opts = {}) {
  try { fs.unlinkSync(ledgerFile); } catch {}
  return createTokenLedger({ file: ledgerFile, getPriceTable: () => PRICE, ...opts });
}

// ── 1. 峰谷分时 ─────────────────────────────────────────────────────────
// 北京时间 = UTC+8。2026-03-02 是周一。
const mon = (hhmm) => Date.parse(`2026-03-02T${hhmm}:00+08:00`);
assert(beijingParts(mon('10:00')).weekday === 1, '2026-03-02 是周一');
assert(isPeakAt(mon('10:00'), PRICE) === true, '周一 10:00 属高峰时段');
assert(isPeakAt(mon('13:00'), PRICE) === false, '周一 13:00（午休）属空闲时段');
assert(isPeakAt(mon('15:00'), PRICE) === true, '周一 15:00 属高峰时段');
assert(isPeakAt(mon('08:59'), PRICE) === false, '周一 08:59 属空闲时段');
assert(isPeakAt(mon('12:00'), PRICE) === false, '窗口为半开区间：12:00 已不在高峰');
assert(isPeakAt(mon('18:00'), PRICE) === false, '窗口为半开区间：18:00 已不在高峰');
// 周六（2026-03-07）全天空闲
assert(isPeakAt(Date.parse('2026-03-07T10:00:00+08:00'), PRICE) === false, '周六 10:00 属空闲时段');
// 节假日：2026-10-01 是周四，但属国庆假期 → 空闲
assert(beijingParts(Date.parse('2026-10-01T10:00:00+08:00')).weekday === 4, '2026-10-01 是周四');
assert(isPeakAt(Date.parse('2026-10-01T10:00:00+08:00'), PRICE) === false, '国庆节（周四）10:00 属空闲时段');
// 春节段
assert(isPeakAt(Date.parse('2026-02-17T10:00:00+08:00'), PRICE) === false, '春节（周二）10:00 属空闲时段');
// 节假日表的边界不应误伤相邻工作日
assert(isPeakAt(Date.parse('2026-10-08T10:00:00+08:00'), PRICE) === true, '2026-10-08（节后周四）10:00 恢复高峰');
assert(CN_HOLIDAYS_2026.length === 33, `2026 法定节假日共 33 天（实得 ${CN_HOLIDAYS_2026.length}）`);

// ── 2. 单价与金额 ───────────────────────────────────────────────────────
const offRates = ratesAt('deepseek-flash', mon('20:00'), PRICE);
const peakRates = ratesAt('deepseek-flash', mon('10:00'), PRICE);
assert(offRates.tier === 'off' && peakRates.tier === 'peak', '同一模型峰谷档位判定正确');
assert(near(peakRates.cacheMiss, offRates.cacheMiss * 2), '高峰单价为空闲单价的 2 倍');
assert(near(offRates.cacheHit, 0.02) && near(offRates.cacheMiss, 1) && near(offRates.output, 4), 'flash 空闲单价与官方一致（0.02/1/4）');

// 100 万 token 各桶 → 正好等于单价
const cost1M = costOfBuckets({ cacheHit: 1e6, cacheMiss: 1e6, cacheWrite: 0, output: 1e6 }, offRates);
assert(near(cost1M.cacheHit, 0.02) && near(cost1M.cacheMiss, 1) && near(cost1M.output, 4), '桶计价 = 单价 × 百万 token');
assert(near(cost1M.total, 5.02), '合计 = 分项之和');

// 桶互不重叠：normalizeUsage 不能把 cacheRead 也算进未命中
const norm = normalizeUsage({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 900, cacheWriteTokens: 5 });
assert(norm.cacheMiss === 100 && norm.cacheHit === 900 && norm.cacheWrite === 5 && norm.output === 10,
  'normalizeUsage 四桶互不重叠（inputTokens 只算未命中）');
assert(totalTokensOf(norm) === 1015, 'token 总量 = 四桶之和');

// ── 3. 没申报价目就不报价 ───────────────────────────────────────────────
assert(ratesAt('some-future-model', mon('10:00'), PRICE) === null,
  '价目表里没有的模型返回 null（不拿别的模型兜底估算）');
const unknownUsage = priceUsage({ cacheMiss: 1e6, cacheHit: 0, cacheWrite: 0, output: 0 }, { model: 'some-future-model', at: mon('10:00'), table: PRICE });
assert(unknownUsage.cost === null && unknownUsage.rates === null, '未申报的模型只计 token，不算钱');
assert(isPeakAt(mon('10:00'), null) === false && ratesAt('deepseek-flash', mon('10:00'), null) === null,
  '没有价目表就没有峰谷之分，也不报价');
// 声明的价目表：单位/货币/峰谷口径都取自 pricingPolicy
const declared = priceTableFromCatalog({
  models: [
    { id: 'my-model', label: '自定义', pricing: { cacheHit: 0.5, cacheMiss: 3, output: 9 } },
    { id: 'no-price', label: '没申报单价' },
  ],
  pricingPolicy: { currency: 'USD', symbol: '$', unit: 1000, peakMultiplier: 3, peakWindows: [[9, 12]], peakWeekdays: [1] },
});
assert(declared.models['my-model'].off.cacheWrite === 3, '声明里没给 cacheWrite 时跟随 cacheMiss');
assert(declared.models['no-price'] === undefined, '没写单价（或只写部分桶）的模型不进价目表');
assert(declared.currency === 'USD' && declared.unit === 1000 && declared.peakMultiplier === 3, '货币 / 单位 / 峰谷倍数取自 pricingPolicy');
assert(priceTableFromCatalog({ models: [{ id: 'free', label: '免费' }] }) === null, '一个模型都没申报单价时整张表为 null');
assert(PRICE.models['deepseek-flash'].off.cacheMiss === 1, '价目只来自各自平台的声明（dsh 不受别的表影响）');

// ── 4~8. 账本折叠语义 ───────────────────────────────────────────────────
const usage = (inputTokens, outputTokens, cacheReadTokens = 0, extra = {}) =>
  ({ inputTokens, outputTokens, cacheReadTokens, ...extra });
// ⚠️ `time` 必须显式给：账本对**没有时间戳**的采样会回退到 `now()`，
// 而 `now()` 落在高峰时段（周一至周五 9:00-12:00、14:00-18:00）时单价是 2 倍
// ⇒ 这个测试会随"跑测试的时刻"时红时绿（实测：周一 17:29 会失败，12:00-16:00 通过）。
// 这里统一钉到下面的 `at`（周一 20:00，空闲档），让期望值与任何跑测试的时刻无关。
const at = mon('20:00');
// 中立用量样本：回合 / 步骤 / 重试 / 时间都由适配器解好，账本不认识平台事件。
// model 必须是价目表里有的那个：没申报价目的模型只计 token、不算钱（见下方用例）。
const ingest = (target, seq, turn, step, u, extra = {}) =>
  target.ingestSample({ sessionId: 's1', seq, turn, step, at, model: 'deepseek-flash', usage: u, ...extra });

let ledger = freshLedger({ resolveKey: (sid) => (sid === 's1' ? 'group:100' : undefined) });

// 同一 (turn, step, retry) 后到的采样应覆盖，而不是累加
ingest(ledger, 10, 1, 1, usage(1000, 50, 0));
ingest(ledger, 11, 1, 1, usage(1200, 80, 4000));
let conv = ledger.conversation('group:100');
assert(conv.turns.length === 1, '同一 (turn, step) 只有一行逐轮明细（流式被结算覆盖）');
assert(conv.turns[0].buckets.cacheMiss === 1200 && conv.turns[0].buckets.output === 80,
  '覆盖语义：保留后到样本的 1200/80');
assert(conv.turns[0].steps === 1, 'steps 计为该回合的采样条数（1）');

// 同回合第二个 step 累加
ingest(ledger, 12, 1, 2, usage(300, 20, 100));
conv = ledger.conversation('group:100');
assert(conv.turns[0].steps === 2, '同回合第 2 个 step 计入同一行');
assert(conv.turns[0].buckets.cacheMiss === 1500 && conv.turns[0].buckets.output === 100, '同回合跨 step 累加');
assert(conv.turns.length === 1, '两个 step 仍是同一轮对话');

// 重连重放：同 seq 同内容不得翻倍
const before = ledger.recent(50).length;
ingest(ledger, 11, 1, 1, usage(1200, 80, 4000));
ingest(ledger, 12, 1, 2, usage(300, 20, 100));
assert(ledger.recent(50).length === before, '重连重放同样的事件不新增采样（幂等）');
conv = ledger.conversation('group:100');
assert(conv.turns[0].buckets.cacheMiss === 1500, '重放后用量不翻倍');

// 旧快照不得覆盖新数据：seq 更旧、以及 seq 相等但内容不同，都必须被拒绝
ingest(ledger, 5, 1, 1, usage(1, 1, 0));
conv = ledger.conversation('group:100');
assert(conv.turns[0].buckets.cacheMiss === 1500, 'seq 更旧的采样被拒绝（不回退）');
ingest(ledger, 11, 1, 1, usage(1, 1, 0));
conv = ledger.conversation('group:100');
assert(conv.turns[0].buckets.cacheMiss === 1500, 'seq 相等但内容不同的采样被拒绝（只信严格更新的 seq）');

// 重试轴已下沉到适配器：样本自带 retry 序号，账本只认结果字段
ingest(ledger, 20, 2, 1, usage(500, 10, 0));
ingest(ledger, 22, 2, 1, usage(600, 12, 0), { retry: 1 });
conv = ledger.conversation('group:100');
const t2 = conv.turns.find((r) => r.turn === 2);
assert(t2.buckets.cacheMiss === 1100 && t2.buckets.output === 22, '同一 step 的第二次请求（retry=1）另算一次');
assert(t2.attempts === 1, '重试次数被记录');

// 基线：权威总量 = 基线 + 基线之后的增量
ledger = freshLedger({ resolveKey: () => 'group:100' });
ledger.ingestBaseline({ sessionId: 's1', tokenUsage: { uncachedInputTokens: 5000, outputTokens: 500, cacheReadTokens: 50000, cacheWriteTokens: 0 }, asOfSeq: 100, at: mon('20:00'), model: 'deepseek-flash' });
// seq <= 100 的采样属于基线范围，只进逐轮明细、不再计入总量
ingest(ledger, 80, 1, 1, usage(5000, 500, 50000));
// seq > 100 的采样是增量
ingest(ledger, 120, 2, 1, usage(1000, 100, 0));
let sum = ledger.summary();
let c = sum.conversations.find((x) => x.key === 'group:100');
assert(c.buckets.cacheMiss === 6000, '权威总量 = 基线 5000 + 增量 1000');
assert(c.buckets.cacheHit === 50000, '基线命中量计入总量');
assert(c.buckets.output === 600, '基线输出计入总量');
const expectCost = (5000 / 1e6) * 1 + (50000 / 1e6) * 0.02 + (500 / 1e6) * 4 + (1000 / 1e6) * 1 + (100 / 1e6) * 4;
assert(near(c.cost, expectCost, 1e-9), `花费 = 基线 + 增量，实得 ${c.cost.toFixed(8)} 期望 ${expectCost.toFixed(8)}`);
assert(c.turns === 2, '基线范围内的回合仍出现在逐轮明细里（共 2 轮）');
assert(near(c.unattributedCost, Math.max(0, c.cost - c.attributedCost), 1e-9), '未逐轮归属差额自洽');
assert(near(sum.totals.cost, c.cost, 1e-9), '全局合计 = 各会话之和');
assert(sum.totals.cacheHitRate > 0.85, `缓存命中率按输入桶计算（${(sum.totals.cacheHitRate * 100).toFixed(1)}%）`);

// 峰谷混算：同一会话内高峰与空闲的采样各按各的档位
ledger = freshLedger({ resolveKey: () => 'group:100' });
ingest(ledger, 10, 1, 1, usage(1e6, 1e6, 0), { at: mon('10:00') }); // 高峰：1 + 4 → ×2
ingest(ledger, 20, 2, 1, usage(1e6, 1e6, 0), { at: mon('20:00') }); // 空闲：1 + 4
c = ledger.summary().conversations[0];
assert(near(c.cost, (1 + 4) * 2 + (1 + 4)), `峰谷分时计价：高峰轮 ¥10 + 空闲轮 ¥5 = ¥15（实得 ${c.cost}）`);
assert(near(c.byTier.peak, 10) && near(c.byTier.off, 5), '高峰期/空闲期花费分开统计');

// ── 9. 半行容错 ─────────────────────────────────────────────────────────
fs.appendFileSync(ledgerFile, '{"k":"turn","sid":"s1","turn":9,"ste', 'utf8');
ledger = createTokenLedger({ file: ledgerFile, getPriceTable: () => PRICE, resolveKey: () => 'group:100' });
assert(ledger.stats().droppedLines === 1, '进程中断留下的半行被跳过而不是让账本读不出来');
assert(ledger.summary().conversations.length === 1, '半行之后仍能读出既有数据');

// ── 10. 压缩与淘汰 ──────────────────────────────────────────────────────
// 逐轮明细超过上限时必须真的淘汰（否则每次采样都会整文件重写），
// 但**累计总量必须精确**——即使这个会话没有投影基线。
ledger = freshLedger({ resolveKey: () => 'group:100', maxLines: 20 });
for (let i = 0; i < 30; i += 1) {
  ingest(ledger, 1000 + i, i + 1, 1, usage(10, 1, 0), { at: mon('20:00') });
}
const stats = ledger.stats();
assert(stats.samples <= 20, `逐轮明细被压到上限内（实得 ${stats.samples}）`);
assert(stats.journalLines <= 40, `压缩后磁盘行数受控（实得 ${stats.journalLines}）`);
const afterEvict = ledger.summary().totals;
const expectEvictCost = 30 * ((10 / 1e6) * 1 + (1 / 1e6) * 4);
assert(afterEvict.buckets.cacheMiss === 300, `淘汰后累计未命中输入仍为 30×10=300（实得 ${afterEvict.buckets.cacheMiss}）`);
assert(afterEvict.buckets.output === 30, `淘汰后累计输出仍为 30（实得 ${afterEvict.buckets.output}）`);
assert(near(afterEvict.cost, expectEvictCost, 1e-9), `淘汰后累计花费不变（实得 ${afterEvict.cost.toFixed(8)} 期望 ${expectEvictCost.toFixed(8)}）`);
assert(afterEvict.unattributedCost > 0, '被淘汰的回合归入「未逐轮归属」而不是凭空消失');
const reloaded = createTokenLedger({ file: ledgerFile, getPriceTable: () => PRICE, resolveKey: () => 'group:100' });
assert(reloaded.stats().samples === stats.samples, '淘汰后重新载入不丢采样');
assert(near(reloaded.summary().totals.cost, afterEvict.cost, 1e-9), '淘汰结果的累计花费可跨重启复现');

// ── 10b. 读取路径是单遍索引：总量不随采样数二次膨胀 ─────────────────────
ledger = freshLedger({ resolveKey: () => 'group:100', maxLines: 5000 });
for (let turn = 1; turn <= 40; turn += 1) {
  for (let step = 1; step <= 5; step += 1) {
    ingest(ledger, turn * 100 + step, turn, step, usage(100, 10, 0), { at: mon('20:00') });
  }
}
const multi = ledger.summary();
assert(multi.conversations.length === 1 && multi.conversations[0].turns === 40,
  `40 轮 × 5 步聚合成 40 行逐轮明细（实得 ${multi.conversations[0]?.turns}）`);
assert(multi.totals.steps === 200, `步数统计正确（实得 ${multi.totals.steps}）`);
assert(multi.totals.buckets.cacheMiss === 40 * 5 * 100, '多轮多步累计正确');
const detail = ledger.conversation('group:100');
assert(detail.turns.length === 40 && detail.turns[0].turn === 40, '逐轮明细按回合倒序返回');

// ── 11. 走势分桶（series） ───────────────────────────────────────────────
// 三条不能错的性质：空桶补零（否则图会撒谎）、桶的峰谷档位、图与数字自洽。
ledger = freshLedger({ resolveKey: () => 'group:100' });
const sBase = Date.parse('2026-03-02T09:00:00+08:00'); // 周一 09:00 = 高峰窗口起点
const sAt = sBase + 6 * 3600_000;                      // 观察时刻
const emitAt = (ms, turn, step, u) => ledger.ingestSample({
  sessionId: 's1',
  seq: turn * 100 + step,
  turn,
  step,
  at: ms,
  model: 'deepseek-flash',
  usage: u
});
// 09:30、09:45（高峰）各一笔；13:00（午休空闲）一笔；中间留出 3 小时空档
const peak1 = sBase + 30 * 60_000;
const peak2 = sBase + 45 * 60_000;
const off1 = sBase + 4 * 3600_000;
emitAt(peak1, 1, 1, usage(1000, 100, 0));
emitAt(peak2, 1, 2, usage(1000, 100, 0));
emitAt(off1, 2, 1, usage(2000, 200, 0));

const ser = ledger.series({ hours: 6, at: sAt });
assert(ser.ok === true && Array.isArray(ser.buckets), 'series 返回桶数组');
assert(ser.bucketMs > 0 && ser.buckets.length > 0, `桶宽与桶数有效（${ser.bucketMs}ms × ${ser.buckets.length}）`);
assert(ser.buckets.length <= 48, `桶数不超过上限（实得 ${ser.buckets.length}）`);
assert(ser.buckets.every((b) => b.t % ser.bucketMs === 0), '桶边界对齐到桶宽整数倍（刷新之间不漂移）');
// 窗口按桶对齐：覆盖最近 hours 小时，起止最多各差一个桶（否则刷新时整条图会抖）
assert(ser.from % ser.bucketMs === 0 && ser.to % ser.bucketMs === 0, '窗口起止也对齐到桶边界');
assert(ser.to - ser.from >= 6 * 3600_000 && ser.to - ser.from < 6 * 3600_000 + ser.bucketMs,
  `窗口长度≈6 小时（实得 ${((ser.to - ser.from) / 3600_000).toFixed(2)}h）`);
assert(ser.buckets.filter((b) => b.cost === 0).length >= 3, '没有调用的时段被补成 0 值桶（不会在图上凭空消失）');
assert(ser.countedSamples === 3, `三笔采样全部落入窗口（实得 ${ser.countedSamples}）`);

// 峰谷档位：09:30/09:45 与 13:00 分别落在高峰与空闲
const tierAt = (ms) => ser.buckets.find((b) => ms >= b.t && ms < b.t + ser.bucketMs)?.tier;
assert(tierAt(peak1) === 'peak', '09:30（周一高峰）的桶标为 peak');
assert(tierAt(off1) === 'off', '13:00（午休空闲）的桶标为 off');
assert(ser.buckets.some((b) => b.tier === 'peak') && ser.buckets.some((b) => b.tier === 'off'),
  '空桶也有档位（图上能看出"这段时间本来就是 2 倍价"）');

// 合计：每笔按自己时刻的峰谷计价（高峰 2 倍）
const expectWindow = 2 * ((1000 / 1e6) * 2 + (100 / 1e6) * 8) + ((2000 / 1e6) * 1 + (200 / 1e6) * 4);
assert(near(ser.totals.cost, expectWindow, 1e-9),
  `窗口合计按各桶自身时刻的峰谷计价（实得 ${ser.totals.cost.toFixed(6)} 期望 ${expectWindow.toFixed(6)}）`);
assert(ser.totals.steps === 3 && ser.totals.turns === 2, `步数 3 / 轮次 2（实得 ${ser.totals.steps}/${ser.totals.turns}）`);
assert(ser.buckets.some((b) => b.t === peak1 - (peak1 % ser.bucketMs) || b.tier === 'peak'), '高峰桶确实存在');
assert(ser.busiest && tierAt(ser.busiest.t) === 'peak', '最贵的一格是高峰那一格');
assert(near(ser.buckets.reduce((s, b) => s + b.cost, 0), ser.totals.cost, 1e-12),
  '各桶花费之和 = 窗口合计（图与数字自洽）');
assert(near(ser.buckets.reduce((s, b) => s + b.tokens, 0), ser.totals.tokens, 1e-9), 'token 同样自洽');
assert(ser.offChartCost >= 0, '给出"时间轴之外"的花费，避免图合计 ≠ 总花费引起误解');

// 窗口大小决定桶宽；窗口外的采样不计入
const wide = ledger.series({ hours: 24 * 30, at: sAt, maxBuckets: 48 });
assert(wide.bucketMs > ser.bucketMs, `更大的窗口用更粗的桶（${ser.bucketMs} → ${wide.bucketMs}）`);
assert(wide.buckets.length <= 48, '放大窗口后桶数仍受上限约束');
const emptyWindow = ledger.series({ hours: 1, at: sBase - 60 * 60 * 1000 });
assert(emptyWindow.countedSamples === 0, '采样发生在窗口之后时不计入');
assert(emptyWindow.buckets.every((b) => b.cost === 0), '窗口内无用量时全为 0 桶');

// ── 12. 逐模型价目覆盖 / 先记账后补价 ─────────────────────────────────
// 账本只存 token 与模型名，金额是**读取时**按当前价目表算的。所以：
//   · 部分模型没价目时，它们只计 token（totals.unpriced / coverage 里能看见是哪一个）；
//   · 补上单价后，已产生的 token（含被淘汰聚合的那部分）金额当场重算，不用迁移账本；
//   · 金额跨重启可复现（每行存的是「模型 × 档位」而不是算好的钱）。
const baseCatalog = {
  models: [{ id: 'deepseek-flash', label: 'Flash', pricing: { cacheHit: 0.02, cacheMiss: 1, output: 4 } }],
  pricingPolicy: { currency: 'CNY', symbol: '¥', unit: 1e6, peakMultiplier: 2, peakWindows: [[9, 12], [14, 18]], peakWeekdays: [1, 2, 3, 4, 5] },
};
const withSide = {
  ...baseCatalog,
  models: [...baseCatalog.models, { id: 'side-model', label: '会话单独用的模型', pricing: { cacheHit: 0.1, cacheMiss: 2, output: 8 } }],
};
const currentTable = { value: priceTableFromCatalog(baseCatalog) };
try { fs.unlinkSync(ledgerFile); } catch { /* 第一次跑没有文件 */ }
ledger = createTokenLedger({
  file: ledgerFile,
  getPriceTable: () => currentTable.value,
  resolveKey: () => 'group:100',
  maxLines: 20,
});
for (let turn = 1; turn <= 25; turn += 1) {
  ledger.ingestSample({ sessionId: 's1', seq: turn * 10, turn, step: 1, at, model: 'deepseek-flash', usage: usage(1000, 100) });
  ledger.ingestSample({ sessionId: 's1', seq: turn * 10 + 1, turn, step: 2, at, model: 'side-model', usage: usage(2000, 200) });
}
const flashOnly = 25 * ((1000 / 1e6) * 1 + (100 / 1e6) * 4);
const sidePriced = 25 * ((2000 / 1e6) * 2 + (200 / 1e6) * 8);
let partial = ledger.summary();
assert(near(partial.totals.cost, flashOnly, 1e-9), `只有 flash 有价目时只算它的钱（实得 ${partial.totals.cost}）`);
assert(partial.totals.unpriced === true && partial.totals.unpricedTokens === 25 * 2200,
  `另一个模型的 token 单独记为未计价（实得 ${partial.totals.unpricedTokens}）`);
const coverageOf = (id) => ledger.coverage().find((row) => row.model === id) ?? {};
assert(coverageOf('deepseek-flash').priced === true && near(coverageOf('deepseek-flash').cost, flashOnly, 1e-9),
  '覆盖清单能按模型看到已算钱的金额');
assert(coverageOf('side-model').priced === false && coverageOf('side-model').unpricedTokens === 25 * 2200,
  '覆盖清单点名哪个模型只有 token、没有金额');
assert(coverageOf('deepseek-flash').tokens === 25 * 1100 && coverageOf('side-model').tokens === 25 * 2200,
  '两边 token 都完整记着（包含被淘汰聚合的部分）');
assert(ledger.stats().samples <= 20, `逐轮明细已压缩到上限内（实得 ${ledger.stats().samples}）`);

// 补上单价：不重新记账，金额按新表重算。
currentTable.value = priceTableFromCatalog(withSide);
partial = ledger.summary();
assert(near(partial.totals.cost, flashOnly + sidePriced, 1e-9),
  `补价后历史金额立即重算（实得 ${partial.totals.cost} 期望 ${flashOnly + sidePriced}）`);
assert(partial.totals.unpriced === false && partial.totals.unpricedTokens === 0, '补完价目后不再有未计价 token');
assert(near(ledger.conversation('group:100').cost, partial.totals.cost, 1e-9), '会话视图与合计同一口径');
const reread = createTokenLedger({ file: ledgerFile, getPriceTable: () => currentTable.value, resolveKey: () => 'group:100' });
assert(near(reread.summary().totals.cost, partial.totals.cost, 1e-9), '补价后的金额跨重启仍可复现');

// ── reset ───────────────────────────────────────────────────────────────
ledger.reset();
assert(ledger.summary().conversations.length === 0, 'reset 清空内存态');
assert(fs.readFileSync(ledgerFile, 'utf8') === '', 'reset 清空磁盘日志');

// ── 样本的形状守卫 ─────────────────────────────────────────────────────
ledger = freshLedger({ resolveKey: () => 'group:100' });
assert(ledger.ingestSample({ sessionId: 's1', turn: 1, step: 1, at, usage: usage(100, 10) }) === true,
  '有 turn / step / usage 的样本被接受');
assert(ledger.ingestSample({ sessionId: 's1', step: 1, at, usage: usage(100, 10) }) === false,
  '缺 turn 的样本被拒绝（无从归属，记账会让实数失真）');
assert(ledger.ingestSample({ sessionId: 's1', turn: 1, step: 1, at, usage: usage(0, 0) }) === false,
  '零用量样本被拒绝');

// ── 没带模型名的采样：只计 token、不计钱 ────────────────────────────────
// 宁可留缺口也不猜价：模型名缺失时无法确定申报的单价，不能拿别的模型顶上。
ledger = freshLedger({ resolveKey: () => 'group:100' });
ledger.ingestSample({ sessionId: 's1', seq: 1, turn: 1, step: 1, at, usage: usage(1000, 100) });
const unpricedTotals = ledger.summary().totals;
assert(near(unpricedTotals.cost, 0) && unpricedTotals.unpriced === true, '没带模型名的采样计入 token 但不计价');
assert(unpricedTotals.unpricedTokens === 1100, `未计价 token 单独统计（实得 ${unpricedTotals.unpricedTokens}）`);
assert(ledger.recent(10)[0].cost === null, '逐笔明细里未计价的金额为 null（界面显示「—」）');

// ── 收尾 ────────────────────────────────────────────────────────────────
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

if (failed) {
  console.error('\n❌ token 账本测试失败');
  process.exit(1);
}
console.log('\n🎉 token 账本 / 价目表测试通过');
