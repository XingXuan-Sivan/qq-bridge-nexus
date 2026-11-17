// DSH 运行期适配器的静态部分：能力声明 + 对端权限档 / agent preset 清单。
//
// 这里只放「平台差异」——会话权限级别（桥接自己的工具过滤器）、审批闸门语义都在 src/ 里，
// 不在这里。新增一个 Agent 平台时照本文件实现一份，并在 src/agent-side/builtin.mjs 注册。
//
// 为什么映射必须住在这里：`qq-full-ask` 是 DSH 0.2.0-rc.2 的预设名，`danger-full-access`
// 是它的沙箱名，`readonly/workspace/full` 是本仓库装进 DSH 的 agent preset 名。这些字符串
// 一旦出现在 src/ 里，内核就等于认识 DSH 了，B5 换平台时要再翻一遍。
//
// DSH 0.2.0-rc.2 的事实（已对照安装包源码核实，见 docs/guides/ADMIN_CHANNEL.md §DSH 事实）：
//   · 权限预设 = 沙箱模式（read-only / workspace-write / danger-full-access）+ 审批策略（ask / never）。
//     dsh-base 默认表：read-only(ask)、workspace-write(ask)、danger-full-access(**never**)。
//   · 预设表只能通过 profile 的 cordis.patch.yml 覆盖 `id: permission` 行的 config 来扩展
//     （settings 只能改 volatile 的 defaultPreset）。adapters/install.mjs 负责加入 qq-full-ask。
//   · 单个会话的预设只能通过 `commands/execute(sessionId, "/permission <名字>")` 设置
//     （与 DSH 官方 Web UI 的做法相同）；session.create 没有权限参数。
//   · `sessions.prompt` 不解析斜杠命令：用户发来的 "/permission ..." 文字只会作为普通文本进模型。
//   · Windows 上 read-only 沙箱只限制写、且是 partial（硬链接/NUL 等缝隙），读不受限。
//     因此只读能力档额外用 readonly agent preset 的**工具白名单守卫**挡掉写/执行类工具 ——
//     这道边界与操作系统无关。
//
// 能力档的 `runtime.peerPermission` 取值域就是下面的 PEER_PERMISSIONS：不含内置
// danger-full-access（审批策略 never = 不弹审批直接执行）。

export const agentPlatform = 'dsh';
export const id = 'dsh';
export const label = 'DeepSeek Harness';

/**
 * 认领的能力档生效方式。
 *
 * - `preset`：把能力档渲染成 agent preset 再挂到会话上；
 * - `passthrough`：不挂 preset、不套沙箱，会话直接跑在对端原生环境里，
 *   桥接只做追加（提示注入、会话编排）。MCP 不靠追加：它由安装期写进执行体配置。
 */
export const RUNTIME_APPLY = Object.freeze(['preset', 'passthrough']);

/**
 * 认领的提示注入通道（能力档 `runtime.prompt` 的取值）。
 *
 * DSH 的 `sessions/create` 没有 system prompt 参数，因此只能用 `prefix`：首轮唤醒把
 * 平台话术作为前缀带进去一次，后续唤醒不再重复；`tool` 是兜底——让模型自己去调
 * `admin（op=get_prompt）`。不在这里声明 `system`，桥接才会如实报 `passthrough_degraded`。
 */
export const RUNTIME_PROMPT = Object.freeze(['prefix', 'tool']);

/**
 * 实现的能力面（声明顺序即控制台展示顺序）。
 *
 * C5 起前七项与 `AgentPort` 的能力位**同名**（`src/agent-side/port.mjs`）；
 * 多出来的 `events` 不是调用面（会话事件流走客户端的 `events.follow`），但控制台要展示；
 * 少的 `maintenance` 是 DSH 实现不了的自愈动作（0.2.0 的 API 里没有对应 RPC）。
 * `prompt` 不在榜上：它是任何平台都必须实现的核心方法，不是可以关掉的能力位。
 */
export const capabilities = Object.freeze([
  'session', 'rename', 'permission', 'models', 'settings', 'workspace', 'events', 'compact',
]);

// ── 对端权限档 ──────────────────────────────────────────────────────────────

/**
 * 桥接「拥有」的权限预设：能力档 `runtime.peerPermission` 的取值域。
 *
 * 三项都在安装期写进 DSH profile（见 PERMISSION_PRESETS），并由 adapters/install.mjs 强制
 * 收紧回去 —— 用户把它们改宽（例如 approval: never）会让「只读 / 工作区 / 完全访问 + 审批」
 * 这三句承诺变成假话。会话建立时桥接按能力档钉一次，之后只随能力档变。
 */
export const PEER_PERMISSIONS = Object.freeze(['read-only', 'workspace-write', 'qq-full-ask']);

/** 完全访问 + 每次审批的预设定义（install.mjs 写入 profile；这里是唯一权威）。 */
export const FULL_ASK_PRESET = Object.freeze({
  sandbox: 'danger-full-access',
  approval: 'ask',
  name: 'QQ 桥接完全访问（每次审批）',
  description: '由能力档 runtime.peerPermission 选用；所有越权操作仍需 owner 审批',
});

/** 装进 profile 的权限预设表。保留 DSH 内置两项只是为了不改变 Web UI 里用户原有的选择。 */
export const PERMISSION_PRESETS = Object.freeze({
  'read-only': { sandbox: 'read-only', approval: 'ask' },
  'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
  'qq-full-ask': FULL_ASK_PRESET,
});

// ── agent preset（装进 DSH 的 agent 行）───────────────────────────────────────

/**
 * 由桥接托管的 agent preset id。顺序即 bundle patch 层顺序。
 * 取值是**能力档名**，不带用户平台前缀：同一个 `readonly` preset 对任何用户侧平台都成立，
 * 平台相关的差异（分条、@、媒体能力）走 prompt 层，不进 preset 名。
 */
export const AGENT_PRESET_IDS = Object.freeze(['chat', 'chat-v2', 'readonly', 'workspace', 'full']);

/**
 * 0.1.x 装出去的旧 preset 名 → 新名。
 *
 * 旧 profile 里可能还挂着 `qq-agent-readonly` 行，会话状态里也可能存着旧名；
 * 读到时归一即可，不必等用户重装。
 */
export const AGENT_PRESET_ALIASES = Object.freeze({
  'qq-chat': 'chat',
  'qq-chat-v2': 'chat-v2',
  'qq-agent-readonly': 'readonly',
  'qq-agent-workspace': 'workspace',
  'qq-agent-full': 'full',
});

/** 旧名归一为新名；不认识的名字原样返回（自建 preset 不能被改名）。 */
export function normalizeAgentPreset(name) {
  const value = String(name ?? '').trim();
  return AGENT_PRESET_ALIASES[value] ?? value;
}

/** 从 `/permission` 命令结果文本判断是否生效（rc.2 成功时返回 "preset <name>"）。 */
export function permissionCommandSucceeded(result, wanted) {
  const r = result?.result ?? result;
  if (!r || r.kind !== 'success') return false;
  const text = String(r.text ?? '');
  return text.includes(wanted);
}
