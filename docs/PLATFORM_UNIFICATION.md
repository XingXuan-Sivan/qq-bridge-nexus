# 平台统一与 Agent 通用化（PLATFORM_UNIFICATION）

> **状态**：C0–C9 已完成（C8 收尾于 2026-11-14，结果见 §9.4；C9 见 §9.5）。C6.5「把 ACP 接成主平台」已收口 ——
> 见 §9.2 的「接线状态」：ACP 自带连接层与 `createRuntime`，与 DSH 同过 `RUNTIME_MEMBERS` 成员表校验，可在「全局配置 › 运行」里切成默认执行体。衔接并取代两份旧规划中"只做了一半"的部分：
> [PLATFORM_DECOUPLING.md](PLATFORM_DECOUPLING.md) 的 B0–B8 已完成（本方案不推翻，只补齐 B8 之后的缺口）；
> [AGENT_PLATFORM_EVOLUTION.md](AGENT_PLATFORM_EVOLUTION.md) 的 P2「中立 Agent IR」**触发条件已满足**（要接第二个 Agent 平台），纳入本方案 C4。
>
> 最后更新：2026-11-14（0.2.0 定版后首份方案）
> 实施时按 §九 的批次走，不要凭记忆重构。

---

## 一、需求（可验收命题）

| # | 命题 | 验收方式 | 现状 |
| --- | --- | --- | --- |
| R1 | 新增用户侧平台后**既能收又能发**，且不改进内核 | mock 平台端到端：收消息 → 准入 → 唤醒 → 发消息 | ❌ 只能发（入站未接） |
| R2 | 新增 Agent 平台**不加一行 `src/` 代码** | 写 `adapters/acp/` 后 `test:audit` 全绿 | ❌ 门面导出 11 个 DSH 符号 |
| R3 | 多平台/多实例并存不串号，`active` 可切且真的生效 | 同进程 qq + mock 活跃；`platforms.active.user` 改后默认发送目标随之变 | ⚠️ 发送按地址分平台，`active` 不生效 |
| R4 | 界面**一个入口**看全两侧平台，能配、能测、能诊断 | 新增平台后界面自动出现，零前端改动；契约缺失当场标红 | ❌ 三份列表、三处入口 |
| R5 | 无兼容层、无双源、目录可解释 | 全仓 `git grep` 无第二份平台清单；`check-profiles` 通过 | ❌ 见 §二 |

**明确不含**：不追求"同一份配置装到任意 Agent 平台"（那是 P2 的完整愿景）；本方案只要求**能力档成为唯一真源、由各平台适配器渲染**。

---

## 二、现状诊断

> **本节写的是 C0 之前的形态**（§2.1 的六个声明源、§2.3 的四标签、§2.4 的缺口清单）：它是方案要解决的问题清单，
> 不是现状态。表里提到的 `/api/platforms`、`/api/runtime/platforms`、`/api/runtime/agent-platforms`
> 与 `pages/behavior/`、`components/platform-panel/` 已随 C1–C7 消失；现行形态见 §七 与 §9.3。

### 2.1 「平台」有六个声明源

| # | 位置 | 字段 | 谁在读 | 问题 |
| --- | --- | --- | --- | --- |
| A | `profiles/platforms/<id>/` | `platform.yml`(id/label/note)、`tools.yml`、`prompt.md`、`behaviors/` | `/api/platforms` → `components/platform-panel/` | 只回答"有没有配置"，不回答"能不能用" |
| B | `profiles/agent-platforms/<id>/` | `agent-platform.yml`、`tools.yml`、`capabilities/`、`agents/` | `/api/capabilities`、`/api/presets` | `capabilities` 与 `agents` 语义重叠（见 2.2） |
| C | `src/runtime/adapters.mjs` `builtinAdapters()` | `label/capabilities/vars`，**qq 与 dsh 硬编码** | `/api/runtime` → 方案页「平台 · Agent」列 | 绕过 B5–B7 全部解耦成果 |
| D | `src/user-side/runtime-registry.mjs` + `transport.mjs` | `id/label/conversationTypes/capabilities/limits` | `/api/runtime/platforms` | 真正的运行期真源，界面只在两处下拉里用到 |
| E | `src/agent-side/runtime-registry.mjs` | 同上 + `protocol` | `/api/runtime/agent-platforms` | **前端零消费** |
| F | `config.json` 的 `platform.id` / `snowluma.*` / `dsh.*` | 平台选择与传输参数 | bridge、MCP 独立进程 | 选择不生效；传参只有 QQ 有位置 |

### 2.2 「能做什么」被三处同时描述

> **C4 已收敛**：`agents/<id>/` 并入 `capabilities/<id>.yml`（`preset` + `rows` 段），plan 删除 `agent` 字段只留 `capability`。
> 下表是 C4 **之前**的形态，保留作诊断依据。

| 位置 | 数量 | 举例 | 谁决定 |
| --- | --- | --- | --- |
| `profiles/agent-platforms/dsh/agents/<id>/` | 5（`chat` `chat-v2` `readonly` `workspace` `full`） | 手写 `agent.cordis.yml` + `preset.yml` + 549B 的 `qq-tool-restrict.mjs` 薄壳 | DSH preset 安装 |
| `profiles/agent-platforms/dsh/capabilities/<id>.yml` | 4（`agent-chat` `agent-readonly` `agent-workspace` `agent-full`） | `tools.platform` / `tools.agent` / `mcp` / `skills` | 平台工具注册面、工具开关 |
| `profiles/plans/<id>.yml` | 6 | 同时写 `agent: chat-v2` **和** `capability: agent-chat` | 会话最终档位 |

`plans/social-v2.yml` 的实际内容同时出现三个近义名（`social-v2` / `chat-v2` / `agent-chat`），分别指向行为档案、DSH preset、能力预设。
**同一个会话"能做哪些事"由三份文件共同决定，改其中任一份都不会通知另外两份。**

另有一处易混淆：`agents/<id>/qq-tool-restrict.mjs` 是 5 份**相同**的 549B 薄壳（SHA256 前缀 `3573A344E72A`），
而 `artifacts/dsh/qq-agent-presets/qq-tool-restrict.mjs` 是 13KB 的**唯一权威实现**。迁移时必须核对前者用途，不能一起删。

**C4 之后的形态**：一份 `capabilities/<id>.yml` 同时给出 `tools`（能做什么）、`preset`（DSH 预设列表里显示什么）、
`rows`（插件行，渲染成 `artifacts/dsh/qq-agent-presets/presets/<id>.patch.yml`）、`extensions`（MCP/技能授权）四段；
**能力档 id 就是 preset id**（`chat` / `chat-v2` / `readonly` / `workspace` / `full` / `direct`）。
P4 起再增 `runtime` 段（`apply` / `prompt` / `permission` / `narrow`）：`apply: passthrough` 的档不装预设、`rows` 可为空、不产 patch。核对结果：那 5 份薄壳只是把裸说明符
`qq-agent-presets/qq-tool-restrict.mjs` 转发一次，随 `agents/` 一起删除；权威实现留在 artifacts 里不动。

### 2.3 界面 IA 错位：四标签按"存储层级"组织，不按"用户问题"组织

`pages/behavior/page.html` 的四个标签（`platform` / `plans` / `behaviors` / `capabilities`）恰好对应当时的配置层级，
但**没有一层是"平台能不能用"**——而"能不能用"正是 B5–B7 做的运行期能力。结果是：

| 用户的问题 | 现在去哪 | 数据源 | 结论 |
| --- | --- | --- | --- |
| 我接了哪些平台？能用吗？ | ❌ 无处 | — | **缺一个页面** |
| 这个平台怎么说话？ | 行为档案 → 平台 | 配置面 A | 位置错（要先点进"档案"） |
| 这个平台的工具开了哪些？ | 行为档案 → 平台（只读表） | 配置面 A | 只读，且与能力预设重复 |
| 这个消息用哪个档位？ | 行为档案 → 运行方案 | B + C 混合 | 与"能力预设"标签重叠 |
| 这个 Agent 能拿哪些工具？ | 行为档案 → 能力预设 | 配置面 B | 与 `agents/` 的 preset 重叠 |
| 哪里坏了？ | 散落在概览/运维 | — | 无契约级诊断 |

### 2.4 缺口清单（用户提出 + 实测补充）

| 侧 | 缺口 | 根因 |
| --- | --- | --- |
| 用户 | 只能出站 | `transport` 契约只有 `send`，bridge 入站仍是 QQ WS 分支 |
| 用户 | `cfg.platform.id` 不切平台 | 只用于 key 前缀与 owner 归一；`useUserPlatform()` 在 `src/` 里**零调用** |
| 用户 | 内置平台无 `configSchema` | ~~`platform.yml` 只有 `id/label/note`~~ → **C2b 已修**：`platform.yml` 落 `vars` + `configSchema`（复用 `src/plugins/config-schema.mjs`） |
| Agent | 只有骨架 | 门面导出 DSH 语义常量；`bridge.js:3760` 直接 `new AgentApiClient(...)` |
| Agent | 无现成插槽 | 无中立契约；`sessions.json` 存裸 `sessionId`，语义绑死 DSH |
| 界面 | 新增平台不自动反映 | 三份列表并存（2.1） |
| 界面 | 无法统一管理 | 无配置表单、无探活、无诊断 |
| 工程 | 两套规划文档 | 本方案并入 P2，实施时同步标注旧文档状态 |

