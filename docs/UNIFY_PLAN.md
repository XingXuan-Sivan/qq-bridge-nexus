# 三线统一改造：复核、契约与执行顺序

> 状态：**待批准**。批准后按第 7 节顺序连续执行，中途不中断。
> 基线：`git tag baseline/pre-unify-2026-11-11`（提交 `726430a`）。严重问题时 `git reset --hard baseline/pre-unify-2026-11-11` 回到动工前。
> 本文是三份文档冲突时的**唯一裁定**；`INJECTION_PROFILE_CONFIG.md` 的 §2 注入块设计、`RUNTIME_PROFILE_MODEL.md` 的 v3 模型仍然有效，冲突处以本文为准。

---

## 1. 复核结论

三条线的对象模型都成立，不需要推翻重来。问题集中在三类，全部可在开工前用文档裁定解决：

1. **两份设计稿互相冲突**：配置键、页面归属、"运行档案 / 运行方案"命名、权限级别去留。
2. **注入块的清单不完整**：漏了唤醒原因尾巴、一次性通知、快照提示、收尾提醒这四类；照着现在的清单迁移，装配器里仍会留 if 分支。
3. **部分假设已被代码推翻**：`sessions.json` 已目录化、`byKey` 已迁进会话档案、`config.role.default` 是全局人格的唯一事实源、保存栏已经改成自动隐藏。

---

## 2. 冲突与裁定

| # | 冲突 | 证据 | 裁定 |
| --- | --- | --- | --- |
| 1 | 「运行档案」vs「运行方案」 | 注入稿 §1/#7 用档案；运行稿全篇用方案 | 统一叫**运行方案**（plan）。"档案"只留 DSH 预设→**能力预设**、行为→**行为档案**、会话→**会话设置**。 |
| 2 | 权限级别是否保留 | 注入稿 §1/#5 保留 L1/L2/L3；运行稿 §3.1 删除 | **删除**。级别只是 `LEVEL_PERMISSION_PRESET` / `LEVEL_AGENT_PRESET` 的配对名（`src/admin/dsh-permission.js:17-42`），改为能力预设的 `sandbox` 字段。 |
| 3 | 配置键 | 注入稿 §3.8 `runtimeProfiles` + `defaultProfile`；运行稿 §10 `runtime.plans` + `state/runtime.json` | 按运行稿：**定义进 `config.runtime.plans`，激活指针进 `state/runtime.json`**。 |
| 4 | 人格注入上限的归属 | 注入稿 §3.5 说删 `config.role.maxInjectChars`；运行稿 §3.3 说"暂留原处" | **独立成 `config.limits.personaInjectChars`**（P2 已实现，旧键 `role.maxInjectChars` 只读兼容）。它限制的是角色卡正文长度，不是块的截断长度，所以不进 `promptBlocks[...]`；全局配置卡继续保留输入框，读写都落这一处。 |
| 5 | 保存栏改造方案 | 注入稿 §4 仍是"内容流 sticky + main 预留高度" | **已作废**。实际实现是：浮层默认隐藏、有未保存内容才浮现、可见时只设 `#mainContent` 的 `scroll-padding-bottom`（不占布局），撤销会重读服务端并重拍基线。文档按实现改写。 |
| 6 | 会话覆盖存哪 | 注入稿 §3.8 写 `sessions.json > sessionOverrides` | **已目录化**：`state/sessions/qq/<group\|private>/<id>.json`（`src/session/directory.mjs`，`SESSION_DIR_VERSION = 2`）。`byKey` 已在 P7 迁进 `profile.persona`（`src/bridge.js:856-863`），`state/current-role.json` 只剩回退作用。 |
| 7 | 全局人格的源 | 注入稿 §5.2 把 `current-role.json > role` 当全局源 | **`config.role.default` 才是唯一事实源**（`src/bridge.js:861`）；`current-role.json.role` 只做旧版本回退。迁移时只取 `config.role.default`。 |
| 8 | 页面/导航没合并 | 注入稿要加「注入块」页；运行稿 §8.1 的导航里没有注入块 | 合并成第 4 节那一张表：新增 2 页（注入块、运行方案），改名 2 项（能力预设、命令与工具），移动 1 项（运行方案位置）。 |
| 9 | 块清单不全 | 注入稿 §2.3 列 19 块，只说"其余 5 处没归一" | 按代码反推，实际是 **26 块 + 3 种提示词档案**（第 6 节；`wake` 23 块 + `context` 2 块 + `reminder` 1 块）。原因尾巴（10 个分支）、一次性通知（读卡/令牌/补写/中继/定时）、快照提示、收尾提醒都不在原清单里。 |
| 10 | 块作用域 `runtime` | 注入稿 §2.2 允许 `scopes: ['global','runtime','session']` | v1 **只做 `global`**；字段保留解析但非 global 一律按 global 处理并在页面标注"按方案覆盖尚未开放"。理由：方案只有三个字段，塞块覆盖会破坏模型；而人格/行为已经能表达差异。 |
| 11 | 行为 kind 的 `render()` 与块重叠 | 运行稿 §3.2 让 kind 输出"提示词片段：参与度/唤醒/等待节奏"；注入稿把这些做成块 | **文本归块，值归 kind**。kind 只提供 `view(ctx)`（现值来自 `behaviorConfigFor` / `behaviorV2View`）与字段规格；若将来某种行为要独有文案，由它**注册自己的块**（owner = `behavior:<id>`），而不是加第二个文本出口。 |
| 12 | 注入预算数值 | 注入稿用 "总 200k"；注册表默认 `maxTotalChars = 4000`；`plugins.json` 是 4000 | 统一成 `config.limits.promptBlocks = { total, perBlockDefault }`，单位字符。P2 先落 **0 = 不限**（与重构前等价，不凭空加闸门）；等真机跑一段、拿到每轮字数分布再定默认值，页面上显示"已用 / 总预算"并允许改。 |
| 13 | 危险沙箱的确认强度 | 运行稿 §6 说 `danger-full-access` 加一次"我了解风险" | **保留 TOTP**：任何含工具的方案切换要 owner 确认码；目标沙箱是 `danger-full-access` 时再加 TOTP（沿用 `getTotpSecret`），"我了解风险"作为第三个输入框。开发者导向不等于把已有的强确认拆掉。 |
| 14 | 收尾提醒是第二套提示词 | 注入稿只建模唤醒提示词；`buildWakeReminderPromptV2`（`src/bridge.js:14757`）自己拼角色/身份/令牌 | 装配器支持 **`profile: 'wake' \| 'reminder'`**，块声明出现在哪些 profile。否则收尾提醒会继续复制三段文本并与块配置漂移。 |

