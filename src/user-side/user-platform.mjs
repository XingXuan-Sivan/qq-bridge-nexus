// 用户侧的中立门面：内核（bridge.js / bridge-extensions.js / mcp-* 等）只 import 这里。
//
// 为什么要有这一层：内核里那些「把一段话发给这个会话」「日志里怎么称呼后端」的调用
// 与平台无关，但它们的**实现**（OneBot 的 send_group_msg、NapCat 的程序名识别）
// 只对 QQ 成立。门面把「要什么」与「谁来做」分开，于是：
//   · bridge.js 不再出现 oneBotSendCall / OneBot 动作名；
//   · 新增平台只改 src/user-side/builtin.mjs 一行，本文件与 bridge 都不用动。
//
// 转发函数而不是 const 绑定：当前平台可以在运行期被 useUserPlatform() 切换
// （B6 的多平台在线），const 绑定会在切换后指向旧平台。一次 Map.get 可忽略。

import { configureBuiltinUserPlatformBackend } from './builtin.mjs';
import {
  buildSendCall as registryBuildSendCall,
  readBackendInfo as registryReadBackendInfo,
  describeBackend as registryDescribeBackend,
  supportsUserCapability as registrySupportsUserCapability,
  userPlatformLimits as registryUserPlatformLimits,
  activeUserPlatformId,
  listUserPlatforms,
} from './runtime-registry.mjs';
import { sendAction as registrySendAction, previewSegments as registryPreviewSegments } from './outbound.mjs';
import { getTransport, listTransports, registerTransport, unregisterTransportsByOwner } from './transport.mjs';
import { resolveSendTarget as registryResolveSendTarget } from './metadata.mjs';

export { activeUserPlatformId, listUserPlatforms, listTransports, getTransport };
// 控制台与 HTTP 发送端点的元数据（B7）：
export { userPlatformMetadata, userPlatformDescriptor } from './metadata.mjs';

/**
 * 插件平台注册表（内核透传给插件内核的 deps）。
 *
 * 收成一个对象而不是四个函数：插件内核只需要一个依赖，
 * 将来加「枚举/健康检查」也不用再改 bridge 的注入点。
 */
export const transportRegistry = Object.freeze({
  register: (definition, owner) => registerTransport(definition, owner),
  unregisterTransportsByOwner: (owner) => unregisterTransportsByOwner(owner),
  list: () => listTransports(),
  get: (id) => getTransport(id),
});

/** 插件注册的用户平台（transport:provide）与控制台列表。 */
export function pluginTransports() {
  return listTransports();
}

/**
 * 注入内置平台的后端配置来源（bridge 启动时调一次）。
 * 返回 { httpUrl, accessToken, fetch }，每次发送时重新取值（config 可热改）。
 */
export function configureUserPlatformBackend(provider) {
  configureBuiltinUserPlatformBackend(provider);
}

/**
 * 统一出站：校验 → 按能力降级 → transport / 适配器 send。
 * @param {{platform?: string, account?: string, conversation: {type: string, id: string}}} address
 * @param {unknown[]} segments 中立段
 * @param {{timeoutMs?: number}} [opts]
 */
export async function sendAction(address, segments, opts = {}) {
  return registrySendAction(address, segments, opts);
}

/** 只降级不发送（控制台预览用）。 */
export function previewSegments(platformId, segments) {
  return registryPreviewSegments(platformId, segments);
}

/**
 * 「平台 + 会话类型 + id」→ 规范地址与会话 key（HTTP 发送端点用）。
 * 校验规则见 metadata.mjs：未注册的平台、平台没声明的会话类型都在这里被挡住。
 */
export function resolveSendTarget(target) {
  return registryResolveSendTarget(target);
}

/** 当前用户平台 id（qq / …）。 */
export function userPlatformId() {
  return activeUserPlatformId();
}

/**
 * 会话类型 + id + 中立段 → 本平台的发送调用 `{ action, params }`。
 * @param {string} kind 会话类型（group / private / …，由平台自己解释）
 * @param {string|number} id 群号或用户号
 * @param {unknown[]} message 中立消息段数组
 */
export function buildSendCall(kind, id, message) {
  return registryBuildSendCall(kind, id, message);
}

/** get_version_info 回执 → { name, version }。 */
export function readBackendInfo(data) {
  return registryReadBackendInfo(data);
}

/** 日志 / 状态文字里的后端称呼。 */
export function describeBackend(opts) {
  return registryDescribeBackend(opts);
}

/** 能力查询（按平台声明判定，不按平台名）。 */
export function supportsUserCapability(capability) {
  return registrySupportsUserCapability(capability);
}

/** 分条与格式限制。 */
export function userPlatformLimits() {
  return registryUserPlatformLimits();
}