---

## 三、目标概念模型（唯一真源）

```
L0  实现层（代码）      UserPlatform 实现        AgentPort 实现
                         src/user-side/adapters/*  src/agent-side/adapters/*
                                   │                        │
L1  平台声明（目录）    profiles/platforms/<id>/   profiles/agent-platforms/<id>/
                         platform.yml + agent-platform.yml（身份 + configSchema）
                         能力面来自实现自报（用户侧 describePlatform / Agent 侧 runtime.mjs）
                                   │                        │
L2  能力档（唯一）      —                          capabilities/<tier>.yml   ← 吸收原 agents/（C4 已落地）
                                                    （工具/MCP/技能/渲染参数）
                                   │                        │
L3  行为档案            profiles/platforms/<id>/behaviors/<id>.yml
                                   │
L4  运行方案            profiles/plans/<id>.yml = capability + behavior + audience（+ 可选 agentPlatform）
                                   │
L5  会话绑定 + 权限级别  state/sessions/*.json = planId + agentRef + level
```

**三条铁律**（每批都要过一遍）：

1. **上游只引用下游 id，不重复描述**：plan 引用 capability 与 behavior，不得再抄一份工具清单。
2. **派生物不手写**：DSH 预设 patch（`artifacts/dsh/qq-agent-presets/presets/<id>.patch.yml`）由 capability 的
   `preset` + `rows` **渲染**（C4 已落地，golden 逐字节比对）。`profiles/.../agents/` 目录已删除，不再有手写预设源。
3. **声明面不 import 实现**：`profiles/*/adapters/runtime.mjs` 只放常量与纯函数（现有不变式，继续沿用）。
   用户侧**不新增**声明面 mjs：能力/上限仍由实现自报（`describePlatform()`），`configSchema` 落 `platform.yml`。

**与旧文档的关系**：本文 §三 取代 `PROFILES_MODEL.md` §一 的层级表（实施 C2 时同步改写该节）；
`PROFILES_MODEL.md` 继续作为"各文件字段字典"存在，不重复叙述层级。

---

## 四、目录重构（新 → 旧映射）

### 4.1 目标目录

```
profiles/
├── platforms/
│   └── qq/
│       ├── platform.yml            # id/label/vars + configSchema（JSON Schema 子集，C2b 已加）
│       ├── tools.yml
│       ├── prompt.md / prompt.default.md
│       ├── behavior-types/*.yml
│       └── behaviors/*.yml + .defaults/
├── agent-platforms/
│   └── dsh/
│       ├── agent-platform.yml      # + configSchema
│       ├── adapters/{runtime,build,install}.mjs
│       ├── tools.yml
│       ├── capabilities/*.yml      # ★唯一能力档（chat / chat-v2 / readonly / workspace / full）
│       └── (agents/ 已删除 → 预设正文并入 capability 的 preset + rows 段)
├── plans/*.yml + .defaults/
└── schemas/                        # 6 份（+platform-runtime）
```

### 4.2 迁移映射

| 旧 | 新 | 处理 |
| --- | --- | --- |
| `agents/chat`（`agent.cordis.yml` + `preset.yml`） | `capabilities/chat.yml` + `artifacts/dsh/qq-agent-presets/presets/chat.patch.yml` | **已落地（C4）**：手工合并成一份 capability，预设由 build 适配器渲染 |
| `agents/chat-v2` | `capabilities/chat-v2.yml`（保留独立档位） | **已落地（C4）**：按 §十一 Q1 拍板"不合并"——`chat-v2` 的 rows 与 `chat` 差异不只一个分支，硬塞进 `render.dsh.chatV2` 会让能力档失真 |
| `agents/qq-tool-restrict.mjs`（5×549B） | `artifacts/dsh/qq-agent-presets/qq-tool-restrict.mjs`（13KB 权威） | **已落地（C4）**：核对确认是纯转发薄壳，随 `agents/` 一起删除 |
| `capabilities/agent-chat.yml` | `capabilities/chat.yml`（去 `agent-` 前缀） | **已落地（C4）**：改名 + 字段重整（五个：`chat` / `chat-v2` / `readonly` / `workspace` / `full`） |
| `plans/*.yml` 的 `agent:` 字段 | 删除，只留 `capability:` | **已落地（C4）**：12 处引用同步改完，`src/runtime/plans.mjs` 不再识别 `agent` |
| `src/runtime/adapters.mjs` | **C2b 已删除**：`vars` 搬进 `platform.yml`、两侧 `configSchema` 搬进平台目录；插件注册通道迁到 `src/platforms/adapter-registry.mjs` | `/api/runtime` 的 `adapters` 字段已在 C1 删除 |
| `profiles/platforms/<id>/` 之外的平台清单拼接 | `src/platforms/registry.mjs` | 单点合成（见 §七） |

### 4.3 `src/` 目录调整

| 现状 | 目标 | 理由 |
| --- | --- | --- |
| `src/runtime/adapters.mjs` | ~~C1 删 `snapshot()`；C2 起逐步下线~~ → **C2b 已整份删除** | 硬编码平台清单，与注册表重复；`platformVars()` 的「取第一个」语义在多平台下本就是错的 |
| — | `src/platforms/adapter-registry.mjs` | 只留**插件注册通道**（`adapters:provide`）：内置平台描述在平台目录里 |
| — | `src/platforms/registry.mjs` | 统一注册表：四个来源合成一张表 + `diagnostics` |
| — | `src/agent-side/agent-port.mjs` | 中立契约 + `requireCapability()` |
| `src/agent-side/agent-client.mjs` | **已删除**（C6.5 / P0） | 连接职责下沉进 `adapters/<id>/runtime.mjs` 的 `createRuntime`，装配期校验由 `src/agent-side/runtime.mjs` 的 `RUNTIME_MEMBERS` 承担（缺成员即抛错）；调用面本来就全在 `AgentPort`。见 EXECUTION_BODY_GENERALIZATION §4.1 |
| `src/capabilities/store.mjs` | 扩为 capability 真源 + 渲染接口 | 吸收 agents/ 语义 |
| `src/behaviors/index.mjs` | 保留 | 行为档案仍是平台子资源 |

### 4.4 删除清单（C8 收尾时逐项核销）

```
profiles/agent-platforms/dsh/agents/     （C4 已删）
src/runtime/adapters.mjs          （C2b 已删）
src/agent-side/agent-client.mjs   （C6.5 已删，连接层归 agent-side/runtime.mjs）
public/console/pages/behavior/            （C7 已删，整页，四标签全部拆走）
public/console/components/platform-panel/ （C7 已删，内容拆入平台页）
```

五项已清零：`src/agent-side/agent-client.mjs` 在 C6.5 删除。它原来承担的两件事各有了归口——「怎么连上平台」
（客户端、地址发现、凭据、探活分类）进 `src/agent-side/adapters/<id>/runtime.mjs` 的 `createRuntime`，
装配期守卫进 `src/agent-side/runtime.mjs` 的 `RUNTIME_MEMBERS`（缺成员 fail-closed，守卫没丢）。ACP 的成员表现已齐备，可当主平台。

> C6.5 的落地方案见 **[EXECUTION_BODY_GENERALIZATION.md](EXECUTION_BODY_GENERALIZATION.md)** §4：
> 连接层下沉为适配器契约 `createRuntime({config,log,onBaseUrlChange})`，成员表与 fail-closed 口径见 §4.1.1；
> `REQUIRED_PROTOCOL_MEMBERS` 已随门面删除，注册门槛改由 `scripts/test-agent-port-tck.mjs` 承担（`npm run test:tck`）。

### 4.5 声明面字段（C2b 落地）

两侧声明面只多两个键，其余字段含义不变：

| 键 | 位置 | 消费方 |
| --- | --- | --- |
| `vars` | 仅 `platform.yml` | 提示词渲染：`{platform}` / `{displayName}` / `{owner}`。白名单 `PROMPT_VAR_KEYS`（`src/runtime/prompt-compose.mjs`）之外键一律丢弃；多写的键不会静默生效 |
| `configSchema` | 两侧 yml | 统一注册表 `vetConfig()` → `config_invalid` 诊断；C7 控制台表单；校验器 `src/plugins/config-schema.mjs`（object + 标量/枚举/数组，不引完整 JSON Schema） |

三条硬约束：

1. **字段是扁平的**：写 `httpUrl` / `baseUrl`，不写 `transport.httpUrl` / `endpoint.baseUrl`。配置 v2 把连接参数与选项分两段存，`flatPlatformEntry()` 在校验前拍平——schema 不需要知道这层分法。
2. **`additionalProperties` 必须为 true**：行为选项（`backfill`、`social` 等）不在这张表里穷举；收紧等于让老配置被判成「未声明的配置项」。
3. **不设 `required`**：所有字段都有默认行为（空串 = 自动发现/默认账号），`required` 只会把「还没配」变成一条红色诊断。