---

## 3. 统一对象模型（最终）

```
资源（resource）
  能力预设 capability = { preset, sandbox, grants }     ← DSH 预设 + 权限预设 + 工具收窄
  行为档案 behavior   = { kind, platform, config }      ← YAML，kind 提供字段与取值视图
  人格 persona        = 角色卡（本地 md / provider: 引用）
  模型 model          = DSH provider / model / effort
  平台适配器 platform = 发送 / 成员 / 历史 / 显示名
  工具目录 catalog    = config.tools（44 个部署事实，重启 DSH 生效）
  准入 access         = 两轴名单（被动 / 主动），独立系统，不进方案

方案（plan）
  { id, name, tools: capabilityId|null, behavior: 'inherit'|'none'|<behaviorId>, audience: 'owner'|'access' }

绑定（binding）
  全局：state/runtime.json > active[platform] = planId
  会话：state/sessions/**/<id>.json > planId
  人格：config.role.default（全局） + session.persona（覆盖）
  模型：DSH 全局 + session.model（覆盖）
```

解析链与投影：

- `resolvePlan({plans, activeByPlatform, sessionPlanId, platform})` → `{ plan, capability, behavior, audience, legacyMode }`。
- `legacyMode` 由 `(tools, behavior.kind)` 推导，继续喂给 `effectiveMode()` 的 55 个调用点（`src/bridge.js`），不要求一次改完。
- 方案不写平台；绑定按平台；行为档案声明 `platform`。

---

## 4. 页面与导航（合并后）

```
管理      运行总览 → 会话与审批 → 运行方案 → 全局配置 → 调试与运维
聊天行为  注入块 → 行为档案 → 能力预设 → 人格与角色 → 记忆 → 黑话词库 → 定时任务
扩展      插件 → 技能 → MCP → 命令与工具
```

