# 控制台表单迁移踩坑与检查清单

> 来源：`social-v2` 从手写表单迁到「字段规格 + `renderFields`」的整个过程（2026-11-06，返工 4 次、回退 1 次），以及随后「控件标尺 / 五类非字段控件 / 表格结构统一」两轮收口。
> 用途：迁 `scheduler` / `persona` / `social-v1` / `overview` / `slang` / `behaviors` 之前先读这一页，按第 2 节的流水线走、用第 3 节自检。
> 关联：`CONSOLE_FORMS.md`（组件与规格 API）、`CONSOLE_UI.md`（目录与加载顺序）、`CONSOLE_UI_REWORK.md`（基础层）。

## 1. 五十八个真实踩过的坑

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

### 1.24 `page-stack` 里的卡片不写 `span-all` 会掉进两列网格
`scheduler` 改成多卡片后，5 张卡片变成「左一张右一张」：`section.page-stack` 是 `display:contents`，卡片直接成为 `main` 网格项，而 `main` 是两列网格（原本靠 `.card.span-all` 跨列）。
**规则**：多卡片页面每张卡片都写 `<div class="card span-all">`；只有确实想并排的两张卡才留半宽。

### 1.25 `custom` 字段默认只占半宽，整块内容要显式 `span: 2`
`scheduler` 的任务编辑器、安全限制网格、任务列表插槽都是 `type:'custom'`，首版没写 `span`，于是被放进 `col-md-6`（实测 607px），编辑器挤成窄条、限制网格只有 4 个 144px 的格子。
**规则**：`custom` 里装的是「整块内容」（表格、编辑器、网格）就写 `span: 2`；只有真正的小块（一个按钮、一个徽标）才留默认。判据：这块内容自己有没有内部的列布局？有就跨满。

### 1.26 开关不是 checkbox：值在 `aria-checked` 上，不绑委托就点不动
`switchField()` 渲染的是 `<button type="button" role="switch" aria-checked>`，切换逻辑原本只挂在 `createForm()` 的点击委托里。`scheduler` 整页字段用 `renderFields` 渲染、没调 `createForm`，于是三个后果叠在一起：点击毫无反应；`el.checked = true` 只是给 button 加了个无意义的属性（视觉不变）；`el.checked` 读回来是 `undefined`，保存时把 `enabled` 写成了 `false`——而徽标仍按服务端的真实值显示「运行中」，看起来就像「开关是关的，却还显示运行中」。

**规则**：开关只有两种接法——走 `createForm`（组件内已绑），或在 `init()` 里 `bindSwitches(root)` 并一律用 `getSwitch`/`setSwitch` 读写。`test-console-static` 现在会扫「用了 `type:'switch'` 却没绑定」的页面。判断一个控件是不是开关，看它是不是 `[role="switch"]`，不要看 `id` 像不像布尔。

### 1.27 弹窗自己切 `hidden`、动作条塞在滚动区里，都会变成「按钮找不到」
`scheduler` 的编辑器一开始是卡片里内联的 `<div id="schedEditor" hidden>`：打开就是 `hidden = false`，列表被推下去，保存按钮滚出视口后完全找不到。搬到弹窗后先只把整块内容塞进 `.modal`，又出现两个后续问题：整个弹窗一起滚，头尾跟着跑；底部动作条用 sticky 兜，结果预览文字从按钮缝里漏出来。

**规则**：弹窗用组件的三段式（`.modal-head` / `.modal-body` / `.modal-foot`，`.modal[data-modal-panel]`），**只有 body 滚动**；关闭/打开一律 `openModal`/`closeModal`，关闭按钮写 `[data-modal-close]` 让 `wireModal` 统一绑定；动作按钮放 foot，不要放进滚动主体，也不要靠 sticky 打补丁。同一动作条里按钮同高——`inlineActions` 默认 40px，紧凑处显式 `small: true`（32px），混档看起来就是没对齐。

### 1.28 手写的表单不会自动获得「148px 标签列」
定时任务编辑器搬进弹窗后仍是 `<div class="grid u-gap-12">` + `<div><label/><input/></div>`，标签在上、控件在下。看起来像「表单组件坏了」，其实是这段 HTML 从来没进过 `.field-row` —— 组件只对走 `renderFields`（或自己写 `.field-block > .field-row`）的字段负责。

