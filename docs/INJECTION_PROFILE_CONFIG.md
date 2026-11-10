# 注入块、运行档案与配置归一（设计稿 v2）

- 状态：草案，**未动工**。等你确认模型细节后按第 8 节顺序执行。
- 适用版本：`qq-bridge-nexus`（开发阶段，按“无历史包袱、不做兼容层”讨论）。
- 本版相对 v1 的变化：注入块独立成页（「聊天行为 › 注入块」）；补全块模型（slot / timing / scope / settings / phase）；把运行相关对象拆成 7 个有明确职责的对象并给出页面归属、现状对比、合并/移除清单；补全局配置统一保存的修复方案。

---

## 0. 结论速览

1. **注入块**：升级为独立的「聊天行为 › 注入块」页，支持排序、启停、上限、作用域、按会话预览；块的“内部策略”由块自己声明 settings，值存 `config.promptBlocks[id].settings`。现在只有 3 个块真正走注册表，其余 5 处（人格、黑话、在场人物、唤醒骨架、插件前后缀）全部迁入。
2. **运行对象**：现在把 5 个轴（协议 / 行为 / 预设 / 权限 / 准入）折进一个 `mode` 枚举，另有 2 个全局下拉，所以“重叠”。目标拆成独立对象，各自有源页面；新增「运行档案」把对象组合起来；`mode` 概念删除。
3. **页面**：新增「注入块」（聊天行为第一项）、「运行档案」（管理）；预设页、行为档案页、准入页、会话详情保留并各自收敛职责；删除运行模式卡、全局预设/级别下拉、插件页的注入块卡、模式卡上的紧急关闭。
4. **保存栏**：全局配置改为“一页一保存栏、按 dirty 卡片出现、内容流内 sticky、保存/丢弃都重置基线”。
5. **配置**：4 处迁出（`mode.json`、`scheduler.settings`、`plugins.json`、`silence-schedule.json`），2 类会话级设置归位（`current-role.json` 的 `byKey`、手动静默），3 个残留清理。
6. **开发者导向**：不写死“Agent 不能进群”；默认档案不提供极端组合，自定义档案可组合，运行时做能力校验 + 风险提示。

---

## 1. 对象总表

| # | 对象 | 一句话职责 | 谁配置 | 页面 | 生效 |
| --- | --- | --- | --- | --- | --- |
| 1 | 注入块 | 唤醒提示词里的一段文字 | 内核 / 插件 | 聊天行为 › 注入块（新） | 下一次投递 |
| 2 | 协议 | 消息怎么走（对话 / v1 / v2 / agent） | 内核（只读属性） | 运行档案编辑器里展示 | 下次唤醒 |
| 3 | 行为档案 | 仿真话术与节奏参数（YAML） | 用户 | 聊天行为 › 行为档案（现有） | 下次唤醒 |
| 4 | DSH 预设 | DSH 侧的工具、系统提示词、基线权限 | 用户 | 预设（现有） | 新建/重建会话 |
| 5 | 权限级别 | Agent 协议的权限范围（L1/L2/L3） | 用户 | 运行档案 › Agent 档案内 | 下次唤醒 |
| 6 | 准入 | 哪些会话允许被服务（白名单/黑名单、被动/主动） | 用户 | 全局配置 › 准入（现有） | 下一条消息 |
| 7 | 运行档案 | 把 2–5 组合成一个命名档案 | 用户 | 管理 › 运行档案（新） | 新会话；已有会话需“应用” |
| 8 | 会话设置 | 单个会话的覆盖（档案、人格、模型、唤醒） | 用户 | 会话与审批 › 详情（现有） | 下次唤醒 |

> 命名去重：现在的 `state.profiles`（会话级覆盖）改叫**会话设置**（`sessionOverrides`）；新的“运行档案”专指运行组合，避免两个 profile 打架。

---

## 2. 注入块系统

### 2.1 现状

- 统一注册表已有：`src/plugins/prompt-blocks.mjs`（`id/owner/priority/maxChars/enabled/render`，按优先级拼接、按块限额、超总预算整块跳过，覆盖值来自 `config.promptBlocks`）。
- 真正走注册表的只有 3 个 core 块：表情包、技能、记忆。
- 没归一：人格卡、黑话表、在场人物、唤醒骨架、插件 `promptAdditions`（旧接口，仓库内无使用方）。
- 真实投递顺序（你贴的那段）：时间 → 角色 → 身份 → 令牌 → 反 AI → 积极性 → 技能 → 表情包 → 首回复节奏 → 此刻状态 → 当前唤醒 → 参与度 → 沉睡前等待 → 行动前 → 引用规则 → 快照。
- 其中“表情包”已经用了“和上次一样就只发一行”的策略——这是好模式，应泛化。

