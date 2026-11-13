# CHANGELOG

本仓库（qq-bridge-nexus）起步于 [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge) `v0.2.0-r3`，此后整体重构。
`0.1.0` 是本仓库**首个自有版本基线**；在此之前的上游时期版本号（v0.3.0 – v1.1.2）与本仓库版本线无关，
原始记录存档于 [docs/release/legacy/CHANGELOG-v0.3.0-v1.1.2.md](docs/release/legacy/CHANGELOG-v0.3.0-v1.1.2.md)。

## 0.1.0 —— 2026-11-13

### 变更：控件标尺统一与四类非字段控件（social-v2 表单零手写）
- 新增控件标尺令牌 `--control-h`(40px) / `--control-h-sm`(32px) / `--badge-h` / `--field-label-w`：输入框、下拉框、按钮、开关、状态徽标同源高度，不再靠 padding 撑出约 36–41px 的偏差；`button.small` 走 32px 次级高度。
- 新增 `.control-row` 行原语（`align-items:center` + `min-height:var(--control-h)`）与角色类 `.control-grow`/`.control-fixed`/`.control-label`/`.control-note`，按钮与输入框混排不再手写 `.row` 平行结构。
- `renderFields` 新增四种渲染类型：`custom`（复合控件槽）、`checkList`（多选清单，取值为字符串数组）、`action`（按钮行 + 状态位）、`status`（只读徽标），并支持 `layout:'inline'` 的页头条布局；栅格按断点分列（两列在 md 分开，三四列在 lg 分开）。
- `.status-badge` 收敛到 `components.css`（`layout.css` 不再定义），新增 `.is-pill` 药丸态；social-v2 顶部「运行中」改用该徽标，文字与同行控件垂直居中。
- social-v2 的 `page.html` 做到**零手写控件**：38 个工具开关、语音库调试行、8 组动作行、保存栏、3 个长文本全部由 `public/console/pages/social-v2/fields.js` 的规格生成；`[data-v2-tool]` 改走表单值 `v2Tools`（数组），旧 `id="v2Tools"` 由清单容器保留。
- 浏览器回归：`router.hydratePage` 在 `init()` 之后给页面打 `data-page-ready="1"`，`test-console-ui` 等待该标记，避免量到「片段到位但字段还没渲染」的空壳；几何断言只量单行字段（清单行刻意顶对齐）。
- 防回归：`test-console-static` 增加控件标尺、四类原语、`.status-badge` 唯一定义、页面不得改原语布局、页面 class 必须有定义等断言，并把手写控件数量做成只降不升的棘轮（social-v2 基线 0）。
- 门禁：`npm run test:audit` 90/90，`PLAYWRIGHT_MODULE=playwright-core npm run test:console-ui` 25/25。

### 变更：表单标签右对齐、顶部状态条、保存条吸底与语音开关
- 标签列改为右对齐、与控件首行对齐；多列表单列间距加到 32px。
- social-v2 顶部三个常用项（启用二代模式 / agentPreset / 提供推荐值）收成一条状态条（不再占三行表单），右侧显示运行状态。
- 暂停/恢复/重置三个操作与「保存当前参数」合并到页尾保存条；保存条恢复为吸底浮动（不透明 + 上投影），顶部重复的保存按钮移除（对应旧 id `v2ConfigSaveTop` 一并退役，契约从 225 个减为 224 个）。
- 开关悬停不再加深底色/上浮/加阴影（保留键盘焦点环），避免看起来像按钮。
- 语音库调试行的「只校验不发送」从复选框换成开关，与发送目标输入框同一行对齐。
### 变更：表单改为「标签在左、控件在右」的标准布局
- `.field` 从纵向 flex 改成两列网格（`--field-label-w` 默认 132px），注解与错误行落在控件列；≤760px 自动退回上下堆叠。
- 必填星号移到标签左侧；开关与单个复选框与输入框同高同行（40px），不再「浮」在标签下方。
- `checkboxField` 不再在控件里重复标签文案（标签已在左列）。
- 保存条 `.save-bar` 从不透明悬停块改为页面内静态块，不再遮挡下方内容（顶部「保存当前参数」按钮保留）。
- 标签列宽 148px、列间距 20px；social-v2 的「推荐*」字段标签统一去掉「推荐」前缀，避免标签折行。
### 变更：表单开关统一为 switch，同排字段对齐
- 单个布尔开关从复选框换成 `switchField`（`role="switch"` + 开/关文案），social-v2 共 12 处；确认类复选框（如「我已了解风险」）仍保留复选框语义。
- 顶部「启用二代模式 / 提供推荐值 / agentPreset」并入字段规格（`V2_FIELDS.header`），不再手写行结构。
- `.field-switch` 高度对齐输入框（40px）、`.form-cols .field-control` 垂直居中，同排字段基线一致。
- 开关态同步：`setCheck()` 识别 `role="switch"`，写 `aria-checked` 与开/关文案（此前写 `checked`，对按钮无效，导致「启用二代模式」显示为关）。
### 变更：二代仿真配置页改为「字段规格 + 统一渲染」
- 新增 `pages/social-v2/fields.js`（`V2_FIELDS`：8 组、57 字段），`page.html` 只保留分组外壳与说明；字段由 `renderFields(host, spec, { columns: 2 })` 渲染，默认两列、长文本用 `span: 2` 占整行。
- 删除 `enhanceForm`（不再有页面使用）；取值统一 `fv/fc`（内核优先、DOM 兜底），写回仍落 DOM。
- 验收：payload 契约逐字节一致、225 个旧 id 全在、`test-console-ui` 24/24、`test-audit` 90/90。
### 变更：二代仿真配置页换壳为表单组件（DOM 增强）
- `enhanceForm(root)`：把既有「label + 控件」就地升级成 `.field`（标题、控件、错误行），页面 HTML 不改；`social-v2` 在 `init()` 里升级后挂 `createForm`。
- `saveV2Config()` 的 113 处 `.value` 与 29 处 `.checked` 读取改走内核（读取时直接读 DOM），写回仍是直接写 DOM；请求体与改前逐字节一致，`test-console-ui` 的 payload 基线未变（24/24）。
- 修 `.settings-content > .row label` 的 `flex-basis:100px!important` 误伤字段标题（改 `:not(.field-label)`）。

### 新增：表单组件（`components/form/`）
- 16 个控件工厂：文本、数字、密码、多行文本、下拉、单选组、多选组、单复选、开关、文件、日期、时间、日期时间、时间区间、只读展示，加动作区；全部返回 HTML 字符串，与 `components/table` 的写法一致。
- `createForm(root, { rules, depends, onSubmit })` 内核：按类型取值（空数字是 `null` 不是 `NaN`）、字段与跨字段校验、`blur` 才报错、条件显示（隐藏字段不参与校验与提交）、提交态、`dirty()/reset()`、`setErrors()` 服务端错误回填。
- 字段注解统一由工厂渲染：`hint`（灰）、`warn`（黄，写触发条件与后果）、`danger`（红，写清不可恢复的是什么）、`docs`（链接），另有块级 `formCallout()`。
- 日期时间用原生控件，值格式 `YYYY-MM-DD` / `HH:mm`，按北京时间；`timeRangeField` 支持跨零点与「开始≠结束」校验。
- 演示页 `components/form/demo.html`（不进导航）铺满 16 个控件与三类注解，同时作为 `test-console-ui` 的回归夹具：19 条断言覆盖取值/条件显示/校验/开关/脏值与 `reset`。

### 变更：控制台基础层（语义令牌、12 列栅格、输入外观改元素级）
- `tokens.css` 新增语义别名与 `--space-1..8`/`--radius-md`/`--elevation-*`/`--text-*`/`--bp-*`；原 163 个令牌一个未改，别名用 `var()` 指向它们，深色主题自动跟随。
- 新增 `css/grid.css`：`.cols` + `.col-1..12` + `.col-{sm,md,lg,xl}-*` + `.stack`/`.cluster`，断点与现有 760/900/1180/1500 对齐；`index.html` 中排在 `components.css` 之前。
- 基础输入外观从 `input[type=text]` 一串改为 `:where(input:not([type=checkbox]):not([type=radio])…)`：漏写 `type` 不再退回浏览器默认描边（改名弹窗就是受害者），且特异性为 0，组件类可正常覆盖。
- `scripts/test-console-static.mjs` 增 8 条断言（栅格顺序、语义令牌、`:where` 选择器、页面 `<input>` 必须写 `type`）；`console-ui-fixture` 与 `console-source` 同步 `grid.css`。

### 变更：控制台组件目录化，搜索框外观收口到组件
- 新增 `public/console/components/<name>/{<name>.js,<name>.css}`：`message` / `modal` / `table` 从 `js/components/` 与 `css/components.css` 迁入，js 与 css 同住；`index.html` 逐个 `<link>` 组件样式，`src/bridge.js` 的静态放行加 `components`。
- 新增 `search-box` 组件：`searchBoxHtml()` / `bindSearchBox()`；6 处搜索框统一成 `type="search" class="search-box"`，删掉 `components.css` 里的 `.search-wrap input,input.search-box` 组合规则。
- 修掉「页面里的搜索框没有外观」的根因：漏写 `type` 导致 `input[type=…]` 基础规则不命中。窄版宽度改用组件自己的 `input.search-box--w240`（通用 `.u-maxw-240` 会被 `input[type=search]` 的 `max-width:100%` 盖掉）。
- `scripts/test-console-static.mjs` 增组件目录、样式归属、`type="search"` 三类断言；`scripts/console-ui-fixture.mjs` 与 `scripts/console-source.mjs` 同步支持 `components/`。

### 修复：soulkit 人格卡按 key 形态读不到
- soulkit 的绑定按 `<group|private>:<id>` 存，而桥接的会话 key 是 `<platform>:<kind>:<id>`；`plugins/soulkit-persona` 直接把带平台前缀的 key 传过去，`/api/persona/card` 一律回 `mode: "none"`（表现是会话页「未挂卡」、日志 `人格卡刷新失败`）。
- 适配器新增 `soulkitKey()`：认得出新形态就剥成 `<kind>:<id>` 再请求，认不出原样透传；**soulkit 侧未改**。
- 真机复测 `/api/persona/sources` 恢复 `source: "provider"`、`name: "魅魔2"`；`test-soulkit-persona` 新增对应用例（8/8）。

