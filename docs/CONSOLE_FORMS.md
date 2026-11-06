# 控制台表单系统规格

> 状态：**阶段 2 已完成**（2026-11-06）：`components/form/{form.js,form.css}` 落地 16 个工厂 + `createForm` 内核 + 字段注解，演示页 `components/form/demo.html` 兼作回归夹具（`test-console-ui` 新增一组断言）。下一步是第 3–5 步：`social-v2` 试点迁移。
>
> 目标：支撑「较复杂的配置表单」——分块、条件显示、校验、脏值守卫、类型化取值、可重写现有 130 控件的 `social-v2` 表单。零构建、无框架：HTML 片段 + 一个轻状态/校验内核。
>
> 落地时踩到两个坑，已写进实现：① 栅格容器只能用 `.cols`，**不要**再叠 `.row`（`.row` 是工具栏的 flex 行，会把 12 列栅格顶掉）；② CSP 是 `style-src 'self'`，组件里**不能**用内联 `style`（多选列数改 `data-columns` + CSS，等宽字体改类名）。

## 1. 表单的解剖

```
<form class="form" data-form="social-v2">
  <section class="form-section">                    ← 分块（fieldset + legend）
    <div class="form-grid row">                     ← 栅格，复用 grid.css
      <div class="col-12 col-md-6">
        <div class="field" data-field-wrap="maxPerDay">
          <label class="field-label" for="maxPerDay">每天最多 <span class="field-req">*</span></label>
          <div class="field-control"><input id="maxPerDay" data-field="maxPerDay" type="number" …></div>
          <p class="field-hint" id="maxPerDay-hint">超过就静默丢弃</p>
          <p class="field-error" id="maxPerDay-error" role="alert" hidden></p>
        </div>
      </div>
      …
    </div>
  </section>
  <div class="form-actions">刷新 / 保存（主按钮在右）</div>
</form>
```

- `data-field` 是唯一约定：内核按它收集/回填/校验；`id` 必须与 `data-field` 同名且**保持页面现有 id**（契约要求 225 个 id 一个不少）。
- 分块用 `.form-section`（`fieldset` 语义 + 可折叠时加 `<details>`），不再用裸 `<div class="card">` 拼。
- 栅格：桌面 12 列、`md` 起两列、`sm` 起单列；数字类字段默认 `col-6 col-md-4`。

## 2. 控件矩阵

| 控件 | 工厂 | 必填参数 | 关键选项 |
| --- | --- | --- | --- |
| 单行文本 | `textField()` | `id` `label` | `placeholder` `hint` `maxlength` `counter` `prefix` `suffix` `readonly` `disabled` |
| 数字 | `numberField()` | `id` `label` | `min` `max` `step` `unit`（如「条/分钟」）`integer` |
| 密码 | `passwordField()` | `id` `label` | `reveal`（眼睛按钮，默认开） |
| 多行文本 | `textareaField()` | `id` `label` | `rows` `autosize` `maxlength` `counter` `mono` |
| 下拉（单选） | `selectField()` | `id` `label` `options` | `placeholder` `grouped`（optgroup）`searchable`（>15 项时） |
| 单选组 | `radioGroup()` | `id` `label` `options` | `inline` `cards`（卡片式，如运行模式四选一） |
| 多选组 | `checkboxGroup()` | `id` `label` `options` | `inline` `columns` `selectAll` |
| 单个复选 | `checkboxField()` | `id` `label` | `hint` |
| 开关 | `switchField()` | `id` `label` | `onLabel` `offLabel` `hint`（`role="switch"`，键盘可切） |
| 文件 | `fileField()` | `id` `label` | `accept` `maxBytes`（插件安装用） |
| 日期 | `dateField()` | `id` `label` | `min` `max` `valueFormat`（默认 `YYYY-MM-DD`） |
| 时间 | `timeField()` | `id` `label` | `step`（分钟粒度，默认 1）`valueFormat`（默认 `HH:mm`） |
| 日期时间 | `datetimeField()` | `id` `label` | `min` `max` |
| 时间区间 | `timeRangeField()` | `id` `label` | `from` `to` `allowEqual`（默认 true）——静默时段/免打扰就是它 |
| 只读展示 | `readonlyField()` | `id` `label` `value` | `copy`（一键复制） |
| 动作区 | `formActions()` | — | `primary` `secondary[]` `sticky` |

