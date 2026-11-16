# 配置说明（v0.3.0 起新增的字段）

> **2026-11-09 规划**：配置结构将按 ](../archive/models/GLOBAL_CONFIG.md) 的三层模型重构；`social` / `socialV2` 的行为字段会迁入 `config/behaviors/*.yml`，`social-v1` / `social-v2` / `access` 页面会删除。本文只描述**当前版本**的字段，实施后同步改写。

原版字段（`allow/deny`、`social*`、`slang` 等）的说明见 [../../README.md](../../README.md)「安装与配置」，含义未变。

**平台配置（当前 v3）**：所有「用哪个平台、它怎么连」都收在 `config.json` 的 `platforms` 段里，
旧版顶层键 `platform.*` / `snowluma.*` / `dsh.*` 在首次启动时**一次性迁移并删除**（迁移前备份
`config.json.bak-<YYYYMMDD-HHmm>`，之后不再读旧键）。v2 → v3 只做一件事：把旧的全局默认运行方案
`runtime.defaultPlan` 写到当时活动的用户平台条目上（`platforms.users.<id>.defaultPlan`），并删掉旧键。

```jsonc
"platforms": {
  "active": { "user": "qq", "agent": "dsh" },      // 用哪个平台；不可用时启动直接报错并列出已注册 id
  "users":  { "qq":  { "account": "", "enabled": true, "defaultPlan": "social-v2", "transport": { /* 连接参数 */ }, "options": { /* 行为选项 */ } } },
  "agents": { "dsh": { "endpoint":  { /* 地址与鉴权 */ }, "options": { /* 模型与行为选项 */ } } }
}
```

下文中带 `platforms.users.<id>.` / `platforms.agents.<id>.` 前缀的路径都指这个段；写散在条目里
（不在 `transport`/`options`/`endpoint` 下）的键会被自动归位，不会丢。

## `platforms.agents.<id>` —— 多实例与默认 Agent 平台

Agent 侧可以同时存多条平台的配置：`agents` 里每条都有自己的 `endpoint`（怎么连）与 `options`（模型与行为选项），
`active.agent` 只决定「默认用哪一个」。没被选中的条目照样可读、可写、可探活 —— 切换默认 Agent 平台不需要先把另一条删掉。

| 入口 | 作用 |
| --- | --- |
| 平台 › Agent 侧 › 详情 › 配置 | 表单字段就是 `platforms.agents.<id>` 那一份，保存只写用户给的键（不把 schema 默认值固化成设置） |
| 平台 › Agent 侧 › 详情 › Agent 平台 | 「探活」与「设为默认 Agent 平台」；后者先探活，探不通不落盘 |

- **端点与选项的生效时机不同**：`endpoint.*`（`baseUrl` / `authToken` / `authTokenExplicit` / `authHeader` /
  `authPrefix` / `allowRemote`）决定「下一次连接去哪」，改了要重启桥接；`options.*`（`provider` / `model` /
  `reasoningEffort` / `vision`）由调用面每次现读，改完即生效。
- **切换默认 Agent 平台只改 `active.agent`**，条目原样保留。运行期的连接层句柄是启动时装配的单例，所以切换后要重启桥接；
  在那之前注册表会给一条 `active_pending_restart`（warn），控制台同时显示「已设为默认，重启后生效」与列表里的「待重启」。
- **默认 Agent 平台没有第二份配置**：控制台「默认 Agent 平台」与 `/api/config/runtime` 的 `runtime.defaultAgent` 读的都是
  `platforms.active.agent`。两处各存一份必然漂移 —— 一个由控制台写、一个由手改 `config.json` 写。

## `platforms.users.<id>` —— 用户侧实例与启用开关

