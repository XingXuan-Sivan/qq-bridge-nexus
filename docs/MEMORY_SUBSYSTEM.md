# 记忆子系统（模型 / 配置 / 迁移 / 分阶段计划）

状态：设计已批准，**代码未动**（S1 待开工）。替代 `PLUGIN_ROADMAP.md` §8.10 里「memory 作为声明式块」的原始写法，差异见 `PLAN_DEVIATIONS.md` D1–D3。
涉及：注入块的统一注册表、local-digest（原 `core-digest`）、soulkit 记忆 provider、查询工具、控制台「记忆」页。

## 1. 目标与不变量

目标：记忆从「散落的硬编码 + 各页开关」收成一套 provider 模型——一个注册表、一套预算、一处开关、一处查看；soulkit 作为 provider 接入；预算与截断在界面上看得见、改得动。

不变量（实现时不许破）：

1. 提示词结构不变：记忆段仍在原 `core-digest` 的位置（stickers、skills 之后），只是内容来源可换。
2. 唤醒不被记忆拖慢：同步 provider 零延迟；异步 provider 只读已预热的缓存，超时静默为空。
3. 关块 / provider 故障只影响自己：关掉记忆段整段消失、预算回收；soulkit 停机时唤醒照常完成。
4. 隔离：记忆只按会话 key 读写；工具不能跨会话。
5. 预算显式：任何截断都写进状态（`truncated` / `skipped`），且默认值写进配置而不是藏在代码里。

## 2. 模型

### 2.1 provider 契约

```js
ctx.memory.registerProvider({
  id: 'soulkit',            // ^[a-z][a-z0-9-]{1,39}$
  label: 'soulkit 记忆',
  contract: 'memory-provider/1',
  capabilities: { sync: false, write: false, listable: true },
  // 异步：唤醒前预热；注入时只读缓存
  fetch: async ({ key, query, history, limit }) => ({ text, items, stats }),
  // 同步：只有 sync:true 才允许，必须快（<5ms）、不发网络请求
  fetchSync: ({ key, query, limit }) => ({ text })
});
```

- 注册走插件内核的 staging → commit（与 persona 同构）：activate 成功才生效，停用/重载按 `pluginId` 注销。
- 同一时刻**一个注入源**：`memory.inject.provider`（单选）。
- 查询工具**联邦**：所有 `enabled` 的 provider 都能被 `qq_memory_recall` 问到，结果合并并标注来源。
- 内置 `local-digest` 由 core 注册（owner=core），数据仍在 `state/social-v2.json` 的会话状态里。

### 2.2 块（所有注入块的通用约定）

- 注册表是唯一事实来源：每个块有 `id` / `owner`（`core` / `plugin:<id>` / `declared`）/ `label` / `priority` / `maxChars`（`null` = 不限）/ `enabled` 覆盖 / 运行状态（`calls`、`lastChars`、`truncated`、`skipped`、`lastError`、`lastRunAt`）。
- 控制台「插件」（原内置注入块）区统一展示**所有已注册块**：core 与插件贡献的块都在表里，可开关、可改上限；优先级只读展示。插件块**默认上限不限**，块内部各段的预算由实现者自行决定并在插件内配置——控制台只管「整块开不开、最多多少字」。
- 开关与上限写进 `config.json.promptBlocks[<id>]`（`{ enabled, maxChars }`），对任意 owner 的块生效；插件重载不会丢这些覆盖值。
- 关块后整段消失、预算立即回收；块取数失败只跳过自己（`skipped: 'error'`），不影响其它块与唤醒。

### 2.3 注入
- 唤醒时读 `memory.inject.provider`：
  - `sync:true` → 直接 `fetchSync`（local-digest 走这条，零延迟）；
  - `sync:false` → 读预热缓存（本轮开始前 warm，超时 `memory.providers[id].timeoutMs`，失败记 `lastError`，注入空串）。
- 位置：注册成 `core-memory` 块（owner=core，priority 200，与旧 `core-digest` 同槽位），由 `renderBlockSync` 直接读值——**块本身不 await**。
- 预算：`memory.inject.maxChars`（默认 2400，0=不限）与 provider 自己的 `maxChars` 取小；截断时块状态记 `truncated: true`。
- 与旧块的关系：`core-digest` 不再作为独立块存在，改为 `local-digest` 的渲染函数；旧配置 `promptBlocks['core-digest']` 兼容读入（见 §5）。

### 2.3 查询工具（S4）

