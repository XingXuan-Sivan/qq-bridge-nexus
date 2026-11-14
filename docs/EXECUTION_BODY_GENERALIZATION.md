# 执行体通用化与运行方案重构（EXECUTION_BODY_GENERALIZATION）

> 状态：**实施中**——P0 全部落地（连接层下沉 §4.1、事件面/审批引用/用量账本归一 §4.4、ACP 事件流出口与 TCK §4.2）、P1 已落地（Agent 侧插件化 §4.3）、P2 已落地（配置多实例与默认执行体 §5.2 / §8.2）；P3 起各批未做。
> 本文是 [PLATFORM_UNIFICATION.md](PLATFORM_UNIFICATION.md) C6.5 缺口的落地设计，
> 也是「可换执行体」在运行时第一次成立的地方。
> 版本口径：0.2.0；分支 `feat/execution-body`（自 `feat/platform-unification` 的 C10 起）。
> 边界：AstrBot 目录只读；本文不改变已发布的 `AgentPort` 五个核心方法。

本文要回答四件事（与设计评审提出的四条补充一一对应）：

| 问题 | 落点 |
| --- | --- |
| 同一时刻只用一个 Agent 实例，切换机制放哪、怎么切 | §5 |
| 已有几套预设要不要重新设计，怎么和直通形成一套 | §6 |
| 直通下桥接的四级权限还有没有意义；能否在界面里读改对端权限 | §7 |
| 界面哪些地方要同步改 | §8 |

---

## 1. 结论先行

1. **执行体「注册多份、同时只跑一份」**。`platforms.active.agent` 是唯一活动执行体（`/api/config/runtime` 的
   `runtime.defaultAgent` 就是它的读视图，不是第二个配置键），切的是「新会话用谁」，
   不是「把运行中的会话搬过去」。已绑定会话保留原实例（`agentRef.instance`），并提供显式的「在新执行体上重开」。
2. **现有预设不是三套体系，而是同一张表的三个轴被写死了**。把「应用方式 / 权限权威 / 行为 / 工具面」
   拆成正交四轴之后，直通只是 `apply: passthrough` 的一个取值，不再是第二套方案。
3. **直通下权限归对端，桥接从「拥有并强制」退化为「观察、转发、可写但不回钉」**。
   界面里读写对端权限不需要新能力位——`listPermissionPresets` / `readPermission` / `applyPermission` 已经实现了。
4. **直通给不了工具级硬边界**。桥接只能决定「发进去什么」「审批转不转」；真正的边界是对端的权限档。
   这条必须写进界面和文档，不能靠提示词假装。
5. 界面改动集中在四处：全局配置（执行体卡）、平台配置（Agent 侧实例）、会话详情（对端权限块）、方案编辑（四轴字段）。

---

## 2. 现状证据

改动之前的耦合点，逐条带位置。这张表是后文所有拆分的依据。

### 2.1 执行体维度的缺口

| 事实 | 位置 | 影响 |
| --- | --- | --- |
| 门面硬依赖 14 个 DSH 成员（`NodeApiClient` / `discoverDshLaunchToken` / `looksLikeDsh` …） | `src/agent-side/agent-client.mjs` `REQUIRED_PROTOCOL_MEMBERS` | ACP 声明面齐了也当不了主平台：装配期直接抛错 |
| 连接层（地址发现 / Cookie / 探活分类 / RPC 客户端）没有归口 | 同上 + `adapters/dsh/{client,endpoint}.mjs` | 换执行体 = 重写一次连接层；`describe()` 里无法表达「怎么连」 |
| Agent 侧只有「描述」注册，没有「实现」注册 | `src/platforms/adapter-registry.mjs`（`ADAPTER_KINDS=['platform','agent']`，仅 id/label/note/vars）；`src/plugins/host-api.mjs` 的 `ctx.userPlatforms.register` 只对用户侧开放 | 用户侧可插件扩展，Agent 侧不能 |
| 单 active | `src/config/platforms.mjs` 的 `platforms.active.{user,agent}` | 多平台并发在配置面就不成立 |

前两条已按 §4.1 收口：`src/agent-side/agent-client.mjs` 与 `REQUIRED_PROTOCOL_MEMBERS` 已删除，
连接层的唯一入口是 `src/agent-side/runtime.mjs` 的 `agentRuntime()`，实现落在 `adapters/<id>/`。

### 2.2 预设体系的三处「多套并存」

| 并存点 | 证据 | 后果 |
| --- | --- | --- |
| 方言写在两处 | `profiles/agent-platforms/dsh/capabilities/chat.yml` 的 `persona.prefix` 自带一大段 QQ 规则；`profiles/platforms/qq/prompt.md` 又有一份 94 行的 QQ 规则 | `build.mjs` 的 `composeRows()` 把平台提示词**追加**到同一条 `persona.prefix`；两份口径有代差（前者「回复会自动转发」，后者「文本不会自动发送」），一旦给该能力档配了平台提示词，前缀里就同时存在两套发送口径 |
| 方案钉死平台与执行体 | `profiles/plans/*.yml` 全部写 `platform: qq` / `agentPlatform: dsh`；`src/runtime/plans.mjs` 里 `agentPlatform || 'dsh'` | 换平台/换执行体要逐个改方案；`validatePlanReferences` 也把两者当必填 |
| 能力档根目录属于 dsh | `src/capabilities/store.mjs` 的 `CAPABILITIES_ROOT = AGENT_PLATFORMS_ROOT/dsh/capabilities`（`src/profiles/paths.mjs` 其实已有 `agentPlatformDir()` 未使用） | 第二家执行体的能力档没有地方放 |
| 方案是日常编辑对象 | 仓库里已有用户克隆出来的 `profiles/plans/agent-full-copy.yml` | 重构必须让克隆方案自动继承新字段，不能要求用户重建 |

### 2.3 权限链路（现状，直通要复用）