取值优先级：`platform.yml` 的 `vars` → 插件按同 id 注册的适配器 `vars`（覆盖）→ `renderPlatformPrompt` 的内置默认值。平台显示名再退回 `platform.yml` 的 `label`。

---

## 五、Agent 侧：`AgentPort` 契约

### 5.1 方法集（内核只认这些动词）

| 分组 | 方法 | 能力位 | ACP 对等 |
| --- | --- | --- | --- |
| 发现（核心） | `probe()` → `{ok, version, detail}` | — | `initialize` |
| 会话（核心 + 能力） | `listSessions()` → `{sessions}`；`ensureSession(params)` → `{sessionId}`；`renameSession(ref,title)`；`archiveSession(ref)`；`listPresets()` → `{presets}` | `session` `rename` | ✅ / rename 在 RFD |
| 回合（核心） | `prompt(ref,{content,mode,requestId})` → `{accepted}`；`cancel(ref)` | — | ✅（响应即回合结束 + `stopReason`） |
| 权限 | `applyPermission(ref,preset)` → `{value}`（已解包的回执，**不判定**）；`readPermission(ref)` → `{preset,text}`；`respondPermission({clientId,eventId},decision)`；`listPermissionPresets()` → `{options,defaultPreset}` | `permission` | ⚠️ 只有逐次决策 |
| 模型 | `listModels()` → `{catalog}`；`selectModel(ref,params)` → `{selected}` | `models` | ✅ config options |
| 设置 | `readSettings(ns)` → `{value}`；`writeSettings(patch)` → `{value}` | `settings` | ❌ DSH 专有 |
| 工作区 | `createWorkspace({path})` → `{workspaceId,created}`；`renameWorkspace({workspaceId,title})` | `workspace` | ❌ |
| 压缩 | `compactSession(ref)` → `{ok,kind,text}` | `compact` | ❌ |
| 维护 | `rebuildSession` / `healSession` | `maintenance` | ❌ |

返回值的形状约定（所有实现都必须遵守）：语义字段（`sessions` / `sessionId` / `preset` / `catalog` …）
是**已解包**的，`raw` 永远是平台返回的**原始响应**。两者都交出去是刻意的——判定与用户提示只用语义字段，
排查时再去看 `raw` 里平台的原话，避免每个调用点自己知道包装长什么样。

落地时的补全（实施 C5 时发现，方案原表漏了）：

- `agentPresets/list` 与 `permissionPresets/catalog` 原来被桥接直接调，归入 `session` / `permission`
  两个能力位（`listPresets` / `listPermissionPresets`）—— 它们决定控制台的下拉选项与 L3 能不能开，
  不能只当「内部细节」；
- `readPermission` 与 `applyPermission` **分两组方法而不是一个带参开关**：外部漂移检测只允许读，
  绝不能因为一次核对就把权限写回去。同理 `compactSession` 单开 `compact` 位——压缩是可选的
  维护动作，不支持它的平台不该被迫实现 `/compact`；
- **没有** `maintenance` 的 DSH 实现：DSH 0.2.0 的 API 里没有「重建/自愈会话」的 RPC，
  桥接现在所谓重建是「停止 + 归档 + 新建」的组合。声明这个能力位会让控制台画出不存在的按钮，
  所以 DSH 不声明它，调用时 fail-closed 报 `capability_unsupported`。

### 5.2 归一事件（适配器翻译，内核只见这个）

| kind | 载荷 |
| --- | --- |
| `text` / `reasoning` | `delta` |
| `tool` | `phase(start,end)` / `name` / `callId` / `summary` |
| `permission` / `question` | `requestId` / `options` 或 `questions` |
| `plan` / `usage` / `compaction` / `notice` | 对应载荷 |
| `turn-end` | `stopReason` ← 回合边界由适配器给，bridge 不再猜 |

### 5.3 三条硬规则

1. **能力缺失 fail-closed**：`requireCapability('workspace')` 直接抛 `capability_unsupported`，不静默降级（与用户侧 `poke` 一致）。
2. **策略归桥接**：`applyPermission` 只接受内核四级；ACP 的 `allow_always` **不映射**，每次由桥接决策（否则 Agent 侧会记住授权，桥接无法审计回收）。
3. **会话引用去平台化**：`state/sessions/*.json` 用 `binding.agentRef: { instance, sessionId }`，`instance` 形如 `dsh` / `acp:claude`。
   **已落地（C5 第三批）**：内存里的 `state.sessions[key]` 也是同一形状；读侧 `get` / `ids` / `entries` / `raw`
   仍产出裸 id（四十多处调用点零改动），归属由 `ref(key)` / `instanceOf(key)` 回答。
   老数据（裸 id、`binding.sessionId`）读入时归一，平台装好后由 `sessions.normalizeAll()` 补记 `instance`
   并落盘（只补空值，不覆盖已明确的归属）。`instance` 不同的引用在两处判废：`ensureSession` 的复用分支
   与休眠恢复（`dormant.instance`）—— 判废时**不向当前平台**发 cancel/archive，旧会话不在那边。

### 5.4 bridge 调用面收敛

迁移前实测（2026-11-14，C5 第二批动手前）：`api.respond`（8）、`api.stopSessionWork`（5）、
`api.callUnary`（4）、`api.setBaseUrl`（1），以及 `session.modelCatalog` / `session.models` /
`session.rename` / `workspace.archiveSession` / `settings.describe` 等 20+ 个 DSH 字面量，合计 **55 处**调用面。

迁移后（已完成）：bridge 只出现 §5.1 的中生动词；`unwrap()` 在 `src/bridge.js` 与 `src/session/reset.mjs`
里归零，`src/self-test.js` 同样改走 `agentPort`。保留下来的平台方法有两类，都不是「对会话做什么」：

- `api.setBaseUrl` —— 端点重识别（「怎么连」），凭据与地址的绑定也只有客户端自己知道；
- `api.events.follow/forget/mux` —— **事件流订阅**（传输层）。归一事件（§5.2）在事件消费侧翻译，
  「订阅哪几条会话」本身没有平台无关的等价物（ACP 是一条长连接自带全部事件）。

验收已固化成 `verify:repo` 的两条断言（见 §九 C5 的调用面部分），手工核对可以跑：

```
git grep -nE "\bapi\.(sessions?|workspace|settings|respond|stopSessionWork|callUnary|agentPresets|permissionPresets|commands)\b" -- src ':(exclude)src/*/adapters/*'
```

必须为空；白名单 `api.setBaseUrl` 单独钉「只出现在 `src/bridge.js` 一次」。

---

## 六、用户侧：三个缺口的修法

| 缺口 | 修法 |
| --- | --- |
| 只能出站 | `transport` 契约补 `connect({signal,onEvent,onStatus})` / `close()`；插件与内置走**同一条**入站管线：`raw event → validateUnifiedEvent(raw, origin) → 准入 → 会话映射 → 唤醒`。顺序不可换（校验必须在准入之前，否则插件能看到未准入会话的正文）。QQ 的 WS 分支改为调用同一个 `emit`，避免两套 |
| `active` 不生效 | 配置 `platforms.active.user`；启动时 `useUserPlatform(active)`；`sendAction` 仍按地址分发（多平台并存靠地址），`active` 只决定"没有 platform 的请求"与裸 id 的解析 |
| 无 `configSchema` | 落 `platform.yml` / `agent-platform.yml`（C2b 已完成）：扁平字段 + `additionalProperties: true`，校验与渲染**复用** `src/plugins/config-schema.mjs`，不引新依赖。用户侧声明面**不新增 mjs** |

**C3 进度（2026-11-14 第二批，已完成）**：管线、契约、QQ 适配器回填、bridge 接线四处齐了。

- ✅ `src/user-side/inbound.mjs`：`createInboundPipeline({origin, admit, resolve, deliver, onDrop})` —— 四步顺序写死在一处，
  任何时候不抛错（异常一律变成 `{ok:false, reason}`），回归见 `scripts/test-unified-inbound.mjs`（11 条）；
- ✅ `transport` 契约：`registerTransport` 接受 `connect`（定义上或 `create()` 产物上），注册表只对外给
  `inbound: boolean` —— 只实现发送的平台合法，但会被标成「只出不进」；
- ✅ `src/user-side/adapters/qq/inbound.mjs`：`connectOneBot({signal,onEvent,onStatus})` 把 OneBot 报文翻成统一事件、
  剔掉自己发的消息、`onMessage` 优先于旧 SDK 的 `onPrivateMessage`/`onGroupMessage`、退出时逐一退订；
  未知段（`face`/`json`/`xml`…）一律降成占位文本 —— 翻译**不判准入**，陌生段也不该把整条消息判成 INVALID；