### 变更：会话页按「会话映射」呈现，搜索框外观统一
- 「会话与审批」页的会话签改名为「会话映射」：只呈现平台侧身份与状态（key 里的平台前缀加了 `qq` 徽章），去掉「DSH 会话」列，不再在这一页暴露 DSH 侧 id。
- 新增「平台」筛选（按 key 前缀现算选项，不写死 `qq`），与原有「类型」筛选、关键词搜索一起收窄列表。
- 操作只留「改名」：清除上下文等会改动会话配置的按钮从这一页移除（改名仍然写回 DSH 侧栏标题）。
- 搜索框统一：新增 `class="search-box"`，与右上角全局搜索共用 `components.css` 的一条规则（`10px` 圆角 / `12px` 字号）；`behaviors`、`sessions`、`slang` 三页五个输入框都套上了，`layout.css` 里重复的 `.search-wrap input` 外观声明删除。
- 约定写进 ](./docs/_internal/PLUGIN_ROADMAP.md) §12 第 8 条，避免以后新页面又用裸 `<input>`。

### 变更：会话 key 只剩一种形态，删除 `platform.keyedFormat` 开关
- 会话 key 统一为 `<platform>:<group|private>:<id>`（qq 即 `qq:group:1`）。旧的 `group:1` 只在**读取侧**由 `parseKey()` 兼容，不再有任何产出路径，也不再有任何开关。
- 解析侧全面迁移：`mode-gate`、`prompt-blocks`、`role-per-key`、`role-refresh`、`mode-handover`、`voice-core`、`memory-policy`、`cross-group`、`scheduler/engine` 里只认旧形态的正则 / `split(':')` / `startsWith('group:')` 一律换成 `parseKey()` / `isGroupKey()` / `isPrivateKey()`。
- 修掉一个**真实发送失败**：`sendToQQ` 及另外 7 处 `key.split(':')` 在 `qq:group:1` 上会解出 `kind='qq'`、`id='group'`，实际调用 `sendGroupMessage(null)`；现在统一 `parseKey()`。
- 接口容错：HTTP 的 `key` 参数（19 处 query、35 处 body）、`ensureSession()`、审批登记表都经 `apiKey()` / `normKey()` 归一，旧形态请求不会 404。
- 修复因解析侧未迁移导致的**私聊静默丢失**（消息在准入闸门被丢弃、日志无任何输出）；详见 `docs/STATUS.md` §6.1 / §6.2。
- 门禁：`test-session-key` 11/11、`test-integration-v030` 31/31、`npm run test:audit` 90/90。

### 控制台：会话清单与审批标签页（PARITY D3 / D7 第一步）
- 「会话与审批」页不再用两张卡片平铺：改成 **会话 / 审批 / 提问** 两个标签页，共用同一张卡片。标签页样式抽成通用 `.page-tabs` / `.page-tab`（与黑话页的 `.slang-tabs` 同一套规则），页面不再各写一份。
- 会话清单从「key + DSH 会话 ID + 类型」扩成完整一行：**模式**（含封闭 Agent 的权限级别）、**人格来源**（provider / 全局卡 / 未挂卡，`stale` 标「缓存」）、**未读数**、**最近唤醒时间**、DSH 会话 ID，以及「改名 / 清除上下文」两个动作。
- 新增 `POST /api/session/rename`：标题在桥接侧归一化（折叠空白、去控制字符、限 60 字），只调 DSH 的 `session.rename`，**桥接不另存一份标题**（存了就会和 DSH 侧栏打架）。空标题 / 超长 400，会话不存在 404，DSH 失败 502。
- `GET /api/sessions` 一次给全：`kind` / `id` / `mode` / `preset` / `level` / `persona{source,name,stale}` / `unread` / `lastWakeAt`。页面不再为了凑一行依次打四个接口。
- 测试：`test-audit-bridge` 新增改名用例（400/404/标题归一化/只调一次 `session.rename`）；`test:audit` 90/90。

### 文档：真机联调记录与 STATUS 更新（2026-11-05）
- `docs/_internal/STATUS.md`（本地台账，不入库）新增 §5「真机联调记录」：记下已验证项（SnowLuma 连接、白名单、chat 回复、reserved2 唤醒、三个注入块各 2 次调用、soulkit 人格卡）与未验证项。未验证的回复发送不是 nexus 缺陷，而是 DSH profile 的 MCP server 仍指向 `qq-bridge-enhanced` 的脚本（读 enhanced 的 `config.json`，端口 3100，`ECONNREFUSED`）；修复动作已写明（`setup-dsh` 重指 + 重启 DSH）。
- 同步把 §1 第 1 行从「从未跑过」改为按证据描述差什么，依赖列补「MCP 指向 nexus 并重启 DSH」。

### 新增：技能清单注入（路线图 §9.2）
- `src/skills/index.mjs`：只读扫描技能根目录（`SKILL.md` 前 600 字，认 `name` / `description`），不执行脚本、不跟随符号链接，目录缺失或损坏只跳过。
- 唤醒提示新增内置块 `core-skills`（priority 150）：标题 1 行 + 最多 `skills.maxEntries` 行 + 溢出提示 1 行，每条只给「名字：一句说明」——**行数由配置固定，不随技能数量膨胀**，全文由 AI 需要时自己读 `SKILL.md`。
- 根顺序：`config.json` 的 `skills.dirs` → `DSH_HOME/skills` → 仓库 `skills/`，同名技能以先出现的为准；扫描结果缓存 60 秒。
- 配置白名单：`skills.enabled` / `maxEntries`（1–40）/ `maxChars`（100–8000）/ `maxDescriptionChars`（8–120）/ `dirs`（≤8 条）；也可用 `promptBlocks['core-skills'].enabled` 单独关块。
- `/api/extensions` 的技能列表改为同一个 `skillIndex`：控制台「技能」页与提示词注入同源（此前是两份扫描逻辑，页面上有、提示词里没有）。
- 测试：`scripts/test-skills-index.mjs` 8 条 + `test-core-prompt-blocks.mjs` 的 `core-skills` 端到端用例；`test:audit` 89/89。

### 文档：一页可复核的未完项清单（2026-11-05）
- 新增 `docs/STATUS.md`：把散在路线图、提交信息与口头汇报里的「没做完 / 只做了一半 / 卡在别人身上」收敛成一张表，每项写清 **是什么 / 完成判据 / 依赖 / 优先级**，状态只允许 `Done`、`Partial`（括号里写差什么）、`Blocked`（括号里写等什么）。
- 与路线图分工：路线图写「打算怎么做、为什么」，状态清单写「现在到哪、还差什么、怎么复核」；`Partial` 不许写成 `Done`，阶段收尾先对表。同时列出明确不做的项（指向路线图 §10），避免把「决定不做」混进「还没做」。
- 文档索引 `docs/README.md` 增加入口。

### 样式：控制中心与控制台共用一套设计令牌（2026-11-05）
- `public/console/css/tokens.css` 补 13 个通用令牌：`--font-ui`/`--font-mono`、`--on-solid`、`--danger-solid`、`--radius-sm`，以及终端面板的 `--term-bg`/`--term-fg`/`--term-fg-dim`/`--term-tag`/`--term-err`/`--term-warn`/`--term-system`/`--term-cmd`。按语义命名，不标「某端专用」——控制台以后做日志/终端视图可直接用。
- 控制中心 `app.css` 删掉自己的 `:root` 与 `prefers-color-scheme`，15 个本地变量全部映射到共享令牌（`--panel→--surface`、`--panel2→--surface-subtle`、`--line→--border`、`--bad→--err`/`--danger-solid`、`--chip→--surface-chip`、`--warn→--warn-fg`/`--warn-border`、`--term→--term-bg`、`--radius→--radius-sm`、`--mono→--font-mono`），并去掉旧色值字面量。
- launcher 新增固定文件路由 `/shared/tokens.css` 与 `/shared/theme-boot.js`（只这两个文件，不走目录遍历）；控制中心页面先加载它们再加载 `app.css`——两个页面现在真的读同一份文件，主题都走 `data-theme`。
- 控制台同步：`base.css` 字体改用 `--font-ui`、主按钮白字改用 `--on-solid`；`utilities.css` 与 `components.css` 的等宽栈统一用 `--font-mono`（原来 `var(--mono)` 落空，另有 5 处硬编码 Consolas）。
- 测试：`test-console-static` 断言控制中心无 `:root`/媒体查询、先加载共享令牌、引用的 28 个令牌都存在；`test-control-center` 新增 `/shared` 两个文件的 200/MIME/字节一致断言。

### 修复：控制台 401 门页外置 + 页面 cookie，无令牌不再白屏、刷新不再闪门页（2026-11-05）
- 根因：`43378be` 去掉 CSP 的 `unsafe-inline` 时，`bridge.js` 里那张 401 页仍是内联 `<script>`，被浏览器直接拦掉 ⇒ `body` 为空、只剩标签「需要令牌」。
- 门页单独放 `public/console/gate/{index.html,gate.css,gate.js}`：整页文档不能并入 `pages/`（那里会被 `console-source` 拼进控制台源码）；401 时读 `index.html` 原文返回（缺文件 500 兜底），脚本/样式全部外链，`bridge.js` 不再内联任何登录页 HTML/JS。
- 刷新不再闪门页：页面鉴权通过后服务端种 `qq_console_token`（`Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`，30 天滑动），之后刷新导航直接 200；cookie 只参与页面 GET，API 仍只认 `x-console-token`，取值优先级 `?token=` > cookie > 头。
- 门页脚本放在 `<head>` 先于样式表执行：带本地令牌时在首绘前直接 `/?token=…#page`；被服务端拒绝（URL 带 `?token=` 仍 401）就清掉本机令牌、抹掉地址栏里的失效令牌并提示「令牌无效或已更换」；`?manual=1` 跳过自动尝试（控制中心「手动输入」入口）。
- 会话内不再弹原生 `prompt`（那是和门页重复的第二套登录 UI）：控制台 API 401 统一 `location.replace('/?reauth=1' + hash)`，门页清掉旧令牌并提示「登录状态已失效」；`reauth=1` 时服务端即使页面 cookie 仍有效也强制回门页，避免「cookie 有效但页面拿不到令牌」变成 401 → 控制台 → 401 循环。
- hash 回跳：门页把 `location.hash` 拼进 `/?token=…#page`，`api.js` 落盘后 `replaceState` 还原；`?token=` 现在对 `/console` 与 `/console/` 同样生效；`api.js` 里已无用的 `consoleTokenTried` 清掉。
- 测试：`test-control-center` #17 改为断言门页在 `gate/`、是完整文档、外链脚本、hash/manual/清令牌，并断言 `bridge.js` 不再内联、读新路径、种 cookie；`test-console-static` 把门页纳入内联 style/script 扫描与 `node --check`。三套用例：console-static 全过、control-center 21/21、http-boundary 7 pass + 1 skip。

