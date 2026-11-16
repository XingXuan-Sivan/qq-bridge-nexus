// 会话权限级别：桥接这一侧**唯一**的权限语义。
//
// 它是一层过滤器，不是执行体那边的沙箱设置：
//   · 不绑任何 Agent 平台（级别只对桥接工具表取值，见 src/tools/catalog.mjs 的 LEVEL_ALLOWS）；
//   · 不依赖能力档（档案里没有能力档就是纯聊天会话，恒只读）；
//   · 不改变已经注入的能力（预设、工具面、沙箱都由能力档决定），只决定「这个会话还能不能调用某类平台工具」。
// 对端（执行体）自己的权限档由能力档的 `runtime.peerPermission` 一次性钉住，跟这里无关。
export const PERMISSION_LEVELS = ['read-only', 'workspace-write', 'full-ask', 'full'];
export const SESSION_PERMISSIONS = ['inherit', ...PERMISSION_LEVELS];

export const PERMISSION_LABEL = {
  'read-only': '只读',
  'workspace-write': '工作区读写',
  'full-ask': '完全访问 · 每次确认',
  full: '完全访问',
};

export function normalizePermissionConfig(raw = {}) {
  const requested = typeof raw?.default === 'string' ? raw.default : '';
  return { default: PERMISSION_LEVELS.includes(requested) ? requested : 'read-only' };
}

export function normalizeSessionPermission(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return SESSION_PERMISSIONS.includes(value) ? value : 'inherit';
}

/** 纯聊天会话恒只读；其余按档案，inherit 时跟随全局默认。 */
export function resolvePermission({ profile, global, chat = false } = {}) {
  if (chat) return 'read-only';
  const own = normalizeSessionPermission(profile?.permission);
  if (own !== 'inherit') return own;
  return normalizePermissionConfig(global).default;
}

export function permissionText(level) {
  return PERMISSION_LABEL[level] ?? level;
}
