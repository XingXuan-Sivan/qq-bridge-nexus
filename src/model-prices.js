// 账单换算：按合成后的价目（内置官方价 → 平台申报 → 本机覆盖）把 token 桶折算成金额，并判定峰谷时段。
//
// 为什么放在桥接里：DSH 自身不做任何货币换算（`dsh-llm-pi-ai` 明写 "no consumer reports
// spend"），provider 只回 token 数。所以「花多少钱」必须由消费方用价目算。
//
// **价目不在代码里**：哪个模型多少钱、货币与单位、峰谷倍数与窗口，都来自三层价目 ——
// 内置官方表（src/pricing/builtins.mjs）、平台在 `profiles/agent-platforms/<id>/agent-platform.yml`
// 的 `modelCatalog` 申报（`pricing` + `pricingPolicy`）、以及本机覆盖（`state/pricing/<agent>.yml`）。
// 这里只负责把合成后的目录算成表；三层都没有单价的模型不算钱 —— 只计 token、金额显示「未申报」，
// 绝不拿别的模型的价格估算。
//
// 口径：
//   扣减费用 = Σ(各桶 token 数 × 对应单价)
//   桶共三个：缓存命中 / 缓存未命中 / 输出；没单独报 cacheWrite 时按未命中计。
//   高峰时段单价 = 空闲 × 峰谷倍数，窗口与工作日同样来自目录；模型级 `pricingPolicy`
//   可以逐模型改窗口（显式空窗口 = 该模型全天同价），没写的那组回落平台声明。
//
// 注意 `dsh` 报的 token 桶是**互不重叠**的：
//   计费输入 = inputTokens(未命中) + cacheReadTokens + cacheWriteTokens
// 所以三个桶要分别计价再相加，不能把 cacheRead 当成 inputTokens 的一部分。
//
// 节假日不在这里：它是日历事实（与任何平台无关），见下方 CN_HOLIDAYS。

/**
 * 2026 年中国法定节假日（放假日，含调休连休段）。
 * 高峰时段判定要排除这些日期；周末（周六/周日）本身已因「非周一至周五」被判为空闲。
 * 调休上班的周六/周日仍按「非周一至周五」算空闲 —— 官方口径只认周一至周五。
 */
export const CN_HOLIDAYS_2026 = [
  // 元旦：1/1(周四)-1/3(周六)
  '2026-01-01', '2026-01-02', '2026-01-03',
  // 春节：2/15(周日)-2/23(周一)
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
  '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  // 清明节：4/4(周六)-4/6(周一)
  '2026-04-04', '2026-04-05', '2026-04-06',
  // 劳动节：5/1(周五)-5/5(周二)
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  // 端午节：6/19(周五)-6/21(周日)
  '2026-06-19', '2026-06-20', '2026-06-21',
  // 中秋节：9/25(周五)-9/27(周日)
  '2026-09-25', '2026-09-26', '2026-09-27',
  // 国庆节：10/1(周四)-10/7(周三)
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  '2026-10-05', '2026-10-06', '2026-10-07'
];

/**
 * 2027 年法定节假日（国务院办公厅通知，放假调休段）。
 *
 * 为什么要预置到 2027：价目表只认这些日期，缺失时的表现是**静默高估**——
 * 节假日里的调用会被当高峰计价（2 倍），金额看着偏高但不报错。
 * 春节/国庆这类长假横跨多天，很容易把一年的账单整体抬高几个百分点。
 * 官方通常在上一年 11 月公布次年安排；公布后按实际日期替换本表即可。
 */