所有工厂返回 **HTML 字符串**（与现有 `tableHtml` 一致），插入后再由 `createForm()` 绑定事件；不引入模板引擎。

### 2.1 日期与时间

用原生 `<input type="date|time|datetime-local">`，**不自绘日历/滚轮**：零构建、移动端与键盘可访问性原生最好、无第三方依赖。代价是弹层外观由浏览器控制，所以只统一「输入框外观 + 值格式 + 校验」，不假装能改弹层。

- **值格式**：日期只接受 `YYYY-MM-DD`；时间只接受 `HH:mm`（`step` 只影响选择粒度，秒位一律丢弃）；空值是 `null`，不是空串。内部一律存字符串，提交原样发（后端现有字段就是这种形态）。
- **时区**：全部按**北京时间**（Asia/Shanghai）解释与展示，字段说明里写明；不做时区下拉——当前所有配置都是本地时间。
- **快捷项**（`quick: true`，可选）：日期给「今天 / 明天 / +7 天」，时间给「现在 / 00:00 / 08:00 / 22:00」。
- **区间**：`timeRangeField()` 渲染两个输入 + 「到」，支持跨零点（`to < from` 表示次日）；校验 `after: 'quietFrom'`，跨零点场景用 `allowOvernight: true` 放行。静默时段、免打扰、定时任务的执行窗口都用它。
- **校验**：`type: 'date'|'time'` 负责格式，`min`/`max` 负责范围，`before`/`after` 负责跨字段先后。

### 2.2 字段上的说明与警告

每个字段可以带四类注解，统一由工厂渲染，不允许页面手写文案块：

| 注解 | 用途 | 视觉 | 无障碍 |
| --- | --- | --- | --- |
| `hint` | 解释「为什么/怎么生效」，例如「按北京时间；留空表示不限制」 | 灰色小字 `.field-hint` | 并入 `aria-describedby` |
| `warn` | 会导致不生效/多花钱的坑，例如「超过上限的回复会被静默丢弃，不提示用户」 | 黄色 `.field-warn`（`--warn-bg/-border/-fg`） | `role="note"` |
| `danger` | 不可逆或安全相关，例如「清空后本地记忆不可恢复」 | 红色 `.field-danger` | `role="alert"`（仅页面加载即需立刻注意时） |
| `docs` | 指向文档/说明页的链接 | 行内链接 | 正常 `<a>` |

块级提示用 `formCallout({ tone: 'info'|'warn'|'danger', title, body })` 渲染 `.form-callout`，放在分区顶部或一组字段之前（例如「以下参数只对二代仿真的群聊生效」）。

**文案规范**：`hint` 写机制与来源，不写「请填写」这类废话；`warn` 必须同时写**触发条件**与**后果**；`danger` 必须写清**不可恢复的是什么**。

## 3. 内核 API

```js
const form = createForm(root, {
  rules: {
    maxPerDay: { type: 'integer', min: 0, max: 200, required: true },
    minGap:    { type: 'number', min: 1, max: 1440 },
    quietFrom: { type: 'time' },
    quietTo:   { type: 'time', greaterThan: 'quietFrom' },   // 跨字段
    keywords:  { type: 'array', maxItems: 20 },
  },
  depends: {                                       // 条件显示/启用
    v2DailyLimit: { on: 'mode', equals: 'reserved2' },
    presetSelect: { on: 'mode', in: ['chat', 'closed-agent'] },
  },
  onSubmit: async (values) => api.post('/api/socialV2/config', values),
});

form.getValues();        // { maxPerDay: 20, quiet: true, keywords: [...] } —— 已按 type 转成数字/布尔/数组
form.getValue('maxPerDay');
form.setValues({ maxPerDay: 30 });          // 回填，触发 depends 重算
form.validate();         // → { ok, errors: { field: '人话错误' } }，并把错误写进 .field-error
form.setErrors({ maxPerDay: '服务端说超限' }); // 服务端错误回填
form.dirty();            // 是否有改动（用于离开前提示）
form.reset();            // 回到 initial
form.on('change', ({ name, value }) => {});
form.destroy();
```

约定：

