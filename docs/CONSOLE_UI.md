# 控制台前端：结构与组件约定

面向改 `public/console/` 的人。目标是让「同一个控件在五个地方长得不一样」不再发生，并且新增页面时先想「用哪个组件」，而不是先写一段 HTML。

> 状态：**组件目录已落地**（2026-11-06）：`components/{message,modal,table,search-box,form}/` 已迁移完成，`/console/components/` 已放行；后续新增控件按本文第 2 节的六条规则走。

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
| `public/console/components/<name>/` | 组件：`<name>.js` 与 `<name>.css` 同住（`message` / `modal` / `table` / `search-box` / `form`） |
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
│  ├─ message/{message.js,message.css}
│  ├─ modal/{modal.js,modal.css}
│  ├─ table/{table.js,table.css}
│  ├─ search-box/{search-box.js,search-box.css}
│  └─ form/{form.js,form.css,demo.html,demo.js,demo.css}
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
- 服务端：放行规则在 `src/bridge.js` 的 `GET /console/(css|components|js|img|fonts|pages|gate)/` 那一行（`src/http/static.mjs` 本身没有目录白名单，只校验前缀、穿越、符号链接与 MIME）。新增资源子目录时改这一处正则即可，安全边界不变。

---

## 4. 搜索框：一个具体的反例与做法

**现象**：右上角全局搜索与页面内搜索外观不一致，页面里的看起来「像没上样式」。

**根因**（2026-11-06 定位）：页面里的五个搜索框写的是 `<input class="u-maxw-240 search-box">`，**没有 `type` 属性**；而输入框的基础外观规则是 `input[type=text],input[type=search],…`（`css/components.css` 第 137 行）。`[type]` 不匹配 → 基础规则整条不生效 → 只剩浏览器默认描边，于是出现白边、圆角与内距都和全局搜索不同。全局搜索带 `type="search"`，所以它才是「正确」的那一个。

**做法**（2026-11-06 已实现）：

1. `components/search-box/search-box.js`：`searchBoxHtml({ id, placeholder, value, label, className })` 固定产出 `type="search"` + `class="search-box"` + `aria-label`；`bindSearchBox(input, onQuery, { onEnter })` 统一绑定 `input` / `search` / Enter / Esc。
2. `components/search-box/search-box.css`：`input.search-box` **自包含**——背景、描边、圆角、内距、字号、placeholder、Safari 原生装饰全部显式声明，不依赖 `input[type=…]`，也不依赖文件顺序。
3. 全部使用点已替换：`index.html#consoleSearch`、`pages/behaviors`、`pages/sessions`、`pages/slang`（三个），并统一改成 `type="search"`。
4. `css/components.css` 里的 `.search-wrap input,input.search-box` 组合规则已删除；`.search-wrap` 只保留布局。
5. **宽度陷阱**：基础输入规则的 `input[type=search]`（特异性 0,1,1）带 `max-width:100%`，会盖掉通用工具类 `.u-maxw-240`（0,1,0）。所以窄版写成组件自己的 `input.search-box--w240`（同样 0,1,1 且更晚），不要用工具类控制搜索框宽度。
6. `scripts/test-console-static.mjs` 断言：组件目录存在、`input.search-box` 是唯一定义处、`components.css` 不再重复、页面内 5 个搜索框都带 `type="search"`、全局搜索框走 `search-box` 类。

**判据**：1440 宽下三页与右上角的搜索框在描边、圆角、高度、字号上一致（截图比对）；`node scripts/test-console-static.mjs` 通过；把 `type` 或 class 删掉时断言能红。

---

## 5. 验收与门禁

| 门禁 | 覆盖什么 |
| --- | --- |
| `node scripts/test-console-static.mjs` | 结构约定：页面必须用 `tableHtml`、不许手写 `className='meta ok|err'`、组件导出是否齐全等（改动结构后先跑它） |
| `PLAYWRIGHT_MODULE=playwright-core npm run test:console-ui` | 浏览器回归：点得动、请求发得出、契约基线 25 条（改前端交互后跑） |
| 截图 | 视觉一致性（间距、对齐、层叠），见路线图 §12 第 5–8 条的既有约定 |

### 5.1 长页面的重排成本（2026-11-07 实测）

现象：DevTools 设备模式拖拽改视口宽度时，页面又卡又抖；直接拖浏览器窗口反而流畅。

原因与数字（`social-v2` 全部分组展开，1600→1288 宽逐档改，主线程 `Performance.getMetrics`）：

| 场景 | TaskDuration / 次 | LayoutDuration / 次 |
| --- | --- | --- |
| 默认状态（只展开第一组，3238 个节点 / 2869px） | 4.9ms | 0.8ms |
| 16 组全展开（6905px） | 30.7ms | 15.9ms |
| 全展开 + `.settings-group{content-visibility:auto}` | **7.3ms** | **1.6ms** |
| 全展开 + 去掉顶栏 `backdrop-filter` | 30.4ms（无变化） | 15.9ms |

结论：**不是毛玻璃、也不是 transition**——设备模式每移动一像素就改一次布局视口，浏览器必须整棵树重排，成本随「已渲染内容」线性增长；普通拖窗口走的是另一条合并路径，所以看起来流畅。修法是对屏幕外的折叠组跳过排版：

```css
.settings-group {
  content-visibility: auto;
  contain-intrinsic-size: auto 600px;
}
```

`contain-intrinsic-size` 用 `auto`：记住上次渲染的高度，滚动条不会跳。代价是折叠组**内部**的 `position:sticky` 后代（例如超长表格的表头）在组处于屏外时不可靠；当前表格都分页（≤20 行），可接受。

已知未解决：`usage` 页默认状态每次重排仍要 16ms（图表绘制占大头，和折叠组无关），属于后续单独优化的范围。

---

## 6. 不做的事

- 不引框架（Vue/React/Svelte）与打包器：当前体量下收益不抵引入成本，且会破坏「改完刷新即生效」。
- 不引 CSS 预处理器：变量已用 CSS 自定义属性表达。
- 不做运行时组件注册（插件 UI 是另一件事，见路线图 §8.4 与 `docs/HTTP_BOUNDARY.md` 的插件 UI 沙箱）。
