// 仓库内置 Agent 平台的装配点。
//
// 这是「src/ 里唯一允许出现具体 Agent 平台名」的地方：新增平台在这里加一行 import
// 与一次注册，其余内核模块只认 src/agent-side/runtime-registry.mjs。
//
// 平台模块只导出常量与纯函数（能力声明、权限映射、preset 名），没有副作用，
// 因此可以在 import 时直接注册；测试若需要空注册表，用 resetAgentPlatforms() 清空。
//
// 每个平台有两个面，它们在这里被拼成一个实现：
//   · **声明面**（profiles/agent-platforms/<id>/adapters/runtime.mjs）：能力、权限映射、
//     preset 清单——纯常量与纯函数，可以在浏览器端复用；
//   · **连接面**（src/agent-side/adapters/<id>/runtime.mjs 的 createRuntime）：地址与凭据
//     怎么发现、客户端怎么建、事件怎么收成一轮、失败怎么分类。
// 声明面不 import 连接面（否则 profiles 会反向依赖 src/ 的实现），因此由本文件用
// `createRuntime` 字段把两者接上。
//
// 调用面（会话 / 回合 / 权限 / 模型 / 设置 / 工作区 / 压缩）不在这里：平台只提供
// createRuntime，中立的 AgentPort 由连接层装配（见 adapters/<id>/runtime.mjs）。
import * as dsh from '../../profiles/agent-platforms/dsh/adapters/runtime.mjs';
import * as acp from '../../profiles/agent-platforms/acp/adapters/runtime.mjs';
import { createRuntime as createDshRuntime } from './adapters/dsh/runtime.mjs';
import { createRuntime as createAcpRuntime } from './adapters/acp/runtime.mjs';
import { registerAgentPlatform } from './runtime-registry.mjs';

/** 内置平台清单（顺序即控制台展示顺序，也是未配置时的默认）。 */
export const BUILTIN_AGENT_PLATFORMS = Object.freeze([
  { ...dsh, createRuntime: createDshRuntime },
  { ...acp, createRuntime: createAcpRuntime },
]);

/** 幂等注册；重复调用只是覆盖同 id 的实现。 */
export function registerBuiltinAgentPlatforms() {
  for (const impl of BUILTIN_AGENT_PLATFORMS) registerAgentPlatform(impl);
  return BUILTIN_AGENT_PLATFORMS.map((impl) => impl.id);
}

registerBuiltinAgentPlatforms();
