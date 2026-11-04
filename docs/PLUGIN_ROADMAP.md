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
| P6 | 控制台前端分层 + 路由/面包屑/搜索层级修复（§8.7） | ✅ 已完成（2026-11-05） | 2–3 天 |
| P7 | `bridge.js` 按接缝抽层，第 1 步 HTTP 层、第 2 步命令层（§8.8） | 🚧 进行中（2026-11-05：1/2 已完成） | 逐步，先 1 天 |

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

### 8.7 控制台前端规范化与路由修复（✅ 第三阶段已完成 2026-11-05）

背景：前端原来是 `public/console.html`（372 KB / 7097 行，样式与脚本全内联）加 `control-center.html`（97 KB），没有组件层；路由只靠 hash，刷新会回落首页，面包屑是纯文本，搜索候选被卡片遮挡。用户要求「框架依赖保持现状」下的规范化，并明确要求**先把 HTTP 边界写进文档**（已完成：[HTTP_BOUNDARY.md](HTTP_BOUNDARY.md)）。

**第一阶段（✅ 2026-11-04）：目录拆分 + 静态路由**
- `public/console/index.html`（结构，117 行骨架）/ `css/`（`tokens` + `base` + `layout` + `components` + `utilities`，按序加载）/ `js/`（公用模块 `api`/`router`/`ui`/`timezone`/`theme-boot` + 组件 `components/{message,table,modal}` + `pages/<id>/page.js`），原 `public/console.html` 与后续的 `css/app.css` 均已删除。
- 服务端：`src/http/static.mjs` 守卫 + `/^\/console\/(?:css|js|img|fonts)\//` 静态路由**排在令牌校验之前**（否则浏览器取 `app.js` 得到 401、页面白屏），页面本身仍鉴权。
- 测试：新增 `scripts/console-source.mjs`（`consoleSourcePaths` / `readConsoleSource` 拼接三件套），14 个读旧 HTML 的测试改用它；`scripts/console-ui-fixture.mjs` 预读 css/js 并按 `text/css`、`text/javascript` 返回。
- 验证：无头 Edge 实测 CSS/JS 均 200（42 KB / 234 KB），无控制台异常；深链 `#scheduler`、点击进页后刷新、未知 hash 回落均保持；`test:audit` 77/80（仍为三项既有失败）。


**先修的三个 bug**

| 编号 | 现象 | 根因 | 状态 |
| --- | --- | --- | --- |
| B1 | 任意页面刷新都回「运行总览」 | 初始化只读 `location.hash`，只监听 `hashchange`，hash 在 reload 后丢失时无兜底 | ✅ 已修：`sessionStorage['qqb-console-page']` + 三层恢复 + `popstate` + 未知 hash 回落并提示 |
| B2 | 顶栏「工作空间 / 页面名」不可点 | 两段都是 `<span>`，`consolePages` 没有父子关系 | ✅ 已修：分组从 `#mainNav` 的 `.nav-label` 推导，`renderBreadcrumb()` 渲染可点父级（`<a href="#组内首页">`） |
| B3 | 搜索候选被卡片盖住 | `.search-results` 在 `.page-heading` 内，而该元素带 `transform`，候选框被锁在它的层叠上下文里 | ✅ 已修：候选框挂到 `document.body` + `position:fixed`，位置按输入框 `getBoundingClientRect()` 计算，滚动/缩放跟随 |

