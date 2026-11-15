# qq-bridge-nexus v0.2.0

内核不再认识具体平台：**平台解耦（B0–B8）**、**平台统一（C1–C9）**、**执行体通用化（P0–P6）**三批同版发布。

## 本版内容

### 平台解耦（B0–B8）

- 两侧适配器：地址模型 `platform[@account]:type:id`，多平台并存不串号；中立消息段与统一入站事件。
- 插件可接管连接（`transport:provide`），控制台元数据化，社交模型容器统一为「会话」。
- 详见 `docs/PLATFORM_DECOUPLING.md`。

### 平台统一（C1–C9）

- **统一平台注册表** `GET /api/platforms/registry`：两侧实例、声明面（`configSchema` / 能力位 / 工具面）、诊断与运行期状态同源，控制台不再各存一份说法。
- **配置 v2**：`platforms.active` / `platforms.users` / `platforms.agents`；`platform.*` / `snowluma.*` / `dsh.*` 三个顶层键一次性迁入后删除，不留别名双读。
- **`AgentPort` 窄契约 + DSH / ACP 双实现**：ACP 自带连接层与 `createRuntime`，与 DSH 同过 `RUNTIME_MEMBERS` 校验，可在「全局配置 › 运行」里切成默认执行体（C6.5 已核销）。
- **控制台界面 IA**：平台页（清单 + 分栏 + 能力 / 行为 / 配置）、运行方案页；用户侧多入站实例，每实例一条管线，条目级 `enabled` 开关，入站状态（`inboundState` / `outbound` / `rawEvent`）读注册表。
- 详见 `docs/PLATFORM_UNIFICATION.md`。

### 执行体通用化（P0–P6）

- **执行体可换**：`platforms.active.agent`（读视图 `runtime.defaultAgent`）；切换落盘并标 `requiresRestart`，把窗口显式报成 `active_pending_restart`，不假装热切换。
- **四轴方案模型**：应用方式（`preset` / `passthrough`）、工具面、权限权威（`bridge` / `agent`）、行为四轴互不推导；能力档新增 `runtime` 段，新增 `direct` 直通档。
- **直通运行期**：提示注入四通道（`none` / `prefix` / `system` / `tool`），`system` 未被执行体认领时降级为 `prefix` 并记 `passthrough_degraded` 审计；权限权威两分，`agent` 权威下桥接不钉不回。
- **会话详情一条给全**：`GET /api/sessions/<key>/agent`；代改对端档位 `POST /api/sessions/<key>/permission` 写后回读核对，不一致按 502 报错，`danger-full-access` 既不列也不接收。
- **界面**：会话详情「执行体与权限」卡、全局配置「执行体」卡（模型卡按 `models` 能力位门控）、方案页「应用方式 / 权限权威」两列与只读生效方式块、平台详情能力位矩阵三行。
- 详见 `docs/EXECUTION_BODY_GENERALIZATION.md`。

### 配置与文档

- `PROFILES_MODEL.md` 改为「四轴 + 存储分层 + 两层默认链」（会话 `planId` → `runtime.defaultPlan`）：设计稿里的平台级默认方案从未落地，如实写明只有两层。
- `CONSOLE.md` 契约 27 条、导航 15 个，新增「执行体 / 方案 / 权限的界面口径」一节；平台页的过期数字一并校正。
- 清掉「方案带 `tools`」的残留分支：`normalizePlan()` 只产出八键，相关死代码删除。

## 升级（从 0.1.1）

```powershell
git pull
npm ci
node scripts/setup-dsh.mjs      # 重新写入 preset / bundle，然后重启 DSH
```

- `config.json` 首次启动自动迁到 v2，迁移前备份 `config.json.bak-<YYYYMMDD-HHmm>`。
- 会话配置一次性迁到 `state/sessions/`：幂等，`defaults.json` 的 `migratedAt` 是提交点，失败时不改动旧来源。
- 内置资产：1 个平台 / 6 个能力档 / 7 个方案 / 6 个预设。

## 已知限制

- 执行体切换不支持热切换，重启后生效。
- 控制台仍是单 token；多管理员只在 QQ 侧获得能力，控制台多账号另立项。
- 扩展平台 P4/P5（市场、外部托管）未实现。
- `bridge.js` 仍是单体大文件，新逻辑一律进 `src/` 下的独立模块。

## 校验

- `npm run test:audit`：133/133 脚本通过。
- `npm run verify:repo`：103 通过 / 0 失败 / 0 跳过。
- `npm run test:console-ui`：45/45（52 条隔离写请求）。
- `node scripts/check-profiles.mjs`、`npm run verify:persona`、`npm run privacy-scan` 通过。

完整变更见 [CHANGELOG.md](../../CHANGELOG.md)。
