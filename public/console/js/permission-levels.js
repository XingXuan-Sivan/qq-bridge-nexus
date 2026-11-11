// 权限级别的统一文案：全局配置页与会话详情弹窗必须给同一套档位、同一套措辞。
// 「完全访问 · 短时授权」只在总开关（允许 full 档）打开时出现，避免用户选到不可用的档。

export const PERMISSION_LEVELS = ['read-only', 'workspace-write', 'full-ask', 'full'];

export const PERMISSION_LEVEL_LABELS = {
  'read-only': '只读（read-only）',
  'workspace-write': '工作区读写（workspace-write）',
  'full-ask': '完全访问 · 每次确认（qq-full-ask）',
  full: '完全访问 · 短时授权（danger-full-access）',
};

export function permissionLevelLabel(level) {
  return PERMISSION_LEVEL_LABELS[level] || level || '—';
}

/** allowFull 为 false 时只给前三档；true 时追加短时授权档。 */
export function permissionLevelOptions(allowFull = false) {
  return PERMISSION_LEVELS
    .filter((level) => level !== 'full' || allowFull === true)
    .map((level) => ({ value: level, label: PERMISSION_LEVEL_LABELS[level] }));
}
