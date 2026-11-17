# 本目录没有 `*.yml`（有意）

能力档只写**意图**（effects / runtime / audience / mcp / skills），行由执行体的渲染层生成。
ACP 确实消费这份意图，但它消费的那一份是跨平台共用的 `profiles/capabilities/direct.yml`：

- **没有可声明的效果**：ACP 的工具面在对端 Agent 里，桥接不渲染任何插件行，所以效果为空
  —— 这与本目录 `../tools.yml` 的 `modules: []` 是同一件事的两半；
- **生效方式是 passthrough**：Agent 名单在 `session/new` 的回执里（`configOptions` 的
  `agent` 项），是会话级的运行期数据，不是可以提前写进仓库的静态表；
- **提示通道是 system**：平台话术作为 `session/new` 的 `systemPrompt` 交出去。

在这个目录再写一份 `chat.yml` 会与 `direct.yml` 逐字段相同 —— 那是重复，不是第二份数据。
「同一份意图被两个执行体消费」由 `scripts/test-acp-capability-intent.mjs` 钉住：
DSH 侧编译成 cordis 插件行，ACP 侧编译成 `session/new` 报文，两边都不改写意图。

能力位（会话 / 权限 / 模型）与权限档映射见 `../adapters/runtime.mjs`。

本文件必须有：`check-profiles` 要求每个 Agent 平台目录存在 `capabilities/`，而 Git 不跟踪空目录。
