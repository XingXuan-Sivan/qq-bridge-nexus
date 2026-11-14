# 四层配置模型（PROFILES_MODEL）

> 从 2026-11-12 起，桥接的“配置”只剩一条主链：**用户侧平台 → 行为档案 / Agent 平台 → 能力档 / 运行方案 → 会话权限级别**。
> 旧的 `config/behaviors/`、`config/platform/`、`dsh/agent-presets/` 三处存储已删除，没有兼容层。
> 本文只描述现状；历史设计文档见文末“相关文档”。
>
> **§一 / §二 已按 [PLATFORM_UNIFICATION.md](PLATFORM_UNIFICATION.md) 改写**（C2 配置 v2、C4 能力归一、C5 `AgentPort`、
> C7 控制台 IA 均已落地）：平台清单只有 `GET /api/platforms/registry` 一份，控制台的唯一调用点是 `js/registry.js`。
>
> **源码 vs 产物**：`profiles/` 是**权威源**（人写的 yml / md / mjs），`artifacts/<agent平台>/` 是**生成或打包产物**（DSH 加载用）。
> 产物一律由该平台的适配器生成，不手改；二者的关系见 [AGENT_PLATFORM_EVOLUTION.md](AGENT_PLATFORM_EVOLUTION.md)。

---

## 一、四层各自负责什么

| 层 | 回答的问题 | 存储 | 谁提供 |
| --- | --- | --- | --- |
| **用户侧平台**（user platform） | AI 在哪个聊天平台上做事（QQ、微信、B 站……）：怎么连、有哪些平台工具、怎么说话 | `profiles/platforms/<id>/`（`platform.yml` + `tools.yml` + `prompt.md` + `behavior-types/`） | 系统给接口与公共配置（`configSchema` / `vars`），具体工具、话术、档案类型由该平台目录提供 |
| **行为档案**（behavior） | 在这个平台上“怎么表现”（一代仿真 / 二代仿真 / 别的风格） | `profiles/platforms/<id>/behaviors/*.yml` | 档案作者（内置两份，可增删）；C7 起它是「平台 › 详情 › 行为」的子资源，不再有整页 |
| **Agent 平台**（agent platform） | AI 跑在哪个 Agent 运行时（当前 DSH 与 ACP） | `profiles/agent-platforms/<id>/` | 系统给 `AgentPort` 契约，具体工具 / 能力档 / 产物由该平台目录提供 |
| **能力档**（capability） | 这个 Agent 平台里“能拿到什么”+“预设长什么样”：平台工具、Agent 模块、MCP、技能、预设元信息与插件行 | `profiles/agent-platforms/<id>/capabilities/*.yml`（四段同居一文件） | 内置五条，可克隆 / 新建；`.defaults/` 留出厂副本供「还原」 |
| **运行方案**（plan） | 把“用户侧平台 + Agent 平台 + 能力档 + 行为档案”组合成一个可切换的档位 | `profiles/plans/*.yml` | 内置六条，可克隆成自定义方案 |
| **权限级别** | 具体会话最终能用能力档里的哪些工具 | 会话配置（`state/sessions.json`） | 会话级，不落在档案里 |

关系一句话：**方案 = 用户侧平台 + Agent 平台 + 能力档 +（可选）行为档案 + 受众**。C4 起方案不再有 `agent` 字段
（能力档 id 就是该平台的 preset id），所以“换能力档”不会再把“换 DSH 预设”忘在后面。
方案决定“拿到哪些能力”，会话权限级别再决定“实际能用哪些”。

---

## 二、目录与文件

