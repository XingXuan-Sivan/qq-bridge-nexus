/**
 * 有效运行模式（SESSION_SUBSYSTEM.md §5.1）。
 *
 * 全局模式是默认值；档案里的 `mode` 可以按会话覆盖。closed-agent 全局排他：
 * 它开启时只保留 owner/管理员私聊，其余会话返回 `inactive`，不参与任何发送与唤醒。
 *
 * 纯函数，便于单测；bridge 只负责把 owner 判定和档案读出来。
 */

export const SESSION_MODES = ['inherit', 'chat', 'reserved', 'reserved2'];

/** 规范化档案里的 mode；非法值按 inherit。 */
export function normalizeSessionMode(value) {
  return SESSION_MODES.includes(value) ? value : 'inherit';
}

/**
 * @param {string} globalMode chat | reserved | reserved2 | closed-agent
 * @param {string} override 档案 mode：inherit/chat/reserved/reserved2
 * @param {{ owner?: boolean }} ctx
 * @returns {string} chat | reserved | reserved2 | closed-agent | inactive
 */
export function resolveEffectiveMode(globalMode, override, ctx = {}) {
  if (globalMode === 'closed-agent') return ctx.owner === true ? 'closed-agent' : 'inactive';
  const mode = normalizeSessionMode(override);
  return mode === 'inherit' ? globalMode : mode;
}

/** 这个有效模式是否还会真正处理 QQ 会话（closed-agent 的 owner 私聊算可用）。 */
export function isUsableMode(mode) {
  return mode === 'chat' || mode === 'reserved' || mode === 'reserved2' || mode === 'closed-agent';
}
