# 控制台基础层与组件层改造（清单）

> 状态：**清单已定，未动工**（2026-11-06）。做法是「借 Bootstrap 的组织与纪律，不引 Bootstrap 本体」：零构建、无框架、无预处理器；后端与 DOM 结构不动。
>
> 目标：让「新增一个表单/按钮/徽章」只写类名或调用一次工厂函数，就得和别处一模一样；同时把响应式布局变成显式语义。

## 1. 为什么不是整包 Bootstrap

- 现有 `tokens.css` 已有 163 个变量、控制台样式约 45KB，暗色主题靠覆盖令牌实现；Bootstrap 自带 `--bs-*` 与组件样式，接进来要么重映射几十个变量，要么逐条覆盖——覆盖多了就回到「拼特异性」，而我们刚被这个坑咬过两次（`input[type=search]` 盖掉 `.u-maxw-240`；`.modal` 样式搬家时漏规则）。
- 真正缺的只有两样：响应式网格、表单行（label + 控件 + 提示 + 错误）。表格、弹窗、标签页、徽章、空态、折叠面板都已在用，Bootstrap 的增量不大。
- 现有 23 条浏览器契约按「当前长什么样/点了发什么请求」录的基线，整包换类名等于全量重录，收益不抵风险。

## 2. 主题映射（现有令牌 → 语义层）

原则：**原变量名全部保留、一个不改**；只新增一层语义别名与两组新令牌（间距、断点）。新组件只写语义别名，老样式不动，逐步收敛。

| 语义 | 现有令牌（举例） | 语义别名（新增） | 说明 |
| --- | --- | --- | --- |
| 页面底色 | `--bg` | `--color-bg` | 深浅主题各自覆盖 |
| 卡片/面板 | `--surface` `--card` | `--color-surface` | |
| 次级面 | `--surface-subtle` `--surface-sunken` `--surface-hover` | `--color-surface-2/3` | 表格行、hover |
| 正文/次要/占位 | `--text` `--text-secondary` `--muted` `--placeholder` | `--color-text` `--color-text-muted` `--color-text-faint` | |
| 边框 | `--border` `--border-input` `--border-strong` | `--color-border` `--color-border-strong` | |
| 强调 | `--accent` `--accent-hover` `--accent-soft-bg` `--accent-border-focus` | `--color-accent` `--color-accent-hover` `--color-accent-soft` | 焦点环仍用 `--accent-ring` |
| 语义状态 | `--ok` `--err` `--warn-fg` `--danger-solid` | `--color-ok` `--color-danger` `--color-warn` | |
| 徽章 | `--pill-blue-bg/fg` 等 6 个 | `--badge-{blue,green,red,muted}-bg/fg` | 一一对应 |
| 圆角 | `--radius`(16) `--radius-sm`(10) | `--radius-md`(12) `--radius-pill`(999) | 新组件按 10/12/16 三档 |
| 阴影 | `--shadow-card` `--shadow-md` `--shadow-pop` `--shadow-modal` | `--elevation-1/2/3/4` | 只加别名 |
| 字体 | `--font-ui` `--font-mono` | 沿用 | |
| 字号 | 散落 `12px/13px/14px/15px/17px/20px` | `--text-xs/sm/base/md/lg/xl` | 只在组件里用 |
| 外壳 | `--sidebar-w` `--topbar-h` | 沿用 | |
| **间距** | 无（各处手写 4/6/8/10/12/14/17/20/24/30） | `--space-1..8` = 4/6/8/10/12/16/20/24 | 新组件与网格专用 |
| **断点** | 散在 `@media (max-width:760/900/1180)`、`(min-width:1500)` | `--bp-sm` 760 `--bp-md` 900 `--bp-lg` 1180 `--bp-xl` 1500 | 网格与工具类统一引用 |

## 3. 基础层三件事（2026-11-06 已完成）

> 落地记录：`tokens.css` 末尾新增语义别名 + `--space-1..8` + `--radius-md/pill` + `--elevation-1..4` + `--text-*` + `--bp-*`；新增 `css/grid.css`（`.cols` / `.col-1..12` / `.col-{sm,md,lg,xl}-*` / `.stack` / `.cluster`，断点 760/900/1180/1500）；`components.css` 的基础输入规则改成 `:where(...)` 元素级；`#sessionRenameInput` 补 `type="text"`。静态断言新增 8 条（栅格顺序、语义令牌、`:where` 选择器、页面 input 必须写 `type`）。三档截图（1440/1180/760）与改前一致，`test-console-ui` 23/23、`test-audit` 90/90。

