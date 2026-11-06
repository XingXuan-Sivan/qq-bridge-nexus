# 控制台前端：结构与组件约定

面向改 `public/console/` 的人。目标是让「同一个控件在五个地方长得不一样」不再发生，并且新增页面时先想「用哪个组件」，而不是先写一段 HTML。

> 状态：**约定已定，迁移进行中**（2026-11-06）。目录与组件规范按本文执行；`components/` 目录与搜索框组件是**计划项**，见路线图 §8.9，尚未落地。

---

## 1. 现在是什么（零构建）

没有打包器、没有 npm 前端依赖，靠浏览器原生 ESM：

| 位置 | 作用 |
| --- | --- |
| `public/console/index.html` | 唯一入口：侧栏、顶栏、全局搜索、各页 `<section>` 容器占位、弹窗 |
| `public/console/js/app.js` | 启动：加载页面片段、初始化路由、绑定全局交互 |
| `public/console/js/router.js` | `consolePages` 路由表、`hydratePage()`（按需 fetch `pages/<name>/page.html` 与 `page.css`）、hash 恢复、`onPageRefresh` |
| `public/console/js/api.js` | 所有 `/api/*` 调用与错误归一 |
| `public/console/js/ui.js` | `esc`、`showConsoleToast`、`setMsg` 等小工具 |
| `public/console/js/components/*.js` | 现有组件（`message` / `modal` / `table`），**样式却散在 `css/components.css`** |
| `public/console/css/*.css` | `tokens`（设计令牌）→ `base` → `layout` → `components` → `utilities`，**顺序即层叠顺序** |
| `public/console/pages/<name>/` | 页面片段：`page.html` + `page.js` + `page.css`，由路由按需加载 |

关键约束：`index.html` 的 `<link>` 顺序决定层叠顺序；页面 CSS 在片段 hydrate 时才插入，所以**页面样式天然晚于全局样式**——这也是「页面里的控件和右上角不一致」的常见来源。

---

## 2. 目录约定（目标结构）

```
public/console/
├─ index.html
├─ css/                 # 只有全局层：tokens / base / layout / utilities
│  ├─ tokens.css        # 设计令牌（颜色、圆角、间距、字号）
│  ├─ base.css          # 重置与排版基线
│  ├─ layout.css        # 骨架：侧栏、顶栏、工作区、滚动区
│  └─ utilities.css     # 工具类（u-*），只做布局，不做外观
├─ components/          # 组件：一个组件一个目录，js 与 css 同住
│  ├─ README.md         # 本约定的简版（新增组件前先看）
│  ├─ message/{message.js,message.css}
│  ├─ modal/{modal.js,modal.css}
│  ├─ table/{table.js,table.css}
│  └─ search-box/{search-box.js,search-box.css}
├─ pages/<name>/        # 页面片段（只在两页以上复用的东西才上提成组件）
└─ img/ gate/           # 静态资源、401 门页
```

规则：

1. **一个组件一个目录**，`<name>.js` + `<name>.css` 同住，方便连样式一起搬；不再出现「js 在 `js/components/`、样式在 `css/components.css`」的分散状态。
2. **js 只导出工厂与绑定函数**：`xxxHtml(opts)` 返回 HTML 字符串、`bindXxx(root, opts)` 负责事件；不导出全局副作用、不在 import 时执行 DOM 操作。
3. **css 自包含**：组件 css 只写自己的类名（`.searchbox`、`.modal`…），**不写标签选择器、不做全局重置**；需要的颜色/圆角一律取 `var(--…)` 令牌。
4. **外观不许依赖标签属性**：不要写 `input[type=text]` 这种靠属性命中的规则当组件外观来源——漏写 `type` 就会退回浏览器默认样式（搜索框就是这么坏的）。
5. **页面专属组件先留在页内**：只服务一个页面、短期不会复用的，写在 `pages/<name>/page.js`；等第二个使用者出现再上提到 `components/`。避免 `components/` 变成杂物间。
6. **样式只在两处**：全局层（`css/`）与组件层（`components/*/*.css`）。页面 `page.css` 只写该页独有的布局微调（例如窄屏表格 `table-layout:auto`）。

