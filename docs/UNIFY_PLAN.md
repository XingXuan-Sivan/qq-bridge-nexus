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
| 4 | 人格注入上限的归属 | 注入稿 §3.5 说删 `config.role.maxInjectChars`；运行稿 §3.3 说"暂留原处" | **归注入块**：`config.promptBlocks['core-persona'].maxChars` + `settings.saveApply`。全局配置卡保留"注入上限"输入框，但读写落到块配置（一个值一个来源）。 |
| 5 | 保存栏改造方案 | 注入稿 §4 仍是"内容流 sticky + main 预留高度" | **已作废**。实际实现是：浮层默认隐藏、有未保存内容才浮现、可见时只设 `#mainContent` 的 `scroll-padding-bottom`（不占布局），撤销会重读服务端并重拍基线。文档按实现改写。 |
| 6 | 会话覆盖存哪 | 注入稿 §3.8 写 `sessions.json > sessionOverrides` | **已目录化**：`state/sessions/qq/<group\|private>/<id>.json`（`src/session/directory.mjs`，`SESSION_DIR_VERSION = 2`）。`byKey` 已在 P7 迁进 `profile.persona`（`src/bridge.js:856-863`），`state/current-role.json` 只剩回退作用。 |
| 7 | 全局人格的源 | 注入稿 §5.2 把 `current-role.json > role` 当全局源 | **`config.role.default` 才是唯一事实源**（`src/bridge.js:861`）；`current-role.json.role` 只做旧版本回退。迁移时只取 `config.role.default`。 |
| 8 | 页面/导航没合并 | 注入稿要加「注入块」页；运行稿 §8.1 的导航里没有注入块 | 合并成第 4 节那一张表：新增 2 页（注入块、运行方案），改名 2 项（能力预设、命令与工具），移动 1 项（运行方案位置）。 |
| 9 | 块清单不全 | 注入稿 §2.3 列 19 块，只说"其余 5 处没归一" | 按代码反推，实际是 **27 块 + 2 种提示词**（第 6 节；`wake` 26 块 + `reminder` 1 块）。原因尾巴（10 个分支）、一次性通知（读卡/令牌/补写/中继/定时）、快照提示、收尾提醒都不在原清单里。 |
| 10 | 块作用域 `runtime` | 注入稿 §2.2 允许 `scopes: ['global','runtime','session']` | v1 **只做 `global`**；字段保留解析但非 global 一律按 global 处理并在页面标注"按方案覆盖尚未开放"。理由：方案只有三个字段，塞块覆盖会破坏模型；而人格/行为已经能表达差异。 |
| 11 | 行为 kind 的 `render()` 与块重叠 | 运行稿 §3.2 让 kind 输出"提示词片段：参与度/唤醒/等待节奏"；注入稿把这些做成块 | **文本归块，值归 kind**。kind 只提供 `view(ctx)`（现值来自 `behaviorConfigFor` / `behaviorV2View`）与字段规格；若将来某种行为要独有文案，由它**注册自己的块**（owner = `behavior:<id>`），而不是加第二个文本出口。 |
| 12 | 注入预算数值 | 注入稿用 "总 200k"；注册表默认 `maxTotalChars = 4000`；`plugins.json` 是 4000 | 统一成 `config.limits.promptBlocks = { total, perBlockDefault }`，单位字符。默认值不拍脑袋：P1 的 golden 用例量出真实分布后取 p95 + 20%，页面上显示"已用 / 总预算"并允许改。 |
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
    "plans": [ /* 自定义方案；内置在代码里，只读 */ ],
    "fallbackPlan": "chat",
    "idleMinutes": 15,
    "resetOnRestart": true
  },
  "capabilities": {                 // 键 = DSH 预设 id
    "qq-agent-full": { "sandbox": "danger-full-access", "grants": { "disable": [] }, "platform": "qq" }
  },
  "limits": {
    "promptBlocks": { "total": 40000, "perBlockDefault": 8000 },   // 具体默认值 P1 实测后定
    "send": { "...": "不变" }
  },
  "scheduler": { /* 原 state/scheduler.json > settings */ },
  "plugins":   { /* 原 plugins.json */ },
  "silence":   { "schedule": { /* 原 state/silence-schedule.json */ }, "manual": null },
  "promptBlocks": {
    "core-persona": { "enabled": true, "maxChars": 6000, "settings": { "saveApply": "nextWake" } }
  }
}
```

删除：`agentPreset`、`socialV2.agentPreset`、`closedAgentPreset`、`behavior.default`、`role`（`default` → `defaults.persona`，`maxInjectChars`/`saveApply` → `core-persona`）。

### 5.2 `state/`

| 文件 | 终态 |
| --- | --- |
| `runtime.json` | `{ "version": 1, "active": { "qq": "social-v2" } }` |
| `sessions/**/<id>.json` | 去掉 `mode` / `presetId`，改为 `planId`；`persona` / `model` / `wake` / `binding` 不变 |
| `prompt-block-state.json` | 原 `prompt-blocks.json`（只记投递：`fp` / `at` / `wakes`） |
| `scheduler.json` | 只剩 `tasks` / `history` / `counters` / `nextId` |
| `mode.json` / `silence-schedule.json` / `current-role.json` | 迁移后删除（备份 `.bak`） |

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

## 6. 注入块完整清单（27 个，从代码反推）

装配器有**两种提示词**：`wake`（唤醒）与 `reminder`（收尾提醒）。块用 `profiles` 声明出现在哪些。

| id | slot | timing | 内容 / 现状位置 | 可配 |
| --- | --- | --- | --- | --- |
| `core-now` | head/0 | every-wake | 【当前时间】（现在在 `withSlangContext` 前置，`src/bridge.js:3327`） | 时区/格式 |
| `core-persona-refresh` | head/1 | reason:roleRefresh | 【角色卡已更新】（`:14628`） | 否（locked） |
| `core-token-notice` | head/2 | on-event | 令牌抄错提醒（`:14631`） | 否（locked） |
| `core-backfill-notice` | head/3 | on-event | 断线补收说明（`:14634`） | 否（locked） |
| `core-role` | head/10 | every-wake | 【当前角色】一行（`:14665`） | 否（有开关） |
| `core-identity` | head/11 | every-wake | 【你的身份】昵称+QQ（`:14652`） | 否（locked） |
| `core-token` | head/12 | every-wake | 【会话令牌】（`:14667`） | 否（locked） |
| `core-initial-prompt` | head/13 | reason:bootstrap | 初始提示词（`:14720`） | 上限 |
| `core-anti-ai` | behavior/20 | every-wake | 【反AI味】 | 开关/措辞 |
| `core-proactivity` | behavior/21 | every-wake | 【积极性】 | 开关/档位 |
| `core-reply-rhythm` | behavior/22 | every-wake | 【首回复节奏】（`:14694`） | quietMs/开关 |
| `core-skills` | resources/100 | on-change | 技能清单 | 条数/截断 |
| `core-stickers` | resources/110 | on-change | 表情包策略 | 条数/策略 |
| `core-slang` | resources/120 | on-change | 黑话表（`withSlangContext`） | 条数/候选 |
| `core-people` | resources/130 | every-wake | 在场人物（`:14674`） | 人数/字段 |
| `core-memory` | resources/140 | every-wake | 记忆（`:14670`） | provider/上限 |
| `core-state` | situation/200 | every-wake | 【此刻状态】（`:14702`） | 统计窗口 |
| `core-wake-info` | situation/210 | every-wake | 【当前唤醒】（`:14716`） | 显示项 |
| `core-participation` | situation/220 | every-wake | 【参与度】（`:14678`） | 窗口 |
| `core-pre-sleep` | situation/230 | every-wake | 【沉睡前强制等待】（`:14695`） | 窗口/强制 |
| `core-wake-task` | action/300 | reason:* | **原因尾巴 10 个分支**（`:14723-14753`），模板化 | 每个原因一段 |
| `core-action` | action/310 | every-wake | 【行动前】检查项（`:14754`） | 可编辑列表 |
| `core-quote-rule` | action/320 | every-wake | 【引用规则】（`:14754`） | 开关/文案 |
| `core-owner-relay` | tail/900 | on-event | 管理员托付（`:14636`） | 否（locked） |
| `core-scheduled` | tail/910 | reason:scheduled | 定时任务说明（`:14637`） | 否（locked） |
| `core-snapshot` | tail/920 | every-wake | 【本次消息快照】+ 读取提示（`:13416`；快照本体在 `deliverPromptNow` 手拼） | 条数/格式 |
| `core-reminder` | — | profile:reminder | 收尾提醒（`:14757`） | 文案模板 |

约定：

- `timing: reason:<name>` 的 `<name>` 必须存在于 `WAKE_REASON_AXES`（`src/session/access.mjs`）或 `bootstrap`/`roleRefresh`/`ownerRelay`/`scheduled` 这几个已登记项；启动时校验，未登记直接拒绝注册并记日志。
- `on-event` 块是动态内容，`render(ctx)` 返回空串表示本次不出现；它们不参与"指纹未变发一行"。
- `on-change` 块复用 `src/prompt-blocks.js` 的 tracker，但刷新策略改成每块可配（`settings.refreshEveryWakes` / `refreshEveryMs`，默认 30 / 12h）。
- 预览接口 `POST /api/prompt-preview { key, reason, profile }` 返回逐块文本、字数、phase、跳过原因；不写 state、不调模型。

---

## 7. 执行顺序

| 阶段 | 内容 | 行为变化 | 重启 |
| --- | --- | --- | --- |
| **P0** | 本文 + 两份旧稿加"以本文为准"的头注；不再动代码 | 无 | 否 |
| **P1** | 注入块内核：注册表 v2（slot/timing/profiles/settings/priority/refresh）、单一装配器（wake+reminder）、27 块迁移、`withSlangContext`/`promptAdditions` 退场、快照进块、`/api/prompt-preview` | 无（golden 逐块等价） | 是（验证真实投递） |
| **P2** | 注入块页 + 插件页移除注入块卡；预算与人格上限迁到 `config.limits.promptBlocks` / `core-persona`；`prompt-blocks.json` 改名 | 无 | 否（前端） |
| **P3** | 配置归一（非运行部分）：`plugins.json` → `config.plugins`、`scheduler.settings` → `config.scheduler`、静默 → `config.silence`、`current-role.json` 的 `silent` → `config.silence.manual` | 无（等价迁移，备份） | 是（读配置） |
| **P4** | 运行方案数据层：`plans.mjs` / `capabilities.mjs` / `resolvePlan` / `legacyMode` 投影 / `state/runtime.json` / plan-control（确认、审计、TOTP、闲置回落、重启不继承）/ 切换 API / 迁移脚本（干跑+备份+幂等） | 无（等价映射） | 是 |
| **P5** | 运行方案控制台：新页、全局配置删模式卡、会话详情合并、导航与总览 | 无 | 否 |
| **P6** | 拆三处硬编码：agent 进群、agent 带行为、kind 解耦 | **有**（能力放开） | 是 |
| **P7** | 行为 kind 接口 + 行为档案表格页；能力预设 provider + 页面（沙箱、grants）；工具目录改名 + 调用入口 `grants` 校验 | 无（默认等价） | 是 |
| **P8** | 收尾：`GLOBAL_CONFIG.md` / `STATUS.md` / `SESSION_SUBSYSTEM.md` 更新；全量 audit；真机逐页截图；提交与报告 | 无 | — |

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
