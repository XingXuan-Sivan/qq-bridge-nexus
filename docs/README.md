# 文档索引（docs/README.md）

本文是 `docs/` 的**唯一索引**。新增、改名、归档文档时同步改这里；索引里不出现的文档视为未登记。

- 根目录只留 `README.md` / `README.en.md` / `RULES.md` 与发布类 `CHANGELOG.md` / `NOTICE.md`。
- `docs/_internal/` 是本地开发台账、计划、阶段报告与提示词快照，**被 `.gitignore` 排除，不随仓库发布**。
- `docs/archive/` 是历史设计稿，只用于追溯「当时为什么这么想」，**不要照着做**。

---

## 一、现行文档

### 配置与模型

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [PROFILES_MODEL.md](PROFILES_MODEL.md) | **四层配置模型**：用户侧平台 → 行为档案 / Agent 平台 → 能力预设 / 运行方案 → 会话权限级别；`profiles/` 目录与 schema、已删除的旧结构、代码接口与自检 | ✅ 现行权威（改配置存储前先读） |
| [INJECTION_PROFILE_CONFIG.md](INJECTION_PROFILE_CONFIG.md) | **注入块与提示词拼接**：块模型（slot / timing / profiles / scope）、注入块页、预算与上限迁移 | ✅ §2、§7 现行；§3–§5 已由 PROFILES_MODEL 取代 |
| [HTTP_BOUNDARY.md](HTTP_BOUNDARY.md) | **HTTP 边界**：静态资源穿越守卫、未启用=404、先鉴权后存在性、CSP 与安全响应头、刷新/深链恢复、插件 UI 沙箱 | ✅ 改路由/静态资源前必读 |
| [FOLDER_MAP.md](FOLDER_MAP.md) | 目录地图：每个顶层目录的作用、`scripts/` 命名约定、疑似过期的一次性脚本清单 | ✅ 现状描述 |

### 会话与记忆

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [SESSION_SUBSYSTEM.md](SESSION_SUBSYSTEM.md) | **会话子系统**：`state/sessions/` 档案目录、准入、运行方案、人格、提示词、唤醒、模型；被动/主动每轴一条全局名单；DSH 自愈/对账/命名 | ✅ 现行 |
| [MEMORY_SUBSYSTEM.md](MEMORY_SUBSYSTEM.md) | **记忆子系统**：采集、写入、召回与注入的边界，与 soulkit 的联动 | ✅ 现行 |

### 控制台

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [CONSOLE.md](CONSOLE.md) | **控制台单一入口**：零构建结构、目录六条规则、设计令牌与栅格、组件 API（card / collapse / tag / alert / message / message-box / tile / table / search-box）、必须不变的契约、门禁、长页重排实测 | ✅ 现行（改 `public/console/` 前先读） |
| [CONSOLE_FORMS.md](CONSOLE_FORMS.md) | **表单系统规格**：16 个控件工厂、`createForm()` 内核（类型化取值、校验、条件显示、脏值守卫）、字段注解、两步迁移法 | ✅ 规格已定 |
| [CONSOLE_FORM_LESSONS.md](CONSOLE_FORM_LESSONS.md) | 表单迁移踩坑与检查清单 | ✅ 迁页面前先读 |

### 扩展与插件

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [EXTENSION_PLATFORM.md](EXTENSION_PLATFORM.md) | **扩展平台方案**：MCP / 技能 / 插件 / 预设统一 catalog、桥接 Hub、外部 MCP 生命周期、GitHub 扫描式市场与分期 | ✅ 方案（P0–P3 已实现，P4/P5 未动） |
| [PLUGIN_KERNEL.md](PLUGIN_KERNEL.md) | 桥接插件内核：四个钩子、manifest、`plugins.json`、host-api 权限、人格 provider 契约、审计、控制台接口 | ✅ 与实现同步 |
| [PERSONA_PROVIDER.md](PERSONA_PROVIDER.md) | 人格三层解析（会话覆盖 → 外部 provider → 全局本地卡）、`persona-provider/1` 契约、缓存与降级 | ✅ 与实现同步 |
| [COMMAND_REGISTRY.md](COMMAND_REGISTRY.md) | 命令注册表：三个执行来源的能力边界、entry 形状、匹配/权限规则、`GET /api/commands` | ✅ 与实现同步 |

### 运维与部署

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [DSH_DEPLOYMENT.md](DSH_DEPLOYMENT.md) | **从零部署（Windows / macOS / Linux）**：版本要求、QQ 后端准备、配置字段、setup-dsh、TOTP、控制中心、状态检查、真实 QQ 验证、更新/备份/回滚、常见错误 | ✅ 部署首选 |

---

## 二、指南（`guides/`）

