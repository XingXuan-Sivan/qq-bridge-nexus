/**
 * 旧三态准入 → 全局黑白名单（`defaults.version: 1 → 2`）的一次性迁移。
 *
 * 迁移只做一件事：把“每会话三态 + 全局默认 allow/deny”翻译成“每轴一份名单”。
 * 翻译目标不是重新解释规则，而是**保持升级当次的生效结果不变**：
 *   - 旧默认 deny → 白名单；entries = 旧规则下实际允许的会话。
 *   - 旧默认 allow → 黑名单；entries = 旧规则下实际拒绝的会话。
 * 旧规则里的 owner/管理员被动豁免也计算进去，迁移后这条豁免不再存在（管理命令走独立通道）。
 */

import { accessState, createAccessConfig, isAccessConfigV2 } from './access.mjs';

function oldEffective(axis, key, { profiles, defaults, ownerKey, adminPassiveKeys }) {
  const profile = profiles?.[key] ?? null;
  const legacy = profile?.legacyAccess
    ?? { blocked: profile?.blocked === true, access: profile?.access ?? {} };
  if (legacy.blocked === true) return 'deny';
  const explicit = legacy.access?.[axis];
  if (explicit === 'deny') return 'deny';
  if (explicit === 'allow') return 'allow';
  if (axis === 'passive' && ownerKey && key === ownerKey) return 'allow';
  if (axis === 'passive' && adminPassiveKeys.has(key)) return 'allow';
  return defaults?.[axis] === 'allow' ? 'allow' : 'deny';
}

/**
 * @returns {{changed:boolean, defaults:object, profiles:object, report:object}}
 */
export function migrateAccessModel(state, { ownerKey = null, adminPassiveKeys = [] } = {}) {
  if (isAccessConfigV2(state?.defaults)) {
    return { changed: false, defaults: state.defaults, profiles: state.profiles ?? {}, report: {} };
  }

  const profiles = state?.profiles ?? {};
  const oldDefaults = state?.defaults && typeof state.defaults === 'object' ? state.defaults : {};
  const admins = new Set(adminPassiveKeys.filter(Boolean));
  const keys = new Set([...Object.keys(profiles), ownerKey, ...admins].filter(Boolean));
  const sorted = [...keys].sort();

  const defaults = createAccessConfig();
  const report = { keys: sorted.length, passive: 0, proactive: 0 };
  for (const axis of ['passive', 'proactive']) {
    const mode = oldDefaults[axis] === 'allow' ? 'deny' : 'allow';
    const wanted = mode === 'allow' ? 'allow' : 'deny';
    const entries = sorted.filter((key) => oldEffective(axis, key, {
      profiles, defaults: oldDefaults, ownerKey, adminPassiveKeys: admins,
    }) === wanted);
    defaults[axis] = { mode, entries };
    report[axis] = entries.length;
  }

  const nextProfiles = {};
  for (const [key, profile] of Object.entries(profiles)) {
    const next = { ...profile };
    delete next.blocked;
    delete next.access;
    delete next.legacyAccess;
    nextProfiles[key] = next;
  }

  return { changed: true, defaults, profiles: nextProfiles, report };
}

/** 给控制台展示迁移后的摘要（不需要知道旧字段）。 */
export function summarizeAccessConfig(defaults) {
  const out = {};
  for (const axis of ['passive', 'proactive']) {
    const state = accessState(axis, 'qq:group:0', { defaults });
    out[axis] = { mode: state.mode, count: defaults?.[axis]?.entries?.length ?? 0 };
  }
  return out;
}
