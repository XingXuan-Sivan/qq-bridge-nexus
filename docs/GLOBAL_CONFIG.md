# 全局配置：三层模型与配置归一化方案

> 状态：**G1–G4 已提交；G5 已完成**（2026-11-09）。
> G1 文档 `f75949e`、G2 行为档案 `4ace129`、G3 全局配置页 `aa2176a`、G4 动态 picker / CM6 / 统一 `yaml` `169da58`。G5 完成文档收尾、控制台二轮（保存条、编辑器/终端组件、工具表、MCP 层级表，见 `docs/STATUS.md` 6.16）与 `js-yaml` 迁移；表格可选能力（D23）留待有使用点再补。
> 相关文档：`docs/SESSION_SUBSYSTEM.md`、`docs/EXTENSION_PLATFORM.md`、`docs/guides/CONFIGURATION.md`、`docs/STATUS.md` 6.12–6.16。

## 0. 结论

1. 控制台新增**一个**「全局配置」页，只放**系统层**配置；不再有 `social-v1` / `social-v2` 两个按仿真模式拆分的页面，也不再有独立的「访问与安全」页。
2. 「预设」页负责**预设层**：预设元数据、`agent.cordis.yml`、扩展授权、行为档案绑定。预设是“一个 Agent 的完整配置包”，不是运行模式。
3. 「会话与审批」页负责**会话层**：某个群的预设、模型、人格、初始提示词、准入成员、清空/重建；行为参数默认继承预设，不在会话页重复。
4. QQ 交互行为参数（唤醒、发送、等待、主动、表情、上下文、反馈）从 `config.json` 的 `social` / `socialV2` 移到**行为档案** `config/behaviors/*.yml`；预设通过 `behavior:` 引用，不再按 `reserved` / `reserved2` 写死在页面里。
5. 旧的 `social-v1` / `social-v2` / `access` 页面、旧配置键、旧兼容读取**直接删除**，不保留别名、不双写；迁移前先提交/打基线，出错用 git 回溯（用户已选方案 2）。
6. 扩展授权改为从真实 catalog 动态勾选；代码编辑器只做一套通用组件，YAML 用“文档对象 + 保留注释”的保存方式。

## 1. 三层模型

| 层 | 回答的问题 | 存放位置 | 编辑入口 | 典型内容 |
| --- | --- | --- | --- | --- |
| 系统层 | 这台桥接怎么运行 | `config.json`、`state/mode.json`、`plugins.json`、`state/sessions/defaults.json`、`state/extensions/` | 全局配置 / 插件 / MCP / 技能 | DSH 地址与模型、默认预设、默认运行模式、控制台端口与令牌、owner/管理员、准入默认名单、发送总上限、静默、记忆/搜索/定价 |
| 预设层 | 这个 Agent 是谁、会什么 | `dsh/agent-presets/<id>/`、`config/behaviors/<id>.yml` | 预设 / 全局配置的「行为档案」 | 人设与提示词、工具限制 guard、扩展授权、唤醒/发送/主动/表情等行为 |
| 会话层 | 这个群/私聊怎么跑 | `state/sessions/<platform>/<kind>/<id>.json` | 会话与审批 | 该会话的 preset、模型、人格卡、初始提示词、准入成员、DSH 绑定、清空/重建 |

### 1.1 三个容易混淆的概念

- **运行模式（mode）**：`chat` / `reserved` / `reserved2` / `closed-agent`，决定消息走哪条处理链、用哪个引擎；是系统层的“路由”，不是预设。
- **预设（preset）**：`dsh/agent-presets/<id>/` 的完整 Agent 包；决定提示词、guard、扩展授权、行为档案。`reserved` 默认用 `qq-chat`，`reserved2` 默认用 `qq-chat-v2`，但会话可以单独指定 preset。
- **行为档案（behavior）**：一组 QQ 交互参数（唤醒、发送、等待、主动、表情、上下文、反馈）。它不绑定“一代/二代”页面，只带一个 `kind` 用于校验使用它的引擎；可以被多个预设共享。

当前 `social-v1` / `social-v2` 页面把“行为参数”按运行模式拆开，所以看起来像“某个预设的独立页面”；归一化后页面只按“层”划分，不再按 mode 划分。

## 2. 现状盘点

### 2.1 控制台页面

