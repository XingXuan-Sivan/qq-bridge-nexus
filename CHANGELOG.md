# CHANGELOG

本仓库（qq-bridge-nexus）起步于 [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge) `v0.2.0-r3`，此后整体重构。
`0.1.0` 是本仓库**首个自有版本基线**；在此之前的上游时期版本号（v0.3.0 – v1.1.2）与本仓库版本线无关，
原始记录存档于 [docs/release/legacy/CHANGELOG-v0.3.0-v1.1.2.md](docs/release/legacy/CHANGELOG-v0.3.0-v1.1.2.md)。

## 0.2.0 —— 2026-11-15

平台解耦（B0–B8）、平台统一（C1–C9）、执行体通用化（P0–P6）三批并入同一条版本线。
目标：内核不认识具体平台。规格与逐批取舍见 [docs/PLATFORM_DECOUPLING.md](docs/PLATFORM_DECOUPLING.md)
与 [docs/PLATFORM_UNIFICATION.md](docs/PLATFORM_UNIFICATION.md)；执行体通用化见
[docs/EXECUTION_BODY_GENERALIZATION.md](docs/EXECUTION_BODY_GENERALIZATION.md)。

### 重构：两侧适配器（B0–B5）
- **B0 常量去 QQ**：`RUNTIME_PLATFORM`、`DEFAULT_PROMPT_VARS`、`catalog.mjs` 的 `provider` 参数化、
  `splitForQQ`/`mdToPlain` 中性命名。
- **B1 发送收口**：四处 `send_*_msg` 三元式收成 `buildSendCall(kind, id, segments) → {action, params}`，
  由桥接自己发 HTTP；段类型与降级策略接线。
- **B2 地址模型**：会话 key 支持 `@account` 与开放 type，id 一律字符串化，`withAddress()` 上下文防串号
  （旧 `qq:group:123` 原样可读，无需迁移）。
- **B3 owner 结构化**：`owner: {platform, account, id}`，准入白名单按地址；`QQ_RE` 移除，
  `cfg.ownerQQ` 降为派生视图。
- **B4 权限映射下沉**：`DSH_PERMISSION_PRESET` / `LEVEL_PERMISSION_PRESET` / `qq-agent-*` →
  `profiles/agent-platforms/dsh/adapters/runtime.mjs`；preset 改为能力档名
  （`chat / chat-v2 / readonly / workspace / full`，旧名经 `AGENT_PRESET_ALIASES` 归一）。
- **B5 运行期适配器**：新增 `src/user-side/`（注册表 + 装配点 + 中立门面 + `adapters/qq/`）与
  `src/agent-side/`（`adapters/dsh/` + `agent-client.mjs` 门面）。`src/dsh-client.js`、
  `src/platform/onebot.mjs`、`src/platform/prompt.mjs`、`src/lib/dsh-endpoint.mjs`、
  `src/lib/dsh-health.js`、`src/lib/qq-backend-label.js` 全部下沉；`bridge.js` / `self-test.js` /
  控制中心只依赖门面。新增 `scripts/test-platform-adapters.mjs`（14 条契约）与
  [docs/guides/ADD_USER_PLATFORM.md](docs/guides/ADD_USER_PLATFORM.md)。
- **两条保留的外部契约**（见 §2.5）：`src/snowluma-conn.js` 不得移动（仓库外 `voice-tool/` 按固定路径引用）；
  `bridge-extensions.js` 保留对 `qq-backend-label.js` 的一处直连（0.1.x 公开导出名与文件名均被测试钉住）。

### 重构：插件接管连接（B6）
- **中立消息段**：新增 `src/user-side/segments.mjs`（11 种段 + `degradeSegments`）。OneBot 的历史写法
  `at` / `record` 在边界处归一到 `mention` / `voice`，出口统一成 `{ type, data }`；`poke` / `ext`
  缺能力时**报错**而不是静默变成文本。
- **出站收口到底**：新增 `src/user-side/outbound.mjs`（`sendAction`）与 `src/user-side/transport.mjs`
  （插件平台注册表，带 owner）。顺序固定为「插件 `onOutbound` 改中立段 → 内核降级 → transport」，
  bridge 四处发送点（语音 / 表情 / 搜图 / 文本）各剩一行，OneBot 的动作名、参数、HTTP 与 426 提示
  全部下沉到 `src/user-side/adapters/qq/`。
- **统一事件**：新增 `src/user-side/event.mjs`（`validateUnifiedEvent`），`platform` / `account` 只取
  内核给的 origin，插件伪造会被覆盖。
- **插件内核**：`send:qq` → `send:message`（旧名按别名接受 + 加载时提示一次）、新增 `transport:provide`
  与 `onOutbound`、`ctx.message`（`ctx.qq` 为同一对象）、`ctx.userPlatforms.register`；插件平台 id
  与内置或别的插件冲突时拒绝（审计 `transport-denied`），卸载时按 2s 上限调 `close()`。
- **新增回归**：`scripts/test-unified-segments.mjs`（10）、`test-unified-event.mjs`（8）、
  `test-transport-plugin.mjs`（12）、`test-plugin-kernel.mjs` +3 条（共 20）。

### 重构：控制台元数据化（B7）
- **运行期元数据端点**：新增 `GET /api/runtime/platforms` 与 `GET /api/runtime/agent-platforms`。
  前者把**内置注册表与插件注册表合成一张表**（会话类型、能力、上限、`source`/`owner`/`active`），
  后者只读 Agent 侧注册表、不经门面（平台未装协议也能列出清单与空态）。
  与已有的 `/api/platforms` 分工不同：那条读 `profiles/platforms/`（工具目录与话术），是配置面。
- **元数据拼装点**：新增 `src/user-side/metadata.mjs`（`userPlatformMetadata` / `userPlatformDescriptor` /
  `resolveSendTarget`）与 `src/agent-side/metadata.mjs`；`runtime-registry.mjs` 与 `transport.mjs`
  开始在描述对象里带 `limits`（插件平台还可自报 `conversationTypes` / `limits`）。
- **发送地址化**：`/api/send/*` 的目标改由 `resolveSendTarget()` 产出（支持完整会话 `key`，或
  `platform` + `account` + `groupId`/`userId`）；内部 `onebotSend(kind,id,…)` 重写为
  `sendTextByKey(key,…)` 并改走 `sendAction`，修掉「按当前默认平台重建 key」的静默串号
  （`tg:group:1` 曾被发到 `qq:group:1`）。`@` 目标的数字号校验下沉到 `adapters/qq/segments.mjs`。
- **控制台**：新增 `public/console/js/platforms.js`（前端唯一读元数据的地方，含中文标签表），
  `app.js` 顶层预热；会话页的平台下拉、类型下拉、平台/类型标签全部查表，类型筛选改为
  「平台声明类型 ∪ 会话出现类型」（插件平台声明 `channel`/`thread` 就自动多出对应项）；
  记忆页的平台列/筛选/类型文案也改为查表；准入名单正则放宽为可带 `平台@账号:类型:id`；
  概览/配置/会话/记忆/运维页的「QQ」文案改为「会话」。
  唯一例外是**行为档案页的平台下拉**：档案存在 `profiles/platforms/<id>/behaviors/`，所以它读配置面的
  `/api/platforms` —— 运行期注册表里有平台不等于有档案目录。
- **新增回归**：`scripts/test-platform-metadata.mjs`（11 条，含插件并入同表、类型别名校验、
  Agent 元数据不泄露 `protocol`）；`test-platform-adapters` 的键集断言同步加 `limits`。

> B7 的两个设计取舍（详见规格 §6.1）：端点改名是为避开 `profiles/platforms/` 的配置面；
> `resolveSendTarget()` 的类型校验只认**已知别名**，不用 `shapeOfType()` 兜底 ——
> 否则「平台声明了 `group`」会变成「`channel` / `thread` 也放行」。

### 重构：社交模型词汇（B8）
- **容器词统一叫「会话」**：`src/social/group-events.js → conversation-events.js`、
  `cross-group.js → cross-conversation.js`、`group-rules.js → conversation-rules.js`；新增
  `src/social/conversation-config.js`（`continuity.conversations` 与旧键 `continuity.groups` 的**唯一**双读处，
  只读不写回）。导出同步改名：`checkCrossConversation` / `validateOwnerConversationAccess` /
  `CONVERSATION_RULE_LIMITS` / `conversationRuleResultText` / `conversationRuleNoticeText` /
  `reconcileConversationMembers` / `conversationRecordable` / `normalizeConversationId`；`bridge.js` 的成员事件与
  成员对账改用 `ev.conversationId`。
- **数据升到 v2**：`state/social/people.json` 里人物下的 `groups` 与顶层对账基线都改为 `conversations`；
  加载 v1 文件时自动迁移（先写 `pre-migrate-v1` 备份、**键换值不动**、`status` 仍是 `member | left`）。
  `continuity.groups` 属于配置，双读兼容、两边都有时合并，但不回写。
- **API 字段换新 + 旧名别名**：`targetGroupId` → `targetConversationId`（入站先读新名再回落旧名；
  `/api/socialV2/cross-group` 的响应把两个都回显一次）；端点**路径**不改名。
- **提示词与文案中性化**：`[入群]` → `[加入]`（修 bug：事件流早已写 `[加入]`，唤醒提示词却让模型去未读里
  找 `[入群]`）、本群 → 本会话、跨群 → 跨会话、「在另外 N 处见过」。
  `scripts/fixtures/wake-prompt-golden.json` 重生成，diff 只剩这两行词汇变化。
- **一处行为放宽**：`checkCrossConversation()` 改用 `isGroupKey()` 判「会话形状」而不是 `kind === 'group'`，
  `channel` / `thread` 形状的会话也能发起受控跨会话查询；QQ 部署下两种判法等价。
- **明确不改**（协议/文法/契约面）：OneBot 的 `group_id` / `send_group_msg` / `getGroupMemberInfo` /
  `group_increase|decrease|card|recall`、会话 key 的 `qq:group:<id>` 段、关系状态 `member|left`、
  `notes[].scope` 的 `group:<id>`、配置键 `crossGroup` / `allow.groups` / `ownerGroupAccess` / `ownerRelay`、
  `qq_*` 工具名与 `crossgroup.query` 审计键、人物库的 `members` 字段。边界表见规格 §6.2。
- **新增回归**：`test-continuity.mjs` +2（people.json v1→v2 真迁移；`continuity.conversations` 新/旧键双读，共 28 条）；
  `test-group-rules.mjs → test-conversation-rules.mjs`（+ 旧字段名仍 200，共 7 条）；`test-integration-v030.mjs`
  新增 owner-relay 旧名与 cross-group 双回显断言（共 21 条）；`test-owner-relay` / `test-session-proactive` /
  `audit-bridge-harness` 注入表同步。

### 修复
- 审计夹具的 Agent 地址发现改为离线桩（旧名 `resolveDshBaseUrl` 改名后未同步，导致 bridge 落到真实现、
  每次启动扫本机进程多花约 0.8 秒，`test-backfill` 的 2 秒容差断言因此随机失败）。

### 重构：平台统一注册表（C1）
- **新增 `src/platforms/registry.mjs`**：把四类来源（`profiles/platforms/<id>/`、`profiles/agent-platforms/<id>/`、
  用户侧运行期注册表、Agent 侧运行期注册表）合成**一张表**。`buildPlatformRegistry()` 是纯函数（可离线喂
  输入测），`platformRegistrySnapshot()` 只负责取事实。条目形状：`side` / `source(builtin|plugin|profile-only)` /
  `active` / `capabilities` / `conversationTypes` / `limits` / `inbound` / `configSchema` / `config` /
  `assets{prompt,tools,behaviors,capabilityProfiles,agentPresets}`（C4 起删掉 `agentPresets`，见下）。
- **7 个诊断码**（`capability_missing` / `config_invalid` / `active_unregistered` / `inbound_unsupported` /
  `profile_only` / `probe_failed` / `id_conflict`）与 error/warn 两级；输入不合法时**不抛错**，只降级成诊断 ——
  平台没连上时控制台也要能画出表和问题。
- **`GET /api/platforms/registry` 成为平台清单的唯一数据源**：删除 `GET /api/platforms`、`GET /api/platforms/:id`、
  `GET /api/runtime/platforms`、`GET /api/runtime/agent-platforms`、`GET /api/runtime/adapters` 与 `/api/runtime`
  响应里的 `adapters` 字段（旧端点不留投影）。
- **`src/platforms/index.mjs`**：`listPlatforms()` 补上 `prompt{active,hasDefault}` 与 `configSchema`；
  新增 `listAgentPlatformDirs()`（`capabilities/` + `agents/` 目录名 + 有无 `adapters/runtime.mjs`）。
- **`src/user-side/metadata.mjs`**：`describePlatform()` 增加 `inbound` 布尔（`connect` 是否存在）。
- **`src/runtime/adapters.mjs`**：删除没人用的 `snapshot()`（`platformVars()` 仍服务提示词渲染，C2 搬进
  `platform.yml` 后再整份下线）。
- **控制台**：`js/platforms.js`、`components/platform-panel/`、`pages/behavior/`、`pages/runtime/` 四处消费点
  改读统一注册表并按 `side === 'user'` 过滤；平台面板不再发第二次 `/api/platforms/:id` 请求，表格列改吃
  `assets`，只能出不能收的平台显式标「只出不进」。
- **新增回归**：`scripts/test-platform-registry.mjs`（12 条：两侧真实快照、qq 条目资产、五个诊断码、
  summary 计数自洽）；`scripts/console-ui-fixture.mjs` 的三份旧 mock 合并为一份注册表 mock。
- **门禁**：`verify:repo` 新增「平台清单只有 `/api/platforms/registry` 一个端点」「控制台不消费旧平台端点」
  两条断言；`test-runtime-adapters` 的 `snapshot()` 用法改为 `list()`。

### 重构：配置 v2 与 `active` 生效（C2a）
- **新增 `src/config/platforms.mjs`**（纯函数，不读写盘）：`config.json` 的 `platforms` 段成为唯一真源——
  `{ configVersion: 2, platforms: { active: {user, agent}, users: {<id>: {account, transport, options}},
  agents: {<id>: {endpoint, options}} } }`。字段归属靠白名单 `USER_TRANSPORT_KEYS`(8) /
  `AGENT_ENDPOINT_KEYS`(6)，白名单外一律进 `options` —— 加一个业务选项不需要改这个文件。
- **一次性迁移**：`platform.*` / `snowluma.*` / `dsh.*` 三个顶层键迁进 `platforms` 后**删除**并写
  `configVersion: 2`；迁移前备份 `config.json.bak-<YYYYMMDD-HHmm>`。**不留别名双读**（v2 从 0.2.0 起生效、
  没有需要长期兼容的外部配置；`snowluma-conn.js` 的 `userTransportView()` 也随之不再认旧 `snowluma` 段）。
- **内核派生视图**：`cfg.platform`（`{id, account}`）+ `cfg.userPlatform` / `cfg.agentPlatform`（扁平投影），
  全仓 `cfg.snowluma` / `cfg.dsh` 改为二者之一；`platformViews()` 是唯一拍平点，`transport/options/endpoint`
  三段不外泄（注册表端点与控制台表单吃 `flatPlatforms()`）。
- **`configViews(raw)`**：凡自己 `JSON.parse` config.json 的地方（独立脚本、`mcp-*` 侧进程、探针、控制中心）
  统一走它（先迁移再取视图）——否则 v1 文件会被读成空表。入参是**解析后的配置对象**，不是文件路径
  （传路径会被当成空配置、静默返回空表）。
- **`platforms.active` 真的生效**：新增 `src/platforms/activate.mjs`，`main()` 里在 `configureKeys` **之前**
  两侧各自 `use*Platform(id)`，id 不可用时 **fail-closed** 并列出已注册 id。此前 `platformOfConfig()` 只用于
  拼会话 key，从未切平台 —— 「改配置换平台」因此一直没有效果。
- **写盘收口**：控制台模型选择 / token 自愈 / 控制中心目录切换三条路都经 `patchPlatformConfig()` +
  `platformsForWrite()`，写前一律 `migrateConfigToV2()`。修掉一个**数据丢失** bug：v1 文件上只改一个 token，
  原本会把 `wsUrl` / `httpUrl` / `homeDir` 一并写空。
- **修掉 token 自愈在 v2 下静默失效**：`snowLumaHomeCandidates` / `discoverSnowLumaConnection` 原按
  `cfg?.snowluma ?? cfg` 取参，v2 下退化成整个 cfg，`homeDir` / `accessToken` 全空且无任何报错。
- **`config.example.json`** 改为 v2；`src/mcp-snowluma-safe.js`、`src/mcp-host-server.js`、`src/self-test.js`、
  `src/snowluma-conn.js`、`src/launcher/control-center.mjs` 与 10 个脚本的读取点全部改扁平视图。
- **新增回归**：`scripts/test-config-v2.mjs`（15 条：分法 / 迁移 / 幂等 / 脏输入 / 扁平投影）、
  `scripts/test-platform-activate.mjs`（5 条：假注册表 + 真实注册表，含 fail-closed 与「失败不改坏当前平台」）；
  `test-audit` 挂上两个脚本，`audit-bridge-harness` 注入 6 个配置符号 + `activatePlatforms` 桩。
- **审计夹具补齐新依赖**：`test-qq-model-view` 的临时夹具只拷「被启动的那几个文件」，新增的依赖
  `src/config/platforms.mjs`（纯函数、无依赖）也要一并带上，否则子进程 import 失败直接退出（表现为
  `MCP error -32000: Connection closed`）；`test-audit-security-mcp` 用 VM 剥掉 import，需注入 `configViews`。
- **参数名纠正**：`migrateConfigToV2` / `readPlatforms` / `configViews` 的入参从 `file` 改为 `raw` ——
  它们接收的是 `JSON.parse` 后的配置对象，传文件路径会被当成空配置、静默返回空表。

### 重构：两侧声明面搬进平台目录（C2b）
- **`profiles/platforms/qq/platform.yml` 带 `vars` + `configSchema`**：`vars`（`platform` / `displayName` /
  `owner`）供 `prompt.md` 与能力预设渲染占位符；`configSchema` 声明该平台的配置项（`httpUrl` / `wsUrl` /
  `accessToken` / `followDiscoveredEndpoint` / `viaPlatform` / `silenceWarnMs` / `launcherPath` / `homeDir` /
  `account`）。`profiles/agent-platforms/dsh/agent-platform.yml` 同据声明 `baseUrl` / 鉴权头 / `provider` /
  `model` / `reasoningEffort` / `vision` 等。两者字段都是**扁平**的（配置 v2 的 `transport` / `endpoint`
  在校验前拍平），`additionalProperties: true` 且不设 `required` —— 行为选项不穷举、未配置不算错。
  校验复用 `src/plugins/config-schema.mjs`，不引完整 JSON Schema 依赖。
- **删除 `src/runtime/adapters.mjs`**（§4.4 删除清单）：不再有硬编码的 QQ/DSH 清单与「取第一个平台
  适配器」的 `platformVars()`。插件注册通道（`adapters:provide`）迁到 `src/platforms/adapter-registry.mjs`，
  只登记描述；同 id 插件的 `vars` 覆盖 `platform.yml` 的取值。
- **提示词变量收敛到一处**：`PROMPT_VAR_KEYS` / `normalizePromptVars()` 搬进 `src/runtime/prompt-compose.mjs`
  （声明面与插件适配器共用同一份白名单，避免「某条路径渲染了、另一条没渲染」）。
  `listPlatforms()` 带出 `vars`，`bridge.js` 的 `platformPromptFor()` / `selfIdentityTextV2()` 改为按平台
  id 现取（快照缓存，与旧内置清单同样是静态语义）。
- **修 `platformPromptVars()` 仍读 v1 `config.platform.id`**：`profiles/agent-platforms/dsh/adapters/build.mjs`
  改为 `configViews()` 取 `platforms.active.user`，变量再读 `platform.yml` 的 `vars`（退回 `label`）——
  此前产物里的 `{platform}` 在 v2 配置下会永远渲染不出来。产物逐字节不变（`verify:artifacts`）。
- **控制台「运行方案」摘要**改用 `/api/platforms/registry` 的当前平台与 Agent 平台名；夹具不再伪造
  `/api/runtime/capabilities.adapters`（该字段 C1 已删）—— 摘要原来恒显示「未注册」。
- **新增回归**：`scripts/test-platform-adapter-registry.mjs`（6 条：注册表语义、`vars` 在 `platform.yml`
  且能渲染、两侧 `configSchema` 能过统一校验器、内核不再持有内置清单）；原 `test-runtime-adapters.mjs` 删除。
  `test-audit-setup` 的沙箱补拷 `src/platforms/index.mjs` 与 `src/config/platforms.mjs`（build 适配器的新依赖）。

### 重构：能力模型归一（C4）
- **能力档吸收预设**：`profiles/agent-platforms/dsh/capabilities/<id>.yml` 成为 Agent 侧**唯一**档位真源，一段文件四段内容——
  `tools`（平台/Agent 模块/MCP/技能）、`preset`（name/description/order/behavior）、`rows`（DSH 插件行）、`extensions`（MCP/技能授权）。
  **能力档 id 就是 preset id**：`chat` / `chat-v2` / `readonly` / `workspace` / `full`（原 `agent-chat` / `agent-readonly` /
  `agent-workspace` / `agent-full` 去掉 `agent-` 前缀；`chat-v2` 按拍板结论**保留独立档位**，不并进 `chat`）。
  `src/capabilities/store.mjs` 的 `normalizeCapability()` 是唯一归一入口，`decorate()` 补 `builtin` / `platformVisible` /
  `agentModules` / `hasRows` / `rowsCount`。