- **取值类型化**：`type: 'integer'|'number'|'boolean'|'array'|'time'|'string'`；空字符串对 number 返回 `null`，不返回 `NaN`。
- **校验时机**：输入不校验（避免边打字边报红），`blur` 校验该字段，提交前全量校验并聚焦第一个错误。
- **错误文案**：规则内置默认文案（「不能为空」「不能小于 0」「最多 20 项」），也允许 `message` 覆盖；错误同时设 `aria-invalid="true"` 与 `aria-describedby="<id>-error"`。
- **条件显示**：隐藏用 `hidden` 属性（不销毁 DOM，保住 `id` 与草稿）；隐藏字段**不参与**校验与提交。
- **提交态**：提交期间禁用主按钮、加 `aria-busy="true"`、按钮文案「保存中…」；成功 toast + 清 dirty，失败写回字段错误或顶部错误条。
- **脏值守卫**：页面切换/刷新前若 `dirty()` 为真，复用现有「轮询不清草稿」的机制提示；不新增 beforeunload 弹窗（浏览器体验差）。

## 4. 可访问性与键盘

- `label[for]` 必须指向真实 `id`；单选/多选用 `fieldset` + `legend`（视觉上仍是 label 样式）。
- 开关：`<button role="switch" aria-checked>`，Space/Enter 切换；也接受原生 checkbox 加样式（二选一，实现时统一）。
- 错误：`role="alert"` + `aria-live="polite"`；聚焦首个错误字段。
- 焦点环沿用 `--accent-ring`，不允许为了「好看」去掉 `:focus-visible`。

### 布局规范（2026-11-06 定）

- 默认「标签在左、控件在右」：`.field` 是两列网格，标签列宽 `--field-label-w`（默认 132px），控件列自适应；注解（hint/warn/danger/error）都落在控件列，不压到标签下。
- 必填星号放在标签**左侧**（`* 名称`），颜色用 danger；标签**右对齐**、与控件首行对齐。
- 开关、单个复选框与输入框同一水平线（控件列内左对齐、40px 行高），不再单独占一行控件区。
- 窄屏（≤760px）自动退回「标签在上、控件在下」的单列。
- 保存类操作条 `.save-bar` 是页面内的静态块（顶部另有快捷保存按钮），不吸底、不遮挡内容。
### 组件选择规则（2026-11-06 定）

- 单个布尔状态（启用 / 允许 / 自动 / 关闭某能力）一律用 `switchField`：`role="switch"`，文案「开 / 关」，与输入框同高。
- 需要用户确认风险的勾选（「我已了解」「删除后不可恢复」）保留 `checkboxField`，语义是确认不是开关。
- 多选集合用 `checkboxGroup`；单选集合用 `radioGroup`（卡片样式给互斥的模式选择）。
- 同排字段靠 `.cols` + `.col-*` 排布，控件区最小高度 40px、垂直居中，保证基线一致；长文本/提示词用 `span: 2` 占整行。
### 控件标尺与四类非字段控件（2026-11-06 落地）

尺寸只有一个来源：`tokens.css` 的标尺令牌。输入框、下拉框、按钮、开关全部用 `height` 取值，**不许再用 padding 撑高**（padding 撑高会随字号和字体各自漂 3–4px，就是「按钮和输入框差一截」的根因）。

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--control-h` | 40px | 输入框 / 下拉框 / 按钮 / 开关 / `.control-row` 的统一行高 |
| `--control-h-sm` | 32px | `button.small`（表格行内、清单里的次级按钮） |
| `--badge-h` | 22px | 药丸徽标 `.status-badge.is-pill`；比 40px 矮，才能和同行控件垂直居中 |
| `--field-label-w` | 148px | 标签列宽 |
| `--row-h` | `var(--control-h)` | 兼容旧写法 |

例外只有 `textarea`：多行控件不设 `height`，仍用 `padding: 9px 11px`。

**页面不许改原语布局**：`.field-row` / `.field-control` / `.field-block` 的 `display`、`grid-template-columns`、`height` 只能由 `components/form/form.css` 决定；页面 css 里出现这类覆盖会被静态检查拦下（`test-console-static` 的「页面样式不覆盖 .field-row 布局」）。

不是所有东西都是「字段」。以下四类走 `renderFields` 的新类型，不要再手写一行 HTML：

| 类型 | 工厂 | 何时用 | 关键点 |
| --- | --- | --- | --- |
| `custom` | `customField({ id, label, html })` | 一段复合控件（语音库面板、key + 按钮 + 状态位） | 内部排版用 `.control-row`；`label` 仍参与左列对齐 |
| `checkList` | `checkListField({ id, label, options, columns })` | 一组复选框清单（工具开关、权限项） | 取值为**字符串数组**（`readField` 对多 checkbox 有专门分支）；清单项是 `<label>`，必须清掉全局 `label` 的 `margin`；`id` 落在清单容器上（旧页面的 `#v2Tools` 就是这么保住的）；字段要写 `span: 2`，否则会缩在半宽格里；**清单很长时标签顶对齐**（`align-self:start`），这是刻意设计，几何断言只量单行字段 |
| `action` | `inlineActions({ items, status })` | 一行按钮（暂停 / 恢复 / 重置 / 保存） | 按钮变体 `danger` / `primary`；`status` 是同一行的状态位 |
| `status` | `statusBadge({ text, tone, pill })` | 只读状态（`运行中`） | 页头固定高度位置用 `pill: true` |

