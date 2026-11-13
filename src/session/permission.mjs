// 会话权限级别：桥接侧只负责“选哪一档、能不能钉”。
//
// 这里**不认识任何具体平台**：级别 → 平台预设名的映射由 Agent 侧适配器给出
// （profiles/agent-platforms/<id>/adapters/runtime.mjs 的 PERMISSION_PRESET_FOR_LEVEL），
// 经 src/admin/agent-permission.js 的 permissionPresetMap() 注入。
export const PERMISSION_LEVELS = ['read-only', 'workspace-write', 'full-ask', 'full'];
export const SESSION_PERMISSIONS = ['inherit', ...PERMISSION_LEVELS];

/** 默认映射：级别与平台预设同名（中立平台的假定）。有差异时由调用方传 presets。 */
export const IDENTITY_PERMISSION_PRESETS = Object.freeze(Object.fromEntries(PERMISSION_LEVELS.map((level) => [level, level])));

export const PERMISSION_LABEL = {
  'read-only': '只读',
  'workspace-write': '工作区读写',
  'full-ask': '完全访问 · 每次确认',
  full: '完全访问 · 短时授权',
};

const FULL_TTLS = [10, 30, 60];

export function normalizePermissionConfig(raw = {}) {
  const requested = typeof raw?.default === 'string' ? raw.default : '';
  const fallback = PERMISSION_LEVELS.includes(requested) && requested !== 'full' ? requested : 'read-only';
  const ttl = Number(raw?.fullTtlMin);
  return {
    default: fallback,
    allowFull: raw?.allowFull === true,
    fullTtlMin: FULL_TTLS.includes(ttl) ? ttl : 30,
  };
}

export function normalizeSessionPermission(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return SESSION_PERMISSIONS.includes(value) ? value : 'inherit';
}

/** chat 会话恒只读；agent 会话按档案，inherit 时跟随全局默认。 */
export function resolvePermission({ profile, global, chat = false } = {}) {
  if (chat) return 'read-only';
  const own = normalizeSessionPermission(profile?.permission);
  if (own !== 'inherit') return own;
  return normalizePermissionConfig(global).default;
}

export function canPinLevel(level, { allowFull = false, grantActive = false } = {}) {
  if (!PERMISSION_LEVELS.includes(level)) return false;
  if (level !== 'full') return true;
  return allowFull === true && grantActive === true;
}

export function presetForLevel(level, opts = {}) {
  const wanted = PERMISSION_LEVELS.includes(level) ? level : 'read-only';
  // 映射缺项时回落同名：宁可让平台侧报「没有这个预设」，也不要静默挑一个档位。
  const presets = opts.presets && typeof opts.presets === 'object' ? opts.presets : IDENTITY_PERMISSION_PRESETS;
  if (wanted === 'full' && !canPinLevel('full', opts)) {
    return { level: 'full-ask', preset: presets['full-ask'] ?? 'full-ask' };
  }
  return { level: wanted, preset: presets[wanted] ?? wanted };
}

export function permissionText(level) {
  return PERMISSION_LABEL[level] ?? level;
}
