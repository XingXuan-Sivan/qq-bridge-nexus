# 控制台：结构、组件与门禁

改 `public/console/` 前先读本文。本文是控制台前端的**单一入口**：结构、目录规则、设计令牌、组件 API、契约与门禁都在这里。

配套文档：

| 文档 | 内容 |
| --- | --- |
| [CONSOLE_FORMS.md](CONSOLE_FORMS.md) | 表单系统规格：16 个控件工厂、`createForm()` 内核、校验与条件显示、字段注解 |
| [CONSOLE_FORM_LESSONS.md](CONSOLE_FORM_LESSONS.md) | 表单迁移踩坑与检查清单（迁页面前先读） |

---

## 1. 零构建结构

没有打包器、没有前端 npm 依赖，靠浏览器原生 ESM。

| 位置 | 作用 |
| --- | --- |
| `public/console/index.html` | 唯一入口：侧栏、顶栏、全局搜索、各页 `<section>` 占位、弹窗 |
| `public/console/js/app.js` | 启动：加载页面片段、初始化路由、绑定全局交互 |
| `public/console/js/router.js` | `consolePages` 路由表、`hydratePage()`（按需 fetch `pages/<name>/page.html` 与 `page.css`）、`parsePageHash()` / `onPageRoute()`（页面子路由）、hash 恢复、`onPageRefresh` |
| `public/console/js/api.js` | 所有 `/api/*` 调用与错误归一 |
| `public/console/js/ui.js` | `esc`、`showConsoleToast`、`setMsg` 等小工具 |
| `public/console/js/registry.js` | **平台注册表**（C7，原名 `js/platforms.js`）：`loadPlatforms()` 读 `GET /api/platforms/registry`（用户平台与 Agent 平台同一份响应），对外给 `registryMeta` / `platformLabel` / `capabilityLabel` / `conversationTypeLabel` / `conversationTypeTone` / `platformFilterOptions` / `platformLimits` 等查表函数与中文标签表。**页面不得再写死平台名**：列名、筛选、标签、上限都从这里取；全仓库只有这一个文件打这个端点 |
| `public/console/components/<name>/` | 组件：`<name>.js` 与 `<name>.css` 同住 |
| `public/console/css/*.css` | `tokens` → `base` → `layout` → `grid` → `components` → `utilities`，**顺序即层叠顺序** |
| `public/console/pages/<name>/` | 页面片段：`page.html` + `page.js` + `page.css`，由路由按需加载 |

关键约束：`index.html` 的 `<link>` 顺序决定层叠顺序；页面 CSS 在片段 hydrate 时才插入，所以**页面样式天然晚于全局样式**——这是「页面里的控件和右上角不一致」的常见来源。

---

## 2. 目录约定

```
public/console/
├─ index.html
├─ css/                 # 只有全局层
│  ├─ tokens.css        # 设计令牌（颜色、圆角、间距、字号、断点）
│  ├─ base.css          # 重置与排版基线
│  ├─ layout.css        # 骨架：侧栏、顶栏、工作区、滚动区
│  ├─ grid.css          # 栅格：.cols / .col-* / .stack / .cluster
│  └─ utilities.css     # 工具类（u-*），只做布局，不做外观
├─ components/          # 一个组件一个目录，js 与 css 同住
├─ pages/<name>/        # 页面片段（只在两页以上复用的东西才上提成组件）
└─ img/ gate/           # 静态资源、401 门页
```

六条规则：

1. **一个组件一个目录**，`<name>.js` + `<name>.css` 同住，方便连样式一起搬；不再出现「js 在 `js/components/`、样式在 `css/components.css`」的分散状态。
2. **js 只导出工厂与绑定函数**：`xxxHtml(opts)` 返回 HTML 字符串、`bindXxx(root, opts)` 负责事件；不导出全局副作用、不在 import 时执行 DOM 操作。
3. **css 自包含**：组件 css 只写自己的类名（`.searchbox`、`.modal`…），**不写标签选择器、不做全局重置**；颜色/圆角一律取 `var(--…)` 令牌。
4. **外观不许依赖标签属性**：不要用 `input[type=text]` 这种靠属性命中的规则当组件外观来源——漏写 `type` 就会退回浏览器默认样式。
5. **页面专属组件先留在页内**：只服务一个页面、短期不会复用的，写在 `pages/<name>/page.js`；等第二个使用者出现再上提到 `components/`。
6. **样式只在两处**：全局层（`css/`）与组件层（`components/*/*.css`）。页面 `page.css` 只写该页独有的布局微调。

