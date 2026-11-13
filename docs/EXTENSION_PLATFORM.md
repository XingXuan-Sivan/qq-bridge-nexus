# 桥接扩展平台（MCP / 技能 / 插件 / 预设）设计方案

> 状态：**方案评审中（2026-11-08），未动工**。
> 关系：本文修订 ](./_internal/PLUGIN_ROADMAP.md) §9/§10 中「MCP 清单管理、skills、插件市场、平台适配器不做/暂缓」的旧结论；实施顺序以本文为准。
> 读者：负责扩展页、DSH 预设、MCP 接入与插件市场的实现者。

---

## 0. 一页结论

桥接要做的不是「给三个只读页补几个按钮」，而是把 **MCP、技能、插件、DSH 预设**收敛成一套可发现、可启停、可按预设授权的扩展平台。

核心决定：

1. **桥接聚合**：对 DSH 暴露一个稳定的扩展入口，不让每次增删 MCP / 技能都重启 DSH。
2. **统一目录**：`extensions/` 放数据型扩展，`src/extensions/` 放实现，`state/extensions/` 放运行态；现有 `plugins/`、`skills/`、`dsh/agent-presets/` 继续作为内置来源，由 catalog 合并，不立刻大搬迁。
3. **预设是授权中心**：MCP 工具、技能、插件注入、工具清单都按 DSH preset 配置；预设可结构化编辑，也允许直接改 YAML 高级编辑。
4. **默认保守、能力可显式解锁**：默认 preset 是安全集；开发者可以定义/选择 `workspace`、`operator` 甚至绑定到群。系统给警告与审计；临时 `arm` 只活在本次进程，长期权限靠建会话时的 preset。
5. **两档暴露**：默认用 `ext_list` / `ext_describe` / `ext_call` 元工具吸收长尾与动态扩展；高频且稳定的工具再「提升」为带命名空间的直连工具。纯元工具会把参数校验退化成字符串 JSON，纯直连会把所有工具塞进所有预设的 schema，两者都不够好。
6. **市场不建中心服务器**：复用「索引 JSON（provider + id）+ GitHub 安装源 + staging/备份回滚」；如果要做「扫描 GitHub 目标仓库」，作为独立的 source adapter，而不是假装 AstrBot 已经这么做。
7. **先修事故**：`compress` 被 `qq-tool-restrict.mjs` 的执行期 guard 拒绝，是当前最高优先级；它是模型侧压缩工具，不属于本地执行面。

---

## 1. 现状与问题

### 1.1 控制台现状

| 页面 | 现在能做什么 | 缺口 |
| --- | --- | --- |
| 插件 | 列表、启停、重载、详情、zip/目录安装、卸载、注入块、运行设置 | 插件配置不可改；无测试/日志/市场；`plugins.<id>.config` 只读 |
| MCP | 内置 server 真实工具清单；外部 MCP 新增/编辑/测试/刷新/日志/删除；Hub 元工具 | 技能尚未接入 Hub；预设策略目前只有 `qq-chat-v2` 的 `extensions.yml`，编辑器在 P3 |
| 技能 | 只读扫描 `SKILL.md` | 不能安装、编辑、启停、删除；不能分配 preset |
| 工具参考 | 已并入 MCP 页（server 概览 + 工具参考） | 独立页面与导航已移除，旧 `#reference` 重定向到 `#mcp` |
| 预设 | 只能改 `qq-chat` / `qq-chat-v2` 的提示词正文 | 五个 preset 写死在 `dsh/agent-presets/`；工具白名单藏在 `qq-tool-restrict.mjs`，不可见；三个 `qq-agent-*` 无入口 |

关键代码位置：

- `src/bridge.js:5309-5319` 的 `GET /api/extensions`：MCP 是 3 条字面量；`snowluma-safe` 的 `tools` 为空，但 `src/mcp-snowluma-safe.js:383-1463` 实际注册 36 个 `qq_*` 工具。
- `public/console/pages/reference/fields.js:5-15`：9 条硬编码工具说明，页面不发请求。
- `src/bridge.js:5321-5329`：`GET /api/presets` 只回 `{id, trust}`。
- `dsh/agent-presets/<id>/agent.cordis.yml` 是 preset 权威源；`dsh-bundles/qq-agent-presets/presets/*.patch.yml` 是生成物；`setup-dsh.mjs` 安装进 DSH profile。
- `dsh-bundles/qq-agent-presets/qq-tool-restrict.mjs:244-252`：执行期 guard 只放行 `SAFE_EXACT`（`ask_user_question`、`todo_write`）、三个 MCP 前缀与 L1 只读工具；`compress` 被拒。

### 1.2 三个结构性问题

1. **没有统一模型**：插件、技能、MCP、预设各自一套目录、状态、接口、页面；前端只能「有就显示、没有就留空」。
2. **扩展改动与 DSH 生命周期绑死**：加 MCP server 要改 DSH profile、重启/重连；预设改 YAML 要手工 build/install；MCP 工具清单是连接时快照。
3. **授权不可见**：什么 preset 能用哪些工具、哪些 MCP、哪些技能，藏在 YAML 与 `qq-tool-restrict.mjs` 里；控制台看不到，也就无法安全地让人改。

### 1.3 `compress` 事故

错误原文：

```text
工具 "compress" 不在 QQ 桥接白名单内，已拒绝（仅允许 QQ MCP 工具与无害模型侧工具）
```

根因不是 preset 没挂 compaction，而是 `qq-tool-restrict.mjs` 的 guard 没有把 DSH 的模型侧 `compress` 当无害工具。`compress` 只压缩当前会话上下文，不读文件、不执行命令、不碰网络，应该进入 `SAFE_EXACT`。`write/edit/pwsh/bash/read/glob/grep/subagent/...` 不进入默认安全集，但可以由高权限 preset 显式声明（见 §4.6），不是全局永久封禁。

---

## 2. 设计原则

