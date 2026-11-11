# 状态清单（未完项与可复核判据）

目的：把「没做完的、只做了一半的、卡在别人身上的」收敛到一页，避免它们散落在路线图、提交信息与口头汇报里，最后被当成「已完成」。

用法：每个阶段收尾时先对这张表；新增项写清判据与依赖，改动项更新状态与「差什么」。**状态只有四种**：

| 状态 | 含义 |
| --- | --- |
| `Done` | 有可复核的证据（测试、命令输出、截图），判据全部满足 |
| `Partial` | 已经开始或部分可用，括号里写「差什么」——差的部分必须能作为一个具体动作写出来 |
| `Todo` | 已立项、判据已写清，但**一行代码都还没动**；与 `Partial` 的区别是「有没有开工」 |
| `Blocked` | 不是我们没做，而是等外部条件（DSH 能力、平台验证、用户拍板），括号里写「等什么」 |

规则：`Partial` 不允许写成 `Done`；`Todo` 在开工当天改成 `Partial` 并写「差什么」；`Blocked` 每次阶段收尾都要重新确认一次外部条件是否已变；判据里要给出复核方式（命令或文件），不能只写「已完成」。

---

## 1. 未完项

| # | 项 | 状态 | 是什么 | 完成判据 | 依赖 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 真机端到端联调 | `Partial`（差：① 群聊路径未验（目前只验了私聊）；② 审批闭环未验（`/approve`、`通过 #编号`、超时回落）；③ 唤醒提示里三个注入块的计数与截断；④ `onReplyDecorate` 与 `inbound:filter` 在真实事件上的生效；⑤ `operator` 只读令牌边界；⑥ 插件任务类型按时触发。**2026-11-06 已验**：DSH profile 的 MCP 已指向 nexus（`setup-dsh` 重写 3 条），`qq_status` 返回「星苒 online」，唤醒后日志 `工具统一发送 qq:private:2897715886: 成功 2/2 条`，人格卡取到 `provider/魅魔2`） | 真实账号全链路联调（群聊/审批/注入/过滤/权限/插件任务） | 用真实账号按上面 ①–⑥ 逐条跑通，并把结果落成一份可复核记录 | 真实 QQ 账号、SnowLuma 在线（需扫码）、DSH 运行中 | 高 |
| 2 | MCP 清单（路线图 §9.1） | `Blocked`（等：验证 DSH 是否支持运行时增删 MCP，见路线图 §11 第 1 条） | 三个写死的 stdio server 变成 `mcp.json` 清单 + 控制台「MCP 服务」页，插件可贡献 server 定义 | 加一个 server 后不重启 DSH 能出现在工具表；否则只能降级为「写配置 + 提示重启」，需要用户先接受这个体验 | DSH 侧能力验证（读 MCP 配置加载路径 + 一次「加了不重启」实验） | 中 |
| 3 | Agent 工具注册（路线图 §8.5） | `Blocked`（等：DSH 支持运行时更新工具表） | `qq_*` 工具现在写死在 preset 补丁里，改一次要重启 DSH；想做成插件可注册 | 注册后模型当轮就能看到新工具；做不到就不做（避免「注册了但模型看不到」的假功能） | 同 2，DSH 侧能力 | 中 |
| 4 | 插件控制台面板（路线图 §8.4） | `Partial`（差：`/plugin-ui/<id>/` 静态路由、按插件隔离的鉴权、页面容器；目前 0 行代码） | 插件可以在控制台里拥有一小块自己的界面，只能拿自己的数据 | 未启用插件的面板返回 404；面板读不到其它插件与会话数据；CSP 不被放宽 | 无 | 低 |
| 5 | 其他 provider 化（路线图 §9.3） | `Partial`（差：TTS/语音、贴纸库、搜索源的 provider 契约与适配器；目前 0 行代码） | 把语音、贴纸、搜索源从「写死在桥接里」变成可替换的数据源 | 每个 provider 有失败回退（语音回退文本、贴纸回退内置库、搜索回退现有实现），且关掉插件后行为与现在一致 | 无 | 低 |
| 6 | manifest 静态 `commands` 声明 | `Partial`（差：manifest 字段、启动时冲突预检；运行时注册与告警已有） | 现在插件命令是运行时注册、冲突只告警；静态声明可以在启动时就拒绝冲突 | 两个插件声明同名命令时启动即报错并指出双方；`test-plugin-kernel` 有对应用例 | 等第二个真实插件出现再评估（只有一个插件时收益接近 0） | 低 |
| 7 | 浏览器回归没有进 `test:audit` | `Partial`（差：是否把 `playwright-core` 写进 `devDependencies`、CI 入口统一；2026-11-06 已复跑 **25/25**，命令见 §4） | `test:console-ui` 能跑，但不在 `npm run test:audit` 里，需要手动 `PLAYWRIGHT_MODULE=playwright-core` | `npm run test:audit` 或一个明确的 `npm run test:ui` 能在干净环境跑通，并在文档里写清依赖 | 需要决定是否把 `playwright`（或 `playwright-core`）写进 `devDependencies` | 中 |
| 8 | 没有 CI | `Partial`（差：至少一个 workflow 跑门禁） | 现在所有门禁都是本地手动跑；仓库没有 `.github/workflows` | 推送后自动跑 `test:audit`（以及可选的 `test:console-ui`），红灯阻断合并 | 需要确认托管平台与是否愿意为此加配置 | 低 |
| 9 | 控制台契约基线的维护流程 | `Partial`（差：基线变化时的提示与评审约定） | `scripts/console-ui-contracts.json` 是 25 条写请求的期望；改前端会合法地改变它，现在靠 `--accept-contracts` 手动重录 | 契约 diff 出现在 PR/提交里并附一句「为什么变」；不接受静默重录 | 无 | 低 |
| 10 | `fs.watch` 在 Windows 的稳定性 | `Blocked`（等：目标平台实测；当前 `watch` 默认关） | 插件文件监听（P2c）默认关闭，因为跨平台可靠性未验证 | 连续 100 次增删改插件文件，自动重载成功率 100% 且无重复加载；再把默认值改回 `true` | Windows 实测（长时运行） | 低 |
| 11 | 迁移评估与实施（`docs/PARITY.md`） | `Partial`（差：2026-11-06 已落定 D-1=B（`persona-bind/1` 插件能力）、D-3=B（会话页 + 可配置切换 + 平台解耦 + 删改同步）；D-2/D-4 仍调研；被判定「补齐/重设计」的项尚未动工） | 见 `PARITY.md` §3 维度表：11 个维度全部有「保持/补齐/重设计」结论；被判定补齐的项拆成可验收小项 | 各小项的判据与依赖见 `PARITY.md` §7；顺序：会话标识平台化 → 会话页（含删改同步）→ `persona-bind/1` → 会话标题 → 切换/迁移脚本 | 按 PARITY 各小项依赖 | 高 |
| 12 | 扩展便利性（`PARITY.md` §7.6） | `Partial`（差：插件 UI 面板、配置 schema 化表单、manifest 静态 `commands`、i18n、依赖约束、安装来源校验） | 新增一个插件时，不改控制台 HTML 就能有配置界面与面板；清单见 `PARITY.md` §7.6 | 需要先定「插件面板」的鉴权与静态路由（等 D-3 的会话页做完再排） | 插件面板鉴权/静态路由 | 中 |
| 13 | 会话标识平台解耦 | `Done`（2026-11-06：`src/session/key.mjs` 统一组装/解析/判等，产出与解析两侧全部迁移，7 个业务模块 + 桥接 18 处构造 + 43 处解析 + 54 处接口入参归一；`platform.keyedFormat` 开关已彻底删除；死代码 `src/core/session-router.mjs` 已删除） | 新增一个平台（如 TG）时，会话/绑定/模式/任务无需改内核代码 | 复核：`node scripts/test-session-key.mjs`（11/11）、`node scripts/test-integration-v030.mjs`（31/31）、`npm run test:audit`（90/90） | — | — |
| 14 | 控制台前端组件化（路线图 §8.9） | `Partial`（2026-11-06 步骤 1–2 已完成为组件目录与搜索框；基础层（语义令牌/栅格/输入选择器）与表单组件（`components/form/`：16 个工厂 + `createForm` + 字段注解）同日完成：`components/<name>/` 目录与约定落地，`message`/`modal`/`table` 迁入、`search-box` 组件新增并替换 6 处、`/console/components/` 已放行；同日「控件标尺 + 五类非字段控件」落地：`--control-h/-control-h-sm/--badge-h/--field-label-w` 令牌、`.control-row` 行原语、`custom`/`checkList`/`checkTable`/`action`/`status` 五种渲染类型、`.status-badge.is-pill` 收敛到 `components.css`，`social-v2` 已做到 `page.html` **零手写控件**（38 个工具开关、语音库面板、8 组动作行、保存栏、3 个长文本全部由 `fields.js` 生成）；同日四项细节收口：40px 标尺只挂 `.btn`，裸 `button` 恢复内容撑高（概览指标卡与左侧导航不再被压扁，指标卡标签/数值/说明恢复同行）、开关回到 148px 标签列（仅页头 `.form-inline-bar` 收成紧凑 `auto auto`）、工具清单改 `checkTable` 三列表格（启用/名称/说明）、页头顺序改为 启用二代模式 / 提供推荐值给 AI / agentPreset / 运行中；表格组件扩展为「工具栏 + 表体 + 分页」（`dataTableHtml` / `initDataTables`，分页只切 `tr.hidden` 不重建 DOM，翻页不丢表单勾选值），`social-v2` 工具表已接入搜索 + 刷新 + 每页 20（可选 10/20/50）；定时任务编辑器改为弹窗内**左右布局**（名称/时区/重复方式/有效期/执行次数/排除日期/静默时段/错过策略/发给谁/内容形式/内容全部 `.field-block > .field-row`，动态重复行同构），布尔项改 `role="switch"`（`跳过法定节假日`），日期改用 `components/date/` 的「文本框 + 日历按钮 + 隐藏原生 date」（原生 date 三段式无法整段键入），时间改用 `components/time/`（同结构，免打扰合并为「时间段 00:00 ～ 07:00」一行）；新增 `components/select/`（`initSelects` + `MutationObserver`，自绘箭头 45°↔-135°、内缩 12px），页面只写 `<select>`；同日修掉开关点不动/保存写坏的缺陷——开关是 `<button role="switch">`，值在 `aria-checked` 上，`scheduler` 未走 `createForm` 却按 `.checked` 读写，导致点击无反应、保存把 `enabled` 写成 `false`（徽标仍显示运行中）；`form.js` 现导出 `getSwitch`/`setSwitch`/`bindSwitches`，静态检查会拦住「用了开关却没绑定」的页面；弹窗组件补齐**三段式**（`.modal-head` 标题 + 自带关闭按钮 / `.modal-body` 唯一滚动区 / `.modal-foot` 动作条），`scheduler` 的「新建/编辑任务」从卡片内联块改为弹窗（`#schedEditorOverlay`），动作条按钮统一单档（默认 40px，紧凑处 `small: true` 才 32px）；同日「页面骨架」定稿并出第二个样板 `scheduler`（`page-stack` + 每卡 `span-all` + 页头 `.form-inline-bar`（左字段 / 右状态徽标 + 保存）+ `.card-head` + `dataTableHtml` 的任务列表/执行记录 + 折叠组 `settings-group` 与 `initGroups` 记忆（首次只开第一组、之后按 `localStorage` 恢复），`scheduler` 的 `page.html` 已 **零手写控件**，编辑器与三个整块插槽用 `custom` + `span: 2`）；2026-11-07 `persona` 收口（27 → 0：六组字段进 `pages/persona/fields.js`，单选/复选组改走 `fieldShell` 落回 148px 标签列，按会话/恢复默认行改类名样式并清掉 5 处内联 style，仿真提示词去掉「两层文本框」，页内私有样式进 `pages/persona/page.css`）；`slang` 同日收口（36 → 0：分栏标签与三个批量操作条改为 `fields.js` 的 `html` 规格注入，标签条与面板同卡；三个分栏表格换成 `dataTableHtml`（分页 20/50/100 + 搜索 + 刷新 + 空态），「手动添加」搬进 body 级三段式弹窗 `#slangAddOverlay`，删掉页面自画的 6 个搜索/条数控件、legacy id 快照 224 → 218）；`social-v1` 同日收口（28 → 0：五个分组进 `pages/social-v1/fields.js`，区间参数用 `.control-row.s1-range`（两个 96px 数字框 + `～` + 单位），状态块从 `.card-head` 挪到独立 `.meta` 行，长标签压成名词 + `hint` 承担限定条件，底部 `.save-bar` 去掉 sticky 避免遮内容；三个开关改 `setSwitch`/`getSwitch`，保存载荷逐字段一致）；`overview` 同日收口（32 → 0：摘要指标、运行模式卡、管理通道行、活动日志、发言上限、静默开关、DSH 模型七块进 `pages/overview/fields.js`，指标与模式卡用 `bare`/`custom` 保留原有卡片外观，`.overview-summary` 不再套 `.card` 而由宿主 `[data-overview-fields="metrics"]` 跨整行（5 列，≤1180 三列、≤760 两列）；数字框固定 88px 不被 `.field-inline` 拉满；定时静默开关改 `role=switch` + `getSwitch`/`setSwitch`，时段行的动态渲染仍留在 `page.js`，只补列宽与窄屏堆叠；活动日志限高 320px 可滚动）；全部 15 个页面已迁完（`page.html` 手写控件全部为 0，`BARE_CONTROL_BASELINE` 只剩 0）；`usage` 的四个指标块、图表控件、会话表、逐轮明细（会话下拉 + 「加载逐轮明细」仍是一行 `.usage-controls`，`.select-wrap` 要按内容收窄否则箭头跑到行尾）、最近流水与价目表两折、压缩模式单选与保存已进 `pages/usage/fields.js`，同时删掉 `pages/usage/page.css` 里重复了一整份的私有样式块；`plugins` 的工具行（刷新 / 全部重载 + 状态位）、插件卡片列表、注入块 / 运行设置 / 安装三块设置与详情弹窗已进 `pages/plugins/fields.js`（开关改 `role="switch"`，读写走 `getSwitch`/`setSwitch`；运行设置的「高级」子折叠取消，两个开关 + 两个数字 + 允许安装平铺，数字带单位 ms / 字符），`page.html` 只剩说明与宿主；`behaviors` 的工具条（刷新 + 来源/权限筛选 + 搜索）与三块表格宿主已进 `pages/behaviors/fields.js`，按 group 折叠的注册表仍保留自绘分组表（分组跨页会断行，因此不接 `dataTableHtml` 的分页），`page.html` 只剩说明与 4 个宿主；`sessions` 的两张表已换 `dataTableHtml`（平台 / 类型筛选、搜索、刷新、20 条分页），标签条与面板宿主、改名弹窗标题字段都进 `pages/sessions/fields.js`；`operations` 的测试发送 / 桥接控制 / 后台引导三块已进 `pages/operations/fields.js`（目标行用 `.control-row`、危险动作走 `danger`）；`access` / `reference` / `mcp` / `skills` / `overview` / `social-v1` / `social-v2` / `scheduler` / `persona` / `slang` 已为 0；`access` 的白名单 / 安全拦截 / 控制台令牌三块已进 `pages/access/fields.js`，拦截通知改开关，两处警示块（state 目录权限、SnowLuma 收不到数据）作为 `custom` 保留）；2026-11-07 全部 15 页均已迁完（`page.html` 手写控件归零、`BARE_CONTROL_BASELINE` 全 0），表单/表格/弹窗/开关/日期时间统一走组件与字段规格；差 §8.9 步骤 3.5 的 empty-state / tabs / collapse 三个展示组件（可选项）未做） | 约定见 `docs/CONSOLE_UI.md`；`public/console/components/<name>/{<name>.js,<name>.css}` 已存在 5 个组件 | 1440 宽下会话/管理行为/黑话三页与右上角搜索框外观一致（`state/step2-sessions.png`），`social-v2` 字段已改成「标题在上、控件在下」两列（`state/socialv2-enhanced.png`）；`node scripts/test-console-static.mjs` 全过（组件目录、样式归属、`type="search"`、控件标尺、手写控件棘轮、类名定义五类断言）；`node scripts/test-audit.mjs` 90/90；浏览器回归 27/27（`PLAYWRIGHT_MODULE=playwright-core npm run test:console-ui`，其中几何断言只量单行字段，清单/表格行刻意顶对齐，另含「同一动作条按钮同高」与「弹窗头/体/脚 + 自带关闭」两条）；长页面重排优化：`.settings-group` 加 `content-visibility:auto` + `contain-intrinsic-size:auto 600px`，DevTools 设备模式逐档改视口时，16 组全展开的 `social-v2` 每帧主线程 30.7ms → 7.3ms（原因与对照数据见 `CONSOLE_UI.md` §5.1）；1666 宽截图验收通过（概览首卡、左侧菜单、工具表格、唤醒开关两列、页头顺序）；`scheduler` 1600 宽截图确认 5 张卡片、页头保存按钮在条内、安全限制标签等高对齐、编辑器整行铺满、0 个 JS 错误；2026-11-07 全站迁移收口：`BARE_CONTROL_BASELINE` 15 页全 0，static 全过 / UI 27/27 / audit 90/90，1600 与 1024 两档逐页冒烟（15 页）全部 `data-page-ready`、无 JS 错误、无横向溢出；每页一提交（096fe69、bbaf323、3ca2e78、2f62ff4、59d6bc4、778d97e、882b99e、2b34f7b、cfb4b59、4bfcdd7、7a67268、9101a18、fab4c9f、be23910）；同日第二批 UI 反馈收口：`plugins` / `social-v2` 的折叠组各自独立成卡（`.card.is-group` 只去壳、不覆写 summary 字号颜色，暂停/恢复合并为 `v2PauseToggle` 单按钮）、左侧「会话与审批」角标统一为**待处理数**且 0 时隐藏（`app.js` 与 `sessions/page.js` 同一写法）、`input[type=file]` 统一 `::file-selector-button` 站内按钮样式、上下文压缩卡改成两行 `.field-row`、`custom` 无 label 时不再生成 `.field-row` 空壳（access 安全卡不再多 102px）、静默时段改成表格（`<colgroup>` 固定列宽、窄屏横向滚动，启用/跳过节假日为 `role=switch`、时间用 `components/time/`、删除为垃圾桶图标），static 全过 / UI 27/27 / audit 90/90；同日管理行为的分组表收进表格组件——`groupedTableHtml`（`<colgroup>` 列宽 + `tr.group-row` + `tr.group-child`）与 `initGroupedTables`（事件委托、回车/空格可切、写 `aria-expanded`），组行底色/三角旋转样式从页面级 `.tool-log-table` 搬到 `components/table/table.css`，修好迁移后「组行点不动、样式丢失」的缺陷 | — | 中 |
| 15 | 统一注入块来源与记忆注入（路线图 §8.10） | `Partial`（2026-11-06 立项、**2026-11-07 方案已批准**，见 `docs/MEMORY_SUBSYSTEM.md`（模型/配置/迁移映射/S1–S5 与判据）与 `docs/PLAN_DEVIATIONS.md`（D1–D3）；现状：`core-digest` 是 nexus 自己的轻量记忆，soulkit 长期记忆没有通道；S1 已开工：块注册表统一（`owner`/`label`/优先级/上限/最近字数/状态、`setOverrides` 接管 `config.json.promptBlocks`、插件块默认不限）、`/api/plugins` 返回全量 `promptBlocks`、插件页「注入块」区改为全量表格并可逐块开关/改上限（2026-11-07）；**S2 已完成**（2026-11-07）：`src/memory/registry.mjs`（provider 注册表：sync 直取 / async 预热缓存、TTL 60s、超时 900ms、上限取小、截断记 `truncated`）、`src/memory/defaults.mjs`、`core-memory` 块（priority 200）替换 `core-digest`、`config.json` 新增 `memory.*`（旧 `promptBlocks['core-digest']` 兼容读成 `providers['local-digest']`）、内核新增 `memory:provide` 权限与 `ctx.memory.registerProvider`（staging → commit、按 pluginId 注销）、`GET/PATCH /api/memory`、`formatMemoryV2(st, limits)` 参数化；`test-core-prompt-blocks.mjs` 增加 memory 用例（关 provider 无记忆段 / 上限截断 / 旧配置等价）；**S3 已完成**（2026-11-07）：新增 `plugins/soulkit-memory/`（`memory:provide` + `net:http`，把桥接 `qq:<kind>:<id>` 削成 soulkit 的 `<kind>:<id>`、取尾部 600 字作 query、`POST /api/recall` 取 `text` 兼容旧 `block.text`、`abstained` 视为空）、清单校验新增 `memory:provide` 权限、运行配置的注入源切到 `soulkit`（`memory.providers.soulkit` 启用、`maxChars` 1200、`timeoutMs` 900）、旧的 `promptBlocks['core-digest']` 键已删除（内置 `local-digest` 仍是项目自带默认实现，保留可用）、`scripts/test-soulkit-memory.mjs` 6/6（key 映射 / query 截断 / 旧形状 / 非 200 / 注册表预热-截断 / 失败静默）；**S4 已完成**（2026-11-07）：`memoryRegistry.recall()` 联邦查询（async 直接 fetch、单源≤800 字 / 总≤2000 字 / 最多 5 源、单源失败只留 `error`）、`memoryRegistry.note()` 写回（主源可写优先，否则退到第一个 `write:true` 的 provider，见 PLAN_DEVIATIONS D4）、`local-digest` 实现 `note()`（记成进行中的话题）、新增 `qq_memory_recall` / `qq_memory_note` 两个 MCP 工具与 `POST /api/socialV2/memory-recall` / `memory-note` 端点（agent token + 会话白名单 + `memory.tools.*` 三道校验、文本脱敏）、`scripts/test-memory-tools.mjs` 6/6、真机 recall 返回 soulkit 片段（800 字截断）；**S5 已完成**（2026-11-07）：新增「记忆」页（`pages/memory/`，聊天行为分类下）——注入源单选与上限/超时/缓存、provider 卡片（开关/地址/上限/超时/状态）、本机轻量记忆查看与编辑（话题/想法/印象/管理员长期规则只读）、工具与交接开关、写回队列与最近 20 条注入/回忆记录；旧的 `socialV2.tools.memory` / `handoverMemory` 开关与二代仿真页「轻量记忆」组原处移除，改由 `memory.providers['local-digest'].tools.enabled` / `memory.handover.enabled` 接管（bridge 新键优先、旧键回落）；新增 `src/memory/ingest.mjs` 写回队列（默认关闭、关闭时零外发、队列落盘 `state/memory-ingest-pending.json`、批量 40 条/1.5s、失败保留并记 `lastError`），入站收非命令用户文本、出站只收模型回复；`GET/PATCH /api/memory` 返回与更新 `ingest`；`scripts/test-memory-ingest.mjs` 6/6；仍未做：§8.10 的声明式块来源 `source.type` 的 `text`/`file`/`http` 三种（当前只有內置 `builtin` 与 `memory`），以及记忆页之外的可选监控打磨；**S6 已完成**（2026-11-07，轻量记忆重做）：`local-digest` 改为真正的 provider（`src/memory/local-store.mjs`，数据落 `state/local-memory.json`、条目带 id、注入与存储上限分离、`manage` 契约），新增通用 `/api/memory/entries`、`/entries/clear`、`/rules`、`/recall`、`/note`；删除 `/api/socialV2/memory-*` 与 `group-rule`（不做别名）、删除 `formatMemoryV2`/`appendMemoryV2` 与 `social-v2.json` 的四个记忆字段（旧数据按用户要求直接丢弃、不迁移），MCP 五个记忆工具改调新端点；记忆页本机段改为「会话表（列出已建立记忆的会话与各类条数，可新增会话、管理、清空、删除）→ 四类 tab + 表格（工具栏搜索/刷新/新增）→ 同一弹窗内编辑」，弹窗与定时任务同构（`modal--wide` + `renderFields` + 三段式），并含注入/存储上限分组；static 全过 / UI 28/28 / audit 90/90） | 所有块统一注册表（`owner` = `core` / `plugin:<id>` / `declared`）、声明式 `source`（`builtin`/`text`/`file`/`http`/`memory`）、`memory:provide` 权限与 `ctx.memory.registerProvider`、`plugins/soulkit-memory/` 适配 `POST /api/recall`、`core-memory` 块（priority 200，配置走 `memory.*`） | 新增 `file` 类型块只改 `config.json` 即生效（源码零改动）；块取数失败只跳过该块且唤醒照常完成；soulkit 停机时记忆段为空不阻塞；`test-prompt-blocks` 覆盖「正常 / 文件缺失 / 超预算 / 热关」四个用例；记忆上限可配且截断可见 | soulkit `POST /api/recall` 可用（2026-11-06 已验证路由存在、`view:'self'` 免令牌）；不改 soulkit，不改它的绑定 | 高 |

