// Safe audit suite: fixtures and mocks only, never production QQ/DSH.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const tests = [
  'test-audit-bridge.mjs', 'test-audit-protocol.mjs', 'test-audit-protocol-helpers.mjs',
  'test-audit-security.mjs', 'test-audit-security-mcp.mjs',
  'test-audit-setup.mjs', 'test-audit-setup-guards.mjs',
  // DSH 会话队列（inbox 投影）解析：0.2.0 把队列从 control baseline 的
  // `value.queues[<id>]` 挪进了 `value.projections[<id>].values.inbox`。
  // 认错形状的后果不是"少清几条"，而是**每一次退役会话都抛错**、旧任务继续跑，
  // 且只留下一行日志 —— 必须有登记期断言钉住（活 DSH 侧的实测见
  // scripts/test-dsh-session-retire.mjs）。
  'test-dsh-inbox-projection.mjs',
  'test-md-to-plain.mjs', 'test-slang-learn.mjs', 'test-mux-reconnect.mjs',
  'test-token-economy.mjs', 'test-qq-model-view.mjs', 'test-qq-preset-contract.mjs',
  'test-reply-wait.mjs', 'test-preset-prompt.mjs', 'test-role-card.mjs',
  // 体检修复回归：无令牌智能体调用面、send-burst 失败回滚、唤醒限频重试、
  // 定时器类暂存唤醒补发、collector 生命周期、ownerQQ 覆盖语义、预设名校验、
  // wake triggers 白名单、memory-update 边界、wait 租约归一化、md/黑话/表情/账本；
  // 本轮新增：/api/send/* 失败路径的作用域错误（R15）、reserved2 落库丢表情识别字段（R16）。
  'test-audit-regressions.mjs',
  // 图片/表情链路（动图/表情包字段、CDN 优先与 emoji_id 兜底）+ 联网搜索
  // （DSH 同一路 DeepSeek 搜索、Bing RSS 兜底、凭据优先级与端点安全；
  //  本轮新增：空结果 note 必须在写缓存之前生成，否则缓存命中丢掉提示）。
  'test-media-search.mjs',
  // GitHub issue 回归：#22 模式 user 层优先 / #11/#19 回合判忙租约 / #29 机器人身份注入。
  'test-issue-regressions.mjs',
  // 二代「会话初始提示词」：只在首次唤醒注入、管理面隔离、损坏文件只读降级、
  // 以及控制台「立即唤醒」不得顶掉首次 bootstrap（否则初始提示词永远发不出去）。
  'test-v2-initial-prompt.mjs',
  // 令牌账本 / 价目表 与 体检修复回归（纯函数，无外部依赖）
  'test-token-usage.mjs', 'test-hardening.mjs',
  // 语音发送（纯函数 + 端点存在性；真发语音只在 --live 或 CLI 里做）
  'test-voice.mjs',
  // 音量：参数校验 + 真的调用 ffmpeg 调音量 + 自算 RMS 验证增益
  'test-voice-volume.mjs',
  // 边界：并发/异常输入/上传限额/越权（纯函数段 + 可选的 live 段）
  'test-voice-edge.mjs',
  // 语音图形界面（参数解析/鉴权/路径穿越/文件名净化；live 段需普通终端）
  'test-voice-gui.mjs',
  // 控制台静态契约（跑不了 Playwright 的环境下的替代回归）
  'test-console-static.mjs',
  // 扩展 catalog（P1）：技能/MCP 统一视图、真工具数的缓存与错误隔离
  'test-extension-catalog.mjs',
  // HTTP 边界（docs/HTTP_BOUNDARY.md）：静态资源穿越/符号链接/扩展名白名单，未启用与未知端点 404
  'test-http-boundary.mjs',
  // 语音系统整体结构检查（入口/依赖/端点/开关/文档一致性）
  'test-voice-system.mjs',
  // SnowLuma 账号/token 自发现（换 QQ 账号后 token 会变，写死的工具会 401）
  'test-snowluma-conn.mjs',
  // 启动器与编码（乱码根因：.cmd 里的非 ASCII 会被 cmd 按 ANSI 解码）
  'test-encoding.mjs',
  // 控制台乱码机制（UTF-8 字节被按 GBK 解码）+ chcp 修复
  'test-console-encoding.mjs',
  // 🔴 铁律 L7（仿真会话不得拥有本地执行能力）：注册期断言——
  //    preset 挂了守卫、守卫的 restrict 名单覆盖全部已知本地工具、且执行期一律拒绝。
  //    这是唯一挡住"绕过桥接直连 OneBot HTTP"的东西（见 QSH_PLAN.md §0.1/§5.2），
  //    所以必须在每次回归里跑，而不是一次性验收。
  'test-preset-local-tools.mjs',
  // qq-mode-console 的 settings 契约：0.2.0 删除了 ctx.settings.register()，
  // 命名空间改为由 loader entry id + 导出的 Config 推导。断言三点前提都在，
  // 并且那条已删除的 API 不会被照旧注释加回来。
  'test-qq-mode-plugin.mjs',
  // SnowLuma 上游健康（被误诊成「qq-bridge 注入失败」的那个失败形态）：
  //   · good 必须取自心跳 status.good / get_status —— 取自 get_login_info 会**静默失效**
  //     （SDK 不校验 data 载荷，good 会永远停在 null，整条权威信号变成死分支）；
  //   · 静默检测不得冒充 hook 检测（心跳是 SnowLuma 本地定时器无条件发的）；
  //   · 客户端库版本不得低于 bot_status 出现的版本。
  'test-snowluma-upstream-health.mjs',
  // ── v0.3.0 新功能（全部离线，假数据）────────────────────────────────────────
  // 人际连续性：QQ 号认人、改名、入群分类/去重、首次部署对账、可见范围过滤、跨群协作、存储可靠性。
  'test-continuity.mjs',
  // 管理通道：TOTP（RFC 6238 向量）、审计哈希链、确认码状态机、并发申请、自动回落、审批编号、命令解析。
  'test-admin-control.mjs',
  // 接线：真实 bridge.js + 假 DSH/OneBot —— 确认消息不进模型、非 owner/提示注入无法提权、
  // 权限预设钉住与 fail-closed、审批绑定参数、入群唤醒、AI 工具的会话边界。
  'test-integration-v030.mjs',
  // L1 只读 agent preset 的工具白名单守卫（不依赖 Windows 沙箱）。
  'test-agent-readonly-guard.mjs',
  // 插件内核（v1.2.0）：清单/配置坏输入只降级、钩子超时隔离、人格 provider 注册表、关闭流程。
  // 插件内核与配置 schema：清单校验、默认值/边界、无 schema 兼容。
  'test-plugin-kernel.mjs',
  'test-plugin-config-schema.mjs',
  // 预设编辑器源文件存储（P3）：元数据/扩展授权校验、备份恢复、YAML 结构底线。
  'test-preset-store.mjs',
  // 行为档案（全局配置）：YAML 校验、预设绑定、坏文件 fail closed。
  'test-behavior-profiles.mjs',
  // 人格三层解析：会话覆盖 → provider → 全局本地卡，off 硬覆盖，缺卡时继续往下落。
  'test-persona-resolve.mjs',
  // soulkit 人格适配器：协议三态、标题行剥离、ETag、坏响应抛错。
  'test-soulkit-persona.mjs',
  // 命令注册表（P3a）：最长匹配、别名、元数据回退、权限/scope、冲突保留先注册者。
  'test-command-registry.mjs',
  // 会话重置（P7 第三步）：逐桶清理、落盘/停 DSH/回执的顺序、停止失败不阻断归档。
  'test-session-reset.mjs',
  // 会话级有效模式（P2a）：closed-agent 排他、inherit 回落、覆盖合法性与非法值归一。
  'test-session-mode.mjs',
  // 会话级模型（P2b）：模型签名进指纹、档案优先、看图能力与全局参数回退。
  'test-session-model.mjs',
  // 主动检查点（P2b）：调度器跳过通知去重/落盘、方案 A 的 v1 主动轴门禁。
  'test-session-proactive.mjs',
  // 多管理员（P3）：名单归一化、capability、closed-agent 级别与私聊被动豁免。
  'test-admins.mjs',
  // 手动静默：策略归一化、owner/管理员/普通矩阵、阶段开关、sendOnly、旧状态兼容。
  'test-manual-silence.mjs',
  // 会话档案端点（P1）：并集列表、GET/PATCH/DELETE、权限与非法值。
  'test-session-profiles.mjs',
  // 准入名单：条目前缀、白/黑空语义、旧三态迁移与 v2 校验。
  'test-session-access.mjs',
  // sessions.json 读写（P7 第三步续）：损坏/读失败降级为只读不写、缺字段补齐、可写才落盘。
  'test-session-store.mjs',
  // 会话映射表（P7 第三步收尾）：映射与策略指纹成对维护、isCurrent 三条件、state 被替换后仍有效。
  'test-session-registry.mjs',
  // 会话稳定性（P0）：新建即命名、启动对账标 missing、prompt not-found 退役重建一次、60 秒 3 次熔断。
  'test-session-lifecycle.mjs',
  // 会话策略指纹（P7 第三步收尾）：级别进指纹（提权要退役旧会话）、非 closed-agent 不进指纹、isCurrent 三条件。
  'test-session-policy.mjs',
  // 会话标识平台化：key 组装/解析、新旧形态互认、非法输入不产出半成品 key。
  'test-session-key.mjs',
  // 上游适配（P7 第四步）：SnowLuma「自报坏」与「静默」两个故障面、边沿告警、get_status 兜底轮询。
  'test-upstream-snowluma-health.mjs',
  // 上游编排的纯策略：DSH 探活 + 自动识别地址的节流重试、SnowLuma 连接参数自愈（两个 token / 端点跟随开关）。
  'test-upstream-dsh-probe.mjs',
  'test-upstream-conn-update.mjs',
  'test-core-prompt-blocks.mjs',
  // 注入块重构（P1）：唤醒提示词按 slot/priority 拼装后，逐字节等于重构前的 golden 夹具
  // （4 种配置 × 14 个唤醒原因 + 收尾提醒），防止「谁来拼」的改动顺手改了「拼出什么」。
  'test-prompt-golden.mjs',
  // 注册表 v2 语义（P2）：槽位顺序、reason 前缀匹配、profiles 筛选、单块/总预算、插件块豁免默认上限。
  'test-prompt-registry.mjs',
  // 配置归一（P3）：定时任务/定时静默/插件配置的设置存 config，状态文件只留运行态，旧文件首读迁移。
  'test-config-unify.mjs',
  // 运行方案（P4）：定义归一、legacy 投影、激活指针的一次性迁移。
  'test-runtime-plans.mjs',
  'test-runtime-combo.mjs',
  'test-runtime-capabilities.mjs',
  'test-tool-catalog.mjs',
  'test-prompt-compose.mjs',
  'test-runtime-adapters.mjs',
  // 技能清单（§9.2）：frontmatter 解析、同名去重、固定行数渲染、字数预算、扫描缓存。
  'test-skills-index.mjs',
  // 外部技能存储（P3）：frontmatter 校验、写入/备份/启停/删除、ZIP 导入与路径边界。
  'test-skill-store.mjs',
  // 扩展 Hub：preset 过滤 MCP/技能、工具 deny、技能正文读取。
  'test-extension-hub.mjs',
  // 插件安装/卸载（P2b）：目录与 zip、清单失败回滚、路径穿越与超限拒绝、卸载进 _trash。
  'test-plugin-install.mjs',
  // preset 源与 bundle patch 不漂移（v0.3.0 起多了 qq-agent-readonly，一并钉住）。
  'test-agent-preset-patches.mjs',
  // v0.4.0 控制中心：目录识别、数据迁移、鉴权、子进程管理、固定命令集与 L6（只由用户点击启停 SnowLuma）。
  'test-control-center.mjs',
  // v0.4.1 部署反馈：握手只发 error 的自愈 + 连接看门狗；DSH 回合错误可定位且不外泄；DSH 端口自动识别。
  'test-snowluma-reconnect.mjs',
  'test-agent-errors.mjs',
  'test-dsh-endpoint.mjs',
  // v0.4.2 管理员私聊托付群会话（方案 C）：只有 owner 私聊能托付白名单群，交给群会话自己发言，会话隔离不变。
  'test-owner-relay.mjs',
  // 接口平台（仓库内 interface-platform/，M1；缺失即失败）：假 SnowLuma + 真实 SDK 客户端走 OneBot 兼容入口；控制中心托管平台进程、
  // 接入桥接的备份/还原；viaPlatform 时自愈不得绕过平台；顶部大标签切换不发请求。
  'test-platform.mjs',
  // 表情单张大小上限 socialV2.sticker.maxBytes（默认 10MB）：收藏/发送用它；图片识别用 r4 的 socialV2.media（默认 8MB）。
  'test-sticker-limits.mjs',
  // 管理员私聊跨群只读 + 群长期规则（默认关闭）：只有 owner 私聊能用、只读不改已读、规则由桥接写入并注入目标群唤醒。
  'test-group-rules.mjs',
  'test-slang-tabs.mjs',
  // NapCat 管理：版本显示（后端自报 / Windows 安装文件）、检查更新（只提示）、目录与启动文件设置、系统「浏览…」窗口（Mac / Windows）。
  'test-napcat-manage.mjs',
  // 桥接日志按实际 QQ 后端称呼（经接口平台 · NapCat），不再一律写 SnowLuma。
  'test-qq-backend-label.mjs',
  // macOS 无窗口启动 App（npm run mac-app 生成，不入库）：脚本约定；macOS 上实际编译一次。
  'test-mac-app.mjs',
  // DSH 探活：连续 2 次失败才判定不可用（偶发一次只在恢复时记一笔），失败原因分类（超时 / 连接被拒 / 其他）。
  'test-dsh-health.mjs',
  // Linux 支持（增量，Windows / macOS 行为不变）：SnowLuma 2.x 发行包识别与启动、Node 要求、按平台的更新建议、Linux「浏览…」、NapCat 在 Linux、systemd 用户服务。
  'test-linux-support.mjs',
  // Windows 实机部署反馈的问题：Release ZIP 中文文件名 UTF-8 标志、黑话研究日志计数、会话重置清等待租约、Linux 服务文件 POSIX 路径、禁止 URL.pathname 当路径。
  'test-deploy-fixes.mjs',
  'test-slang-guess.mjs',
  'test-dsh-model.mjs',
  'test-quote-forward.mjs',
  'test-mode-handover.mjs',
  'test-scheduler.mjs',
  'test-silence-schedule.mjs',
  'test-role-refresh.mjs',
  'test-sticker-describe.mjs',
  'test-web-image.mjs',
  'test-auto-compact.mjs',
  'test-default-roles.mjs',
  'test-send-limit-console.mjs',
  'test-backfill.mjs',
  'test-role-per-key.mjs',
  'test-dsh-auth-hint.mjs',
  'test-prompt-blocks.mjs',
  'test-agent-token-guard.mjs',
  // AI 收藏表情的后端适配：SnowLuma 照旧 base64://；NapCat 只收本地路径时改用桥接自建的受控临时文件（用完即删）。
  'test-sticker-collect.mjs',
];
let failed = 0;
for (const test of tests) {
  console.log(`\nRunning ${test}`);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', test)], {
    cwd: root, stdio: 'inherit', timeout: 60000,
    // 离线测试一律不碰真实 NapCat 目录（macOS 上在 QQ 沙盒容器里，读它会弹授权窗并卡住）
    env: { ...process.env, QQ_BRIDGE_TEST_LIVE: '0', QQ_BRIDGE_NAPCAT_HOME: process.env.QQ_BRIDGE_NAPCAT_HOME || path.join(os.tmpdir(), 'qq-bridge-test-no-napcat') },
  });
  if (result.status !== 0 || result.error) {
    failed++;
    console.error(`FAILED ${test}: ${result.error?.message || `exit ${result.status}`}`);
  }
}
console.log(`\nAudit suite: ${tests.length - failed}/${tests.length} scripts passed.`);
process.exitCode = failed ? 1 : 0;