1. **桥接是扩展的 source of truth，DSH 只看到稳定入口。**
2. **配置态与运行态分离**：JSON 是配置态；连接、工具清单、错误是运行态；不能用「配置写成功」冒充「运行态已生效」。
3. **按 preset 授权，不按进程全局授权。** 同一个桥接进程可能服务 QQ 群、owner 私聊、运维 Agent；授权必须从会话 → preset → 扩展条目逐层求交。
4. **默认保守、能力可显式解锁**：默认 preset 不含本地执行/文件/子代理；开发者可以选择或定义 `workspace` / `operator` preset，甚至把它接入群。系统在保存、绑定、首次生效时给警告并审计；临时 `arm` 仅本次进程，重启解除，长期权限由建会话时的 preset 决定——最终决定权在开发者。
5. **保存前校验，失败可回滚**：安装、改 YAML、改 MCP 配置都走 staging/备份；不把半成品写进权威目录。
6. **控制台先展示真实状态，再加写操作。** 不做「假开关」；不能执行的按钮不放。
7. **不为兼容而保留旧实现**：v1 只读接口在 v2 页面落地时同步替换；不长期维护两套 catalog。

---

## 3. 统一模型

### 3.1 四类对象

| 类型 | 说明 | 权威源 | 运行态 |
| --- | --- | --- | --- |
| `mcp` | 一个 MCP server（stdio / SSE / Streamable HTTP）及其工具 | `extensions/mcp/<id>/server.json`，内置 server 仍由 `src/mcp-*.js` 提供 | 连接、工具清单、健康、错误 |
| `skill` | 一份 `SKILL.md`，只注入 name/description，正文按需读 | `extensions/skills/<id>/SKILL.md`，内置来源 `DSH_HOME/skills`、仓库 `skills/`、插件自带 skills | 扫描结果、启用状态 |
| `plugin` | 桥接进程内插件（钩子 / 人格 provider / 命令 / 注入块） | `plugins/<id>/plugin.json` + `plugins.json` | 加载状态、钩子、调用计数 |
| `preset` | DSH agent preset（提示词、工具面、compaction、MCP/技能授权） | `dsh/agent-presets/<id>/agent.cordis.yml` | 安装后的 patch / 当前会话绑定 |

说明：`preset` 不是「扩展」本身，但它是扩展授权的中心，所以放进同一个 catalog 视图；不把 preset 伪装成可安装插件。

### 3.2 ID 与命名

统一 id 采用 **`kind:namespace/name`** 的可读形式，文件路径使用安全 slug：

```text
mcp:builtin/snowluma-safe
mcp:external/github
skill:builtin/pdf
skill:local/my-writing
plugin:builtin/soulkit-persona
preset:builtin/qq-chat-v2
```

规则：

- `builtin` / `local` / `external` / `market` 是保留 namespace；内置项不可删除、不可改名。
- 外部 id 从安装源归一化（GitHub `owner/repo` → `market/owner-repo`），不用显示名做 id。
- 工具对外名称必须带 server 命名空间：`<server-id>__<tool-name>`，避免 AstrBot 那种同名静默覆盖。
- 所有 id 只允许 `[a-z0-9][a-z0-9._-]*`，拒绝路径分隔符、控制字符、`..`。

### 3.3 目录布局

```text
extensions/                     # 数据型扩展（可备份、可导出）
  mcp/<id>/server.json          # 外部 MCP 描述（含 transport、args、env 引用）
  skills/<id>/SKILL.md          # 技能正文 + frontmatter
  sources.json                  # 市场源配置（registry / github / local）
src/extensions/                 # 实现代码
  catalog.mjs                   # 合并内置/外部，产出统一 catalog
  hub/                          # MCP Hub（对 DSH 暴露）
  mcp/                          # 外部 MCP client、生命周期、探测
  skills/                       # 技能扫描/安装/启用（复用 src/skills）
  market/                       # source adapter、安装、回滚
state/extensions/               # 运行态（不提交）
  runtime.json                  # 每个 server 的连接/工具/健康状态
  logs/<server-id>.log          # stderr 环形日志
  staging/                      # 安装临时目录
```

现有 `plugins/`、`skills/`、`dsh/agent-presets/` **不搬**：catalog 通过 source adapter 合并；等 P4 市场稳定后再评估是否把第三方数据迁到 `extensions/`。

### 3.4 Catalog 条目

```json
{
  "id": "mcp:external/github",
  "kind": "mcp",
  "name": "GitHub MCP",
  "description": "仓库、issue、PR",
  "version": "1.2.0",
  "source": "external",
  "builtin": false,
  "enabled": true,
  "health": "running",
  "capabilities": ["tools"],
  "configSchema": { "type": "object", "properties": {} },
  "tools": [
    { "name": "search_repos", "description": "...", "inputSchema": {} }
  ],
  "origin": { "type": "local-file", "path": "extensions/mcp/github/server.json" },
  "updatedAt": "2026-11-08T00:00:00.000Z"
}
```

约束：

- `configSchema` 由类型实现提供，前端用现有 `renderFields` / 表单组件渲染，不另造一套主题。
- `health` 只允许 `unknown | stopped | starting | running | error`；`running` 必须同时有最近一次 `tools/list` 时间。
- catalog **不返回 env 值**；只返回 `envKeys` 与是否已配置。
- 列表默认不返回完整 `inputSchema`；`ext_describe` 才返回，避免 UI/提示词被大 schema 撑爆。

### 3.5 内置与外置

内置（`builtin`）与外置（`external` / `market` / `local`）不是两套系统，只是 catalog 的 `source` 不同；UI 在同一个列表里按来源筛选，能力与状态字段一致。

| 行为 | 内置 | 外置 |
| --- | --- | --- |
| 启停 / 配置 / 测试 / 刷新 | 允许（按类型能力） | 允许 |
| 删除 / 卸载 / 改名 / 覆盖 | 禁止 | 允许 |
| 更新 | 随桥接发布，不单独更新 | 允许按 source 更新，失败回滚 |
| 物理位置 | 保持现有目录（`src/mcp-*.js`、`plugins/`、`skills/`、`dsh/agent-presets/`） | 统一 `extensions/<kind>/<id>/` |

- 内置项由 source adapter 提供 manifest，catalog 标记 `source: "builtin"`；不要求把现有内置搬进 `extensions/`。
- 内置项也必须有稳定 id、可显示的工具/技能/配置 schema；不能因为“内置”就只给一行只读摘要。
- 外置项安装/更新走 preview → staging → 校验 → 替换 → 回读；内置项没有安装步骤。
- 这与 AstrBot 的 `reserved` 一致：内置插件不可卸载/更新，但仍可启停、配置、查看状态；桥接把该保护扩展到 MCP/技能/预设，而不是只保护插件。

