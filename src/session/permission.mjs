// 会话权限级别：桥接侧只负责“选哪一档、能不能钉”，DSH 侧只认权限预设名。
export const PERMISSION_LEVELS = ['read-only', 'workspace-write', 'full-ask', 'full'];
export const SESSION_PERMISSIONS = ['inherit', ...PERMISSION_LEVELS];

// 唯一映射：级别 → DSH 权限预设。danger-full-access 只在这里出现。
export const DSH_PERMISSION_PRESET = {
  'read-only': 'read-only',
  'workspace-write': 'workspace-write',
  'full-ask': 'qq-full-ask',
  full: 'danger-full-access',
};

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
  if (wanted === 'full' && !canPinLevel('full', opts)) {
    return { level: 'full-ask', preset: DSH_PERMISSION_PRESET['full-ask'] };
  }
  return { level: wanted, preset: DSH_PERMISSION_PRESET[wanted] };
}

export function permissionText(level) {
  return PERMISSION_LABEL[level] ?? level;
}