**第二阶段（✅ 2026-11-05 完成）：公共层先抽，pages 留到最后**
- `js/api.js`：令牌引导（`?token=` → localStorage）与 `api()` 的统一 401 重试。
- `js/ui.js`：`showConsoleToast`、`esc`、`renderTable`、`renderTileList`——页面不再各写一份 `innerHTML` 模板。
- `js/router.js`：`consolePages` 页面表、`setConsolePage`、面包屑、hash/popstate、首屏三层恢复；数据刷新改成页面用 `onPageRefresh(page, fn)` 注册回调，路由器不再反向依赖页面模块。
- `js/app.js` 只留装配：import 三个模块 + 建页面 + 绑定事件 + 末尾 `initRouter()`。
- 第三阶段（✅ 2026-11-05 基本收口）：页面目录化 `pages/<id>/{page.html,page.css,page.js}`（15 页全部自包含）、公用层留在 `js/{api,ui,router,timezone,theme-boot}.js` 与 `js/components/{message,table,modal}.js`、`app.css` 拆成 `css/{base,layout,components}`、内联样式收口到 `utilities.css` 且 0 残留、favicon、CSP 去掉 `unsafe-inline`、控制中心按 B 档独立目录化。详见本节「第三阶段」的 3.1–3.5。
- 第二阶段收口（实测 2026-11-05）：**15 个页面全部**在 `public/console/pages/<id>/`（技能 / MCP / 管理行为 / 工具参考 / 访问与安全 / 二代仿真 / 一代仿真 / 黑话词库 / 定时任务 / 用量与花费 / 人格与角色 / 调试与运维 / 会话与审批 / 运行总览 / 插件），`index.html` 只剩 15 个空宿主 + toast/modal 宿主（117 行）、`app.js` 只剩全局状态刷新、搜索、主题与入口装配（298 行），公共逻辑在 `js/{api,ui,router,timezone,theme-boot}.js`、可复用组件在 `js/components/{message,table,modal}.js`；`js/store.js`（跨页共享状态）暂不做，等有真实共享状态再加。
- 页面模块约定：`pages/<page>.js` 导出 `initXxxPage()`，自己绑事件、自己 `onPageRefresh('<page>', ...)`、自己做首次加载；入口只调 `initXxxPage()`。**迁移时必须逐个核对用到的辅助函数**（`esc`、`showConsoleToast`、`api` 从 `../ui.js`、`../api.js` 显式 import）——漏掉一个会被 `init` 末尾的 `.catch(() => {})` 吞掉，页面停在「加载中…」而控制台无报错（插件页迁移时踩过）。**整块搬迁不要用 `@@SLOT@@` 之类的哨兵占位**：脚本替换完忘记回填，裸文本会直接挂在 `main` 下、在每一页都显示（访问与安全页迁移时踩过，2 行残留）；真要占位就用带本页 id 的注释，并让 `test-console-static` 的哨兵断言兜住。**片段里的 `position:fixed` 浮层（modal / 抽屉 / 全局提示）必须挂到 `document.body`**：片段被注入在 `section.card` 里，而 `.card` 有入场动画与 `backdrop-filter`，会给 `fixed` 造出包含块——遮罩只盖住卡片、盖不住整页（插件详情弹窗踩过；搜索候选框是同一类问题的另一处）。挂载放在该页 `init()` 里，用 `if (el.parentElement !== document.body) document.body.appendChild(el)`，事件委托仍按 id 绑定。

**目标结构（A：原生 ESM + 微运行时，零构建；页面与组件自包含）**

设计原则：**页面归页面、公用归公用**——一个页面的 HTML/CSS/JS 放在同一个目录，能整目录搬走或删掉；公用组件同理；只有真正的横切能力（API、路由、存储、格式化、全局样式）留在 `app/`。不做 scoped CSS 编译、不做构建产物，保持「改完刷新就能看」的节奏。

```
public/console/
  index.html                 只留骨架：aside 导航 / header（面包屑+搜索）/ <main id="pageHost"> / toast / modal 宿主
  img/favicon.svg            浏览器标签图标（复用侧栏品牌标记 q↗ 的图形与配色）
  css/                       公用样式（按加载顺序）
    tokens.css               设计令牌与深色覆盖
    base.css                 重置、排版、滚动条、按钮与表单基线
    layout.css               三容器外壳：侧栏 / 顶栏 / 主区
    components.css           网格、卡片、表格、表单、弹窗、主题细节
    utilities.css            工具类（宽度、间距、flex、行内对齐）
  js/                        公用逻辑
    api.js                   fetch 封装（x-console-token、401 重试）
    router.js                页面表、hash/popstate、hydratePage、面包屑、onPageRefresh
    ui.js                    toast、esc、tile 列表、applyPageA11y
    timezone.js              时区下拉与偏移计算（定时任务 / 定时静默共用）
    theme-boot.js            首屏前套用主题（避免闪白）
    components/              可复用组件
      message.js             setMsg / clearMsg（统一操作反馈配色）
      table.js               tableHtml（表头宽度走 data-w）
      modal.js               openModal / closeModal / wireModal（Esc、点遮罩）
    app.js                   只做装配：建页面、绑全局事件、末尾 initRouter()
  pages/
    overview/{page.html,page.css,page.js}
    persona/{page.html,page.css,page.js}
    plugins/…  skills/…  mcp/…  behaviors/…  scheduler/…  slang/…  usage/…  access/…  operations/…  social-v1/…  social-v2/…  reference/…
```

