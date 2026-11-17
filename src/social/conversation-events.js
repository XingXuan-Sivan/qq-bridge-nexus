// 成员事件（入群/退群/改名片/撤回）：把统一事件里的成员类通知规整成中性事件，
// 并生成给二代会话的「事件提示」。
//
// 入参是内核的**统一事件**（kind=notice），不是厂商报文：`notice_type` → 中立词的
// 那张表在平台适配器里（src/user-side/adapters/qq/inbound.mjs），这里只认三个中立位：
//   · notice.target.id  当事人（进群/退群/改名片的人，撤回消息的作者）
//   · actor.id          操作者（批准、踢人、撤回的人；系统自动处理时没有）
//   · notice.ref        撤回指向的消息
//
// SnowLuma 不重放离线期间的事件，断线期间的入群/退群会**丢失** —— 由
// reconcileConversation 的成员名单对账兜底（只记录，不唤醒）。
// 同一事件可能重复投递（部分推送 seq=0 时 SnowLuma 的去重会放行）—— 由 people.js 的指纹 +
// 逻辑去重处理。
//
// 对内一律叫 `conversationId` —— 那是社交模型的容器词汇，别的平台不应该被迫叫「群」。

import { normalizeConversationId, normalizeQQ, cleanDisplayName } from './people.js';
import { conversationRecordable } from './conversation-config.js';

/**
 * 统一事件（kind=notice）→ 成员事件；不是成员类通知返回 null。
 *
 * 规整后对内只用一个词：`conversationId` / `userId` / `operatorId` / `selfInvolved`。
 */
export function memberEventFromNotice(event) {
  if (!event || event.kind !== 'notice') return null;
  const type = String(event.notice?.type ?? '');
  const conversationId = normalizeConversationId(event.conversation?.id);
  const userId = normalizeQQ(event.notice?.target?.id);
  if (!conversationId || !userId) return null;
  const detail = event.notice?.detail ?? {};
  const base = {
    conversationId,
    userId,
    operatorId: normalizeQQ(event.actor?.id),
    subType: String(detail.subType ?? ''),
    // 统一事件的 time 是毫秒（与 Date.now() 同尺度）；people.js 的去重指纹按这个值算。
    time: Number.isFinite(Number(event.time)) ? Number(event.time) : null,
    selfInvolved: detail.selfInvolved === true,
  };
  if (type === 'member.join') return { kind: 'join', ...base };
  if (type === 'member.leave') return { kind: 'leave', ...base };
  if (type === 'member.card') return { kind: 'card', ...base, cardNew: String(detail.cardNew ?? ''), cardOld: String(detail.cardOld ?? '') };
  if (type === 'recall') return { kind: 'recall', ...base, messageId: event.notice?.ref?.messageId != null ? String(event.notice.ref.messageId) : null };
  return null;
}

const CATEGORY_TEXT = {
  stranger: '第一次见到的人',
  knownElsewhere: '在别处认识的人',
  returning: '以前在本会话、退群后又回来的人',
  alreadyMember: '记录里本来就在本会话的人',
};

/**
 * 处理一条已规整的成员事件。
 * @param {object} ev       memberEventFromNotice 的结果
 * @param {object} deps
 * @param {object} deps.people          people.js 实例
 * @param {object} deps.continuity      config.continuity
 * @param {(conversationId:string)=>boolean} deps.conversationAllowed   会话是否在白名单内
 * @param {(conversationId:string,userId:string)=>Promise<{card?:string,nickname?:string}|null>} [deps.fetchMember]
 * @param {(m:string)=>void} [deps.log]
 * @returns {Promise<{handled:boolean, wake:boolean, wakeReason?:string, streamText?:string, result?:object}>}
 */
