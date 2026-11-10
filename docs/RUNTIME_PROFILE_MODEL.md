# 运行方案模型（Runtime Plan）

> 状态：设计稿 v3，未动工。
> 执行顺序、配置键归属、页面合并与冲突裁定以 `docs/UNIFY_PLAN.md` 为准（该文是三份文档的唯一裁定）。
> v2 的五字段方案把人格与模型也塞了进去，属过度设计——本轮按意见改为三字段，人格与模型回到"单独配置"；同时补上行为档案的接口化与页面归属。
> 本文替代 `docs/INJECTION_PROFILE_CONFIG.md` §3；§2 注入块部分不受影响。

---

## 0. 一句话

系统只留三类东西：

1. **资源**：能力预设、行为档案、人格、模型、平台适配器、准入。
2. **方案**：`工具 + 行为 + 受众` 三件事的组合，是一份数据，可克隆、可导入导出。
3. **绑定**：全局按平台一个当前方案；会话可单独指一个方案。

人格与模型**不进方案**——它们是"这个人是谁、用哪个脑子"，和"这次让它拿什么工具、用什么说话方式、对谁生效"是两件事，各自有全局默认与会话覆盖。

级别、模式、协议都不再是字段，是方案解析出来的标签。

---

## 1. 设计原则

| 原则 | 含义 | 反例（现状 / v2） |
| --- | --- | --- |
| 一个值一个来源 | 任一运行时参数只有一条解析链，链上每一层都可显式留空 | `mode` 和 `agentPreset` 都能决定预设 |
| 方案只装"这次怎么跑" | 工具、行为、受众进方案；人格、模型、唤醒留在外面 | v2 把人格与模型塞进方案 |
| 资源按引用组合 | 方案存 id 不存拷贝；改资源，所有引用它的方案一起变 | 预设里内嵌行为配置 |
| 默认保守，不做禁令 | 不提供极端预设，但允许用户自己组合 | `danger-full-access` 被代码硬禁 |
| 安全靠"看得见 + 留痕" | 确认、摘要、审计、漂移检测 | 用白名单把路堵死 |
| 平台无关 | 方案不写死 QQ；平台差异落在适配器与行为档案里 | `mode` 只对 QQ 有意义 |

---

## 2. 对象与关系

```
能力预设 ─┐
行为档案 ─┼──▶ 运行方案 ──▶ 绑定（全局按平台 / 会话）
准入     ─┘         │
                    └──▶ 解析结果

人格 ──┐
模型 ──┴──▶ 会话覆盖（与方案平行，独立配置）
```

- 资源是名词，方案是句子，绑定是对谁说。
- 方案只引用资源，不复制内容。
- 人格与模型不在方案里，但和方案同处一条解析链：会话覆盖 → 全局默认。

---

## 3. 资源

### 3.1 能力预设（capability）

一个能力预设 = **agent preset（工具集 + 系统提示 + 扩展授权）+ 沙箱（权限预设 + 审批姿态）+ 工具收窄**。今天前两者被"级别"间接绑死（`src/admin/dsh-permission.js:17-42`），第三项藏在 DSH 预设的 `extensions.yml` 里；现在把三者显式注册成**一份数据 + 一个 provider 接口**：

```jsonc
{
  "id": "qq-agent-full",
  "label": "全权 Agent",
  "platform": "qq",
  "preset": "qq-agent-full",         // 由 provider 解析的实际能力包
  "sandbox": "danger-full-access",   // 权限预设名；空 = 不额外设置权限
  "grants": { "disable": ["sendSticker"] },  // 在平台工具箱之上收窄（见 §3.7）
  "builtin": true,
  "note": ""
}
```

**已实现的形态**（P7，见 `src/runtime/capabilities.mjs`）：能力 = DSH 目录里的预设（权威源 `dsh/agent-presets/<id>/`）+ 桥接侧补丁 `config.capabilities[presetId] = { sandbox, grants: { disable: [...] }, note }`。注册表按「DSH 目录 ∪ 方案用到的预设」懒建，`save()` 只写桥接侧补丁，绝不改写 DSH 预设源文件；`grants.disable` 的 9 个写工具是固定的可收紧集合（`GATEABLE_TOOLS`），执行侧由 `v2ToolEnabled(flag, key)` 按会话固定方案拦截（403 语义）。

