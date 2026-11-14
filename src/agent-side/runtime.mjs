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
import {
  clearAgentPlatformIssues,
  noteAgentPlatformIssue,
  requireAgentPlatform,
} from './runtime-registry.mjs';
import { CAPABILITY_OVERCLAIMED } from './port.mjs';

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

const messageOf = (error) => (error instanceof Error ? error.message : String(error ?? ''));

/**
 * 套一层门面，只为在 `port()` 装配失败时把结论记进注册表。
 *
 * 为什么要包：能力位是**平台自己声明**的，内核唯一的校验机会是 `createAgentPort` 的装配闸门
 * （未知能力位 / 声明了却漏实现 / 缺核心方法）。把那三类结论写进注册表，控制台诊断与测试
 * 都能看见「它自证失败」，而不是只在启动日志里留一行。
 *
 * 失败照抛（fail-closed）：一个声称能做却做不到的执行体，不能当主平台继续跑。
 * 边界：常量形态的能力位在 `port()` 里就求值，这里拦得住；协商制平台（能力位是函数）要到
 * 第一次查询才求值，那一层错误由调用方记日志 —— issues 是进程内的事实，进程在了才有控制台。
 */
function withAssemblyTracking(runtime, platformId) {
  const handle = { id: runtime.id, label: runtime.label, mode: runtime.mode };
  for (const name of RUNTIME_MEMBERS) {
    const fn = runtime[name];
    if (name !== 'port') {
      // 绑定回原句柄：适配器实现里用 this 取自己闭包状态的写法照常工作。
      handle[name] = (...args) => fn.apply(runtime, args);
      continue;
    }
    handle.port = (...args) => {
      try {
        const port = fn.apply(runtime, args);
        // 能装配起来就说明自证通过：旧结论不再成立（重建成功的平台不该继续背着旧账）。
        clearAgentPlatformIssues(platformId);
        return port;
      } catch (error) {
        if (error?.code === CAPABILITY_OVERCLAIMED) {
          noteAgentPlatformIssue(platformId, { code: CAPABILITY_OVERCLAIMED, message: error.message });
        }
        throw error;
      }
    };
  }
  return handle;
}

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
  let runtime;
  try {
    runtime = impl.createRuntime({
      config: options.config ?? {},
      log: options.log ?? (() => {}),
      onBaseUrlChange: options.onBaseUrlChange,
    });
  } catch (error) {
    // 连句柄都建不起来：对端没起、凭据缺失、地址不对都可能，一律按「执行体不可用」记
    // （与探活失败同一个结论：这一轮它跑不了）。原文照抛，调用方仍能拿到细节。
    noteAgentPlatformIssue(impl.id, { code: 'agent_instance_offline', message: messageOf(error) });
    throw error;
  }
  // 形状不完整属于「平台不符合契约」，与「暂时连不上」分开：前者要改实现，后者等对端。
  const missing = RUNTIME_MEMBERS.filter((name) => typeof runtime?.[name] !== 'function');
  if (missing.length) {
    const message = `createRuntime 返回的句柄缺少 ${missing.join(' / ')}`;
    noteAgentPlatformIssue(impl.id, { code: 'agent_provider_invalid', message });
    throw new Error(`Agent 平台 ${impl.id} 的 ${message}`);
  }
  if (!runtime.id || !runtime.label || !runtime.mode) {
    const message = 'createRuntime 必须声明 id / label / mode';
    noteAgentPlatformIssue(impl.id, { code: 'agent_provider_invalid', message });
    throw new Error(`Agent 平台 ${impl.id} 的 ${message}`);
  }
  current = withAssemblyTracking(runtime, impl.id);
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
