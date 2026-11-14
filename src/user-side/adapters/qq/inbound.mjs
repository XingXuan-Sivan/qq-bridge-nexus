// QQ（OneBot v11）入站：厂商报文 → 统一事件，并挂在既有 WS 连接上（C3）。
//
// 三件事写在一个文件里，因为它们是同一条链路的事实：
//   · 翻译（oneBotToUnified）：OneBot 的 message 数组 → 中立段；
//   · 剔掉自己发的消息（isSelfMessage）：OneBot 会把机器人自己的群消息也推回来；
//   · connect()：把翻译接到 WS 客户端上，返回一个可关闭的句柄。
//
// 为什么是「注入客户端」而不是自己连：QQ 的 WS 连接同时承载通知、心跳与健康度，
// 桥接自己要用；再建第二条等于让 SnowLuma 看到两个客户端，重连风暴时互相挤。
// 与 sendOneBotAction 用 setOneBotBackend 注入后端地址是同一个理由 —— 适配器
// 不认识配置，只认识连接。
//
// 翻译必须是**全函数**：陌生态（OneBot 生态里每天都在多出新的 `xxx` 段，还有
// `face` 这种内置表情）一律降成占位文本，绝不让一条陌生段把整条消息判成畸形。
// 入站是事实记录，宁可少一笔，也不能丢一条。

import { normalizeSegment } from '../../segments.mjs';

/** OneBot 段类型 → 中立段的草稿。没收录的类型走占位文本。 */
const SEGMENT_DRAFTS = {
  text: (data) => ({ type: 'text', data: { text: String(data.text ?? '') } }),
  // `qq: 'all'` 是 @全体成员。中立段没有「全体」这个概念（发送侧也把 all 当滥用面拦），
  // 所以这里降成文本，保留「有人 @ 了全员」这个事实。
  at: (data) => (String(data.qq ?? '').trim() === 'all'
    ? { type: 'text', data: { text: '@全体成员' } }
    : { type: 'mention', data: { target: String(data.qq ?? '').trim() } }),
  reply: (data) => ({ type: 'reply', data: { messageId: String(data.id ?? '').trim() } }),
  image: (data) => ({ type: 'image', data: pickMedia(data) }),
  record: (data) => ({ type: 'voice', data: pickMedia(data) }),
  video: (data) => ({ type: 'video', data: pickMedia(data) }),
  file: (data) => ({ type: 'file', data: { ...pickMedia(data), ...(data.name ? { name: String(data.name) } : {}) } }),
  mface: (data) => ({
    type: 'sticker',
    data: { ...(data.url ? { url: String(data.url) } : {}), ...(data.emoji_id ? { id: String(data.emoji_id) } : {}) },
  }),
  forward: (data) => ({ type: 'forward', data: { id: String(data.id ?? '').trim() } }),
};

/** 认不出的段类型 → 占位文本。常见的几种给可读名字，其余用原文类型名。 */
const PLACEHOLDER_TEXT = Object.freeze({
  face: '[表情]',
  json: '[卡片消息]',
  xml: '[卡片消息]',
  share: '[链接]',
  location: '[位置]',
  music: '[音乐]',
  dice: '[骰子]',
  rps: '[猜拳]',
  shake: '[窗口抖动]',
  contact: '[推荐联系人]',
  node: '[合并转发]',
  light_app: '[小程序]',
});

/** @type {() => object|null} */
let clientProvider = () => null;
/** 当前这条入站订阅（同一进程只该有一条）。 */
let attached = null;

/** 注入 WS 客户端来源（bridge 启动时调一次）。 */
export function setOneBotClient(provider) {
  clientProvider = typeof provider === 'function' ? provider : () => null;
}

/** 测试用：恢复成「没有客户端」。 */
export function resetOneBotClient() {
  clientProvider = () => null;
}

function resolveClient() {
  try {
    return clientProvider() ?? null;
  } catch {
    return null;
  }
}

function pickMedia(data) {
  const file = String(data?.file ?? '').trim();
  const url = String(data?.url ?? '').trim();
  return { ...(file ? { file } : {}), ...(url ? { url } : {}) };
}

function placeholderSegment(type) {
  return { type: 'text', data: { text: PLACEHOLDER_TEXT[type] ?? `[${type || '未知段'}]` } };
}

/**
 * 单个 OneBot 段 → 中立段（`{ type, data }`）。
 *
 * 出口统一成中立名（`at` → `mention`、`record` → `voice`），因此下游只认一套词。
 * 形状由内核的 normalizeSegments 裁定：它判为非法（例如只有 id 没有地址的图片）
 * 就降成占位文本 —— 判定规则只有一份，不在这里复制。
 */
export function oneBotSegmentToNeutral(segment) {
  const type = String(segment?.type ?? '').trim().toLowerCase();
  const data = segment?.data && typeof segment.data === 'object' && !Array.isArray(segment.data) ? segment.data : {};
  const draft = SEGMENT_DRAFTS[type]?.(data);
  if (!draft) return placeholderSegment(type);
  try {
    return normalizeSegment(draft);
  } catch {
    return placeholderSegment(type);
  }
}

/**
 * OneBot message（数组或 CQ 字符串）→ 中立段数组。
 *
 * 字符串形态（老网关的 CQ 码写法）不解析：把整串当一个文本段，至少内容不丢；
 * 解析别家的 CQ 语法属于「平台事实」，没有第二个调用方就不写。
 */