### 重构：会话策略指纹收进 `src/session/policy.mjs`（P7 第三步收尾，2026-11-05）
- `sessionPolicy()` 与 `isCurrentSession()` 从 `bridge.js` 搬出，`bridge.js` 只留两行薄包装。指纹由「模式 + 模式预设 + （closed-agent 才有的）管理员/级别/权限预设」组成；**级别只在 closed-agent 进指纹**是有意为之——漏了它，「管理通道提权成功但旧会话继续按低权限跑」；多算易变量则「每次检查都判过期、会话无限重建、反复读卡烧 token」。
- `isCurrent()` 把「仍被允许 + 映射没换 + 指纹没变」三条件写在一处，缺一条就会复活幽灵会话。
- 新增 `scripts/test-session-policy.mjs`（9 条）：chat 指纹只含模式+预设、私聊 null 稳定成空串、closed-agent 级别变化必须改指纹、`plan.ok=false` 时预设位空串、非 closed-agent 级别不进指纹、三条件、缺参不抛、缺依赖构造即报错。VM 夹具补 `createSessionPolicy`。

### 收口：三项长期「既有失败」修绿（P7 第五步，2026-11-05）
- **红着就等于没有这条断言**，而这三项恰好都在安全/可用边界上。逐条真因与处理：
  - `test-preset-local-tools` #5：守卫名单按目标版本（DSH 0.3.x）写，本机是 0.1.1-rc.2，15 个 0.3 才有的工具名在安装目录里本来就不存在。加 `TOOL_NAMES_ADDED_AFTER_0_1` 豁免集 + 版本判定：**只有本机 DSH < 0.3 才豁免**，升级后自动恢复严格（版本读不到时从严）。既不逼人删真名字，也不给拼错名字长期开洞。
  - `test-control-center` #20：迁移守卫检查「旧目录 WebUI 端口是否在监听」，用例假目录没写 `runtime.json` ⇒ 落默认 6099，本机真开着 SnowLuma 时被误判「运行中」而 409。用例改为写 `config/runtime.json` 的 `webuiPort`，端口由 `freePort()`（绑 0 再关）现取，产品逻辑不动。
  - `test-mac-app` #2：`control-center.command` 被 Windows 编辑器改成 CRLF，而断言用 `else\n` 锚点 ⇒ 整条不匹配。读入后统一 `\r\n → \n` 再断言。
- 另外修掉 `interface-platform` 的一条**偶发**红：「健康阶梯」断言 `nickname === '测试机器人'` 时只等了「账号出现在列表里」，而上游登录信息是随后一拍才回报的 —— 现在等到 nickname 就位再断言（连跑 3 次均 14/14）。
- 结果：`npm run test:audit` 不再有「已知失败」项，`test-preset-local-tools` 7/7、`test-control-center` 21/21、`test-mac-app` 3 pass + 1 skip（macOS 专属）。
### 重构：SnowLuma 接收链路健康搬进 `src/upstream/snowluma-health.mjs`（P7 第四步，2026-11-05）
- 健康状态机、快照文案与 `get_status` 兜底轮询从 `bridge.js` 搬出（−104 行 → +33 行接线），`bridge.js` 只喂心跳/状态事件、保留 `pollSnowlumaStatus()` / `startSnowlumaWatch()` 两个薄包装；日志、`fetch`、时钟、定时器、告警阈值全部注入，可用假时钟驱动。
- 这一步真正收口的是**两个故障面不能混**：`good=false` 是 SnowLuma 自报 **[Hook] 收不到 QQ 数据**（消息进不来），长时间没有事件包只是**进程/WS 静默**（心跳由它自己无条件发，不代表 hook 死了）——排查方向完全不同，以前这两种情况共用一条 `degraded` 布尔与一段文案。
- 新增 `scripts/test-upstream-snowluma-health.mjs`（10 条）：非布尔 good 忽略、两种 hint 互不串味、同时故障优先报「确认坏」、边沿告警只报一次、恢复只报一次、轮询成功/HTTP 非 ok/抛错三种路径、`startWatch` 只启动一次且 5s 首轮 + 30s/60s 两个定时器。
- 既有 `scripts/test-snowluma-upstream-health.mjs` 同步改为**两侧断言**：取值逻辑看模块（`/get_status`、`body.data?.good`），接线看 bridge（`createSnowlumaHealth`、`snowlumaHealth.pollStatus`）——否则搬家后这条最重要的断言会静默失效。
- 验证：新用例 10/10、既有用例 9/9、`test-integration-v030` 31/31、`test-audit-bridge` 全 PASS、全量 `test:audit` **82/85**（三项既有失败不变）。

### 重构：上游编排的两条纯策略抽成模块（P7 第四步收尾，2026-11-05）
- `src/upstream/dsh-probe.mjs`：把「探活失败时按 10s 节流重新识别 DSH 随机端口、识别到就重试一次」从 `checkDsh` 的闭包里抽出来。以前这段只能靠「起整桥接 + 关掉 DSH」验证，现在可以断言「首次即可重识别」「窗口内不重复扫端口」「识别到地址但探活仍失败时不能算恢复」。顺带修掉一处重复日志（重新识别的提示原先会打两遍）。
- `src/upstream/snowluma-conn-update.mjs`：把「HTTP token 与 WS token 是两个不同的值」「发现到的端点该不该跟随」压成一张决策表。`snowluma.followDiscoveredEndpoint=false` 或经接口平台时**只自愈 token、绝不改 URL、绝不写回 config.json**——这条以前靠「改 cfg 之后再恢复」维持，现在由 `persistUrl` 直接表达，不会再漏。
- 新增 `scripts/test-upstream-dsh-probe.mjs`（8 条）与 `scripts/test-upstream-conn-update.mjs`（8 条）；夹具补 `createDshProbe` / `resolveConnectionUpdate` 注入。
- 边界说明：MCP server 由 DSH 以子进程方式启动（桥接只维护清单、不 spawn、不分配端口），因此第 4 步在上游侧没有「MCP host 启停」可搬；`bridge.js` 里剩下的上游代码是事件接线与模式/队列联动。

### 重构：会话映射表收进 `src/session/registry.mjs`（P7 第三步收尾，2026-11-05）
- `state.sessions` / `state.sessionPolicies` 的 46 处直接读写全部换成注册表方法：`get` / `policyOf` / `has` / `keys` / `ids` / `entries` / `raw` / `bindSession` / `setPolicy` / `drop` / `dropPolicy` / `unbind` / `isCurrent` / `clearAll`。
- 收口的价值在两条此前只写在注释里的规则：**映射与策略指纹必须成对维护**（只写映射不写指纹 ⇒ `isCurrentSession()` 永远判旧、会话无限重建；只删映射不删指纹 ⇒ 下次同 id 会被误当新会话），现在由 `bindSession()` / `unbind()` 保证。
- 注册表接 `() => state` 的 getter 而非 state 对象——`loadState()` 会整体替换 `state`，闭包旧引用会过期；`scripts/test-session-registry.mjs` 7 条专门钉住这个回归。
- `sessionPolicy()` 仍留在 `bridge.js`：它拼的是 `modePreset()` / `closedAgentPlan()` 的口径，属于模式层。
- 迁移时踩到一个自引用坑：`/api/compact/config` 里局部变量就叫 `sessions`，被机械替换成 `const sessions = sessions.entries()` ⇒ TDZ `Cannot access 'sessions' before initialization`，`test-auto-compact` 立刻打红；局部变量改名 `rows` 修复。教训：批量替换前先查同名局部变量。
- 验证：`test-session-registry` 7/7、`test-integration-v030` 31/31、全量 `test:audit` 除三项既有失败外无新增。

### 重构：`sessions.json` 读写搬到 `src/session/store.mjs`（P7 第三步续二，2026-11-05）
- `loadSessionState()` / `saveSessionState()` 从 `bridge.js` 搬到 `src/session/store.mjs`，`loadState()` / `saveState()` 只剩两行调用；文件、原子写、日志、`normalizeDormant` 全部由调用方注入，模块内不读全局。
- 这一步的真正目的是把两条安全不变量变成可离线验证的代码：**读失败或 JSON 损坏 ⇒ `writable:false`，此后任何一次保存都不得回写**（早期实现读到坏文件就当空状态，紧接着的原子写会把空映射永久落盘）；**老文件缺 `sessionPolicies` / `dormantSessions` 就地补齐**，不因少一个键把整份判成不可用。
- 新增 `scripts/test-session-store.mjs`（8 条）：ENOENT 空状态、BOM 剥离、缺字段补齐、`sessionPolicies` 数组被重置、`normalizeDormant` 注入生效、损坏 JSON ⇒ 只读 + 日志、非 ENOENT 读错 ⇒ 只读、`writable:false` 时 save 既不调用原子写也不改动原文件；已登记进 `test:audit`。
- VM 夹具 `scripts/audit-bridge-harness.mjs` 再补 `loadSessionState` / `saveSessionState`（第三次踩同一个坑：夹具剥 import，漏补就是 `ReferenceError`）。
- 验证：`test-session-store` 8/8、`test-integration-v030` 31/31、`test-audit-bridge` 全 PASS；全量 `test:audit` **80/83**（仍为三项既有失败）。