```
profiles/
├── platforms/                    # 用户侧：一层一个目录，新增平台不改内核
│   └── qq/
│       ├── platform.yml          # id / label / note / vars / configSchema（字段字典见 §三）
│       ├── tools.yml             # 平台工具目录（flag、宿主工具名、风险、defaultOff）
│       ├── prompt.md             # 平台话术（可编辑）
│       ├── prompt.default.md     # 出厂话术（「还原」从这里取）
│       ├── behavior-types/
│       │   ├── social-v1.yml     # 类型：label / engine / schema.fields
│       │   └── social-v2.yml
│       └── behaviors/
│           ├── .defaults/        # 出厂副本，供「还原」
│           ├── social-v1.yml     # 一代仿真（kind: social-v1）
│           └── social-v2.yml     # 二代仿真（kind: social-v2）
├── agent-platforms/              # Agent 侧：一层一个目录（dsh 为默认 active）
│   ├── dsh/
│   │   ├── agent-platform.yml    # id / label / configSchema（字段字典见 §三）
│   │   ├── tools.yml             # Agent 模块目录（文件读写、PowerShell、Web……）
│   │   ├── capabilities/
│   │   │   ├── .defaults/        # 出厂副本（还原用）
│   │   │   ├── chat.yml
│   │   │   ├── chat-v2.yml
│   │   │   ├── readonly.yml
│   │   │   ├── workspace.yml
│   │   │   └── full.yml
│   │   ├── templates/rows.yml    # 安装/生成产物用的行模板
│   │   └── adapters/             # 该平台的构建 / 安装 / 运行期适配器
│   │       ├── build.mjs         # planArtifacts()：源码 → 产物文件清单（纯函数）
│   │       ├── install.mjs       # install()：产物装进运行时（写 profile patch / junction）
│   │       └── runtime.mjs       # 声明面 + AgentPort 装配（能力位在这里声明）
│   └── acp/                      # 第二实现（C6）：没有产物要渲染，只有协议适配器
│       ├── agent-platform.yml    # command / args / cwd 等 configSchema
│       ├── tools.yml             # 空（工具由 ACP 对端决定）
│       ├── capabilities/README.md
│       └── adapters/runtime.mjs
├── plans/
│   ├── .defaults/                # 出厂副本（还原用）
│   ├── chat.yml                  # 内置六条：chat / social-v1 / social-v2 /
│   └── …                         #   agent-readonly / agent-workspace / agent-full
└── schemas/                      # 五份 JSON Schema（platform / agent-platform / behavior / capability / plan）

artifacts/                        # 各 Agent 平台的产物根（目录名 = agent 平台 id）
└── dsh/
    ├── qq-agent-presets/         # DSH bundle：生成出来的 presets/*.patch.yml + 手写守卫 mjs
    └── qq-mode-console/          # DSH bundle：qq-mode 设置命名空间插件（只有 host 半）
```

`artifacts/dsh/qq-agent-presets/presets/*.patch.yml` 由 **DSH 平台的 build 适配器**
（`profiles/agent-platforms/dsh/adapters/build.mjs`）从 `profiles/agent-platforms/dsh/capabilities/<id>.yml`
（`preset` 元信息 + `rows` 插件行）渲染，入口是 `node scripts/build-artifacts.mjs dsh`（`npm run build:artifacts`）；
改能力档后要重新生成并重启 DSH。

同一目录里**手写**的文件（`qq-tool-restrict.mjs`、`qq-approval-gate.mjs`、`protected-paths.mjs`、`package.json`）
不是产物，构建不会覆盖它们 —— 生成器只写 `presets/*.patch.yml`。

安装（把产物接进 DSH 运行时：profile patch、bundle 注册、两层 junction）走
`profiles/agent-platforms/dsh/adapters/install.mjs`，入口是 `node scripts/install-agent-platform.mjs dsh <profile>`；
`node scripts/setup-dsh.mjs` 保留为兼容入口，等价于后者。

---

## 三、各文件字段

### 行为档案 `behaviors/<id>.yml`

```yaml
version: 1
platform: qq
kind: social-v1       # 必须是 behavior-types/ 里注册的类型；engine 决定用哪套字段与解析
label: 一代仿真
description: 单人设、短回复，适合小群
prompt: |             # 行为提示词（和档案同一次保存）
  …
config: {}            # 该类型的配置（v2 与全局 socialV2 合并）
```

- `kind` 由平台提供：类型定义在 `behavior-types/<id>.yml`（`label` / `engine` / `schema.fields`），档案只引用类型 id；系统只校验 `version/platform/kind/label/description/prompt/config` 这七个顶层键。
- 新建档案时选的是「平台 + 类型（label）」，不再出现 v1/v2；同一类型下可以有多份档案（如 `social-v1`、`social-v2` 都是内置类型各一份）。
- 旧写法 `v1:` / `v2:` 顶层段已被拒绝（报“未知顶层字段”）；`kind: v1` 这类旧值仍能被 engine 别名解析，但归档时统一写 `social-v1`。

### 能力档 `capabilities/<id>.yml`

C4 起能力档是 Agent 侧**唯一**的档位真源：`tools`（能拿到什么）、`preset`（DSH 预设元信息）、
`rows`（插件行列表，渲染成 preset patch）、`extensions`（MCP/技能授权）四段同居一文件，
**能力档 id 就是 Agent preset id**（`chat` / `chat-v2` / `readonly` / `workspace` / `full`）。

