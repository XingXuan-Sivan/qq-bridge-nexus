// Agent 侧的中立操作契约（`AgentPort`）：内核只认这一组动词（PLATFORM_UNIFICATION §五）。
//
// 与 agent-client.mjs 的分工：
//   · agent-client.mjs 解决「怎么连上」（地址发现、凭据、RPC 客户端类、解包）；
//   · 本文件解决「连上之后能干哪些事」，并把**能力位**（capability）做成可查询、可 fail-closed
//     的闸门 —— 与用户侧的段降级是同一种思路：声明了什么才做什么，没声明就报明确的错，
//     不做「静默降级成好像成功」。
//
// 三条硬规则（§5.3），都落在这里：
//   1. 能力缺失 fail-closed：`capability_unsupported`，不是 `port.x is not a function`；
//   2. 策略归桥接：port 不判断「该不该批准」，只负责把内核的决定送过去；
//   3. 会话引用去平台化：`{ instance, sessionId }`，接受裸字符串（迁移期兼容）。
//
// 这里不 import 任何 adapters/：契约是中立描述，实现由 builtin.mjs 装配。

/**
 * 能力位 → 该位下的方法。
 *
 * 为什么按组而不是逐方法声明：调用方关心的是「这个平台能不能做这几件事」，
 * 逐个方法声明会让 platform.yml / 控制台 / 诊断各维护一份长清单，且必然漂移。
 */
export const AGENT_PORT_GROUPS = Object.freeze({
  session: Object.freeze(['archiveSession', 'listPresets']),
  rename: Object.freeze(['renameSession']),
  // readPermission 是**只读核对**（「这个会话现在是什么预设」），与 applyPermission（设置）
  // 分开：外部漂移检测只允许读，绝不能因为一次核对就把权限写回去。
  permission: Object.freeze(['applyPermission', 'readPermission', 'respondPermission', 'listPermissionPresets']),
  models: Object.freeze(['listModels', 'selectModel']),
  settings: Object.freeze(['readSettings', 'writeSettings']),
  workspace: Object.freeze(['createWorkspace', 'renameWorkspace']),
  compact: Object.freeze(['compactSession']),
  maintenance: Object.freeze(['rebuildSession', 'healSession']),
});

/** 所有能力位（顺序即控制台与诊断里的展示顺序）。 */
export const AGENT_PORT_CAPABILITIES = Object.freeze(Object.keys(AGENT_PORT_GROUPS));

/**
 * 没有能力位、任何 port 都必须实现的方法。
 *
 * 少任何一个，桥接的核心链路（探活 → 建会话 → 发提示 → 收回复 → 取消）就断了，
 * 因此它们是硬要求，而不是能力位可以关掉的东西。
 */
export const AGENT_PORT_CORE_METHODS = Object.freeze([
  'probe',
  'listSessions',
  'ensureSession',
  'prompt',
  'cancel',
]);

/** 能力位缺位时抛的错误码（诊断与控制台展示用同一个字符串）。 */
export const CAPABILITY_UNSUPPORTED = 'capability_unsupported';

/** 能力位缺位。刻意单独一个类：调用方可以按类型区分「平台做不到」与「调用失败」。 */
export class AgentCapabilityError extends Error {
  constructor(id, capability, method) {
    super(`Agent 平台 ${id || '(未知)'} 未提供能力 ${capability}${method ? `（${method}）` : ''}`);
    this.name = 'AgentCapabilityError';
    this.code = CAPABILITY_UNSUPPORTED;
    this.agentPlatform = id || '';
    this.capability = capability;
    this.method = method || '';
  }
}

/** 归一事件类型（§5.2）：桥接只认这些 kind，平台怎么命名是适配器的事。 */
export const AGENT_EVENT_KINDS = Object.freeze([
  'text',
  'reasoning',
  'tool',
  'permission',
  'question',
  'plan',
  'usage',
  'compaction',
  'notice',
  'turn-end',
]);

/** 判断一个对象是不是已经归一过的事件（适配器自测与控制台预览共用）。 */
export function isAgentEvent(value) {
  if (!value || typeof value !== 'object') return false;
  return AGENT_EVENT_KINDS.includes(String(value.kind ?? ''));
}

/**
 * 会话引用归一：接受 `{ instance, sessionId }` 或裸 sessionId。
 *
 * 调用面已经全部走对象或裸字符串两种写法（bridge 仍传裸 sessionId，因为会话 key 是桥接
 * 自己的概念）；落盘格式统一成 `agentRef` 由 C5 第三批做。这里只做形状归一，不判断平台 ——
 * `instance` 缺省时用 port 自己的 id。
 */
export function normalizeSessionRef(ref, instance = '') {
  if (ref && typeof ref === 'object' && !Array.isArray(ref)) {
    const sessionId = String(ref.sessionId ?? '').trim();
    if (!sessionId) throw new Error('AgentPort: 会话引用缺少 sessionId');
    return { instance: String(ref.instance ?? instance ?? '').trim(), sessionId };
  }
  const sessionId = String(ref ?? '').trim();
  if (!sessionId) throw new Error('AgentPort: 会话引用为空');
  return { instance: String(instance ?? '').trim(), sessionId };
}

/** 能力位 → 方法名反查：`methodCapabilityOf('selectModel')` → `'models'`。 */
export function methodCapabilityOf(method) {
  const name = String(method ?? '').trim();
  for (const [capability, methods] of Object.entries(AGENT_PORT_GROUPS)) {
    if (methods.includes(name)) return capability;
  }
  return AGENT_PORT_CORE_METHODS.includes(name) ? '' : null;
}

