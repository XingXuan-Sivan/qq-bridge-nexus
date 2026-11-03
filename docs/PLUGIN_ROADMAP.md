# 桥接插件与扩展路线图

> 用途：把「接下来做什么、为什么这么做、什么明确不做」固定在仓库里，避免实现跑着跑着偏离规划。
> 规则：**先改这份文档，再改代码**；任何阶段的范围变化，都要在这里留下记录。
> 最后更新：2026-11-04

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
| 界面暴露 | 每个新能力先判断是否上界面 | 会改变对外行为或安全边界的必须有开关并写清影响；纯调参收进「高级」；结构性、调错代价高的保持文件、面板只读 |
| 前端框架 | 不引入运行时框架、不引入构建步骤 | 控制台由 Node 直出静态文件、部署形态是「一个文件夹 + `node src/bridge.js`」；上构建会推翻现有 HTML/DOM 断言测试，也会把插件 UI 契约绑死在框架上。规范化走原生 ESM 分层 + 微型运行时（§8.7） |
| 后端分层 | 不重写 `bridge.js`，按接缝逐步抽，入口路径不变 | 14.7k 行里 HTTP/业务/上游三层混在一起，重写无法 review 与回归；抽层每步保持 `test-integration-v030` 全绿（§8.8） |

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
| P2a | 插件启用/停用、重载、详情页 | ✅ 已完成（2026-11-03） | 1 天 |
| P2b | 本地目录安装/卸载（含 zip） | ✅ 已完成（2026-11-03） | 1 天 |
| P2c | 文件监听自动重载（默认关） | ✅ 已完成（2026-11-03） | 半天 |
| P3a | 命令注册表（内置命令收口）+ 「扩展」四页 + 管理行为只读页 | ✅ 已完成（2026-11-03） | 1–1.5 天 |
| P3b | 插件注册命令（`ctx.commands.register`） | ✅ 已完成（2026-11-03） | 1 天 |
| P3c | 技能 / MCP 只读清单（真管理需 DSH 接口） | 待验证 | 1–2 天 |
| P3d | 「扩展」四页 UI 精修：管理行为表格化 + 命令分组层级、插件卡片重做、与既有控制台视觉统一 | ✅ 已完成（2026-11-03） | 0.5 天 |
| P4 | 具名注入块（✅ 2026-11-03）；出站装饰（✅ 2026-11-03）；入站过滤链（✅ 2026-11-03）；定时任务类型 | 部分完成 | 各 0.5–1 天 |
| P5 | Agent 工具注册 | 需先验证 | 未知 |
| P6 | 控制台前端分层 + 路由/面包屑/搜索层级修复（§8.7） | 🚧 进行中（2026-11-04） | 2–3 天 |
| P7 | `bridge.js` 按接缝抽层，第一步 HTTP 层（§8.8） | 🚧 进行中（2026-11-04） | 逐步，先 1 天 |

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

### 实施记录与偏差（2026-11-03）

实现中发现、且已写进代码/文档的几点，后续阶段不要再踩：

- **ESM 缓存**：`import()` 同一 URL 只会执行一次，重载必须用 `pathToFileURL(main).href + '?v=' + stat.mtimeMs` 绕开缓存（`?v=` 用 mtime 而不是时间戳，避免同一文件重复加载）。
- **重载必须 staging**：新实例的钩子与 persona provider 在 `activate` 成功前不能进全局索引。第一版直接在 `activate` 里注册，结果坏插件的 `activate` 抛错时已经把旧 provider 顶掉；现在 `buildInstance` 收 `pending`，`commit` 才生效。
- **`shutdown` 顺序**：先 `callHook('onShutdown')` 再 `disposeEntry()`。反过来会把钩子表先拆掉，插件拿不到退出钩子（测试里 `shutdown.json` 没写出就是这么发现的）。
- **`detail` 的审计要按插件过滤**：审计文件是全局追加的，直接取尾部 20 条会混进别的插件；现在过滤 `item.plugin === id` 后再取末 20 条。
- **运行态 ≠ 配置**：enable/disable 只写内存 `runtimeEnabled`，不写 `plugins.json`；重启后以配置为准。页面必须说清「临时生效」，否则用户会以为改了配置。
- **控制台刷新函数必须 async**：`refreshPlugins()` 里有 `await api(...)`，漏 `async` 会让整个脚本块语法错误（浏览器直接整页不执行）。
- 测试追加用 PowerShell `Add-Content` 会带 BOM，本项目统一用 node 脚本追加并检查 `BOM count 0`。

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