```yaml
version: 1
label: 聊天 Agent
note: 无本地工具，只做对话与问答
tools:
  platform: { sendGroup: true, getPrompt: true, … }   # 平台工具开关（true/false 都保留）
  agent: { tool-web: true, tool-todo: true, … }       # Agent 模块开关
  mcp: [{ server: '*', tools: '*' }]                  # MCP 服务器与工具
  skills: ['*']                                       # 技能
preset:                                               # DSH 预设列表里显示什么
  name: QQ 聊天角色
  description: …
  order: 10
  behavior: social-v1                                 # 仿真不变量校验用（v1 / v2）
rows:                                                 # 插件行（同 DSH cordis 行）
  - id: persona
    name: '@deepseek-ai/dsh-persona'
    config: { prefix: |- … }
extensions:                                           # 可选：外部 MCP/技能授权
  mcp: { allow: ['*'], tools: { allow: ['*'], deny: [] } }
  skills: { allow: ['*'] }
```

- 能力档**同时描述“拿到什么”和“预设长什么样”**：`tools/label/note` 描述能力语义（平台无关），
  `preset.name/description` 与 `rows` 是随平台走的预设正文（含“QQ”这类产品文案）。
- 保存只写回这一个 yml（yaml Document 局部更新，其它段注释不丢）；内置五条不可删除，可克隆。
- `rows` 是 `artifacts/dsh/qq-agent-presets/presets/<id>.patch.yml` 的唯一源；子插件名用
  **bundle 包名裸说明符**（如 `qq-agent-presets/qq-tool-restrict.mjs`）——`./x.mjs` 会被按 profile 目录解析而装不上。
- 平台工具的注册面 = 所有能力档 `tools.platform` 的并集（`platformFlags()`），`config.json` 不再有 `tools`。

### 运行方案 `plans/<id>.yml`

```yaml
version: 1
id: social-v2
label: 二代仿真
builtin: true
platform: qq
agentPlatform: dsh
behavior: social-v2
capability: chat-v2      # 能力档 id（同时就是预设 id）
audience: access
note: …
```

- 内置六条：`chat`、`social-v1`、`social-v2`、`agent-readonly`、`agent-workspace`、`agent-full`；`builtin: true` 的只能克隆，不能改/删。
- 方案里**没有独立的 `agent` 字段**（C4 起）：能力档 id 就是预设 id，`capability` 一个字段说清「用哪套预设」。
- `behavior` 只存档案名；引用的档案不存在时加载侧告警并退化为“无档案”，不阻断消息处理。
- 方案解析：会话单独设置的方案优先，没设就用全局默认方案（`config.json` 的 `runtime.defaultPlan`，缺省 `social-v2`）；不再有 `state/runtime.json` 运行时指针，也没有全局「切换方案」接口。切换/提级权限仍走管理通道的 TOTP，与方案无关。
- 内置方案、内置行为档案、内置能力档的出厂副本放在各自目录的 `.defaults/<id>.yml`；控制台「重置」按钮复制回正式文件，改坏了可以一键还原。

### 平台 / Agent 平台

`platform.yml`、`agent-platform.yml` 放身份与目录元信息（`id` / `label` / 目录项）与下面两个声明面字段；平台工具目录在 `tools.yml`，Agent 模块目录在 `agent-platforms/<id>/tools.yml`。

C2b 起两侧多了两个**声明面**字段（详见 [PLATFORM_UNIFICATION.md](PLATFORM_UNIFICATION.md) §4.5）：

| 键 | 位置 | 含义 |
| --- | --- | --- |
| `vars` | 仅 `platform.yml` | 提示词变量（`platform` / `displayName` / `owner`）。构建期渲染产物、运行期渲染唤醒提示词都读它；白名单外键丢弃 |
| `configSchema` | 两侧 yml | 这个平台有哪些配置项。统一注册表用它判 `config_invalid`，控制台用它画表单。字段是**扁平**的（不写 `transport.` / `endpoint.` 前缀），`additionalProperties: true`，不设 `required` |

---

## 四、代码接口