**规则**：弹窗主体、动态生成的重复行（`schedFieldsHtml()` 的 13 个分支）也必须是 `.field-block > .field-row > .field-label + .field-control`。行距用容器自己的 `gap`（`.form-grid` 是 18px，手写容器自己补），别指望 `.field-block` 自带外边距。多行文本行加 `.field-block--textarea`，标签才会对齐第一行而不是整块居中。

### 1.29 原生 `select` 的箭头改不了，只能整个换掉
`:where(select)` 设了高度和内边距，但 `appearance` 仍是 `auto`：箭头方向固定、贴右边缘、无展开动画，暗色主题下还常常是黑箭头。给 select 写 `appearance:none` 又会把箭头彻底删掉，看起来像「下拉框坏了」。

**规则**：下拉框一律交给 `components/select/`（`initSelects()` 启动时装、`decorateSelects(host)` 切页时补、`MutationObserver` 兜动态插入）。页面只写 `<select>`，不要自己画箭头，也不要在页面 CSS 里覆盖 `appearance`。

### 1.30 选错控件的代价：布尔状态写成复选框，用户就得「勾上表示开启」
「跳过法定节假日」原本是 `<label><input type="checkbox"> 跳过…</label>`：它既不是多选集合，也不是风险确认，就是一个开关。后来改成 `role="switch"` 时，读取代码仍写 `.checked`，于是又踩回 1.26 的坑。

**规则**：单个布尔状态 → `switchField`（或手写 `role="switch"` + `bindSwitches`）；确认类（「我已了解」）→ checkbox；多选集合 → `checkboxGroup`。判断标准是「这个选项是一个状态，还是集合里的一项」。

### 1.31 原生 `type="date"` 能选不能打，纯文本 `HH:mm` 又没法选

两件事一起暴露的：

- **日期**：`<input type="date">` 的年 / 月 / 日是三段式，连续键入 `20261225` 会被年份段吞成 `202612-02-05`，用户会直接说「无法手动输入」。但它的日历面板又是浏览器自带、体验最好的。
- **时间**：安全限制里的「免打扰开始 / 结束」原本是 `type="text"` + `placeholder="00:00"`，想改时间只能手打；换成 `type="time"` 后时/分自动进位，键盘输入和面板都正常。

**规则**：日期用 `components/date` 的「文本框 + 日历按钮 + 隐藏原生 date」（可见控件可整段键入，按钮调起浏览器面板，见 `docs/CONSOLE_FORMS.md`）；时间直接用原生 `type="time"`。别再出现「纯文本框让用户手打日期时间」的字段，也别只留原生 date 让用户逐段敲。

### 1.32 11px 的 `--muted-soft` 连接符在深色底上等于不存在

日期区间的 `～` 用 `.field-unit`（11px、`--muted-soft`），截图里看起来像一条误触的细横线，用户直接问「中间是不是少了个符号」。

**规则**：行内连接符（`～`、`到`、`起，每`）用 `.field-inline > .field-unit`——13px + `--muted`，并在两侧留 2px；它属于控件的一部分，不是说明文字，不要沿用说明文字的弱化色。

### 1.33 图标按钮 hover 时「跳出输入框」：全局 `transform` 顶掉了居中

日期框右侧的日历按钮用 `top:50%; transform:translateY(-50%)` 居中，看上去正常；一 hover 就往下掉半格、背景方块溢出输入框。原因不在组件，而是 `components.css` 里那条老规则：

```css
button:not(.nav-item):hover:not(:disabled) { transform: translateY(-1px) }
```

它的权重（0,3,1）比 `.date-field > .date-field-btn`（0,2,1）高，hover 时直接覆盖了 `-50%`。

**规则**：绝对定位的图标按钮不要靠 `transform` 居中（用 `top:0; bottom:0; margin:auto 0`），并加 `.btn-icon` 类——全局 hover/active 的浮动位移已经用 `:not(.btn-icon)` 排除。改完 hover 前后 `getBoundingClientRect().y` 必须一致（探针量过：375 → 375）。


### 1.34 单选/复选组没走 `fieldShell`：标签落在左上、控件掉到下一行

`radioGroup` / `checkboxGroup` 早期直接返回 `<div class="field"><span class="field-label">…</span><div class="field-control">…`，没有 `.field-block / .field-row`。这种「看着能用」的旧结构一旦混进规格，同一页里就会有两种对齐：普通字段标签在 148px 列，单选组标签贴在左边缘、控件另起一行（`persona` 的「生效方式」就是这样被看出来的）。

规矩：**所有字段工厂的外壳只允许 `fieldShell()` 一种**。它顺带处理 `data-field-wrap`、hint/warn/danger/docs、`labelFor`（没有可聚焦控件时传 `''`）与 `required`。

