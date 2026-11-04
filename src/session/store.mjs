/**
 * `state/sessions.json` 的读写（P7 第三步续：会话层的持久化）。
 *
 * 从 bridge.js 搬出来的目的不是「少几行」，而是把两条**安全不变量**变成可离线验证的代码：
 *
 * 1. 读失败或内容损坏时**绝不回写**。早期实现读到坏文件就当空状态处理，紧接着一次
 *    `saveState()` 会把空映射原子写回磁盘 —— 一次截断/占用/写满就变成永久丢失。
 *    这里用返回的 `writable:false` 表达「降级为只读不写」，由调用方原样传递。
 * 2. 缺字段就地补齐（`sessionPolicies`、`dormantSessions`），不因为老版本文件没有这些键
 *    就把整个文件当作不可用。
 *
 * 模块本身不持有状态，也不 import 全局：`file` / `atomicWriteJson` / `log` /
 * `normalizeDormant` 都由调用方传入，测试里可以指向临时目录。
 */

const EMPTY = () => ({ sessions: {}, sessionPolicies: {}, dormantSessions: {} });

/**
 * @returns {{ state: object, writable: boolean }}
 *   `writable:false` 表示文件读不了或内容损坏 —— 调用方必须停止回写。
 */
export function loadSessionState({ file, readFile, log = () => {}, normalizeDormant = (x) => x ?? {} }) {
  let raw;
  try {
    raw = readFile(file);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      log(`⚠️ sessions.json 读取失败，已降级为「只读不写」（不会覆盖原文件）：${error?.message ?? error}`);
      return { state: EMPTY(), writable: false };
    }
    return { state: EMPTY(), writable: true };
  }
  let loaded = null;
  if (raw.trim() !== '') {
    try {
      const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      loaded = JSON.parse(text);
    } catch (error) {
      log(`⚠️ sessions.json 内容损坏，已降级为「只读不写」（不会覆盖原文件，请先备份再修复）：${error?.message ?? error}`);
      return { state: EMPTY(), writable: false };
    }
  }
  const state = loaded && loaded.sessions && typeof loaded.sessions === 'object' ? loaded : { sessions: {} };
  if (!state.sessionPolicies || typeof state.sessionPolicies !== 'object' || Array.isArray(state.sessionPolicies)) state.sessionPolicies = {};
  // 模式切换期间休眠的聊天会话（见 src/mode-handover.js）；脏数据丢弃
  state.dormantSessions = normalizeDormant(state.dormantSessions);
  return { state, writable: true };
}

/**
 * 原子写。`writable:false` 时静默跳过 —— 这是「损坏后不覆盖」的唯一执行点。
 * @returns {boolean} 是否真的写了
 */
export function saveSessionState({ file, atomicWriteJson, state, writable }) {
  if (!writable) return false;
  atomicWriteJson(file, state);
  return true;
}