- **页面目录契约**：`page.html` 是该页 DOM 片段（不含 `<html>/<head>`，不引脚本）；`page.css` 只写本页私有样式；`page.js` 导出 `initXxxPage()`（沿用现有约定，自绑事件、自注册 `onPageRefresh`、自做首次加载）。工具参考页只有 `page.html`，没有 JS。
- **路由器载入一页**：`loadPage(id)` → `fetch('pages/<id>/page.html')`（内存 Map 缓存，一页只取一次）→ 注入 `#pageHost` → 按需插 `<link rel="stylesheet" href="pages/<id>/page.css">`（按 URL 去重）→ `import('./pages/<id>/page.js')` → 调 `initXxxPage()`。片段取不到时显示「页面加载失败，刷新重试」占位并记一条 console 日志，不白屏。
- **组件契约**：需要 DOM 结构的（modal、field、table）导出返回节点的构造函数；纯展示的（pill、tile、空态）导出 HTML 字符串。样式与组件同目录（`app/ui/table.css`），由 `components.css` 汇总引入。
- **样式纪律**：全局只有 `app/styles/`；页面私有样式禁止写全局选择器；禁止 JS 拼布局。现有 407 处内联 `style="width:…"` 收敛为宽度工具类（`.w-200` / `.w-118` 这类），分批清，不一次性大改。

