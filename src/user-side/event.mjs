// 统一入站事件（docs/PLATFORM_DECOUPLING.md §3.3）。
//
// 插件 transport 负责「把厂商报文变成这个形状」，内核负责**校验并补全**：
//   · platform / account 只认内核给的值，插件写什么都覆盖掉 —— 否则一个插件可以
//     把自己的事件伪装成 qq 的，绕过按平台分流的准入与限流；
//   · kind / type / conversation 一律校验，形状不对的事件直接丢弃并审计，
//     不让半成品流进业务代码（半成品比没有更贵：它会让下游在几百行后才炸）。
//
// 这里不读配置、不碰网络、不发日志：纯函数 + 单调序号，单测可直接跑。

import { normalizeSegments, segmentsToText } from './segments.mjs';

/** 内核认识的入站事件大类。 */
export const EVENT_KINDS = Object.freeze(['message', 'notice', 'request', 'meta', 'agent']);

/**
 * 通知类事件的闭集（`notice.type` 的取值域）。
 *
 * 平台特有的通知只有两条出路：折进这里，或者不进统一事件（留在 `ext` 里由适配器
 * 自己处理）。留一个开放字符串等于让每个平台自己发明词汇，下游就得按平台名分支。
 */
export const NOTICE_TYPES = Object.freeze([
  'poke', 'recall', 'reaction', 'member.join', 'member.leave', 'member.card',
]);

/** 必须能回答「谁做的」的通知类型：没有当事人的通知（成员事件）只认 target。 */
const NOTICE_NEEDS_ACTOR = Object.freeze(['poke', 'reaction']);

// `message.group` / `message.private` / `agent.turn`：至少两段，限定字符集。
const TYPE_RE = /^[a-z][a-z0-9_-]{0,31}(\.[a-z0-9_-]{1,32}){1,2}$/;
const CONVERSATION_TYPE_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const ID_TEXT_RE = /^[^\s/\\]{1,128}$/;
const NAME_MAX = 200;

let sequence = 0;

/** 测试用：把序号归零。 */
export function resetEventSequence() {
  sequence = 0;
}

function nextEventId() {
  sequence += 1;
  return `evt_${sequence}`;
}

function text(value, max = NAME_MAX) {
  const raw = value === null || value === undefined ? '' : String(value).trim();
  return raw.slice(0, max);
}

function fail(errors, message) {
  errors.push(message);
  return null;
}

/** 群里的成员角色（闭集）。平台特有的角色名由适配器折进这三个词。 */
export const SENDER_ROLES = Object.freeze(['owner', 'admin', 'member']);

/**
 * 消息发送者：`{ id, name }` 之外再带群名片、昵称与角色。
 *
 * `name` 是适配器挑好的「该叫这个人什么」；`card` / `nickname` 各自保留，因为
 * 人物库要分别记两项（群名片会改，昵称不会），而下游既有逻辑用的是两者之一。
 */
function senderOf(value, errors) {
  const base = personOf(value, 'sender', errors);
  if (!base) return null;
  const card = text(value.card, 64);
  const nickname = text(value.nickname, 64);
  const role = text(value.role, 16).toLowerCase();
  return {
    ...base,
    ...(card ? { card } : {}),
    ...(nickname ? { nickname } : {}),
    ...(SENDER_ROLES.includes(role) ? { role } : {}),
  };
}

/**
 * 入站媒体清单的 kind 闭集：业务体只认这三种（收藏表情与市场表情都算 sticker）。
 */
export const MEDIA_KINDS = Object.freeze(['image', 'sticker', 'face']);

