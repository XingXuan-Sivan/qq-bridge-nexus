// QQ（OneBot v11）用户侧平台实现。
//
// 这是 `src/` 里**唯一**允许出现 QQ / OneBot 实现细节的目录（连同同目录的
// onebot.mjs 与 qq-backend-label.js）。内核不再 import 这里的任何文件，只经
// src/user-side/user-platform.mjs 这一道门面问：
//   · 这个会话该怎么构造发送调用 → buildSendCall
//   · 这条 get_version_info 回执背后是哪个后端 → readBackendInfo / describeBackend
//
// 为什么要把「构造发送调用」留在适配器里：OneBot v11 只有 send_group_msg /
// send_private_msg 两个动作，参数名（group_id / user_id）与 id 必须是数字都是
// 它的事实。将来接微信或 B 站时，这些事实一条都不成立，所以它们不能住内核。
//
// 本文件只做「拼装与命名」：动作与参数构造在 onebot.mjs，日志称呼在
// qq-backend-label.js，两者都是纯函数，可离线测（test-onebot-send-call /
// test-qq-backend-label）。
import { oneBotSendCall, ONEBOT_CONVERSATIONS } from './onebot.mjs';
import { qqBackendLabel, qqBackendFromVersionInfo } from './qq-backend-label.js';
import { sendOneBotAction, setOneBotBackend, resetOneBotBackend } from './transport.mjs';
import { toOneBotSegments } from './segments.mjs';

export { oneBotSendCall, ONEBOT_CONVERSATIONS, qqBackendLabel, qqBackendFromVersionInfo };
export { sendOneBotAction, setOneBotBackend, resetOneBotBackend, toOneBotSegments };

export const id = 'qq';
export const label = 'QQ';

/** 会话类型（内核的 type 是开放字符串，这里只声明本平台真正有的两种）。 */
export const conversationTypes = Object.freeze(Object.keys(ONEBOT_CONVERSATIONS));

/**
 * 声称的能力面。顺序即控制台展示顺序。
 *
 * 这份声明是**契约**而不是开关：B1 的降级策略按能力判定，不按平台名判定。
 * 声明了却发不出去，比不声明更糟——所以只列 OneBot v11 确实能做的。
 */
export const capabilities = Object.freeze([
  'group', 'direct', 'mention', 'reply', 'recall', 'poke',
  'image', 'voice', 'sticker', 'file', 'forward', 'member-list', 'member-info',
]);

/**
 * 分条与格式限制。
 *
 * chunkChars 与 `src/md-to-plain.js` 的 `splitForPlatform(text, max = 4000)` 默认值一致；
 * markdown=false 表示本平台不渲染 Markdown，正文必须先经 mdToPlain 降级。
 */
export const limits = Object.freeze({ chunkChars: 4000, markdown: false });

/** 中立的发送调用构造（内核侧的名字）。实现见 onebot.mjs。 */
export const buildSendCall = oneBotSendCall;

/**
 * 中立的发送实现：`send({ address, segments, opts })`。
 *
 * 内核的 sendAction 在没有插件 transport 时落到这里。实现见 transport.mjs——
 * OneBot 的动作名、参数名、HTTP 细节全部留在适配器目录内，内核只给中立段。
 */
export const send = sendOneBotAction;

/** 中立的「后端该怎么称呼」。实现见 qq-backend-label.js。 */
export const describeBackend = qqBackendLabel;

/** 中立的「回执背后是哪个后端」。实现见 qq-backend-label.js。 */
export const readBackendInfo = qqBackendFromVersionInfo;

/** 控制台与静态校验用的描述（B7 会把它变成 /api/platforms 的响应）。 */
export function describe() {
  return {
    id,
    label,
    conversationTypes: [...conversationTypes],
    capabilities: [...capabilities],
    limits: { ...limits },
  };
}
