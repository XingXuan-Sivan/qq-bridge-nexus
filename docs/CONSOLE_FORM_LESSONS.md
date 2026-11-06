# 控制台表单迁移踩坑与检查清单

> 来源：`social-v2` 从手写表单迁到「字段规格 + `renderFields`」的整个过程（2026-11-06，返工 4 次、回退 1 次），以及随后「控件标尺 / 五类非字段控件 / 表格结构统一」两轮收口。
> 用途：迁 `scheduler` / `persona` / `social-v1` / `overview` / `slang` / `behaviors` 之前先读这一页，按第 2 节的流水线走、用第 3 节自检。
> 关联：`CONSOLE_FORMS.md`（组件与规格 API）、`CONSOLE_UI.md`（目录与加载顺序）、`CONSOLE_UI_REWORK.md`（基础层）。

## 1. 二十三个真实踩过的坑

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

### 1.10 写文件别用 PowerShell，含中文的源码尤其危险
`Set-Content -Encoding UTF8` 会带 BOM、把 `\n` 改 `\r\n`。更要命的是 PowerShell 5.1 的 `Get-Content -Raw` **按 GBK 解码**无 BOM 的 UTF-8 文件：一次 `-replace` 批量给按钮补 `class="btn"`，整份 `fields.js` 的中文变成 `鍒锋柊璇煶搴?`，不可逆（只能 `git checkout --` 复原重做）。
**规则**：改源码一律用 `edit`/`write`；确需批量处理就写临时 `.mjs` 脚本用 Node 读写（显式 `utf8`），跑完删。改完 `git diff` 里凡是出现 `�`/乱码片段，立刻回滚。

### 1.11 全局 `label` 的 margin 会漏进复核清单
工具开关清单用 `.field-check-item` 承载每一行，而它是 `<label>`——`base.css` 里全局的 `label { margin: 17px 0 7px }` 直接生效，两行之间凭空多出 24px，看起来像「栅格坏了」，其实是外边距。
**规则**：任何用 `<label>` 当行容器的自定义清单，都要显式 `margin: 0`；改完用 `getComputedStyle` 读一次 `margin`，别只看截图猜。

### 1.12 `checkList` 忘了 `span: 2` 只占半宽
`renderFields` 默认 `span: 1`，两列布局下就是 `col-12 col-md-6`。工具开关 38 项挤在 586px 的半宽格里，每列只有 207px，checkbox 和说明文字互相挤压。
**规则**：清单、长文本、整行说明一律写 `span: 2`；迁完量一次 `.field-checklist` 的宽度，应该接近控件列宽（约 1000px）。

### 1.13 「不是字段的一行」硬塞进字段格就会错位
语音库那一行是「按钮 + 小标签 + 输入框 + 开关 + 说明 + 按钮」，没有字段标签的语义。上一版塞进 `.field-row` 后标签列空着，行内控件从左缘开始，按钮和输入框各自按自己的 padding 撑高，差 5px。
**规则**：这类行用 `type:'custom'` + `.control-row`，角色类 `control-label`/`control-grow`/`control-fixed`/`control-note`；高度由 `--control-h` 统一，不许用 padding 凑。

### 1.14 把 40px 挂到裸 `button` 上，会压扁卡片式按钮
「控件统一 40px」这条本身没错，但写成了 `button { height: var(--control-h) }`——概览指标卡（`<button class="metric metric-link">`）、左侧导航（`<button data-view>`）、运行模式卡全是 `<button>`，一起被压到 40px：指标卡内容裁切、菜单行距变化、`button` 从 `inline-flex` 变成块级后指标里的「标签 / 数值 / 说明」从一行变三行。
**规则**：标尺只给 `.btn`；裸 `button` 只保留通用外观。要参与同行对齐的按钮显式加 `class="btn"`。判断方法：`grep '<button' pages/*/page.html`，凡是不在表单行里的按钮都不该有 40px。

### 1.15 表单内的开关不要「标签贴控件」
`switchField` 曾经走 `field-block--inline`（`grid-template-columns: auto auto`），标签紧跟开关。在单列里看着没问题，一进两列栅格，开关就从 148px 标签列的右边缘缩到单元格左边缘——和上面的输入框差出 40px，用户一眼就说「开关没和其他行对齐」。
**规则**：表单里的开关走标准 `.field-row`（148px 标签列 + 控件列），只有页头工具条（`.form-inline-bar`）允许 `auto auto`。改完量一次 `.field-row` 的 `grid-template-columns`，应当是 `148px …`。

### 1.16 条目多、名字长的开关清单用表格，不用复选框网格
38 个工具名长短不一，两列复选框网格里说明文字左边缘参差，扫读成本高。改成 `checkTable`（三列：启用 / 名称 / 说明，表头 sticky、行 hover）后，列对齐、对比清楚，也顺手解决了「两列网格里标签对不齐」的观感问题。
**规则**：同一组条目的名称长度差异大、或超过约 12 条时用 `checkTable`；少量短选项仍用 `checkList`。表格字段写 `span: 2`，渲染走 `components/table` 的 `dataTableHtml()`（工具栏 + 表体 + 分页），**不要**再在 `form.css` 里另写一套 `.field-table` 外观（第一版就这么干了，等于给同一个东西维护两份表格样式）。