/** 媒体摘要：去控制字符后截断。业务侧不再各自清洗一遍。 */
function summaryText(value) {
  const s = String(value ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();
  return s ? s.slice(0, 60) : '';
}

const MEDIA_TEXT_FIELDS = Object.freeze([
  ['file', 1024], ['url', 2048], ['stickerId', 64], ['packageId', 64], ['stickerKey', 64], ['subType', 32],
]);

/**
 * 校验入站媒体清单。
 *
 * 为什么单列一份而不是从段里推：平台段的私有字段（市场表情的 `emoji_id`、图片的
 * `sub_type`、内置表情的 `id`）在中立段里没有位置 —— 段回答的是「怎么发出去」，
 * 而媒体清单回答的是「收到的是什么」。少了它，业务体只能回头去读平台报文。
 *
 * 单项不认识只跳过这一项，不把整条消息判成畸形：入站是事实记录，一条消息里有
 * 一张图的名字看不懂，不该让这句话消失（与「陌生段降成占位文本」同一条理由）。
 * 只有 `media` 整体不是数组时才记错 —— 那是适配器写错了形状，不是不认识的值。
 */
function mediaOf(value, errors) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    fail(errors, 'message.media 必须是数组');
    return [];
  }
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const kind = text(item.kind, 16).toLowerCase();
    if (!MEDIA_KINDS.includes(kind)) continue;
    const entry = { kind };
    for (const [key, max] of MEDIA_TEXT_FIELDS) {
      const v = text(item[key], max);
      if (v) entry[key] = v;
    }
    if (kind === 'face') {
      const faceId = text(item.faceId, 64);
      if (faceId) entry.faceId = faceId;
    }
    const summary = summaryText(item.summary);
    if (summary) entry.summary = summary;
    out.push(entry);
  }
  return out;
}

/** `{ id, name }` 形状的人（sender / actor）：id 必填，name 截断。 */
function personOf(value, label, errors) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    fail(errors, `${label} 必须是对象`);
    return null;
  }
  const id = value.id === null || value.id === undefined ? '' : String(value.id).trim();
  if (!ID_TEXT_RE.test(id)) {
    fail(errors, `${label}.id 不合法：${id || '(空)'}`);
    return null;
  }
  return { id, name: text(value.name, 64) };
}

/** 可选的单值 id（`notice.target.id` / `notice.ref.messageId` / `message.seq`）。 */
function optionalId(value, label, errors) {
  if (value === undefined || value === null) return null;
  const id = String(value).trim();
  if (!ID_TEXT_RE.test(id)) {
    fail(errors, `${label} 不合法：${id || '(空)'}`);
    return null;
  }
  return id;
}

/**
 * 校验并补全一条统一事件。
 *
 * @param {unknown} raw 插件 transport 产出的事件
 * @param {{platform: string, account?: string}} origin 内核认定的来源（必填）
 * @returns {{ok: boolean, errors: string[], event: object|null}}
 */
