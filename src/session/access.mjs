/**
 * 会话准入：被动 / 主动两根独立的轴（SESSION_SUBSYSTEM.md §4）。
 *
 * 解析顺序（deny 永远优先）：
 *   blocked → access[axis] 显式 deny/allow → 被动轴 owner/管理员私聊豁免 → 全局默认。
 *
 * 只接受 `(axis, key, snapshot, ctx)`，不读 `currentMode`、不读旧的 allow/deny 列表：
 * 迁移完成后旧配置已被删除，这里不存在第二套真相。
 */

export const ACCESS_AXES = ['passive', 'proactive'];

export function isAccessAxis(axis) {
  return ACCESS_AXES.includes(axis);
}

/** 规范化三态：非法值按 inherit。 */
export function normalizeAccessValue(value) {
  return ['inherit', 'allow', 'deny'].includes(value) ? value : 'inherit';
}

/**
 * @param {'passive'|'proactive'} axis
 * @param {string} key
 * @param {{profiles?: object, defaults?: object}} snapshot
 * @param {{ownerPrivate?: boolean, adminPrivate?: boolean, adminExemptPassive?: boolean}} ctx
 * @returns {'allow'|'deny'}
 */
export function resolveAccess(axis, key, snapshot, ctx = {}) {
  if (!isAccessAxis(axis)) throw new Error(`未知的准入轴：${axis}`);
  const profile = snapshot?.profiles?.[key] ?? null;
  if (profile?.blocked === true) return 'deny';
  const explicit = normalizeAccessValue(profile?.access?.[axis]);
  if (explicit === 'deny') return 'deny';
  if (explicit === 'allow') return 'allow';
  if (axis === 'passive' && ctx.ownerPrivate === true) return 'allow';
  if (axis === 'passive' && ctx.adminPrivate === true && ctx.adminExemptPassive !== false) return 'allow';
  const fallback = snapshot?.defaults?.[axis];
  return fallback === 'allow' ? 'allow' : 'deny';
}

/** 一次解析两根轴（控制台列表/详情用）。 */
export function resolveAccessSummary(key, snapshot, ctx = {}) {
  return {
    passive: resolveAccess('passive', key, snapshot, ctx),
    proactive: resolveAccess('proactive', key, snapshot, ctx),
  };
}

/** 默认策略的黑白语义文案（给控制台提示用）。 */
export function defaultPolicyText(value) {
  return value === 'allow' ? '默认允许（黑名单模式）' : '默认拒绝（白名单模式）';
}
