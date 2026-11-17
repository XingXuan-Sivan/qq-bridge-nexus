// 出站传输注册表（插件 transport:provide 的落点）。
//
// 一个 transport 就是一份「能发送的最小实现」：`send({ address, segments, opts })`。
// 它替换的是**网络与协议**，替换不了策略：段校验、能力降级、准入都在内核里做，
// transport 拿到的已经是分好条、降完级的段（docs/PLATFORM_DECOUPLING.md §5.3）。
//
// 与 src/user-side/runtime-registry.mjs 的分工：
//   · runtime-registry 住**内置**平台（src/user-side/adapters/ 下，随仓库发布）；
//   · 本文件住**插件**平台（运行期注册，随插件卸载消失）。
// 出站时插件 transport 优先：它注册了同 id 说明它就是要接管这个平台的连接，
// 但注册那一刻 id 与内置平台冲突会被拒绝（见 registerTransport），所以两者不会打架。
//
// 为什么不复用 runtime-registry：那张表在 import 时就被 builtin.mjs 填满，
// 且没有 owner 概念，卸载插件时无法批量清干净。

import { userPlatform } from './runtime-registry.mjs';

const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

/** @type {Map<string, {id: string, owner: string, label: string, conversationTypes: string[], capabilities: string[], actions: string[], limits: object, send: Function, connect: Function|null, actionHandler: Function|null, instance: object|null}>} */
const transports = new Map();

/**
 * 注册插件 transport。
 *
 * @param {object} definition
 * @param {string} definition.id           平台 id（会成为会话 key 里的平台段）
 * @param {string[]} [definition.capabilities]
 * @param {string[]} [definition.actions]     敢接的动作用名（见 src/user-side/actions.mjs）；
 *        不声明等于这个平台做不到那些事，内核按表格降级或报 capability_unsupported
 * @param {Function} [definition.actionHandler] async ({ name, params }) => 回执
 * @param {string[]} [definition.conversationTypes] 本平台真正有的会话类型（控制台据此限制
 *        表单选项；不声明时控制台不限制，但发送能不能成仍由实现决定）
 * @param {object} [definition.limits]    分条与格式限制（chunkChars / markdown …）
 * @param {object} [definition.instance]   create(config) 的产物；`close()` 由内核在卸载时调用
 * @param {Function} [definition.send]     async ({ address, segments, opts }) => { messageId }
 *                                         —— 不给时取 instance.send（docs §5.2 的写法）
 * @param {Function} [definition.connect]  async ({ signal, onEvent, onStatus }) => ({ close })
 *                                         —— 入站（C3）：拿到厂商报文后翻译成统一事件再 onEvent(evt)；
 *                                         不给则这个平台只能发不能收（统一注册表报 `inbound_unsupported`）
 * @param {string} owner                   pluginId
 */