### 2.2 块模型

```js
{
  id: 'core-persona',
  owner: 'core',                 // core | 插件 id
  title: '人格卡',
  description: '当前会话的人格提示词',
  slot: 'persona',               // head | persona | behavior | resources | situation | action | tail
  priority: 10,                  // 同一 slot 内排序
  timing: 'on-change',           // every-wake | first | on-change | reason:<name>
  scopes: ['global', 'runtime', 'session'],   // 允许在哪一级覆盖
  maxChars: 6000,
  locked: false,                 // 身份/令牌类为 true，只读不可关
  settings: [ /* 字段规格，注入页用 renderFields 渲染 */ ],
  render(ctx, { phase }) {}      // phase: 'full' | 'brief' | 'unchanged'
}
```

- 覆盖：`config.promptBlocks[id] = { enabled, maxChars, priority, scope, settings }`。
- 总预算：`config.limits.promptAppendChars`（从 `plugins.json` 迁入）。
- 投递记账：`state/prompt-blocks.json` 只记录“这次投递了哪些块、各多少字、指纹”，不存配置。
- 插件 manifest 只能声明 `owner/slot/timing/scopes/settings`，内核校验（非法 slot/scope 拒绝注册并记日志）。

### 2.3 内置块清单与内部配置

| 块 | slot / 优先级 | timing | 内部配置（settings） |
| --- | --- | --- | --- |
| `core-wake-identity` | head / 0 | every-wake | 无（locked） |
| `core-wake-token` | head / 1 | every-wake | 无（locked，仅 agent/v2 出现） |
| `core-now` | head / 2 | every-wake | 时区格式、是否带日期 |
| `core-persona` | persona / 10 | on-change | 全文/一行的文案模板、`briefLine`、上限 |
| `core-anti-ai` | behavior / 20 | every-wake | 开关、措辞档位 |
| `core-proactivity` | behavior / 21 | every-wake | 开关、档位 |
| `core-reply-rhythm` | behavior / 22 | every-wake | 默认 `quietMs`、是否强制短静默 |
| `core-skills` | resources / 100 | on-change | 条数、描述截断长度 |
| `core-stickers` | resources / 110 | on-change | 条数、策略（总是/变化才提） |
| `core-slang` | resources / 120 | on-change | 提示条数、是否附候选 |
| `core-people` | resources / 130 | every-wake | 最多人数、字段 |
| `core-memory` | resources / 140 | every-wake | provider、上限（已有） |
| `core-state` | situation / 200 | every-wake | 统计窗口、是否显示未读 |
| `core-wake-info` | situation / 210 | every-wake | 是否显示原因/触发条件 |
| `core-participation` | situation / 220 | every-wake | 两个统计窗口（1h / 5m） |
| `core-pre-sleep` | situation / 230 | every-wake | 观察窗口时长（默认 300000）、是否强制 |
| `core-action` | action / 300 | every-wake | 行动前检查项（可编辑列表） |
| `core-quote-rule` | action / 310 | every-wake | 开关 |
| `core-snapshot` | tail / 900 | every-wake | 最多条数、是否带 recent、格式（JSON/文本） |
| `core-unread-hint` | tail / 910 | every-wake | 是否提示 `readThroughSeq` 用法 |

> 表里是迁移后的目标形态；`head` 里的身份/令牌可拆可合，但都 `locked`。现在整段“唤醒骨架”拆成 `core-now / core-wake-identity / core-wake-token / core-state / core-wake-info / core-participation / core-pre-sleep / core-action / core-quote-rule / core-snapshot / core-unread-hint`。

### 2.4 slot / timing / scope / phase

- **slot（位置）**：决定段落先后。`head` → `persona` → `behavior` → `resources` → `situation` → `action` → `tail`。slot 内按 priority 排。
- **timing（时机）**：
  - `every-wake`：每次唤醒都发；
  - `first`：每个会话第一次唤醒发；
  - `on-change`：指纹变化才发全文，否则按 `brief`；
  - `reason:<name>`：只在特定唤醒原因时发（如 `scheduled`）。
