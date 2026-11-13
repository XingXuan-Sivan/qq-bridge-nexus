# 用户侧 / Agent 侧平台解耦规格

- 状态：设计规格（v1）。基于 `docs/_internal/DECOUPLING_AUDIT.md` 的现状清单与四条前置决策。
- 前置决策（已定）：
  1. 用户侧**支持多平台同时在线**。
  2. 会话 id **接受非数字**（Telegram username、B 站直播间号、thread id 等）。
  3. `interface-platform` **可合并**——合并其"模型与映射"，不合并其"网关服务"（理由见 §4）。
  4. 插件**可以接管连接**（`transport:provide`）。
- 与既有工作的关系：P0 目录（`artifacts/`）、P1 构建/安装适配器、P3 模式存储后端均已落地，本规格在其上加"运行期适配器"与"地址模型"，不推翻。

---

## 1. 目标

一句话：**加一个用户平台或一个 Agent 平台 = 加一个目录，内核代码零改动**；插件可以用同一套契约提供实现。

拆成四条可验收的命题：

| 命题 | 验收方式 |
| --- | --- |
| 用户侧可插拔 | 新增 mock 平台（无网络、内存收发）后，会话/准入/定时/记忆/权限全流程可用，且 `src/` 无该平台字面量 |
| Agent 侧可插拔 | 新增 mock Agent 平台后，会话装配/提示/审批/模型列表/压缩全流程可用 |
| 多平台并存不串号 | 同一进程内 qq 与 mock 平台同时有活跃会话；跨平台上下文产出的 key 必须报错而非静默写错 |
| 插件可接管连接 | 插件注册 transport 后，其入站消息仍经过内核准入/权限/水位，出站仍走统一发送出口 |

---

## 2. 地址模型（本轮最关键的改动）

### 2.1 现状缺口

`src/session/key.mjs` 的主键是 `<platform>:<kind>:<id>`，三个问题：

1. **没有账号维度**。SnowLuma 与 NapCat 各带一个 QQ 号同时在线时，两者都是 `platform=qq`，同一个群号会指向两个不同的机器人身份 → 数据互相覆盖。
2. **`kind` 是 QQ 二分法** `group|private`，挡住 Telegram channel / Discord thread / B 站直播间。
3. **`id` 必须 `^\d+$` 且被 `Number()` 化**，非数字地址无法表达，且超过 2^53 会截断（`interface-platform/CONTRACT.md` 明确要求按不透明字符串处理，两处标准冲突）。

### 2.2 目标形态

```
<platform>[@<account>]:<type>:<id>
```