```
会话 permission（inherit / 四级）
  → src/session/permission.mjs resolvePermission()          ← 已有
  → src/admin/agent-permission.js permissionPresetMap()     ← 映射随适配器走，内核零平台名
  → 适配器 PERMISSION_PRESET_FOR_LEVEL（dsh/adapters/runtime.mjs）
  → AgentPort.applyPermission / readPermission / listPermissionPresets  ← 双实现都已具备
```

- DSH 侧：`commands/execute(sessionId, "/permission <preset>")` 写，`/permission` 无参读，`permissionPresets/catalog` 列目录。
- ACP 侧：`session/set_config_option`（`category: 'mode'`）或 `session/set_mode` 写；读只有事件与快照
  （重启后未产生事件的会话读不到 → 返回空串，按「读不出来」fail-closed，与「读到别的值」区分）。
- 桥接「拥有」的只是 `BRIDGE_OWNED_PRESETS`（`read-only` / `workspace-write` / `qq-full-ask`）：
  安装时把它们改宽了会被强制收紧。**这个「拥有」关系是 preset 模式的前提，直通模式里不成立。**

---

## 3. 概念模型：四轴 + 三层

### 3.1 四轴（替代现在的隐式耦合）

| 轴 | 取值 | 决定什么 | 住哪 |
| --- | --- | --- | --- |
| **应用方式** `apply` | `preset` / `passthrough` | 要不要给执行体装环境（能力档 rows → bundle patch） | 能力档 `runtime` 段 |
| **工具面** `tools` | 能力档的 `tools` 段（platform / agent / mcp / skills） | 发什么工具给模型 | 能力档 `tools` 段（已有） |
| **权限权威** `permission` | `bridge` / `agent` | 档位由谁定、谁回钉 | 能力档 `runtime` 段 |
| **行为** `behavior` | `none` / `social-v1` / `social-v2` | 回合怎么被驱动（自主发言、等待、潜水） | 用户侧平台 `behaviors/`（已有） |

方案（plan）不再是「平台 + 能力档 + 行为」的三元组硬绑定，而是**这四轴的一组取值 + 三条可选覆盖**：

```yaml
# profiles/plans/direct.yml（新增内置，示意）
version: 1
id: direct
label: 直通 · 主人
note: 用 Agent 侧现成环境干活，桥接只追加提示与工具。
builtin: true
audience: owner
behavior: none
capability: direct          # 能力档 id；其 runtime.apply 决定 preset / passthrough
# platform / agentPlatform 不再必填：缺省跟随全局默认（见 §5）
```

### 3.2 三层默认（与会话人格同构）

| 层 | 键 | 作用 |
| --- | --- | --- |
| 会话 | `state/profiles/<key>.planId` | 单会话覆盖（已有） |
| 平台 | `platforms.users.<id>.defaultPlan` | 同一平台的实例可以有不同默认方案（新增） |
| 全局 | `runtime.defaultPlan` | 全局默认（已有） |

`runtime.defaultPlan` 从「所有会话都靠它」变成「最后一层兜底」——这正是多平台并发之后它「不再适用」的部分：
不是删掉它，而是让它在平台层之下生效。

### 3.3 为什么不做「组合自由」

方案允许自由组合四轴会导致组合爆炸（4 轴 × 用户侧 N 平台 × 执行体 M），且每一种组合都要有审计口径。
约束：**内置方案是模板，自定义方案只能从模板克隆后改参数**，不能凭空新造轴组合。
`src/runtime/plans.mjs` 的 `validatePlanReferences()` 负责拒绝非法组合（见 §6.4）。

---

## 4. 执行体契约 v2（P0 的地基）

### 4.1 连接层下沉

一个平台要能被配成 `platforms.active.agent`，只需在实现面提供一个 `createRuntime`；
调用面（会话 / 回合 / 权限 / 模型 / 设置 / 工作区 / 压缩）仍在 `AgentPort`，两件事不混在一个对象里。

```js
// src/agent-side/adapters/<id>/runtime.mjs（连接面）
export function createRuntime({ config, log, onBaseUrlChange }) {
  return { id, label, mode /* http | stdio */, ...members };
}
```

`config` 是 `platforms.agents.<id>` 的**活引用**：识别到新地址时连接层直接改它，调用方不再同步副本。

### 4.1.1 单一入口与成员表

`src/agent-side/runtime.mjs` 的 `agentRuntime({config, log, onBaseUrlChange})` 是内核唯一的连接入口：
按 `platforms.active.agent` 取已注册实现 → 调 `createRuntime` → 按成员表校验 → 缓存。
进程内同一时刻只有一个句柄；缓存键是**实现对象本身**（不是 id），注册表重置后重新装配同一平台不会复用旧句柄。
`resetAgentRuntime()` 丢弃句柄并 `close()`，切换执行体后下一次调用按新平台重建。

| 成员 | 谁用 | 说明 |
| --- | --- | --- |
| `prepareAuth(config)` | bridge / self-test / 启动器 | 连接前补全凭据，返回 `{ authToken, tokenExplicit }`；不发请求 |
| `prepareEndpoint(config)` | 同上 | 连接前补全地址，返回 `{ baseUrl, auto, discovered, reachable }`；stdio 执行体返回空串 + `auto: false` |
| `client()` | 连接层内部 / 诊断 | 懒建底层客户端 |
| `events()` | bridge | 事件流订阅面（`follow` / `forget` / `mux`） |
| `port()` | bridge / 工具面 | 懒建 `AgentPort`，能力位由 `createAgentPort` 装配 |
| `collector()` | bridge | 按本平台的事件口径把一条流收成「一轮」 |
| `health({threshold})` | bridge | 连续失败计数：`ok()` / `fail(err)`（阈值策略归调用方） |
| `probe()` | bridge / 启动器 | `check()` → `{ ok, error, rediscovered, url }`；HTTP 执行体自带重识别与节流 |
| `authHint(err)` | bridge | 401 诊断文本；不是凭据问题或在限频窗口内返回 `null` |
| `authRecentlyFailed()` | bridge | 「连上就断」日志的归因依据 |
| `resetAuthHint()` | bridge | 恢复后清空限频与计数 |
| `close()` | 切换执行体 / 退出 | 断开连接或结束子进程 |

