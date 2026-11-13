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
| `public/console/js/router.js` | `consolePages` 路由表、`hydratePage()`（按需 fetch `pages/<name>/page.html` 与 `page.css`）、hash 恢复、`onPageRefresh` |
| `public/console/js/api.js` | 所有 `/api/*` 调用与错误归一 |
| `public/console/js/ui.js` | `esc`、`showConsoleToast`、`setMsg` 等小工具 |
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
collapseHtml({ id, title, body, open, persist, className, elementId })
hydrateCollapses(root)   // 恢复 persist 的展开状态（幂等）
```

输出 `<details class="settings-group"><summary>…</summary><div class="settings-content">…</div></details>`。页面级「默认展开第一组 + 按页面记忆」由 `components/groups/groups.js` 的 `initGroups(host,{pageId})` 负责，**不要**再叠一层 persist。

### 4.3 标签 `tag`

```js
tag(text, { type: 'default|primary|success|warning|danger|info', size: ''|'sm', title })
```

输出 `<span class="tag tag--<type>">`。`.pill` 已彻底删除，旧类名要改成 `tag`；动态拼接处同样用 `tag()` 或 `tag tag--*`。

### 4.4 提示条 `alert`

```js
alertHtml({ id, elementId, type, title, description, html, hidden, closable, persist, actions, className })
mountAlert(host, spec)
hydrateAlerts(root)      // 隐藏已关闭项 + 绑定关闭按钮（幂等）
dismissAlert(id, persist) / resetAlert(id)
```

- 结构：图标 + 标题 + 描述 +（可选）操作；`closable` 时带关闭按钮。
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

### 4.7 插件/人格卡片 `tile`

```js
tileHtml({ id, title, badges, description, tags, error, actions, body, interactive, className })
```

- `badges` / `tags` / `actions` 是 HTML 片段（调用方转义文本）。
- 给了 `body` 就不再输出默认的标题/描述/标签行。
- 插件页与人格页的列表都用它，样式 `.tile` / `.tile-head` / `.tile-actions` 共享。

### 4.8 其它

| 组件 | 导出 | 说明 |
| --- | --- | --- |
| `table` | `tableHtml(...)` | 页面不许手写表格骨架；分页见页面实现 |
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

- **225 个 DOM id 全部存在且唯一**（`scripts/test-console-ui.mjs` 第一条断言）。
- **25 条接口契约原样**（`scripts/console-ui-contracts.json`）：`POST /api/mode`×5、`/api/roles/create`、`/api/role`×2、`/api/role-mode`×2、`/api/whitelist`、`/api/security`×2、`/api/socialV2/config`×2、`/api/socialV2/activity`×2、`/api/social`、`/api/social/state`、`/api/social/flush`、`/api/slang`、`/api/slang/demo-candidate/confirm`、`/api/slang/config`、`/api/test-send`、`/api/console/notify-ai`。
- 10 个导航目标可达、轮询不清草稿；移动/平板无文档级横向溢出；深色模式跟随系统偏好；`prefers-reduced-motion` 关装饰动画。

契约确实变了才重录：`node scripts/test-console-ui.mjs --accept-contracts`，并在提交信息里写明原因。

---

## 7. 门禁与验收

| 门禁 | 覆盖什么 |
| --- | --- |
| `node scripts/test-console-static.mjs` | 结构约定：页面必须用 `tableHtml`、不许手写 `className='meta ok\|err'`、组件导出齐全、`input.search-box` 唯一定义、页面搜索框带 `type` |
| `PLAYWRIGHT_MODULE=playwright-core npm run test:console-ui` | 浏览器回归：点得动、请求发得出、25 条契约基线、几何与分页、移动端无横向溢出 |
| `npm run test:audit` | 全量脚本回归（提交前必跑） |
| 截图 | 视觉一致性：`sessions` / `behaviors` / `access` / `persona` / `overview` 三档（1440 / 1180 / 760） |

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

## 9. 不做的事

- 不引框架（Vue/React/Svelte）与打包器：当前体量下收益不抵引入成本，且会破坏「改完刷新即生效」。
- 不引 CSS 预处理器：变量已用 CSS 自定义属性表达。
- 不引 Bootstrap 整包：只是借它的组织与纪律。现有令牌与组件已够用，整包替换等于全量重录 25 条契约。
- 不做运行时组件注册（插件 UI 是另一件事，见 [HTTP_BOUNDARY.md](HTTP_BOUNDARY.md) 的插件 UI 沙箱）。