**第三阶段（✅ 2026-11-05 完成）：页面目录化 + favicon**
1. `3.1 骨架化`（✅ 2026-11-04 试点）：`skills` / `mcp` / `behaviors` 三页已搬进 `pages/<id>/{page.html,page.css,page.js}`，`index.html` 里对应的 `<section>` 只留空容器；路由器 `hydratePage(page)` 首次进入时 fetch 片段 → 注入 → 按需插 `page.css` → `import('./pages/<id>/page.js')` → 调 `init()`，失败只在该 section 显示占位、不影响其它页。`page.css` 先留占位（这几页暂时完全复用公共样式）。之后又搬了纯静态的 `reference`（工具参考）：无接口请求、无事件绑定，`page.js` 只有一行空 `init()`——保留这个空实现是为了让「每页模块都有 `init()`」没有例外。之后又搬了 `access`（访问与安全）：它是**一页三卡**（白名单 / 安全拦截 / 访问令牌），为此立了「多卡片页」约定——宿主的 `<section data-page>` 用 `class="page-stack"`（`display:contents`），注入的卡片直接成为 `main` 的网格项，布局与搬之前逐像素一致（实测：白名单整行 1086px，安全/令牌各 532px 并排）。三个卡片的 `refreshWhitelist` / `loadSecurity` / `changeConsoleToken` 与四个按钮绑定、以及挂在令牌输入框后的「显示令牌」按钮，都随页面搬进 `pages/access/page.js`。之后又搬了 `social-v2`（二代仿真）：它是**单卡页**（原 section 自身就是那张 `.card`），所以宿主保留 `class="card span-all"`、`page.html` 只放内部内容，不额外包 wrapper；整页 23 个函数、27 个绑定（含语音库、工具日志、轻量记忆、唤醒状态）一并进了 `pages/social-v2/page.js`。顺手补了一个跨页的洞：`app.js` 里给表单补 `aria-label`、给主按钮补 `.primary`、给 `*Msg` 补 `role=status` 的那段只在启动时跑一次，片段页是之后才注入的、永远拿不到；现在抽成 `ui.js` 的 `applyPageA11y(root)`，由 `router.js` 在 `init()` 后对注入的 host 再调一次（`app.js` 自己那次保留，管首页与尚未搬的页）。之后又搬了 `social-v1`（一代仿真）与 `slang`（黑话词库）：两页都自带表单，`slang` 还带一个词库模态——**模态 DOM 留在共享宿主里**（`index.html` 的 `</main>` 之后、`#consoleToast` 之前），逻辑随页面模块走，多页复用同一个模态壳，不用每页各造一个。顺带补了全局刷新按钮的语义：`router.js` 新增 `refreshCurrentPage()`，`#refreshConsole` 现在会把「当前页注册的 refresher」一起跑；否则搬走的页在点全局刷新时会显得毫无反应。之后又搬了 `scheduler`（定时任务）：它和「定时静默」共用一套时区下拉，所以把 `tzOffset` / `tzOptionsHtml` / `tzSet` 抽成 `js/timezone.js` 两页共用（初始化改到 `init()` 里跑，不再受「必须早于 `schedEl`」的历史约束）。之后又搬了 `usage`（用量与花费）：第二个**多卡片页**——「令牌与花费」与「上下文压缩」两张卡一起进 `pages/usage/`，宿主改 `.page-stack` 后 index 里的 `section-compact` 消失；手写 SVG 图表、逐轮明细、清空账本、价目表与压缩模式单选随页面走，3 秒图表轮询与 60 秒压缩轮询都保留「仅本页可见时才跑」的判断。其余 5 页仍留在 `index.html`，按同一约定逐页迁移（下一步：人格与角色、调试与运维、模式、会话与审批、运行时）。之后又搬了 `persona`（人格与角色）：这一页的坑最密——section 里混着整块「仿真提示词」（DOM / JS / 绑定 / 启动刷新必须一起走）；`filterRoleSuggestions` 原是顶层 IIFE，改成 `init()` 内调用 `setupRoleSuggest()`；`#personaSourceRefresh` 的绑定原本在 `app.js` 最底部，最容易漏；全局 3 秒 `refresh()` 原本跨页写 `#roleText` / `#roleModeText`，不删会在片段未注入时 `null` 崩溃，现改为页内 `refreshPersonaStatus()`（`GET /api/status`）。代价是页头状态不再随全局轮询每 3 秒更新，只在进入页面、切页、保存/清除/新建/删除后刷新。其余 3 页仍留在 `index.html`（运行总览、插件、会话与审批）。之后又搬了 `operations`（调试与运维）：它是第三个**多卡片页**——测试发送 / 桥接控制 / 后台控制端引导三张卡一起进 `pages/operations/`，宿主改 `.page-stack`；四个按钮的绑定与校验文案随页面走，清空工作区不再直接调 `refreshSessions()`，改由全局指标轮询和会话页进入时刷新。之后又搬了 `sessions`（会话与审批）：会话映射 / 挂起审批与提问两张卡一起进 `pages/sessions/`，宿主改 `.page-stack`；`refreshSessions` / `refreshPending`、清除上下文按钮与 3 秒轮询随页面走。概览的 `#metricSessions` / `#metricPending` 与导航角标 `#pendingCount` 是跨页指标：会话页可见时由页面模块判空写入，其它页由 `app.js` 的 `refreshSessionMetrics()` 轮询补上，避免重复请求，也没有「元素不在就抛错」的路径。路由器顺手修了 `data-target` 指向未注入片段时滚动落空的问题（等 `hydratePage` 完成再滚）。其余 2 页仍留在 `index.html`（运行总览、插件）。
   - 配套改动：`src/bridge.js` 静态路由放行 `/console/pages/`（仍在鉴权之前，否则片段取不到）；`scripts/console-source.mjs` 增 `consolePageDirs()` 并把 `pages/*/{page.html,page.css,page.js}` 拼进源码视图；`console-ui-fixture.mjs` 按真实路径提供片段与页面模块；`test-console-static.mjs` 增 16 条片段断言。
   - `overview`（运行总览）是**六块一页**：摘要指标、运行模式、活动日志、发言上限、定时静默、DSH 模型。六块按原顺序搬进 `pages/overview/page.html`；宿主 `#section-overview` 用 `.page-stack` 放在 `.grid` 首个子元素，`#overviewSummary` 保留 `overview-summary span-all` 与 `data-page="overview"`，仍是网格首行（`page.css` 只补一条 `margin-bottom:0`，避免 24px margin 与 22px 网格 gap 叠加）。这一页保留一个**跨页例外**：页面模块管交互（模式切换、发言上限、静默排期、DSH 模型读写与首次加载），`app.js` 仍管状态刷新——`refresh()` 继续写摘要指标、活动日志与 `#statusText`，概览页首次进入/切回或写操作成功后用 `console:refresh-status` 事件请它补一次；所有只存在于片段的节点写入都判空，`refreshSessionMetrics()` 逻辑未动。另把 `router.js` 的 `[data-view]` 从启动时 `querySelectorAll` 直接绑定改为 document 级事件委托，否则片段里后注入的 `#metricSessions`/`#metricPending` 点不动（`data-target="section-pending"` 的跨页 hydrate 链路保持原样）。`app.js` 因此少 291 行（590 → 299）。
    - 顺带修掉的隐患：`app.js` 的搜索索引原来在启动时用 `section.querySelector('h2')` 硬取标题，空 section 会抛 `TypeError` 并中断整个入口脚本的后续初始化；现在改为「按需重建 + 跳过空 section + 未注入的片段页用页面表标题兜底」，保证「没打开过的页也能搜到」。
   - 真机验证（无头 Edge + CDP，3111）：三页都能注入并渲染（技能「共 1 个技能包」、MCP「桥接自带 3 个 MCP server」、管理行为「注册表 5 条内置 + 0 条插件」）；冷启动直开 `#mcp` 正常；`#behaviors` 刷新后仍在原页且内容重新注入；搜索「技能」能命中未打开过的页面并跳转；控制台零异常。