```js
// 对：radio 组也走 fieldShell，label 落在标签列
return fieldShell({ id, label, required, control: `<div class="field-inline" role="radiogroup" aria-label="${esc(label)}">…</div>`, hint, warn, danger, docs, labelFor: '' });
```

（原来的 `aria-labelledby="<id>-label"` 指向的 `<span>` 不存在了，改用 `aria-label`，别再引回去。）

### 1.35 容器类挂到 `.field-block` 上：一个控件两层框

`className` 落在字段**外壳**（`.field-block`）上，不是控件本身。把 `.code-area`（自带 border / padding / 背景 / `margin-top` 的容器类）当 className 传进 `textareaField`，就得到「外层容器一个框 + textarea 自己一个框」——用户看到的是「套了两层文本框」。

给控件加样式要写后代选择器，不要复用容器类：

```css
.field-block--code > .field-row > .field-control > textarea {
  min-height: 280px; font-family: var(--font-mono); font-size: 12px; line-height: 1.7;
  background: var(--surface-sunken); color: var(--pre-fg);
}
```

### 1.36 页面里不要写 `style="…"`：CSP 直接拒绝

控制台 CSP 是 `style-src 'self'`，内联 style 会被浏览器拒绝（控制台刷 `Applying inline style violates the following Content Security Policy directive`），控件静默退回默认样式。宽度/间距用工具类（`.u-w-140`）或外层 `<span class="u-flex-basis-max-220">` 收窄；行布局用类名，不要在 JS 里 `el.style.marginTop = …`。迁移 `persona` 时清掉 `page.js` 里 5 处 `.style.` 后才恢复对齐。

### 1.37 一个页面服务两代时，校验和文案都要跟着当前代次走

仿真提示词只有一份文本框，但一代（`qq-chat`）和二代（`qq-chat-v2`）的段落名完全不同：一代是「【QQ 群聊模式 —— 安全规则】」「【发送与汇报禁令】」，二代是「【二代仿真模式 —— 安全规则】」「【二代仿真模式 —— 工具协议】」。服务端的 `presetPromptWarnings(content)` 原先只认二代段落且不接 `preset` 参数，切到一代就永远报「缺少二代段落」。`presetPromptBlockers` 早已按代次取清单，warnings 却没跟上——**同一个「按代次取清单」的约定要覆盖所有校验/提示，不能只改一处**。现在的签名是 `presetPromptWarnings(content, preset = 'v2')`，`bridge.js` 三个调用点都传 `preset === PRESET_NAMES.v1 ? 'v1' : 'v2'`。`scripts/test-preset-prompt.mjs` 有一条回归钉住「一代内容按二代校验必须报两段缺失、按一代校验必须为空」。

### 1.38 分栏页的标签条必须和内容同一张卡；工具条也要进规格文件

`slang` 页第一次重写时，把 4 个 `.slang-tab` 留在页头卡、三个分栏面板放进下一张「词库」卡。功能没问题，但视觉上标签被卡片边界切断，用户第一眼就是「标签页和内容断开了」。分栏页的正确结构是：**标题卡只放 h2/说明，标签条和它的面板同卡**，并用页内样式把标签条贴到内容顶部（`.card > .slang-tabs { margin: 10px 0 0 }`）。

另一个坑：分栏标签、批量操作条、「手动添加」这类工具条也是手写控件，留在 `page.html` 会被棘轮拦住（slang 第一次重写后仍是 17 个）。做法是把它写进 `fields.js` 的 `html` 规格，由 `renderFields` 注入：

```js
export const SLANG_FIELDS = {
  tabs: { html: TABS_HTML },
  barCandidate: { html: bar('slangCandidate', '...') },
};
```

页面里只留 `<div data-slang-fields="tabs"></div>` 宿主。「不是字段、但是页面结构」的东西，落点仍然是规格文件，而不是回到 HTML。

### 1.39 表格的「搜索/翻页」只切显隐，断言要数可见行

`dataTableHtml` 分页与搜索都是给 `<tr>` 加 `hidden`（这是为了翻页不丢表单勾选值，见 1.17）。迁移前的断言常写成 `tbody tr` 总数等于 2（旧表把表头也放在 `tbody` 里）。换组件后总数不变，必须改成：

```js
await page.locator('#slangConfirmedList tbody tr:not([hidden])').count()
```

同理，「全选本页」要按 `tbody tr:not([hidden])` 取行，否则会把其它页/被筛掉的行一起勾上。