| 页面 | 变化 | 归属阶段 |
| --- | --- | --- |
| 注入块（新） | 块列表 + 详情 + 预览抽屉；聊天行为第一项 | P2 |
| 运行方案（新） | 列表 + 编辑器 + 启用 + 克隆/导入导出 | P5 |
| 全局配置 | 删"运行模式"卡与模式相关下拉；"人格与行为"卡保留；「QQ 工具」改名「工具目录」加依赖提示 | P5 / P7 |
| 会话与审批 | "模式 + DSH 预设"两个下拉合并为"运行方案"；人格/模型/唤醒保留 | P5 |
| 行为档案 | 表格 + 编辑区（kind 字段驱动）；新建/复制/删除 | P7 |
| DSH 预设 → 能力预设 | 改名；加沙箱列与工具收窄；从 DSH 目录导入 | P7 |
| 管理行为 → 命令与工具 | 只改名 | P7 |
| 运行总览 | 模式徽标 → 当前方案名 + 解析摘要 | P5 |
| 插件 | 移除"注入块"卡；插件详情显示"贡献 N 个块"+ 跳转 | P2 |
| 调试与运维 | 不动（紧急关闭已在此） | — |

---

## 5. 配置与状态契约

### 5.1 `config.json`（终态）

```jsonc
{
  "defaults": { "behavior": "social-v2", "persona": "soulkit:saren" },
  "runtime": {
    "plans": [ /* 自定义方案；内置 6 条在 src/runtime/plans.mjs，只读 */ ],
    "fallbackPlan": "social-v2",
    "idleMinutes": 10,
    "resetOnRestart": true
  },
  "capabilities": {                 // 键 = DSH 预设 id
    "qq-agent-full": { "sandbox": "danger-full-access", "grants": { "disable": [] }, "platform": "qq" }
  },
  "limits": {
    "promptBlocks": { "total": 0, "perBlockDefault": 0 },          // 0 = 不限；实测分布后给默认值
    "personaInjectChars": 6000,                                    // 人格卡注入上限（原 config.role.maxInjectChars）
    "send": { "...": "不变" }
  },
  "scheduler": { /* 原 state/scheduler.json > settings */ },
  "plugins":   { /* 原 plugins.json */ },
  "silence":   { "schedule": { /* 原 state/silence-schedule.json */ }, "manual": null },
  "promptBlocks": {
    "core-persona-refresh": { "enabled": true, "maxChars": null, "settings": {} }
  }
}
```

删除：`agentPreset`、`socialV2.agentPreset`、`closedAgentPreset`、`behavior.default`、`role`（`default` → `defaults.persona`，`maxInjectChars` → `limits.personaInjectChars`，`saveApply` → 页面本地状态）。

### 5.2 `state/`

| 文件 | 终态 |
| --- | --- |
| `runtime.json` | `{ "version": 1, "active": { "qq": "social-v2" } }` |
| `sessions/**/<id>.json` | 去掉 `mode` / `presetId`，改为 `planId`；`persona` / `model` / `wake` / `binding` 不变 |
| `prompt-block-state.json` | 原 `prompt-blocks.json`（只记投递：`fp` / `at` / `wakes`） |
| `scheduler.json` | 只剩 `tasks` / `history` / `counters` / `nextId`（设置已迁 `config.scheduler`） |
| `silence-schedule.json` | 只剩 `override`（时间段已迁 `config.silence.schedule`） |
| `mode.json` / `current-role.json` | P4 迁移后删除（备份 `.bak`）；`current-role.json` 的 `silent` 已在 P3 迁到 `config.silence.manual` |

### 5.3 注入块配置

```jsonc
"promptBlocks": {
  "<id>": {
    "enabled": true,
    "maxChars": 6000,
    "priority": 10,          // 可拖拽排序，缺省用块声明的默认值
    "settings": { }          // 由块自己声明字段规格，控制台 renderFields 渲染
  }
}
```

`normalizePromptBlocks`（`src/bridge.js:1040`）扩到这四个字段；未知字段丢弃。

### 5.4 方案与能力

```jsonc
// plan
{ "id": "agent-full-group", "name": "全权 Agent · 群聊",
  "tools": "qq-agent-full", "behavior": "social-v2", "audience": "access",
  "builtin": false, "note": "" }
```

- `tools: null` = 不带工具（纯聊天）；`behavior: "inherit"` 读 `config.defaults.behavior`；`"none"` = 不使用。
- 内置六条：`chat` / `social-v1` / `social-v2` / `agent-readonly` / `agent-workspace` / `agent-full`。

