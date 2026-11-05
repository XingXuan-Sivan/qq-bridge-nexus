# 状态清单（未完项与可复核判据）

目的：把「没做完的、只做了一半的、卡在别人身上的」收敛到一页，避免它们散落在路线图、提交信息与口头汇报里，最后被当成「已完成」。

用法：每个阶段收尾时先对这张表；新增项写清判据与依赖，改动项更新状态与「差什么」。**状态只有三种**：

| 状态 | 含义 |
| --- | --- |
| `Done` | 有可复核的证据（测试、命令输出、截图），判据全部满足 |
| `Partial` | 已经开始或部分可用，括号里写「差什么」——差的部分必须能作为一个具体动作写出来 |
| `Blocked` | 不是我们没做，而是等外部条件（DSH 能力、平台验证、用户拍板），括号里写「等什么」 |

规则：`Partial` 不允许写成 `Done`；`Blocked` 每次阶段收尾都要重新确认一次外部条件是否已变；判据里要给出复核方式（命令或文件），不能只写「已完成」。

---

## 1. 未完项

| # | 项 | 状态 | 是什么 | 完成判据 | 依赖 | 优先级 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 真机端到端联调 | `Partial`（差：回复发送没验到——DSH profile 的 MCP server 仍指向 `qq-bridge-enhanced` 的脚本，读它的 `config.json` 走 3100，会话里 `mcp__snowluma__*` 发送必然 `fetch failed`；`operator` 只读令牌边界、插件任务类型按时触发、`onReplyDecorate` 真实生效也未验） | 用真实账号跑一遍：唤醒提示里能看到 `core-stickers` / `core-digest` 两段、人格 provider 取卡与回落、`onReplyDecorate` 与 `inbound:filter` 在真实事件上生效、插件任务类型按时触发、`operator` 只读令牌边界 | 留下一份跑通记录：每步的命令/响应或截图，落在 `docs/` 或提交信息里；未通过的项转入本表 | 真实 QQ 账号、SnowLuma（需扫码）、DSH 运行中；回复链路还需把 DSH profile 的 MCP 指向 nexus 并重启 DSH（用户已自定义过 enhanced 的 MCP/插件，需其确认） | 高 |
| 2 | MCP 清单（路线图 §9.1） | `Blocked`（等：验证 DSH 是否支持运行时增删 MCP，见路线图 §11 第 1 条） | 三个写死的 stdio server 变成 `mcp.json` 清单 + 控制台「MCP 服务」页，插件可贡献 server 定义 | 加一个 server 后不重启 DSH 能出现在工具表；否则只能降级为「写配置 + 提示重启」，需要用户先接受这个体验 | DSH 侧能力验证（读 MCP 配置加载路径 + 一次「加了不重启」实验） | 中 |
| 3 | Agent 工具注册（路线图 §8.5） | `Blocked`（等：DSH 支持运行时更新工具表） | `qq_*` 工具现在写死在 preset 补丁里，改一次要重启 DSH；想做成插件可注册 | 注册后模型当轮就能看到新工具；做不到就不做（避免「注册了但模型看不到」的假功能） | 同 2，DSH 侧能力 | 中 |
| 4 | 插件控制台面板（路线图 §8.4） | `Partial`（差：`/plugin-ui/<id>/` 静态路由、按插件隔离的鉴权、页面容器；目前 0 行代码） | 插件可以在控制台里拥有一小块自己的界面，只能拿自己的数据 | 未启用插件的面板返回 404；面板读不到其它插件与会话数据；CSP 不被放宽 | 无 | 低 |
| 5 | 其他 provider 化（路线图 §9.3） | `Partial`（差：TTS/语音、贴纸库、搜索源的 provider 契约与适配器；目前 0 行代码） | 把语音、贴纸、搜索源从「写死在桥接里」变成可替换的数据源 | 每个 provider 有失败回退（语音回退文本、贴纸回退内置库、搜索回退现有实现），且关掉插件后行为与现在一致 | 无 | 低 |
| 6 | manifest 静态 `commands` 声明 | `Partial`（差：manifest 字段、启动时冲突预检；运行时注册与告警已有） | 现在插件命令是运行时注册、冲突只告警；静态声明可以在启动时就拒绝冲突 | 两个插件声明同名命令时启动即报错并指出双方；`test-plugin-kernel` 有对应用例 | 等第二个真实插件出现再评估（只有一个插件时收益接近 0） | 低 |
| 7 | 浏览器回归没有进 `test:audit` | `Partial`（差：Playwright 依赖怎么装的决定、CI/本地入口统一） | `test:console-ui` 能跑（23/23），但不在 `npm run test:audit` 里，需要手动 `PLAYWRIGHT_MODULE=playwright-core` | `npm run test:audit` 或一个明确的 `npm run test:ui` 能在干净环境跑通，并在文档里写清依赖 | 需要决定是否把 `playwright`（或 `playwright-core`）写进 `devDependencies` | 中 |
| 8 | 没有 CI | `Partial`（差：至少一个 workflow 跑门禁） | 现在所有门禁都是本地手动跑；仓库没有 `.github/workflows` | 推送后自动跑 `test:audit`（以及可选的 `test:console-ui`），红灯阻断合并 | 需要确认托管平台与是否愿意为此加配置 | 低 |
| 9 | 控制台契约基线的维护流程 | `Partial`（差：基线变化时的提示与评审约定） | `scripts/console-ui-contracts.json` 是 25 条写请求的期望；改前端会合法地改变它，现在靠 `--accept-contracts` 手动重录 | 契约 diff 出现在 PR/提交里并附一句「为什么变」；不接受静默重录 | 无 | 低 |
| 10 | `fs.watch` 在 Windows 的稳定性 | `Blocked`（等：目标平台实测；当前 `watch` 默认关） | 插件文件监听（P2c）默认关闭，因为跨平台可靠性未验证 | 连续 100 次增删改插件文件，自动重载成功率 100% 且无重复加载；再把默认值改回 `true` | Windows 实测（长时运行） | 低 |
| 11 | 迁移评估与实施（`docs/PARITY.md`） | `Partial`（差：2026-11-06 已落定 D-1=B（`persona-bind/1` 插件能力）、D-3=B（会话页 + 可配置切换 + 平台解耦 + 删改同步）；D-2/D-4 仍调研；被判定「补齐/重设计」的项尚未动工） | 见 `PARITY.md` §3 维度表：11 个维度全部有「保持/补齐/重设计」结论；被判定补齐的项拆成可验收小项 | 各小项的判据与依赖见 `PARITY.md` §7；顺序：会话标识平台化 → 会话页（含删改同步）→ `persona-bind/1` → 会话标题 → 切换/迁移脚本 | 高 |
| 12 | 扩展便利性（`PARITY.md` §7.6） | `Partial`（差：插件 UI 面板、配置 schema 化表单、manifest 静态 `commands`、i18n、依赖约束、安装来源校验） | 新增一个插件时，不改控制台 HTML 就能有配置界面与面板；清单见 `PARITY.md` §7.6 | 需要先定「插件面板」的鉴权与静态路由（等 D-3 的会话页做完再排） | 中 |
| 13 | 会话标识平台解耦 | `Partial`（差：key 从 `group:/private:` 改为 `<platform>:<类型>:<id>`，以及全部以 key 为索引的状态文件迁移） | 新增一个平台（如 TG）时，会话/绑定/模式/任务无需改内核代码 | 依赖 `PARITY.md` D12 方案批准；需一次数据迁移脚本与回滚方案 | 中 |

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
# 全量门禁（当前基线：88/88）
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