- **fail-closed 在装配期**：`RUNTIME_MEMBERS` 缺任一成员，或未声明 `id` / `label` / `mode`，`agentRuntime()` 直接抛错：
  不允许「少一个方法先跑起来」，也不允许内核按 `undefined` 分支猜行为。
- **ACP 的差异只有形态**：`stdio` 子进程没有地址、没有凭据猜测、没有重识别，这些都由 ACP 自己的 `createRuntime`
  返回同样的成员名；`events()` 由子进程 stdout 自建事件面（`onEvent` → 异步 `mux`），不继承任何 HTTP 客户端。
- **DSH 专有符号不出 `adapters/dsh/`**：地址发现（`endpoint.mjs`）、Cookie 与客户端（`client.mjs`）、
  探活重识别（`probe.mjs`）、401 诊断与限频（`auth-hint.mjs`）、失败分类（`health.mjs`）都在该目录内，
  内核只认成员名。

### 4.2 一致性测试包（TCK）

`scripts/test-agent-port-tck.mjs`（`npm run test:tck`）对每个已注册 Agent 平台跑同一组离线用例。
它测的是**跨平台契约**，不是某家的实现细节：

| 用例 | 断言 |
| --- | --- |
| 事件 kind 契约 | 两家翻译出的每个 `kind` 都落在 `AGENT_EVENT_KINDS` 内，且事件带 `sessionId` |
| 收集器同源 | 同一串中立事件喂进 `src/agent-side/collector.mjs`，收出同一份文本与结束原因 |
| 回合分组 | 两个会话的回合交错到达，各自收口，不串文本 |
| 无回合号的事件 | 只有 `turn-start` / `turn-end` 带编号时，文本仍归到该会话唯一打开的回合；多个在途则丢弃而不是猜 |
| 孤儿事件 | 没有 `turn-start` 的文本不建收集器、不产生回复 |
| 审批引用 | `respondPermission` 只接受 `{ instance, sessionId, requestId }`；平台键只在适配器挂起表里 |
| 快照隔离 | 会话开场快照走独立 `kind: 'snapshot'`，`records` 里的历史 `turn-start` / `turn-end` 不会被当成新回合 |
| 连接层成员 | 两家 `createRuntime()` 给出 `RUNTIME_MEMBERS` 全集与 `id` / `label` / `mode` |

ACL：TCK 通过是「可注册」的前置条件；插件注册的 Agent 平台同样要过。
能力自证与 fail-closed 的实时校验留在各自的 port 单测（`test-agent-port.mjs` / `test-acp-port.mjs`）。

### 4.3 Agent 侧插件化

照搬用户侧 `registerTransport()` 的形状（`src/user-side/transport.mjs` 已有同类校验：id 文法、
同 owner 可覆盖、换 owner 拒绝）。差别是**不另开第二张表**：用户侧之所以有 `transport.mjs`，
是因为那张表在 import 时就被内置平台填满且没有 owner；Agent 侧的 owner 与装配结论直接记在
`src/agent-side/runtime-registry.mjs` 里，于是「这个平台是谁注册的、当时装配成了什么」只有一个答案。

| 项 | 实现 |
| --- | --- |
| 新权限 | `agent-provider:provide`（与 `transport:provide` / `adapters:provide` 并列） |
| host-api | `ctx.agentPlatforms = { register(def), list() }`；内核在 `disposeEntry` 里调 `unregisterAgentPlatformsByOwner(owner)` |
| 注册形状 | `{ id, label, capabilities, configSchema?, resolveLevelPlan(level, ctx), createRuntime(opts) }`，连接层成员同 §4.1。`resolveLevelPlan` 与 `createRuntime` 缺任一即拒：能被选为当前执行体是个承诺，注册时就验 |
| 懒建与缓存 | 沿用 `agentRuntime()` 的进程内单例；换 active 要重启桥接 —— 正在当执行体的平台不允许随插件注销（会话落盘里的 `agentRef.instance` 指着它） |
| 安全边界 | 插件**不能自证能力**：`capabilities` 只是描述，闸门在 `createAgentPort` 的装配校验（未知能力位 / 声明了却漏实现 / 缺核心方法）；权限决策权只在内核 |
| 诊断 | `issue.code` 由注册表记，由统一注册表翻成诊断码：`capability_overclaimed`（自证失败，error）/ `agent_provider_invalid`（实现不合契约，error）/ `agent_instance_offline`（此刻没连上，warn） |

三条落地口径：

- **装配结论与 owner 同表**：`listAgentPlatforms()` 直接带 `owner` / `source` / `issues`，
  `agentPlatformMetadata()` 与统一注册表都读这一处，控制台不拼第二份。
- **实时连接状态不进注册表**：`agent_instance_offline` 由桥接的探活结论（`agentConnected`）
  注入快照；`null`（还没探过）不判，否则启动瞬间会报一条假的离线。
- **装配期即是插件的 TCK**：内置平台的事件契约由 `scripts/test-agent-port-tck.mjs` 钉住；
  插件平台在启动时过的是同一道闸门的运行时版本（`RUNTIME_MEMBERS` 全集 + `createAgentPort`）。
  `scripts/test-agent-provider.mjs` 把这三类失败与 owner 语义都钉住。

### 4.4 事件面 / 审批引用 / 用量账本三处归一

P0 的两项遗留（ACP 当主平台、TCK）都卡在同一处：`events()` 必须是中立面。
下面三处是内核里仅剩平台形状的地方：

