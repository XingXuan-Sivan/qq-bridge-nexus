// 内置价目：DeepSeek 官方 API 的缺省表，价目三层里最下面那层。
//
// 平台申报优先；申报里没有单价的模型用这里的官方价；本机覆盖（state/pricing/<agent>.yml）
// 再叠在两者之上 —— 但本机只能改单价，峰谷口径只属于声明面（内置口径 + 平台申报）。
// 账本按模型 id 取价，这里只列在售模型的官方 id：已下架的旧写法（deepseek-v4-flash、
// deepseek-v4-flash-vision-exp、deepseek-pro）不再占默认列表，要算旧记录就在价目卡手动加一行。
//
// 单价口径：人民币 / 百万 token；`cacheHit` 是缓存命中输入价，`cacheMiss` 是未命中输入价，
// `output` 是输出价，余额都是空闲时段的价格，高峰按 `peakMultiplier` 乘出来 ——
// 所以这里填的是官方价目表左侧那一列，不是平均值。
// 数字与版本取自 DeepSeek 官方 API 定价页（V4.1-Flash / V4-Pro）；官方改价时连同 version 一起改。
//
// 某个模型若官方不分时分价，就在**平台申报**的模型级 `pricingPolicy` 里写空的 `peakWindows`，
// 不需要在这里为它另做一套阈值。
import { normalizePricingPolicy } from './policy.mjs';

const V41_FLASH = Object.freeze({ cacheHit: 0.02, cacheMiss: 1, cacheWrite: 1, output: 4 });
const V4_PRO = Object.freeze({ cacheHit: 0.15, cacheMiss: 4.5, cacheWrite: 4.5, output: 13.5 });

export const BUILTIN_CATALOG = Object.freeze({
  pricingPolicy: Object.freeze({
    version: '2026-11-04',
    currency: 'CNY',
    symbol: '¥',
    unit: 1_000_000,
    peakMultiplier: 2,
    peakWindows: Object.freeze([[9, 12], [14, 18]]),
    peakWeekdays: Object.freeze([1, 2, 3, 4, 5]),
  }),
  models: Object.freeze([
    { id: 'deepseek-flash', label: 'DeepSeek-V4.1-Flash', pricing: V41_FLASH },
    { id: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro', pricing: V4_PRO },
  ]),
});

const BUILTIN_BY_ID = new Map(BUILTIN_CATALOG.models.map((item) => [item.id, item]));

/**
 * 把内置表叠到平台申报上，产出「申报面」价目目录。
 *
 * - 申报里有的模型：申报优先；申报只写了模型、没写单价时补上内置价（并标 `origin: 'builtin'`）。
 * - 申报里没有的模型：补进来，`origin: 'builtin'`。
 * - 口径：内置的官方峰谷做底，申报写了的字段盖上去（显式空窗口仍能关掉高峰）。
 */
export function withBuiltin(declared) {
  const base = declared && typeof declared === 'object' && !Array.isArray(declared) ? declared : {};
  const models = [];
  const seen = new Set();
  for (const item of base.models ?? []) {
    const id = String(item?.id ?? '').trim();
    if (!id) continue;
    seen.add(id);
    const fallback = BUILTIN_BY_ID.get(id);
    const pricing = item.pricing ?? fallback?.pricing ?? null;
    models.push({
      ...item,
      id,
      label: String(item.label || fallback?.label || id),
      pricing,
      origin: item.pricing ? 'declared' : (fallback ? 'builtin' : 'declared'),
    });
  }
  for (const item of BUILTIN_CATALOG.models) {
    if (!seen.has(item.id)) models.push({ ...item, pricing: { ...item.pricing }, origin: 'builtin' });
  }
  return {
    ...base,
    pricingPolicy: { ...BUILTIN_CATALOG.pricingPolicy, ...normalizePricingPolicy(base.pricingPolicy) },
    models,
  };
}