- ✅ bridge 接线：启动时 `startUserPlatformInbound()` 起、`shutdownThenExit()` 先摘订阅；准入（`passiveAllowed`
  与管理通道）、会话映射（`convKey`）、唤醒（`handleIncoming`）仍在 bridge；`deliver` 传 `ext.raw`，
  下游业务体吃到的报文形状归 C5；
- 回归：`scripts/test-qq-inbound.mjs`（新，14 条）、`test-transport-plugin.mjs` 增 mock 平台端到端
  「收 → 校验 → 准入 → 会话映射 → 唤醒 → 发」（15 条）、`test-platform-registry.mjs` 改写「只发不收」用例（13 条）。

---

## 七、界面：系统性重构

### 7.1 设计原则

**按用户任务组织，不按存储层级组织。** 一次导航解决一个问题：

| 用户问题 | 归属页面 |
| --- | --- |
| 我接了哪些平台？能用吗？哪里坏了？ | **平台**（一级） |
| 这个会话/这个群用哪个档位？ | **方案**（一级） |
| 这个平台怎么说话？ | 平台详情 → 行为 |
| 这个 Agent 能拿哪些工具？ | 平台详情 → 能力 |
| 连接参数、token、地址 | 平台详情 → 配置 |

### 7.2 目标 IA

```
运行总览 | 会话与审批 | 平台 ★ | 方案 ★ | 人格与角色 | 记忆 | 黑话 | 扩展 | 定时任务 | 运维 | 全局配置
                        │
           ┌────────────┴────────────┐
        用户侧                     Agent 侧
     QQ / Mock / …              DSH / ACP:claude / …
           └────────────┬────────────┘
                  平台详情（tabs）
   用户侧：概览 · 配置 · 话术与工具 · 行为（有档案才有）
   Agent 侧：概览 · 能力（有声明的能力档才有）· 配置
```

标签按「这一侧真有的资产」给，不按平台 id 分支；没有资产就不画那一栏（见 §9.3 的三处留白）。

**平台页顶部固定一条诊断汇总**：`2 个平台 · 1 警告 · 1 错误`，点开是 `diagnostics` 列表；没有诊断时这张卡不占地方。

### 7.3 四个旧标签的取舍（本方案的明确结论）

| 旧标签 | 权威存储 | 去向 | 理由 |
| --- | --- | --- | --- |
| **平台** | `profiles/platforms/<id>/` + 运行期注册表 | → 一级「平台」页的**列表 + 详情** | 它本来就该是独立页面，不该藏在"档案"里 |
| **运行方案** | `profiles/plans/*.yml` | → 一级「方案」页（`pages/runtime/` 改名 `pages/plans/`，路由 id `plans`） | 方案是**跨平台组合**，不属于任何单个平台 |
| **行为档案** | `profiles/platforms/<id>/behaviors/` | → 平台详情 → 「行为」标签（仅用户侧平台有） | 档案是平台的**子资源**，靠平台过滤天然收窄 |
| **能力预设** | `profiles/agent-platforms/<id>/capabilities/` | → 平台详情 → 「能力」标签（仅 Agent 侧有） | 同上是子资源；与 `agents/` 合并后名字只剩一套 |

**结论：`public/console/pages/behavior/` 整页删除**，`components/platform-panel/` 拆解：
表格 → 平台页列表；提示词 + 工具表 → 平台详情「话术与工具」。
`components/capability-panel/` 保留组件形态，但要改数据源（不要再自己拼 `/api/capabilities` 与 `/api/runtime/capabilities` 两份）。
`pages/runtime/page.js` 改名 `pages/plans/page.js`，去掉「平台 · Agent」列的硬编码兜底（`AGENT_FALLBACK`）。

### 7.4 统一注册表（界面唯一数据源）

`src/platforms/registry.mjs` 合成四类输入 → 一个形状：

| 输出字段 | 含义 |
| --- | --- |
| `id` / `side(user|agent)` / `label` | 身份 |
| `source` | `builtin` / `plugin` / `profile-only`（只有配置目录、没有实现） |
| `active` | 是否当前默认 |
| `capabilities[]` / `conversationTypes[]` / `limits{}` | 能力面（来自实现） |
| `configSchema` / `config` | 配置面（来自声明面 + `config.json`） |
| `assets` | `{ prompt, tools, behaviors, capabilities }` 有无 |
| `probe` | 上次探活结论 `{ ok, at, url, error }`（P2 落地；是「最近一次请求的结果」，不是快照自带的事实） |
| `diagnostics[]` | 见 7.5 |

**C1 已落地的字段**：`id` / `side` / `label` / `note` / `source` / `owner` / `active` / `capabilities` /
`conversationTypes` / `limits` / `inbound` / `configSchema` / `config` / `assets` / `diagnostics`。
`assets` 实际形状是 `{ prompt:{active,hasDefault}, tools, behaviors, capabilityProfiles }`（C4 起能力档列表就是预设列表，不再另给 `agentPresets`）；
`source` 只取 `builtin` / `plugin` / `profile-only` 三值（`profile-only` 是合成出来的，不再单设“只有目录”那一栏）。
P2/P3 再加运行期事实：`configured`（配置面选的是哪条，与 `active` 不一致时出 `active_pending_restart`）、`enabled` /
`inboundState` / `outbound` / `rawEvent`（用户侧每条实例各自的入站管线）、`probe`（Agent 侧上次探活结论）。
原定的两处待落地已清：探活端点与 `PATCH .../config` 均在 P2 落地（两侧共用一条写路径，校验与诊断同一套 schema 规则）。

端点（旧的全部删除，不留投影）：

| 端点 | 用途 |
| --- | --- |
| `GET /api/platforms/registry` | 统一读（平台页、会话页下拉、方案页共用） |
| `PATCH /api/platforms/registry/:side/:id/config` | 写配置（按 `configSchema` 校验） |
| `POST /api/platforms/registry/agent/:id/probe` | 探活（只有 Agent 侧；用户侧看条目的 `inboundState`，不另做探活） |
| `GET /api/plans` / `POST /api/plans[/:id]` | 方案 CRUD（原 `/api/runtime/plans`） |

### 7.5 可检测（诊断码）

| code | 判定 | 级别 | 落地 |
| --- | --- | --- | --- |
| `capability_missing` | 声明了能力位但实现没有对应方法 | error | C5（`AgentPort` 能力位） |
| `config_invalid` | 配置不符合 `configSchema` | error | C1 实现判定，C2 起两侧声明面都带 schema |
| `active_unregistered` | `platforms.active.*` 指向未注册 id | error | C1 |
| `inbound_unsupported` | 平台未提供 `connect`（只能发不能收） | warn | C3 起 qq 不再触发；只实现发送的平台仍会报 |
| `profile_only` | 有配置目录、无实现（能编辑但不生效） | warn | C1 |
| `probe_failed` | 探活失败 | warn | 随探活端点（C5/C6） |
| `id_conflict` | 插件 id 与内置冲突（注册期已拒绝，此处兜底展示） | error | C1 |

### 7.6 页面迁移动作清单

| 文件 | 动作 |
| --- | --- |
| `public/console/pages/behavior/*` | **删除**（5 个文件） |
| `public/console/pages/platforms/*` | **新增**：`page.html` + `page.js` + `page.css` + `platform-detail.js` + `fields.js` |
| `public/console/pages/plans/*` | 由 `pages/runtime/` 改名，去掉 `AGENT_FALLBACK` |
| `public/console/components/platform-panel/` | **删除**，表格逻辑并入 `pages/platforms/` |
| `public/console/components/capability-panel/` | 改数据源为统一注册表 + 方案页复用 |
| `public/console/js/platforms.js` | 改名 `js/registry.js`（读 `/api/platforms/registry`），函数签名保留 |
| `public/console/js/router.js` | `consolePages` 加 `platforms`、`plans`，删 `behavior`；标题/描述同步 |
| `public/console/index.html` | 导航加两项、删一项 |
| `scripts/console-source.mjs` | 页面清单同步（新页必须在册） |
| `scripts/test-console-static.mjs` | 新增"平台页是唯一平台入口"断言 |

---

## 八、配置模型 v2

```jsonc
{
  "configVersion": 2,
  "platforms": {
    "active": { "user": "qq", "agent": "dsh" },
    "users":  { "qq":  { "account": "", "transport": { "wsUrl": "", "httpUrl": "", "accessToken": "", "followDiscoveredEndpoint": true,
                                                    "viaPlatform": false, "silenceWarnMs": 600000, "launcherPath": "", "homeDir": "" },
                                "options": {} } },
    "agents": { "dsh": { "endpoint":  { "baseUrl": "", "authToken": "", "authTokenExplicit": false, "authHeader": "authorization",
                                                    "authPrefix": "Bearer", "allowRemote": false },
                          "options": {} } }
  }
}
```

**唯一实现**：`src/config/platforms.mjs`（纯函数，不读写盘）。字段分法只有它知道：