### 2.1 加载方式

- 全局层：`index.html` 里按 `tokens → base → layout → grid → components → utilities` 顺序 `<link>`（顺序不能改）。
- 组件层：在 `index.html` 里逐个 `<link href="/console/components/<name>/<name>.css">`，放在全局层之后、页面片段之前。**不做 `@import` 聚合**。
- 页面层：由 `router.hydratePage()` 动态插入 `pages/<name>/page.css`，天然最后生效。
- 服务端：放行规则在 `src/bridge.js` 的 `GET /console/(css|components|js|img|fonts|pages|gate)/` 那一行（`src/http/static.mjs` 只校验前缀、穿越、符号链接与 MIME，没有目录白名单）。新增资源子目录时改这一处正则即可，安全边界不变。

### 2.2 数据新鲜度

- **下拉 / 候选列表不做模块级永久缓存**：人格、平台、能力档这类可在别处增删的目录，**每次打开弹窗都重拉**（如 `pages/sessions/page.js` 的 `ensurePersonaCatalog()`）；拉取失败沿用上一次结果，别让下拉突然空掉。拿到一次就永不失效，会表现为「在人格页新建了卡，回会话详情看不到，必须刷页面」。
- **「跟随平台默认（当前：…）」必须写出可读名字**：后端把整份定义一起给（`/api/sessions/<key>` 的 `defaultBehavior` 与 `behaviors[]`、`defaultCapability` 与 `capabilities[]`），页面侧再兜一层（取不到就用 id）——不允许出现只有一个破折号的选项。
- 缓存只给「不常变且自己维护生命周期」的东西（参考组件里的单飞与 TTL 写法）；目录类数据一律现取。

### 2.3 页面子路由

hash 形状是 `#<page>[/<sub>[/<tab>]]`：`page` 必须在 `consolePages` 里，`sub` / `tab` 对路由器是**不透明字符串**（`agent:dsh`、插件 id、页内分段名）。

- 页面用 `onPageRoute(page, ({ sub, tab }) => …)` 注册「子段变了要做什么」；路由器在片段 hydrate 完成后才调，所以注册写在 `init()` 里。
- 二级页的返回用 `setConsolePage(page, { sub: '' })`，**不用 `history.back()`** —— 从外部深链进来时栈里没有上一页，`back()` 会把用户送出控制台。
- 面包屑不参与子段：二级页自带标题与返回按钮，`consolePages` 不长第三列标题。
- 同页换子段也算一次离开，`setPageLeaveGuard()` 的第三参数 `{ fromSub, toSub }` 用来判断要不要拦未保存修改。

---

## 3. 设计令牌与栅格

### 3.1 语义别名

原则：**原变量名全部保留、一个不改**；只新增一层语义别名与两组新令牌（间距、断点）。新组件只写语义别名，老样式不动，逐步收敛。

| 语义 | 现有令牌（举例） | 语义别名（新增） |
| --- | --- | --- |
| 页面底色 | `--bg` | `--color-bg` |
| 卡片/面板 | `--surface` `--card` | `--color-surface` |
| 次级面 | `--surface-subtle` `--surface-sunken` `--surface-hover` | `--color-surface-2/3` |
| 正文/次要/占位 | `--text` `--text-secondary` `--muted` `--placeholder` | `--color-text` `--color-text-muted` `--color-text-faint` |
| 边框 | `--border` `--border-input` `--border-strong` | `--color-border` `--color-border-strong` |
| 强调 | `--accent` `--accent-hover` `--accent-soft-bg` `--accent-border-focus` | `--color-accent` `--color-accent-hover` `--color-accent-soft`（焦点环仍用 `--accent-ring`） |
| 语义状态 | `--ok` `--err` `--warn-fg` `--danger-solid` | `--color-ok` `--color-danger` `--color-warn` |
| 徽章 | `--pill-*-bg/fg` 6 个 | `--badge-{blue,green,red,muted}-bg/fg` |
| 圆角 | `--radius`(16) `--radius-sm`(10) | `--radius-md`(12) `--radius-pill`(999) |
| 阴影 | `--shadow-card/md/pop/modal` | `--elevation-1/2/3/4` |
| 字号 | 散落 `12px…20px` | `--text-xs/sm/base/md/lg/xl` |
| 间距 | 无（各处手写 4/6/8/10/12/14/17/20/24/30） | `--space-1..8` = 4/6/8/10/12/16/20/24 |
| 断点 | 散在 `@media` 里 | `--bp-sm` 760 `--bp-md` 900 `--bp-lg` 1180 `--bp-xl` 1500 |

