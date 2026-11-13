# 四层配置模型（PROFILES_MODEL）

> 从 2026-11-12 起，桥接的“配置”只剩一条主链：**用户侧平台 → 行为档案 / Agent 平台 → 能力预设 / 运行方案 → 会话权限级别**。
> 旧的 `config/behaviors/`、`config/platform/`、`dsh/agent-presets/` 三处存储已删除，没有兼容层。
> 本文只描述现状；历史设计文档见文末“相关文档”。
>
> **源码 vs 产物**：`profiles/` 是**权威源**（人写的 yml / md / mjs），`artifacts/<agent平台>/` 是**生成或打包产物**（DSH 加载用）。
> 产物一律由该平台的适配器生成，不手改；二者的关系见 [AGENT_PLATFORM_EVOLUTION.md](AGENT_PLATFORM_EVOLUTION.md)。

---

## 一、四层各自负责什么

| 层 | 回答的问题 | 存储 | 谁提供 |
| --- | --- | --- | --- |
| **用户侧平台**（platform） | AI 在哪个聊天平台上做事（QQ、微信、B 站……） | `profiles/platforms/<id>/` | 系统给接口与公共配置，平台特有的行为由该平台目录里的数据提供 |
| **行为档案**（behavior） | 在这个平台上“怎么表现”（一代仿真 / 二代仿真 / 别的风格） | `profiles/platforms/<id>/behaviors/*.yml` | 档案作者（内置两份，可增删） |
| **Agent 平台**（agent platform） | AI 跑在哪个 Agent 运行时（当前只有 DSH） | `profiles/agent-platforms/<id>/` | 系统给接口，具体工具/模块由该平台目录提供 |
| **能力预设**（capability） | 这个 Agent 平台里“能拿到什么”：平台工具、Agent 模块、MCP、技能 | `profiles/agent-platforms/<id>/capabilities/*.yml` | 内置四条，可克隆/新建 |
| **运行方案**（plan） | 把“行为档案 + 能力预设”组合成一个可切换的档位，并声明平台与 Agent | `profiles/plans/*.yml` | 内置六条（只读），可克隆成自定义方案 |
| **权限级别** | 具体会话最终能用能力预设里的哪些工具 | 会话配置（`state/sessions.json`） | 会话级，不落在档案里 |

关系一句话：**方案 = 平台 + Agent 平台 + Agent + 行为档案 + 能力预设**；方案决定“拿到哪些能力”，会话权限级别再决定“实际能用哪些”。

---

## 二、目录与文件

```
profiles/
├── platforms/
│   └── qq/
│       ├── platform.yml          # id / label / 说明
│       ├── tools.yml             # 平台工具目录（flag、宿主工具名、风险、defaultOff）
│       ├── prompt.md             # 平台话术（可编辑）
│       ├── prompt.default.md     # 出厂话术（「还原」从这里取）
│       ├── behavior-types/
│       │   ├── social-v1.yml     # 类型：label / engine / schema.fields
│       │   └── social-v2.yml
│       └── behaviors/
│           ├── social-v1.yml     # 一代仿真（kind: social-v1）
│           └── social-v2.yml     # 二代仿真（kind: social-v2）
├── agent-platforms/
│   └── dsh/
│       ├── agent-platform.yml    # id / label / 说明
│       ├── tools.yml             # Agent 模块目录（文件读写、PowerShell、Web……）
│       ├── capabilities/
│       │   ├── agent-chat.yml
│       │   ├── agent-readonly.yml
│       │   ├── agent-workspace.yml
│       │   └── agent-full.yml
│       ├── templates/rows.yml    # 安装/生成产物用的行模板
│       ├── agents/               # 要装进 DSH 的 preset（chat、chat-v2、qq-agent-*）
│       └── adapters/             # 该平台的构建/安装适配器（P1 起）
│           ├── build.mjs         # planArtifacts()：源码 → 产物文件清单（纯函数）
│           └── install.mjs       # install()：产物装进运行时（写 profile patch / junction）
├── plans/
│   ├── chat.yml                  # 内置六条：chat / social-v1 / social-v2 / agent-readonly / agent-workspace / agent-full
│   └── …
└── schemas/                      # 五份 JSON Schema（platform / agent-platform / behavior / capability / plan）

artifacts/                        # 各 Agent 平台的产物根（目录名 = agent 平台 id）
└── dsh/
    ├── qq-agent-presets/         # DSH bundle：生成出来的 presets/*.patch.yml + 手写守卫 mjs
    └── qq-mode-console/          # DSH bundle：qq-mode 设置命名空间插件（只有 host 半）
```

`artifacts/dsh/qq-agent-presets/presets/*.patch.yml` 由 **DSH 平台的 build 适配器**
（`profiles/agent-platforms/dsh/adapters/build.mjs`）从 `profiles/agent-platforms/dsh/agents/` 生成，
入口是 `node scripts/build-artifacts.mjs dsh`（`npm run build:artifacts`）；改 agent 目录后要重新生成并重启 DSH。

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

### 能力预设 `capabilities/<id>.yml`

```yaml
version: 1
id: agent-chat
label: 聊天 Agent
note: …
platform: qq
agentPlatform: dsh
agent: chat          # 该能力对应的 DSH preset
tools:
  platform: { sendGroup: true, getPrompt: true, … }   # 平台工具开关（true/false 都保留）
  agent: { tool-web: true, tool-todo: true, … }       # Agent 模块开关
  mcp: [{ server: snowluma-safe, tools: '*' }]        # MCP 服务器与工具
  skills: ['*']                                       # 技能
```