| 文档 | 内容 |
| --- | --- |
| [guides/DSH_SETUP.md](guides/DSH_SETUP.md) | 把 preset 与 MCP server 挂到目标设备的 DSH |
| [guides/DSH_020_ADAPTATION.md](guides/DSH_020_ADAPTATION.md) | DSH 0.2.0 适配改动逐条记录（升级 DSH 前先读操作清单） |
| [guides/CONFIGURATION.md](guides/CONFIGURATION.md) | 配置字段与状态文件 |
| [guides/ADMIN_CHANNEL.md](guides/ADMIN_CHANNEL.md) | owner 管理通道：权限分级、命令、确认流程、TOTP 边界、审批与审计（改权限代码前必读） |
| [guides/SECURITY_BASELINE.md](guides/SECURITY_BASELINE.md) | 安全基线与威胁模型、发布前回归清单（改安全相关代码前必读） |
| [guides/CONTINUITY.md](guides/CONTINUITY.md) | 人际连续性：QQ 号认人、人物库、共享策略、入群事件、跨群协作 |
| [guides/CONTROL_CENTER.md](guides/CONTROL_CENTER.md) | 控制中心：托管桥接与 QQ 后端子进程的本地网页 |
| [guides/SCHEDULER.md](guides/SCHEDULER.md) | 定时任务：控制台页面、`/remind`、AI 登记、重复方式、时区与安全限制 |
| [guides/SILENCE.md](guides/SILENCE.md) | 定时静默：按时间段停掉 AI 省 token，与手动静默的区别 |
| [guides/TESTING.md](guides/TESTING.md) | 离线回归清单与需要部署后验证的事项 |
| [guides/CONSOLE-UI-TESTING.md](guides/CONSOLE-UI-TESTING.md) | 控制台离线预览与离线浏览器回归怎么用 |
| [guides/TOKEN_USAGE_CONSOLE.md](guides/TOKEN_USAGE_CONSOLE.md) | 「令牌与花费」看板：数据来源、计价口径、API、配置 |
| [guides/PRIVACY.md](guides/PRIVACY.md) | 隐私边界：哪些数据留在本机、哪些会出站 |
| [guides/VOICE.md](guides/VOICE.md) | 语音发送全解：独立工具、桥接 CLI、AI 工具、控制台面板与配置解析顺序 |

---

## 三、发布（`release/`）

| 文档 | 内容 |
| --- | --- |
| [release/PUBLISHING.md](release/PUBLISHING.md) | 发布流程：发布前检查、推送与打标签、生成 Release ZIP、创建 GitHub Release |
| [release/RELEASE_NOTES_v0.1.0.md](release/RELEASE_NOTES_v0.1.0.md) | 本仓库首个发布基线的说明 |

`release/legacy/` 是上游 fork 时期的发布说明（v0.3.0 – v1.1.2），**只作存档**，版本号与本仓库无关。

---

## 四、归档（`archive/`）

| 位置 | 内容 |
| --- | --- |
| [archive/models/](archive/models/) | 早期配置与资源模型：`GLOBAL_CONFIG.md`（三层配置）、`RESOURCE_MODEL.md`（资源与权限）、`RUNTIME_PROFILE_MODEL.md`（运行方案 v3）——均以 PROFILES_MODEL 为准 |
| [archive/capability/](archive/capability/) | `CAPABILITY_UNIFY_SPEC.md`：能力/行为/工具归一 SPEC（产物链已废弃） |
| [archive/console/](archive/console/) | 控制台历史稿：`CONSOLE_UI.md`、`CONSOLE_COMPONENTS.md`、`CONSOLE_UI_REWORK.md`（已合并进 CONSOLE.md） |
| [archive/PROMPT_MIGRATION.md](archive/PROMPT_MIGRATION.md) | 2026-11-11 提示词逐段迁移记录 |

---

## 五、本地内部文档（`docs/_internal/`，不入库）

开发台账与阶段材料，保留在本机供追溯，不随仓库发布：

- 未完项与偏差台账：`STATUS.md`、`PARITY.md`、`PLAN_DEVIATIONS.md`、`EXTENSION_PLATFORM_DEVIATIONS.md`、`migration-report.md`
- 执行计划：`UNIFY_PLAN.md`、`PLUGIN_ROADMAP.md`
- 人格与提示词快照：`prompts/2026-11-11/`

---

## 六、想找什么 → 去哪看

| 我想…… | 看这个 |
| --- | --- |
| 搞清楚「配置存在哪、四层各管什么」 | [PROFILES_MODEL.md](PROFILES_MODEL.md) |
| 在新设备上把桥接接进 DSH | [DSH_DEPLOYMENT.md](DSH_DEPLOYMENT.md)、[guides/DSH_SETUP.md](guides/DSH_SETUP.md) |
| 改控制台界面 / 加组件 / 跑 UI 回归 | [CONSOLE.md](CONSOLE.md)、[CONSOLE_FORMS.md](CONSOLE_FORMS.md)、[guides/CONSOLE-UI-TESTING.md](guides/CONSOLE-UI-TESTING.md) |
| 改会话准入、方案、人格 | [SESSION_SUBSYSTEM.md](SESSION_SUBSYSTEM.md)、[PERSONA_PROVIDER.md](PERSONA_PROVIDER.md) |
| 写 / 改插件 | [PLUGIN_KERNEL.md](PLUGIN_KERNEL.md) |
| 接 MCP、技能、外部扩展 | [EXTENSION_PLATFORM.md](EXTENSION_PLATFORM.md) |
| 动权限、鉴权、发布前安全检查 | [guides/ADMIN_CHANNEL.md](guides/ADMIN_CHANNEL.md)、[guides/SECURITY_BASELINE.md](guides/SECURITY_BASELINE.md) |
| 知道某个目录/脚本是干什么的 | [FOLDER_MAP.md](FOLDER_MAP.md) |
| 权限边界与安全承诺（对外） | [../RULES.md](../RULES.md) |
| 发版、打 tag、写 Release Notes | [release/PUBLISHING.md](release/PUBLISHING.md) |