| 16 | 会话子系统重构（`docs/SESSION_SUBSYSTEM.md`） | `Partial` | 把散落的按会话配置收成 `state/sessions/` 目录（`defaults.json` + 每会话文件）；被动/主动每轴一条全局名单（白名单/黑名单二选一，单源；见 D19）；会话级运行模式/模型/预设；DSH 自愈、启动对账与确定性命名；owner + 管理员两级。**P0 已完成**（确定性命名、启动/手动对账、not-found 自愈一次 + 60 秒 3 次熔断、`/api/sessions` 健康度与重建按钮、`test-session-lifecycle`）；**P1 主体完成**（目录存储与启动迁移、档案读写/删除端点、控制台列表并集与详情弹窗七卡、关闭前未保存确认、双清空、persona/二代/访问三处旧入口迁走、`test-session-directory` 6/6、`test-session-profiles` 4/4）；**P2a 完成**（`src/session/mode.mjs` 的 `resolveEffectiveMode`、单会话全部门禁改 `effectiveMode`、会话级 preset 与 `modePreset` 指纹、详情「运行」卡与「定时任务」只读卡、`test-session-mode` 5/5）；**P2b 模型部分完成**（档案级 `model` 与 `profileModelSignature` 进策略指纹、`ensureChatModel` 按会话模型 `selectModel`、详情模型/思考强度控件、看图能力按会话模型降级、`test-session-model` 5/5）；**P2b 主动检查点方案 A 完成**（scheduler 跳过通知按任务+日期去重并私聊创建者、v1 按会话 `socialEnabledForKey` 与 `proactiveAllowed` 收紧、随机触发同样受主动轴约束、跨会话发送明确拒绝、`test-session-proactive` 3/3）；**2026-11-11 D20 主动准入收口**（准入改为按统一原因表 `WAKE_REASON_AXES` 判定：投递闸门、`scheduleWakeV2`、回复检查、潜水到期、静默结束与 DSH 断线补投全部过主动轴，会话详情保存准入后立即重排；`test-session-proactive` 6/6 含实投用例，全量 audit 103/103）；**P3 完成**（`src/admin/admins.mjs` 名单/capability/级别纯函数、配置 `admins[]` 启动校验、管理员私聊审批与状态命令、审批通知 owner+notify 管理员、closed-agent 按 maxLevel 限级且 L3 只 owner、`/api/whitelist` 返回/保存 admins、访问页管理员表、审计 actor、`test-admins` 6/6；控制台仍单 token owner，见 D18）；**准入两态单源完成**（`state/sessions/defaults.json` 每轴 `{mode,entries}`、档案只存成员关系、旧三态迁移后删除、`GET/PATCH /api/access` 唯一入口且翻转需确认、status/scheduler/reconcile/语音/MCP 同源、`/api/whitelist` 只留 owner/admins、删除 `mode-gate` 与 MCP 自查白名单、控制台统一表单两列名单、详情只读成员关系、`test-session-access` 5/5、`test-audit-bridge` 16/16，audit 96/96、UI 28/28、static 全过）；**未完成**：`test-session-migrate` 与详情弹窗 UI 专项用例（目前由 `test-session-directory`/`test-session-profiles`/`test-session-access` 与真机探针覆盖）；方案 B（AI 跨会话工具，已列入后续计划 D17）。验收标准尚差这两项测试，故仍为 `Partial`。 | P0 判据：`test-session-lifecycle` 4/4、static/UI/audit 全绿、控制台会话表显示 DSH 状态且可重建；P1 判据：`test-session-directory` 6/6、`test-session-access` 5/5、static/UI/audit 全绿、旧文件/旧键/旧读取分支不存在、详情可保存并落盘（真机探针验证）；P2–P3 判据见 `docs/SESSION_SUBSYSTEM.md` §11；每阶段收尾必须：对应单测全过 + static/UI/audit 全绿 + 旧键/旧文件/旧读取分支不存在 | 用户确认本方案（已确认 P0、P1）；P2 依赖 P1 的档案与详情页 | 高 |

**2026-11-11 D21 注入块与运行方案归一（P1–P7）**：唤醒提示词改由注入块注册表按 slot/priority 拼装（26 块、3 种档案，golden 逐字节等价）；注入块独立页；定时任务/静默/插件/手动静默/人格上限迁入 `config.json`；运行方案成为唯一入口（`state/runtime.json` 指针 + 会话 `planId`，引擎/能力/行为/受众由方案决定）；行为档案改 kind 注册表、方案页带能力授予（`config.capabilities` + 9 个可收紧写工具）。
**2026-11-11 D22 能力与工具归一（P10.1–P10.4）**：能力改为单一源 `dsh/agent-presets/<id>/capability.yml`（工具/Agent 模块/MCP/技能/安全一段写全），`preset.yml`、`agent.cordis.yml`、`extensions.yml` 全部由 `scripts/build-capability-artifacts.mjs` 生成并带 `--check`；`config.capabilities` 删除，服务端只认能力文件（`src/capabilities/store.mjs`），`v2ToolEnabled` 按会话方案的 `capability` 判定；`plan.tools` 迁移为 `plan.capability`（旧 `qq-*` 预设 id 自动折算）；能力编辑器改为「平台工具 + Agent 模块 + 安全补充」，模板四条 `agent-chat/agent-readonly/agent-workspace/agent-full`，`qq-chat` 与 `qq-chat-v2` 合并。全量 audit 114/114。

---

## 2. 已完成（可复核，供对照）

只列「别人容易误以为没做」的部分，细节见 `docs/PLUGIN_ROADMAP.md` 与 `CHANGELOG.md`。