- `qq_memory_recall(query, provider?, limit?)`：联邦查询，单次最多 3 条 / 2000 字，结果标来源；`query` 缺省取本轮最后一条真实用户消息。
- `qq_memory_note(text, tags?)`：默认关；只有 `capabilities.write` 的 provider 接受。
- key 解析：由当前 DSH session 反查 `state/sessions.json`（值是 sessionId、键带 `qq:` 前缀），**禁止跨会话**。

### 2.4 写回（S5，默认关）

- 方案：每轮结束把 user/assistant 的摘要 POST 到 provider 的 `write`（soulkit 侧是 `/api/ingest`），带队列、限流、失败重试与每日上限。
- 默认关闭；打开前在记忆页明确提示「会把对话内容写到外部记忆服务」。

## 3. 配置

```json
"memory": {
  "inject": { "provider": "local-digest", "maxChars": 2400, "timeoutMs": 900, "cacheTtlMs": 60000 },
  "providers": {
    "local-digest": {
      "enabled": true,
      "limits": { "topics": 10, "thoughts": 10, "impressions": 10, "impressionsMax": 50, "topicStaleHours": 24, "itemChars": 200 },
      "tools": { "append": true, "query": true, "remove": true, "clear": true }
    },
    "soulkit": { "enabled": false, "baseUrl": "http://127.0.0.1:3110", "maxChars": 1200, "timeoutMs": 900 }
  },
  "tools": { "recall": true, "note": false },
  "handover": { "enabled": true },
  "ingest": { "enabled": false }
}
```

预算分层（互不挤占，任何一层截断都可见）：

| 层 | 配置 | 默认 | 管什么 |
| --- | --- | --- | --- |
| 记忆注入 | `memory.inject.maxChars` | 2400 | 记忆段整体长度 |
| provider | `memory.providers.<id>.maxChars` | 2400 / 1200 | 单个 provider 的输出上限 |
| 内置/声明块 | `memory.blocks.maxTotalChars`（新增，原 `promptBlocks.maxTotalChars` 200000 保留兼容） | 200000 | stickers/skills 等块的总预算，**不含记忆** |
| 插件追加 | `limits.maxPromptAppendChars` | 4000 | 插件 `prompt:provide` 追加的尾部文本 |

## 4. 控制台

### 4.1 插件页「注入块」→ 全量表格

列：块 / owner（`core` / `plugin:<id>` / `declared`）/ 优先级 / 开关 / 上限 / 最近字数 / 状态（正常 / 截断 / 跳过原因）/ 详情（最近调用时间、失败次数）。

- **列出所有已注册块**，包括插件运行时注册的块；插件块默认上限「不限」，块的内部子预算由实现者在插件里自行配置，控制台只提供「整块开关 + 总上限」。
- 上限输入留空 = 不限（`null`）；保存写入 `config.json.promptBlocks[<id>]`，对任意 owner 生效。
- `core-memory` 行显示 `memory.inject.maxChars`；点「详情」跳到记忆页对应卡片。

### 4.2 新「记忆」页（聊天行为分类）

- **注入**：单选 provider（local-digest / soulkit）、记忆上限、超时、缓存 TTL；右侧实时预览「本轮会注入什么」（只读）。
- **provider 卡片**：local-digest（开关 + 条数上限 + 话题过期小时数 + 工具开关）；soulkit（开关 + 地址 + 超时 + 「测试连通」+ 最近命中/最近错误）。
- **本机轻量记忆**：从二代仿真页迁来的按 key 查询/删除/清空，加条数统计。
- **长期规则**：`ownerRules` 只读列出（仍由管理员私聊 `qq_owner_group_rule` 修改），附来源说明。
- **工具**：`qq_memory_recall` / `qq_memory_note` 开关；`qq_memory_append/query/remove/clear` 在 local-digest 卡片里。
- **跨模式**：`handover` 开关（原 `socialV2.tools.handoverMemory`）。
- **最近回忆**：最近 10 次主动回忆记录（时间 / query / 命中条数 / 来源）。

## 5. 迁移映射（旧 → 新，保留 vs 修改）

