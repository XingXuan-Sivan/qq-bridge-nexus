# 桥接插件与扩展路线图

> 用途：把「接下来做什么、为什么这么做、什么明确不做」固定在仓库里，避免实现跑着跑着偏离规划。
> 规则：**先改这份文档，再改代码**；任何阶段的范围变化，都要在这里留下记录。
> 最后更新：2026-11-03

相关文档：

- [PLUGIN_KERNEL.md](PLUGIN_KERNEL.md)：插件内核的现有实现（P1，已交付）。
- [PERSONA_PROVIDER.md](PERSONA_PROVIDER.md)：人格三层解析与 provider 契约（P1，已交付）。

---

## 1. 已拍板的决策（不再重开）

| 决策 | 结论 | 理由 |
| --- | --- | --- |
| 插件配置 | 独立文件 `plugins.json`，不进主 `config.json` | 插件配置变化频繁，混进主配置会让「重启才生效」的边界变模糊 |
| 人格权威 | 三层解析：会话覆盖 → 外部 provider → 全局本地卡 | 既保留 `/role` 的直观操作，又允许外部系统成为权威，且不写穿 |
| `off` 语义 | 硬覆盖，provider 不接管 | 用户明确说「这个会话不挂卡」时，不能被外部卡偷偷接管 |
| 写穿 | 不做 | 桥接只读 provider，切换人格仍走 `/role` 与控制台，避免两套写入口 |
| provider 数量 | 同一时刻只启用一个（`persona.provider`） | 多 provider 竞争在 P1 没有明确的产品语义，先留白 |
| 插件进程 | 与桥接同进程 | 独立进程要处理 RPC、生命周期、日志与权限，收益不抵成本 |

---

## 2. 现状（P1 已交付）

- 内核：[src/plugins/](../src/plugins/)（`manifest` / `config` / `audit` / `persona` / `host-api` / `kernel`），四个钩子 `onInbound` / `onPromptBuild` / `onAfterSend` / `onShutdown`。
- 人格：三层解析 [src/persona-resolve.mjs](../src/persona-resolve.mjs)、契约 `persona-provider/1`、缓存与降级在注册表内。
- 第一个插件：[plugins/soulkit-persona/](../plugins/soulkit-persona/)，从 soulkit 的 `/api/persona/card` 按会话取卡。
- 控制台：「桥接插件」只读页、「人格来源」只读页。
- 边界：`dsh-bundles/` 是给 DSH 加载的 bundle，`plugins/` 是桥接插件目录，两者不混。

**P1 明确不做、留给路线图**：热重载、安装/卸载、插件面板、命令注册、MCP 清单管理、skills。

---

## 3. 阶段总览

| 阶段 | 内容 | 状态 | 预估 |
| --- | --- | --- | --- |
| P2a | 插件启用/停用、重载、详情页 | 待开始 | 1 天 |
| P2b | 本地目录安装/卸载（含 zip） | 待开始 | 1 天 |
| P2c | 文件监听自动重载（默认关） | 待开始 | 半天 |
| P2 同期 | 命令注册 + 具名注入块 | 待开始 | 1 天 |
| P3 | 出站装饰、入站过滤链、定时任务类型、插件面板 | 候选 | 各 0.5–1 天 |
| P3+ | Agent 工具注册、MCP 清单、Skills | 需先验证 | 未知 |

排序原则：**先让插件「能管」，再让插件「能干活」，最后才碰主链与 DSH 侧**。

---

## 4. P2a：插件管理（启停 / 重载 / 详情）

### 做什么

- `POST /api/plugins/:id/enable`、`/disable`：只改运行态，不写 `plugins.json`；下次启动以 `plugins.json` 为准，页面明确提示「临时生效」。
- `POST /api/plugins/:id/reload`：热重载单个插件。
- `GET /api/plugins/:id`：详情（manifest、权限、钩子、计数、最近错误、审计尾部 20 条）。
- 控制台插件页：卡片上加启用/停用/重载按钮，点开是详情抽屉。

### 怎么做

- 内核新增 `reload(id)`：
  1. `dispose()` 旧实例（拆钩子、注销 provider、清 timer）；
  2. 从注册表移除；
  3. 重新读 `plugin.json` 并校验；
  4. `import(url + '?v=' + mtimeMs)` 绕过 ESM 缓存；
  5. `activate(ctx)`，成功则替换，**失败则恢复旧实例**并把错误写进状态。
- 启用/停用 = `loadOne(id)` / `dispose(id)`，状态在 `disabled` 与 `active` 之间切换。
- 计数与最近错误沿用现有 `status()` 结构，不新造字段。

### 代价与风险