### 实施记录与偏差（2026-11-03）

- 实现落在 `src/plugins/zip.mjs`（零依赖 zip 解析：EOCD → 中央目录 → 本地头 → `inflateRawSync`）与 `src/plugins/install.mjs`（暂存、目录树检查、移入 `_trash`），kernel 只做编排。
- 与计划不同的地方：目录安装不是直接 `fs.cp` 到 `plugins/<id>`，而是**先复制到 `plugins/.staging-*/plugin`**，校验清单后再 `renameSync` 到目标位置。这样坏清单或加载失败时目标目录从未出现过，回滚只需删暂存。
- zip 要求「恰好一个含 `plugin.json` 的根」（zip 根或唯一顶层目录）。多根、无根都拒绝，避免把 `__MACOSX` 之类的垃圾一起搬进 `plugins/`。
- 拒绝面比计划更严：除路径穿越/超限外，还拒绝加密、分卷、zip64、非 deflate/store 的压缩方法、以及源目录和产物里的符号链接。
- `init()` 现在跳过 `.` 开头的目录；否则安装中途崩掉留下的 `.staging-*` 会被当成插件扫描（清单缺失 → `invalid` 噪声）。
- 卸载顺序是「先移目录，再 dispose」：移不动就整体失败、运行实例不受影响；反过来会出现「目录没了、插件还在跑」的半状态。
- 测试 `scripts/test-plugin-install.mjs` 全程用临时目录，不碰仓库 `plugins/`；已登记 `test-audit.mjs`。
- 联调时补了两处**通用**修正：① 控制台的 CSRF 守卫原先要求所有非 GET 都带 `application/json`，把 zip 上传和 `DELETE` 一起挡了——现在只对 `/api/plugins/install` 的 `application/zip|octet-stream` 与 `/api/plugins/:id` 的 DELETE 例外，Origin 校验不变；② 内核读 `plugin.json` 时剥掉 UTF-8 BOM，否则记事本存过的清单会报「不是合法 JSON」。

---

## 6. P2c：文件监听自动重载（默认关）

- `plugins.watch: true` 时，`fs.watch(pluginsDir, { recursive: true })` + 500ms debounce，只重载变更文件所属的插件。
- 默认关闭：开发时开，生产默认关，避免保存到一半触发半成品重载。
- 对应 AstrBot 的 `ASTRBOT_RELOAD=1`（`astrbot/core/star/star_manager.py` 的 `_watch_plugins_changes`），但只做单层目录，不做递归深度限制之外的复杂过滤。

风险：Windows 上 `fs.watch` recursive 在部分文件系统上不稳定，失败时降级为「不监听 + 日志一行」。

### 实施记录与偏差（2026-11-03）

- `pluginIdFromPath` 提成 `src/plugins/kernel.mjs` 的顶层导出：路径映射是纯函数，放闭包里既不好单测，也容易在 `pluginRoot()` 变化时漂移。
- 监听事件可能连发（编辑器保存一次触发 change + rename），按 id 去抖 500ms，合并成一次重载。
- 只重载 `active` 插件：`disabled`/`invalid` 不动，避免「删目录」把 failed 状态反复刷成 `reload-failed`。
- `shutdown()` 第一步先 `stopWatching()`：退出过程中触发的文件事件不应该再排队重载。
- 监听不可用（平台不支持 recursive、权限、`watcher` error）一律降级为手动，不影响桥接启动；日志只留一行。
- 已知边界：`plugins.json` 本身不在监听范围内——改配置（含 `watch` 本身）仍需重启，这一点与 §12 的「不做热生效」一致。