export const CN_HOLIDAYS_2027 = [
  // 元旦：1/1(周五)-1/3(周日)
  '2027-01-01', '2027-01-02', '2027-01-03',
  // 春节：2/5(周五，除夕前一天)-2/13(周六)（按农历正月初一 2/6 前后连续放假日推定）
  '2027-02-05', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09',
  '2027-02-10', '2027-02-11', '2027-02-12', '2027-02-13',
  // 清明节：4/4(周日)-4/6(周二)
  '2027-04-04', '2027-04-05', '2027-04-06',
  // 劳动节：5/1(周六)-5/5(周三)
  '2027-05-01', '2027-05-02', '2027-05-03', '2027-05-04', '2027-05-05',
  // 端午节：6/9(周三)-6/11(周五)（按农历五月初五）
  '2027-06-09', '2027-06-10', '2027-06-11',
  // 中秋节：9/15(周三)-9/17(周五)（按农历八月十五）
  '2027-09-15', '2027-09-16', '2027-09-17',
  // 国庆节：10/1(周五)-10/7(周四)
  '2027-10-01', '2027-10-02', '2027-10-03', '2027-10-04',
  '2027-10-05', '2027-10-06', '2027-10-07'
];

/** 内置的全部法定节假日（跨年份）。 */
export const CN_HOLIDAYS = [...CN_HOLIDAYS_2026, ...CN_HOLIDAYS_2027];

/** 北京时间相对 UTC 的分钟偏移。 */
const BEIJING_OFFSET_MINUTES = 8 * 60;

/**
 * 用合成后的模型目录生成价目表。
 *
 * @param catalog `modelCatalog`：`{ models:[{id,label,pricing,pricingPolicy}], pricingPolicy }`
 * @returns 价目表；一个模型的单价都没有时返回 `null`（= 不报价）
 */
export function priceTableFromCatalog(catalog) {
  const policy = catalog?.pricingPolicy ?? {};
  const platformPeak = {
    peakMultiplier: peakMultiplierOf(policy),
    peakWindows: windowsOf(policy),
    peakWeekdays: weekdaysOf(policy),
    holidays: CN_HOLIDAYS,
  };
  const models = {};
  for (const item of catalog?.models ?? []) {
    const given = item?.pricing;
    if (!given || !item?.id) continue;
    const cacheMiss = Number(given.cacheMiss);
    const output = Number(given.output);
    // 未命中价与输出价是算钱的基准：有一个缺失就不是可用的报价。
    if (!Number.isFinite(cacheMiss) || !Number.isFinite(output)) continue;
    const hit = Number(given.cacheHit);
    const write = Number(given.cacheWrite);
    // 模型级口径只覆盖写了的组：没写的高峰窗口沿用平台，显式空数组则是「全天同价」。
    const own = item.pricingPolicy ?? {};
    const peak = Object.keys(own).length
      ? {
        peakMultiplier: 'peakMultiplier' in own ? peakMultiplierOf(own) : platformPeak.peakMultiplier,
        peakWindows: 'peakWindows' in own ? windowsOf(own) : platformPeak.peakWindows,
        peakWeekdays: 'peakWeekdays' in own ? weekdaysOf(own) : platformPeak.peakWeekdays,
        holidays: CN_HOLIDAYS,
      }
      : platformPeak;
    models[item.id] = {
      label: String(item.label || item.id),
      origin: item.origin === 'builtin' ? 'builtin' : 'declared',
      off: {
        cacheHit: Number.isFinite(hit) ? hit : cacheMiss,
        cacheMiss,
        // 平台没单独报缓存写入价时按未命中价计。
        cacheWrite: Number.isFinite(write) ? write : cacheMiss,
        output,
      },
      peak,
    };
  }
  if (!Object.keys(models).length) return null;
  const unit = Number(policy.unit);
  return {
    version: String(policy.version ?? ''),
    currency: String(policy.currency ?? '') || 'CNY',
    symbol: String(policy.symbol ?? '') || '¥',
    unit: Number.isFinite(unit) && unit > 0 ? unit : 1e6,
    peakMultiplier: platformPeak.peakMultiplier,
    peakWindows: platformPeak.peakWindows,
    peakWeekdays: platformPeak.peakWeekdays,
    holidays: CN_HOLIDAYS,
    models,
  };
}