- **scope（作用域）**：`global`（默认）/ `runtime`（某个运行档案）/ `session`（某会话）。覆盖就近原则：session > runtime > global。
- **phase（阶段）**：块可以只实现 `full`，也可以实现 `brief`（一行）与 `unchanged`（空）。人格、技能、在场人物、表情包都走这套。

### 2.5 页面：聊天行为 › 注入块

放在侧栏「聊天行为」分组**第一项**。

```
注入块
┌ 预算条：已用 3.2k / 总 200k ｜ 预览 ｜ 恢复默认 ┐
├ 左：块列表（按 slot 分组，可拖拽排序）
│   每行：拖柄 · 标题 · owner pill · 时机 · 当前字数 · 开关
├ 右：块详情
│   ├ 运行设置：启用 / 上限 / 作用域 / 时机 / 排序
│   ├ 实现设置：由块 settings 生成（renderFields）
│   └ 最近投递：命中/裁剪/跳过、平均字数、最近指纹
└ 预览抽屉：选会话 + 唤醒原因 → 拼装结果（分块高亮、字数、可临时关某块）
```

- 预览调用 `POST /api/prompt-preview {key, reason}`，返回 `{blocks:[{id,title,text,chars,phase,skipped}], total}`；不写 state、不调模型。
- 插件页的插件详情里显示「贡献 N 个块」+「去注入块查看」，跳转带 `?owner=<plugin>`。
- 顶部预算条同时显示“总预算”和“本次投递已用”。

### 2.6 与插件的关系

- 插件在 manifest 里声明块元数据；内核注册时校验并登记 `owner`。
- 插件页只读展示；编辑统一在注入块页。
- 插件被停用/卸载时，其块自动下线（注册表已有 `unregisterPlugin`）。

### 2.7 迁移

- 先扩展注册表（新增字段，旧块不填也能跑）；再把 5 处非标注入改成块；最后删旧拼装函数与 `promptAdditions`。
- 迁移期间用“预览”对比新旧拼装结果，逐块对齐文案。

---

## 3. 运行相关对象：完整模型

### 3.1 现状对比

| 对象 | 现在怎么配 | 现在存哪 | 问题 |
| --- | --- | --- | --- |
| 模式 | 运行模式卡（4 张写死的卡） | `state/mode.json` | 点击立即影响所有未覆盖会话；把 5 个轴塞进一个枚举 |
| DSH 预设 | ① 全局下拉（运行模式卡）② 预设页（CRUD）③ 会话详情 | `config.agentPreset` + `profiles[key].presetId` | 三个入口，语义不同：全局下拉改的是“新会话默认”，预设页改的是“预设本体” |
| 权限级别 | 运行模式卡下拉 | `state/mode.json > level` | 只对 agent 有意义，却作为全局项出现 |
| 行为档案 | 行为档案页 + 全局配置「默认行为档案」 | `config/behaviors/*.yml` + `config.behavior.default` | 两个来源；v1/v2 各一份，但全局默认只有一项 |
| 准入 | 全局配置 › 准入 + 会话详情 | `config.security/continuity` + 会话覆盖 | 与模式隐含的“agent 仅管理员私聊”重复 |
| 会话覆盖 | 会话详情 | `sessions.json > profiles` | 与“运行档案”同名冲突（本设计改叫会话设置） |

**结论**：不是“多了一个权限级别”，而是 5 个不同维度的对象被折进了同一个枚举，另外 2 个维度又有各自页面。用户看到的“重叠”来自这里。

### 3.2 目标模型

```
协议 protocol（代码能力，不可编辑）
  ├ chat        普通对话
  ├ social-v1   一代仿真
  ├ social-v2   二代仿真
  └ agent       Agent 工具循环

行为档案 behavior（用户可建，YAML）
  └ social-v1.yml / social-v2.yml / 自定义

DSH 预设 preset（用户可建，DSH 侧）
  └ qq-chat / qq-chat-v2 / qq-agent-* / 自定义

权限级别 permission（仅 agent）
  └ read-only(L1) / workspace(L2) / full(L3)

准入 access（会话级策略）
  └ 白名单/黑名单 + 被动/主动/管理命令

运行档案 runtime profile
  = protocol + behavior + preset + permission
  （不含 access，准入是独立策略）

会话设置 session override
  = runtime profileId + persona + model + preset 覆盖 + 唤醒配置
```

### 3.3 职责边界（回答“权限级别属于哪类”）