2. `3.2 组件层`（✅ 2026-11-05）：重复的模板与反馈写法收进 `js/components/`——`table.js` 的 `tableHtml(columns, rows)`（由 `ui.js` 的 `simpleTable` 迁出，表头宽度改走 `data-w` 属性，见 `components.css` 的 `th[data-w]`）、`message.js` 的 `setMsg(target, text, kind)`（把「设文本 + 设 `meta ok|err` 类」这一对动作收成一处，22 处调用点全部改用它）、`modal.js` 的 `openModal`/`closeModal`/`isModalOpen`/`wireModal`（统一 `.open` 类、`aria-hidden`、Esc 与点遮罩关闭；插件详情弹窗与黑话模态都改成它，后者因自带 Esc 焦点环传 `closeOnEscape: false`）。`ui.js` 只剩 toast、`esc`、tile 列表与 `applyPageA11y`；无调用方的 `renderTable` 一并删掉。`test-console-static` 增 12 条组件断言（文件存在、导出签名、页面改用 `tableHtml(`、全局不再有 `className = 'meta ok|err'`），真机探针验证「点开 / Esc 关 / 点遮罩关 / 黑话页注入」全部通过。
3. `3.3 样式分家`（第一步 ✅ 2026-11-04）：`css/tokens.css` 单独承载设计令牌（`:root` + `[data-theme="dark"]`）；页面私有规则回各自 `pages/<id>/page.css`——`overview` 的网格占位与窄屏覆盖、`usage` 的账本/进度条/SVG 图表与图例，公用样式里不再出现 `#section-*` 选择器。
   - 第二步（✅ 2026-11-04）：`app.css`（1810 行）按**连续区间**拆成 `css/base.css`（重置、排版、滚动条、按钮与表单基线，123 行）、`css/layout.css`（三容器外壳、侧栏、顶栏、主区、页面标题与指标条，343 行）、`css/components.css`（网格、卡片、表格、表单、弹窗、主题与各页细节，拆分时 1357 行，3.2/3.4 又加了组件类与 `th[data-w]` 规则，现 1386 行），`index.html` 按 `tokens → base → layout → components → utilities` 依次 `<link>`。拆分脚本先校验「三件按序拼接 === 原文件（逐字节）」再落盘，因此级联顺序与拆分前完全一致；实测样式规则总数 296 条不变、概览页关键几何不变（模式卡 `y=484 / w=1086`）。
   - 第三步（✅ 2026-11-04，内联样式收口）：HTML 里 **407 处内联 `style` 中的 388 处**换成 `css/utilities.css` 的 57 个工具类（`.u-w-80`、`.u-flex-1`、`.u-mt-8`、`.u-m-0`、`.u-flex-basis-220`、`.u-between`……），工具类只在「宽度 / flex / 外边距 / gap / 文字对齐」这几种纯静态属性上按声明值一一映射，不承载主题色与组件样式；剩下 19 处保留内联，全部是 JS 会切换 `display` 的元素（隐藏/展开），换类会与 `el.style.display` 打架。实测 `u-w-*` 的宽度、`u-flex-1` 的 `flex-grow`、`u-mt-*` 的外边距都按预期生效，概览/插件/定时任务三页几何与转换前一致、零异常。
   - 第四步（✅ 2026-11-05，CSP 收口）：剩下 19 处内联 `style` 与所有 `el.style.display` 全部搬走——表格列宽改 `data-w`（`components.css` 用 `th[data-w="…"]` 给宽度，`renderTable`/`simpleTable`/管理行为页表头同步）、显隐改 `hidden` 属性（`base.css` 的 `[hidden]{display:none!important}` 兜底）、内联主题脚本抽成 `js/theme-boot.js`（同步 `<script src>`，仍放样式表之前防闪白）、用量页进度条改 `data-pct` + `applyUsageBarWidths()` 用 CSSOM 写宽度。结果：HTML 与页面模块里 **0 处内联 style、0 处内联 script/style 块**，`src/http/security.mjs` 的 CSP 去掉两处 `'unsafe-inline'`。验证：`test-http-boundary` 7 pass（新断言 CSP 不含 `unsafe-inline`）、`test-console-static` 全过（新断言 0 内联 style + 模块语法用 `node --check`），浏览器探针深链/切页/搜索候选/表格列宽全部正常、`securitypolicyviolation` 与异常均为空。
