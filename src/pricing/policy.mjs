// 计费口径（货币 / 单位 / 峰谷倍数与窗口）的归一化。
//
// 只服务声明面：平台申报的 `pricingPolicy` 与模型级 `pricingPolicy` 共用这一份判据。
// 本机覆盖层只存单价、改不了峰谷 —— 否则同一条用量会因「谁在什么时间读」而变价。
// 判据：只保留认识的键；标量逐字段，`peakWindows` / `peakWeekdays` 是「组」，覆盖时整组替换 ——
// 逐项合并会拼出从没申报过的时段。**显式空数组要保留**：它表达「这个模型没有高峰时段
// （全天同价）」，与「没写、回落上一层」是两件事，所以这里不把空组过滤掉。
export const POLICY_SCALARS = Object.freeze(['version', 'currency', 'symbol', 'unit', 'peakMultiplier']);
export const POLICY_GROUPS = Object.freeze(['peakWindows', 'peakWeekdays']);

function finite(value) {
  // 只有空白的输入框等于「没填」，不能按 Number(' ') = 0 当成免费价。
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** 归一一份口径；输入不是对象时给空对象（= 这一层什么都不覆盖）。 */
export function normalizePricingPolicy(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const key of POLICY_SCALARS) {
    if (!(key in raw) || raw[key] === null) continue;
    if (key === 'unit' || key === 'peakMultiplier') {
      const n = finite(raw[key]);
      if (n !== null && n > 0) out[key] = n;
      continue;
    }
    const text = String(raw[key]).trim();
    if (text) out[key] = text;
  }
  if ('peakWeekdays' in raw && raw.peakWeekdays !== null) {
    const days = Array.isArray(raw.peakWeekdays) ? raw.peakWeekdays.map(Number) : null;
    if (days && days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)) out.peakWeekdays = days;
  }
  if ('peakWindows' in raw && raw.peakWindows !== null) {
    // 窗口是 [起始小时, 结束小时]（半开区间），两个端点都得是 0-24 的整数且start < end。
    const windows = Array.isArray(raw.peakWindows) ? raw.peakWindows : null;
    const valid = windows && windows.every((w) => Array.isArray(w) && w.length === 2
      && w.every((h) => Number.isInteger(Number(h)) && Number(h) >= 0 && Number(h) <= 24)
      && Number(w[0]) < Number(w[1]));
    if (valid) out.peakWindows = windows.map(([a, b]) => [Number(a), Number(b)]);
  }
  return out;
}
