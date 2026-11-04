# 命令注册表（P3a / P3b / P7 第二步）

桥接侧命令的统一真源。目标不是「所有能执行的东西都归这里管」——DSH 的会话命令与 agent 工具不由桥接执行，硬做开关只会骗人。这里只解决三件事：**能列出、能判定权限、能让插件注册**。

## 1. 三个来源，能力不同

| 来源 | 例子 | 谁执行 | 桥接能做什么 |
| --- | --- | --- | --- |
| 桥接命令 | `/role`、`/reset`、`/status`、`/remind` | 桥接 | 列出、启停（按插件）、改权限、生成帮助 |
| DSH 会话命令 | `/compact`、`/permission` | DSH | 只能展示「桥接调用过的」，不能枚举全集 |
| Agent 工具 | `qq_*`、`web_search`、`web_fetch` | DSH / 桥接 MCP server | 展示名字与来源；启停要改 DSH 配置，通常需重启 |

管理行为页把三者放在同一张表里，但**来源列必须可见**，状态列语义分开：桥接命令显示启用/停用，另外两类显示「由 DSH 管理」。

## 2. 数据模型

```js
{
  id: 'role',                    // 稳定 id，等于主名去掉斜杠
  name: '/role',                 // 主名，必须带 /
  aliases: ['/角色'],            // 可选
  scope: 'all',                  // all | private | group
  permission: 'owner',           // all | admin | owner（P3a 的 admin 与 owner 同义）
  help: '查看或切换本会话的人格卡',
  group: '人格',                 // 页面分组
  source: 'bridge',              // bridge | dsh | tool
  pluginId: null,                // 内置为 null；插件命令为插件 id
  migrated: true,                // false = 仅元数据，仍走旧 if 链
  handler: async (ctx) => {},    // 可选；缺省表示未迁移
}
```

## 3. 匹配与分发

- 只认前缀形态：`text === name` 或 `text.startsWith(name + ' ')`；参数为剩余部分。
- 同一段文本按 **最长主名** 命中（`/role` 不会抢 `/rolelist` 这类更长的命令）。
- 命中顺序：内置 → 插件（按 pluginId 字典序）；冲突在注册时告警，**先注册者保留**，不静默覆盖。
- 非 owner 发任何 `/` 命令，仍在桥接层统一回「管理命令仅管理员可用」，不进入注册表。
- 迁移期：命中但 `migrated:false` 的条目返回 `{ handled:false }`，继续走旧 if 链；迁一个删一个，旧链不长期保留。P7 第二步之后五条内置命令全部 `migrated:true`，`migrated:false` 只为将来自愿只登记元数据的条目保留。
- 不做正则匹配、不做自然语言触发（`/` 前缀是刻意的边界）。

## 4. 权限

| permission | 谁能用 | P3a 行为 |
| --- | --- | --- |
| `all` | 所有人 | 白名单内即可用 |
| `admin` | ownerQQ | 与 `owner` 同义，等有了多管理员再拆 |
| `owner` | ownerQQ | 现有判定 |

插件命令默认 `owner`，要 `all` 必须在 manifest 里显式声明，避免插件悄悄对群开放。

## 5. 接口

`GET /api/commands`（控制台令牌）：

```json
{
  "ok": true,
  "bridge": { "builtin": [ /* CommandEntry 去掉 handler */ ], "plugin": [] },
  "dsh": [ { "name": "/compact", "note": "桥接调用过，由 DSH 执行" } ],
  "tools": [ { "name": "web_search", "source": "src/mcp-web-search-safe.js", "managed": "dsh" } ]
}
```

## 6. 页面

控制台 nav 新增一级「扩展」，四个 tab：**插件 / 技能 / MCP / 管理行为**。

管理行为页是一张按 `group` 自动分组的表格（P3d 起）：