4. `3.4 收尾`：`favicon.svg` + `<link rel="icon">`（✅ 2026-11-04，同日晚些按反馈改版：图标不画背景块，直接复用侧栏品牌标记的字形——`<text>q</text>` + `<text>↗</text>`，与侧栏同一套字体栈与字重，颜色走 `@media (prefers-color-scheme)` 跟随系统深浅色；控制中心 `public/control-center/favicon.svg` 与它**逐字节相同**，两处图标只有一个来源；`index.html` 已声明 `<link rel="icon" type="image/svg+xml">`，`/console/img/` 走鉴权前的静态放行，实测无令牌 200、`image/svg+xml`、580 字节；静态测试 8 条断言兜住「同形、无背景、跟随主题、两处一致」）。CSP 去掉 `unsafe-inline` 已于 2026-11-05 完成（见 3.3 第四步）；`scripts/console-source.mjs` 与 `console-ui-fixture.mjs` 的拼接/分发已在 3.1 完成。
5. `3.5 控制中心`（✅ 2026-11-04）：`public/control-center.html` 已按**B 档**拆成 `public/control-center/{index.html,app.css,app.js}`，**不并入** `pages/`；控制中心样式独立（`tokens.css` 共享为后续项）。详见本节「3.5 启动器控制中心」。
6. `浏览器回归`（✅ 2026-11-05）：`scripts/test-console-ui.mjs` 在本机真正跑通（此前因缺 `playwright` 整段跳过）。夹具递归提供 `js/**`、补 `/console/img|fonts` 与四个只读接口桩；`reveal()` 改成「先按 id 快照切页再定位」；手机 390px 横向溢出与「进页重拉配置冲掉草稿」两个缺陷修复；契约基线用 `--accept-contracts` 有意重录（`level` / `apply` 两个新字段）。**23/23 全绿**，连跑两次稳定。用法与重录规则见 `docs/guides/CONSOLE-UI-TESTING.md`。

- 测试与夹具影响（已在 3.1 落地）：`console-source.mjs` 拼 index + css + js + `pages/*/{html,css,js}`；`console-ui-fixture.mjs` 按路径返回 `pages/<id>/page.{html,css,js}`；`test-console-static.mjs` 改为断言片段存在、index 对应 section 为空、路由器有 `hydratePage`。
- **代价**：每页首次进入多 1 次片段请求（约 2–6 KB，浏览器缓存 + 内存 Map 兜底）；拆 15 页 + 2036 行 CSS 预计 6–8 个提交，每步保持 77/80 基线；迁移期页面结构会动，需逐页截图比对。
- **明确不做**：引入 React/Vue/Svelte 运行时；引入 bundler 与构建产物目录；组件级 scoped CSS 编译；把插件 UI 塞进宿主文档（插件 UI 仍走 iframe 沙箱，见 HTTP_BOUNDARY §5）。

**3.5 启动器控制中心（B 档：独立目录化，不并入 console）**

原 `public/control-center.html`（1280 行 / 97 KB，单个 `<style>` + 单个 `<script>`，0 个 `<link>`）是**启动器**页面，由 `src/launcher/control-center.mjs` 独立进程在 `127.0.0.1:3099` 托管（`PAGE_FILE` 见该文件 `:49`），用自己的 `state/control-center-token`（经地址 `#t=` 片段传给页面）与自己的 `state/control-center.json`/`.lock`。它负责启动/停止桥接、看四路日志、NapCat 扫码、SnowLuma 安装与迁移，因此**必须在桥接未运行或已崩溃时可用**。现已拆成 `public/control-center/{index.html,app.css,app.js}`（见下「已完成」）。

- 不并入 `pages/` 的四条硬理由：① 可用性边界相反（console 以桥接在跑为前提）；② 令牌体系不同（`x-console-token` vs 控制中心令牌 + `#t=`）；③ 宿主不同（launcher 没有 `/console/*` 静态路由，并进去等于复制一份 `src/http/static.mjs` 守卫）；④ 打包与测试按单文件引用它（`build-{linux-service,mac-app,release}.mjs`；`test-control-center` / `test-napcat-manage` / `test-platform` / `test-linux-support` / `test-mac-app`）。
- 目标结构（与 console 同一套目录约定，但独立托管）：
  ```
  public/
    console/{index.html,favicon.svg,app/styles/tokens.css,pages/<id>/…}
    control-center/{index.html,app.css,app.js}   ← 原 control-center.html 拆三件
  ```
  `tokens.css` 是唯一色板来源，两个页面最终都 `<link>` 它（控制中心目前仍用自带 `app.css`，色值对齐在后续项）；控制中心其余样式留 `public/control-center/app.css`，不跨目录 import console 的页面/组件样式。
- launcher 改动（已完成）：`PAGE_FILE` 指向 `public/control-center/index.html`；新增 GET `/control-center/*` 静态路由，复用 `resolveStaticPath`（前缀锁死 `/control-center/`）与 `serveStaticFile`，穿越一律 404；其余路由与令牌逻辑不动；缺文件时返回「控制中心页面缺失：public/control-center/index.html」。
- 影响面清单（实际落地）：
  1. `src/launcher/control-center.mjs`：`PAGE_FILE` 改目录内 index + 静态服务 + 缺文件兜底；
  2. 打包：`build-release.mjs` 用 `git ls-files` 收文件，新目录随提交自动进包，**无需改路径**；
  3. 测试：`test-control-center` / `test-napcat-manage` / `test-platform` / `test-linux-support` 的读取改为「`index.html` + `'\n'` + `app.js`」拼接（保留对 DOM 与脚本的原有断言），共 8 处；
  4. 文档：`docs/FOLDER_MAP.md`、本文件、`interface-platform/docs/MILESTONES.md`、`CHANGELOG.md`；
  5. `CHANGELOG.md` 一条（见下）。
