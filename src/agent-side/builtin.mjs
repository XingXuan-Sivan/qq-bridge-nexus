// 仓库内置 Agent 平台的装配点。
//
// 这是「src/ 里唯一允许出现具体 Agent 平台名」的地方：新增平台在这里加一行 import
// 与一次注册，其余内核模块只认 src/agent-side/runtime-registry.mjs。
//
// 平台模块只导出常量与纯函数（能力声明、权限映射、preset 名），没有副作用，
// 因此可以在 import 时直接注册；测试若需要空注册表，用 resetAgentPlatforms() 清空。
import * as dsh from '../../profiles/agent-platforms/dsh/adapters/runtime.mjs';
import { registerAgentPlatform } from './runtime-registry.mjs';

/** 内置平台清单（顺序即控制台展示顺序）。 */
export const BUILTIN_AGENT_PLATFORMS = Object.freeze([dsh]);

/** 幂等注册；重复调用只是覆盖同 id 的实现。 */
export function registerBuiltinAgentPlatforms() {
  for (const impl of BUILTIN_AGENT_PLATFORMS) registerAgentPlatform(impl);
  return BUILTIN_AGENT_PLATFORMS.map((impl) => impl.id);
}

registerBuiltinAgentPlatforms();