| 位置 | 归一前的依赖 | 为什么必须归一 |
| --- | --- | --- |
| `pumpMux()`（约 17667 起，700 余行） | `frame.type` 取 `session/snapshot` / `session/event` / `question/requested` / `approval/requested`；`frame.event.type` 取 `turn/start` / `tool/call` / `tool/result` | 换执行体 = 重写这 700 行；ACP 的归一事件在这套判别值上一格都对不上 |
| `recordSessionUsage()` / `recordSessionSnapshot()` / `rebuildInFlightCollector()` | 事件体是 DSH wire 形状（`data.usage`、`turn`、`assistant/message`）与快照的 `projections.tokenUsage` / `records` | 用量账本与「断线重建进行中回合」都绑在 DSH 上 |
| `agentPort.respondPermission({ clientId, eventId })` | 审批回执引用是 DSH 事件标识的形状 | ACP 用 `requestId`（`pendingPermissions`），审批转发要各自分叉 |

三项归一，缺一不算完成：

1. **事件面**：`events().mux()` 产出 `{ kind, sessionId, turn? }`，`kind` ∈ `AGENT_EVENT_KINDS`（含 `turn-start` 与 `snapshot`）。
   wire 形状的翻译全部在适配器内，内核不再出现 `turn/start` / `tool/call` 这类名字；历史快照与用量作为**载荷**
   由适配器提供，内核只透传给账本，不解析平台字段。`snapshot` 是独立 kind，绝不混进事件流 ——
   它含**历史** `turn-end`，混进去就会被当成新回合去发 QQ 回复。
2. **审批引用**：`respondPermission(ref)` 归一成 `{ instance, sessionId, requestId }`；
   平台键（DSH `clientId` / `eventId`、ACP RPC `id`）只留在适配器挂起表 `Map<requestId, {...}>` 里，
   内核与审批表只认 `requestId`。
3. **用量账本**：`createTokenLedger.ingestSample()` 吃中立用量样本
   （`{ sessionId, seq, turn, step, retry, model, provider, usage, at }`），`ingestBaseline()` 吃 `{ tokenUsage, asOfSeq }`；
   重试轴由适配器按平台事件算好后随样本来，账本不认识任何平台事件名。

落地位置（按依赖顺序，逐项可独立验证）：

1. `src/agent-side/port.mjs`：`AGENT_EVENT_KINDS` 含 `turn-start` / `snapshot`；中立事件形状与 `normalizePermissionRef` 在这里定义。
2. `src/agent-side/collector.mjs`：中立收集器（`turn-start` 开回合、`text` 追加、`turn-end` 收口），两家共用。
   只有 `turn-start` 才建收集器；没有回合号的后续事件归到该会话**唯一**打开的回合（`groupKeyOf`），
   同时开着多个回合就丢弃，宁可丢也不混进另一轮回复。
3. `src/agent-side/adapters/dsh/events-plane.mjs`：wire 事件 / snapshot / `$events` 提问审批 → 中立事件；
   DSH 的 `events()` 与 `collector()` 用它。
4. `src/token-ledger.js`：`ingestSample` / `ingestBaseline` 取代吃平台事件的入口，重试轴随样本传入。
5. `src/bridge.js`：`pumpMux` 按 `kind` 分发，`recordSessionUsage` / `recordSessionSnapshot` /
   `rebuildInFlightCollector` / `trackTurnEvent` 吃中立事件。
6. `src/agent-side/port.mjs` + 两家 `port.mjs` + `src/admin/approvals.js` + bridge：审批引用统一成 `requestId`。
7. `src/agent-side/adapters/acp/runtime.mjs`：`onEvent` 建事件总线并实现 `events()` 的 `mux` / `follow` / `forget`，
   `close()` 走 `client.stop()`；ACP 本身没有回合号，由 port 层 `beginTurn()` 给在途回合打戳并发出 `turn-start`。
8. `scripts/test-agent-port-tck.mjs`：见 §4.2，接入 `npm run test:tck`。

验证：`npm run verify:repo` 101 通过 0 失败；`npm run test:audit` 全绿；`npm run test:tck` 8/8。

---

## 5. 执行体切换机制（补充一）

### 5.1 语义

- **同一时刻只有一个活动执行体**：`platforms.active.agent` 保持单值，语义从「唯一存在的」变成「默认的」。
- **多个实例可注册、可配置、可探活**：`platforms.agents.<id>` 每条都保留端点与选项；未激活的实例不参与收流。
- **切换只影响新会话**：已建立的会话继续用建会话时的实例（`agentRef.instance`）。
  理由：会话归属（审批回执 `requestId`、preset 所有权、漂移核对）都是**实例级**语义，
  把运行中的会话跨实例迁移等于迁移一段对话历史，而历史在对端——桥接做不到，假装做不到更糟。
- **提供显式「在新执行体上重开」**：归档旧会话 + 在新实例建新会话 + 迁移桥接侧元数据（方案、人格、准入），
  界面上明写「对话历史不会随之迁移」。

### 5.2 切换前置与失败处理

| 步骤 | 规则 |
| --- | --- |
| 1. 选目标 | 入口在「平台 › Agent 侧 › 详情」：每条注册表条目带「设为默认执行体」（已经是默认的不重复显示按钮）。写配置与切默认互相独立 —— 没配过端点的平台也可以先存配置再切 |
| 2. 预检 | 同一请求里先探活：active 复用后台轮询的结论，其余建临时 `createRuntime()` 探完 `close()`。失败回 409 且**不落盘**；结论留在快照的 `entry.probe` 里，控制台能看出「为什么没切成功」 |
| 3. 落盘 | 只改 `platforms.active.agent`，条目原样保留；响应带 `requiresRestart: true`，审计记 `runtime.defaultAgent`（旧 → 新） |
| 4. 运行期 | 这一版**不换**：`agentEvents` / `agentPort` / `agentProbe` 在启动期捕获的是单例，换掉只会得到「旧的事件面 + 新的调用面」。重启桥接才装配新平台 |
| 5. 窗口可见 | 配置面（`configured`）与本进程装配（`active`）不一致时，注册表出 `active_pending_restart`（warn）；详情页与列表同时标「已设为默认，重启后生效」/「待重启」 |

### 5.3 入口只做两处，同一 API