**为什么不是异步 provider 接口**：能力目录在本机是同步可读的目录结构，引入 Promise 只会在唤醒路径上多一层 await 且无收益；将来接第二个 agent 运行时，把 `catalog` 的来源换掉即可，注册表契约不变。

## 3.2 行为档案（behavior）

已有：`config/behaviors/<id>.yml`（`version / kind / label / description / config`），`kind: v1 | v2`，由 `src/behaviors/index.mjs` 读写。**本轮把它接口化**：

```js
// src/behaviors/kinds/v1.mjs / v2.mjs —— 每个 kind 一个实现
export const kind = 'v2';
export const label = '二代仿真';
export const platform = 'qq';
export const fields = [...];        // 控制台字段描述（现在散在 pages/presets/behavior-form.js）
export function defaults() {}
export function normalize(config) {}
export function describe(config) {}  // 表格里的一行摘要
export function render(ctx) {}       // 提示词片段：参与度 / 唤醒 / 等待节奏
```

注册表（`src/behaviors/index.mjs` 改造）负责：`listKinds(platform)`、`getKind(kind)`、`list/read/write/remove/duplicate`、`validate`。桥接拼提示词时调 `kind.render(ctx)`，不再在 `src/bridge.js` 里按 v1/v2 写 if 分支；另一个平台要接仿真，只需再实现一个 kind，不改内核。

配套约定：

- 行为档案 YAML 加可选顶层 `platform`（缺省 `qq`），与 kind 声明的平台一致才能加载。
- **退役"预设 → 行为"绑定**（`preset.yml > behavior`、`assertPresetBehaviorBindings`、`cfg.presetBehaviors`）：行为改由方案决定，绑定关系只保留一版用于迁移。
- 方案删除/改名行为档案时校验引用（见 §8.2）。

### 3.3 人格（persona）

已有：角色卡 + `state/roles.json` / `role-content.json`。**不进方案**。

- 全局默认：`config.defaults.persona`（现 `config.role.default`）。
- 会话覆盖：会话档案里的 `persona`（已有）。
- 注入上限 `maxInjectChars` 暂留原处，待注入块重构时并入块级设置。

### 3.4 模型（model）

已有：provider / model / reasoningEffort / vision。**不进方案**。

- 全局默认：DSH 全局设置。
- 会话覆盖：会话档案里的 `model`（已有）。
- 方案切换不影响模型——换方案不换脑子。

### 3.5 平台适配器（platform）

会话 key 已经是 `<platform>:<group|private>:<id>`（`src/session/key.mjs`，P8 已做）。适配器契约（先只实现 QQ）：

```js
{ id, displayName, sessionKinds, capabilities, send, fetchMembers, fetchHistory, resolveDisplayName }
```

方案不写平台；绑定按平台分开；行为档案声明平台；能力预设可声明适用平台。

### 3.6 准入（access）

已有：`state/defaults` 两轴 + 每会话规则，`resolveAccess()`。**不改**，方案不复制它。

### 3.7 工具目录（tool catalog）

现有的「全局配置 → 拓展功能 → QQ 工具」是 44 个全局布尔（`public/console/pages/config/tools-section.js`），决定 `src/mcp-snowluma-safe.js` **注册哪些工具**（模块加载时 `if (cfg.tools?.X !== false) register(...)`，所以改动要重启 DSH 才刷新工具清单）。它同时被别的子系统当开关用：`voice.enabled`、`socialV2.sticker.enabled`、`crossGroup.enabled`。

它和"方案能用哪些工具"是**两个层**，现在却被混在一起：全局布尔管"存在不存在"，DSH 预设的 `extensions.yml` 管"这个预设允许哪些"。本轮把它显式拆成两层，一处解析：

| 层 | 位置 | 决定 | 生效时机 |
| --- | --- | --- | --- |
| **工具目录** | `config.tools`（保留这张卡，改名「工具目录」） | 平台实现了哪些工具、哪些随依赖关闭（语音/表情/跨群） | 重启 DSH |
| **能力授权** | 能力预设的 `grants.disable` / `grants.allow` | 这个方案在目录之上还能用哪些 | 即时（桥接调用时拦截） |