---

## 7. P3：命令注册表、「扩展」入口与管理行为

### 7.1 命令注册表（P3a，✅ 已完成 2026-11-03）

- 做什么：内置命令收进唯一真源 `src/commands/registry.mjs`；`handleIncoming` 的 `/` 分支先走注册表，未迁移的条目回退旧 if 链。
- 怎么做：entry 形状见 [COMMAND_REGISTRY.md](COMMAND_REGISTRY.md) §2；先迁 `/status`（纯读）、`/role`（带参数与前缀）、`/reset`（大量内部状态）三种形态，其余命令先登记元数据 `migrated:false`；**迁一个删一个**，旧链不长期保留。
- 代价：中——`/reset` 触及 40 多个内存 Map，必须整段搬走而不是复制一份；用 `test-integration-v030` 与新增 registry 单测兜底。
- 验收：三个命令行为与现在逐字一致；`/api/commands` 能列出全部内置命令并标出未迁移项。
- 实施记录与偏差：
  - `/reset` 的整段清理搬进 `commandReset(ctx)`，旧内联块删除；`commandStatus` / `commandRole` 同样整段搬运，没有复制。
  - 注册表新增「元数据条目」形态（无 handler）：`/silent`、`/active` 先登记，`dispatch` 返回 `handled:false` 让调用方回退旧链——比先删旧链再补 handler 安全。
  - `scripts/audit-bridge-harness.mjs` 的 VM 必须注入真实 `createCommandRegistry`（纯内存、无 IO），否则 `/role`、`/reset` 在集成测试里会走空实现。
  - 三个命令的行为靠 `test-integration-v030`（31 条）与 `test-command-registry.mjs`（10 条）共同兜底，注册表单测不启动桥接。

### 7.2 「扩展」四页与管理行为（P3a）

- 做什么：nav 新增「扩展」一级，四个 tab：插件 / 技能 / MCP / 管理行为；管理行为页展示桥接命令、DSH 会话命令、桥接 MCP 工具三组，带来源列。
- 怎么做：复用 `data-view` / `data-page` / `consolePages`；`GET /api/commands` 提供数据；技能列 DSH skills 目录，MCP 列桥接 server 与工具，都只读；状态列不放假开关。
- 代价：低-中（前端为主）。风险：`console.html` 继续变大——本次只在 section 内分块，不拆文件。
- 验收：四页可切换；管理行为里每条命令有来源、权限、帮助；DSH 侧条目标注「由 DSH 管理」。
- 实施记录与偏差：技能页扫 `DSH_HOME/skills` 与仓库 `skills/`，只读 `SKILL.md` 的 frontmatter；MCP 页只列桥接自带的三个 stdio server，DSH 侧的 `mcpServers` 配置不在这里猜；管理行为页的 DSH 命令/工具是静态清单（桥接实际只调用 `/compact`、`/permission`，只提供 `web_search`、`web_fetch`、`snowluma_status`），页面明确标注只读，不做假开关。

### 7.3 插件注册命令（P3b）

- 做什么：`ctx.commands.register({ name, aliases, scope, permission, help, handler })`；manifest 静态声明 `commands`，启动时查冲突。
- 怎么做：注册表新增 `source:'plugin'` 与 `pluginId`；新增插件权限位 `commands`，未申请时 `ctx.commands` 为 `undefined`；内置永远优先，插件间按 pluginId 字典序、冲突告警不覆盖。
- 代价：低。风险：插件命令冒充内置——规则是内置不能覆盖，插件之间先注册者保留。
- 验收：注册 `/hello` 群内可用；`/role` 仍走内置；`owner` 命令对非 owner 静默；未申请权限的插件拿不到 `ctx.commands`。

实施记录与偏差（2026-11-03）：

