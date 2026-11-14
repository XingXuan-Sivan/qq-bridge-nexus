// 回合收集器（归一事件的消费者）：把一段回合里的助手文本攒成一条完整回复。
//
// 为什么不是每家适配器各写一份：回合边界与文本累加是**内核的语义**（「一轮对话说了什么」），
// 平台只是用不同事件表达它。放在这里，DSH 的 turn/start 与 ACP 的隐藏回合编号走同一条
// 累加路径，适配器只负责把平台事件翻成 `AGENT_EVENT_KINDS`。
//
// 分组键是 `turn`（平台给了编号时）而不是会话：一个会话可以同时有排队中的第二个回合，
// 按会话分组会把两轮的文本混成一条回复。

/**
 * 建一个归一回合收集器。
 *
 * @returns {{
 *   push: (event: object) => ({turn: (string|number|null), reason: object, text: string}|null),
 *   size: () => number,
 * }}
 *   `push()` 返回非 null 表示这一条事件收尾了一个回合，值里带最终文本与结束原因。
 */
export function createAgentTurnCollector() {
  const turns = new Map(); // 分组键 -> { turn, text }

  /**
   * 分组键：有回合编号时按编号分组，没有时按会话分组。
   *
   * 两段拼起来是为了让同一条流里的「有编号的回合」与「没编号的会话」不会撞键 ——
   * 会话 id 里不会出现 `#` 与编号尾巴的组合巧合，这一点由键前缀不被复用保证。
   */
  const keyOf = (event) => (event.turn === undefined || event.turn === null
    ? String(event.sessionId ?? '')
    : `${String(event.sessionId ?? '')}#${event.turn}`);

  /**
   * 后续事件该落进哪一组。
   *
   * 有回合号就精确匹配；没有时归到该会话**唯一**打开的回合 —— 有的平台只在
   * turn-start / turn-end 带编号，文本不带，精确匹配会把这一轮的文本丢掉。
   * 同时开着多个回合时无从判定，落回会话键（宁可丢弃，也不能混进另一轮回复）。
   */
  function groupKeyOf(event) {
    const exact = keyOf(event);
    if (event.turn !== undefined && event.turn !== null) return exact;
    const prefix = `${String(event.sessionId ?? '')}#`;
    const open = [...turns.keys()].filter((key) => key.startsWith(prefix));
    return open.length === 1 ? open[0] : exact;
  }

  return {
    push(event) {
      if (!event || typeof event !== 'object') return null;
      if (event.kind === 'turn-start') {
        turns.set(keyOf(event), { turn: event.turn ?? null, text: '' });
        return null;
      }
      if (event.kind === 'text') {
        const turn = turns.get(groupKeyOf(event));
        if (!turn) return null;
        turn.text += String(event.delta ?? '');
        return null;
      }
      if (event.kind === 'turn-end') {
        const key = groupKeyOf(event);
        const turn = turns.get(key);
        turns.delete(key);
        if (!turn) return null;
        return { turn: turn.turn, reason: event.reason ?? { kind: 'completed' }, text: turn.text };
      }
      return null;
    },

    /** 当前仍在跟踪（有 start 无 end）的回合数：用来判断收集器是否已成空壳。 */
    size() {
      return turns.size;
    },
  };
}