### 1.40 状态块塞进 `.card-head` 会撑成两行；长标签在 148px 列里会折行

`social-v1` 迁移时把 `<span class="status-badge" id="socialStatus">` 放在 `.card-head` 里，而它的内容是「摘要缓冲: 无 / 状态: 暂无（发过消息的群会显示状态）」这种长文本——`.card-head` 是 `flex + justify-content:space-between`，于是标题被挤到左边、状态块自己换行占满右侧，卡头高了一倍。状态类文本要么是短徽标（`is-pill` + 两三个字），要么单独一行 `<div class="meta">`，不要放进卡头。

同一页还有 5 个超过 148px 标签列宽度的字段名（「普通消息触发概率（观望期）」之类），实测在标签列里折成两行、把整行撑高，视觉上像错位。约定：**标签只写名词，限定条件放 `hint`**（「触发概率」+ hint「观望期收到普通消息时，按这个概率决定是否回应」），单位放控件后缀（`.field-unit`）而不是标签括号里。

### 1.41 自带卡片外观的块不能再套 `.card`；它的宿主才是网格项

`overview` 的摘要指标 `.overview-summary` 自己就有 `background/border/radius`（它本身就是一张卡），迁移时如果外面再包一层 `<div class="card">`，会出现「卡里套卡」的双边框。正确做法是让它裸着放进 `page-stack`，只给**宿主 div** 指定跨列：

```css
[data-overview-fields="metrics"] { grid-column: 1 / -1; }
```

`page-stack` 是 `display:contents`，宿主 div 才是 `main` 网格的直接子项；把 `grid-column` 写在内层 `.overview-summary` 上不生效——实测被挤到半宽（627px），5 个指标挤成两列、文案全折行。

### 1.42 断言按 `<section id="…">` 切片，控件搬进 `fields.js` 后必然失败

`test-silence-schedule.mjs` / `test-send-limit-console.mjs` 原来把页面 HTML 从 `<section id="section-silent"` 切到下一个 `</section>`，再在片断里找 `id="silentOn"`。控件搬进 `pages/<page>/fields.js` 后，section 里只剩下 `<div data-overview-fields="silence">`，切片里当然找不到。

约定：
- 切片只用来断言**页面结构**（宿主 div、卡片标题），控件是否存在改在整份 `readConsoleSource()` 里找；
- 工厂生成的控件源码里只有 `name: 'x'`（渲染时才变成 id），断言要接受 `id="x"` / `name: 'x'` / `id: 'x'` 三种写法（与 1.18 同一个坑，这里是切片版本）。

### 1.43 工具栏筛选器：`.table-filter` 与 `.select-wrap` 都要按内容收窄

全局 `select { width:100% }` 是给表单用的；`dataTableHtml` 的 `filters` 放在 `.table-toolbar-main` 里，若不收窄，每个下拉占满一整行，工具栏被撑成三行（会话页 2026-11-07 实际踩到）。而且 `initSelects()` 会把每个 `<select>` 包进 `.select-wrap`（默认 `display:block;width:100%`），只给 `select` 写 `width:auto` 仍然不够——箭头会跑到整行最右边。

**规则**：`components/table/table.css` 里同时写 `.table-toolbar .table-filter { width:auto; min-width:116px; flex:0 0 auto }` 与 `.table-toolbar .select-wrap { width:auto; min-width:116px; flex:0 0 auto }`。新页接筛选器时先看一眼工具栏是不是一行。

### 1.44 普通行里的 .select-wrap 同样要收窄，不只工具栏

同一个坑在**非表格的普通行**里也会犯：令牌与花费页的「逐轮花费」行是 .row.usage-controls（一个 select#usageKeySelect + 一个「加载逐轮明细」按钮）。.select-wrap 默认 display:block;width:100%，下拉先占满整行，按钮被挤到下一行，箭头还贴在整行最右（2026-11-07 实测）。

**规则**：任何「一行里放 select + 其它控件」的自定义行，都要给 .select-wrap 写 width:auto + flex:0 0 auto（usage 的做法是 width:auto; min-width:190px; max-width:280px），并让父行 display:flex; align-items:center; flex-wrap:wrap。不要指望 select { width:auto } 单独生效——被包起来的永远是 .select-wrap。

### 1.45 `custom` 字段没有 label 时别留 `.field-row` 空壳

