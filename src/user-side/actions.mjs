// 用户侧动作词表：内核能向平台要的 13 件事（docs/CAPABILITY_CONTRACT.md §3.2）。
//
// 「这条消息怎么发」由 outbound.mjs 管（段校验、按能力降级、交给平台的 send）；
// 本文件管的是另一件事：**让平台执行一次操作** —— 拍一拍、撤回、拉历史、存表情。
// 后者在 OneBot 里是 `group_poke` / `delete_msg` 这类动作名，换平台全都不一样，
// 所以内核只认这里的名字，具体动作名留在 adapters/<id>/actions.mjs。
//
// 平台适配器用 `actions` 声明自己敢接哪些（没声明 = 做不到），用
// `actionHandler({ name, params })` 实现。内核的调用口径：
//   · 声明了 → 直接交给它；
//   · 没声明 → 按本表降级（例如没有原生表情反应就发一条消息），降不了就抛
//     capability_unsupported，不静默吞掉。
//
// 为什么不是「有就有、没有就算了」：能力缺失如果在调用点各自 if 一下，同一个缺失
// 会在十个地方有十种处理方式，而用户看到的是「有时有效有时没反应」。

import { activeUserPlatformId, requireUserPlatform } from './runtime-registry.mjs';
import { getTransport } from './transport.mjs';

/**
 * 13 个动作：risk 用于权限判定，fallback 是「做不到时怎么办」，
 * scope 说明它作用在会话上还是账号上。
 *
 * `fallback: null` 表示这是该平台的基本盘，缺了就是配置错（message.send）；
 * 其余要么降成另一个动作（同名参数形状），要么抛错。
 * `scope: 'conversation'` 的动作必须带 params.conversation —— 地址猜错就会把命令
 * 发到别处；`'global'` 的按平台对象寻址（转发 id、账号收藏夹），不带会话。
 */
export const ACTIONS = Object.freeze({
  'message.send': { risk: 'send', fallback: null, scope: 'conversation' },
  'message.reply': { risk: 'send', fallback: 'message.send', scope: 'conversation' },
  'message.recall': { risk: 'send', fallback: 'throw', scope: 'conversation' },
  'message.forward': { risk: 'send', fallback: 'throw', scope: 'conversation' },
  'reaction.add': { risk: 'send', fallback: 'message.send', scope: 'conversation' },
  'poke.send': { risk: 'send', fallback: 'throw', scope: 'conversation' },
  'message.get': { risk: 'read', fallback: 'throw', scope: 'global' },
  'history.get': { risk: 'read', fallback: 'throw', scope: 'conversation' },
  'forward.get': { risk: 'read', fallback: 'throw', scope: 'global' },
  'member.list': { risk: 'read', fallback: 'throw', scope: 'conversation' },
  'member.get': { risk: 'read', fallback: 'throw', scope: 'conversation' },
  'sticker.list': { risk: 'read', fallback: 'throw', scope: 'global' },
  'sticker.save': { risk: 'state', fallback: 'throw', scope: 'global' },
});

export const ACTION_NAMES = Object.freeze(Object.keys(ACTIONS));

/** 平台缺这个动作时的错误：带上动作名与平台 id，排障时不必猜是哪一侧没配。 */
export class ActionUnsupportedError extends Error {
  constructor(action, platform) {
    super(`用户平台 ${platform} 没有动作 ${action}`);
    this.name = 'ActionUnsupportedError';
    this.code = 'capability_unsupported';
    this.action = action;
    this.platform = platform;
  }
}

/** 动作的声明；未登记的动作名直接抛（写错名字不该静默降级）。 */
export function actionSpec(name) {
  const key = String(name ?? '').trim();
  const spec = ACTIONS[key];
  if (!spec) throw new Error(`未知的用户侧动作：${key || '(空)'}；可用：${ACTION_NAMES.join(', ')}`);
  return spec;
}

/**
 * 会话形状校验：`scope: 'conversation'` 的动作必须给出完整地址。
 * 校验放在内核是因为它是「别发错人」这条底线，不属于任何平台；
 * 但地址**怎么用**（数字还是字符串、拼成哪个参数）仍由平台解释。
 */
function conversationOf(params, name, spec) {
  const conv = params?.conversation;
  if (conv === undefined || conv === null) {
    if (spec.scope === 'conversation') throw new Error(`${name} 需要 params.conversation`);
    return null;
  }
  if (typeof conv !== 'object' || Array.isArray(conv)) throw new Error(`${name} 的 params.conversation 不是对象`);
  const type = String(conv.type ?? '').trim().toLowerCase();
  const id = conv.id === null || conv.id === undefined ? '' : String(conv.id).trim();
  if (!type || !id) throw new Error(`${name} 的会话不完整：${type || '(空)'}:${id || '(空)'}`);
  return { type, id };
}

function platformOf(ctx) {
  const id = String(ctx?.platform ?? '').trim().toLowerCase() || activeUserPlatformId();
  if (!id) throw new Error('callAction 无法确定平台：既没有传入 platform，也没有当前平台');
  return id;
}

function declaredActions(impl) {
  return Array.isArray(impl?.actions) ? impl.actions : [];
}

/**
 * 当前平台是否声明了某个动作。
 * 缺省视为不支持（与 supportsUserCapability 同一口径：不猜）。
 */
export function supportsAction(name, ctx = {}) {
  const impl = getTransport(platformOf(ctx)) ?? requireUserPlatform(platformOf(ctx));
  return typeof impl.actionHandler === 'function' && declaredActions(impl).includes(String(name ?? '').trim());
}

/**
 * 让当前平台执行一个动作。
 *
 * @param {string} name     ACTIONS 里的名字
 * @param {object} params   `{ conversation, ... }`，其余键由动作自己解释
 * @param {{platform?: string}} [ctx]
 */
export async function callAction(name, params = {}, ctx = {}) {
  const spec = actionSpec(name);
  const platform = platformOf(ctx);
  // 与出站同一条选取顺序：插件接管了这个平台，就连动作一起接管。
  const impl = getTransport(platform) ?? requireUserPlatform(platform);
  if (typeof impl.actionHandler === 'function' && declaredActions(impl).includes(name)) {
    const conversation = conversationOf(params, name, spec);
    return impl.actionHandler({ name, params: conversation ? { ...params, conversation } : { ...params } });
  }
  if (spec.fallback === 'throw' || !spec.fallback) throw new ActionUnsupportedError(name, platform);
  // 降级：参数形状与目标动作一致（reply / reaction 的入参就是一条消息的入参），
  // 所以只要换个名字重走一遍，不必在这里再拼参数。
  return callAction(spec.fallback, params, { ...ctx, platform });
}