export function registerTransport(definition, owner) {
  const id = String(definition?.id ?? '').trim().toLowerCase();
  if (!ID_RE.test(id)) throw new Error(`transport id 不合法：${id || '(空)'}`);
  const existing = transports.get(id);
  const ownerName = String(owner ?? '').trim() || 'plugin';
  // 同 owner 允许覆盖（插件热重载时旧实例还没拆干净），换 owner 一律拒绝：
  // 两个插件抢同一个平台 id，发出去的消息归谁无法解释。
  if (existing && existing.owner !== ownerName) {
    throw new Error(`平台 id 已被占用：${id}（${existing.owner}）；插件不得顶替别人的平台`);
  }
  // send 可以写在定义上，也可以只写在 create(config) 的产物上（后者才是「一个连接」的形态）。
  // 取实例那个要 bind：实例方法里的 this 往往持有 socket/连接句柄。
  const instance = definition?.instance ?? null;
  const send = typeof definition?.send === 'function'
    ? definition.send
    : (typeof instance?.send === 'function' ? instance.send.bind(instance) : null);
  if (!send) {
    throw new Error(`transport ${id} 必须提供 send({ address, segments, opts })（定义上或 create() 的产物上）`);
  }
  // 入站（C3）：同样可以写在定义上或实例上。**可选** —— 只实现发送的平台合法，
  // 但它会在统一注册表里被标成「只出不进」（`inbound_unsupported`），不会静默假装能收。
  const connect = typeof definition?.connect === 'function'
    ? definition.connect
    : (typeof instance?.connect === 'function' ? instance.connect.bind(instance) : null);
  // 内置平台 id（qq / …）不许被插件顶替：那条链路连着真实账号与准入，
  // 让插件接管等于把「谁在发」这件事交给运行期代码（§5.3 第 3 条）。
  if (userPlatform(id)) {
    throw new Error(`平台 id 与内置平台冲突：${id}；插件只能新增平台，不能顶替内置平台`);
  }
  const capabilities = Array.isArray(definition?.capabilities)
    ? [...new Set(definition.capabilities.map((item) => String(item ?? '').trim().toLowerCase()).filter(Boolean))]
    : (Array.isArray(instance?.capabilities) ? [...new Set(instance.capabilities.map((item) => String(item ?? '').trim().toLowerCase()).filter(Boolean))] : []);
  // 动作与回执：插件平台也可以接管内核的动作（例如用自己的协议实现拍一拍）。
  // 只声明、不实现等于撒谎，所以两者必须成对出现；不声明就是「做不到」。
  const actionHandler = typeof definition?.actionHandler === 'function'
    ? definition.actionHandler
    : (typeof instance?.actionHandler === 'function' ? instance.actionHandler.bind(instance) : null);
  const rawActions = Array.isArray(definition?.actions)
    ? definition.actions
    : (Array.isArray(instance?.actions) ? instance.actions : []);
  const actions = actionHandler
    ? [...new Set(rawActions.map((item) => String(item ?? '').trim()).filter(Boolean))]
    : [];
  // 会话类型与限制同理：定义上没写就看 create() 的产物。这两项只影响控制台的表单与
  // 提示，不参与发送判定，所以缺省是空而不是报错（插件不必为了能被列出而声明它们）。
  const conversationTypes = [...new Set(
    (Array.isArray(definition?.conversationTypes) ? definition.conversationTypes : instance?.conversationTypes ?? [])
      .map((item) => String(item ?? '').trim().toLowerCase())
      .filter(Boolean),
  )];
  const limits = { ...(definition?.limits ?? instance?.limits ?? {}) };
  const entry = {
    id,
    owner: ownerName,
    label: String(definition?.label ?? '').trim() || id,
    conversationTypes,
    capabilities,
    actions,
    limits,
    send,
    connect,
    actionHandler,
    instance,
    close: typeof instance?.close === 'function' ? () => instance.close() : null,
  };
  transports.set(id, entry);
  return entry;
}

/**
 * 取 transport；未注册返回 null（调用方回落到内置平台实现）。
 */
export function getTransport(id) {
  return transports.get(String(id ?? '').trim().toLowerCase()) ?? null;
}

/** 是否已有同 id 的平台（内置或插件）——注册前的冲突检查用。 */
export function hasTransport(id) {
  return transports.has(String(id ?? '').trim().toLowerCase());
}

/**
 * 按 owner 批量注销，返回被移除的条目。
 *
 * 返回而不是就地 close：内核要按 DISPOSE_TIMEOUT_MS 给 close() 上超时，
 * 这个策略属于内核（它知道自己的退出预算），注册表只管记账。
 */
export function unregisterTransportsByOwner(owner) {
  const ownerName = String(owner ?? '').trim();
  const removed = [];
  for (const [id, entry] of transports) {
    if (entry.owner === ownerName) {
      transports.delete(id);
      removed.push(entry);
    }
  }
  return removed;
}

/** 控制台 / 健康检查用：插件注册的平台清单。 */
export function listTransports() {
  return [...transports.values()].map(({ id, owner, label, conversationTypes, capabilities, actions, limits, connect }) => ({
    id,
    owner,
    label,
    conversationTypes: [...conversationTypes],
    capabilities: [...capabilities],
    actions: [...actions],
    limits: { ...limits },
    // 能不能收消息 = 有没有 connect()。这里只给布尔值，函数不进返回值
    // （这份对象会原样进 `/api/platforms/registry`）。
    inbound: typeof connect === 'function',
  }));
}

/** 清空（测试用）。 */
export function resetTransports() {
  transports.clear();
}
