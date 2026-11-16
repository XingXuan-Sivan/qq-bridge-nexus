// QQ 会话上下文太长时自动压缩（让 Agent 平台执行 /compact）。
//
// 背景（实测）：二代仿真的 QQ 会话一直不重建，历史越攒越长；每一步模型都要把整段历史重读一遍。
// 群 A 每一步要读 50～67 万 token：缓存命中率 99%，但光「命中缓存」一项就占了花费的三分之二。
// Agent 平台自带的自动压缩按模型上下文窗口的比例触发，窗口大的模型要到很晚才压。
//
// 这里在桥接侧补一道更早的门槛：某个会话最近一步读的 token 超过阈值，
// 就在这一轮结束、会话空闲后执行一次 /compact。平台会把较早的历史换成一条摘要，近期对话原样保留。
// 冷却：同一个会话两次自动压缩至少隔 2 小时（失败也算，避免反复重试）。
// 压缩后桥接会在下一次唤醒重新完整给出黑话表、表情块和角色卡（见 bridge.js 的 compactConversation）。
//
// 「平台自己什么时候压」由平台在 agent-platform.yml 的 `modelCatalog.compact.approxTokens` 申报：
// 这个值既是阈值的缺省值，也是阈值上限（设得比它还晚没有意义）。桥接不内置任何平台的数字。

/** 阈值下限：填得太小会让上下文一直在摘要上打转。 */
export const COMPACT_THRESHOLD_MIN = 50_000;

/** 两种压缩方式：桥接提前压 / 交给平台自己压。 */
export const COMPACT_MODES = Object.freeze(['early', 'agent']);

export const COMPACT_DEFAULTS = Object.freeze({
  mode: 'early',
  // null = 跟随平台申报的近似触发点。
  thresholdTokens: null,
  cooldownMinutes: 120,
  idleDelayMs: 20_000,
});

/** 平台申报的近似触发点；没申报（或不可能合法）时为 null。 */
export function declaredCompactPoint(approxTokens) {
  const n = Number(approxTokens);
  return Number.isFinite(n) && n >= COMPACT_THRESHOLD_MIN ? Math.round(n) : null;
}

/** 规范化 context.compact 配置；非法值回到默认。 */
export function normalizeCompactConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const num = (v, min, max, d) => (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : d);
  const threshold = Number(c.thresholdTokens);
  return {
    mode: COMPACT_MODES.includes(c.mode) ? c.mode : COMPACT_DEFAULTS.mode,
    thresholdTokens: Number.isFinite(threshold) && threshold >= COMPACT_THRESHOLD_MIN
      ? Math.round(threshold)
      : COMPACT_DEFAULTS.thresholdTokens,
    cooldownMinutes: num(c.cooldownMinutes, 10, 24 * 60, COMPACT_DEFAULTS.cooldownMinutes),
    idleDelayMs: Math.round(num(c.idleDelayMs, 0, 600_000, COMPACT_DEFAULTS.idleDelayMs)),
  };
}

/** 实际生效的阈值：自己设的，或平台申报点；平台申报点存在时不接受更晚的值。 */
export function effectiveCompactThreshold(config, approxTokens) {
  const point = declaredCompactPoint(approxTokens);
  const threshold = normalizeCompactConfig(config).thresholdTokens ?? point;
  if (!threshold) return null;
  return point ? Math.min(threshold, point) : threshold;
}

/** 一步读了多少 token（命中 + 未命中 + 写缓存）。usage 是归一化后的桶。 */
export function inputTokensOf(b) {
  if (!b || typeof b !== 'object') return 0;
  return (Number(b.cacheHit) || 0) + (Number(b.cacheMiss) || 0) + (Number(b.cacheWrite) || 0);
}

/**
 * 要不要压缩。
 * @param {object} args.approxTokens 平台申报的近似触发点（可选）
 * @returns {{ compact: boolean, reason: string }}
 */
export function decideCompact({ inputTokens, lastAttemptAt = 0, now = Date.now(), config, approxTokens } = {}) {
  const c = normalizeCompactConfig(config);
  if (c.mode === 'agent') return { compact: false, reason: '交给平台自己压缩' };
  const threshold = effectiveCompactThreshold(c, approxTokens);
  if (!threshold) return { compact: false, reason: '平台没申报自动压缩点，也没设阈值' };
  if (!(inputTokens > threshold)) return { compact: false, reason: '没超过阈值' };
  if (lastAttemptAt && now - lastAttemptAt < c.cooldownMinutes * 60_000) return { compact: false, reason: '冷却中' };
  return { compact: true, reason: `上一步读了 ${Math.round(inputTokens / 1000)}k token（阈值 ${Math.round(threshold / 1000)}k）` };
}

/**
 * 控制台改压缩设置。mode = 'early'（桥接提前压缩）或 'agent'（交给平台自己压）；
 * thresholdWan 留空 = 跟随平台申报点。不合法抛 Error（给人看的原因）。
 * 返回值直接写进 config.json 的 `compact` 段。
 */
export function compactConfigFromConsole(current, { mode, thresholdWan } = {}, { approxTokens } = {}) {
  const base = normalizeCompactConfig(current);
  if (!COMPACT_MODES.includes(mode)) throw new Error('压缩方式只能是「提前压缩」或「交给 Agent 平台」');
  if (mode === 'agent') return { ...base, mode };
  // 留空 = 跟随平台申报的近似触发点（此时「提前压缩」实际上不会早于平台自己的动作）。
  if (thresholdWan === undefined || thresholdWan === null || thresholdWan === '') {
    return { ...base, mode, thresholdTokens: null };
  }
  const min = COMPACT_THRESHOLD_MIN / 10_000;
  const point = declaredCompactPoint(approxTokens);
  const max = point ? point / 10_000 : null;
  const wan = Number(thresholdWan);
  if (!Number.isFinite(wan) || wan < min || (max !== null && wan > max)) {
    throw new Error(max === null
      ? `压缩阈值不能小于 ${min} 万 token（该平台没申报自动压缩点）`
      : `压缩阈值要在 ${min}～${max} 万 token 之间（平台自己在 ${max} 万左右压）`);
  }
  return { ...base, mode, thresholdTokens: Math.round(wan * 10_000) };
}