---

## 6. 注入块完整清单（26 个，已按此实现）

装配器有三种提示词档案：`wake`（唤醒）、`reminder`（收尾提醒）、`context`（唤醒前的前导段：当前时间 + 黑话表）。
块用 `profiles` 声明自己出现在哪些档案；`slot` 决定先后，`priority` 决定同一 slot 内的先后。

| slot | id | priority | profiles | timing | 内容 |
| --- | --- | --- | --- | --- | --- |
| head | `core-backfill-notice` | 10 | wake | on-event | 断线补收说明（":13434" 一带） |
| head | `core-token-notice` | 20 | wake | on-event | 令牌抄错提醒 |
| head | `core-persona-refresh` | 30 | wake | on-event | 角色卡已更新（新卡全文） |
| head | `core-now` | 100 | context | every-wake | 【当前时间】 |
| head | `core-slang` | 110 | context | on-change | 黑话表（变了给全文，没变只给一行引用） |
| identity | `core-role` | 100 | wake, reminder | every-wake | 【当前角色】一行 |
| identity | `core-identity` | 110 | wake, reminder | every-wake | 【你的身份】昵称 + QQ |
| identity | `core-token` | 120 | wake, reminder | every-wake | 【会话令牌】 |
| identity | `core-initial-prompt` | 130 | wake | reason:bootstrap | 初始提示词（只在首次唤醒） |
| behavior | `core-anti-ai` | 140 | wake | every-wake | 【反AI味】 |
| behavior | `core-proactivity` | 150 | wake | every-wake | 【积极性】 |
| resources | `core-skills` | 160 | wake | on-change | 技能清单（名字 + 一句说明） |
| resources | `core-stickers` | 170 | wake | on-change | 表情包策略（没变只给一行） |
| situation | `core-reply-rhythm` | 180 | wake | every-wake | 【首回复节奏】 |
| situation | `core-state` | 190 | wake | every-wake | 【此刻状态】 |
| situation | `core-wake-info` | 200 | wake | every-wake | 【当前唤醒】条件与触发 |
| situation | `core-memory` | 210 | wake | every-wake | 记忆（provider 决定内容） |
| situation | `core-people` | 220 | wake | every-wake | 在场人物 |
| situation | `core-participation` | 230 | wake | every-wake | 【参与度】 |
| situation | `core-pre-sleep` | 240 | wake | every-wake | 【沉睡前强制等待】 |
| action | `core-wake-task` | 100 | wake | every-wake | 原因尾巴 10 个分支（bootstrap/timeout/replyCheck/proactiveCheck/memberJoin/roleRefresh/silenceEnded/scheduled/ownerRelay/poke） |
| action | `core-action` | 110 | wake | every-wake | 默认尾巴：【行动前】+【引用：只在必要时用】 |
| action | `core-reminder` | 100 | reminder | every-wake | 【提醒】回合收尾 |
| tail | `core-owner-relay` | 100 | wake | on-event | 管理员托付 |
| tail | `core-scheduled` | 110 | wake | on-event | 定时任务说明 |
| tail | `core-snapshot` | 900 | wake | on-event | 【本次消息快照】+ 读取/收尾提示 |

约定（实现见 `src/plugins/prompt-blocks.mjs` 与 `src/bridge.js` 的 `registerCoreBlocks` / `wakePromptCtx`）：

- **块只产出自己的正文，不带分隔符**；注册表用 `'\n\n'` 连接。这是逐字节等价的硬约束：原文里凡是用单换行连成一段的（例如【行动前】与【引用规则】），就不拆成两个块——拆了会被分隔符改成双换行，所以原来规划里的 `core-quote-rule` 并入 `core-action`。
- `timing: reason:<name>` 支持前缀（`memberJoin` 命中 `memberJoin:member_start`）。`on-event` / `on-change` 是「块自己决定这次有没有内容」，注册表不筛选：返回空串即本轮不出现。
- `wake` 档案的装配不设总字数闸门（`renderProfileSync(..., { maxTotalChars: 0 })`）：重构前这些段落本来就没有总预算，先保证等价；总预算与逐块上限的配置化在 P2 落到 `config.limits.promptBlocks`。
- `wakePromptCtx()` 一次取齐状态（角色、令牌、未读、唤醒条件、托付、定时说明、快照之外的动态内容），块只读 ctx，不自己查状态。预览接口会复用同一份 ctx。
- 快照本体仍在 `deliverPromptNow` 里生成（它依赖投递时的实时状态），但**那段话归 `core-snapshot` 块**，投递处只做「渲染 + 追加」。
- `core-persona-refresh` 的注入上限独立于块预算：人格卡有自己的裁剪阈值 `config.limits.personaInjectChars`（原 `config.role.maxInjectChars`，兼容读旧键），它限制的是「本次唤醒附带的角色卡」长度，不是整个块的截断长度，因此不塞进 `promptBlocks[...].maxChars`。