---

## 3. 加载方式

- 全局层：`index.html` 里按 `tokens → base → layout → utilities` 的顺序 `<link>`（顺序不能改）。
- 组件层：在 `index.html` 里逐个 `<link href="/console/components/<name>/<name>.css">`，放在全局层之后、页面片段之前。**不做 `@import` 聚合**：串行加载更慢，出错时也更难定位是哪一层。
- 页面层：由 `router.hydratePage()` 动态插入 `pages/<name>/page.css`，天然最后生效。
- 服务端：`src/http/static.mjs` 的静态白名单目前只放行 `/console/{js,css,img,fonts,pages}`，**新增 `/console/components/` 需要改这一处**（属于服务端改动，改前先确认安全边界：仍然只读、仍然先鉴权后存在性、仍然拒绝路径穿越）。

---

## 4. 搜索框：一个具体的反例与做法

**现象**：右上角全局搜索与页面内搜索外观不一致，页面里的看起来「像没上样式」。

**根因**（2026-11-06 定位）：页面里的五个搜索框写的是 `<input class="u-maxw-240 search-box">`，**没有 `type` 属性**；而输入框的基础外观规则是 `input[type=text],input[type=search],…`（`css/components.css` 第 137 行）。`[type]` 不匹配 → 基础规则整条不生效 → 只剩浏览器默认描边，于是出现白边、圆角与内距都和全局搜索不同。全局搜索带 `type="search"`，所以它才是「正确」的那一个。

**做法**（计划，路线图 §8.9）：

1. 新建 `components/search-box/search-box.js`：导出 `searchBoxHtml({ id, placeholder, value, label, className })`，固定产出 `type="search"` + `class="searchbox"` + `aria-label`；再导出 `bindSearchBox(el, { onInput, debounceMs })`。
2. 新建 `components/search-box/search-box.css`：`.searchbox` **自包含**——背景、描边、圆角、内距、字号、placeholder 色、focus 环全部显式声明，不依赖 `input[type=…]`，也不依赖文件顺序。
3. 替换全部使用点：`index.html#consoleSearch`、`pages/behaviors`、`pages/sessions`、`pages/slang`（三个）。
4. 删掉 `css/components.css` 里的 `.search-wrap input,input.search-box` 组合规则与 `.search-box` 残留；`.search-wrap` 只保留布局（宽度、定位）。
5. `scripts/test-console-static.mjs` 加断言：不允许再手写 `class="… search-box"`；搜索输入必须带 `type="search"` 与 `class="searchbox"`。

**判据**：1440 宽下三页与右上角的搜索框在描边、圆角、高度、字号上一致（截图比对）；`node scripts/test-console-static.mjs` 通过；把 `type` 或 class 删掉时断言能红。

---

## 5. 验收与门禁

| 门禁 | 覆盖什么 |
| --- | --- |
| `node scripts/test-console-static.mjs` | 结构约定：页面必须用 `tableHtml`、不许手写 `className='meta ok|err'`、组件导出是否齐全等（改动结构后先跑它） |
| `PLAYWRIGHT_MODULE=playwright-core npm run test:console-ui` | 浏览器回归：点得动、请求发得出、契约基线 25 条（改前端交互后跑） |
| 截图 | 视觉一致性（间距、对齐、层叠），见路线图 §12 第 5–8 条的既有约定 |

---

## 6. 不做的事

- 不引框架（Vue/React/Svelte）与打包器：当前体量下收益不抵引入成本，且会破坏「改完刷新即生效」。
- 不引 CSS 预处理器：变量已用 CSS 自定义属性表达。
- 不做运行时组件注册（插件 UI 是另一件事，见路线图 §8.4 与 `docs/HTTP_BOUNDARY.md` 的插件 UI 沙箱）。