当前 16 页：`overview`、`sessions`、`persona`、`plugins`、`skills`、`presets`、`mcp`、`behaviors`、`social-v2`、`social-v1`、`slang`、`scheduler`、`memory`、`usage`、`access`、`operations`。

目标：

- 删除 `social-v1`、`social-v2`、`access` 三个页面及导航/路由/片段；
- 新增 `config`（「全局配置」），放在「管理行为」之后、「定时任务」之前；
- 保留 `presets`（预设层）、`sessions`（会话层）、`persona`（人格卡库）、`behaviors`（命令/工具参考）、`mcp`/`skills`/`plugins`（扩展注册）、`memory`/`scheduler`/`usage`/`operations`。

### 2.2 当前文件与内容

| 文件 | 当前内容 | 归属判断 |
| --- | --- | --- |
| `config.json` | `dsh`、`role`、`snowluma`、`ownerQQ`、`admins`、`sessionCwd`、`agentPreset`、`workspaceTitle`、`ackMessage`、`sendDelayMs`、`questionTimeoutMs`、`consolePort`、`consoleToken`、`pricing`、`security`、`continuity`、`admin`、`crossGroup`、`slang`、`social`、`socialV2`、`webSearch`、`promptBlocks`、`platform`、`memory` | 系统层；`social`/`socialV2` 的行为部分要移出 |
| `plugins.json` | 插件内核开关/目录/限额/审计/安装/过滤/人格缓存；`plugins.<id>.enabled/config` | 系统层（插件页维护） |
| `state/mode.json` | `mode`、`closedAgentPreset`、`level` | 系统层运行态；全局配置页编辑，但不是“源文件” |
| `state/current-role.json` | `role`、`mode` | 运行态 |
| `state/persona-cache.json` | `version`、`provider`、`entries` | 运行态缓存 |
| `state/prompt-blocks.json` | 按会话 key 的注入块覆盖 | 运行态/系统层 |
| `state/scheduler.json` | 任务、历史、计数器、设置 | 系统层（定时任务页） |
| `state/local-memory.json` | 轻量记忆条目 | 运行态（记忆页） |
| `state/social-v2.json` | `paused`、`conversations` | 运行态消息缓存，**不是配置** |
| `state/slang.json` / `state/stickers.json` | 词库/表情缓存 | 运行态/资源 |
| `state/sessions/defaults.json` | v2 默认准入双轴 `passive/proactive {mode,entries}` | 系统层默认值；由会话页/全局配置的准入段维护 |
| `state/sessions/<platform>/<kind>/<id>.json` | `displayName`、`mode`、`persona`、`prompt`、`wake`、`model`、`presetId`、`binding`、`dormant`、`updatedAt` | 会话层 |
| `dsh/agent-presets/<id>/` | `preset.yml`、`extensions.yml`、`agent.cordis.yml` | 预设层源文件 |
| `config/behaviors/<id>.yml` | **新建**：行为档案 | 预设层共享库 |
| `extensions/mcp/<id>/server.json` | 外部 MCP 配置 | 系统层（MCP 页） |
| `extensions/skills/<id>/SKILL.md` | 外部技能 | 系统层（技能页） |
| `state/extensions/secrets.json` | 外部 MCP 秘密 | 系统层（MCP 页） |
| `roles/*.md` | 旧人格卡 | 人格库；不属于本次迁移 |

### 2.3 当前配置的两个重复源

`src/bridge.js:4045-4060` 的 `modePreset(key, mode, cfg)` 当前：

```js
function modePreset(key, mode, cfg) {
  if (mode === 'closed-agent') { ... }
  const override = state.profiles?.[key]?.presetId;
  if (override && mode !== 'closed-agent') { ... }
  const wanted = mode === 'reserved2'
    ? (cfg.socialV2?.agentPreset || cfg.agentPreset)
    : cfg.agentPreset;
  return resolvePresetName(wanted, { strict: true }) || undefined;
}
```

重复点：

- 会话 `profile.presetId` 已经是会话层覆盖；
- `config.agentPreset` 是全局默认；
- `config.socialV2.agentPreset` 是第二份默认，且只有 `reserved2` 读它；
- `social-v1` / `social-v2` 页面又各自编辑一份行为参数。

目标：只保留 `config.agentPreset`（全局默认）+ `profile.presetId`（会话覆盖）；删除 `socialV2.agentPreset`。

### 2.4 访问与安全页

当前 `public/console/pages/access/fields.js` 只剩三组：