## 7. 执行顺序

| 阶段 | 内容 | 行为变化 | 重启 |
| --- | --- | --- | --- |
| **P0** | 本文 + 两份旧稿加"以本文为准"的头注；不再动代码 | 无 | 否 |
| **P1** | 注入块内核：注册表 v2（slot/timing/profiles/settings/priority/refresh）、单一装配器（wake+reminder）、26 块迁移、`buildWakePromptV2Core` 退化为「建 ctx + renderProfileSync」、`withSlangContext` 改走 context 档案、快照进块、golden 逐字节夹具 | 无（golden 等价） | 是（验证真实投递） |
| **P2** | 注入块页（`GET /api/prompt-blocks`、`POST /api/prompt-preview`、表格里改开关与上限）+ 插件页移除注入块卡；预算与人格上限迁到 `config.limits.promptBlocks` / `config.limits.personaInjectChars`；`prompt-blocks.json` 改名 `prompt-block-state.json` | 无 | 是（新接口 + 状态文件改名） |
| **P3** | 配置归一（非运行部分）：`plugins.json` → `config.plugins`、`scheduler.settings` → `config.scheduler`、静默 → `config.silence`、`current-role.json` 的 `silent` → `config.silence.manual` | 无（等价迁移，备份） | 是（读配置） |
| **P4** | 运行方案数据层：`src/runtime/plans.mjs`（6 条内置 + 归一 + legacy 投影 + `planIdForLegacy`）、`src/runtime/active.mjs`（`state/runtime.json` 指针、一次性迁移、原子写）、`effectiveMode` 改用方案投影、会话档案新增 `planId`、`GET /api/runtime/plans` / `POST /api/runtime/switch`（确认、审计、TOTP、回落仍走 `mode-control`） | 无（等价映射） | 是 |
| **P5** | 运行方案控制台：新页 `pages/runtime/`（摘要 + 切换 + 清单 + 弹窗编辑器 + 克隆 + 导入/导出 JSON，只复用 `renderFields`/`dataTableHtml`/`modalHtml`）、`POST/DELETE /api/runtime/plans`（内置只读、在用方案不许删）、导航重排（管理组：总览→会话→运行方案→全局配置→运维；预设移入聊天行为）、全局配置删「运行模式」卡与 `saveMode`/`#modeRow`/`#closedPreset`/`#adminPanic`/`#adminStatus` 一套、`overview/fields.js` 删 `MODE_HTML`/`ADMIN_ROW`/`mode` 组、会话详情「模式 + DSH 预设」合并为「运行方案」（`detailPlan`，保存发 `planId`）、`/api/status` 回 `planId/planLabel` 且总览指标显示方案名 | 无 | 是（前端 + 新接口） |
| **P6** | 拆三处硬编码（已完成）：① `resolveEffectiveMode` 不再做 owner 排他 / `inactive` 投影，closed-agent 是全局引擎；② `effectiveMode` 按方案 `planMode()` 投影（行为 kind → reserved/reserved2，工具 → chat/closed-agent），会话固定 `planId` 时忽略旧 `mode`；③ `behaviorFor` 只看方案（`none` / `inherit` / id），删掉「按模式返回 null」与 kind 不匹配抛错；`modePreset` 方案能力优先；④ 受众由 `planAudienceBlocks()` 在 `passiveAllowed`/`proactiveAllowed` 里拦（`audience:'owner'` 只给管理员私聊），取代旧 closed-agent 排他；⑤ `legacyModeOfPlan` 改行为优先 | **有**（能力放开：Agent 工具 + 仿真行为 + 任意受众可组合） | 是 |
| **P7** | 行为 kind 与能力授予：`src/behaviors/kinds/{v1,v2}.mjs`（字段表 + `defaults`，行为页与 `behavior-form` 共用）、`GET /api/behaviors/kinds`、行为页「档案清单」表（类型/被引用/编辑）、`src/runtime/capabilities.mjs`（`GATEABLE_TOOLS` 9 个写工具 + 沙箱 + `grants.disable`，配置落 `config.capabilities`）、`GET/PATCH /api/runtime/capabilities`、运行方案页「能力预设」卡 + 弹窗编辑器、`v2ToolEnabled(flag, key)` 按会话方案收紧写工具 | 无（只收紧，不放宽） | 是（新接口 + 前端） |
| **P8** | 收尾：全量回归（audit 109/109、console UI 35/35、static 全过）、逐页截图核对、文档同步（`GLOBAL_CONFIG` 页面盘点、`STATUS` D21、模型稿 §3.1 对齐实现） | 无 | 否 |