访问与安全页的两个警示块（state 目录权限、SnowLuma 收不到数据）是 `custom` 字段、没有 label。`fieldShell` 原先不管有没有 label 都包一层 `.field-block > .field-row`，而 `.field-row` 有 `min-height:40px`——两个空壳就多出约 102px 空白，看着像「卡片下边距不一致」（2026-11-07 用户报的第 ⑤ 条，实际是第 ⑥ 个空壳问题）。

**规则**：`components/form/form.js` 的 `fieldShell` 里，无 label 时不要生成 `.field-row`；有 label 或需要缩进的注解时保留 `.field-notes`，否则 `.field-error` 直接挂 `.field-block`。迁移时遇到 `{ type:'custom', span:2, html }` 且没有 label 的，先量一下这个字段的高度是不是 0。

### 1.46 折叠组单独成卡时不要另写 summary 样式

插件页与二代仿真页按用户要求把每个 `<details class="settings-group">` 拆成独立卡片（`section.card.span-all.is-group`），一开始给 `.card.is-group summary` 覆写了 `font-size:15px/padding:17px 44px/color:var(--text)`，结果和站内其它页的折叠标题（13px、`var(--text-secondary)`、12px 42px 12px 18px）明显不一致，用户当即指出两处。

**规则**：`.card.is-group` 只做结构性去壳（`.settings-group{margin:0;border:0;border-radius:0;background:none}`、`[open] summary` 只留一条分隔线、`.settings-content` 给卡片内边距），**不要**碰字号/颜色/内边距；需要视觉区分就换个类名，别覆写 summary。同理：`input[type=file]` 这种原生控件要在 `css/base.css` 里统一 `::file-selector-button`，不要在每个页面各写一套。

### 1.47 一行里塞 5+ 个控件不要用 grid 自适应，窄屏必然挤乱

「运行总览 → 静默时段」的时段行原来是 `display:grid` 五列（启用/名称/时间段/哪些天/删），列宽用 `minmax()` 和比例分配。1600 宽看着正常，但窗口缩到 900 左右时每列都低于内容最小宽度，浏览器只能把控件挤成三行：开关+名称一行、时间+下拉+节假日一行、垃圾桶单独一行居中，完全不可读（2026-11-07 用户截图）。给开关定宽只解决了“两行下拉长度不一致”，没有解决窄屏折行。

**规则**：这种「固定几列的编辑行」直接写成表格——`.table-wrap` + `<table class="silence-table">` + `<colgroup>` 固定列宽 + `min-width` 兜底，窄屏横向滚动而不是折行；单元格内控件 `width:100%`，表头文字就是列名。表格天然保证各列上下对齐，也顺带解决了“同一列长度不一致”。改完记得量 `scrollWidth > clientWidth` 才算真的可滚动，而不是把页面撑出横向溢出。

### 1.48 表格迁移时，页面级的表结构 class 与折叠样式会一起丢

「管理行为」页的可折叠分组表（`tr.group-row` + `tr.group-child`）在迁移后不能折叠、样式也没了。原因是折叠的交互与样式都挂在 `.tool-log-table` 这个页面级作用域上（`css/components.css` 里 `.tool-log-table tr.group-row {…}`、`.tool-log-table tr.group-child.hidden { display:none }`），而迁移后的 `#behaviorsBridge` 是组件产出的裸 `<table>`，既没有 `.table-wrap` 也没有 `.tool-log-table`：类名不匹配 → 组行没有底色/三角旋转，`.hidden` 也没有 `display:none`，点了等于没反应。原来自写的 click 处理器还在，但切的是 `hidden` 类，而类被样式忽略。

**规则**：凡是「表格结构 + 交互」的能力，都归 `components/table`，页面只提供数据。
- 分组折叠用 `groupedTableHtml({ columns, groups, openIndex })` + `initGroupedTables(root)`，组行带 `role="button"` / `aria-expanded`，键盘回车与空格也能切换；页面不要再手拼 `tr.group-row`、不要再写 `.hidden` 切换。
- 样式写在组件自己的 `table.css` 里，用 `.table-wrap tr.group-row` 这种与页面无关的选择器；页面级 class（`.tool-log-table` 之类）只用来调列宽，不承载结构。
- 迁移检查清单里加一问：**这张表原来的 class 和 CSS 是不是被留在了页面侧？** 搬 `page.html` 时把表结构一起搬进组件，别只搬数据。

### 1.49 动态插入的开关必须带 `data-field`，否则 `bindSwitches` 不接管