---

## 4. 运行时架构：Extension Hub

### 4.1 为什么需要 Hub

DSH 的 MCP client 是「一个 server 连接 → 一组工具」。如果桥接把每个外部 MCP 都直接写进 DSH profile：

- 新增/删除 server 要改 profile，可能触发 DSH 重连；
- 所有工具会出现在所有 preset 的 schema 里；
- 外部 server 一多，工具数量线性膨胀，且同名冲突没有命名空间。

Hub 把「连接外部世界」留在桥接进程内，对 DSH 只暴露一个稳定 MCP server；连接/断开/刷新都在桥接内完成。

### 4.2 暴露策略：元工具 + 提升工具

**默认（P2）**：Hub 只暴露三个元工具：

| 工具 | 作用 | 关键参数 |
| --- | --- | --- |
| `ext_list` | 列出当前会话可见的扩展与工具摘要 | `kind?`, `query?`, `token` |
| `ext_describe` | 取一个扩展/工具的完整 schema 与用法 | `id` 或 `server+tool`, `token` |
| `ext_call` | 调用某个 MCP 工具 | `server`, `tool`, `arguments`, `token` |

`token` 与会话绑定：Hub 用 token 反查会话 key，再按该会话的 preset 计算允许项；不能只信模型传入的 `preset` 字符串。

**提升（P4）**：对高频、稳定、schema 简单的工具，允许在 Hub 内注册为直连工具：

```text
mcp__bridge-ext__github__search_repos
```

提升规则：

- 每个 preset 显式声明 `extensions.promote` 名单；默认空。
- 全局提升数量上限（建议 40 个），每个 server 上限（建议 12 个），避免 schema 爆炸。
- 名称强制 `<server>__<tool>`；冲突时拒绝提升，不静默覆盖。
- 提升/取消提升时 Hub 发 `tools/list_changed`，DSH 重新拉清单；不重启 DSH。
- 直连工具仍要在 Hub 内做 preset 授权；DSH 侧看到工具不等于该 preset 可调用。

**取舍**：纯元工具实现简单、上下文稳定，但模型要把参数拼成 JSON，错参率更高；纯直连体验最好，但工具数量与 preset 可见性不可控。先元工具、再按需提升，是两者之间可运营的折中。

### 4.3 请求链路

```text
DSH session
  → MCP client (bridge-ext)
  → Hub tool call
  → token → session key
  → session profile → preset id
  → preset.extensions (mcp allow / skill allow / promote)
  → catalog entry (enabled? health?)
  → MCP client (external server)
  → result normalize
```

拒绝原因要可读：

- `扩展未启用`
- `该预设未授权此 MCP server`
- `该工具不在预设白名单`
- `server 未连接（健康状态 error）`
- `参数不符合 schema`

### 4.4 生命周期

每个外部 MCP server 一个状态机：

```text
stopped → starting → running
                 ↘ error → starting (retry/backoff)
running → stopping → stopped
```

- **懒连接**：首次 `ext_call` / 显式 test 时启动；列表页只显示 configured。
- **单飞**：同一 server 的 start/stop/refresh 用互斥锁 + in-flight promise，避免并发拉起两个进程。
- **超时**：初始化 30s、动态启用 30s、单次调用 60s（可按 server 配置覆盖，硬上限 300s）。
- **重连**：调用失败时有限重试；连接断开后标记 error，后台指数退避，不无限刷日志。
- **刷新**：`refresh(server)` 重新 `tools/list`；上游 `tools/list_changed` 时自动刷新并通知 DSH。
- **日志**：stdio stderr 进 `state/extensions/logs/<id>.log` 环形缓冲；控制台展示最近 200 行，敏感 env 脱敏。
- **测试**：临时 client 连接 → `tools/list` → 断开，返回工具数与耗时，不污染运行态。
- **回滚**：新增 server 先测连再落盘；更新失败恢复旧配置；启动失败保留配置但标 error，不删用户数据。

### 4.5 按会话 / 预设授权

授权解析顺序：

1. 会话是否有显式禁用（P4 再引入）；
2. 会话 profile 的 `presetId`（未指定则用全局默认 preset）；
3. preset 的 `extensions.mcp.allow` / `extensions.skills.allow` / `extensions.promote`；
4. catalog 的 `enabled` 与 `health`；
5. 工具级 `allow` / `deny`（deny 优先）。

默认值：

- 内置 QQ MCP：保持现有 `mcp__snowluma__*` 行为；只由 preset 与 `socialV2.tools` 控制。
- 外部 MCP：**是否启用由创建时的开关决定**；授权由创建时选择的 preset 决定。桥接不强制默认关闭，也不强制“未授权”。
- 技能：默认不进注入清单；预设勾选后才进入 `core-skills`。是否默认勾选由创建/编辑者决定。
- 提升工具：默认空；只对显式声明的 preset 提供。

### 4.6 能力档位与解锁

默认 preset 是安全集；高权限不是“系统不提供”，而是“默认模板不提供，开发者可以自己定义/选择”。

| 档位 | 能力 | 默认 preset | 说明 |
| --- | --- | --- | --- |
| `safe` | QQ MCP、搜索、记忆、`compress`、ask/todo | `qq-chat-v2` | 群/好友默认；不含文件/执行 |
| `workspace` | 读写 DSH 工作区、查看文件、项目操作；不含任意 shell | 可新建或基于 `qq-agent-workspace` | 可由开发者绑定到群 |
| `operator` | shell、进程、完整 DSH 能力，包括操作电脑 | 可新建或基于 `qq-agent-full` | 可由开发者绑定到群 |
| `custom` | 按工具 allow/deny 自由组合 | 用户定义 | 工具清单以 catalog 为准 |

规则：

