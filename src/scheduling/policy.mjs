// 调度策略解析：默认值 + 覆盖层 → 内核用的普通对象。
//
// 参数只有一条解析链：行为引擎定义的默认值 → `config.wake.<name>`（行为档案里的覆盖）
// → 策略对象。会话态不承载任何节奏参数：会话态是「这个群现在的状态」，不是「这个平台的手感」。
//
// 核心中立：这里不出现「礼貌」「拟人」「该不该回」，只出现「投递一次的成本与顺序」。
// 默认值不在代码里：调用方从引擎定义取（`groupDefaults(engine, 'wake')`）传进来。

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
 * 解析策略。`wake` 是 `config.wake` 段（引擎默认值之上叠了档案覆盖），
 * `defaults` 是引擎定义里 `wake_*` 字段的默认值：缺了就取不到值，所以由引擎定义充当唯一真源。
 *
 * @param {object} [wake]
 * @param {object} [defaults]
 * @returns {{
 *   adaptiveDebounce: boolean,
 *   batching: { direct: {baseMs:number,maxWaitMs:number}, ambient: {baseMs:number,maxWaitMs:number} },
 *   pacing: { direct: {capacity:number,refillMs:number}, ambient: {capacity:number,refillMs:number} },
 *   backlog: { enabled: boolean, wakeAfter: number, quietMs: number }
 * }}
 */
export function resolveSchedulingPolicy(wake = {}, defaults = {}) {
  const w = wake && typeof wake === 'object' ? wake : {};
  const d = defaults && typeof defaults === 'object' ? defaults : {};
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
