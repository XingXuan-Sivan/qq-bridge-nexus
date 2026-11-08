# 扩展平台实施偏差台账

> 目的：`EXTENSION_PLATFORM.md` 是目标设计；本文件只记录实施过程中**与设计不一致、临时绕过、分期调整、验收缺口**，防止“做着做着变成另一套东西”。
>
> 规则：
> - 先改设计再改代码；如果来不及，先在“实施中”登记，落地后补“回写设计”或“明确不做”。
> - 每条必须写清：计划是什么、实际做了什么、为什么、影响范围、验收证据、状态。
> - 没有登记的“顺手改动”视为偏差；不能在聊天里口头带过。
> - 状态只用：`实施中` / `已接受` / `已回写设计` / `已撤销` / `待验收`。
> - 本文件不替代 `docs/PLAN_DEVIATIONS.md`：全局偏差仍记后者，扩展平台专项记这里。

## 1. 当前阶段

- 基线设计：[EXTENSION_PLATFORM.md](EXTENSION_PLATFORM.md)（2026-11-08 版）
- 当前阶段：**P0**
- P0 目标：修复 DSH 自动压缩被 `qq-tool-restrict.mjs` 拒绝的问题，让 `compress` 在 QQ 会话 preset 中可用；不提前做 Hub/catalog/MCP CRUD。
- P0 完成判据：
  1. `compress` 进入守卫的 `SAFE_EXACT`，且不在 `RESTRICTED_TOOL_NAMES`；
  2. 预设守卫测试通过；
  3. 安装到 DSH 的链接包包含新守卫（重启 DSH 后生效）；
  4. static / UI / audit 门禁通过；
  5. 提交只包含 P0 相关文件与本台账。

## 2. 偏差记录

### E1 — P0 从“只改一行”扩为“白名单 + 回归断言”

- 阶段：P0
- 计划：只把 `compress` 加入 `SAFE_EXACT`。
- 实际：同时修改 `scripts/test-preset-local-tools.mjs`，把 `compress` 加入“允许的无害模型侧工具”断言，并加入“不得出现在 restrict 名单”的反向断言。
- 原因：原测试只覆盖 `ask_user_question` / `todo_write`；如果只改守卫，下一次重构可能再次把 `compress` 挤出去，事故会静默复发。
- 影响：仅测试代码与守卫常量；不改变其他工具权限。
- 验收证据：`node --test scripts/test-preset-local-tools.mjs` 7/7。
- 状态：已接受

### E2 — 安装包是 junction，改守卫后必须重启 DSH

- 阶段：P0
- 计划：扩展/守卫改动尽量不重启 DSH。
- 实际：`C:\Users\starl\.dsh\profiles\desktop\node_modules\qq-agent-presets` 是指向 `C:\Users\starl\.dsh\plugins\qq-agent-presets` 的 junction，后者再指向仓库 `dsh-bundles/qq-agent-presets`；源文件已改，但 DSH 进程内的 preset 已加载，需要重启 DSH 才能用新守卫。
- 原因：这是 preset 代码更新，不是运行时扩展 CRUD；文档里的“不重启 DSH”只针对 Hub 的扩展增删改。
- 影响：P0 验收需要一次 DSH 重启；不涉及桥接重启。
- 验收证据：junction 指向仓库；安装目录文件已含 `compress`；待重启后实测压缩。
- 状态：待验收

### E3 — 偏差台账本身是本阶段新增交付物

- 阶段：P0
- 计划：P0 只做 `compress` 白名单。
- 实际：新增本文件，并在文档索引/扩展平台文档中挂链接。
- 原因：用户明确要求“过程中建立偏差记录文档，防止实施中偏离目标”；这属于过程约束，不是范围膨胀。
- 影响：只增加文档与索引，不改变运行时代码。
- 验收证据：`docs/README.md` 与 `docs/EXTENSION_PLATFORM.md` 可跳转到本文件。
- 状态：已接受

## 3. 待登记（占位，不预先承诺）

- P1 若把 `reference` 页面并入 MCP 页面，需登记“旧路由是否保留、书签如何处理”。
- P1 若 catalog 与 `GET /api/extensions` 旧字段不兼容，需登记“兼容层保留多久、何时删除”。
- P2 若 Hub 第一版只做 `ext_list` / `ext_call`，需登记“哪些内置工具先不提升、为什么”。
- P2 外部 MCP `allowArbitraryCommand` / `allowPrivateNetwork` 的实际默认值，若与设计不同，必须登记。
- P3 预设 YAML 保存若丢注释，需登记“接受范围、备份位置、恢复方式”。

## 4. 回写检查

阶段收尾时逐项检查：

- [ ] 设计文档的目标、分期、验收判据是否仍与实现一致？
- [ ] 本台账每条是否都有状态与证据？
- [ ] 是否有“聊天里答应了、文档里没写”的口头偏差？
- [ ] 是否有“为了过测试而改测试、没有回写设计”的情况？
- [ ] 是否把 Partial 写成了 Done？

> 最后一项是硬约束：P0 只有在 DSH 重启后实际能调用 `compress`，才把状态改为 Done；否则保持 Partial 并写清缺口。