- `ctx.commands.register` 在 `activate` 里调用，但真正入表发生在 **commit**（activate 成功之后）；activate 抛错或清单校验失败时注册表里不会残留半截命令。
- `id` 不强制填写：缺省用 `<pluginId>:<name>` 兜底，避免两个插件撞 id。
- 注销按 `pluginId` 批量做，卸载 / 停用 / 重载共用一条路径，插件不需要自己清理。
- 冲突策略实测：内置先注册、插件排在后面，内置不被覆盖；两个插件抢同一个名字时后注册者只告警。
- 未做：manifest 静态声明 `commands`（运行时冲突已经告警，等有第二个插件时再评估）。

### 7.4 具名注入块（P4）

- 做什么：`ctx.prompt.registerBlock({ id, priority, maxChars, render(ctx) })`，让记忆、贴纸、日程、关系各占一块，可单独开关与限额。
- 怎么做：现有 `promptAdditions` 保留为兼容层，内部改为调用块注册表；`state/prompt-blocks.json` 已有跟踪能力，扩展成「按 block id 记录注入与跳过」。
- 代价：低。风险：块多了会稀释人格——用 `maxPromptAppendChars` 总上限兜底，并在控制台显示每块占比。
- 验收：注入两块，顺序与限额符合声明；关掉一块后 prompt 里不再出现。

实施记录与偏差（✅ 已完成，2026-11-03）：

- 新增 `src/plugins/prompt-blocks.mjs`：注册表负责排序、块级截断、总预算跳块与错误隔离；`render` 返回 `{ text, blocks, chars }`，`status()` 给控制台看每块的 `calls/failures/lastError/lastRunAt`。
- 注册走 staging：插件在 `activate` 里调用 `ctx.prompt.registerBlock`，先入 `pending.blocks`，`commit` 成功才进表；`disposeEntry` 按 pluginId 注销，并清空 `entry.blocks`。
- 与 `promptAdditions` 的关系：**没有**把旧接口改成兼容层内部调块（那样会把「前缀/后缀」语义硬塞进「块」），而是让两者并列、共用 `limits.maxPromptAppendChars` 这一份总预算；`deliverPromptNow` 先拼钩子前后缀，再接块文本。
- 总预算超限时整块跳过（记 `budget`），不截半句；单块超 `maxChars` 才截断（记 `truncated`）。这条是有意的：块是「一段完整内容」，半句话比没有更糟。
- `status().promptBlocks` 平铺在 `/api/plugins` 响应里；插件条目带 `blocks`（注册的 id 列表），控制台详情可据此显示。
- 没有新增审计事件：块渲染失败只写日志与 `lastError`，不写 `plugin-audit.jsonl`（它记的是生命周期，不是每轮渲染）。
- 内置段落也已迁移（2026-11-03）：贴纸参考 `core-stickers`、记忆摘要 `core-digest` 走 bridge 自建的第二个注册表（`maxTotalChars` 200000，与插件块分账）；配置在 `config.json` 的 `promptBlocks`，默认开启。`/api/plugins` 的 `coreBlocks` 返回这两块的上限与调用次数，插件页 meta 直接显示。
- 迁移验收：用 bridgeHarness 抓 `buildWakePromptV2` 三种 reason（replyCheck / timeout / bootstrap）的全文，迁移前后**逐字一致**（只差每次随机会话令牌）；`scripts/test-core-prompt-blocks.mjs` 守住「关掉后整段消失、`maxChars` 收紧后变短但不整段消失」。
- 偏差：块 id 正则只允许 `[a-z][a-z0-9-]`，原计划的 `core.stickers` / `core.digest` 带点被注册表拒绝（记忆段整段消失 637 字才发现），改为连字符 id；`config.json` 的 `promptBlocks` 原样未知键会被 `loadConfig` 丢弃，已补 `normalizePromptBlocks` 白名单（只接受 `enabled` 布尔与 1–100000 的 `maxChars`）。

### 7.5 「扩展」四页 UI 精修（P3d）

