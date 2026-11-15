// 合批：把「一串入站消息」折算成「这一次投递还要等多久」。
//
// 纯函数，不读盘、不认平台、不认运行模式。调用方只负责把「第一批是什么时候来的、
// 上一条是什么时候来的」记在批次状态里，等待时长全部由这里算。
//
// 两条硬约束来自实测手感：
//   · 单条消息只等 base，不能陪跑满 maxWait —— 否则私聊、@ 都要白等一个完整窗口；
//   · 有新消息就续期，但永远不超过 maxWait —— 否则热闹群会被无限期续期，一条都发不出去。

const nonNegative = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * 本次投递还需等待多少毫秒。
 *
 * gap 取「距同批上一条入站」的间隔：批内首条时 prevAt 为空（或 0），gap 记 0，
 * 于是首条只等 base；之后每来一条按间隔伸缩，并受 maxWait 绝对上限约束。
 *
 * @param {object} input
 * @param {number} input.now        现在（毫秒时间戳）
 * @param {number} input.firstAt    本批第一条入站的时刻
 * @param {number} [input.prevAt]   同批上一条入站的时刻（首条留空）
 * @param {number} input.baseMs     单条消息的最短等待
 * @param {number} input.maxWaitMs  合批硬上限
 * @param {boolean} [input.adaptive] false = 固定等满 maxWaitMs（等价性对照与排障用）
 * @returns {number} 毫秒；<=0 表示立即投递
 */
export function batchDelayMs({ now, firstAt, prevAt, baseMs, maxWaitMs, adaptive = true }) {
  const at = nonNegative(now, Date.now());
  const maxWait = nonNegative(maxWaitMs, 0);
  if (maxWait <= 0) return 0;
  const first = nonNegative(firstAt, at);
  const remaining = maxWait - Math.max(0, at - first);
  if (remaining <= 0) return 0;
  if (!adaptive) return Math.round(remaining);
  const gap = prevAt > 0 ? Math.max(0, at - nonNegative(prevAt, at)) : 0;
  const base = Math.min(nonNegative(baseMs, 0), maxWait);
  return Math.round(Math.min(remaining, Math.max(base, 0.8 * gap)));
}

/**
 * 批内取「更急」的那一档：direct 永远压过 ambient。
 * 定时器类唤醒不参与档位，按 ambient 的窗口合批（它不该因为「是时钟」就少等或插队）。
 */
export function tighterTier(a, b) {
  return a === 'direct' || b === 'direct' ? 'direct' : 'ambient';
}