插件页「注入块」表里的启用开关是 `page.js` 用模板字符串拼出来的 `<button role="switch">`，渲染后调了 `bindSwitches(rows)`，但点击完全没反应：`bindSwitches` 的委托选择器是 `[role="switch"][data-field]`，只认 `data-field` 标记（`form.js` 里所有工厂生成的开关都带它）。少这个属性不会报错、`aria-checked` 也不会变，看起来像「保存没生效」。

**规则**：任何手写/动态生成的开关，一律写成 `<button class="field-switch" type="button" role="switch" data-field …>` + `<span class="field-switch-track"></span><span>开</span>`，再对容器 `bindSwitches`；读写用 `getSwitch`/`setSwitch`。排查「点了没反应」时先看三件事：有没有 `data-field`、有没有对**新插入的容器**绑一次、保存时读的是不是 `aria-checked` 而不是某个不存在 `.checked`。

### 1.50 `DELETE` 没带 body 也会被 CSRF 中间件拦成 415

MCP 页删除外部 server 时，前端 `api(path, 'DELETE')` 不带 body、也不带 `content-type`；bridge 的全局 CSRF 中间件要求所有非 GET 必须是 `application/json`，之前只给插件卸载开了特例，所以 `DELETE /api/extensions/mcp/<id>` 直接返回 `415 请求必须是 application/json`，按钮看起来「完全没反应」。用 PowerShell 发同样的无 body DELETE 也复现 415，才确认不是前端按钮没绑事件。

**规则**：标准 DELETE 允许没有请求体，服务端对「无 content-type 的 DELETE」应放行，但仍要做 Origin 校验；不要为了绕过去让前端硬塞一个 `{}` body（后端路由未必有 body schema，还会让「无 body」契约失真）。排查顺序：先看响应码（415 是中间件，400/404 才是路由/参数），再用不带 body 的原始请求复现一次。

### 1.51 前端提交 `{config,secrets}`、后端要扁平字段：保存 400 但按钮「像没生效」

MCP 弹窗的 `parseEditor()` 返回 `{config,secrets}`，保存时原样 POST；而 `POST /api/extensions/mcp` 读的是顶层 `id/transport/command/...`，于是真实新建一直 400。更早的 UI 测试只 mock 了 `POST` 成功，没有校验请求体形状，所以测试全绿、真机全挂。

**规则**：改动「新建/编辑」接口时，前端保存前把 `config` 摊平（`{...config, secrets}`），并用真机创建一条测试数据确认 200；测试夹具里的 mock 路由要记录 body 并按真实后端字段断言，不能只断言「请求发出过」。

### 1.52 `initDataTables` 会用「共 N 条」覆盖自定义统计

MCP 两张表在工具栏传了 `meta: '2 个 server · 2 个工具 · 1 个技能'`，但 `initDataTables` 每次刷新都执行 `meta.textContent = '共 N 条'`，统计瞬间被覆盖。UI 测试因此报「期望 2 个 server，实际 共 2 条」。

**规则**：组件只覆盖自己生成的 meta；调用方传了固定统计时，在 meta 元素上打 `data-table-meta-fixed`，组件检测到就不再改写。页面侧不要靠「刷新后再手动写一次」补救，否则每次翻页/搜索都会回退。

### 1.53 同一语义的标签混用 `.status-badge` 与 `.pill`

MCP 页来源/状态最初用 `.status-badge is-pill`，其他表格用 `.pill`，圆角、底色、字重都不一致；内置来源还是纯文本。用户一眼就看出「和别的表不一样」。

**规则**：表格内的状态/来源/权限标签统一用 `.pill`（中性 `.pill n`、主色 `.pill b`、成功 `.pill g`、危险 `.pill r`）；不要再造页面私有的 badge 样式。新增 `.pill.n` 时要确认 `components.css` 里已有定义，否则 class 存在但样式是空的（静态门禁只查 class 是否有定义，不查视觉效果）。

### 1.54 `section card:true` 必须切到 `<section>` 并自己闭合

把 MCP 弹窗的三段改成卡片时，`renderFields` 仍输出 `<fieldset>`，标题 `legend` 落在卡片框外；同时 `sectionClose` 固定写 `</fieldset>`，`section` 版本会留下未闭合标签，后续 DOM 全被吞。

**规则**：`type:'section', card:true` 时输出 `<section class="form-section form-section--card"><div class="form-section-head"><h3>…</h3></div>`，并用 `sectionClose` 变量记录 `</section>`/`</fieldset>`；改渲染器后至少检查三项：标题在框内、`.cols` 子元素数等于字段数、控制台无 `pageerror`。