`users` 里每条条目就是一个**实例**：一个平台 + 一个账号。每条实例在启动时各自装配一条入站管线
（校验 → 准入 → 会话映射 → 唤醒），`id` 既是配置键也是实例键，`account` 是这条实例在该平台上的账号。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 条目级开关。`false` 的实例启动时直接跳过装配（不连接、不收消息），控制台标「已停用」 |
| `defaultPlan` | `""` | 条目级默认运行方案（`profiles/plans/<id>.yml` 的 id）。这个平台新建、且没单独指定方案的会话用它；空串 = 回退内置 `social-v2` |
| `account` | `""` | 账号名；空串 = 该平台的默认账号，会话 key 里也就不带 `@` 段 |

- **`defaultPlan` 也不是平台的选项**：与 `enabled` 同级，不进 `transport` / `options`，也不在 `configSchema` 里。它由写口单独校验（只认方案目录里真有的 id），页面把它排在配置表单的条目开关旁边；Agent 侧没有这个字段，写口直接 400。
- **`enabled` 不是平台的选项**：它不进 `transport` / `options`，也不在 `configSchema` 里 —— 控制台把它排在
  配置表单首位，保存时与平台字段一起提交；校验只针对平台字段，所以配置本身不合规时也能先把实例停掉。
- **翻开关要重启**：装配只发生在启动期，改 `enabled` 不会断开已经连上的实例，写口固定回 `requiresRestart: true`。
  在那之前注册表里 `enabled` 与 `inboundState` 会不一致 —— 前者是配置面，后者是本进程装配的事实。
- **入站结论按实例记**：`inboundState` 是 `open` / `closed` / `error` / `disabled` / `send-only` / `unregistered`
  之一，`null` 表示本进程还没走到装配那一步。停用是有意关掉的，不产生诊断。
- **出站与开关无关**：能不能发消息由「谁接管了这条平台的传输」决定，注册表的 `outbound` 写明走内置适配器
  （`via: adapter`）还是插件 transport（`via: transport` + `owner`），`none` 表示没人接。

| 入口 | 作用 |
| --- | --- |
| 平台 › 用户侧 › 详情 › 配置 | `PATCH /api/platforms/registry/user/:id/config`：字段由 `configSchema` 生成，外加条目开关 |
| 平台 › 用户侧 › 详情 › 实例 | 「设为默认实例」只改 `active.user`，重启后装配；同一端点上的 `probe` 对用户侧固定 400 —— 没有主动探活，连接结论看 `inboundState` |

`active.user` 只决定「默认用哪一个」：它是出站没有地址上下文时的兜底（`defaultAddress()` 读它），
也是控制台与日志里「哪个账号是主账号」的答案，与 `/api/config/runtime` 的 `runtime.defaultUser` 是同一个值。

本文只列 v0.3.0 起新增的配置段、工具开关和状态文件。所有字段都可省略，省略即取下表默认值；**默认值都是安全的**。
修改 `config.json` 后需要重启桥接；修改 `socialV2.tools.*` 还需要重启 DSH（MCP 工具清单在 DSH 启动时读取）。

## `continuity` —— 人际连续性

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关。关闭后不记录人物、不处理成员事件、不注入【在场人物】 |
| `sharePolicy` | `"identity"` | `none` / `identity` / `shared`，见 [CONTINUITY.md](CONTINUITY.md) §4；非法值按 identity 处理 |
| `injectPeople` | `true` | 是否在二代唤醒提示词里注入【在场人物】 |
| `injectMaxPeople` | `8` | 每次最多注入几个人 |
| `injectMaxChars` | `1500` | 【在场人物】小节的字数上限（成本护栏） |
| `reconcileOnConnect` | `true` | 连上 SnowLuma 后拉成员名单对账（首次部署建档 / 补记漏掉的入退群） |
| `joinEvents.wake` | `true` | 入群事件是否唤醒二代会话 |
| `joinEvents.wakeOn` | `["stranger","knownElsewhere","returning"]` | 哪些入群分类会唤醒 |
| `leaveEvents.wake` | `false` | 退群事件是否唤醒 |
| `dedupeWindowMs` | `600000` | 入/退群事件去重窗口 |
| `pruneListedAfterDays` | `0`（关） | 保留策略：删除这么多天未出现、无记忆、未被管理员设定的 `listed` 记录 |
| `groups.<群号>.label` | `""` | 群标签。在 `identity`/`shared` 策略下，别的群里会显示「也在『标签』见过」；不设则只显示「另外 N 个群」 |
| `groups.<群号>.sharePolicy` | 继承 | 只能比全局更严 |
| `groups.<群号>.recordable` | `true` | `false`：该群不写人物库、不被其它群看见、AI 不能在该群记人 |