### 重构：会话准入闸门搬到 `src/session/mode-gate.mjs`（P7 第三步续，2026-11-05）
- `allowed`（白名单：deny 优先、单复数键名、空表按 `allowAllWhenEmpty`）、`modeAllowed`（closed-agent 只放行 owner 私聊，chat/reserved/reserved2 走白名单）、`isSessionAllowedInCurrentMode`（`group:`/`private:` 形态校验）从 `bridge.js` 搬到 `src/session/mode-gate.mjs`，保持纯函数、`cfg` 由调用方传入，行为逐字不变。
- `bridge.js` 只留 `isSessionAllowedInCurrentMode(key)` 薄包装（转调 `sessionAllowed(key, cfg, currentMode)`），`builtin.mjs` 的 `acl: { allowed }` 接线不变；这些判断原先各有 7 / 18 / 多处调用，散在 14k 行里，改规则只能靠全量回归。
- 新增 `scripts/test-session-mode-gate.mjs`（6 条）：白名单空表语义、单复数键名与字符串 id、deny 优先、closed-agent 只看 owner 私聊、三种聊天模式、非法 key 形态拒绝；已登记进 `test:audit`。
- VM 夹具 `scripts/audit-bridge-harness.mjs` 补 `allowed` / `modeAllowed` / `sessionAllowed`（夹具会剥 `bridge.js` 的 import，漏补就 `ReferenceError: allowed is not defined`，整批用例红）。
- 验证：`test-integration-v030` 31/31、`test-audit-bridge` 全 PASS、`test-session-mode-gate` 6/6；全量 `test:audit` **79/82**（三项既有失败不变）。

### 测试：控制台浏览器回归真正跑起来（2026-11-05）
- 夹具 `scripts/console-ui-fixture.mjs` 之前只把 `public/console/js/*.js` 顶层文件注册进资源表，片段化后的 `js/components/*`、`js/lib/*` 全是 404 ⇒ `app.js` 的 import 失败、整页不启动、片段永不注入，测试卡在 hydrate 超时。改为递归提供全部脚本，并补 `/console/img/*`、`/console/fonts/*` 与 `/api/{plugins,commands,extensions,persona/sources}` 四个只读桩，15 个页面请求 404 清零。
- 测试辅助 `reveal(selector)` 原来靠 `locator.evaluate(el => el.closest('[data-page]'))` 反查元素属于哪一页——片段化后元素在未注入的页里**根本不在 DOM**，于是先超时、永远走不到导航分支。改为启动时逐页 hydrate 一遍、拍下「元素 id → 所属页」快照，之后先切页再定位。
- `dialog` 处理去掉重复的 `page.once('dialog', ...)`（两个 handler 会对同一个 dialog 二次 `accept()` 而抛错），只保留一个会 `catch` 的全局监听。
- 修两个真实缺陷：① 手机 390px 下面板被 `#mainNav` 的 min-content 撑到 1179px 宽（网格列改 `minmax(0,1fr)`、`#mainNav` 加 `min-width:0`）；② 「二代仿真」页每次进入都重拉配置，把未保存的草稿冲掉（配置只在首次进入与保存成功后加载）。
- 契约基线按当前控制台重录一次（`--accept-contracts`，25 条写请求）：差异是 `/api/mode` 与 `/api/roles/*` 新增 `level` / `apply` 字段——closed-agent 分级与人格切换生效时机是改版后能力。`--record-baseline` 仍只允许搭配 `--original`，重录开关与理由写进 `docs/guides/CONSOLE-UI-TESTING.md`。
- 结果：`npm run test:console-ui`（配 `PLAYWRIGHT_MODULE='playwright-core'` + 本机 Edge）**23/23 全绿**、连跑两次稳定；此前本机因缺 `playwright` 一直整段跳过。

### 重构：`/reset` 的清理序列搬到 `src/session/reset.mjs`（P7 第三步，2026-11-05）
- 新增 `src/session/reset.mjs`：`createSessionResetter(deps)` 返回 `resetSession(key)`，承接原来写在 `bridge.js` 里的 58 行清理序列——删 `state.sessions`/策略、清 8 个按旧 sessionId 索引的 Map、`pending` 与 `ext.approvals`、提示队列、`messageMediaStore`、social/socialV2/slang 的按键缓存、四个 wake 集合、`seenForwardIds`，再落盘、停 DSH 侧工作、归档、回执。
- 顺序按「先删挂账、再清内存、再落盘、最后网络调用与回执」固定下来，并写进文件头注释：反过来会在清理没做完时就让用户看到「已重置」。
- `bridge.js` 只剩惰性拼 `deps` 的登记段（首次重置时才建，避免模块顶部的 TDZ）；`sessionEpoch` 通过 `bumpEpoch` 回调传入，模块不直接改这个变量。行数上这一步基本持平（−58 行逻辑、+64 行登记，`bridge.js` 14694 行），换来的是清理序列能脱离桥接单测。
- 新增 `scripts/test-session-reset.mjs`（4 条）：`no-session` 直接返回且不动任何状态、全桶清理（逐 Map/Set 断言，少登记一个桶就会红）、落盘 < 停 DSH < 归档 < 回执的顺序、停止旧会话抛错时只记日志并继续归档回执。
- 回归：`scripts/test-integration-v030.mjs` 31/31、`scripts/test-audit-bridge.mjs` 全 PASS（含「console reset drops the session policy and stops the retired DSH session」）。

### 重构：内置命令壳抽到 `src/commands/`（P7 第二步，2026-11-05）
- 新增 `src/commands/builtin.mjs`（`createBuiltinCommands(deps)`，承载 `/reset` `/status` `/role` `/silent` `/active` 五条命令的定义、别名、权限、分组与文案）与 `src/commands/payload.mjs`（`buildCommandsPayload(registry)` 组装 `GET /api/commands` 的三段响应）。
- `src/bridge.js` 删掉 `commandStatus`/`commandRole`、5 条内联 `commandRegistry.register({...})` 与 `/silent` `/active` 两段旧 `if` 分支；`/api/commands` 由 20 行字面量改成一次 `sendJson(buildCommandsPayload(commandRegistry))`。`commandReset(ctx)` 改名 `resetSession(key)` 留在原地（要收口 30 个内存态对象与 45 处调用，属于第 3 步会话层）。
- `bridge.js` 14745 → 14686 行（净 −59），`commandReset`/`commandStatus`/`commandRole` 残留 0；入口、行为、文案不变。
- 回归门禁：`scripts/test-command-registry.mjs` 扩到 17 条（新增 `makeBuiltinHarness` 假 deps，覆盖五条命令注册/别名、`/status` 文案、`/reset` 透传、`/role` 五种分支、`/silent` `/active` 改模式、payload 分组）；`scripts/audit-bridge-harness.mjs` 补 `createBuiltinCommands`/`buildCommandsPayload` 的 import 与 sandbox 条目（VM 夹具剥 import，漏了会 `ReferenceError`）。
- 文档：`docs/COMMAND_REGISTRY.md` 新增 §9「代码位置」并把迁移状态改成「五条内置全部 `migrated:true`」；`docs/PLUGIN_ROADMAP.md` §8.8 标第 1、2 步完成、第 3 步（`resetSession` + 会话状态）列为 A′ 待做。

### 重构：控制台组件层（3.2，2026-11-05）
- 新增 `public/console/js/components/`：`table.js` 的 `tableHtml(columns, rows)`（由 `ui.js` 的 `simpleTable` 迁出，列宽仍走 `data-w`）、`message.js` 的 `setMsg(target, text, kind)`（把「设文本 + 设 `meta ok|err`」收成一处，22 处调用点全部改用它）、`modal.js` 的 `openModal`/`closeModal`/`isModalOpen`/`wireModal`（统一 `.open` 类与 `aria-hidden`，Esc 与点遮罩关闭）。
- 插件详情弹窗与黑话模态改走 `wireModal`：前者据此挂到 `document.body`（片段注入在 `.card` 里，`.card` 的 `backdrop-filter` 会给 `fixed` 造包含块，遮罩只盖住卡片）；后者自带 Esc 焦点环，传 `closeOnEscape: false` 避免双重关闭。
- `ui.js` 只剩 toast、`esc`、tile 列表与 `applyPageA11y`，无调用方的 `renderTable` 删除；三个只读页（技能 / MCP / 管理行为）改用 `tableHtml`。
- 回归门禁：`test-console-static` 增 12 条组件断言（文件存在、导出签名、页面改用 `tableHtml(`、全局不再有 `className = 'meta ok|err'`）；`test-console-ui` 的片段化选择器改为「先切页再等元素」，两处 `style.display` 断言改成 `hidden` 属性。真机探针验证「点开 / Esc 关 / 点遮罩关 / 黑话页注入」全部通过、零异常。

### 安全：CSP 去掉 `unsafe-inline`（3.4 收尾，2026-11-05）
- 控制台彻底外置：HTML 与 15 个页面模块里现在 **0 处内联 `style`**、`index.html` 无内联 `<script>`/`<style>`；主题引导抽成 `public/console/js/theme-boot.js`（同步 `<script src>`，仍放在样式表之前防首屏闪白）。
- 动态排版改正规路径：表格列宽由内联 `style="width:Npx"` 改成 `data-w="N"`（`components.css` 用 `th[data-w="…"]` 给宽度，`renderTable`/`simpleTable`/管理行为页表头同步）、显隐一律用 `hidden` 属性（`base.css` 的 `[hidden]{display:none!important}` 兜底）、用量页进度条改 `data-pct` + `applyUsageBarWidths()` 用 CSSOM 写宽度——CSP 的 `style-src` 不拦 CSSOM。
- `src/http/security.mjs` 的 `CONTENT_SECURITY_POLICY` 收成 `script-src 'self'; style-src 'self'`，其余（`frame-ancestors`/`base-uri`/`form-action`/`object-src`）不变。
- 回归门禁：`test-http-boundary` 新增「CSP 不含 `unsafe-inline`、script/style 只允许同源」断言（7 pass）；`test-console-static` 断言 0 内联 style，并把每个控制台模块复制成 `.mjs` 交给 `node --check` 做语法校验（index 里已无内联脚本可解析）。
- 浏览器探针（深链 `#usage`、切页到管理行为、搜索候选层、定时任务时区、用量图表）无 `securitypolicyviolation`、无异常；管理行为表头宽度 200/92/118/84/84/70 按 `data-w` 生效。