### 1.17 表格的工具栏和分页要跟着表格走，不要每页各拼一套
改造前每个页面各写自己的「刷新 + 搜索 + 条数」，样式和间距各不相同；工具清单这种几十行的表既没有搜索也没有分页，只能靠滚动找。更隐蔽的是分页实现：如果翻页时重建 `<tbody>`，表单里勾选的 checkbox 会随 DOM 一起消失，保存时就变成「只勾了当前页的工具」——线上表现是「AI 突然少了一半工具」。
**规则**：完整表格用 `dataTableHtml` + `initDataTables`，页面只给数据和 `onRefresh`；分页只切 `tr.hidden`，**绝不重建行**。只有真的只需要表体（卡片里的小表、日志短表）才直接用 `tableHtml`。

### 1.18 静态断言按 HTML 文本 grep 控件，控件一搬进 `fields.js` 就全部误报
迁移后 `npm run test:audit` 从 90/90 掉到 86/90，四条失败全是同一类：`test-v2-initial-prompt` 数 `id="v2InitPromptText"`、`test-voice` / `test-voice-system` 找 `data-v2-tool="sendVoice"`、`test-mode-handover` 找 `data-v2-tool="handoverMemory"`——控件已经不在 `page.html` 里，而在 `fields.js` 的规格里。
**规则**：断言不要绑定某一种写法。用 `occurrences(id)` 统计 `id="X"` / `id: 'X'` / `name: 'X'` / `status: 'X'` 四种写法之和；控件值断言写成 `html.includes('data-v2-tool="X"') || /value: 'X'/.test(html)`。迁移前先跑一遍 audit 记录基线，迁完对着失败逐条改断言，**不要**为了让测试过而把控件搬回 HTML。

### 1.19 旧 DOM id 会随着「容器换成组件」一起丢
把工具清单换成 `checkTable` 后，`#v2Tools` 没了——旧页面里它是那个开关容器的 id，`checkList` / `checkTable` 默认把 id 放在哪、有没有放，很容易漏。224 条 legacy id 断言会直接抓出来。
**规则**：`checkList` / `checkTable` 的 `id` 必须落在**容器**上（清单 `div`、表格外层 `div`），不是落在第一行或表格元素上；迁完跑一遍 legacy id 断言，缺一个都不算完。

### 1.20 片段页的「就绪」是异步的，测试会量到空壳
字段由 `init()` 里的 `renderFields` 渲染，而 `router.hydratePage` 只要 `innerHTML` 一到位、`children.length>0` 就返回。浏览器回归拿到的 `#section-social-v2` 里 `[data-field-wrap]` 数为 0，几何断言直接走了 skip 分支——**看起来全绿，其实什么都没测**。
**规则**：`hydratePage` 在 `module.init?.()` 与 `applyPageA11y` 之后打 `host.dataset.pageReady = '1'`（非片段页同样打）；测试的 `hydrate(view)` 等 `data-page-ready === '1'` 再继续。页面内部顺序固定为「`renderFields` → 取动态节点 → `createForm` → 绑事件 → 拉数据」，需要渲染后才存在的节点不能在 `renderFields` 之前取。

### 1.21 页面 CSS 会把原语的布局拆掉
`social-v2/page.css` 曾经把 `.v2-head-fields .field-row` 从 grid 改回 flex 并清掉 `min-height`——只为让页头一行排开，结果整页字段对齐规则在这块失效。
**规则**：页面样式**不许**碰 `.field-row` / `.field-control` / `.field-block` 的 `display` / `grid-template-columns` / `height`；页头这种「字段横排」的场景用 `renderFields(..., { layout: 'inline' })` + `.form-inline-bar`。静态检查有对应断言。

### 1.22 死类名：CSS 里根本不存在，改完也没人发现
`btn-secondary`、`u-bold-pad-md` 这类类名在页面里用着，但全局 CSS 里没有定义——按钮拿不到任何样式，间距靠浏览器默认值，看起来「和别处不一样」却查不到原因。
**规则**：页面 class 必须在某个 CSS 里有定义（静态检查会扫，历史遗留只留 3 个白名单：`dsh-model-row` / `u-overflow-auto` / `role-defaults`）。迁移时看到这类类名直接换成组件类（`.btn` / `.btn.small` / `danger`）。

### 1.23 变体规则写在基类前面，会被后面的通用规则覆盖
`.form-actions--inline` 原本写在第 203 行，而 `.form-actions { justify-content: flex-end }` 在 553 行——同特异性、后者胜出，行内按钮条永远右对齐。
**规则**：变体规则放在基类**之后**（或用更高特异性）；改完用 `getComputedStyle` 读一次真正生效的值，别只看类名写没写。

## 2. 迁移一个页面的检查清单

