# 控制台表单迁移踩坑与检查清单

> 来源：`social-v2` 从手写表单迁到「字段规格 + `renderFields`」的整个过程（2026-11-06），期间返工 4 次、回退 1 次。
> 用途：迁 `scheduler` / `persona` / `social-v1` / `overview` / `slang` 之前先读这一页，按清单逐项过。
> 关联：`CONSOLE_FORMS.md`（组件与规格 API）、`CONSOLE_UI.md`（目录与加载顺序）、`CONSOLE_UI_REWORK.md`（基础层）。

## 1. 十个真实踩过的坑

### 1.1 标签垂直不居中：`margin` 是继承来的
全局 `label { margin: 17px 0 7px }` 会进到字段标签里，flex/grid 怎么调都偏 5px。
**规则**：行原语内标签必须 `margin: 0 !important`，且**禁止**再写 `height`/`min-height`/`padding-top`（高度由 `.field-row` 的 `--row-h` 决定）。
**门禁**：`test-console-static.mjs` 有两条断言盯着这件事。

### 1.2 少一个 `</div>`，后面的字段全被吞
`fieldShell` 模板少闭合一层时，浏览器会把后续字段当成第一个字段的子节点：DOM 里 `.cols` 只剩 1 个子元素，页面看着「只剩一个字段」。
**规则**：改渲染器后，用「`.cols` 子元素数 == 字段数」断言，不要用肉眼确认。
**门禁**：`test-console-ui.mjs` 的 `Field rows centre labels and keep two columns`。

### 1.3 工具类会被元素选择器压掉
`class="u-maxw-240"`（特异性 0,1,0）被 `input[type=search]{max-width:100%}`（0,1,1）覆盖，输入框被拉成 658px。
**规则**：宽度用组件类（`input.search-box--w240`、`fw-md`），不要用工具类控制控件尺寸。

### 1.4 覆盖层规则会命中被搬动的节点
`.settings-content>.row label { flex-basis:100px!important }` 本来只给工具栏行用，字段标签搬进 `.row` 后也命中，在纵向 flex 里 100px 变成高度。
**规则**：给这类规则加 `:not(.field-label)`（或改成更具体的类），不要直接删旧规则。

### 1.5 `.row` 与 `.cols` 不能叠在同一个元素上
`.row` 是工具栏 flex 行，会把 `.cols` 的 12 列栅格压成单列。
**规则**：栅格容器只用 `class="cols"`；工具栏才用 `.row`。

### 1.6 注解的位置决定对齐
注解若和标签、控件同处一行，行高会被拉高、标签就偏上。
**规则**：注解区固定在行外（`.field-notes`），缩进 = 标签宽 + 列间距。

### 1.7 CSP 不允许内联样式与内联脚本
演示页最初把 CSS/JS 内联进 HTML，被 `style-src 'self'` / `script-src 'self'` 拦掉，字段渲染数为 0。
**规则**：组件里不写 `style="…"`（有静态断言）；演示页拆成 `demo.html` + `demo.css` + `demo.js`。

### 1.8 「看起来修好了」不等于没坏别处
改外壳时页面看着正常，但 `.cols` 已经塌成 1 列。
**规则**：每次改渲染器/样式，必须同时跑几何断言 + 列数断言 + 三档宽度截图（1600/1180/760）。

### 1.9 手写块最容易在迁移时漏掉
语音库组是手写 `.row` + 原生控件，没有 `data-v2-fields` 宿主，迁移字段规格时被整组漏在外面，结构与其他折叠组不一致。
**规则**：迁移前先 `grep` 页面里的 `class="row"`、`<input`、`<button`，列出「非字段块」，逐个决定是 `field` / `inline` / `toolbar` 变体。

### 1.10 写文件别用 PowerShell
`Set-Content -Encoding UTF8` 会带 BOM、把 `\n` 改 `\r\n`；`node -e` 里嵌模板字符串的转义极易写坏。
**规则**：改源码用 `edit`/`write`，批量改动用临时 `.mjs` 脚本（跑完删）。

## 2. 迁移一个页面的检查清单

1. **盘点**：该页有几个直接手写的控件？哪些是字段、哪些是按钮条（toolbar）？哪些控件由 JS 动态生成（如 38 个工具开关）——动态列表不进 spec。
2. **抽 spec**：新建 `pages/<id>/fields.js`，每项 `{ name: 控件 id, type, label, hint?, warn?, danger?, span?, width? }`；分组用 `type:'section'` + `legend`。
3. **换宿主**：`page.html` 里字段区域换成 `<div data-v2-fields="<key>"></div>`，**保留**分组外壳、说明文字、动态列表与按钮条。
4. **接线**：`page.js` 里 `renderFields(host, FIELDS[key].fields, { columns: 2 })` 再 `createForm(root, {})`；读取统一走 `form.getValue(id)`，写回仍落 DOM。
5. **保持契约**：所有旧 DOM id 不变（改名会破 25 条接口契约与 224 个 legacy id 断言）；保存载荷必须**逐字节一致**。
6. **补注解**：每个字段问三件事——单位是什么（`hint`）、什么情况下会出问题（`warn`）、误操作后果（`danger`）。
7. **门禁**：
   - `node scripts/test-console-static.mjs`（结构/样式归属/标签规则）
   - `PLAYWRIGHT_MODULE=playwright-core node scripts/test-console-ui.mjs`（几何 + 契约 + 载荷）
   - `node scripts/test-audit.mjs`（90/90 基线）
   - 1600 / 1180 / 760 三档截图
8. **提交**：一次只迁一个页面；提交信息写清「换壳、载荷未变」。

## 3. 提交前的自检问句

- 三个宽度下，标签与控件中心差是否都 ≤1px（760 宽允许上下堆叠）？
- 每个 `data-v2-fields` 宿主的 `.cols` 子元素数是否等于该组字段数？
- 页面里还有没有 `class="row"` 兼作字段容器的残留？
- 保存一次后，请求体与迁移前是否逐字节相同？
- 注解是否都在行外、左缘与控件对齐？
