/**
 * 启动期把配置里的 `platforms.active` **真正落到运行期**。
 *
 * 为什么单独一支：历史上 `platformOfConfig(cfg)` 只被拿去拼会话 key，
 * 从来没有调用过 `useUserPlatform()` —— 于是「把 config.json 的 platform.id 改成别的」
 * 既不报错也不生效，进程照旧跑在启动时默认注册的那个平台上。这类静默串号比启动失败更难查。
 *
 * 两条约定：
 *   · 两侧都 fail-closed：id 没注册就直接抛，并把可用的 id 列出来；
 *   · 为空则不干预：沿用注册表默认值（配置文件没写这一项不算错）。
 *
 * 依赖注入只为了让测试不必真的内置平台：默认参数就是运行期注册表本身。
 */

import { listUserPlatforms, useUserPlatform } from '../user-side/runtime-registry.mjs';
import { listAgentPlatforms, useAgentPlatform } from '../agent-side/runtime-registry.mjs';

function activateOne({ side, id, use, list }) {
  const wanted = String(id ?? '').trim();
  if (!wanted) return;
  try {
    use(wanted);
  } catch (error) {
    const available = list().map((item) => item.id).join(' / ') || '无';
    const sideLabel = side === 'agent' ? 'Agent 平台' : '用户侧平台';
    throw new Error(`配置 platforms.active.${side} = ${wanted} 不可用：${error?.message ?? error}（已注册的${sideLabel}：${available}）`);
  }
}

/**
 * 激活用户侧与 Agent 侧的平台。
 *
 * @param {{platforms?: {active?: {user?: string, agent?: string}}}} cfg  `loadConfig()` 的结果
 * @param {{userRegistry?: object, agentRegistry?: object}} [deps]      测试注入
 */
export function activatePlatforms(cfg, { userRegistry, agentRegistry } = {}) {
  const active = cfg?.platforms?.active ?? {};
  const user = userRegistry ?? { use: useUserPlatform, list: listUserPlatforms };
  const agent = agentRegistry ?? { use: useAgentPlatform, list: listAgentPlatforms };
  activateOne({ side: 'user', id: active.user, use: user.use, list: user.list });
  activateOne({ side: 'agent', id: active.agent, use: agent.use, list: agent.list });
}
