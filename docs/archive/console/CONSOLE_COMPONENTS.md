# 控制台通用组件（CONSOLE_COMPONENTS）

控制台是零构建的 ESM 前端：每个组件一个目录 `public/console/components/<name>/{<name>.js,<name>.css}`，页面只 import 工厂函数，拼好的 HTML 由组件统一给出。这份文档是**组件层的单一入口**；页面结构、表单控件、迁移踩坑分别见 `CONSOLE_UI.md`、`CONSOLE_FORMS.md`、`CONSOLE_FORM_LESSONS.md`。

## 一颗组件的最短用法

```js
import { cardHtml } from '../../components/card/card.js';

host.innerHTML = [
  cardHtml({ title: '运行方案', note: '保存后立即生效', body: '<div data-runtime-fields="table"></div>' }),
  cardHtml({ title: '说明', description: '一段说明文字', body: '…' }),
].join('');
```

规则：

- 组件只导出**纯函数**（HTML 字符串）或幂等的 `init/hydrate` 函数，不自己找页面节点、不绑全局事件。
- 页面 `page.html` 只留容器与宿主；卡片、折叠面板、标签、提示条等外壳一律由 JS 生成（用户 2026-11-12 的决定）。
- 清空页面自带样式：组件的观感写在 `css/components.css`（共享）或组件自己的 css，页面 css 不得覆写组件的栅格/字号/间距。

## 卡片 `card`

`components/card/card.js`

```js
cardHtml({ id, title, note, description, actions, body, footer, className, headId, bodyId })
mountCard(host, spec)   // 替换宿主内容并返回 section
```

- 固定输出 `<section class="card span-all">`，`title` 写成 `<h2>`；`note` 写成 `h2[data-note]`，由 CSS `::after` 渲染到卡片头右侧。
- `actions` 放卡片头右侧（新建/刷新一类按钮）；`description` 是标题下的一段说明（HTML 片段，调用方负责转义）；`body` 包进 `.card-body`；`footer` 包进 `.card-foot`。
- 页面里卡片宿主用 `<div class="page-stack">`（`display:contents`），这样注入的 `<section>` 直接成为 `main` 网格项；否则卡片会被宿主挤成半宽。
- 没有标题的卡片（分组卡）用 `className:'is-group'` + `collapseHtml`，或直接只给 `body`。

## 折叠面板 `collapse`

`components/collapse/collapse.js`

```js
collapseHtml({ id, title, body, open, persist, className, elementId })
hydrateCollapses(root)   // 恢复 persist 的展开状态（幂等）
```

输出 `<details class="settings-group"><summary>…</summary><div class="settings-content">…</div></details>`。页面级「默认展开第一组 + 按页面记忆」仍由 `components/groups/groups.js` 的 `initGroups(host,{pageId})` 负责，**不要**再叠一层 persist；只有需要独立记忆的面板才传 `persist`。

## 标签 `tag`

`components/tag/tag.js`

```js
tag(text, { type: 'default|primary|success|warning|danger|info', size: ''|'sm', title })
```

输出 `<span class="tag tag--<type>">`。`.pill` 已彻底删除（用户 2026-11-12 决定），旧代码里的 `pill` 类名要改成 `tag`；动态拼接处（状态映射等）同样用 `tag()` 或 `tag tag--*`。

## 提示条 `alert`

`components/alert/alert.js`

```js
alertHtml({ id, elementId, type, title, description, html, hidden, closable, persist, actions, className })
mountAlert(host, spec)
hydrateAlerts(root)   // 隐藏已关闭项 + 绑定关闭按钮（幂等）
dismissAlert(id, persist) / resetAlert(id)
```

- 结构：图标 + 标题 + 描述 +（可选）操作；`closable` 时带关闭按钮。
- 关闭状态记录在 `localStorage['qq-console:alert-dismissed']`（`persist:'session'` 用 sessionStorage）；刷新不重现，`resetAlert(id)` 可恢复。
- 复杂内容（代码块、按钮）走 `html` 参数，`description` 只放纯文本。
- 纯页面说明（如「会话可在…单独指定」）**不要**收敛成 Alert；表单里的块级提示（`formCallout`）已改为返回 Alert 结构。

## 消息提示 `message`

`components/message/message.js`

```js
toast({ type: 'info|success|warning|danger', title, message, duration })
clearToasts()
setMsg(text, tone) / clearMsg()   // 页面内联状态行，app.js 依赖，勿删
```

`toast` 是全局堆叠（`.message-stack`），悬停暂停计时；`js/ui.js` 的 `showConsoleToast` 已转发到这里，旧页面继续调用即可。

## 消息弹窗 `message-box`

`components/message-box/message-box.js`

```js
await confirmBox({ title, message, type, confirmText, cancelText, danger })  // → boolean
await alertBox({ title, message, type })                                    // → void
```

替代浏览器原生 `confirm/alert`（401 门页除外）；内部复用 `components/modal` 的三段式弹窗，按钮带 `[data-box-confirm]` / `[data-box-cancel]`，UI 回归测试按这两个选择器自动确认。

## 插件/人格卡片 `tile`

`components/tile/tile.js`

```js
tileHtml({ id, title, badges, description, tags, error, actions, body, interactive, className })
```

- `badges` / `tags` / `actions` 是 HTML 片段数组/字符串（调用方转义文本）。
- `body` 用于需要自定义内部结构（如人格卡的可点击 `.tile-body`）；给了 `body` 就不再输出默认的标题/描述/标签行。
- 插件页与人格页的列表都用它，样式 `.tile` / `.tile-head` / `.tile-actions` 共享。

## 测试与门禁

- `scripts/test-console-static.mjs` 断言：组件文件导出约定函数、`components.css` 有共享类名、页面 `page.html` 不再手写 `class="card"` 或 `.pill`、卡片标题可以来自 `cardHtml(`。
- `scripts/test-console-ui.mjs` 覆盖几何、契约载荷、分页、移动端无横向溢出；`addInitScript` 会自动点击 `[data-box-confirm]`，所以原生 dialog → message-box 的迁移不需要改每个用例。
- 新增组件时同时补：导出函数断言、共享样式断言、至少一个页面迁移。
