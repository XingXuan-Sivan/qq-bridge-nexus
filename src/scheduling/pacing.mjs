// 投递预算：两档令牌桶。
//
// 桶计的是**投递次数**，不是消息条数 —— 合批窗口里十句话合成一次投递，只消耗 1。
// 状态是普通对象 `{ direct: { tokens, at }, ambient: { tokens, at } }`，落盘由调用方负责。
//
// 三条不可省的细节：
//   · tokens 必须保留小数：回填量 = 经过时间 / 回填间隔，取整会让「差一点就满」永远差一点，
//     表现为桶打空后再也不恢复；
//   · 两档物理隔离：ambient 打空不影响 direct（否则热闹群会把一条 @ 拖到几十秒后）；
//   · 容量 <= 0 视为「不限额」而不是「禁止投递」：配置写坏不能把会话彻底锁死。

export const PACING_TIERS = Object.freeze(['direct', 'ambient']);

const round = (value) => Math.round(value * 1000) / 1000;
const capacityOf = (cfg) => {
  const n = Number(cfg?.capacity);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const refillOf = (cfg) => {
  const n = Number(cfg?.refillMs);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** 满桶。 */
export function createPacingState(pacingCfg = {}, now = Date.now()) {
  const state = {};
  for (const tier of PACING_TIERS) {
    state[tier] = { tokens: capacityOf(pacingCfg[tier]), at: now };
  }
  return state;
}

/** 从落盘的桶状态恢复：缺档补齐、越界夹紧、时间戳异常按「此刻」处理。 */
export function normalizePacingState(raw, pacingCfg = {}, now = Date.now()) {
  const fresh = createPacingState(pacingCfg, now);
  if (!raw || typeof raw !== 'object') return fresh;
  const state = {};
  for (const tier of PACING_TIERS) {
    const capacity = fresh[tier].tokens;
    const stored = raw[tier];
    const tokens = Number(stored?.tokens);
    const at = Number(stored?.at);
    state[tier] = {
      tokens: round(Math.min(capacity, Math.max(0, Number.isFinite(tokens) ? tokens : capacity))),
      at: Number.isFinite(at) && at > 0 && at <= now ? at : now,
    };
  }
  return state;
}

function refill(bucket, capacity, refillMs, now) {
  const at = Number(bucket?.at) > 0 ? Number(bucket.at) : now;
  if (capacity <= 0) return { tokens: 0, at: now };
  const elapsed = Math.max(0, now - at);
  const grown = refillMs > 0 ? elapsed / refillMs : capacity;
  const tokens = Math.min(capacity, Math.max(0, Number(bucket?.tokens) || 0) + grown);
  return { tokens: round(tokens), at: now };
}

/**
 * 从某一档取一个 token。
 *
 * 返回新的状态对象（不改入参），调用方把 `state` 写回会话态即可。
 * `allowed=false` 时 `waitMs` 是「还差多久回填出 1 个」，供降级重试用；容量 <= 0 时永远放行。
 *
 * @returns {{ allowed: boolean, state: object, tokens: number, waitMs: number }}
 */
export function takeToken(state, tier, pacingCfg, now = Date.now()) {
  const current = state && typeof state === 'object' ? state : createPacingState(pacingCfg, now);
  const cfg = pacingCfg?.[tier] ?? {};
  const capacity = capacityOf(cfg);
  const refillMs = refillOf(cfg);
  const bucket = refill(current[tier], capacity, refillMs, now);
  if (capacity <= 0) {
    return { allowed: true, state: { ...current, [tier]: bucket }, tokens: bucket.tokens, waitMs: 0 };
  }
  if (bucket.tokens >= 1) {
    return {
      allowed: true,
      state: { ...current, [tier]: { tokens: round(bucket.tokens - 1), at: now } },
      tokens: bucket.tokens,
      waitMs: 0,
    };
  }
  return {
    allowed: false,
    state: { ...current, [tier]: bucket },
    tokens: bucket.tokens,
    waitMs: refillMs > 0 ? Math.max(0, Math.ceil((1 - bucket.tokens) * refillMs)) : 0,
  };
}

/** 投递失败要退回这一个 token（否则被拒的那一枪白扣额度，重试会被自己的失败卡住）。 */
export function refundToken(state, tier, pacingCfg, now = Date.now()) {
  const current = state && typeof state === 'object' ? state : createPacingState(pacingCfg, now);
  const capacity = capacityOf(pacingCfg?.[tier]);
  if (capacity <= 0) return current;
  const bucket = current[tier] ?? { tokens: 0, at: now };
  return {
    ...current,
    [tier]: { tokens: round(Math.min(capacity, (Number(bucket.tokens) || 0) + 1)), at: Number(bucket.at) || now },
  };
}

/**
 * 读侧视图：控制台用，模型看不到。
 * `tokens` 是此刻实际可用额度（已经算上回填），不是落盘值。
 */
export function pacingSnapshot(state, pacingCfg = {}, now = Date.now()) {
  const view = {};
  for (const tier of PACING_TIERS) {
    const capacity = capacityOf(pacingCfg[tier]);
    const bucket = refill(state?.[tier], capacity, refillOf(pacingCfg[tier]), now);
    view[tier] = {
      tokens: bucket.tokens,
      capacity,
      refillMs: refillOf(pacingCfg[tier]),
    };
  }
  return view;
}