- **删除 `profiles/agent-platforms/dsh/agents/` 与 `assets/default-presets/`**：5 份 `agent.cordis.yml` + `preset.yml`
  手工源与 5 份 549B 的 `qq-tool-restrict.mjs` 转达薄壳一并移除（权威实现仍是
  `artifacts/dsh/qq-agent-presets/qq-tool-restrict.mjs`）。`agent-platform.yml` 的 `agents:` 与
  `profiles/schemas/agent-platform.schema.json` 的 `required.agents` 同步删除，不再留有指向已删目录的悬空键。
- **预设改渲染产物**：`adapters/build.mjs` 从能力档的 `preset` + `rows` 渲染
  `artifacts/dsh/qq-agent-presets/presets/<id>.patch.yml`，子插件名必须是 bundle 包名裸说明符
  （`qq-agent-presets/qq-tool-restrict.mjs`）；相对/绝对名直接构建失败，产物逐字节不变（golden）。
- **方案去 `agent` 字段**：`profiles/plans/*.yml` 只留 `capability`；`src/runtime/plans.mjs` 的
  `normalizePlan()` 缺 `capability` 直接报错、`legacyModeOfPlan()` 按 `capability` 判定，12 处引用同步改完。
  控制台方案编辑器同步去掉 agent 下拉（`#runtimeEditTools` 的选项就是能力档，PATCH 路径
  `/api/runtime/capabilities/<id>` 的 id 也是能力档 id）。
- **统一注册表去重**：`assets.agentPresets` 与 `assets.capabilityProfiles` 原来是同一串值的两份拷贝，删除前者，
  由 `test-platform-registry` 钉住「不得再出现」。
- **测试与夹具跟上新契约**：`test-audit-setup` 的沙箱补拷
  `src/capabilities/store.mjs` / `src/profiles/paths.mjs` / `src/tools/catalog.mjs`（build 适配器的新依赖链）；
  `audit-bridge-harness` 的 VM 注入表补 `YAML` 与 `normalizeCapability`（剥掉顶层 import 后靠注入补齐，否则
  只有真走到预设编辑器分支才报 `X is not defined`）；`test-tool-catalog` 改为五个内置能力；
  `test-runtime-plans` / `test-platform-registry` / `test-console-ui` 按新契约重写断言；
  `console-ui-fixture` 的假数据对齐真实响应形状（能力档列表、`PATCH` 返回 `{ok, capability}`、方案去 `agent`）。
- **删一次性迁移脚本**：`scripts/migrate-prompt-layers.mjs`（输入目录已不存在，迁移结果早已是现行源）。
- **文档同步**：`PROFILES_MODEL.md`（§三 能力档整节重写）、`FOLDER_MAP.md`、`EXTENSION_PLATFORM.md`、
  `INJECTION_PROFILE_CONFIG.md`、`guides/DSH_SETUP.md`、`guides/SECURITY_BASELINE.md`、`AGENT_PLATFORM_EVOLUTION.md`、
  `PLATFORM_UNIFICATION.md`（§2.2 / §4.2 / §4.4 / §七 / §九 标注 C4 已落地）与 `README.md`。
- **门禁**：`test:audit` 126/126；`test-capability-unify` 17 条红线；`build-artifacts --check` 与 golden 逐字节一致；
  `test-console-ui` 全 PASS（含无 JS 报错 / 无未知 API 路由）；`verify:repo` 75 通过 0 失败。

### 重构：用户侧入站接通（C3）
- **QQ 适配器新增 `connect()`**：`src/user-side/adapters/qq/inbound.mjs` 只做「OneBot 报文 → 统一事件」，
  并负责订阅与退订。三个细节值得记住：`onMessage` 优先于旧 SDK 的 `onPrivateMessage`/`onGroupMessage`；
  两个分类型回调**不能共用同一个函数引用**（SDK 内部用集合存监听器，共用会变成「私聊能收、群聊收不到」）；
  同一进程只允许一条入站订阅，重复 `connect` 先摘旧的。
- **翻译必须全函数**：`normalizeSegment` 对未知段类型抛错，而 `face` / `json` / `xml` / `share` 在真实 QQ 消息里
  极常见，因此未知段一律降成占位文本（`[表情]` / `[卡片消息]` …）。把整条消息判成 INVALID 是最坏的降级方式。
- **收消息只剩一条路**：`bridge.js` 删掉 `bot.onPrivateMessage` / `bot.onGroupMessage` 两个订阅，改用
  `configureUserPlatformInbound(() => bot)` + `createInboundPipeline({origin, admit, resolve, deliver, onDrop})` +
  `startUserPlatformInbound(...)`。管线顺序固定为 `校验 → 准入 → 会话映射 → 唤醒`（校验必须在准入之前，
  否则插件能看到未准入会话的正文）；准入仍保留「管理通道先于白名单」，`deliver` 仍传 `ext.raw`，下游业务体
  吃到的报文形状留到 C5。`shutdownThenExit()` 先摘订阅再退出。
- **门面对称**：`user-platform.mjs` 新增 `configureUserPlatformInbound` / `startUserPlatformInbound`（后者在平台
  没有 `connect` 时返回 `null`），`builtin.mjs` 同步转发给 QQ。`bridge.js` 仍不 import `adapters/`（`verify:repo` 钉）。
- **只发不收的平台仍合法**：显式报 `inbound_unsupported`（warn），不再静默地“看起来能用”；QQ 在 C3 之后
  不再触发该诊断，控制台夹具的 mock 平台同步改为 `inbound: true`（`diagnostics: []`、warnings 归零）。
- **测试**：新增 `scripts/test-qq-inbound.mjs`（14 条：群/私聊翻译、秒→毫秒、自消息过滤、陌生段降级、
  CQ 字符串、订阅/投递/退订/状态、旧 SDK 分订阅、重复 connect、signal 已中止、`onEvent` 抛错不拖死后续、
  翻译不判准入）；`test-transport-plugin.mjs` 增 mock 平台端到端「收 → 校验 → 准入 → 会话映射 → 唤醒 → 发」；
  `test-platform-registry.mjs` 把「qq 只能出不能进」的条件用例改写为「能收」+ 新增「只实现发送的平台仍报
  `inbound_unsupported`」；`audit-bridge-harness.mjs` 的源码切片锚点从 `bot.onPrivateMessage` 改到
  `configureUserPlatformInbound(() => bot);`。
- **文档同步**：`PLATFORM_UNIFICATION.md`（状态改 `C0–C4 已完成`、§六 C3 进度改第二批已完成、§九 C3 行标完成、
  诊断表 `inbound_unsupported` 注脚）、`FOLDER_MAP.md`（`user-side/inbound.mjs` 与 `adapters/qq/inbound.mjs`）、
  `guides/ADD_USER_PLATFORM.md`（§二 三步改四步并补 `connect` 示例、§三 新增「入站只翻译不判准入」不变式、
  §五 改为已接通）。
- **门禁**：`test:audit` 128/128；`test-qq-inbound` 14/14；`test-transport-plugin` 15/15；`test-platform-registry` 13/13；
  `test-console-ui` 34/34；`test:v030` 四项、`build-artifacts --check`、`check-profiles`、`verify:repo` 75 条全过。

### 重构：AgentPort 契约（C5 第一批）
- **新增 `src/agent-side/port.mjs`**：中立操作契约——`AGENT_PORT_GROUPS` 把方法按**能力位**分组
  （`session` / `rename` / `permission` / `models` / `settings` / `workspace` / `maintenance`），
  `AGENT_PORT_CORE_METHODS`（`probe` / `listSessions` / `ensureSession` / `prompt` / `cancel`）是任何平台都必须实现的。
  `createAgentPort()` 把实现包成冻结对象：**未声明的能力方法仍然存在，但调用时抛
  `AgentCapabilityError`（`code: 'capability_unsupported'`）** —— 这样报错能说清缺哪个能力，
  而不是让调用方撞上 `TypeError: not a function`（那种错分不清平台不支持与名字写错）。
  同时导出 `AGENT_EVENT_KINDS`（§5.2 的归一事件 kind）与 `normalizeSessionRef()`（接受裸
  `sessionId` 或 `{instance, sessionId}`，第二批落盘统一成后者）。
- **新增 `src/agent-side/adapters/dsh/port.mjs`**：DSH 实现。每个动词落到哪个 RPC 都有注释：
  `probe` → `settings/describe`、`listSessions`/`ensureSession`/`prompt` → `sessions/*`、
  `cancel` → `stopSessionWork`、`archiveSession` → `workspace/archiveSession`、
  `renameSession` → `callUnary('session/rename')`（旧 SDK 的 sessions 门面没有它）、
  `listModels` → `session/modelCatalog` 并保留 `session/models` 回落、
  `listPresets`/`listPermissionPresets` → `agentPresets/list` 与 `permissionPresets/catalog`。
  **不判断策略**：`applyPermission` 只交回未判定的回执，“成不成”留给桥接的 `permissionCommandSucceeded`
  （否则平台与内核会各有一套判定，漂移时最难查）。
- **两处方案补全**（实施时发现原表漏了）：`agentPresets/list` 与 `permissionPresets/catalog`
  归入 `session` / `permission` 能力位；**DSH 不声明 `maintenance`** —— 0.2.0 的 API 里没有
  「重建/自愈会话」RPC（桥接现在的重建是「停止 + 归档 + 新建」组合），声明了会让控制台画出
  不存在的按钮。
- **声明面能力位与 port 能力位对齐**：`profiles/agent-platforms/dsh/adapters/runtime.mjs` 的
  `capabilities` 改为 `['session','rename','permission','models','settings','workspace','events','compact']`
  —— 除 `events`（事件流订阅，不是调用面）外都与 port 同名，`maintenance` 故意不声明（DSH 没有
  重建/自愈的 RPC）；`prompt` 不进榜（它是核心方法，不是可关掉的能力位）。两者的一致性由 `test-agent-port` 钉住。
- **门面对称**：`agent-client.mjs` 新增 `createAgentPort`（经 registry 的 `protocol.createAgentPort`），
  `builtin.mjs` 把 `adapters/dsh/port.mjs` 合并进 protocol。`bridge.js` 的调用面已在第二批迁完
  （见下两节）；`state/sessions/*.json` 的 `agentRef` 落盘格式已在第三批统一。
- **测试**：新增 `scripts/test-agent-port.mjs`（19 条）：能力位 fail-closed、声明了没实现要在建 port 时炸、
  未声明方法仍存在、返回值冻结、会话引用归一、事件 kind 表、DSH 每个动词落到哪个 RPC、
  探活失败不抛错、权限只转发不判定、缺 `commands.execute` 时报能力缺失、`respondPermission` 缺 id 报错、
  模型目录回落只看 `not found` 一类错误、`readSettings` 不传 ns 给原始表。`console-ui-fixture` 的 mock
  平台能力列表同步改名。
- **门禁**：`test-agent-port` 19/19（第二批扩到 21 条）；`test-platform-adapters` / `test-platform-registry` /
  `test-console-ui` / `verify:repo` 75 条全过（第二批后 77 条）。

### 重构：AgentPort 调用面迁移（C5 第二批）
- **`bridge.js` 55 处调用面全部改走 `agentPort.*`**：`unwrap()` 18 处清零。`api.sessions.*` /
  `api.workspace.*` / `api.settings.*` / `api.respond` / `api.stopSessionWork` / `api.callUnary` /
  `api.agentPresets.*` / `api.permissionPresets.*` / `api.commands.execute` 在本文件里彻底消失。
  保留下来的是两类「不是对会话做什么」的调用：`api.setBaseUrl`（端点重识别属于「怎么连」，
  地址与凭据的绑定只有客户端自己知道）与 `api.events.follow/forget/mux`（事件流订阅，属传输层；
  归一事件在消费侧翻译，而「订阅哪几条会话」没有平台无关的等价物）。
- **port 补两个真实缺口**（不补就只能让平台操作继续留在 bridge 里）：`permission` 组加
  `readPermission`（`/permission` 无参**只读核对**，与 `applyPermission` 分开——外部漂移检测
  绝不能因为一次核对就把权限写回去）；新增 `compact` 组（`compactSession` → `/compact`）。
  能力位从 6 个变 7 个：`session` / `rename` / `permission` / `models` / `settings` / `workspace` / `compact`。
- **返回值形状统一**：语义字段是**已解包**的，`raw` 永远是平台**原始响应**。原实现不一致
  （`listModels.raw` 是原始响应、`listPermissionPresets.raw` 是解包值），现在一致。
  `listModels()` 返回 `{catalog, raw}`，`unwrap` 放在「回落判断之外」——只有老版本回 `not found`
  才回落 `session/models`，`ok:false` 是真故障不能吞。`applyPermission` 交回 `{value, raw}`：
  `value` 是解包回执，判定仍归平台档的 `permissionCommandSucceeded`（port 只拆包、不判定）。
- **回执解析下沉**：`/permission` 的 `current preset <x>` 正则从 bridge 搬进
  `adapters/dsh/port.mjs`（`CURRENT_PRESET_RE`），bridge 只比较 `preset` 值；`/compact` 的
  `kind` / `text` 解析同理。平台回执长什么样，只有适配器该知道。
- **`probe()` 语义翻译**：`agentPort.probe()` 是查询语义（失败返 `{ok:false, detail}` 不抛），
  而 `createDshProbe` 要「抛错即失败」，bridge 里包一层 `if (!r.ok) throw`；
  「什么算不可用」的政策仍留在 `src/upstream/dsh-probe.mjs`。
- **`self-test.js` 与 `session/reset.mjs` 同步迁移**：`selfTestApi` → `selfTestPort`；
  `reset.mjs` 只认中立动词 `cancel` / `archiveSession`——平台把「取消回合」叫什么都不影响清理序列。
- **新增门禁（`verify:repo` 两条）**：内核（`src/` 下除 `adapters/` 与用户侧）不得出现
  `api.<平台动词>`；`api.setBaseUrl` 只能在 `bridge.js` 出现一次。光靠「不 import 适配器」守不住：
  客户端对象上就挂着 `sessions` / `workspace`，写一行 `api.sessions.list()` 同样能跑通，
  而能力闸门与解包约定全被绕过——这种写法在测试里看不出异常，只有换平台时才爆。
- **测试夹具**：`audit-bridge-harness.mjs` 注入**真** `createAgentPort`（假 api 的方法名与 DSH 同名，
  `createDshPort` 直接吃得下），并补 `workspace.rename` 桩；`test-agent-port` 21 条（新增
  `readPermission` / `compactSession` 两个用例与返回值形状断言）；`test-session-reset` 改
  `cancel` / `archiveSession(sid)`；`test-dsh-endpoint` 的探活断言改到 `AgentPort.probe`。
- **门禁**：`test:audit` 129/129 脚本、`verify:repo` 77 条、`test:console-ui` 34/34、
  `build-artifacts --check` 逐字节一致、`test:v030` 四项、`test:artifact-pipeline`、
  `check-profiles`、`verify:persona` 全过。

### 重构：会话引用去平台化（C5 第三批）
- **落盘形状换成 `binding.agentRef: { instance, sessionId }`**（内存里的 `state.sessions[key]`
  同形）。只存裸 id 时，「这个会话归谁」根本不在数据里：换平台后同一个字符串在另一个平台可能
  恰好存在，映射会**意外命中**，两个平台的上下文串在一起；不存在则每条消息撞 404，看起来像
  「会话易失」。`instance` 记的是产生这个 id 的平台（`dsh` / 未来的 `acp:claude`）。
- **读侧零改动**：`createSessionRegistry` 的 `get` / `ids` / `entries` / `raw` 仍产出裸
  `sessionId`（`src/bridge.js` 里四十多处调用点一行没动），需要知道归属时用新增的
  `ref(key)` / `instanceOf(key)`。形状的知识只留在 `src/session/{ref,registry}.mjs`。
- **老数据不写一次性迁移脚本**：`src/session/ref.mjs` 把裸 id / `binding.sessionId` 读成
  `{ instance: '', sessionId }`（空 = 未知），平台装好后 `sessions.normalizeAll()` 把它认领成
  当前平台并落盘（只补空值，**不覆盖**已明确的归属——那可能是上一个平台留下的，覆盖掉就等于
  伪造）。这样升级后第一条消息还能接上旧会话（不丢上下文），而这个窗口只存在一次启动。
- **跨平台引用判废两处**：`ensureSession` 的复用分支与休眠恢复（`dormant.instance`，
  `normalizeDormant` 同步保留该字段）。判废时**不向当前平台**发 `cancel` / `archiveSession`：
  那边根本没有这个会话，发过去只能换回一条 404 噪声，还会把「平台换了」伪装成「会话丢了」。
- **修一个真实的安全面 bug**：`pinSessionPermission` 里写的是 `sessions.get(key)?.sessionId`，
  而 `get()` 一直返回裸 id —— `?.sessionId` 恒为 `undefined`，于是**不传 `explicitSessionId`
  的调用全部静默跳过**：`clearFullGrant` 的授权过期回收、owner 用 `/permission` 命令改级别、
  控制台的 profile / grant-full / revoke-full。表现是「授权过期了但 DSH 侧还是 full」。
- **`bindSession` 不传 policy 时不再写 `undefined`**：落盘会丢字段、读回是 `null`，导致
  「指纹恰好为空」的会话被判成同一个；现在缺省表示「指纹由调用方紧接着 `setPolicy` 写」。
- **新增门禁（`verify:repo` 三条，77 → 80）**：`state.sessions` 的直接读写只允许出现在会话归一层
  （`registry` / `directory` / `reset`）；档案里不得再出现 `binding.sessionId`；`sessions.get()`
  之后不得再取字段（它返回裸 id，上面那个 bug 正是这么来的）。这些回退都不报错，只在换平台、
  会话复用或权限回收那条路径上表现出来。
- **测试**：`test-session-registry` 7 → 11 条（归一、`ref`/`instanceOf`、`normalizeAll` 认领与
  幂等、不覆盖已明确归属、指纹不被 `undefined` 抹掉）；`test-session-lifecycle` 4 → 6 条
  （裸 id 照常复用、跨平台引用判废且不归档旧平台会话）；`test-session-directory` 改断言为 ref 形状
  并钉住「装载期不认领平台」；读 `h.state.sessions[...]` 的 `test-mode-handover` /
  `test-agent-token-guard` / `test-backfill` / `test-sticker-describe` 改经 `sessionIdOf()`
  （后者原来是 `Object.values(...).includes(sid)`，形状变了会变成恒真）。
- **门禁**：`test:audit` 129/129 脚本、`verify:repo` 80 条、`test:console-ui` 34/34、
  `build-artifacts --check` 逐字节一致、`test:v030` 四项、`test:artifact-pipeline`、
  `check-profiles`、`verify:persona` 全过。

### 重构：ACP 适配器（C6，第二个 Agent 平台）
- **契约中立化（C6-a）**：`AgentPort.prompt()` 的返回从「平台信封」改成 `{ ok, isCommand, commandText, error, raw }`。
  `bridge.js` 六处调用点原本读 `accepted.result.ok` / `accepted.result.value.command` —— 那是 DSH 的包形状；
  现在 DSH 与 ACP 各自在自己的适配器里拍平，内核不认识任何一个平台的包。`isCommand` 是独立字段：
  ACP v1 的 `session/prompt` 只有 `stopReason`、没有命令回执，但内核不能因此假定「所有平台都不支持命令」。
- **能力位延迟求值（C6-b）**：`createAgentPort({ capabilities })` 接受函数形态且**不缓存**。
  ACP 的能力位来自 `initialize` 回执，装配那一刻还不存在；常量形态仍在构造时校验（拼错能力名 / 声明了没实现
  必须启动即暴露）。
- **stdio 传输（C6-c）**：新增 `src/agent-side/adapters/acp/client.mjs` —— NDJSON 编解码 + JSON-RPC 双向分发
  （`pending` 等响应 / `handlers` 收反向请求）+ 子进程生命周期。与 DSH 的根本差异是**谁是 server 反过来了**：
  Agent 会反向发 `session/request_permission`，不回它 Agent 就永远卡在那一步，所以有 `DEFERRED`（先不回、
  稍后 `respond`）。子进程一退出，所有挂起请求立即判失败（挂到超时是最难查的一类故障）；未注册处理函数的
  反向请求回 `-32601` 而不是沉默。
- **`AgentPort` 实现（C6-d）**：新增 `src/agent-side/adapters/acp/port.mjs`（核心五动词 + `session` / `permission`
  / `models`）。三处结构差异都落在里面：
  - **受理制**：v1 的 `session/prompt` 阻塞到回合结束，不能直接 await。要么等「本会话首条 `session/update`」、
    要么等响应或宽限期（800ms）—— 先到者定局；响应一到一律补发 `turn-end`（含失败），否则内核永久判忙。
    失败分两类：JSON-RPC 错误（对端拒绝受理）→ `ok:false` 走自愈；传输级错误 → 抛。
  - **名单是会话级的**：`modes` / `configOptions` 只出现在 `session/new` 回执里。`listPresets` /
    `listPermissionPresets` / `listModels` 在任何会话都没有时建一个**探测会话**去读（只建一次）。
  - **不猜模式名、不升级授权**：决策只映射 `allow_once` / `reject_once`，**不映射 `allow_always`**；
    没有「允许一次」就回 `cancelled`，宁可拒绝也不把「只批这次」升成「以后都批」。
