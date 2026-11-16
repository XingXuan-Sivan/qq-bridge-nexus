// 权限级别的统一文案：全局配置页与会话详情弹窗必须给同一套档位、同一套措辞。
// 「完全访问 · 短时授权」只在总开关（允许 full 档）打开时可选；当前值本来就是 full 时始终保留，
// 否则关掉总开关后，已存的档位会在下拉里显示成空白。

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

/**
 * 档位选项。`allowFull` 打开时给四档；`current` 是 full 时即使总开关关着也保留——
 * 已经存在的 full 要能显示出来（关掉开关时后端已收回授权，这里只解决「显示为空」）。
 */
export function permissionLevelOptions({ allowFull = false, current = '' } = {}) {
  const withFull = allowFull === true || current === 'full';
  return PERMISSION_LEVELS
    .filter((level) => level !== 'full' || withFull)
    .map((level) => ({ value: level, label: PERMISSION_LEVEL_LABELS[level] }));
}