**命名避让**：`.grid` 已是卡片两列网格、`.row` 已是工具栏行，所以栅格容器叫 `.cols`，列叫 `.col-*`；不要复用那两个名字。

### 3.1 修掉「外观挂在 `input[type=…]` 上」

`css/components.css:134` 现在是 `input[type=text],input[type=search],…`。漏写 `type` 就退回浏览器默认外观（改名弹窗已经中招）。

改为元素级选择器（保留 checkbox/radio/file/range 例外）：

```css
:where(input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range])),
:where(textarea), :where(select) { …原有外观… }
```

`:where()` 特异性为 0，后续组件类可以正常覆盖，不会再出现「必须靠顺序压过去」的问题。同时 `pages/sessions/page.html` 的 `#sessionRenameInput` 补 `type="text"`。

### 3.2 新增 `css/grid.css`

- `.row`（`display:grid`、`grid-template-columns:repeat(12,minmax(0,1fr))`、`gap:var(--space-3)`）
- `.col-1..12`，以及 `.col-sm-*` / `.col-md-*` / `.col-lg-*` / `.col-xl-*`（断点取上表）
- `.stack`（纵向堆叠，`gap` 可覆盖）、`.cluster`（横向换行）
- 断点语义：`sm` ≥760、`md` ≥900、`lg` ≥1180、`xl` ≥1500（与现状一致，移动优先 `min-width`，`max-width` 写法在旧样式里保留不动）

### 3.3 `utilities.css` 只加不改

现有 80 个 `u-*` 一个不动，新增响应式显隐：`u-hide` / `u-hide-md` / `u-show-md`（语义：在某断点以下隐藏/显示），以及 `u-gap-1..8`。

## 4. 组件清单（按证据排序）

计数来自 `public/console/**`（2026-11-06）：207 个 `<label>`、210 个 `<input>`、162 个 `<button>`（其中 77 个小号、17 个危险、仅 1 个"主按钮"类）、31 个 `<select>`、38 处 `class="pill…"`、30 处 `settings-group`、7 处 `empty-state`、2 处 `page-tabs`。

**表单是重点**：`field` 不再单独做，统一并入表单系统——12 个控件工厂与 `createForm()` 内核的规格见 ](../../CONSOLE_FORMS.md)，含文本/数字/密码/多行/下拉/单选组/多选组/复选/开关/文件/只读/动作区、类型化取值、字段与跨字段校验、条件显示、提交态与脏值守卫。首个重写目标是 `social-v2`（130 个控件），分「只换壳（请求体逐字节一致）→ 再加校验与条件显示」两步。

| 顺序 | 组件 | 现状问题 | API（`components/<name>/<name>.js`） | 首批迁移 |
| --- | --- | --- | --- | --- |
| 1 | `field` | label 间距/必填/错误态各写一遍；有的 label 与控件不成对 | `fieldHtml({ label, control, hint, error, required, forId })` 返回 `<label class="field">…` 片段；`bindFieldError(root, msg)` | `sessions`（改名弹窗）、`behaviors`、`access` || 2 | `button` | 162 个按钮靠零散 class，小号/危险/主按钮不统一 | `buttonHtml({ label, variant: 'primary'\|'secondary'\|'danger'\|'ghost', size: 'md'\|'sm', attrs })` | 同上 |
| 3 | `select` | 31 处，箭头/宽度/内距各写 | `selectHtml({ id, options: [{value,label}], value })` | `persona`、`social-v2` |
| 4 | `badge` | 38 处手写 `pill g/b/r` | `badgeHtml({ text, tone: 'blue'\|'green'\|'red'\|'muted' })` | 全站逐步替换 |
| 5 | `empty-state` | 7 处各写一段虚线框 | `emptyStateHtml({ title, hint })` | 列表页 |
| 6 | `tabs` | 2 处，样式在 `components.css` | `tabsHtml({ tabs, active })` + `bindTabs()` | `sessions`、`slang` |
| 7 | `collapse` | 30 处 `settings-group` + `settings-content` 靠人记规则（路线图 §12.5） | `collapseHtml({ title, body, open })` | 表单页 |

原则不变：页面专属控件先留页内，出现第二个使用者再上提；组件 js 与 css 同住、css 自包含、不写标签选择器。