| 块 | 状态 | 复核方式 |
| --- | --- | --- |
| 插件内核 P1（钩子、权限、审计、生命周期）与人格 provider | `Done` | `node scripts/test-plugin-kernel.mjs`、`node scripts/test-soulkit-persona.mjs`、`node scripts/test-persona-resolve.mjs` |
| 启停/重载/详情、zip 与目录安装、文件监听（默认关） | `Done` | `test-plugin-kernel`、`node scripts/test-plugin-install.mjs` |
| 命令注册表与「扩展」四页、插件注册命令 | `Done` | `node scripts/test-command-registry.mjs` |
| 具名注入块（插件块 + 内置 `core-stickers` / `core-digest`） | `Done` | `node scripts/test-prompt-blocks.mjs`、`node scripts/test-core-prompt-blocks.mjs` |
| 技能清单 provider 化（路线图 §9.2） | `Done` | `node scripts/test-skills-index.mjs`、`node scripts/test-core-prompt-blocks.mjs`（`core-skills` 用例）；配置见 `config.example.json` 的 `skills` 段 |
| 控制台「会话与审批」页（会话映射 + 审批标签页，PARITY D3/D7 第一步） | `Done` | 打开控制台「会话与审批」：会话映射页签有 平台/类型 筛选、模式/人格/未读/最近唤醒/改名（不含 DSH 会话 id 与清除上下文）；`POST /api/session/rename` 见 `test-audit-bridge.mjs` 的改名用例；`GET /api/sessions` 的一次性字段见 `src/bridge.js` |
| 控制台搜索框统一（`class="search-box"`） | `Done` | `components.css` 的 `.search-wrap input,input.search-box` 一条规则；三个页面五个输入框已套用，见 `behaviors`/`sessions`/`slang` 的 `page.html`；约定见 `docs/PLUGIN_ROADMAP.md` §12 第 8 条 |
| 出站装饰 `onReplyDecorate`、入站过滤 `onInbound` | `Done` | `test-plugin-kernel` 的装饰/过滤用例 |
| 定时任务类型插件化 | `Done` | `node scripts/test-scheduler.mjs` |
| 配置面板 P5（注入块、运行设置、插件持久化） | `Done` | `test-plugin-kernel` 的设置接口用例 + 手动核对控制台 |
| 控制台前端规范化 3.1–3.4（页面自包含、组件层、样式分家） | `Done` | `node scripts/test-console-static.mjs` 与 `public/console/pages/*/` 的十五个页面目录 |
| 控制中心目录化 3.5、401 门页、共享设计令牌、CSP 收紧 | `Done` | `public/control-center/`、`node scripts/test-control-center.mjs`、`node scripts/test-console-static.mjs` |
| `bridge.js` 抽层 P7 第 1–5 步（HTTP / 命令 / 会话 / 上游 / 收口清红） | `Done` | `node scripts/test-integration-v030.mjs`、`npm run test:audit` |

---

## 3. 明确不做

见 `docs/PLUGIN_ROADMAP.md` §10（插件市场与签名、插件独立进程、多 provider 竞争、插件读写仓库文件、插件访问 DSH 内部对象、事件总线式任意钩子、QQ 之外的平台适配器）。这些不进本表，避免把「决定不做」和「还没做」混在一起。

---

## 4. 复核命令

```powershell
# 全量门禁（当前基线：90/90）
npm run test:audit

# 跨版本集成
node scripts/test-integration-v030.mjs

# 浏览器回归（需要 playwright-core 与本机 Edge）
$env:PLAYWRIGHT_MODULE='playwright-core'
npm run test:console-ui
```

数字变了就是变了——基线不接受「偶发」解释，除非能在干净 HEAD 上复现同样的失败。

---

## 5. 真机联调记录（2026-11-05 深夜，单号单客户端切换窗口）

环境：nexus 在 3111 接管 SnowLuma（`ws://127.0.0.1:3001`，HTTP token 走 `snowluma.homeDir` 下的 `config/onebot_2890363827.json`），DSH 桌面版随机端口自动发现到 `57254`；`qq-bridge-enhanced` 的 watchdog（`DSHBot\start.ps1 -Watch`）与其 bridge 已停，验证后已按 A 方案回滚（`socialV2.enabled` 改回 `false`、nexus 重启）。

已验证（有日志/接口证据）：

| 项 | 证据 |
| --- | --- |
| SnowLuma 连接与账号 | `SnowLuma 1.14.19-node 已连接：ws://127.0.0.1:3001`；`/api/status` → `botAccount={userId:2890363827,nickname:星苒}`、`snowluma.connected=true` |
| 白名单与越权拒绝 | 私聊 `private:2897715886` 正常处理；群 `group:903621673` 打出 `忽略未授权会话` |
| 会话建立与回复（chat 路径） | `23:04:34 会话 private:2897715886 已挂载 preset qq-chat` → `新会话 … session-d3a9b6aa…` → `agent 回复 (private:2897715886) 9 字` |
| 唤醒路径 | `23:47:44 唤醒 private:2897715886（private）` → 新会话 `session-c71a72c9-d80c-4941-959d-49c7f7cb4875`（reserved2 / qq-chat-v2）；`/api/socialV2/state` → `wakeCount=1`、`lastWakeReason=private` |
| 注入块真的组装了 | `/api/plugins` → `core-stickers` / `core-skills` / `core-digest` 三个块 `calls` 均为 **2** |
| 人格 provider 取卡 | `/api/persona/sources` → `provider:soulkit`、`rows:[{key:'private:2897715886',source:'provider',name:'魅魔2',stale:false}]` |
| 未授权群不抢答 | 同段日志 `忽略未授权会话 group:903621673`（非白名单） |

未验证（阻塞原因写清，不写成「待办」）：

- **回复发送**：唤醒会话里 `mcp__snowluma__*` 调用 `qq_send_message` / `qq_mark_read` 报 `fetch failed / ECONNREFUSED 127.0.0.1:3100`。根因是 `C:\Users\starl\.dsh\profiles\desktop\cordis.patch.yml` 的 `# === qq-bridge MCP BEGIN/END ===` 区块仍指向 `qq-bridge-enhanced\src\mcp-*.js`，而这些脚本以自身仓库为 `ROOT` 读 enhanced 的 `config.json`（`consolePort:3100`）与 enhanced 的 `state/console-token`。修复动作明确：跑 `node scripts/setup-dsh.mjs` 把该区块重指 nexus，再重启 DSH（会中断当前会话）。用户已手工改过 enhanced 的 MCP 与 DSH 插件，故这一步交由其决定。
- **`onReplyDecorate` 真实生效、插件任务类型按时触发、`operator` 只读令牌边界**：本轮窗口没覆盖，靠上面那次修复后再补。

---

## 6. 主键形态变更与数据迁移

原则：**主键形态变更不做数据迁移**——nexus 启用后从新会话开始，旧会话映射与旧会话级状态一律作废。少一个长期维护的迁移工具，也少一条「代码形态与磁盘数据对不上」的隐蔽故障路径。

做法与边界：

- 变更前后各跑一次门禁；动手前把 `state/` 整目录备份成 `state.bak-<时间戳>`（已在 `.gitignore` 里），观察一个周期后再删。
- **会丢的**（有意丢）：`sessions.json` 的「会话 → DSH 会话」映射、`social-v2.json` 的每会话唤醒配置与未读数、`prompt-blocks.json` / `role-seen.json` / `persona-cache.json` 这些以会话 key 为索引的缓存。
- **不受影响的**（不以会话 key 为索引，只要不清 `state/`）：群规则、定时任务、人物库、黑白名单、人格卡本地库、审计日志。
- **孤儿 key 不报错**：形态变化后旧形态 key 查不到任何东西、日志也不告警；需要旧数据只能翻备份。

### 6.1 会话 key 平台化（2026-11-06，已完成）

- 形态：只有一种 —— `<platform>:<group|private>:<id>`（qq 即 `qq:group:<id>` / `qq:private:<id>`）；**没有开关**，旧形态 `group:<id>` 只在读取侧被 `parseKey()` 兼容。
- 代码：`src/session/key.mjs` 统一组装/解析/判等（`formatKey`/`parseKey`/`sameSession`/`isGroupKey`/`isPrivateKey`/`idOfKey` + 进程级 `configureKeys()`/`key()`）；`src/bridge.js` 18 处构造、7 个业务模块（`social/people.js`、`owner-relay`、`group-rules`、`memory-policy`、`mcp-snowluma-safe`、`bridge-extensions`、`session/mode-gate`）全部改走该出口。
- 解析侧（2026-11-06 补齐）：`src/bridge.js` 43 处、`prompt-blocks.js`、`role-per-key.js`、`role-refresh.js`、`mode-handover.js`、`voice-core.js`、`social/memory-policy.js`、`social/cross-group.js`、`scheduler/engine.js` 的正则/`split(':')`/`startsWith('group:')` 全部换成 `parseKey()`/`isGroupKey()`/`isPrivateKey()`；`sendToQQ` 等 8 处发送解包改 `parseKey()`（此前 `qq:group:1` 会被解成 `kind='qq'`、`id='group'`，实际发 `sendGroupMessage(null)`）；HTTP 接口的 `key` 参数（19 处 query + 35 处 body）统一经 `apiKey()` 归一，`ensureSession()` 也归一；`admin/approvals.js` 用 `normKey()` 归一登记与匹配。
- 门禁：`scripts/test-session-key.mjs` 11 条；`test-integration-v030` 31/31；**`npm run test:audit` = 90/90**（迁移过程中一度回落到 78/90，逐项修完）。
- 已删除：`src/core/session-router.mjs` 及其测试（全仓库无引用、未登记门禁，属死代码）；`scripts/migrate-session-keys.mjs` 及其测试（按本节策略不再需要迁移工具）。
- 已发生的偏差：本机在定策略**之前**跑过一次迁移（8 处 / 5 个文件），备份 `state.bak-2026-11-05T20-23-59-947Z`。这不影响策略，只是「旧会话映射作废」这条提前发生了。
- 回滚：没有开关可回；要退回旧形态需回滚代码提交，再从 `state.bak-*` 手工还原需要的文件（没有自动工具，这是策略的一部分）。
- 夹具教训：① `scripts/test-qq-model-view.mjs` 的临时目录只拷被 spawn 的 3 个文件，`mcp-snowluma-safe.js` 新增依赖 `src/session/key.mjs` 后子进程 import 失败、报 `MCP error -32000: Connection closed`；已补拷依赖。**给被单独 spawn 的模块加 import，要同步修「只拷部分文件」的夹具。** ② VM 夹具会剥 import，`parseKey`/`isGroupKey`/`isPrivateKey`/`idOfKey` 都要同时加进 sandbox 列表，否则 `ReferenceError`。

### 6.2 已修复：解析侧未迁移导致私聊静默丢失（2026-11-06）

- **现象**：`platform.keyedFormat: true` 时，私聊消息能进 `bot.onPrivateMessage`，但既不进未读、也不报错、也不打 `忽略未授权会话`，日志完全静默；`/api/sessions` 永远空。
- **根因**：只迁移了 key 的**构造**，没迁移 key 的**解析**。`src/session/mode-gate.mjs:44` 的 `isSessionAllowedInCurrentMode()` 仍用 `/^(group|private):(\d+)$/`，形如 `qq:private:2897715886` 的 key 直接判 false；`src/bridge.js:13347` 的 `if (!isSessionAllowedInCurrentMode(key)) return;` 是静默返回 ⇒ 消息在准入闸门被丢弃。
- **处置（已完成）**：解析侧全部改走 `parseKey()` 系（见 6.1）；`platform.keyedFormat` 这个开关已彻底删除（`src/bridge.js`、`config.json`、`config.example.json` 三处），因为形态只剩一种，留着就是技术债。
- **复测**：重启后 `消息已入未读` 正常、`/api/sessions` 有真实数据（`qq:private:2897715886`、`mode: reserved2`、`preset: qq-chat-v2`）、强制唤醒生成 `session-8031d170-…`。
- **教训**：改主键形态必须**同时**改「产出」和「解析」，并且要用真机跑一遍私聊链路 —— 单元测试全绿也可能整条消息链静默断掉。

### 6.3 已修复：soulkit 人格卡的 key 形态（2026-11-06）

- **现象**：key 改成 `qq:private:…` 后，`/api/persona/sources` 里该会话一直是 `source: "none"`（会话页显示「未挂卡」），日志 `⚠️ 人格卡刷新失败（保留旧缓存）：fetch failed`。
- **根因**：soulkit 的绑定按 `<group|private>:<id>` 存（平台由 `platform` 查询参数表达），`GET /api/persona/card?key=qq:private:2897715886` 返回 `mode: "none"`；同样的会话用旧形态 `private:2897715886` 能拿到 `mode: "card"`（魅魔2、`sha: 159bdbe855`）。桥接把平台前缀原样传给了它。
- **处置（已完成）**：`plugins/soulkit-persona/index.mjs` 的 `cardUrl()` 增加 `soulkitKey()`：认得出 `<platform>:<kind>:<id>` 就剥成 `<kind>:<id>` 再请求，认不出则原样透传（旧形态与自定义 key 行为不变）。**soulkit 侧未改**，它的绑定与其它入口不受影响。
- **验证**：`scripts/test-soulkit-persona.mjs` 8/8（新增「新形态 key 剥前缀」用例）；真机复测 `/api/persona/sources` → `{key:'qq:private:2897715886', source:'provider', name:'魅魔2', stale:false}`，注入块正常。
- **遗留**：soulkit 仍然是「读通了、写没通」（PARITY D2/D6）——桥接没有 `persona-bind/1` 的写绑定能力，换角色仍只能走 soulkit 自己的入口。

### 6.4 会话子系统 v2 配置迁移（2026-11-08 起，对 §6 的例外）

本轮是**按会话配置的合并迁移**，不是会话 key 形态变更；旧绑定会迁入 `state/sessions/` 目录里对应会话文件的 `binding`，不作废。因此 §6 的「主键形态变更不做迁移」与「动手前备份 `state.bak-*`」两条按下面执行：

- 迁移代码**不生成 `.bak`**；如本机需要人工快照，放仓库外，验证后删除。仓库与 `state/` 的正式版本不保留备份文件、不保留旧配置。
- 迁移先写 `defaults.json` 与每会话文件，回读校验后把 `migratedAt` 作为提交点；提交前失败保留旧来源并清理本次新文件，提交后崩溃继续清理旧键。
- 迁移失败时报错并拒绝进入会话子系统；成功后才删除旧文件与旧键；不提供兼容读、不双写。
- 回滚靠代码回滚 + 仓库外人工快照，不提供运行时回滚工具。
- 原因与判据见 `docs/SESSION_SUBSYSTEM.md` §9 与 `docs/PLAN_DEVIATIONS.md` D7–D9。

### 6.5 手动静默（2026-11-08，已完成）

- 语义：手动静默由 owner 在运行总览开启，直到手动恢复，不自动过期；owner 私聊始终例外；管理员不能开启或解除。静默决定“进入后 AI 是否活动”，不改变准入名单。
- 策略：`mode:'full'|'sendOnly'`；五个环节（被动行为/主动行为/定时任务·叫 AI 来说/定时任务·固定文字/插件任务）可单独勾选；`adminApplies` 控制管理员是否按普通目标处理（owner 始终不受影响），`recordMessages` 控制静默期记录群消息，`catchUp` 控制解除后最多补一次唤醒。
- 定时任务：固定文字与「叫 AI 来说」共用管理员开关/owner 豁免矩阵；普通群/好友停，管理员仅在 `adminApplies` 开启时停，owner 永远照发/可唤醒；被跳过的定时 AI 不补跑，也不重排定时任务。`sendOnly` 只拦发送，AI 仍会唤醒并消耗 token。
- 实现：`src/manual-silence.mjs` 定义策略与判定；`src/role-per-key.js` 持久化 `silent`；`src/bridge.js` 的 `setManualSilenceMode` 统一 `/api/role-mode`、`/silent`、`/active`，并在入站、唤醒、发送、定时投递处统一门禁；开启冻结 pending/sleep/reply/proactive 计时器，解除后按未读/休眠重排并最多补一次 `silenceEnded`。
- 界面：总览页移除旧「静默期间」三选一与旧复选，改为手动模式、五环节、三个行为开关、锁定/已静默时长；开启与关闭合并为一个「开启手动静默 / 关闭手动静默」切换按钮；定时静默只保留开关、时区、时间段。
- 边界：管理命令与审批走独立通道；群里的 owner/管理员不单独豁免；`sendOnly` 不省 token；静默期间不中断正在执行的 AI 回合，但后续发送会被发送门禁拦住。
- 验证：`test-manual-silence.mjs` 9/9、`test-silence-schedule.mjs` 4/4、`npm run test:audit` 97/97、UI 28/28、static 全过；真机重启后 `/api/silence`、`/api/role-mode` 的 silent/active 往返正常。

### 6.6 扩展平台 P1：真实 catalog 与 MCP 页（2026-11-09，已完成）