- **归一事件映射（C6-e）**：新增 `events.mjs`。`agent_message_chunk` → `text`、`agent_thought_chunk` →
  `reasoning`、`tool_call(_update)` → `tool`、`plan` → `plan`、`current_mode_update` /
  `available_commands_update` / `session_info_update` → `notice`、`user_message_chunk` → 丢弃。
  未知判别值**不猜也不丢**：落成 `notice(unknown-update)` 并带上原文，否则协议小版本演进时会变成静默丢消息。
- **声明面与注册（C6-f）**：新增 `profiles/agent-platforms/acp/`（`agent-platform.yml` 带
  `command` / `args` / `cwd` 的 `configSchema`、空 `tools.yml`、`capabilities/README.md` 说明为何空、
  `adapters/runtime.mjs`）；`src/agent-side/builtin.mjs` 注册第二个内置平台（排在 dsh 之后，顺序即默认 active）。
  没有 `build.mjs` / `install.mjs`：ACP 没有要渲染的产物、也没有对方的 profile 要改。
- **明确的能力取舍**：ACP v1 没有改名 / 设置 / 工作区 / 压缩 / 自愈，能力位一个都不声明，调用 fail-closed 报
  `capability_unsupported`（不造伪能力）。**未连接时能力位乐观声明、`initialize` 后按回执收缩** —— 闸门在
  方法之前执行，返回空集会锁死「唯一能做初始化的地方」（`listPermissionPresets` 永久被拒，L3 永远开不起来）。
- **装配期守卫**：`src/agent-side/agent-client.mjs` 是「连一个常驻服务」的门面（`NodeApiClient` / 地址发现 /
  Cookie / 探活分类）。acp 的 `protocol` 面只有 `createAcpClient` 与 `createAgentPort`，因此**目前不能把它配成
  `platforms.active.agent`**：门面在装配期直接报「protocol 面缺少 …」，而不是让 bridge 撞上
  `AgentApiClient is not a constructor`。接线（按配置 spawn、把 `onEvent` 接进事件管线）属 C6.5，
  不改变本批已交付的任何契约。
- **测试**：新增 `scripts/test-acp-port.mjs`（14 条，离线夹具 `scripts/fixtures/fake-acp-agent.mjs` 走真实
  stdio，不起网络：事件映射、权限事件、能力位乐观 + 收缩、`session/list` 分页与归档、prompt 三条受理路径、
  cancel、权限反向请求与回执、模式读写、agent 与模型目录）。`test-agent-port.mjs` 21 → 30 条（新增 5 条 ACP
  契约一致性：声明面覆盖能力位且不多画、协商制 getter、protocol 面无 `NodeApiClient`、级别计划 fail-closed、
  回执判据「ok 且名字一致」）。`test-platform-adapters.mjs` 的内置清单断言改为 `['dsh', 'acp']`。
- **文档**：`PLATFORM_UNIFICATION.md` 状态改 `C0–C6 已完成`；§9.1 的 prompt 欠账与两条风险标为已解决；
  新增 §9.2（交付物、四处设计决定、未做的接线）。

### 重构：控制台界面 IA（C7，平台页 + 方案页）
- **`#behavior` 四标签拆成两页**：`平台`（一级）= 左列表（按 `side` 分「用户侧 / Agent 侧」分组）+ 右详情
  （标签按「这一侧真有的资产」给：用户侧 `概览 · 配置 · 话术与工具 · 行为`，Agent 侧 `概览 · 能力 · 配置`）；
  `方案`（一级）= `pages/runtime/` 改名重写，只管「一次组合怎么跑」。`pages/behavior/`（5 文件）、
  `pages/runtime/`（2 文件）、`components/platform-panel/` 全部删除。
- **`js/platforms.js` → `js/registry.js`**：端点从 `/api/runtime/platforms` 换成 `/api/platforms/registry`（两侧同源），
  函数签名保留；`test-console-static` 新增断言「页面源码里没有第二处 `/api/platforms/registry` 调用」——
  口径只允许在这一个文件里。
- **兼容面只有一条**：`PAGE_ALIASES = { behavior: 'platforms' }`，旧书签 `#behavior` 一次性重定向。
  `PAGE_FRAGMENTS` 删除：每页的片段都在 `pages/<id>/page.html`，不再区分「静态页 / 片段页」。
- **`AGENT_FALLBACK` 删除**：方案编辑器不再给 `agentPlatform` 兜底写 `'dsh'`，改为从注册表挑
  `assets.capabilityProfiles.length > 0` 的 Agent 平台。这是**数据约束**（`plan.capability` 必须是被选平台的档），
  不是白名单：新平台声明能力档后自动出现在下拉里；旧方案没写 `agentPlatform` 时显示「跟随能力档」。
- **能力面板不再造假归属**：`createCapabilityPanel()` 删掉「Agent 平台」列（原值是 `cap.agentPlatform || 'dsh'`，
  而 `src/capabilities/store.mjs` 根本没这个字段），改为收 `platformId`，把「保存后写回哪份文件」按当前平台算。
- **三处有意留白**（界面上写明原因，不造数据）：没有「健康」标签（注册表无 `health` 字段、`probe` 端点未实现）；
  「配置」只读（`PATCH .../config` 未实现，参数仍改 `platform.yml` + 重启）；能力档不按平台过滤（档位无平台归属字段）。
- **行为档案按平台过滤**：`behaviors-panel` 收 `platformId`；档案自己写了 `platform` 就用它，否则用 kind 注册表里的
  （`/api/behaviors/kinds` 的 `platform`）。列表只显示当前平台的档案，新建时直接落到当前平台。
- **测试**：`test-console-ui` 34 → 37 条（行为档案走「平台 › 行为」、平台提示词走「话术与工具」、方案编辑器全部
  `#planEdit*` 且 Agent 平台下拉 = 注册表里的声明者、能力档走「Agent 平台 › 能力」、两侧清单 + 没有诊断就不渲染
  诊断卡、配置标签只读）；`test-console-static` 新增「## C7：界面 IA」整段，`BARE_CONTROL_BASELINE` 删
  `behavior: 4`（新页基线 0：`page.html` 里没有裸控件）；`console-ui-fixture` 的注册表 mock 补上两侧
  `configSchema` / `config`（照抄两份声明面），预览里「配置」标签才有真表可看。
- **文档**：`PLATFORM_UNIFICATION.md` §7.2 改成实际标签矩阵、§九 C7 行标完成、新增 §9.3（交付物 / 三处留白 /
  与 §7.6 的四处出入）、§二 加「本节写的是 C0 之前的形态」横幅；`FOLDER_MAP.md` 与 `CONSOLE.md` 的
  `js/platforms.js` 条目改为 `js/registry.js`（端点同时换成 `GET /api/platforms/registry`）；`CONSOLE.md` §6/§7
  的过期数字改为事实（契约 25 → 22 条、导航 10 → 15 个、不再钉具体 DOM id 数、截图页从已删的 `behaviors`
  换成 `platforms` / `plans`）；`guides/ADD_USER_PLATFORM.md` 的平台数据源改为注册表，
  `PLATFORM_DECOUPLING.md` §6.1 加「已收口为 `/api/platforms/registry`」横幅（该节保留作设计演进记录）。

### 重构：平台统一收尾（C8）
- **文档按事实改写**：`PROFILES_MODEL.md` 顶部横幅指向本方案，§一 层级表重写（能力预设 → 能力档、Agent 平台写
  「当前 DSH 与 ACP」、关系句写明方案不再有 `agent` 字段），§二 目录树补 `behaviors/.defaults/`、
  `capabilities/.defaults/`、`plans/.defaults/`、`adapters/runtime.mjs` 与 `acp/` 平台；`FOLDER_MAP.md` 新增
  `src/platforms/` 与 `src/config/` 两行、`src/agent-side/` 补 `adapters/acp/`、`src/user-side/metadata.mjs` 的
  端点改注册表、脚本计数改 208；`CONSOLE.md` 的数据源、契约条数与导航数按 C7 后的事实落定；`docs/README.md`
  索引状态改「C0–C8 已完成」。
- **方案端点按 §7.4 改名为 `/api/plans`**（原 `/api/runtime/plans`）：`src/bridge.js` 三处路由（GET / POST /
  DELETE，含 `slice('/api/plans/'.length)`）、`pages/plans/page.js` 四处调用、控制台夹具四条 mock 路由、
  `test-console-ui` 的写请求期望值、`console-ui-contracts.json` 的写载荷基线同步改。理由是归属：方案是「配置面」，
  跟 `GET /api/platforms/registry` 同类，不该挤在 `runtime/` 下面，也不该让人以为它是运行期临时物。
- **删除清单逐项核销**：`profiles/agent-platforms/dsh/agents/`（C4）、`src/runtime/adapters.mjs`（C2b）、
  `public/console/pages/behavior/` 与 `public/console/components/platform-panel/`（C7）已清零；唯一有意偏离是
  `src/agent-side/agent-client.mjs` **保留** —— 它只剩「怎么连上平台」（`AgentApiClient` / 地址发现 / 凭据 /
  探活分类 + 装配期协议面校验），调用面已全在 `AgentPort` 里，删掉等于把装配期守卫一起丢掉；偏离与理由写进
  `PLATFORM_UNIFICATION.md` §4.3 / §4.4，C6.5 接线时一并处理。
- **门禁**：`verify:repo` 80 通过 0 失败 0 跳过、`test:audit` 129/129、`test-console-static` 全过、
  `test:console-ui` 37/37（41 条隔离 mock 写请求）、`test-artifact-pipeline` 全过、`build-artifacts --check`
  全部最新、`test:v030` 9/9、`check-profiles` 通过。`git grep` 复核四项删除清单：目录/文件本体均已不存在，
  残留字符串只出现在测试的「已删除」断言、平台页的 `data-platform-panel-body` 属性名与文档的历史说明里。

### 重构：控制台文案与人格生效口径（C9）
- **导航改名**：`index.html` 的「平台」→「平台配置」、「方案」→「运行方案」；`js/router.js` 的 `consolePages.platforms/plans` 标题与副标题同步。路由键不变，旧书签照旧可用。
- **能力档编辑页对齐行为档案页**：`components/capability-panel/capability-panel.js` 的 `renderEditor()` 改用 `.platform-stack` / `.platform-section` / `.form-stack` / `.form-actions`，字段走 `renderFields(..., { columns: 1, layout: 'inline' })`；`pages/platforms/platform-detail.js` 去掉编辑器外层多余的 `<section>`；`pages/platforms/page.css` 删掉 `.platform-detail .card { padding }` —— 那是卡片套卡片、与「行为」标签间距不一致的来源。
- **`/role` 与「默认人格下拉」同源**：新增 `resolvePersonaTarget(raw)` 作为「卡名 → 可写入的人格值」唯一入口（本地 `roles/<名字>.md` → `provider:id` → 裸名在各 provider 目录里唯一匹配，重名要求写全并返回 `candidates`），`externalPersonaTarget()` 负责刷缓存与离线沿用旧缓存。`builtinCommandDeps.role` 的 `sanitize` / `exists` 换成 `resolve` / `refresh`；`/role 名字` 因此能直接切外部人格，回执标「（外部人格）」。
- **`applyRoleChange` 搬到 main 作用域**：它原本是 HTTP 处理函数里的 `const`，而 `builtinCommandDeps` 在 `main()` 作用域，`/role` 调它会抛 `ReferenceError` 且被命令层吞掉 —— 表现为「状态写进去了但没有任何回执」。现在放在 `refreshRoleNowV2` 之后并写成**函数声明**（`server.listen` 在更早的代码里已执行，`const` 会踩 TDZ）。
- **人格卡注入口径统一**：`roleRefreshBlockV2(key)` 不再豁免 `bootstrap`，`roleFpAtBuild` 无条件记录指纹；新建会话、重置会话、人工唤醒一视同仁，**没读过这一版就整段给卡**。引导唤醒的文案改成两套：有卡时「角色卡已经在上文完整给出，不用再读」，无卡时仍让 AI 去 `qq_get_prompt` 看角色（golden 夹具逐字节不变）。
- **重置 = 新上下文**：`src/session/reset.mjs` 的 `createSessionResetter` 新增 `forgetRoleSeen`，重置时忘掉「已读哪一版卡」，否则下次唤醒不会重新注入。`resetSession(key, { notify })` 透传 `notify` —— 修掉「控制台点重置也往群里发一条『已重置会话』回执」（旧实现 `return resetSessionImpl(key)` 把 options 丢了）。控制台 `/api/session/reset` 与 QQ 的 `/reset` 共用这一份序列。
- **会话详情下拉现取现用**：`pages/sessions/page.js` 的 `ensurePersonaCatalog()` 去掉模块级永久缓存，每次打开详情都重拉 `/api/personas`（失败沿用上次结果），人格页新建/改名/删除角色卡后回来立刻能看到。
- **「跟随全局（当前：…）」显示完整方案名**：`/api/sessions` 的 `activePlan` 由 `id` 改为整份定义（`activePlan() ?? null`），前端新增 `planLabelOf()` 兼容只给 id 的旧写法；下拉不再只剩一个破折号。
- **`/api/roles` 的 `assignments.missing` 判据改走 `roleCardFor`**：本地卡与外部引用（`provider:id`）同一个门，外部人格不再被误报成「已失效」。
- **`role-per-key.js` 认外部引用**：新增 `PERSONA_REF_RE` / `safePersonaRef` / `safeRoleValue`；`safeRoleName` 会吃掉冒号，写外部卡会被静默改成另一个名字，所以「全局 `role` 与按会话 `byKey`」的写入与读盘都改走 `safeRoleValue`。
- **测试**：`test-command-registry` 补外部人格与 4 次 `refresh` 断言（17 条）；`test-session-reset` 补 `forgetRoleSeen` 与 `notify:false`（5 条）；`test-role-refresh` 改为断言引导唤醒也带卡；`test-deploy-fixes` 的重置断言改指 `createSessionResetter` 的登记项（序列已搬进模块）；`test-console-ui` 37 → 38 条（会话详情显示方案名 + 新建人格卡后下拉即时更新）。
- **门禁**：`test:audit` 129/129、`test:console-ui` 38/38（43 条隔离 mock 写请求）、`verify:repo` 80 通过 0 失败 0 跳过、`test-console-static` 全过、`node --check` 全过。
- **文档**：`COMMAND_REGISTRY.md` §9 补 `role` 注入契约；`guides/TESTING.md`、`guides/CONFIGURATION.md`、`guides/SECURITY_BASELINE.md`、`PLUGIN_KERNEL.md` §9.2 按新事实校正；`PLATFORM_UNIFICATION.md` 新增 §9.5。

### 重构：执行体通用化 P0（C6.5，连接层下沉）
- **连接层唯一入口**：新增 `src/agent-side/runtime.mjs` —— `agentRuntime({config,log,onBaseUrlChange})` 按
  `platforms.active.agent` 取实现、调 `createRuntime`、按 `RUNTIME_MEMBERS`（12 个成员）校验后缓存；
  缺成员或未声明 `id` / `label` / `mode` 直接抛错。缓存键是实现对象本身，注册表重置后重新装配同一平台
  不复用旧句柄；`resetAgentRuntime()` 丢弃并 `close()`，切换执行体后下一次调用按新平台重建。
- **删门面**：`src/agent-side/agent-client.mjs` 与 `REQUIRED_PROTOCOL_MEMBERS` 删除（B5/C8 的「有意保留」到此核销）。
  bridge 改从 `agentRuntime()` 取 `events` / `port` / `collector` / `health` / `probe` / `authHint`，`src/` 内不再有第二套连接入口。
- **DSH 连接层归口**：`adapters/dsh/runtime.mjs` 提供全部 12 个成员（`prepareAuth` / `prepareEndpoint` / `client` /
  `events` / `port` / `collector` / `health` / `probe` / `authHint` / `authRecentlyFailed` / `resetAuthHint` / `close`）；
  地址发现与 401 诊断限频都在 `adapters/dsh/` 内，`client.setBaseUrl` 只在适配器里调用，新地址经
  `onBaseUrlChange` 交给调用方决定是否落盘。
- **ACP 连接层建立**：`adapters/acp/runtime.mjs` 按 `command` / `args` / `cwd` spawn 子进程、懒建客户端与 port、
  按归一事件收成一轮，没有地址与凭据猜测。它唯一缺的成员是 `events()`，已在本批 P0c 补齐（见下一小节）。
- **调用方迁移**：`src/self-test.js`、`src/launcher/control-center.mjs` 改走 `agentRuntime()`；
  `src/bridge-extensions.js` 删掉两组 DSH 直导出（仓内已无消费者）；`scripts/audit-bridge-harness.mjs` 夹具
  改为注入连接层离线桩 + 真 `AgentPort`，不再注入旧符号。
- **测试**：连接层契约用例新增（成员齐备、单例与 reset、成员不齐即 fail-closed）；
  `test-dsh-{health,auth-hint,endpoint}`、`test-upstream-dsh-probe`、`test-platform-adapters`、`test-agent-port`、
  `verify-adaptation` 的断言同步到新契约（`bridge` 里不再出现 `createAgentHealth` / `createDshProbe` / `resolveAgentBaseUrl`）。
- **门禁**：`verify:repo` 81 通过 0 失败；`test:audit` 128/129（唯一失败是本地未纳入版本管理的
  `profiles/plans/agent-full-copy.yml` 让「内置方案六条」变成七条，与本次改动无关）。
- **文档**：`EXECUTION_BODY_GENERALIZATION.md` §4.1 改为实际形态（成员表 + fail-closed + ACP 缺口）、
  §4.4 拆出剩余的「事件面 / 审批引用 / 用量账本」三处归一并把 P0 分成 P0a/P0b/P0c、§8.6 给出概览指标卡的目标语义；
  `PLATFORM_UNIFICATION.md` §4.3/§4.4 与 ACP 接线段、删除清单表的「门面保留」改为已删除；
  `PROFILES_MODEL.md`、`guides/TESTING.md` 同步。

### 重构：事件面 / 审批引用 / 用量账本三处归一（P0b）
- **事件面下沉**：`events().mux()` 改为产出中立事件 `{ kind, sessionId, turn? }`，`kind` ∈ `AGENT_EVENT_KINDS`
  （新增 `turn-start` / `snapshot`）。新增 `src/agent-side/adapters/dsh/events-plane.mjs` 承担 wire → 中立翻译
  （`session/event`、`session/snapshot`、`$events` 的提问与审批），bridge 的 `pumpMux` 按 `kind` 分发，
  内核不再出现 `turn/start` / `tool/call` 这类判别值。`snapshot` 是**独立 kind**，绝不混进事件流：
  它含历史 `turn-end`，混进去就会被当成新回合去发 QQ 回复。
- **收集器共用**：新增 `src/agent-side/collector.mjs`（`turn-start` 开回合、`text` 追加、`turn-end` 收口），
  DSH/ACP 不再各自维护一份；`adapters/dsh/client.mjs` 的 `createTurnCollector` 删除。只有 `turn-start` 建收集器；
  没有回合号的后续事件归到该会话**唯一**打开的回合（`groupKeyOf`），多个在途则丢弃——宁可丢也不混进另一轮回复。
- **用量账本中立化**：`createTokenLedger.ingestEvent()` → `ingestSample()`（吃
  `{ sessionId, seq, turn, step, retry, model, provider, usage, at }`），`ingestBaseline()` 吃 `{ tokenUsage, asOfSeq }`；
  重试轴由适配器按平台事件算好随样本来，账本与 `usageOfEvent` / `usageFromStream` 一并删除。
- **审批引用归一**：`respondPermission` 只收 `{ instance, sessionId, requestId }`；
  平台键（DSH `clientId` + `eventId`、ACP JSON-RPC `id`）只在适配器挂起表 `Map<requestId, {...}>` 里，
  `src/admin/approvals.js`、审批回执与 `/api/sessions` 透出全部改用 `requestId`。新增 `normalizePermissionRef`
  负责缺字段与跨会话不一致的 fail-closed 报错。

### 重构：ACP 当主平台 + 一致性测试包（P0c）
- **ACP 事件流出口**：`adapters/acp/runtime.mjs` 新增 `createEventPlane()`（`onEvent` → queue + wake 的异步 generator），
  实现 `events()` 的 `mux` / `follow` / `forget`，abort 监听在循环外注册、finally 解绑；`close()` 改走 `client.stop()`。
  ACP 自身没有回合号，由 port 层 `beginTurn()` / `activeTurns` / `turnCounters` 给在途回合打戳并发出 `turn-start`，
  `emitTurnEnd` 带显式回合号并在同号时清理。至此两家的 `RUNTIME_MEMBERS` 均齐备，ACP 可以配成 `platforms.active.agent`。
- **TCK**：新增 `scripts/test-agent-port-tck.mjs`（`npm run test:tck`，同时接入 `test:agents`），8 条跨平台契约：
  事件 kind 集合、收集器同源、回合分组交错不混、无回合号按会话累加、孤儿事件不建回复、审批引用、
  快照独立 kind、连接层成员齐备。它直接抓出了 ACP 文本不带回合号的问题，修法是把「唯一在途回合回退」写进收集器
  而不是在测试里手工打戳。
- **门禁**：`verify:repo` 101 通过 0 失败；`test:audit` 全绿；`test-agent-port` 30/30、`test-acp-port` 14/14、
  `test:tck` 8/8。顺带修了两条与本次无关的脆弱断言：「内置方案六条」不再把用户克隆到同一目录的方案算进去，
  `test-sticker-describe` 的源码断言不再钉变量名。
- **文档**：`EXECUTION_BODY_GENERALIZATION.md` 状态改为 P0 全部落地，§4.1.1 的 ACP 缺口改为「差异只有形态」、
  §4.2 改为实际 TCK 用例、§4.4 改为落地位置与三条归一口径；`PLATFORM_UNIFICATION.md` §4.3/§4.4 与 ACP 接线段、
  §9.2 后的「仍不能当主平台」全部按事实改写。