| 入口 | 位置 | 状态 |
| --- | --- | --- |
| 平台配置 › Agent 侧 › 详情 | 「执行体」卡：探活 + 「设为默认执行体」+ 上次结论 | 已落地（P2） |
| 全局配置 › 行为与模型 | 新增卡片「执行体」：当前默认（下拉）+ 连接方式徽标 + 探活结果 | P5 |

两处都读同一份 `/api/platforms/registry`，按钮都打 `POST /api/config/runtime`。**不新开第二个数据源**——第二个入口只是同一端点上的另一个视图，补卡时不需要新接口。

### 5.4 与方案的关系

- 方案的 `agentPlatform` 改为**可选**：缺省 `auto`（跟随 `runtime.defaultAgent`）；写死 id 表示「这个方案必须跑在它上面」。
- 内置方案全部改成 `auto`（含直通）。用户克隆的方案如果写着 `dsh` 就继续钉 dsh——**不静默改写已有方案**。
- `src/runtime/plans.mjs` 的默认值从 `'dsh'` 改为 `'auto'`；`validatePlanReferences()` 接受 `auto`，其余 id 必须已注册。

---

## 6. 预设体系重构（补充二）

### 6.1 目标形状

能力档从「三段」变「四段」，唯一新增的是 `runtime`：

```yaml
# profiles/agent-platforms/dsh/capabilities/direct.yml（新增，示意）
version: 1
id: direct
label: 直通 · 主人
note: 不装环境，用 Agent 侧现成工具与权限
tools:
  platform: {}
  agent: { host: true }        # 新取值：不指定清单，用对端全部（见 §6.5）
  mcp: [{ server: '*', tools: '*' }]
  skills: ['*']
runtime:
  apply: passthrough           # 不产 patch、不装 preset
  prompt: system               # 提示注入通道：system / prefix / tool（§7.3）
  permission: agent            # 档位归对端
  narrow: []                   # 可选：投递侧 deny 名单（不是硬边界，见 §7.5）
preset: …                      # passthrough 下不参与构建，但保留作为「建议值」供界面展示
rows: []                       # 允许为空——这是与 preset 模式唯一的结构差异
```

- `apply: preset` 的能力档保持现状（`rows` 非空、参与 build、`verify:artifacts` 管住漂移）。
- `apply: passthrough` 的能力档 `rows: []` 合法，`build.mjs` 跳过它，`verify:artifacts` 也不为它产文件。
- `runtime` 段缺省等价于 `{ apply: preset, prompt: none, permission: bridge }`——老能力档不用改。

### 6.2 内置方案收敛表

现状 7 个内置方案（`chat` / `social-v1` / `social-v2` / `agent-readonly` / `agent-workspace` / `agent-full`
+ 1 个用户克隆 `agent-full-copy`），重构后**仍只增一个**，不新增第二套概念：

| 方案 | apply | 能力档 | 权限权威 | 行为 | audience |
| --- | --- | --- | --- | --- | --- |
| `chat` | preset | `chat` | bridge | `social-v1` | access |
| `social-v2` | preset | `chat-v2` | bridge | `social-v2` | access |
| `agent-readonly` | preset | `readonly` | bridge | none | owner |
| `agent-workspace` | preset | `workspace` | bridge | none | owner |
| `agent-full` | preset | `full` | bridge | none | owner |
| `direct`（新增） | passthrough | `direct` | agent | none | owner |

- **群聊直通不内置**：需要的人从 `direct` 克隆，把 `audience` 改 access、`behavior` 改 social-v2。
  这是「一套体系」的检验点——直通复用同一批轴，不是另一条代码路径。
- `social-v1` 保留为一代行为的内置方案（行为档案本身没变，只是不再和能力档的 `preset.behavior` 纠缠）。

### 6.3 方言上移

| 现在 | 之后 | 迁移方式 |
| --- | --- | --- |
| `capabilities/chat.yml` 的 `persona.prefix` 里 100 行 QQ 规则 | `profiles/platforms/qq/prompt.md`（已有 94 行，二代口径） | 能力档只留**平台无关**的安全边界；平台规则唯一住在 `prompt.md`，由 `platform.yml` 的 `prompt.active` 指定 |
| `capabilities/chat-v2.yml` rows 里的 QQ 工具协议 | 同上 | 同上；`{platform}` / `{displayName}` / `{owner}` 三个变量继续由 `vars` 渲染 |
| `prompt-compose.mjs` 的 `composeRows()` 只 patch `persona` 行 | 保留 | 它只在 `apply: preset` 的构建期运行；直通走运行期注入（§7.3），两条路不共用函数 |

这一步的收益不只是干净：现在「一代说自动转发、二代说文本不发送」的矛盾只在那份拼好的 prefix 里可见，
上移之后平台规则与能力档各只有一份，代差变成**同一个文件的版本**，改错能一眼看见。

### 6.4 校验（`validatePlanReferences` 扩展）

| 新校验 | 失败诊断 |
| --- | --- |
| 能力档的 `runtime.apply` 必须是 `preset` / `passthrough` | `plan_invalid` |
| `apply: preset` 但 `rows` 为空 | `capability_invalid`（构建期也会挡） |
| `apply: passthrough` 但方案的 `agentPlatform` 被写死成某个只支持 `preset` 的平台 | `plan_invalid`（提示改用 `auto`） |
| `permission: bridge` 但适配器没有 `PERMISSION_PRESET_FOR_LEVEL` | `plan_invalid`（禁止静默退化成不设权限） |
| `audience: access` + `apply: passthrough` | `plan_warn`：允许，但控制台在方案卡上标「群聊直通：对端工具对群友可见」 |

### 6.5 `tools.agent.host` 的诚实含义

`host: true` 表示「不指定工具清单」。它**不是**「拿到全部工具」的保证，因为工具面由对端决定。
这也意味着直通下桥接**给不出工具级硬边界**（详见 §7.5），能力档里必须显式写这一句，避免下一次改动时被误读成「白名单已开启」。

---