| 导出 | 职责 |
| --- | --- |
| `USER_TRANSPORT_KEYS` / `AGENT_ENDPOINT_KEYS` | 白名单：「怎么连上」的键。白名单外一律进 `options` —— 加一个业务选项不需要改这个文件 |
| `migrateConfigToV2(raw)` | 一次性迁移（纯函数，入参是 `JSON.parse` 后的配置对象、不是文件路径）。迁完删 `platform` / `snowluma` / `dsh` 三个顶层键并写 `configVersion: 2`，返回 `{ config, migrated, notes }`；调用方负责备份 + 落盘 |
| `readPlatforms(raw)` | 读 `platforms` 段并对脏输入宽容（写散的键按白名单归位）；`active` 缺省时按「目录里唯一 id → 内置默认」推断，**指向不存在的 id 时原样保留**（交给 `active_unregistered` 诊断） |
| `platformViews(platforms)` | 内核派生视图：`{ platform: {id, account}, userPlatform, agentPlatform }`，后两者是**扁平**的（连接参数在前、选项在后） |
| `configViews(raw)` | 从**尚未迁移的原始配置对象**取派生视图（先迁移）。凡自己 `JSON.parse` config.json 的地方（独立脚本、`mcp-*` 侧进程、探针、控制中心）都走这个入口，否则 v1 文件会被读成空表 |
| `flatPlatformEntry` / `flatPlatforms` | 注册表端点与控制台表单消费的扁平投影（`transport/options/endpoint` 三段不外泄） |
| `patchPlatformConfig` / `platformsForWrite` | 写盘：把补丁按白名单分到 `transport`/`endpoint` 与 `options`，序列化只保留三段 |

**`active` 真的生效**：`src/platforms/activate.mjs` 的 `activatePlatforms(cfg)` 在 `main()` 里、`configureKeys` 之前调用，两侧各自 `use*Platform(id)`；id 不可用时 **fail-closed** 并列出已注册的 id（不静默回退到内置平台）。历史上 `platformOfConfig(cfg)` 只用于拼会话 key，从未 `useUserPlatform()` —— 于是「改配置换平台」是没有效果的。

**写配置的三条路**（控制台模型选择 / token 自愈 / 控制中心目录切换）形状不同、语义相同，全部经 `patchPlatformConfig` + `platformsForWrite`，不允许各自拼 `file.dsh = {...}` 把 v2 结构写坏；写前一律 `migrateConfigToV2`（否则「只改一个 token」会变成把 `wsUrl` / `homeDir` 全删掉）。

**不留别名双读**（与 B8 的兼容策略相反：v2 从 0.2.0 起生效、没有需要长期兼容的外部配置；留着就是债）：`snowluma.*` / `dsh.*` / `platform.*` 只在 `migrateConfigToV2` 里出现一次，其余读取点一律经扁平视图；`src/snowluma-conn.js` 的 `userTransportView()` 也不再认旧 `snowluma` 段。

---

## 九、批次与验收

| 批次 | 内容 | 触及 | 验收 |
| --- | --- | --- | --- |
| **C0** | 本方案（已完成） | `docs/PLATFORM_UNIFICATION.md` + 索引 | 文档评审通过 |
| **C1** | 统一注册表：`src/platforms/registry.mjs`、`/api/platforms/registry`、`diagnostics`；旧三端点消费者改完并删除（已完成） | `bridge.js`、`src/platforms/*`、`src/user-side/metadata.mjs`、`src/runtime/adapters.mjs`（删 `snapshot()`） | `verify:repo` 新增“不得有第二份平台清单”断言；`test-platform-registry.mjs`（新，12 条） |
| **C2** | 配置 v2 + 迁移 + `active` 生效（C2a 已完成）+ 两侧声明面 `configSchema` / `vars` 搬进平台目录（C2b 已完成：`src/runtime/adapters.mjs` 已删、插件注册通道迁到 `src/platforms/adapter-registry.mjs`） | `bridge.js`、`src/config/platforms.mjs`、`src/platforms/*`、`src/session/key.mjs`、`profiles/*/*.yml`、`mcp-snowluma-safe.js` | 迁移幂等；`configVersion` 断言；`useUserPlatform(active)` 有回归（`test-config-v2.mjs` 15 条、`test-platform-activate.mjs` 5 条）；`test-platform-adapter-registry.mjs` 6 条（vars/configSchema 在目录里、内核无内置清单） |
| **C3** | 用户侧入站：`connect/onEvent` + 统一入站管线**（已完成）** | `src/user-side/{inbound,event,transport,user-platform,builtin}.mjs`、`src/user-side/adapters/qq/inbound.mjs`、`bridge.js` 入站 | `test-qq-inbound.mjs` 14 条；`test-transport-plugin` mock 平台端到端（收→准入→唤醒→发）；`test-platform-registry` 13 条 |
| **C4** | 能力模型归一：capability 吸收 agents/、plan 去 `agent` 字段、preset 改渲染产物**（已完成）** | `src/capabilities/store.mjs`、`profiles/agent-platforms/dsh/*`、`adapters/build.mjs`、`scripts/check-profiles.mjs` | 渲染结果与现有 `artifacts/**/presets/*.patch.yml` 逐字节一致（golden）：`build-artifacts --check` 逐字节一致、`test-capability-unify` 17 条、`test:audit` 126/126 |
| **C5** | `AgentPort` 契约 + DSH 适配器 + bridge 调用面迁移 + 会话引用去平台化（**已完成**三批：契约与适配器、`bridge.js` 55 处调用面、`state/sessions/*.json` 的 `binding.agentRef`） | `src/agent-side/{port,agent-client,builtin}.mjs`、`src/agent-side/adapters/dsh/port.mjs`、`src/session/{ref,registry,directory,reset,migrate}.mjs`、`bridge.js`、`self-test.js` | `test-agent-port.mjs` 21 条（能力位 fail-closed + 每个动词落到哪个 RPC + 返回值形状）；`test-session-registry.mjs` 11 条（归一、认领、跨平台归属、指纹不被 `undefined` 抹掉）；`verify:repo` 新增五条：内核不直接调平台 RPC（`\bapi\.(sessions?|workspace|settings|respond|stopSessionWork|callUnary|agentPresets|permissionPresets|commands)\b`）、`api.setBaseUrl` 只能在 `bridge.js` 出现一次、`state.sessions` 的直接读写只在会话归一层、档案里不再出现 `binding.sessionId`、`sessions.get()` 之后不再取字段；`test-session-lifecycle` 6 条（含裸 id 复用与跨平台判废） |
| **C6** | ACP 适配器（第二实现）**（已完成）**：`client.mjs`（stdio + 双向分发）、`events.mjs`（归一映射）、`port.mjs`（`AgentPort` 实现）、声明面 `profiles/agent-platforms/acp/`、`builtin.mjs` 注册 | `src/agent-side/adapters/acp/`、`profiles/agent-platforms/acp/`、`src/agent-side/builtin.mjs`、`src/agent-side/runtime.mjs`（装配期守卫）、`scripts/test-{acp-port,agent-port}.mjs` | **不改 `src/` 其余文件**跑通 session/prompt/permission/models：`test-acp-port.mjs` 14 条（离线夹具走真实 stdio）+ `test-agent-port.mjs` 30 条（含 5 条 ACP 契约一致性）；`check-profiles` 通过 |
| **C7** | 界面 IA 重构（平台页 + 方案页，行为档案与能力预设并入平台详情）**（已完成）** | `public/console/**`、`scripts/console-source.mjs`、`test-console-*` | `test:console-static` 全过；`test:console-ui` 37/37（新增平台页、方案页、配置只读、两侧清单四条契约） |
| **C8** | 收尾**（已完成）**：文档改写（PROFILES_MODEL §一/§二、FOLDER_MAP、CONSOLE、README 索引、CHANGELOG）、删除清单逐项核销、方案端点按 §7.4 改名为 `/api/plans` | `docs/*`、`src/bridge.js`（三处路由）、`public/console/pages/plans/page.js`、`scripts/console-ui-{contracts.json,fixture.mjs}`、`scripts/test-console-ui.mjs` | 全套门禁 + `git grep` 删除清单为空（结果见 §9.4） |

**依赖**：C1/C2 → C7；C4 → C5 → C6；C3 与 C4 可并行。
**建议顺序**：C1 → C2 → C4 → C3 → C5 → C6 → C7 → C8。

每批都要过的门禁：`verify:repo`（80 条）、`test:audit`（全部脚本）、`test:artifact-pipeline`、`test:console-ui`、`test:v030`。

### 9.1 C6 前置调研：ACP 契约对照（2026-11-14）

一句话结论：**ACP 与 DSH 的差异不在动词名字，而在「谁是 server」。** DSH 是客户端连一个常驻服务；
ACP 是客户端 spawn 子进程，而且**必须自己实现 server 侧** —— Agent 会反向调用
`session/request_permission`。所以 `adapters/acp/` 除了 RPC 客户端，还要有请求分发与挂起表。

**传输**：只有 `stdio`（Streamable HTTP 仍在 RFD）。每行一条 JSON-RPC，不许内嵌换行，无批量，
关闭 stdin 即断开连接。这意味着**没有「地址」这个概念** —— `api.setBaseUrl` 与
`discoverLaunchToken` / `resolveAgentHome` 一类 DSH 专名在 ACP 下无对应物。

