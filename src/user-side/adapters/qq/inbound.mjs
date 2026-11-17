// QQ（OneBot v11）入站：厂商报文 → 统一事件，并挂在既有 WS 连接上（C3）。
//
// 四件事写在一个文件里，因为它们是同一条链路的事实：
//   · 翻译消息（oneBotToUnified）：OneBot 的 message 数组 → 中立段；
//   · 翻译通知（noticeToUnified）：拍一拍、撤回、入群/退群/改名片 → 统一事件的通知位；
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
import { oneBotClient } from './connection.mjs';

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

/** 当前这条入站订阅（同一进程只该有一条）。 */
let attached = null;

function pickMedia(data) {
  const file = String(data?.file ?? '').trim();
  const url = String(data?.url ?? '').trim();
  return { ...(file ? { file } : {}), ...(url ? { url } : {}) };
}

/** OneBot 的 id 可能是 number，也可能是 0（UID 解析失败）—— 0 一律当没有。 */
function idText(value) {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  return s === '0' ? '' : s;
}

/** OneBot 的 time 是**秒**，统一事件用毫秒（与 Date.now() 同尺度）。 */
function timeOf(raw) {
  const seconds = Number(raw?.time);
  return Number.isFinite(seconds) && seconds > 0 ? { time: seconds * 1000 } : {};
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

function mediaText(value, max = 1024) {
  return String(value ?? '').trim().slice(0, max);
}

/**
 * OneBot message → 中立媒体清单（“收到了什么”）。
 *
 * 图片与表情的区分、市场表情的 `emoji_id` / `emoji_package_id` / `key`、图片的
 * `sub_type` / `summary`，在中立段里都没有位置（段只回答“怎么发出去”）。业务体
 * 要按它们选兜底地址、判断是否表情包，所以单列一份清单。
 * `subType` 统一成字符串：‘1’/‘0’ 在旧代码里已经当字符串比。
 */
export function oneBotMediaOf(message) {
  if (!Array.isArray(message)) return [];
  const media = [];
  for (const segment of message) {
    const type = String(segment?.type ?? '').trim().toLowerCase();
    const data = segment?.data && typeof segment.data === 'object' && !Array.isArray(segment.data) ? segment.data : {};
    if (type === 'image' || type === 'mface') {
      media.push({
        kind: type === 'image' ? 'image' : 'sticker',
        file: mediaText(data.file),
        url: mediaText(data.url, 2048),
        // image 段靠 sub_type 区分普通图与表情包；mface 本身就是表情（历史值与 image 的表情包一致）。
        subType: type === 'image' ? mediaText(data.sub_type ?? data.subType, 32) : '1',
        summary: data.summary,
        stickerId: mediaText(data.emoji_id ?? data.emojiId, 64),
        packageId: mediaText(data.emoji_package_id ?? data.emojiPackageId, 64),
        stickerKey: mediaText(data.key, 64),
      });
    } else if (type === 'face') {
      // QQ 内置小表情：没有文件也没有地址，只有表情编号。
      media.push({
        kind: 'face',
        faceId: mediaText(data.id, 64),
        url: mediaText(data.url, 2048),
        summary: data.summary,
      });
    }
  }
  return media;
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
 * （见 src/user-side/event.mjs）。原始报文留在 `ext.raw`，供排障与平台侧自查；
 * 内核的业务体只读这里的字段，不再回头认 OneBot 的键名。
 */
export function oneBotToUnified(raw) {
  const type = String(raw?.message_type ?? '').trim().toLowerCase() === 'private' ? 'private' : 'group';
  // 私聊的会话 id 就是对方；get_msg 一类回执可能只在 sender 上给 user_id。
  const conversationId = type === 'private' ? (raw?.user_id ?? raw?.sender?.user_id) : raw?.group_id;
  const senderId = String(raw?.sender?.user_id ?? raw?.user_id ?? '').trim();
  const selfId = idText(raw?.self_id);
  const seq = idText(raw?.message_seq);
  // 三个名字各有用处：name 是「该叫这个人什么」，card 与 nickname 进人物库。
  const card = String(raw?.sender?.card ?? '').trim();
  const nickname = String(raw?.sender?.nickname ?? '').trim();
  const role = String(raw?.sender?.role ?? '').trim().toLowerCase();
  return {
    kind: 'message',
    type: `message.${type}`,
    conversation: { type, id: String(conversationId ?? '') },
    ...(senderId
      ? { sender: { id: senderId, name: card || nickname, ...(card ? { card } : {}), ...(nickname ? { nickname } : {}), ...(role ? { role } : {}) } }
      : {}),
    // 没有 self_id 时不写：统一事件一旦给了空 id 会被当成畸形事件整条丢掉。
    ...(selfId ? { self: { id: selfId } } : {}),
    message: {
      id: String(raw?.message_id ?? ''),
      ...(seq ? { seq } : {}),
      segments: oneBotSegmentsToNeutral(raw?.message),
      media: oneBotMediaOf(raw?.message),
    },
    ...timeOf(raw),
    ext: { raw },
  };
}

/**
 * OneBot 通知报文 → 统一事件（未校验）；不进管线的通知返回 null。
 *
 * 只有六种通知进统一事件（见 src/user-side/event.mjs 的 NOTICE_TYPES），其余的
 * 直接不进：`notice_type` 是 OneBot 的开放词汇，让它流进内核等于把平台的命名
 * 习惯带进业务层。`notice_type` → 中立词的那张表只在这里，换平台时换这一份。
 *
 * 载荷形状（对照 SnowLuma 的 to-notice 转译层核实）：
 *   group_increase  { group_id, user_id, operator_id, sub_type: approve|invite, time, self_id }
 *   group_decrease  { group_id, user_id, operator_id, sub_type: leave|kick|kick_me|disband }
 *   group_card      { group_id, user_id, card_new, card_old }  ← 由「下一条消息的名片变化」
 *                                                               派生，不是 QQ 实时推送
 *   group_recall    { group_id, user_id, operator_id, message_id }
 *   notify/poke     { group_id?, user_id, sender_id, target_id, action?, suffix? }
 * ID 全部是 number，解析不出来的会变成 0（idText 一律当没有）。
 *
 * 自己发起的拍一拍在适配器判掉：那不是我**收到**的事，回灌会让 agent 回答自己。
 */
export function noticeToUnified(raw) {
  if (!raw || raw.post_type !== 'notice') return null;
  const selfId = idText(raw.self_id);
  const noticeType = String(raw.notice_type ?? '');

  if (noticeType === 'notify' && String(raw.sub_type ?? '') === 'poke') {
    const fromId = idText(raw.sender_id ?? raw.user_id ?? raw.sender?.user_id);
    if (!fromId || fromId === selfId) return null;
    const groupId = idText(raw.group_id);
    const targetId = idText(raw.target_id ?? raw.targetId);
    return {
      kind: 'notice',
      type: 'notice.poke',
      // 私聊里的对端就是拍的人：没有群就没有别的会话标识可用。
      conversation: groupId ? { type: 'group', id: groupId } : { type: 'private', id: fromId },
      actor: { id: fromId, name: String(raw.sender?.card || raw.sender?.nickname || '') },
      notice: {
        type: 'poke',
        ...(targetId ? { target: { id: targetId } } : {}),
        detail: {
          selfInvolved: !!targetId && targetId === selfId,
          // action / suffix 是 NapCat 的私有字段（“拍了拍我的胸口”这类自定义文案），
          // 适配器不解释它们，原样放进 detail 供消息流摘要使用。
          ...(raw.action ? { action: String(raw.action) } : {}),
          ...(raw.suffix ? { suffix: String(raw.suffix) } : {}),
        },
      },
      ...timeOf(raw),
      ext: { qq: raw },
    };
  }

  const groupId = idText(raw.group_id);
  const memberId = idText(raw.user_id);
  if (!groupId || !memberId) return null;
  const operatorId = idText(raw.operator_id);
  const base = {
    kind: 'notice',
    conversation: { type: 'group', id: groupId },
    // 当事人是 target，操作者是 actor；系统自动处理时没有操作者。
    ...(operatorId ? { actor: { id: operatorId, name: '' } } : {}),
    ...timeOf(raw),
    ext: { qq: raw },
  };
  const noticeOf = (type, extra = {}) => ({
    type,
    target: { id: memberId },
    detail: { subType: String(raw.sub_type ?? ''), selfInvolved: memberId === selfId, ...extra },
  });

  if (noticeType === 'group_increase') return { ...base, type: 'notice.member.join', notice: noticeOf('member.join') };
  if (noticeType === 'group_decrease') return { ...base, type: 'notice.member.leave', notice: noticeOf('member.leave') };
  if (noticeType === 'group_card') {
    return {
      ...base,
      type: 'notice.member.card',
      notice: noticeOf('member.card', { cardNew: String(raw.card_new ?? ''), cardOld: String(raw.card_old ?? '') }),
    };
  }
  if (noticeType === 'group_recall') {
    const messageId = idText(raw.message_id);
    return {
      ...base,
      type: 'notice.recall',
      notice: { ...noticeOf('recall'), ...(messageId ? { ref: { messageId } } : {}) },
    };
  }
  return null;
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
  const client = oneBotClient();
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

  // 通知类事件（拍一拍、撤回、入群/退群/改名片）与消息走同一条管线：适配器只翻译，
  // 校验、准入、会话映射、唤醒都在内核。SDK 的 onNotice(handler) 不带类型参数，
  // 换哪个 notice_type 都收得到，过滤在 noticeToUnified 里按闭集做。
  const acceptNotice = (raw) => {
    if (closed || !raw || typeof raw !== 'object') return;
    let unified;
    try {
      unified = noticeToUnified(raw);
    } catch (error) {
      status('error', error);
      return;
    }
    if (!unified) return;
    try {
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
  // 没有不带类型的 onNotice 就没有通知：这条能力缺失要写进入站详情，否则
  // 「戳一戳没反应」会变成一个没有任何线索的谜。
  const noticeSupported = typeof client.onNotice === 'function';
  if (noticeSupported) unsubscribe.push(client.onNotice((raw) => acceptNotice(raw)));

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
  const connected = typeof client.isConnected === 'boolean' ? `已连接=${client.isConnected}` : '';
  const noticeNote = noticeSupported ? '' : 'SDK 没有 onNotice(handler)：拍一拍与成员事件收不到';
  status('open', [connected, noticeNote].filter(Boolean).join('；') || null);
  return handle;
}