- `whitelist`：`ownerQQ`、`admins` 表；
- `security`：`secInterceptNotify`；
- `token`：`consoleTokenField`。

会话准入名单已在「会话与审批」页，Access 页只留摘要。目标：把这三组并入「全局配置 → 安全与静默」，删除 Access 页、导航、路由和摘要；旧 `#access` 不保留重定向（用户要求“原处直接移除”）。

### 2.5 YAML 保存现状

- `src/presets/store.mjs` 的 `writeMeta` / `writeExtensions` 用 `js-yaml` 的 `dump`，会**丢注释、重排格式**；
- `writeAgentYaml` 写原始文本，已经能 100% 保注释；
- 预设页的 YAML 高级编辑框保存 `agent.cordis.yml` 原文不会丢注释；结构化保存 `preset.yml` / `extensions.yml` 才会丢。

## 3. 目标文件布局

```text
config.json                         # 只放系统层
config/behaviors/
  default-v1.yml                    # 一代默认行为档案
  default-v2.yml                    # 二代默认行为档案
  <custom-id>.yml                   # 以后可新增/复制
state/
  mode.json                         # 当前运行模式（运行态）
  sessions/
    defaults.json                   # 默认准入
    <platform>/<group|private>/<id>.json
  extensions/
  scheduler.json
  ...
dsh/agent-presets/
  qq-chat/
    preset.yml                      # 增加 behavior: default-v1
    extensions.yml
    agent.cordis.yml
  qq-chat-v2/
    preset.yml                      # 增加 behavior: default-v2
    extensions.yml
    agent.cordis.yml
  qq-agent-readonly/                # 运维 Agent，不引用行为档案
  qq-agent-workspace/
  qq-agent-full/
extensions/
  mcp/<id>/server.json
  skills/<id>/SKILL.md
plugins.json
roles/*.md
```

### 3.1 为什么行为档案单独放

- 行为参数是 QQ 交互层，不是 DSH Agent 的提示词/工具；混在 `agent.cordis.yml` 里会让 DSH 预设包变成“桥接私有格式”。
- 多个预设可以共享同一套行为（例如两个不同人设的二代预设都用 `default-v2`），不需要复制 64 个字段。
- 全局配置页可以独立于预设编辑行为库；预设页只做选择，不复制整份表单。
- 文件在 `config/` 下、可被 git 追踪；不塞进 `state/`（否则会被误认为运行态缓存）。

### 3.2 行为档案 schema

`config/behaviors/default-v2.yml` 建议：

```yaml
schema: 1
id: default-v2
kind: reserved2          # legacy | reserved2；决定字段校验和 UI 分组
name: 二代仿真默认
description: 二代仿真的默认唤醒、发送、主动与表情行为。

wake:
  defaultMode: diving
  preSleepWaitEnabled: true
  preSleepWaitMs: 300000
  recommendedDefaultInfinite: true
  sleepMinMs: 60000
  sleepMaxMs: 0
  recommendedSleepMinMs: 300000
  recommendedSleepMaxMs: 7200000
  recommendedProbability: 0.05
  recommendedKeywords: [...]
  recommendedAtMention: true
  recommendedNameMention: true
  recommendedQuestion: true
  recommendedPoke: true
  recommendedHint: ...
  batchWindowMs: 8000
  maxWakePerMinute: 1
  maxWakePerHour: 12
  noActionLimit: 3
  maxWakeConfigReminders: 2

send:
  burstEnabled: true
  burstMaxMessages: 8
  burstIntervalMinMs: 1000
  burstIntervalMaxMs: 3000
  longGapProbability: 0.2
  longGapMinMs: 5000
  longGapMaxMs: 9000
  maxGapMs: 30000
  gapBaseMs: 700
  gapPerCharMs: 35
  maxChars: 500

wait:
  defaultMs: 30000
  minMs: 5000
  maxMs: 600000
  defaultQuietMs: 8000
  minQuietAfterNewMs: 10000

proactive:
  enabled: true
  checkIntervalMinMs: 1800000
  checkIntervalMaxMs: 5400000
  idleThresholdMs: 900000
  probability: 0.3

sticker:
  enabled: true
  syncTtlMs: 60000
  maxListCount: 100
  includeInPrompt: true
  promptMaxStickers: 8
  maxBytes: 10485760
  collect:
    enabled: true
    maxPerMinute: 2
    maxPerHour: 10
    maxRemarkChars: 20

context:
  recentLimit: 100
  unreadLimit: 30
  contextWindow: 20
  inlineWakeMessages: true
  wakeMessageLimit: 12
  wakeRecentLimit: 4
  wakeMaxChars: 6000

feedback:
  maxLength: 500
  notifyOwnerOnError: false

autoReplyCheckMs: 30000
provideRecommendations: true
```