## 7. 直通模式与权限（补充三）

### 7.1 定义

直通 = 满足全部三条，缺一条就不是直通：

1. 不安装、不修改执行体的任何 profile / preset / 沙箱；
2. 桥接只做**追加**：提示注入（提示词）、工具追加（MCP 下发）、会话编排；
3. 权限档位不归桥接所有——读得到、可以替用户改，但不回钉、不冒充。

### 7.2 权威两分

| 模式 | 谁定档 | 桥接做什么 | 回钉 |
| --- | --- | --- | --- |
| `permission: bridge`（preset） | 桥接四级 → 适配器映射 | 建会话后钉一次；外部漂移检测发现被改宽则改回 | 是 |
| `permission: agent`（passthrough） | 对端档位 | 读、展示、按用户操作写、写后核对 | **否**（只告警） |

`enforce` / `observe` 两个词只用于**漂移处理方式**，不作为独立配置项：
`bridge` 恒 enforce，`agent` 恒 observe。少一个开关，少一种「半强制」的歧义状态。

### 7.3 提示注入通道（直通的命门）

现有链条是**构建期**的：能力档 rows + 平台提示词 → `persona.prefix` → patch → preset。
直通没有 preset，所以必须有一条**运行期**通道：

| 通道 | 适用 | 机制 | 局限 |
| --- | --- | --- | --- |
| `system` | ACP | `session/new` 的客户端 system prompt（`append`），2026-11-06 已稳定 | `mode.override` 会替换对端正文，默认禁用 |
| `prefix` | DSH | 会话第一条唤醒把提示词作为首轮前缀追加，同时记 `promptInjectedAt` | 污染首轮对话历史；同一会话只做一次 |
| `tool` | 兜底 | 只靠 `qq_get_prompt` 工具按需拉取（`prompt.md` 第 2 条已要求模型先调它） | 长度受限、依赖模型主动调用 |

- 能力档声明 `prompt: system`，适配器 `describe().supportedPrompt` 声明支持面；
  不匹配时**不静默降级**：产 `passthrough_degraded` 诊断（降级到哪一级、丢什么），方案卡显示黄条。
  口径与 OpenClaw 一致——不支持的运行时要拒绝，而不是忽略。
- `prompt` 同时是新的能力位（`AgentPort` 增可选组 `prompt`），缺它时控制台显示「该执行体只能靠工具拉取提示词」。

### 7.4 直通下的「管理通道」怎么办

| 现状 | 直通下 |
| --- | --- |
| `/level L1/L2/L3` 切 preset + 权限档 | **不适用**：直通不改环境。收到命令时明确回「当前方案为直通，档位由执行体自身管理」，并附当前档位 |
| L3 的 TOTP 与确认码 | 保留，但用途收窄为「允许写对端权限档」与「允许 `allowForbiddenPreset`」 |
| 群友请求提权 | 不变：一律拒绝，指向 owner 在控制台操作 |
| 审批闸门（`qq-approval-gate`） | 直通下不装闸门。审批由对端的 `permission` 事件驱动，桥接**照常转发到 QQ**，owner 回复即回执 |

最后一条是关键：**审批转发是桥接不可让渡的职责**，不因直通而丢。变的是「谁决定弹不弹」（对端），
不是「弹出来之后谁批」（owner，经 QQ）。

### 7.5 直通给不了什么（必须写在界面上）

| 想要 | 直通能否 | 原因 |
| --- | --- | --- |
| 工具级白名单 | 否 | 对端已经把工具暴露给模型；桥接只能过滤**经由桥接**的调用，挡不住对端直接执行 |
| 沙箱 | 否 | 直通的定义就是不套环境 |
| 工作区隔离 | 否 | 用对端 cwd；`session/new` 的 `additionalDirectories` 只能追加，不是隔离 |
| 审计 | 是 | 桥接侧仍记录注入内容、工具调用事件、审批回执 |
| 权限档可读可改 | 是 | 见 §7.6 |

因此直通方案的 `audience` 默认 `owner`，且方案卡固定显示一行：
「本方案不做工具级限制，安全边界由执行体自身的权限档承担」。

### 7.6 界面内读写对端权限（可直接复用现有能力位）

数据流（不需要新协议）：

```
GET  /api/sessions/:key/agent
     → { instance, agentPlatform, plan, permission: { authority, current, options[], readable, setAt, drift } }
     options ← AgentPort.listPermissionPresets()      （DSH: permissionPresets/catalog；ACP: modes / config option）
     current ← AgentPort.readPermission()             （DSH: /permission 无参；ACP: 快照 currentModeId）
POST /api/sessions/:key/permission  { preset }
     → AgentPort.applyPermission(ref, preset)
     → 立刻 readPermission() 核对，写回 state 并记审计
```

交互规则：

| 情况 | 界面行为 |
| --- | --- |
| `readable: false`（ACP 重启后未产生事件的会话） | 下拉仍可写（目录来自探测会话），当前值显示「读不出来」，附「读不出来 ≠ 没改」 |
| 目标档位在 `FORBIDDEN_PERMISSION_PRESETS` 内（如 DSH `danger-full-access`） | 默认不列出；仅当方案显式 `allowForbiddenPreset: true` 且 owner 二次确认后出现，并标红 |
| 写入失败 / 核对不一致 | 保留旧值 + `permission_write_failed` 诊断；不回滚成「假装成功」 |
| 漂移（`agent` 模式） | 只标黄「已被外部改为 X（时间）」，提供「改回」按钮；**不自动改回** |
| 漂移（`bridge` 模式） | 现有行为不变：自动钉回并记日志 |

写权限的鉴权：控制台已登录即 owner 身份；写入额外要求当前会话方案 `audience: owner` 或操作者是 owner，
并在审计里记「谁把哪个会话从 A 改成 B」。

---

## 8. 界面改造清单（补充四）