export function validateUnifiedEvent(raw, origin = {}) {
  const errors = [];
  const platform = text(origin.platform, 64).toLowerCase();
  const account = text(origin.account, 64).toLowerCase();
  // 来源必须由内核给：插件自己声明 platform 等于「谁都能声称自己是 qq」。
  if (!platform) {
    return { ok: false, errors: ['内核未提供 platform，拒绝接收事件'], event: null };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['事件必须是对象'], event: null };
  }

  const kind = text(raw.kind, 16).toLowerCase();
  if (!EVENT_KINDS.includes(kind)) {
    fail(errors, `未知事件类型：${kind || '(空)'}`);
  }

  const type = text(raw.type, 64).toLowerCase();
  if (!type) fail(errors, 'type 不能为空');
  else if (!TYPE_RE.test(type)) fail(errors, `type 格式不合法：${type}`);
  else if (kind && !type.startsWith(`${kind}.`)) fail(errors, `type 必须以 ${kind}. 开头：${type}`);

  const conversationRaw = raw.conversation;
  let conversation = null;
  if (!conversationRaw || typeof conversationRaw !== 'object' || Array.isArray(conversationRaw)) {
    fail(errors, 'conversation 必须是 { type, id }');
  } else {
    const convType = text(conversationRaw.type, 32).toLowerCase();
    const convId = conversationRaw.id === null || conversationRaw.id === undefined ? '' : String(conversationRaw.id).trim();
    if (!CONVERSATION_TYPE_RE.test(convType)) fail(errors, `conversation.type 不合法：${convType || '(空)'}`);
    else if (!ID_TEXT_RE.test(convId)) fail(errors, `conversation.id 不合法：${convId || '(空)'}`);
    else conversation = { type: convType, id: convId };
  }

  // sender 是消息的发送者；actor 是通知的当事人/操作者。同一件事在两个 kind 里
  // 各有自己的名字，读代码时不必猜「这条事件的 sender 到底是谁」。
  // sender / self 是「谁在说话」与「我是谁」：前者要群名片与角色，后者只要 id。
  // self 没有它时内核回答不了「这条是不是在对我说话」（@ 与引用自己都要比它）。
  const sender = senderOf(raw.sender, errors);
  const self = personOf(raw.self, 'self', errors);
  const actor = personOf(raw.actor, 'actor', errors);

  let message = null;
  if (kind === 'message') {
    const messageRaw = raw.message;
    if (!messageRaw || typeof messageRaw !== 'object' || Array.isArray(messageRaw)) {
      fail(errors, '消息事件必须带 message');
    } else {
      let segments;
      try {
        segments = normalizeSegments(messageRaw.segments ?? []);
      } catch (error) {
        fail(errors, `message.segments 不合法：${error?.message ?? error}`);
      }
      if (segments) {
        const messageId = messageRaw.id === null || messageRaw.id === undefined ? '' : String(messageRaw.id).trim();
        const seq = optionalId(messageRaw.seq, 'message.seq', errors);
        // text 由内核从段里推导，插件写的不采用：两处不一致时，日志与记忆用的是段。
        message = {
          ...(ID_TEXT_RE.test(messageId) ? { id: messageId } : {}),
          ...(seq ? { seq } : {}),
          segments,
          text: segmentsToText(segments),
          media: mediaOf(messageRaw.media, errors),
        };
      }
    }
  }

  let notice = null;
  if (kind === 'notice') {
    const noticeRaw = raw.notice;
    if (!noticeRaw || typeof noticeRaw !== 'object' || Array.isArray(noticeRaw)) {
      fail(errors, '通知事件必须带 notice');
    } else {
      const noticeType = text(noticeRaw.type, 32).toLowerCase();
      if (!NOTICE_TYPES.includes(noticeType)) {
        fail(errors, `未知通知类型：${noticeType || '(空)'}`);
      } else if (type && type !== `notice.${noticeType}`) {
        // type 与 notice.type 是同一件事的两种写法，对不上说明适配器自己没想清楚。
        fail(errors, `type 必须等于 notice.${noticeType}：${type}`);
      } else {
        const targetId = optionalId(noticeRaw.target?.id, 'notice.target.id', errors);
        const refMessageId = optionalId(noticeRaw.ref?.messageId, 'notice.ref.messageId', errors);
        notice = {
          type: noticeType,
          ...(targetId ? { target: { id: targetId } } : {}),
          ...(refMessageId ? { ref: { messageId: refMessageId } } : {}),
          // detail 是归一后的细节包（子类型、操作者附加信息）。内核不解释里面
          // 的具体键，只保证它是对象 —— 解释权在各自的业务动作里。
          detail: noticeRaw.detail && typeof noticeRaw.detail === 'object' && !Array.isArray(noticeRaw.detail)
            ? { ...noticeRaw.detail }
            : {},
        };
      }
    }
    if ((raw.actor === undefined || raw.actor === null) && NOTICE_NEEDS_ACTOR.includes(notice?.type ?? text(raw.notice?.type, 32).toLowerCase())) {
      fail(errors, `${notice?.type ?? '该通知'} 必须带 actor（谁做的）`);
    }
  }

  const ext = raw.ext && typeof raw.ext === 'object' && !Array.isArray(raw.ext) ? raw.ext : {};

  if (errors.length) return { ok: false, errors, event: null };

  return {
    ok: true,
    errors: [],
    event: {
      v: 1,
      id: text(raw.id, 64) || nextEventId(),
      time: Number.isFinite(Number(raw.time)) && Number(raw.time) > 0 ? Number(raw.time) : Date.now(),
      // 来源一律取内核的判定：插件写的 platform/account 到这里已被丢弃。
      platform,
      account,
      kind,
      type,
      conversation,
      sender,
      self,
      actor,
      message,
      notice,
      ext,
    },
  };
}