> `config.example.json` 里的 `groups` 用的是**示例群号 10001 / 20002**，部署时请删除或改成真实群号。

## `admin` —— owner 私聊管理通道

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 关闭后 owner 私聊不再处理管理命令；模式/权限类斜杠命令仍被拦截，不会透传 |
| `naturalLanguage` | `true` | 是否识别「切换到 agent 模式」等固定句式（正则，不经过模型） |
| `safeMode` | `"reserved2"` | 降级、紧急关闭、自动回落的目标（`chat` / `reserved` / `reserved2`） |
| `defaultAgentLevel` | `"L1"` | `/mode agent` 不带级别时的默认级别。控制台未指定时用 L2 |
| `confirmCodeDigits` | `4` | 确认码位数（4~8） |
| `requestTtlMs` | `120000` | 确认码有效期 |
| `maxConfirmAttempts` | `3` | 每个申请最多尝试次数 |
| `maxPendingRequests` | `3` | 同时待确认的申请上限 |
| `idleTimeoutMs` | `1800000` | 高权限闲置自动回落；`0` = 关闭（不建议） |
| `maxElevatedMs` | `{ "L1": 14400000, "L2": 7200000, "L3": 3600000 }` | 各级别最长持续时间 |
| `hibernateChatSessions` | `true` | 进 agent 时聊天会话休眠、回落后原样复用；`false` = 切换即归档（旧行为） |
| `dormantMaxMs` | `86400000` | 休眠会话最长保留多久，超过归档 |
| `handover` | `true` | 记录 owner 私聊往来，并在 owner 会话因切换换新 / 恢复时注入交接（只含 owner 私聊、已脱敏）；`false` = 不记录不注入 |
| `totpMaxFailures` | `5` | TOTP 连续失败多少次锁定 |
| `totpLockMs` | `900000` | 锁定时长 |
| `allowL3` | `true` | `false` = 任何入口都不能开 L3。未配置 TOTP 时 L3 本来就不可用 |
| `externalEscalation` | `"revert"` | 发现外部把模式改成 closed-agent 时：`revert` 回退并告警；`alert` 只告警 |
| `showPrivateNotes` | `false` | 管理通道 `/whois` 是否显示私聊来源记忆的原文（默认只显示条数） |
| `pinChatReadOnly` | `true` | 群友会话建好后顺手钉 `read-only` 权限预设（纵深防御，失败不影响聊天） |
| `approvalArgsMaxChars` | `600` | 审批消息里参数展示的字数上限 |
| `consoleEscalationCooldownMs` | `600000` | 高权限回落后多久内控制台不能提权（高权限期间控制台一律不能提权）；QQ 管理通道的申请+确认不受影响 |
| `allowCustomAgentPreset` | `false` | `true` 时 L2/L3 改用控制台「封闭 Agent 使用的 DSH 预设」里选的 preset —— **那样没有桥接的审批闸门**，不建议 |

TOTP 秘密**不在** `config.json` 里：用 `npm run admin:totp-setup` 写入 `state/admin/totp.json`，或设置环境变量 `QQ_BRIDGE_TOTP_SECRET`。

## `crossGroup` —— 跨群受控查询

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 总开关 |
| `links` | `[]` | 有向链接：`{ "from": "<群号>", "to": "<群号>", "allow": ["presence", "activity"] }`。模板里的链接是示例 |

## `socialV2.tools` 新增开关（默认都是 `true`）