### 重构：控制台样式再分三层（3.3 第二步，2026-11-04）
- `public/console/css/app.css`（1810 行）按连续区间拆成三件：`base.css`（重置、排版、滚动条、按钮与表单基线，123 行）、`layout.css`（三容器外壳、侧栏、顶栏、主区、页面标题与指标条，343 行）、`components.css`（网格、卡片、表格、表单、弹窗、主题与各页细节，1357 行）；`index.html` 依次加载 `tokens → base → layout → components`，原 `app.css` 删除。
- 拆分脚本先断言「三件按序拼接 === 原文件（逐字节）」再落盘，级联顺序与拆分前完全一致；实测样式规则总数 296 条、概览页几何（模式卡 `y=484 / w=1086`）、深浅色令牌值全部不变。
- `scripts/console-source.mjs` 改为按顺序拼接四件样式；`console-ui-fixture.mjs` 逐个分发；`test-console-static` 的样式断言改为「三件存在、不含令牌、加载顺序正确、页面私有规则归属不变」。

### 重构：内联样式收口到工具类（3.3 收尾，2026-11-04）
- 新增 `public/console/css/utilities.css`（57 个工具类，最后加载）：把 HTML 里 407 处内联 `style` 中的 **388 处**换成 `.u-w-80` / `.u-flex-1` / `.u-mt-8` / `.u-m-0` / `.u-flex-basis-220` / `.u-between` 这一类工具类，覆盖 `index.html` 与 15 个 `pages/<id>/page.html`。
- 只映射纯静态属性（宽度、flex、外边距、gap、文字对齐），不把主题色与组件样式塞进工具类；含 `display:` 的 19 处保持内联——这些元素由 JS 切 `display` 隐藏/展开，换类会和 `el.style.display` 打架。
- 实测：`u-w-*` 宽度、`u-flex-1` 的 `flex-grow`、`u-mt-*` 外边距全部按预期生效；概览（模式卡 `y=484 / w=1086`）、插件、定时任务三页几何与转换前一致，零异常。`test-console-static` 增断言：工具类文件存在、加载顺序最后、HTML 内联宽度为 0、剩余内联 ≤20 处。
- **CSP 还没到**：JS 拼的模板里仍有内联 `style`（`ui.js:100` 表格列宽、`pages/behaviors/page.js:24-26` 写死列宽、插件/黑话页动态行）与 26 处 `el.style.display`；下一步把这些也搬走，才能去掉 `style-src 'unsafe-inline'`。

### 重构：启动器控制中心拆成三件套（3.5，2026-11-04）
- `public/control-center.html`（单文件 1280 行，样式与脚本全内联）拆为 `public/control-center/{index.html,app.css,app.js}`，并复制一份 `favicon.svg`；页面结构与行为不变，只把内联块换成 `<link>` 与 `<script src>`。
- `src/launcher/control-center.mjs`：`PAGE_FILE` 指向目录内的 `index.html`，新增 `GET /control-center/*` 静态路由（复用 `src/http/static.mjs` 的 `resolveStaticPath` + `serveStaticFile`，前缀锁死、穿越 404）；其余路由、`#t=` 令牌、锁文件与 `/api/*` 逻辑不动。
- 打包不受影响（`build-release.mjs` 用 `git ls-files` 收文件）；`test-control-center` / `test-napcat-manage` / `test-platform` / `test-linux-support` 的读取改为「index + app.js」拼接，原有断言全部保留。
- 实测：`GET /` 200（25073 字节）、`app.css` 12287、`app.js` 60543、`favicon.svg` 915，`/control-center/../../state/console-token` 返回 404；无头 Edge 打开页面零异常、样式与主标签正常。

### 重构：控制台样式分家（3.3 第一步，2026-11-04）
- 新增 `public/console/css/tokens.css`：`:root` 设计令牌与 `[data-theme="dark"]` 覆盖单独成层，`index.html` 里先于 `app.css` 加载（同文件内的顺序语义保持原样）。
- 页面私有样式回各自目录：`overview` 的三块网格占位、顺序与窄屏覆盖 → `pages/overview/page.css`；`usage` 的账本数字对齐、进度条、手写 SVG 图表与图例 → `pages/usage/page.css`；`app.css` 不再持有 `#section-*` 选择器。
- `test-console-static` 增 7 条断言（tokens 文件与顺序、app.css 不持有令牌、两页私有规则归属），防止样式回流。

### 修复：插件详情弹窗只罩住卡片；标签图标改回品牌字形（2026-11-04）
- 插件详情遮罩被 `.card` 的入场动画/`backdrop-filter` 形成的包含块困住，`position:fixed` 只覆盖卡片；现在 `init()` 里把 `#pluginDetailOverlay` 挂到 `document.body`（实测遮罩 1410×905 = 整页视口），并在路线图「页面模块约定」写明「片段里的 fixed 浮层必须挂 body」。
- 重画标签图标：不再自绘几何图形（原版被看成性别符号），直接复用侧栏品牌标记的字形——`<text>q</text>` + `<text>↗</text>`、同一套字体栈，**不画背景块**，颜色用 `@media (prefers-color-scheme)` 跟随系统深浅色；控制中心 `favicon.svg` 与之逐字节相同，两处图标只有一个来源。
- `test-console-static` 增 4 条断言（同形、无背景与自绘图形、跟随主题、两处一致）与 1 条浮层归属断言。

### 重构：控制台页面目录化（3.1：全部 15 页，2026-11-04）
- 收尾：插件页也收进 `pages/plugins/`（`js/pages/plugins.js` 删除），控制台 15 个页面至此全部自包含；`js/` 只剩 `api.js` / `ui.js` / `router.js` / `timezone.js` / `app.js`（约 290 行，只做全局刷新、搜索、主题与入口装配）。
- 新增 `public/console/img/favicon.svg`（初版为深色圆角底 + 自绘 `q↗`，当日晚些改版为「只留品牌字形、无背景」，见上方修复条目），`index.html` 声明 `<link rel="icon" type="image/svg+xml">`；`/console/img/` 沿用鉴权前的静态放行，标签图标不再空白。
- `public/console/pages/<id>/` 成为页面自包含目录：`skills`、`mcp`、`behaviors`、`reference` 四页的 DOM 片段、私有样式、页面模块搬进各自目录；`index.html` 对应 `<section>` 只留空容器（页面不再是「全写死在 index 里」）。`reference` 是纯静态页，模块只导出空 `init()`，保持「每页都有 `init()`」的约定。
- 路由器新增 `hydratePage(page)`：首次进入时 fetch `page.html` → 注入容器 → 按需插 `page.css` → 动态 `import()` 页面模块并调 `init()`；每页只加载一次，并发切页复用同一个 Promise；片段取不到时只在该 section 显示「页面加载失败（刷新重试）」，不影响其它页。
- `src/bridge.js` 的静态路由前缀扩到 `/console/(css|js|img|fonts|pages)/`（仍在令牌校验之前）；`scripts/console-source.mjs` 增 `consolePageDirs()` 并把页面片段拼进源码视图；`scripts/console-ui-fixture.mjs` 按真实路径提供 `pages/<id>/page.{html,css,js}`。
- `access` 是一页三卡（白名单 / 安全拦截 / 访问令牌），新增「多卡片页」约定：宿主 section 用 `.page-stack`（`display:contents`），注入的卡片直接落进 `main` 的网格，布局与搬之前一致；三个卡片的读取/保存逻辑与「显示令牌」按钮一起搬进 `pages/access/page.js`。
- `social-v2`（二代仿真）是单卡页：宿主保留 `class="card span-all"`，`page.html` 只放内部内容；23 个函数与 27 个事件绑定（配置存取、语音库、工具日志、轻量记忆、唤醒状态、一键补表情说明）整体搬进 `pages/social-v2/page.js`，`app.js` 少 739 行。
- 无障碍增强下沉：原来给表单补 `aria-label`、给主按钮补 `.primary`、给 `*Msg` 补 `role=status` 的代码只在入口脚本启动时跑一次，片段页注入得晚、永远补不上；现抽成 `ui.js` 的 `applyPageA11y(root)`，由路由器在页面 `init()` 后对注入的 host 再调一次。
- `social-v1`（一代仿真）与 `slang`（黑话词库）也搬进各自目录：表单读写、筛选 Tab、批量研究/确认/拒绝、词库模态与键盘焦点环随页面模块走；`slang` 的模态 DOM 留在共享宿主（`</main>` 之后），逻辑搬进页面，避免每页各造一个壳。
- 路由器新增 `refreshCurrentPage()`：全局刷新按钮现在会同时跑「当前页注册的 refresher」，搬走的页不再点刷新毫无反应。
- `scheduler`（定时任务）也搬进 `pages/scheduler/`：任务列表、编辑器（13 种重复方式、时区、目标、payload）、限额与免打扰设置、执行记录整块随页面走。它与「定时静默」共用一套时区下拉，因此把 `tzOffset`/`tzOptionsHtml`/`tzSet` 抽成 `js/timezone.js` 两页共用，初始化改到 `init()` 里执行。
- `usage`（用量与花费）是第二个多卡片页：两张卡（令牌与花费 / 上下文压缩）一起搬进 `pages/usage/`，宿主改 `.page-stack` 后原 `section-compact` 从 index 消失。图表绘制（手写 SVG）、逐轮明细、清空账本、价目表与压缩模式单选随页面走，3 秒图表轮询与 60 秒压缩轮询都保留「仅本页可见时」的判断。
- `persona`（人格与角色）搬进 `pages/persona/`：人格列表与编辑器、按会话设置人格、人格来源、恢复默认、仿真提示词整块（DOM / 逻辑 / 绑定 / 启动刷新）一起走。`filterRoleSuggestions` 从顶层 IIFE 改为 `init()` 内调用；全局 3 秒刷新不再跨页写页头，改由页内 `GET /api/status` 在进入页面与增删改后刷新。
- `operations`（调试与运维）是第三个多卡片页：测试发送 / 桥接控制 / 后台控制端引导三张卡一起搬进 `pages/operations/`，宿主改 `.page-stack`；四个按钮绑定与校验文案随页面走，清空工作区不再直接调 `refreshSessions()`，由全局指标轮询和会话页进入时刷新。
- `sessions`（会话与审批）搬进 `pages/sessions/`：会话映射 / 挂起审批与提问两张卡与 `refreshSessions` / `refreshPending`、清除上下文绑定、3 秒轮询一起走；跨页的 `#metricSessions` / `#metricPending` / `#pendingCount` 改为判空写入，会话页可见时由页面模块刷新、其它页由 `app.js` 的 `refreshSessionMetrics()` 补上，避免重复请求与空元素异常。
- 修复搜索索引的启动期崩溃：原来在入口脚本里对每个 `section[data-page]` 直接取 `h2`，片段页为空时会抛 `TypeError` 并中断后续初始化（整页交互失效）；现改为按需重建、跳过空 section，并用页面表标题给未注入的页兜底，保证「没打开过也能搜到」。
- `overview`（运行总览）搬进 `pages/overview/`：六块一页（摘要指标 / 运行模式 / 活动日志 / 发言上限 / 定时静默 / DSH 模型）按原顺序注入，宿主 `#section-overview` 用 `.page-stack` 放在 `.grid` 首个子元素，`#overviewSummary` 保留 `overview-summary span-all` 与 `data-page="overview"`，仍是网格首行。模式切换、发言上限、静默排期、DSH 模型读写与首次加载随页面走；摘要指标、活动日志与 `#statusText` 仍由 `app.js` 的 `refresh()` 写（页面管交互、app 管状态刷新），页面用 `console:refresh-status` 请求补刷，片段内节点写入全部判空。`router.js` 的 `[data-view]` 改为 document 级事件委托，片段里的 `#metricSessions`/`#metricPending` 可正常跳转；`app.js` 少 291 行（590 → 299）。
- `scripts/test-console-static.mjs` 增 16 条断言（页面目录三件套、index 容器为空、路由器注入、搜索索引兜底）。


