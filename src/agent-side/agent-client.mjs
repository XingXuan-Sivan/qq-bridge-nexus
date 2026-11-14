// Agent 侧的中立门面：主程序（bridge.js / self-test.js）只 import 这里。
//
// 为什么要有这一层：连接一个 Agent 平台需要三样东西——地址与凭据的发现方式、
// 一个 RPC 客户端、把返回包解开成值的约定。这三样在 DSH 里是
// `@deepseek-ai/dsh-host-apiproxy/client` 加一层鉴权胶水（见
// adapters/dsh/client.mjs），换个 Agent 平台就完全不同。门面把「要什么」与
// 「谁来做」分开：
//   · bridge.js 不再 import 任何 adapters/ 下的具体平台文件，也不再出现
//     NodeApiClient / discoverDshLaunchToken 这类 DSH 专有名字；
//   · 新增 Agent 平台只改 src/agent-side/builtin.mjs 一行。
//
// 这里用具名常量绑定而不是转发函数：协议实现是**模块级单例**（一个进程只有一套
// RPC 客户端工厂），与「当前平台」在会话级别切换无关；B5 阶段只装配一个平台。
// 若将来要按会话切平台，改成经 requireAgentPlatform() 逐次取即可，调用方不变。

import './builtin.mjs';
import { requireAgentPlatform } from './runtime-registry.mjs';

const protocol = requireAgentPlatform().protocol;

if (!protocol) {
  throw new Error('当前 Agent 平台未提供 protocol（检查 src/agent-side/builtin.mjs 是否把 client.mjs 装配进 protocol）');
}

/**
 * 门面绑定的一整套协议面成员。
 *
 * 为什么要在装配期整体检查：这些名字要么被下面的具名常量直接绑定，要么被 bridge 当
 * 函数调用；缺一个时 `AgentApiClient` 会变成 `undefined`，bridge 报的是
 * `AgentApiClient is not a constructor` —— 看不出是「配置指错平台」还是「平台实现写坏了」，
 * 会把人引去改协议代码。这里把失败提前到装配期，并直接说出缺了什么。
 *
 * 现状：只有「连一个常驻服务」这一类比平台拥有整套成员。以 spawn 子进程方式接入的
 * 平台（ACP）目前只有 AgentPort 与传输工厂，因此不能当主平台 —— 等它的连接层接线完成，
 * 把成员补齐即可解除限制，门面这边一行都不用改。
 */
const REQUIRED_PROTOCOL_MEMBERS = Object.freeze([
  'NodeApiClient',
  'discoverDshLaunchToken',
  'resolveDshHome',
  'discoverDshSessionCookie',
  'resolveDshBaseUrl',
  'dshBaseUrlCandidates',
  'looksLikeDsh',
  'detectDshDesktop',
  'createDshHealth',
  'classifyDshError',
  'createAgentPort',
  'unwrap',
  'createTurnCollector',
  'blocksToText',
]);

const missingMembers = REQUIRED_PROTOCOL_MEMBERS.filter((name) => typeof protocol[name] !== 'function');
if (missingMembers.length) {
  throw new Error(`当前 Agent 平台的 protocol 面缺少 ${missingMembers.join(' / ')}：这是「连一个常驻服务」所需的整套成员。`
    + '只提供 AgentPort 的平台要等连接层接线完成才能当主平台；请把 config.json 的 platforms.active.agent 指回一个协议面完整的平台');
}

// ── RPC 客户端 ──────────────────────────────────────────────────────────────

/** Agent 平台的 RPC 客户端类。原 DSH 名 NodeApiClient。 */
export const AgentApiClient = protocol.NodeApiClient;

// ── 地址与凭据发现 ──────────────────────────────────────────────────────────

/** 发现进程启动 token（新版 DSH 把它打印在 `dsh web` 的 URL 上）。 */
export const discoverLaunchToken = protocol.discoverDshLaunchToken;

/** Agent 主目录（凭据文件与历史启动日志都在这里）。 */
export const resolveAgentHome = protocol.resolveDshHome;

/** 从浏览器会话里发现 Cookie。 */
export const discoverSessionCookie = protocol.discoverDshSessionCookie;

/** 解析 Agent 服务的基础地址（配置留空时自己找端口）。 */
export const resolveAgentBaseUrl = protocol.resolveDshBaseUrl;

/** 候选基础地址（配置值 + 桌面版/命令行版的已知端口）。 */
export const listAgentBaseUrlCandidates = protocol.dshBaseUrlCandidates;

/** 这个地址看起来是不是本 Agent 平台（探活用，不做业务判断）。 */
export const looksLikeAgentEndpoint = protocol.looksLikeDsh;

/** 桌面版是否装着（只看安装痕迹，不启动它）。 */
export const detectAgentDesktop = protocol.detectDshDesktop;

// ── 探活与失败分类 ──────────────────────────────────────────────────────────

/** 连续 N 次失败才判定不可用（阈值 2，带原因分类与恢复记录）。 */
export const createAgentHealth = protocol.createDshHealth;

/** 把真实的 fetch 错误形状分成 refused / timeout / reset / auth / http / other。 */
export const classifyAgentError = protocol.classifyDshError;

// ── 操作契约（C5）─────────────────────────────────────

/**
 * 建一份 AgentPort：中立动词 + 能力位闸门。
 *
 * 参数是「连接对象」（现在是 DSH 的 `NodeApiClient` 实例）与可选的 `instance`
 * （写进会话引用，形如 `dsh` / `acp:claude`）。返回的值冻结，方法集只包含
 * 平台声明的能力位，未声明的调用会抛 `capability_unsupported`。
 */
export const createAgentPort = protocol.createAgentPort;

// ── 返回包解包与事件收集 ─────────────────────────────────────────────────────

/** 解开 { result } / { error } 包装；失败时抛带上下文的错误。 */
export const unwrap = protocol.unwrap;

/** 按轮次收集事件（turn/end、tool、approval）。 */
export const createTurnCollector = protocol.createTurnCollector;

/** 消息段数组 → 纯文本。 */
export const blocksToText = protocol.blocksToText;

// ── 平台元数据（B7）───────────────────────────────────────────────────────────
// 与上面的 protocol 绑定不同，这一项与「平台连没连上」无关：控制台在平台不可用时
// 也要能把列表画出来。所以它的实现读注册表而不是读 protocol。
export { agentPlatformMetadata } from './metadata.mjs';