| 能力 | 模块 |
| --- | --- |
| 读平台与工具目录 | `src/platforms/index.mjs`：`listPlatforms`（带 `label` / `vars` / `configSchema`）/ `loadPlatform` / `readPlatformTools` / `listAgentPlatformDirs` / `PLATFORM_TOOL_RISKS` |
| 行为档案读写 | `src/behaviors/index.mjs`：`loadBehaviorProfiles` / `normalizeBehavior` / `resolveBehavior` / `readBehaviorDocument` / `writeBehaviorData` / `duplicateBehavior` / `removeBehaviorFile` |
| 平台话术 | `src/user-side/prompt.mjs`：`readPlatformPrompt` / `writePlatformPrompt` / `restorePlatformPrompt` / `renderPlatformText` |
| 能力档 | `src/capabilities/store.mjs`：`createCapabilityStore` / `visiblePlatformFlags` / `platformFlags` / `capabilityAllowsFlag` |
| 运行方案 | `src/runtime/plans.mjs`：`createPlanStore`（list/get/save/remove/clone）/ `normalizePlan` / `findPlan` / `legacyModeOfPlan` |
| 目录常量 | `src/profiles/paths.mjs`：`PROFILES_ROOT` / `PLATFORMS_ROOT` / `AGENT_PLATFORMS_ROOT` / `PLANS_ROOT` / `SCHEMAS_ROOT` / `agentPlatformDir(id)` |
| 模式持久化 | `src/runtime/mode-store.mjs`：`createModeStore` / `createLocalModeFileBackend`（`state/mode.json`）/ `createDshModeBackend`（DSH `qq-mode` 命名空间）。只负责存取，模式语义（别名归一、级别、提权判定）仍在 `bridge.js` |
| 平台适配器发现 | `scripts/agent-platform-adapters.mjs`：`ADAPTER_KINDS` / `adapterFile` / `listAgentPlatforms` / `loadAdapter` / `normalizeArtifactFiles`。**约定优于声明**：只看 `profiles/agent-platforms/<id>/adapters/<kind>.mjs` 存不存在，不读 `agent-platform.yml` |
| 产物构建调度 | `scripts/build-artifacts.mjs`：`buildArtifacts({targets, check})`。遍历平台 → 调 `planArtifacts()` → 校验路径/去重 → 写盘；`--check` 只比对不写（漂移即非零退出） |
| 产物安装调度 | `scripts/install-agent-platform.mjs`：`installAgentPlatform({agentPlatform, profile})`。**先 build 再 install**，避免装到旧产物 |
| 运行期适配器 `runtime.mjs` | `profiles/agent-platforms/<id>/adapters/runtime.mjs` 是**声明面**：能力、权限映射、preset 清单等纯常量与纯函数，**不得 import `src/`**（否则四层模型反向依赖内核，构建期无法单独打包）。协议面（RPC 客户端、鉴权、事件解包）在 `src/agent-side/adapters/<id>/`，由 `src/agent-side/builtin.mjs` 用 `protocol` 字段与声明面拼装后注册；内核只经 `src/agent-side/agent-client.mjs` 门面调用（B4 / B5） |

自检：`node scripts/check-profiles.mjs`（校验目录四件套、工具风险值、内置能力/方案、引用闭合、旧目录不得存在）。
产物链路自检：`npm run verify:artifacts`（产物未漂移）、`npm run test:artifact-pipeline`（发现/校验/幂等/mock 平台隔离）。

### 适配器契约（P1）

`profiles/agent-platforms/<id>/adapters/build.mjs`：

```js
export const agentPlatform = 'dsh';                                   // 必须等于所在目录名
export function planArtifacts({ repoRoot }) {                         // 纯函数：不读环境、不写盘
  return { files: [{ path: path.join(repoRoot, 'artifacts/dsh/…'), content: '…' }] };
}
```

`profiles/agent-platforms/<id>/adapters/install.mjs`：

```js
export const agentPlatform = 'dsh';
export async function install({ repoRoot, profile, env, log }) {     // 失败抛错，不 process.exit
  return { profile, runtimeHome, bundles: ['qq-agent-presets', 'qq-mode-console'] };
}
```

`profiles/agent-platforms/<id>/adapters/runtime.mjs`（0.2.0 / B4 起）：运行期只读描述与映射，**同步、纯常量 + 纯函数**（启动时由 `src/agent-side/builtin.mjs` 同步 import）：