- 能力预设**只描述“拿到什么”**：不再有 order / prompt.base / safety / risk 这些只为生成 DSH 产物的字段。
- 保存只写回这一个 yml，不再生成 `agent.cordis.yml` / `preset.yml`；内置四条不可删除，可克隆。
- 平台工具的注册面 = 所有能力预设 `tools.platform` 的并集（`platformFlags()`），`config.json` 不再有 `tools`。

### 运行方案 `plans/<id>.yml`

```yaml
version: 1
id: social-v2
label: 二代仿真
builtin: true
platform: qq
agentPlatform: dsh
agent: chat-v2
behavior: social-v2
capability: agent-chat
audience: access
note: …
```

- 内置六条：`chat`、`social-v1`、`social-v2`、`agent-readonly`、`agent-workspace`、`agent-full`；`builtin: true` 的只能克隆，不能改/删。
- `behavior` 只存档案名；引用的档案不存在时加载侧告警并退化为“无档案”，不阻断消息处理。
- 方案解析：会话单独设置的方案优先，没设就用全局默认方案（`config.json` 的 `runtime.defaultPlan`，缺省 `social-v2`）；不再有 `state/runtime.json` 运行时指针，也没有全局「切换方案」接口。切换/提级权限仍走管理通道的 TOTP，与方案无关。
- 内置方案、内置行为档案、内置能力预设的出厂副本放在各自目录的 `.defaults/<id>.yml`；控制台「重置」按钮复制回正式文件，改坏了可以一键还原。

### 平台 / Agent 平台

`platform.yml`、`agent-platform.yml` 只放 `id / label / note` 与目录元信息；平台工具目录在 `tools.yml`，Agent 模块目录在 `agent-platforms/<id>/tools.yml`。

---

## 四、代码接口

| 能力 | 模块 |
| --- | --- |
| 读平台与工具目录 | `src/platforms/index.mjs`：`listPlatforms` / `loadPlatform` / `readPlatformTools` / `PLATFORM_TOOL_RISKS` |
| 行为档案读写 | `src/behaviors/index.mjs`：`loadBehaviorProfiles` / `normalizeBehavior` / `resolveBehavior` / `readBehaviorDocument` / `writeBehaviorData` / `duplicateBehavior` / `removeBehaviorFile` |
| 平台话术 | `src/platform/prompt.mjs`：`readPlatformPrompt` / `writePlatformPrompt` / `restorePlatformPrompt` / `renderPlatformText` |
| 能力预设 | `src/capabilities/store.mjs`：`createCapabilityStore` / `visiblePlatformFlags` / `platformFlags` / `capabilityAllowsFlag` |
| 运行方案 | `src/runtime/plans.mjs`：`createPlanStore`（list/get/save/remove/clone）/ `normalizePlan` / `findPlan` / `legacyModeOfPlan` |
| 目录常量 | `src/profiles/paths.mjs`：`PROFILES_ROOT` / `PLATFORMS_ROOT` / `AGENT_PLATFORMS_ROOT` / `PLANS_ROOT` / `SCHEMAS_ROOT` / `agentPlatformDir(id)` |
| 模式持久化 | `src/runtime/mode-store.mjs`：`createModeStore` / `createLocalModeFileBackend`（`state/mode.json`）/ `createDshModeBackend`（DSH `qq-mode` 命名空间）。只负责存取，模式语义（别名归一、级别、提权判定）仍在 `bridge.js` |
| 平台适配器发现 | `scripts/agent-platform-adapters.mjs`：`ADAPTER_KINDS` / `adapterFile` / `listAgentPlatforms` / `loadAdapter` / `normalizeArtifactFiles`。**约定优于声明**：只看 `profiles/agent-platforms/<id>/adapters/<kind>.mjs` 存不存在，不读 `agent-platform.yml` |
| 产物构建调度 | `scripts/build-artifacts.mjs`：`buildArtifacts({targets, check})`。遍历平台 → 调 `planArtifacts()` → 校验路径/去重 → 写盘；`--check` 只比对不写（漂移即非零退出） |
| 产物安装调度 | `scripts/install-agent-platform.mjs`：`installAgentPlatform({agentPlatform, profile})`。**先 build 再 install**，避免装到旧产物 |

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
export const capabilities = Object.freeze(['session', 'prompt', 'events', 'models', 'permissions', 'settings', 'compact']);
export const PERMISSION_PRESET_FOR_LEVEL = Object.freeze({ 'read-only': 'read-only', …, full: 'danger-full-access' });
export const LEVEL_PERMISSION_PRESET = Object.freeze({ L1: 'read-only', L2: 'workspace-write', L3: 'qq-full-ask' });
export const AGENT_PRESET_IDS = Object.freeze(['chat', 'chat-v2', 'readonly', 'workspace', 'full']);
export const AGENT_PRESET_FOR_LEVEL = Object.freeze({ L1: 'readonly', L2: 'workspace', L3: 'full' });
export const AGENT_PRESET_ALIASES = Object.freeze({ 'qq-chat': 'chat', … });      // 旧名读入归一
export function resolveLevelPlan(level, ctx) {}                     // 内核级别 → 平台落地
export function normalizeAgentPreset(name) {}
```

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
| `dsh/agent-presets/qq-*`（DSH preset 源） | `profiles/agent-platforms/dsh/agents/qq-*` |
| `config.json` 的 `behavior.default` | `profiles/plans/chat.yml` 的 `behavior: none` |
| `config.json` 的 `runtime.plans[]` | `profiles/plans/*.yml` |
| `config.json` 的 `tools`（38 键） | 能力预设 `tools.platform` 并集 |
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