### 重构：管理行为页迁到 pages/behaviors.js（2026-11-04）
- 命令注册表表格（按 group 折叠）、筛选/搜索防抖、组行展开，以及 DSH 会话命令与 Agent 工具两张只读表整段搬到 `public/console/js/pages/behaviors.js`，导出 `initBehaviorsPage()`；`app.js` 只留调用。
- 回归：无头 Edge 实测「注册表 5 条内置 + 0 条插件；显示 5 条」、2 个分组 7 行，无 JS 异常。

### 重构：技能页与 MCP 页迁到 pages/（2026-11-04）
- 新增 `public/console/js/pages/skills.js`、`pages/mcp.js`，各自导出 `initSkillsPage()` / `initMcpPage()`，自绑刷新按钮、自注册 `onPageRefresh`、自管 30 秒轮询与首次加载；`app.js` 只保留 `initXxxPage()` 调用。
- `simpleTable(columns, rows)` 从 `app.js` 移到 `ui.js` 导出（返回 HTML 字符串，与返回节点的 `renderTable` 并存），行为页与两个新模块共用。
- 回归：无头 Edge 实测技能页「共 1 个技能包」1 行、MCP 页「桥接自带 3 个 MCP server」3 行，控制台无异常。

### 重构：插件页迁到 pages/plugins.js（2026-11-04）
- 后续（同日）：插件页也收进自包含目录 `public/console/pages/plugins/`，`js/pages/plugins.js` 删除，`app.js` 不再静态 import 页面模块——控制台 15 个页面至此全部由路由器按需注入。
- 「桥接插件」页（加载状态、启停/重载/卸载、安装、运行设置、详情弹窗）整段从 `app.js` 搬到 `public/console/js/pages/plugins.js`，导出 `initPluginsPage()` 自己绑事件、注册 `onPageRefresh('plugins')`、做首次加载与 15 秒轮询。
- 页面模块新增 import 了 `esc`；缺这一条时 `refreshPlugins()` 的 Promise 会被 `.catch(() => {})` 吞掉，页面停在「加载中…」且控制台无报错（无头 Edge 实测复现并修复）。
- 回归：插件页 meta/卡片/4 个操作按钮渲染正常，详情弹窗可开可关；`test:audit` 77/80（三项既有失败不变）。

### 重构：控制台拆出 api / ui / router 三个公共模块（2026-11-04）
- `public/console/js/api.js`：`?token=` 引导与 `api()` 的 401 重试集中到一处。
- `public/console/js/ui.js`：`showConsoleToast`、`esc`、`renderTable`、`renderTileList`。
- `public/console/js/router.js`：页面表、`setConsolePage`、面包屑、hash/popstate、首屏三层恢复；页面数据刷新改为 `onPageRefresh(page, fn)` 注册，路由器不再反向依赖页面代码。
- `public/console/js/app.js` 只留装配（import + 建页面 + 绑事件 + 末尾 `initRouter()`）；`console-source.mjs` 与 `console-ui-fixture.mjs` 改为读取/分发整个 `js/` 目录，测试仍能一次读到全部源码。
- 回归：`test-scheduler`、`test-role-per-key` 的路由接线断言改为匹配 `onPageRefresh(...)` 与 `getCurrentPage()`；无头 Edge 实测 5 个资源全 200、路由/刷新/面包屑/搜索层级正常、无 JS 异常。

### 重构：控制台拆成「骨架 + 样式 + 逻辑」三件套（2026-11-04）
- `public/console.html`（372 KB 单文件）拆为 `public/console/index.html`（结构）、`css/app.css`、`js/app.js`（ES module，零构建）；原文件已删除。
- 服务端新增控制台静态路由：只放行 `^/console/(css|js|img|fonts)/`，且**排在令牌校验之前**（浏览器取资源不带令牌头，放在后面会 401 白屏）；页面 `/`、`/console/` 仍需令牌，穿越/符号链接/白名单外扩展名一律 404。
- 测试适配：新增 `scripts/console-source.mjs`（`consoleSourcePaths` / `readConsoleSource`），14 个读取旧 HTML 的用例改用它；`scripts/console-ui-fixture.mjs` 预读并分发 `/console/css/app.css`、`/console/js/app.js`。
- 验证：无头 Edge 实测样式/脚本均 200、无控制台异常，深链与刷新保页、点击进页刷新、未知 hash 回落全部保持；`npm run test:audit` 77/80（失败仍为三项既有问题）。

### 修复：控制台刷新回首页、面包屑不可点、搜索候选被遮挡（2026-11-04）
- 刷新保页：当前页写入 `sessionStorage['qqb-console-page']`，首屏按「hash → sessionStorage → overview」三层恢复；补 `popstate` 监听；未知 hash 回落并 `replaceState` 纠正地址栏，同时提示一次。
- 面包屑可点：分组由 `#mainNav` 的 `.nav-label` 推导（不再维护第二份页面父子表），`renderBreadcrumb()` 生成 `<a href="#组内首页">`，当前页保留 `aria-current="page"`。
- 搜索候选：`#searchResults` 改挂到 `document.body` 并 `position:fixed`，位置按输入框 `getBoundingClientRect()` 计算——原来它被 `.page-heading` 的 `transform` 锁在层叠上下文里，永远盖不过后面的卡片。
- 新增 `src/http/security.mjs`（安全响应头单一来源）、`src/http/static.mjs`（静态资源守卫：解码一次、拒绝 `..`/盘符/ADS/反斜杠/符号链接/白名单外扩展名、失败统一 404）与 `scripts/test-http-boundary.mjs`（8 项，含真实符号链接用例，无权限环境自动跳过）；`src/bridge.js` 的 `SECURITY_HEADERS` 改为从模块导入。
- `scripts/test-console-static.mjs` 增加 7 条路由/面包屑/候选框断言，防止三个 bug 回归。

### 新增：HTTP 边界文档与控制台规范化路线（2026-11-04）
- 新增 `docs/HTTP_BOUNDARY.md`：静态资源路径穿越守卫（`path.resolve` + `path.relative` + 拒绝清单 + 符号链接）、「未启用 = 404」「先鉴权后存在性」的语义表、CSP 与安全响应头现状与收敛目标、刷新/深链的三层恢复顺序、插件 UI 的 iframe 沙箱与样式隔离约定、验收清单。
- `docs/PLUGIN_ROADMAP.md` 新增 §8.7（控制台前端分层 A 方案 + B1 刷新保页 / B2 面包屑可点 / B3 搜索层级）、§8.8（`bridge.js` 按接缝抽层，第一步 HTTP 层，入口路径不变），并把「不引前端框架」「不重写 bridge.js」写进已拍板决策。
- `docs/PLUGIN_ROADMAP.md` §8.7 追加第三阶段「3.5 启动器控制中心（B 档）」：`public/control-center.html` 拆为 `public/control-center/{index.html,app.css,app.js}`，仍由 launcher 独立托管（默认 3099），与 console 共享 `app/styles/tokens.css`；列出四条不并入 console 的理由、launcher 静态服务改法、3 个打包脚本 + 5 个测试的影响面与验收。

