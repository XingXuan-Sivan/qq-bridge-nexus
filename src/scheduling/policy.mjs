// 调度策略解析：默认值 + 覆盖层 → 内核用的普通对象。
//
// 参数只有一条解析链：`SCHEDULING_DEFAULTS` → `config.wake.<name>`（平台行为档案 / 全局配置）
// → 策略对象。会话态不承载任何节奏参数：会话态是「这个群现在的状态」，不是「这个平台的手感」。
//
// 核心中立：这里不出现「礼貌」「拟人」「该不该回」，只出现「投递一次的成本与顺序」。
// 换平台、换行为档案时，改的是 config 覆盖值，不是这段代码。

/** 核心默认值：唯一的真源，行为档案只在「这个平台的默认值确实不同」时才写覆盖键。 */
export const SCHEDULING_DEFAULTS = Object.freeze({
  adaptiveDebounce: true,
  directBaseMs: 1200,
  directMaxWaitMs: 3000,
  ambientBaseMs: 4000,
  ambientMaxWaitMs: 8000,
  directBudgetCapacity: 3,
  directRefillMs: 20000,
  ambientBudgetCapacity: 6,
  ambientRefillMs: 300000,
  backlogEnabled: true,
  backlogWakeAfter: 3,
  backlogQuietMs: 60000,
});

/** 明确冲 bot 来的原因：被别的唤醒挤掉就是事故，单独走 direct 档与 direct 桶。 */
const DIRECT_WAKE_REASONS = new Set(['private', 'atMention', 'ownerRelay', 'speaker']);

/**
 * 时钟类原因：它们属于「到点了」而不是「有信号了」。
 * 不消耗预算 —— timeout 被预算拦住会让会话停在「潜水已到期 + 没有任何定时器」的静默态，
 * 比省一次唤醒严重得多。
 */
const CLOCK_WAKE_REASONS = new Set(['timeout', 'replyCheck', 'proactiveCheck', 'scheduled', 'admin', 'silenceEnded', 'roleRefresh', 'bootstrap']);

/**
 * 唤醒原因 → 档位。原因可能带子类型（`keyword:小鲸鱼`、`speaker:昵称`），只取冒号前的基名。
 *
 * 未登记的原因落到 ambient 而不是 direct：漏登记的代价只是「慢一点」，
 * 反过来会让一条陌生原因无限量抢占 direct 额度。
 */
export function tierOf(reason) {
  const base = String(reason ?? '').split(':')[0];
  if (CLOCK_WAKE_REASONS.has(base)) return 'clock';
  if (DIRECT_WAKE_REASONS.has(base)) return 'direct';
  return 'ambient';
}

const toBool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const toInt = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
};

/**
 * 解析策略。`wake` 是 `config.wake` 段（核心默认值之上叠了平台档案与全局配置）。
 *
 * @param {object} [wake]
 * @returns {{
 *   adaptiveDebounce: boolean,
 *   batching: { direct: {baseMs:number,maxWaitMs:number}, ambient: {baseMs:number,maxWaitMs:number} },
 *   pacing: { direct: {capacity:number,refillMs:number}, ambient: {capacity:number,refillMs:number} },
 *   backlog: { enabled: boolean, wakeAfter: number, quietMs: number }
 * }}
 */
export function resolveSchedulingPolicy(wake = {}) {
  const w = wake && typeof wake === 'object' ? wake : {};
  const d = SCHEDULING_DEFAULTS;
  return {
    adaptiveDebounce: toBool(w.adaptiveDebounce, d.adaptiveDebounce),
    batching: {
      direct: {
        baseMs: toInt(w.directBaseMs, d.directBaseMs, 0, 600000),
        maxWaitMs: toInt(w.directMaxWaitMs, d.directMaxWaitMs, 0, 600000),
      },
      ambient: {
        baseMs: toInt(w.ambientBaseMs, d.ambientBaseMs, 0, 600000),
        maxWaitMs: toInt(w.ambientMaxWaitMs, d.ambientMaxWaitMs, 0, 600000),
      },
    },
    pacing: {
      direct: {
        capacity: toInt(w.directBudgetCapacity, d.directBudgetCapacity, 0, 1000),
        refillMs: toInt(w.directRefillMs, d.directRefillMs, 0, 86400000),
      },
      ambient: {
        capacity: toInt(w.ambientBudgetCapacity, d.ambientBudgetCapacity, 0, 1000),
        refillMs: toInt(w.ambientRefillMs, d.ambientRefillMs, 0, 86400000),
      },
    },
    backlog: {
      enabled: toBool(w.backlogEnabled, d.backlogEnabled),
      wakeAfter: toInt(w.backlogWakeAfter, d.backlogWakeAfter, 1, 1000),
      quietMs: toInt(w.backlogQuietMs, d.backlogQuietMs, 0, 3600000),
    },
  };
}

/** 某一档的合批窗口（`clock` 按 ambient 合批：它不该因为「是时钟」就少等或插队）。 */
export function batchLimits(policy, tier) {
  return tier === 'direct' ? policy.batching.direct : policy.batching.ambient;
}