| 开关 | 工具 | 说明 |
| --- | --- | --- |
| `personProfile` | `qq_get_person` / `qq_note_person` | 按 QQ 号查看/记录人物（按可见范围过滤；只能写当前会话作用域） |
| `requestMode` | `qq_request_mode_change` | 只在 owner 私聊会话里登记申请；不能执行、不能确认 |
| `crossGroup` | `qq_cross_group_query` | 还需要 `crossGroup.enabled` 与链接授权 |
| `schedule` | `qq_schedule_create / list / update / delete` | AI 在管理员私聊里登记定时任务（定时任务的总开关在控制台「定时任务」页面，和这个工具开关是两回事）。见 [SCHEDULER.md](SCHEDULER.md) |
| `webImage`（**默认 `false`**） | `qq_search_images` / `qq_preview_image` / `qq_send_web_image` | 管理员私聊里搜图并发送：只能发搜到且看过的候选，图片由桥接安全下载；搜索词会发给 Bing。必须显式设为 `true`，改后重启 DSH |
| `handoverMemory` | —（不是工具） | 切到 agent 时，把二代仿真里 AI 在管理员私聊记下的长期记忆（最多 1500 字，只取管理员私聊）一起交接；`false` = 只交接最近的私聊往来 |

## `compact` —— 会话太长时自动压缩

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `mode` | `early` | `early` = 桥接提前压缩；`agent` = 交给 Agent 平台自己压（它按模型窗口的比例触发，窗口大的模型要到很晚才压） |
| `thresholdTokens` | `null` | 某个二代会话最近一步读的 token 超过它，就在这一轮结束、会话空闲后执行一次 Agent 平台的 `/compact`。`null` = 跟随平台申报的 `modelCatalog.compact.approxTokens`；自己填也不接受晚于申报点的值（再往上平台自己会先压） |
| `cooldownMinutes` | `120` | 同一个会话两次自动压缩的最小间隔（失败也算） |

控制台「全局配置 → 行为与模型 → 上下文压缩」可以直接改：选「提前压缩」并填几万 token（5 万起，上限取平台申报点），或选「交给 Agent 平台自己压缩」；卡片里还列出每个会话上一步读了多少。

“平台自己什么时候压”由平台在 `profiles/agent-platforms/<id>/platform.yml` 的 `modelCatalog.compact.approxTokens` 申报，桥接不内置任何平台的数字。

压缩只把较早的历史换成摘要，桥接自己的记忆（群规则、话题、印象）不受影响；压缩后下一次唤醒会重新完整给黑话表、表情块和角色卡。

## 定时任务与定时静默

这两项的设置**不在 `config.json` 里**，在桥接控制台改（「定时任务」页面；「运行总览 → 静默开关」），保存在 `state/scheduler.json` 与 `state/silence-schedule.json`，改完立即生效、不用重启。
说明见 [SCHEDULER.md](SCHEDULER.md)、[SILENCE.md](SILENCE.md)。

## 管理员私聊托付群会话（v0.4.2，默认关闭）

每个 QQ 会话（群、私聊）在 DSH 里是独立的 AI 会话，会话令牌只能发到自己的会话。所以你在私聊里说「去 X 群说两句」，
私聊里的 AI 发不出去（以前会回答「令牌不对」）。打开这个工具后，私聊里的 AI 可以把这件事**托付**给 X 群**自己的**会话：
桥接把托付交过去并唤醒它，由群会话看着群里的上下文自己组织语言、用自己的令牌发言。会话之间的隔离不变。

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `socialV2.tools.ownerRelay` | `false` | 开关，对应工具 `qq_ask_group_session`。必须显式设为 `true`；改动后重启 DSH 才会出现在工具列表里 |
| `socialV2.ownerRelay.maxPerHour` | `10` | 每小时最多托付次数（全部群合计） |
| `socialV2.ownerRelay.maxPerTargetPerHour` | `5` | 同一个群每小时最多托付次数 |
| `socialV2.ownerRelay.maxChars` | `300` | 托付内容最长字数 |
| `socialV2.ownerRelay.ttlMs` | `1800000` | 托付等待群会话处理的最长时间（30 分钟），过期丢弃 |
| `socialV2.ownerRelay.notifyOwner` | `true` | 每次托付后桥接私聊告诉你转交了什么 |