| 旧位置 | 旧项 | 新位置 | 处理 |
| --- | --- | --- | --- |
| `config.json.promptBlocks['core-digest']` | `enabled` / `maxChars` | `memory.providers['local-digest'].enabled` / `memory.inject.maxChars` | 兼容读一版，首次保存后写新结构；旧键保留只读 |
| 注册表默认值 | digest `maxChars = maxTotalChars = 200000` | `memory.inject.maxChars = 2400` | **改**：默认值显式、可改、截断可见 |
| `state/social-v2.json` | `activeTopics` / `pendingThoughts` / `memberImpressions` | local-digest 数据源（不变） | 保留数据，不动结构 |
| `formatMemoryV2` 硬编码 | 各取 `slice(-10)`、印象 50 条、话题 24h 清理、文本 200 字 | `local-digest.limits` | **改**：全部变成配置项 |
| `ownerRules` | 注入在最前、管理员私聊命令修改 | local-digest「长期规则」区 | 保留机制；记忆页只读展示 + 说明入口 |
| `socialV2.tools.handoverMemory` | 切 agent 时带私聊记忆 | `memory.handover.enabled` | **迁**：默认仍 true |
| `socialV2.tools.memory` | `qq_memory_append/query/remove/clear` | `local-digest.tools.*` | **迁** |
| 二代仿真页「轻量记忆」组 | 查看/清空调试面板 | 记忆页「本机轻量记忆」 | **迁**：原处直接移除，不留提示或链接 |
| 插件页「内置注入块」 | digest 开关/上限 | 记忆页「注入」卡 + 记忆块行 | **迁**：块表保留 `core-memory` 一行（上限随记忆页），不再列 `core-digest` |
| `qq_get_prompt` / `peekView` | 返回 `formatMemoryV2` | 不变 | 保留，改读 provider 输出 |

## 6. 分阶段计划

| 阶段 | 内容 | 关键文件 | 完成判据 |
| --- | --- | --- | --- |
| S1 块注册表归一 | 块记录补 `owner` / `label` / `priority` / `maxChars` / `truncated` / `skipped`；`status()` 输出统一形状；控制台块表改表格 | `src/plugins/prompt-blocks.mjs`、`src/bridge.js`（`registerCoreBlocks` / `/api/plugins`）、`pages/plugins/fields.js` | 块表显示 owner/优先级/上限/最近字数/状态；关块后整段消失且预算回收；`node scripts/test-prompt-blocks.mjs` 全过 |
| S2 记忆 provider + local-digest | `memory` 注册表（与内核同构）、`core-memory` 块、`memory.*` 配置与兼容读、上限参数化、注入切换、状态端点 | `src/memory/registry.mjs`（新）、`src/bridge.js`、`config.json` 归一化 | 关 local-digest 后提示词无记忆段；改 `maxChars=400` 后段被截断且状态显示 `truncated`；旧 `promptBlocks['core-digest']` 配置读入后行为等价 |
| S3 soulkit provider | 插件 `plugins/soulkit-memory/`：`/api/recall`、`(key,query)` 60s 缓存、预热、失败静默、状态上报；权限 `memory:provide` + `net:http` | `plugins/soulkit-memory/`、`src/plugins/host-api.mjs`、`src/plugins/kernel.mjs` | soulkit 停机时唤醒 <1s、记忆段为空、其它块正常；开起来后记忆段出现且字数 ≤ 上限；缓存命中不重复请求 |
| S4 查询工具 | `qq_memory_recall` / `qq_memory_note` + 联邦 + 审计 | `src/bridge.js`、preset 工具表 | 不跨会话；note 关闭时工具不暴露；recall 结果带来源 |
| S5 写回与收尾 | `/api/ingest` 队列（默认关）、记忆页完整化、文档与偏差登记 | `src/memory/ingest.mjs`（新）、`pages/memory/` | ingest 关闭时无外发请求；打开后队列可观测；记忆页四项开关生效 |

每阶段收尾固定动作：`node scripts/test-console-static.mjs`、`PLAYWRIGHT_MODULE=playwright-core node scripts/test-console-ui.mjs`、`npm run test:audit`、更新 `STATUS.md` 与 `PLAN_DEVIATIONS.md`、一阶段一提交。

**实施进度**：S1 已完成（提交 `094a251`）；S2 已完成（`src/memory/registry.mjs` + `core-memory` + `memory.*` 兼容读 + `/api/memory`，`test-core-prompt-blocks.mjs` 新增 memory 用例，static / UI 27/27 / audit 90/90 全过）；S3–S5 未开工。

## 7. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 唤醒变慢 | 同步优先、异步预热、900ms 超时、失败静默、缓存 |
| 两套记忆叠加（local-digest 与 soulkit） | 注入单选；记忆页显示「当前注入源」与另一源的启用状态 |
| 配置迁移写坏 | 兼容读 + 首次保存写新结构 + 保留旧键只读；迁移前后各跑一次 `test-prompt-blocks` |
| 预算仍不透明 | 每层截断写 `truncated`；控制台显示 最近字数 / 上限；默认值进配置文件 |
| 隐私外泄 | 只按 key 注入；ingest 默认关；soulkit 地址只允许环回或显式配置 |