**版本**：`initialize.protocolVersion` 是整数 MAJOR；Agent 回选「≤ 请求版本的自己支持的最高版本」。
**v1 是 stable，v2 仍是 Draft**（官方 `acp-v2-draft` 公告）。初稿曾误判「v1 没有 `session/list`」——
那是只读了 overview 的 baseline 清单；实际上 `session/list`、`session/close`、`session/resume`、
`session/delete`、`session_info_update`、config options（含 `model_config` 分类）、additional dirs
都已作为**能力位门控的可选方法** stabilise 进 v1。因此 **C6 以 v1 为实施目标，v2 留待转正式版**。
生态现实也指向 v1：DSH 官方的 `deepseek-harness-acp` 实现的就是 ACP v1。

**方法对照**

| `AgentPort` | ACP（v1） | 结论 |
| --- | --- | --- |
| `probe` | `initialize` | ✅ 一次成功即活；`version` 取 `info.version` |
| `listSessions` | `session/list`（需 `sessionCapabilities.list`，游标分页） | ✅ |
| `ensureSession` | `session/new`（`cwd` / `mcpServers` / `systemPrompt`） | ✅ 新建 / `session/load`（`loadSession`）/ `session/resume` 三条路，适配器按需选 |
| `prompt` | `session/prompt`，**v1 阻塞到回合结束**才回 `stopReason` | ⚠️ 见下方「受理制」 |
| `cancel` | `session/cancel`（通知） | ✅ 无响应，结束靠回合边界 |
| `archiveSession` | `session/close`（需 `sessionCapabilities.close`） | ✅ 语义接近（close 不等于 delete） |
| `listPresets` | 无标准方法；DSH 的 ACP 实现把 agent 名单暴露成无分类 config option（`id: "agent"`） | ⚠️ 只能运行时探测 |
| `renameSession` | 无（`session_info_update` 是 Agent→Client，Client 改标题仍在 RFD） | ❌ `rename` 位不可声明 |
| `applyPermission` / `readPermission` | `session/set_mode`（v1 专用方法，官方标注将来被 config options 取代）或 config option `category: 'mode'` | ✅ 两条路都要认 |
| `listPermissionPresets` | `session/new` 回执的 `modes.availableModes`，或 mode option 的 `options` | ✅ |
| `respondPermission` | **回一条挂起的 `session/request_permission` 请求** | ⚠️ 语义反转，见下 |
| `listModels` / `selectModel` | config option（`category: 'model'` / `model_config`） | ✅ 同样按 option 存在与否降级 |
| `readSettings` / `writeSettings` | 无 | ❌ |
| `createWorkspace` / `renameWorkspace` | 无（`cwd` 是会话属性；多根走 `additionalDirectories`） | ❌ |
| `compactSession` | 无「要求压缩」的方法（只有 Agent 主动发的 compaction 通知） | ❌ 不伪造 |

**能力位来自协商，不是来自协议版本**：`initialize` 回执里的 `agentCapabilities` 才是唯一依据 ——
`sessionCapabilities.list` / `.close` / `.resume` / `.delete`、`loadSession`、`promptCapabilities.*`。
所以能力位声明**必须**在连接建立后求值；再看 `session/new` 回执有没有 `modes` 与带 `category` 的
`configOptions`，决定 `permission` / `models`。`supports()` 因此不能是构造时的常量。

**受理制**：DSH 的 `prompt()` 是「投递 + accepted 回执」，回复靠事件流；ACP v1 的 `session/prompt`
**阻塞到回合结束**。适配器不能直接 await 它（会占住整轮），要把它当后台任务、立即回 accepted，
回合边界再由事件推给内核。

**事件映射**（`session/update.update.sessionUpdate` → `AGENT_EVENT_KINDS`，v1 判别值）

| `sessionUpdate` | kind |
| --- | --- |
| `agent_message_chunk` | `text` |
| `agent_thought_chunk` | `reasoning` |
| `tool_call` / `tool_call_update` | `tool` |
| `plan` | `plan` |
| `current_mode_update` / `available_commands_update` / `session_info_update` | `notice` |
| `user_message_chunk` | 丢弃（桥接自己发的回声） |
| （`session/prompt` 的 `stopReason`） | `turn-end` |

v2 的判别值是另一套（`agent_message` / `state_update` / …），两者不能混用。`session/request_permission`
**不是** `session/update`，是独立请求，要在分发里翻成 `kind: 'permission'`，`ref` 用 `{ requestId }`
（JSON-RPC id）；`respondPermission` 按 `requestId` 找挂起项回 `{ outcome: { outcome: 'selected', optionId } }`。
内核四级 → `optionId` 按 `kind` 映射（`allow_once` / `reject_once`），**不做 `allow_always`**（§5.3 规则 2）。

**`prompt` 的返回形状**（C6 已解决）：C5 时期 `src/bridge.js` 五处调用点读的是 `accepted.result.ok` /
`accepted.result.value.command`，那是 **DSH 的包形状**而不是中立契约。C6-a 把 `prompt()` 中立化成
`{ ok, isCommand, commandText, error, raw }`，并同步改了 DSH 实现与六处调用点 —— 两个平台都不再泄漏
自己的信封，内核也不再认识任何一个平台的包形状。

**风险**

1. **v2 是 Draft**：不实现，等转正式版再评估。v1 的方法面已够用（含 `session/list`）。
2. **能力位必须在协商后求值**：~~需单独拍板~~ **已解决（C6-b）** —— `createAgentPort` 的
   `capabilities` 接受函数形态，每次查询现算；常量形态仍在构造时校验（装配错误必须启动即暴露）。
3. **子进程生命周期无处安放**：**已解决（C6-c）** —— `adapters/acp/client.mjs` 自己 spawn 并托管
   （`command` / `args` / `cwd` / `env`），stdin 关闭即断开，子进程退出时把所有挂起请求判失败。
4. **真实验证目标已存在但本机版本不够**：DSH 官方的 `@openma/deepseek-harness-acp`（ACP v1，
   `dsh --profile acp`）与 `@deepseek-ai/dsh-acp-demo`。本机 `dsh` 是 0.1.1-rc.2，而前者要求
   `>=0.1.7-rc.2`，要先 `dsh plugin --profile acp add @openma/deepseek-harness-acp@latest`。

---

### 9.2 C6 实施结果（已完成，2026-11-14）

**交付物**

| 文件 | 职责 |
| --- | --- |
| `src/agent-side/adapters/acp/client.mjs` | 传输：NDJSON 编解码 + JSON-RPC 双向分发（`pending` / `handlers` 两张表）+ 子进程生命周期（`DEFERRED` = 先不回，稍后 `respond`） |
| `src/agent-side/adapters/acp/events.mjs` | `session/update` → `AGENT_EVENT_KINDS`；`session/request_permission` → `kind: 'permission'` 事件 |
| `src/agent-side/adapters/acp/port.mjs` | `AgentPort` 实现：核心五动词 + `session` / `permission` / `models` 三组 |
| `profiles/agent-platforms/acp/` | 声明面：`agent-platform.yml`（含 `configSchema`）、`tools.yml`（空表）、`adapters/runtime.mjs`；`capabilities/README.md` 说明为何空 |
| `src/agent-side/builtin.mjs` | 第二个内置平台（排在 dsh 之后 —— 顺序即默认 active） |
| `scripts/test-acp-port.mjs` | 14 条；离线夹具 `scripts/fixtures/fake-acp-agent.mjs` 走真实 stdio，不起网络 |

**四处设计决定（与 §9.1 预判有出入的都写在这里）**

1. **能力位：未连接时乐观声明，连接后按回执收缩。** 闸门在方法之前执行，而唯一的初始化点就在方法里
   —— 未连接时返回空集会形成「初始化死锁」：`listPermissionPresets()` 被永久拒绝，控制台读不到模式
   名单，L3 永远开不起来。所以未连接时按 v1 固定方法面声明，`initialize` 后只按 `sessionCapabilities.close`
   收缩 `session` 组。这不是猜对端：对端的真实差异只有这一个位。
2. **受理制：三条信号先到者定局。** 本会话首条 `session/update` / `session/prompt` 响应 / 宽限期
   `acceptGraceMs`（默认 800ms）。响应一到**一律**补发 `turn-end`（含失败），否则内核永久判忙。
   失败分两类：JSON-RPC 错误（`typeof code === 'number'`，对端拒绝受理）→ `ok:false` 走自愈；
   传输级错误（进程没了 / 管道断了）→ 抛（那不是「拒绝受理」）。
3. **名单是会话级的 → 探测会话。** `modes` / `configOptions` 只出现在 `session/new` 的回执里，协议
   没有全局目录。`listPresets` / `listPermissionPresets` / `listModels` 在任何会话都没有时建一个
   探测会话去读（只建一次，失败不重试）。替代方案是回空表，那会让控制台在第一条消息前什么都看不到。