/**
 * 把一份「实现」包成带能力闸门的 port。
 *
 * - `capabilities` 缺省 = 全部能力位（实现方可以只给子集，未给的那几组会自动变成抛错桩）；
 * - 每个未声明的方法都**存在**，调用时抛 `AgentCapabilityError` —— 这样报错能说清「缺哪个能力」，
 *   而不是让调用方撞上 `TypeError: not a function`（那种错误无法区分平台不支持与写错名字）；
 * - 返回值冻结：port 是运行期共享对象，调用方改它等于改所有人的契约。
 *
 * 返回值的形状约定（所有实现都必须遵守）：语义字段（`sessions` / `sessionId` / `preset` …）
 * 是已解包的，`raw` 永远是平台返回的**原始响应**——需要在错误日志里看一眼平台原话时用它。
 *
 * `prompt()` 的返回是**中立形状** `{ ok, isCommand, commandText, error, raw }`（C6）：`ok` 是「消息是否被受理」，
 * `isCommand` 是「平台把它当斜杠命令直接执行了，不会有模型回合」，`commandText` 是那条命令的回执文本，
 * `error` 是 `{ code, message } | null` 而**不是**平台的包。DSH 的 `{result:{ok,error,value}}`、
 * ACP 的 JSON-RPC 错误，都在各自的适配器里拍平 —— 内核不该知道任何一个平台的包长什么样
 * （否则换平台时这条泄漏会变成硬约束）。
 *
 * @param {{id: string, label?: string, capabilities?: string[]|(() => string[]), impl: object}} spec
 *   `capabilities` 可以是常量数组，也可以是**函数**（每次查询现算）。后者是为了协商制平台：
 *   ACP 的能力位来自 `initialize` 回执，进程启动时并不存在；用函数才能让同一份 port
 *   在「未连接 → 已连接」之间自然演进，而不是被冻结在构造时那一刻。
 */
export function createAgentPort({ id, label = '', capabilities = AGENT_PORT_CAPABILITIES, impl } = {}) {
  const platformId = String(id ?? '').trim();
  if (!platformId) throw new Error('createAgentPort: 缺少 id');
  if (!impl || typeof impl !== 'object') throw new Error(`createAgentPort: ${platformId} 缺少实现`);

  /**
   * 现算一次能力位。**刻意不缓存**：函数形态下「连接前空集、连接后全集」是正常演进，
   * 缓存下来只会让控制台永远显示「没有能力」。常量形态下这点开销可以忽略（数组很短）。
   */
  const declaredNow = () => {
    const raw = typeof capabilities === 'function' ? capabilities() : capabilities;
    const list = [...new Set((raw ?? []).map((name) => String(name).trim()).filter(Boolean))];
    const unknown = list.filter((name) => !AGENT_PORT_CAPABILITIES.includes(name));
    if (unknown.length) throw new Error(`createAgentPort: ${platformId} 声明了未知能力 ${unknown.join(', ')}`);
    // 「声明了某个位却漏实现方法」以前在构造时就炸；延迟求值后改在第一次求值炸。
    // 仍然是 fail-fast，只是时机晚到「平台真正连上之后」——那时才知道它声明了什么。
    const holes = list.flatMap((capability) => AGENT_PORT_GROUPS[capability]
      .filter((name) => typeof impl[name] !== 'function')
      .map((name) => `${capability}.${name}`));
    if (holes.length) throw new Error(`createAgentPort: ${platformId} 声明了能力但没实现 ${holes.join(', ')}`);
    return list;
  };

  const missingCore = AGENT_PORT_CORE_METHODS.filter((name) => typeof impl[name] !== 'function');
  if (missingCore.length) throw new Error(`createAgentPort: ${platformId} 缺少核心方法 ${missingCore.join(', ')}`);

  // 常量形态在构造时先跑一遍：装配错误（拼错能力名、声明了却没实现）必须在启动时就暴露，
  // 不能等到某个按钮被点下去才发现。函数形态没法在构造时求值（ACP 那时还没 initialize），
  // 只能退到「第一次查询或调用时」——这是延迟求值的必要代价，不是疏漏。
  if (typeof capabilities !== 'function') declaredNow();

  const port = { id: platformId, label: label || platformId };
  // 用 getter 而不是数据属性：能力位是活的，赋值时拿到的快照会立刻过期。
  Object.defineProperty(port, 'capabilities', {
    enumerable: true,
    get: () => Object.freeze(declaredNow()),
  });

  const bind = (name) => {
    const fn = impl[name];
    if (typeof fn !== 'function') throw new Error(`createAgentPort: ${platformId} 声明了能力但没实现 ${name}`);
    // 绑定到 impl：实现里用 this 访问 client 的写法（与出站 transport 的 create() 产物同构）能正常工作。
    return (...args) => fn.apply(impl, args);
  };

  for (const name of AGENT_PORT_CORE_METHODS) port[name] = bind(name);
  for (const capability of AGENT_PORT_CAPABILITIES) {
    for (const name of AGENT_PORT_GROUPS[capability]) {
      // 每次调用都过一遍闸门：能力位可能是协商出来的，构造时就绑死会把「后天获得的能力」判死。
      port[name] = (...args) => {
        if (!declaredNow().includes(capability)) throw new AgentCapabilityError(platformId, capability, name);
        const fn = impl[name];
        if (typeof fn !== 'function') throw new AgentCapabilityError(platformId, capability, name);
        return fn.apply(impl, args);
      };
    }
  }

  /** 这个 port 有没有某个能力位。缺省查询（不传参）返回当前声明的能力位数组。 */
  port.supports = (capability) => {
    const name = String(capability ?? '').trim();
    const list = declaredNow();
    if (!name) return [...list];
    return list.includes(name);
  };

  return Object.freeze(port);
}