### 新增：桥接插件内核与人格 provider（v1.2.0）
- `plugins/` 成为桥接运行时插件目录，内核在 `src/plugins/`（`manifest` / `config` / `audit` / `persona` / `host-api` / `kernel`）；原先给 DSH 加载的两个 bundle 改名到 `dsh-bundles/`，避免「插件」一词指两样东西。
- 四个钩子：`onInbound` / `onPromptBuild` / `onAfterSend` / `onShutdown`；钩子超时（默认 2s）与异常只记审计，不阻断消息主链；`plugins.json` 独立配置（不入库，模板 `plugins.example.json`）。
- 人格 provider 契约 `persona-provider/1`：按会话取卡、ETag/304、未绑定返回 `none`；缓存与降级（TTL 5 分钟、最小刷新 30 秒、旧卡最多用 24 小时、单飞、持久化 `state/persona-cache.json`）由内核统一负责。
- 三层解析 `src/persona-resolve.mjs`：会话覆盖（`/role`、控制台按会话设置；`off` 硬覆盖）→ 外部 provider → 全局本地卡；`currentRoleHintV2` / `currentRoleFingerprintV2` / 唤醒提示词 / `qq_get_prompt` 都改走这一处。
- 第一个 provider 插件 `plugins/soulkit-persona`：`GET /api/persona/card?platform=qq&key=…`，剥掉 `【人格卡：…】` 标题行，失败保留旧卡；soulkit 不在线时按解析链回落本地角色卡。
- 控制台：「桥接插件」页（`/api/plugins`）、「人格来源（只读）」页（`/api/persona/sources`）；`role.maxInjectChars` 默认 6000 → 8000（soulkit 卡片约 6.5k 字符）。
- 测试：`test-plugin-kernel`、`test-soulkit-persona`、`test-persona-resolve`，均已接入 `test:audit`。
- 文档：新增 `docs/PLUGIN_KERNEL.md`、`docs/PERSONA_PROVIDER.md`、`docs/PLUGIN_ROADMAP.md`（后续路线与明确不做）。

### 新增：插件运行期管理（P2a）
- 内核支持 `reload(id)` / `reloadAll()` / `enable(id)` / `disable(id)` / `detail(id)`：重载先构建新实例（钩子与 persona 暂存），成功后才拆旧实例，失败保留旧实例继续跑；管理动作串行执行。
- 重载用 `?v=<mtime>` 绕开 ESM 缓存；`shutdown` 改为先发 `onShutdown` 再 `dispose`，插件能拿到退出钩子。
- 控制台插件页：每张卡片加「启用/停用」「重载」「详情」，另有「全部重载」；详情弹窗展示清单、权限、钩子、入口、计数、最近变更/错误与该插件最近 20 条审计。
- 接口：`GET /api/plugins/:id`、`POST /api/plugins/:id/{enable,disable,reload}`、`POST /api/plugins/reload`；启用/停用只改进程内状态，重启后以 `plugins.json` 为准。
- 测试：`test-plugin-kernel` 增至 8 个用例（停用后钩子不再执行、启用恢复、重载读到新版本、坏插件重载失败保留旧实例、detail 字段与审计）。
- 文档：`PLUGIN_KERNEL.md` §5.1 / §10 / §11 / §12 / §13 / §14 同步；`PLUGIN_ROADMAP.md` §4 补「实施记录与偏差」。

### 新增：插件安装与卸载（P2b）
- `POST /api/plugins/install`：`{ path }` 从服务器本地目录安装，`application/zip` 直接上传安装包；都先复制/解压到 `plugins/.staging-*`，校验清单后原子改名到 `plugins/<id>`，激活失败回滚进 `state/_trash`。
- `DELETE /api/plugins/:id`：卸载先把目录移到 `state/_trash/plugins-<id>-<时间戳>`（不硬删），再 dispose 并从索引移除；移不动则整体失败、运行实例不受影响。
- 零依赖 zip 解析 `src/plugins/zip.mjs`：拒绝路径穿越、加密、分卷、zip64、非 deflate/store、解压后超限；`src/plugins/install.mjs` 再查符号链接与目录树总大小。
- `plugins.json` 新增 `install: { enabled, maxBytes }`（默认 5MB）；`init()` 跳过 `.` 开头目录，残留暂存目录不会被当成插件。
- 控制台插件页新增「安装插件」折叠区（zip 上传 / 本地目录）与卡片上的「卸载」按钮。
- 测试：新增 `test-plugin-install.mjs`（目录/zip 安装、坏清单回滚、穿越与超限拒绝、卸载进 `_trash`），已接入 `test:audit`。
- 文档：`PLUGIN_KERNEL.md` §4 / §5.2 / §10–§14 同步；`PLUGIN_ROADMAP.md` §5 标完成并补「实施记录与偏差」。
- 顺带修正：控制台 CSRF 守卫对插件 zip 上传与插件 DELETE 放行（其余写接口仍只收 JSON）；内核读 `plugin.json` 时剥 UTF-8 BOM（Windows 编辑器常带）。

### 新增：插件文件监听自动重载（P2c）
- `plugins.json` 新增 `watch`（默认 `false`）：开启后 `fs.watch(plugins/, { recursive: true })` 监听变更，按 `plugins/<id>/…` 只重载变更文件所属的那一个插件，500ms 去抖合并连发事件。
- 只重载 `active` 插件（`disabled`/`invalid` 不动），走与手动重载相同的 staging 流程；失败保留旧实例并记 `reload-failed`。
- 监听不可用（平台不支持 recursive、权限、watcher 报错）自动降级为「只手动重载」，日志一行，不影响桥接启动；`shutdown()` 先停监听再拆实例。
- `plugins.json` 本身仍不监听：改配置（含 `watch`）需要重启，与「不做配置热生效」的边界一致。
- 测试：`test-plugin-kernel.mjs` 增至 11 个用例（路径映射、配置默认与非法值、开启后 5 秒内自动重载）。
- 文档：`PLUGIN_KERNEL.md` §4 / §5.3 / §12–§14 同步；`PLUGIN_ROADMAP.md` §3 标完成、§6 补「实施记录与偏差」；`plugins.example.json` 增 `watch`。

### 新增：命令注册表与「扩展」四页（P3a）
- 新增 `src/commands/registry.mjs`：内置命令按「最长主名优先、别名指向同一条目、内置先注册者保留」匹配；条目分「已迁移」（带 handler，由注册表执行）与「旧链」（只有元数据，回退原来的 `if` 分支），迁移是逐条进行的。
- 首批迁移 `/reset`（别名 `/new`）、`/status`、`/role`；`/silent`、`/active` 先登记元数据，行为仍走旧链。权限沿用原来的 owner 守卫，scope 区分全部会话 / 仅群聊 / 仅私聊。
- 控制台导航新增「扩展」一级：插件（原有页）、技能、MCP、管理行为。技能页只读扫描 `DSH_HOME/skills` 与仓库 `skills/` 下的 `SKILL.md`；MCP 页只读列出桥接自带的三个 stdio server；管理行为页按来源展示命令与迁移状态，并只读列出 DSH 会话命令与 Agent 工具。
- 接口：`GET /api/commands`（桥接内置/插件/DSH 命令/工具，三个来源分开返回）、`GET /api/extensions`（技能清单与 MCP server 清单）。
- 测试：新增 `test-command-registry.mjs`（10 个用例：匹配、别名、元数据回退、权限与 scope、抛错兜底、冲突规则、按插件注销），已接入 `test:audit`；`scripts/audit-bridge-harness.mjs` 注入真实注册表，命令迁移后的行为在 VM 里也能验证。
- 文档：新增 `docs/COMMAND_REGISTRY.md`（三来源能力矩阵、entry 形状、匹配/权限规则、页面布局、明确不做、P3b 预留）；`PLUGIN_ROADMAP.md` §3 / §7 同步。

### 新增：插件注册命令（P3b）
- 新增权限位 `commands`，插件可在 `activate(ctx)` 里调用 `ctx.commands.register({ name, aliases, scope, permission, help, handler })`；未申请权限时 `ctx.commands` 为 `undefined`。
- 注册在 `commit` 阶段入表：activate 抛错、清单非法、重载失败都不会留下半截命令；命令 id 缺省用 `<pluginId>:<name>` 兜底。
- 停用 / 卸载 / 重载时内核按 `pluginId` 批量注销；冲突仍只告警、内置命令永远优先。
- `detail` 与 `/api/commands` 会列出插件命令，管理行为页能看到来源为「插件」的条目。
- 测试：`test-plugin-kernel.mjs` 增至 12 个用例（注册、派发、停用后消失、启用后恢复）。
- 文档：`PLUGIN_KERNEL.md` §7/§8 增 `ctx.commands` 与 `commands` 权限；`COMMAND_REGISTRY.md` §8 改为「已实现」；`PLUGIN_ROADMAP.md` P3b 标完成并补实施记录。

### 新增：「扩展」四页 UI 精修（P3d）
- 管理行为页从平铺列表改成表格：列是「指令 / 类型 / 所属 / 描述 / 权限 / 状态 / 操作」，按命令 `group` 自动生成可展开的指令组（会话 / 人格 / 插件），首组默认展开，点组行折叠；另有来源、权限两个下拉与关键词搜索，三者叠加、计数实时更新。
- 命令注册补齐 `group`：`/reset`、`/status`、`/silent`、`/active` → 会话，`/role` → 人格；插件命令归到「插件 &lt;id&gt;」，插件行给「详情」跳到插件面板。
- 插件页卡片重做：复用控制台 `.grid` + `.card` + `.row` / `.meta` / `.pill` 组件（不另起样式），标题行带状态与版本、描述、权限/钩子/命令/调用/失败标签与操作按钮行；`/api/plugins` 为卡片补 `description` 与 `permissions` 字段。
- 布局改成标准控制台外壳：左侧导航、右侧顶栏、内容区三个独立容器，只有内容区内部滚动（`body` 固定高度网格，`.workspace` 再分 header/main 两行），不再靠「侧栏 fixed + sticky 顶栏」拼位置。
- 滚动条统一为细样式：去掉上下箭头，默认透明、悬停才显形，只有内容溢出时才出现。
- 技能页与 MCP 页统一成同样的表格语言（技能：名称/说明/路径；MCP：服务器/说明/入口与工具），空态统一。
- 测试：`test-console-static` 通过；两段内联脚本语法检查通过。
- 文档：`PLUGIN_ROADMAP.md` §3 P3d 标完成、§7.5 补「实施记录与偏差」。