- **默认模板保守，自定义不设上限。** `safe` / `workspace` / `operator` 只是内置模板；开发者可以 clone、改工具清单、绑到任意会话。
- **高权限可入群。** 不强制“只能 owner 私聊”；在预设绑定/会话切换/首次生效时显示明确警告（会执行命令、读写文件、可操作电脑），确认后按开发者选择执行。
- **`arm` 只改 Hub 授权，不改 DSH preset。** 它可以把当前会话在 Hub 层临时提升到另一个能力档位（例如 `/arm workspace`），但只覆盖经 Hub 暴露的扩展/MCP 工具；不会让已经创建的 DSH 会话获得 `read/write/edit/pwsh` 等原生工具。原生工具仍由建会话时的 preset 决定。`arm` 授权默认只活在本次进程内，重启自动解除；要长期高权限，应在建会话时选高权限 preset。
- **guard 以 preset 声明为准。** 已知工具按 catalog 风险分级；默认安全集不含危险工具；自定义 preset 可以显式 allow；未在 catalog 中声明的工具仍拒绝（防止拼写/注入绕过），但不是把危险工具永久焊死。
- **审计不阻断。** 记录谁在哪个会话、哪个 preset、什么时候使用了高权限工具；是否弹确认由 preset 的 `confirmDangerous` 决定（默认建议开启，但不是硬编码）。
- 现有 `qq-agent-readonly` / `qq-agent-workspace` / `qq-agent-full` 可作为档位模板；是否需要把它们从 closed-agent 专用改成可复用 preset，在 P2 实现时确认。

### 4.7 `arm` 与切换预设的边界

DSH 的 `agentPresets.select()` 只允许在会话第一轮开始前调用；一旦会话已开始过一轮（`turnBoundary.lastTurn > 0` 或有未结束回合），会抛 `agent-preset/locked`。DSH 没有 rebind / 热换 preset 的公开 API，所以：

- **`/arm` 可行，且只活在本次进程**：只更新桥接侧授权，不碰 DSH preset，不重建会话；重启桥接自动解除。它能让当前会话立即使用更多 Hub 工具（`ext_call`、提升工具、外部 MCP），但不能补出 DSH 原生工具。需要长期高权限时，必须在建会话时选对应 preset。
- **`/preset` 分两种情况**：
  - 会话“还没开始第一轮”：直接切换，不重建；
  - 会话“已经开始过”：返回“DSH 已锁定，需要重开会话”；用户确认后，命令直接按新 preset 新建一个 DSH 会话（上下文清空），取消则什么都不做。绝不静默重置，也不伪造“切换成功”。
- **新建会话**是 `/preset` 已开始分支的显式结果，不是副作用：回复里要说清“新会话、上下文会丢”，并保留原会话直到新会话创建成功。
- **原生高权限能力**（工作区/文件/命令）只能在建会话时由 preset 提供；可以按 4.6 把 `workspace` / `operator` preset 绑定到群，但不要承诺“已运行的会话随时长出新工具”。
- 如果未来确实要在已开始会话上换原生工具面，需要 DSH 层支持；桥接不伪造能力。


---

## 5. MCP 管理

### 5.1 外部 server 描述

`extensions/mcp/<id>/server.json`：

```json
{
  "schemaVersion": 1,
  "id": "github",
  "name": "GitHub MCP",
  "description": "仓库、issue、PR",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": { "GITHUB_TOKEN": "secret:github-token" },
  "cwd": null,
  "timeoutMs": 60000,
  "enabled": true,
  "trust": "external"
}
```

HTTP 形式：

```json
{
  "transport": "streamable_http",
  "url": "https://example.com/mcp",
  "headers": { "Authorization": "secret:example-token" }
}
```

规则：

- **启用状态由创建表单决定。** 新增时提供 `enabled` 开关；默认值可以开启（用户主动添加的扩展），也可以关闭，桥接不强制覆盖。保存后立即按该值生效，不再额外要求“二次启用”。
- **stdio 默认 allowlist，可显式放开。** 默认只允许常用运行时；高级开关 `allowArbitraryCommand` 打开后允许任意命令，但仍是 `command + args[]`，不经 shell、不允许字符串拼接；打开时显示风险提示并记审计。
- **HTTP 默认 https，可显式允许私网。** `allowPrivateNetwork` 打开后允许 localhost/局域网自建 MCP；始终拒绝云 metadata 地址与重定向到内网的跳转。
- `env` / `headers` 的值只允许 `secret:<name>` 引用；secret 存在 `state/extensions/secrets.json`（0600，控制台只显示“已配置”），不写进 catalog/日志。
- `trust` 只允许 `builtin | verified | external`；外部默认 `external`，控制台必须显示风险提示。
- **工具命名与冲突**：对外 `<server-id>__<tool>`；同名工具在 server 内拒绝；跨 server 不冲突。

### 5.2 工具发现与命名

- 连接后 `tools/list`，保存原始 `name`、`description`、`inputSchema`、`annotations`。
- 对外名称：`<server-id>__<tool-name>`；原始名保留在 `originName`。
- schema 做宽松归一化（属性级 `required: true` 提升为父级 required 数组），再做 JSON Schema 校验；畸形 schema 只影响该工具，不让整个 server 连接失败。
- 同名工具在同一 server 内拒绝；跨 server 因命名空间天然不冲突。
- 工具描述截断（列表 160 字，`ext_describe` 全文），防止提示词膨胀。

### 5.3 控制台页面

MCP 页面合并「工具参考」：

- 顶部：服务表格（名称/transport/状态/工具数/最近检查/操作）。
- 行展开：工具表（命名空间名、原始名、说明、schema 按钮、最近调用/错误）。
- 操作：新增、编辑、测试连接、启用/停用、刷新工具、看日志、删除。
- 工具参考不再是独立静态页；每个工具的完整说明与 schema 在这一页展开，由真实 catalog 提供。
- 预设授权不在此页做「每工具全局开关」；工具可见性统一去预设编辑器配置，避免两套开关。

---

## 6. 技能管理

### 6.1 数据与发现

- 外部技能：`extensions/skills/<id>/SKILL.md`；frontmatter 至少 `name`、`description`，可选 `version`、`tags`。
- 内置来源：`DSH_HOME/skills`、仓库 `skills/`、插件自带 `<plugin>/skills/**`；catalog 合并，不复制。
- 同名优先级：`extensions/skills`（用户管理）→ `DSH_HOME/skills` → 仓库 `skills/` → 插件（只读）；同名时标注来源，不静默覆盖。
- 只读来源（插件、仓库内置）在 UI 显示「内置/只读」，不可编辑/删除。

### 6.2 启用与注入

