// ACP 运行期适配器的静态部分：能力声明 + 对端权限档入口。
//
// 与 dsh 那份（profiles/agent-platforms/dsh/adapters/runtime.mjs）同一个分工：这里只放
// 「平台差异」，内核的会话权限级别（桥接自己的工具过滤器）、审批闸门语义都在 src/ 里。
//
// ACP 为什么比 DSH 短很多，三条都是协议决定的，不是没写完：
//
//   1. **没有可安装的东西**：对端是任意实现了 ACP v1 的 Agent 进程，由适配器 spawn 并
//      托管（PLATFORM_UNIFICATION §十一 Q5）。没有 profile 要打补丁，因此没有
//      PERMISSION_PRESETS / PEER_PERMISSIONS 取值域（那两个常量的用途是「安装期写定预设
//      并收紧回去」，这里没有可写的对象）。
//   2. **模式名由对端定**：ACP 不规定 `availableModes` 里叫什么（`read-only` 与
//      `readOnly` 都合法）。桥接**不猜**：能力档 `runtime.peerPermission` 写的名字要在建立
//      会话时对上对端实时清单，对不上就 fail-closed —— 猜错的代价是「只读被设成一个完全
//      放开的模式」，比拒绝更贵。
//   3. **没有 agent preset 概念**：部分实现用无分类的 `agent` config option 暴露名单
//      （§9.1），那由 port 的 `listPresets` 动态读，桥接不声明静态清单。
//
// 只导出内核确实会读的成员（经 src/agent-side/runtime-registry.mjs）：多导一份没人读的表，
// 下次换平台时就是第二个真源。

export const agentPlatform = 'acp';
export const id = 'acp';
export const label = 'ACP（Agent Client Protocol）';

/**
 * 实现的能力面（声明顺序即控制台展示顺序）。
 *
 * 前三个与 `AgentPort` 的能力位同名（`src/agent-side/port.mjs`），并且是**上限**：
 * port 会在 `initialize` 之后按对端回执收缩 `session` 组（对端没声明 `session/close`
 * 就没有 archiveSession）。没有 rename / settings / workspace / compact / maintenance ——
 * ACP v1 里没有对应方法，不为缺口造伪能力（§十 第 3 条）。
 *
 * `events` 不是调用面：会话事件流经 `onEvent` 出口交给桥接（见 adapters/acp/port.mjs）。
 */
export const capabilities = Object.freeze(['session', 'permission', 'models', 'events']);

/**
 * 认领的能力档生效方式。
 *
 * `preset` 对 ACP 的含义是「用 `session/set_config_option` 选对端的 agent 档」——
 * 没有可安装的 profile，但对端声明了 `agent` 选项时这套选择确实成立；
 * `passthrough` 则不指定 agent，会话直接跑在对端默认环境里。
 */
export const RUNTIME_APPLY = Object.freeze(['preset', 'passthrough']);

/**
 * 认领的提示注入通道。
 *
 * ACP 的 `session/new` 带 `systemPrompt`（`append` 语义，2026-11-06 起稳定）：这是唯一
 * 能在**会话创建时**把话术交给对端的通道。`prefix` 不声明——ACP 没有「首轮前缀」这种
 * 概念，硬拼进第一条 prompt 会把平台规则混进用户消息。`tool` 仍是兜底。
 */
export const RUNTIME_PROMPT = Object.freeze(['system', 'tool']);

// ── 对端权限档 ──────────────────────────────────────────────────────────────

/**
 * 对端权限档的静态取值域：空 = 由对端决定，名单在建立会话后实时读。
 *
 * 桥接对空名单的处理是「不预设可选值，但写入前按对端实时清单核对」（见 bridge 的
 * pinSessionPermission）：对不上就 fail-closed，不退回到对端存在的更宽模式。
 */
export const PEER_PERMISSIONS = Object.freeze([]);

/**
 * `applyPermission` 的回执算不算成功。
 *
 * 与 DSH 的差别：ACP 的 `session/set_mode` **没有回执值**，`session/set_config_option`
 * 回的是新的 option。能确认的只有「RPC 成功 + 我们请求的就是这个名字」，
 * `current_mode_update` 是事件，不保证先于响应到达。所以判据是「回执说 ok 且名字一致」，
 * 不假装能读到对端的最终状态（要读就再调 `readPermission`）。
 */
export function permissionCommandSucceeded(result, wanted) {
  const r = result && typeof result === 'object' ? result : {};
  if (r.ok !== true) return false;
  return String(r.modeId ?? '') === String(wanted ?? '');
}