顺序理由：

- **注入块最先**：它是提示词的唯一出口，后面的行为接口（P7）要往里注册块；先做省一次返工。且它能独立验收（golden 等价）。
- **配置归一其次**：把散落的 state 文件收干净，P4 的迁移只需要处理 `mode.json` 与会话档案，不会和 `plugins.json`/`scheduler.json` 的搬迁搅在一起。
- **运行方案在中间**：P4 只做数据层与 API，P5 才动界面；这样"等价映射"可先用单测和 CLI 验证，再上 UI。
- **P6 单独一轮**：唯一改变安全边界的步骤，必须能一键回滚。
- **P7 最后**：能力预设页与行为接口是资源层改良，不阻塞主链路；工具 `grants` 默认全开时完全等价。

每一步的验收（缺一不可）：

1. 相关单测 + `node scripts/test-console-static.mjs`；
2. 改动后端时跑 `node scripts/test-audit.mjs`（当前基线 103/103）；
3. 改动界面时跑 `node scripts/test-console-ui.mjs`，并对改动页真机截图；
4. 每阶段一个提交；P1/P3/P4/P6/P7 各打一个 `phase/<n>` 标签，便于单步回滚。

---

## 8. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 注入拼接顺序变化导致模型行为漂移 | P1 的 golden 用例：同会话同原因，迁移前后逐块比对；默认配置下要求逐字节相同 |
| 人格"其余轮只发一行"导致人设漂移 | 首轮/指纹变化全文；`maxInjectChars` 仍生效；预览可见；日志记录本轮是否全文 |
| 配置归一迁移丢设置 | 迁移脚本先 `--dry-run` 打表；写前备份 `.bak`；幂等（已迁移跳过） |
| 方案迁移丢会话覆盖 | 会话 `mode`+`presetId` 组合不在内置六条时自动生成自定义方案；迁移前列出全部组合 |
| P6 放开 agent 进群后工具被滥用 | 方案级 `grants` 默认收窄危险工具；被动/主动准入与发送限速不变；工具调用全量审计（`state/tool-calls.jsonl`）；控制台在方案卡上标"未验证组合" |
| 桥接重启打断正在跑的回合 | 重启点放在阶段边界；重启前确认无进行中的 AI 回合（日志里查"回合进行中"）；守护窗口 5 秒拉起 |
| 前端片段页缓存 | 每页 `page.js` 带 `?v=` 由 router 注入；改完硬刷新验证 |

---

## 9. 批准后的执行方式

- 连续执行 P0→P8，不逐阶段停下来等确认；每阶段结束在对话里报一句进度（不阻塞）。
- 只在三种情况下停：① 需要删除/覆盖真实数据且没有安全备份；② 测试失败且同一阶段内修不好；③ 发现文档之间的新冲突会改变产品语义（不是实现细节）。
- 所有"文档没写死"的小决策按本文原则取默认值，并在阶段提交信息里记一句，最后汇总。
- 完成判据：P0–P8 全部落地；`test-audit` 全绿；控制台逐页无报错；真机验证"切换方案 + 注入块预览 + 会话覆盖 + 极端组合"四条主路径；文档与代码一致。

---

## 10. 明确不做

- 不做方案继承（只复制）。
- 不把人格/模型/唤醒塞进方案。
- 不把准入规则复制进方案。
- 不为极端组合写特判。
- 不重写工具注册机制（工具目录仍决定"是否存在"，改动仍需重启 DSH）。
- 本轮不接第二个平台，只留适配器接口（P8 可选尾项）。