- 全局开关：`skills.enabled` 与单技能 `active`。
- 预设授权：preset 的 `extensions.skills.allow`；只注入被授权技能的 `name + description + 路径`，正文由模型按需读（渐进披露）。
- 注入块继续用 `core-skills`，但数据源改为 catalog 的可见技能；行数/字数上限沿用现有配置。
- 技能内声明的脚本/工具在当前阶段**不执行**；那是插件或 MCP 的职责。以后 `skill` 工具单独讨论。

### 6.3 管理操作

- 导入：zip（含一个 `SKILL.md`）或从 GitHub 目录；staging 校验 frontmatter、大小、路径穿越后落盘。
- 编辑：文本编辑器改 `SKILL.md`；保存前校验 YAML、名称唯一；写前备份。
- 启停/删除：只允许用户管理来源；内置只读。
- 控制台不提供「运行技能」按钮；技能是提示词资产，不是进程。

---

## 7. 插件与插件市场

### 7.1 现有插件内核的补齐

现有 `plugin.json` 已有 `id/name/version/main/apiVersion/permissions/hooks`；补齐：

```json
{
  "configSchema": { "type": "object", "properties": {} },
  "ui": { "views": [] },
  "market": { "license": "MIT", "homepage": "..." }
}
```

- `configSchema` 驱动控制台通用表单，存 `plugins.json` 的 `plugins.<id>.config`。
- `permissions` 继续由内核校验；市场页必须展示权限，不把「能装」等同于「可信」。
- 插件仍与桥接同进程（既定设计）；市场只解决分发，不引入沙箱承诺。

### 7.2 市场：三种 source，不建中心服务器

AstrBot 的实际实现不是逐仓库扫 GitHub：它用「社区索引 JSON + md5 缓存」，安装时才按 GitHub repo 读 metadata。桥接可以做得更灵活，但要区分三种来源：

| source | 作用 | 说明 |
| --- | --- | --- |
| `registry` | 社区/自建索引 JSON | 兼容 AstrBot 的条目形状（`owner/repo`、`download_url`、`marketplace_name`），支持 md5/ETag 缓存；全失败回落缓存 |
| `github` | 扫描 GitHub 目标仓库 | 用户配置 owner/repo 列表，或使用 GitHub Search API；只读 raw `plugin.json` 预检，不整仓克隆 |
| `local` | 本地目录 / zip | 开发与内网分发；仍走 staging 校验 |

**市场不承担信任**：索引只提供候选，安装前必须 preview（manifest、权限、大小、版本、来源 URL），由用户确认。

### 7.3 安装 / 更新 / 回滚

```text
resolve source → preview manifest → staging download
→ validate id/version/permissions/size → backup current
→ atomic replace → load → smoke check
→ commit; failure → restore backup
```

- 只允许覆盖同名 id；`builtin` 禁止覆盖/卸载。
- 更新记录 `source + ref + sha256`；支持固定 tag/SHA，不默认追 main。
- 安装失败不留下半目录；回滚失败保留备份并明确报错。
- 市场扫描结果缓存（ETag/md5 + TTL），避免 GitHub rate limit；刷新按钮显式失效。

### 7.4 市场 UI

- 列表：名称、作者、版本、权限摘要、来源、更新时间、信任级别。
- 详情：README、manifest、权限、版本、安装源、校验和。
- 操作：预览、安装、更新、卸载；内置项只读。
- 不做「一键安装全部」；不做自动更新默认开启。

---

## 8. DSH 预设

### 8.1 权威源与生成链

```text
dsh/agent-presets/<id>/agent.cordis.yml   # 权威源（人可读，可 review）
  → scripts/build-agent-preset-patches.mjs
  → dsh-bundles/qq-agent-presets/presets/<id>.patch.yml
  → setup-dsh.mjs 安装到 DSH profile
```

预设编辑器只写权威源，再走生成/安装；不直接改生成物，否则下次 build 会覆盖。

### 8.2 结构化视图 + YAML 高级编辑

结构化字段（按当前 preset 能力档位）：

- 基本信息：id、名称、说明、适用模式（chat / reserved / reserved2 / agent）、是否默认。
- 提示词：正文、变量、长度预算。
- 能力：档位（safe / workspace / operator / custom）、允许的工具清单、禁用的工具清单、MCP 扩展授权、提升工具名单。
- compaction：是否启用、阈值、是否允许 `compress`（默认允许）。
- 扩展：允许的 MCP server、技能白名单。

高级编辑：直接编辑 YAML 文本；保存前：

1. YAML parse + 结构校验；
2. 必填 group/plugin 校验；
3. 能力声明校验：默认 `safe` 模板不含危险工具；`workspace` / `operator` / `custom` 可以显式声明危险工具；声明了危险工具的 preset 在保存、绑定会话、首次生效时显示警告，但允许保存；未在 catalog 中声明的工具拒绝，防止拼写绕过；
4. 显示 diff；写前备份；失败恢复。

**注释保留**：默认打开 YAML 原文（注释/空行原样保留）；结构化保存会按标准格式重写，可能丢注释，保存前明确提示并建议先备份。当前不做 CST 级保注释编辑；需要绝对保注释时用 YAML 视图。

### 8.3 工具声明与 `compress`

`qq-tool-restrict.mjs` 从“硬编码白名单”调整为“按 preset 声明执行”：

- `SAFE_EXACT`：模型侧无害工具，当前 `ask_user_question`、`todo_write`；**加入 `compress`**。
- `TOOL_CATALOG`：已知工具及风险分级（safe / workspace / operator），用于校验 preset 声明、生成 UI 勾选项；不在 catalog 中的工具拒绝，避免拼写/注入绕过。
- `SAFE_PREFIXES`：桥接 MCP 命名空间（`mcp__snowluma__`、`mcp__snowluma-host__`、`mcp__web-search-safe__`、未来的 `mcp__bridge-ext__`）。
- 默认 `safe` preset 不含 `read/write/edit/pwsh/bash/glob/grep/subagent/...`；`workspace` / `operator` / `custom` preset 可以显式声明这些工具，guard 按声明放行，并在保存/绑定/首次生效时警告。
- 不做“永久 deny 列表”；只保留“未声明即拒绝”。这样开发者可以把完整 DSH 能力接入群，同时不会因为拼写错误把未知工具带进来。

