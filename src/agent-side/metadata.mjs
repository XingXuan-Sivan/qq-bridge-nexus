// Agent 侧平台元数据（控制台「Agent 平台」的数据源，B7）。
//
// 只回答「有哪些 Agent 平台、当前是哪个、各自声明了什么能力」。
//
// 为什么不复用 agent-client.mjs：那个门面在 import 时就 requireAgentPlatform().protocol，
// 也就是「至少有一个平台装着协议」才算可用；而控制台在平台没连上、甚至一个都没注册时
// 也要能把列表画出来并给出空态。列表是注册表的静态事实，与协议无关。

// 装配点先求值：内置 Agent 平台在 builtin.mjs 的 import 里注册。独立调用本文件时
// （控制台路由、测试）不能指望别人已经装配过。
import './builtin.mjs';
import { activeAgentPlatformId, listAgentPlatforms } from './runtime-registry.mjs';

/** `{ active, platforms: [{ id, label, capabilities, active }] }` —— 全是常量。 */
export function agentPlatformMetadata() {
  const active = activeAgentPlatformId();
  return {
    active,
    platforms: listAgentPlatforms().map((impl) => ({ ...impl, active: impl.id === active })),
  };
}