### 3.2 栅格

`css/grid.css` 提供 `.cols`（12 列）、`.col-1..12`、`.col-{sm,md,lg,xl}-*`、`.stack`（纵向堆叠）、`.cluster`（横向换行）。断点与上表一致，**移动优先 `min-width`**。

**命名避让**：`.grid` 已是卡片两列网格、`.row` 已是工具栏行，所以栅格容器叫 `.cols`、列叫 `.col-*`——不要复用那两个名字。

### 3.3 输入元素外观

基础输入规则用 `:where()` 降特异性，避免「必须靠顺序压过去」：

```css
:where(input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range])),
:where(textarea), :where(select) { /* 原有外观 */ }
```

### 3.4 工具类

现有 `u-*` 只增不改；响应式显隐为 `u-hide` / `u-hide-md` / `u-show-md`，间距为 `u-gap-1..8`。工具类只做布局，不做外观；**不要用工具类控制组件宽度**（特异性会被组件规则盖掉）。

---

## 4. 组件 API

组件只导出**纯函数**（HTML 字符串）或幂等的 `init/hydrate` 函数，不自己找页面节点、不绑全局事件。页面 `page.html` 只留容器与宿主；卡片、折叠面板、标签、提示条等外壳一律由 JS 生成。

### 4.1 卡片 `card`

```js
cardHtml({ id, title, note, description, actions, body, footer, className, headId, bodyId })
mountCard(host, spec)   // 替换宿主内容并返回 section
```

- 固定输出 `<section class="card span-all">`，`title` 写成 `<h2>`；`note` 写成 `h2[data-note]`，由 CSS `::after` 渲染到卡片头右侧。
- `actions` 放卡片头右侧；`description` 是标题下的说明（HTML 片段，调用方负责转义）；`body` 包进 `.card-body`；`footer` 包进 `.card-foot`。
- 卡片宿主用 `<div class="page-stack">`（`display:contents`），否则卡片会被宿主挤成半宽。
- 无标题的分组卡用 `className:'is-group'` + `collapseHtml`，或只给 `body`。

### 4.2 折叠面板 `collapse`

```js
collapseHtml({ id, title, body, open, persist, plain, className, elementId })
hydrateCollapses(root)   // 恢复 persist 的展开状态（幂等）
```

输出 `<details class="settings-group"><summary>…</summary><div class="settings-content">…</div></details>`。页面级「默认展开第一组 + 按页面记忆」由 `components/groups/groups.js` 的 `initGroups(host,{pageId})` 负责，**不要**再叠一层 persist。

`plain: true` 加 `.is-plain`：去掉外框与底色，只留一行可点的小标题。用于**卡片内部的分类分组**（平台清单的两个分类）与**详情页的只读附注段**（原始声明）——这两种位置再套一张卡就会变成卡中卡。

### 4.3 标签 `tag`

```js
tag(text, { type: 'default|primary|success|warning|danger|info', size: ''|'sm', title })
```

输出 `<span class="tag tag--<type>">`。`.pill` 已彻底删除，旧类名要改成 `tag`；动态拼接处同样用 `tag()` 或 `tag tag--*`。

### 4.4 提示条 `alert`

```js
alertHtml({ id, elementId, type, title, description, html, hidden, closable, boxed, persist, actions, className })
mountAlert(host, spec)
hydrateAlerts(root)      // 隐藏已关闭项 + 绑定关闭按钮（幂等）
dismissAlert(id, persist) / resetAlert(id)
```

- 结构：图标 + 标题 + 描述 +（可选）操作；`closable` 时带关闭按钮。
- `boxed: true` 换成整圈边框的说明卡（`.alert--boxed`），用于「整段说明要先读」的场合；
  不传则只有左侧一条竖色条，适合一行结论。
