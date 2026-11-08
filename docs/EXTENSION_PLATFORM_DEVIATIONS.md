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
- 当前阶段：**P2（已实现并通过门禁，待提交）**
- P0 目标：修复 DSH 自动压缩被 `qq-tool-restrict.mjs` 拒绝的问题，让 `compress` 在 QQ 会话 preset 中可用；不提前做 Hub/catalog/MCP CRUD。
- P0 完成判据：
  1. `compress` 进入守卫的 `SAFE_EXACT`，且不在 `RESTRICTED_TOOL_NAMES`；
  2. 预设守卫测试通过；
  3. 安装到 DSH 的链接包包含新守卫（重启 DSH 后生效）；
  4. static / UI / audit 门禁通过；
  5. 提交只包含 P0 相关文件与本台账。
- P0 当前状态：**代码与加载链路已验收**；DSH 已于 2026-11-09 重启，守卫测试 7/7、static 全过、UI 28/28、audit 97/97。真实长会话自动压缩尚未在本次会话中人工触发，因此不把 P0 标成 Done；等下一次长会话压缩成功后补实录。

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
- 验收证据：junction 指向仓库；安装目录文件已含 `compress`；2026-11-09 重启 DSH 后重新加载；`node --test scripts/test-preset-local-tools.mjs` 7/7。
- 状态：已接受（加载链路）；真实长会话压缩调用待自然触发后补一次实录。

### E3 — 偏差台账本身是本阶段新增交付物

- 阶段：P0
- 计划：P0 只做 `compress` 白名单。
- 实际：新增本文件，并在文档索引/扩展平台文档中挂链接。
- 原因：用户明确要求“过程中建立偏差记录文档，防止实施中偏离目标”；这属于过程约束，不是范围膨胀。
- 影响：只增加文档与索引，不改变运行时代码。
- 验收证据：`docs/README.md` 与 `docs/EXTENSION_PLATFORM.md` 可跳转到本文件。
- 状态：已接受

### E4 — 工具参考页从“合并”改为“整页移除 + 旧书签重定向”

- 阶段：P1
- 计划：把工具参考的内容合并进 MCP 页，保留独立 reference 页作为可选入口。
- 实际：删除 `public/console/pages/reference/`、导航按钮、`#section-reference`、`consolePages.reference`/`PAGE_FRAGMENTS`；`#reference` 旧 hash 重定向到 `#mcp`。
- 原因：工具清单改为运行时 `tools/list` 后，独立页会重复维护同一份数据；保留一个只读静态页只会再次变成“摆设”，且容易与 MCP 页数据不一致。
- 影响：旧书签不会落到未知页面；MCP 页是唯一工具入口。
- 验收证据：`test-console-static.mjs` 去掉 reference 基线后全过；UI 用例断言无 reference 导航/容器；`#reference` 重定向由 router 归一化处理。
- 状态：已接受

### E5 — `GET /api/extensions` v2 直接替换旧字段，不保留兼容层

- 阶段：P1
- 计划：v2 返回真实 catalog；旧字段是否保留待定。
- 实际：直接返回 `{version:2, generatedAt, scannedAt, skills, mcp, summary}`；旧 `mcp[].tools` 的静态值不再保留。
- 原因：唯一消费者是控制台；保留旧字段会留下两套工具数据源，违背“单一事实来源”。agent token 不在该端点白名单内。
- 影响：控制台必须同步升级；旧外部脚本若读 v1 字段会失败（当前无此类脚本）。
- 验收证据：真机 `GET /api/extensions` 返回 v2 与 `summary.tools=51`；UI fixture 改为 v2 形状后 29/29。
- 状态：已接受

### E6 — 工具数改为运行时 `tools/list`，不再从源文件注册表手写

- 阶段：P1
- 计划：从 `src/mcp-*.js` 的注册表取工具数。
- 实际：新增 `src/extensions/mcp-inventory.mjs`，用 MCP SDK 启动 server 并调用 `tools/list`；5 分钟缓存、15s 超时、单 server 错误隔离、并发去重、`refresh` 强制重扫。
- 原因：snowluma-safe 存在 `TOOL_CONFIG_FLAGS` 条件注册，源文件 54 个 `server.tool(` 实际只暴露 48 个；静态扫描会给出假数字。
- 影响：页面首次加载会触发 3 个子进程（约几秒），之后走缓存；刷新按钮强制重扫。失败 server 只显示错误，不影响其他 server。
- 验收证据：实测 `1 + 2 + 48 = 51`；真机 API `summary{servers:3,online:3,errors:0,tools:51,skills:1}`；`test-extension-catalog.mjs` 4/4。
- 状态：已接受

### E7 — Hub 第一版只承载外部 MCP 与技能，不提升内置 MCP/插件工具

- 阶段：P2
- 计划：Hub 聚合外部 MCP、内置 MCP 与插件工具，统一走 `ext_list/ext_call`。
- 实际：内置 MCP 仍由 DSH 直连（`mcp__snowluma__*` 等），Hub 的 `ext_list` 只列 external MCP 与 skills；插件工具暂不进入 Hub。
- 原因：内置 MCP 已有稳定的直连工具与 preset 守卫，重复包一层会出现同名工具、schema 重复和权限双入口；插件工具还没有稳定的 JSON schema/元数据。先把“动态、外部、需要授权”的部分收进 Hub，避免第一版把静态能力也搅进来。
- 影响：模型对内置 MCP 仍按原工具名调用；只有外部 MCP 与技能需要 `ext_list/ext_describe/ext_call`。
- 验收证据：真机 `ext_list` 只返回 external `test-ext`；`ext_describe` 返回其 tools；内置 `mcp__snowluma__*` 保持不变。
- 状态：已接受（后续提升内置/插件工具时另开一期，不沿用本条的豁免）

