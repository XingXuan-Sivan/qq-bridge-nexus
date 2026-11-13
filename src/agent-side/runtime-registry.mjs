// Agent 侧平台注册表（中立，零平台名）。
//
// 内核只通过这里问「当前 Agent 平台能做什么、某个级别该映射成什么」。具体平台
// （dsh / 将来的其它 Agent 平台）由 src/agent-side/builtin.mjs 或插件在启动时注册。
//
// 为什么是同步注册表而不是 await import()：resolveLevelPlan 在消息处理的热路径上，
// 异步解析会让每次调用都变成 Promise，调用方要穿透 await，收益为零。平台模块本身
// 只是常量与纯函数，同步加载没有副作用。
//
// 未注册时的行为：抛错（fail-closed）。猜一个默认平台会把权限映射错，比直接报错更贵。

const platforms = new Map();
let activeId = '';

/** 注册一个 Agent 平台实现。重复注册同 id 会覆盖（热更新与测试需要）。 */
export function registerAgentPlatform(impl) {
  const id = String(impl?.id ?? '').trim();
  if (!id) throw new Error('registerAgentPlatform: 缺少 id');
  if (typeof impl.resolveLevelPlan !== 'function') throw new Error(`registerAgentPlatform: ${id} 缺少 resolveLevelPlan`);
  platforms.set(id, { ...impl, id });
  if (!activeId) activeId = id;
  return platforms.get(id);
}

/** 注销（测试与插件卸载用）。 */
export function unregisterAgentPlatform(id) {
  const key = String(id ?? '').trim();
  const existed = platforms.delete(key);
  if (activeId === key) activeId = platforms.keys().next().value ?? '';
  return existed;
}

/** 清空注册表（测试用）。 */
export function resetAgentPlatforms() {
  platforms.clear();
  activeId = '';
}

/** 指定当前平台；传空串只读取当前值。 */
export function useAgentPlatform(id) {
  const key = String(id ?? '').trim();
  if (key) {
    if (!platforms.has(key)) throw new Error(`Agent 平台未注册：${key}`);
    activeId = key;
  }
  return activeId;
}

export function activeAgentPlatformId() {
  return activeId;
}

/** 取平台实现；未注册返回 null。 */
export function agentPlatform(id = '') {
  return platforms.get(String(id ?? '').trim() || activeId) ?? null;
}

/** 取平台实现；未注册抛错（调用方通常希望 fail-closed）。 */
export function requireAgentPlatform(id = '') {
  const key = String(id ?? '').trim() || activeId;
  const impl = platforms.get(key);
  if (!impl) throw new Error(`Agent 平台未注册：${key || '(空)'}；请检查 src/agent-side/builtin.mjs 是否已装配`);
  return impl;
}

/** 控制台 / 健康检查用：所有已注册平台的静态描述。 */
export function listAgentPlatforms() {
  return [...platforms.values()].map((impl) => ({
    id: impl.id,
    label: impl.label ?? impl.id,
    capabilities: [...(impl.capabilities ?? [])],
  }));
}

// ── 转发查询 ────────────────────────────────────────────────────────────────

/** 级别 → { agentPreset, permissionPreset, custom? } | { ok:false, error }。 */
export function resolveLevelPlan(level, ctx = {}) {
  return requireAgentPlatform(ctx.agentPlatform).resolveLevelPlan(level, ctx);
}

export function permissionCommandSucceeded(result, wanted, ctx = {}) {
  const impl = requireAgentPlatform(ctx.agentPlatform);
  return typeof impl.permissionCommandSucceeded === 'function'
    ? impl.permissionCommandSucceeded(result, wanted)
    : false;
}

/** 旧 preset 名归一（未注册平台时原样返回，不阻断读取）。 */
export function normalizeAgentPreset(name, ctx = {}) {
  const impl = agentPlatform(ctx.agentPlatform);
  return typeof impl?.normalizeAgentPreset === 'function' ? impl.normalizeAgentPreset(name) : String(name ?? '').trim();
}

/** 该 preset 是否管理通道托管的档位；返回 L1/L2/L3 或 null。 */
export function agentPresetLevel(name, ctx = {}) {
  const impl = agentPlatform(ctx.agentPlatform);
  const map = impl?.AGENT_PRESET_FOR_LEVEL;
  if (!map) return null;
  const wanted = normalizeAgentPreset(name, ctx);
  for (const [level, preset] of Object.entries(map)) {
    if (preset === wanted) return level;
  }
  return null;
}

/** 群友 preset（不能被当作 closed-agent 自选档）。 */
export function chatAgentPresets(ctx = {}) {
  return [...(agentPlatform(ctx.agentPlatform)?.CHAT_AGENT_PRESETS ?? [])];
}

/** 全部受管 preset id（构建期与静态校验用）。 */
export function agentPresetIds(ctx = {}) {
  const impl = requireAgentPlatform(ctx.agentPlatform);
  return [...(impl.AGENT_PRESET_IDS ?? Object.values(impl.AGENT_PRESET_FOR_LEVEL ?? {}))];
}
