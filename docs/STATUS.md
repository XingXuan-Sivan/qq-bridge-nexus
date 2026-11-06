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
| 1 | 真机端到端联调 | `Partial`（差：① 群聊路径未验（目前只验了私聊）；② 审批闭环未验（`/approve`、`通过 #编号`、超时回落）；③ 唤醒提示里三个注入块的计数与截断；④ `onReplyDecorate` 与 `inbound:filter` 在真实事件上的生效；⑤ `operator` 只读令牌边界；⑥ 插件任务类型按时触发。**2026-11-06 已验**：DSH profile 的 MCP 已指向 nexus（`setup-dsh` 重写 3 条），`qq_status` 返回「星苒 online」，唤醒后日志 `工具统一发送 qq:private:2897715886: 成功 2/2 条`，人格卡取到 `provider/魅魔2`） | 用真实账号按上面 ①–⑥ 逐条跑通，并把结果落成一份可复核记录 | 真实 QQ 账号、SnowLuma 在线（需扫码）、DSH 运行中 | 高 |
| 2 | MCP 清单（路线图 §9.1） | `Blocked`（等：验证 DSH 是否支持运行时增删 MCP，见路线图 §11 第 1 条） | 三个写死的 stdio server 变成 `mcp.json` 清单 + 控制台「MCP 服务」页，插件可贡献 server 定义 | 加一个 server 后不重启 DSH 能出现在工具表；否则只能降级为「写配置 + 提示重启」，需要用户先接受这个体验 | DSH 侧能力验证（读 MCP 配置加载路径 + 一次「加了不重启」实验） | 中 |
| 3 | Agent 工具注册（路线图 §8.5） | `Blocked`（等：DSH 支持运行时更新工具表） | `qq_*` 工具现在写死在 preset 补丁里，改一次要重启 DSH；想做成插件可注册 | 注册后模型当轮就能看到新工具；做不到就不做（避免「注册了但模型看不到」的假功能） | 同 2，DSH 侧能力 | 中 |
| 4 | 插件控制台面板（路线图 §8.4） | `Partial`（差：`/plugin-ui/<id>/` 静态路由、按插件隔离的鉴权、页面容器；目前 0 行代码） | 插件可以在控制台里拥有一小块自己的界面，只能拿自己的数据 | 未启用插件的面板返回 404；面板读不到其它插件与会话数据；CSP 不被放宽 | 无 | 低 |
| 5 | 其他 provider 化（路线图 §9.3） | `Partial`（差：TTS/语音、贴纸库、搜索源的 provider 契约与适配器；目前 0 行代码） | 把语音、贴纸、搜索源从「写死在桥接里」变成可替换的数据源 | 每个 provider 有失败回退（语音回退文本、贴纸回退内置库、搜索回退现有实现），且关掉插件后行为与现在一致 | 无 | 低 |
| 6 | manifest 静态 `commands` 声明 | `Partial`（差：manifest 字段、启动时冲突预检；运行时注册与告警已有） | 现在插件命令是运行时注册、冲突只告警；静态声明可以在启动时就拒绝冲突 | 两个插件声明同名命令时启动即报错并指出双方；`test-plugin-kernel` 有对应用例 | 等第二个真实插件出现再评估（只有一个插件时收益接近 0） | 低 |
| 7 | 浏览器回归没有进 `test:audit` | `Partial`（差：是否把 `playwright-core` 写进 `devDependencies`、CI 入口统一；2026-11-06 已复跑 **25/25**，命令见 §4） | `test:console-ui` 能跑，但不在 `npm run test:audit` 里，需要手动 `PLAYWRIGHT_MODULE=playwright-core` | `npm run test:audit` 或一个明确的 `npm run test:ui` 能在干净环境跑通，并在文档里写清依赖 | 需要决定是否把 `playwright`（或 `playwright-core`）写进 `devDependencies` | 中 |
| 8 | 没有 CI | `Partial`（差：至少一个 workflow 跑门禁） | 现在所有门禁都是本地手动跑；仓库没有 `.github/workflows` | 推送后自动跑 `test:audit`（以及可选的 `test:console-ui`），红灯阻断合并 | 需要确认托管平台与是否愿意为此加配置 | 低 |
| 9 | 控制台契约基线的维护流程 | `Partial`（差：基线变化时的提示与评审约定） | `scripts/console-ui-contracts.json` 是 25 条写请求的期望；改前端会合法地改变它，现在靠 `--accept-contracts` 手动重录 | 契约 diff 出现在 PR/提交里并附一句「为什么变」；不接受静默重录 | 无 | 低 |
| 10 | `fs.watch` 在 Windows 的稳定性 | `Blocked`（等：目标平台实测；当前 `watch` 默认关） | 插件文件监听（P2c）默认关闭，因为跨平台可靠性未验证 | 连续 100 次增删改插件文件，自动重载成功率 100% 且无重复加载；再把默认值改回 `true` | Windows 实测（长时运行） | 低 |
| 11 | 迁移评估与实施（`docs/PARITY.md`） | `Partial`（差：2026-11-06 已落定 D-1=B（`persona-bind/1` 插件能力）、D-3=B（会话页 + 可配置切换 + 平台解耦 + 删改同步）；D-2/D-4 仍调研；被判定「补齐/重设计」的项尚未动工） | 见 `PARITY.md` §3 维度表：11 个维度全部有「保持/补齐/重设计」结论；被判定补齐的项拆成可验收小项 | 各小项的判据与依赖见 `PARITY.md` §7；顺序：会话标识平台化 → 会话页（含删改同步）→ `persona-bind/1` → 会话标题 → 切换/迁移脚本 | 高 |
| 12 | 扩展便利性（`PARITY.md` §7.6） | `Partial`（差：插件 UI 面板、配置 schema 化表单、manifest 静态 `commands`、i18n、依赖约束、安装来源校验） | 新增一个插件时，不改控制台 HTML 就能有配置界面与面板；清单见 `PARITY.md` §7.6 | 需要先定「插件面板」的鉴权与静态路由（等 D-3 的会话页做完再排） | 中 |
| 13 | 会话标识平台解耦 | `Done`（2026-11-06：`src/session/key.mjs` 统一组装/解析/判等，产出与解析两侧全部迁移，7 个业务模块 + 桥接 18 处构造 + 43 处解析 + 54 处接口入参归一；`platform.keyedFormat` 开关已彻底删除；死代码 `src/core/session-router.mjs` 已删除） | 新增一个平台（如 TG）时，会话/绑定/模式/任务无需改内核代码 | 复核：`node scripts/test-session-key.mjs`（11/11）、`node scripts/test-integration-v030.mjs`（31/31）、`npm run test:audit`（90/90） | — |
| 14 | 控制台前端组件化（路线图 §8.9） | `Partial`（2026-11-06 步骤 1–2 已完成为组件目录与搜索框；基础层（语义令牌/栅格/输入选择器）与表单组件（`components/form/`：16 个工厂 + `createForm` + 字段注解）同日完成：`components/<name>/` 目录与约定落地，`message`/`modal`/`table` 迁入、`search-box` 组件新增并替换 6 处、`/console/components/` 已放行；同日「控件标尺 + 五类非字段控件」落地：`--control-h/-control-h-sm/--badge-h/--field-label-w` 令牌、`.control-row` 行原语、`custom`/`checkList`/`checkTable`/`action`/`status` 五种渲染类型、`.status-badge.is-pill` 收敛到 `components.css`，`social-v2` 已做到 `page.html` **零手写控件**（38 个工具开关、语音库面板、8 组动作行、保存栏、3 个长文本全部由 `fields.js` 生成）；同日四项细节收口：40px 标尺只挂 `.btn`，裸 `button` 恢复内容撑高（概览指标卡与左侧导航不再被压扁，指标卡标签/数值/说明恢复同行）、开关回到 148px 标签列（仅页头 `.form-inline-bar` 收成紧凑 `auto auto`）、工具清单改 `checkTable` 三列表格（启用/名称/说明）、页头顺序改为 启用二代模式 / 提供推荐值给 AI / agentPreset / 运行中；表格组件扩展为「工具栏 + 表体 + 分页」（`dataTableHtml` / `initDataTables`，分页只切 `tr.hidden` 不重建 DOM，翻页不丢表单勾选值），`social-v2` 工具表已接入搜索 + 刷新 + 每页 20（可选 10/20/50）；同日修掉开关点不动/保存写坏的缺陷——开关是 `<button role="switch">`，值在 `aria-checked` 上，`scheduler` 未走 `createForm` 却按 `.checked` 读写，导致点击无反应、保存把 `enabled` 写成 `false`（徽标仍显示运行中）；`form.js` 现导出 `getSwitch`/`setSwitch`/`bindSwitches`，静态检查会拦住「用了开关却没绑定」的页面；弹窗组件补齐**三段式**（`.modal-head` 标题 + 自带关闭按钮 / `.modal-body` 唯一滚动区 / `.modal-foot` 动作条），`scheduler` 的「新建/编辑任务」从卡片内联块改为弹窗（`#schedEditorOverlay`），动作条按钮统一单档（默认 40px，紧凑处 `small: true` 才 32px）；同日「页面骨架」定稿并出第二个样板 `scheduler`（`page-stack` + 每卡 `span-all` + 页头 `.form-inline-bar`（左字段 / 右状态徽标 + 保存）+ `.card-head` + `dataTableHtml` 的任务列表/执行记录 + 折叠组 `settings-group` 与 `initGroups` 记忆（首次只开第一组、之后按 `localStorage` 恢复），`scheduler` 的 `page.html` 已 **零手写控件**，编辑器与三个整块插槽用 `custom` + `span: 2`）；剩余：其余 13 个页面仍各自手写控件（基线：`slang` 36、`overview` 32、`social-v1` 32、`persona` 27、`plugins` 16、`usage` 14、`access` 12、`operations` 10、`sessions` 10、`behaviors` 4、`mcp` 1、`skills` 1、`reference` 0），按 §8.9「上提时机」逐页收，每收一页把 `BARE_CONTROL_BASELINE` 该页改成 0） | 约定见 `docs/CONSOLE_UI.md`；`public/console/components/<name>/{<name>.js,<name>.css}` 已存在 5 个组件 | 1440 宽下会话/管理行为/黑话三页与右上角搜索框外观一致（`state/step2-sessions.png`），`social-v2` 字段已改成「标题在上、控件在下」两列（`state/socialv2-enhanced.png`）；`node scripts/test-console-static.mjs` 全过（组件目录、样式归属、`type="search"`、控件标尺、手写控件棘轮、类名定义五类断言）；`node scripts/test-audit.mjs` 90/90；浏览器回归 27/27（`PLAYWRIGHT_MODULE=playwright-core npm run test:console-ui`，其中几何断言只量单行字段，清单/表格行刻意顶对齐，另含「同一动作条按钮同高」与「弹窗头/体/脚 + 自带关闭」两条）；长页面重排优化：`.settings-group` 加 `content-visibility:auto` + `contain-intrinsic-size:auto 600px`，DevTools 设备模式逐档改视口时，16 组全展开的 `social-v2` 每帧主线程 30.7ms → 7.3ms（原因与对照数据见 `CONSOLE_UI.md` §5.1）；1666 宽截图验收通过（概览首卡、左侧菜单、工具表格、唤醒开关两列、页头顺序）；`scheduler` 1600 宽截图确认 5 张卡片、页头保存按钮在条内、安全限制标签等高对齐、编辑器整行铺满、0 个 JS 错误 | — | 中 |
| 15 | 统一注入块来源与记忆注入（路线图 §8.10） | `Todo`（2026-11-06 立项，契约见 `PLUGIN_KERNEL.md` §5.5；现状：`core-digest` 是 nexus 自己的轻量记忆，soulkit 长期记忆没有通道） | 所有块统一注册表（`owner` = `core` / `plugin:<id>` / `declared`）、声明式 `source`（`builtin`/`text`/`file`/`http`/`memory`）、`memory:provide` 权限与 `ctx.memory.registerProvider`、`plugins/soulkit-memory/` 适配 `POST /api/recall`、新增 `core-memory`（priority 120） | 新增 `file` 类型块只改 `config.json` 即生效（源码零改动）；块取数失败只跳过该块且唤醒照常完成；soulkit 停机时 `core-memory` 为空不阻塞；`test-prompt-blocks` 覆盖「正常 / 文件缺失 / 超预算 / 热关」四个用例 | soulkit `POST /api/recall` 可用（2026-11-06 已验证路由存在、`view:'self'` 免令牌）；不改 soulkit，不改它的绑定 | 高 |

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