- 每次重载会重新执行 `activate`，插件若在 `activate` 里做重活（读大文件、建连接）会拖慢请求；限制在 2 秒内完成，超时视为失败。
- 重载瞬间若有 in-flight 钩子，等超时或直接丢弃，审计记 `dropped`。
- 不解决「改 `plugins.json` 自动生效」——那是 P2c。

### 验收

1. 停用后钩子不再被调用，`/api/plugins` 状态为 `disabled`。
2. 重载一个坏插件 → 旧实例仍在跑，错误可见。
3. 重载后 `persona` 注册表仍只有一份，不出现重复 provider。
4. 所有操作写 `state/plugin-audit.jsonl`。

---

## 5. P2b：安装与卸载

### 做什么

- `POST /api/plugins/install`：`{ path }`（服务器本地目录）或上传 zip；只允许落在 `plugins/` 下。
- `DELETE /api/plugins/:id`：卸载（先 dispose，再移到 `state/_trash/plugins-<id>-<ts>/`，不硬删）。
- 安装后自动校验 manifest，失败则回滚目录。

### 怎么做

- 目录安装：`fs.cp` 到 `plugins/<id>`，校验通过才 `loadOne`。
- zip 安装：解压到临时目录，取顶层含 `plugin.json` 的目录，校验后移入。
- 拒绝：绝对路径越界、`..`、符号链接指向仓库外、zip 内路径穿越、超过 5MB。

### 代价与风险

- 安装即执行代码，等于给 owner 一个「往桥接里放代码」的入口；只对 owner 开放，并且每次安装写审计。
- 不做签名与来源校验（P2 明确不做），文档要写清这一点。

### 验收

1. 安装一个最小插件 → 出现在列表、可启用。
2. 安装非法目录 → 报错且 `plugins/` 不残留。
3. 卸载后目录进 `_trash`，列表消失。

---

## 6. P2c：文件监听自动重载（默认关）

- `plugins.watch: true` 时，`fs.watch(pluginsDir, { recursive: true })` + 500ms debounce，只重载变更文件所属的插件。
- 默认关闭：开发时开，生产默认关，避免保存到一半触发半成品重载。
- 对应 AstrBot 的 `ASTRBOT_RELOAD=1`（`astrbot/core/star/star_manager.py` 的 `_watch_plugins_changes`），但只做单层目录，不做递归深度限制之外的复杂过滤。

风险：Windows 上 `fs.watch` recursive 在部分文件系统上不稳定，失败时降级为「不监听 + 日志一行」。

---

## 7. P2 同期：命令注册与具名注入块

### 7.1 命令注册

- 做什么：插件可注册命令，带 `name` / `aliases` / `scope`（private/group/all）/ `ownerOnly` / `help` / `handler(ctx, args)`。
- 怎么做：在 [src/bridge.js](../src/bridge.js) 的命令分发表上加一层「插件命令表」，命中后先做权限判定（复用 `parseOwnerCommandForGuard` 的 owner 判定），再调用 handler；命令冲突时内置命令优先，插件之间按 plugin id 排序并告警。
- 代价：低。风险：插件命令可能冒充内置命令——规则是**内置命令永远优先**，插件不能覆盖。
- 验收：注册 `/hello` → 群里可用；`/role` 仍走内置；ownerOnly 命令对非 owner 静默。

### 7.2 具名注入块

- 做什么：`ctx.prompt.registerBlock({ id, priority, maxChars, render(ctx) })`，让记忆、贴纸、日程、关系各占一块，可单独开关与限额。
- 怎么做：现有 `promptAdditions` 保留为兼容层，内部改为调用块注册表；`state/prompt-blocks.json` 已有跟踪能力，扩展成「按 block id 记录注入与跳过」。
- 代价：低。风险：块多了会稀释人格——用 `maxPromptAppendChars` 总上限兜底，并在控制台显示每块占比。
- 验收：注入两块，顺序与限额符合声明；关掉一块后 prompt 里不再出现。

---

## 8. P3 候选（按收益排序）

### 8.1 出站装饰 `onReplyDecorate`

- 做什么：发送前拿到 `parts`，可改写、增删或取消。
- 场景：md→plain、拆条策略、引用/卡片、贴纸追加、语音替换。
- 代价：中——要碰 `sendToQQ` 前的组装逻辑；必须先有「装饰失败一律回退原文」的兜底。
- 验收：装饰抛错时原文照发。

### 8.2 入站过滤链 `onInbound` 增强

- 做什么：钩子返回 `{ drop, replaceText }`，按优先级链式执行。
- 场景：敏感词、群规则、白名单、去重、跨群转发。
- 代价：中偏高——改的是消息入口判定，必须用 feature flag 灰度；默认行为与现在逐字节一致。
- 验收：无插件时行为不变（回归测试对比）。

