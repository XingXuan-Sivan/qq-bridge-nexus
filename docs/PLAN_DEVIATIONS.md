# 执行偏差登记（计划 vs 实际）

用途：实施过程中只要「做的和计划写的不一样」就登记一行，不让偏差只活在提交信息、聊天记录或口头汇报里。**偏差不是错误，隐瞒才是。**

配套文档：`PLUGIN_ROADMAP.md`（计划来源）、`MEMORY_SUBSYSTEM.md`（记忆子系统计划）、`STATUS.md`（未完项）。

## 规则

1. 当天登记：发现偏差的同一个工作日内写进来，最迟不超过该阶段提交。
2. 影响判据的偏差，**先改计划再继续**：先更新对应计划文档的条目，再在本文登记「计划已改」。
3. 每条必须写清「为什么」：是外部限制（能力/接口不可用）、成本权衡（工期/复杂度），还是原计划本身写错了。
4. 阶段收尾时逐条过：`未处理` 的偏差不许留到下一个阶段。
5. 编号连续（D1、D2…），不复用；被推翻的条目保留并改状态为 `已回滚`。

状态取值：`未处理` / `已改计划` / `已回滚` / `接受现状`。

## 登记表

| # | 日期 | 阶段 | 计划项 | 实际做法 | 原因 | 影响 | 处理 | 关联提交 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | 2026-11-07 | 记忆 S2 设计 | `PLUGIN_ROADMAP.md` §8.10 把记忆写成声明式块（`source.type='memory'`，走 `config.promptBlocks`） | 记忆注册成 core 的 `core-memory` 块，配置独立放 `memory.*`，由记忆页管理 | 声明式块的配置与「记忆预算独立」冲突：放 `promptBlocks` 会被块总预算与块表口径混在一起，出现两套预算 | 块表仍能看到 `core-memory` 一行（owner=core），但它的上限来自 `memory.inject.maxChars`；`promptBlocks` 不再管记忆 | 已改计划 | — |
| D2 | 2026-11-07 | 记忆 S2 设计 | 计划里 `core-memory` 的 priority 写 120 | 用 **200**（与旧 `core-digest` 同槽位） | 保持未改动前的提示词顺序（stickers 100 → skills 150 → digest 200）；改成 120 会把记忆段插到 skills 之前，属于无收益的结构变更 | 提示词布局与现状一致，迁移可对比 | 已改计划 | — |
| D3 | 2026-11-07 | 记忆 S2 设计 | 计划保留 `core-digest` 作为独立块，另加 `core-memory` | 删除 `core-digest` 块，改为 `local-digest` provider 的渲染函数；旧 `promptBlocks['core-digest']` 只做兼容读 | 两个块渲染同一份数据会出现「双份记忆」与双份预算，无法解释截断 | 需要一次性迁移旧配置；迁移前跑 `test-prompt-blocks` 做基线对比 | 已改计划 | — |
| D4 | 2026-11-07 | 记忆 S4 工具 | `MEMORY_SUBSYSTEM.md` §2.3 写「写回只写主 provider」 | 主 provider 不可写时退到第一个 `write:true` 的 provider，并在结果里返回实际写入源 | `soulkit` 只读（`write:false`），而注入源已切到 soulkit；严格只写主源会让 `qq_memory_note` 在默认配置下永远失败 | 写回可能落到 `local-digest`（记成进行中的话题），用户在结果里能看到 `provider`；S5 的 `/api/ingest` 是独立队列，不改变这条回退 | 已改计划 | — |
| D5 | 2026-11-07 | 记忆 S5 写回 | 计划只写「`/api/ingest` 队列（默认关）」 | 只采两类事件：入站的非命令用户文本 + 出站由模型生成的回复（`opts.decorate`）；系统通知、`/` 命令、peek 与工具输出都不入队 | 写回的目的是给长期记忆沉淀「人说了什么、AI 回了什么」；把系统通知或命令塞进去会污染记忆，也会把令牌类文本带出去 | 写回的覆盖范围小于「全量聊天记录」；关闭时 `enqueue` 直接返回 false 且不落盘 | 已改计划 | — |
| D6 | 2026-11-07 | 记忆 S6 轻量记忆重做 | `MEMORY_SUBSYSTEM.md` 计划保留 `/api/socialV2/memory-*` 与 `group-rule`，作为控制台与工具的既有入口 | 直接删除这批端点，新增通用 `/api/memory/entries` / `/entries/clear` / `/entries/compact` / `/rules` / `/recall` / `/note`，**不做别名、不做双写**；同时删除 `formatMemoryV2` / `appendMemoryV2` 与 `social-v2.json` 的 `activeTopics/pendingThoughts/memberImpressions/ownerRules`，旧数据不迁移、直接丢弃 | 用户明确要求「旧实现、接口、数据都统一移除或归一化，不要再留着、当别名或者保留，不留技术债务」；轻量记忆本身没有需要保留的重要数据，核心数据在 soulkit | 旧接口的调用方（MCP 工具、控制台、测试）全部改到新端点；升级后旧的 `social-v2.json` 记忆字段成为死数据（不读、不删），`state/local-memory.json` 从空开始 | 已改计划 | — |