`.control-row` 是「一行不是字段的东西」的唯一原语：`display:flex; flex-wrap:wrap; align-items:center; gap:8px; min-height:var(--control-h)`。角色类四个：

- `.control-label`：行内小标签（如「发送目标」），不是字段标签，不占 148px 列。
- `.control-grow`：吃掉剩余宽度的输入框（`flex:1 1 160px`）。
- `.control-fixed`：固定宽度的按钮或选择器。
- `.control-note`：行内说明文字（12px、muted），跟在控件后面，不换行到下一行。

页头那一条「开关 + 输入 + 开关 + 状态」用 `layout: 'inline'`：`renderFields(host, spec, { layout: 'inline' })` 不铺 `.cols` 栅格，外层是 `.form-inline-bar`（条内隐藏 `.field-notes`、`.field-control` 取消最小高度）。

三条反模式，评审时直接打回：

1. 在 `page.html` 里写 `<button>` / `<input>` / `<select>` / `<textarea>`（该页还没迁移就按棘轮只降不升，迁移时清零）。
2. 给控件写 `height: 36px` 这类字面量，或给 `.field-switch` 单独定高。
3. 用 `margin` / `padding` 把两个不同高的控件「凑齐」——对齐靠标尺，不靠微调。

## 5. 现有复杂表单的迁移

按控件量排序（2026-11-06 收口后实测，`page.html` 里的手写控件数）：`slang` 36、`overview` 32、`social-v1` 32、`scheduler` 28、`persona` 27、`plugins` 16、`usage` 14、`access` 12、`operations` 10、`sessions` 10、`behaviors` 4、`mcp` 1、`skills` 1、`reference` 0、`social-v2` **0**。

**试点选 `social-v2`**（最复杂，能验证规格是否够用），分两步走，避免一次改太多：

1. **只换壳不改行为**：把裸 `<input>`/`<label>` 换成工厂 + `createForm` 接管取值与回填，提交仍走原来的 `POST /api/socialV2/config`，**请求体逐字节一致**（用现有 25 条契约兜底）。

   > **2026-11-06 第一步已落地（方式 A：DOM 增强，不动页面 HTML）**：`page.js` 的 `init()` 里先 `enhanceForm(section)` 把「label + 控件」就地包成 `.field`，再 `createForm(root, {})`；`saveV2Config()` 的 113 处 `.value`、29 处 `.checked` 读取统一走 `fv(id)`/`fc(id)`（内核读 DOM，读不到再兜底 DOM），写回仍是 `setCheck`/`setValue` 直接落 DOM。**请求体与改前逐字节一致**（`test-console-ui` 的 payload 基线未变，24/24）。三个坑：① `.settings-content > .row label` 的 `flex-basis:100px!important` 会把字段标题撑成 100px 高，已改成 `:not(.field-label)`；② `appendChild` 之后不要再 `remove()`，会把刚挂上的节点删掉；③ 搬完控件再 `insertBefore` 会报 `HierarchyRequestError`，必须先记住原父节点与后继节点。

2. **再加能力**：条件显示、字段级校验、脏值提示、错误回填。

