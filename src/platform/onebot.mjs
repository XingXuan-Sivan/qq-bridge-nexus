// OneBot v11 的发送动作与参数构造。
//
// 定位：**QQ 后端的实现细节，不属于内核**。内核只认 `{ kind, id, segments }`；
// 换平台（微信、B 站…）时由该平台自己的 transport 承担同样的职责，内核代码不改。
//
// 这里只是把原先散在 bridge.js 四处的同一个三元式收成一处：
//   const action = kind === 'private' ? 'send_private_msg' : 'send_group_msg';
//   const params = kind === 'private' ? { user_id: Number(id), ... } : { group_id: Number(id), ... };
// B5 之后，这些调用点会改为走 UserPlatform 的 send()，本文件成为 QQ 适配器的内部实现。

/** 会话类型 → 动作名与 id 字段。只列 OneBot 真正有的两种。 */
export const ONEBOT_CONVERSATIONS = Object.freeze({
  group: Object.freeze({ action: 'send_group_msg', field: 'group_id' }),
  private: Object.freeze({ action: 'send_private_msg', field: 'user_id' }),
});

/**
 * 构造 OneBot 发送调用。
 *
 * @param {string} kind 会话类型（group / private）
 * @param {string|number} id 群号或 QQ 号
 * @param {unknown[]} message OneBot 消息段数组
 * @returns {{action: string, params: object}}
 * @throws 未知会话类型、id 不可转为有限数时抛错 —— 不静默发到 NaN 的会话。
 */
export function oneBotSendCall(kind, id, message) {
  const spec = ONEBOT_CONVERSATIONS[String(kind ?? '')];
  if (!spec) throw new Error(`未知会话类型：${kind ?? '(空)'}`);
  // 单独拦空值：Number('') 与 Number(null) 都是 0，直接转会把消息发到 0 号会话。
  const raw = id === null || id === undefined ? '' : String(id).trim();
  const numeric = Number(raw);
  if (raw === '' || !Number.isFinite(numeric)) {
    throw new Error(`OneBot ${spec.action} 需要数字 id，收到：${id ?? '(空)'}`);
  }
  return { action: spec.action, params: { [spec.field]: numeric, message } };
}