### 8.3 定时任务类型

- 做什么：插件注册 task kind + runner，进入 [src/scheduler/engine.js](../src/scheduler/engine.js)。
- 代价：中——要处理持久化、恢复、时区。
- 验收：自定义类型的任务重启后仍在。

### 8.4 插件控制台面板

- 做什么：`/plugin-ui/<id>/` 静态路由 + 插件页卡片入口，面板只能拿自己的数据。
- 代价：中——鉴权隔离、CSP、样式污染。
- 验收：未启用插件的面板 404。

### 8.5 Agent 工具注册（暂缓）

- 现状：`qq_*` 工具写死在 DSH preset 补丁（[dsh/agent-presets/](../dsh/agent-presets/)），改一次要重启 DSH。
- 结论：需要 DSH 侧支持运行时更新工具表；在确认之前不做，避免做出「注册了但模型看不到」的假功能。

---

## 9. 桥接之外的扩展面

### 9.1 MCP 清单（需先验证）

- 现状：三个写死的 stdio 服务——[src/mcp-host-server.js](../src/mcp-host-server.js)（SnowLuma 状态）、[src/mcp-snowluma-safe.js](../src/mcp-snowluma-safe.js)、[src/mcp-web-search-safe.js](../src/mcp-web-search-safe.js)。
- 目标：`mcp.json` 清单 + 控制台「MCP 服务」页（启停、测试连接、看工具），插件可贡献 server 定义。参考 AstrBot 的 `data/mcp_server.json` + `func_tool_manager.py`（`init_mcp_clients` / `enable_mcp_server` / `test_mcp_server_connection`）。
- **开工门槛**：先验证 DSH 是否支持运行时增删 MCP。不支持就只能「写配置 + 提示重启 DSH」，体验打折，需要用户确认是否接受。

### 9.2 Skills（低成本，可先做）

- 目标：每个角色/会话一个 skills 目录，人格卡声明「可用技能」；唤醒时只注入清单，agent 用时再读全文。参考 AstrBot 的 `SkillManager`（`SKILL.md` + frontmatter + 渐进式披露）。
- 代价：低（目录约定 + prompt 约定）。风险：技能里的脚本等于执行面，必须白名单 + 只读挂载。
- 验收：技能清单只在系统提示里占固定行数，不随技能数量线性膨胀。

### 9.3 其他 provider 化

| 对象 | 建议 | 原因 |
| --- | --- | --- |
| TTS / 语音 | 可做，低风险 | 失败可回退文本 |
| 贴纸库 | 可做，低风险 | 只是数据源替换 |
| 搜索源 | 可做 | 已有 web-search 抽象 |
| 模型路由（[src/dsh-model.js](../src/dsh-model.js)） | **只读展示 + 手动切换**，不开放给插件 | 直接涉及钱与输出质量 |

---

## 10. 明确不做 / 暂缓

| 项 | 结论 | 原因 |
| --- | --- | --- |
| 插件市场、在线下载、签名 | 不做 | 供应链风险，收益低 |
| 插件独立进程 / 沙箱 | 不做 | 与桥接同进程是既定设计 |
| 多 provider 竞争 | 暂缓 | 没有明确产品语义 |
| 插件直接读写 `state/` 以外的仓库文件 | 不做 | 越权 |
| 插件访问 DSH 内部对象或 MCP 工具 | 不做 | 接口不稳定，破坏边界 |
| 事件总线式任意钩子 | 不做 | 只认白名单钩子，避免内核变成半成品框架 |
| 平台适配器（QQ 之外） | 暂缓 | 成本远大于当前收益 |

---

## 11. 决策门槛（需要先验证才开工）

1. **DSH 是否支持运行时增删 MCP / 工具？** 决定 9.1 与 8.5 的做法。验证方式：读 DSH 的 MCP 配置加载路径，做一次「加一个 MCP server 后不重启 DSH」的实验。
2. **`fs.watch` 在目标平台（Windows）上的稳定性** 决定 P2c 的默认值。
3. **插件命令与内置命令的冲突策略** 是否需要「插件可覆盖内置」的开关——当前结论是不需要。

---

## 12. 变更流程

1. 规划变化先改本文档，写清「改什么、为什么、影响哪些阶段」。
2. 实现完成后同步 [PLUGIN_KERNEL.md](PLUGIN_KERNEL.md)（接口/配置/契约）与 [PERSONA_PROVIDER.md](PERSONA_PROVIDER.md)（若涉及人格）。
3. 每个阶段结束跑 `npm run test:audit`，新增测试登记到 `scripts/test-audit.mjs`。
4. 文档里不写未实现的能力；「计划中」必须标阶段，不能写成「已支持」。
