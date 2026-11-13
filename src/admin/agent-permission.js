// 管理通道「级别 → 平台落地」的查询入口（中立，零平台名）。
//
// 原先这份映射写死在 src/admin/dsh-permission.js 里，等于内核认识 DSH。现在映射随
// Agent 平台适配器走（profiles/agent-platforms/<id>/adapters/runtime.mjs），这里只转发。
//
// 约定：
//   · 内核只认三个管理级别 L1/L2/L3 与四个会话权限级别（见 src/session/permission.mjs）。
//   · 「L3 要不要审批」「哪个 agent preset 带工具白名单守卫」是平台差异，不由内核决定。
import { requireAgentPlatform, resolveLevelPlan, permissionCommandSucceeded, agentPresetIds, chatAgentPresets, normalizeAgentPreset, agentPresetLevel, activeAgentPlatformId } from '../agent-side/runtime-registry.mjs';
// 副作用：确保内置平台已注册（ESM 只执行一次）。
import '../agent-side/builtin.mjs';

export { resolveLevelPlan, permissionCommandSucceeded, agentPresetIds, chatAgentPresets, normalizeAgentPreset, agentPresetLevel, activeAgentPlatformId };

/** 内核四级 → 当前平台的权限预设名映射（presetForLevel 的 presets 参数）。 */
export function permissionPresetMap(ctx = {}) {
  const impl = requireAgentPlatform(ctx.agentPlatform);
  const map = impl.PERMISSION_PRESET_FOR_LEVEL;
  return map && typeof map === 'object' ? { ...map } : null;
}

/** 管理通道三级 → 当前平台的权限预设名映射。 */
export function levelPermissionMap(ctx = {}) {
  const impl = requireAgentPlatform(ctx.agentPlatform);
  const map = impl.LEVEL_PERMISSION_PRESET;
  return map && typeof map === 'object' ? { ...map } : null;
}

/** 桥接拥有的权限预设名（安装适配器会把被改宽的取值收紧回去）。 */
export function bridgeOwnedPermissionPresets(ctx = {}) {
  const impl = requireAgentPlatform(ctx.agentPlatform);
  return [...(impl.BRIDGE_OWNED_PRESETS ?? [])];
}

/** 要写进平台 profile 的权限预设表。 */
export function permissionPresetTable(ctx = {}) {
  const impl = requireAgentPlatform(ctx.agentPlatform);
  return impl.PERMISSION_PRESETS ? { ...impl.PERMISSION_PRESETS } : {};
}