`default-v1.yml` 使用一代字段（`triggerProbability`、`activeCheckMinMs`、`activeDuration*`、`idle*`、`burst*`、`proactive*` 等），结构同样分 `send`/`proactive` 等组，`kind: legacy`。

> 注：字段名以当前 `src/bridge.js` 的归一化对象为准；上表是目标结构，迁移时逐字段对照，不凭页面 label 猜。

### 3.3 `config.json` 目标结构

迁移完成后 `config.json` 只保留系统层。目标形状如下（省略号表示沿用当前子字段）：

```jsonc
{
  "dsh": { /* baseUrl/provider/model/reasoningEffort/auth/vision */ },
  "role": { "maxInjectChars": 6000 },
  "snowluma": { /* 网关地址与令牌 */ },
  "ownerQQ": "2897715886",
  "admins": [ /* 管理员表 */ ],
  "sessionCwd": "",
  "agentPreset": "qq-chat-v2",
  "workspaceTitle": "",
  "ackMessage": "",
  "sendDelayMs": 800,
  "questionTimeoutMs": 60000,
  "consolePort": 3111,
  "consoleToken": "",
  "pricing": { /* 价目表 */ },
  "security": { /* interceptNotify 等 */ },
  "continuity": { /* 人际连续性 */ },
  "admin": { /* owner 管理通道 */ },
  "crossGroup": { /* 跨群 */ },
  "slang": { /* 黑话学习 */ },
  "webSearch": { /* 联网搜索 */ },
  "promptBlocks": { /* 注入块覆盖 */ },
  "platform": { /* 平台适配 */ },
  "memory": { /* 记忆预算/ingest */ },

  "tools": { /* 原 socialV2.tools：QQ MCP 工具开关 */ },
  "compact": { /* 原 socialV2.compact：上下文压缩 */ },
  "limits": {
    "send": { "maxSendPerMinute": 10, "maxSendPerHour": 120 },
    "initialPromptMaxChars": 2000
  },
  "voice": { /* 原 socialV2.voice：语音库/发送上限 */ },
  "media": { /* 原 socialV2.media：图片字节/像素/张数 */ }
}
```

明确不在这里的：

- `state/mode.json` 的 `mode/closedAgentPreset/level`：运行态，不在 `config.json`；
- `social`、`socialV2`、`socialV2.agentPreset`、`socialV2.enabled`：删除；
- 会话行为/人格/提示词/准入成员：在 `state/sessions/`；
- 预设人设、guard、扩展授权：在 `dsh/agent-presets/`；
- 插件配置：在 `plugins.json`；
- 外部 MCP 配置与秘密：在 `extensions/mcp/` 与 `state/extensions/secrets.json`。

## 4. 迁移映射

### 4.1 从 `config.json` 移出

| 当前键 | 目标 |
| --- | --- |
| `social.*`（v1 全量行为） | `config/behaviors/default-v1.yml`；`social.enabled` 删除，由 mode 决定 |
| `socialV2.wake/send 行为部分/wait/proactive/sticker/context/feedback/autoReplyCheckMs/provideRecommendations` | `config/behaviors/default-v2.yml` |
| `socialV2.agentPreset` | 删除，统一用 `config.agentPreset` |
| `socialV2.enabled` | 删除，由 mode 决定；不再有“选了 reserved2 但 v2 关着”的第二开关 |
| `socialV2.tools` | `config.tools`（全局工具面） |
| `socialV2.compact` | `config.compact`（上下文压缩） |
| `socialV2.send.maxSendPerMinute/maxSendPerHour` | `config.limits.send`（全局防刷屏上限；与行为档案里的 burst 分开） |
| `socialV2.initialPromptMaxChars` | `config.limits.initialPromptMaxChars` |
| `socialV2.voice` | `config.voice` |
| `socialV2.media` | `config.media` |

> 这里把“发送节奏/分条”留在行为档案，把“每分钟/每小时总上限”留在系统层：前者是拟人化表达，后者是账号安全，不应随预设变化。