- 表头列：指令 / 类型 / 所属 / 描述 / 权限 / 状态 / 操作；组行显示组名与条数，点一下折叠或展开，首组默认展开。
- 组名来自条目 `group`：内置命令按注册时写的「会话」「人格」分组，插件命令归到「插件 &lt;id&gt;」，没有 `group` 的落到「其他」——层级是派生出来的，页面不维护第二份分组表。
- 类型列区分「注册表」（已迁移进注册表）与「旧链」；状态列内置显示「常开」、插件显示「随插件」，不做单条启停。
- 三个筛选同时生效：来源（全部/内置/插件）、权限（全部/owner/admin/所有成员）、关键词（匹配 name、help、别名）；计数随筛选更新，无结果显示空态。
- 插件命令的操作列给「详情」，跳到插件面板；内置命令是「—」。分页不做（桥接命令量级在几十条）。


## 7. 明确不做

- 单条内置命令的运行时禁用：会让帮助、文档与 owner 习惯失真；要停就停整个插件。
- 枚举 DSH 全部会话命令：没有接口，列出来就是编造。
- 在桥接侧启停 agent 工具：执行方在 DSH，改配置通常要重启。
- 命令自然语言触发：与「不打断群聊」的边界冲突。

## 8. 插件命令（P3b，已实现 2026-11-03）

- `ctx.commands.register({ id?, name, aliases?, scope?, permission?, help?, handler })`，需要清单申请 `commands` 权限；未申请时 `ctx.commands` 为 `undefined`。
- 插件命令 `source:'plugin'`、`pluginId` 由内核代填；`id` 未写时用 `<pluginId>:<name>` 兜底。
- 注册在 `commit`（activate 成功）时才进注册表：activate 抛错、清单不合法、重载失败都不会留下半截命令。
- 卸载 / 停用 / 重载时内核按 `pluginId` 批量注销，插件不需要自己清理；`detail` 与 `/api/commands` 都能看到 `commands` 列表。
- 冲突规则不变：内置永远优先；插件之间先注册者保留，失败的一条只告警、不覆盖，也不阻断其它命令。
- 未做：manifest 里静态声明 `commands` 以便启动前校验冲突（运行时冲突已经有告警，静态声明留到有第二个插件时再评估）。

## 9. 代码位置（P7 第二步、第三步，2026-11-05）

`bridge.js` 从 14745 行降到 14694 行，命令与会话重置拆成四个文件，职责不重叠：

| 文件 | 职责 | 依赖 |
| --- | --- | --- |
| `src/commands/registry.mjs` | 注册表本体：校验、匹配、分发、权限/scope、冲突与注销 | 无（纯内存） |
| `src/commands/builtin.mjs` | 五条内置命令的壳（`/reset` `/status` `/role` `/silent` `/active`）+ 文案 | 由 `deps` 注入 `send`/`session`/`acl`/`role`/`log` |
| `src/commands/payload.mjs` | `GET /api/commands` 的响应组装（bridge 内置/插件 + DSH 命令 + agent 工具） | 只读注册表，不碰会话 |
| `src/session/reset.mjs` | `/reset` 的清理序列：删挂账 → 清内存态 → 落盘 → 停 DSH → 归档 → 回执 | 由 `deps` 注入约 30 项状态与 `api`/`withTimeout` |

- 入口不变：`package.json` 的 `start` 仍是 `node src/bridge.js`，`bridge.js` 保留为组装根（建注册表、拼 `builtinCommandDeps`、注册、挂 `/api/commands`；`resetSession` 在这里惰性拼 `createSessionResetter` 的 deps）。
- `/reset` 的清理序列在 `src/session/reset.mjs`（P7 第三步）：`deps` 显式登记每个要清的桶，新增缓存必须同步登记，漏了测试会红。`bridge.js` 只剩「把状态交给它」的登记段。
- `resetSession` 依赖 `sessionEpoch` 自增，`bridge.js` 有 9 处使用它，所以通过 `bumpEpoch` 回调传入，模块不直接改这个变量。
- `deps` 是刻意的窄口：内置命令拿不到 `cfg`、`stateDir`、`sessions` Map，只能通过注入的能力做事——这样单测可以直接给假实现，不需要起桥接进程。
- 回归：`scripts/test-command-registry.mjs` 17 条（12 条注册表 + 5 条内置命令/payload）、`scripts/test-session-reset.mjs` 4 条（no-session、全桶清理、顺序、停止失败容忍）、`scripts/test-audit-bridge.mjs` 全 PASS（含「console reset drops the session policy and stops the retired DSH session」）、`scripts/test-integration-v030.mjs` 31/31。