### 重构：概览指标卡按「执行体 / 用户平台」定义（P0d）
- **`/api/status` 给中性投影**：`dshReady` 换成 `agent: { id, label, mode, ready }`（由 `agentStatusSummary()`
  从连接层取），并补上 `platform`（当前用户平台 id）。连接层装配失败时这两个字段退化为空 + `ready:false`，
  状态端点不会整页 500。
- **五格指标改按位置命名**：执行体 / 用户平台 / 当前运行方案 / 已建立会话 / 待处理请求。前两格读状态投影，
  标题写死的是「位置」而不是平台名；SnowLuma 上游健康从独立卡片收进「用户平台」格副行，与「访问与安全」
  的告警条由同一份快照渲染（`renderUpstreamHealth`），两处不会说出不同结论。
- **样式去特例**：删掉按格子 id 写死的字号（`#metricMode` / `#metricSnowluma` 三处媒体查询），改为
  `.metric strong.is-text` 文本格修饰；新增指示格不再需要新的样式分支。
- **日志与提示跟着执行体自报的 label 走**（就绪 / 探活偶发失败 / 不可用入队），控制中心与 `send-voice`
  改读 `agent.ready`，`docs/DSH_DEPLOYMENT.md` 的验证命令同步。
- **门禁**：`verify:repo` 101 通过 0 失败；`test:audit` 全绿（含同步重写的 `test-dsh-health`、
  `test-snowluma-upstream-health` 两条断言）；`test-console-static` / `test-console-ui` 通过。

### 重构：Agent 侧插件化（P1）
- **新权限 `agent-provider:provide`**：`ctx.agentPlatforms = { register(def), list() }`，注册形状为
  `{ id, label, capabilities, configSchema?, resolveLevelPlan, createRuntime }`。id 文法、`resolveLevelPlan`
  与 `createRuntime` 在注册时就判；同 owner 可覆盖（热重载），换 owner 一律拒绝 —— 内置平台不可被顶替。
- **不另开第二张表**：`owner` 与装配结论（issues）都记在 `src/agent-side/runtime-registry.mjs`，
  `listAgentPlatforms()` 直接带 `owner` / `source` / `configSchema` / `issues`，控制台与
  `agentPlatformMetadata()` 读同一处；插件停用时内核按 owner 批量注销。
- **装配失败留下结论**：`createRuntime` 抛错 → `agent_instance_offline`；返回句柄缺成员 →
  `agent_provider_invalid`；`port()` 装配失败 → `capability_overclaimed`（新增 `AgentAssemblyError`，
  与「能力位缺位」的 `AgentCapabilityError` 分开：后者是调用方问错了，前者是平台自己声明错了）。
  失败照抛（fail-closed），装配成功即清账。
- **统一注册表出三条诊断**：`capability_overclaimed` / `agent_provider_invalid`（error）、
  `agent_instance_offline`（warn）。「当前执行体探活未通过」由桥接注入 `agentConnected` 判断，
  `null`（还没探过）不判，避免启动瞬间报一条假的离线。
- **运行期边界**：正在当执行体的平台不能随插件卸载（会话落盘的 `agentRef.instance` 指着它），
  换执行体要改 `platforms.active.agent` 并重启桥接；插件平台的配置模型来自实现自报的 `configSchema`。
- **门禁**：新增 `scripts/test-agent-provider.mjs`（9 条：owner 语义、三类装配结论、诊断码、内核接线），
  `test-plugin-kernel` / `test-platform-registry` / `test-agent-port` / `test:tck` 全绿。

### 重构：平台配置写口与默认执行体（P2）
- **Agent 侧配置可写**：`PATCH /api/platforms/registry/agent/:id/config` 按 id 写 `platforms.agents.<id>`
  （端点进 `endpoint`、其余进 `options`），只落盘用户给的补丁，不把 schema 默认值固化成设置；
  写入前用与 `config_invalid` 诊断同一个 `vetPlatformConfig()` 校「旧值 + 补丁」合并后的整份。
  id 不在注册表里直接 404 —— 写一个没人读的 id 等于制造死数据。
- **探活**：`POST /api/platforms/registry/agent/:id/probe`。active 复用后台轮询的结论，其余建临时
  `createRuntime()` 探完 `close()`，不碰单例也不回写配置；结论进快照的 `entry.probe`，控制台与切换预检共用。
  探活失败是有效结论（200 + `probe.ok=false`），只有未注册 / 没有运行期实现才 400/404。
- **默认执行体**：`/api/config/runtime` 增 `defaultAgent`（读的就是 `platforms.active.agent`，不另存一份）。
  切换先预检，探不通回 409 不落盘；成功后带 `requiresRestart: true` 并记审计 `runtime.defaultAgent`。
  一个请求只改一项（方案与执行体不同时提交）。
- **配置面与运行期分开看**：注册表条目新增 `configured`（配置面选的）与 `active`（本进程装配的）并列，
  不一致时出 `active_pending_restart`（warn）；控制台详情显示「已设为默认，重启后生效」，列表标「待重启」。
- **控制台**：平台详情「配置」改为由 `configSchema` 生成的可写表单（用户侧仍只读），概览新增「执行体」卡
  （探活 + 设为默认 + 上次结论）；schema → 表单的映射抽成 `components/form/schema.js`，插件详情与平台详情共用。
  保存/探活/切默认后重拉同一份注册表快照，标签不被打回概览。
- **门禁**：新增 `scripts/test-platform-config.mjs`（9 条：按 id 打补丁、端点/选项分界、不固化默认值、
  非法 id、切默认补空壳、`configured` 与 `active_pending_restart`、探活入快照、写口与诊断同一套校验）；
  `test-console-ui` 新增可写/探活/设为默认三条用例，`console-ui-contracts.json` 按新写口重录（只新增 3 条）。

### 重构：多入站实例与用户侧配置写口（P3）
- **一条条目一个实例**：`platforms.users.<id>` 现在是**可装配的东西**——`userInstances()` 把表摊成清单，
  桥接启动时按清单逐条装管线，来源地址、准入与会话映射都按该实例的 `platform + account` 算 key。
  以前只有「当前平台」一条管线，第二条平台的消息无处可去。
- **`enabled` 是条目级开关**：`normalizeUserEntry` 恒把它归成布尔（缺省即启用），不进 `transport` / `options`
  —— 否则适配器会收到一个与它无关的键。停用的实例装配时直接跳过并入站结论 `disabled`；
  翻这个开关不参与 schema 校验：配置本身不合规时，停用它恰恰是最该做的事。
- **正文契约 `rawEvent`**：`describePlatform()` 与注册表条目新增静态布尔，只有声明了它的平台才把 `ext.raw`
  交给业务体，没声明的由管线按 `body_unsupported` 丢弃并写明原因。对应的 `createInboundPipeline({ deliver })`
  允许 `deliver` 返回 `{ reason, errors }` 拒绝一条事件。
- **用户侧写口**：`PATCH /api/platforms/registry/{agent,user}/:id/config` 两侧共用一套路径文法；
  `enabled` 从补丁里剥出来单独落盘，其余字段合并后照旧校 schema。用户侧没有主动探活，
  `probe` 固定 400（连接结论只看注册表的 `inboundState`）；`requiresRestart` 按「该实例是否已装配」算。
- **默认实例**：`/api/config/runtime` 增 `defaultUser`（读的就是 `platforms.active.user`，不另存一份），
  切换只改指针并回 `requiresRestart`，审计记 `runtime.defaultUser`；响应里 `runningUser` 与它并列返回。
- **注册表三个读视图**：条目新增 `enabled` / `inboundState` / `outbound` 与 `rawEvent`。`outbound` 按与
  `src/user-side/outbound.mjs` 相同的顺序解析（插件 transport 优先，其次内置适配器），写明
  `via: transport|adapter|none` 与 `owner`；`inboundState` 是桥接记的装配结论，没装配过为 `null`。
  只在配置里存在的条目（`config-only`）同样列出并报 `config_only`（warn）——否则那条实例无处可改。
- **`entry.config` 剥掉 `enabled`**：控制台拿它与补丁合并后校严格 schema，多一个平台不认识的键会拒掉整次保存；
  条目开关只从 `entry.enabled` 读。
- **控制台**：用户侧配置改为可写表单（与 Agent 侧同一组件），首位一枚条目开关；实例卡新增「设为默认实例」；
  概览把「条目开关 / 入站结论 / 出站实现」三件事分开写；清单里停用的实例一枚「已停用」，
  入站有结论时一枚状态徽标（停用不再叠同名徽标）。
- **门禁**：新增 `scripts/test-user-instances.mjs`（10 条：条目开关归位、实例清单顺序、扁平投影、按 id 写、
  切默认补空壳、注册表三视图、插件 transport、config-only、默认指向未注册、停用不产诊断）；
  `test-unified-inbound` 补 `deliver` 拒绝与空结果两条用例；`test-console-ui` 新增「设为默认实例」，
  `console-ui-contracts.json` 按新写口重录（只新增 2 条）。`test-config-v2` 的期望值随 `enabled`
  进扁平投影更新——它是条目级显式字段，与 `account` 同层；缺条目时不编造 `enabled`。

### 重构：方案解绑与能力档 `runtime` 段（P4）
- **能力档第四段 `runtime`**：`{ apply, prompt, permission, narrow }`，缺省 `preset / none / bridge / []` ——
  不写这一段的能力档行为与引入前完全一致。四项取值非法直接报错，不猜默认值（把「不装预设」悄悄装成预设
  会同时错掉安全边界与权限权威）。新增 `direct.yml`：`apply: passthrough`（`rows: []`）、`permission: agent`、
  `tools.agent.host: true`，构建期跳过、不产 `direct.patch.yml`，`preset` 段只作界面建议值。
- **执行体认领 `apply`**：DSH 声明面新增 `RUNTIME_APPLY = ['preset']`。引用直通能力档的方案会被
  `validatePlanReferences()` 拒成 `plan_invalid`，而不是在运行期被静默投影成别的档位；直通运行期在 P5。
- **方案不再绑用户平台**：`normalizePlan()` 不读 `platform`，`planText()` 不写它；旧文件里的 `platform` 由
  `planWarnings()` 报 `plan_warn`，保存时自然丢弃 —— 不需要迁移，也不动方案 `version`。`agentPlatform` 默认
  `auto`（跟随 `platforms.active.agent`），内置方案全部 `auto`；写死具体 id 会在换全局执行体后被拉回旧平台，
  这条同样出 `plan_warn`。
- **校验按事实判**：`validatePlanReferences()` 现在能看能力档事实（`apply` / `hasRows` / `permission`）与执行体
  声明（认领的 `apply`、是否有权限预设映射），产出 `capability_invalid` / `plan_invalid` / `plan_warn` 三码；
  群聊直通仍是「允许 + 警告」。`check-profiles` 与 `test-runtime-plans` 消费同一份结论。
- **方言上移**：能力档 `rows` 只剩平台无关的两段（`【安全边界（最高优先级，不可违反）】` +
  `【送达方式：自动转发】` / `【送达方式：工具发送】`）；QQ 场景规则、认人、工具协议、操作即动作、
  群聊不是客服队列、模式切换、学习群友策略、群管禁令、发送与汇报禁令全部只住在 `profiles/platforms/qq/prompt.md`，
  运行期由 `core-platform-prompt` 注入一份。`prompt-compose.mjs` 里构建期把平台话术追加进 `persona.prefix`
  的死路径（`composeRows()`）随之删除。
- **预设不变量按代次**：`src/preset-prompt.js` 的必带段落改为「安全边界 + 送达方式」，一代查
  `【送达方式：自动转发】`、二代查 `【送达方式：工具发送】`；正文最短长度阈值从 500 降到 300
  （两代正文只剩两段时约 490 字符，旧阈值会把两个预设都锁死）。
- **平台提示词条件化**：`prompt.md` 的【发送】一条改成「只有『工具发送』档位才自己发消息」——
  一代同样挂着 MCP，不条件化就会出现「提示词让你发、能力档说自动转发」的两套口径。
- **控制台**：方案页去掉用户平台字段与必填校验，执行体下拉加 `auto`（显示为「跟随全局（当前：…）」），
  表格列名改「执行体」，导出不再写 `platform`；`test-console-static` 加静态断言防回退。
- **出厂副本**：`profiles/plans/.defaults/` 六份与 `capabilities/.defaults/` 六份（含新增 `direct`）逐字同步。
- **门禁**：`check-profiles`、`verify:artifacts`、`test:artifact-pipeline`、`verify:repo`、`verify:adaptation`
  （repo + all）、`test:preset-prompt` 16/16、`test:runtime-plans` 8/8、`test:qq-preset-contract` 10/10、
  `test-platform-prompt` 1/1、`test:audit` 132/132、`test-console-static`、`test-console-ui` 42/42。

### 重构：直通运行期（P5）
- **提示通道声明面**：能力档 `runtime.prompt` 的四个取值各自有明确语义——`none` 每次唤醒都带；
  `prefix` 只首轮带一次；`system` 建会话时交给对端；`tool` 完全不带。执行体在 `adapters/runtime.mjs`
  用 `RUNTIME_PROMPT` 认领，注册表 `agentPlatformPromptChannels()` 读出，在 `listAgentPlatforms()` 里
  与 `applies` / `canPinPermission` 一样作为声明面暴露。缺声明时只给 `tool`。
- **不新增 `prompt` 能力位**：它本来就在 `AGENT_PORT_CORE_METHODS` 里，再加一道闸门会变成两套口径。
- **降级只有一条**：四个通道里只有 `system` 对执行体有要求，它不被认领时 `promptChannelOf()` 降为 `prefix`
  并产 `passthrough_degraded` 审计（同一方案 + 执行体只记一次）+ 一条日志；`prefix` / `tool` 桥接侧即可完成。
- **`promptInjected` 落盘**：会话档案新增 `promptInjected: { sessionId, at }`，按会话 id 比对，换会话
  自然重来；不再复用 `prompt-blocks` 的 30 次唤醒 / 12 小时刷新语义（那是「定期重申」，直通要的是「一次」）。
- **直通不挂预设**：`modePreset()` 在 `apply: passthrough` 下短路返回 `undefined`——档案里残留的 `presetId`
  也不能挂上，否则直通等于偷偷装了个 preset。`strictPreset` 随之关掉（否则预设断言会在建会话时抛错）。
  `closed-agent` 模式不参与直通：那个模式的权威是「级别 → preset + 权限预设」。
- **权限权威两分落地**：`pinSessionPermission()` 在 `permission: agent` 下短路成 no-op，所有既有调用点
  （建会话、复用重钉、full 授权回收、PATCH 档案、`/perm`）自动不再回钉；漂移 interval 同样短路，只告警。
  新增 `readAgentPermission()` / `describeAgentPermission()` / `applySessionPermission()`：后者写完**立刻回读**，
  不一致即记 `permission.write_failed` 并如实报错，不回滚成「假装成功」。
- **不静默丢用户意图**：`PATCH /api/sessions/:key/profile` 在 agent 权威下写 `permission` 改为 409 明确拒绝并
  指向新界面；`/perm` 的 describe 显示对端现状、set 返回 `ok:false` + 说明；`permissionPayload` 增 `authority`。
- **顺带修掉一个既有缺陷**：`normalizeProfile()` 的白名单里没有 `permission`，会话级权限覆盖重启即丢
  （writer 写了、load 时被丢）。现在 `permission` 与 `promptInjected` 都在白名单里。
- **MCP 不在会话层下发**：四个 MCP 服务器本来由 `adapters/install.mjs` 写进执行体配置（与 preset 无关），
  直通不装 preset 也照样有 MCP。给 DSH 再传一遍 `mcpServers` 只会把同一批 server 声明两次，因此不传；
  `direct.yml` 头注释与 §7.1 已按这个事实改写。
- **权限基线 `permissionMirror` 落盘**：桥接每次代改成功都记 `{ preset, at }`，只用来判「对端已被外部改成别的档」；
  漂移只标不改（改回是用户点按钮的事），没有基线就不报漂移。
- **会话详情一条给全**：`GET /api/sessions/:key/agent` 一次返回执行体、实例（含 `instanceForeign`）、方案四轴、
  能力档、提示通道与权限现状；直通下 `permission.current` 是对端**此刻**的回读值，读不出来就如实标 `readable:false`，
  不拿档案里的旧值充数。
- **代改走专门写口**：`POST /api/sessions/:key/permission` 只收直通会话（桥接权威下 409 指向档案里的「权限级别」，
  避免写了又被钉回去的假开关）；写失败/回读不一致回 502 并附对端实际档位。两个端点都只允许控制台。
- **免审批档双保险**：`FORBIDDEN_PERMISSION_PRESETS`（`danger-full-access`）在 `src/session/permission.mjs` 单一来源，
  列表过滤 + 写口 403 各用一次；需要高权限走 `full-ask`。
- **其余写口对齐**：`PATCH /api/sessions/:key/profile` 在直通下写 `presetId` 改 409（不挂预设就不该假装有开关）；
  `GET /api/sessions/:key/profile` 增 `apply`，页面靠它决定要不要显示预设/沙箱那几张卡。
- **控制台 · 会话详情**：新增「执行体与权限」卡，一条 `GET /api/sessions/:key/agent` 渲染执行体、方案、
  提示注入通道与权限档。执行体权威给下拉（写后由后端回读核对），桥接权威只读展示生效级别并写
  「桥接权威：这一档由桥接钉住并自动改回」；漂移标黄并给「改回」，会话建在旧实例上时给「重开」。
- **控制台 · 方案页**：清单补「应用方式 / 权限权威」两列，直通行是「直通」徽标 + 「不做工具级限制」；
  编辑器新增「生效方式」只读块（两枚徽标 + 「改能力档」），改能力档先二次确认，然后关掉编辑器跳到
  声明这套档的执行体的「能力」标签——方案与能力档不各存一份说法。
- **控制台 · 平台详情**：能力位矩阵补应用方式、提示注入通道、权限权威支持面三行，全部读注册表声明。
- **控制台 · 全局配置**：新增「执行体」卡（默认执行体下拉 + 当前运行一行 + 待重启提示），
  模型卡按当前执行体的 `models` 能力位门控，未声明时写「模型与思考强度在它自己的界面里改」。
- **测试**：新增 `scripts/test-passthrough-plan.mjs`（6 条：不挂预设、`system` 降级只记一次、`prefix` 首轮一次、
  `tool` 完全不带、写后回读失败不污染基线、两个端点的权限/漂移/409/403/502 契约）。
  同时补上审计夹具缺的两个符号（`agentPlatform`、`user-side/prompt.mjs` 整个命名空间）——此前平台话术在夹具里
  恒为空串，前缀通道的断言会静默变成「断言空串」。
- **控制台测试**：`test-console-ui` 新增 3 条（会话详情两权威、方案页两列与跳转、全局配置执行体卡），
  共 45/45；`test-console-static` 新增「P5 声明面」13 条，堵住「方案里另存一份生效方式」「页面硬编码执行体 id」
  这类回退。夹具补 `/api/sessions/:key/agent` 与 `POST .../permission`（含漂移），离线预览也能看到两态。
- **门禁**：`test-passthrough-plan` 6/6、`test-console-ui` 45/45（52 条隔离写）、`test-console-static` 全通过、
  `test:audit` 133/133、`verify:adaptation --layer all` 134 通过 0 失败、`check-profiles`、`verify:persona` 全通过。

### 重构：文档同步与 C6.5 核销（P6）
- **PROFILES_MODEL.md 改成「四轴 + 存储分层」**：应用方式 / 工具面 / 权限权威 / 行为四轴互不推导；存储按
  「会话档案 → 方案 → 能力档 → 全局运行时」分层；默认解析链只有**两层**（会话 `planId` → `runtime.defaultPlan`，
  缺省 `social-v2`），设计稿里的 `platforms.users.<id>.defaultPlan` 从未落地。
- **SESSION_SUBSYSTEM.md 追平实现**：档案补 `planId` / `permission` / `permissionMirror` / `promptInjected`；
  §5.1 的有效模式换成代码里的两条分支（有 `planId` 走 `sessionPlanOf` + `planMode`，否则 `resolveEffectiveMode`），
  并点明 `currentMode` 是全局方案的投影、不单独存盘；新增 §5.4（提示注入四通道）与 §5.5（执行体与权限的两权威），
  §8.2 的详情弹窗补齐十张卡。
- **CONSOLE.md 对上盘子**：写载荷契约从 22 条改 27 条（补齐平台注册表那一组 `PATCH .../registry/<side>/<id>/config`、
  `POST .../registry/agent/<id>/probe` 等），导航目标 15 个；新增 §9「执行体 / 方案 / 权限的界面口径」（7 行表 +
  「一次取全 / 写口只有一个 / 失败写在块内」三条），原 §9 顺延为 §10；并写明基线是改造前的快照——改造后新增的
  写口不进基线，由专项用例与夹具的 `unknownRequests` 兜住。
- **PLATFORM_UNIFICATION.md 核销 C6.5**：状态行不再说「唯一没做的是 C6.5」；§7.4 的注册表字段 `health` 改为
  `probe`（与 `src/platforms/registry.mjs` 一致），补 `configured` / `enabled` / `inboundState` / `outbound` /
  `rawEvent`；§9.3 两处「有意留白」标注已由 P2/P3 补上；§9.4 的 CONSOLE 行改成 27 条契约 / 15 个导航。