- `GET /api/extensions` 升级 v2：`src/extensions/catalog.mjs` 汇总技能与 MCP；`src/extensions/mcp-inventory.mjs` 用 MCP SDK 启动三个内置 server 并调用 `tools/list`，5 分钟缓存、15s 超时、单 server 错误隔离、`?refresh=1` 强制重扫。
- MCP 页合并独立工具参考：server 概览 + 工具参考两张表，显示真实工具名/描述/数量；页面标题改「MCP 与工具」；独立 `reference` 页、导航、路由与 `#section-reference` 全部移除，旧 `#reference` 重定向到 `#mcp`。
- 实测工具数：`snowluma-host` 1、`web-search-safe` 2、`snowluma-safe` 48，合计 51；此前页面显示的 0 是假数据。
- 验收：`test-extension-catalog.mjs` 4/4、static 全过、UI 29/29、audit 98/98；真机 `GET /api/extensions` 返回 `summary{servers:3,online:3,errors:0,tools:51,skills:1}`。
- 偏差：见 `docs/EXTENSION_PLATFORM_DEVIATIONS.md` E4–E6（整页移除 + 重定向、v2 不保留旧字段、运行时 `tools/list` 而非静态源扫描）。

### 6.7 扩展平台 P2：Hub 与外部 MCP（2026-11-09，已提交 `de95c4a`）

- 新增 `src/mcp-bridge-ext.js`（MCP stdio server）：对 DSH 只暴露 `ext_list` / `ext_describe` / `ext_call`；每个调用把 `x-hub-token` + `x-agent-token` 转发到 bridge 内部 `/api/extensions/hub/*`，bridge 用 agent token 反查会话与 preset，再按 preset 的 `extensions.yml` 做 server 与工具级 allow/deny。
- 外部 MCP 管理：`extensions/mcp/<id>/server.json` 为配置态；`state/extensions/secrets.json` 存 `secret:<name>` 实际值（0600）；`state/extensions/logs/<id>.log` 存 stderr 环形日志；`src/extensions/mcp-runtime.mjs` 懒连接、30s 初始化/60s 调用/300s 硬上限、单 server 错误隔离；`src/extensions/mcp-store.mjs` 校验 id/transport/stdio allowlist/HTTP 私网/秘密引用。
- 控制台 MCP 页：内置 server 只读展示真实 `tools/list`；外部 MCP 行提供编辑/测试/刷新/日志/删除；新增 MCP 弹窗复用表单组件；`#reference` 旧入口重定向到 `#mcp`。
- 预设策略：`dsh/agent-presets/qq-chat-v2/extensions.yml` 允许外部 MCP 与技能；其他预设无文件即默认拒绝。DSH `agent.cordis.yml` 是插件数组，不能追加顶层 mapping，所以策略独立存 `extensions.yml`。
- 验收：static 全过、UI 29/29、audit 无失败、扩展模块测试 14/14；真机 3 内置 server + 51 工具、外部 `test-ext` CRUD/测试/日志、Hub `list/describe/call` 与 401/403 均通过；DSH 已加载 `mcp__bridge_ext__*` 三工具。
- 边界与偏差：见 `docs/EXTENSION_PLATFORM_DEVIATIONS.md` E7–E12；P2 第一版不提升内置 MCP/插件工具、`tools/list_changed` 先显式 refresh、`ext_list` 不自动连接、Hub 本身需一次 DSH 重启。P0 `compress` 仍为 Partial（真实长会话自动压缩未触发）。

### 6.8 扩展平台 P2 后续：MCP 页重构与删除修复（2026-11-09，已完成）

- MCP 页统一表格：来源/状态用 `.pill`（内置/外部、在线/读取失败），状态列按「来源 + 状态」排列；失败提示移到工具栏，说明列不再回显原始 `Streamable HTTP error`；server 表补来源/状态筛选、搜索、刷新，工具表补 server 筛选、搜索、刷新；外部行操作列只保留编辑/测试/删除，日志进弹窗。
- 外部 MCP 弹窗重做：基本信息/连接/凭据三张卡片分组（复用 `form.js` 的 `section card:true`，标题在框内）；配置为单 JSON 文本框，按连接方式自动套用 stdio/HTTP/SSE 模板；footer 提供取消/测试连接/保存，编辑时显示日志入口；隐藏与本连接方式无关的开关。
- 新增 `POST /api/extensions/mcp/test` 草稿测试：接收未保存的 `{config,secrets}`，`mcpRuntime.test` 用临时 secret 覆盖，不落盘；弹窗测试连接使用该端点。
- 删除修复：`api(path,'DELETE')` 不带 body 时，bridge CSRF 中间件对无 content-type 的 DELETE 放行（保留 Origin 校验），不再返回 415；前端另修保存请求体，POST/PATCH 改为扁平 `{...config,secrets}`。
- 测试：`test-console-static.mjs` 全过；`test-console-ui.mjs` **30/30**（含 MCP 弹窗模板、测试按钮、标签/筛选断言）；`npm run test:audit` **98/98**。真机重启后验证：无 body DELETE 返回 200、草稿测试返回 1 个工具且 catalog 不新增、UI 新建/删除行成功、弹窗 3 张卡片/模板自动切换/日志隐藏正确；`extensions/` 运行时数据已加入 `.gitignore` 并清理测试 server。
- 偏差：E12（草稿测试端点 + 无 body DELETE 例外）。
- 踩坑记录：`docs/CONSOLE_FORM_LESSONS.md` 1.50–1.58（DELETE 415、保存体形状、meta 覆盖、pill 统一、section card、模板推导、dialog 重复处理、浏览器扩展 pageerror、契约基线更新）。

### 6.9 扩展平台 P3：技能管理子批（2026-11-09，已完成）

- 外部技能目录：`extensions/skills/<id>/SKILL.md`，状态 `state/extensions/skills-state.json`，备份 `state/extensions/skill-backups/`；新增/编辑/启停/删除、ZIP 导入（根目录或单层目录、拒绝穿越/加密/多 SKILL、≤4MB/200 文件）、只读来源 403。
- 技能索引：`src/skills/index.mjs` 支持 `rootMeta`/`extraSkills`/`list({includeInactive})`，条目带 `source/editable/active`；`render({ids})` 支持 preset 白名单；`core-skills` 按当前 preset `skills.allow` 过滤，未配置保持全量。
- API：`GET/POST /api/extensions/skills`、`POST /api/extensions/skills/import`、`GET/PATCH/DELETE /api/extensions/skills/<id>`；写操作审计、`MAX_BODY_BYTES` 6MB。
- Hub：`ext_describe` 支持 `skill`，返回技能正文；仍按 preset `skillAllowed` 与 active 校验。
- 控制台：技能页改为表格（技能/来源/状态/说明/路径/操作）+ 搜索/来源/状态筛选/刷新/自定义 meta；外部技能行「编辑/停用/删除」，只读行「查看」；编辑/导入弹窗复用表单与 modal 组件；说明 3 行截断、路径省略。
- 验收：`test-skill-store` 3/3、技能/catalog/hub 相关 14/14、static 全过、UI 30/30、audit 100/100；真机 create/detail/duplicate-409/disable/list/readonly-403/import/delete 与 Hub 技能正文均通过。
- 偏差：E13（只写外部目录、ZIP/体量限制、core-skills 未配置时保持全量）。P0 `compress` 仍 Partial；插件 `configSchema` 与预设结构化/YAML 编辑器留待后续子批。

### 6.10 扩展平台 P3：插件 configSchema 通用表单（2026-11-09，已完成）

- 清单：`plugin.json` 可声明 `configSchema`（JSON Schema 子集：object/properties 的 string/number/integer/boolean/array/enum，含 title/description/default/min/max/minLength/maxLength/minItems/maxItems/required/additionalProperties）；`src/plugins/manifest.mjs` 校验并暴露给控制台，无 schema 的旧插件继续原样透传。
- 后端：`src/plugins/config-schema.mjs` 负责 schema 规范化与配置填充/校验；`kernel.updatePluginConfig(id,patch,{reload})` 写 `plugins.json` 的 `plugins.<id>.config`、审计并重载启用插件；`testPluginConfig(id,patch)` 只校验不落盘。API：`PATCH /api/plugins/<id>/config`、`POST /api/plugins/<id>/test`。
- 控制台：插件详情改为摘要 + 由 schema 动态生成的配置表单（复用 `renderFields`，单列避免 148px 标签列压窄输入）+ 保存/测试按钮 + 最近审计日志区；无 schema 插件显示“未声明配置项”并保留原始 config JSON。内置 `soulkit-persona`、`soulkit-memory` 已补示例 schema（baseUrl/timeoutMs，memory 另有 view）。
- 验收：`test-plugin-config-schema` 4/4、插件内核/清单 21/21、static 全过、UI **31/31**、audit **101/101**；真机 `GET /api/plugins/<id>` 返回 schema，`POST .../test` 与 `PATCH .../config` 均 200，`reloaded:true`；插件详情表单读出 baseUrl/timeoutMs/view、日志与控制台无 pageerror。
- 偏差：E14（schema 只覆盖控制台需要的 JSON Schema 子集；无 schema 插件不做表单）。P0 `compress` 仍 Partial；预设结构化/YAML 编辑器留待后续子批。

### 6.11 扩展平台 P3：预设编辑器（2026-11-09，已完成）

- 源文件：五个内置预设仍以 `dsh/agent-presets/<id>/` 为权威源（`preset.yml`、`extensions.yml`、`agent.cordis.yml`）；`src/presets/store.mjs` 提供 list/read/writeMeta/writeExtensions/writeAgentYaml/listBackups/restore/apply，写前备份到 `state/preset-editor-backups/<id>/<timestamp>-<reason>/`，`apply` 执行 `build-agent-preset-patches.mjs` + `setup-dsh.mjs`，失败自动恢复。
- API：`GET /api/extensions/presets`、`GET /<id>`、`PUT /<id>/meta|extensions|yaml`、`POST /<id>/validate|apply|rollback`；写操作写 `ext.audit`；YAML 校验要求非空数组、id/name 唯一、含 `persona` 与 `qq-tool-restrict`；非法 YAML 400，apply 失败 502。
- 控制台：新增「预设」页（技能与 MCP 之间），列表显示预设/名称/说明/授权/操作（编辑、应用、回滚），说明 3 行截断；编辑区内联三段（基本信息/扩展授权/YAML 高级编辑）+ 危险能力提示，保存先校验 YAML，应用后提示新会话生效、已开始会话需重建/重启 DSH。
- 验收：`test-preset-store` 5/5、static 全过、UI **32/32**、audit **102/102**；真机 GET 列表 5 个、GET 详情、validate 200/6 行、PUT extensions 200（已回滚测试写入）、apply 200（build+setup 均成功）、rollback 200（恢复后重新 apply 成功），无 pageerror。
- 偏差：E15（共用 guard 拿不到 preset id，不提供按预设放行原生工具的假开关）。P0 `compress` 仍 Partial；P4/P5 后续子批。

### 6.12 全局配置三层模型（2026-11-09，方案已拍板）

- 文档：`docs/GLOBAL_CONFIG.md`（系统层 / 预设层 / 会话层、现有文件清单、目标布局、迁移映射、动态授权、代码编辑器与 YAML 保注释、分批计划）。
- 已定（用户 m31113/m31268）：新页面命名「全局配置」；原「访问与安全」页配置并入「安全与静默」，旧页不保留入口/摘要；诊断/通知不进全局配置；配置页不按仿真模式拆分；旧 `social-v1` / `social-v2` / `access` 页面与旧配置键直接删除，不保留别名/兼容，迁移前用 git 建基线（方案 2）；编辑器选 CM6，YAML 统一到 `yaml`。
- 核心结构调整：QQ 交互参数从 `config.social` / `config.socialV2` 移到 `config/behaviors/<id>.yml` 行为档案；预设 `preset.yml` 通过 `behavior:` 引用；会话层只保留 preset/模型/人格/提示词/准入；`socialV2.agentPreset` 与 `socialV2.enabled` 删除，默认 preset 统一为 `config.agentPreset`。
- 实施进度见 6.13；逐项实施见 `docs/GLOBAL_CONFIG.md` §10（G1–G5）。

### 6.13 G2 行为档案接入（2026-11-09，已提交 `4ace129`）

- 新增 `src/behaviors/index.mjs`、`config/behaviors/default-v1.yml`、`default-v2.yml`；`qq-chat`/`qq-chat-v2` 的 `preset.yml` 分别绑定 v1/v2。
- `src/bridge.js` 已加载行为档案与 preset 绑定，`cfg.social`/`cfg.socialV2` 通过 `AsyncLocalStorage` 按会话 preset 视图取值；`handleIncoming`、调度投递、睡眠/主动定时器、唤醒提示已包 `withBehavior`；维护类 timer 用 `optional:true`，避免管理通道因 preset 未就绪被挡。
- `config.json` 已迁移：删除 `social`/`socialV2`，新增 `tools`/`compact`/`voice`/`media`/`limits`；`config.example.json` 已同步新结构。`config.json` 仍被 `.gitignore` 排除，未入库。
- 门禁：`test-behavior-profiles` 3/3、`test-integration-v030` 31/31、`test-sticker-collect` 8/8、`test-token-economy` 36/36、static 全过、audit 103/103、`node --check src/bridge.js` 通过、`git diff --check` 干净。
- 遗留：UI 回归在 G3 阶段补跑；G3 已完成，G4/G5 待做；P0 `compress` 仍 Partial。

### 6.14 G3 全局配置页（2026-11-09，已实现并真机验收）

- 新增 `public/console/pages/config/`：左侧六分区「运行与模型 / 安全与静默 / 准入 / 行为档案 / 工具与语音 / 配置位置」，复用 overview/access/sessions 字段与逻辑，不重复 ID。
- 删除 `public/console/pages/access/`、`social-v1/`、`social-v2/` 及 nav/router/PAGE_FRAGMENTS/index section；旧 hash 不重定向；overview 只留指标与活动日志。旧 `/api/socialV2/config` 已从 `src/bridge.js` 删除。
- 新增 API：`/api/config/behaviors`（列表/读/校验/写，写前 normalize、备份 `state/behavior-backups`）、`/api/config/send-limit`、`/api/config/tools`（37 个 QQ 工具开关）；`/api/config/behaviors` 写后提示重启才生效。
- 24 个旧 audit 失败项已按新配置结构迁移；`test-voice` 83/0、`test-voice-system` 50/0、`test-web-image` 5/5；全量 audit **103/103**；static 全过；UI **31/31**，contracts 已重录。
- 真机：桥接 job `pwsh-16c04ab424ba4ac8`，`reserved2`/`dshReady=true`；`#config` 六分区、行为列表/校验/保存、发言上限、37 个工具开关均可用，无 pageerror；语音库为空（本机无音频）。
- 遗留：动态授权 picker、CM6 代码编辑器、统一 `yaml` Document（G4）；旧键清理与文档收尾（G5）。

### 6.15 G4 预设编辑器增强（2026-11-09，已提交 `169da58`）