- 桥接在工具调用入口统一校验 `plan → capability → grants`，deny 直接拒绝并回一条简短说明；不改 DSH 工具清单即可按会话收窄。
- DSH 预设的 `extensions.yml` 继续负责"模型看到哪些工具"（提示词层面的收敛），但不再是唯一真相；控制台在能力预设页同时展示"目录 ∩ 授权"的最终清单。
- 工具目录卡加依赖提示：`crossGroup` 需 `crossGroup.enabled`、`sendVoice` 需 `voice.enabled`、表情类需 `socialV2.sticker.enabled`，并在卡上写明"改动影响所有方案，需重启 DSH"。
- 这层不进方案的三个字段：方案引用能力预设，能力预设引用工具目录的键；目录是部署事实，不是策略。

---

## 4. 运行方案

```jsonc
{
  "id": "social-v2",
  "name": "二代仿真",
  "tools": "qq-chat-v2",   // 能力预设 id；null = 无工具
  "behavior": "social-v2", // "inherit"（跟随全局默认）| "none"（不使用）| 行为档案 id
  "audience": "access",    // owner | access
  "builtin": true,
  "note": ""
}
```

三个字段，每个都是"引用 / 空 / 继承"三种状态之一，没有隐藏默认值。

`audience` 只做一件事：带工具的方案默认只对 owner 私聊生效（`owner`）；要放开就把现有准入系统当闸门（`access`）。"Agent 进群"不需要新机制——方案设 `access`，再把群放进准入白名单。

### 4.1 内置六条（数据）

设全局默认行为 = `social-v2` 时：

| id | 名称 | tools | behavior | audience |
| --- | --- | --- | --- | --- |
| `chat` | 聊天 | `qq-chat` | `none` | access |
| `social-v1` | 一代仿真 | `qq-chat` | `social-v1` | access |
| `social-v2` | 二代仿真 | `qq-chat-v2` | `social-v2` | access |
| `agent-readonly` | Agent · 只读 | `qq-agent-readonly` | `none` | owner |
| `agent-workspace` | Agent · 工作区 | `qq-agent-workspace` | `none` | owner |
| `agent-full` | Agent · 全权 | `qq-agent-full` | `none` | owner |

内置方案显式写 `behavior`，不吃全局默认——否则用户改一次默认行为，聊天和 Agent 会一起变成仿真腔，这就是"隐含耦合"。

### 4.2 极端组合长什么样

"带 Saren 人格、全权限的 Agent 进群，还会主动说话"：

```jsonc
// 方案
{ "id": "agent-full-group", "name": "全权 Agent · 群聊",
  "tools": "qq-agent-full", "behavior": "social-v2", "audience": "access" }

// 会话上再挂人格
{ "key": "qq:group:903621673", "planId": "agent-full-group", "persona": { "mode": "fixed", "name": "soulkit:saren" } }
```

不需要"高级模式"开关。三处现在会挡住它的硬编码在 P4 拆：

| 硬编码 | 位置 | 处理 |
| --- | --- | --- |
| `closed-agent` 只允许 owner 私聊 | `src/session/mode.mjs` `resolveEffectiveMode` | 改为 `audience` 判定 |
| `closed-agent` 不注入行为 | `src/bridge.js` `behaviorFor` | 去掉，行为由方案决定 |
| 行为 kind 必须与模式匹配 | 同上 | 改为行为档案自洽校验 |

---

## 5. 解析与生效

```js
resolvePlan({ plans, activeByPlatform, sessionPlanId, platform }) → {
  plan, tools, behavior, audience, legacyMode
}
```

| 值 | 会话覆盖 | 方案 | 全局默认 |
| --- | --- | --- | --- |
| 方案 | `session.planId` | — | `state.runtime.active[platform]` |
| 工具 | — | `plan.tools` | 无 |
| 行为 | `session.behavior`（预留） | `plan.behavior`（可 inherit） | `config.defaults.behavior` |
| 受众 | — | `plan.audience` | 准入系统 |
| 人格 | `session.persona` | — | `config.defaults.persona` |
| 模型 | `session.model` | — | DSH 全局设置 |