限制：只在二代仿真（reserved2）下可用；只有你本人私聊（`private:<ownerQQ>`）的会话能托付；目标只能是白名单里的群；
目标群开着静默模式时拒绝；托付内容会过敏感信息过滤，只保存在内存里（不落盘）；每次托付或被拒都记入管理审计（`/audit`）。
群会话按群里的情况决定怎么说；明显不合适的托付（比如会泄露私聊内容）它可以不做。

## 管理员私聊跨群查看与群长期规则（默认关闭）

会话之间默认互相隔离：私聊里的 AI 看不到群里的消息，它记下的东西也只存在私聊会话自己的记忆里，所以你在私聊里说「群里以后要这样」，群里的 AI 是看不到的。打开这个开关后，**只有你本人的私聊**会话多两个工具：

| 工具 | 作用 |
| --- | --- |
| `qq_owner_peek_group` | 只读查看某个白名单群最近的消息（≤50 条）、该群会话的记忆摘要和长期规则。不会标记那个群的已读，也不能在那个群发言 |
| `qq_owner_group_rule` | 给白名单群增删「长期规则」（每群 ≤10 条，每条 ≤200 字）。规则由**桥接**写进那个群会话的记忆，之后每次唤醒都注入【管理员为本群设定的长期规则】；群会话自己的记忆工具改不动、清不掉 |

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `socialV2.tools.ownerGroupAccess` | `false` | 开关。必须显式设为 `true`；改动后重启桥接，并重启 DSH 才会出现在工具列表里 |

不变的边界：在群里说话仍然只能走托付（`qq_ask_group_session`），私聊的令牌依旧不能直接往群里发；规则只用于说话习惯，不能改模式、权限或安全设置（那些只能用管理通道命令）；查看与增删规则都记入管理审计，增删规则会私聊通知你。

## `socialV2.sticker.maxBytes` —— 表情单张大小上限（默认 `10485760`，即 10MB）

AI **收藏**群友的表情、**发送**收藏表情时，桥接会先自己下载并校验图片（DNS 固定、逐跳校验、限制大小），再以 base64 交给网关；超过这个上限就拒绝。

- 取值范围 256KB ～ 40MB，超出按边界处理，非法值回到 10MB。上界是给传输留的余量：base64 会膨胀约 1/3，40MB 编码后约 54MB，仍在接口平台单条消息 64MB 的上限内。
- **不影响图片识别**：把聊天图片 / 表情图交给模型看（含 `qq_get_sticker_image`）用的是另一个配置 `socialV2.media.maxBytes`（上游 r4 引入，默认 8MB，范围 256KB～20MB；同组还有 `maxPixels` 默认 64MP、`maxCount` 默认 5 张）。
- 直连 SnowLuma（不经接口平台）时，SnowLuma 自身对单条消息的大小限制没有实测过；遇到发送失败可以先调小这个值。

## `socialV2.sticker.collect.tempDir` —— NapCat 收藏表情用的临时目录（默认留空）

只在网关是 NapCat 时用到：NapCat 的 `add_custom_face` 只接受本地文件路径，桥接会把已校验的表情字节写成一个随机名、权限 0600 的临时文件交给它，调用结束立即删除。
留空时：macOS 用 QQ 沙盒容器里的 `~/Library/Containers/com.tencent.qq/Data/tmp`（App Store 版 QQ 读不到系统临时目录），其它系统用系统临时目录。SnowLuma 不用这个目录。

## `platforms.agents.<id>.options`：`provider` / `model` / `reasoningEffort` / `vision` —— 模型选择