### 4.2 访问与安全

- `ownerQQ`、`admins`：仍写 `config.json`，在「全局配置 → 安全与静默」编辑；
- `consoleToken`：仍写 `config.json`，同段编辑；
- `security.interceptNotify`：同段；
- 会话准入名单：仍写 `state/sessions/defaults.json`，但入口从 Access 页移到「全局配置 → 准入」或保留在会话页？**决定：名单本身属于系统默认值，放「全局配置 → 准入」；会话页只显示某个会话是否在名单里/被拒绝，不再编辑全局名单。** 这样 Access 页删除后不会留下“名单在会话页、其他安全在全局配置”的割裂。
- 旧 Access 页的 `state/` 权限警告、SnowLuma 排查块属于诊断，不进全局配置；保留在「调试与运维」或按用户意见先不做入口。

### 4.3 运行模式与默认预设

- `state/mode.json` 仍是运行态，不迁入 `config.json`；全局配置页通过现有 mode API 编辑。
- 默认 preset 只保留 `config.agentPreset`；`modePreset()` 改为：会话 `profile.presetId` → `config.agentPreset` → 按 mode 的硬编码默认（启动校验必须存在）。
- `closed-agent` 仍用 `state/mode.json.closedAgentPreset` 与 `level`，不参与 QQ 行为档案。

## 5. 解析顺序与校验

### 5.1 解析顺序

```text
mode          = session.profile.mode（inherit → state/mode.json.mode）
preset        = session.profile.presetId || config.agentPreset
behavior      = preset.behavior || null
behaviorKind  = behavior.kind
```

- `mode` 与 `preset` 独立：会话可以把 `qq-chat-v2` 固定到某个群，即使全局 mode 是 `reserved`；但启动/保存时要校验 preset 与 mode 的兼容性（见下）。
- 行为档案只按 preset 解析；**不再**按 mode 直接选 `socialV2` 或 `social`。
- 没有 `behavior` 的预设（`qq-agent-*`）表示“不做 QQ 仿真行为”，不套默认档案。

### 5.2 校验

- 启动时校验所有 chat preset 的 `behavior` 存在、可读、`id` 与文件名一致；缺失/非法直接启动失败（fail closed）。
- `behavior.kind` 必须与预设的引擎匹配：`qq-chat` 用 `legacy`，`qq-chat-v2` 用 `reserved2`；显式不匹配时启动失败，避免“拿二代参数跑一代”。
- 会话 `presetId` 指向不存在或与 mode 不兼容的 preset：会话详情显示警告；该会话不做 QQ 仿真（不唤醒/不自动回复），只保留管理命令与审批，避免静默套错。
- `preset.yml` 的 `behavior` 字段由预设页校验；不能引用不存在的档案。

## 6. 全局配置页

### 6.1 页面结构

单页 + 顶部水平分区标签（复用站点通用的 `.page-tabs` / `.page-tab`，与记忆页同一套；不再维护左侧竖排导航）：

```text
全局配置
├─ 运行与模型        mode、默认 preset、DSH provider/model/reasoning/vision、compact
├─ 安全与静默        owner/admins、控制台令牌、拦截提示、手动静默、定时静默、发送总上限
├─ 准入              被动/主动两条名单（白名单/黑名单）、归属说明
├─ 行为档案          档案列表 + 编辑器（新建/复制/删除/设为默认？）
└─ 拓展功能          QQ 工具开关、语音库、媒体限制、初始提示词上限
```

- “配置位置”分区已删除：各项写入哪个文件由实现决定，不再在页面上做只读展示；代码编辑器只出现在 YAML/JSON 字段。

- 顶部固定一条「三层模型」说明与跳转：`系统层（本页） / 预设层（预设页） / 会话层（会话与审批）`。
- 每个分区底部保存（或全页底部 sticky 保存 + 脏分区标记）；保存失败只影响该分区，不整页回滚。
- 诊断/通知（`state/` 权限、SnowLuma 排查）不进本页。

### 6.2 删除的页面/入口

- `#social-v1`、`#social-v2`：页面、nav、router、`PAGE_FRAGMENTS`、静态基线全部删除；旧 hash 不重定向（用户要求不保留）。
- `#access`：页面、nav、router 删除；其配置并入「安全与静默」；会话准入名单并入「准入」；旧 hash 不重定向。
- `#overview` 保留“运行总览”，但移除重复的全局配置表单与「管理全局配置 →」入口：模式/预设/模型/发言上限/静默只保留摘要，配置统一从左侧导航进入；活动日志保留。
- `#persona` 保留人格卡库；会话页仍可选择人格。

