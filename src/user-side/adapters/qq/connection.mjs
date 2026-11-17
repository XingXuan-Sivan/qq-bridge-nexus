// QQ 的 WS 客户端持有处（入站订阅与出站动作共用同一个连接）。
//
// 客户端由桥接建好后注入进来，适配器不认识配置：连接的生命周期（重连、心跳、
// 健康度）归桥接，适配器只负责「拿到它、按 OneBot 的动作名调它」。
//
// 单独成文件而不是留在 inbound.mjs：入站（onNotice / onMessage）与动作
// （group_poke / get_group_msg_history …）都要同一条连接，谁持有它就只是
// 「谁先被 import」的偶然结果，不该由目录结构决定。

/** @type {() => object|null} */
let clientProvider = () => null;

// 同一条连接对应一个后端身份（SnowLuma / NapCat）：换连接就要重新问。
// 不重置的后果是重连到另一种网关后，收藏表情仍按旧网关的方式发。
/** @type {{napCat: boolean}|null} */
let backendInspection = null;

/** 注入 WS 客户端来源（bridge 启动时调一次）。 */
export function setOneBotClient(provider) {
  clientProvider = typeof provider === 'function' ? provider : () => null;
  backendInspection = null;
}

/** 测试用：恢复成「没有客户端」。 */
export function resetOneBotClient() {
  clientProvider = () => null;
  backendInspection = null;
}

/** 已探明的后端身份；还没探过时返回 null。 */
export function backendInspectionOf() {
  return backendInspection;
}

/** 记下这次探测的结论（由动作层在问完 get_version_info 后调用）。 */
export function rememberBackendInspection(value) {
  backendInspection = value ?? null;
}

/** 当前连接；没有时返回 null（调用方决定是抛错还是跳过）。 */
export function oneBotClient() {
  try {
    return clientProvider() ?? null;
  } catch {
    return null;
  }
}