function peakMultiplierOf(policy) {
  const n = Number(policy?.peakMultiplier);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function windowsOf(policy) {
  return Array.isArray(policy?.peakWindows) ? policy.peakWindows : [];
}

function weekdaysOf(policy) {
  return Array.isArray(policy?.peakWeekdays) ? policy.peakWeekdays : [];
}

/** 把任意时间戳换算成北京时间的日历分量（不依赖运行机器的本地时区）。 */
export function beijingParts(atMs) {
  const d = new Date(Number(atMs) + BEIJING_OFFSET_MINUTES * 60000);
  const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // 1=周一 … 7=周日
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return {
    weekday,
    hour: d.getUTCHours(),
    date: `${d.getUTCFullYear()}-${month}-${day}`,
    clock: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  };
}

/** 判断某一时刻是否落在高峰时段；没有价目表就没有峰谷之分。 */
export function isPeakAt(atMs, table) {
  const ms = Number(atMs);
  if (!table || !Number.isFinite(ms)) return false;
  const { weekday, hour, date } = beijingParts(ms);
  if (!table.peakWeekdays.includes(weekday)) return false;
  const holidays = table.holidays instanceof Set ? table.holidays : new Set(table.holidays ?? []);
  if (holidays.has(date)) return false;
  return (table.peakWindows ?? []).some(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && hour >= start && hour < end);
}

/**
 * 某模型在某一时刻的峰谷档位（`'peak'` / `'off'`）。
 *
 * 峰谷看这个模型自己的口径（模型级窗口 / 倍数），没有就回落表级的平台口径。
 * 表里还没有这个模型时同样按表级口径判 —— 账本淘汰聚合要先按档位分桶，
 * 那时可能还没有价目；等补上价目后按当时那一档重算，金额才追得回来。
 */
export function tierAt(model, atMs, table) {
  if (!table) return null;
  const entry = table.models[String(model ?? '').trim()];
  return isPeakAt(atMs, entry?.peak ?? table) ? 'peak' : 'off';
}

/**
 * 按**已判定的档位**取单价。
 *
 * 账本里被淘汰的聚合桶只留 `{模型 × 档位}`：金额在读取时重算，
 * 档位沿用记录当时的判定，不随「现在几点」漂移。
 *
 * @returns 单价；**表里没有这个模型就是 `null`** —— 没价就不报价。
 */
export function ratesAtTier(model, tier, table) {
  if (!table) return null;
  const key = String(model ?? '').trim();
  const entry = table.models[key];
  if (!entry) return null;
  const off = entry.off;
  const peakScope = entry.peak ?? table;
  const peak = tier === 'peak';
  const factor = peak ? peakMultiplierOf(peakScope) : 1;
  return {
    model: key,
    label: entry.label,
    origin: entry.origin ?? 'declared',
    tier: peak ? 'peak' : 'off',
    tierLabel: peak ? '高峰时段' : '空闲时段',
    currency: table.currency,
    symbol: table.symbol,
    unit: table.unit,
    peakWindows: peakScope.peakWindows ?? [],
    peakWeekdays: peakScope.peakWeekdays ?? [],
    peakMultiplier: peakMultiplierOf(peakScope),
    cacheHit: off.cacheHit * factor,
    cacheMiss: off.cacheMiss * factor,
    cacheWrite: (Number.isFinite(off.cacheWrite) ? off.cacheWrite : off.cacheMiss) * factor,
    output: off.output * factor
  };
}

/**
 * 取某模型在某一时刻生效的单价（含峰谷判定）。
 *
 * @returns 单价；表里没有这个模型就是 `null`（没价不报价，不拿别的模型兜底估算）。
 */
export function ratesAt(model, atMs, table) {
  if (!table) return null;
  const key = String(model ?? '').trim();
  if (!table.models[key]) return null;
  return ratesAtTier(key, tierAt(key, atMs, table), table);
}

/**
 * 把 usage 归一化成四个互不重叠的计费桶。
 *
 * 同时接受两种键名，这一点是**必须**的：
 *   - DSH 原始口径：`inputTokens` / `cacheReadTokens` / `cacheWriteTokens` / `outputTokens`；
 *   - 账本落盘口径：`cacheMiss` / `cacheHit` / `cacheWrite` / `output`。
 * 只认一种会在「写盘 → 重新载入」时把桶读成 0（花费凭空少一截），所以两种都读。
 */
export function normalizeUsage(usage) {
  const pick = (value, ...keys) => {
    for (const key of keys) {
      const v = Number(value?.[key]);
      if (Number.isFinite(v) && v > 0) return Math.round(v);
    }
    return 0;
  };
  if (!usage || typeof usage !== 'object') {
    return { cacheMiss: 0, cacheHit: 0, cacheWrite: 0, output: 0, reasoning: 0 };
  }
  return {
    // DSH 的 inputTokens 是「未命中」部分，不是总输入。
    cacheMiss: pick(usage, 'cacheMiss', 'uncachedInputTokens', 'inputTokens'),
    cacheHit: pick(usage, 'cacheHit', 'cacheReadTokens'),
    cacheWrite: pick(usage, 'cacheWrite', 'cacheWriteTokens'),
    output: pick(usage, 'output', 'outputTokens'),
    reasoning: pick(usage, 'reasoning', 'reasoningTokens')
  };
}

/** 四个桶求和（token 总量）。 */
export function totalTokensOf(buckets) {
  return (buckets?.cacheMiss ?? 0) + (buckets?.cacheHit ?? 0) + (buckets?.cacheWrite ?? 0) + (buckets?.output ?? 0);
}

/**
 * 按单价把 token 桶折算成金额。
 * @param buckets 归一化后的四个桶
 * @param rates   `ratesAt()` 的返回值
 * @returns 分项金额与合计（单位同 rates.currency）
 */
export function costOfBuckets(buckets, rates) {
  const b = buckets ?? {};
  const cacheHit = ((b.cacheHit ?? 0) / rates.unit) * rates.cacheHit;
  const cacheMiss = ((b.cacheMiss ?? 0) / rates.unit) * rates.cacheMiss;
  const cacheWrite = ((b.cacheWrite ?? 0) / rates.unit) * rates.cacheWrite;
  const output = ((b.output ?? 0) / rates.unit) * rates.output;
  return {
    cacheHit,
    cacheMiss,
    cacheWrite,
    output,
    total: cacheHit + cacheMiss + cacheWrite + output
  };
}

/**
 * 一步到位：给桶 + 时间 + 模型，直接算钱。
 * @returns `{ rates, cost }`；模型没申报价目时两者都是 `null`（只计 token，不计价）
 */
export function priceUsage(buckets, { model, at, table } = {}) {
  const rates = ratesAt(model, at, table);
  if (!rates) return { rates: null, cost: null };
  return { rates, cost: costOfBuckets(buckets, rates) };
}

/** 空桶常量（避免各处重复字面量）。 */
export const ZERO_BUCKETS = Object.freeze({ cacheMiss: 0, cacheHit: 0, cacheWrite: 0, output: 0, reasoning: 0 });

/** 桶相加。 */
export function addBuckets(a, b) {
  return {
    cacheMiss: (a?.cacheMiss ?? 0) + (b?.cacheMiss ?? 0),
    cacheHit: (a?.cacheHit ?? 0) + (b?.cacheHit ?? 0),
    cacheWrite: (a?.cacheWrite ?? 0) + (b?.cacheWrite ?? 0),
    output: (a?.output ?? 0) + (b?.output ?? 0),
    reasoning: (a?.reasoning ?? 0) + (b?.reasoning ?? 0)
  };
}

/** 桶相减（用于「基线之后」的增量），逐桶下限为 0。 */
export function subBuckets(a, b) {
  const s = (x, y) => Math.max(0, (x ?? 0) - (y ?? 0));
  return {
    cacheMiss: s(a?.cacheMiss, b?.cacheMiss),
    cacheHit: s(a?.cacheHit, b?.cacheHit),
    cacheWrite: s(a?.cacheWrite, b?.cacheWrite),
    output: s(a?.output, b?.output),
    reasoning: s(a?.reasoning, b?.reasoning)
  };
}