| 问题 | 答案 |
| --- | --- |
| 模式 = 预设 + 级别？ | 接近，但还包含**协议**；且预设/级别只在各自协议下有意义。 |
| 权限级别属于哪类？ | 属于 **agent 协议的权限轴**，不是全局维度；它和预设一起决定“能做什么”，但预设决定“有哪些工具/提示词”，级别决定“文件与命令的访问范围”。 |
| 为什么现在觉得乱？ | 因为协议、行为、预设、级别被一个枚举藏起来，而预设、行为又有各自页面；准入还被模式隐含了一份。 |
| 统一标准 | 每个轴一个对象、一个源页面；运行档案只做组合；准入独立。 |

### 3.4 页面与存放位置

| 对象 | 页面 | 位置 | 说明 |
| --- | --- | --- | --- |
| 注入块 | 注入块（新） | 聊天行为 · 第一项 | 见第 2 节 |
| 行为档案 | 行为档案（现有） | 聊天行为 | 只对 social-v1/v2 生效，页面顶部注明 |
| 预设 | 预设（现有） | 管理 | 预设本体 + 扩展授权；不再承担“全局默认” |
| 运行档案 | 运行档案（新） | 管理 | 档案列表 + 编辑器 + 「应用到现有会话」 |
| 权限级别 | 运行档案 › Agent 档案 | 档案编辑器内 | 不做全局页 |
| 准入 | 准入（现有） | 全局配置 | 白名单/黑名单 + 轴开关；与档案解耦 |
| 默认档案 | 运行与模型 | 全局配置 | 一个下拉 + 说明；不再是 4 张卡 |
| 会话设置 | 会话详情（现有） | 会话与审批 | 档案、人格、模型、唤醒 |
| 紧急关闭 | 桥接控制 | 调试与运维 | 从运行模式卡移走 |

### 3.5 合并 / 移除 / 新建清单

| 处置 | 对象 | 说明 |
| --- | --- | --- |
| 删除 | 运行模式卡（4 张卡） | 由「默认档案」下拉 + 运行档案页替代 |
| 删除 | 全局「DSH 预设」下拉 | 预设只属于档案；预设页仍是本体 |
| 删除 | 全局「权限级别」下拉 | 级别只属于 Agent 档案 |
| 删除 | `state/mode.json` | 迁移到 `config.runtimeProfiles` + `config.defaultProfile` |
| 删除 | `config.agentPreset` | 迁移到档案 |
| 删除 | `config.behavior.default` | 行为由档案指定 |
| 删除 | `config.role.maxInjectChars` | 改 `promptBlocks['core-persona'].maxChars` |
| 删除 | 插件页「注入块」卡 | 迁到注入块页 |
| 删除 | 模式卡上的紧急关闭 | 迁到桥接控制 |
| 合并 | `state.current-role.json` | `byKey` → 会话设置；`silent` → 静默；全局 `role` 删 |
| 合并 | `plugins.json` | 并入 `config.plugins` |
| 合并 | `state/scheduler.json > settings` | 并入 `config.scheduler` |
| 合并 | `state/silence-schedule.json` | 并入 `config.silence` |
| 新建 | 注入块页 | 聊天行为第一项 |
| 新建 | 运行档案页 | 管理 |
| 保留 | 预设页 / 行为档案页 / 准入页 / 会话详情 | 各自收敛职责 |

### 3.6 生效语义

| 改动 | 对已有会话 | 对新会话 |
| --- | --- | --- |
| 注入块配置 | 下一次投递 | 下一次投递 |
| 运行档案本体（改预设/权限） | 不自动生效；点「应用到现有会话」后，下次唤醒重建 | 生效 |
| 默认档案 | 不自动生效（避免“莫名切换”） | 生效 |
| 会话设置 | 下次唤醒 | — |
| 预设本体 | 下次重建 | 下次创建 |
| 行为档案 | 下次唤醒 | 下次唤醒 |
| 准入 | 下一条消息 | — |

“应用到现有会话”是一个按钮 + 二次确认，可选“跳过管理员私聊”。

### 3.7 自定义与极端组合

- 内置档案：聊天 / 一代仿真 / 二代仿真 / Agent L1 / Agent L2 / Agent L3。
- 自定义档案：复制内置档案后改 protocol/preset/behavior/permission；协议与权限映射可改，但需要**能力校验**：
  - `agent + 群聊`：允许创建，卡片标「未验证组合」；要求确认；运行时仍要求 @ 触发、发送限速、工具白名单；
  - `agent + L3 + 群聊`：同上，额外标「高权限」；
  - `social-v2 + 无工具预设`：提示“仿真协议依赖工具，可能无法运行”，不阻止。