只列改动，不写实现细节（组件与表单按 [CONSOLE.md](CONSOLE.md) / [CONSOLE_FORMS.md](CONSOLE_FORMS.md) 的既有组件来，
新增卡片一律走 `cardHtml()` + `fields` 规格，不在页面里硬编码控件与样式）。

### 8.1 全局配置 › 行为与模型

| 变更 | 内容 |
| --- | --- |
| 新增卡片「执行体」 | 当前默认执行体下拉（来源 `/api/platforms/registry` 的 agent 侧）+ 连接方式徽标（http / stdio / remote）+ 探活结果 + 「切换」；切换前预检、失败提示保留原值 |
| 既有「人格与行为」卡 | `runtimeDefaultSelect` 文案从「默认方案」改为「默认方案（无平台/会话覆盖时生效）」，位置不变 |
| 既有「DSH 模型与思考强度」卡 | 标题里的 `DSH` 换成当前执行体的 `label`；该卡只在执行体声明 `models` 能力位时出现，否则显示「当前执行体不支持在桥接侧选择模型」 |

### 8.2 平台配置 › Agent 侧详情

| 变更 | 内容 |
| --- | --- |
| 新增动作 | 「设为默认执行体」（同一端点）+ 当前是否 active 的徽标（「当前启用」/「已设为默认，重启后生效」/「未启用」） |
| 能力位矩阵 | 补两行：提示注入通道（system / prefix / tool）、权限权威支持面（bridge / agent）（P5） |
| 配置编辑 | Agent 侧端点与选项可写（`PATCH /api/platforms/registry/agent/:id/config`，字段由 `configSchema` 生成）；用户侧仍只读——连接参数由活着的传输手柄持有，随 P3 多入站一起做 |
| 探活 | `POST /api/platforms/registry/agent/:id/probe`，结论写进注册表快照（`entry.probe`）供详情与切换预检复用 |

### 8.3 会话与审批 › 会话详情

新增一块「执行体与权限」，插在现有详情字段之后：

| 行 | 内容 |
| --- | --- |
| 执行体 | 实例 + 平台 label + 连接状态；与全局默认不一致时标「跟随建会话时的实例」 |
| 方案 | 方案名 + 权限权威徽标（桥接 / 执行体自身） |
| 权限档 | `bridge`：只读展示四级（现状）；`agent`：下拉可写 + 「最近核对 时间」+ 漂移标记 + 「改回」 |
| 重开 | 「在新执行体上重开」按钮（仅 `agent` 模式或切换过默认时出现，需二次确认并写明历史不迁移） |

### 8.4 运行方案 › 编辑

| 字段 | 控件 | 说明 |
| --- | --- | --- |
| 应用方式 | 单选 `preset` / `passthrough` | 来自能力档 `runtime.apply`，只读展示 + 「改能力档」跳转（避免方案与能力档各说各话） |
| 权限权威 | 只读徽标 | 同上，来自能力档 |
| 执行体 | 下拉 `auto` + 已注册平台 | 默认 `auto`；选具体 id 时提示「关闭后可跟随全局切换」 |
| 能力档 | 现有下拉 | `passthrough` 时显示「使用宿主环境」说明，不显示 rows 编辑器 |
| 平台 | **移除或隐藏** | 方案不再绑平台；遗留值保留在文件里读取时忽略并给 `plan_warn` |

方案列表补两列：应用方式、权限权威；直通方案行显示「不做工具级限制」标记。

### 8.5 平台配置 › 用户侧（P3 同批）

多实例（`enabled` + `defaultUser`）、每实例一条入站管线、出站解析可见。
这一块与执行体切换无耦合，放同一批只是为了「多平台并发」一次收口。

### 8.6 概览与诊断

概览顶部五格指标卡按「执行体 / 用户平台 / 当前运行方案 / 会话 / 待处理」定义语义：前两格读 `/api/status` 的
平台身份投影（`agent` / `platform`），标题写死的是「位置」而不是平台名，换执行体或换用户平台时格子仍成立。

| 格 | 标题 | 值 | 副行 |
| --- | --- | --- | --- |
| 1 | 执行体 | `agent.label` + 连接态（未就绪标红） | 连接方式（`http` / `stdio`）+ 连接态 |
| 2 | 用户平台 | `platform` 的显示名 | 上游摘要（该平台上报了 `snowluma` 才有：正常 / 连不上网关 / 连着但收不到数据） |
| 3 | 当前运行方案 | 模式名 | 角色（`state/profiles/<key>.role`） |
| 4 | 已建立会话 | 会话数（可点） | 查看会话映射 |
| 5 | 待处理请求 | 提问 + 审批数（可点） | 提问与工具审批 |

- 数据由 `js/app.js` 的 `refresh()` 写入，DOM 由 `pages/overview/fields.js` 的 `METRICS_HTML` 产出；
  不新增组件、不在页面里写样式。文本格用 `.metric strong.is-text` 修饰字号，新增指示格不会再需要按 id 加样式分支。
- 第 2 格的上游摘要按平台上报的事实出现，不按平台名判断：用户侧换成没有上游健康的平台时，副行自然变成
  「未上报」，格子标题仍成立。告警条与这行副行由同一次 `snowluma` 快照渲染，两处不会说出不同结论。
- 新诊断码：`capability_overclaimed`、`agent_provider_invalid`、`agent_instance_offline`、
  `passthrough_degraded`、`permission_unreadable`、`permission_write_failed`、`plan_warn`。
  全部走既有 `diagnostics` 通道（`/api/platforms/registry` 携带），不新开接口。

---

## 9. 批次表

按依赖排序；同一批内尽量不中断。