`legacyMode` 由 `(tools, behavior)` 推导，只供旧调用点与审计展示：

```
tools                    → 'agent'
behavior.kind = v1       → 'reserved'
behavior.kind = v2       → 'reserved2'
其它                     → 'chat'
```

UI 上不再让用户选"模式"；方案卡显示这一行推导结果（"当前表现：二代仿真"）。

---

## 6. 风险：显示、确认、留痕

不设等级，不做白名单。风险由方案**实际会打开的东西**描述：

```
即将启用：全权 Agent · 群聊
  工具    qq-agent-full（沙箱：完全访问，无审批）
  行为    二代仿真（主动发言、自动回复）
  受众    准入白名单（当前 3 个群、2 个私聊）
```

确认规则只有三条：

1. 切到**含工具**的方案：owner 确认码（沿用 `mode-control` 流程）。
2. 沙箱是 `danger-full-access` 或目录里查不到的名字：额外一次显式确认（输入"我了解风险"）。
3. 降级（新方案不含工具或工具更弱）与紧急关闭：免确认。

审计 `state/admin/audit.jsonl`，事件 `runtime.plan.switch`，记 `{from, to, resolved:{preset, sandbox, behavior, audience}}`。

保留：高权限闲置回落、重启不继承、漂移检测（比较对象从级别换成沙箱名）、紧急关闭。

---

## 7. 现有对象并入

| 现有 | 并入方式 |
| --- | --- |
| 4 个模式 | 6 条内置方案（枚举删除，名字保留） |
| L1/L2/L3 | 能力预设的 `sandbox` 字段（级别删除） |
| `config.agentPreset` / `socialV2.agentPreset` / `closedAgentPreset` | 能力预设的 `preset` 字段 |
| 5 个 DSH 预设 | 注册成能力预设，补 `sandbox` |
| 2 个仿真行为 | 保留为行为档案，接口化为两个 kind 实现 |
| `preset.yml > behavior` 绑定 | 迁移进内置方案的 `behavior`，随后退役 |
| `config.behavior.default` | `config.defaults.behavior`（人格与行为卡） |
| `config.role.default` | `config.defaults.persona`（人格与行为卡） |
| 会话 `mode` + `presetId` | `session.planId` |
| 会话人格 / 模型 / 唤醒 | 保留为覆盖项 |
| 准入 | 不动，`audience: access` 复用它 |
| `config.tools` 44 个布尔 | 保留为「工具目录」（平台层，§3.7）；方案级收窄进能力预设的 `grants` |
| DSH 预设 `extensions.yml` 的工具授权 | 保留管"模型看到哪些"；能力预设的 `grants` 管"实际能不能用" |

---

## 8. 控制台改造

### 8.1 导航与页面

```
管理      运行总览 → 会话与审批 → 运行方案 → 全局配置 → 调试与运维
聊天行为  行为档案 → 能力预设 → 人格与角色 → 记忆 → 黑话词库 → 定时任务
扩展      插件 → 技能 → MCP → 命令与工具
```

| 页面 | 变化 |
| --- | --- |
| 运行总览 | 模式徽标 → 当前方案名 + 解析摘要 |
| 会话与审批 | "模式 + DSH 预设"两个下拉 → 一个"运行方案"；人格/模型/唤醒保留为覆盖项 |
| **运行方案**（新） | 列表 + 编辑器 + 启用 + 克隆/导入导出；放"会话与审批"后 |
| 全局配置 | 删"运行模式"卡；保留"人格与行为"卡（默认行为 + 默认人格 + 注入上限）；「拓展功能 → QQ 工具」改名「工具目录」并加依赖提示（§3.7） |
| 行为档案 | 加表格 + 编辑区；新建/复制/删除 |
| 能力预设（原"DSH 预设"） | 改名；加沙箱列；放"行为档案"后 |
| 命令与工具（原"管理行为"） | 只改名 |
| 调试与运维 / 记忆 / 黑话 / 定时 / 插件 / 技能 / MCP | 不动 |

净变化：新增 1 页、改名 2 页、移动 1 页、删 1 张卡；导航净增 0。