- 动态 picker：预设页扩展授权区按 `/api/extensions` 真实 catalog 渲染「MCP 服务器 / MCP 工具 / 技能」三组复选框；工具值 `server__tool`；`*` 表示全部；失效条目保留并标“当前未安装”；picker 只写 allow，deny 仍走文本框/YAML。
- CM6：`scripts/console-codemirror-entry.mjs` + `scripts/build-console-vendor.mjs`（esbuild iife，`ConsoleCM`）产出 `public/console/vendor/codemirror.js`（~428KB）；预设页把原 YAML textarea 隐藏，CM 编辑内容实时写回，保存/校验仍读 textarea。
- CSP：`src/http/security.mjs` 的 `consoleCsp(nonce)` 只给 `style-src` 加 nonce；`src/http/static.mjs` 的 `serveConsolePage` 替换 `__CSP_NONCE__`；`src/bridge.js` 的 `/`、`/console/` 使用随机 nonce；`/console/vendor/` 纳入静态白名单。真机无 CSP/JS 错误。
- YAML Document：`src/presets/store.mjs` 改 `yaml` 的 `parseDocument`/`setIn`/`String(doc)`，meta/extensions 保存保留原注释；`test-preset-store` 6/6（含顶部注释与 `EXTENSIONS_HEADER` 不重复）。
- 回归：UI 31/31（含 picker 3 组、CM 挂载与 textarea 同步）、static 全过、`test-http-boundary` 0 fail、全量 audit 103/103。
- 遗留：其余 12 处 `js-yaml`（bridge/dsh-client/preset-prompt/web-search/skill-store/preset-policy/build/setup/测试）统一迁移留在 G5；临时 `_pw-*`/`_picker*.png`/`tools-patch-sdk.mjs` 提交前清理，SDK 补丁由 `scripts/patch-snowluma-sdk.mjs` postinstall 负责。

### 6.16 控制台配置页二轮（2026-11-09，阶段 0–4 已实现并验收）

- 导航：配置页去掉左侧竖排 nav 与「配置位置」分区，改成五个水平标签（运行与模型 / 安全与静默 / 准入 / 行为档案 / 拓展功能）；概览页删除「管理全局配置 →」重复入口，脚注回到 `#section-overview` 内；运行模式圆点全亮的问题按 `.mode-row button.active` 收窄。
- 保存模型（方案 C）：页面级悬浮保存条（`components/save-bar/`）常驻右下角，按 `read()` 快照比对脏值；只串行保存有变化的分区，逐项显示结果，失败项保留脏值；改动后改回原值自动变干净。分区 = 安全提示 / 全局准入 / DSH 模型 / 发言上限 / 访问令牌（令牌最后保存）；管理员、静默时间段、行为档案、工具开关保留各自表格/卡片上的保存按钮。离开配置页时若有脏值，弹「取消 / 不保存，直接离开 / 保存并离开」，`beforeunload` 兜底。
- 表单统一：所有字段规格改为单列（`columns: 1`），新增 `.form-stack` 统一行距 14px；卡片间距对齐站点网格 22px；卡片说明到字段 14px；单行控件限宽 460px，令牌输入 420px，文本域与编辑器整行；安全面板拆成管理员 / 访问令牌 / 安全提示 / 静默四张卡，管理员表格保存按钮进表格工具栏。
- 代码编辑器：`components/code-editor/`（`entry.mjs` + `vendor/codemirror.js` + 主题/高亮）替换预设页与行为档案的 textarea，Monaco 风亮暗配色走 CSS 变量；`npm run build:console-vendor` 重建、`npm run verify:console-vendor` 比对 sha256。
- 终端：`components/terminal/` 抽出统一外观，MCP 日志弹窗、插件日志、控制中心终端三处共用（控制中心经 `/shared/terminal.css` 映射）。
- 表格：`components/table/table.js` 支持可展开父行（`children` + `tree-toggle`）与 `pager:false` 全量显示；拓展功能改为 37 项工具表（分类筛选、搜索、全开/全关、工具栏保存）；MCP 页合并成一张「服务器 → 工具」层级表；预设扩展授权按 server 分组、组头三态全选并级联到工具。
- 验收：`test-console-static` 全过；`test-console-ui` **31/31、39 次写**；`test-control-center` **fail 0**；`verify:console-vendor` OK；全量 audit **103/103**。
- `js-yaml` 统一迁移（G5 剩余项）：桥接自有代码全部改用 `yaml` 的 `parse`/`stringify`，`js-yaml` 已从依赖删除；`stringify` 用 `lineWidth: 0 + singleQuote: true + aliasDuplicateObjects: false`，重新生成的 5 个 patch 与旧产出逐字一致。三个 `verify-*`/`test-setup-dsh-idempotent` 仍加载 DSH 自带的 `js-yaml` 做对照（见 D24）。
- 未做：表格的分组行 / 多选列 / 可配置限高（见 D23），等有真实使用点再补。

### 6.17 断点：控制台二轮收尾（2026-11-10，回来从这里继续）

用户 2026-11-10 提出下一批需求（人格页重构等，见 6.18），要求先记录断点、未批准前不动工。本节是恢复上下文用的检查点。

**已提交**
- `581d26b` feat(console)：配置页五分区水平标签、页面级保存条、表单统一、code-editor/terminal 组件、工具表、MCP 层级表、预设工具级联；文档 STATUS 6.16 / GLOBAL_CONFIG / D20–D23。
- `a166a4c` refactor(yaml)：自有代码统一迁到 `yaml`，删除 `js-yaml` 依赖；5 个 preset patch 重新生成后与旧产出逐字一致；D24。
- 工作树干净（`git status --short` 为空）。

**回来先做的收尾项**

| # | 项 | 完成判据 | 依赖 / 备注 |
| --- | --- | --- | --- |
| 1 | 重启桥接后真机复核 | 3111 上运行的是新进程；控制台五标签、保存条逐项结果、工具表筛选、MCP 展开均可用；无 pageerror | 当前进程 PID 22656 是 YAML 迁移前的代码，`src/extensions/*` 的改动要重启才生效；纯前端改动刷新即可 |
| 2 | 表格可选能力（D23） | 分组行 / 多选列 / 可配置限高（默认不限高）按需补；`dataTableHtml` 现有 `children` + `pager:false` 为基线 | 目前没有真实使用点，优先级低于 6.18 |
| 3 | 清理 `.dsh-scratch/` | 目录删除（117 MB：会话解码 jsonl + 截图 + 临时 Playwright 脚本） | 与仓库无关；截图里的验收证据已同步进本文档 |
| 4 | 保存条改版时同步替换 | 6.18 第 2 条会把 `components/save-bar/` 换成通用浮动按钮组，届时删旧组件、更新 `index.html` 引用与 `test-console-ui.mjs` 的 `saveBarWrite` | 在改版前不要在其他页面复用 `components/save-bar/` |

**恢复入口（关键文件，2026-11-10 P0–P5 后）**
- 浮动操作组：`public/console/components/action-dock/{action-dock.js,save-dock.js,action-dock.css}`；配置页分区表在 `pages/config/page.js`，离开拦截在 `js/router.js` 的 `setPageLeaveGuard`。
- 编辑器：`components/code-editor/{entry.mjs,vendor/codemirror.js,code-editor.js,code-editor.css}`；构建 `npm run build:console-vendor`、校验 `npm run verify:console-vendor`。
- 终端：`components/terminal/`（`terminalHtml`/`renderTerminalLines`/`textToLines`）。
- 表格与主从：`components/table/table.js`（`dataTableHtml`/`tableHtml`）、`components/split-view/`（`splitViewHtml`/`splitItemHtml`/`initSplitView`）。
- 配置页分区：`pages/config/page.html`（tabs 3–7 行、五个 `.config-panel`）。

### 6.18 下一批需求（2026-11-10 提出，未动工）

1. **移除三层配置说明条**：`pages/config/page.html` 的 `.config-layer-note`（「三层配置 系统层管整台桥接；预设层决定 Agent 包；会话层只覆盖单个群 / 好友。运行模式是路由，不是预设。」）整块删除。
2. **保存栏改为 AstrBot 式浮动按钮组**：右下角竖向排列一组圆形/胶囊操作按钮（保存只是其中之一），常驻、非默认隐藏，组件需重命名（不再是 save 专用），供其他页面复用。现状是 `components/save-bar/` 单个保存胶囊 + 结果面板。
3. **MCP 级联菜单重新调研**：现为「服务器行展开工具」的层级表，用户认为效果不理想；需对比常见方案（主从表 / 右侧抽屉 / 左右分栏 / 折叠树 / 服务器卡片 + 工具列表）后再定，涉及 `pages/mcp/page.js` 与表格组件。
4. **人格与角色页重构**（`pages/persona/{page.html,fields.js,page.js,page.css}`）：
   - 页面重新定位为「人格 CRUD」：只保留人格列表与提示词编辑；列表用卡片而非表格，但顶部要有表格工具栏式操作（刷新 / 筛选 / 搜索 / 新建）。
   - 全局默认人格设置移到全局配置，并归一到 `config.json`（现为 `state/current-role.json`，由 `/api/role` 写入）。
   - 外部（soulkit）人格要像本地卡一样可 CRUD、可在全局/会话被选中，卡片标「外部」；现 `/api/persona/sources` 只读、无 CRUD 接口，nexus 需提供完整 CRUD，soulkit 侧配合改造（soulkit 暂不实现删除）。
   - 被引用的外部人格在断连时用本地缓存兜底；卡片仍可见，可手动编辑并另存为内部卡。
   - 仿真提示词与预设配置重合，需先查清链路（`data-persona-fields="sim"`、`docs/PERSONA_PROVIDER.md`、preset prompt）再决定取舍或合并。
   - 「恢复默认人格」并入人格列表，不再作为独立功能；现 `/api/roles/restore-default` + `src/default-roles.js`。
   - 相关来源：`src/plugins/persona.mjs`、`src/persona-resolve.mjs`、`roles/*.md`、`state/current-role.json`、`src/default-roles.js`。

### 6.19 第二批需求完成（2026-11-10，P0–P5）

6.18 的六条已按 P0→P5 分批做完；本次改动未提交，等确认后一起提交。

1. **说明条**：`pages/config/page.html` 的 `.config-layer-note` 与 `page.css` 对应规则已删。
2. **编辑器选区**：`components/code-editor/code-editor.js` 不再给 `.cm-editor` 铺不透明背景（选区层 `z-index:-2` 会被自己的背景盖住）；背景只由宿主 `.code-editor` 提供。复测选区 `rgb(173,214,255)` 可见。
3. **浮动操作组**：`components/action-dock/`（`action-dock.js` + `save-dock.js` + `action-dock.css`），常驻右下、竖向排列、圆/方可配、支持角标与结果面板；配置页现有「保存」「撤销未保存的修改」两个动作。旧 `components/save-bar/` 已删。
4. **仿真提示词搬到预设页**：卡片在「YAML 高级编辑」上方，只读展示、解锁后可编辑；出厂初始版本在 `assets/default-prompts/{qq-chat,qq-chat-v2}.md`，新增「还原初始提示词」按钮（`POST /api/preset/sim-prompt/reset`）。人格页对应分组已删。源预设的 `persona.prefix` 从 `>-` 折叠块一次性迁成 `|-` 字面块（语义等价，`test-preset-prompt` 已放宽断言）。
5. **默认人格归一到 `config.json`**：`role.default` 是唯一事实源（`state/current-role.json` 只作升级回退）；全局配置「运行与模型」新增「默认人格」卡片，走 `GET/POST /api/config/role-default`；`/api/role` 也改为写 `config.json`。
6. **人格页重排**：列表改为卡片 + 顶部工具栏（搜索 / 筛选 已用·未用 / 刷新 / 新建）；行内操作「设为默认」「恢复初始」（原「恢复默认人格」独立分组已删）；`state/current-role.json` 的全局开关 UI 已删。
7. **外部人格**：soulkit 增加角色列表/读取/写入/改名/合成卡接口（只动接口，不碰核心模型）；`persona-provider/1` 增加可选方法（`list/getByName/save/create/rename/card`）；桥接新增 `GET /api/persona/external` 与 `POST /api/persona/external/{card,detail,save,create,rename,save-as-role}`，并把卡片缓存到 `state/persona-external.json`（断连时用缓存兜底）。控制台人格页新增「外部人格」区：编辑（只开放覆盖与角色追加）、选用（另存为内部并设默认）、另存为内部。
8. **MCP 改主从布局**：`components/split-view/`（`splitViewHtml`/`splitItemHtml`/`initSplitView`），左栏 server、右栏详情与工具清单；表格上一轮加的树形能力已从 `table.js`/`table.css` 移除（管理行为页的多级表格不受影响）。

**验收**：`test-console-static` 全部通过；`test-console-ui` **32/32、46 次写**；`test-qq-preset-contract` 8/0；`test-preset-prompt` 13/0；`test-control-center` fail 0；`verify:console-vendor` OK；真机（3111 + soulkit 3110）`/api/roles`、`/api/persona/external`、`/api/characters/card` 均正常，人格页外部卡可读、弹窗字段正确。

**有意保留**：外部人格不提供「删除」（soulkit 侧避免记忆悬空）；外部编辑不开放 soul 与角色本体；soulkit 的绑定/切换仍走它自己的 `/api/bindings`。

### 6.20 控制台第三批：侧栏重排与令牌花费并入总览（2026-11-10）

1. **侧栏按使用场景重排**：分组顺序改为「管理 → 聊天行为 → 扩展」。管理：运行总览、调试与运维、会话与审批、全局配置；聊天行为：人格与角色、记忆、黑话词库、定时任务；扩展：预设、插件、技能、MCP、管理行为。预设图标从 `⚙`（与全局配置重复）改成 `◈`。
2. **令牌与花费并入运行总览**：独立页 `pages/usage/` 删除，模块搬到 `pages/overview/usage.js`（字段规格 `usage-fields.js`、样式 `usage.css`）；两张卡（令牌与花费 / 上下文压缩）追加到 `pages/overview/page.html` 的 `#section-usage`，用 `display: contents` 落回主栅格；`router.js` 的 `PAGE_META`/`PAGE_FRAGMENTS` 移除 `usage`，旧 `#usage` 链接自动回落到运行总览。导航的「令牌与花费」按钮删除，面包屑首段改「管理」。
3. **行为档案文件改名**：`config/behaviors/{default-v1,default-v2}.yml` → `{social-v1,social-v2}.yml`；`qq-chat` / `qq-chat-v2` 的 `preset.yml` 绑定同步改为 `social-v1` / `social-v2`；测试夹具、契约、静态/UI 用例与文档中的旧 id 一并更新。

**验收**：`test-console-static` 全部通过；`test-console-ui` **32/32、46 次写**；`test-behavior-profiles` fail 0；`test-sticker-limits` fail 0；截图核对侧栏顺序、面包屑与总览底部两张用量卡（1440×1000，无 pageerror）。

**下一步（P7）**：行为档案并入预设页的「行为档案 / 预设」两个标签页；全局配置删掉行为档案分区，只在「运行与模型」增加默认行为档案选择；删除改名/新建/直接编辑文件入口，改为按 schema 的全表单编辑；默认行为档案落到 `config.json`。

### 6.21 行为档案表单化与总览收口（2026-11-10）

1. **行为档案并入预设页**：预设页改为「预设 / 行为档案」两个标签；行为档案按 v1（27 项）/ v2（wake/send/wait/proactive/sticker/context/feedback 分组）全部表单化，保存走 `PUT /api/config/behaviors/<id>` 的 `{data}`（后端保留文件头注释、按 schema 重排 YAML、写前整份备份）。字段多时按表单组件的 md 断点自动两列，窄屏回落单列；带 hint 的行标签对齐输入框首行。
2. **默认行为档案**：全局配置「运行与模型」新增默认行为档案卡（在默认人格卡上方）；`config.json` 的 `behavior.default` 是全局默认，预设 `behavior:` 绑定优先；`GET/POST /api/config/behavior-default`；档案 kind 需与运行模式一致。
3. **全局配置删掉行为档案分区**：标签页回到 4 个（运行与模型 / 安全与静默 / 准入 / 拓展功能）。
4. **花费概览并入指标卡样式**：去掉「花费概览」标题与独立卡片外观，直接复用顶部连接指标卡的 `.overview-summary` 外壳；四个指标、说明文字与「刷新 / 清空账本」都在同一张卡内，同步提示固定为「每 3 秒自动同步」。
5. **会话跳转**：按会话表的会话名改为链接，点击跳到「会话与审批」并预填该会话 key 到搜索框；逐轮明细仍由上方下拉选择后加载。
6. **表单组件修复**：`renderFields` 在遇到 `type: 'section'` 时先关闭已打开的 `.form-cols` 栅格，否则分组会被塞进栅格当列（v2 表单整段变成窄条）。