- 关闭状态记录在 `localStorage['qq-console:alert-dismissed']`（`persist:'session'` 用 sessionStorage）；`resetAlert(id)` 可恢复。
- 复杂内容走 `html` 参数，`description` 只放纯文本。纯页面说明**不要**收敛成 Alert。

### 4.5 消息提示 `message`

```js
toast({ type: 'info|success|warning|danger', title, message, duration })
clearToasts()
setMsg(text, tone) / clearMsg()   // 页面内联状态行，app.js 依赖，勿删
```

`toast` 是全局堆叠（`.message-stack`），悬停暂停计时；`js/ui.js` 的 `showConsoleToast` 已转发到这里。

### 4.6 消息弹窗 `message-box`

```js
await confirmBox({ title, message, type, confirmText, cancelText, danger })  // → boolean
await alertBox({ title, message, type })                                    // → void
```

替代浏览器原生 `confirm/alert`（401 门页除外）；内部复用 `components/modal` 的三段式弹窗，按钮带 `[data-box-confirm]` / `[data-box-cancel]`，UI 回归测试按这两个选择器自动确认。

### 4.7 卡片 `tile`

```js
tileHtml({ id, title, icon, badges, description, tags, error, actions, body, interactive, className })
```

- `badges` / `tags` / `actions` 是 HTML 片段（调用方转义文本）。
- `icon` 是 `{ glyph | src, tone }`（`tone` = `accent`/`ok`/`warn`/`danger`）；**不传也渲染图标位**，内容取标题首字（`.tile-icon.is-default`）。这样 DOM 结构不因有无自定义图标而分叉，作者将来补图标只需传参。
- 给了 `body` 就不再输出默认的标题/描述/标签行（此时图标也由调用方自己放）。
- `interactive: true` 让整张卡可点：输出 `role="button"` + `tabindex="0"`，配合页面的点击委托（排除卡内的 `button` / `a`）与 `Enter` / 空格键进二级页。平台清单与插件清单就是这么用的。
- 插件页、人格页与平台清单的列表都用它，样式 `.tile` / `.tile-head` / `.tile-icon` / `.tile-head-body` / `.tile-actions` 共享（均在 `css/components.css`）。

### 4.8 其它