- 做什么：管理行为页从平铺列表改成表格（指令 / 类型 / 所属 / 描述 / 权限 / 状态 / 操作），按命令 `group` 自动生成可展开的分组；插件页卡片重做（图标块、状态 pill、描述、权限与钩子标签、操作按钮行）；技能页与 MCP 页统一成同样的表格语言。
- 怎么做：只复用控制台已有的组件与样式（`.card` / `.grid` / `.row` / `.meta` / `.pill` / `.tool-log-table` / `table`），不引前端框架、不另起一套；命令注册补 `group`（内置按「会话 / 人格 / 静默」，插件命令按 pluginId 归组）；分组行点击折叠，搜索与权限筛选在前端过滤；窄屏横向滚动而不是压缩列。
- 代价：低（纯前端 + 注册元数据）。风险：分组名是自由文本，插件可能写乱——统一回退到插件名，并在文档里约定简短中文分组名。
- 验收：分组可展开/收起；搜索、权限、来源筛选同时生效且计数正确；表格在 1280 与 1600 宽下不溢出；`test-console-static` 通过；插件卡片与既有页面视觉一致（同一套圆角、边框、字号）。

实施记录与偏差：

- 分组层级直接由注册表条目的 `group` 派生（`/reset`、`/status`、`/silent`、`/active` → 会话，`/role` → 人格，插件命令 → `插件 <id>`，缺失回退「其他」），页面不维护第二份分组表。
- 表格用 `<table>` + 组行 `<tr class="group-row">` / 子行 `<tr class="group-child">`；首组默认展开，点组行折叠；搜索按 name/help/aliases 过滤，权限与来源是下拉，三者叠加。
- 首版自造了 `.plugin-*` / `.ext-table` 一套样式，被用户指出「界面简陋、应复用框架组件」后全部删除：表格容器改用 `.tool-log-table`，卡片改用 `.grid` + `.card` + `.row` / `.meta`，标签一律用 `.pill`（`.tag` 是 8×18 的大号点击胶囊，放表格与卡片里会撑高行、挤压列），组行展开状态只留 6 条 `.tool-log-table tr.group-row` 相关样式。
- 控制台没有 `--line` 变量（旧平铺行用它导致分隔线不显示），统一改用 `--card-border`。
- 外壳改成标准三容器布局：`body` 是固定高度的网格（`grid-template-columns:var(--sidebar-w) minmax(0,1fr)`、`grid-template-rows:var(--topbar-h) minmax(0,1fr)`、`height:100dvh`、`overflow:hidden`），`aside` 占左列两行，右侧 `.workspace` 自己再分 `header` + `main` 两行，`main` 是唯一滚动容器。不再用「侧栏 fixed + workspace 左偏移 + topbar sticky」那套并列机制；两处媒体查询只改 `--sidebar-w` / `--topbar-h`。
- 滚动条：全局细样式（`scrollbar-width:thin` + 9px webkit thumb），去掉上下箭头（`::-webkit-scrollbar-button{display:none}`），默认透明、悬停容器才显形；`overflow-y:auto` 保证只在该滚的时候出现。
- 插件卡片：`.grid` 两列、`.card` 内标题行 + 描述 + 标签行 + 按钮行（`button.small`），无自造头像；`/api/plugins` 因此补了 `description` 与 `permissions` 两个字段。
- 技能页与 MCP 页同步使用 `.tool-log-table` 表格（技能：名称/说明/路径；MCP：服务器/说明/入口与工具），空态统一 `.meta`。
- 「详情」这类跨区域按钮的点击委托从 `#pluginsList` 提到 `document`，否则管理行为表里的按钮点不到。
- 明确不做：分页（桥接命令量级在几十条，先不做）、单条命令启停（内置命令没有独立开关，状态列只标「常开」或「随插件」）。


---

## 8. P3 候选（按收益排序）

### 8.1 出站装饰 `onReplyDecorate`

- 做什么：发送前拿到 `parts`，可改写、增删或取消。
- 场景：md→plain、拆条策略、引用/卡片、贴纸追加、语音替换。
- 代价：中——要碰 `sendToQQ` 前的组装逻辑；必须先有「装饰失败一律回退原文」的兜底。
- 验收：装饰抛错时原文照发。

**状态：✅ 已完成（2026-11-03）。** 实现口径：