- **默认不提供**极端档案，但不写死禁止；风险提示 + 能力检查，而不是拒绝加载。
- 权限级别与准入解耦：`agent + L3 + 群聊` 是合法组合，由用户显式创建。

### 3.8 数据模型

```jsonc
// config.json
{
  "runtimeProfiles": [
    {
      "id": "social-v2",
      "label": "二代仿真",
      "protocol": "social-v2",
      "behavior": "social-v2",
      "preset": "qq-chat-v2",
      "permission": null,
      "builtin": true,
      "risk": "verified"
    },
    {
      "id": "agent-l3",
      "label": "Agent · L3",
      "protocol": "agent",
      "behavior": null,
      "preset": "qq-agent-full",
      "permission": "full",
      "builtin": true,
      "risk": "verified"
    }
  ],
  "defaultProfile": "social-v2"
}
```

```jsonc
// sessions.json
{
  "sessions": { "qq:group:123": "session-…" },
  "sessionOverrides": {
    "qq:group:123": {
      "profileId": "social-v1",
      "persona": "星苒-内部",
      "model": { "provider": "…", "model": "…" },
      "preset": null
    }
  }
}
```

迁移：读 `mode.json` + `agentPreset` + `sessions.json.profiles`，生成 6 个内置档案与 `defaultProfile`；`profiles[key].mode/presetId` 映射成 `sessionOverrides[key].profileId`；备份后删除旧文件与旧键。

---

## 4. 全局配置统一保存

现状问题：保存栏跨页面显示、浮动占底部空间、丢弃后 dirty 不消失。

根因与修法：

| 问题 | 根因 | 修法 |
| --- | --- | --- |
| 跨页面显示 | 保存栏是 body 上的单例，路由切换不销毁 | 保存栏挂到页面容器，离开路由时销毁；只在当前 tab 有 dirty 卡片时渲染 |
| 占底部空间 | `position: fixed` 但内容区没预留高度 | 改为内容流内 `sticky bottom`，并给 `main` 加 `padding-bottom`（= 栏高） |
| 丢弃后仍显示更改 | discard 只重置表单，没重置基线 | 维护 `baseline` 快照；保存/丢弃都替换基线并重新拉取；进入页面时若与服务端一致自动清 dirty |

配套：`dirty` 按卡片计算（卡片内字段 vs 基线），保存栏显示“N 张卡片有未保存更改”，保存只提交 dirty 卡片。

---

## 5. 配置归一清单

### 5.1 已在 `config.json`（保留）

`dsh.*`、`role.default`、`snowluma.*`、`ownerQQ`、`sessionCwd`、`workspaceTitle`、`ackMessage`、`sendDelayMs`、`questionTimeoutMs`、`consolePort`、`consoleToken`、`security.*`、`continuity.*`、`admin.*`、`crossGroup.*`、`slang.*`、`webSearch.*`、`promptBlocks.*`、`platform.*`、`memory.*`、`admins[]`、`tools.*`、`compact.*`、`voice.*`、`media.*`、`limits.*`、`behavior.default`（将删）。

### 5.2 迁出

| 范围 | 现在 | 目标 |
| --- | --- | --- |
| 运行档案 / 默认档案 | `state/mode.json`、`config.agentPreset` | `config.runtimeProfiles`、`config.defaultProfile` |
| 定时任务设置 | `state/scheduler.json > settings` | `config.scheduler` |
| 插件设置 | `plugins.json` | `config.plugins` |
| 静默时段 | `state/silence-schedule.json` | `config.silence` |
| 注入总预算 | `plugins.json > limits.maxPromptAppendChars` | `config.limits.promptAppendChars` |
| 按会话人格 | `state/current-role.json > byKey` | `sessionOverrides[key].persona` |
| 手动静默 | `state/current-role.json > silent` | `config.silence.manual` |

### 5.3 保留在 `state/`（运行数据）

`sessions.json`（映射 + `sessionOverrides`）、`social-v2.json`、`prompt-blocks.json`（改名 `prompt-block-state.json`）、`role-seen.json`、`persona-cache.json`、`persona-external.json`、`slang.json`、`local-memory.json`、`stickers.json`、`scheduler.json`（tasks/history/counters）、`control-center.json`（独立进程，不并）、日志与统计文件。