- **清掉「方案带 `tools`」的残留**：`normalizePlan()` 只产出八键、没有 `tools`，于是 `modePreset()` 里「档案锁定
  的方案带工具面」那一支与 `/api/sessions` payload 的 `plans[].tools` 都是死代码——一并删除，注释改成实情
  （方案不带工具面，能力档只决定档位）。
- **口径统一**：根 `README.md`、`docs/README.md`、`FOLDER_MAP.md`、`INJECTION_PROFILE_CONFIG.md`、
  `PLATFORM_DECOUPLING.md` 里的「四层配置模型」改成「四轴 + 存储分层」；历史发布说明与 archive 描述保持原样。
- **门禁**：`verify:repo` 103 通过 0 失败 0 跳过、`test:audit` 133/133、`test-console-ui` 45/45（52 条隔离写）、
  `test-console-static` 全通过。

### 修复
- **`verify-persona-config` 的「正文 500 字」断言换成段落断言**：P4 方言上移后能力档正文只剩安全边界与
  送达方式两段（435/480 字符），按字数判完整性的断言便一直红着——而它想防的是「正文被截断」。
  改为按段落名判（`【安全边界` + `【送达方式` 缺一即报），与 `src/preset-prompt.js` 的必带段落同源，
  不再随正文长短拨阈值。
- **`scripts/verify-adaptation.mjs` 的 `stripComments()` 换成最小词法扫描**：旧实现先跑块注释正则、再逐行删
  行注释，而 `src/bridge.js` 的行注释里写了块注释开头两个字符（`// 规则都在 src/social/* 里`），于是正则从
  那里一路吃到下一个块注释结尾，把 **34 万字符真代码当注释删掉**（871115 → 527802），依赖它的断言全部
  静默假通过。新实现区分字符串 / 模板串 / 正则字面量与注释，并保留换行。修正后 repo 层 75 条断言全通过
  （原 74 通过 1 失败是新增断言的误判）。

### 方案（仅文档，定版后追加）
- **新增 [docs/PLATFORM_UNIFICATION.md](docs/PLATFORM_UNIFICATION.md)**：平台统一与 Agent 通用化的总纲。
  适用前提：B0–B8 已完成，但仍有三个用户侧缺口（只能出站 / `cfg.platform.id` 不切平台 / 内置平台无
  `configSchema`）、Agent 侧门面仍导出 DSH 语义、平台相关界面分散在 `behavior/` 的四个标签里。
  内容：现状诊断（三源平台定义 / 能力三处描述 / 界面 IA 错位）、目标概念模型 L0–L5、`AgentPort` 窄契约
  与 DSH/ACP 双实现、用户侧三缺口修法、统一注册表与诊断码、界面 IA 重构（四标签取舍：`pages/behavior/`
  整页删除）、配置 v2、C0–C8 批次与验收。
- **旧规划状态标注（避免两套方案并存）**：`AGENT_PLATFORM_EVOLUTION.md` 的 P2 标记为“已移交”（由本方案
  C4–C6 接管，§三 仅保留设计意图与反模式）；`PLATFORM_DECOUPLING.md` 标注 B0–B8 已落地并声明 B8 之后
  的缺口不在其范围内；`PROFILES_MODEL.md` 声明 §一 层级表与 §二 目录示例在 C2/C4 时由本方案改写。
- **`docs/guides/ADD_USER_PLATFORM.md` §五**改为「入站：尚未接通，已定方案（C3）」，写明 `connect/close`
  契约与不可交换的入站顺序（校验 → 准入 → 会话映射 → 唤醒）。（C3 已落地，该节现已改为「已接通」，见上方 C3 条目。）
- `docs/README.md` 索引与“想找什么 → 去哪看”表同步登记本方案；C0 阶段无 `src/` / `public/` 改动。

---

## 0.1.1 —— 2026-11-13

0.1.0 基线后的第一批结构性改动：只动 Agent 平台产物链路、模式持久化与版本身份，不含用户可见行为变化。

### 重构：Agent 平台适配层（产物目录迁移 + build/install 分离 + 模式存取抽象）
- **产物目录**：`dsh-bundles/` → `artifacts/dsh/`（`git mv` 保留历史），全仓 34 个文件的引用一并替换；旧目录已不存在（代码/脚本里不再有任何引用，只剩文档里的迁移记录）。产物根约定为 `artifacts/<agent平台 id>/`。
- **build/install 分离**：平台相关的实现全部内聚到 `profiles/agent-platforms/dsh/adapters/`
  —— `build.mjs`（`planArtifacts({repoRoot})` 纯函数：源 → `{files:[{path,content}]}`）、
  `install.mjs`（`install(ctx)`：产物 → DSH profile，失败抛错、幂等）。
- **通用调度层**（零平台知识，只依赖 Node 内置模块）：新增 `scripts/agent-platform-adapters.mjs`（按
  `adapters/<kind>.mjs` 的存在发现与校验，不读 `agent-platform.yml`）、`scripts/build-artifacts.mjs`
  （`--check` 只比对不写）、`scripts/install-agent-platform.mjs`（先 build 再 install）。
  新命令：`npm run build:artifacts` / `verify:artifacts` / `test:artifact-pipeline`。
- **兼容入口**：`scripts/setup-dsh.mjs`（448 行 → 薄壳）、`scripts/build-agent-preset-patches.mjs`
  （re-export 旧 API）行为不变，旧文档与快捷方式继续可用。
- **模式持久化（P3）**：新增 `src/runtime/mode-store.mjs`（`local-file` + `dsh-settings` 两个 backend），
  `bridge.js` 不再自己拼 `state/mode.json` 的读写；模式语义（别名归一、级别、提权 TOTP）仍在桥接侧。
- **清理**：删除 `agent-platform.yml` 里没有读者的死字段 `artifacts:`（值指向已删除路径）。
- **修了两个被目录迁移暴露的隐形问题**：
  - `artifacts/dsh/qq-agent-presets/protected-paths.mjs` 原来用「向上数两层」算仓库根，迁移后变成
    `artifacts/` —— 会让 `state/` 与 `config.json` 的保护**静默失效**。改为向上找仓库标志文件
    （`config.example.json` + `package.json`），失败时才回退到当前层级。
  - `test-console-static.mjs` 的样式分层断言用了带 `\n` 的锚点正则，而 `.gitattributes` 没有覆盖 `.css`，
    在 `core.autocrlf=true` 的 Windows 上 base.css 是 CRLF，断言必失败；改为读入后归一换行（断言看内容，不看行尾）。
- **新增回归**：`scripts/test-artifact-pipeline.mjs`（发现/路径校验/幂等/相对路径拒绝/重复路径拒绝/
  mock 平台隔离 —— 临时仓库里只放一个 `profiles/agent-platforms/mock/adapters/build.mjs` 即可被发现与构建，
  且真实仓库的 dsh 产物零 diff）。
- 文档：新增 [docs/AGENT_PLATFORM_EVOLUTION.md](docs/AGENT_PLATFORM_EVOLUTION.md)（P1/P3 现状与维护不变式 +
  P2「中立 Agent IR」的规划、触发条件、验收与反模式）；同步 `PROFILES_MODEL.md`、`FOLDER_MAP.md`、
  `guides/DSH_SETUP.md`、`EXTENSION_PLATFORM.md` 与两份 README 的目录说明。
- 门禁：`verify:repo` 62 通过 0 失败；`test:audit` 116/116；`test:artifact-pipeline`、`test:setup-idempotent` 全过。

## 0.1.0 —— 2026-11-13

### 变更：控件标尺统一与四类非字段控件（social-v2 表单零手写）
- 新增控件标尺令牌 `--control-h`(40px) / `--control-h-sm`(32px) / `--badge-h` / `--field-label-w`：输入框、下拉框、按钮、开关、状态徽标同源高度，不再靠 padding 撑出约 36–41px 的偏差；`button.small` 走 32px 次级高度。
- 新增 `.control-row` 行原语（`align-items:center` + `min-height:var(--control-h)`）与角色类 `.control-grow`/`.control-fixed`/`.control-label`/`.control-note`，按钮与输入框混排不再手写 `.row` 平行结构。
- `renderFields` 新增四种渲染类型：`custom`（复合控件槽）、`checkList`（多选清单，取值为字符串数组）、`action`（按钮行 + 状态位）、`status`（只读徽标），并支持 `layout:'inline'` 的页头条布局；栅格按断点分列（两列在 md 分开，三四列在 lg 分开）。
- `.status-badge` 收敛到 `components.css`（`layout.css` 不再定义），新增 `.is-pill` 药丸态；social-v2 顶部「运行中」改用该徽标，文字与同行控件垂直居中。
- social-v2 的 `page.html` 做到**零手写控件**：38 个工具开关、语音库调试行、8 组动作行、保存栏、3 个长文本全部由 `public/console/pages/social-v2/fields.js` 的规格生成；`[data-v2-tool]` 改走表单值 `v2Tools`（数组），旧 `id="v2Tools"` 由清单容器保留。
- 浏览器回归：`router.hydratePage` 在 `init()` 之后给页面打 `data-page-ready="1"`，`test-console-ui` 等待该标记，避免量到「片段到位但字段还没渲染」的空壳；几何断言只量单行字段（清单行刻意顶对齐）。
- 防回归：`test-console-static` 增加控件标尺、四类原语、`.status-badge` 唯一定义、页面不得改原语布局、页面 class 必须有定义等断言，并把手写控件数量做成只降不升的棘轮（social-v2 基线 0）。
- 门禁：`npm run test:audit` 90/90，`PLAYWRIGHT_MODULE=playwright-core npm run test:console-ui` 25/25。

### 变更：表单标签右对齐、顶部状态条、保存条吸底与语音开关
- 标签列改为右对齐、与控件首行对齐；多列表单列间距加到 32px。
- social-v2 顶部三个常用项（启用二代模式 / agentPreset / 提供推荐值）收成一条状态条（不再占三行表单），右侧显示运行状态。
- 暂停/恢复/重置三个操作与「保存当前参数」合并到页尾保存条；保存条恢复为吸底浮动（不透明 + 上投影），顶部重复的保存按钮移除（对应旧 id `v2ConfigSaveTop` 一并退役，契约从 225 个减为 224 个）。
- 开关悬停不再加深底色/上浮/加阴影（保留键盘焦点环），避免看起来像按钮。
- 语音库调试行的「只校验不发送」从复选框换成开关，与发送目标输入框同一行对齐。
### 变更：表单改为「标签在左、控件在右」的标准布局
- `.field` 从纵向 flex 改成两列网格（`--field-label-w` 默认 132px），注解与错误行落在控件列；≤760px 自动退回上下堆叠。
- 必填星号移到标签左侧；开关与单个复选框与输入框同高同行（40px），不再「浮」在标签下方。
- `checkboxField` 不再在控件里重复标签文案（标签已在左列）。
- 保存条 `.save-bar` 从不透明悬停块改为页面内静态块，不再遮挡下方内容（顶部「保存当前参数」按钮保留）。
- 标签列宽 148px、列间距 20px；social-v2 的「推荐*」字段标签统一去掉「推荐」前缀，避免标签折行。
### 变更：表单开关统一为 switch，同排字段对齐
- 单个布尔开关从复选框换成 `switchField`（`role="switch"` + 开/关文案），social-v2 共 12 处；确认类复选框（如「我已了解风险」）仍保留复选框语义。
- 顶部「启用二代模式 / 提供推荐值 / agentPreset」并入字段规格（`V2_FIELDS.header`），不再手写行结构。
- `.field-switch` 高度对齐输入框（40px）、`.form-cols .field-control` 垂直居中，同排字段基线一致。
- 开关态同步：`setCheck()` 识别 `role="switch"`，写 `aria-checked` 与开/关文案（此前写 `checked`，对按钮无效，导致「启用二代模式」显示为关）。
### 变更：二代仿真配置页改为「字段规格 + 统一渲染」
- 新增 `pages/social-v2/fields.js`（`V2_FIELDS`：8 组、57 字段），`page.html` 只保留分组外壳与说明；字段由 `renderFields(host, spec, { columns: 2 })` 渲染，默认两列、长文本用 `span: 2` 占整行。
- 删除 `enhanceForm`（不再有页面使用）；取值统一 `fv/fc`（内核优先、DOM 兜底），写回仍落 DOM。
- 验收：payload 契约逐字节一致、225 个旧 id 全在、`test-console-ui` 24/24、`test-audit` 90/90。
### 变更：二代仿真配置页换壳为表单组件（DOM 增强）
- `enhanceForm(root)`：把既有「label + 控件」就地升级成 `.field`（标题、控件、错误行），页面 HTML 不改；`social-v2` 在 `init()` 里升级后挂 `createForm`。
- `saveV2Config()` 的 113 处 `.value` 与 29 处 `.checked` 读取改走内核（读取时直接读 DOM），写回仍是直接写 DOM；请求体与改前逐字节一致，`test-console-ui` 的 payload 基线未变（24/24）。
- 修 `.settings-content > .row label` 的 `flex-basis:100px!important` 误伤字段标题（改 `:not(.field-label)`）。

### 新增：表单组件（`components/form/`）
- 16 个控件工厂：文本、数字、密码、多行文本、下拉、单选组、多选组、单复选、开关、文件、日期、时间、日期时间、时间区间、只读展示，加动作区；全部返回 HTML 字符串，与 `components/table` 的写法一致。
- `createForm(root, { rules, depends, onSubmit })` 内核：按类型取值（空数字是 `null` 不是 `NaN`）、字段与跨字段校验、`blur` 才报错、条件显示（隐藏字段不参与校验与提交）、提交态、`dirty()/reset()`、`setErrors()` 服务端错误回填。
- 字段注解统一由工厂渲染：`hint`（灰）、`warn`（黄，写触发条件与后果）、`danger`（红，写清不可恢复的是什么）、`docs`（链接），另有块级 `formCallout()`。
- 日期时间用原生控件，值格式 `YYYY-MM-DD` / `HH:mm`，按北京时间；`timeRangeField` 支持跨零点与「开始≠结束」校验。
- 演示页 `components/form/demo.html`（不进导航）铺满 16 个控件与三类注解，同时作为 `test-console-ui` 的回归夹具：19 条断言覆盖取值/条件显示/校验/开关/脏值与 `reset`。

### 变更：控制台基础层（语义令牌、12 列栅格、输入外观改元素级）
- `tokens.css` 新增语义别名与 `--space-1..8`/`--radius-md`/`--elevation-*`/`--text-*`/`--bp-*`；原 163 个令牌一个未改，别名用 `var()` 指向它们，深色主题自动跟随。
- 新增 `css/grid.css`：`.cols` + `.col-1..12` + `.col-{sm,md,lg,xl}-*` + `.stack`/`.cluster`，断点与现有 760/900/1180/1500 对齐；`index.html` 中排在 `components.css` 之前。
- 基础输入外观从 `input[type=text]` 一串改为 `:where(input:not([type=checkbox]):not([type=radio])…)`：漏写 `type` 不再退回浏览器默认描边（改名弹窗就是受害者），且特异性为 0，组件类可正常覆盖。
- `scripts/test-console-static.mjs` 增 8 条断言（栅格顺序、语义令牌、`:where` 选择器、页面 `<input>` 必须写 `type`）；`console-ui-fixture` 与 `console-source` 同步 `grid.css`。

### 变更：控制台组件目录化，搜索框外观收口到组件
- 新增 `public/console/components/<name>/{<name>.js,<name>.css}`：`message` / `modal` / `table` 从 `js/components/` 与 `css/components.css` 迁入，js 与 css 同住；`index.html` 逐个 `<link>` 组件样式，`src/bridge.js` 的静态放行加 `components`。
- 新增 `search-box` 组件：`searchBoxHtml()` / `bindSearchBox()`；6 处搜索框统一成 `type="search" class="search-box"`，删掉 `components.css` 里的 `.search-wrap input,input.search-box` 组合规则。
- 修掉「页面里的搜索框没有外观」的根因：漏写 `type` 导致 `input[type=…]` 基础规则不命中。窄版宽度改用组件自己的 `input.search-box--w240`（通用 `.u-maxw-240` 会被 `input[type=search]` 的 `max-width:100%` 盖掉）。
- `scripts/test-console-static.mjs` 增组件目录、样式归属、`type="search"` 三类断言；`scripts/console-ui-fixture.mjs` 与 `scripts/console-source.mjs` 同步支持 `components/`。

### 修复：soulkit 人格卡按 key 形态读不到
- soulkit 的绑定按 `<group|private>:<id>` 存，而桥接的会话 key 是 `<platform>:<kind>:<id>`；`plugins/soulkit-persona` 直接把带平台前缀的 key 传过去，`/api/persona/card` 一律回 `mode: "none"`（表现是会话页「未挂卡」、日志 `人格卡刷新失败`）。
- 适配器新增 `soulkitKey()`：认得出新形态就剥成 `<kind>:<id>` 再请求，认不出原样透传；**soulkit 侧未改**。
- 真机复测 `/api/persona/sources` 恢复 `source: "provider"`、`name: "魅魔2"`；`test-soulkit-persona` 新增对应用例（8/8）。

### 变更：会话页按「会话映射」呈现，搜索框外观统一
- 「会话与审批」页的会话签改名为「会话映射」：只呈现平台侧身份与状态（key 里的平台前缀加了 `qq` 徽章），去掉「DSH 会话」列，不再在这一页暴露 DSH 侧 id。
- 新增「平台」筛选（按 key 前缀现算选项，不写死 `qq`），与原有「类型」筛选、关键词搜索一起收窄列表。
- 操作只留「改名」：清除上下文等会改动会话配置的按钮从这一页移除（改名仍然写回 DSH 侧栏标题）。
- 搜索框统一：新增 `class="search-box"`，与右上角全局搜索共用 `components.css` 的一条规则（`10px` 圆角 / `12px` 字号）；`behaviors`、`sessions`、`slang` 三页五个输入框都套上了，`layout.css` 里重复的 `.search-wrap input` 外观声明删除。
- 约定写进 ](./docs/_internal/PLUGIN_ROADMAP.md) §12 第 8 条，避免以后新页面又用裸 `<input>`。

### 变更：会话 key 只剩一种形态，删除 `platform.keyedFormat` 开关
- 会话 key 统一为 `<platform>:<group|private>:<id>`（qq 即 `qq:group:1`）。旧的 `group:1` 只在**读取侧**由 `parseKey()` 兼容，不再有任何产出路径，也不再有任何开关。
- 解析侧全面迁移：`mode-gate`、`prompt-blocks`、`role-per-key`、`role-refresh`、`mode-handover`、`voice-core`、`memory-policy`、`cross-group`、`scheduler/engine` 里只认旧形态的正则 / `split(':')` / `startsWith('group:')` 一律换成 `parseKey()` / `isGroupKey()` / `isPrivateKey()`。
- 修掉一个**真实发送失败**：`sendToQQ` 及另外 7 处 `key.split(':')` 在 `qq:group:1` 上会解出 `kind='qq'`、`id='group'`，实际调用 `sendGroupMessage(null)`；现在统一 `parseKey()`。
- 接口容错：HTTP 的 `key` 参数（19 处 query、35 处 body）、`ensureSession()`、审批登记表都经 `apiKey()` / `normKey()` 归一，旧形态请求不会 404。
- 修复因解析侧未迁移导致的**私聊静默丢失**（消息在准入闸门被丢弃、日志无任何输出）；详见 `docs/STATUS.md` §6.1 / §6.2。
- 门禁：`test-session-key` 11/11、`test-integration-v030` 31/31、`npm run test:audit` 90/90。

### 控制台：会话清单与审批标签页（PARITY D3 / D7 第一步）
- 「会话与审批」页不再用两张卡片平铺：改成 **会话 / 审批 / 提问** 两个标签页，共用同一张卡片。标签页样式抽成通用 `.page-tabs` / `.page-tab`（与黑话页的 `.slang-tabs` 同一套规则），页面不再各写一份。
- 会话清单从「key + DSH 会话 ID + 类型」扩成完整一行：**模式**（含封闭 Agent 的权限级别）、**人格来源**（provider / 全局卡 / 未挂卡，`stale` 标「缓存」）、**未读数**、**最近唤醒时间**、DSH 会话 ID，以及「改名 / 清除上下文」两个动作。
- 新增 `POST /api/session/rename`：标题在桥接侧归一化（折叠空白、去控制字符、限 60 字），只调 DSH 的 `session.rename`，**桥接不另存一份标题**（存了就会和 DSH 侧栏打架）。空标题 / 超长 400，会话不存在 404，DSH 失败 502。
- `GET /api/sessions` 一次给全：`kind` / `id` / `mode` / `preset` / `level` / `persona{source,name,stale}` / `unread` / `lastWakeAt`。页面不再为了凑一行依次打四个接口。
- 测试：`test-audit-bridge` 新增改名用例（400/404/标题归一化/只调一次 `session.rename`）；`test:audit` 90/90。

### 文档：真机联调记录与 STATUS 更新（2026-11-05）
- `docs/_internal/STATUS.md`（本地台账，不入库）新增 §5「真机联调记录」：记下已验证项（SnowLuma 连接、白名单、chat 回复、reserved2 唤醒、三个注入块各 2 次调用、soulkit 人格卡）与未验证项。未验证的回复发送不是 nexus 缺陷，而是 DSH profile 的 MCP server 仍指向 `qq-bridge-enhanced` 的脚本（读 enhanced 的 `config.json`，端口 3100，`ECONNREFUSED`）；修复动作已写明（`setup-dsh` 重指 + 重启 DSH）。
- 同步把 §1 第 1 行从「从未跑过」改为按证据描述差什么，依赖列补「MCP 指向 nexus 并重启 DSH」。

