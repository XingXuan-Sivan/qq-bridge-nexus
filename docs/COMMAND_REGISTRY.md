# 命令注册表（P3a / P3b）

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
- 迁移期：命中但 `migrated:false` 的条目返回 `{ handled:false }`，继续走旧 if 链；迁一个删一个，旧链不长期保留。
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

控制台 nav 新增一级「扩展」，四个 tab：**插件 / 技能 / MCP / 管理行为**。管理行为页是只读表格 + 筛选（来源、权限、状态）+ 搜索；行内展开显示帮助文本与所属插件。P3a 不做行内编辑。

## 7. 明确不做

- 单条内置命令的运行时禁用：会让帮助、文档与 owner 习惯失真；要停就停整个插件。
- 枚举 DSH 全部会话命令：没有接口，列出来就是编造。
- 在桥接侧启停 agent 工具：执行方在 DSH，改配置通常要重启。
- 命令自然语言触发：与「不打断群聊」的边界冲突。

## 8. P3b 预留

- `ctx.commands.register(entry)`，插件命令 `source:'plugin'`。
- manifest 静态声明 `commands: [{ name, aliases, scope, permission, help }]`，启动时就能查冲突。
- 新增插件权限位 `commands`，未申请时 `ctx.commands` 为 `undefined`。
