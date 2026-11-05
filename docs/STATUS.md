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
| 1 | 真机端到端联调 | `Partial`（差：从未在真实 DSH + SnowLuma 上跑过一轮；现阶段全部证据来自夹具，只证明接线对，不证明协议假设成立） | 用真实账号跑一遍：唤醒提示里能看到 `core-stickers` / `core-digest` 两段、人格 provider 取卡与回落、`onReplyDecorate` 与 `inbound:filter` 在真实事件上生效、插件任务类型按时触发、`operator` 只读令牌边界 | 留下一份跑通记录：每步的命令/响应或截图，落在 `docs/` 或提交信息里；未通过的项转入本表 | 真实 QQ 账号、SnowLuma（需扫码）、DSH 运行中 | 高 |
| 2 | Skills provider 化（路线图 §9.2） | `Partial`（差：清单契约与增量注入设计、`SKILL.md` frontmatter 约定、只读白名单校验、测试） | 每个角色/会话一个 skills 目录，人格卡声明可用技能；唤醒时只注入清单，用到再读全文 | 提示里的技能清单占**固定行数**，不随技能数量线性膨胀；新增/删除技能目录无需改人格卡；`test:audit` 有对应用例 | 无（可独立做） | 高 |
| 3 | MCP 清单（路线图 §9.1） | `Blocked`（等：验证 DSH 是否支持运行时增删 MCP，见路线图 §11 第 1 条） | 三个写死的 stdio server 变成 `mcp.json` 清单 + 控制台「MCP 服务」页，插件可贡献 server 定义 | 加一个 server 后不重启 DSH 能出现在工具表；否则只能降级为「写配置 + 提示重启」，需要用户先接受这个体验 | DSH 侧能力验证（读 MCP 配置加载路径 + 一次「加了不重启」实验） | 中 |
| 4 | Agent 工具注册（路线图 §8.5） | `Blocked`（等：DSH 支持运行时更新工具表） | `qq_*` 工具现在写死在 preset 补丁里，改一次要重启 DSH；想做成插件可注册 | 注册后模型当轮就能看到新工具；做不到就不做（避免「注册了但模型看不到」的假功能） | 同 3，DSH 侧能力 | 中 |
| 5 | 插件控制台面板（路线图 §8.4） | `Partial`（差：`/plugin-ui/<id>/` 静态路由、按插件隔离的鉴权、页面容器；目前 0 行代码） | 插件可以在控制台里拥有一小块自己的界面，只能拿自己的数据 | 未启用插件的面板返回 404；面板读不到其它插件与会话数据；CSP 不被放宽 | 无 | 低 |
| 6 | 其他 provider 化（路线图 §9.3） | `Partial`（差：TTS/语音、贴纸库、搜索源的 provider 契约与适配器；目前 0 行代码） | 把语音、贴纸、搜索源从「写死在桥接里」变成可替换的数据源 | 每个 provider 有失败回退（语音回退文本、贴纸回退内置库、搜索回退现有实现），且关掉插件后行为与现在一致 | 无 | 低 |
| 7 | manifest 静态 `commands` 声明 | `Partial`（差：manifest 字段、启动时冲突预检；运行时注册与告警已有） | 现在插件命令是运行时注册、冲突只告警；静态声明可以在启动时就拒绝冲突 | 两个插件声明同名命令时启动即报错并指出双方；`test-plugin-kernel` 有对应用例 | 等第二个真实插件出现再评估（只有一个插件时收益接近 0） | 低 |
| 8 | 浏览器回归没有进 `test:audit` | `Partial`（差：Playwright 依赖怎么装的决定、CI/本地入口统一） | `test:console-ui` 能跑（23/23），但不在 `npm run test:audit` 里，需要手动 `PLAYWRIGHT_MODULE=playwright-core` | `npm run test:audit` 或一个明确的 `npm run test:ui` 能在干净环境跑通，并在文档里写清依赖 | 需要决定是否把 `playwright`（或 `playwright-core`）写进 `devDependencies` | 中 |
| 9 | 没有 CI | `Partial`（差：至少一个 workflow 跑门禁） | 现在所有门禁都是本地手动跑；仓库没有 `.github/workflows` | 推送后自动跑 `test:audit`（以及可选的 `test:console-ui`），红灯阻断合并 | 需要确认托管平台与是否愿意为此加配置 | 低 |
| 10 | 控制台契约基线的维护流程 | `Partial`（差：基线变化时的提示与评审约定） | `scripts/console-ui-contracts.json` 是 25 条写请求的期望；改前端会合法地改变它，现在靠 `--accept-contracts` 手动重录 | 契约 diff 出现在 PR/提交里并附一句「为什么变」；不接受静默重录 | 无 | 低 |
| 11 | `fs.watch` 在 Windows 的稳定性 | `Blocked`（等：目标平台实测；当前 `watch` 默认关） | 插件文件监听（P2c）默认关闭，因为跨平台可靠性未验证 | 连续 100 次增删改插件文件，自动重载成功率 100% 且无重复加载；再把默认值改回 `true` | Windows 实测（长时运行） | 低 |

---

## 2. 已完成（可复核，供对照）

只列「别人容易误以为没做」的部分，细节见 `docs/PLUGIN_ROADMAP.md` 与 `CHANGELOG.md`。

| 块 | 状态 | 复核方式 |
| --- | --- | --- |
| 插件内核 P1（钩子、权限、审计、生命周期）与人格 provider | `Done` | `node scripts/test-plugin-kernel.mjs`、`node scripts/test-soulkit-persona.mjs`、`node scripts/test-persona-resolve.mjs` |
| 启停/重载/详情、zip 与目录安装、文件监听（默认关） | `Done` | `test-plugin-kernel`、`node scripts/test-plugin-install.mjs` |
| 命令注册表与「扩展」四页、插件注册命令 | `Done` | `node scripts/test-command-registry.mjs` |
| 具名注入块（插件块 + 内置 `core-stickers` / `core-digest`） | `Done` | `node scripts/test-prompt-blocks.mjs`、`node scripts/test-core-prompt-blocks.mjs` |
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