### 新增：技能清单注入（路线图 §9.2）
- `src/skills/index.mjs`：只读扫描技能根目录（`SKILL.md` 前 600 字，认 `name` / `description`），不执行脚本、不跟随符号链接，目录缺失或损坏只跳过。
- 唤醒提示新增内置块 `core-skills`（priority 150）：标题 1 行 + 最多 `skills.maxEntries` 行 + 溢出提示 1 行，每条只给「名字：一句说明」——**行数由配置固定，不随技能数量膨胀**，全文由 AI 需要时自己读 `SKILL.md`。
- 根顺序：`config.json` 的 `skills.dirs` → `DSH_HOME/skills` → 仓库 `skills/`，同名技能以先出现的为准；扫描结果缓存 60 秒。
- 配置白名单：`skills.enabled` / `maxEntries`（1–40）/ `maxChars`（100–8000）/ `maxDescriptionChars`（8–120）/ `dirs`（≤8 条）；也可用 `promptBlocks['core-skills'].enabled` 单独关块。
- `/api/extensions` 的技能列表改为同一个 `skillIndex`：控制台「技能」页与提示词注入同源（此前是两份扫描逻辑，页面上有、提示词里没有）。
- 测试：`scripts/test-skills-index.mjs` 8 条 + `test-core-prompt-blocks.mjs` 的 `core-skills` 端到端用例；`test:audit` 89/89。

### 文档：一页可复核的未完项清单（2026-11-05）
- 新增 `docs/STATUS.md`：把散在路线图、提交信息与口头汇报里的「没做完 / 只做了一半 / 卡在别人身上」收敛成一张表，每项写清 **是什么 / 完成判据 / 依赖 / 优先级**，状态只允许 `Done`、`Partial`（括号里写差什么）、`Blocked`（括号里写等什么）。
- 与路线图分工：路线图写「打算怎么做、为什么」，状态清单写「现在到哪、还差什么、怎么复核」；`Partial` 不许写成 `Done`，阶段收尾先对表。同时列出明确不做的项（指向路线图 §10），避免把「决定不做」混进「还没做」。
- 文档索引 `docs/README.md` 增加入口。

### 样式：控制中心与控制台共用一套设计令牌（2026-11-05）
- `public/console/css/tokens.css` 补 13 个通用令牌：`--font-ui`/`--font-mono`、`--on-solid`、`--danger-solid`、`--radius-sm`，以及终端面板的 `--term-bg`/`--term-fg`/`--term-fg-dim`/`--term-tag`/`--term-err`/`--term-warn`/`--term-system`/`--term-cmd`。按语义命名，不标「某端专用」——控制台以后做日志/终端视图可直接用。
- 控制中心 `app.css` 删掉自己的 `:root` 与 `prefers-color-scheme`，15 个本地变量全部映射到共享令牌（`--panel→--surface`、`--panel2→--surface-subtle`、`--line→--border`、`--bad→--err`/`--danger-solid`、`--chip→--surface-chip`、`--warn→--warn-fg`/`--warn-border`、`--term→--term-bg`、`--radius→--radius-sm`、`--mono→--font-mono`），并去掉旧色值字面量。
- launcher 新增固定文件路由 `/shared/tokens.css` 与 `/shared/theme-boot.js`（只这两个文件，不走目录遍历）；控制中心页面先加载它们再加载 `app.css`——两个页面现在真的读同一份文件，主题都走 `data-theme`。
- 控制台同步：`base.css` 字体改用 `--font-ui`、主按钮白字改用 `--on-solid`；`utilities.css` 与 `components.css` 的等宽栈统一用 `--font-mono`（原来 `var(--mono)` 落空，另有 5 处硬编码 Consolas）。
- 测试：`test-console-static` 断言控制中心无 `:root`/媒体查询、先加载共享令牌、引用的 28 个令牌都存在；`test-control-center` 新增 `/shared` 两个文件的 200/MIME/字节一致断言。

### 修复：控制台 401 门页外置 + 页面 cookie，无令牌不再白屏、刷新不再闪门页（2026-11-05）
- 根因：`43378be` 去掉 CSP 的 `unsafe-inline` 时，`bridge.js` 里那张 401 页仍是内联 `<script>`，被浏览器直接拦掉 ⇒ `body` 为空、只剩标签「需要令牌」。
- 门页单独放 `public/console/gate/{index.html,gate.css,gate.js}`：整页文档不能并入 `pages/`（那里会被 `console-source` 拼进控制台源码）；401 时读 `index.html` 原文返回（缺文件 500 兜底），脚本/样式全部外链，`bridge.js` 不再内联任何登录页 HTML/JS。
- 刷新不再闪门页：页面鉴权通过后服务端种 `qq_console_token`（`Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`，30 天滑动），之后刷新导航直接 200；cookie 只参与页面 GET，API 仍只认 `x-console-token`，取值优先级 `?token=` > cookie > 头。
- 门页脚本放在 `<head>` 先于样式表执行：带本地令牌时在首绘前直接 `/?token=…#page`；被服务端拒绝（URL 带 `?token=` 仍 401）就清掉本机令牌、抹掉地址栏里的失效令牌并提示「令牌无效或已更换」；`?manual=1` 跳过自动尝试（控制中心「手动输入」入口）。
- 会话内不再弹原生 `prompt`（那是和门页重复的第二套登录 UI）：控制台 API 401 统一 `location.replace('/?reauth=1' + hash)`，门页清掉旧令牌并提示「登录状态已失效」；`reauth=1` 时服务端即使页面 cookie 仍有效也强制回门页，避免「cookie 有效但页面拿不到令牌」变成 401 → 控制台 → 401 循环。
- hash 回跳：门页把 `location.hash` 拼进 `/?token=…#page`，`api.js` 落盘后 `replaceState` 还原；`?token=` 现在对 `/console` 与 `/console/` 同样生效；`api.js` 里已无用的 `consoleTokenTried` 清掉。
- 测试：`test-control-center` #17 改为断言门页在 `gate/`、是完整文档、外链脚本、hash/manual/清令牌，并断言 `bridge.js` 不再内联、读新路径、种 cookie；`test-console-static` 把门页纳入内联 style/script 扫描与 `node --check`。三套用例：console-static 全过、control-center 21/21、http-boundary 7 pass + 1 skip。

### 重构：会话策略指纹收进 `src/session/policy.mjs`（P7 第三步收尾，2026-11-05）
- `sessionPolicy()` 与 `isCurrentSession()` 从 `bridge.js` 搬出，`bridge.js` 只留两行薄包装。指纹由「模式 + 模式预设 + （closed-agent 才有的）管理员/级别/权限预设」组成；**级别只在 closed-agent 进指纹**是有意为之——漏了它，「管理通道提权成功但旧会话继续按低权限跑」；多算易变量则「每次检查都判过期、会话无限重建、反复读卡烧 token」。
- `isCurrent()` 把「仍被允许 + 映射没换 + 指纹没变」三条件写在一处，缺一条就会复活幽灵会话。
- 新增 `scripts/test-session-policy.mjs`（9 条）：chat 指纹只含模式+预设、私聊 null 稳定成空串、closed-agent 级别变化必须改指纹、`plan.ok=false` 时预设位空串、非 closed-agent 级别不进指纹、三条件、缺参不抛、缺依赖构造即报错。VM 夹具补 `createSessionPolicy`。

### 收口：三项长期「既有失败」修绿（P7 第五步，2026-11-05）
- **红着就等于没有这条断言**，而这三项恰好都在安全/可用边界上。逐条真因与处理：
  - `test-preset-local-tools` #5：守卫名单按目标版本（DSH 0.3.x）写，本机是 0.1.1-rc.2，15 个 0.3 才有的工具名在安装目录里本来就不存在。加 `TOOL_NAMES_ADDED_AFTER_0_1` 豁免集 + 版本判定：**只有本机 DSH < 0.3 才豁免**，升级后自动恢复严格（版本读不到时从严）。既不逼人删真名字，也不给拼错名字长期开洞。
  - `test-control-center` #20：迁移守卫检查「旧目录 WebUI 端口是否在监听」，用例假目录没写 `runtime.json` ⇒ 落默认 6099，本机真开着 SnowLuma 时被误判「运行中」而 409。用例改为写 `config/runtime.json` 的 `webuiPort`，端口由 `freePort()`（绑 0 再关）现取，产品逻辑不动。
  - `test-mac-app` #2：`control-center.command` 被 Windows 编辑器改成 CRLF，而断言用 `else\n` 锚点 ⇒ 整条不匹配。读入后统一 `\r\n → \n` 再断言。
- 另外修掉 `interface-platform` 的一条**偶发**红：「健康阶梯」断言 `nickname === '测试机器人'` 时只等了「账号出现在列表里」，而上游登录信息是随后一拍才回报的 —— 现在等到 nickname 就位再断言（连跑 3 次均 14/14）。
- 结果：`npm run test:audit` 不再有「已知失败」项，`test-preset-local-tools` 7/7、`test-control-center` 21/21、`test-mac-app` 3 pass + 1 skip（macOS 专属）。
### 重构：SnowLuma 接收链路健康搬进 `src/upstream/snowluma-health.mjs`（P7 第四步，2026-11-05）
- 健康状态机、快照文案与 `get_status` 兜底轮询从 `bridge.js` 搬出（−104 行 → +33 行接线），`bridge.js` 只喂心跳/状态事件、保留 `pollSnowlumaStatus()` / `startSnowlumaWatch()` 两个薄包装；日志、`fetch`、时钟、定时器、告警阈值全部注入，可用假时钟驱动。
- 这一步真正收口的是**两个故障面不能混**：`good=false` 是 SnowLuma 自报 **[Hook] 收不到 QQ 数据**（消息进不来），长时间没有事件包只是**进程/WS 静默**（心跳由它自己无条件发，不代表 hook 死了）——排查方向完全不同，以前这两种情况共用一条 `degraded` 布尔与一段文案。
- 新增 `scripts/test-upstream-snowluma-health.mjs`（10 条）：非布尔 good 忽略、两种 hint 互不串味、同时故障优先报「确认坏」、边沿告警只报一次、恢复只报一次、轮询成功/HTTP 非 ok/抛错三种路径、`startWatch` 只启动一次且 5s 首轮 + 30s/60s 两个定时器。
- 既有 `scripts/test-snowluma-upstream-health.mjs` 同步改为**两侧断言**：取值逻辑看模块（`/get_status`、`body.data?.good`），接线看 bridge（`createSnowlumaHealth`、`snowlumaHealth.pollStatus`）——否则搬家后这条最重要的断言会静默失效。
- 验证：新用例 10/10、既有用例 9/9、`test-integration-v030` 31/31、`test-audit-bridge` 全 PASS、全量 `test:audit` **82/85**（三项既有失败不变）。

### 重构：上游编排的两条纯策略抽成模块（P7 第四步收尾，2026-11-05）
- `src/upstream/dsh-probe.mjs`：把「探活失败时按 10s 节流重新识别 DSH 随机端口、识别到就重试一次」从 `checkDsh` 的闭包里抽出来。以前这段只能靠「起整桥接 + 关掉 DSH」验证，现在可以断言「首次即可重识别」「窗口内不重复扫端口」「识别到地址但探活仍失败时不能算恢复」。顺带修掉一处重复日志（重新识别的提示原先会打两遍）。
- `src/upstream/snowluma-conn-update.mjs`：把「HTTP token 与 WS token 是两个不同的值」「发现到的端点该不该跟随」压成一张决策表。`snowluma.followDiscoveredEndpoint=false` 或经接口平台时**只自愈 token、绝不改 URL、绝不写回 config.json**——这条以前靠「改 cfg 之后再恢复」维持，现在由 `persistUrl` 直接表达，不会再漏。
- 新增 `scripts/test-upstream-dsh-probe.mjs`（8 条）与 `scripts/test-upstream-conn-update.mjs`（8 条）；夹具补 `createDshProbe` / `resolveConnectionUpdate` 注入。
- 边界说明：MCP server 由 DSH 以子进程方式启动（桥接只维护清单、不 spawn、不分配端口），因此第 4 步在上游侧没有「MCP host 启停」可搬；`bridge.js` 里剩下的上游代码是事件接线与模式/队列联动。

### 重构：会话映射表收进 `src/session/registry.mjs`（P7 第三步收尾，2026-11-05）
- `state.sessions` / `state.sessionPolicies` 的 46 处直接读写全部换成注册表方法：`get` / `policyOf` / `has` / `keys` / `ids` / `entries` / `raw` / `bindSession` / `setPolicy` / `drop` / `dropPolicy` / `unbind` / `isCurrent` / `clearAll`。
- 收口的价值在两条此前只写在注释里的规则：**映射与策略指纹必须成对维护**（只写映射不写指纹 ⇒ `isCurrentSession()` 永远判旧、会话无限重建；只删映射不删指纹 ⇒ 下次同 id 会被误当新会话），现在由 `bindSession()` / `unbind()` 保证。
- 注册表接 `() => state` 的 getter 而非 state 对象——`loadState()` 会整体替换 `state`，闭包旧引用会过期；`scripts/test-session-registry.mjs` 7 条专门钉住这个回归。
- `sessionPolicy()` 仍留在 `bridge.js`：它拼的是 `modePreset()` / `closedAgentPlan()` 的口径，属于模式层。
- 迁移时踩到一个自引用坑：`/api/compact/config` 里局部变量就叫 `sessions`，被机械替换成 `const sessions = sessions.entries()` ⇒ TDZ `Cannot access 'sessions' before initialization`，`test-auto-compact` 立刻打红；局部变量改名 `rows` 修复。教训：批量替换前先查同名局部变量。
- 验证：`test-session-registry` 7/7、`test-integration-v030` 31/31、全量 `test:audit` 除三项既有失败外无新增。

### 重构：`sessions.json` 读写搬到 `src/session/store.mjs`（P7 第三步续二，2026-11-05）
- `loadSessionState()` / `saveSessionState()` 从 `bridge.js` 搬到 `src/session/store.mjs`，`loadState()` / `saveState()` 只剩两行调用；文件、原子写、日志、`normalizeDormant` 全部由调用方注入，模块内不读全局。
- 这一步的真正目的是把两条安全不变量变成可离线验证的代码：**读失败或 JSON 损坏 ⇒ `writable:false`，此后任何一次保存都不得回写**（早期实现读到坏文件就当空状态，紧接着的原子写会把空映射永久落盘）；**老文件缺 `sessionPolicies` / `dormantSessions` 就地补齐**，不因少一个键把整份判成不可用。
- 新增 `scripts/test-session-store.mjs`（8 条）：ENOENT 空状态、BOM 剥离、缺字段补齐、`sessionPolicies` 数组被重置、`normalizeDormant` 注入生效、损坏 JSON ⇒ 只读 + 日志、非 ENOENT 读错 ⇒ 只读、`writable:false` 时 save 既不调用原子写也不改动原文件；已登记进 `test:audit`。
- VM 夹具 `scripts/audit-bridge-harness.mjs` 再补 `loadSessionState` / `saveSessionState`（第三次踩同一个坑：夹具剥 import，漏补就是 `ReferenceError`）。
- 验证：`test-session-store` 8/8、`test-integration-v030` 31/31、`test-audit-bridge` 全 PASS；全量 `test:audit` **80/83**（仍为三项既有失败）。

### 重构：会话准入闸门搬到 `src/session/mode-gate.mjs`（P7 第三步续，2026-11-05）
- `allowed`（白名单：deny 优先、单复数键名、空表按 `allowAllWhenEmpty`）、`modeAllowed`（closed-agent 只放行 owner 私聊，chat/reserved/reserved2 走白名单）、`isSessionAllowedInCurrentMode`（`group:`/`private:` 形态校验）从 `bridge.js` 搬到 `src/session/mode-gate.mjs`，保持纯函数、`cfg` 由调用方传入，行为逐字不变。
- `bridge.js` 只留 `isSessionAllowedInCurrentMode(key)` 薄包装（转调 `sessionAllowed(key, cfg, currentMode)`），`builtin.mjs` 的 `acl: { allowed }` 接线不变；这些判断原先各有 7 / 18 / 多处调用，散在 14k 行里，改规则只能靠全量回归。
- 新增 `scripts/test-session-mode-gate.mjs`（6 条）：白名单空表语义、单复数键名与字符串 id、deny 优先、closed-agent 只看 owner 私聊、三种聊天模式、非法 key 形态拒绝；已登记进 `test:audit`。
- VM 夹具 `scripts/audit-bridge-harness.mjs` 补 `allowed` / `modeAllowed` / `sessionAllowed`（夹具会剥 `bridge.js` 的 import，漏补就 `ReferenceError: allowed is not defined`，整批用例红）。
- 验证：`test-integration-v030` 31/31、`test-audit-bridge` 全 PASS、`test-session-mode-gate` 6/6；全量 `test:audit` **79/82**（三项既有失败不变）。

### 测试：控制台浏览器回归真正跑起来（2026-11-05）
- 夹具 `scripts/console-ui-fixture.mjs` 之前只把 `public/console/js/*.js` 顶层文件注册进资源表，片段化后的 `js/components/*`、`js/lib/*` 全是 404 ⇒ `app.js` 的 import 失败、整页不启动、片段永不注入，测试卡在 hydrate 超时。改为递归提供全部脚本，并补 `/console/img/*`、`/console/fonts/*` 与 `/api/{plugins,commands,extensions,persona/sources}` 四个只读桩，15 个页面请求 404 清零。
- 测试辅助 `reveal(selector)` 原来靠 `locator.evaluate(el => el.closest('[data-page]'))` 反查元素属于哪一页——片段化后元素在未注入的页里**根本不在 DOM**，于是先超时、永远走不到导航分支。改为启动时逐页 hydrate 一遍、拍下「元素 id → 所属页」快照，之后先切页再定位。
- `dialog` 处理去掉重复的 `page.once('dialog', ...)`（两个 handler 会对同一个 dialog 二次 `accept()` 而抛错），只保留一个会 `catch` 的全局监听。
- 修两个真实缺陷：① 手机 390px 下面板被 `#mainNav` 的 min-content 撑到 1179px 宽（网格列改 `minmax(0,1fr)`、`#mainNav` 加 `min-width:0`）；② 「二代仿真」页每次进入都重拉配置，把未保存的草稿冲掉（配置只在首次进入与保存成功后加载）。
- 契约基线按当前控制台重录一次（`--accept-contracts`，25 条写请求）：差异是 `/api/mode` 与 `/api/roles/*` 新增 `level` / `apply` 字段——closed-agent 分级与人格切换生效时机是改版后能力。`--record-baseline` 仍只允许搭配 `--original`，重录开关与理由写进 `docs/guides/CONSOLE-UI-TESTING.md`。
- 结果：`npm run test:console-ui`（配 `PLAYWRIGHT_MODULE='playwright-core'` + 本机 Edge）**23/23 全绿**、连跑两次稳定；此前本机因缺 `playwright` 一直整段跳过。

### 重构：`/reset` 的清理序列搬到 `src/session/reset.mjs`（P7 第三步，2026-11-05）
- 新增 `src/session/reset.mjs`：`createSessionResetter(deps)` 返回 `resetSession(key)`，承接原来写在 `bridge.js` 里的 58 行清理序列——删 `state.sessions`/策略、清 8 个按旧 sessionId 索引的 Map、`pending` 与 `ext.approvals`、提示队列、`messageMediaStore`、social/socialV2/slang 的按键缓存、四个 wake 集合、`seenForwardIds`，再落盘、停 DSH 侧工作、归档、回执。
- 顺序按「先删挂账、再清内存、再落盘、最后网络调用与回执」固定下来，并写进文件头注释：反过来会在清理没做完时就让用户看到「已重置」。
- `bridge.js` 只剩惰性拼 `deps` 的登记段（首次重置时才建，避免模块顶部的 TDZ）；`sessionEpoch` 通过 `bumpEpoch` 回调传入，模块不直接改这个变量。行数上这一步基本持平（−58 行逻辑、+64 行登记，`bridge.js` 14694 行），换来的是清理序列能脱离桥接单测。
- 新增 `scripts/test-session-reset.mjs`（4 条）：`no-session` 直接返回且不动任何状态、全桶清理（逐 Map/Set 断言，少登记一个桶就会红）、落盘 < 停 DSH < 归档 < 回执的顺序、停止旧会话抛错时只记日志并继续归档回执。
- 回归：`scripts/test-integration-v030.mjs` 31/31、`scripts/test-audit-bridge.mjs` 全 PASS（含「console reset drops the session policy and stops the retired DSH session」）。

### 重构：内置命令壳抽到 `src/commands/`（P7 第二步，2026-11-05）
- 新增 `src/commands/builtin.mjs`（`createBuiltinCommands(deps)`，承载 `/reset` `/status` `/role` `/silent` `/active` 五条命令的定义、别名、权限、分组与文案）与 `src/commands/payload.mjs`（`buildCommandsPayload(registry)` 组装 `GET /api/commands` 的三段响应）。
- `src/bridge.js` 删掉 `commandStatus`/`commandRole`、5 条内联 `commandRegistry.register({...})` 与 `/silent` `/active` 两段旧 `if` 分支；`/api/commands` 由 20 行字面量改成一次 `sendJson(buildCommandsPayload(commandRegistry))`。`commandReset(ctx)` 改名 `resetSession(key)` 留在原地（要收口 30 个内存态对象与 45 处调用，属于第 3 步会话层）。
- `bridge.js` 14745 → 14686 行（净 −59），`commandReset`/`commandStatus`/`commandRole` 残留 0；入口、行为、文案不变。
- 回归门禁：`scripts/test-command-registry.mjs` 扩到 17 条（新增 `makeBuiltinHarness` 假 deps，覆盖五条命令注册/别名、`/status` 文案、`/reset` 透传、`/role` 五种分支、`/silent` `/active` 改模式、payload 分组）；`scripts/audit-bridge-harness.mjs` 补 `createBuiltinCommands`/`buildCommandsPayload` 的 import 与 sandbox 条目（VM 夹具剥 import，漏了会 `ReferenceError`）。
- 文档：`docs/COMMAND_REGISTRY.md` 新增 §9「代码位置」并把迁移状态改成「五条内置全部 `migrated:true`」；`docs/PLUGIN_ROADMAP.md` §8.8 标第 1、2 步完成、第 3 步（`resetSession` + 会话状态）列为 A′ 待做。

