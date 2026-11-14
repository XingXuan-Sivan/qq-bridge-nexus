// DSH 的事件面：把 wire 事件翻译成 `AGENT_EVENT_KINDS`，并维护审批 / 提问的挂起引用。
//
// 为什么单开一个文件：这一层全是**判别值表的翻译**（`turn/start`、`assistant/message`、
// `tool/call`……），纯函数、无状态，可以单独钉住；让 client.mjs 同时管 WebSocket 生命周期
// 与语义映射，就只能整体测。
//
// 三条约定：
//   1. 一轮事件可能翻成 0 条（`assistant/chunk` 与 `assistant/message` 内容重复，累加会让
//      回复文本翻倍）、也可能翻成多条（`assistant/message` 同时带文本与用量）；
//   2. 回合编号 `turn` 照原样带出去：收集器按它分组，排队中的第二个回合不会被混进同一条回复；
//   3. 回执键在**平台内部**找回：内核只持有 `{ instance, sessionId, requestId }`，
//      DSH 需要的 `clientId` + `eventId` 存在挂起表里，连接一断就作废。
import { blocksToText } from './client.mjs';

const clean = (value) => String(value ?? '').trim();

/** 从 assistant stream 记录里取最后一个 usage 采样（DSH 把用量挂在流式 chunk 上）。 */
export function usageFromStream(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let i = stream.length - 1; i >= 0; i -= 1) {
    const chunk = stream[i];
    if (chunk && typeof chunk === 'object' && chunk.usage !== undefined) return chunk.usage;
  }
  return undefined;
}

/**
 * 取一条会话事件携带的 provider usage（原始桶，未归一化）。
 *
 * `assistant/message` 优先用 `data.usage`（最终结算），否则回落到 `assistant/attempt` /
 * `assistant/message` 的 stream 尾部采样 —— 与 DSH 自己的 token 计量口径一致。
 */
export function usageOfWireEvent(event) {
  if (!event || typeof event !== 'object') return undefined;
  if (event.type === 'assistant/message' && event.data?.usage !== undefined) return event.data.usage;
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined;
  return usageFromStream(event.data?.stream);
}

/**
 * 建一份 DSH 事件面。
 *
 * @param {object} spec
 * @param {() => object} spec.getClient      惰性取客户端（地址与凭据就绪后才存在）
 * @param {Map<string, object>} spec.approvals 挂起表：`requestId -> { clientId, eventId, sessionId, at }`
 *   由连接层与 `createDshPort()` 共享 —— 事件面写入、端口读出，回执才能找到自己的键。
 * @returns {{mux: Function, follow: Function, forget: Function, sessionEvents: Function,
 *   snapshotEvent: Function, requestEvent: Function}}
 */