### 5.4 资源型文件

`config/behaviors/*.yml`、`dsh/agent-presets/*`、`assets/default-presets/*`、`extensions/mcp/<id>/server.json`、`state/extensions/secrets.json`。

### 5.5 待清理

`current-role.json`、`roles.json`、`role-content.json`、`config.agentPreset`、`config.behavior.default`、`config.role.maxInjectChars`。

---

## 6. 紧急关闭

- 从运行模式卡移除（含说明与“回到安全模式”文案）。
- 移到「调试与运维 › 桥接控制」，与「重启桥接」同组，红色 `danger`，二次确认。
- 端点与行为不变：`POST /api/admin/panic`。
- 运行模式卡**不留**任何说明或链接。

---

## 7. 页面调整汇总

| 页面 | 调整 |
| --- | --- |
| 聊天行为 › 注入块（新） | 第一项；块列表 + 详情 + 预览 |
| 聊天行为 › 行为档案 | 保留；只对仿真协议生效，页面注明 |
| 管理 › 运行档案（新） | 档案 CRUD + 应用到现有会话 |
| 全局配置 › 运行与模型 | 删模式卡、预设下拉、级别下拉、紧急关闭；保留模型设置、默认档案、默认人格 |
| 全局配置 › 拓展功能 | 不再放注入块；保留工具开关/记忆/压缩 |
| 插件 | 「注入块」卡移除，插件详情显示“贡献 N 个块”+ 跳转 |
| 调试与运维 › 桥接控制 | 新增紧急关闭 |
| 会话与审批 › 详情 | 模式/预设合并为“运行档案”下拉；保留人格、模型、唤醒 |

---

## 8. 执行顺序

1. **P0-A 保存栏修复**：一页一栏、内容流 sticky、基线脏判断。独立可先行。
2. **P0-B 注入块系统**
   - 扩展注册表（slot/timing/scopes/settings/phase），总预算迁 `config.limits.promptAppendChars`。
   - 迁移 5 处非标注入；删 `promptAdditions`；人格策略落地。
   - 新页面「注入块」；插件页移除注入块卡。
   - 预览接口 `/api/prompt-preview`。
   - 验收：同会话同原因，迁移前后逐块对比；长人格场景 token 下降。
3. **P1 运行档案**
   - `runtimeProfiles/defaultProfile` + 迁移脚本（备份、删 `mode.json`）。
   - 运行档案页、默认档案下拉、会话详情合并下拉、「应用到现有会话」。
   - 紧急关闭搬家。
4. **P2 配置归一**
   - `scheduler.settings`、`plugins.json`、静默时段、`current-role.json` 迁入/归位。
   - 清理残留；更新 `GLOBAL_CONFIG.md`、`STATUS.md`、踩坑记录。

每步：`test-console-static`、`test-console-ui`、相关单测、全量 `test-audit`、真机截图。

---

## 9. 风险

| 风险 | 对策 |
| --- | --- |
| 注入顺序变化影响模型行为 | 迁移前后各抓一次真实投递逐块比对；块顺序进 golden 测试 |
| 人格“其余轮一行”导致人设漂移 | 首轮/变更全文；`qq_get_prompt` 常驻；日志记录本轮是否全文 |
| 保存栏改造影响现有页面 | 先做保存栏，再动配置页；每页跑 UI 用例 |
| 运行档案迁移丢覆盖 | 迁移脚本备份 + 打印摘要；开发阶段一次性迁移 |
| 极端组合（agent 进群、L3+群）被滥用 | 默认不提供；创建时风险确认；运行时能力校验与限速 |
| 插件块破坏顺序 | slot/priority 校验；预览可见；超预算整块跳过并记日志 |

---

## 10. 待拍板

1. 注入块页放「聊天行为」第一项（已定）；块的 `slot` 命名用「头部 / 人格 / 行为 / 资源 / 现场 / 动作 / 尾部」可以吗？
2. 运行档案页放「管理」分组；全局配置只留「默认档案」下拉——可以吗？
3. 准入保持独立页（不并入档案），档案只管协议/行为/预设/权限——同意吗？
4. 行为档案从 `config.behavior.default` 移入档案（即“默认行为档案”这个概念消失）——同意吗？
5. 保存栏按“每页一个 + 内容流 sticky”改造——可以吗？
6. 极端组合只做风险提示 + 能力校验，不做禁止——确认？