- 只作用于模型回复：`auditAndSend()` 传 `{ decorate: true }`，`sendToQQ(key, msg, opts)` 在**每一段**发送前调用 `plugins.decorateReply({ key, text, partIndex, totalParts })`；确认语、系统通知、管理通道不装饰。
- 链式：按插件 id 顺序执行，后一个拿到前一个改过的 `text`；返回字符串 / `{ text }` / `{ drop: true }`。
- 兜底：单步抛错或超时保留上一步结果；装饰后的文本仍过一次敏感信息审计（不能借装饰绕过）；内核 `invokeHook()` 统一收口超时、审计与统计。
- 记录：`scripts/test-plugin-kernel.mjs` 增「链式改写、drop 取消、抛错保留上一步、停用后链缩短」用例（14/14）。

### 8.2 入站过滤链 `onInbound` 增强（✅ 2026-11-03）

- 做什么：`filters.inbound: true` 时钩子可返回 `{ drop }` / `{ text }`，按 id 链式执行；需 `inbound:filter` 权限。
- 场景：敏感词、群规则、白名单、去重、跨群转发。
- 实现口径：默认关；关着时完全不调用过滤逻辑，行为与没有插件时一致；`drop` 发生在写社交历史之前（消息不留痕）；替换文本上限 4000 字；无权限动作被忽略并记审计 `inbound-denied`。
- 验收：`scripts/test-plugin-kernel.mjs` 增「默认关不生效、开启后可丢可改、无权限动作被忽略」用例（15/15）。

### 8.3 定时任务类型（✅ 2026-11-04）

- 做什么：插件注册 task kind + runner，进入 [src/scheduler/engine.js](../src/scheduler/engine.js)。
- 落地：权限 `task-type:provide`，`ctx.scheduler.registerTaskType({ id, label, description?, validate?, run })`；内核 `taskTypeIndex` 按 pluginId 注销，调度器通过 `taskKinds` 适配器只问「有没有 / 怎么校验 / 叫什么」；控制台编辑器加「插件任务类型」下拉 + payload JSON，列表用 `kindLabel` 与 payload 预览。
- 代价：中——要处理持久化、恢复、时区。
- 验收：自定义类型的任务重启后仍在（`test-scheduler.mjs` ⑦：写入 `state/scheduler.json`、重建调度器后 kind/payload/label 都在；未注册时拒绝新建、已有任务保留）。

### 8.4 插件控制台面板

- 做什么：`/plugin-ui/<id>/` 静态路由 + 插件页卡片入口，面板只能拿自己的数据。
- 代价：中——鉴权隔离、CSP、样式污染。
- 验收：未启用插件的面板 404。

### 8.5 Agent 工具注册（暂缓）

- 现状：`qq_*` 工具写死在 DSH preset 补丁（[dsh/agent-presets/](../dsh/agent-presets/)），改一次要重启 DSH。
- 结论：需要 DSH 侧支持运行时更新工具表；在确认之前不做，避免做出「注册了但模型看不到」的假功能。

### 8.6 配置面板（✅ 2026-11-04）

- 做什么：把「只能改文件」的高频配置搬进控制台，写回仍走 JSON + 原子写 + 审计，不做第二套存储。
- 上界面（可改）：
  - 内置注入块 `core-stickers` / `core-digest` 的 `enabled` 与 `maxChars`（写 `config.json`，`PATCH /api/config/promptBlocks`，立即生效）。
  - `filters.inbound`、`watch`、`limits.hookTimeoutMs`、`limits.maxPromptAppendChars`、`install.enabled`（写 `plugins.json`，`PATCH /api/plugins/settings`，立即生效）。
  - 插件级持久化启用（详情弹窗写 `plugins.<id>.enabled`，重启后生效）。
- 保持只读或不暴露：`audit.*`、`persona.cache.*`（详情里可见状态，但不给一键关）、`persona.provider`（等有第二个 provider 再做下拉）、插件自由 `config`（manifest 没有 `configSchema` 前不做通用表单）、`role.maxInjectChars`（人格页显示即可）。
- 验收：`scripts/test-plugin-kernel.mjs` 增「设置接口：越界拒绝、白名单写回、watch 即时生效、未知字段忽略」（16/16）；两个 PATCH 都要求 JSON 与控制台令牌，写操作记审计 `settings`。