### 8.2 行为档案页

表格（复用 `components/table/table.js` 的 `dataTableHtml` / `initDataTables`）：

| 档案 | 类型 | 平台 | 被引用 | 说明 | 操作 |
| --- | --- | --- | --- | --- | --- |
| 一代仿真 `social-v1` | v1 | qq | 1 个方案 | … | 编辑 / 复制 / 删除 |
| 二代仿真 `social-v2` | v2 | qq | 2 个方案 | … | 编辑 / 复制 / 删除 |

- 点"编辑"展开下方编辑区（复用现有 `behavior-form.js` 的字段渲染，改为由 kind 的 `fields` 驱动），保存写回 `config/behaviors/<id>.yml`。
- "新建"选 kind（未来按平台过滤），生成默认配置。
- 删除前校验引用：被方案或能力预设引用时拒绝，并列出引用方。

### 8.3 运行方案页

- 左列：方案列表（内置置顶、自定义在下），一行摘要。
- 右列：`名称 / 工具 / 行为 / 受众 / 说明` + 解析预览 + 保存。
- 顶部：当前方案 + 「启用」。
- 操作：新建、克隆、删除（被会话引用时提示回落到当前全局方案）、导出/导入 JSON。

### 8.4 全局配置的"人格与行为"卡

```
默认行为档案  [ 跟随全局默认（二代仿真） | 不使用 | 一代仿真 | 二代仿真 ]
默认人格      [ 小鲸鱼 ▾ ]
注入上限      [ 6000 ] 字符
```

- 这张卡不删，只把"默认行为"并进来；"运行模式"卡删掉。
- 所有默认值统一落 `config.defaults`（见 §10），不在行为档案页另设入口。

---

## 9. 多平台演进

| 层 | 现状 | 目标 |
| --- | --- | --- |
| 会话 key | 已带平台前缀 | 不动 |
| 准入 | 按 key | 不动 |
| 方案 | 平台无关 | 不动 |
| 绑定 | 单平台 | `state.runtime.active[platform]` |
| 行为 | QQ 专用 if 分支 | kind 接口 + `platform` 字段 |
| 工具 | DSH 预设 | 预设可声明适用平台 |
| 发送/成员/媒体 | 直接调 SnowLuma | 平台适配器接口 |

接第二个平台 = 加适配器 + 一套行为 kind；方案和页面不动。

---

## 10. 配置与状态归一

```jsonc
// config.json（新增/改名的部分）
{
  "defaults": {
    "behavior": "social-v2",     // 原 config.behavior.default；"none" 表示默认不使用
    "persona": "soulkit:saren"   // 原 config.role.default
  },
  "runtime": {
    "plans": [ /* 自定义方案；内置在代码里，只读 */ ],
    "fallbackPlan": "chat",
    "idleMinutes": 15,
    "resetOnRestart": true
  }
}
```

```jsonc
// state/runtime.json（运行时指针，切换时写）
{ "version": 1, "active": { "qq": "social-v2" } }
```

- 方案定义进 `config.json`（可编辑、可导出、随配置备份）；当前激活方案进 `state`（运行时状态，不进备份）。
- 迁移后删 `config.agentPreset`、`config.socialV2.agentPreset`、`config.behavior.default`、`config.role.default`、`state/mode.json` 的读写路径（保留一版只读）。

---

## 11. 迁移

`node scripts/migrate-runtime-plans.mjs --dry-run` 先出表：

| 旧 | 新 |
| --- | --- |
| `mode=chat` | 全局方案 `chat` |
| `mode=reserved` | `social-v1` |
| `mode=reserved2` | `social-v2` |
| `mode=closed-agent` + `level=L*` | `agent-readonly/workspace/full` |
| `closedAgentPreset` 非空 | 生成一条自定义能力预设（同沙箱、换 preset），当前方案引用它 |
| 会话 `mode` + `presetId` | `session.planId`（组合不在内置里时自动生成方案） |
| `preset.yml > behavior` | 写进对应内置方案的 `behavior` |
| `config.behavior.default` / `role.default` | `config.defaults.behavior` / `.persona` |

