/**
 * 旧会话配置 → `state/sessions/` 档案的一次性迁移（SESSION_SUBSYSTEM.md §4.4/§9）。
 *
 * 迁移的目标是「完全保持现状」，不是顺手重新设计权限：
 *   - 旧 allow 里的会话：被动 + 主动都允许；
 *   - 旧 deny 里的会话：blocked=true（拒绝优先）；
 *   - allowAllWhenEmpty=true 且 allow 为空：两根轴默认 allow；
 *   - 其余：两根轴默认 deny。
 *
 * 函数是纯的：只接收旧数据快照，返回新档案与要写入的提交结果，不读写文件。
 * 真正的「写目录 → 回读校验 → 写 migratedAt → 删旧源」由 bridge 的迁移流程完成。
 */

import { formatKey, parseKey } from './key.mjs';
import { applyPatch, createProfile, normalizeDefaults } from './directory.mjs';

/** 旧 key 规范化；兼容只有数字 ID 的旧白名单，不合法返回 null。 */
function canonicalKey(raw, kindHint, platform = 'qq') {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const full = parseKey(text);
  if (full) return formatKey(full.platform, full.kind, full.id);
  if (/^(group|private):[^:\s]+$/i.test(text)) {
    const [kind, id] = text.split(':');
    return formatKey(platform, kind.toLowerCase(), id);
  }
  if (kindHint && /^[A-Za-z0-9_-]{1,64}$/.test(text)) return formatKey(platform, kindHint, text);
  return null;
}

function listKeys(list, kindHint, platform) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const key = canonicalKey(raw, kindHint, platform);
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * @param {object} input
 * @param {string[]} input.allowGroups
 * @param {string[]} input.allowPrivate
 * @param {string[]} input.denyGroups
 * @param {string[]} input.denyPrivate
 * @param {boolean} input.allowAllWhenEmpty
 * @param {object} input.sessions 旧绑定 key→sessionId
 * @param {object} input.policies 旧指纹 key→fingerprint
 * @param {object} input.dormant 旧休眠表
 * @param {object} input.roleByKey 旧人格 byKey（null=不挂卡）
 * @param {object} input.initialPrompts key→{text,updatedAt}
 * @param {object} input.wakeConfigs key→wakeConfig
 * @param {() => number} input.now
 */
export function migrateSessionProfiles(input = {}) {
  const now = typeof input.now === 'function' ? input.now : () => Date.now();
  const platform = input.platform || 'qq';
  const allow = [...listKeys(input.allowGroups, 'group', platform), ...listKeys(input.allowPrivate, 'private', platform)];
  const deny = [...listKeys(input.denyGroups, 'group', platform), ...listKeys(input.denyPrivate, 'private', platform)];
  const allAllow = input.allowAllWhenEmpty === true && allow.length === 0;
  const defaults = allAllow ? { passive: 'allow', proactive: 'allow' } : normalizeDefaults({});

  /** @type {Record<string, object>} */
  const profiles = {};
  const keys = new Set([
    ...allow,
    ...deny,
    ...Object.keys(input.sessions ?? {}).map(canonicalKey).filter(Boolean),
    ...Object.keys(input.roleByKey ?? {}).map(canonicalKey).filter(Boolean),
    ...Object.keys(input.initialPrompts ?? {}).map(canonicalKey).filter(Boolean),
    ...Object.keys(input.wakeConfigs ?? {}).map(canonicalKey).filter(Boolean),
    ...Object.keys(input.dormant ?? {}).map(canonicalKey).filter(Boolean),
  ]);

  const report = { keys: 0, allowed: 0, blocked: 0, persona: 0, prompt: 0, wake: 0, binding: 0 };

  for (const key of [...keys].sort()) {
    let profile = createProfile(key, {}, now);
    const patch = {};

    if (deny.includes(key)) {
      patch.blocked = true;
      report.blocked += 1;
    } else if (allow.includes(key)) {
      patch.access = { passive: 'allow', proactive: 'allow' };
      report.allowed += 1;
    }

    const role = input.roleByKey?.[key];
    if (Object.hasOwn(input.roleByKey ?? {}, key)) {
      if (role === null) patch.persona = { mode: 'off', name: null };
      else if (typeof role === 'string' && role.trim()) patch.persona = { mode: 'card', name: role.trim() };
      report.persona += 1;
    }

    const prompt = input.initialPrompts?.[key];
    if (prompt && typeof prompt === 'object' && typeof prompt.text === 'string' && prompt.text.trim()) {
      patch.prompt = { initialText: prompt.text, updatedAt: Number(prompt.updatedAt) > 0 ? Number(prompt.updatedAt) : now() };
      report.prompt += 1;
    }

    const wake = input.wakeConfigs?.[key];
    if (wake && typeof wake === 'object') {
      patch.wake = { config: wake };
      report.wake += 1;
    }

    const sessionId = input.sessions?.[key];
    const fingerprint = input.policies?.[key];
    if (sessionId) {
      patch.binding = {
        sessionId,
        fingerprint: fingerprint ?? null,
        status: 'unknown',
        checkedAt: 0,
        createdAt: now(),
      };
      report.binding += 1;
    }

    if (input.dormant?.[key]) patch.dormant = input.dormant[key];

    profile = applyPatch(profile, patch, now);
    // 档案 schema 已去掉三态字段；把迁移读到的旧准入先挂在 legacyAccess 上，
    // 交给后面的 migrateAccessModel 翻译成 v2 名单，翻译完会删掉。
    if (patch.blocked === true || patch.access) {
      const access = patch.access && typeof patch.access === 'object' ? patch.access : {};
      profile.legacyAccess = {
        blocked: patch.blocked === true,
        access: {
          passive: ['inherit', 'allow', 'deny'].includes(access.passive) ? access.passive : 'inherit',
          proactive: ['inherit', 'allow', 'deny'].includes(access.proactive) ? access.proactive : 'inherit',
        },
      };
    }
    profiles[key] = profile;
  }
  report.keys = Object.keys(profiles).length;

  return {
    profiles,
    defaults,
    sessions: Object.fromEntries(Object.entries(profiles).filter(([, p]) => p.binding?.sessionId).map(([k, p]) => [k, p.binding.sessionId])),
    sessionPolicies: Object.fromEntries(Object.entries(profiles).filter(([, p]) => p.binding?.fingerprint).map(([k, p]) => [k, p.binding.fingerprint])),
    dormantSessions: Object.fromEntries(Object.entries(profiles).filter(([, p]) => p.dormant).map(([k, p]) => [k, p.dormant])),
    report,
    legacy: { allowCount: allow.length, denyCount: deny.length, allAllow },
  };
}

/** 迁移后判定「目录是否已经成为唯一真相」：有 defaults 且 migratedAt > 0。 */
export function isDirectoryMigrated(state) {
  return Number(state?.migratedAt) > 0 && !!state?.defaults;
}