**验收**：`test-console-static` 全部通过；`test-console-ui` **32/32、46 次写**；真机 `GET /api/config/behavior-default` 与 `GET /api/config/behaviors/social-v2`（含结构化 `data`）均 200；截图核对 v1/v2 两列表单、总览花费卡与连接卡同款、会话跳转落点。

### 6.22 第四批：预设全表单化、总览四表组件化、外部人格进默认下拉（2026-11-10）

1. **预设全表单化**：`agent.cordis.yml` 不再用 YAML 编辑器直改，改为按插件行生成表单（联网工具、QQ 工具边界、上下文压缩等；chat 与 agent 档共用一套「按插件 id 定义字段」的机制）。保存走 `PUT /api/extensions/presets/<id>/agent` 的 `{rows}`，后端按插件 id 定位行、只覆盖提交的键，未知键与注释保留；写前整份备份（`state/preset-editor-backups/`）。
2. **新建预设与还原出厂**：预设页可从一个已有预设复制出新预设（`POST /api/extensions/presets/create`）；「还原出厂设置」从 `assets/default-presets/<id>/` 复制三件套回来（`POST …/factory`），两者都先备份。
3. **prefix 统一**：5 个预设的 `persona.prefix` 全部写成 `|-` 字面块（保留原始空行与换行），出厂副本与源文件一致。
4. **总览四表改用项目表格组件**：按会话、逐轮花费、最近调用流水、当前价目表都改用 `components/table` 的 `dataTableHtml`（自带工具栏、搜索、筛选、分页、每页条数）；逐轮花费的会话选择变成工具栏里的筛选，去掉了「加载逐轮明细」按钮；「其中 ¥0.91 来自更早的回合」「有模型未登记在价目表」两段说明移到表格外。
5. **外部人格进默认下拉**：全局配置的「默认人格」下拉新增「外部人格」分组（来自 soulkit 角色卡）；选中后自动把该卡另存为内部人格并设为默认，之后即使 soulkit 断连也能继续使用。`GET /api/config/role-default` 增加 `external` 列表，POST 支持外部名字；顺手把 `roles/README.md` 从选项里排除。
6. **MCP 工具区用标准表格**：右栏工具清单改用表格组件（搜索 + 分页 + 条数选择），不再手写列表。
7. **测试适配**：侧栏分组顺序变化后，定时任务用例从「在管理分组之前」改为「黑话词库之后、扩展分组之前」。

**验收**：`test-console-static` 全部通过；`test-console-ui` **32/32、50 次写**；`test-scheduler` 7/0；全量 `test-audit` **103/103（exit 0）**；`test-control-center` fail 0；`verify:console-vendor` OK（`686ab8cb2bda`）；截图核对预设插件表单、总览四表、MCP 工具表格。

**已知限制**：行为档案与预设的改动仍需重启桥接（预设需再「应用并安装」）才对正在运行的会话生效；外部人格被另存为内部后与原卡不再联动。

### 6.23 第五批：布局调整、提示词格式统一与预设页重做（2026-11-10）

1. **布局与入口调整**：全局配置「拓展功能」两张卡恢复间距；侧栏「预设」移到「管理」组、排在「全局配置」之前；预设页标签改为「行为档案 / 预设」且默认停在行为档案；人格页删除「人格来源（只读）」卡片、对应字段规格、刷新函数与 15 秒轮询。
2. **仿真提示词格式统一**：5 个预设与 5 份出厂副本的 `persona.prefix` 统一为「标题行 → 空行 → 【段落头】→ 正文/编号条目 → 空行」的格式（CRLF→LF、行尾空白清理、段落头独立成行、多空行折叠）；写入前做「去掉所有空白后逐字相等」校验，内容不丢字；随后重建 `dsh-bundles/qq-agent-presets/presets/*.patch.yml`。
3. **行为档案 v1 分组**：v1 的 27 项按 v2 思路分成 6 组（触发与上下文 / 主动检查 / 主动机会 / 空闲重试 / 连发与间隔 / 其它），每组一张卡片；v2 的 7 组同样各自成卡。
4. **预设列表重做**：表格工具栏有搜索；「新建预设」走项目统一弹窗（id / 名称 / 复制自），不再是一段内联表单；自建预设行内出现「删除」，内置预设没有删除；编辑器里「还原出厂设置」只对内置预设显示。后端 `PresetStore` 新增 `builtin` 标记与 `deletePreset`（内置拒绝删除、删除前整份备份），桥接新增 `DELETE /api/extensions/presets/:id`。
5. **测试**：预设新建用例改为弹窗流程并断言内置预设无删除按钮；行为档案保存用例改为直接断言 `PUT` 载荷；契约重录。

**验收**：`test-console-static` 全部通过；`test-console-ui` **32/32、50 次写**；`test-preset-store` 6/0；`test-qq-preset-contract` 8/0；`test-preset-prompt` 13/0；全量 `test-audit` **103/103（exit 0）**；`test-control-center` fail 0；`verify:console-vendor` OK（`686ab8cb2bda`）。

**未完成（下一批）**：以上三条（行为档案独立成页与页面级卡片、扩展授权改表格、预设页整体排版）已在 6.24 完成，此清单作废。

### 6.24 第六批：预设编辑区重组、授权表格化与 YAML 编辑器（2026-11-10）

1. **编辑区拆成页面级卡片**：删掉「编辑预设」标题卡，改为一行 `.overview-footnote` 文本（`编辑预设 · <id>` + `dsh/agent-presets/<id>`，与运行总览的白名单说明同款）；卡片顺序固定为 基本信息 / 扩展授权 · MCP / 扩展授权 · 技能 / 仿真提示词 / 插件配置 / 危险能力。
2. **仿真提示词独立成卡**：`presetPromptSlot` 之前在 `renderFields` 里被上一张卡片吞掉（`type:'section'` 一直开到下一个 section），导致卡片套卡片；现在字段规格里单独声明「仿真提示词」section，`#presetPrompt` 作为独立卡片的容器，内部仍是 CodeMirror 编辑器与编辑/保存/取消/还原。
3. **扩展授权改成两张联动表**：MCP 服务器与 MCP 工具同在一张卡（不再左右分栏），先勾服务器，工具表只列已勾服务器的工具；技能单独一张卡。三张表都从 `GET /api/extensions` 自动读取，勾选=允许、不勾=拒绝；目录里没有但 `extensions.yml` 里仍写着的条目以「目录中未找到 / 保留原值」保留，保存时不丢；「刷新目录」按钮移进表格工具栏。
4. **表格组件新增通用多选列**：`dataTableHtml({select})` / `selectCellHtml()`，表头带三段态全选框（全选 / 半选 / 清空），列宽默认 44px；`tableHtml` 给带多选列的表加 `data-select`，配合 `table-layout:fixed` 时留一列不写宽度来吸收剩余宽度（否则固定列会按比例被撑宽，多选列会变成几十上百像素）。
5. **去掉卡片外的「全部允许（*）」工具栏**：与表格表头的全选语义重复，已删除。`*` 的读取语义保留：`allow: ['*']` 仍显示为全选；手动取消某行时把 `*` 展开成当时的明确列表再删（工具在 `*` 下取消则写 `deny`，新工具仍默认允许）。写回按目录顺序排序，勾选顺序不影响 diff。
6. **插件配置改 YAML 编辑器**：不再为每个插件、每个配置键生成表单（成本过高、字段永远追不全），改为与仿真提示词同款的 CodeMirror「yaml」编辑器，只读展示 `agent.cordis.yml` 全文，点「编辑」解锁、「保存」走 `PUT /api/extensions/presets/<id>/yaml`（后端先 `validateAgentYaml` 再整份备份）。`public/console/pages/presets/agent-form.js` 删除。
7. **新建预设弹窗统一**：改用 `modalHtml` + `renderFields({layout:'inline'})` 的 `.form-stack`，与「新建定时任务」弹窗同款行距与标签列；「复制自」多一个「空白预设（不复制，含最小骨架）」，后端 `createPreset` 允许 `from` 为空（persona / tool-ask-user / tool-todo / qq-tool-restrict 四行骨架）。
8. **提示词源改读出厂 YAML**：`src/preset-defaults.js` 不再读 `assets/default-prompts/<id>.md`，改为解析 `assets/default-presets/<id>/agent.cordis.yml` 的 `persona.prefix`；`assets/default-prompts/` 整个删除（旧 `.md` 是 `>-` 折叠时代留下的副本，丢了空行，与 YAML 权威内容不一致）。
9. **详情接口补插件行**：`PresetStore.read()` 返回 `agent`（`readAgent().rows`），修「插件配置卡恒空」。

**验收**：`test-console-static` 全部通过；`test-console-ui` **32/32、48 次写**（预设用例改为「改 YAML → 保存」并重录契约）；`test-preset-prompt` 13/13；真机重启桥接后 `GET /api/preset/sim-prompt?preset=qq-chat-v2` 返回 9199 字符（来自出厂 YAML）；真机截图核对授权两表（多选列 44px、无卡片外全选栏）与 YAML 卡片。

**已知限制**：MCP 工具表仍一次渲染全部工具（当前 48 行，卡片较高），分页/搜索框可按需再加；工具说明较长时行高偏大。

### 6.25 第七批：高级配置折叠卡与「所有预设都能改提示词」（2026-11-10）

1. **插件配置改名「高级配置」并默认折叠**：`form.js` 的 `type:'section'` 新增 `collapsed:true`，复用全局 `.card.is-group > details.settings-group`（social-v2 / 插件页同款），不新增折叠样式；`groups.js` 支持 `data-default-open="closed"`，让这张唯一的折叠组在首次访问时也保持收起（否则「首访展开第一组」的规则会把它默认打开）。编辑器内容仍是 `agent.cordis.yml` 全文。
2. **提示词卡对所有预设有内容**：`page.js` 删掉 `PROMPT_PRESETS`（原只认 qq-chat / qq-chat-v2），提示词卡不再按预设隐藏；后端 `knownPresetName()` 换成 `editablePresetName()`，只要 `dsh/agent-presets/<id>/agent.cordis.yml` 存在就允许读写（名字仍限 `[a-z0-9-]` 且校验路径前缀，挡住路径穿越），`presetStatus().label` 对非仿真预设显示「预设提示词」。
3. **prefix 缺省也能打开与保存**：`readPresetPromptText()` 在 `extractPresetPrefix()` 为 null 时不再抛错（返回空串）；`locatePresetPromptBlock()` 从「只认块标量」扩成四种形态——block（`>-`/`|`）、inline（`prefix: ""`/`prefix:` 整行替换）、insert-under-config（persona 有 `config:` 但没 prefix）、insert-config（连 `config:` 都没有，补一层）。`renderPresetPromptYaml()` 按 mode 替换或插入，写回后仍做「重新解析必须逐字一致」的校验。
4. **非仿真预设不做仿真不变量校验**：`presetPromptMarkers/Blockers` 增加 `generic` 分支（只拦空内容），`bridge.js` 用 `presetKind()` 决定 v1/v2/generic；否则 qq-agent-* 与自建预设会被「缺少『你没有本地工具』」硬拒保存。

**验收**：`test-console-static` 全部通过；`test-console-ui` **32/32、49 次写**（新增用例：`demo-agent` 空提示词也能打开并保存；契约重录只多一条 `POST /api/preset/sim-prompt`）；`test-preset-prompt` **16/16**（新增「缺 prefix 自动补 config」「行内空值替换」「generic 不校验」三条）；真机重启后 `GET /api/preset/sim-prompt?preset=qq-agent-full` 返回 652 字符、label「预设提示词」，临时预设删掉 prefix 后读为 0 字符、写入自动补出 `config:` + `prefix: |-` 且回读一致，`prefix: ""` 行内值同样能替换。

**已知限制**：`prefix` 写在 flow mapping 里（`config: { prefix: '' }`）不属于上述四种形态，会落到 insert 模式并在 `config` 下补一个 `prefix` 键（YAML 视为重复键，可能解析失败）；本仓库五个预设都不用这种写法。

### 6.26 第八批：人格入口收缩、运维页顺序与「主动行为/会话重建」修复（2026-11-10）

1. **人格页移除「按会话设置人格」卡**：那张卡只剩「已迁到会话与审批页」的说明，按用户要求整块删除（单会话人格仍在会话详情的「人格」卡里改）；`persona/page.css` 的 `.assign-row/.assign-key` 一并删除。
2. **全局配置标签顺序**：改为 运行与模型 → 准入 → 安全与静默 → 拓展功能（准入前移）。
3. **运维页卡片顺序与按钮行**：测试发送 → 后台控制端引导 → 桥接控制；「重启桥接」「清空 QQ 聊天工作区」并排一行、间距 8px（与 `.tile-actions` / `#presetEditorActions` 等其它页面同排按钮一致）。`form.js` 的 `inlineActions` 支持每个 item 自带 `status`，两个按钮各自保留状态位（id 仍是 `restartMsg` / `clearWsMsg`）。
4. **外部人格另存为内部后即可编辑/设为默认**：`POST /api/persona/external/save-as-role` 落盘前先 `validateRoleName`（与 `/api/roles`、`role-default` 同一套清洗），正文走 `validateRoleContent`，并返回清洗后的 `name`；前端改用返回名。此前名字含空格/`·`/括号时文件能写进去，但 `/api/roles/content`、`/api/config/role-default` 按清洗后的名字查不到，表现就是「不能编辑、不能设为默认」。
5. **控制台写请求统一 JSON**：`js/api.js` 的 `api()` 对非 GET 一律带 `content-type: application/json` 与 JSON 体（无参补 `{}`），修「重建 DSH 会话」「插件重载」等无 body POST 被 CSRF 中间件拦成 415 `请求必须是 application/json`。
6. **主动行为按权限即时生效**：`scheduleSocialReply` 增加 `proactive` 标记，定时器触发时若主动且 `proactiveAllowed(key)` 已为假则跳过；`scheduleProactiveCheckV2Impl` 的回调开头复查 `socialV2.paused` / 准入 / 当前模式。`PATCH /api/access` 保存后调用 `rescheduleProactiveChecksAfterAccessChange()`，立刻撤销被拒会话的 v2 主动定时器、给新放开的会话补排——此前已排队的计时器会在关掉主动后照常触发一次。
7. **会话重建与自愈**：`POST /api/sessions/<key>/rebuild` 不再要求本地已有映射（无映射时直接建新会话并返回 `created:true`），路由按 403/404/502 映射错误；`isSessionNotFoundError` 增加 `session/archived`、`session/gone` 与「已归档/已删除」等判定；`ensureSession` 复用映射前先查 DSH 侧 health，`missing` 就退役重建；启动后每 5 分钟跑一次 `reconcileDshSessions`。

**验收**：`test-console-static` 全部通过；`test-console-ui` **33/33、49 次写**（新增外部人格用例）；`test-role-per-key` 5/5（第 ⑤ 条改为断言 persona 页不再有 assign 卡）；全量 `test-audit` **103/103、exit 0**。真机：运维页截图核对卡片顺序与 8px 间距；Playwright 核对人格页无 assign 卡、配置页 tab 顺序；`POST /api/persona/external/save-as-role {as:'zz probe'}` 返回 `name:'zzprobe'`，`GET /api/roles/content` 200 且可设为默认（验证后已改回并删除临时角色）；`POST /api/sessions/group%3A999999/rebuild` 带 JSON 返回 200/`created:true`（证明 415 已修），探测会话随后用 `/api/session/reset` 归档清理。

**已知限制**：主动行为修复只作用于「已排队尚未触发的那一次」与之后的排程，已经发出的消息无法撤回；「DSH 侧会话被删 → 下一条消息自动重建」仍建议在真实群观察一次（代码路径已覆盖 archived/gone，但本机没有可安全复现的真实群会话）。

