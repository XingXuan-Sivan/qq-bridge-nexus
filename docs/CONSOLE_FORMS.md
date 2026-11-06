# 控制台表单系统规格

> 状态：**规格已定，未动工**（2026-11-06）。属于 `CONSOLE_UI_REWORK.md` 的第 2 阶段展开，优先级高于其余组件。
>
> 目标：支撑「较复杂的配置表单」——分块、条件显示、校验、脏值守卫、类型化取值、可重写现有 130 控件的 `social-v2` 表单。零构建、无框架：HTML 片段 + 一个轻状态/校验内核。

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
| 只读展示 | `readonlyField()` | `id` `label` `value` | `copy`（一键复制） |
| 动作区 | `formActions()` | — | `primary` `secondary[]` `sticky` |

所有工厂返回 **HTML 字符串**（与现有 `tableHtml` 一致），插入后再由 `createForm()` 绑定事件；不引入模板引擎。

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

## 5. 现有复杂表单的迁移

按控件量排序（2026-11-06 实测）：`social-v2` 130（含 53 个 checkbox）、`slang` 36、`overview` 32、`social-v1` 32、`scheduler` 28、`persona` 27，其余 ≤16。

**试点选 `social-v2`**（最复杂，能验证规格是否够用），分两步走，避免一次改太多：

1. **只换壳不改行为**：把裸 `<input>`/`<label>` 换成工厂 + `createForm` 接管取值与回填，提交仍走原来的 `POST /api/socialV2/config`，**请求体逐字节一致**（用现有 25 条契约兜底）。
2. **再加能力**：条件显示、字段级校验、脏值提示、错误回填。

其余页面按「一页一次迁完」推进：`overview` → `scheduler` → `persona` → `social-v1` → `slang` → 小页面。

## 6. 与契约的关系（硬约束）

- **225 个 DOM id 全部保留**：工厂必须接受调用方传入的 `id` 并原样输出；`scripts/test-console-ui.mjs` 的第一条断言是这道闸门。
- **25 条接口契约不变**：迁移只换 DOM 与取值方式，`POST` 的 path 与 body 必须逐字段等价；任何一处不等价都要在提交信息里写明理由。
- 静态断言（新增）：禁止在页面 html 里直接写 `<input`/`<select`/`<textarea>`（白名单：`components/form/**`）；禁止手写 `.field-error` 文案；每个 `data-field` 必须有同名 `id`。

## 7. 实施顺序与工时

| 阶段 | 内容 | 工时 | 产出判据 |
| --- | --- | --- | --- |
| 1 | 令牌语义层 + `grid.css` + input 选择器改元素级（`CONSOLE_UI_REWORK.md` §3） | 0.5 天 | 三档截图无视觉变化；`test-console-static`/`test-console-ui` 全过 |
| 2 | `components/form/` 内核（取值/校验/依赖/提交态）+ 12 个控件工厂 + 静态断言 | 2 天 | 单独的表单演示页（临时，不入导航）能把 12 种控件、条件显示、跨字段校验都跑通 |
| 3 | `social-v2` 试点：第一步只换壳（请求体逐字节一致） | 1.5 天 | 25 条契约不变；`social-v2` 页三档截图一致；保存后 `/api/socialV2/config` 请求体与改前 diff 为空 |
| 4 | `social-v2` 第二步：条件显示 + 字段校验 + 脏值提示 | 1 天 | 关掉条件字段后不参与提交；错误文案人话；离开前有提示 |
| 5 | `overview` / `scheduler` / `persona` / `social-v1` / `slang` 顺序迁移 | 1.5–2 天 | 每页迁完跑一次契约与截图 |
| 6 | `badge` / `tabs` / `empty-state` / `collapse`（可选） | 0.5–1 天 | 纯一致性收益 |

合计约 7–8 个工作日；阶段 2 结束时给一次规格确认（有需要改的地方此时改最便宜）。