| 组件 | 导出 | 说明 |
| --- | --- | --- |
| `split-view` | `splitViewHtml({ id, listLabel, listHtml, detailHtml, empty, toolbar, className })` / `splitItemHtml({ key, title, meta, badges, active, attrs })` / `setSplitActive(root, key)` / `initSplitView(root, { onSelect, onEnter })` | 左栏宽度的唯一开关是 CSS 变量 `--split-list-w`（默认 `minmax(272px, 348px)`），页面在自己的 `page.css` 里对宿主作用域重设它，组件不接收宽度参数；`toolbar` 槽里放 `tableToolbarHtml()` 生成的工具栏（槽内搜索框按整栏撑开、工具栏不再留表格的上边距）；`split-detail` 是一列分节卡（flex column，卡间距 16px），多张 `cardHtml()` 直接放进去，不再另套容器；窄屏 ≤900px 自动上下堆叠。**现仅 MCP 页使用**，并把 `--split-list-w` 重设为 `minmax(300px, 360px)`：平台页已改为「卡片网格清单 + 二级页」（见 [CONSOLE_FORMS.md](CONSOLE_FORMS.md) §4），不再适合塞进两栏 |
| `table` | `tableHtml(columns, rows)` / `dataTableHtml({ columns, rows, …, fit })` / `tableToolbarHtml({ … })` | 页面不许手写表格骨架；工具栏 + 表体 + 分页的完整表格用 `dataTableHtml`。键值表（属性 / 开关这类两三列的短表）传 `fit: true` 去掉 1000px 最小宽度，否则会在分栏右栏、窄卡片里溢出并被硬切 |
| `detail-head` | `detailHeadHtml({ title, code, meta, badges, backLabel })` | 二级页页头：返回按钮（`data-detail-back`，点击由页面的事件委托接住）+ 标题 + 可选的 `code` 次级标识 + 一行说明 + 右侧徽标。`title` / `code` / `backLabel` 由组件转义，`meta` 与 `badges` 是已渲染的片段（调用方转义）。样式 `components/detail-head/detail-head.css` 写 `grid-column: 1 / -1`，直接放进 `display:contents` 的二级页外壳即可；现在它放在 `detail-panel` 大卡里，那条网格声明在卡内不再生效（卡不是网格容器）；平台详情与插件详情共用 |
| `key-value` | `keyValueHtml({ rows, columns })` | 键值网格：把两三列、行数又少的「属性 / 值」表格摊成「两对一行」（`columns` 可 1–3）。值可以是 HTML 片段（标签、代码、补充说明），调用方转义；一行放不下就只开一对（`columns: 1`），长值给 row 加 `wide` 独占整行。**短属性优先用它，不要用 `dataTableHtml`**——两列表格会一屏只放十行、剩下都是留白，还给人「这是可排序数据集」的错觉 |
| `detail-panel` | `detailPanelHtml({ body })` / `detailSectionHtml({ title, note, actions, body })` / `detailCardHtml({ title, note, value, text, hint, actions, body })` / `detailCardsHtml(cards, { wide })` | 详情页版面：**整页就是一张大卡**，页头、结论句、标签条与面板都在卡里；卡内按分区排，分区之间靠分隔线分层；分区里的短内容用带边框小卡（`.detail-panel-card`），给 `value` 就是「标签 / 数值 / 脚注」的数字卡，`wide` 用于药丸清单或带表单的一组。大卡里再挂 `cardHtml` 的组件（能力档、行为档案）会被统一降成小卡外观。**详情页不要再用多张 `.card` 平铺，也不要把页头留在卡外** |
| `search-box` | `searchBoxHtml({ id, placeholder, value, label, className })` / `bindSearchBox(input, onQuery, { onEnter })` | 固定产出 `type="search"` + `class="search-box"`，宽度用 `input.search-box--w240` 而不是工具类 |
| `modal` | 三段式弹窗 | 被 `message-box` 复用 |
| `form` | 见 [CONSOLE_FORMS.md](CONSOLE_FORMS.md) | 表单控件工厂与 `createForm()` |

### 4.9 搜索框：一个具体的反例

**现象**：右上角全局搜索与页面内搜索外观不一致，页面里的看起来「像没上样式」。

**根因**：页面里的搜索框写成 `<input class="u-maxw-240 search-box">`，**没有 `type` 属性**；而输入框基础外观规则当时是 `input[type=text],input[type=search],…`。`[type]` 不匹配 → 整条规则不生效 → 只剩浏览器默认描边。

**做法**：组件固定产出 `type="search"`；`input.search-box` 自包含声明背景/描边/圆角/内距/字号与 Safari 原生装饰；`css/components.css` 删除 `.search-wrap input` 组合规则；静态断言锁住「`input.search-box` 是唯一定义处、5 个页面搜索框都带 `type="search"`」。

**判据**：1440 宽下三页与右上角的搜索框在描边、圆角、高度、字号上一致；`node scripts/test-console-static.mjs` 通过；把 `type` 或 class 删掉时断言能红。

---

## 5. 表单

表单不做零散 `field`，统一并入表单系统：16 个控件工厂（文本/数字/密码/多行/下拉/单选组/多选组/复选/开关/文件/日期/时间/日期时间/时间区间/只读/动作区）+ `createForm()` 内核（类型化取值、字段与跨字段校验、条件显示、提交态、脏值守卫）+ 字段注解（说明/警告/危险/文档）。

完整规格与迁移步骤见 [CONSOLE_FORMS.md](CONSOLE_FORMS.md)；迁页面时对照 [CONSOLE_FORM_LESSONS.md](CONSOLE_FORM_LESSONS.md) 的检查清单。

---

## 6. 必须不变的契约

改样式可以，这些不能动：