export function createDshEventPlane({ getClient, approvals }) {
  if (typeof getClient !== 'function') throw new Error('createDshEventPlane: 缺少 getClient');
  if (!(approvals instanceof Map)) throw new Error('createDshEventPlane: approvals 必须是 Map');

  /**
   * 重试轴：`(turn, step) -> retry` 序号。
   *
   * DSH 用 `llm/retry-started` 单独宣告「这一步又请求了一次」，用量样本本身不带序号。
   * 轴在**翻译期**消费掉，归一用量记录里只留结果 `retry` —— 账本不该认识平台的宣告事件。
   */
  const retryAxis = new Map(); // sessionId -> { turn, step, retry, seq }

  /** 一条用量样本需要的全部字段（`turn/step` 缺失时返回 null：无从归属，记账会让实数失真）。 */
  function usageEvent(sessionId, event) {
    const usage = usageOfWireEvent(event);
    if (!usage) return null;
    const turn = Number(event.data?.turn);
    const step = Number(event.data?.step);
    if (!Number.isFinite(turn) || !Number.isFinite(step)) return null;
    const seq = Number.isFinite(Number(event.seq)) ? Number(event.seq) : -1;
    const axis = retryAxis.get(sessionId);
    return {
      kind: 'usage',
      sessionId,
      turn,
      step,
      retry: axis && axis.turn === turn && axis.step === step ? axis.retry : 0,
      seq,
      at: Number.isFinite(Number(event.time)) ? Number(event.time) : undefined,
      model: clean(event.data?.model ?? event.data?.usage?.model) || undefined,
      provider: clean(event.data?.provider) || undefined,
      usage,
    };
  }

  /** `llm/retry-started` 只更新重试轴，不产出事件。 */
  function noteRetry(sessionId, event) {
    const turn = Number(event.data?.turn);
    const step = Number(event.data?.step);
    if (!Number.isFinite(turn) || !Number.isFinite(step)) return;
    const retry = Number.isFinite(Number(event.data?.retry)) ? Number(event.data.retry) : 1;
    const seq = Number.isFinite(Number(event.seq)) ? Number(event.seq) : -1;
    const axis = retryAxis.get(sessionId);
    if (axis && axis.seq > seq) return;
    retryAxis.set(sessionId, { turn, step, retry, seq });
  }

  /**
   * 一条会话 wire 事件 → 归一事件数组。
   *
   * 未列出的 wire 类型直接丢弃：DSH 的事件类型远多于桥接消费的那几种（标题、种子、
   * 会话状态…），把它们统统翻成 notice 只会让日志与账本里全是噪声。
   */
  function sessionEvents(sessionId, event) {
    if (!event || typeof event !== 'object' || !sessionId) return [];
    const turn = event.data?.turn;
    switch (event.type) {
      case 'turn/start':
        return [{ kind: 'turn-start', sessionId, turn }];

      case 'assistant/chunk':
        // 流式分块与 assistant/message 是同一份内容的两种粒度，累加会让回复文本翻倍。
        return [];

      case 'assistant/message': {
        const out = [];
        const text = blocksToText(event.data?.message?.content);
        if (text) out.push({ kind: 'text', sessionId, turn, delta: text });
        const usage = usageEvent(sessionId, event);
        if (usage) out.push(usage);
        return out;
      }

      case 'assistant/attempt': {
        // 只有用量（流式采样），没有可发的文本。
        const usage = usageEvent(sessionId, event);
        return usage ? [usage] : [];
      }

      case 'turn/end':
        return [{
          kind: 'turn-end',
          sessionId,
          turn,
          reason: event.data?.reason && typeof event.data.reason === 'object'
            ? event.data.reason
            : { kind: 'completed' },
        }];

      case 'tool/call':
        return [{
          kind: 'tool',
          sessionId,
          turn,
          callId: event.data?.callId,
          name: clean(event.data?.name),
          phase: 'start',
          args: event.data?.arguments ?? event.data?.input,
        }];

      case 'tool/result': {
        const message = event.data?.message ?? {};
        const block = message.content?.[0];
        const failed = message.isError === true || block?.isError === true;
        return [{
          kind: 'tool',
          sessionId,
          turn,
          callId: message.source?.callId,
          phase: 'end',
          ok: !failed,
          error: failed ? clean(block?.text ?? block?.error ?? message.error) : '',
        }];
      }

      case 'model/selection':
        return [{
          kind: 'notice',
          sessionId,
          notice: 'model-selection',
          model: clean(event.data?.model) || undefined,
          provider: clean(event.data?.provider) || undefined,
        }];

      case 'llm/retry-started':
        noteRetry(sessionId, event);
        return [];

      default:
        return [];
    }
  }

  /**
   * 开场快照 → 一条归一 `snapshot` 事件。
   *
   * 快照里含**历史**回合的 turn/end，所以它绝不能被当成普通事件流喂给内核：那是
   * 「早已结束的回合被当成新回合发一条 QQ 回复」的直接成因。这里只保留内核需要的三样：
   * 当前模型、token 投影基线、可回放的历史记录。
   */
  function snapshotEvent(sessionId, snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !sessionId) return null;
    const values = snapshot.projections?.values ?? {};
    const selection = values.modelSelection?.lastUsed ?? values.modelSelection?.pending ?? null;
    const tokenUsage = values.tokenUsage;
    const records = [];
    // 记录按 seq 升序回放：重试轴与「进行中的回合」都依赖真实顺序。
    for (const entry of Array.isArray(snapshot.records) ? snapshot.records : []) {
      const wire = entry?.type === 'event' ? entry.event : entry;
      records.push(...sessionEvents(sessionId, wire));
    }
    return {
      kind: 'snapshot',
      sessionId,
      model: selection ? { model: clean(selection.model) || undefined, provider: clean(selection.provider) || undefined } : null,
      baseline: tokenUsage
        ? { tokenUsage, asOfSeq: Number.isFinite(Number(snapshot.projections?.asOfSeq)) ? Number(snapshot.projections.asOfSeq) : -1 }
        : null,
      records,
    };
  }

  /**
   * 审批 / 提问请求 → 归一事件，并把回执需要的平台键记进挂起表。
   *
   * `requestId` 用 `eventId`：DSH 的回执（`$events/result`）就是按它对齐的，内核拿它
   * 拼引用，两个平台就统一成了同一个形状。
   */
  function requestEvent(frame) {
    const sessionId = clean(frame.sessionId);
    const requestId = clean(frame.eventId);
    if (!sessionId || !requestId) return null;
    approvals.set(requestId, {
      clientId: clean(frame.clientId),
      eventId: requestId,
      sessionId,
      at: Date.now(),
    });
    if (frame.type === 'question/requested') {
      return {
        kind: 'question',
        sessionId,
        requestId,
        questions: Array.isArray(frame.questions) ? frame.questions : [],
      };
    }
    return {
      kind: 'permission',
      sessionId,
      requestId,
      callId: frame.callId != null ? String(frame.callId) : '',
      name: clean(frame.toolName),
      toolKind: '',
      reason: clean(frame.reason),
      // DSH 的审批只有「通过 / 拒绝」，没有可选项清单；给空数组而不是编一份。
      options: [],
    };
  }

  /**
   * 事件流：`client.events.mux()` 的 wire 帧在这里翻成归一事件。
   *
   * `onOpen` 原样透传（调用方据此知道「可以开始投递了」）；生成器收尾时清空挂起表——
   * 连接一断，平台侧的等待就不存在了，留着只会让回执打到一个失效的连接上。
   */
  async function* mux(_payload, signal, onOpen) {
    const stream = getClient().events.mux({}, signal, onOpen);
    try {
      for await (const envelope of stream) {
        const frame = envelope?.payload ?? {};
        if (frame.type === 'session/snapshot') {
          const translated = snapshotEvent(frame.sessionId, frame.snapshot);
          if (translated) yield translated;
        } else if (frame.type === 'session/event') {
          for (const event of sessionEvents(frame.sessionId, frame.event)) yield event;
        } else if (frame.type === 'approval/requested' || frame.type === 'question/requested') {
          const translated = requestEvent(frame);
          if (translated) yield translated;
        } else if (frame.type === 'stream/error') {
          yield { kind: 'notice', sessionId: '', notice: 'stream-error', error: frame.error };
        }
      }
    } finally {
      approvals.clear();
    }
  }

  return {
    mux,
    follow: (sessionId) => getClient().events.follow(sessionId),
    forget: (sessionId) => getClient().events.forget(sessionId),
    sessionEvents,
    snapshotEvent,
    requestEvent,
  };
}