| 批 | 目标 | 主要文件 | 门禁 |
| --- | --- | --- | --- |
| **P0** ✅ | 执行体可换（分四段）：**P0a** 连接层下沉 + 删 `REQUIRED_PROTOCOL_MEMBERS`；**P0b** 事件面 / 审批引用 / 用量账本归一（§4.4）；**P0c** ACP 当主平台 + TCK（§4.2）；**P0d** 概览指标卡按位置命名（§8.6） | `src/agent-side/runtime.mjs`、`adapters/{dsh,acp}/`、`src/bridge.js`（`pumpMux` / 账本 / `agentStatusSummary`）、`scripts/test-agent-port-tck.mjs`、`public/console/pages/overview/fields.js` | `verify:repo` 101/0、`test:audit` 全绿、`test:tck` 两家全绿、`test-console-{static,ui}` |
| **P1** ✅ | Agent 侧插件化：`agent-provider:provide` + `ctx.agentPlatforms` + owner 清理 + 三条装配诊断（§4.3） | `src/agent-side/runtime-registry.mjs`、`src/agent-side/runtime.mjs`、`src/plugins/{manifest,host-api,kernel}.mjs`、`src/platforms/registry.mjs`、`PLUGIN_KERNEL.md` | `test-agent-provider` 新增、`test:audit` / `verify:repo` 全绿 |
| **P2** ✅ | 配置：`platforms.agents.<id>` 多实例可写、默认执行体（`platforms.active.agent`）、agent 侧 probe/config 端点与注册表的 `configured`/`probe` 读视图 | `src/config/platforms.mjs`、`src/platforms/registry.mjs`、`src/bridge.js`（注册表写口与 `/api/config/runtime`）、`public/console/pages/platforms/`、`public/console/components/form/schema.js`、`guides/CONFIGURATION.md` | `verify:repo`、`test:audit`（含新增 `test-platform-config`）、`test-console-{static,ui}` |
| **P3** | 多入站：每实例一条管线、出站解析、用户侧实例 UI | `src/bridge.js`（`startUserPlatformInbound` 单例处）、`src/user-side/inbound.mjs`、`src/config/platforms.mjs` | `test:audit`、`test-console-ui`、`test:v030` 等价回归 |
| **P4** | 方案解绑 + 能力档 `runtime` 段 + 方言上移 + `direct` 方案 | `src/runtime/plans.mjs`、`src/capabilities/store.mjs`、`profiles/**`、`adapters/dsh/adapters/build.mjs` | `verify:artifacts`、`test:artifact-pipeline`、`test:preset-prompt` |
| **P5** | 直通运行期：提示注入三通道、权限读写与漂移、会话详情块、全局执行体卡 | `src/runtime/prompt-compose.mjs`（新增运行期入口）、`src/agent-side/port.mjs`（`prompt` 能力位）、`public/console/pages/{config,sessions,plans,platforms}/` | `test-console-ui`、新增 `test-passthrough-plan.mjs`、`verify:persona` |
| **P6** | 收口：文档同步（PROFILES_MODEL / SESSION_SUBSYSTEM / CONSOLE）、`PLATFORM_UNIFICATION.md` C6.5 核销 | `docs/**` | `verify:repo` 全绿 |

回滚：P0 的连接层下沉与删门面是同一版内的替换，不存在「先留着旧路径以后删」的中间态；
要换执行体就换 `createRuntime` 的实现，要退只能整批退回上一个可运行提交。
P2（配置）与 P4（方案）各自带 `configVersion` 与方案 `version` 递增，读旧值即旧行为；
P1（Agent 侧插件化）是纯增量，单独回滚不影响运行。

---

## 10. 不做清单

| 不做 | 理由 |
| --- | --- |
| 同会话跨执行体热迁移 | 历史在对端，迁不了；只能「在新实例上重开」 |
| 直通下的工具级白名单 | 技术上给不了（§7.5）；给了就是假安全 |
| 把桥接四级权限强行映射到任意对端 | ACP 只有逐次 allow/reject，映射出来的「只读」是假话 |
| 会话级 `agentPlatform` 覆盖 | 实例是会话归属的单位，再加一层覆盖只会让审批回执更难对账 |
| 为直通单开一条运行时代码路径 | 直通必须是同一套方案模型的取值，否则就是第二套体系 |
| 自动回钉直通下的权限档 | 违背直通的语义；只告警 + 提供「改回」 |

---

## 11. 待确认（已给默认值，可直接按默认开工）

| # | 点 | 默认 |
| --- | --- | --- |
| 1 | 用户侧多实例的实例键 | `platform[@account]`（与 `src/session/key.mjs` 文法一致，不新增规则） |
| 2 | `runtime.defaultAgent` 与方案 `agentPlatform` 的优先级 | 方案显式 > 全局默认；内置方案全部 `auto` |
| 3 | 群聊直通 | 不内置，从 `direct` 克隆；克隆时 `plan_warn` 提示风险 |
| 4 | `allowForbiddenPreset` | 默认 `false`；仅 owner + 二次确认可开 |
| 5 | 旧方案里的 `platform` 字段 | 读取时忽略 + `plan_warn`，下一版删字段 |
| 6 | `social-v1` 是否并入平台层 | 不并：行为档案按平台走，方案只引用行为 id |

---

## 12. 相关文档

| 文档 | 关系 |
| --- | --- |
| [PLATFORM_UNIFICATION.md](PLATFORM_UNIFICATION.md) | 总纲；本文接 §4.4 的 C6.5 核销与 §9.1 的 ACP 差异表 |
| [PROFILES_MODEL.md](PROFILES_MODEL.md) | 「四层配置」在 P4 后要改写为「四轴 + 三层默认」，届时同步 |
| [AGENT_PLATFORM_EVOLUTION.md](AGENT_PLATFORM_EVOLUTION.md) | P0 的连接层下沉是该文 P2「中立 Agent IR」的先行部分 |
| [guides/ADMIN_CHANNEL.md](guides/ADMIN_CHANNEL.md) | 直通下 `/level` 语义变化要同步（§7.4） |
| [CONSOLE.md](CONSOLE.md) / [CONSOLE_FORMS.md](CONSOLE_FORMS.md) | §8 的界面改动必须遵守的组件与表单约定 |
| [guides/ADD_USER_PLATFORM.md](guides/ADD_USER_PLATFORM.md) | 用户侧四步不变；多实例只是把「一条管线」复制成多条 |