- **每个 DOM id 存在且唯一**（`scripts/test-console-ui.mjs` 的 `Legacy config IDs remain present and every DOM ID is unique`）。
- **29 条写载荷契约原样**（`scripts/console-ui-contracts.json`，逐条比对 `method` + `path` + `body`）：`POST /api/config/runtime`×2、`PUT /api/config/behaviors/<id>`、`PATCH /api/runtime/capabilities/<id>`、`PATCH /api/platforms/registry/user/<id>/config`×3（连接参数、条目级 `defaultBehavior` 与回填各一条）、`PATCH /api/platforms/registry/agent/<id>/config`、`POST /api/platforms/registry/agent/<id>/probe`、`PATCH /api/sessions/<key>/profile`、`POST /api/session/rename`、`POST /api/roles/create`、`POST /api/personas/default`、`POST /api/config/role-default`、`POST /api/role-mode`×2、`POST /api/whitelist`、`POST /api/security`×2、`PATCH /api/access`、`POST /api/config/permission`、`POST /api/config/send-limit`、`POST /api/slang`、`POST /api/slang/demo-candidate/confirm`、`POST /api/slang/config`、`POST /api/test-send`、`POST /api/console/notify-ai`、`POST /api/plugins/<id>/test`、`DELETE /api/extensions/mcp/<id>`。
- **基线是改造前的快照**：录制时控制台仍是 `scripts/fixtures/console.before.html` 那一版，所以基线只认「改造前就有的写口」。改造后新加的写口不进基线（每条都有专项用例），由夹具的 `unknownRequests` 兜住「调了没人认领的路线」。
- 14 个导航目标（`consolePages` 的键，按「管理 / 聊天行为 / 扩展」三组平铺）全部可达、轮询不清草稿；移动/平板无文档级横向溢出；深色模式跟随系统偏好；`prefers-reduced-motion` 关装饰动画。

契约确实变了才重录：`node scripts/test-console-ui.mjs --accept-contracts`，并在提交信息里写明原因。

---

## 7. 门禁与验收

| 门禁 | 覆盖什么 |
| --- | --- |
| `node scripts/test-console-static.mjs` | 结构约定：页面必须用 `tableHtml`、不许手写 `className='meta ok\|err'`、组件导出齐全、`input.search-box` 唯一定义、页面搜索框带 `type` |
| `PLAYWRIGHT_MODULE=playwright-core npm run test:console-ui` | 浏览器回归：点得动、请求发得出、29 条写载荷契约基线、几何与分页、移动端无横向溢出 |
| `npm run test:audit` | 全量脚本回归（提交前必跑） |
| 截图 | 视觉一致性：`sessions` / `platforms` / `persona` / `overview` 三档（1440 / 1180 / 760） |

新增组件时同时补：导出函数断言、共享样式断言、至少一个页面迁移。

---

## 8. 长页面的重排成本（2026-11-07 实测）

现象：DevTools 设备模式拖拽改视口宽度时页面又卡又抖；直接拖窗口反而流畅。

`social-v2` 全部分组展开、1600→1288 宽逐档改，主线程 `Performance.getMetrics`：

| 场景 | TaskDuration / 次 | LayoutDuration / 次 |
| --- | --- | --- |
| 默认（只展开第一组，3238 节点 / 2869px） | 4.9ms | 0.8ms |
| 16 组全展开（6905px） | 30.7ms | 15.9ms |
| 全展开 + `.settings-group{content-visibility:auto}` | **7.3ms** | **1.6ms** |
| 全展开 + 去掉顶栏 `backdrop-filter` | 30.4ms（无变化） | 15.9ms |

结论：**不是毛玻璃、也不是 transition**——设备模式每移动一像素就改一次布局视口，浏览器必须整棵树重排，成本随「已渲染内容」线性增长。修法：

```css
.settings-group {
  content-visibility: auto;
  contain-intrinsic-size: auto 600px;
}
```

`contain-intrinsic-size` 用 `auto` 记住上次高度，滚动条不跳。代价：折叠组内部 `position:sticky` 后代在组处于屏外时不可靠；当前表格都分页（≤20 行），可接受。`usage` 页默认状态每次重排仍要 16ms（图表绘制占大头），属后续单独优化。

---

## 9. Agent 平台 / 能力档 / 权限的界面口径（P2–P5）

这四块界面共用一条规矩：**值从哪来写清、写口只有一个**。四轴与存储分层见
[PROFILES_MODEL.md](PROFILES_MODEL.md) §1.1 / §1.2，两级权限权威见
[SESSION_SUBSYSTEM.md](SESSION_SUBSYSTEM.md) §5.5。

