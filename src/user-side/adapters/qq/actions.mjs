// QQ 的动作实现：内核的 12 个中立动作在这里落到 OneBot / NapCat 的调用上。
//
// 这一层存在的理由和 onebot.mjs 一样：`group_poke`、`get_group_msg_history`、
// `fetch_custom_face_detail` 是 QQ 后端的词，换平台时它们不该跟着内核走。
// 内核只调 callAction(name, params)，本文件负责「这个名字对应哪个动作、参数怎么摆、
// 回执怎么判定成功」。回执的成功判据也在这里：`status === 'ok' && retcode === 0`
// 是 OneBot 的约定，内核不该知道。
//
// 声明的动作 = 本文件确实实现了的动作。没声明的由内核按 ACTIONS 表降级或抛
// capability_unsupported —— 声明了却做不到，比不声明更糟。

import { validateUnifiedEvent } from '../../event.mjs';
import { backendInspectionOf, oneBotClient, rememberBackendInspection } from './connection.mjs';
import { oneBotToUnified } from './inbound.mjs';
import { oneBotBackend } from './transport.mjs';
import {
  findFavByMd5,
  isNapCatVersionInfo,
  looksLikePathOnlyError,
  napcatAddOk,
  stickerTempBase,
  writeTempSticker,
} from './sticker-collect.js';

/** 本平台敢接的动作（顺序即控制台展示顺序）。 */
export const actions = Object.freeze([
  'message.send',
  'poke.send',
  'message.get',
  'history.get',
  'forward.get',
  'member.list',
  'member.get',
  'sticker.list',
  'sticker.save',
]);

function client() {
  const c = oneBotClient();
  if (!c) throw new Error('QQ 动作不可用：桥接还没有把 WS 客户端交给适配器（configureUserPlatformInbound）');
  return c;
}

// 本文件只服务 QQ 这一个平台：来源在这里写死（与 index.mjs 的 `id` 是同一个值）。
const PLATFORM = 'qq';

/**
 * 动作交回的消息也必须是完整统一事件。
 *
 * 入站那条路的校验在管线里（src/user-side/inbound.mjs）；动作的返回值不经过管线，
 * 所以在这里调用同一道校验器：正文由段拼出、媒体按闭集压平，与实时入站同形。
 * 校验器（src/user-side/event.mjs）是统一事件的唯一定义，这里只调用它，不另写一套。
 */
function adoptMessage(raw) {
  const checked = validateUnifiedEvent(oneBotToUnified(raw), { platform: PLATFORM });
  return checked.ok ? { event: checked.event, reason: '' } : { event: null, reason: checked.errors.join('；') };
}

/** OneBot 的 group_id / user_id 是数字；非数字 id 原样传（老网关偶有非数字账号）。 */
function oneBotId(value) {
  const raw = String(value ?? '').trim();
  const n = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(n) ? n : raw;
}

