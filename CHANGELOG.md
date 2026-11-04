# CHANGELOG

本仓库（qq-bridge-nexus，基于上游 fork）基于 [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge) `v0.2.0-r3`，随后同步到 [h-D-ACE/dsh-qq](https://github.com/h-D-ACE/dsh-qq) `v1.1.2`。
上游更早的版本历史见 [docs/guides/DSH_020_ADAPTATION.md](docs/guides/DSH_020_ADAPTATION.md) 与上游 Release 页面。

## 未发布

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
- `plugins/` 成为桥接运行时插件目录，内核在 `src/plugins/`（`manifest` / `config` / `audit` / `persona` / `host-api` / `kernel`）；原先给 DSH 加载的两个 bundle 改名到 `dsh-bundles/`，避免「插件」一词指两样东西。
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

## v1.1.2 —— 2026-10-29

**按会话（群 / 私聊）分别设置人格卡**、**断线期间错过的消息恢复后补收**。
发布说明：[docs/release/RELEASE_NOTES_v1.1.2.md](docs/release/RELEASE_NOTES_v1.1.2.md)。

### 升级注意（从 v1.1.1）
- 沿用 `config.json`、`state/`、`interface-platform/state/`；执行 `npm ci`，重启控制中心（桥接要重启才会用上新代码）。
- **不用重启 DSH、不用重跑 `setup-dsh.mjs`**：preset 和 MCP 工具都没变（MCP 服务只改了版本号，DSH 下次重启时自然换上）。
- **QQ 命令 `/role` 的行为变了**：以前在任何地方发都是切全局人格，现在只改发命令的那个会话。全局人格改在控制台「切换当前启用的人格」。
- `state/current-role.json` 原样可用，不用迁移；没有单独设置人格时，文件格式和以前完全一样。
- 断线补收默认开着（只在二代仿真里补）；新的状态文件 `state/upstream-seen.json` 会自动创建。
- `off` / `clear` / `default` 成了保留名，已有同名人格的（极少见）请先改名。

### 新功能：按会话（群 / 私聊）分别设置人格卡
- 以前角色卡是全局的，所有群和私聊共用一张，做不到「A 群用傲娇助手、B 群用小鲸鱼、C 群不挂卡」（来自 issue）。
- `state/current-role.json` 增加可选的 `byKey`：`{ "role": "小鲸鱼", "mode": "active", "byKey": { "group:<群号>": "傲娇助手", "group:<群号>": null } }`。
  - 会话不在 `byKey` 里 → 用全局 `role`。**老状态文件原样可用，不用迁移**；没有单独设置时写回去也还是老格式。
  - 值为 `null` → 这个会话不挂任何角色卡（不是回落到全局）。
  - 人格正文仍然只来自 `roles/<名字>.md`，不新增文件格式。手动静默（`mode`）仍是全局的。
- 控制台「人格与角色 → 按会话设置人格」：每个群 / 私聊选「跟随全局默认 / 不挂角色卡 / 某张卡」，也可以直接填会话添加；引用的人格文件不存在时标红。
  有自己的一组生效方式（下次唤醒 / 立即），选「立即」只唤醒保存的那一个会话；进入页面和停在页面时每 15 秒自动刷新，改了没保存的行标「未保存」，刷新时保留选择。
- **QQ 命令 `/role` 改为只对当前会话生效**（以前是全局切换）：
  - `/role 名字`：本会话换卡；`/role off`（或 `clear`）：本会话不挂卡；`/role default`：回到全局默认；`/role`：看本会话现在用哪张。
  - 全局默认人格只在控制台改。`/status` 显示的也是本会话的角色。
  - 仍然只有管理员能用。
- 二代仿真的读卡刷新按会话算指纹：给某个群换卡、或改了某张卡的内容，只有用这张卡的会话会在下一次唤醒收到新卡；选「立即」也只唤醒这些会话。
  `qq_get_prompt`、唤醒提示里的【当前角色】、一代 / 聊天模式的角色提示都按会话取。
- 人格改名时，单独用它的会话跟着改名；人格被删时，单独用它的会话改成「不挂卡」（不会突然换成全局那张别的卡）。
- `off` / `clear` / `default` 成为保留名，不能用作人格名。
- 安全：全局 `role` 和 `byKey` 的值走同一条校验（清洗人格名 + 解析后必须在 `roles/` 里），会话 key 只接受规范化的 `group:<正整数>` / `private:<正整数>`，别名和非法 key 忽略；
  新接口 `POST /api/roles/assign` 只开给控制台，AI 的令牌一律拒绝，AI 依然没有任何能改人格的工具。
- 新模块 `src/role-per-key.js`，新测试 `scripts/test-role-per-key.mjs`。

### 新功能：断线期间错过的消息，恢复后补收
- 实测：Mac 合盖睡眠期间（约 36 分钟），群里有人 @ 了 AI 两次；NapCat 醒来后没有把这些消息当作事件推给桥接，AI 一直不知道，看起来就是「@ 了不回」。
  这些消息用 OneBot 的历史消息接口都能拉到。
- 新模块 `src/backfill.js`：桥接发现两次事件包隔了超过 2 分钟（心跳 30 秒一次），就在连接恢复 10 秒后，对当前模式允许的群和私聊各拉一次最近的历史消息，
  把断线这段时间错过的补收进未读（记原始发送时间、带 `backfill` 标记，按消息 ID 去重）；有 @ / 私聊等直接找 AI 的照常排唤醒，唤醒提示最前面说明「这是断线期间错过、刚补收的」。
  最后一次收到事件包的时间每分钟写进 `state/upstream-seen.json`，桥接自己停过 / 睡过也能发现断档。
- 安全：补收的消息**不执行任何命令、审批、确认码、角色切换**；管理员私聊里补收到的命令只私聊提醒「没有执行，需要的话重发」（确认码打码）。
- 超过 6 小时的消息只记下不唤醒；每个会话最多补 50 条；只在二代仿真里补收，其它模式只在活动记录里提醒可能错过了。配置 `snowluma.backfill`。
- 拉历史失败时（实测：Mac 半睡半醒、连接刚通而 NapCat 实例还没起来）不会记成「没有错过」：记下这个会话最早还没补上的时间，一分钟后重试（最多 5 次）；
  之后再断线恢复，这个会话也从更早的时间一起补，中间那段不会漏。
- 实测（macOS + NapCat）：合盖睡眠后自动补收一个群 12 条，其中 5 条命令类消息没有执行；AI 被唤醒后看过、判断不需要插话。
- 补不回来的：拍一拍、入群等通知事件；断线期间被撤回的消息。
- 新测试 `scripts/test-backfill.mjs`。

### 其它
- `scripts/test-console.mjs` 连的是**正在运行的真实桥接**（会临时切换人格、改白名单、真实发一条测试消息），以前误跑就会动到线上；
  现在不加 `--live` 时直接退出并说明（`npm run test-console -- --live`）。它本来就不在 `test:audit` 里。

## v1.1.1 —— 2026-10-27

省钱与易用性版本：**长会话自动压缩**（阈值在控制台可调，也可以交给 DSH）、**不常变的大块只在变化时注入**；**会话令牌抄错能自己恢复**；
定时静默新增「只在被 @ 或私聊时唤醒」、控制台「恢复默认人格」、总览页直接改发言上限；新增一键补表情说明、管理员私聊搜图发图（默认关）。
发布说明：[docs/release/RELEASE_NOTES_v1.1.1.md](docs/release/RELEASE_NOTES_v1.1.1.md)。

### 升级注意（从 v1.1.0）
- 沿用 `config.json`、`state/`、`interface-platform/state/`；执行 `npm ci`，重启控制中心（桥接和接口平台都要重启才会用上新代码）。
- **要重启一次 DSH**：MCP 服务的版本号变了，搜图的三个新工具也由 DSH 启动的 MCP 服务注册。preset 没有变化，不需要重跑 `setup-dsh.mjs`。
- **自动压缩默认开着（30 万 token）**：升级后，已经很长的二代会话会在下一轮结束、空闲 20 秒后压缩一次（实测一次 12 秒左右）。
  想保持原来的行为，在「令牌与花费 → 上下文压缩」里选「交给 DSH 自己压缩」。
- 升级后第一次唤醒，黑话表、表情块会各完整给一次（之前没有记录），之后只在变化时再给。
- 新增的状态文件（都在 `state/` 里）：`prompt-blocks.json`（只存指纹）、`sticker-describe-session.json`、`role-backups/`（恢复默认人格时的备份）。没有旧数据格式变化。
- 新配置字段都有默认值，不用改 `config.json`：`socialV2.compact`、`socialV2.tools.webImage`（默认关）、定时静默的 `options.directWakes`（默认关）。

### 改进：B 站评论区反馈的几处易用性问题
- **定时静默新增「只在被 @ 或私聊时唤醒」档位**：静默期间 AI 的唤醒改成三选一——全部停止 / 只在被 @ 或私聊时唤醒 / 照常唤醒只拦往外发。
  选中间这档时，有人 @ AI、引用回复 AI 或私聊 AI，这个群 / 私聊照常放行 10 分钟（能接着聊几句），其余会话和主动冒泡、睡醒等唤醒照样停：不会漏掉找它的人，大头的花费照样省下。
  配置字段 `options.directWakes`（默认关，原来的行为不变）。
- **控制台「恢复默认人格」**：人格页新增一组按钮，列出发布包自带的默认人格是「和原版一样 / 改过 / 已被删除」，一键放回原版；改过的那份先备份到 `state/role-backups/`（每个人格最多留 10 份）。
  恢复当前启用的人格时按「保存当前启用的人格后」的生效方式处理；恢复不会自动切换人格。原版副本放在 `assets/default-roles/`。接口 `GET /api/roles/defaults`、`POST /api/roles/restore-default`（仅控制台）。
- **发言上限放到总览页**：总览页新增「发言上限」卡片，直接改每分钟 / 每小时最多发几条（和「二代仿真 → 发送限制」里是同一组数字）；
  被上限拦下时日志和活动记录写明「发言达到上限，可在控制台调」（同一会话 5 分钟只记一次），卡片显示最近 24 小时被拦了几次；AI 收到的提示也说明这是桥接的上限、不是 QQ 的限制。
- **上下文压缩可选、阈值可调**：「令牌与花费」页新增「上下文压缩」卡片——选「提前压缩」并填几万 token（5～80，默认 30），或选「交给 DSH 自己压缩」（约 80 万）；
  卡片里列出每个会话上一步读了多少。接口 `GET/POST /api/compact/config`（仅控制台），写进 `config.json` 的 `socialV2.compact`。`thresholdTokens` 上限从 90 万改为 80 万（再往上 DSH 自己会先压）。
- 新模块 `src/default-roles.js`；新测试 `scripts/test-default-roles.mjs`、`scripts/test-send-limit-console.mjs`；`test-silence-schedule.mjs`、`test-auto-compact.mjs` 补了对应用例。

### 修复：会话令牌抄错后工具调用一直失败、群里冒出「回复被拦截」
- 实测：群 A 的 AI 把 48 位会话令牌抄错了一位，之后一直照着自己写过的错版本抄，工具调用全被「令牌无效」拒绝，持续将近两天；
  它在内部输出里提到令牌，又触发了审计——而二代仿真里 AI 的文字本来就不会转发，桥接却照样往群里发了一条「本条回复因疑似包含敏感信息…被拦截」。
- 二代仿真里被审计拦下的内部输出只记日志，**不再往群里发拦截通知**（其它模式照旧）。
- 新模块 `src/agent-token-guard.js`：令牌只差 1～2 位时判定为「抄错」，照样拒绝，但提示「抄错了几位、请从最新一条唤醒提示逐字复制」（不泄露正确令牌）；
  下一次唤醒在提示最前面加【令牌提醒】；30 分钟内连错 3 次自动换一个全新令牌（不动 DSH 会话和记忆，旧令牌立即失效）。
- 控制台接口 `POST /api/socialV2/rotate-token`：手动给某个二代会话换令牌（仅控制台，AI 调用一律拒绝）。

### 省钱：不常变的大块只在变化时注入；会话太长时自动压缩
- 实测：二代会话一直不重建，群 A 每一步要读 50～67 万 token，缓存命中率 99%，但光「命中缓存」一项就占花费三分之二；DSH 自带的自动压缩要到上下文窗口的 80%（约 80 万）才触发。
- 新模块 `src/prompt-blocks.js`：黑话表、表情包策略与常用表情按「会话 + 内容指纹」只在变化时完整注入，没变时只放一行「和上次一样」并说明用哪个工具查；
  满 30 次唤醒或 12 小时、换了会话、压缩过上下文后重新完整给一次。群规则照旧每次都注入。新状态文件 `state/prompt-blocks.json`（只存指纹）。
- 新模块 `src/auto-compact.js`：某个二代会话最近一步读的 token 超过阈值（默认 30 万），这一轮结束、会话空闲后执行一次 DSH 的 `/compact`
  （较早的历史换成摘要，近期对话原样保留）；同一会话两次至少隔 2 小时；压缩后下一次唤醒重新完整给黑话表、表情块和角色卡。配置 `socialV2.compact`（`enabled` / `thresholdTokens` / `cooldownMinutes`）。
- 控制台接口 `POST /api/session/compact`：手动压缩某个会话（仅控制台）。实测 DSH 0.2.1-rc.2 上 `/compact` 可用：群 B 一次压缩了 362 条历史（约 8.9 万 token），用时 12 秒。
  注意 DSH 会原样保留最近约 16% 窗口的对话，所以对本来不长的会话效果有限，主要针对几十万 token 的长会话。
- 新测试 `scripts/test-agent-token-guard.mjs`、`test-prompt-blocks.mjs`、`test-auto-compact.mjs`。

### 新功能：管理员私聊里搜图并发送（默认关闭）
- 「找一张 xxx 的图发我」：二代仿真里的 AI 在**管理员私聊**中可以用三个新工具——`qq_search_images`（搜图，只拿到编号、标题和来源网站，拿不到网址）、
  `qq_preview_image`（看缩略图，图进入视觉上下文）、`qq_send_web_image`（只能发**本次搜索里看过**的候选）。
- 安全：搜索走 Bing 图片搜索并加严格安全搜索（`adlt=strict`），Bing 标为不适宜的缩略图直接丢弃；图片由桥接用安全下载取（DNS 固定、逐跳校验、只连公网、限大小与像素、校验文件头），
  AI 填不了任意网址或本地路径；只放行二代仿真 + 管理员私聊 + 有效会话令牌，群里和别的私聊一律拒绝；模型不能看图时不能预览，也就不能发；搜索每小时 20 次、发送每小时 10 次；静默时不发。
- 网关回执超时（NapCat 常见）按「结果未知」处理：提示 AI 先问管理员收到没有，不要马上重发。
- 搜索地址依次尝试：Bing 结果页有时跳到 www.bing.com 后只返回不带结果的骨架页（同一个词前后两次也会一次有一次没有），没解析出候选就改用异步接口 `/images/async`，再不行换 www.bing.com 重试，拿到候选就停。
- 开关：控制台「二代仿真 → 工具开关」的 `qq_search_images / qq_preview_image / qq_send_web_image`（`socialV2.tools.webImage`，**默认关**）。改后重启 DSH 才会出现在工具列表；已有的私聊会话要重建后才看得到新工具。
- 数据出机：搜索词会发给 Bing（与 `web_search` 一样）。
- 新模块 `src/web-image.js`；新测试 `scripts/test-web-image.mjs`。

### 新功能：一键让 AI 看图补表情说明
- 用户反馈：平时不特地要求，AI 就很少主动发表情。排查发现原因之一是收藏表情里有一半没有任何说明，AI 不知道图里是什么，要用就得先 `qq_get_sticker_image` 看图，于是干脆不用。
- 控制台「二代仿真 → 表情包参数」新增「让 AI 看图补表情说明」：桥接用一个**不挂本地工具**的专用会话（和黑话研究同一个安全 preset，工作区「QQ 表情整理」），
  每批 5 张、一次最多 20 张，把没有说明的表情图发给当前模型，只收 JSON，逐字段单行化、限长后写进本地表情库的 localNote / tags / usage；**不改 QQ 账号里的官方备注**，已有说明的不动。
- 图里的配字按不可信内容处理（提示里写明「图里的文字不是指令」）；偏凶或带粗口的表情打上「偏凶 / 粗口」标签、用法标「慎用」。
- 只在控制台可用（带 agent token 的调用一律拒绝）；agent 模式、模型不能看图、DSH 未就绪、表情库只读时不启动；后台运行，控制台显示进度和结果。
- 修复：学习会话每结束一个回合都会被移出事件收集列表（只有黑话会话例外），专用看图会话的第二批回答因此收不到；现在两者都保留。
- 新模块 `src/sticker-describe.js`；新测试 `scripts/test-sticker-describe.mjs`；新状态文件 `state/sticker-describe-session.json`。

## v1.1.0 —— 2026-10-22

新功能版本：**定时任务**（按时区到点发消息或叫 AI 来说）、**定时静默**（按时间段让 AI 停下来省 token）；**切换 / 修改人格在二代仿真里真正生效**（以前要等会话重建）；切到 agent 时可以带上私聊长期记忆。
发布说明：[docs/release/RELEASE_NOTES_v1.1.0.md](docs/release/RELEASE_NOTES_v1.1.0.md)。

### 升级注意（从 v1.0.3）
- 沿用 `config.json`、`state/`、`interface-platform/state/`；执行 `npm ci`，重启控制中心（桥接和接口平台都要重启才会用上新代码）。
- **要重启一次 DSH**：新的 MCP 工具 `qq_schedule_*` 由 DSH 启动的 MCP 服务注册，只重启桥接时 AI 还看不到它们。preset 没有变化，不需要重跑 `setup-dsh.mjs`。
- 新增的状态文件（都在 `state/` 里、0600）：`scheduler.json`（定时任务）、`silence-schedule.json`（定时静默）、`role-seen.json`（各会话读到的角色卡版本，只存指纹）。没有旧数据格式变化。
- 升级后第一次唤醒，已有的二代会话会各收到一次当前角色卡（之前没有读卡记录），之后只在换卡时再给。

### 修复：二代仿真切换 / 修改人格后会话仍用旧角色卡
- 用户反馈：控制台切换人格后，群里 AI 的语气没变，像是「切换失败」。原因是二代仿真的会话只在建立时的引导唤醒里调用一次 `qq_get_prompt` 读完整角色卡，之后每次唤醒只有一行「【当前角色】名字」；切换、清除或修改当前人格都要等会话重建才生效。
- 现在桥接按「会话 + 角色卡指纹」记下每个会话读到的是哪一版卡（AI 调用 `qq_get_prompt`，或唤醒提示带着新卡被 DSH 接受时记下；只存指纹，不存内容）。
  指纹对不上时，下一次唤醒把新卡全文放在提示最前面，并说明旧卡作废；记忆、群规则和会话都不动。引导唤醒不重复给。
- 控制台「人格与角色 → 切换当前启用的人格」新增生效方式：**下次唤醒时重新读卡**（默认）/ **立即切换**（马上给还没读到新卡的会话各安排一次 `roleRefresh` 唤醒；已读到的跳过，定时静默中的等静默结束）。切换后显示有几个会话会读到新卡。
- 「编辑人格提示词」的保存按钮下方也有同样的生效方式（只对当前启用的人格起作用；编辑其它人格不影响任何会话）。两处选项各管各的按钮，两处都点也只会让每个会话读一次：已读到新卡的会话自动跳过，还在合并窗口里的读卡唤醒不会重复排。
- 升级后第一次唤醒，已有的二代会话会各收到一次当前角色卡（之前没有读卡记录）。
- 聊天模式 / 一代仿真每条消息都注入角色卡，本来就立即生效，不受影响。`roles/README.md` 里「下一条消息即生效」的说法按模式分开写清楚。
- 新模块 `src/role-refresh.js`；新测试 `scripts/test-role-refresh.mjs`。

### 新功能：定时静默（运行总览 → 静默开关）
- 按时间段自动让 AI 停下来省 token：多个时间段，各带开关；哪些天 = 每天 / 工作日 / 周末 / 自选（可跳过法定节假日）；跨午夜以开始那天为准；带 UTC 偏移的时区下拉。
  说明见 [docs/guides/SILENCE.md](docs/guides/SILENCE.md)。
- 「一键填入 DeepSeek 高峰时段」取自价目表（北京时间工作日 09:00–12:00、14:00–18:00，跳过节假日），不重复添加。
- 静默期间默认：**停止一切唤醒**（原来的手动静默只拦发送、AI 仍被定时唤醒去思考，照样花钱）、群消息照样记进未读、结束时给被直接找过的会话补一次唤醒、
  定时任务「叫 AI 来说」暂停（任务可单独设「静默时段内：照常执行」，预览会标出会跳过的那几次）、固定文字照发、管理员私聊不受影响（可勾选一起静默）。
- 手动开关优先；定时静默期间点「恢复正常」= 这一段临时恢复，下一段照常。`/api/status` 带上静默来源，卡片显示「静默中 · 定时（名称），到 HH:mm」。
- 静默开关卡片改成整行宽的普通布局（原来的紧凑两栏会把新面板挤在一栏里）。
- 定时任务页面的「群消息免打扰」改名为「定时任务免打扰」，并注明只拦定时任务发往群的消息、不影响 AI 平时被 @ 时回复。
- 新模块 `src/silence-schedule.js`；新测试 `scripts/test-silence-schedule.mjs`；控制台离线夹具接入真实的静默模块。

### 改进：切到 agent 时可以带上私聊长期记忆
- 用户反馈：切到 agent L2 后「没有 qq-chat-v2 的记忆」。交接原本只带最近的私聊往来；现在可以把二代仿真里 AI 在管理员私聊记下的话题 / 想说的话 / 印象一并交接给 agent（最多 1500 字，逐行脱敏；只取管理员私聊，不含任何群）。
- 开关在控制台「二代仿真 → 工具开关」的「切到 agent 时带上私聊长期记忆」（`socialV2.tools.handoverMemory`，默认开）。同一处补上了定时任务工具 `qq_schedule_*` 的开关。
- 文档补充：桥接重启时 agent 会话按安全规则回落归档；交接记录从升级到 v1.0.3 后才开始记。
- `test-mode-handover.mjs` 新增 ⑥。

### 新功能：定时任务（第一阶段）
- 桥接控制台「聊天行为」下新增「定时任务」页面：总开关、默认时区（出厂北京时间）、AI 登记开关、可改的安全限制（留空恢复默认）、任务列表（启用 / 试发 / 编辑 / 删除）、
  新建与编辑表单（实时预览接下来 5 次）、执行记录。说明见 [docs/guides/SCHEDULER.md](docs/guides/SCHEDULER.md)。
- 重复方式：一次性 / 每天 / 每周 / 工作日 / 每月几号 / 每月第几个周几 / 每年 / 特殊日期 / 每隔 N 天 / 每隔 N 分钟 / 每天随机几次 / 每月随机几次 / **高级：cron 表达式**（只能在控制台设置）；
  都可以加开始 / 结束日期、排除日期、跳过法定节假日、共执行几次后停止。随机时刻按「任务 + 日期」确定，重启不重抽。
- 内容：固定文字（桥接直接发；发给管理员时任何模式都能发）或叫 AI 来说（唤醒那个会话自己的 AI，提示里带上【定时任务】）。
- 发送对象：管理员私聊、白名单好友、白名单群，可多选。时区按任务计算，与机器时区无关；时区下拉列出全部时区并带当前 UTC 偏移（如「Asia/Shanghai（UTC+8，北京时间）」），时间文字也带偏移。
- 安全：总开关和限制只能在控制台 / 管理员命令里改；AI 只能在管理员私聊里用 `qq_schedule_*` 登记，默认只能发给管理员私聊，发往群的要开关并且先暂停待确认；
  登记后桥接另发确认；限额（任务数、每任务 / 每天 / 每群条数、最小间隔）、定时任务免打扰（只拦定时任务发往群的消息）、固定时间随机偏移、错过补发窗口；新建 / 修改 / 删除写入审计日志。
- 管理员私聊命令 `/remind`（桥接直接处理，不进模型）。
- 新模块 `src/scheduler/`（time / schedule / engine / commands / notes）；新 MCP 工具 `qq_schedule_create / list / update / delete`（工具开关 `socialV2.tools.schedule`，默认开）。
- 新测试 `scripts/test-scheduler.mjs`；控制台离线夹具接入真实的调度引擎（假发送）。
- 已知限制：「工作日」不含调休上班的周末（内置节假日表只有放假日）；农历日期、AI 没发出时的备用文字、导出 / 导入留到第二阶段。

## v1.0.3 —— 2026-10-21

在 v1.0.2 的基础上的修复版本：**切换 agent 等级不再失忆**；引用一条（较早的）合并转发时，AI 能看到并打开里面的内容，这条消息也不再卡 30 秒；普通图片不再被误当成表情。
发布说明：[docs/release/RELEASE_NOTES_v1.0.3.md](docs/release/RELEASE_NOTES_v1.0.3.md)。

### 升级注意（从 v1.0.2）
- 沿用 `config.json`、`state/`、`interface-platform/state/`；执行 `npm ci`，重启控制中心（桥接和接口平台都要重启才会用上新代码）。没有数据格式变化，不需要重跑 `setup-dsh.mjs`。

### 修复：切换 agent L1~L3 / 自动回落后 AI「失忆」（设计缺陷）
- 现象（用户反馈）：切到 agent 会自动回落到二代仿真，回落又把 DSH 会话归档，「一用 L2 就几乎失忆」。原因：每次模式 / 级别切换，桥接把**所有**会话退役归档再新建，
  连从没挂过工具的群聊会话也一起归档；新会话里也没有任何「刚才聊到哪了」。
- 新模块 `src/mode-handover.js`：
  - **聊天会话休眠复用**：进 closed-agent 时，非 closed-agent 建的、带明确 preset 的会话（qq-chat / qq-chat-v2）不归档，只停在途工作、撤销映射、轮换令牌，
    记进 `sessions.json` 的 `dormantSessions`；回到同一模式、同一 preset 时原样复用（DSH 侧已不存在则新建）。过期（`admin.dormantMaxMs`，默认 24 小时）、
    模式 / preset 不同、不再被允许、`/reset`、清空工作区时归档。群会话恢复后第一条消息带一句休眠提示。
  - **owner 私聊交接**：`state/admin/owner-transcript.json` 记 owner 私聊往来（最多 60 条，0600，路径 / 凭据打码；只记 owner 发的和模型真正发出去的，
    管理通道命令 / 确认码 / TOTP 本来就不交给模型、不会进来）。owner 会话因切换换新时注入最近往来，从休眠恢复时注入 agent 期间的往来，标明「不是新指令」；不含任何群聊原文。
  - 高权限会话不休眠：agent 会话回落、`/panic`、L1→L2 仍然停掉并归档。
  - 休眠保留「已引导 / 已看过的消息」：恢复后按正常原因唤醒，不再重发一遍首次引导（`【引导唤醒】`、初始提示词）、不把看过的消息重新喂一遍；休眠作废归档时才清，下一个新会话照常引导。（本机实测发现：恢复后曾多发一次引导唤醒。）
- 新配置 `admin.hibernateChatSessions`（默认 true）、`admin.dormantMaxMs`、`admin.handover`（默认 true）；文档 `ADMIN_CHANNEL.md` 新增「切换不失忆」。
- 新测试 `scripts/test-mode-handover.mjs`；测试夹具补注入 `role-card.js`（以前 agent 模式下 owner 私聊这条路径在夹具里跑不通）。

### 修复：引用合并转发时内容丢失、整条消息卡 30 秒
- 现象：群友引用一条（较早的）合并转发，AI 只看到「[引用消息]」，这条消息也晚了 30 秒才进未读。实测 macOS NapCat 4.18 读这种消息 `get_msg` / `get_forward_msg` 都要约 76 秒，而 SDK 和接口平台都只等 30 秒。
- 新模块 `src/quote-forward.js`：慢取缓存（后台长超时 120 秒、并发去重、成功缓存、失败短暂负缓存）与「最多等一会儿」。
- 收消息时引用解析最多等 4 秒（同一条消息里只解析一次，判断「是否引用机器人」复用结果），等不到先放带 id 的占位文字；原消息后台取到后缓存。
- 被引用消息里的合并转发 id 在归属校验通过后登记为本会话可见，并记到这条消息的 `forwardIds` 上；跨群 / 跨私聊的不登记。
- `qq_get_message_detail` 对加载中的 id 返回 `pending:true` 和「稍后再查」；工具说明同步更新。
- 读合并转发走缓存（30 分钟、最多 200 条），嵌套预览并行、各自最多等 30 秒，还在加载的标出来；MCP 端超时改为 180 秒。
- 发送引用时「加载中」不算确认目标归属（仍最多等 30 秒，和以前一样）。
- 接口平台：`get_msg` / `get_forward_msg` 用 `limits.slowReadTimeoutMs`（默认 120 秒），其它动作仍按 `requestTimeoutMs`（30 秒）。
- 新测试 `scripts/test-quote-forward.mjs`。

### 修复：文件名是 32 位哈希的普通图片被误当成表情
- 普通 QQ 图片的文件名本身就是 32 位哈希（`<32 位 HEX>.jpg`），旧的「从文件名推 emoji_id」规则会把它们当成表情：先去拼一个必然 404 的表情 CDN 地址，日志也错标成「表情获取失败」（实测：引用的合并转发里那张普通图片，`sub_type=0`）。
- 现在只有真的是表情才按表情处理：`kind=sticker`（mface 市场表情）、带 `emoji_id`、`sub_type=1`，或市场表情特有的「两位前缀-32 位 hex」文件名（前缀必须等于 id 的前两位，例如 `f9-f96b….gif`）。
- `test-media-search.mjs` 新增回归：哈希文件名的普通图片先走 get_image、失败时只试消息自带的链接、不拼表情 CDN；真表情的四种情况仍先走 CDN。

## v1.0.2 —— 2026-10-20

在 v1.0.1 的基础上：换 SnowLuma 目录（例如升级到 2.x）时，新目录缺数据会先提醒迁移；补充 SnowLuma WebUI 登录相关的常见问题；
修复 Windows 实机部署 v1.0.1 时发现的问题（Release ZIP 中文文件名乱码、重置会话清不掉等待租约等）；黑话研究未确认的 AI 推测显示在控制台；控制台可以选择 DSH 的提供方 / 模型 / 思考强度（GitHub issue #1）。
发布说明：[docs/release/RELEASE_NOTES_v1.0.2.md](docs/release/RELEASE_NOTES_v1.0.2.md)。

### 控制台选择 DSH 模型（提供方 / 模型 / 思考强度），保存即生效（GitHub issue #1）
- 「DSH 模型与思考强度」卡片改为提供方、模型、思考强度三个联动下拉，外加「看图能力」。选项全部来自 DSH 的模型目录（`session.modelCatalog`），不另维护清单，
  在 DSH 里配好的其它提供方桥接也能用；目录读不到时只显示当前配置和内置档位，并标注「目录不可用」。保存后对已有会话的下一条消息生效，不用重启桥接。
- 默认值不变：`deepseek-official` / `deepseek-flash` / `max`（DSH 桌面版 0.2.1 的 `deepseek-account` 同样按 DeepSeek 自家处理）。
- 服务端硬校验：提供方 / 模型不在目录里 → 400；档位不在该模型公布的列表里 → 400（附上支持的档位）；目录读不到 → 503 且不写 `config.json`。
  无档位的模型强度下拉置灰，`selectModel` 不带 `reasoningEffort`；配置里的档位该模型不支持时交给模型默认并记一条日志。
- **`off` 档放开**：档位以目录为准，选「关闭思考」时提示二代仿真的工具调用、读群判断和人格一致性可能变差。
- **不能看图的模型自动把图片改成文字**：目录不公布 `inputModalities`，所以看图能力用「已知表 + 未知」表达（`dsh.vision`：`auto` / `yes` / `no`）。
  `auto` 下只有核实过的 `deepseek-flash` 收图；其它模型的聊天图片、表情改成「[图片1：当前模型 … 不能看图，已省略]」（不下载图片），
  工具查询图片只返回文字，表情图 / 形象图对 AI 拒绝返回——避免整条消息报 `UNSUPPORTED_CONTENT` / `MODEL_DOES_NOT_SUPPORT_IMAGES`。
- **第三方提供方提示隐私**：选中非 DeepSeek 自家的提供方时提示「QQ 聊天内容会发给它处理」，第一次保存前再确认一次。
- 价格表只覆盖 DeepSeek 自家价目：其它模型（含第三方的同名模型）在下拉里标「价格未覆盖」，花费按 Flash 估算并标「估算」。
- 安全：`POST /api/dsh/model` 只有控制台能调（agent token 白名单本来就不含 `/api/dsh/*`），QQ 里的 AI 和私聊管理通道都改不了模型。
- 实现：新模块 `src/dsh-model.js`（目录 60 秒缓存与并发去重、校验、selectModel 参数、看图判断、提示文案、图片降级），`bridge.js` 只做接线；旧接口 `POST /api/dsh/effort` 保留并同样按目录校验。
- 新测试 `scripts/test-dsh-model.mjs`（模块 + 桥接接口端到端 + 图片降级）；`test-audit-bridge` 的 agent token 拒绝清单加上 `POST /api/dsh/model`；控制台离线夹具与 `test-console-ui` 改为新流程（夹具里的第三方提供方是虚构的）。
- 文档：`CONFIGURATION.md` 新增模型选择一节；`DSH_020_ADAPTATION.md` 更新 `off` 档与桌面版提供方名的说明。

### 黑话研究：未确认的 AI 推测显示在控制台
- 词条新增 `lastGuess`（`{ meaning, usage, example, at }`）：研究结果未确认时保存 AI 的推测，只给控制台看。旧词库没有这个字段，读入为 `null`，不需要迁移。
- 控制台「候选词-待研究」卡片显示「AI 推测（未确认，时间）」与「采用为含义」按钮：只把推测填进编辑框的空栏位，保存仍由管理员点，保存后词条仍是候选（移到「已研究」）。
- 安全：推测不写 meaning / usage / example，不算「已研究」，不能凭它确认；`buildSlangContext` 与给 AI 的 `publicSlangEntry` 都是字段白名单，不含 `lastGuess`；`GET /api/slang` 本来就拒绝 agent token；接口不接受外部写入 `lastGuess`；重新研究时也不把上次的推测喂回去。
- 研究确认、管理员填了含义、单条 / 批量确认时清空；再次研究仍未确认时覆盖为最新推测（没给推测则保留上一次）。
- 新测试 `scripts/test-slang-guess.mjs`；控制台离线夹具加一条带推测的演示候选。

### 修复（来自 Windows 实机部署 v1.0.1 的反馈）
- **Release ZIP 中文文件名在 Windows 上乱码、解压失败**（`roles/小鲸鱼.md`、`roles/傲娇助手.md`、`assets/deepseek娘.png`）：macOS 自带的 zip 不设「文件名是 UTF-8」标志，
  Windows 的解压按旧代码页解读。发布脚本改用自己的 ZIP 实现（`scripts/zip-utf8.mjs`，只依赖 Node 自带的 zlib）：每个条目都带 UTF-8 标志，`.command` / `.sh` 保留可执行位，
  三个系统生成的包一致，不再依赖系统的 zip / tar。v1.0.0、v1.0.1 的包都有这个问题。
- **黑话研究日志口径**：以前打印「已更新 N 条」用的是解析到的条数，未确认（不写库）的也算进去，管理端以为研究成功、词库却没变。
  现在分别报「写入 / 解析 / 未确认」，未确认的仍不写库，但把 AI 的推测（前 120 字）写进日志，方便判断该手填还是换关键词重研。
- **重置会话清不掉 `qq_wait_for_messages` 的等待租约**：控制台 / 控制中心的「重置会话」、QQ 里的 `/reset`、二代仿真全量重置都漏了清租约，
  新会话被旧租约挡住最长 15 分钟（「该会话已有一个等待中的 qq_wait_for_messages」）。现在三处都调用完整清理，归一后的会话 key 也一并清。
- **接口平台里默认生成的 SnowLuma 实例标红**（从 v0.4.x 升级时平台第一次启动，`snowluma-main` 既没有目录也没有令牌）：控制中心知道 SnowLuma 目录时自动替它补上，
  连接器按账号读令牌；用户自己配过令牌的实例不动。
- **两个测试在 Windows 上失败**：接口平台测试用 `URL.pathname` 当路径（Windows 上是 `/C:/…`）；生成 Linux 服务文件时用了平台相关的 `path.join`（Windows 上变成反斜杠）。
  都改为 `fileURLToPath` / `path.posix`，另外两处同样写法一并修正，并加回归测试禁止再用 `URL.pathname` 当路径。
- 部署文档：第 13 节补「换目录后必做」清单（先重置会话再删旧目录、重启 MCP、工具开关改后重置会话、带上 `interface-platform/state/`、SnowLuma 换目录走更新助手、不要双击旧目录的启动器），常见错误补四条。
- 新测试 `scripts/test-deploy-fixes.mjs`，`test-platform.mjs` 加 ⑧（自动补 SnowLuma 目录）。
- 测试夹具 `audit-bridge-harness.mjs` 的临时目录先取 realpath：macOS 默认临时目录是软链接，`test-audit-bridge` / `test-voice` 的语音库路径断言在真实 Mac 上会失败（只改测试，语音库的 symlink 防护不变）。

### 升级注意（从 v1.0.1）
- 沿用 `config.json`、`state/`、`interface-platform/state/`；执行 `npm ci`，重启控制中心。没有数据格式变化，不需要重跑 `setup-dsh.mjs`。

### 换 SnowLuma 目录前提醒迁移数据
- 在控制中心换到新的 SnowLuma 目录时，如果新目录里既没有账号配置（`config/onebot_<QQ号>.json`）也没有 WebUI 密码（`config/webui.json`），而旧目录有，**先不切换**，提醒用「更新助手」迁移：
  直接换过去 SnowLuma 会当成全新安装——生成新的随机 WebUI 密码（浏览器里保存的旧密码失效）、要重新扫码登录、重新开 OneBot WebSocket。确认框里点「去迁移（推荐）」会打开更新助手并填好新目录；坚持不迁移要再确认一次才切换。
- 背景：SnowLuma 1.14 与 2.x 的 `webui.json` 格式、密码规则完全相同，升级本身不会让密码失效；失效通常是新目录没带上旧的 `config/`（或旧版从没改过初始密码，每次启动都会重新生成）。

### 文档：SnowLuma WebUI 登录的常见问题
- 部署文档「常见错误」补三条：升级后旧密码登录不了（新目录没带上 `config/`，或初始密码从没改过）；
  输对密码也登不进、提示「登录尝试过多」（SnowLuma 同一地址 5 次输错锁 15 分钟，锁定期间正确密码也被拒，重启 SnowLuma 或等 15 分钟即解除；`localhost` 与 `127.0.0.1` 分开计数）；
  改密码提示「新密码不得与旧密码相同」（说明填的当前密码就是现在存着的密码，直接用它登录）。


在 v1.0.0 的基础上**增加 Linux 支持**（Windows、macOS 原有行为不变），适配 SnowLuma 2.x，DSH 探活更稳，macOS 第一次运行自动生成无窗口启动 App。
发布说明：[docs/release/RELEASE_NOTES_v1.0.1.md](docs/release/RELEASE_NOTES_v1.0.1.md)。

### 升级注意（从 v1.0.0）
- 沿用 `config.json`、`state/`、`interface-platform/state/`；执行 `npm ci`，重启控制中心（桥接、接口平台随之重启）。preset 没有变化，不需要重跑 `setup-dsh.mjs`。
- 用 SnowLuma 2.x 的 **Lite 版**需要本机 Node 24+；**完整版**自带 Node，不受影响。账号配置格式与 1.14 相同，可以用控制中心的「更新助手」把 `config/`、`data/` 迁移到新版本目录。
- Linux：`npm run linux-service -- --enable` 生成并启动 systemd 用户服务（见部署文档 10.1）。

### macOS：第一次运行自动生成无窗口启动 App
- 第一次双击 `control-center.command` 时，如果仓库根目录还没有「QQ Bridge 控制中心.app」，会自动生成（同 `npm run mac-app`）并在访达里选中它；这一次仍在终端里运行，以后双击 App 即可。生成失败只提示、不影响启动；设 `QQ_BRIDGE_NO_MAC_APP=1` 可关闭。
- App 仍然不入库、不进 Release 包（下载来的未签名 App 会被 macOS 拦下，本机生成的不会）。

### Linux 支持（增量，Windows / macOS 行为不变）
- **SnowLuma 2.x**（2.0 起正式支持 Linux x64 / arm64；账号配置的位置与格式与 1.14 相同，接口平台的账号发现和桥接的令牌自愈不用改）：
  控制中心识别 Windows（`launcher.bat`、自带 `node.exe`）与 Linux（`launcher.sh`、自带 `./node`）两种发行包；Linux 用 `bash ./launcher.sh` 启动。
  读 `package.json` 的 `engines.node`（2.x 是 `>=24`）与 `release.json` 的目标平台：Lite 版本机 Node 不够、或发行包与本机平台 / 架构不符时，不启动并写明原因。
  检查更新按本机系统与架构建议完整版（`win-x64.zip` / `linux-x64.tar.gz` / `linux-arm64.tar.gz`）。
- 控制中心页面：Linux 上也列「本机 SnowLuma 程序」、可「开启 SnowLuma」；Node 要求按发行包显示。
- Linux 的「浏览…」：有 zenity 用 zenity，否则 kdialog；都没有（服务器）时手动填路径。
- **NapCat 在 Linux**：启动文件可选 `.sh` 脚本（用 bash 运行）或可执行文件；版本从启动文件旁的 `package.json` 读；更新提示 Linux 安装方式。
- **Linux 无窗口启动**：`npm run linux-service`（`-- --enable` 直接启用）生成 systemd 用户服务（`--no-open`、崩溃自动重启、`KillMode=mixed` 先让控制中心按顺序停子进程）与桌面启动项。
- 新测试 `scripts/test-linux-support.mjs`（含 Windows / macOS 原有行为不变的断言）。

### DSH 探活更稳：不再「失败一次就报不可用」
- 桥接每 5 秒探活一次 DSH；现在**连续 2 次**（约 10 秒）失败才判定「DSH 不可用」并让 QQ 消息入队。DSH 很忙时偶尔一次没及时回应（例如本机满负载渲染时），不再刷出误报；偶发失败一次只在恢复时记一笔「DSH 探活偶发失败 1 次（原因），已恢复」。
- 端口重新识别不受影响：第一次失败就开始（DSH 0.2.1 换端口后照样很快跟上）。
- 日志写明失败次数和原因：超时 / 连接被拒（DSH 没在运行或换了端口）/ 连接被中断 / 鉴权失败 / HTTP 状态 / 其他。新模块 `src/lib/dsh-health.js`，测试 `scripts/test-dsh-health.mjs`。

## v1.0.0 —— 2026-10-19

第一个正式版本：支持 **Windows 与 macOS**；新增**接口平台**（桥接经它接入 QQ 后端，可同时接 SnowLuma 与 NapCat）；
控制中心统一管理桥接、接口平台与 QQ 后端（两边都有无窗口启动入口）；兼容 DSH 0.2.0-rc.2 与 0.2.1；增量合入上游 r4 的修复。
发布说明：[docs/release/RELEASE_NOTES_v1.0.0.md](docs/release/RELEASE_NOTES_v1.0.0.md)。

### 升级注意（从 v0.4.2）
- 沿用 `config.json` 与 `state/`；执行 `npm ci`，**重跑 `node scripts/setup-dsh.mjs` 并重启 DSH**（preset 去掉了 `{{cwd}}`，DSH 0.2.1 需要）。
- 想经接口平台收发：控制中心 → 接口平台 → 开启后端 →「设置 → 接入桥接」→ 重启桥接。不接入时桥接照旧直连 SnowLuma。
- macOS：`npm run mac-app` 生成无窗口启动 App；第一次读 NapCat 配置时允许「访问其他 App 的数据」。
- 更新 / 备份时把 `interface-platform/state/`（接口平台的实例配置与令牌）一起带上。
- 接口平台的版本号与项目统一（1.0.0），只在 `interface-platform/package.json` 一处维护；`test-platform` 检查两者一致。英文 README 同步更新。
- 发布包（`npm run release:zip`）默认输出到仓库外、与仓库同级的 `release/` 文件夹（历次版本都放在这里，不占仓库目录）；`--out` 可改。

### macOS 无窗口启动、NapCat 扫码、日志用词
- 新增 `npm run mac-app`：在本机生成「QQ Bridge 控制中心.app」（对应 Windows 的 `control-center-hidden.vbs`）：没有终端窗口和 Dock 图标，后台启动控制中心并打开页面；再次双击重新打开页面；页面上退出控制中心后 App 随之退出。生成的 .app 不入库。
- NapCat 登录二维码直接显示在控制中心：NapCat 由控制中心启动、未登录且生成了新二维码时，开启卡提示、程序区显示二维码（`GET /api/napcat/qrcode`，需令牌、文件位置固定、只给 PNG），登录后自动消失。NapCat 日志里同时插入二维码小图，换新后旧图标「已过期」；下载日志不含图片数据。
- NapCat 程序区更好找：开启卡上加「管理 NapCat 程序 →」；接口平台没运行时实例列表里也有「本机 NapCat 程序」。
- 桥接日志按实际后端称呼：经接口平台时写「QQ 后端（经接口平台 · NapCat 4.18.38）已连接」，不再一律写「SnowLuma 已连接」（`src/lib/qq-backend-label.js`）。
- 离线测试：`test-qq-backend-label.mjs`、`test-mac-app.mjs`，`test-napcat-manage.mjs` 补二维码。

### NapCat 管理：版本、检查更新、目录与启动文件
- 控制中心的 NapCat 程序区显示版本（运行中由 NapCat 经 `get_version_info` 自报；Windows 也可从安装文件读）、「检查更新」（只读 GitHub 最新 Release，只提示不下载）、「打开下载页」（macOS → Mac 安装器）。
- 新增「NapCat 设置」：QQ.app（macOS）/ 启动文件（Windows）、NapCat 目录、快速登录 QQ 号，带校验；改目录同步给接口平台的 NapCat 实例。不用再手改 `state/control-center.json`。
- 「浏览…」改用系统原生窗口模块 `src/launcher/pick-dialog.mjs`：macOS 用 osascript，Windows 用 PowerShell；标题与路径经 argv / 环境变量传入，不拼进脚本。只接受固定用途（`/api/pick`）。SnowLuma 的「浏览…」在 macOS 上也能用。
- 接口平台：链路连上后调用一次 `get_version_info`，在链路快照里给出 `backend: { appName, appVersion, protocolVersion }`。
- 离线测试 `scripts/test-napcat-manage.mjs`（接入 test:audit）。

### 接口平台并入仓库
- `interface-platform/` 从与桥接平行的目录搬进本仓库，作为独立子程序（自己的 `package.json`、测试与 `state/`）；`state/` 不入库，发布包随 `git ls-files` 自动包含平台。
- 控制中心默认按 `<仓库>/interface-platform` 找平台，旧布局（同级 `../interface-platform`）仍然认；`platformDir` 与 `QQ_BRIDGE_PLATFORM_DIR` 不变。
- `test-platform.mjs` 找不到平台改为失败（不再跳过），新增 ⑥：桥接与平台互不导入对方的模块、`.gitignore` 排除平台 `state/`。
- 离线测试用 `QQ_BRIDGE_NAPCAT_HOME` 指向假目录，不再读真实 NapCat 目录（macOS 上那会弹「访问其他 App 的数据」并卡住测试）。`.DS_Store` 加入 `.gitignore`。

### 控制中心：状态栏与桥接控制台入口
- 底栏 DSH 指示以桥接自己的连通结论（dshReady）为准，不再因为控制中心没探到 DSH 0.2.1 的随机端口而显示「不可达」；总体徽章同步。
- 底栏「SnowLuma」改为「接入后端」：走接口平台时列出平台里各实例（如「NapCat 已连接」），桥接直连时才显示直连的 SnowLuma；版本行只在选了 SnowLuma 目录时显示其版本。
- 「打开桥接控制台」从顶栏移到桥接卡片（启动桥接与重启之间），点击时自动带上桥接控制台令牌（经控制中心鉴权的 POST 取得，控制中心页面不保存）；旁边保留「手动输入令牌」。
- 桥接控制台的令牌页会先用本机浏览器里上次保存的令牌自动试一次，失效或走手动入口时才弹窗。
- 桥接控制台黑话库：「候选词」拆成「候选词-待研究」和「候选词-已研究」两栏（有含义 / 用法 / 示例之一即为已研究，标签上显示条数）；只是页面分栏，数据仍是候选，确认 / 拒绝 / 研究接口不变。
- 新增 macOS 启动入口 `control-center.command`（双击在终端里打开）。从其他 App 里启动时，macOS 会以那个 App 的名义反复询问「访问其他 App 的数据」。
- 接口平台：账号目录**读不了**（权限 / macOS 隐私保护）不再被当成「账号从目录消失」而断开链路，保留现有链路并在实例上报 `discoveryError`；只有目录里真的没了才关。
  控制中心底栏「接入后端」改按真实链路（open）判断，读不到目录时显示原因。NapCat 自动登录设置的读取缓存 10 分钟，不再每次刷新都读沙盒容器。
- NapCat 卡片识别 NapCat 自己的自动登录设置（`config/webui.json` 的 `autoLoginAccount`，只读）。

### NapCat 下 AI 收藏表情
- NapCat 的 `add_custom_face` 只接受本地文件路径（`base64://` 会报 ENAMETOOLONG），回执也不含 emoji_id。现在 base64 被拒且网关识别为 NapCat 时，
  把桥接已校验的表情字节写进桥接自建的临时文件（随机名、0600，macOS 放在 QQ 沙盒容器的 tmp，用完即删）再交给它；按 MD5 在收藏列表里找到刚收藏的表情，
  备注改用 NapCat 的 `set_custom_face_desc`。SnowLuma 的行为不变；消息里的原始 URL / AI 给的路径仍然不会交给网关。临时目录可用 `socialV2.sticker.collect.tempDir` 指定。

### 兼容 DSH 桌面版 0.2.1-rc.2（同时保持兼容 0.2.0-rc.2）
- **preset 不再使用 `{{cwd}}`**：0.2.1 的提示词变量只剩 provider / model，`suffix: Your working directory is {{cwd}}.` 会让每一轮直接报错
  （`unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix"`）。5 个 preset 都不再覆盖 suffix，改用当前 DSH 版本自带的默认后缀；已重新生成 bundle patch。
- **自动发现 DSH 随机端口**：0.2.1 桌面版每次启动监听一个随机回环端口（不再写死 19387）。`dsh.baseUrl` 留空时，固定端口连不上就查 DSH 桌面版进程的监听端口
  （macOS `lsof`，Windows `netstat` + `tasklist`），再用未登录 401 的特征文字确认是 DSH；DSH 不可用期间桥接每 10 秒重新识别，DSH 重启换端口后自动跟上。
- **macOS 识别桌面版**：Mac 上没有 `~/.dsh/dsh-runtimes`，改读 App 包 Info.plist 的版本号；之前 DSH 还没起来时会被误判成命令行版（3080）。
- Windows 上的 `netstat`/`tasklist` 发现路径只做了离线解析测试，尚未在 Windows 实机验证。

### 合入上游 Derpyu520/qq-bridge v0.2.0-r4（增量合并，本仓库的增强功能全部保留）
- **回合判忙租约**：回合只按「起始时间 + 15 分钟租约」判忙，turn/end 丢失或 DSH 重启丢回合时不再永久卡在「会话繁忙」（上游 #11/#19/#23/#26；本机 Mac 部署曾复现）。
  本仓库另在控制台 `/api/socialV2/state` 增加只读的 `busy` 诊断字段。
- **DSH 设置 user 层优先**：控制台切的模式不再被 5 秒轮询改回去（上游 #22）；DSH 设置页 ownerQQ 留空不再抹掉 config.json 的值。保留本仓库 v0.3.0 管理控制器的外部模式判定。
- **机器人身份写进唤醒提示词**（昵称 + QQ 号，上游 #29），不再把 @自己 当成 @别人；引用旧消息里的昵称不算被叫到。
- **会话初始提示词**：控制台为每个会话预写圈子主题/氛围（`state/initial-prompts.json`），只在首次唤醒注入；AI 读不到也改不了。
- **图片/表情链路**：safe-fetch 校验全部 DNS 结果 + IPv4 优先 + 逐地址切换（修 AAAA 先返回时每次白等 20 秒）；表情优先走 CDN、按 emoji_id/文件名推 gxh 地址兜底；
  落库保留 kind/emojiId/summary/subType。图片识别上限改为 `socialV2.media`（默认 8MB / 64MP / 5 张）。本仓库的表情上限 `socialV2.sticker.maxBytes`（10MB）照旧单独生效。
- **联网搜索**：新增 `src/web-search.js`，优先复用 DSH 的 DeepSeek 联网搜索，Bing RSS 兜底（配置 `webSearch`）。
- **稳定性**：`qq_wait_for_messages` 改走 `node:http` 长轮询（绕开 undici 300 秒 headersTimeout）、DSH 控制调用统一 15 秒超时、事件流重连指数退避；SnowLuma 对象形态的 error 拆出详情记日志。
- **体检修复**：`/api/send/*` 失败路径的 ReferenceError、MCP 对象 error 显示成 `[object Object]`、md-to-plain 的 ReDoS 与「2 * 3 * 4」被当斜体删掉、表情/黑话按码点截断不切坏 emoji、搜索空结果提示被缓存吞掉。
- 测试：移植上游 `test-audit-regressions`、`test-issue-regressions`、`test-media-search`、`test-v2-initial-prompt`，并接入 `test:audit`。
- 未合入：上游各包的版本号（本仓库保持自己的版本号）。

### 新增
- **接口平台 M1**（仓库内的独立子程序 `interface-platform/`，零依赖，Windows / macOS 通用；桥接与控制中心只经 HTTP 接口与它通信）：统一管理接入实例、账号、事件与发送，后端是可替换的连接器。
  本轮提供 QQ 的 SnowLuma 连接器（Windows）与 NapCat 连接器（macOS / Windows，连接用户自己安装的 NapCat；macOS 上已实机验证收发），都按目录自动发现每个账号；统一数据接口（`/v1`，SSE 事件流 + 带状态的发送请求）、
  管理接口（`/v1/admin`，与数据令牌分离）和 OneBot v11 兼容入口（过渡层：桥接只改配置即可经过平台）。见 interface-platform/README.md 与 interface-platform/docs/CONTRACT.md。
  **M1 不是完整交付**：Mac 原生 QQ（M3）、完整功能矩阵（M4）尚未实现；Windows 上经接口平台的实机链路尚未验收。
- **控制中心改为顶部大标签**：「桥接」「接口平台」两个标签，切换只改变显示、不启停任何模块；接口平台页有概览、接入实例、账号、日志、设置。
  SnowLuma 的目录选择、启停、更新助手移到「接口平台 → 接入实例」，仍然只由用户亲手点击。
- **管理员私聊跨群查看与群长期规则**（`socialV2.tools.ownerGroupAccess`，默认关闭）：管理员本人私聊的 AI 可以只读查看白名单群的消息和记忆（`qq_owner_peek_group`），并给群设长期规则（`qq_owner_group_rule`，由桥接写进群会话记忆、每次唤醒注入）；群里发言仍走托付，会话隔离不变。
- **`socialV2.sticker.maxBytes`**（默认 10MB，范围 256KB～40MB）：收藏 / 发送表情的单张大小上限单独可配；图片识别（含 `qq_get_sticker_image`）改用上游 r4 的 `socialV2.media.maxBytes`（默认 8MB）。
- **`snowluma.viaPlatform`**：「接入桥接」一键把桥接端点改为平台兼容入口（原值备份在 `state/platform-link-backup.json`，可「恢复直连」）；
  开启后 token 自愈不再扫描 SnowLuma 目录、不跟随发现到的端点，避免绕过平台直连。

## v0.4.2 —— 2026-10-17

### 新增
- **管理员私聊托付群会话**（`qq_ask_group_session`，默认关闭，开关 `socialV2.tools.ownerRelay`）：在私聊里让 AI「去某个群说两句」时，
  私聊会话不能直接往群里发（会话令牌只能发到自己的会话，以前会报「令牌不对」）。现在它可以把这件事托付给那个群**自己的**会话，
  由群会话看着群里的上下文自己组织语言发言；会话隔离不变。只有管理员私聊能托付，目标必须是白名单群，有限频、审计和私聊通知。
  见 docs/guides/CONFIGURATION.md。

### 修复
- 控制台「切换当前启用的人格」的下拉列表被折叠面板裁掉、看不到下面的人格：列表改为在页面里展开，面板跟着变高，人格多时可以滚动。

## v0.4.1 —— 2026-10-16

根据第一次真实部署（DSH 桌面版 + SnowLuma + 新 QQ 号）的报告修复。

### 修复
- **SnowLuma 握手被拒后永远连不上**：有的 SnowLuma 版本拒绝 WS 握手时只触发 `error`、不触发 `close`，
  SDK 的重连和桥接的 token 自愈都挂在 `close` 上，结果一直不连。现在 `error` 时（未连接）也触发自愈，
  并新增**连接看门狗**（`src/lib/ws-watchdog.mjs`）：未连接时按 10 秒起、最长 60 秒的退避重试，连上即停。
- **AI 出错时无从排查**：回合出错 / 消息未被接受时，原来只把一句话发到 QQ、不写日志，而且错误里带 credential 字样
  会被整条替换成「含敏感信息，已隐藏」。现在（`src/lib/agent-errors.mjs`）：日志写**错误码 + 脱敏后的详情**；
  QQ 上显示错误码（群聊等审计会话不显示原文）；缺凭据 / 余额不足 / 模型不可用这类**配置错误**私聊提醒 owner（30 分钟限频）。

### 改进：DSH 桌面版开箱即用
- `dsh.baseUrl` 默认留空 = **自动识别**：桌面版固定端口 `19387`，命令行版 `3080`（`src/lib/dsh-endpoint.mjs`）；
  桥接、控制中心状态栏、`probe:permission`、`self-test` 都用同一套识别。显式填写的地址照用（已有配置不受影响）。
- `setup-dsh.mjs` 自动识别 profile（桌面版 `desktop` / 命令行版 `web`），`dsh` 不在 PATH 时自动使用桌面版自带的 `dsh.cmd`
  安装 profile bundle。
- `control-center.bat` 找不到 Node.js 时给出提示并暂停；`control-center-hidden.vbs` 弹窗提示，不再静默失败。

### 控制台
- 「切换当前启用的人格」输入框：获得焦点时列出已有人格，输入时按**开头**过滤（不区分大小写），点击或 ↑↓ + 回车填入；仍可手动输入。

### 文档
- 部署指南：桌面版的 profile / 端口 / `dsh.cmd` 位置；新增「配置 DSH 模型凭据」一节（API Key → `deepseek-official`，
  账号登录 → `deepseek-account`）；装好或更换 Node 后要重跑 setup；DSH 沙箱可能不允许在工作区写可执行文件；
  `reasoningEffort` 的快慢取舍；「1006 正常」的说明补上 non-101 的情况；常见错误表新增三条。

### 升级注意
- 已经在 `config.json` 里写了 `dsh.baseUrl` 的保持不变即可；想用自动识别就改成 `""`。
- 新增离线测试 `test-snowluma-reconnect` / `test-agent-errors` / `test-dsh-endpoint`，`test:audit` 现为 40 个脚本。

## v0.4.0 —— 2026-10-16

### 新增：控制中心（docs/guides/CONTROL_CENTER.md）
- 一个只监听本机的网页（`control-center.bat` / `control-center-hidden.vbs` / `npm run control-center`，默认 `127.0.0.1:3099`），
  左侧是桥接的终端输出与固定命令集，右侧是 SnowLuma，底部是整体状态（桥接 / SnowLuma / QQ 账号与接收链路 / DSH / 模式级别 / 版本）。
- 桥接与 SnowLuma 作为控制中心的子进程运行：按钮启动、停止（桥接先保存状态再退出）、桥接崩溃自动重启（可关）；
  日志可过滤、只看错误、暂停、下载，显示前抹掉令牌与凭据，同时写入 `state/logs/`。
- SnowLuma：用 Windows 文件夹选择框选择你自己解压的目录（不放进项目），显示版本与完整版/Lite 版、已配置账号；
  **只在你点击时**按原样运行它自带的 `launcher.bat`；打开它的 WebUI（它禁止被嵌入，所以在新标签页打开）；
  检查 GitHub 上的最新版本；**更新助手**：你下载解压新版本后，备份并迁移 `config/`、`data/` 到新目录并切换（不下载、不替换它的程序文件）。
- 选择 SnowLuma 目录时自动同步 `config.json` 的 `snowluma.homeDir`。
- 桥接新增 `POST /api/admin/shutdown`（优雅退出，仅控制台令牌）；`/api/status` 增加 `botAccount` 与 `version`。

### 规则变更（经维护者确认）
- 允许**由用户亲手点击**控制中心按钮启动/停止 SnowLuma；仍然不自动启动、不下载、不安装、不修改 SnowLuma，
  桥接/MCP/AI 依旧没有任何启停 SnowLuma 的途径。`LICENSE` 第三方说明与 L6 测试已同步（新增 `scripts/test-control-center.mjs`）。
- `.gitignore` 与发布脚本排除 SnowLuma 目录与安装包。

### 文档
- 部署指南补充**桌面版 DSH** 的路径（版本检测、端口、bundle 安装的替代办法），仓库地址改为 h-D-ACE/dsh-qq，日常启动改为控制中心。

## v0.3.0 —— 2026-10-16

适配：DSH `@deepseek-ai/dsh@0.2.0-rc.2`（未变），SnowLuma ≥ 1.14.20（对照 1.14.22 源码），Node.js ≥ 22.13。

### 新增：人际连续性（docs/guides/CONTINUITY.md）
- 全局人物库 `state/social/people.json`：以 QQ 号为唯一主键，按群记录群名片/昵称及变更历史、成员关系、认识程度；
  同名不同号绝不合并，小号关联只能由管理员标注。
- 分层记忆：群内 / 私聊 / 全局三个作用域；共享策略 `none` / `identity`（默认）/ `shared`，群级可调严；
  **可见范围在注入时由程序过滤**，私聊来源记忆任何策略下都不外流；AI 申请的跨群共享需管理员批准。
- 二代唤醒提示词新增【在场人物】小节（只含本轮出现的人，有字数上限）。
- 成员事件：处理 `group_increase` / `group_decrease` / `group_card` / `group_recall`；入群按「陌生 / 别处认识 / 回归」分类，
  写入二代消息流并按配置唤醒（不强制欢迎）；事件去重；连上 SnowLuma 后成员名单对账（首次部署不把老成员当新人，补记断线期间的入退群）。
- 跨群受控查询（默认关闭，有向链接 + 能力授权，只返回统计/成员关系，不返回内容）。
- 新 MCP 工具：`qq_get_person`、`qq_note_person`、`qq_cross_group_query`。
- 旧版 `memberImpressions`（按名字）迁移：唯一映射才导入，其余待人工确认。

### 新增：owner 私聊管理通道（docs/guides/ADMIN_CHANNEL.md）
- 权限级别 L0（群友）/ L1（只读 Agent）/ L2（工作区读写）/ L3（高权限，TOTP + 每次审批）；不存在免审批的完全访问。
- 新 agent preset `qq-agent-readonly`（L1）：工具白名单只有读文件/检索/联网只读，不依赖 Windows 沙箱。
- `setup-dsh.mjs` 在 DSH profile 中加入权限预设 `qq-full-ask`（danger-full-access + ask）；桥接绝不使用内置的 `danger-full-access`（never）。
- closed-agent 会话按级别用 `commands/execute "/permission <预设>"` 钉住权限，钉不上就丢弃会话；高权限期间每分钟核对，被外部改动即告警 + 紧急关闭。
- 模式切换：确定性命令（`/mode`、`/level`、`/panic`、`/cancel`）+ 固定句式自然语言 + AI 工具 `qq_request_mode_change`（只能登记）；
  升级需确认码（一次性、2 分钟、绑定申请、并发互不覆盖），L3 另需 TOTP（RFC 6238，防重放，失败锁定）；降级与紧急关闭一步完成。
- 确认消息、管理命令、审批回复在交给模型之前被桥接拦截；群里的模式/权限命令一律拒绝；特权斜杠命令不再透传。
- 审批增强：全局编号 `#n`、展示按 callId 关联的实际参数（抹凭据）、多个并发互不覆盖、旧编号无效、超时自动拒绝。
- 自动回落：闲置超时 / 最长时长；重启不继承高权限。
- 统一变更通知（前后模式、级别、来源、时间、结果）与哈希链审计日志 `state/admin/audit.jsonl`。
- 外部变更检测：DSH 设置里的模式提权默认回退并告警；`ownerQQ` 变更告警（高权限时紧急关闭）。
- 管理通道人物命令：`/whois`、`/people`、`/person …`、`/note`、`/share`、`/review`、`/say`、`/audit`。
- 控制台：closed-agent 级别选择（L3 需输入 TOTP）、管理状态、紧急关闭按钮；`/api/admin/*`、`/api/people*` 管理接口（AI 令牌不可达）。
- 新脚本：`npm run admin:totp-setup`、`npm run probe:permission`、`npm run probe:member-events`、`npm run release:zip`。

### 安全加固（发布前独立安全审查后修订）
- **L2/L3 改用桥接自带的运维 preset**（`qq-agent-workspace` / `qq-agent-full`）+ 审批闸门 `qq-approval-gate`（`tools/pre-execute` 返回 ask）：
  核实发现 rc.2 的审批只在越过沙箱时触发，danger-full-access 下永远不会弹审批；DSH 默认 standard preset 还带审批策略固定为 never 的子代理。
- 运维 Agent 的文件工具不能读取 `state/`、`config.json`、`~/.dsh/.credentials.yaml`（`protected-paths.mjs`）。
- 控制台 API 不再接受 `?token=`（只用于打开页面）；高权限期间与回落后 10 分钟内控制台不能提权。
- 降级 / `/panic` 无条件退役运维会话并作废其审批；失效会话的审批回复一律拒绝。
- 执行层拒绝来自非确认来源的真实提权；`admin.allowL3=false` 在执行层也生效；外部变更在 alert 模式下最多按 L1 接受；启动校验完成前拒绝申请。
- 权限核对 fail-closed（返回格式无法识别或连续失败 → 紧急回落）。
- 审批编号跨重启连续；管理通道的消息不能被「引用」或 `qq_get_message_detail` 读回模型；入群事件里的名片先清理再进提示词。
- `setup-dsh.mjs`：已有用户 permission 覆盖时不再替用户加回 danger-full-access；桥接使用的三个预设强制为 ask（只收紧）。

### 变更（与上游行为不同的地方）
- 控制台 `POST /api/mode` 改经管理控制器：closed-agent 未指定级别时为 L2；L3 要 `totp`。closed-agent 不再使用 DSH 默认 preset（控制台的 preset 下拉只在 `admin.allowCustomAgentPreset=true` 时生效）。
- 控制台/DSH 设置/QQ 的所有模式变更都会私聊通知 owner。
- **未经授权的 closed-agent 不再能建会话**；从上游升级时若停在 closed-agent，首次启动回落到 `reserved2` 并告警。
- 审批不再使用「每个会话一个挂起槽」（新审批不会再自动拒绝旧审批）。
- 群友会话建好后额外钉 `read-only` 权限预设（纵深防御，`admin.pinChatReadOnly`）。
- 移除上游附带的 `@snowluma/mcp` 工具目录快照 `_snowluma-catalog.json`（无代码引用；不再入库）。
- QQ 号/群号校验放宽为 1~12 位正整数（原来不校验长度的地方保持兼容）。

### 修复（上游在 GitHub 源码包上的离线回归失败）
- `start.bat` / `restart.bat` 恢复 CRLF，并用 `.gitattributes` 固定。
- `test-preset-prompt` 不再依赖检出时的行尾；`test-preset-local-tools` 在未安装 DSH 时跳过工具名对账、
  不把可选第三方 bundle 的工具名当假名；补公开版 `docs/guides/VOICE.md`（原文件被 .gitignore 排除但被测试依赖）。

### 升级注意
- 必须重跑 `node scripts/setup-dsh.mjs` 并重启 DSH（新 preset 与权限预设）。
- `state/` 可直接沿用；新增 `state/social/`、`state/admin/`。
- 需要 L3 时先在本机运行 `npm run admin:totp-setup`。