### E8 — `tools/list_changed` 不接运行时刷新，先靠显式 refresh

- 阶段：P2
- 计划：外部 MCP 的 `tools/list_changed` 到达时自动刷新工具清单。
- 实际：`src/extensions/mcp-runtime.mjs` 首版不订阅通知；`POST /api/extensions/mcp/<id>/refresh` 清缓存并重新 `tools/list`，页面刷新按钮显式触发。
- 原因：首版先保证连接状态、超时、错误隔离和授权稳定；通知驱动的刷新要和调用中的工具清单做并发/幂等处理，容易在工具调用中途换掉 schema。显式 refresh 可预期、可审计。
- 影响：外部 server 自行增删工具后，需要人工刷新一次；不刷新则模型看到旧清单。
- 验收证据：`test-extension-runtime.mjs` 覆盖 refresh；真机 `POST .../refresh` 后 toolCount 从 0 变 1；`ext_describe` 懒连接后也能拿到清单。
- 状态：已接受（P3 或后续再接通知）

### E9 — `ext_list` 不自动连接外部 server，`ext_describe` 懒连接

- 阶段：P2
- 计划：`ext_list` 返回每个外部 server 的完整工具清单。
- 实际：`ext_list` 只返回运行态摘要（未启动时 `status:'stopped'`、`toolCount:0`）；`ext_describe` 才 `await runtime.listTools(server)` 建连并返回真实 tools/schema。
- 原因：列表是高频入口，自动拉起所有外部进程会拖慢每次唤醒、放大故障面；描述是显式查看某一条，适合按需连接。
- 影响：模型若只看列表会以为没有工具；必须先 `ext_describe` 再 `ext_call`。文档与工具描述要明确这一点。
- 验收证据：`test-extension-hub.mjs` 覆盖；真机修复后 `ext_describe` 返回 `toolCount:1` 与 `snowluma_status`。
- 状态：已接受

### E10 — 新增 `mcp-bridge-ext` 需要一次 DSH 重启；之后外部 CRUD 不重启

- 阶段：P2
- 计划：新增 Hub 时不打断 DSH。
- 实际：`scripts/setup-dsh.mjs` 把 `mcp-bridge-ext` 写入 desktop profile，并修改 `qq-tool-restrict.mjs` 的 `SAFE_PREFIXES`；这两处是 DSH 启动时加载的，必须重启 DSH 一次。Hub 进程起来后，外部 MCP 的增删改测试只走 bridge，不再动 DSH profile。
- 原因：Hub 本身是 DSH 的 MCP server 条目，不能靠运行时 catalog 动态插入；外部 server 才是 Hub 内部管理的对象。
- 影响：P2 首次上线需要一次 DSH 重启；后续外部扩展 CRUD 不需要。
- 验收证据：DSH 重启后出现 `mcp__bridge_ext__ext_list/ext_describe/ext_call`；真机新增/测试/删除 `test-ext` 全程未再重启 DSH。
- 状态：已接受

### E11 — 外部 MCP 的安全默认值按设计收紧

- 阶段：P2
- 计划：stdio 默认 allowlist、HTTP 默认 https；高级开关显式放开。
- 实际：`src/extensions/mcp-store.mjs` 对 stdio 只允许 `node/npx/python/python3/uv/uvx/deno/bun/bunx`，`allowArbitraryCommand` 默认 false；HTTP 只允许 https，私网需 `allowPrivateNetwork`；env/headers 只接受 `secret:<name>`，实际值落 `state/extensions/secrets.json`（0600），`server.json` 不存明文。
- 原因：外部 MCP 是本机进程/任意 HTTP，默认放开等于把 SSRF 与任意命令执行直接交给控制台表单；但用户明确要求“创建时由 owner 决定启用”，所以只收紧传输层的危险默认值，不强制默认禁用。
- 影响：创建非 allowlist 命令或私网 HTTP 时会被拒，必须显式打开高级开关；日志/API 不回显秘密。
- 验收证据：`test-extension-mcp-store.mjs` 3/3（allowlist、私网、secret 引用）；真机 test-ext 走 node + 默认值成功。
- 状态：已接受

## 3. 待登记（占位，不预先承诺）

- P1 旧路由/书签处理：已登记 E4（整页移除 + `#reference` 重定向）。
- P1 catalog 旧字段兼容：已登记 E5（v2 直接替换，不保留兼容层）。
- P1 工具数来源：已登记 E6（运行时 `tools/list` + 缓存/错误隔离）。
- P2 Hub 第一版只做 `ext_list` / `ext_describe` / `ext_call`，已登记 E7（内置 MCP/插件工具暂不提升）与 E9（列表不自动连接）。
- P2 外部 MCP 安全默认值：已登记 E11（与设计一致，未放宽）。
- P2 `tools/list_changed`：已登记 E8（首版显式 refresh）。
- P3 预设 YAML 保存若丢注释，需登记“接受范围、备份位置、恢复方式”。

## 4. 回写检查

阶段收尾时逐项检查：

- [ ] 设计文档的目标、分期、验收判据是否仍与实现一致？
- [ ] 本台账每条是否都有状态与证据？
- [ ] 是否有“聊天里答应了、文档里没写”的口头偏差？
- [ ] 是否有“为了过测试而改测试、没有回写设计”的情况？
- [ ] 是否把 Partial 写成了 Done？

> 最后一项是硬约束：P0 只有在 DSH 重启后实际能调用 `compress`，才把状态改为 Done；否则保持 Partial 并写清缺口。