| D7 | 2026-11-08 | 会话子系统设计 | 按会话配置分散在 `current-role.json` / `initial-prompts.json` / `social-v2.json` / `access` 页 / `sessions.json` 映射五处，各自读写 | 合并为 `state/sessions/` 目录：`defaults.json`（准入默认）+ `<platform>/<kind>/<id>.json`（准入、运行模式、人格、提示词、唤醒、模型、预设、DSH 绑定） | 跨文件保存无法原子、迁移/回滚/备份都要各写一遍；用户要求系统性重构而非修补；单文件写坏会拖垮全部会话，目录让损坏隔离到单会话 | P1 需要一次性迁移旧文件并删除旧键；迁移提交点前失败不覆盖旧来源，提交后崩溃可继续清理旧键 | 已改计划 | — |
| D8 | 2026-11-08 | 会话子系统设计 | 计划保留 `config.json` 的 `allow` / `deny` / `allowAllWhenEmpty` 作为兼容读 | 一次性迁到 `defaults` + `profiles[].access`，迁移后删除旧键，**不做兼容读、不做双写** | 两个准入真相会导致「改了没生效」且无法测试；用户要求正式版本不留旧配置 | 升级必须先成功迁移；失败拒绝启动会话子系统并报错，不静默降级 | 已改计划 | — |
| D9 | 2026-11-08 | 会话子系统迁移 | `STATUS.md` §6 要求动手前把 `state/` 备份成 `state.bak-<时间戳>`，观察后再删 | 本轮迁移代码**不生成 `.bak`**；需要人工快照时放仓库外并在验证后删除；失败保留旧文件原样 | 用户明确要求「正式版本不得保留旧备份文件和旧配置」；运行期备份会变成永久残留 | 回滚依赖代码回滚 + 仓库外人工快照；迁移必须 `.tmp` + rename 且幂等 | 已改计划 | — |
| D10 | 2026-11-08 | 会话子系统范围 | `PARITY.md` D-3 的会话页只做「列表 + 改标题 + 清理」 | 扩展为会话子系统重构：双轴准入、会话档案与详情子页、会话级运行模式、模型/预设、DSH 自愈/命名、多管理员 | 用户新需求要求把会话相关的通用配置与单会话配置整体重做，而不是继续修补 | `PARITY.md` D-3 的会话页范围由本文档覆盖；STATUS #11 的会话页子项以 `SESSION_SUBSYSTEM.md` 为准 | 已改计划 | — |
| D11 | 2026-11-08 | 会话子系统设计 | 运行模式是全局唯一 `currentMode`，所有会话跟随 | 允许按会话固定 `chat` / `reserved` / `reserved2`；`closed-agent` 仍是全局排他模式，管理员私聊以外一律不活跃 | 用户明确要不同会话可分别跑一代/二代仿真，而不是全局切换 | 所有 `currentMode === …` 与 `modeAllowed` 分支要改成按会话的 `effectiveMode`；P2 风险最高，需先列调用点清单 | 已改计划 | — |
| D12 | 2026-11-08 | 会话子系统设计 | 只有 `ownerQQ` 一个管理员，审批、通知、closed-agent 都只认它 | 引入 owner + `admins[]`（capability、maxLevel、notify、exemptPassive）；管理员不能改全局模式/权限/名单 | 用户要求支持多管理员，同时保留 owner 最高权限 | 审批/通知/审计/closed-agent 级别都要带 actor；控制台多账号不在本轮硬做 | 已改计划 | — |
| D13 | 2026-11-08 | P0 稳定性 | 详情页只读 DSH 状态与重建按钮 | 先落在会话表：新增 DSH 列（在线/缺失/未知 + 检查时间）与行内「重建」；详情子页 P1 才建 | 详情子页属于 P1 档案与页面重构，P0 临时造一个半成品页面会立刻被 P1 推翻 | P0 判据改为「会话表显示 DSH 状态且可重建」；P1 建详情页时把入口迁入 | 接受现状 | — |
| D14 | 2026-11-08 | P1 会话档案 | `SESSION_SUBSYSTEM.md` §8 要求详情用独立子页 `#sessions/<url-encoded key>` | 实际做成列表页上的宽弹窗（`#sessionDetailOverlay` + 七张卡），路由仍只有 `#sessions` | 与全站「增改操作用弹窗」的既有约定一致；独立子页要再补路由、返回态与深链刷新，本轮收益低于成本 | 详情不可直接分享/刷新恢复；P2 若要深链再升级为子页，弹窗内容可原样搬 | 已改计划 | — |
| D15 | 2026-11-08 | P1 会话档案 | 计划拆 `src/session/store.mjs`（目录存储）与 `src/session/profiles.mjs`（schema/合并/三态） | 合并为 `src/session/directory.mjs`：加载、校验、写入、`createProfile`/`normalizeProfile`/`applyPatch` 同文件；旧的 `src/session/store.mjs` 仍留给迁移读旧单文件 | 档案 schema 与目录读写强耦合（路径即 key、binding 回填、损坏隔离都依赖同一份 normalize），拆开只会多一层转发 | 后续若 P2 加模型/预设字段，仍在 `directory.mjs` 内扩展；测试从 `test-session-directory` 覆盖 | 已改计划 | — |
| D16 | 2026-11-08 | P2b 会话模型 | 只改本会话的 DSH 模型，不动全局默认 | 保存会话模型时同步写 DSH 全局默认（`selectModel` 本身的语义），控制台提示会影响 Web GUI 新会话 | 用户明确选择「接受全局副作用（推荐）」；DSH 的 `session.selectModel` 没有“仅本次会话”参数 | 全局默认会被会话保存意外改写；必须在详情弹窗明示，且会话按自己的模型能力决定看图 | 接受现状 | — |

## 模板

```md
| D<N> | YYYY-MM-DD | 阶段 | 计划里怎么写的 | 实际怎么做的 | 为什么（外部限制 / 成本 / 计划写错） | 对判据、接口、数据的影响 | 未处理 / 已改计划 / 已回滚 / 接受现状 | 提交号 |
```