P0 验收：`compress` 可被调用；`test-preset-local-tools.mjs` 把 `compress` 纳入「真实工具名」对账；默认 `safe` preset 仍不含本地执行工具；自定义 operator preset 可正常声明。

### 8.4 预设变更何时生效

- 新会话 / 重建会话：读取新 preset。
- 已开始过第一轮的会话：DSH 的 `agentPresets.select()` 会抛 `agent-preset/locked`，没有 rebind；只能显式新建/重建会话（上下文会丢，必须二次确认）。
- 尚未开始第一轮的会话：允许选择/切换 preset，这是 DSH 支持的窗口。
- 因此命令语义是：
  - `/preset <id>`：未开始会话直接切换；已开始会话提示“DSH 已锁定，需要重开会话”，确认后按新 preset 新建会话，取消不动作。
  - `/arm ...`：只改桥接 Hub 授权，不碰 preset，重启自动解除；不能补出原生工具。
- 目标是不重启 DSH；如果 DSH 版本要求 reload 才能读 preset，必须在文档与 UI 明说，不能假装热更新。


### 8.5 预设编辑器与扩展授权的关系

- MCP / 技能页只负责「有什么、是否健康」；「哪个 preset 能用」在 preset 编辑器里配置。
- 预设页显示每个扩展的授权状态（服务器级、工具级、技能级），不重复做全局开关。
- 保存 preset 时校验引用的 MCP/技能 id 仍存在；不存在只警告，不自动删除授权。

---

## 9. 控制台信息架构

```text
扩展
  插件          现有页面 + 配置/市场/日志
  MCP 与工具    服务表格 + 工具展开 + 测试/日志
  技能          列表 + 编辑/导入 + 启用
  预设          列表 + 结构化编辑 + YAML 高级编辑
```

- 「工具参考」不再单独占一级导航，合并到「MCP 与工具」。
- 「管理行为」保留命令/工具只读视图，但只列 DSH 侧命令与 Agent 工具，不再重复 MCP 工具清单。
- 页面内部用现有卡片/表格/表单组件；不新增一套扩展专属主题，不为黑白名单式开关另造 tab。
- 状态展示：`配置已保存` 与 `运行态已生效` 分开显示；错误显示可操作原因。

---

## 10. API 草案

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/extensions` | catalog 列表，支持 `kind/q/health` |
| GET | `/api/extensions/:id` | 条目详情（含 schema，敏感值脱敏） |
| POST | `/api/extensions/mcp` | 新增外部 MCP（preview/confirm） |
| PATCH | `/api/extensions/mcp/:id` | 修改配置/启停 |
| DELETE | `/api/extensions/mcp/:id` | 删除（先停连接） |
| POST | `/api/extensions/mcp/:id/test` | 临时连接测试 |
| POST | `/api/extensions/mcp/:id/refresh` | 重新发现工具 |
| GET | `/api/extensions/mcp/:id/logs` | stderr 环形日志 |
| POST | `/api/extensions/skills/import` | zip / GitHub 导入 |
| PATCH | `/api/extensions/skills/:id` | 编辑/启停 |
| DELETE | `/api/extensions/skills/:id` | 删除用户技能 |
| GET | `/api/extensions/presets` | 预设列表/结构 |
| PATCH | `/api/extensions/presets/:id` | 结构化保存 |
| PUT | `/api/extensions/presets/:id/yaml` | YAML 高级保存（校验 + diff） |
| POST | `/api/extensions/presets/:id/apply` | 生成/安装/回读 |
| POST | `/api/extensions/presets/:id/rollback` | 回滚上一版 |
| GET | `/api/extensions/market/sources` | 市场源 |
| POST | `/api/extensions/market/search` | 搜索（服务端聚合/去重） |
| POST | `/api/extensions/market/install` | 预览/安装 |

权限：

- 控制台 token：全部管理端点。
- agent token：只能经 Hub 的 `ext_list/ext_describe/ext_call`，不能调用管理 API。
- 所有写操作 JSON + 同源校验；审计记录 actor、目标 id、动作、结果。

---

## 11. 安全与审计

1. **外部 MCP 的启用状态由创建者决定**；新增要 preview（命令、URL、env 键、工具数），保存时按表单里的 `enabled` 生效，不强制默认关闭。
2. **stdio 默认 allowlist，可显式放开**：高级 `allowArbitraryCommand` 打开后允许任意命令；始终禁止 shell 字符串拼接、`-c/-e` 之类的内联执行与 host 网络。
3. **HTTP SSRF**：默认只允许 https；`allowPrivateNetwork` 打开后可访问 localhost/局域网；始终拒绝云 metadata 与重定向到内网。
4. **秘密**：`secret:` 引用，日志/API 永不回显；导出配置时只导出引用。
5. **插件供应链**：市场安装必须展示 permissions；内置/社区/本地三级 trust；同进程插件仍是高风险，不承诺沙箱。
6. **预设能力**：默认 `safe` 模板保守；`workspace` / `operator` / `custom` 由开发者显式选择；高权限接入群、绑定会话、首次生效时显示警告并审计；临时 `arm` 重启解除，长期权限靠建会话时选 preset。
7. **审计**：扩展安装/更新/删除、MCP 连接/工具调用失败、预设保存/应用、市场安装都写 `state/admin/audit.json`（或现有审计通道）。
8. **资源限制**：工具 schema 大小、返回内容大小、日志行数、并发连接数、总提升工具数都有硬上限。

---

## 12. 分期与验收

### P0 `compress` 白名单修复（最小、立即）

- 改 `qq-tool-restrict.mjs`：`SAFE_EXACT` 加 `compress`。
- 测试：`test-preset-local-tools.mjs` 对账；真实 QQ 群会话触发一次自动压缩。
- 验收：不再出现「工具 compress 不在白名单」；默认 `safe` preset 仍不含本地执行工具；自定义高权限 preset 不受影响。

### P1 Catalog + MCP 页合并工具参考

- 状态：**已完成（2026-11-09）**。实现与偏差见 `EXTENSION_PLATFORM_DEVIATIONS.md` E4–E6。
- 新增 `src/extensions/catalog.mjs`；`GET /api/extensions` v2 返回真实 MCP/技能条目（只读）。
- MCP 页显示 3 个内置 server 的真实工具数（运行时 `tools/list`，5 分钟缓存）；工具参考合并进同一页，旧 `#reference` 重定向到 `#mcp`。
- 验收：页面工具数与 MCP `tools/list` 一致（实测 51 个：1/2/48）；无假开关；static 全过、UI 29/29、audit 98/98。

