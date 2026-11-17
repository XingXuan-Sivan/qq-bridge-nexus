// 权限级别的统一文案：全局配置页与会话详情弹窗必须给同一套档位、同一套措辞。
// 文案与后端 `PERMISSION_LABEL`（src/session/permission.mjs）逐字一致；
// 运行时优先用 `/api/config/permission` 下发的 `levels` / `labels`，这里只做首屏兜底。

export const PERMISSION_LEVELS = ['read-only', 'workspace-write', 'full-ask', 'full'];

export const PERMISSION_LEVEL_LABELS = {
  'read-only': '只读',
  'workspace-write': '工作区读写',
  'full-ask': '完全访问 · 每次确认',
  full: '完全访问',
};

export function permissionLevelLabel(level) {
  return PERMISSION_LEVEL_LABELS[level] || level || '—';
}

/** 档位选项：四档都给。权限级别本身就是配置值，不再有「总开关 / 限时授权」。 */
export function permissionLevelOptions() {
  return PERMISSION_LEVELS.map((level) => ({ value: level, label: PERMISSION_LEVEL_LABELS[level] }));
}