| 界面 | 数据源 | 写口 | 口径 |
| --- | --- | --- | --- |
| 平台页（清单 + 二级页） | `GET /api/platforms/registry`（用户平台与 Agent 平台同一份响应，清单与详情共用这一份快照） | `PATCH /api/platforms/registry/<side>/<id>/config`、`POST /api/platforms/registry/agent/<id>/probe` | 清单是**一张非折叠卡**：顶部工具栏（刷新 / 搜索 / 计数）+ 两个分类的普通下拉栏（`collapseHtml({ plain: true })`）+ 卡片网格，与「人格与角色」的卡片墙同形；诊断块（仅 error）在同一张卡里、工具栏之上。路由 `#platforms/<side>:<id>[/<tab>]` 进二级页；二级页固定「概览 / 配置 / 能力」，用户平台多一页「话术与行为」（不按平台 id 分支）：概览 = 运行状态键值网格 + 资产计数条 + 诊断表，配置 = `configSchema` 表单与模型卡，能力 = 一句话结论 + 注册表下发的分组清单（每项一枚「名字 + id」药丸）+ 工具表 / 能力档，话术与行为 = 平台提示词卡 + 行为档案（档案清单 / 档案内容两段 `detailSectionHtml` 分区，与能力页同一套分区写法，不再卡里套卡）。平台名、能力位、上限、`configSchema` 全从注册表取，页面不写死；探活结论写回注册表条目，不另存一份 |
| 平台›原始声明（能力位矩阵） | 注册表条目（同上） | 无（只读） | 降级到「能力 › 原始声明」的普通下拉（`collapseHtml({ plain: true })`）且默认折叠：用户平台一行「能力位」；Agent 平台四行「能力位 / 应用方式 / 提示注入通道 / 对端权限档」。空项给「—」；对端权限档是平台声明的取值域（`peerPermissions`），空即「由对端决定」，不另维护一份「平台支持什么」的表 |
| 平台›能力（能力档） | `GET /api/runtime/capabilities`（`catalog.agent` 是执行体的模块声明 + `capabilities`）+ 注册表的 `assets.capabilityProfiles` + `GET /api/extensions`（MCP 与技能目录） | `PATCH /api/runtime/capabilities/<id>`（只带 `label` / `note` / `mcp`（`allow` + `tools.allow` / `tools.deny`）/ `skills.allow`） | 能力档只写意图（`effects` / `runtime` / `behavior` / `audience` / `mcp` / `skills`），插件行由该平台渲染层（`render.yml` + `adapters/render.mjs`）生成——本页不出现任何插件名。「效果」表只读：每行写效果、变体（`true` = 默认）、承担它的模块、可装 / 装不出（由 `catalog.agent` 的 `effects` 求交得到）；「执行体工具面」只读，8 个模块来自 `tools.yml`；只有 MCP 工具与技能是勾选写口。受众 / 生效方式在卡头一句话写明，改它们要改后端 |
| 会话详情›执行体与对端权限（已删卡） | `GET /api/sessions/<key>/agent` 只取 `instanceForeign`；正文仍由平台的「能力」页提供 | 无（只读） | 执行体与对端权限档不在会话里复述：Agent 平台名、注入通道、对端权限档与钉档记录都在「平台›该 Agent 平台›能力」。会话只用 `/agent` 的 `instanceForeign` 决定危险操作卡里要不要给「在新 Agent 平台上重开」；桥接侧的权限级别仍在运行卡里选，与能力档、行为档案同一次保存 |
| 全局配置›Agent 平台（默认平台 + 模型与思考强度） | `GET /api/config/runtime` + `GET /api/status` + 注册表条目（`config` + `modelCatalog`）+ `GET /api/platforms/registry/agent/<id>/models` | `POST /api/config/runtime`；`PATCH /api/platforms/registry/agent/<id>/config`（与平台详情的模型卡同一个写口） | **一张卡、两个按钮**（`#agentRefresh` / `#agentSave`）。默认平台只落盘：`#agentDefaultSelect` 写配置面，`#agentRunningReadout` 同时写「配置面已改为 X，重启后生效」与「本进程仍在跑 Y」；模型控件（`components/agent-model`，控件 id `agentModel*`）跟着选中的平台走，不写死平台，没声明 `models` 能力位时只少这段控件、卡片与两个按钮仍在。保存先写默认平台（变了才写，服务端先预检探活），再写模型设置；两个写口分开报结果。选项来源、目录不可用的兜底、第三方提供方确认、看图能力提示与平台详情那份完全一致 —— 两处只是同一个组件的两次挂载（`prefix` 传 `platform` / `agent`） |
| 平台›配置（条目级默认行为） | 注册表条目的 `defaultBehavior` + `assets.behaviors` | `PATCH /api/platforms/registry/user/<id>/config` | 字段 `#platformDefaultBehavior`，首项「不设置（聊天模式）」，与条目开关一起保存；只对用户平台出现。它描述「这个平台新建、且行为档案选『跟随平台默认』的会话挂哪份档案」，不提供全局开关 |
| 会话详情›运行卡（能力档 / 行为 / 权限 / 模型） | `GET /api/sessions/<key>/profile` 的 `capability` / `defaultCapability` / `capabilities` / `behavior` / `defaultBehavior` / `behaviors` / `permission` / `model` / `effectiveModel` | `PATCH /api/sessions/<key>/profile` | 三个下拉的首项都写「跟随平台默认（当前：…）」，不许只剩一个破折号；能力档空 = 平台默认，行为 `inherit` = 平台条目默认，权限 `inherit` = 全局默认。只提交改过的项，不混入其它字段。模型按「会话值 → 平台配置 → 未设置」显示生效值；保存时模型目录不可用按原值存并回 `warnings`，不当成失败；页面把 `warnings` 拼进保存结果（`已保存（模型未校验：目录不可用）`，`⚠` 前缀让 toast 走 warning 配色） |
| 会话详情›显示名 | `GET /api/sessions` 的 `displayName` / `health` | `POST /api/session/rename`（唯一写口） | 列表行「重命名」按钮打开弹窗（没有 `sessionId` 时置灰）；它同时改对端标题与档案 `displayName`，详情头部只读。`PATCH /profile` 收到 `displayName` 一律 400 |
| 运行总览›指标格「会话模式」 | `GET /api/status` 的 `defaultBehavior` / `platform` | 无（只读） | 格子里是**当前运行用户平台**的默认行为，不是全局值；全局默认行为卡不存在 |
| 运行总览›指标格「用户平台」 | 注册表快照（`listPlatforms('user')` 的 `inboundState`） | 无（只读） | 格子里是**已连接的用户侧平台条数**，不是某个平台名：判据是每条实例的入站结论 `inboundState.state === 'open'`（真的在收），不是「默认出站实例是哪个」。`title` 写「x / y 条用户实例已接管：名称」，不让一个数字没有分母；注册表未就绪时写 `—`。副行仍是上游健康摘要（`#metricUpstream`） |
| 全局配置›权限级别 | `GET /api/config/permission`（`levels` / `labels` 一起给） | `POST /api/config/permission` | 四档全部可选，标签与后端 `PERMISSION_LABEL` 逐字一致；没有总开关、没有限时授权，写口径只有 `default` 一项 |

