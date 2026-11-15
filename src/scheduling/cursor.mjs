// 游标与收尾判据：判断「这一轮到底处理到哪」。
//
// 判据只有三个状态，且顺序固定：
//   explicitAck  已带水位回执（qq_mark_read / qq_set_wake_config 的 throughSeq）  → 终态，永不补发
//   unreadStill  那条消息还在未读缓冲里                                          → 必须补发
//   overflowed   被缓冲上限挤出、模型从未被展示过                                 → 记溢出，不假装处理过
//
// 「不调发送工具」是**没有动作**而不是一个状态，所以它不能当判据：分不清「看过决定不回」
// 与「根本没看到」。带水位的回执才是唯一强信号。

/**
 * 记录一次溢出（未读缓冲把消息挤出去了）。
 *
 * 已在未读窗口外的消息不会被再次展示，所以不能静默跨过：合并成一条记录，
 * 让下一次唤醒明确交代「有 N 条你可能没看到」。同一条消息只记一次。
 *
 * @param {object|null} prev  上一次的溢出记录
 * @param {Array} dropped     本次被挤出的消息（按 seq 升序）
 * @param {number} now
 * @returns {object|null} `{ count, fromSeq, toSeq, at }`
 */
export function noteOverflow(prev, dropped, now = Date.now()) {
  const list = Array.isArray(dropped) ? dropped.filter((m) => Number.isSafeInteger(Number(m?.seq))) : [];
  if (!list.length) return prev ?? null;
  const seqs = list.map((m) => Number(m.seq));
  const from = Math.min(...seqs);
  const to = Math.max(...seqs);
  const count = (Number(prev?.count) || 0) + list.length;
  const fromSeq = Number(prev?.fromSeq) > 0 ? Math.min(Number(prev.fromSeq), from) : from;
  const toSeq = Number(prev?.toSeq) > 0 ? Math.max(Number(prev.toSeq), to) : to;
  return { count, fromSeq, toSeq, at: now };
}

/** 水位推进到溢出范围末尾之后，这条记录就可以销账了。 */
export function clearAcknowledgedOverflow(overflow, lastReadThroughSeq) {
  if (!overflow) return null;
  const ack = Number(lastReadThroughSeq);
  if (!Number.isFinite(ack) || ack < 0) return overflow;
  return ack >= Number(overflow.toSeq) ? null : overflow;
}

/**
 * 一条暂存唤醒原因该走哪条路。
 *
 * 先判终态（explicitAck），再判「还在不在缓冲里」，最后才判溢出 —— 顺序反了会把
 * 「已回执」误判成「漏看」，变成没完没了的补发。
 *
 * 既没回执、又不在未读、也没有溢出记录的（比如状态被外部改写）一律按 unreadStill 处理：
 * 宁可多补一次，也不让一条消息被无声吞掉。
 *
 * @param {object} input
 * @param {{reason: string, seq: number}} input.item
 * @param {Array} input.unread
 * @param {number} input.lastReadThroughSeq
 * @param {object|null} input.overflow
 * @returns {'explicitAck'|'unreadStill'|'overflowed'}
 */
export function classifyPendingWake({ item, unread, lastReadThroughSeq, overflow }) {
  const seq = Number(item?.seq) || 0;
  const ack = Number(lastReadThroughSeq) || 0;
  if (seq > 0 && ack >= seq) return 'explicitAck';
  if (Array.isArray(unread) && unread.some((m) => m && Number(m.seq) >= seq)) return 'unreadStill';
  if (overflow && Number(overflow.toSeq) >= seq && Number(overflow.fromSeq) <= seq) return 'overflowed';
  return 'unreadStill';
}