> **2026-11-06 改为方式 B（字段规格 + 统一渲染），方式 A 已废弃**：字段搬到 `pages/social-v2/fields.js` 的 `V2_FIELDS`（8 组、57 字段，含 4 个「上限」补录），`page.html` 只留分组外壳、说明文字与工具开关等交互块，`page.js` 用 `renderFields(host, spec.fields, { columns: 2 })` 铺字段、`createForm` 接管；`enhanceForm` 已删除。取值 `fv(id)` 内核优先、`domValue` 兜底（复选框回布尔），`fc(id) = Boolean(fv(id))`；长文本（关键词、提示词）在 spec 里写 `span: 2` 占整行。验收：payload 契约逐字节一致、225 个旧 id 全在、`test-console-ui` 24/24、`test-audit` 90/90。
>
> 方式 A 的三个坑留作历史教训：`.settings-content > .row label` 的 `flex-basis:100px!important` 会把字段标题撑成 100px 高（已改 `:not(.field-label)`）；`appendChild` 后不要再 `remove()`；搬完控件再 `insertBefore` 会报 `HierarchyRequestError`。

其余页面按「一页一次迁完」推进：`overview` → `scheduler` → `persona` → `social-v1` → `slang` → 小页面。

> **2026-11-06 收口（方式 C：控件零手写）**：`social-v2/page.html` 里已经没有任何 `<input>/<button>/<select>/<textarea>`——顶部状态条、38 个工具开关、语音库面板、8 组动作行、保存栏、3 个长文本全部由 `fields.js` 的 `V2_FIELDS` + `renderFields` 生成。三条硬规则同时进静态检查：
>
> 1. **手写控件棘轮**：`test-console-static.mjs` 里 `BARE_CONTROL_BASELINE` 记录每页当前手写控件数，只许降不许升；迁完一页就把该页基线改成 0。`social-v2` 单独断言必须为 0。
> 2. **类名必须有定义**：`page.html` 里出现的 class 必须能在某个 css 里找到（`btn-secondary`、`u-bold-pad-md` 这类死类名就是被这条挡住的）。三个历史遗留先放白名单：`dsh-model-row`、`u-overflow-auto`、`role-defaults`，迁到对应页面时删掉。
> 3. **页面不许拆原语**：`page.css` 里对 `.field-row` / `.field-control` / `.field-block` 写 `display` / `grid-template-columns` / `height` 一律失败。
>
> 验收方式（本机没有 playwright 时）：`node scripts/test-console-static.mjs` 全过；再用 CDP 截图核对三档宽度下「按钮 / 输入框 / 开关 / 徽标」是否同高居中（见 `docs/CONSOLE_FORM_LESSONS.md` 第 11 条）。

## 6. 与契约的关系（硬约束）

- **225 个 DOM id 全部保留**：工厂必须接受调用方传入的 `id` 并原样输出；`scripts/test-console-ui.mjs` 的第一条断言是这道闸门。
- **25 条接口契约不变**：迁移只换 DOM 与取值方式，`POST` 的 path 与 body 必须逐字段等价；任何一处不等价都要在提交信息里写明理由。
- 静态断言（新增）：禁止在页面 html 里直接写 `<input`/`<select`/`<textarea>`（白名单：`components/form/**`）；禁止手写 `.field-error` 文案；每个 `data-field` 必须有同名 `id`。

## 7. 实施顺序与工时

| 阶段 | 内容 | 工时 | 产出判据 |
| --- | --- | --- | --- |
| 1 | 令牌语义层 + `grid.css` + input 选择器改元素级（`CONSOLE_UI_REWORK.md` §3） | 0.5 天 | 三档截图无视觉变化；`test-console-static`/`test-console-ui` 全过 |
| 2 | `components/form/` 内核（取值/校验/依赖/提交态）+ 16 个控件工厂 + 字段注解（说明/警告/危险/文档）+ 静态断言 | 2 天 | 临时演示页能把 16 种控件、日期与时间区间、字段注解、条件显示、跨字段校验全部跑通 |
| 3 | `social-v2` 试点：第一步只换壳（请求体逐字节一致） | 1.5 天 | 25 条契约不变；`social-v2` 页三档截图一致；保存后 `/api/socialV2/config` 请求体与改前 diff 为空 |
| 4 | `social-v2` 第二步：条件显示 + 字段校验 + 脏值提示 | 1 天 | 关掉条件字段后不参与提交；错误文案人话；离开前有提示 |
| 5 | `overview` / `scheduler` / `persona` / `social-v1` / `slang` 顺序迁移 | 1.5–2 天 | 每页迁完跑一次契约与截图 |
| 6 | `badge` / `tabs` / `empty-state` / `collapse`（可选） | 0.5–1 天 | 纯一致性收益 |

合计约 7–8 个工作日；阶段 2 结束时给一次规格确认（有需要改的地方此时改最便宜）。
