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

| 16 | 会话子系统重构（`docs/SESSION_SUBSYSTEM.md`） | `Partial` | 把散落的按会话配置收成 `state/sessions/` 目录（`defaults.json` + 每会话文件）；被动/主动双轴三态 + 默认黑白切换；会话级运行模式/模型/预设；DSH 自愈、启动对账与确定性命名；owner + 管理员两级。**P0 已完成**（确定性命名、启动/手动对账、not-found 自愈一次 + 60 秒 3 次熔断、`/api/sessions` 健康度与重建按钮、`test-session-lifecycle`）；**P1 主体完成**（目录存储与启动迁移、双轴准入、档案读写/删除端点、控制台列表并集与详情弹窗七卡、关闭前未保存确认、双清空、persona/二代/访问三处旧入口迁走、`test-session-directory` 7/7）；**未完成**：profile 端点的专项单测（目前靠真机探针）；**P2–P3 代码未动** | P0 判据：`test-session-lifecycle` 4/4、static/UI/audit 全绿、控制台会话表显示 DSH 状态且可重建；P1 判据：`test-session-directory` 7/7、static/UI/audit 全绿、旧文件/旧键/旧读取分支不存在、详情可保存并落盘（真机探针验证）；P2–P3 判据见 `docs/SESSION_SUBSYSTEM.md` §11；每阶段收尾必须：对应单测全过 + static/UI/audit 全绿 + 旧键/旧文件/旧读取分支不存在 | 用户确认本方案（已确认 P0、P1）；P2 依赖 P1 的档案与详情页 | 高 |

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