推荐在桥接控制台的 Agent 平台 › DSH 详情的「模型与思考强度」里选：提供方、模型、思考强度、看图能力四个控件联动，选项来自该平台声明的模型目录
（`modelCatalog` 声明 + 实时目录，见 `GET /api/platforms/registry/agent/<id>/models`），保存后对已有会话的下一条消息生效，不用重启桥接。手改 `config.json` 也可以，重启桥接后生效。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `options.provider` | `deepseek-official` | 提供方。DSH 桌面版 0.2.1 起 DeepSeek 自家的提供方叫 `deepseek-account`。其它提供方是第三方：QQ 里的聊天内容会发给它们，控制台会提示隐私并在保存前再确认一次 |
| `options.model` | `deepseek-flash` | 模型 id（DeepSeek-V4.1-Flash，能看图） |
| `options.reasoningEffort` | `max` | 思考档位：`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`，具体模型支持哪些以 DSH 目录为准；留空 = 用模型默认。`off` 是关闭思考，回复更快但工具调用和人格一致性可能变差。模型没有思考档位时自动不带这个参数 |
| `options.vision` | `auto` | 看图能力：`auto` = 只有核实过能看图的模型（目前是 DeepSeek 的 `deepseek-flash`）才把 QQ 图片交给它，其余模型把图片、表情改成文字占位（避免整条消息被拒）；`yes` / `no` = 手动指定 |

- 控制台保存时由服务端按目录硬校验：提供方 / 模型不在目录里、档位不在该模型的列表里都会拒绝；目录读不到时**不保存**（返回 503），聊天照常按原配置进行。
- 价目只来自平台声明（`modelCatalog.models[].pricing` + `pricingPolicy`）：平台没申报单价的模型不报价，账本只计 token、金额显示 `—`，不做兜底估算。
- 只有控制台能改模型：AI 的令牌调不了这些接口，QQ 私聊管理通道也没有改模型的命令。
- 和思考强度一样，切换会同时写入 DSH 的全局默认（`~/.dsh/settings.yaml` 的 `agent-default-model`），Web GUI 里新建会话的默认模型也会跟着变。

## `platforms.agents.<id>.endpoint.baseUrl` —— DSH 地址（默认留空 = 自动识别）

留空时按顺序识别：桌面版固定端口 19387 / 命令行版 3080 → 都连不上时查 DSH 桌面版进程正在监听的回环端口（DSH 桌面版 0.2.1 起每次启动换随机端口），
并用未登录请求的 401 提示文字确认确实是 DSH。DSH 不可用期间桥接每 10 秒重新识别一次，DSH 重启换端口后会自动跟上。
显式填写时一律照用、不做发现（DSH 跑在别处或别的端口时才需要填）。

## `platforms.users.<id>.transport.viaPlatform` —— 经接口平台连接（默认 `false`）

为 `true` 时，同段的 `wsUrl` / `httpUrl` / `accessToken` 指向接口平台（与桥接平行的 `interface-platform/`）的 OneBot 兼容入口，令牌是平台的数据令牌：

- token 自愈不再扫描 SnowLuma 目录（`homeDir` / `launcherPath` / `SNOWLUMA_HOME` 一律忽略），也不跟随发现到的端点 —— 否则会拿到 SnowLuma 的真实地址、绕过平台直连；
- 等同于强制 `followDiscoveredEndpoint: false`。

一般不用手改：在控制中心「接口平台 → 设置」点「接入桥接」，会写好这几个字段并把原值备份到 `state/platform-link-backup.json`，「恢复直连」可还原。「接入桥接」时数据令牌和地址由平台经管理接口交给控制中心，控制中心不读平台的文件，所以平台必须正在运行。详见同级目录的 `interface-platform/README.md`。

## `platforms.users.<id>.options.backfill` —— 断线期间错过的消息，恢复后补收

