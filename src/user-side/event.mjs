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

  let sender = null;
  if (raw.sender !== undefined && raw.sender !== null) {
    if (typeof raw.sender !== 'object' || Array.isArray(raw.sender)) {
      fail(errors, 'sender 必须是对象');
    } else {
      const senderId = raw.sender.id === null || raw.sender.id === undefined ? '' : String(raw.sender.id).trim();
      if (!ID_TEXT_RE.test(senderId)) fail(errors, `sender.id 不合法：${senderId || '(空)'}`);
      else sender = { id: senderId, name: text(raw.sender.name, 64) };
    }
  }

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
        // text 由内核从段里推导，插件写的不采用：两处不一致时，日志与记忆用的是段。
        message = {
          ...(ID_TEXT_RE.test(messageId) ? { id: messageId } : {}),
          segments,
          text: segmentsToText(segments),
        };
      }
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
      message,
      ext,
    },
  };
}