4. **模式名不猜。** ACP 不规定 `availableModes` 叫法。声明面用与内核四级同名的规范名
   （`read-only` / `workspace-write` / `full-ask` / `full`），对端没有就 fail-closed 并列出它实际提供的
   模式；绝不退回更宽的档。`applyPermission` 的回执契约是 `{ value: { ok, modeId } }`，
   `permissionCommandSucceeded` 判 `ok === true && modeId === wanted` —— `session/set_mode` 没有回执值，
   能确认的只有「RPC 成功」，`current_mode_update` 是事件、不保证先到，不假装能读到最终状态。

**接线状态（C6.5，已收口）**

acp 的连接层已建立（`src/agent-side/adapters/acp/runtime.mjs`：按 `command` / `args` / `cwd` spawn 子进程，
懒建客户端与 port，按归一事件收成一轮）。它声明 `mode: 'stdio'`，没有地址发现与凭据猜测——这些差异
不再需要内核假设。因此：

- `builtin.mjs` 注册了 acp（控制台能看见它的能力位与配置表），可以配成 `platforms.active.agent`；
- 成员不齐时拒绝发生在 `agentRuntime()` 的成员表校验上，错误明确指出缺哪一项，而不是让 bridge 撞上
  `AgentApiClient is not a constructor`；
- `events()` 由子进程 stdout 自建（`onEvent` → 异步 `mux`），`turn-start` 由 port 层为在途回合打戳；
  同一套契约由 `scripts/test-agent-port-tck.mjs` 对两家一起验。

**测试**

- `scripts/test-acp-port.mjs` 14 条：事件映射与未知判别值、权限事件形状、能力位（乐观 + 收缩）、
  `session/list` 分页与归档、`list` / `close` 未声明时的 fail-closed、prompt 三条受理路径、cancel、
  权限反向请求与回执（拒绝落 `reject_once`）、模式读写、agent 与模型目录（探测会话）。
- `scripts/test-agent-port.mjs` 30 条：新增 5 条 ACP 契约一致性 —— 声明面覆盖能力位且不多画
  v1 没有的组、装配点交出协商制 getter、protocol 面无 `NodeApiClient`、级别计划 fail-closed、
  回执判据「ok 且名字一致」。

### 9.3 C7 实施结果（已完成，2026-11-14）

**交付物**

| 文件 | 职责 |
| --- | --- |
| `public/console/js/registry.js` | 由 `js/platforms.js` 改名；两侧平台同源（`GET /api/platforms/registry`），`loadPlatforms` / `registryMeta` / `platformLabel` / `capabilityLabel` 等函数签名保留，新增 `conversationTypeLabel` / `conversationTypeTone` |
| `public/console/pages/platforms/` | `page.html`（只有 `#platformHost`）+ `page.js`（诊断汇总卡 + 主从卡：左列表按 `side` 分组，右详情）+ `page.css` + `platform-detail.js`（标签矩阵与各面板）+ `behaviors-panel.js` / `behavior-form.js` / `fields.js`（从已删页搬来，按平台过滤） |
| `public/console/pages/plans/` | 由 `pages/runtime/` 改名重写：当前方案 + 方案清单两张卡，编辑器字段全部 `planEdit*`；`AGENT_FALLBACK` 删除，Agent 平台取自注册表 |
| `public/console/js/router.js` / `index.html` | `consolePages` 加 `platforms` / `plans`、删 `behavior`；`PAGE_FRAGMENTS` 删除（每页都在 `pages/<id>/page.html`）；`PAGE_ALIASES = { behavior: 'platforms' }` 是唯一兼容面 |
| 删除 | `pages/behavior/`（5 文件）、`pages/runtime/`（2 文件）、`components/platform-panel/`；能力面板改由平台详情挂载 |

**标签矩阵（按资产有无给，不按平台 id 分支）**

| 侧 | 标签 |
| --- | --- |
| 用户侧 | 概览 / 配置 / 话术与工具 / 行为（`assets.behaviors.length > 0`） |
| Agent 侧 | 概览 / 能力（`assets.capabilityProfiles.length > 0`）/ 配置 |

**三处有意留白**（界面上写明原因，不造数据）

1. **不做「健康」标签**（后续已补探活）：当时注册表没有 `health` 字段、探活端点也未实现，所以 §7.2 tab 图里的「健康」没做。P2 落了 `POST /api/platforms/registry/agent/<id>/probe`，结论回填成条目的 `probe` 字段，在「全局配置 › 运行」与平台详情里各显示一次 —— 仍不新开「健康」标签页。
2. **「配置」当时只读**（后续已补写口）：C7 不改 `src/`，那一栏只能把声明面字段与当前值列成表。P2/P3 落了 `PATCH /api/platforms/registry/<side>/<id>/config`（两侧同一条路径，`vetPlatformConfig` 与诊断共用同一套 schema 规则），配置栏改成按 `configSchema` 生成的表单；连接参数写明「重启后生效」。
3. **能力面板不按平台过滤**：`src/capabilities/store.mjs` 没有 `agentPlatform` 字段（能力档实际只有 DSH 一份）。因此：列表不再显示「Agent 平台」列（原来 `cap.agentPlatform || 'dsh'` 是造出来的值）；面板挂在哪个 Agent 平台下，写回路径就用哪个平台的目录（`createCapabilityPanel({ platformId })`）；不假装「这个平台只有这几套档」。

**与 §7.6 预判的出入**

| §7.6 的说法 | 实际 |
| --- | --- |
| `components/capability-panel/` 改数据源为统一注册表 | 注册表只回答「有哪些能力档」，档的正文仍在 `/api/runtime/capabilities`；组件只补了 `platformId` 参数（避免把资产正文塞进清单响应） |
| `pages/platforms/fields.js` 放页面字段规格 | 只放行为面板的两处宿主（清单表 + 备注）；其余卡片由 `cardHtml` 生成，不需要字段规格 |
| `pages/plans/` 由 `pages/runtime/` 改名 | 编辑器宿主从 `fields.js` 的 custom 字段改成 `cardHtml` + `renderFields`，所以不再需要 `fields.js` |
| 方案端点改名为 `/api/plans`（§7.4） | 本批不动 `src/`，留给了 C8；**C8 已改名**（`bridge.js` 三处路由 + 方案页 + 写载荷基线 + 控制台夹具），`/api/runtime/plans` 在代码与测试里已无引用（只剩文档里作为“原路径”的历史说明） |

**测试**

- `scripts/test-console-static.mjs`：新增「## C7：界面 IA」整段 —— 三处删除已生效、页面源码里没有第二处 `/api/platforms/registry` 调用、标签按资产给、详情不按平台 id 分支、行为档案按平台过滤、方案页无 `'dsh'` 且 `agentPlatform` 取自下拉；`PAGE_FRAGMENTS` 断言改为「每页片段都从 `pages/<id>/page.html` 注入」；`BARE_CONTROL_BASELINE` 删 `behavior: 4`。
- `scripts/test-console-ui.mjs` 37 条（+3）：行为档案改走「平台 › 行为」、平台提示词走「话术与工具」、方案编辑器全部 `#planEdit*` 且 Agent 平台下拉 = 注册表里的声明者、能力档走「Agent 平台 › 能力」、两侧清单与「没有诊断就不渲染诊断卡」、配置标签只读。
- `scripts/console-ui-fixture.mjs`：qq / dsh 的注册表 mock 补上 `configSchema` 与 `config`（照抄两份声明面），预览里「配置」标签才有真表可看。

---

### 9.4 C8 实施结果（已完成，2026-11-14）

**文档改写**

| 文档 | 改了什么 |
| --- | --- |
| `PROFILES_MODEL.md` | 顶部横幅指向本方案；§一 层级表按 C2/C4/C7 的事实重写（能力预设 → 能力档，Agent 平台写「当前 DSH 与 ACP」，关系句写明方案不再有 `agent` 字段）；§二 目录树补 `behaviors/.defaults/`、`capabilities/.defaults/`、`plans/.defaults/`、`adapters/runtime.mjs`、`acp/` 平台 |
| `FOLDER_MAP.md` | 新增 `src/platforms/` 与 `src/config/` 两行；`src/agent-side/` 补 `adapters/acp/`；`src/user-side/metadata.mjs` 的端点改注册表；adapters 行区分 dsh 三份 / acp 一份；scripts 计数改 208；docs 树补本文件 |
| `CONSOLE.md` | §4 数据源改 `js/registry.js`；§6/§7 的过期数字改为事实（契约 27 条、导航 15 个、截图页 `sessions` / `platforms` / `plans` / `persona` / `overview`）；契约清单里的方案端点随改名更新；P6 已补 §9「执行体 / 方案 / 权限的界面口径」 |
| `PLATFORM_DECOUPLING.md` | §6.1 加「已收口为 `GET /api/platforms/registry`」横幅，该节保留作设计演进记录 |
| `README.md` / `CHANGELOG.md` | 索引状态改「C0–C8 已完成」；CHANGELOG 新增 C8 段 |

