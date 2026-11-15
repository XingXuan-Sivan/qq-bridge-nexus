# qq-bridge-nexus v0.2.1

消息调度内核上线，同时把「带出厂副本的配置」统一成一套契约：字段与默认值只有一处、内置由出厂副本判定、行为档案存全量快照。

## 本版内容

### 消息调度内核（L1）

- 新增 `src/scheduling/`：`batching.mjs`（动态合批 + 硬上限）、`pacing.mjs`（两档令牌桶）、`cursor.mjs`（游标与三态收尾）、`policy.mjs`（策略解析）。全部纯函数，不认平台、不认行为档案。
- **动态合批**：单条消息只等 `base`、不陪跑满窗口；有新消息就续期但永不超 `maxWait`（`direct` 3s / `ambient` 8s）。
- **双桶预算**：`direct` 容量 3（每 20s 回填 1）、`ambient` 容量 6（每 300s 回填 1）。`direct` 打空改为照常投递并记 `directOverflow`；`ambient` 打空转 `pendingAmbient` 按回填时间搭车重试；时钟类原因不耗预算。
- **三态收尾**：`explicitAck` → `unreadStill` → `overflowed`，turn-end 一次性消费暂存队列并合并成一次唤醒；未读溢出不再静默跨过，下一次唤醒写明条数与 seq 范围。
- **堆积触达**：无人点名但积压到阈值（3 条）且安静够久（60s）时补一次 `ambient` 唤醒，提示词写明来由并允许不接话。
- 规格见 `docs/MESSAGE_PACING.md`。

### 配置资源统一

- **行为引擎独立成文件**：字段清单、控件、取值域、默认值搬到 `profiles/behavior-engines/{v1,v2}.yml`；平台行为类型只写 `label` / `platform` / `engine` / `fields` 覆盖，新增类型不再抄字段表。
- **行为档案存全量快照**：`config` 每个字段都有值；顺带修掉三段键（`sticker_collect_…`）写回只落两段的 bug。
- **出厂副本统一判定**：`<dir>/<id>.yml` 与 `<dir>/.defaults/<id>.yml` 成对就是内置（可重置、只能克隆），`builtin` 由副本派生、不写进文件；方案重置走 `POST /api/plans/<id>/reset`。
- **方案排序数据化**：内置方案写显式 `order`（10…70），自定义缺省 900，控制台按它排列。
- **工具面显式**：能力档 `tools.platform` 写全每个平台工具 flag，缺键即不可见，不再回落到某条内置档的模板。
- **调度默认值注入**：默认值只在引擎定义里，`bridge.js` 用 `groupDefaults('v2', 'wake')` 喂 `resolveSchedulingPolicy(wake, defaults)`。
- **行为类型按平台聚合**：`GET /api/behaviors/kinds` 每个平台各出一份类型清单，控制台按 `(platform, kind)` 索引。

### 控制台

- 行为档案表单：字段值按引擎默认值回填、保存时整份写回；数字框清空即回到默认值。
- 管理导航顺序改为「全局配置 → 平台配置 → 运行方案」。

## 升级（从 0.2.0）

```powershell
git pull
npm ci
node scripts/check-profiles.mjs      # 确认配置目录符合新契约
```

- 重启桥接（以及在用的控制中心）后生效；本版不改产物，`npm run verify:artifacts` 应与发布包一致。
- 本地改过的行为档案：`kind` 必须写类型的 id（`social-v1` / `social-v2`），旧值 `v1` / `v2` 不再被接受；`config` 缺的键会在下次保存时按引擎默认值补齐。
- 内置资产：1 个平台 / 2 个行为引擎 / 6 个能力档 / 7 个方案（7 条都有出厂副本）。

## 已知限制

- 行为档案是全量快照：引擎默认值改了，已有档案要手动改字段或点「重置」才会跟着变。
- 执行体切换不支持热切换，重启后生效。
- 控制台仍是单 token；多管理员只在 QQ 侧获得能力。

## 校验

- `npm run test:audit`：134/134 脚本通过。
- `npm run verify:repo`：103 通过 / 0 失败 / 0 跳过。
- `npm run test:console-ui`：45/45（52 条隔离写请求）。
- `node scripts/check-profiles.mjs`、`npm run test:artifact-pipeline`、`npm run verify:persona`、`npm run privacy-scan` 通过。

完整变更见 [CHANGELOG.md](../../CHANGELOG.md)。
