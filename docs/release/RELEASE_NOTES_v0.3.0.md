# qq-bridge-nexus v0.3.0

内核与平台彻底分家：入站事件、出站动作、工具面、能力档四处都不再认识具体平台；
控制台的平台配置、会话详情、价目卡按「声明面能回答的问题」重排。

## 本版内容

### 协议：统一事件与动作词表

- **统一事件**（`src/user-side/event.mjs`）：入站只有一种形状 —— `message.{id,seq,segments,text,media}`、`sender.{id,card,nickname,role}`、`self.id`、`conversation`、`notice.{type,actor,target,detail}`。`request` / `meta_event` 不进统一事件（健康度走 `onEvent` 旁路）。
- **通知翻译**：适配器翻六类通知（`poke` / `reaction` / `recall` / `member.join|leave|card`），`actor` 按白名单要求，成员事件的当事人放 `notice.target`。
- **动作词表**（`src/user-side/actions.mjs`）：13 项动作，每项带 `risk` / `fallback` / `scope`。9 项 `conversation`（缺 `params.conversation` 直接抛错，不猜一个会话发出去）、4 项 `global`。QQ 方言（`bot.raw` / `bot.request` / `bot.send*`）只允许活在 `src/user-side/adapters/qq/`。
- **`ext.raw` 读取归零**：`deliver()` 把管线校验后的统一事件直接交给 `handleIncoming`，下游不再按 OneBot 字段读。

### 工具面：37 项登记 → 8 组

- `src/tools/catalog.mjs` 从 36 个 flag 改成 8 组（`read_messages` / `get_member` / `send` / `act` / `conversation_state` / `memory` / `slang` / `admin`），组内 op 50 个；`tools/list` 的 schema 合计从 ≈60–100KB 降到 ≈25.8KB。
- `AGENT_MODULES`、`visiblePlatformFlags`、`capabilityAllows()` 的双参形态全部删除：白名单唯一源是平台声明 `profiles/platforms/<id>/tools.yml`，会话收紧只由权限级别承担。

### 能力档：意图 / 渲染分离

- 5 份 dsh 能力档改写成意图层（`effects` / `runtime` / `behavior` / `audience` / `mcp` / `skills`），不再写 `rows` / `preset` / `tools.agent`；`profiles/agent-platforms/dsh/render.yml` + `adapters/render.mjs` 把意图翻成插件行、行序、权限档与人格文案，构建期与运行期共用同一份。
- 新增共用直通档 `profiles/capabilities/direct.yml`（任何 Agent 平台都能选）。
- **产物不变**：`artifacts/dsh/qq-agent-presets/presets/*.patch.yml` 五份行数与正文逐字节一致，只有文件头第 2 行的来源说明改写。

### 控制台

- **导航**回到「管理 / 聊天行为 / 扩展」三组平铺 14 项（`全局配置` 在 `平台配置` 之前），去掉折叠分组与深链自动展开。
- **平台配置**：清单是一张非折叠卡（工具栏 + 两个分类的普通下拉栏 + 卡片墙）；二级页固定「概览 / 配置 / 能力」，用户平台多一页「话术与行为」。一句话结论与能力清单由注册表下发，原始声明降级成能力页里的只读下拉。
- **详情页信息密度**：详情整页就是一张大卡（`detail-panel`），卡内按分区排、分区之间只用一条分隔线；插件详情同步按「概览 / 配置 / 审计」三页。
- **会话详情**：运行卡底部一行结论（能力档 / 行为 / 权限 / 模型）；人格 + 提示、唤醒 + 准入各合成一张卡，关联（记忆 · 定时任务）与危险操作降级成折叠卡；「执行体与对端权限」整张删掉。「唤醒与准入」的两个表单并成一张栅格（模式与关键词同行、触发与允许整行、末尾「额度」只读一行），全局限额口径指路「配置 › 准入」。
- **全局配置 › Agent 平台**：默认平台与模型在一张卡里，动作条是「刷新 / 探活 / 保存」；探活复用平台详情页的同一个写口，只写结论位、不改配置。
- **插件页**：卡片动作条加「配置」（直达详情页配置标签）、卸载改成红边危险按钮；详情页头补齐「启用 / 停用」「重载」「卸载」，页头不再重复状态徽标。「启用状态」区块移除 —— 启停本身就是配置态，`POST /api/plugins/:id/enable|disable` 先写回 `plugins.json` 再改运行态。
- **运行总览 › 用户平台**：格子里改成已连接的用户侧实例条数。
- **详情页头**：`detail-head` 新可选 `actions` 槽；只有动作、没有徽标时动作行与标题同行，不跟着页头行上移。