### 6.3 预设页的变化

- 增加「行为档案」下拉：读取 `config/behaviors/*.yml`，按 `kind` 过滤；显示档案名与 `id`。
- 扩展授权从文本框改为动态 picker（见 §7）。
- YAML 高级编辑框改用统一代码编辑器（见 §8）。
- 预设页不再提供“按模式开关行为”的表单；行为字段只在全局配置的行为档案里编辑。

### 6.4 会话页的变化

- 保留 preset/模型/人格/初始提示词/准入成员/重建/重置。
- 准入成员只显示“是否在全局名单 + 生效结果”；全局名单编辑链接到全局配置「准入」。
- 不提供行为参数覆盖（一期）；以后如确有需要，再加 `profile.behaviorId` 覆盖，不复制字段。

## 7. 扩展授权动态 picker

数据源：现有 `GET /api/extensions?refresh=1`（`src/extensions/catalog.mjs`）：

- `mcp[]`：server id、name、description、status、tools[]；
- `skills[]`：id、name、description、source、active。

### 7.1 交互

- 三个分组：MCP Server、MCP 工具、技能。
- 每个分组：搜索、全选/清空、已选计数；tree/checkbox list；工具按 server 分组，值用 `server__tool`（与 `preset-policy.mjs` 的 `mcpToolAllowed` 一致）。
- `*` 作为“全部”特殊项；选中 `*` 时其他项禁用并显示“全部允许”。
- 已配置但当前 catalog 不存在的条目：保留在“失效条目”区，标红/警告，可移除；不自动删除，避免临时不可用造成授权丢失。
- 工具列表按 server 过滤：未选 server 时，其工具仍可被选？为避免歧义，工具分组跟随 server 勾选；若只选工具不选 server，保存前提示。
- 结构化 picker 只编辑 allow；`deny` 仍通过高级 YAML 编辑（UI 可后续补，但不在第一期做假 deny 开关）。
- 保存前校验至少一项或明确“全部拒绝”；空 `extensions.yml` 的语义仍是全部拒绝，UI 必须显式提示。

### 7.2 后端

- 继续用 `normalizePresetPolicy` 校验，不新增第二套策略解析。
- 动态 picker 只读 catalog，不落盘 catalog；保存只写 `extensions.yml`。
- 现有 `preset-policy.mjs` 的 `matches` 支持 `*` 后缀；picker 对 `foo__*` 这类前缀通配不做 UI，留给高级编辑。

## 8. 代码编辑器与 YAML 保注释

### 8.1 编辑器选择

要求：通用（YAML/JSON/以后其他文本）、唯一方案、无 CDN、能在零 bundler 的控制台里自托管。

推荐：**CodeMirror 6 + `@codemirror/lang-yaml`**，用 esbuild 打成 vendor 文件，放 `public/console/components/code-editor/vendor/codemirror.js`：

- 一个组件/入口 `public/console/components/code-editor/entry.mjs`，API 暴露 `createEditor/EditorView/EditorState/Compartment/HighlightStyle/syntaxHighlighting/tags/yaml/basicSetup`（主题写在组件 JS 里，改配色不需要重建）；
- 语言包按需注册：先 YAML，后面 JSON；不为每种文件另造编辑器；
- 行号、搜索、括号匹配、折叠；不启用重型 lint（服务端校验为准）；
- `script-src 'self'` 下自托管，不引 CDN；不引入 Monaco（体积/构建都重）。CSP 只给 `style-src` 加 nonce（`src/http/security.mjs` `consoleCsp`），CM6 运行时注入的样式因此可用。
- 已落地（G4，D21 调整目录）：`scripts/build-console-vendor.mjs` 产出 `public/console/components/code-editor/vendor/codemirror.js`（约 428KB）；`npm run verify:console-vendor` 重建到临时文件比对 sha256。预设页与行为档案都用 `attachTextareaEditor` 挂载，变更写回隐藏 textarea，保存仍拿 textarea。

> 已拍板：CM6，不用 Ace/CM5；不再保留“待拍板”状态。

### 8.2 YAML 库

