/**
 * 有效运行模式（SESSION_SUBSYSTEM.md §5.1）。
 *
 * 全局模式是默认值；档案里的 `mode` 可以按会话覆盖。closed-agent 是全局引擎：
 * 它开启时所有会话都用它，档案覆盖不能把它盖回 chat/仿真。
 *
 * P6 起这里不再判断「谁能用 closed-agent」——那是运行方案 `audience` 的职责
 * （见 bridge 的 planAudienceBlocks）。本模块只回答「这套引擎对哪些会话生效」，
 * 准入由 src/session/access.mjs 与方案受众共同决定。
 *
 * 纯函数，便于单测。
 */

export const SESSION_MODES = ['inherit', 'chat', 'reserved', 'reserved2'];

/** 规范化档案里的 mode；非法值按 inherit。 */
export function normalizeSessionMode(value) {
  return SESSION_MODES.includes(value) ? value : 'inherit';
}

/**
 * @param {string} globalMode chat | reserved | reserved2 | closed-agent
 * @param {string} override 档案 mode：inherit/chat/reserved/reserved2
 * @returns {string} chat | reserved | reserved2 | closed-agent | inactive
 */
export function resolveEffectiveMode(globalMode, override) {
  if (globalMode === 'closed-agent') return 'closed-agent';
  const mode = normalizeSessionMode(override);
  return mode === 'inherit' ? globalMode : mode;
}

/** 这个有效模式是否还会真正处理 QQ 会话（closed-agent 的 owner 私聊算可用）。 */
export function isUsableMode(mode) {
  return mode === 'chat' || mode === 'reserved' || mode === 'reserved2' || mode === 'closed-agent';
}