## 5. 契约与门禁：哪些必须不变、哪些要重录

### 5.1 必须保持不变（改样式不能动这些）

- **225 个 DOM id 全部存在且唯一**（`scripts/test-console-ui.mjs` 第一条断言「All 225 legacy IDs remain present and every DOM ID is unique」）。
- **25 条接口契约原样**（`scripts/console-ui-contracts.json`）：`POST /api/mode`×5、`/api/roles/create`、`/api/role`×2、`/api/role-mode`×2、`/api/whitelist`、`/api/security`×2、`/api/socialV2/config`×2、`/api/socialV2/activity`×2、`/api/social`、`/api/social/state`、`/api/social/flush`、`/api/slang`、`/api/slang/demo-candidate/confirm`、`/api/slang/config`、`/api/test-send`、`/api/console/notify-ai`。
- 10 个导航目标可达、轮询不清草稿；移动/平板无文档级横向溢出；深色模式与系统偏好；`prefers-reduced-motion` 关装饰动画。

### 5.2 需要重录或新增

| 类别 | 文件/命令 | 改什么 | 何时重录 |
| --- | --- | --- | --- |
| 接口契约 | `scripts/console-ui-contracts.json` | 目标：**0 条变化**。若某控件的默认值/提交时机被改（例如按钮从 `submit` 变 `button`），需 `node scripts/test-console-ui.mjs --accept-contracts` 重录并在提交信息里写明原因 | 仅当交互流程变了 |
| 静态断言 | `scripts/test-console-static.mjs` | 新增：① 外观规则不得再以 `input[type=…]` 为来源；② 表单控件必须走 `fieldHtml`/`selectHtml`/`buttonHtml`；③ 禁止手写 `class="pill…"`；④ `grid.css` 必须在 `components.css` 之前 `<link>`；⑤ 组件目录清单与 `CONSOLE_UI.md` 一致 | 随组件落地逐个加 |
| 截图基线 | `state/ui-*.png`（1440 / 1180 / 760） | `sessions` / `behaviors` / `access` / `persona` / `overview` 三档各一张，逐轮比对 | 每阶段结束 |
| 文档 | `docs/CONSOLE_UI.md` | §2 六条规则扩充为「组件 API + 何时上提 + 禁止写法」；§4 增网格与语义层 | 阶段 1 后 |
| 文档 | `docs/PLUGIN_ROADMAP.md` §8.9 | 追加子步骤 3.1–3.7（基础层 → field → button → select → badge → empty-state/tabs/collapse → 逐页替换） | 阶段 1 后 |
| 文档 | `docs/STATUS.md` 第 14 行 | `Partial` 的「差什么」按阶段更新 | 每阶段结束 |

## 6. 顺序与工时

1. **基础层**（半天）：语义别名 + 间距/断点令牌 + `grid.css` + input 选择器改造 + 改名输入补 `type`。
2. **`field` + `button`**（1 天）：先把 `sessions`/`behaviors`/`access` 的表单行与按钮换过来。
3. **`select` + `badge`**（半天）：`persona`、`social-v2`、`usage` 顺带。
4. **逐页替换**（1–1.5 天）：`overview`、`persona`、`social-v2`（表单最密），每页一次迁完，不留新旧混用的中间态。
5. **`empty-state` / `tabs` / `collapse`**（半天，可选）：纯一致性收益，放最后。

每阶段结束跑：`node scripts/test-console-static.mjs`、`PLAYWRIGHT_MODULE=playwright-core node scripts/test-console-ui.mjs`、`node scripts/test-audit.mjs`，并留三档截图。

## 7. 风险与回滚

- **特异性/顺序**：已踩两次（`search-box` 宽度、`modal` 样式）。对策：组件 css 一律自包含、`:where()` 降特异性、`grid.css` 固定加载在 `components.css` 之前并用静态断言锁住。
- **契约误伤**：把「当前样子」当基线，改样式可能让某些断言变红。对策：阶段 1 只改选择器写法、不改视觉；字段/按钮替换逐页做，红了先看是不是真的变了样。
- **中间态**：新旧混用最容易被误认为「已经统一」。对策：一页一次迁完，提交信息写明迁移范围。
- **回滚**：每次提交只动一层（基础层 / 单个组件 / 单页），可单点 `git revert`；不改后端、不改 DOM id，回滚不会影响会话与提示词链路。