目标：**一套 YAML 方案，保留注释，不再用 `js-yaml.dump` 做结构化保存**。

- 采用 `yaml`（eemeli/yaml）的 `parseDocument` / `Document.setIn` / `String(doc)`；
- 结构化表单修改只改对应节点，保留其他注释与顺序；flow 风格可能被规范化（`["*"]` → `[ "*" ]`），这是可接受的格式变化，不丢语义；
- `agent.cordis.yml` 继续“原始文本保存”，不 parse/dump；代码编辑器保存的就是原文；
- 预设结构化保存（meta/extensions）全部改走 `yaml` Document；`js-yaml` 从桥接自有代码中移除，避免两个 YAML 库并存；
- DSH 自己 bundle 里的 `js-yaml` 不属于桥接依赖，保持不动。

迁移影响（已完成）：桥接自有代码已全部改用 `yaml`——`src/presets/store.mjs` 用 `parseDocument`/`setIn`（保注释，`test-preset-store` 6/6），`src/extensions/skill-store.mjs`、`src/extensions/preset-policy.mjs`、`scripts/build-agent-preset-patches.mjs`、`scripts/setup-dsh.mjs` 及 3 个测试改用 `parse`/`stringify`；产出与旧 `js-yaml` 逐字一致（`lineWidth: 0` + `singleQuote: true` + `aliasDuplicateObjects: false`），patch 文件无 diff。`js-yaml` 已从 `package.json` 删除。仅 `scripts/test-setup-dsh-idempotent.mjs`、`scripts/verify-dsh-020-adaptation.mjs`、`scripts/verify-persona-config.mjs` 仍按路径加载 **DSH 自带的** `js-yaml`（用于验证 DSH 侧解析结果），不属于桥接依赖。

### 8.3 保存交互

参考 AstrBot 的两阶段，但按我们的表单拆分：

1. 结构化字段修改 → 在内存 Document 上 `setIn`；
2. 切到「代码编辑」→ 显示当前 Document 文本；用户可直接改；
3. 「应用」→ 解析并校验（YAML 语法、preset 契约），通过后写回内存 Document（不落盘）；
4. 「保存」→ 写文件 + 备份；预设页的「应用」仍单独执行 build+setup。

这样避免“代码编辑改了但没保存”的歧义，也不让结构化字段和原始文本各存一份。

## 9. 迁移步骤（方案 2：直接删旧键，不留兼容）

### 9.1 前置

- 当前分支干净、`HEAD` 可回滚；先打一个基线提交/标签（只用于回溯，不生成运行时备份）。
- 记录当前生效配置快照（`/api/socialV2/config` 的完整归一化对象，不是 `config.json` 的 4 个键），作为迁移前后对照。

### 9.2 后端

1. 新建 `config/behaviors/default-v1.yml`、`default-v2.yml`，从**归一化后的** `cfg.social` / `cfg.socialV2` 逐字段生成；不要只读 raw config（很多默认值在代码里）。
2. 给 `qq-chat` / `qq-chat-v2` 的 `preset.yml` 加 `behavior:`；`qq-agent-*` 不引用。
3. 新增行为档案 loader/validator，启动时校验；`resolveBehavior(preset)` 替代所有 `cfg.social` / `cfg.socialV2` 行为读取点。
4. `modePreset` 删除 `socialV2.agentPreset` 分支，只留 `profile.presetId` → `config.agentPreset`。
5. `config.json` 迁移：`socialV2.tools/compact/send/voice/media/initialPromptMaxChars` 移到 `tools/compact/limits/voice/media`；行为键删除；`social` 整体删除；`socialV2.agentPreset`/`enabled` 删除。
6. 旧 Access 页配置并入「安全与静默」；准入名单移到全局配置「准入」；删除 Access 路由/页面/导航。
7. 删除 `social-v1`/`social-v2` 页面、路由、`PAGE_FRAGMENTS`、静态基线、旧 API（如 `/api/socialV2/config` 的行为部分只保留系统键；若整页移除，则端点也删）。
8. 保留 `/api/socialV2/state`、`/activity`、`/feedback`、`/tool-log` 等运行态端点，但改名/归入运维接口（不留在已删除页面的命名空间下）；具体清单在实施时列。

### 9.3 前端

