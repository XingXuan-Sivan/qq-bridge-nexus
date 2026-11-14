// 当前执行体的「连接层」入口：一个进程同一时刻只有一个活动执行体。
//
// 一个 Agent 平台要能被配成 `platforms.active.agent`，只需提供一个 `createRuntime`：
//   · prepareAuth(config)     连接前补全凭据（不改 config，返回要写回的值）
//   · prepareEndpoint(config) 连接前补全地址（stdio 执行体返回空地址 + auto=false）
//   · client()                懒建客户端；地址变化时由执行体自己重绑
//   · events()                事件流订阅面（follow / forget / mux）
//   · port()                  懒建 AgentPort（调用面在 port.mjs）
//   · collector()             按本平台的事件口径把一条流收成「一轮」
//   · health({threshold})     连续失败计数（分类口径由平台决定）
//   · probe()                 探活 + 失败时按节流窗口重新识别地址
//   · authHint(error)         这个错误要不要给用户一段诊断（不需要返回 null）
//   · authRecentlyFailed()    最近是否提示过凭据被拒（给「连上就断」这类日志做归因）
//   · resetAuthHint()         恢复后重置提示限频
//   · close()                 断开 / 结束子进程
//
// 调用面（会话、回合、权限、模型、设置、工作区、压缩）不在这里 —— 那是 AgentPort 的事。
// 两侧分开的原因：连上一个执行体与「连上之后能做什么」是两件事，前者是 HTTP 还是子进程
// 完全不影响后者；混在同一个对象里会让第二个执行体必须假装拥有第一个的连接方式。
import './builtin.mjs';
import { requireAgentPlatform } from './runtime-registry.mjs';

/** createRuntime 必须给出的成员。缺任何一个都不允许当主平台（fail-closed）。 */
export const RUNTIME_MEMBERS = Object.freeze([
  'prepareAuth',
  'prepareEndpoint',
  'client',
  'events',
  'port',
  'collector',
  'health',
  'probe',
  'authHint',
  'authRecentlyFailed',
  'resetAuthHint',
  'close',
]);

let current = null;
let currentImpl = null;
let currentId = '';

/**
 * 取当前执行体的运行期句柄（进程内单例）。
 *
 * @param {{config?: object, log?: (message: string) => void, onBaseUrlChange?: (url: string) => void}} [options]
 *   `config` 是 `platforms.agents.<id>` 的活引用：执行体识别到新地址后直接改它，
 *   调用方无需再同步一份副本。只有首次调用生效。
 */
export function agentRuntime(options = {}) {
  const impl = requireAgentPlatform();
  // 按实现对象而不是 id 比对：注册表被重置后重新装配同 id 的平台时，旧句柄不能再被复用。
  if (current && currentImpl === impl) return current;
  if (typeof impl.createRuntime !== 'function') {
    throw new Error(`Agent 平台 ${impl.id} 未提供 createRuntime，不能当主平台；请把 platforms.active.agent 指回一个实现了连接层的平台`);
  }
  const runtime = impl.createRuntime({
    config: options.config ?? {},
    log: options.log ?? (() => {}),
    onBaseUrlChange: options.onBaseUrlChange,
  });
  const missing = RUNTIME_MEMBERS.filter((name) => typeof runtime?.[name] !== 'function');
  if (missing.length) {
    throw new Error(`Agent 平台 ${impl.id} 的 createRuntime 缺少 ${missing.join(' / ')}`);
  }
  if (!runtime.id || !runtime.label || !runtime.mode) {
    throw new Error(`Agent 平台 ${impl.id} 的 createRuntime 必须声明 id / label / mode`);
  }
  current = runtime;
  currentImpl = impl;
  currentId = impl.id;
  return current;
}

/** 当前运行期句柄的平台 id；尚未建立时为空串。 */
export function agentRuntimeId() {
  return currentId;
}

/** 丢弃单例（测试与执行体切换用，切换后下一次 agentRuntime() 按新平台重建）。 */
export async function resetAgentRuntime() {
  const runtime = current;
  current = null;
  currentImpl = null;
  currentId = '';
  if (runtime) await runtime.close();
}