### 6.27 第九批：控制中心服务通用化与接入卡片动态化（2026-11-10）

1. **服务注册表**：`state/control-center.json` 新增 `services[]`，内置四项（`bridge` / `platform` / `snowluma` / `napcat`，`builtin:true` + `kind`）在启动时补齐并纠正名称/类型；旧键（`autoRestartBridge` / `autoRestartPlatform`）仍保留并与内置服务的 `autoRestart` 双向同步，老配置文件不用迁移。
2. **自定义服务**：`kind:'process'`，存 `command / args / cwd / env / port / healthUrl / autoRestart`，用 `createManagedProcess` 与内置服务同一套托管（启停、优雅停止、崩溃自动重启、日志），`shutdown()` 一并停掉。校验：id 匹配 `[a-z0-9][a-z0-9-]{0,31}`、内置 id 不可占用、`command` 必填、`port` 1–65535、`healthUrl` 仅 http(s)、`env` 只收合法键名。
3. **新增接口**：`GET /api/services`、`POST /api/services`（创建）、`POST /api/services/:id/save|delete|start|stop|restart`、`GET /api/services/:id/logs?after=`；`stateSnapshot` 增加 `services`（含运行态、PID、端口探测、健康检查、重启次数）与 `platform.providers`。
4. **控制中心第三个大标签「服务」**：左侧服务列表（内置 + 自定义），右侧详情（状态/端口/目录/健康检查/日志）与添加、编辑、删除表单；完全复用页面现有 `.split + .list + .form + .info + .term` 与 `panel-sub` 折叠条，没有为服务页单独写一套表单/终端布局。基础控件规则从「text/search/password/select」扩展到 `textarea`、`input[type=number|url]`，让新表单的输入框与页面其它表单同一套内边距与圆角（原先这三类控件没有命中基础规则，观感不一致）。内置服务只能改显示名与自动重启（启动命令、目录仍由各自的程序面板管理）。
5. **接入后端卡片改为动态生成**：按 `GET /api/platform/providers` 的 `available` 列表画卡（含 `os` 元数据，内置两项保留短名），未知/新 provider 给通用卡——只显示平台侧连接状态和「去接入实例」按钮，不再伪装成本机可一键开启的程序；平台没运行或旧版本时回落到内置 `BUILTIN_BACKENDS` 两项。
6. **边框统一**：`.bcard` 与 `.bcard.on` 都保持 1px 边框、同一底色；只删掉运行态原来那条 3px 内阴影（它让「已启动」卡片的边比其它卡粗一圈），绿色描边保留，运行状态仍然一眼可辨，但已启动/未启动的背景色完全一致。
7. **列表卡与添加按钮统一**：`.split` 增加 `align-items: start`，服务页与接入实例页的左侧列表卡都按内容高度（不再被右侧详情拉满整列、留出大片空白）；「接入实例」的添加按钮改成 `primary` 的「添加实例」，与「添加服务」同款。服务表单占位文本去掉 soulkit，改用通用示例（`my-service`、`app.js --port 8080`、`..\services\demo`），后端非法 ID 提示同样用 `my-service`。

**验收**：`test-control-center` **23/23**（新增服务注册表用例：内置四项、落盘、创建自定义服务、启停、日志、改名、删除内置 400、删除自定义、非法 ID/缺命令 400 全过）；`test-linux-support` 9/9（内置兜底表断言改为 `BUILTIN_BACKENDS` 形态，仍要求 SnowLuma 声明 Windows / Linux、NapCat 声明 macOS / Windows / Linux）；`test-console-static` 全部通过（控制中心引用的样式令牌齐全）；全量 `test-audit` **103/103、exit 0**。真机（3099）Playwright 走完「添加服务 → 启动 → 日志出现服务输出 → 停止 → 删除 → 列表归零」全流程，无 console 错误；截图核对服务列表/详情/表单（输入框、文本域与页面其它表单同一套样式）、接入卡片（SnowLuma / NapCat 两张，动态取自平台），以及服务页/接入实例页的左侧列表卡高度与添加按钮样式一致。

**已知限制**：自定义服务只做进程级托管与端口/HTTP 健康检查，没有心跳协议；内置服务的启动命令仍以各自面板为准，服务页不提供修改；日志固定保留最近 800 行（前端渲染上限），不做下载。

**本机接入**：服务页额外登记了 soulkit（`kind:'process'`，`node bin/soulkit.mjs serve`，3110）作为自定义服务；SnowLuma 通过「选择目录」指向本机安装（5099）。这些条目只写 `state/control-center.json`（`.gitignore` 已忽略，不入库）；内置服务详情补上了 SnowLuma 的 WebUI 端口与桥接的项目目录。控制中心目前只在自身运行时托管这些进程，没有「开机自启/随控制中心启动」的开关。

### 6.28 第十批：统一人格目录、人格提示词搬家与 MCP 页整理（2026-11-10）

1. **统一人格目录**：新增 `GET /api/personas`，把本地 `roles/*.md` 与各 provider 的目录合并成一份列表（`uid` = `local:<名字>` 或 `<provider>:<id>`），返回 `items / providers / providersErrors / default`；每项带 `source / capabilities / chars / default / deletable / resettable / cached / stale`。provider 离线时只回放「用过的缓存卡」（`stale:true`），不会临时编造没缓存过的卡。
2. **人格引用与离线缓存**：`config.role.default` 与按会话指定都接受 `provider:id`（旧的纯名字仍按本地卡解析，不用迁移）；默认或会话引用外部卡时写 `state/persona-cache/<provider>/<id>.json`，注入时读缓存，所以外部服务掉线不影响正在用的人格。缓存不等于「另存为内部」：另存仍然显式写 `roles/<名字>.md`。
3. **provider 契约扩展**：`persona-provider/1` 增加可选能力位 `catalog / create / update / rename / remove`；注册表支持多 provider（按 id 分派目录，注入仍只认激活的那个），内核 `plugins.json` 的白名单支持字符串或数组。前端按能力位决定按钮是否可用，不再假设所有外部卡都能改。
4. **soulkit 只加接口**：新增 `GET /api/souls`、`GET /api/soul?id=`、`POST /api/souls/prompt`、`POST /api/souls/create`，复用 `src/domain/souls.mjs`，只读写 `prompt.md` 与新建 soul 目录，没有改核心逻辑和既有数据；`soulkit-persona` 插件的 `list/read/update/create` 改走 soul 接口，注入仍走 `/api/persona/card`。
5. **人格页重写**：保留卡片墙，操作按钮统一固定在卡片底部；编辑改成与定时任务同风格的弹窗（人格名 + 代码编辑器写提示词，标签在控件上方、整行）；内外卡操作统一为「设为默认 / 另存为内部 / 重置 / 删除」，能力位不支持的按钮置灰或隐藏；标签改用插件卡同款 `pill`（默认 / 内部 / 外部 / 缓存），不再单独定义一套徽标样式。
6. **「人格提示词」搬到全局配置**：`全局配置 › 运行与模型` 新增 `#section-personasettings`（注入上限 1000–20000 字符 + 生效方式），两项由同一个保存按钮一起提交；`/api/roles/limit` 改为 `GET` 读两项、`POST` 写两项（`config.role.injectMaxChars` / `config.role.saveApply`）；保存人格卡的 5 个写接口默认取这份全局生效方式。
7. **MCP 页整理**：弹窗底栏改为「日志 / 测试连接 / 取消 / 保存」；「连接配置」换成项目自带代码编辑器、整行显示（标签在上，「允许任意命令」在其上方）；左侧列表悬停露出删除按钮（只对外部 server）；「编辑 / 测试 / 日志」移到详情右上、徽标移到名称旁；删掉详情里重复的「工具 N」小节。
8. **插件卡按钮统一**：插件卡片按钮行改用共享 `.tile-actions`，与人格卡一样贴在卡片底部对齐。

**验收**：`node --check` 对 `src/bridge.js`、`src/plugins/{persona,kernel}.mjs`、`plugins/soulkit-persona/index.mjs`、人格/配置/MCP 页全部通过；`test-console-static` 全部通过；`test-console-ui` **33/33、45 次 mock 写**（契约只改 2 条：人格创建不再自带 `apply`、设默认从 `/api/config/role-default` 改为 `/api/personas/default`）；真机（3111）核对：人格列表 5 张（本地 3 + `soulkit:saren` / `soulkit:succubus`），默认「星苒」，外部卡的 `pill` 与插件卡一致；全局配置「人格提示词」两项同卡保存；MCP 弹窗底栏顺序、代码编辑器、无「工具 N」小节均符合预期；无 console 错误。

**已知限制**：soulkit 按约定不实现删除与重命名，对应按钮在能力位里标 `false`（前端隐藏）；外部卡只有在被默认或会话引用过之后才有缓存，从未用过的卡在服务离线时不会出现在列表里；缓存目前不自动回收（引用改回本地后旧缓存仍留在 `state/persona-cache/`，可手动清理）；`soulkit` 仓库的改动单独提交，其工作树本来就有其它未提交内容。

### 6.29 第十一批：工具栏与同类控件统一（2026-11-10）

1. **工具栏组件化**：`components/table/table.js` 新增导出 `tableToolbarHtml({refresh,filters,search,meta,metaId,actions})`，`dataTableHtml` 改为调用它；布局固定为「左侧刷新 / 筛选 / 搜索，右侧统计与主操作」。筛选的 DOM id 只认 `filter.domId`，避免 sessions / memory 两页的 `platform`、`kind` 撞车。
2. **人格页**：删掉 `pages/persona/fields.js`，工具栏改由 `tableToolbarHtml` 生成（刷新 / 全部人格 / 搜索 … 统计 / 新建人格），与预设页同序；卡片操作统一为「编辑 / 设为默认 / 另存为内部 / 重置 / 删除」，默认卡只保留 `默认` 标签、不再加高亮底色；能力位不支持的动作渲染成 `disabled` + `title`，不再隐藏。
3. **MCP 页**：顶层工具栏改用 `tableToolbarHtml`；工具列表改用 `dataTableHtml` 自带的搜索/统计工具栏，删掉页面自拼的「筛选工具名 + 共 N 个」那条；内置 server 不再显示「由桥接仓库提供」说明，描述不再回退到 `note`（去掉「SnowLuma 网关状态，只读」）。
4. **定时任务页**：新建按钮从卡片头移进表格工具栏的 `actions`，空表也渲染表格（空状态走 `empty` 文案），卡片外不再有游离按钮。
5. **全局配置**：默认行为档案、默认人格、人格提示词三张卡合并为「人格与行为」，删掉与字段 hint 重复的说明段落；「默认人格」下拉改读 `GET /api/personas`，本地卡与外部卡都可直接选（外部写 `provider:id`），当前值不在列表时补一个同名选项，避免显示成「不挂人格卡」。
6. **踩坑记录**：`docs/CONSOLE_FORM_LESSONS.md` 追加 1.70–1.73（工具栏必须复用表格组件、同类控件位置同序、未实现按钮置灰而非隐藏、合并卡片不重复说明）。

**验收**：`test-console-static` 全部通过；`test-console-ui` **33/33、45 次 mock 写**；真机（3111，Edge）逐页截图核对：人格页工具栏与预设页同序、卡片按钮排齐且默认卡无特殊底色，定时任务页工具栏为「刷新 · 1 / 20 · ＋ 新建任务」且 `#schedNew` 在 `.table-toolbar` 内，全局配置只剩「人格与行为」一张卡且默认人格正确显示「星苒-内部」，MCP 页无只读说明、工具表使用自带工具栏；无 console 错误。

**已知限制**：MCP 页首次进入需要等 `/api/extensions/mcp` 与工具清单返回，数据量大时会有几秒「加载中…」；外部人格的「编辑」目前只能改提示词正文，重命名仍受 provider 能力位限制。

### 6.30 第十二批：黑话表格列宽、人格排序与 MCP 弹窗细节（2026-11-10）

1. **黑话表格**：「手动添加」移进表格自带工具栏（`dataTableHtml({actions})`，与刷新/搜索同栏，右侧对齐）；删除按钮改成垃圾桶图标（`.slang-list .row-actions .btn-icon`，36×40 方形，悬停变红）；去掉独立的「语境证据」列，把第一条证据折进「词条」单元格（否则 9 列必然超宽、只能横向滚动）；含义/用法/参考来源用 `.cell-clamp` 截断 2 行并在 `title` 里保留全文；列宽重排为 选择 60 / 词条 140 / 次数 70 / 来源 80 / 含义 200 / 用法 150 / 参考来源 110 / 操作 260（合计 1070，正好铺满内容区），操作列能让「确认 / 编辑 / 拒绝 / 删除」四个按钮同排。
2. **人格卡片**：`visibleItems()` 增加排序——默认卡 → 内部卡 → 外部在线卡 → 缓存卡，同组按中文名 `localeCompare(zh-Hans-CN)`；卡片墙空态加 `grid-column:1/-1`，占位文字不再缩在左侧一格。
3. **MCP 弹窗**：日志按钮常驻底栏，新建时置灰并提示「保存之后才能查看日志」；`.field-block--stacked` 的标签补 `justify-content:flex-start`（基础样式是 `flex-end`，只改 `text-align` 不生效）；「凭据」改成与「连接配置」同款代码编辑器（字段名「内容」，标签在控件上方、整行、160px）。
4. **表格列宽约束**：`th[data-w]` 是 `components.css` 里的白名单，只有登记过的宽度才生效；写未登记的值会被 `table-layout:fixed` 平均分摊，看起来像「宽度没生效」。

**验收**：`node --check` 对 `pages/slang/page.js`、`pages/mcp/{page,fields}.js`、`pages/persona/page.js` 全部通过；`test-console-static` 全部通过；`test-console-ui` **33/33、45 次 mock 写**；全量 `test-audit` **103/103、exit 0**；真机（3111，Edge）截图核对：黑话表每行约 92px（原来 700+），四个操作按钮同排、删除为图标，工具栏「刷新 / 搜索 … 手动添加」；人格页空态占满整行、卡片按默认→内部→外部排序；MCP 弹窗底栏含日志、连接配置与凭据都挂编辑器且标签左对齐在上；无 console 错误。

**已知限制**：MCP 弹窗内容变长后需要滚动（连接配置 320px + 凭据 160px）；语境证据在表格里只显示第一条，完整证据仍在编辑弹窗；provider 不支持 rename/remove 时按钮仍置灰，不做隐藏。

### 6.31 第十三批：会话人格下拉与管理员权限列（2026-11-10）

1. **会话人格下拉**：会话详情的「人格卡」从自由文本改成下拉，数据与全局配置同源（`GET /api/personas`），按「本地人格 / 外部人格 · provider」分组；只在「指定人格卡」模式下可编辑，其它模式置灰但保留可见，避免整行跳变。旧档案里只存了名字的外部卡（如「魅魔」）会按唯一同名匹配到 provider 卡并显示为引用，保存一次即迁移成 `provider:id`。
2. **后端放宽引用**：`PATCH /api/sessions/:key/profile` 的 `body.persona.name` 接受 `provider:id`：先 `refreshPersonaCardCache()` 刷一次缓存，provider 离线时回退读旧缓存，连缓存都没有才返回 400「人格卡暂时不可用」；本地名字仍走 `sanitizeRoleName`。
3. **详情标签对齐**：`.detail-card .control-row > .control-label` 固定 `flex:0 0 84px` + 右对齐；此前标签宽度随字数（模式 / 人格卡 / DSH 预设）变化，控件左边缘参差，看起来像「标签和控件没对齐」。
4. **管理员权限列**：权限格改成一行摘要按钮（如「审批 · 会话」，空值显示「未设置」），点击打开「编辑管理员权限」弹窗勾选，应用后写回草稿、再点「保存管理员」落盘。行高从约 140px 回到 67px，以后新增权限项只加一行复选，不会把表格撑高。弹窗复用 `modalHtml` + `.field-check-item`，未新增自定义组件。