- `platform`：`^[a-z][a-z0-9-]{0,15}$`（不变）
- `account`：可选，`^[a-z0-9][a-z0-9._-]{0,31}$`；省略表示"该平台的默认账号"
- `type`：**开放**。不再是固定枚举，而是"内核理解的会话类型 + 平台自定义类型"
- `id`：**一律字符串**，长度 1–128，禁止 `/`、`\`、`:`、空白与控制字符；不做数字校验

向后兼容：

| 旧形态 | 新形态 | 说明 |
| --- | --- | --- |
| `qq:group:123` | `qq:group:123` | 完全不变（默认账号） |
| `group:123` | `qq:group:123` | 读取侧继续兼容（`legacyToKey`） |
| — | `qq@napcat:group:123` | 新增：具名账号 |
| — | `telegram:channel:@somechannel` | 新增：非数字 id、非 group/private 类型 |

### 2.3 内核理解的类型 vs 平台类型

内核只对**三种**类型有语义，其余原样透传：

| 类型 | 内核含义 | 谁映射 |
| --- | --- | --- |
| `group` | 多方会话（群/频道/服务器频道/直播间） | 平台适配器把自身概念映射到它 |
| `direct` | 一对一（私聊/私信/DM） | 同上 |
| `temp` | 群内临时会话（QQ 专有，保留但不新增使用方） | 同上 |

`parseKey()` 返回的 `type` **保留原文**（写 `private` 读回来还是 `private`），另有一个归一层 `shape`：`private` / `direct` / `dm` / `chat` 都归一成 `direct`，`group` / `temp` 各自归一。内核判"是不是群"只看 `shape`，判断两个 key 是不是同一会话（`sameSession`）也比 `shape` 而不是 `type`。

平台自有类型（如 `thread`、`live`）写进 key 的 `type` 段时，`shape` 回落到该类型本身（既不是 `group` 也不是 `direct`）；接入方如果需要它被当多方会话处理，就在自己的适配器里映射成 `group`，不靠内核猜。

### 2.4 平台上下文（防串号）

`key()` 现在是进程级单例（`configureKeys()`，`key.mjs:113-120`）。多平台并存下必须二选一：

- **主流程显式传参**：事件对象带 `platform` / `account`，所有 key 构造从事件派生。
- **辅助模块走上下文**：`src/social/*`、`scheduler`、`voice-core` 等 15 个 import 了 `session/key.mjs` 的模块，用 `withAddress({ platform, account }, fn)`（AsyncLocalStorage，bridge 已有 `behaviorContext` 先例）包裹。

落地规则：

1. `key()` 的地址优先级：显式地址参数 > `withAddress()` 上下文 > 进程默认（`configureKeys()` 注册的平台/账号）。**`strict: true`** 时（多平台部署启用）没有显式地址或上下文就直接抛错。
2. 新增 `keyFor(platform, type, id, account?)` 供无法使用上下文的场景（如 MCP 独立进程）。
3. 测试加"跨平台串号"用例：在 `withAddress(qq)` 内调用 `keyFor(telegram, ...)` 必须被显式允许（说明调用方知情），而 `withAddress()` 上下文不能泄漏到外层。

**这一步不做"读旧数据自动猜平台"**：猜错比报错贵得多。

---

### 2.5 实施偏差（B2 – B5 落地时相对上述设计的取舍）

| 项 | 设计 | 实施 | 理由 |
| --- | --- | --- | --- |
| `private` 改写 | 新写入一律 `direct` | **不改写**，`type` 保留原文，另给归一后的 `shape` | 改写等于把 `sessions.json`、`people`、`roles`、`memory` 全部重键；风险极高、收益为零。`shape` 已经满足"内核只认语义"的目标 |
| `key()` 无上下文 | 直接抛错 | 回落到进程默认，另有 `strict` 开关 | 单平台部署下启动、定时 tick 等离线路径没有事件上下文，强制抛错会让整条链断掉。多平台部署（B5）打开 `strict` |
| 数据迁移脚本 | `sessions.json` 迁移脚本 | **不做** | 新文法是旧文法的超集，`qq:group:123` 原样可读、`group:123` 由 `legacyToKey` 读出，没有数据需要改写 |
| id 数值归一 | 不做数字校验 | 纯数字 id 去前导零（`0456` → `456`），仍不做 `Number()` 转换 | 旧实现用 `Number()` 归一，去掉会破坏"限频/定时按 key 相等判同一会话"；但保留 `Number()` 又会截断超 2^53 的群号 |
| owner 形态校验（B3） | 沿用 `QQ_RE = /^[1-9]\d{4,11}$/` | **移除**，只校验地址结构（非空、分离出 platform/account/id、必须 direct） | 该正则隐式绑定 QQ 号段；微信 / Telegram 的 id 形态各不相同。平台 id 的形态规则应由 B5 的平台能力声明提供 |
| `cfg.ownerQQ` 去留（B3） | 直接删除 | 保留为**派生视图**（仅当 owner 落在本进程平台、无 account、纯数字时回落为 number） | 旧控制台、插件、日志仍有读 `ownerQQ` 的调用；唯一的真相是 `cfg.owner`，派生值在 `loadConfig` / `noteOwnerChange` / `/api/whitelist` 三处统一计算 |
| 裸 id 的归属（B3） | 全局唯一裸 id | 裸 id 只在**本进程平台且同账号**下解释；换平台或换账号的同号是不同人 | 多账号下 `qq@napcat:10001` 与 `qq@snowluma:10001` 是两个账号，不按 id 混同 |
| `ownerQQ` DOM id（B3） | —— | 控制台字段与 `/api/whitelist` 的键改为 `owner`；`ownerQQ` 移入 `console-ui-retired-ids.json` | 接口仍接受 `ownerQQ` 作为回退（旧脚本、旧前端不炸），但新前端只发 `owner` |
| 映射落点（B4） | 内核 `src/admin/` 里的常量表 | 拆成三层：`src/agent-side/runtime-registry.mjs`（中立注册表，零平台名）+ `src/agent-side/builtin.mjs`（唯一装配点）+ `profiles/agent-platforms/dsh/adapters/runtime.mjs`（映射与能力声明的权威源） | 让 `src/admin/*` 直接 import `profiles/agent-platforms/dsh/` 会让内核反向依赖具体平台，违反 §7.2；注册表同时把 B5 的 AgentPlatform 接口提前落地 |
| preset 名（B4） | `chat / readonly / workspace / full` | 按上述改名（旧 `qq-chat` / `qq-chat-v2` / `qq-agent-*`），另留 `AGENT_PRESET_ALIASES` 读入归一 | 改名是硬约束（§3.5），但旧 `config.json`、旧 profile 不该因一次升级就报错；归一放在 `loadConfig`、`resolveLevelPlan` 的 `presetIds`、`agentPresetLevel` 反查三处 |
| bundle 包名（B4） | 一并去前缀 | **不改**：`artifacts/dsh/qq-agent-presets/` 与权限预设名 `qq-full-ask` 保持原样 | 前者是 profile `package.json` 的 `link:` 依赖名与守卫行的裸说明符（`qq-agent-presets/qq-tool-restrict.mjs`），改名要连带 node_modules junction 与环境自愈；后者是 DSH profile `cordis.patch.yml` 里的 preset id，属平台侧命名。二者都在「Agent 平台内部」，不构成内核耦合 |
| 旧 DSH 会话（B4） | 自动迁移 | 不迁移，`install` 适配器只在安装时**报告**残留的旧 preset 目录/patch，由用户重建会话 | dsh 侧会话绑定的是 preset id，桥接无法安全改写；`state/sessions/*.json` 只存 `planId` 不存 raw preset 名，故桥接自身无需迁移 |
| 适配器边界（B5） | §3.1 约定下的全部平台相关模块 | 只下沉**传输层**：`dsh-client` / `dsh-endpoint` / `dsh-health` / `onebot` / `qq-backend-label` / `prompt`；`dsh-model`、`qq-model-view`、`mcp-snowluma-safe`、`snowluma-conn` 留在 `src/` | `adapters/` 回答的是「怎么连上平台」；「连上之后拿它做什么」（模型目录视图、MCP 桥、控制台文案）属内核业务，随 B7/B8 元数据化再收敛。一次搬完会让 B5 的回归面从「路径等价」扩大到「行为等价」 |
| `snowluma-conn.js`（B5） | 一并下沉进 `adapters/qq/` | **不动**，仍在 `src/` 根，登记为唯一豁免 | 它是仓库外独立工具（`voice-tool/`）按固定路径引用的**外部契约**，`scripts/test-snowluma-conn.mjs` 钉死了这个路径；移动会打断仓库外调用方 |
| `bridge-extensions.js` 直连（B5） | 全部经门面 | 保留**一处**直连 `user-side/adapters/qq/qq-backend-label.js` | `qqBackendLabel` / `qqBackendFromVersionInfo` 是 0.1.x 的公开导出名，文件名也被 `scripts/test-qq-backend-label.mjs` 钉住；门面用的是中立名（`describeBackend` / `readBackendInfo`），凭空造不出旧名字。测试从「一律禁止」改成「只允许这一条」的精确比对 |
| 声明面与协议面（B5） | 适配器是一个模块 | 拆成两面：`profiles/agent-platforms/<id>/adapters/runtime.mjs`（能力、权限映射、preset 清单——纯常量与纯函数）与 `src/agent-side/adapters/<id>/`（RPC 客户端、鉴权、事件解包），由 `builtin.mjs` 用 `protocol` 字段拼装 | 声明面被构建期适配器与浏览器端复用，不能 import 依赖本机凭据与 npm SDK 的协议面；让它反向依赖 `src/` 等于把四层模型变成内核的从属物 |
| 门面导出方式（B5） | 统一 `export const X = impl.X` | Agent 侧 `export const X = protocol.X`（协议是模块级单例）；用户侧一律**转发函数** | 用户侧将来要在同一进程里切多个平台（多平台在线），把引用绑死在模块加载期会拿到启动时的那一个 |
| 夹具同步（B5） | —— | 审计夹具注入表改按门面的中立名补回（`buildSendCall` / `describeBackend` / `readBackendInfo` / `AgentApiClient` / `discoverLaunchToken` / `resolveAgentHome`） | 夹具剥掉 bridge 的 import 后靠同名注入提供绑定；改名不同步会让 bridge 落到门面的**真实现**上。`resolveAgentBaseUrl` 尤其致命：真实现会扫本机进程找 DSH，单次启动多花约 0.8 秒，把 `test-backfill` 里「记原始发送时间」的 2 秒容差顶成随机失败。现在由 `test-platform-adapters.mjs` 钉住「地址发现必须离线桩掉、注入表不得残留旧符号」 |

---

## 3. 两侧适配器契约

### 3.1 目录约定（与 P1 的构建期适配器同址）

```
profiles/platforms/<id>/
├── platform.yml            # 元数据：label、capabilities、configSchema、limits
├── prompt.md               # 平台话术（已有）
├── behaviors/              # 行为档案（已有）
├── tools.yml               # 平台工具声明（已有）
└── adapters/
    ├── runtime.mjs         # 运行期：create({ config }) → UserPlatform
    ├── build.mjs           # 构建期（可选）：产物清单
    └── install.mjs         # 安装期（可选）：依赖 / 后端安装

profiles/agent-platforms/<id>/
├── agent-platform.yml
├── agents/ capabilities/ templates/
└── adapters/
    ├── runtime.mjs         # 运行期：create({ config }) → AgentPlatform
    ├── build.mjs           # 已有
    └── install.mjs         # 已有
```

调度器按 `adapters/runtime.mjs` 是否存在发现运行期平台（与 P1 的"约定优于声明"一致；`agent-platform.yml` 不加字段）。

### 3.2 UserPlatform（用户侧）

```js
export const id = 'qq';
export const capabilities = Object.freeze([
  'group', 'direct', 'mention', 'reply', 'recall', 'poke',
  'image', 'voice', 'sticker', 'file', 'forward', 'member-list', 'member-info',
]);
export const limits = Object.freeze({ chunkChars: 3000, markdown: false, maxChunks: 4 });

// 连接生命周期；实现自己决定轮询/WS/回调
export async function connect({ signal, onEvent, onStatus }) {}
export async function close() {}

// 唯一发送出口。segments 是中立段（§3.4），实现负责映射与本平台降级
export async function send(address, segments, opts = {}) {}
//   address: { platform, account, conversation: { type, id } }
//   opts: { replyTo?: string, mention?: [string], silent?: boolean }
//   返回: { messageId } 或抛 PlatformError

// 能力查询与降级
export function supports(capability) {}

// 元数据（控制台渲染用）
export function describe() { return { label, conversationTypes, accountLabel, configSchema }; }
```

硬约束：

- `send` 只接受内核已校验的 segments；**实现不得自行读取配置文件或全局状态**。
- 能力缺失时**抛明确错误**（`capability_unsupported`），不得静默丢弃——现状里"贴纸/语音/合并转发在非 QQ 平台会假装成功"是必须消灭的行为。
- 入站事件由实现归一为 §3.3 的形状，**不带上游原始结构**（原始放在 `ext.<platform>`）。

### 3.3 统一事件（借 interface-platform 的形状）

```js
{
  v: 1,
  id: 'evt_42',                    // 本进程内单调序号
  time: 1760000000000,             // 本进程收到时间
  platform: 'qq', account: 'qq:10001',
  kind: 'message' | 'notice' | 'request' | 'meta' | 'agent',   // agent = Agent 侧事件
  type: 'message.group',
  conversation: { type: 'group', id: '20001' },
  sender: { id: '30001', name: '群名片或昵称' },
  message: { id: '123456', segments: [...], text: '...' },
  ext: { qq: { ... } }             // 平台逃生舱，内核不读
}
```

### 3.4 中立消息段

在 interface-platform 的 8 种基础上扩到 nexus 实际需要的集合：

| 段 | 字段 | 缺能力时降级 |
| --- | --- | --- |
| `text` | `text` | — |
| `mention` | `target` | 降级为 `text: '@xxxx'` |
| `reply` | `messageId` | 丢弃引用，保留正文 |
| `image` | `file`/`url`/`name` | 降级为 `text: '[图片]'` |
| `voice` | `file`/`url` | 降级为 `text: '[语音]'` |
| `video` | `file`/`url` | 降级为 `text: '[视频]'` |
| `file` | `file`/`name` | 降级为 `text: '[文件]'` |
| `sticker` | `id`/`url` | 降级为 `text: '[表情]'` |
| `forward` | `messages`/`id` | 降级为 `text: '[合并转发]'` |
| `poke` | `target` | 无能力时**报错**（不能降级成文本，会误伤） |
| `ext` | `platform`/`kind`/`data` | 原样透传给对应平台，其他平台报 `unsupported_segment` |

**降级策略必须由 `capabilities` 决定，不由平台名决定**。这是 A 阶段（发送收口）的核心验收点。

实装（B6）：段类型与降级表在 `src/user-side/segments.mjs`（`SEGMENT_TYPES` / `degradeSegments`），
OneBot 的历史写法 `at` / `record` 在边界处归一到 `mention` / `voice`，出口统一成 `{ type, data }`。
QQ 侧的还原在 `src/user-side/adapters/qq/segments.mjs`，报文逐字段不变由
`scripts/test-transport-plugin.mjs` 钉住。

### 3.5 AgentPlatform（Agent 侧）

```js
export const id = 'dsh';
export const capabilities = Object.freeze(['session', 'prompt', 'events', 'models', 'permissions', 'settings', 'compact']);

export async function ensureSession(address) {}          // → { sessionId }
export async function prompt(sessionId, { text, attachments, requestId }) {}
export async function rename(sessionId, title) {}
export async function stop(sessionId) {}
export async function listModels() {}
export async function applyPermission(sessionId, level) {}   // level 是内核四级，实现自己映射
export async function readSettings() {}
export function onEvent(sessionId, handler) {}           // 归一为 { kind: 'turn'|'tool'|'approval'|'question' }
export function describe() { return { label, modelLabel, permissionLevels }; }
```

硬约束（与现状对照）：

| 现状 | 目标 |
| --- | --- |
| `src/admin/dsh-permission.js` 直接写 `read-only/workspace-write/qq-full-ask` | ✅ 映射表移入 `adapters/dsh/runtime.mjs`（B4；该文件已删除，`src/admin/agent-permission.js` 只做转发） |
| `src/session/permission.mjs` 的 `DSH_PERMISSION_PRESET` | ✅ 同上；内核只保留 `read-only/workspace-write/full-ask/full` 四级，`presetForLevel` 接受 `opts.presets` 注入（B4） |
| `preset` 名 `qq-agent-*` | ✅ 改为能力档名 `chat / chat-v2 / readonly / workspace / full`（B4）；用户平台差异走 prompt 层 |
| `dsh-client.js` 被 bridge 直接 import | ✅ 已移入 `src/agent-side/adapters/dsh/client.mjs`（B5）；bridge / self-test 只见 `src/agent-side/agent-client.mjs` 门面，`src/agent-side/adapters/` 由 `builtin.mjs` 装配进 `protocol` |

---

## 4. interface-platform 取舍（决策 3 的结论）

核实结果：

| 部分 | 规模 | 依赖 | 结论 |
| --- | --- | --- | --- |
| `src/core/model.mjs` | 64 行 | 零 | **合并**。`rawId / accountId / safeJsonParse（2^53 保护）/ PlatformError / ERR / cap / SEGMENT_TYPES` 正是内核缺的 |
| `src/connectors/onebot-v11/mapping.mjs` | 123 行 | 仅 model | **合并**为 QQ 适配器内部实现。`toUnifiedEvent` 与 bridge 现在的入站分支高度重合 |
| `src/core/platform.mjs` / `event-bus.mjs` | 384 行 | 零 | 部分借：事件序号与能力声明形状；不搬调度 |
| `src/api/server.mjs` / `src/net/ws-server.mjs` | 430 行 | 零 | **不合并**。它是"独立网关进程"形态，与内核重复 |
| `docs/CONTRACT.md` | 99 行 | — | 作为 §3.3 的权威来源，改写进本文档后原文件降级为历史 |

合并时必须改的三处：

1. `SEGMENT_TYPES` 从 8 种扩到 11 种（§3.4）。
2. `toOneBotSegments` 遇到不支持段**整条拒绝** → 改为**按能力降级 + 记录一次 `degraded` 事件**（nexus 现在就是降级行为，不能倒退）。
3. `oneBotId` 的 `^\d+$` 校验**保留但下沉**：它是 QQ 后端的实现约束，不是内核约束。内核不再校验 id 类型。

`interface-platform` 目录本身：**先保留**为可选独立网关（它有 `/v1` REST 与 OneBot 兼容入口的独立价值），但 `src/` 不得 import 它；等 §6 的 B5 完成后再决定是否删除，届时用 `git grep` 清单证明"只被文档引用"。

---

## 5. 插件接管连接（决策 4）

### 5.1 权限与钩子

```js
KNOWN_PERMISSIONS: ['state','persona:provide','prompt:provide','memory:provide',
  'task-type:provide','send:message',        // 由 'send:qq' 改名
  'net:http','commands','inbound:filter',
  'adapters:provide',                        // 保留：声明能力/提示词变量
  'transport:provide']                       // 新增：提供 UserPlatform 实现
KNOWN_HOOKS: [...现有五个, 'onOutbound']     // 新增
```

`send:qq` → `send:message`：旧 manifest 声明 `send:qq` 时按别名接受并打一次 deprecation 日志（插件是外部产物，不能硬切）。

### 5.2 宿主 API

```js
// transport:provide
ctx.userPlatforms.register({
  id: 'my-platform',                      // 必须是未占用的平台 id
  capabilities: [...],
  create(config) { return { connect, close, send, supports }; },
});

// adapters:provide（保留旧语义：只声明）
ctx.adapters.register(kind, adapter)      // kind: 'platform' | 'agent'
```

`send` 可以写在 `register` 的定义上，也可以只写在 `create(config)` 的产物上——后者才是「一个连接」的
形态，注册表会取实例上的那个并绑定 `this`；`capabilities` 同理（定义优先，其次实例）。

出站对插件侧的入口是 `ctx.message.send(key, payload, opts)`：`payload` 只接受字符串、单个段或段数组，
准入、段校验、降级、`onOutbound` 全在内核里做完才到达 transport。旧名 `ctx.qq` 指向同一个对象。

### 5.3 安全边界（关键）

插件只替换**网络与协议**，不替换**策略**：

| 环节 | 归属 | 理由 |
| --- | --- | --- |
| 连接、重连、鉴权、原始报文解析 | 插件 transport | 这是"厂商差异" |
| 归一事件的形状校验 | 内核 | 插件产出的结构必须过内核 schema 校验，非法事件丢弃并审计 |
| 准入（白名单/黑名单）、模式、权限、水位 | 内核 | 插件不得看到未准入会话的正文 |
| 段校验与降级 | 内核判定，插件执行 | 插件只能按 `capabilities` 降级，不能扩大能力 |
| 出站 | 内核 `sendAction` → transport | 插件 transport 的 `send` 只接受内核已构造好的 segments |

落地手段：

1. 内核在把事件交给业务前，用 `validateUnifiedEvent()` 校验并**补全** `platform/account`（防止插件伪造成别的平台）。
2. 插件 transport 的 `send` 收到的是**已脱敏、已分条、已降级**的 segments；它没有原始文本入口。
3. 插件注册的平台 id 与内置平台冲突时拒绝。
4. 插件卸载时 `close()` 必须完成或在 2s 后被强制丢弃（沿用现有 `DISPOSE_TIMEOUT_MS`）。

### 5.4 实装（B6）

| 环节 | 落点 | 行为 |
| --- | --- | --- |
| 段与降级 | `src/user-side/segments.mjs` | 11 种中立段 + `degradeSegments`；`poke` / `ext` 缺能力抛错，不静默变文本 |
| 出站收口 | `src/user-side/outbound.mjs` | `sendAction(address, segments, opts)`：**先降级**，再选插件 transport，否则内置 `send` |
| 插件平台表 | `src/user-side/transport.mjs` | 带 owner 的注册表：内置 id 冲突拒绝、换 owner 拒绝、按 owner 批量注销 |
| 统一事件 | `src/user-side/event.mjs` | `validateUnifiedEvent(raw, origin)`：`platform` / `account` 只取内核给的 origin |
| QQ 出站 | `src/user-side/adapters/qq/{segments,transport}.mjs` | OneBot 动作名、参数、HTTP、426 提示全在适配器内；bridge 四处发送点各剩一行 |
| 插件内核 | `src/plugins/{manifest,host-api,kernel}.mjs` | `send:message` 别名、`transport:provide`、`onOutbound`、`close()` 2s 上限、`transport-denied` / `outbound-denied` 审计 |

出站顺序不可颠倒：**插件 `onOutbound` 改中立段 → 内核降级 → transport**。反过来的话，插件就能用
「改造」的名义发出本平台发不了的东西。

---

## 6. 迁移批次

每批独立可提交、均可通过 `verify:repo`（73 项）+ `test:audit`（119 项）+ `test:artifact-pipeline` + `test:console-ui`（34 项）。批次之间有依赖，不可乱序。

状态：`✅` 已提交 / `—` 未开始。

| 批次 | 内容 | 触及 | 风险 |
| --- | --- | --- | --- |
| **B0** ✅ | 常量去 QQ：`RUNTIME_PLATFORM`（plans.mjs:8）、`DEFAULT_PROMPT_VARS`（prompt-compose.mjs:6）、`runtime.json` 键名、`catalog.mjs` 的 `provider` 参数化；`selfIdentityTextV2` 改 prompt 变量；`splitForQQ`/`mdToPlain` 中性命名 | 5 个文件 | 极低 |
| **B1** ✅ | 发送收口：4 处 `send_*_msg` 三元式 → `sendAction(address, segments)`；v1 管线退化为 v2 薄封装；段类型与降级策略接线 | bridge.js + md-to-plain + 3 个媒体函数 | 低（收益最高） |
| **B2** ✅ | 地址模型：`key.mjs` 支持 `@account` 与开放 type、id 字符串化；`withAddress()` 上下文 + 15 个 import 点改造；`sessions.json` 迁移脚本（见 §2.5：实际未做，旧文法已是新文法子集） | key.mjs + 15 模块 + bridge | 中高（主键） |
| **B3** ✅ | owner 结构化（`owner: {platform, account, id}`）、准入白名单按地址；`admins` 项新增 `platform`/`account`/`id`（`qq` 保留为别名）；`QQ_RE` 移除、`cfg.ownerQQ` 降为派生视图 | bridge + 控制台 + 6 个测试 | 中 |
| **B4** ✅ | 权限映射下沉：`DSH_PERMISSION_PRESET` / `LEVEL_PERMISSION_PRESET` / `qq-agent-*` → `adapters/dsh/runtime.mjs` + 能力档名（`chat / chat-v2 / readonly / workspace / full`，旧名经 `AGENT_PRESET_ALIASES` 归一；见 §2.5） | 2 个文件 + preset 名迁移 | 中 |
| **B5** ✅ | 运行期适配器：新建 `src/user-side/`（`runtime-registry` / `builtin` / `user-platform` + `adapters/qq/`）与 `src/agent-side/`（已有 registry/builtin + `adapters/dsh/` + `agent-client` 门面）；`dsh-client.js` → `agent-side/adapters/dsh/client.mjs`，`lib/dsh-endpoint` 与 `lib/dsh-health` → 同目录，`platform/onebot` + `lib/qq-backend-label` → `user-side/adapters/qq/`，`platform/prompt` → `user-side/prompt.mjs`；bridge / self-test / control-center 只依赖门面；边界与例外见 §2.5 | 大（bridge 18 处 + 18 个 importer + 夹具） | 高 |
| **B6** ✅ | 插件：`onOutbound` + `transport:provide` + `ctx.userPlatforms` + `validateUnifiedEvent` + 安全边界回归（实装见 §5.4） | kernel/host-api/manifest + `src/user-side/` 四个新模块 | 中高 |
| **B7** | 控制台元数据化：品牌与文案、`/api/platforms` 与 `/api/agent-platforms` 驱动表单、列名与筛选读元数据、`/api/send/*` 收敛 | console 全站 | 中 |
| **B8** | 社交模型 `group→conversation`、`成员→participant`（`/api/socialV2/*` 46 端点） | social 7 文件 1195 行 | 高 |

反向约束（写进提交说明）：

- **B2 之前不动 B8**。社交模型是最广的语义面，在大迁移未稳时再叠一次全量重命名会失控。
- 每批都要保证"旧 key 可读"；任何需要放宽断言的地方在 commit message 里点出。
- B5 期间禁止同时改行为（模式/权限/提示词），否则回归无法归因。

---

## 7. 验收

### 7.1 新增回归

| 用例 | 断言 | 状态 |
| --- | --- | --- |
| `scripts/test-platform-adapters.mjs` | 两侧注册表 fail-closed、门面只出中立名、内核不直连 `adapters/`、平台专属文件不回 `src/` 根；夹具的平台桩用中立名且地址发现强制离线（14 条） | ✅ B5 |
| `scripts/test-unified-segments.mjs` | 11 种段与顺序、`at`/`record` 归一、扁平写法、缺能力降级、`poke`/`ext` 抛错、能力判定不看平台名（10 条） | ✅ B6 |
| `scripts/test-unified-event.mjs` | 5 种 kind、`platform`/`account` 只取内核来源（插件伪造被覆盖）、形状错误逐条报错、id 单调（8 条） | ✅ B6 |
| `scripts/test-transport-plugin.mjs` | 插件 transport 注册/冲突/注销/`create` 产物、**降级先于 transport**、QQ 报文逐字段不变（`send_group_msg` / `send_private_msg` / at/record/reply）、426 提示、同进程多平台不串号（12 条） | ✅ B6 |
| `test-plugin-kernel` 新增三条 | `transport:provide` + `create(config)` 产物 + 停用后 `close()`、`onOutbound` 链式/丢弃/非法段、`send:qq` 别名与 `ctx.qq === ctx.message`（20 条） | ✅ B6 |
| `test:user-platform-pipeline` | 整桥 + mock 平台的端到端流水（建会话 → 收消息 → 准入 → 唤醒 → 发消息） | 待 B7（届时与 `/api/platforms` 一起做） |

### 7.2 静态验收（可机械化）

```
# 内核目录不得出现具体平台名（白名单：适配器目录、测试、文档）
git grep -nE '\bqq\b|\bdsh\b|snowluma|napcat' -- src/ ':!src/*/adapters/*' ':!src/user-side/adapters/*' ':!src/agent-side/adapters/*'
```

目标：从当前的 127 个文件降到 ≤ 20 个（允许保留：`session/key.mjs` 的旧形态兼容、`profiles/paths.mjs`、迁移脚本、注释里的历史说明）。

### 7.3 文档

- ✅ 新增 [`guides/ADD_USER_PLATFORM.md`](guides/ADD_USER_PLATFORM.md)（对称于 Agent 平台的接入指南）。
- ✅ `docs/PROFILES_MODEL.md` 增补 `adapters/runtime.mjs` 契约（声明面不得 import `src/`，协议面由 `builtin.mjs` 拼装）。
- ✅ `docs/FOLDER_MAP.md` 增补 `src/user-side/`、`src/agent-side/` 的职责与边界。

---

## 8. 明确不做

1. 不把两侧合成一个 `Adapter` 接口。用户侧是"连接+消息+社交"，Agent 侧是"会话+提示+权限+事件"，合并会得到一个谁都不好用的大接口。
2. 不为没有第二个实现的位置加抽象。允许保留 `if (platform === 'qq')` 的地方必须先写清"为什么不需要抽象"。
3. 不做"读旧 key 自动猜平台"。猜错会静默污染数据。
4. 不在 B5 期间改行为语义（模式、权限、提示词），只做等价搬运。
5. 不把 `interface-platform` 的网关服务搬进内核（§4）。