```js
export const id = 'dsh';
export const capabilities = Object.freeze(['session', 'rename', 'permission', 'models', 'settings', 'workspace', 'events', 'compact']);
export const PERMISSION_PRESET_FOR_LEVEL = Object.freeze({ 'read-only': 'read-only', …, full: 'danger-full-access' });
export const LEVEL_PERMISSION_PRESET = Object.freeze({ L1: 'read-only', L2: 'workspace-write', L3: 'qq-full-ask' });
export const AGENT_PRESET_IDS = Object.freeze(['chat', 'chat-v2', 'readonly', 'workspace', 'full']);
export const AGENT_PRESET_FOR_LEVEL = Object.freeze({ L1: 'readonly', L2: 'workspace', L3: 'full' });
export const AGENT_PRESET_ALIASES = Object.freeze({ 'qq-chat': 'chat', … });      // 旧名读入归一
export function resolveLevelPlan(level, ctx) {}                     // 内核级别 → 平台落地
export function normalizeAgentPreset(name) {}
```

`capabilities` 是**声明面**（控制台展示与降级判断）：前七项与 `AgentPort` 能力位同名，
`events` 是事件流订阅（不属于调用面），`maintenance` 故意不声明（DSH 0.2.x 没有重建/自愈的 RPC）。
`AgentPort` 自己的能力位、核心方法与返回值形状见
[PLATFORM_UNIFICATION.md](PLATFORM_UNIFICATION.md) §5.1。

内核侧只认接口，不认平台名：`src/agent-side/runtime-registry.mjs`（中立、零平台名、fail-closed 抛错）负责登记与转发，`src/agent-side/builtin.mjs` 是**唯一**允许写具体平台目录的装配点，`src/admin/agent-permission.js` 只做转发。`verify:repo` 会钉住这条边界：`src/` 不得再出现旧 preset 名，也不得在 `builtin.mjs` 之外装配平台。

新增一个 Agent 平台 = 加一个 `profiles/agent-platforms/<id>/` 目录并实现这三个文件；
调度器无需改动。调度器刻意**不 import `src/`**（只依赖 Node 内置模块），这样离线夹具只要拷 `scripts/` 子集 + `profiles/` 整棵就能跑。
运行时同理：换 Agent 平台只需改 `src/agent-side/builtin.mjs` 的一行 import，内核其余文件不动。

---

## 五、已删除的旧结构

| 旧位置 | 现在 |
| --- | --- |
| `config/behaviors/*.yml` | `profiles/platforms/qq/behaviors/*.yml` |
| `config/platform/<id>.yml`（含 `prompt`） | `profiles/platforms/qq/prompt.md` + `prompt.default.md` |
| `dsh/agent-presets/agent-*`（能力产物） | `profiles/agent-platforms/dsh/capabilities/*.yml`（不再有产物） |
| `dsh/agent-presets/qq-*`（DSH preset 源） | `profiles/agent-platforms/dsh/capabilities/<id>.yml` 的 `preset` + `rows` 段 |
| `profiles/agent-platforms/dsh/agents/<id>/`（C4 前的预设目录） | 同上，能力档 id 就是预设 id；`assets/default-presets/**` 同时删除 |
| `config.json` 的 `behavior.default` | `profiles/plans/chat.yml` 的 `behavior: none` |
| `config.json` 的 `runtime.plans[]` | `profiles/plans/*.yml` |
| `config.json` 的 `tools`（38 键） | 能力档 `tools.platform` 并集 |
| `config.json` 的 `role.maxInjectChars` / `limits.personaInjectChars` | `config.promptBlocks['core-persona'].maxChars`（注入块页） |

启动时桥接会把 `behavior.default`、`runtime.plans`、`role.maxInjectChars`、`limits.personaInjectChars` 从 `config.json` 里清掉并写回（日志会说明）。

---

## 六、相关文档

- [AGENT_PLATFORM_EVOLUTION.md](AGENT_PLATFORM_EVOLUTION.md)：Agent 平台适配层的 P1/P3 现状与 P2（中立 IR）规划
- [FOLDER_MAP.md](FOLDER_MAP.md)：目录地图
- [INJECTION_PROFILE_CONFIG.md](INJECTION_PROFILE_CONFIG.md)：注入块与提示词拼接
- [archive/capability/CAPABILITY_UNIFY_SPEC.md](archive/capability/CAPABILITY_UNIFY_SPEC.md)：能力统一（历史设计，产物链已废弃）
- [archive/models/RUNTIME_PROFILE_MODEL.md](archive/models/RUNTIME_PROFILE_MODEL.md)：运行方案/权限（历史设计稿）
- [archive/models/GLOBAL_CONFIG.md](archive/models/GLOBAL_CONFIG.md)：三层配置与 `config.json` 键表（历史对照）
