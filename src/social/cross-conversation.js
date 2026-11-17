// 跨会话能力（默认关闭，开关 socialV2.tools.crossGroup / 工具 admin（op=cross_group_query））：
//   在一个会话里，经**显式授权**查询另一个会话的成员关系与活跃度。
//
// 原则：
//   · 默认关闭（crossGroup.enabled=false），且链接是**有向**的：A→B 授权不代表 B→A。
//   · 只有显式列出的能力可用，能力只返回统计/成员关系，**永远不返回聊天内容、发言者名字或记忆**。
//     - presence：某个用户是否是目标会话成员（只对人物库里认识的人回答；目标会话 recordable=false 时拒绝）
//     - activity：目标会话最近 1 小时 / 24 小时的消息条数、活跃人数、最后一条消息距今多久
//   · 两端都必须在白名单 allow.groups 内；一对一会话不能发起跨会话查询（owner 用管理通道）。
//   · 跨会话**发送**不在这里：二代会话令牌只对自己所在会话有效（/api/send/* 用目标 key 校验令牌），
//     AI 天然无法往别的会话发消息；owner 代发走管理通道的 /say 命令。
//   · 每次查询都写审计日志（调用方负责）。
//
// 有意保留的旧词：配置键 `crossGroup` 与工具名 `admin（op=cross_group_query）` 是 0.1.x 的公开面，
// 白名单 `allow.groups` 里存的是平台上的会话地址（QQ 群号）。改名会让老配置静默失效。

import { isGroupKey, parseKey } from '../session/key.mjs';
import { conversationRecordable } from './conversation-config.js';

export const CROSS_CONVERSATION_CAPABILITIES = ['presence', 'activity'];

function str(v) { return String(v ?? '').trim(); }

/**
 * 判断 fromKey 所在会话能否对 toConversationId 使用 capability。
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
export function checkCrossConversation(cfg, fromKey, toConversationId, capability) {
  const cg = cfg?.crossGroup ?? {};
  if (cg.enabled !== true) return { ok: false, reason: '跨会话协作未启用（crossGroup.enabled=false）' };
  if (!CROSS_CONVERSATION_CAPABILITIES.includes(capability)) return { ok: false, reason: `未知能力：${capability}` };
  const m = parseKey(str(fromKey));
  // 判的是「会话形状」而不是类型字面量：类型叫 channel / thread 也一样是多方会话。
  // 反过来说，这里必须拒掉一对一会话 —— 私聊里问「隔壁会话有谁」本身就是越界。
  if (!m || !isGroupKey(fromKey)) return { ok: false, reason: '只有多方会话可以发起跨会话查询' };
  const from = String(m.id);
  const to = str(toConversationId);
  if (!/^\d+$/.test(to)) return { ok: false, reason: '目标会话 id 无效' };
  if (from === to) return { ok: false, reason: '目标会话就是当前会话' };
  const conversations = (cfg?.allow?.groups ?? []).map(String);
  if (!conversations.includes(from) || !conversations.includes(to)) return { ok: false, reason: '两端会话都必须在白名单 allow.groups 内' };
  if (!conversationRecordable(cfg?.continuity, to)) return { ok: false, reason: '目标会话不允许被记录/查询' };
  const links = Array.isArray(cg.links) ? cg.links : [];
  const link = links.find((l) => str(l?.from) === from && str(l?.to) === to);
  if (!link) return { ok: false, reason: `没有从会话 ${from} 到会话 ${to} 的授权链接` };
  const allow = Array.isArray(link.allow) ? link.allow.map(String) : [];
  if (!allow.includes(capability)) return { ok: false, reason: `链接未授权能力 ${capability}` };
  return { ok: true };
}

/** presence：只回答「是否成员」，不回答名片/记忆。人物库不认识的人一律 unknown。 */
export function queryPresence(people, toConversationId, userId) {
  const p = people.getPerson(userId);
  if (!p) return { known: false, member: 'unknown' };
  const entry = p.conversations?.[str(toConversationId)];
  if (!entry) return { known: true, member: 'unknown' };
  return { known: true, member: entry.status === 'member' ? 'yes' : 'no' };
}

/** activity：统计目标会话的二代消息流，不返回任何文本或名字。 */
export function queryActivity(targetState, now = Date.now()) {
  const msgs = Array.isArray(targetState?.recentMessages) ? targetState.recentMessages.filter((m) => m && !m.isSelf) : [];
  const hour = msgs.filter((m) => now - (Number(m.time) || 0) < 3600_000);
  const day = msgs.filter((m) => now - (Number(m.time) || 0) < 86_400_000);
  const last = msgs.reduce((t, m) => Math.max(t, Number(m.time) || 0), 0);
  return {
    messagesLastHour: hour.length,
    messagesLast24h: day.length,
    activeSpeakersLastHour: new Set(hour.map((m) => m.userId || m.sender)).size,
    minutesSinceLastMessage: last ? Math.round((now - last) / 60000) : null,
    note: '统计仅基于桥接最近缓存的消息（最多 recentLimit 条），不是完整历史',
  };
}