三条落地细节：

- **一次取全**：会话详情不复述平台声明面，`/agent` 只为「在新平台上重开」取 `instanceForeign`；平台清单与二级页共用一份注册表快照，切标签不重拉。
- **写口只有一个**：会话的三项运行参数（能力档 / 行为档案 / 权限级别）只走 `PATCH /api/sessions/<key>/profile`，默认 Agent 平台只走 `POST /api/config/runtime`（不混进平台配置），能力档只走 `/api/runtime/capabilities/<id>`，条目级默认行为只走平台条目配置。同一个值出现第二个写口就是缺陷。
- **失败写在块内**：写后回读不一致、写口拒绝（409）都在块内联报错，不弹全局 toast、不静默改回。

---

## 10. 不做的事

- 不引框架（Vue/React/Svelte）与打包器：当前体量下收益不抵引入成本，且会破坏「改完刷新即生效」。
- 不引 CSS 预处理器：变量已用 CSS 自定义属性表达。
- 不引 Bootstrap 整包：只是借它的组织与纪律。现有令牌与组件已够用，整包替换等于全量重录 29 条契约。
- 不做运行时组件注册（插件 UI 是另一件事，见 [HTTP_BOUNDARY.md](HTTP_BOUNDARY.md) 的插件 UI 沙箱）。