/** 防止底层网关把文本里的 `[CQ:` 当作 CQ 码解析：换一个全角冒号。 */
function escapeCqText(value) {
  return String(value ?? '').replace(/\[CQ:/gi, '[CQ：');
}

/** OneBot 回执是否成功。 */
function okOf(res) {
  return Boolean(res) && res.status === 'ok' && Number(res.retcode) === 0;
}

function failOf(res, action) {
  return new Error(`${action} 失败：${res?.wording || res?.message || res?.retcode || '无回执'}`);
}

/**
 * 后端身份探测（连接建立时调用一次）。
 *
 * 这是「日志里怎么称呼后端」与「收藏表情走哪条路」的共同前提：两者都要问
 * get_version_info，而问法只对 OneBot 成立。探测结果记在连接持有处（换连接即失效），
 * 桥接只拿到 { name, version } 用于显示。
 */
export async function probeBackend() {
  const c = oneBotClient();
  if (!c || typeof c.request !== 'function') return null;
  const res = await c.request('get_version_info', {});
  if (!okOf(res) || !res.data) return null;
  rememberBackendInspection({ napCat: isNapCatVersionInfo(res.data) });
  return { name: String(res.data.app_name ?? '').trim() || null, version: String(res.data.app_version ?? '').trim() || null };
}

/** 还没探过就补一次：收藏表情的两条路不能靠配置猜。 */
async function isNapCat() {
  if (!backendInspectionOf()) {
    try { await probeBackend(); } catch { /* 探测失败按非 NapCat 处理 */ }
  }
  return backendInspectionOf()?.napCat === true;
}

// ── 各动作的实现 ────────────────────────────────────────────────────────────

async function sendText({ conversation, text }) {
  const body = escapeCqText(text).trim();
  if (!body) throw new Error('要发送的文本为空');
  const target = oneBotId(conversation.id);
  const res = conversation.type === 'private'
    ? await client().sendPrivateMessage(target, body)
    : await client().sendGroupMessage(target, body);
  const id = res?.message_id ?? res?.messageId ?? null;
  return { messageId: id === null || id === undefined ? null : String(id), raw: res ?? null };
}

async function sendPoke({ conversation, targetId }) {
  if (conversation.type === 'group') {
    await client().raw('group_poke', { group_id: oneBotId(conversation.id), user_id: oneBotId(targetId) });
  } else {
    // 私聊拍一拍：send_poke 自动路由到当前私聊对象。
    await client().raw('send_poke', { user_id: oneBotId(conversation.id) });
  }
  return { targetId: targetId == null ? null : String(targetId) };
}

async function getHistory({ conversation, count }) {
  const max = Math.min(500, Math.max(1, Number(count) || 100));
  const action = conversation.type === 'private' ? 'get_friend_msg_history' : 'get_group_msg_history';
  const params = conversation.type === 'private'
    ? { user_id: oneBotId(conversation.id), count: max }
    : { group_id: oneBotId(conversation.id), count: max };
  const res = await client().request(action, params);
  if (!okOf(res)) throw failOf(res, action);
  const list = Array.isArray(res.data?.messages) ? res.data.messages : [];
  // 历史与实时入站走同一个翻译：调用方拿到的每一条都是统一事件，不必再认 OneBot 的键名。
  // 历史条目不一定回带会话 id：按这次请求的地址补齐，否则会话字段会是空的。
  const messages = [];
  let firstError = '';
  for (const item of list) {
    const { event, reason } = adoptMessage({
      ...item,
      message_type: conversation.type,
      user_id: item?.user_id ?? item?.sender?.user_id ?? (conversation.type === 'private' ? conversation.id : undefined),
      ...(conversation.type === 'group' ? { group_id: item?.group_id ?? conversation.id } : {}),
    });
    if (event) messages.push(event);
    else if (!firstError) firstError = reason;
  }
  // 一条坏记录只跳过它自己；整页都坏说明后端形状变了，说出来比静默返回空更有用。
  if (!messages.length && list.length) throw new Error(`历史消息里没有一条能构成统一事件：${firstError}`);
  return { messages };
}

async function getMessage({ messageId, timeoutMs }) {
  const id = String(messageId ?? '').trim();
  if (!id) throw new Error('message.get 需要 messageId');
  const opts = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? { timeoutMs: Number(timeoutMs) } : undefined;
  const res = await client().request('get_msg', { message_id: oneBotId(id) }, opts);
  if (!okOf(res)) throw failOf(res, 'get_msg');
  const data = res.data;
  if (!data || typeof data !== 'object') return { event: null };
  // get_msg 的回执不保证带 message_type：群消息以 group_id 判定，其余按私聊。
  // 私聊的会话 id 就是对方，回执里可能只出现在 sender.user_id 上。
  const type = String(data.message_type ?? '').trim().toLowerCase() || (data.group_id != null ? 'group' : 'private');
  const { event, reason } = adoptMessage({ ...data, message_type: type, user_id: data.user_id ?? data.sender?.user_id });
  if (!event) throw new Error(`get_msg 返回的消息不是合法的统一事件：${reason}`);
  return { event };
}

async function getForward({ id, timeoutMs }) {
  const res = await client().raw('get_forward_msg', { id: String(id ?? '') }, { timeoutMs });
  return { raw: res ?? null };
}

/** OneBot 成员对象 → 中立成员（id / 群名片 / 昵称）。 */
function memberOf(raw) {
  return {
    id: String(raw?.user_id ?? ''),
    card: String(raw?.card ?? ''),
    nickname: String(raw?.nickname ?? ''),
  };
}

async function listMembers({ conversation }) {
  const res = await client().getGroupMemberList(oneBotId(conversation.id), { noCache: true });
  const list = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
  return { members: list.map(memberOf).filter((m) => m.id) };
}

async function getMember({ conversation, userId }) {
  const c = client();
  if (typeof c.getGroupMemberInfo !== 'function') return { member: null };
  const res = await c.getGroupMemberInfo(oneBotId(conversation.id), oneBotId(userId), { noCache: true });
  const member = memberOf(res);
  // SnowLuma 找不到成员时返回 ok + 空字段（不是错误），空串按「没有这个名字」处理。
  return { member: member.id ? member : { id: String(userId ?? ''), card: '', nickname: '' } };
}

/** 收藏表情的原始条目 → 中立条目。字段名是 QQ 的，只在这一层出现。 */
function stickerOf(raw) {
  const id = String(raw?.emoji_id ?? raw?.resId ?? raw?.emoId ?? '').trim();
  if (!id) return null;
  return {
    id,
    resId: String(raw?.resId ?? raw?.emo_id ?? raw?.emoji_id ?? id).trim(),
    url: String(raw?.url ?? '').trim(),
    md5: String(raw?.md5 ?? '').trim(),
    desc: String(raw?.desc ?? '').trim(),
  };
}

async function listStickers({ count }) {
  const max = Math.min(500, Math.max(1, Number(count) || 100));
  const res = await client().request('fetch_custom_face_detail', { count: max });
  if (!okOf(res)) throw failOf(res, 'fetch_custom_face_detail');
  if (!Array.isArray(res.data)) throw new Error('fetch_custom_face_detail 返回 data 不是数组，已放弃同步');
  const entries = res.data.map(stickerOf).filter(Boolean);
  // complete：拿到的比要的少，说明这就是全部 —— 调用方据此决定能不能清理「已删除」的条目。
  return { entries, complete: res.data.length < max };
}

/**
 * 收藏一张表情，或改一张已有表情的备注。
 *
 * 传入 `stickerId` 时只改备注；传入 `bytes` 时收藏新表情（可选同时写备注）。
 * 两条路径在 NapCat 与 SnowLuma 上不同，差异全部收在 sticker-collect.js。
 */
async function saveSticker({ bytes, mimeType, remark, stickerId }) {
  const desc = String(remark ?? '').trim();
  const c = client();

  if (stickerId != null && stickerId !== '') {
    const id = String(stickerId);
    const res = await c.request('modify_custom_face', { emoji_id: id, desc });
    if (!okOf(res)) throw failOf(res, 'modify_custom_face');
    return { id, remark: desc };
  }

  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new Error('收藏表情需要图片字节');
  const res = await c.request('add_custom_face', { file: `base64://${bytes.toString('base64')}` });
  if (okOf(res)) {
    const id = String(res.data?.emoji_id ?? '');
    if (!id) throw new Error('add_custom_face 未返回 emoji_id');
    if (desc) {
      const modRes = await c.request('modify_custom_face', { emoji_id: id, desc });
      if (!okOf(modRes)) throw failOf(modRes, 'modify_custom_face');
    }
    return { id, remark: desc };
  }

  // 走到这里说明 base64 那条路不通。只有「把 base64:// 当成本地路径」这一类失败
  // 才换 NapCat 的路径重试；其它失败（禁言、额度、格式）原样抛，不要拿临时文件乱试。
  if (!looksLikePathOnlyError(res)) throw failOf(res, 'add_custom_face');
  if (!await isNapCat()) throw failOf(res, 'add_custom_face');

  const tmp = writeTempSticker(bytes, mimeType, stickerTempBase({ configured: oneBotBackend().stickerTempDir }));
  try {
    const addRes = await c.request('add_custom_face', {
      file: tmp.file,
      md5: tmp.md5,
      file_size: String(tmp.size),
      file_name: tmp.name,
      is_origin: true,
    });
    if (!napcatAddOk(addRes)) throw new Error(`add_custom_face 失败（NapCat）：${addRes?.wording || addRes?.data?.errMsg || addRes?.retcode || 'unknown'}`);
    // NapCat 的回执不含 emoji_id：按 MD5 在收藏列表里找回刚收藏的那张。
    const listRes = await c.request('fetch_custom_face_detail', { count: 100 });
    const fav = findFavByMd5(Array.isArray(listRes?.data) ? listRes.data : [], tmp.md5);
    if (!fav) throw new Error('已提交收藏，但在收藏列表里还没找到它（QQ 可能仍在处理）');
    const id = String(fav.resId || fav.emoId || '');
    if (desc) {
      const descRes = await c.request('set_custom_face_desc', { emoji_id: fav.emoId, res_id: fav.resId, md5: fav.md5, desc });
      if (!okOf(descRes)) throw failOf(descRes, 'set_custom_face_desc');
    }
    return { id, remark: desc };
  } finally {
    tmp.cleanup();
  }
}

/**
 * 动作分发。`params` 已由内核校验过会话形状，这里只管平台侧。
 *
 * @param {{name: string, params: object}} call
 */
export async function actionHandler({ name, params = {} } = {}) {
  switch (name) {
    case 'message.send': return sendText(params);
    case 'poke.send': return sendPoke(params);
    case 'message.get': return getMessage(params);
    case 'history.get': return getHistory(params);
    case 'forward.get': return getForward(params);
    case 'member.list': return listMembers(params);
    case 'member.get': return getMember(params);
    case 'sticker.list': return listStickers(params);
    case 'sticker.save': return saveSticker(params);
    default: throw new Error(`QQ 适配器没有实现动作 ${name}`);
  }
}