### 8.7 控制台前端规范化与路由修复（进行中：第一阶段已落地）

背景：前端原来是 `public/console.html`（372 KB / 7097 行，样式与脚本全内联）加 `control-center.html`（97 KB），没有组件层；路由只靠 hash，刷新会回落首页，面包屑是纯文本，搜索候选被卡片遮挡。用户要求「框架依赖保持现状」下的规范化，并明确要求**先把 HTTP 边界写进文档**（已完成：[HTTP_BOUNDARY.md](HTTP_BOUNDARY.md)）。

**第一阶段（✅ 2026-11-04）：目录拆分 + 静态路由**
- `public/console/index.html`（结构，82 KB）/ `css/app.css`（41 KB）/ `js/app.js`（ES module，212 KB），原 `public/console.html` 已删除；`js/app.js` 目前仍是单个 module，模块化拆分留在下一阶段。
- 服务端：`src/http/static.mjs` 守卫 + `/^\/console\/(?:css|js|img|fonts)\//` 静态路由**排在令牌校验之前**（否则浏览器取 `app.js` 得到 401、页面白屏），页面本身仍鉴权。
- 测试：新增 `scripts/console-source.mjs`（`consoleSourcePaths` / `readConsoleSource` 拼接三件套），14 个读旧 HTML 的测试改用它；`scripts/console-ui-fixture.mjs` 预读 css/js 并按 `text/css`、`text/javascript` 返回。
- 验证：无头 Edge 实测 CSS/JS 均 200（42 KB / 234 KB），无控制台异常；深链 `#scheduler`、点击进页后刷新、未知 hash 回落均保持；`test:audit` 77/80（仍为三项既有失败）。


**先修的三个 bug**

| 编号 | 现象 | 根因 | 状态 |
| --- | --- | --- | --- |
| B1 | 任意页面刷新都回「运行总览」 | 初始化只读 `location.hash`，只监听 `hashchange`，hash 在 reload 后丢失时无兜底 | ✅ 已修：`sessionStorage['qqb-console-page']` + 三层恢复 + `popstate` + 未知 hash 回落并提示 |
| B2 | 顶栏「工作空间 / 页面名」不可点 | 两段都是 `<span>`，`consolePages` 没有父子关系 | ✅ 已修：分组从 `#mainNav` 的 `.nav-label` 推导，`renderBreadcrumb()` 渲染可点父级（`<a href="#组内首页">`） |
| B3 | 搜索候选被卡片盖住 | `.search-results` 在 `.page-heading` 内，而该元素带 `transform`，候选框被锁在它的层叠上下文里 | ✅ 已修：候选框挂到 `document.body` + `position:fixed`，位置按输入框 `getBoundingClientRect()` 计算，滚动/缩放跟随 |

**第二阶段（进行中）：公共层先抽，pages 留到最后**
- `js/api.js`：令牌引导（`?token=` → localStorage）与 `api()` 的统一 401 重试。
- `js/ui.js`：`showConsoleToast`、`esc`、`renderTable`、`renderTileList`——页面不再各写一份 `innerHTML` 模板。
- `js/router.js`：`consolePages` 页面表、`setConsolePage`、面包屑、hash/popstate、首屏三层恢复；数据刷新改成页面用 `onPageRefresh(page, fn)` 注册回调，路由器不再反向依赖页面模块。
- `js/app.js` 只留装配：import 三个模块 + 建页面 + 绑定事件 + 末尾 `initRouter()`。
- 待办：`pages/*.js`（12 个页面）、`js/store.js`（跨页共享状态）、CSS 拆 `tokens/layout/components/pages`、CSP 去 `unsafe-inline`。

**目标结构（A：原生 ESM + 微型运行时，零构建）**

```
public/console/
  index.html            只留骨架：aside / header / main
  css/{tokens,layout,components,pages}.css
  js/{router,api,components,store}.js
  js/pages/{overview,sessions,persona,plugins,skills,mcp,behaviors,scheduler,usage,access,operations,reference}.js
```