### P2 Hub + 外部 MCP + 预设授权

- `src/extensions/hub` MCP server（`ext_list/ext_describe/ext_call`）；bridge 配置一个稳定 `mcp-bridge-ext`。
- 外部 MCP CRUD/测试/刷新/日志；连接态/工具清单/错误可视化。
- 预设的 MCP allowlist 与工具级 allow/deny；Hub 执行期校验。
- 验收：新增外部 server 不需要重启 DSH；未授权 preset 调用被拒；断线/超时/日志可见；`compress` 正常。

**2026-11-09 状态：P2 已实现、验收并提交（`de95c4a`）。** 新增 `src/mcp-bridge-ext.js`（`ext_list/ext_describe/ext_call`）、`src/extensions/{mcp-store,secrets,mcp-runtime,preset-policy,hub,hub-token}.mjs`；bridge 接 4 条管理 API、Hub 内部 API 与 `state/extensions/hub-token`；MCP 页支持外部 MCP 新增/编辑/测试/刷新/日志/删除；`dsh/agent-presets/qq-chat-v2/extensions.yml` 允许外部 MCP 与技能，其他预设无文件即拒绝。真机已验证外部 `test-ext` 的 CRUD/测试/日志，以及 Hub `list/describe/call` 与 401/403。2026-11-09 后续把 MCP 页重构为统一表格/四段弹窗：来源与状态用 `.pill`、失败提示进工具栏、工具栏筛选/刷新、操作列最多编辑/测试/删除、配置按连接方式自动套模板、footer 测试连接，并新增 `POST /api/extensions/mcp/test` 草稿测试（不落盘）；无 body DELETE 走通用 CSRF 例外。范围边界见 ](./_internal/EXTENSION_PLATFORM_DEVIATIONS.md) E7–E12（内置 MCP/插件工具暂不提升、tools/list_changed 先显式 refresh、ext_list 不自动连接、Hub 本身需一次 DSH 重启、外部 MCP 安全默认值、草稿测试 API 与无 body DELETE）。

### P3 技能 / 插件配置 / 预设编辑器

- 技能导入/编辑/启停/删除 + preset 技能白名单 + `core-skills` 数据源切换；Hub 的 `ext_describe` 支持读技能正文。
- 插件 `configSchema` 通用表单 + 日志/测试。
- 预设结构化编辑 + YAML 高级编辑 + 校验/备份/apply/rollback；能力档位（safe/workspace/operator/custom）、危险工具声明与警告、绑定到群的确认流程；`compress` 开关归入 compaction 区块。
- 验收：改预设不手工 build；保存失败可回滚；危险工具必须显式声明并给出警告；未知工具被拒绝。

**2026-11-09 状态：P3 技能管理与插件 configSchema 子批已实现并验收。** 技能：外部技能存 `extensions/skills/<id>/SKILL.md`，状态 `state/extensions/skills-state.json`，备份 `state/extensions/skill-backups/`；支持新增、ZIP 导入（根目录或单层目录、无路径穿越、≤4MB/200 文件）、编辑、启停、删除，只读来源（DSH_HOME、仓库、额外目录）只能查看。`GET/POST /api/extensions/skills`、`POST /api/extensions/skills/import`、`GET/PATCH/DELETE /api/extensions/skills/<id>`；Hub `ext_describe` 支持 `skill` 读正文；`core-skills` 注入按当前 preset 的 `skills.allow` 过滤（未配置时保持全量，兼容无 extensions.yml 的内置 preset）。插件：`plugin.json` 可选 `configSchema`（受支持的 JSON Schema 子集），`PATCH /api/plugins/<id>/config` 写 `plugins.json` 并重载，`POST /api/plugins/<id>/test` 只校验；插件详情用 schema 动态表单 + 测试/日志，无 schema 显示原始 config。验收：`test-skill-store` 3/3、`test-plugin-config-schema` 4/4、技能/catalog/hub 相关 14/14、插件内核/清单 21/21、static 全过、UI 31/31、audit 101/101；真机 API 往返、ZIP 导入、启停/删除、Hub 技能正文、插件 config PATCH/test 与详情表单均通过。偏差见 E13/E14。预设编辑器随后完成：`src/presets/store.mjs` 以 `dsh/agent-presets/<id>/` 为源，提供元数据/扩展授权/YAML 读取写入、备份与 apply/rollback；`/api/extensions/presets` 系列 API；控制台新增预设页（列表 + 内联三段编辑器），保存前校验 YAML，应用执行 build + setup-dsh，失败回滚。`test-preset-store` 5/5、static 全过、UI 32/32、audit 102/102，真机 GET/PUT/validate/apply/rollback 均通过；共用 guard 无法按 preset 放行原生工具，见 E15。

### P4 市场与 GitHub source

- `market/` source adapter：registry（AstrBot 兼容）、github（owner/repo 列表或 Search）、local。
- 预览/安装/更新/回滚；缓存与 rate limit；信任级别与权限展示。
- 验收：从 GitHub 安装一个测试插件；失败回滚；内置插件不可覆盖；市场搜索不阻塞页面。

### P5 提升工具 / `skill` 工具 / 会话覆盖

- 高频工具提升为直连（命名空间 + 上限 + list_changed）。
- 原生 `skill` 工具（若 DSH 侧提供稳定契约，复用 P3 的技能正文读取）；会话级扩展覆盖。
- 验收：提升不导致 schema 爆炸；未授权 preset 仍无法调用；技能正文按需读取。

---

## 13. AstrBot 对照