export function oneBotSegmentsToNeutral(message) {
  if (typeof message === 'string') return message ? [{ type: 'text', data: { text: message } }] : [];
  if (!Array.isArray(message)) return [];
  return message.map(oneBotSegmentToNeutral);
}

/** 这条报文是不是机器人自己发的（OneBot 会把 `message_sent` 之类也推回来）。 */
export function isSelfMessage(raw) {
  const selfId = String(raw?.self_id ?? '').trim();
  if (!selfId) return false;
  return String(raw?.sender?.user_id ?? raw?.user_id ?? '').trim() === selfId;
}

/**
 * OneBot 消息报文 → 统一事件（未校验；校验由入站管线做）。
 *
 * `platform` / `account` 故意不写：它们只由内核的 origin 决定，写了也会被覆盖
 * （见 src/user-side/event.mjs）。原始报文留在 `ext.raw`，桥接侧的业务体还要用
 * 它（引用解析、合并转发、媒体下载都是 OneBot 形状）。
 */
export function oneBotToUnified(raw) {
  const type = raw?.message_type === 'private' ? 'private' : 'group';
  const conversationId = type === 'private' ? raw?.user_id : raw?.group_id;
  const senderId = String(raw?.sender?.user_id ?? raw?.user_id ?? '').trim();
  // OneBot 的 time 是**秒**，统一事件用毫秒（与 Date.now() 同尺度）。
  const seconds = Number(raw?.time);
  return {
    kind: 'message',
    type: `message.${type}`,
    conversation: { type, id: String(conversationId ?? '') },
    ...(senderId
      ? { sender: { id: senderId, name: String(raw?.sender?.card || raw?.sender?.nickname || '') } }
      : {}),
    message: { id: String(raw?.message_id ?? ''), segments: oneBotSegmentsToNeutral(raw?.message) },
    ...(Number.isFinite(seconds) && seconds > 0 ? { time: seconds * 1000 } : {}),
    ext: { raw },
  };
}

/**
 * 入站契约（C3）：`connect({signal, onEvent, onStatus}) → {close}`。
 *
 * 只做「把翻译结果交出去」这一件事：校验、准入、会话映射、唤醒都在内核的入站
 * 管线里（src/user-side/inbound.mjs）。所以这里既不判白名单，也不记审计 ——
 * 两处都判会让「为什么这条消息没进来」有两个可能的原因。
 */
export async function connectOneBot({ signal = null, onEvent, onStatus } = {}) {
  if (typeof onEvent !== 'function') throw new Error('QQ 入站缺少 onEvent 回调');
  const client = resolveClient();
  if (!client) {
    throw new Error('QQ 入站不可用：桥接还没有把 WS 客户端交给适配器（configureUserPlatformInbound）');
  }

  // 重复 connect 会把每条消息投两次；下游按 message_id 去重只挡得住重复的那一份，
  // 命令与社交历史却已经各走了一遍。所以新的连接先把旧的摘掉。
  if (attached) {
    const previous = attached;
    attached = null;
    try { await previous.close(); } catch { /* 旧句柄关不掉不影响新连接 */ }
  }

  let closed = false;
  const status = (state, detail) => {
    try {
      onStatus?.({ state, ...(detail ? { detail: String(detail?.message ?? detail) } : {}) });
    } catch {
      // 状态回调坏了不影响收消息。
    }
  };

  const accept = (raw) => {
    if (closed || !raw || typeof raw !== 'object') return;
    // 自己发的消息不是入站：不剔掉会让 agent 模式回答自己，chat 模式下还会自问自答。
    if (isSelfMessage(raw)) return;
    let unified;
    try {
      unified = oneBotToUnified(raw);
    } catch (error) {
      status('error', error);
      return;
    }
    try {
      // 管线永不抛错；这里仍兜一层，因为 onEvent 是调用方给的，
      // 异步失败会变成 unhandledRejection（桥接会把它记成致命异常）。
      Promise.resolve(onEvent(unified)).catch((error) => status('error', error));
    } catch (error) {
      status('error', error);
    }
  };

  // 优先用 onMessage（一条订阅覆盖私聊与群聊）；老版本 SDK 只有分开的两个。
  // 两个回调**不能**共用同一个函数引用：SDK 内部可能用 Set 存监听器，同一引用
  // 注册两次只会留下一个（那正是「私聊能收、群聊收不到」的最隐蔽形态）。
  const unsubscribe = typeof client.onMessage === 'function'
    ? [client.onMessage(accept)]
    : [
      typeof client.onPrivateMessage === 'function' ? client.onPrivateMessage((raw) => accept(raw)) : null,
      typeof client.onGroupMessage === 'function' ? client.onGroupMessage((raw) => accept(raw)) : null,
    ].filter(Boolean);

  const close = async () => {
    if (closed) return;
    closed = true;
    if (attached === handle) attached = null;
    signal?.removeEventListener?.('abort', close);
    for (const off of unsubscribe) {
      try { off?.(); } catch { /* SDK 的退订是尽力而为 */ }
    }
    status('closed');
  };
  const handle = { close };

  if (signal?.aborted) {
    await close();
    return handle;
  }
  signal?.addEventListener?.('abort', () => { void close(); }, { once: true });
  attached = handle;
  status('open', typeof client.isConnected === 'boolean' ? `已连接=${client.isConnected}` : null);
  return handle;
}