### 价目与模型目录

- **价目表 state 化**：内置官方价 → 平台 `modelCatalog` 申报 → `state/pricing/<agent>.yml` 本机覆盖（只存与申报不同的单价，写前备份）。`GET` / `PUT` / `DELETE /api/pricing`，保存后热刷新，账本历史金额立即按新表重算。表只为全局配置里的默认模型匹配。
- **本机可改高峰**：`models.<id>.policy` 接 `peakMultiplier` / `peakWindows` / `peakWeekdays`，逐组覆盖声明面；`peakWindows: []` 仍是「这个模型全天同价」。价目表最后一列改成「操作」，弹窗里时段 / 星期 / 倍数分别用 `time` / `checkboxGroup` / `numberField`。
- **提交只写差异**：价目补丁只提交「本机已存的键 + 用户敲过的键」，继承值不再固化成覆盖。
- **覆盖率**：没价的模型只计 token、金额显示「—」；补上单价后历史金额当场重算。
- **模型目录降级**：实时目录读不到时按平台声明的 `modelCatalog.models` 铺、档位四级回落，写口照存并回 `warnings`。

## 升级（从 0.2.1）

```powershell
git pull
npm ci
node scripts/check-profiles.mjs      # 确认 profiles/ 符合新契约
npm run verify:artifacts             # 产物应与仓库里的五份 patch 一致
```

- 重启桥接与控制中心后生效。
- `config.json` 启动时自动迁移到配置 v4（写盘前备份为 `config.json.bak-<时间戳>`）：方案层退役，运行改由「用户平台条目 + 能力档 + 行为档案」四轴承担；顶层 `presets` / `apply` 不再读取，会话档案的旧 `planId` / `mode` 迁成能力档 + 行为档案。
- 自己加过能力档的话：`rows` / `preset` / `tools.agent` 不再生效，需要改写成 `effects`（意图层），行由 `profiles/agent-platforms/<id>/render.yml` 生成。
- 认价从「在哪报价」变成「默认模型配了没」：升级后先看一眼「全局配置 › 模型与行为 › 价目表」有没有跟着默认模型走。

## 已知限制

- 价目表只为全局配置里的默认模型匹配（不接受 `?agent=`，也不猜「现在哪个模型在跑」）；换模型后需要重新确认价目。
- 金额是读取时按当前价目表重算的：改本机单价或高峰口径会同时改写历史金额，可复现的前提是表不再变。
- 默认 Agent 平台与执行体切换不热切，重启后装配。
- 控制台仍是单 token；多管理员只在 QQ 侧获得能力。

## 校验

- `npm run test:audit`：132/132 脚本通过（≈88s）。
- `npm run verify:repo`：105 通过 / 0 失败 / 0 跳过。
- `npm run test:console-ui`：56/56（63 条隔离写请求）。
- `node scripts/test-console-static.mjs`、`node scripts/check-profiles.mjs`、`npm run verify:artifacts`、`npm run test:artifact-pipeline`、`npm run verify:persona`、`npm run privacy-scan` 通过。

完整变更见 [CHANGELOG.md](../../CHANGELOG.md)。