| 维度 | AstrBot 实际做法 | 桥接采用/不采用 |
| --- | --- | --- |
| 插件元数据 | `metadata.yaml` + `_conf_schema.json`；`author/name` 作 id | 采用 manifest + configSchema；id 用稳定 slug，不用显示名 |
| 插件市场 | 社区索引 JSON + md5 缓存；安装时才读 GitHub raw；分类接口为空、搜索在前端 | 采用 index/cache/preview；补服务端搜索、分类、权限；不建中心市场服务器 |
| 安装回滚 | staging + 全量备份 + 失败恢复 | 采用；补更新失败回滚与固定 ref |
| 技能 | `SKILL.md` frontmatter；全局 active；人格白名单；渐进披露 | 采用渐进披露与 frontmatter；桥接增加 preset 级授权 |
| MCP 暴露 | 每工具直接注册，无 server 前缀、无 list_changed；同名静默覆盖 | **不采用**；Hub 元工具 + 命名空间 + 显式 refresh/list_changed |
| MCP 粒度 | server 级 + 全局 tool 开关 + persona | 桥接做 preset 级 MCP/工具授权；不复制全局-only |
| MCP 安全 | stdio allowlist、禁 eval、HTTP/SSE；无独立审计 | 采用 allowlist/SSRF/超时；补审计与 secret 引用 |
| 预设 | `abconf_*.json` + UMO 路由，插入序无优先级 | 不复制；桥接用显式 preset id + 会话绑定 + 能力档位 |
| 会话插件 | enabled/disabled，disabled 优先 | 可借鉴；桥接 P5 再做会话覆盖 |
| 目录 | 多存储碎片化，无统一 extensions | **不采用**；统一 catalog + `extensions/` 数据目录 |

### 13.1 关于「扫描 GitHub 市场」

AstrBot 的现状是「索引 JSON + GitHub 安装源」，不是逐仓库扫描。桥接若要做「类似扫描 GitHub 目标仓库」：

- 作为 `github` source adapter：用户配置 owner/repo 清单或关键词，桥接用 GitHub API/raw 读取 `plugin.json` 做预检；
- 结果进入同一个 catalog，不另建一套市场模型；
- 不默认全 GitHub 搜索（噪声、rate limit、供应链风险）；至少要求 owner/repo 或明确关键词；
- 安装仍走 preview + staging + 回滚。

---

## 14. 风险与待拍板

### 14.1 风险

1. **工具 schema 膨胀**：元工具减少数量，但错参率上升；提升工具要限量。
2. **外部 MCP 不可信**：可能返回恶意内容、超时、崩溃；必须隔离进程、限流、日志；默认不自动信任，但启用与授权由创建者决定。
3. **插件同进程**：市场插件仍可访问桥接内存与文件；不承诺沙箱，只做权限展示与审计。
4. **预设 YAML 复杂**：直接编辑可能破坏 group/插件结构；必须 schema + 能力声明 + 备份。
5. **DSH 版本差异**：`tools/list_changed`、preset 加载时机、工具名会随版本变；用契约测试锁住。
6. **GitHub rate limit / 供应链**：缓存、固定 ref、校验和、人工确认。

### 14.2 待拍板 / 已确认

已确认：

1. Hub 暴露：接受「P2 先元工具，P4 再提升高频工具」。
2. 市场来源：先做 registry 兼容，再做 GitHub owner/repo 扫描，不默认全 GitHub 搜索。
3. 高权限：默认预设安全，但开发者可定义/选择 `workspace`、`operator` 甚至绑定到群；临时 `arm` 只扩 Hub 工具、重启解除；长期高权限靠建会话时的 preset；警告 + 审计，最终决定权在开发者。
4. 外部 MCP：启用状态由创建时的开关决定，不强制默认关闭。
5. `/preset`：未开始会话可直接切换；已开始会话提示“需重开会话”，确认后按新 preset 新建会话，取消不动作；不静默重置。

仍需确认：

5. `stdio` 的高级放开：`allowArbitraryCommand` 是否默认出现在创建表单（默认关，但可见）？还是折叠到“高级”里，避免误用？
6. 预设编辑：接受「YAML 原文默认、结构化保存会重写并警告」；还是要求结构化保存也必须保留注释（需要 CST，成本更高）？
7. 技能：接受「`core-skills` 发现 + `ext_describe` 按需读正文」的混合方案；还是要在 P3 就接原生 `skill` 工具？

---

## 15. 变更记录

> 实施过程中与本文档不一致的临时改动、分期调整、验收缺口，登记在 ](./_internal/EXTENSION_PLATFORM_DEVIATIONS.md)；阶段收尾必须回写本文档或明确不做。

- 2026-11-08：初稿。基于当前控制台只读页、`qq-tool-restrict.mjs` 的 `compress` 事故、AstrBot 插件/MCP/技能/预设调研；提出桥接聚合、统一 catalog、元工具 + 提升工具、预设 YAML 与 GitHub source adapter。
- 2026-11-08：按评审意见修订。能力模型从「永久 deny」改为「默认 preset 安全 + 能力档位显式解锁」，允许高权限 preset 绑定群；`arm` 后续收敛为进程内临时授权，重启解除；外部 MCP 启用状态由创建者决定；`stdio` 增加 `allowArbitraryCommand`、HTTP 增加 `allowPrivateNetwork`；预设编辑明确 YAML 原文优先、结构化保存会重写并警告；技能改为 `core-skills` 发现 + `ext_describe` 按需读正文。
- 2026-11-08：补「内置/外置」统一规则（§3.5）与 `arm`/预设切换边界（§4.7、§8.4）。依据 DSH `agentPresets.select()` 的实现，已开始过第一轮的会话会返回 `agent-preset/locked`，没有 rebind；`arm` 只做 Hub 层授权，不承诺给已运行会话补原生工具。
- 2026-11-08：按最新决策收敛：`arm` 仅本次进程有效、重启自动解除；`/preset` 未开始会话直接切，已开始的提示需重开会话，确认后按新 preset 新建会话；内置可启停/配置/测试，但不可删除/改名/覆盖/卸载/单独更新。
- 2026-11-08：P0 启动。`compress` 加入 `qq-tool-restrict.mjs` 的 `SAFE_EXACT` 并补回归断言；偏差台账见 ](./_internal/EXTENSION_PLATFORM_DEVIATIONS.md)。
- 2026-11-09：P3 技能、插件 configSchema、预设编辑器三子批完成。技能/插件配置见 `STATUS` 6.9/6.10；预设编辑器以 `dsh/agent-presets/` 为源，提供元数据/扩展授权/YAML 编辑、校验、备份、apply/rollback，控制台新增预设页；偏差 E13–E15。P0 `compress` 仍 Partial，P4/P5 未动工。

