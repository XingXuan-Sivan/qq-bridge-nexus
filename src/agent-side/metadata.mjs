// Agent 侧平台元数据（控制台「Agent 平台」的数据源，B7）。
//
// 只回答「有哪些 Agent 平台、当前是哪个、各自声明了什么能力」。
//
// 为什么不走 runtime.mjs：agentRuntime() 要建一份连接层句柄（拉客户端、拿事件流），
// 而控制台在平台没连上、甚至一个都没注册时也要能把列表画出来并给出空态。
// 列表是注册表的静态事实，与「连没连上」无关。

// 装配点先求值：内置 Agent 平台在 builtin.mjs 的 import 里注册。独立调用本文件时
// （控制台路由、测试）不能指望别人已经装配过。
import './builtin.mjs';
import { activeAgentPlatformId, listAgentPlatforms } from './runtime-registry.mjs';

/**
 * `{ active, platforms: [{ id, label, capabilities, configSchema, owner, source, issues, active }] }`。
 *
 * `owner` / `source` 回答「这条是哪来的」（内置还是哪个插件）；`issues` 是注册表记下的装配结论
 * （自证失败 / 形状不合规 / 连不上），与「此刻连没连上」是两件事 —— 后者在 runtime.mjs 的单例里。
 */
export function agentPlatformMetadata() {
  const active = activeAgentPlatformId();
  return {
    active,
    platforms: listAgentPlatforms().map((impl) => ({ ...impl, active: impl.id === active })),
  };
}