1. 新增 `public/console/pages/config/`（`fields.js/page.html/page.js/page.css`），按 §6 分区。
2. 删除 `public/console/pages/social-v1/`、`social-v2/`、`access/`、导航按钮、`router.js` 条目、`PAGE_FRAGMENTS`、`index.html` section。
3. 预设页：行为档案下拉 + 动态扩展 picker + 统一代码编辑器。
4. 会话页：准入成员只读/跳转全局配置；不重复全局名单。
5. 总览页：去重全局配置表单，改为摘要 + 链接。

### 9.4 测试与验收

- 新增 `test-behavior-profiles`（解析/校验/解析顺序/kind 不匹配 fail closed）。
- 迁移 golden：同一份归一化 `social`/`socialV2` 迁移前后，`resolveBehavior` 输出逐字段相等。
- 现有 `test-session-profiles`、`test-preset-store`、`test-preset-local-tools`、`test-console-static/ui`、`test-audit` 更新。
- 真机：旧 `config.json` 迁一次，校验旧键消失、行为档案生成、预设可启动、会话无 pageerror；旧页面 404/不可达（不重定向）。
- 门禁：static、UI、audit、`git diff --check`；提交前确认 `config.json` 无旧键。

### 9.5 回滚

- 代码回滚到基线提交；配置文件在 git 中，直接 checkout；不提供运行时双读或迁移工具。
- 迁移失败时启动失败（fail closed），不会带着半套配置跑。

## 10. 分批计划

| 批次 | 内容 | 出口 |
| --- | --- | --- |
| G1 | 本文档 + 三层模型 + 文件布局/迁移清单 | 用户批准（含编辑器方案） |
| G2 | 行为档案后端 + 迁移 + 预设引用 + 测试 | 旧 `social`/`socialV2` 行为键删除，golden 通过 |
| G3 | 全局配置页（运行/安全/准入/行为档案/工具语音）+ 删除旧三页 | static/UI/audit，真机无旧入口 |
| G4 | 预设页动态 picker + 统一代码编辑器 + YAML Document | 注释保留测试、保存/应用/回滚 |
| G5 | 文档/STATUS/配置说明收尾 | 提交、工作区干净 |

状态：G1 `f75949e`、G2 `4ace129`、G3 `aa2176a`、G4 `169da58` 已提交；G5 已完成文档收尾、控制台二轮（保存条、编辑器/终端组件、工具表、MCP 层级表，见 `docs/STATUS.md` 6.16）与 `js-yaml` 统一迁移（见 §8.2）。表格可选能力（分组行/多选列/可配置限高）按 `PLAN_DEVIATIONS.md` D23 留待有使用点再补。

## 11. 已拍板（2026-11-09，m31268）

1. **编辑器**：CodeMirror 6 + `@codemirror/lang-yaml`，esbuild 自托管到 `public/console/components/code-editor/vendor/`；只保留这一套，后续 JSON 复用同一个 `code-editor` 组件。
2. **YAML 库**：桥接自有代码统一迁到 `yaml` 的 `parseDocument` / `Document.setIn` / `String(doc)`；`agent.cordis.yml` 继续原样保存。不保留第二个 YAML 库。
3. **行为档案“默认”归属**：chat preset 必须显式绑定 `behavior`，不做隐式兜底；缺失或 `kind` 不匹配时启动失败（fail closed）。运维 Agent 不绑定行为档案。
4. **准入名单位置**：放「全局配置 → 准入」。会话页只显示成员关系与生效结果，不重复编辑全局名单。
5. **诊断/通知**：`state/` 权限与 SnowLuma 排查块移到「调试与运维」，不放进全局配置页。
6. **迁移**：方案 2 直接删旧键、旧页面、旧 API，不保留别名/双写/兼容读取；当前分支先留一个可回滚基线提交。
7. **实施纪律**：任何偏离本方案的决定记入 `docs/PLAN_DEVIATIONS.md`，踩坑追加 `docs/CONSOLE_FORM_LESSONS.md`；阶段收尾检查 Partial 项，不把 Partial 写成 Done。

---

## 附：本方案不做的事

- 不把 DSH 预设的 `agent.cordis.yml` 拆成桥接字段；
- 不做“按运行模式自动切换行为档案”的隐式魔法；
- 不保留 `social-v1` / `social-v2` / `access` 的旧 URL、旧 API 别名或兼容读取；
- 不引入第二套 YAML 库或第二个代码编辑器；
- 不在本次把 `overview` 的活动日志/诊断搬进全局配置。
