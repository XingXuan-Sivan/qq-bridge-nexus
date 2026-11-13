// 统一出站：`sendAction(address, segments, opts)` 是内核唯一的发送出口。
//
// 一次调用把三件事收在一处（docs/PLATFORM_DECOUPLING.md §5.3）：
//   1. 段校验 → 按当前平台的 capabilities 降级（degradeSegments）；
//   2. 选实现：插件 transport 优先，其次内置平台适配器的 send；
//   3. 把**已经分好条、降完级的段**交给实现，实现看不到原始文本与配置。
//
// 为什么在第 1 步之后才交给实现：插件注册的 transport 也在第 2 步的候选里。
// 如果先交给它再降级，插件就能绕过能力声明发出平台发不了的东西 ——
// 那正是「插件不得扩大能力」要禁止的事。
//
// 与 user-platform.mjs 门面的关系：门面负责「取出/构造」，本文件负责「发出去」。
// bridge 只 import 门面，门面再转发到这里，于是内核里没有一行平台名。

import { activeUserPlatformId, requireUserPlatform } from './runtime-registry.mjs';
import { degradeSegments } from './segments.mjs';
import { getTransport } from './transport.mjs';

/** 对象与数组一律挡在门外：地址是主键的一部分，猜不得。 */
function normalizeAddress(address, fallbackPlatform) {
  if (!address || typeof address !== 'object' || Array.isArray(address)) {
    throw new Error(`sendAction 需要 { platform, account, conversation }：${JSON.stringify(address)}`);
  }
  const platform = String(address.platform ?? '').trim().toLowerCase() || fallbackPlatform;
  if (!platform) throw new Error('sendAction 无法确定平台：地址里没有 platform，也没有当前平台');
  const conversation = address.conversation ?? {};
  const type = String(conversation.type ?? '').trim().toLowerCase();
  const id = conversation.id === null || conversation.id === undefined ? '' : String(conversation.id).trim();
  if (!type) throw new Error(`sendAction: 会话类型为空（${platform}）`);
  if (!id) throw new Error(`sendAction: 会话 id 为空（${platform}:${type}）`);
  return {
    platform,
    account: String(address.account ?? '').trim().toLowerCase(),
    conversation: { type, id },
  };
}

/**
 * 发送一组中立段。
 *
 * @param {{platform?: string, account?: string, conversation: {type: string, id: string}}} address
 * @param {unknown[]} segments 中立段（也接受 OneBot 历史写法 at / record）
 * @param {{timeoutMs?: number, replyTo?: string, mention?: string[]}} [opts] 透传给实现
 * @returns {Promise<{messageId: string|null, raw: any, degraded: Array<{type: string, reason: string}>}>}
 */
export async function sendAction(address, segments, opts = {}) {
  const target = normalizeAddress(address, activeUserPlatformId());
  // 插件 transport 优先：它注册了这个 id 就说明它要接管这个平台的连接。
  const transport = getTransport(target.platform);
  const impl = transport ?? requireUserPlatform(target.platform);

  const degraded = degradeSegments(segments, impl.capabilities ?? []);
  const send = typeof transport?.send === 'function' ? transport.send : impl.send;
  if (typeof send !== 'function') {
    throw new Error(`用户平台 ${target.platform} 没有可用的发送实现（既没有 transport，适配器也没导出 send）`);
  }

  const result = await send({ address: target, segments: degraded.segments, opts: { ...opts } });
  return {
    messageId: result?.messageId ?? null,
    // raw 保留平台回执原样（OneBot 的 message_id、将来的 msgid…），
    // 内核既有代码按平台字段读回执的地方不用改。
    raw: result?.raw ?? result ?? null,
    degraded: degraded.degraded,
  };
}

/** 只做降级、不发送：控制台预览「这条消息在目标平台上会变成什么」用。 */
export function previewSegments(platformId, segments) {
  const id = String(platformId ?? '').trim().toLowerCase() || activeUserPlatformId();
  const impl = getTransport(id) ?? requireUserPlatform(id);
  return degradeSegments(segments, impl.capabilities ?? []);
}