0. **先跑基线**：`npm run test:audit`（当前 90/90）、`node scripts/test-console-static.mjs`、`PLAYWRIGHT_MODULE=playwright-core node scripts/test-console-ui.mjs` 三条都绿了再动手；给该页拍一张 1600 宽截图存底，并记下 `BARE_CONTROL_BASELINE` 里这一页的数字。**迁移过程中只允许这个数字往下降。**
1. **盘点**：该页有几个直接手写的控件？哪些是字段、哪些是按钮条（toolbar）？哪些控件由 JS 动态生成（如 38 个工具开关）——动态列表现在**进** spec（`checkList` / `checkTable` 的 `options`），不再留在 HTML。同时列出「非字段块」（`class="row"`、裸 `<table>`、工具栏），逐个决定 `custom` / `action` / `status` / 表格组件。
2. **抽 spec**：新建 `pages/<id>/fields.js`，每项 `{ name: 控件 id, type, label, hint?, warn?, danger?, span?, width? }`；分组用 `type:'section'` + `legend`；非字段块用 `custom` / `checkList` / `action` / `status`。
3. **换宿主**：`page.html` 里字段区域换成 `<div data-v2-fields="<key>"></div>`，**保留**分组外壳与说明文字；页头工具条用 `data-v2-layout="inline"`。
4. **接线**：`page.js` 里先 `renderFields(host, FIELDS[key].fields, { columns: 2, layout: host.dataset.v2Layout || 'grid' })`，**再**取渲染后才存在的节点（如 `v2InitPromptText`），**再** `createForm(root, {})`，最后绑事件、`initDataTables(root, { onRefresh })`、拉数据。顺序错了就是 1.20 的空壳/竞态。
5. **保持契约**：所有旧 DOM id 不变（改名会破 25 条接口契约与 224 个 legacy id 断言）；保存载荷必须**逐字节一致**。控件搬进 spec 后，id 要落在容器上（1.19）。
6. **枚举改断言**：控件不再出现在 `page.html`，按 1.18 把 grep 型断言改成「四种写法都认」；不要为了过测试把控件搬回 HTML。
7. **补注解**：每个字段问三件事——单位是什么（`hint`）、什么情况下会出问题（`warn`）、误操作后果（`danger`）。
8. **表格单独过一遍**：该页的表格要么用 `tableHtml`（只要表体），要么用 `dataTableHtml`（工具栏 + 分页）；**不要**保留页面自拼的「刷新 + 搜索 + 条数」。表单里的表格用 `checkTable`，并确认翻页/搜索后 checkbox 总数不变（1.17）。
9. **门禁**：
   - `node scripts/test-console-static.mjs`（结构/样式归属/标签规则/控件棘轮/类名定义/表格结构）
   - `PLAYWRIGHT_MODULE=playwright-core node scripts/test-console-ui.mjs`（几何 + 契约 + 载荷 + 表格翻页；仓库没装 playwright，但全局有 `playwright-core`，**必须**带这个环境变量）
   - `npm run test:audit`（基线随脚本增减更新，当前 90 个脚本）
   - 1600 / 1180 / 760 三档截图（纯截图用 `playwright-core` 指定本机 chrome，见下）
10. **提交**：一次只迁一个页面；提交信息写清「换壳、载荷未变」，并把 `BARE_CONTROL_BASELINE` 里该页改成 0；文档（`STATUS` 第 14 行、本页）同步更新。

## 3. 提交前的自检问句

- 三个宽度下，标签与控件中心差是否都 ≤1px（760 宽允许上下堆叠）？
- 每个 `data-v2-fields` 宿主的 `.cols` 子元素数是否等于该组字段数？
- 页面里还有没有 `class="row"` 兼作字段容器的残留？
- 保存一次后，请求体与迁移前是否逐字节相同？
- 注解是否都在行外、左缘与控件对齐？
- 同一行里按钮、输入框、开关、徽标的 `getBoundingClientRect().height` 是否都等于 40（徽标为 22 且垂直居中）？
- 页面 css 里有没有对 `.field-row` / `.field-control` / `.field-block` 写 `display` / `grid-template-columns` / `height`？
- 页面里每个 class 都能在某个 css 里找到定义吗（没有就是 1.22 的死类名）？
- 表格：翻到第 2 页、搜一个词之后，`input[data-field]` 的总数还等于总行数吗？
- 折叠分组（`<details>`）全部展开后，有没有行被裁掉/点不到（1.20 的测试也要先展开）？
- 页面底部保存栏滚动时会不会盖住表格底栏或最后一行按钮？（已知遗留，见 `STATUS` 第 14 行的待办）

## 4. 剩余页面的迁移顺序与取舍

1. `scheduler`（28 个控件，表单最规整，先立第二块样板）→ 2. `persona`（27）→ 3. `social-v1`（32，与 v2 同构，可复用字段清单）→ 4. `overview`（32，卡片式，注意裸 `button` 与 `metric`）→ 5. `slang`（36，表格 + 词条编辑）→ 6. `behaviors`（4 个控件但有三张手写表，按 1.17 换 `dataTableHtml`）。
每迁一页：`BARE_CONTROL_BASELINE` 该页改 0、`STATUS` 第 14 行更新数字、截图存档；一页一提交，不要攒。
`access` / `operations` / `sessions` / `usage` / `plugins` / `mcp` / `skills` 控件较少，随对应功能改动顺带迁，不单独立项。