**端点收口**：`/api/runtime/plans` → `/api/plans`，涉及 `src/bridge.js` 三处路由（GET / POST / DELETE，含 `slice('/api/plans/'.length)`）、`public/console/pages/plans/page.js` 四处调用、`scripts/console-ui-fixture.mjs` 四条 mock 路由、`scripts/test-console-ui.mjs` 的写请求期望值、`scripts/console-ui-contracts.json` 的写载荷基线。测试的 `clickWrite` 用 `pathname === path` 精确比对，所以路由与期望值必须同批改。

**删除清单核销**（§4.4）

| 项 | 结论 |
| --- | --- |
| `profiles/agent-platforms/dsh/agents/` | C4 已删 |
| `src/runtime/adapters.mjs` | C2b 已删 |
| `public/console/pages/behavior/` | C7 已删 |
| `public/console/components/platform-panel/` | C7 已删 |
| `src/agent-side/agent-client.mjs` | C6.5 已删（连接层归 `src/agent-side/runtime.mjs` 与 `adapters/<id>/`） |

**门禁**：`verify:repo` 80 通过 0 失败 0 跳过；`test:audit` 129/129；`test-console-static` 全过；`test:console-ui` 37/37（41 条隔离 mock 写请求）；`test-artifact-pipeline` 全过；`build-artifacts --check` 全部最新；`test:v030` 9/9；`check-profiles` 通过。`git grep` 残留只出现在测试的「已删除」断言、平台页的 `data-platform-panel-body` 属性名与文档的历史说明里。

---

### 9.5 C9 补充（用户反馈，2026-11-14）

C0–C8 验收后，用户报了三类「界面文案与人格生效时机」的问题。这一批不入批次表，只把口径收口：

| 问题 | 根因 | 修法 |
| --- | --- | --- |
| 导航还叫「平台」「方案」 | C7 只改了页面内部标题 | `index.html` 与 `js/router.js` 的 `consolePages` 标题/副标题改「平台配置」「运行方案」；路由键不动 |
| 能力档编辑页与行为档案页版式不一致 | 能力面板编辑器自画一套卡片层次，外层又套一层 `<section class="card">` | `renderEditor()` 改用 `.platform-stack/.platform-section/.form-stack/.form-actions` + `renderFields(..., { columns: 1, layout: 'inline' })`；删掉多余的 `<section>` 与 `.platform-detail .card{padding}` |
| 新建角色卡后会话下拉不更新 | `ensurePersonaCatalog()` 做了模块级永久缓存 | 去掉缓存：每次打开会话详情重拉 `/api/personas`，失败沿用上次结果 |
| `/role` 切不了外部人格 | 命令层只认 `roles/*.md`，与「默认人格下拉」两套解析 | 抽 `resolvePersonaTarget()` 作为唯一入口（本地卡 → `provider:id` → 裸名唯一匹配），命令层依赖从 `sanitize/exists` 改为 `resolve/refresh` |
| 切换人格后不重新注入 | `applyRoleChange` 是 HTTP 处理函数内的 `const`，命令层调用会 `ReferenceError` 被吞 | 搬到 `main()` 作用域并写成函数声明（`server.listen` 更早执行，`const` 会踩 TDZ） |
| 重置后不重新注入（`/new`、控制台重置） | 注入入口对 `bootstrap` 豁免；重置没清「已读哪一版卡」 | 去掉 `bootstrap` 豁免、`roleFpAtBuild` 无条件记录；重置序列新增 `forgetRoleSeen`；`resetSession(key,{notify})` 透传（顺手修掉控制台重置也往群里发回执） |
| 会话详情「跟随全局（当前：—）」 | `/api/sessions` 的 `activePlan` 只给 id，前端直接拼进文案 | 后端返回整份定义（`activePlan() ?? null`），前端 `planLabelOf()` 兼容旧写法 |

**口径**（以后改人格相关的地方照这个来）：

1. **解析只有一个入口** — 本地卡与外部 `provider:id` 都走 `resolvePersonaTarget()`；不要在新地方再写一套「读 roles 目录判断存在」。
2. **写入只有一个写法** — 全局 `role` 与会话 `byKey` 都过 `safeRoleValue()`（`safeRoleName` 会吃掉冒号，写外部卡会被静默改名）。
3. **生效只有一个开关** — 换卡后一律调 `applyRoleChange(roleSaveApplyDefault, keys)`，命令层不另写「立即唤醒」。
4. **注入只有一个判据** — 没读过这一版卡就整段给，不分唤醒原因（新建 / 重置 / 人工 / 定时）。重置与压缩都要 `roleRefresh.forget(key)`。
5. **目录类数据不做永久缓存** — 人格 / 平台 / 能力档的下拉每次打开都重拉（失败沿用上次结果），否则「在人格页新建了卡，回会话详情看不到」；「跟随全局（当前：…）」必须能写出可读名字，不允许只剩破折号。

**门禁**：`test:audit` 129/129、`test:console-ui` 38/38（43 条隔离 mock 写请求）、`verify:repo` 80 通过 0 失败 0 跳过、`test-console-static` 全过、`node --check` 全过。

---

## 十、明确不做

1. **不把两侧合成一个接口**：用户侧是"连接 + 消息 + 社交"，Agent 侧是"会话 + 提示 + 权限"，合并会得到谁都不好用的大接口。
2. **不做"读旧配置自动猜平台"**：猜错静默污染数据。
3. **不为 ACP 的缺口造伪能力**：settings/workspace/自愈缺失就报 `capability_unsupported`，不假装成功。
4. **不保留旧端点/旧配置别名**（见 §八）。
5. **不在本方案里改行为语义**（模式、提示词、权限判定逻辑），只做结构搬运；唯一的例外是 C3 的入站顺序，它必须正确。
6. **不删除 `interface-platform/`**：本方案不动它，但它已无内核引用，是否下线见 §十一 Q4。

---

## 十一、风险与开放问题

### 11.1 风险

| 风险 | 缓解 |
| --- | --- |
| C4 的 preset 渲染与现有产物不一致 → DSH 行为漂移 | 先立 golden：现有 `artifacts/dsh/qq-agent-presets/presets/*.patch.yml` 逐字节比对，不允许"语义等价" |
| C5 迁移期间 DSH 特有路径（自愈/投影）漏迁 | 逐条对照 §5.1 的能力位；缺的落进 `maintenance`/`settings`，不允许散落在 bridge |
| C7 删页导致用户书签/深链 404 | `HTTP_BOUNDARY.md` 已要求刷新恢复；路由表加 `#behavior → #platforms` 一次性重定向（这是**唯一**允许的兼容动作） |
| 迁移脚本误改本地 `config.json` | 迁移前写 `config.json.bak-<ts>`；脚本跳过未跟踪的运行期配置 |

### 11.2 待拍板（实施 C4 前回答即可）

Q1 / Q2 已随 C4 落地（按默认建议执行）；其余仍待定。

| # | 问题 | 默认建议 |
| --- | --- | --- |
| Q1 | `chat` 与 `chat-v2` 是否合并为一个 capability 档？ | **不合并（已落地）**：两者对应不同行为引擎，合并会让"档位"与"行为"耦合；实际采用 `capabilities/{chat,chat-v2,…}.yml` 平级 |
| Q2 | 能力档目录保留 `capabilities/` 还是改 `tiers/`？ | **保留 `capabilities/`（已落地）**：少一个术语，`src/capabilities/store.mjs` 不用改名 |
| Q3 | 平台页是否提供"新增平台向导"？ | **不提供**：新平台必然要写代码或装插件，向导只能造出"配置目录孤岛"（`profile_only` 诊断）；页面上提供"如何新增"的说明与跳转 |
| Q4 | `interface-platform/` 是否下线？ | **不下线（C8 已核实）**：“只被文档引用”这个假设不成立——`src/launcher/control-center.mjs` 负责托管它的进程，`scripts/build-release.mjs` 的发布清单必须有它，`test-platform` / `test-linux-support` / `test-quote-forward` 直接 import 它。它是桥接与 QQ 后端之间的实际接入层 |
| Q5 | ACP 的 stdio 子进程由谁托管？ | **由适配器自己**（进程生命周期是"怎么连上平台"的一部分）；桥接只传 `cwd`/`env`/`mcpServers` |

---

## 十二、相关文档

- [PLATFORM_DECOUPLING.md](PLATFORM_DECOUPLING.md)：B0–B8 已落地的规格与取舍（本方案的输入）
- [AGENT_PLATFORM_EVOLUTION.md](AGENT_PLATFORM_EVOLUTION.md)：P0/P1/P3 现状；P2 的完整愿景（本方案 C4 是其第一步）
- [PROFILES_MODEL.md](PROFILES_MODEL.md)：各配置文件字段字典（§一 层级表将被本文取代）
- [FOLDER_MAP.md](FOLDER_MAP.md)：目录地图（C8 同步）
- [guides/ADD_USER_PLATFORM.md](guides/ADD_USER_PLATFORM.md)：用户侧接入步骤（含入站 `connect` 部分）