电脑睡眠（比如 Mac 合盖）、NapCat 重启、桥接停过的时候，这段时间群里和私聊的消息不会作为事件推给桥接，AI 也就不知道有人 @ 过它。
桥接发现两次事件包隔得太久，就在连接恢复后用 `get_group_msg_history` / `get_friend_msg_history` 把这段时间的消息补收进未读。

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `gapMs` | `120000` | 两次事件包隔了这么久就认为断过（心跳 30 秒一次；范围 1～60 分钟） |
| `settleMs` | `10000` | 恢复后等多久再补收 |
| `maxAgeMinutes` | `360` | 比这更早的消息只记下，不唤醒 AI |
| `maxPerConversation` | `50` | 每个会话最多补几条 |
| `lookbackMs` | `60000` | 从断线前最后一个事件包再往前多看一点，防止边界上的消息漏掉（重复的按消息 ID 去掉） |

- 只在二代仿真里补收（其它模式会把旧消息逐条交给模型回复），其它模式只在活动记录里提醒「可能错过了」。
- 补收的消息带 `backfill: true` 和原始发送时间；有 @ / 私聊等直接找 AI 的，照常排唤醒，唤醒提示最前面会说明这是补收的。
- **补收的消息不执行任何命令、审批、确认码、角色切换**；管理员私聊里补收到的命令只私聊提醒你「没有执行，需要的话重发」。
- 补不回来的：拍一拍、入群等通知事件；断线期间被撤回的消息。

## 状态文件（`state/`，不入库）

| 文件 | 内容 |
| --- | --- |
| `state/social/people.json`（+ `backups/`） | 人物库 |
| `state/admin/control.json`（+ `backups/`） | 当前模式/级别、申请记录、TOTP 防重放计数、审批编号 |
| `state/admin/audit.jsonl`（滚动 `.1`~`.5`） | 管理审计（哈希链） |
| `state/admin/totp.json` | TOTP 秘密（如果用文件方式） |
| `state/mode.json` | 原版的模式兜底文件，v0.3.0 额外写入 `level` |
| `state/admin/owner-transcript.json` |owner 私聊往来记录，切换模式时交接用；脱敏、限长，0600 |
| `state/scheduler.json` |定时任务：总开关、默认时区、安全限制、任务列表、执行记录；0600 |
| `state/silence-schedule.json` |定时静默：时间段、时区、静默期间的行为选项；0600 |
| `state/sticker-describe-session.json` |一键补表情说明用的专用看图会话 ID 与 preset；删掉会在下次使用时重建 |
| `state/prompt-blocks.json` |各会话上次完整拿到的黑话表 / 表情块指纹（只存指纹）；删掉只会让下一次唤醒重新完整给 |
| `state/role-backups/` |「恢复默认人格」时，改过的那份角色卡先备份到这里（每个人格最多 10 份，0600）；可以随时删 |
| `state/upstream-seen.json` |最后一次收到 QQ 事件包的时间（每分钟最多写一次），桥接停过之后用来发现断档、补收错过的消息；可以随时删 |
| `state/current-role.json` | 当前人格与手动静默：`{ role, mode }`；可选的 `byKey` 按会话单独设置人格卡，值为人格名、外部引用 `provider:id`（如 `soulkit:saren`）或 `null`（这个会话不挂卡），不在里面的会话用全局 `role`。读的时候人格值与会话 key 都重新校验（本地名与 `provider:id` 走 `safeRoleValue`）；建议在控制台「人格与角色 → 按会话设置人格」或 QQ 里 `/role` 改 |
| `state/role-seen.json` |每个会话读到的角色卡版本（只存会话 ID 与指纹，不存内容）；删掉只会让各会话下一次唤醒再收到一次当前角色卡；**重置会话（`/reset`、`/new` 或控制台按钮）与自动压缩都会忘掉该记录**，所以重置之后的下一次唤醒会重新注入一次整张卡，而不是让新上下文裸奔；0600 |
| `state/persona-cache/<provider>/<id>.json` | 外部人格 provider 的卡片正文缓存（本地卡不建此文件）；provider 离线时沿用旧缓存，新版正文在下一次刷新时覆盖；可随时删，代价是离线期间可能取不到卡 |