### 1.55 模板按钮会破坏表单对齐，能推导的配置不要多造一行控件

MCP 弹窗最初并列放「stdio 模板 / HTTP 模板 / SSE 模板」三个按钮，和 148px 标签列对不齐，用户要求「模板应随连接方式自动切换，不要单列按钮」。

**规则**：连接方式这类互斥选择，模板由 `transport` 推导；切换时先保存旧模式草稿，新模式无草稿再 `templateFor(next)`，有草稿则恢复。不要为「可能有用」再增加一行按钮；表单行越少，标签列越稳定。

### 1.56 测试里重复挂 `dialog` handler 会抛「already handled」

UI 测试顶部已有全局 `page.on('dialog', d => d.accept())`；MCP 删除回归又加了 `page.once('dialog', d => d.accept())`，同一个 confirm 被 accept 两次，直接抛 `Cannot accept dialog which is already handled!`，整轮测试中断。之前 `test-silence` 也踩过同一个坑。

**规则**：一个页面只保留一个 dialog handler；局部测试只 `click` 并等待请求/状态，不再 accept。只有全局 handler 不存在时才加局部 handler，且用 `page.once` 后要确认没有旧的全局 handler。

### 1.57 真机 `pageerror` 先看堆栈来源，Edge 自带扩展不是应用错误

MCP 真机检查一直报 `TypeError: v[w] is not a function`，打印 stack 后发现来自 `chrome-extension://abkclgdmdkokpdkbpdkoiiemhcaafbkg/main...js`，是 headless Edge 自带的扩展脚本，不是控制台代码。

**规则**：`pageerror` 必须记录 `error.stack` 并检查协议/来源；`chrome-extension://`、`moz-extension://` 的错误先排除浏览器扩展，换干净 user-data-dir 复测；不要为浏览器扩展改应用代码，也不要把「有 pageerror」直接当成业务失败。

### 1.58 契约基线是逐字节请求列表，新增行为要显式更新而不是 `--accept-contracts`

MCP 删除回归新增了一条 `DELETE /api/extensions/mcp/test-ext`，`test-console-ui.mjs` 的「所有提交载荷与基线一致」立刻失败；基线是 `console-ui-contracts.json` 的完整请求数组，不是宽松包含。

**规则**：有意新增请求时，只在 `console-ui-contracts.json` 的对应位置插入这一条（本次是数组首位），并在提交说明里写清；不要用 `--accept-contracts` 整份重录（会把其他页面的意外变化一起掩盖）。新增请求后必须重跑完整 UI，确认 30/30 而不是只看单条断言。

### 1.59 `dataTableHtml` 的 `columns` 必须是对象，字符串会让表头整行空白

预设页第一版 `columns: ['预设', '名称', '说明', '授权', '操作']`，表格能出数据、表头却是空白细条：组件按 `column.label` 生成 `<th>`，字符串没有 `label`，渲染成空单元格。技能页一直是 `{ label, width }` 对象，所以没暴露。

**规则**：`tableHtml` / `dataTableHtml` 的列一律写 `{ label, width?, className? }`；需要列宽就显式给，别指望内容撑。新增页先看同目录成熟页的 `columns` 形状，不要凭「字符串数组也能用」的记忆写。

### 1.60 无 body 的 `POST` 也会被 CSRF 拦成 415，前端要么带 `{}` 要么服务端放行

预设页「应用」「回滚」是 `POST /api/extensions/presets/<id>/apply|rollback`，没有业务 body。用 curl 直接 POST 得到 415「请求必须是 application/json」；`api()` 只在有 body 时加 content-type，所以真实按钮也会命中同一拦截。页面里改成 `api(..., 'POST', {})` 后正常。这与 1.50 的 DELETE 不同：DELETE 已在 CSRF 中间件放行无 body；POST 没有，且不应为了一个按钮放宽所有 POST。

**规则**：无 body 的 POST 在前端显式传 `{}`，或在服务端按路由加白名单；不要靠「反正 GET 能过」或删掉 CSRF。联调时用与页面完全相同的 `api()` 调用，不要只测 curl 带 JSON 的版本。

### 1.61 新增片段页要同时改三处静态门禁

预设页接完后 `test-console-static.mjs` 连报两项：`路由器登记了片段页`（精确匹配的 `PAGE_FRAGMENTS` 字符串没加 `presets`）和 `页面手写控件只降不升（presets: 0 → 5）`（`BARE_CONTROL_BASELINE` 没登记 5 个按钮）。两处都是测试数据，不是页面 bug。

