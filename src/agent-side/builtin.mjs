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
//   · **协议面**（src/agent-side/adapters/<id>/client.mjs）：RPC 客户端、鉴权、事件解包——
//     依赖 npm SDK 与本机凭据，只在 Node 侧装配。
// 声明面不 import 协议面（否则 profiles 会反向依赖 src/ 的实现），因此由本文件
// 用 `protocol` 字段把两者接上。
//
// C5 起 protocol 多了一项 `createAgentPort`：把「连上之后的动词」（会话 / 回合 / 权限 /
// 模型 / 设置 / 工作区 / 压缩）包成中立的 AgentPort。包能力闸门的那一层在 src/agent-side/port.mjs，
// 平台只提供实现与「自己支持哪几个能力位」。
//
// C6 的 acp 是第二个平台，它的 protocol 面**只有两项**，这是刻意的：
//   · DSH 的协议面里塞了一整套「连一个常驻 HTTP 服务」的东西（地址发现、Cookie、鉴权头、
//     探活分类），ACP 一样都不需要 —— 连接是 spawn 一个子进程，进程边界就是信任边界；
//   · 因此 acp 没有 `NodeApiClient`。主程序的门面（src/agent-side/agent-client.mjs）绑定的
//     正是这套「连常驻服务」的成员，它会在装配期用一条明确的错误拒绝 acp 当主平台，
//     而不是让 bridge 撞上 `AgentApiClient is not a constructor`。等接线批次把连接层
//     补上（§9.1 收尾），这条限制自然解除。
import * as dsh from '../../profiles/agent-platforms/dsh/adapters/runtime.mjs';
import * as acp from '../../profiles/agent-platforms/acp/adapters/runtime.mjs';
import * as dshProtocol from './adapters/dsh/client.mjs';
import * as dshEndpoint from './adapters/dsh/endpoint.mjs';
import * as dshHealth from './adapters/dsh/health.mjs';
import * as dshPort from './adapters/dsh/port.mjs';
import { createAcpClient } from './adapters/acp/client.mjs';
import { createAcpPort } from './adapters/acp/port.mjs';
import { createAgentPort } from './port.mjs';
import { registerAgentPlatform } from './runtime-registry.mjs';

/**
 * 内置平台清单（顺序即控制台展示顺序）。
 *
 * **顺序也是默认 active**（注册表把第一个当默认）：dsh 必须留在首位，直到 acp 的
 * 连接层接线完成。调换顺序会让一个每次调用都报「协议面不完整」的平台成为默认。
 */
export const BUILTIN_AGENT_PLATFORMS = Object.freeze([
  {
    ...dsh,
    protocol: {
      ...dshProtocol,
      ...dshEndpoint,
      ...dshHealth,
      // 能力位来自适配器的 `DSH_AGENT_CAPABILITIES`（只含调用面：会话 / 重命名 / 权限 /
      // 模型 / 设置 / 工作区 / 压缩）。与声明面 `dsh.capabilities` 的差异都是刻意的：
      // 声明面多一个 `events`（事件流订阅，不属调用面），少一个 `maintenance`
      // （DSH 没有重建/自愈的 RPC）。两者的一致性由 `test-agent-port` 钉住。
      createAgentPort: (client, opts = {}) => createAgentPort({
        id: dsh.id,
        label: dsh.label,
        capabilities: dshPort.DSH_AGENT_CAPABILITIES,
        impl: dshPort.createDshPort({ client, ...opts }),
      }),
    },
  },
  {
    ...acp,
    protocol: {
      // 「怎么连上」：ACP v1 只有 stdio，连接就是 spawn 子进程。字段名与
      // profiles/agent-platforms/acp/agent-platform.yml 的 configSchema 一致。
      createAcpClient,
      // 「连上之后能做什么」。能力位是**函数**：ACP 的能力来自 `initialize` 回执，
      // 装配这一刻还不存在（C6-b 的延迟求值就是为协商制平台加的）。
      createAgentPort: (client, opts = {}) => {
        const { impl, capabilities } = createAcpPort({ client, ...opts });
        return createAgentPort({
          id: acp.id,
          label: acp.label,
          capabilities,
          impl,
        });
      },
    },
  },
]);

/** 幂等注册；重复调用只是覆盖同 id 的实现。 */
export function registerBuiltinAgentPlatforms() {
  for (const impl of BUILTIN_AGENT_PLATFORMS) registerAgentPlatform(impl);
  return BUILTIN_AGENT_PLATFORMS.map((impl) => impl.id);
}

registerBuiltinAgentPlatforms();