备份 `state/mode.json` 与会话目录快照；旧字段保留一版只读；幂等（已有 `state/runtime.json` 跳过）。

---

## 12. 代码改造面

| 文件 | 改动 |
| --- | --- |
| `src/runtime/plans.mjs`（新） | 方案 schema、引用校验、`resolvePlan`、`legacyMode` 推导 |
| `src/runtime/capabilities.mjs`（新） | 能力预设 provider 注册表；`dsh` 实现组合 preset-store + 权限目录 + `config/capabilities.json` |
| `config/capabilities.json`（新） | 能力的 `sandbox` / `grants` / 平台声明（不写进 DSH 的 `preset.yml`） |
| `src/admin/mode-control.js` | 换 plan-control：确认码/TOTP/审计/回落保留，判断对象换方案 |
| `src/session/mode.mjs` | `resolveEffectiveMode` → `resolveEffectivePlan`，旧函数留投影 |
| `src/behaviors/`（改） | kind 注册表 + `kinds/v1.mjs`、`kinds/v2.mjs`；`render(ctx)` 承接提示词片段 |
| `src/bridge.js` | `effectiveMode()` 保留投影（55 处调用点先不动）；`modePreset`/`behaviorFor` 读方案；拆三处硬编码 |
| `src/mcp-snowluma-safe.js` | 工具调用入口加 `plan → capability → grants` 统一校验（deny 即时拒绝，不改工具清单） |
| `public/console/pages/config/tools-section.js` | 改名「工具目录」、加依赖提示与"影响所有方案"说明 |
| `src/platform/*`（新） | 适配器接口 + QQ 适配器（包住现有 SnowLuma 调用） |
| API | `GET/POST /api/runtime/plan(s)`、导出/导入；`/api/runtime/capabilities`；`/api/config/behaviors` 返回 kind 元信息 |
| 控制台 | 运行方案页；行为档案表格；能力预设页（沙箱 + 收窄）；config 删模式卡、工具目录改名；sessions 合并；导航调整 |
| 脚本 | 迁移脚本（干跑 + 备份 + 幂等） |

**降压**：`effectiveMode()` 继续返回四个旧字符串，17k 行里的 55 处判断原样工作；新逻辑走 `resolvePlan()`，后续再逐步内化。

---

## 13. 分步

| 步骤 | 内容 | 行为变化 |
| --- | --- | --- |
| P1 | 方案/能力预设数据层 + 解析 + 单测（不接线） | 无 |
| P2 | 迁移 + `state/runtime.json` + 切换 API + 确认/审计 | 无（等价映射） |
| P3 | 控制台：运行方案页、config 卡替换、sessions 合并、导航 | 无 |
| P4 | 拆三处硬编码（agent 进群、agent 带行为、kind 解耦） | **有**（能力放开） |
| P5 | 行为档案接口化 + 表格页 + 新建/复制/删除 | 无 |
| P6 | 能力预设 provider + 页面（沙箱列、`grants` 收窄、改名、从 DSH 导入） | 无 |
| P7 | 工具目录卡改名与依赖提示 + 调用入口的 `grants` 校验 | 无（默认全开时等价） |
| P8 | 平台适配器接口（只抽 QQ） | 无 |

P4 单独一轮，是唯一改变安全边界的步骤，必须可回滚。

---

## 14. 不做的事

- 不做方案继承（只复制，不链式覆盖）。
- 不做"高级模式"开关或隐藏入口——所有组合都是同一种数据。
- 不把人格、模型、唤醒塞进方案。
- 不把准入规则复制进方案。
- 不为极端组合写特判。
- 不在这轮接第二个平台（只留接口）。
- 不重写工具注册机制：工具目录仍然决定"是否存在"，改动仍需重启 DSH；`grants` 只做收窄。

---

## 15. 待拍板

1. 方案定义放 `config.json`、激活指针放 `state/runtime.json`——可以吗？（备选：定义也进 state，便于整包导出。）
2. `behavior` 的三态 `inherit / none / <id>` 是否可接受？（备选：改成"空=不使用、不提供 inherit"，全局默认只作用于没有方案的会话。）
3. 行为档案删除的策略：拒绝（推荐）还是改绑到默认行为？