**规则**：新增/迁移页面时同时改 `consolePageDirs` 能扫到的 `page.html`、`PAGE_FRAGMENTS` 精确字符串、`pilotIds`、`BARE_CONTROL_BASELINE`；先跑一次 static 看真实计数，再登记基线。不要为了让断言过而把按钮搬回 HTML 或改宽正则。

### 1.62 结构化写 YAML 会重排引号并丢掉原注释

预设页保存 `extensions.yml` 时走 `yaml.dump`，一次「原样保存」把 `allow: ['*']` 改成多行列表、并删掉文件头三行说明注释；`writeMeta` 同理。源码是权威源，注释也是维护信息。

**规则**：结构化保存必须在写盘前保留一段固定说明头（`src/presets/store.mjs` 的 `writeExtensions` 已加「扩展授权：由控制台预设编辑器维护…」），并在验收时 `git diff` 看格式变化；需要逐字节保留注释就只能走 YAML 原文编辑或 CST，不要假装结构化保存无损。

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
- 单选/复选组的标签是否也在 148px 标签列（而不是贴左边缘、控件另起一行）？
- 长文本/代码块是不是只有一层边框（`.field-block` 上有没有误挂 `.code-area` 这类容器类）？
- 页面源码里还有没有 `style="` 或 JS 里的 `.style.`（CSP 会拒绝，静默失效）？
- 一个控件服务多代时（如仿真提示词两代共用一份文本框），校验清单/提示文案是否跟着当前代次变（1.37）？
- 折叠分组（`<details>`）全部展开后，有没有行被裁掉/点不到（1.20 的测试也要先展开）？
- 页面上每个开关点一下：`aria-checked` 和「开/关」文案是否同步翻转？保存后请求体里的布尔值是否跟着变（不是 `undefined`，也不是永远 `false`）？
- 日期字段能否整段键入 `2026-12-25`（不是被年份段吞掉）？点日历按钮能否弹出面板、选完是否回填？
- 时间字段能否整段键入 `9:5` 并归一化成 `09:05`？图标按钮 hover 前后 `getBoundingClientRect().y` 是否一致（1.33）？
- 同一区间的两端是否合成了一行「起始 ～ 结束」，而不是「开始」「结束」两行？
- 页面底部保存栏滚动时会不会盖住表格底栏或最后一行按钮？（已知遗留，见 `STATUS` 第 14 行的待办）
- 每个「单个布尔状态」是不是开关（`role="switch"`）而不是复选框？多选集合、风险确认是不是各自用了 checkbox？
- 有没有文本框在要求用户手打 `YYYY-MM-DD`（应该换成 `type="date"`）？
- 页面上的 `<select>` 是否都已经包在 `.select-wrap` 里、箭头不贴边、展开时会翻转（1.29）？
- 分栏页的标签条是否和它的面板在同一张卡里、中间没有卡片边界（1.38）？
- 分栏标签、批量操作条、卡片头按钮这些「非字段控件」是否写进了 `fields.js` 的 `html` 规格，`page.html` 里只剩宿主 div？
- 表格的搜索/翻页断言是否数的是可见行（`tbody tr:not([hidden])`），「全选本页」是否也只勾可见行（1.39）？

## 4. 剩余页面的迁移顺序与取舍

**骨架已经定了**（`docs/CONSOLE_FORMS.md`「一个页面的固定骨架」+ `scheduler` 样板）：`page-stack` 宿主 + 每张卡 `span-all` + 页头 `.form-inline-bar`（左字段 / 右状态徽标 + 动作）+ 列表卡 `.card-head` + 表格走 `dataTableHtml` + 折叠组走 `settings-group` + `initGroups` 记忆。逐页迁移只换内容，不再各自发明结构。

1. `behaviors`（4 个控件但有三张手写表，按 1.17 换 `dataTableHtml`）→ 2. `plugins`（16，四组折叠 + 详情弹窗）→ 3. `usage`（14，三张手写表 + 两个图表）。
`social-v2`（38→0）、`scheduler`（28→0）、`persona`（27→0）、`slang`（36→0）、`social-v1`（28→0）、`overview`（32→0）、`operations`（10→0）、`sessions`（10→0）、`access`（12→0）与三个只读清单页（`mcp`/`skills`/`reference`）已迁完。
每迁一页：`BARE_CONTROL_BASELINE` 该页改 0、`STATUS` 第 14 行更新数字、截图存档；一页一提交，不要攒。