export async function processMemberEvent(ev, { people, continuity = {}, conversationAllowed, fetchMember = null, log = () => {} }) {
  if (!ev) return { handled: false, wake: false };
  if (!conversationAllowed(ev.conversationId)) return { handled: false, wake: false };
  // 自己进群/被踢：不当成「有人入群」，只记一笔。`selfInvolved` 由适配器算（只有它
  // 知道本账号是哪个 id），内核不再拿一个 self_id 去做比较。
  if (ev.selfInvolved) {
    log(`会话 ${ev.conversationId} 的成员事件涉及机器人自身（${ev.kind}/${ev.subType}），只记录不唤醒`);
    return { handled: true, wake: false };
  }
  const recordable = conversationRecordable(continuity, ev.conversationId);
  const joinCfg = continuity.joinEvents ?? {};
  if (ev.kind === 'join') {
    let info = null;
    if (fetchMember) {
      try {
        info = await fetchMember(ev.conversationId, ev.userId);
        // 名片/昵称来自群友：清理换行与控制字符后才能进事件文本（防止伪造「系统」行）。
        if (info) info = { card: cleanDisplayName(info.card), nickname: cleanDisplayName(info.nickname) };
      } catch (error) { log(`查询新成员资料失败（${ev.conversationId}/${ev.userId}）：${error?.message ?? error}；按无名片处理`); }
    }
    const shownName = info?.card || info?.nickname || '';
    if (!recordable) {
      return { handled: true, wake: joinCfg.wake !== false, wakeReason: 'memberJoin', streamText: `[加入] ${ev.userId}${shownName ? `（${shownName}）` : ''} 加入了本会话` };
    }
    const r = people.observeJoin({ conversationId: ev.conversationId, userId: ev.userId, card: info?.card ?? '', nickname: info?.nickname ?? '', time: ev.time, subType: ev.subType, operatorId: ev.operatorId });
    if (!r || r.category === 'duplicate') return { handled: true, wake: false, result: r };
    const name = shownName;
    const how = ev.subType === 'invite' && ev.operatorId ? `（由 ${ev.operatorId} 邀请）` : '';
    const streamText = `[加入] ${name ? `${name}（${ev.userId}）` : `${ev.userId}`} 加入了本会话${how}：${CATEGORY_TEXT[r.category] ?? r.category}`;
    const wakeOn = Array.isArray(joinCfg.wakeOn) ? joinCfg.wakeOn : ['stranger', 'knownElsewhere', 'returning'];
    return { handled: true, wake: joinCfg.wake !== false && wakeOn.includes(r.category), wakeReason: `memberJoin:${r.category}`, streamText, result: r };
  }
  if (ev.kind === 'leave') {
    if (!recordable) return { handled: true, wake: false };
    const r = people.observeLeave({ conversationId: ev.conversationId, userId: ev.userId, time: ev.time, subType: ev.subType, operatorId: ev.operatorId });
    if (!r || r.category === 'duplicate') return { handled: true, wake: false, result: r };
    const how = ev.subType === 'kick' ? '被移出了本会话' : ev.subType === 'disband' ? '（会话已解散）' : '退出了本会话';
    const streamText = `[离开] ${r.card ? `${r.card}（${ev.userId}）` : `${ev.userId}`} ${how}`;
    // 退群默认只记录、不唤醒（不追问原因）；可配置 continuity.leaveEvents.wake=true。
    return { handled: true, wake: continuity.leaveEvents?.wake === true, wakeReason: 'memberLeave', streamText, result: r };
  }
  if (ev.kind === 'card') {
    if (!recordable) return { handled: true, wake: false };
    const r = people.observeCardChange({ conversationId: ev.conversationId, userId: ev.userId, cardNew: ev.cardNew, cardOld: ev.cardOld });
    if (!r) return { handled: true, wake: false };
    return { handled: true, wake: false, streamText: `[改名片] ${ev.userId}：${r.from || '（空）'} → ${r.to || '（空）'}`, result: r };
  }
  if (ev.kind === 'recall') {
    // 撤回：只记录，默认不回应、不复述（不把被撤回的内容写进任何地方）。
    return { handled: true, wake: false };
  }
  return { handled: false, wake: false };
}

/** 给唤醒提示词用的入群说明（只描述行为规则，具体人物资料由在场人物小节提供）。 */
export function joinWakeInstruction(category) {
  const common = '不需要每次都欢迎；看此刻在聊什么、你的人设和与对方的熟悉程度，自然决定要不要开口。不要复述别的会话里的聊天内容，〔跨会话〕记录也只在合适时轻轻带过。';
  if (category === 'knownElsewhere') return `一位你在别处认识的人加入了本会话。你可以认出 TA、用已知的称呼打个招呼，也可以先不点破；${common}`;
  if (category === 'returning') return `一位以前在本会话的人回来了。可以说句「回来啦」之类的，但不要追问 TA 为什么离开；${common}`;
  if (category === 'stranger') return `一位新朋友加入了本会话，你之前不认识 TA。可以像普通群友那样简单打个招呼或先观察；${common}`;
  return common;
}