**验收**：`node --check` 对 `src/bridge.js`、`pages/sessions/page.js`、`pages/config/access-section.js` 全部通过；`test-role-per-key` 通过；`test-console-static` 全部通过；`test-console-ui` **33/33、45 次 mock 写**；全量 `test-audit` **103/103、exit 0**；真机（3111，Edge）：会话详情人格下拉 6 个选项、分 2 组，`模式` 与 `人格卡` 标签同宽且控件左对齐；管理员表行高 67px，权限摘要显示「审批 · 会话」，弹窗 4 个复选、应用后摘要更新；无 console 错误。

**已知限制**：会话人格改动同样要等下一条消息才生效（与其它会话字段一致）；provider 离线且没有缓存时无法把会话指到该卡；权限弹窗与「保存管理员」是两段式，勾选后需再点一次保存才会写入 `config.json`。

### 6.32 第十四批：按钮尺寸、单选圈、多选表格与零散统一（2026-11-10）

1. **按钮同标尺**：裸 `button` 之前只有 `padding:9px 15px`（高度由内容撑，约 39.5px），和固定 40px 的 `.btn` 差 1–2px；现在裸 `button` 直接采用 `.btn` 的 `height:var(--control-h)` + `padding:0 15px` + `inline-flex` 居中，`button.small` 同步改成 `height:var(--control-h-sm)` + `padding:0 11px`。同尺寸按钮不再因为有没有 `.btn` 而高低不一，`取消` 与 `保存任务` 现在都是 40px。
2. **单选圈统一**：`input[type=radio]` 改为 `appearance:none` 的 16px 圆环（未选 1px 细边，选中 5px 强调色环、中心留空），与文案卡上的 `.mode-indicator`（12px、4px 环）同一视觉；复选框保持 16px `accent-color` 方形，两者尺寸对齐。
3. **去掉额外焦点圈**：删除全局 `:focus-visible` 的 3px 外框（以及 `input/textarea/select:focus` 的 `box-shadow` 光环）；选中卡片/控件只保留自身 1px 边框，不再在边框外再套一圈粗蓝边。
4. **多选表格统一**：黑话词库的「选择」列改用表格组件自带的 `select`（表头 `[data-select-all]` 全选 + 行 `data-select-row`），删掉批量栏里的「全选本页」和 `updateSlangSelectAll()`；QQ 工具表删掉「全开 / 全关」两个表外按钮（行内开关仍逐个可点），并打开组件自带分页（37 项按每页 20 条分页）。
5. **预设授权工具条**：「刷新目录」从右侧动作区移到工具栏左侧（`tableToolbarHtml` 的 `refresh` 参数支持 `{ label, attrs }`，默认仍是「刷新」）。
6. **定时任务去时区**：删掉「默认时区」下拉，设置面板只剩启用开关与安全限制；时区统一由全局配置的 `config.timezone` 决定。单条任务里的「任务时区」保持不动。
7. **踩坑记录**：`docs/CONSOLE_FORM_LESSONS.md` 追加 1.82–1.83（裸按钮必须与 `.btn` 同标尺；多选表优先用组件 `select`，不要自己画表头全选）。

**验收**：`test-console-static` 全部通过；`test-console-ui` **33/33、45 次 mock 写**；真机（3111，Edge）核对：调度器设置面板无时区、保存按钮与开关行同高，定时任务弹窗「取消 / 保存任务」均 40px；黑话表 580 行带表头全选、无「全选本页」，QQ 工具表有分页且无全开/全关；预设授权表「刷新目录」在工具栏左侧；选中模式卡只有 1px 边框与圆环指示器；人格卡正文未被 40px 固定高度压扁；无 console 错误。

**已知限制**：组件表头全选按「整表」而不是「当前页」计算（与 Element Plus 一致），黑话批量操作会带上其它分页里的行；`button.small` 与 `.btn.small` 尺寸相同但仍保留两套类名，历史页面不需要改类名。

### 6.33 第十五批：控件标尺回归修正、弹窗多选多列与「发给谁」弹窗（2026-11-10）

1. **按钮标尺的根因修正**：上一批把 `height:40px` + `inline-flex` + 居中直接加在 `button` 元素上，连侧栏 `.nav-item`、标签页 `.page-tab` 也被当成控件接管——文字从左侧对齐变成居中、标签页的数字和下划线错位。现在裸 `button` 只保留中性外观（背景/边框/圆角/`padding:9px 15px`），控件标尺只挂在 `.btn`、`.btn.small`、`button.small`、`button.primary`、`button.danger` 这些语义类上：同尺寸按钮仍然同高（40px / 32px），导航与标签页恢复各自的内容布局。
2. **弹窗里的多选自动多列**：`.modal .field-checklist` 改成 `repeat(auto-fit, minmax(190px, 1fr))`，空间够时自动排 2–3 列，不再一项占满一行；管理员「编辑权限」弹窗的容器也从 `.form-stack` 改成 `.field-checklist`，4 个权限在 634px 宽度下排成 3 列。
3. **定时任务「发给谁」改成摘要 + 弹窗**：编辑表单里只显示「管理员私聊 / N 个对象」摘要和一个「选择对象」按钮；点开 `#schedTargetOverlay` 用表格组件的多选列列出好友与群（类型 / 对象 / 对象 ID，可搜索、每页 10 条），「发送到管理员私聊」放在表格上方的开关里。应用时按 `maxTargets` 校验，超限只在弹窗内提示、不写回；保存载荷的 `targets` 改从选择集合读取，不再扫 DOM 里的 checkbox。
4. **测试同步**：`scripts/test-scheduler.mjs` 删掉两处已过时的 `schedTimezone` 断言（默认时区只在全局配置里），保留 `schedTaskTz`（单条任务时区）的断言。

**验收**：`node --check` 对 `pages/scheduler/page.js`、`pages/config/access-section.js` 通过；`test-scheduler` **7/7**；`test-console-static` 全部通过；`test-console-ui` **33/33、45 次 mock 写**；真机（3111，Edge）：侧栏条目 41px、左对齐与图标间距恢复，标签页 36px、数字与下划线不再重叠；「发给谁」摘要行 40px 高，弹窗表格 9 行可选、管理员私聊开关生效、应用后摘要从「管理员私聊」变为「1 个对象」；权限弹窗 3 列排布；无 console 错误。

**已知限制**：「发给谁」弹窗里的对象列表来自 `/api/scheduler` 的 `targets`（白名单好友 + 群），没有昵称解析，只能显示「好友 QQ 号 / 群号」；对象数量受 `maxTargets` 限制，超过时弹窗内提示、必须减少选择才能应用。

### 6.34 第十六批：人格弹窗改表单组件、行距与徽标统一（2026-11-10）

1. **人格编辑弹窗不再手写控件**：`pages/persona/page.js` 的弹窗体改由 `renderFields` 渲染——人格名（`text` + `required` + `maxlength`）、人格提示词（`custom` 槽 + `field-block--stacked` 的代码编辑器）、另存为内部人格名（`text`）。原来的 `class="input"` 是未定义的死类名，一并删掉；动态说明改写到字段自带的 `#personaName-hint`。
2. **保留旧 id 兼容**：组件用 `data-field-wrap` 标记字段外层，渲染后把 `personaNameBlock`、`personaSaveAsBlock` 两个旧 id 补回外层节点，既有 UI 测试与外部脚本不用改。
3. **表单行距归一**：`.form-cols` 的行距从 16px 改为 `var(--form-row-gap, 14px)`，并删掉 `config`、`behavior`、`presets` 三页各自写的 `row-gap: 14px` 覆盖——同一个间距只保留一个来源。
4. **徽标统一 `.pill`**：定时任务状态、静默状态、当前人格来源从 `status-badge is-pill ok/err` 改成 `pill g / pill r / pill n / pill b`；`status-badge` 只留作纯文本状态位（例如弹窗底栏的保存提示）。
5. **按钮类名统一**：`behaviors`、`plugins` 里 `class="small"` 的 5 个按钮改成 `class="btn small"`，与其它页面一致（高度本来就都是 32px）。

**验收**：`node --check` 全部通过；`test-console-ui` **33/33、45 次 mock 写**；`test-scheduler` **7/7**；`test-console-static` 全部通过；全量 `test-audit` **103/103**；真机截图确认人格弹窗字段、提示词编辑器、`#personaSaveAsBlock` 兼容 id、定时任务绿色 `pill`、插件卡 32px 按钮都正常。

**已知限制**：这一批只动了「自己引入的手写控件 + 重复样式」，`sessions` 详情弹窗、`config` 的管理员/静默两张可编辑表、`scheduler` 的动态计划编辑器仍是手写结构（下一批处理，见巡检清单 B/C 批）。

### 6.35 第十七批：授权表分页、行内勾选组件化、令牌行对齐（2026-11-10）

1. **预设授权表恢复分页**：`pages/presets/page.js` 的 `tableOf()` 把 `pageSize` 从 `Math.max(rows.length, 1)` 改成固定 10——之前行数一多（`qq-chat-v2` 允许全部 server 时 48 个工具）就整屏铺开，看起来像「分页偶尔失效」。
2. **行内布尔单元格统一**：`components/table/table.js` 新增导出 `checkCellHtml({value, checked, label, attrs, rowSelect})`，`selectCellHtml` 复用它。定时任务列表的「启用」列从裸 `<input type="checkbox">` 改成它，QQ 工具表的「开关」列也不再手写 `<label class="table-check">`——两处与表格多选列同一套外观与对齐。
3. **QQ 工具表每页 10 条**：`pages/config/tools-section.js` 的 `dataTableHtml` 增加 `pageSize: 10`（37 项分 4 页）。
4. **访问令牌行对齐**：`pages/config/access-fields.js` 给令牌字段加 `className:'field-block--top'`（新变体：标签顶部对齐 + `padding-top`），说明文案改成字段 `hint` 由组件渲染；`components/form/form.css` 增加 `.field-block--top` 两条规则。
5. **踩坑记录 1.86–1.88**：`pageSize: rows.length` 等于永远一页；行内布尔统一 `checkCellHtml`；控件高于一行时标签会垂直居中、要用 `field-block--top` + `hint`。
6. **行为档案页字段规格化**：新增 `pages/behavior/fields.js`，把「选择档案（下拉 + 刷新）」与「名称」两行从 `page.html` 的手写 `.field-row` 搬进字段规格，`page.html` 只留 `<div class="form-stack" data-behavior-fields="main">`；`page.js` 在 `init()` 里 `renderFields(..., {columns:1, layout:'inline'})`。下拉仍是复合行（`custom` + `.control-row`），因为组件没有「select + 同行按钮」类型；旧 id 全部保留。

**验收**：`node --check` 全过；`test-console-static` 全部通过；`test-console-ui` **33/33、45 次 mock 写**；`test-scheduler` **7/7**；真机确认预设工具表 48 行只显示 10 行、QQ 工具表 37 项分 4 页、定时任务勾选与表格多选同款、令牌标签与输入框同一基线。

**已知限制**：`tableOf` 固定 10 条后，授权表里超过 10 行的表（工具表）需要翻页才能看全；筛选/搜索会重置到第 1 页。

### 6.36 第十八批：会话详情改字段规格、卡片单列（2026-11-10）

1. **详情卡片改单列、卡内两列**：`pages/sessions/page.css` 的 `.session-detail-grid` 从两列改 `minmax(0, 1fr)`；每张卡里的字段容器交给 `renderFields(host, fields, {columns:2})`，所以卡片铺满宽度、字段两列排布。
2. **六张可编辑卡全部字段化**：显示名（text）、准入（checkboxGroup）、运行（5 个 select）、人格（模式 + 人格卡 select）、初始提示词（textarea + 计数器）、唤醒（模式 + 触发 checkboxGroup + 关键词 text）。删掉 `detailRow/detailSelect/detailCheck/detailAccessItem/detailAccessCard` 五个手写辅助函数。
3. **人格卡下拉用组件分组**：`personaSelectOptions()` 生成 `{group, options}`，由 `selectField` 渲染 `<optgroup>`；模式不是「指定人格卡」时 `disabled`，切模式时同步。
4. **补丁读取改按 name 收集**：准入读 `input[name="detailAccess"]:checked`，唤醒触发读 `input[name="detailWakeTriggers"]:checked`，不再依赖 `data-detail-access` / `detailWakeAt` 等 id。
5. **组件补通用计数器绑定**：`components/form/form.js` 新增 `bindCounters(root)`——`counter: true` 生成的计数 DOM 之前没人更新；会话详情提示词用它显示 `N / 2000`。
6. **只读块与跳转**：记忆/定时任务卡保留只读内容，按钮改 `btn small`；「去记忆页/去定时任务」改成 `data-detail-nav` 按钮（hash 跳转，避免 `<a class="btn">` 没有按钮底样式）。

**验收**：`node --check` 全过；`test-console-static`、`test-console-ui`（**33/33、45 次写**）、`test-role-per-key`、`test-v2-initial-prompt` 全过；真机（3111）确认 9 张卡单列、字段两列（435px/张）、人格下拉 6 个选项分 2 组、切「指定人格卡」后可写、提示词计数器 `5 / 2000` 实时更新、保存补丁为 `{displayName, persona:{mode:'card',name:'soulkit:saren'}, prompt:{text}, access:{proactive:'allow'}}`（用路由拦截验证，未写真实档案）。

**已知限制**：卡片顺序固定，不支持拖动/折叠；唤醒的批次窗口、概率等参数仍在「二代仿真」页；提示词上限来自 `prompt.maxChars`，会话页不提供修改入口。

### 6.37 第十九批：记忆 Provider 卡与上下文压缩改字段规格（2026-11-10）

1. **记忆 Provider 卡字段化**：卡片头保留（名称、id、同步/可写、最近调用），卡内从一行手写 `.memory-field` 改成 `renderFields(..., {columns:3})` 的 3–4 个字段——启用（switch）、服务地址（text，仅插件 provider，占满整行）、单次上限（number，字）、超时（number，ms）；值从 `config.providers` 回填，空上限仍表示「跟随注入」。
2. **刷新后开关可再点**：卡片每次刷新都重建 DOM，渲染完补一次 `bindSwitches(host)`（`bindSwitches` 只处理未绑过的元素，重复调用安全）。顺带修掉旧实现「刷新后开关点不动」的隐患。
3. **核心 / 插件 provider 判定**：`/api/memory` 的 `status.providers` 只提供 `id`、`label`，没有 `plugin` 字段；改为本地核心名单 `CORE_PROVIDERS = new Set(['local-digest'])`，其余一律按插件 provider 处理（决定是否显示「服务地址」）。
4. **上下文压缩字段化**：`pages/config/compact.js` 从手写 `.field-block` 改成字段规格——`radio(compactMode)` + `number(compactWan, unit:'万 token', 5–80)`；说明段落、会话用量、保存按钮保持原样；删除 `page.css` 里 `.usage-compact` / `.field-inline` / `input[type=number]` 的旧排版覆盖。
5. **清理死代码**：移除 `memory/page.js` 的 `switchHtml()` 与 `.memory-field`、`.memory-provider-fields` 两条样式。

**验收**：`node --check` 全过；`test-console-static`、`test-console-ui`（**33/33、45 次写**）、全量 `test-audit` **103/103**；真机确认两张 provider 卡分别 3 / 4 个字段（local-digest 的「单次上限」为空、超时 900；soulkit 的服务地址回填 `http://127.0.0.1:3110`、上限 1200、超时 900），压缩区单选为「交给 DSH 自己压缩」、阈值 8 万。

**已知限制**：provider 卡仍是动态渲染，没有「新增 provider」入口（内核当前只注册 local-digest 与 soulkit）；压缩阈值只能填 5–80 万 token。