### 重构：控制台组件层（3.2，2026-11-05）
- 新增 `public/console/js/components/`：`table.js` 的 `tableHtml(columns, rows)`（由 `ui.js` 的 `simpleTable` 迁出，列宽仍走 `data-w`）、`message.js` 的 `setMsg(target, text, kind)`（把「设文本 + 设 `meta ok|err`」收成一处，22 处调用点全部改用它）、`modal.js` 的 `openModal`/`closeModal`/`isModalOpen`/`wireModal`（统一 `.open` 类与 `aria-hidden`，Esc 与点遮罩关闭）。
- 插件详情弹窗与黑话模态改走 `wireModal`：前者据此挂到 `document.body`（片段注入在 `.card` 里，`.card` 的 `backdrop-filter` 会给 `fixed` 造包含块，遮罩只盖住卡片）；后者自带 Esc 焦点环，传 `closeOnEscape: false` 避免双重关闭。
- `ui.js` 只剩 toast、`esc`、tile 列表与 `applyPageA11y`，无调用方的 `renderTable` 删除；三个只读页（技能 / MCP / 管理行为）改用 `tableHtml`。
- 回归门禁：`test-console-static` 增 12 条组件断言（文件存在、导出签名、页面改用 `tableHtml(`、全局不再有 `className = 'meta ok|err'`）；`test-console-ui` 的片段化选择器改为「先切页再等元素」，两处 `style.display` 断言改成 `hidden` 属性。真机探针验证「点开 / Esc 关 / 点遮罩关 / 黑话页注入」全部通过、零异常。

### 安全：CSP 去掉 `unsafe-inline`（3.4 收尾，2026-11-05）
- 控制台彻底外置：HTML 与 15 个页面模块里现在 **0 处内联 `style`**、`index.html` 无内联 `<script>`/`<style>`；主题引导抽成 `public/console/js/theme-boot.js`（同步 `<script src>`，仍放在样式表之前防首屏闪白）。
- 动态排版改正规路径：表格列宽由内联 `style="width:Npx"` 改成 `data-w="N"`（`components.css` 用 `th[data-w="…"]` 给宽度，`renderTable`/`simpleTable`/管理行为页表头同步）、显隐一律用 `hidden` 属性（`base.css` 的 `[hidden]{display:none!important}` 兜底）、用量页进度条改 `data-pct` + `applyUsageBarWidths()` 用 CSSOM 写宽度——CSP 的 `style-src` 不拦 CSSOM。
- `src/http/security.mjs` 的 `CONTENT_SECURITY_POLICY` 收成 `script-src 'self'; style-src 'self'`，其余（`frame-ancestors`/`base-uri`/`form-action`/`object-src`）不变。
- 回归门禁：`test-http-boundary` 新增「CSP 不含 `unsafe-inline`、script/style 只允许同源」断言（7 pass）；`test-console-static` 断言 0 内联 style，并把每个控制台模块复制成 `.mjs` 交给 `node --check` 做语法校验（index 里已无内联脚本可解析）。
- 浏览器探针（深链 `#usage`、切页到管理行为、搜索候选层、定时任务时区、用量图表）无 `securitypolicyviolation`、无异常；管理行为表头宽度 200/92/118/84/84/70 按 `data-w` 生效。

### 重构：控制台样式再分三层（3.3 第二步，2026-11-04）
- `public/console/css/app.css`（1810 行）按连续区间拆成三件：`base.css`（重置、排版、滚动条、按钮与表单基线，123 行）、`layout.css`（三容器外壳、侧栏、顶栏、主区、页面标题与指标条，343 行）、`components.css`（网格、卡片、表格、表单、弹窗、主题与各页细节，1357 行）；`index.html` 依次加载 `tokens → base → layout → components`，原 `app.css` 删除。
- 拆分脚本先断言「三件按序拼接 === 原文件（逐字节）」再落盘，级联顺序与拆分前完全一致；实测样式规则总数 296 条、概览页几何（模式卡 `y=484 / w=1086`）、深浅色令牌值全部不变。
- `scripts/console-source.mjs` 改为按顺序拼接四件样式；`console-ui-fixture.mjs` 逐个分发；`test-console-static` 的样式断言改为「三件存在、不含令牌、加载顺序正确、页面私有规则归属不变」。

### 重构：内联样式收口到工具类（3.3 收尾，2026-11-04）
- 新增 `public/console/css/utilities.css`（57 个工具类，最后加载）：把 HTML 里 407 处内联 `style` 中的 **388 处**换成 `.u-w-80` / `.u-flex-1` / `.u-mt-8` / `.u-m-0` / `.u-flex-basis-220` / `.u-between` 这一类工具类，覆盖 `index.html` 与 15 个 `pages/<id>/page.html`。
- 只映射纯静态属性（宽度、flex、外边距、gap、文字对齐），不把主题色与组件样式塞进工具类；含 `display:` 的 19 处保持内联——这些元素由 JS 切 `display` 隐藏/展开，换类会和 `el.style.display` 打架。
- 实测：`u-w-*` 宽度、`u-flex-1` 的 `flex-grow`、`u-mt-*` 外边距全部按预期生效；概览（模式卡 `y=484 / w=1086`）、插件、定时任务三页几何与转换前一致，零异常。`test-console-static` 增断言：工具类文件存在、加载顺序最后、HTML 内联宽度为 0、剩余内联 ≤20 处。
- **CSP 还没到**：JS 拼的模板里仍有内联 `style`（`ui.js:100` 表格列宽、`pages/behaviors/page.js:24-26` 写死列宽、插件/黑话页动态行）与 26 处 `el.style.display`；下一步把这些也搬走，才能去掉 `style-src 'unsafe-inline'`。

### 重构：启动器控制中心拆成三件套（3.5，2026-11-04）
- `public/control-center.html`（单文件 1280 行，样式与脚本全内联）拆为 `public/control-center/{index.html,app.css,app.js}`，并复制一份 `favicon.svg`；页面结构与行为不变，只把内联块换成 `<link>` 与 `<script src>`。
- `src/launcher/control-center.mjs`：`PAGE_FILE` 指向目录内的 `index.html`，新增 `GET /control-center/*` 静态路由（复用 `src/http/static.mjs` 的 `resolveStaticPath` + `serveStaticFile`，前缀锁死、穿越 404）；其余路由、`#t=` 令牌、锁文件与 `/api/*` 逻辑不动。
- 打包不受影响（`build-release.mjs` 用 `git ls-files` 收文件）；`test-control-center` / `test-napcat-manage` / `test-platform` / `test-linux-support` 的读取改为「index + app.js」拼接，原有断言全部保留。
- 实测：`GET /` 200（25073 字节）、`app.css` 12287、`app.js` 60543、`favicon.svg` 915，`/control-center/../../state/console-token` 返回 404；无头 Edge 打开页面零异常、样式与主标签正常。

### 重构：控制台样式分家（3.3 第一步，2026-11-04）
- 新增 `public/console/css/tokens.css`：`:root` 设计令牌与 `[data-theme="dark"]` 覆盖单独成层，`index.html` 里先于 `app.css` 加载（同文件内的顺序语义保持原样）。
- 页面私有样式回各自目录：`overview` 的三块网格占位、顺序与窄屏覆盖 → `pages/overview/page.css`；`usage` 的账本数字对齐、进度条、手写 SVG 图表与图例 → `pages/usage/page.css`；`app.css` 不再持有 `#section-*` 选择器。
- `test-console-static` 增 7 条断言（tokens 文件与顺序、app.css 不持有令牌、两页私有规则归属），防止样式回流。

### 修复：插件详情弹窗只罩住卡片；标签图标改回品牌字形（2026-11-04）
- 插件详情遮罩被 `.card` 的入场动画/`backdrop-filter` 形成的包含块困住，`position:fixed` 只覆盖卡片；现在 `init()` 里把 `#pluginDetailOverlay` 挂到 `document.body`（实测遮罩 1410×905 = 整页视口），并在路线图「页面模块约定」写明「片段里的 fixed 浮层必须挂 body」。
- 重画标签图标：不再自绘几何图形（原版被看成性别符号），直接复用侧栏品牌标记的字形——`<text>q</text>` + `<text>↗</text>`、同一套字体栈，**不画背景块**，颜色用 `@media (prefers-color-scheme)` 跟随系统深浅色；控制中心 `favicon.svg` 与之逐字节相同，两处图标只有一个来源。
- `test-console-static` 增 4 条断言（同形、无背景与自绘图形、跟随主题、两处一致）与 1 条浮层归属断言。

### 重构：控制台页面目录化（3.1：全部 15 页，2026-11-04）
- 收尾：插件页也收进 `pages/plugins/`（`js/pages/plugins.js` 删除），控制台 15 个页面至此全部自包含；`js/` 只剩 `api.js` / `ui.js` / `router.js` / `timezone.js` / `app.js`（约 290 行，只做全局刷新、搜索、主题与入口装配）。
- 新增 `public/console/img/favicon.svg`（初版为深色圆角底 + 自绘 `q↗`，当日晚些改版为「只留品牌字形、无背景」，见上方修复条目），`index.html` 声明 `<link rel="icon" type="image/svg+xml">`；`/console/img/` 沿用鉴权前的静态放行，标签图标不再空白。
- `public/console/pages/<id>/` 成为页面自包含目录：`skills`、`mcp`、`behaviors`、`reference` 四页的 DOM 片段、私有样式、页面模块搬进各自目录；`index.html` 对应 `<section>` 只留空容器（页面不再是「全写死在 index 里」）。`reference` 是纯静态页，模块只导出空 `init()`，保持「每页都有 `init()`」的约定。
- 路由器新增 `hydratePage(page)`：首次进入时 fetch `page.html` → 注入容器 → 按需插 `page.css` → 动态 `import()` 页面模块并调 `init()`；每页只加载一次，并发切页复用同一个 Promise；片段取不到时只在该 section 显示「页面加载失败（刷新重试）」，不影响其它页。
- `src/bridge.js` 的静态路由前缀扩到 `/console/(css|js|img|fonts|pages)/`（仍在令牌校验之前）；`scripts/console-source.mjs` 增 `consolePageDirs()` 并把页面片段拼进源码视图；`scripts/console-ui-fixture.mjs` 按真实路径提供 `pages/<id>/page.{html,css,js}`。
- `access` 是一页三卡（白名单 / 安全拦截 / 访问令牌），新增「多卡片页」约定：宿主 section 用 `.page-stack`（`display:contents`），注入的卡片直接落进 `main` 的网格，布局与搬之前一致；三个卡片的读取/保存逻辑与「显示令牌」按钮一起搬进 `pages/access/page.js`。
- `social-v2`（二代仿真）是单卡页：宿主保留 `class="card span-all"`，`page.html` 只放内部内容；23 个函数与 27 个事件绑定（配置存取、语音库、工具日志、轻量记忆、唤醒状态、一键补表情说明）整体搬进 `pages/social-v2/page.js`，`app.js` 少 739 行。
- 无障碍增强下沉：原来给表单补 `aria-label`、给主按钮补 `.primary`、给 `*Msg` 补 `role=status` 的代码只在入口脚本启动时跑一次，片段页注入得晚、永远补不上；现抽成 `ui.js` 的 `applyPageA11y(root)`，由路由器在页面 `init()` 后对注入的 host 再调一次。
- `social-v1`（一代仿真）与 `slang`（黑话词库）也搬进各自目录：表单读写、筛选 Tab、批量研究/确认/拒绝、词库模态与键盘焦点环随页面模块走；`slang` 的模态 DOM 留在共享宿主（`</main>` 之后），逻辑搬进页面，避免每页各造一个壳。
- 路由器新增 `refreshCurrentPage()`：全局刷新按钮现在会同时跑「当前页注册的 refresher」，搬走的页不再点刷新毫无反应。
- `scheduler`（定时任务）也搬进 `pages/scheduler/`：任务列表、编辑器（13 种重复方式、时区、目标、payload）、限额与免打扰设置、执行记录整块随页面走。它与「定时静默」共用一套时区下拉，因此把 `tzOffset`/`tzOptionsHtml`/`tzSet` 抽成 `js/timezone.js` 两页共用，初始化改到 `init()` 里执行。
- `usage`（用量与花费）是第二个多卡片页：两张卡（令牌与花费 / 上下文压缩）一起搬进 `pages/usage/`，宿主改 `.page-stack` 后原 `section-compact` 从 index 消失。图表绘制（手写 SVG）、逐轮明细、清空账本、价目表与压缩模式单选随页面走，3 秒图表轮询与 60 秒压缩轮询都保留「仅本页可见时」的判断。
- `persona`（人格与角色）搬进 `pages/persona/`：人格列表与编辑器、按会话设置人格、人格来源、恢复默认、仿真提示词整块（DOM / 逻辑 / 绑定 / 启动刷新）一起走。`filterRoleSuggestions` 从顶层 IIFE 改为 `init()` 内调用；全局 3 秒刷新不再跨页写页头，改由页内 `GET /api/status` 在进入页面与增删改后刷新。
- `operations`（调试与运维）是第三个多卡片页：测试发送 / 桥接控制 / 后台控制端引导三张卡一起搬进 `pages/operations/`，宿主改 `.page-stack`；四个按钮绑定与校验文案随页面走，清空工作区不再直接调 `refreshSessions()`，由全局指标轮询和会话页进入时刷新。
- `sessions`（会话与审批）搬进 `pages/sessions/`：会话映射 / 挂起审批与提问两张卡与 `refreshSessions` / `refreshPending`、清除上下文绑定、3 秒轮询一起走；跨页的 `#metricSessions` / `#metricPending` / `#pendingCount` 改为判空写入，会话页可见时由页面模块刷新、其它页由 `app.js` 的 `refreshSessionMetrics()` 补上，避免重复请求与空元素异常。
- 修复搜索索引的启动期崩溃：原来在入口脚本里对每个 `section[data-page]` 直接取 `h2`，片段页为空时会抛 `TypeError` 并中断后续初始化（整页交互失效）；现改为按需重建、跳过空 section，并用页面表标题给未注入的页兜底，保证「没打开过也能搜到」。
- `overview`（运行总览）搬进 `pages/overview/`：六块一页（摘要指标 / 运行模式 / 活动日志 / 发言上限 / 定时静默 / DSH 模型）按原顺序注入，宿主 `#section-overview` 用 `.page-stack` 放在 `.grid` 首个子元素，`#overviewSummary` 保留 `overview-summary span-all` 与 `data-page="overview"`，仍是网格首行。模式切换、发言上限、静默排期、DSH 模型读写与首次加载随页面走；摘要指标、活动日志与 `#statusText` 仍由 `app.js` 的 `refresh()` 写（页面管交互、app 管状态刷新），页面用 `console:refresh-status` 请求补刷，片段内节点写入全部判空。`router.js` 的 `[data-view]` 改为 document 级事件委托，片段里的 `#metricSessions`/`#metricPending` 可正常跳转；`app.js` 少 291 行（590 → 299）。
- `scripts/test-console-static.mjs` 增 16 条断言（页面目录三件套、index 容器为空、路由器注入、搜索索引兜底）。


### 重构：管理行为页迁到 pages/behaviors.js（2026-11-04）
- 命令注册表表格（按 group 折叠）、筛选/搜索防抖、组行展开，以及 DSH 会话命令与 Agent 工具两张只读表整段搬到 `public/console/js/pages/behaviors.js`，导出 `initBehaviorsPage()`；`app.js` 只留调用。
- 回归：无头 Edge 实测「注册表 5 条内置 + 0 条插件；显示 5 条」、2 个分组 7 行，无 JS 异常。

### 重构：技能页与 MCP 页迁到 pages/（2026-11-04）
- 新增 `public/console/js/pages/skills.js`、`pages/mcp.js`，各自导出 `initSkillsPage()` / `initMcpPage()`，自绑刷新按钮、自注册 `onPageRefresh`、自管 30 秒轮询与首次加载；`app.js` 只保留 `initXxxPage()` 调用。
- `simpleTable(columns, rows)` 从 `app.js` 移到 `ui.js` 导出（返回 HTML 字符串，与返回节点的 `renderTable` 并存），行为页与两个新模块共用。
- 回归：无头 Edge 实测技能页「共 1 个技能包」1 行、MCP 页「桥接自带 3 个 MCP server」3 行，控制台无异常。

### 重构：插件页迁到 pages/plugins.js（2026-11-04）
- 后续（同日）：插件页也收进自包含目录 `public/console/pages/plugins/`，`js/pages/plugins.js` 删除，`app.js` 不再静态 import 页面模块——控制台 15 个页面至此全部由路由器按需注入。
- 「桥接插件」页（加载状态、启停/重载/卸载、安装、运行设置、详情弹窗）整段从 `app.js` 搬到 `public/console/js/pages/plugins.js`，导出 `initPluginsPage()` 自己绑事件、注册 `onPageRefresh('plugins')`、做首次加载与 15 秒轮询。
- 页面模块新增 import 了 `esc`；缺这一条时 `refreshPlugins()` 的 Promise 会被 `.catch(() => {})` 吞掉，页面停在「加载中…」且控制台无报错（无头 Edge 实测复现并修复）。
- 回归：插件页 meta/卡片/4 个操作按钮渲染正常，详情弹窗可开可关；`test:audit` 77/80（三项既有失败不变）。

### 重构：控制台拆出 api / ui / router 三个公共模块（2026-11-04）
- `public/console/js/api.js`：`?token=` 引导与 `api()` 的 401 重试集中到一处。
- `public/console/js/ui.js`：`showConsoleToast`、`esc`、`renderTable`、`renderTileList`。
- `public/console/js/router.js`：页面表、`setConsolePage`、面包屑、hash/popstate、首屏三层恢复；页面数据刷新改为 `onPageRefresh(page, fn)` 注册，路由器不再反向依赖页面代码。
- `public/console/js/app.js` 只留装配（import + 建页面 + 绑事件 + 末尾 `initRouter()`）；`console-source.mjs` 与 `console-ui-fixture.mjs` 改为读取/分发整个 `js/` 目录，测试仍能一次读到全部源码。
- 回归：`test-scheduler`、`test-role-per-key` 的路由接线断言改为匹配 `onPageRefresh(...)` 与 `getCurrentPage()`；无头 Edge 实测 5 个资源全 200、路由/刷新/面包屑/搜索层级正常、无 JS 异常。

### 重构：控制台拆成「骨架 + 样式 + 逻辑」三件套（2026-11-04）
- `public/console.html`（372 KB 单文件）拆为 `public/console/index.html`（结构）、`css/app.css`、`js/app.js`（ES module，零构建）；原文件已删除。
- 服务端新增控制台静态路由：只放行 `^/console/(css|js|img|fonts)/`，且**排在令牌校验之前**（浏览器取资源不带令牌头，放在后面会 401 白屏）；页面 `/`、`/console/` 仍需令牌，穿越/符号链接/白名单外扩展名一律 404。
- 测试适配：新增 `scripts/console-source.mjs`（`consoleSourcePaths` / `readConsoleSource`），14 个读取旧 HTML 的用例改用它；`scripts/console-ui-fixture.mjs` 预读并分发 `/console/css/app.css`、`/console/js/app.js`。
- 验证：无头 Edge 实测样式/脚本均 200、无控制台异常，深链与刷新保页、点击进页刷新、未知 hash 回落全部保持；`npm run test:audit` 77/80（失败仍为三项既有问题）。

### 修复：控制台刷新回首页、面包屑不可点、搜索候选被遮挡（2026-11-04）
- 刷新保页：当前页写入 `sessionStorage['qqb-console-page']`，首屏按「hash → sessionStorage → overview」三层恢复；补 `popstate` 监听；未知 hash 回落并 `replaceState` 纠正地址栏，同时提示一次。
- 面包屑可点：分组由 `#mainNav` 的 `.nav-label` 推导（不再维护第二份页面父子表），`renderBreadcrumb()` 生成 `<a href="#组内首页">`，当前页保留 `aria-current="page"`。
- 搜索候选：`#searchResults` 改挂到 `document.body` 并 `position:fixed`，位置按输入框 `getBoundingClientRect()` 计算——原来它被 `.page-heading` 的 `transform` 锁在层叠上下文里，永远盖不过后面的卡片。
- 新增 `src/http/security.mjs`（安全响应头单一来源）、`src/http/static.mjs`（静态资源守卫：解码一次、拒绝 `..`/盘符/ADS/反斜杠/符号链接/白名单外扩展名、失败统一 404）与 `scripts/test-http-boundary.mjs`（8 项，含真实符号链接用例，无权限环境自动跳过）；`src/bridge.js` 的 `SECURITY_HEADERS` 改为从模块导入。
- `scripts/test-console-static.mjs` 增加 7 条路由/面包屑/候选框断言，防止三个 bug 回归。