- 验收（实测）：`GET /` 200 `text/html` 25073 字节；`/control-center/app.css` 200 12287；`/control-center/app.js` 200 60543；`/control-center/favicon.svg` 200 915；`/control-center/../../state/console-token` **404**；无头 Edge 打开页面（`#t=` 令牌）零异常，`app.css` 129 条规则生效、`#bridgeStart`/`#consoleOpen`/`#tab-platform` 均在；`test-napcat-manage` 13/13、`test-platform` 8/8、`test-linux-support` 9/9、`test-control-center` 20/21（失败项是改动前就存在的第 20 条 SnowLuma 迁移用例）。
- 不做：把启动/修复能力搬进 console；给 launcher 引入构建步骤；把控制中心的 token 与 console token 合并。
- **顺序**：放在 3.1–3.4 之后（3.5），因为「唯一色板 `tokens.css`」要等 3.3 样式分家落地后才存在。

**验收**：15 个页面全部从 `pages/<id>/` 加载（HTML/CSS/JS 同目录）；`index.html` ≤ 150 行；`favicon.svg` 在浏览器标签生效；刷新保页、深链、面包屑、搜索层级全部不回归；CSP 响应头无 `unsafe-inline`；控制中心拆成 `public/control-center/` 三件并在桥接停止时可用；`npm run test:console-static` 全过。

### 8.8 `bridge.js` 按接缝抽层（进行中：第 1–3 步已完成，第 3 步只做了 `/reset`）

现状：`src/bridge.js` 14.6k 行，HTTP 路由、业务规则、上游适配混在一个请求处理函数体里。**不重写**，按接缝逐步抽，每步一个提交、每次保持 `test-integration-v030` 全绿。

| 步骤 | 抽什么 | 落到哪 | 状态 | 风险 |
| --- | --- | --- | --- | --- |
| 1 | 安全头与静态资源守卫、CSP | `src/http/{security,static}.mjs` | ✅ 2026-11-04（路由表/鉴权中间件仍在 `bridge.js`） | 低 |
| 2 | 五条内置命令的壳与 `/api/commands` 响应 | `src/commands/{registry,builtin,payload}.mjs` | ✅ 2026-11-05（`/reset` 执行体仍在 `bridge.js`，留给第 3 步） | 低 |
| 3 | 会话/模式状态（`state.sessions`、模式闸门、审批、`resetSession`） | `src/session/*` | ✅ 2026-11-05：`resetSession` 清理序列、**模式闸门**（`mode-gate.mjs`）、**`sessions.json` 读写**（`store.mjs`）与**会话映射表**（`registry.mjs`）全部搬出，`bridge.js` 只剩薄包装与 `sessionPolicy()` 的指纹拼装（依赖 `modePreset` / `closedAgentPlan`，属于模式层） | 中 |
| 4 | 上游适配（DSH / SnowLuma / MCP host） | `src/upstream/*` | 🟡 2026-11-05：**SnowLuma 接收链路健康**（`upstream/snowluma-health.mjs`）已搬——「自报坏」与「静默」两个故障面、边沿告警、`get_status` 兜底轮询都可离线测；DSH 客户端（`dsh-client.js`）与 MCP host（`mcp-host-server.js`）本就在独立模块，bridge 里剩的是接线与重连编排 | 中 |

约定：

- **入口不动**：`package.json` 的 `start` 仍是 `node src/bridge.js`，`src/bridge.js` 保留为组装根（读配置 → 建依赖 → 注册路由 → 启动），最终收敛到 500 行量级；
- 每一抽都必须「行为零变化」，只搬代码不改语义；语义要改的另开提交；
- 抽完 HTTP 层后新增 `scripts/test-http-boundary.mjs`（穿越、符号链接、未启用 404、未知端点 404），并入 `test:audit`；
- 抽命令层后新增 `src/commands/builtin.mjs` 的 deps 窄口（`send`/`session`/`acl`/`role`/`log`），让内置命令可以用假实现单测，不必起桥接；
- 抽会话层时，`resetSession` 的清理由 `deps` 显式登记每一个桶：新增缓存必须同步登记，漏了 `scripts/test-session-reset.mjs` 会立刻红——这是这一步唯一比「留在 bridge.js 里」更值钱的地方。

**已完成的三步**：

