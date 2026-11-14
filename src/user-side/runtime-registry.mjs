// 用户侧平台注册表（中立，零平台名）。
//
// 内核只通过这里问「当前用户平台怎么发、有什么能力、有什么限制」。具体平台
// （qq / 将来的微信、B 站…）由 src/user-side/builtin.mjs 或插件在启动时注册。
//
// 与 src/agent-side/runtime-registry.mjs 同构，理由也相同：这些查询都在消息处理
// 的热路径上，异步解析会把每次调用变成 Promise；平台模块本身只是常量与纯函数，
// 同步加载没有副作用。
//
// 未注册时的行为：抛错（fail-closed）。猜一个默认平台会把消息发到错误的通道，
// 比直接报错贵得多。

const platforms = new Map();
let activeId = '';

/** 注册一个用户侧平台实现。重复注册同 id 会覆盖（热更新与测试需要）。 */
export function registerUserPlatform(impl) {
  const id = String(impl?.id ?? '').trim();
  if (!id) throw new Error('registerUserPlatform: 缺少 id');
  platforms.set(id, { ...impl, id });
  if (!activeId) activeId = id;
  return platforms.get(id);
}

/** 注销（测试与插件卸载用）。 */
export function unregisterUserPlatform(id) {
  const key = String(id ?? '').trim();
  const existed = platforms.delete(key);
  if (activeId === key) activeId = platforms.keys().next().value ?? '';
  return existed;
}

/** 清空注册表（测试用）。 */
export function resetUserPlatforms() {
  platforms.clear();
  activeId = '';
}

/** 指定当前平台；传空串只读取当前值。 */
export function useUserPlatform(id) {
  const key = String(id ?? '').trim();
  if (key) {
    if (!platforms.has(key)) throw new Error(`用户平台未注册：${key}`);
    activeId = key;
  }
  return activeId;
}

export function activeUserPlatformId() {
  return activeId;
}

/** 取平台实现；未注册返回 null。 */
export function userPlatform(id = '') {
  return platforms.get(String(id ?? '').trim() || activeId) ?? null;
}

/** 取平台实现；未注册抛错。 */
export function requireUserPlatform(id = '') {
  const key = String(id ?? '').trim() || activeId;
  const impl = platforms.get(key);
  if (!impl) throw new Error(`用户平台未注册：${key || '(空)'}；请检查 src/user-side/builtin.mjs 是否已装配`);
  return impl;
}

/**
 * 控制台 / 健康检查用：所有已注册平台的静态描述。
 *
 * 只放**常量**：函数、Socket、配置一律不进返回值 —— 这个对象会原样进 `/api/platforms`，
 * 泄漏一个函数就等于把实现细节暴露给了控制台（test-platform-adapters 钉着这一点）。
 * limits（分条上限、是否渲染 Markdown）是控制台画表单要用的，B7 起一并暴露。
 */
export function listUserPlatforms() {
  return [...platforms.values()].map((impl) => ({
    id: impl.id,
    label: impl.label ?? impl.id,
    conversationTypes: [...(impl.conversationTypes ?? [])],
    capabilities: [...(impl.capabilities ?? [])],
    limits: { ...(impl.limits ?? {}) },
    // 能不能收消息 = 有没有 connect()（C3 的入站契约）。函数本身不进返回值：
    // 这份对象会原样进 /api/platforms/registry。
    inbound: typeof impl.connect === 'function',
  }));
}

// ── 转发查询 ────────────────────────────────────────────────────────────────

/**
 * 会话类型 + id + 中立段 → 本平台的发送调用 { action, params }。
 *
 * 实现缺失时抛错而不是返回空对象：拿不到 action 的调用会去打一个不存在的方法，
 * 错误会飘到几百行之外才现形。
 */
export function buildSendCall(kind, id, message, ctx = {}) {
  const impl = requireUserPlatform(ctx.platform);
  if (typeof impl.buildSendCall !== 'function') {
    throw new Error(`用户平台 ${impl.id} 未提供 buildSendCall`);
  }
  return impl.buildSendCall(kind, id, message);
}

/** get_version_info 回执 → { name, version }；未提供实现时返回空名。 */
export function readBackendInfo(data, ctx = {}) {
  const impl = requireUserPlatform(ctx.platform);
  return typeof impl.readBackendInfo === 'function' ? impl.readBackendInfo(data) : { name: null, version: null };
}

/** 日志里的后端称呼。 */
export function describeBackend(opts, ctx = {}) {
  const impl = requireUserPlatform(ctx.platform);
  if (typeof impl.describeBackend === 'function') return impl.describeBackend(opts);
  return impl.label ?? impl.id;
}

/** 能力查询：按声明判定，缺省视为不支持。 */
export function supportsUserCapability(capability, ctx = {}) {
  const impl = requireUserPlatform(ctx.platform);
  return (impl.capabilities ?? []).includes(String(capability ?? ''));
}

/** 分条与格式限制；未声明时返回空对象（调用方回落到内核默认值）。 */
export function userPlatformLimits(ctx = {}) {
  const impl = requireUserPlatform(ctx.platform);
  return { ...(impl.limits ?? {}) };
}