- `definePage(name, { title, parent, mount, refresh })` 注册页面，`setConsolePage` 只做「切换 + 落 URL + 记 sessionStorage」；
- 组件：`renderTable({columns, rows})`、`renderTileList()`、`openModal()`、`toast()`、`renderBreadcrumb()`，替换现在散落的 `innerHTML` 拼接；
- 样式只走 CSS 变量与既有类名（`.tile-list`/`.tile`、`.settings-group`/`.settings-content`），禁止 JS 拼布局；
- 服务端加 `GET /console/*` 静态路由（带 [HTTP_BOUNDARY.md](HTTP_BOUNDARY.md) §1 的穿越守卫），同时把 CSP 的 `unsafe-inline` 收敛到 `'self'`。

**明确不做**：引入 React/Vue/Svelte 等运行时；引入 bundler/构建产物目录；把插件 UI 塞进宿主文档（插件 UI 走 iframe 沙箱，见 HTTP_BOUNDARY §5）。

**代价与风险**：控制台从一个大 HTML 变成骨架 + 样式 + 逻辑三件套（第二阶段再拆成约 20 个模块），迁移期需要一次「双跑」窗口；`test-console-static.mjs`/`test-console-ui.mjs` 断言 HTML 字符串与 DOM 选择器，第一阶段已用 `scripts/console-source.mjs` 兼容，第二阶段拆模块后需要改成断言模块/渲染结果。

**验收**：B1–B3 各有回归用例；`npm run test:console-static` 全过；逐页截图与人格页对齐；CSP 响应头无 `unsafe-inline`。

### 8.8 `bridge.js` 按接缝抽层（进行中）

现状：`src/bridge.js` 14.7k 行，HTTP 路由、业务规则、上游适配混在一个请求处理函数体里。**不重写**，按接缝逐步抽，每步一个提交、每次保持 `test-integration-v030` 全绿。

| 步骤 | 抽什么 | 落到哪 | 风险 |
| --- | --- | --- | --- |
| 1 | 路由表、`sendJson/sendFile`、鉴权中间件、404 语义、静态资源守卫、CSP | `src/http/{router,respond,auth,static}.mjs` | 低（纯搬迁 + 集中边界） |
| 2 | 命令分发与 `/remind` 等内置命令 | `src/commands/*` | 低 |
| 3 | 会话/模式状态（`state.sessions`、模式闸门、审批） | `src/session/*` | 中 |
| 4 | 上游适配（DSH / SnowLuma / MCP host） | `src/upstream/*` | 中 |

约定：

- **入口不动**：`package.json` 的 `start` 仍是 `node src/bridge.js`，`src/bridge.js` 保留为组装根（读配置 → 建依赖 → 注册路由 → 启动），最终收敛到 500 行量级；
- 每一抽都必须「行为零变化」，只搬代码不改语义；语义要改的另开提交；
- 抽完 HTTP 层后新增 `scripts/test-http-boundary.mjs`（穿越、符号链接、未启用 404、未知端点 404），并入 `test:audit`。

**验收**：`test-integration-v030` 31/31 不减；`test:audit` 不差于 76/79；`src/bridge.js` 行数逐阶段下降并在 CHANGELOG 记录。


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
5. 控制台折叠面板统一 `<details class="settings-group"><summary>…</summary><div class="settings-content">…</div></details>`：内容必须包在 `.settings-content` 里，否则没有内距、会贴着边框；内层小折叠用 `<details class="settings-sub">`，别再手写 padding。
6. 控制台列表与工具栏统一：卡片列表用 `.tile-list` + `.tile`（人格卡与插件卡同一套间距，`gap:10px`、`margin:10px 0 4px`、tile 内距 `13px 15px`）；表格列表用 `.tool-log-table`（自带 `margin-top:12px`），外层不要再叠加内联 `margin-top`；h2 下与列表前的工具栏行用 `class="row" style="margin-top:8px"`。新增页面先对照人格页的间距，不要自造网格或 padding。