- 第 1 步（2026-11-04，`cb2de96` / `3b8534c` / `43378be`）：`src/http/security.mjs`（安全头 + CSP 单一来源）、`src/http/static.mjs`（解码一次、`path.resolve` + `path.relative`、拒绝 `..`/盘符/ADS/反斜杠/符号链接/白名单外扩展名，失败统一 404）、`scripts/test-http-boundary.mjs`；VM 夹具补 `SECURITY_HEADERS`。
- 第 2 步（2026-11-05）：`src/commands/builtin.mjs` 承载 `/reset` `/status` `/role` `/silent` `/active` 五条壳与文案；`src/commands/payload.mjs` 组装 `/api/commands`；`bridge.js` 删掉 `commandStatus`/`commandRole`/两条旧 if 分支与 5 条内联 `register`。`src/bridge.js` 14745 → 14686 行（净 −59）。
- 第 3 步（2026-11-05，A′）：`src/session/reset.mjs` 承接 `/reset` 的完整清理序列（删挂账 → 清 30 项内存态 → 落盘 → 停 DSH → 归档 → 回执），`bridge.js` 只留惰性拼 `deps` 的登记段；`sessionEpoch` 通过 `bumpEpoch` 回调传入。`scripts/test-session-reset.mjs` 4 条用例逐桶断言。行数上这一步几乎持平（−58 行逻辑、+64 行 deps 登记，`bridge.js` 14694 行）：换来的是清理序列可脱离桥接单测、漏清会被测试挡住。
- 第 3 步续（2026-11-05）：`src/session/mode-gate.mjs` 收走 `allowed` / `modeAllowed` / `isSessionAllowedInCurrentMode`——它们在 `bridge.js` 里各有 7 / 18 / 多处调用，「群聊在 chat 模式下能不能进」这种判断以前只能起整个桥接才能验证。`bridge.js` 只留 `isSessionAllowedInCurrentMode(key)` 薄包装（`sessionAllowed(key, cfg, currentMode)`），`acl: { allowed }` 的接线不变。新增 `scripts/test-session-mode-gate.mjs` 6 条（白名单空表语义、单复数键名、deny 优先、closed-agent 只看 owner 私聊、三种聊天模式、key 形态校验）。VM 夹具补 `allowed` / `modeAllowed` / `sessionAllowed` 三个符号——**夹具剥 import，漏一个就是 `ReferenceError` 把整个用例打红**（这次又踩到一次）。
- 第 3 步续二（2026-11-05）：`src/session/store.mjs` 收走 `sessions.json` 的读写，`bridge.js` 的 `loadState()` / `saveState()` 变成两行调用。这一步搬的不是「几行 IO」，而是两条安全不变量：**读失败或 JSON 损坏时 `writable:false`，此后任何一次 `saveState()` 都不得回写**（早期实现读到坏文件当空状态处理，紧接着的原子写会把空映射永久落盘）；**老文件缺 `sessionPolicies` / `dormantSessions` 就地补齐**，不因少一个键把整份判成不可用。`scripts/test-session-store.mjs` 8 条覆盖：ENOENT、BOM、字段补齐、`sessionPolicies` 数组重置、`normalizeDormant` 注入、损坏 JSON、非 ENOENT 读错、`writable:false` 时 save 既不写也不动原文件。VM 夹具补 `loadSessionState` / `saveSessionState`（同上，剥 import 必红）。

- 第 3 步收尾（2026-11-05）：`src/session/registry.mjs` 收走 `state.sessions` / `state.sessionPolicies` 的全部直接读写（46 处：2 处绑定、3 处删除、7 处遍历、其余读取）。搬之前这两张表必须**成对**维护——只写映射不写指纹会让 `isCurrentSession()` 永远判旧、会话被无限重建；只删映射不删指纹则下次同 id 会被误当新会话——这条规则只存在于注释里。现在 `bindSession()` 写两格、`unbind()` 删两格、`isCurrent()` 一次性校验「仍被允许 + 映射没换 + 指纹没变」。注册表接的是 `() => state` 的 getter 而不是 state 对象：`loadState()` 会把 `state` 整体替换，闭包里的旧引用会立刻过期。`scripts/test-session-registry.mjs` 7 条，含「state 被替换后注册表跟着走」这条回归。`sessionPolicy()` 本体留在 bridge——它拼的是 `modePreset()` / `closedAgentPlan()` 的口径，属于模式层，不在会话层重复实现。

**验收**：`test-integration-v030` 31/31 不减；`test:audit` 不差于三项既有失败（`test-preset-local-tools` #5、`test-control-center` #20、`test-mac-app` #2）；`src/bridge.js` 行数逐阶段下降并在 CHANGELOG 记录。


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
