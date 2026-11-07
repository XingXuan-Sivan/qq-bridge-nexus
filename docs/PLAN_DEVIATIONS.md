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

## 模板

```md
| D<N> | YYYY-MM-DD | 阶段 | 计划里怎么写的 | 实际怎么做的 | 为什么（外部限制 / 成本 / 计划写错） | 对判据、接口、数据的影响 | 未处理 / 已改计划 / 已回滚 / 接受现状 | 提交号 |
```