### 新增：HTTP 边界文档与控制台规范化路线（2026-11-04）
- 新增 `docs/HTTP_BOUNDARY.md`：静态资源路径穿越守卫（`path.resolve` + `path.relative` + 拒绝清单 + 符号链接）、「未启用 = 404」「先鉴权后存在性」的语义表、CSP 与安全响应头现状与收敛目标、刷新/深链的三层恢复顺序、插件 UI 的 iframe 沙箱与样式隔离约定、验收清单。
- `docs/PLUGIN_ROADMAP.md` 新增 §8.7（控制台前端分层 A 方案 + B1 刷新保页 / B2 面包屑可点 / B3 搜索层级）、§8.8（`bridge.js` 按接缝抽层，第一步 HTTP 层，入口路径不变），并把「不引前端框架」「不重写 bridge.js」写进已拍板决策。
- `docs/PLUGIN_ROADMAP.md` §8.7 追加第三阶段「3.5 启动器控制中心（B 档）」：`public/control-center.html` 拆为 `public/control-center/{index.html,app.css,app.js}`，仍由 launcher 独立托管（默认 3099），与 console 共享 `app/styles/tokens.css`；列出四条不并入 console 的理由、launcher 静态服务改法、3 个打包脚本 + 5 个测试的影响面与验收。

### 新增：桥接插件内核与人格 provider（v1.2.0）
- `plugins/` 成为桥接运行时插件目录，内核在 `src/plugins/`（`manifest` / `config` / `audit` / `persona` / `host-api` / `kernel`）；原先给 DSH 加载的两个 bundle 改名到 `artifacts/dsh/`，避免「插件」一词指两样东西。
- 四个钩子：`onInbound` / `onPromptBuild` / `onAfterSend` / `onShutdown`；钩子超时（默认 2s）与异常只记审计，不阻断消息主链；`plugins.json` 独立配置（不入库，模板 `plugins.example.json`）。
- 人格 provider 契约 `persona-provider/1`：按会话取卡、ETag/304、未绑定返回 `none`；缓存与降级（TTL 5 分钟、最小刷新 30 秒、旧卡最多用 24 小时、单飞、持久化 `state/persona-cache.json`）由内核统一负责。
- 三层解析 `src/persona-resolve.mjs`：会话覆盖（`/role`、控制台按会话设置；`off` 硬覆盖）→ 外部 provider → 全局本地卡；`currentRoleHintV2` / `currentRoleFingerprintV2` / 唤醒提示词 / `qq_get_prompt` 都改走这一处。
- 第一个 provider 插件 `plugins/soulkit-persona`：`GET /api/persona/card?platform=qq&key=…`，剥掉 `【人格卡：…】` 标题行，失败保留旧卡；soulkit 不在线时按解析链回落本地角色卡。
- 控制台：「桥接插件」页（`/api/plugins`）、「人格来源（只读）」页（`/api/persona/sources`）；`role.maxInjectChars` 默认 6000 → 8000（soulkit 卡片约 6.5k 字符）。
- 测试：`test-plugin-kernel`、`test-soulkit-persona`、`test-persona-resolve`，均已接入 `test:audit`。
- 文档：新增 `docs/PLUGIN_KERNEL.md`、`docs/PERSONA_PROVIDER.md`、`docs/PLUGIN_ROADMAP.md`（后续路线与明确不做）。

### 新增：插件运行期管理（P2a）
- 内核支持 `reload(id)` / `reloadAll()` / `enable(id)` / `disable(id)` / `detail(id)`：重载先构建新实例（钩子与 persona 暂存），成功后才拆旧实例，失败保留旧实例继续跑；管理动作串行执行。
- 重载用 `?v=<mtime>` 绕开 ESM 缓存；`shutdown` 改为先发 `onShutdown` 再 `dispose`，插件能拿到退出钩子。
- 控制台插件页：每张卡片加「启用/停用」「重载」「详情」，另有「全部重载」；详情弹窗展示清单、权限、钩子、入口、计数、最近变更/错误与该插件最近 20 条审计。
- 接口：`GET /api/plugins/:id`、`POST /api/plugins/:id/{enable,disable,reload}`、`POST /api/plugins/reload`；启用/停用只改进程内状态，重启后以 `plugins.json` 为准。
- 测试：`test-plugin-kernel` 增至 8 个用例（停用后钩子不再执行、启用恢复、重载读到新版本、坏插件重载失败保留旧实例、detail 字段与审计）。
- 文档：`PLUGIN_KERNEL.md` §5.1 / §10 / §11 / §12 / §13 / §14 同步；`PLUGIN_ROADMAP.md` §4 补「实施记录与偏差」。

### 新增：插件安装与卸载（P2b）
- `POST /api/plugins/install`：`{ path }` 从服务器本地目录安装，`application/zip` 直接上传安装包；都先复制/解压到 `plugins/.staging-*`，校验清单后原子改名到 `plugins/<id>`，激活失败回滚进 `state/_trash`。
- `DELETE /api/plugins/:id`：卸载先把目录移到 `state/_trash/plugins-<id>-<时间戳>`（不硬删），再 dispose 并从索引移除；移不动则整体失败、运行实例不受影响。
- 零依赖 zip 解析 `src/plugins/zip.mjs`：拒绝路径穿越、加密、分卷、zip64、非 deflate/store、解压后超限；`src/plugins/install.mjs` 再查符号链接与目录树总大小。
- `plugins.json` 新增 `install: { enabled, maxBytes }`（默认 5MB）；`init()` 跳过 `.` 开头目录，残留暂存目录不会被当成插件。
- 控制台插件页新增「安装插件」折叠区（zip 上传 / 本地目录）与卡片上的「卸载」按钮。
- 测试：新增 `test-plugin-install.mjs`（目录/zip 安装、坏清单回滚、穿越与超限拒绝、卸载进 `_trash`），已接入 `test:audit`。
- 文档：`PLUGIN_KERNEL.md` §4 / §5.2 / §10–§14 同步；`PLUGIN_ROADMAP.md` §5 标完成并补「实施记录与偏差」。
- 顺带修正：控制台 CSRF 守卫对插件 zip 上传与插件 DELETE 放行（其余写接口仍只收 JSON）；内核读 `plugin.json` 时剥 UTF-8 BOM（Windows 编辑器常带）。

### 新增：插件文件监听自动重载（P2c）
- `plugins.json` 新增 `watch`（默认 `false`）：开启后 `fs.watch(plugins/, { recursive: true })` 监听变更，按 `plugins/<id>/…` 只重载变更文件所属的那一个插件，500ms 去抖合并连发事件。
- 只重载 `active` 插件（`disabled`/`invalid` 不动），走与手动重载相同的 staging 流程；失败保留旧实例并记 `reload-failed`。
- 监听不可用（平台不支持 recursive、权限、watcher 报错）自动降级为「只手动重载」，日志一行，不影响桥接启动；`shutdown()` 先停监听再拆实例。
- `plugins.json` 本身仍不监听：改配置（含 `watch`）需要重启，与「不做配置热生效」的边界一致。
- 测试：`test-plugin-kernel.mjs` 增至 11 个用例（路径映射、配置默认与非法值、开启后 5 秒内自动重载）。
- 文档：`PLUGIN_KERNEL.md` §4 / §5.3 / §12–§14 同步；`PLUGIN_ROADMAP.md` §3 标完成、§6 补「实施记录与偏差」；`plugins.example.json` 增 `watch`。

### 新增：命令注册表与「扩展」四页（P3a）
- 新增 `src/commands/registry.mjs`：内置命令按「最长主名优先、别名指向同一条目、内置先注册者保留」匹配；条目分「已迁移」（带 handler，由注册表执行）与「旧链」（只有元数据，回退原来的 `if` 分支），迁移是逐条进行的。
- 首批迁移 `/reset`（别名 `/new`）、`/status`、`/role`；`/silent`、`/active` 先登记元数据，行为仍走旧链。权限沿用原来的 owner 守卫，scope 区分全部会话 / 仅群聊 / 仅私聊。
- 控制台导航新增「扩展」一级：插件（原有页）、技能、MCP、管理行为。技能页只读扫描 `DSH_HOME/skills` 与仓库 `skills/` 下的 `SKILL.md`；MCP 页只读列出桥接自带的三个 stdio server；管理行为页按来源展示命令与迁移状态，并只读列出 DSH 会话命令与 Agent 工具。
- 接口：`GET /api/commands`（桥接内置/插件/DSH 命令/工具，三个来源分开返回）、`GET /api/extensions`（技能清单与 MCP server 清单）。
- 测试：新增 `test-command-registry.mjs`（10 个用例：匹配、别名、元数据回退、权限与 scope、抛错兜底、冲突规则、按插件注销），已接入 `test:audit`；`scripts/audit-bridge-harness.mjs` 注入真实注册表，命令迁移后的行为在 VM 里也能验证。
- 文档：新增 `docs/COMMAND_REGISTRY.md`（三来源能力矩阵、entry 形状、匹配/权限规则、页面布局、明确不做、P3b 预留）；`PLUGIN_ROADMAP.md` §3 / §7 同步。

### 新增：插件注册命令（P3b）
- 新增权限位 `commands`，插件可在 `activate(ctx)` 里调用 `ctx.commands.register({ name, aliases, scope, permission, help, handler })`；未申请权限时 `ctx.commands` 为 `undefined`。
- 注册在 `commit` 阶段入表：activate 抛错、清单非法、重载失败都不会留下半截命令；命令 id 缺省用 `<pluginId>:<name>` 兜底。
- 停用 / 卸载 / 重载时内核按 `pluginId` 批量注销；冲突仍只告警、内置命令永远优先。
- `detail` 与 `/api/commands` 会列出插件命令，管理行为页能看到来源为「插件」的条目。
- 测试：`test-plugin-kernel.mjs` 增至 12 个用例（注册、派发、停用后消失、启用后恢复）。
- 文档：`PLUGIN_KERNEL.md` §7/§8 增 `ctx.commands` 与 `commands` 权限；`COMMAND_REGISTRY.md` §8 改为「已实现」；`PLUGIN_ROADMAP.md` P3b 标完成并补实施记录。

### 新增：「扩展」四页 UI 精修（P3d）
- 管理行为页从平铺列表改成表格：列是「指令 / 类型 / 所属 / 描述 / 权限 / 状态 / 操作」，按命令 `group` 自动生成可展开的指令组（会话 / 人格 / 插件），首组默认展开，点组行折叠；另有来源、权限两个下拉与关键词搜索，三者叠加、计数实时更新。
- 命令注册补齐 `group`：`/reset`、`/status`、`/silent`、`/active` → 会话，`/role` → 人格；插件命令归到「插件 &lt;id&gt;」，插件行给「详情」跳到插件面板。
- 插件页卡片重做：复用控制台 `.grid` + `.card` + `.row` / `.meta` / `.pill` 组件（不另起样式），标题行带状态与版本、描述、权限/钩子/命令/调用/失败标签与操作按钮行；`/api/plugins` 为卡片补 `description` 与 `permissions` 字段。
- 布局改成标准控制台外壳：左侧导航、右侧顶栏、内容区三个独立容器，只有内容区内部滚动（`body` 固定高度网格，`.workspace` 再分 header/main 两行），不再靠「侧栏 fixed + sticky 顶栏」拼位置。
- 滚动条统一为细样式：去掉上下箭头，默认透明、悬停才显形，只有内容溢出时才出现。
- 技能页与 MCP 页统一成同样的表格语言（技能：名称/说明/路径；MCP：服务器/说明/入口与工具），空态统一。
- 测试：`test-console-static` 通过；两段内联脚本语法检查通过。
- 文档：`PLUGIN_ROADMAP.md` §3 P3d 标完成、§7.5 补「实施记录与偏差」。

### 新增：内置段落块化（贴纸 + 记忆摘要）
- 内置的「表情包策略」与「此刻状态（记忆摘要）」不再写死在 wake prompt 里，改为 `core-stickers` / `core-digest` 两个具名块，走与插件块相同的排序、限额、错误隔离语义。
- `config.json` 新增 `promptBlocks`：`{ "core-digest": { "enabled": false } }` 可整段关掉，`maxChars` 可单独收紧；配错（类型不对、超范围）只回落默认，不影响启动。
- 与插件块**分账**：插件块仍受 `plugins.json` 的 `limits.maxPromptAppendChars`（默认 4000）约束，内置段落用自己的预算（200000），互不挤占；`/api/plugins` 的 `coreBlocks` 返回两块的上限与调用次数，插件页 meta 直接显示。
- 迁移前后用 bridgeHarness 抓 `replyCheck` / `timeout` / `bootstrap` 三种唤醒的 prompt 全文比对，**逐字一致**（只差随机会话令牌）。
- 测试：新增 `test-core-prompt-blocks.mjs`（默认注入、关掉后整段消失、`maxChars` 收紧后变短但不整段消失、关表情块不影响记忆段）。
- 文档：`PLUGIN_KERNEL.md` §5.4 增「内置段也用同一注册表（分预算）」；`config.example.json` 增 `promptBlocks`；`PLUGIN_ROADMAP.md` P4 实施记录补迁移与偏差。

### 新增：具名注入块（P4）
- 新权限位 `prompt:provide`，插件可在 `activate(ctx)` 里 `ctx.prompt.registerBlock({ id, priority, maxChars, render })`，把「最近记忆」「贴纸策略」这类内容作为独立块注入 prompt，而不是挤在一条 append 管道里。
- 注册随 `commit` 入表：`activate` 抛错、清单非法、重载失败都不会留下半截块；停用 / 卸载 / 重载按 `pluginId` 批量注销，旧块不会继续进 prompt。
- 渲染按 `priority` 升序（同优先级按 id），单块超 `maxChars` 截断（`truncated`），合计超 `limits.maxPromptAppendChars` 的块整块跳过（`budget`），单块抛错只跳过该块（`error`）。
- `status().promptBlocks` 与 `/api/plugins` 的 `blocks` 字段暴露每块的状态，控制台插件详情可见。
- 与 `onPromptBuild` 分工：钩子改文本/加前后缀，注入块稳定贡献一段内容；两者共用同一总预算，`promptAdditions` 语义不变。
- 测试：`test-plugin-kernel.mjs` 增至 13 个用例（顺序、截断、预算跳块、抛错隔离、停用消失、启用恢复）。
- 文档：`PLUGIN_KERNEL.md` 新增 §5.4、§7/§8 增 `prompt:provide`、§13/§14 同步；`PLUGIN_ROADMAP.md` P4 标「部分完成」并补实施记录。

### 新增：出站装饰 `onReplyDecorate`
- 新钩子：模型回复逐段发送前可改写或取消（返回字符串 / `{ text }` / `{ drop: true }`），按插件 id **链式**执行，后一个拿到前一个改过的文本。
- 只作用于模型回复：`auditAndSend()` 显式传 `{ decorate: true }`，确认语、系统通知、管理通道不受影响；装饰后的文本仍过一次敏感信息审计，不能借装饰绕过。
- 兜底：单步抛错或超时保留上一步结果（最差是原文），装饰失败不会让消息发不出去；内核抽出 `invokeHook()` 统一收口超时、审计与调用统计。
- 测试：`test-plugin-kernel.mjs` 增至 14 个用例（链式改写、`drop` 取消、抛错保留上一步、停用后链缩短）。
- 文档：`PLUGIN_KERNEL.md` §6.3 / §13、`PLUGIN_ROADMAP.md` §8.1 同步。

### 新增：入站过滤链 `onInbound` 增强
- `plugins.json` 新增 `filters.inbound`（默认 `false`）：关闭时 `onInbound` 仍是纯观察，任何返回值都忽略，行为与没有插件时一致。
- 打开后，声明 `inbound:filter` 权限的插件可以返回 `{ drop: true }`（整条消息丢弃）或 `{ text }`（替换正文），按插件 id 链式执行，后一个拿到前一个改过的文本。
- `drop` 发生在写入社交历史与命令判定之前，消息不会留痕；替换文本上限 4000 字；没申请权限的动作被忽略并记审计 `inbound-denied`。
- 钩子抛错或超时保留上一步结果，主链按当前文本继续，不会因为过滤失败丢消息。
- 测试：`test-plugin-kernel.mjs` 增至 15 个用例（默认关不生效、开启后可丢可改、无权限动作被忽略）。
- 文档：`PLUGIN_KERNEL.md` §4 / §6.1 / §7 / §10 / §13 / §14、`PLUGIN_ROADMAP.md` §8.2 同步；`plugins.example.json` 增 `filters`。

### 新增：控制台配置面板（P5）
- 内置注入块：`core-stickers` / `core-digest` 的开关与字符上限进界面，保存写 `config.json`（`PATCH /api/config/promptBlocks`），**立即生效**；关掉后模型当轮就看不到该段。
- 运行设置：`filters.inbound`、`watch`、`limits.hookTimeoutMs`、`limits.maxPromptAppendChars`、`install.enabled` 进界面，保存写 `plugins.json`（`PATCH /api/plugins/settings`），除需要重启的项外立即生效。
- 插件详情弹窗可把插件启用状态写回 `plugins.json`（`plugins.<id>.enabled`），重启后保持；卡片上的启用/停用仍只改运行态。
- 写配置统一走「规范化校验 → 原子写 → 审计 `settings` → 返回 `restartRequired`」；越界值整份拒绝，不会写出半份配置。
- 只读保留：`audit.*`、`persona.cache.*`、`persona.provider`（等有第二个 provider 再做下拉）、插件自由 `config`。
- 测试：`test-plugin-kernel.mjs` 增至 16 个用例（越界拒绝、白名单写回、watch 即时生效、未知字段忽略）。
- 文档：`PLUGIN_KERNEL.md` §11、`PLUGIN_ROADMAP.md` §8.6 与「界面暴露」决策。

### 新增：定时任务类型插件化（P8）
- 插件可用 `ctx.scheduler.registerTaskType({ id, label, description?, validate?, run })` 注册自己的定时任务类型（权限 `task-type:provide`）；桥接仍负责到点、发给谁、限额、免打扰与模式判定。
- 任务保存时调用插件的 `validate` 规范化 `payload`；到点每个发送对象调一次 `run`，单次 60 秒超时，抛错记 `failed` 但任务不停用。
- 类型按 pluginId 注销：停用/卸载/重载插件后类型消失，已存在的任务保留在 `state/scheduler.json`（执行时返回失败并说明「任务类型未注册」），重建任务被拒绝。
- 控制台「定时任务」：内容区多一个「插件任务类型」下拉（只在有注册类型时出现）与 payload JSON 文本域；列表徽章显示插件给的 `label`，预览显示 payload。
- 测试：`test-plugin-kernel.mjs` 增至 17 个用例（注册/校验/执行/停用注销/重复 id 只保留先注册）；`test-scheduler.mjs` 增至 7 个用例（payload 校验、写盘、重建后仍在、未注册时拒绝）。
- 文档：`PLUGIN_KERNEL.md` §7 / §8 / §8.1 / §13 / §14，`PLUGIN_ROADMAP.md` §8.3 标完成。

### 改进：控制台间距与列表组件统一
- 折叠面板内距修复：新增的「内置注入块 / 运行设置 / 安装插件」补上 `.settings-content`，与已有面板一致；内层「高级」用 `.settings-sub`，不再继承外层摘要的背景与箭头。
- 列表统一：人格卡与插件卡共用 `.tile-list` + `.tile`（`gap:10px`、内距 `13px 15px`），插件卡不再用 26px 内距的 `.card` + 22px 的 `.grid` 网格。
- 工具条行距统一为 8px；技能 / MCP 页去掉列表外层的额外 `margin-top`（表格组件自带 12px），避免叠加成 20px。
- 约定写进 `docs/PLUGIN_ROADMAP.md` §12 第 6 条：列表、表格、工具栏各自用统一组件与间距，新增页面先对照人格页。

### 改进：DSH 401 时说清楚原因（来自 issue）
- 反馈：桥接读的 DSH 数据目录（默认 `~/.dsh`）和 DSH 实际用的不一致时，所有请求 401、事件流「本次收到 0 帧」，日志却提示「多半是事件流协议/版本不匹配」，把人引到了错误方向。
- 新模块 `src/dsh-auth-hint.js`：探活遇到 401 时（包括启动后从没连上过的情况）在日志里说明读的是哪个凭据文件、有没有设 `DSH_HOME`、是否发现了另一个有凭据的目录，以及怎么改；10 分钟提示一次，恢复后重置。路径里的用户目录显示成 `~`，不读、不输出密钥内容。
- 「事件流连上就断、一帧都没收到」的提示：最近有 401 时改说「原因是 DSH 拒绝了桥接的凭据」；其它情况补一句「DSH 刚重启时出现一次属正常」。
- 新测试 `scripts/test-dsh-auth-hint.mjs`（已接入 `test:audit`）。

### 文档
- 新增 `docs/PLUGIN_ROADMAP.md`：把 P2a（启停/重载/详情）、P2b（安装/卸载）、P2c（文件监听）、P2 同期的命令注册与具名注入块、P3 候选、MCP/Skills 的开工门槛，以及「明确不做」固定成文；约定规划变化先改这份文档再写代码。
- `DSH_SETUP.md`「常见问题」重写「DSH 一直 401」一条：原因、`DSH_HOME` 的设法（Windows / macOS / Linux）、要重跑 `setup-dsh.mjs`、自己验证时要用 POST（GET 得到 404 是正常的）；`DSH_DEPLOYMENT.md` 排查表同步。
- DSH 桌面版 0.2.1-rc.3 复核：不需要改代码，记录见 [DSH_020_ADAPTATION.md](docs/guides/DSH_020_ADAPTATION.md)「附：DSH 0.2.1-rc.3 复核」。