### 新增：内置段落块化（贴纸 + 记忆摘要）
- 内置的「表情包策略」与「此刻状态（记忆摘要）」不再写死在 wake prompt 里，改为 `core-stickers` / `core-digest` 两个具名块，走与插件块相同的排序、限额、错误隔离语义。
- `config.json` 新增 `promptBlocks`：`{ "core-digest": { "enabled": false } }` 可整段关掉，`maxChars` 可单独收紧；配错（类型不对、超范围）只回落默认，不影响启动。
- 与插件块**分账**：插件块仍受 `plugins.json` 的 `limits.maxPromptAppendChars`（默认 4000）约束，内置段落用自己的预算（200000），互不挤占；`/api/plugins` 的 `coreBlocks` 返回两块的上限与调用次数，插件页 meta 直接显示。
- 迁移前后用 bridgeHarness 抓 `replyCheck` / `timeout` / `bootstrap` 三种唤醒的 prompt 全文比对，**逐字一致**（只差随机会话令牌）。
- 测试：新增 `test-core-prompt-blocks.mjs`（默认注入、关掉后整段消失、`maxChars` 收紧后变短但不整段消失、关表情块不影响记忆段）。
- 文档：`PLUGIN_KERNEL.md` §5.4 增「内置段也用同一注册表（分预算）」；`config.example.json` 增 `promptBlocks`；`PLUGIN_ROADMAP.md` P4 实施记录补迁移与偏差。

### 新增：具名注入块（P4）
- 新权限位 `prompt:provide`，插件可在 `activate(ctx)` 里 `ctx.prompt.registerBlock({ id, priority, maxChars, render })`，把「最近记忆」「贴纸策略」这类内容作为独立块注入 prompt，而不是挤在一条 append 管道里。
- 注册随 `commit` 入表：`activate` 抛错、清单非法、重载失败都不会留下半截块；停用 / 卸载 / 重载按 `pluginId` 批量注销，旧块不会继续进 prompt。
- 渲染按 `priority` 升序（同优先级按 id），单块超 `maxChars` 截断（`truncated`），合计超 `limits.maxPromptAppendChars` 的块整块跳过（`budget`），单块抛错只跳过该块（`error`）。
- `status().promptBlocks` 与 `/api/plugins` 的 `blocks` 字段暴露每块的状态，控制台插件详情可见。
- 与 `onPromptBuild` 分工：钩子改文本/加前后缀，注入块稳定贡献一段内容；两者共用同一总预算，`promptAdditions` 语义不变。
- 测试：`test-plugin-kernel.mjs` 增至 13 个用例（顺序、截断、预算跳块、抛错隔离、停用消失、启用恢复）。
- 文档：`PLUGIN_KERNEL.md` 新增 §5.4、§7/§8 增 `prompt:provide`、§13/§14 同步；`PLUGIN_ROADMAP.md` P4 标「部分完成」并补实施记录。

### 新增：出站装饰 `onReplyDecorate`
- 新钩子：模型回复逐段发送前可改写或取消（返回字符串 / `{ text }` / `{ drop: true }`），按插件 id **链式**执行，后一个拿到前一个改过的文本。
- 只作用于模型回复：`auditAndSend()` 显式传 `{ decorate: true }`，确认语、系统通知、管理通道不受影响；装饰后的文本仍过一次敏感信息审计，不能借装饰绕过。
- 兜底：单步抛错或超时保留上一步结果（最差是原文），装饰失败不会让消息发不出去；内核抽出 `invokeHook()` 统一收口超时、审计与调用统计。
- 测试：`test-plugin-kernel.mjs` 增至 14 个用例（链式改写、`drop` 取消、抛错保留上一步、停用后链缩短）。
- 文档：`PLUGIN_KERNEL.md` §6.3 / §13、`PLUGIN_ROADMAP.md` §8.1 同步。

### 新增：入站过滤链 `onInbound` 增强
- `plugins.json` 新增 `filters.inbound`（默认 `false`）：关闭时 `onInbound` 仍是纯观察，任何返回值都忽略，行为与没有插件时一致。
- 打开后，声明 `inbound:filter` 权限的插件可以返回 `{ drop: true }`（整条消息丢弃）或 `{ text }`（替换正文），按插件 id 链式执行，后一个拿到前一个改过的文本。
- `drop` 发生在写入社交历史与命令判定之前，消息不会留痕；替换文本上限 4000 字；没申请权限的动作被忽略并记审计 `inbound-denied`。
- 钩子抛错或超时保留上一步结果，主链按当前文本继续，不会因为过滤失败丢消息。
- 测试：`test-plugin-kernel.mjs` 增至 15 个用例（默认关不生效、开启后可丢可改、无权限动作被忽略）。
- 文档：`PLUGIN_KERNEL.md` §4 / §6.1 / §7 / §10 / §13 / §14、`PLUGIN_ROADMAP.md` §8.2 同步；`plugins.example.json` 增 `filters`。

### 新增：控制台配置面板（P5）
- 内置注入块：`core-stickers` / `core-digest` 的开关与字符上限进界面，保存写 `config.json`（`PATCH /api/config/promptBlocks`），**立即生效**；关掉后模型当轮就看不到该段。
- 运行设置：`filters.inbound`、`watch`、`limits.hookTimeoutMs`、`limits.maxPromptAppendChars`、`install.enabled` 进界面，保存写 `plugins.json`（`PATCH /api/plugins/settings`），除需要重启的项外立即生效。
- 插件详情弹窗可把插件启用状态写回 `plugins.json`（`plugins.<id>.enabled`），重启后保持；卡片上的启用/停用仍只改运行态。
- 写配置统一走「规范化校验 → 原子写 → 审计 `settings` → 返回 `restartRequired`」；越界值整份拒绝，不会写出半份配置。
- 只读保留：`audit.*`、`persona.cache.*`、`persona.provider`（等有第二个 provider 再做下拉）、插件自由 `config`。
- 测试：`test-plugin-kernel.mjs` 增至 16 个用例（越界拒绝、白名单写回、watch 即时生效、未知字段忽略）。
- 文档：`PLUGIN_KERNEL.md` §11、`PLUGIN_ROADMAP.md` §8.6 与「界面暴露」决策。

### 新增：定时任务类型插件化（P8）
- 插件可用 `ctx.scheduler.registerTaskType({ id, label, description?, validate?, run })` 注册自己的定时任务类型（权限 `task-type:provide`）；桥接仍负责到点、发给谁、限额、免打扰与模式判定。
- 任务保存时调用插件的 `validate` 规范化 `payload`；到点每个发送对象调一次 `run`，单次 60 秒超时，抛错记 `failed` 但任务不停用。
- 类型按 pluginId 注销：停用/卸载/重载插件后类型消失，已存在的任务保留在 `state/scheduler.json`（执行时返回失败并说明「任务类型未注册」），重建任务被拒绝。
- 控制台「定时任务」：内容区多一个「插件任务类型」下拉（只在有注册类型时出现）与 payload JSON 文本域；列表徽章显示插件给的 `label`，预览显示 payload。
- 测试：`test-plugin-kernel.mjs` 增至 17 个用例（注册/校验/执行/停用注销/重复 id 只保留先注册）；`test-scheduler.mjs` 增至 7 个用例（payload 校验、写盘、重建后仍在、未注册时拒绝）。
- 文档：`PLUGIN_KERNEL.md` §7 / §8 / §8.1 / §13 / §14，`PLUGIN_ROADMAP.md` §8.3 标完成。

### 改进：控制台间距与列表组件统一
- 折叠面板内距修复：新增的「内置注入块 / 运行设置 / 安装插件」补上 `.settings-content`，与已有面板一致；内层「高级」用 `.settings-sub`，不再继承外层摘要的背景与箭头。
- 列表统一：人格卡与插件卡共用 `.tile-list` + `.tile`（`gap:10px`、内距 `13px 15px`），插件卡不再用 26px 内距的 `.card` + 22px 的 `.grid` 网格。
- 工具条行距统一为 8px；技能 / MCP 页去掉列表外层的额外 `margin-top`（表格组件自带 12px），避免叠加成 20px。
- 约定写进 `docs/PLUGIN_ROADMAP.md` §12 第 6 条：列表、表格、工具栏各自用统一组件与间距，新增页面先对照人格页。

### 改进：DSH 401 时说清楚原因（来自 issue）
- 反馈：桥接读的 DSH 数据目录（默认 `~/.dsh`）和 DSH 实际用的不一致时，所有请求 401、事件流「本次收到 0 帧」，日志却提示「多半是事件流协议/版本不匹配」，把人引到了错误方向。
- 新模块 `src/dsh-auth-hint.js`：探活遇到 401 时（包括启动后从没连上过的情况）在日志里说明读的是哪个凭据文件、有没有设 `DSH_HOME`、是否发现了另一个有凭据的目录，以及怎么改；10 分钟提示一次，恢复后重置。路径里的用户目录显示成 `~`，不读、不输出密钥内容。
- 「事件流连上就断、一帧都没收到」的提示：最近有 401 时改说「原因是 DSH 拒绝了桥接的凭据」；其它情况补一句「DSH 刚重启时出现一次属正常」。
- 新测试 `scripts/test-dsh-auth-hint.mjs`（已接入 `test:audit`）。

### 文档
- 新增 `docs/PLUGIN_ROADMAP.md`：把 P2a（启停/重载/详情）、P2b（安装/卸载）、P2c（文件监听）、P2 同期的命令注册与具名注入块、P3 候选、MCP/Skills 的开工门槛，以及「明确不做」固定成文；约定规划变化先改这份文档再写代码。
- `DSH_SETUP.md`「常见问题」重写「DSH 一直 401」一条：原因、`DSH_HOME` 的设法（Windows / macOS / Linux）、要重跑 `setup-dsh.mjs`、自己验证时要用 POST（GET 得到 404 是正常的）；`DSH_DEPLOYMENT.md` 排查表同步。
- DSH 桌面版 0.2.1-rc.3 复核：不需要改代码，记录见 [DSH_020_ADAPTATION.md](docs/guides/DSH_020_ADAPTATION.md)「附：DSH 0.2.1-rc.3 复核」。
