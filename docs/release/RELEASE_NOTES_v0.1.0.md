# qq-bridge-nexus v0.1.0

首个发布基线。

本仓库起步于 [Derpyu520/qq-bridge](https://github.com/Derpyu520/qq-bridge) `v0.2.0-r3`，此后已整体重构：
配置模型、接口平台、插件内核、扩展平台、控制台、会话与记忆子系统全部重写；上游时期的版本号（v0.3.0 – v1.1.2）
不再沿用，原始记录存档在 [`legacy/`](legacy/)。

## 本版内容

### 配置与运行方案

- **四层配置模型**：用户侧平台 → 行为档案 / Agent 平台 → 能力预设 / 运行方案 → 会话权限级别。全部落在 `profiles/`，
  旧的 `config/behaviors/`、`config/platform/`、`dsh/agent-presets/` 三处存储已删除，无兼容层。详见 `docs/PROFILES_MODEL.md`。
- 内置六条运行方案（`chat` / `social-v1` / `social-v2` / `agent-readonly` / `agent-workspace` / `agent-full`），
  出厂副本放在各目录的 `.defaults/`，控制台可一键还原；`node scripts/check-profiles.mjs` 做目录与引用闭合自检。
- 注入块注册表：26 块 / 7 槽位 / 3 档案，独立的「注入块」页支持排序、启停、上限、作用域与按会话预览。

### 会话与记忆

- 会话子系统：`state/sessions/` 档案目录、准入两态单源、DSH 自愈与对账、会话详情弹窗、owner + 管理员分级。
- 记忆子系统与 soulkit 的人格 provider 联动；人格三层解析（会话覆盖 → 外部 provider → 全局本地卡）。

### 控制台

- 15 页控制台，零构建 ESM：组件目录化（`components/<name>/{js,css}`）、语义令牌与 12 列栅格、
  表单系统（16 个控件工厂 + `createForm()` 内核）、`tag` / `alert` / `card` / `collapse` / `tile` / `message-box` 组件。
- 长页面（`social-v2` 全展开）用 `content-visibility` 把重排成本从 30.7ms 降到 7.3ms。

### 插件与扩展

- 桥接插件内核：四个钩子、manifest、`plugins.json`、host-api 权限、人格 provider 契约、审计轮转。
- 扩展平台：MCP / 技能 / 插件 / 预设统一 catalog，桥接 Hub 元工具，外部 MCP 生命周期管理。
- 命令注册表：三个执行来源的能力边界、匹配与权限规则、`GET /api/commands`。

### 安全与运维

- owner 管理通道：`/mode agent L1~L3` 确认码 + L3 TOTP、`/panic` 回落、高权限闲置自动降级、哈希链审计。
- SnowLuma / NapCat 双后端，接口平台统一接入；控制中心托管子进程；Windows / macOS / Linux 三平台启动器。
- 适配基线闸门 `dsh-baseline.json`（当前 DSH `0.2.2-rc.2`），宿主工具集漂移即报错。

## 升级 / 安装

这是首次发布，没有从旧版本升级的路径。按 [`docs/DSH_DEPLOYMENT.md`](../DSH_DEPLOYMENT.md) 从零部署：

```powershell
npm ci
Copy-Item config.example.json config.json   # 填 ownerQQ、allow.*、dsh.provider
node scripts/setup-dsh.mjs                  # 然后重启 DSH
```

## 已知限制

- `bridge.js` 仍有约 1.6 万行，模块拆分未完成（新逻辑一律进 `src/` 下的独立模块）。
- 扩展平台 P4/P5（市场、外部托管）未实现。
- `npm run test:audit` 在 macOS / Linux 上有一项 Windows 专用的编码测试会跳过或失败，以 Windows 上的 116/116 为准。

## 校验

- `npm run test:audit`：116/116 脚本通过。
- `npm run test:console-ui`：浏览器回归（225 个 DOM id、25 条接口契约、几何与分页）。
- `npm run privacy-scan`：不含真实 QQ 号、本机路径与令牌。

完整变更见 [CHANGELOG.md](../../CHANGELOG.md)。
