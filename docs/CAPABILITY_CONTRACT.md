# 平台能力契约（CAPABILITY_CONTRACT）

> **状态**：设计规格 v1，**S1–S5 已实施**（2026-11-17）；§四 的界面部分按 S6 台账推进。
> 本文回答三个问题：用户平台侧的行为与能力还绑在哪、
> Agent 侧的能力怎么才算通用、以及这两件事做完之后控制台长什么样。
>
> **与既有文档的关系**：
> - [PLATFORM_DECOUPLING.md](PLATFORM_DECOUPLING.md) §3.2 已经写了「入站事件不带上游原始结构，
>   原始放在 `ext.<platform>`、内核不读」，但从未被门禁钉住 —— 本文把那一条**从规格变成断言**（§5.1）。
> - [PLATFORM_UNIFICATION.md](PLATFORM_UNIFICATION.md) 的 C0–C9 与
>   [EXECUTION_BODY_GENERALIZATION.md](EXECUTION_BODY_GENERALIZATION.md) 的 P0–P6 **不推翻**，
>   本文只补它们之后的最后一段：事件正文、动作词表、能力档的意图/渲染分离。
> - [PROFILES_MODEL.md](PROFILES_MODEL.md) 的四轴模型不变；本文只改「工具面」那一轴的**词表**与**落盘位置**。
>
> 最后更新：2026-11-17。

---

## 一、现状核对

### 1.1 已经中立的部分（不要动）

| 层 | 落点 | 现状 |
| --- | --- | --- |
| 地址 / 主键 | `src/session/key.mjs` + `withAddress()` | `platform[@account]:type:id`，开放会话类型、id 字符串化；15 个模块经上下文取地址 |
| 出站 | `src/user-side/outbound.mjs` + `segments.mjs` | 11 种中立段；`degradeSegments` 按 **capabilities 判定**降级，不看平台名；`poke` / `ext` 缺能力直接抛错 |
| 入站入口 | `src/user-side/inbound.mjs` + `event.mjs` | `校验 → 准入 → 会话映射 → 唤醒`，顺序固定；来源由内核给定，插件伪造被覆盖 |
| 平台注册与诊断 | `src/platforms/registry.mjs` | 一张表 + 7 个诊断码（`capability_missing` / `inbound_unsupported` / `active_pending_restart` …） |
| Agent 连接层 | `src/agent-side/runtime.mjs` | `agentRuntime()` 单例 + `RUNTIME_MEMBERS` 成员表，缺任一成员 fail-closed |
| Agent 动作层 | `src/agent-side/port.mjs` | `AgentPort`：5 个核心方法 + 8 组能力位（session / rename / permission / models / settings / workspace / compact / maintenance），未声明即抛 `capability_unsupported` |
| Agent 事件层 | `port.mjs` 的 `AGENT_EVENT_KINDS` | 12 种归一事件（turn-start / text / tool / permission / question / usage / …） |
| 生效方式 | `src/agent-side/runtime-registry.mjs` | `RUNTIME_APPLY`（preset / passthrough）、`RUNTIME_PROMPT`（none / system / prefix / tool）、`PEER_PERMISSIONS` |

**这张表是本次改造的护栏**：下面所有改动都不允许触碰这八行。

### 1.2 用户侧：四处仍在绑定

| # | 现象 | 证据 | 后果 |
| --- | --- | --- | --- |
| U1 | 统一事件只是**入口门卫**，不是数据契约 | `src/bridge.js` 的 `deliver()` 只把 `event.ext?.raw` 交下去 | 校验、准入、建 key 都用了统一事件，一进业务体就退回原始报文 |
| U2 | 通知类事件**绕开**统一管线 | `bot.onNotice('notify', …)` 直接挂在 bridge；`oneBotToUnified()` 只翻译 `message` | 戳一戳、撤回、入退群、改名片全在抽象之外 —— 这正是「仿真 v2 的行为无法统一管理」的根因 |
| U3 | 消息之外的**动作没有中立词表** | `bot.raw('group_poke')`、`bot.request('fetch_custom_face_detail' / 'add_custom_face' / 'set_custom_face_desc' / 'get_group_msg_history')` | 这些是 NapCat 扩展，连 OneBot v11 标准都不是；内核直接持有平台动作 |
| U4 | **工具面就是平台面** | `src/tools/catalog.mjs`：36 个 flag、约 50 个 `qq_*` 工具名，`provider: 'qq'` 写在目录条目里 | 模型看到 36 组 QQ 工具；换平台等于重写工具面 |

另外有一处**规格与实现分叉**：`PLATFORM_DECOUPLING.md` §3.2 要求 `ext.<platform>` 且「内核不读」，
实现是 `ext: { raw }` 且内核大量直读（`raw?.message`、`sender.user_id`、`notice_type`、`sub_type`）。
**这条不需要重新论证，只需要钉住。**

### 1.3 Agent 侧：结构已通用，内容没通用

Agent 侧比用户侧做得好 —— `AgentPort` 是真正的能力位契约。剩下三处：

| # | 现象 | 证据 | 后果 |
| --- | --- | --- | --- |
| A1 | 能力档把**意图**与**DSH 渲染材料**混在一份 yml | `profiles/agent-platforms/dsh/capabilities/chat-v2.yml` 同时有 `tools.platform`（36 个 QQ flag）、`tools.agent`（dsh 模块 id）、`rows`（`@deepseek-ai/dsh-persona` 等插件行）、`preset`（dsh preset 元信息） | 同一份档在 ACP 下**装不了**：`rows` 是 dsh 语法，`tools.agent` 是 dsh 模块名 |
| A2 | Agent 工具表有**两份拷贝** | `src/tools/catalog.mjs` 的 `AGENT_MODULES`（8 项）与 `profiles/agent-platforms/dsh/tools.yml`（8 项）逐条重复；前者 `provider: 'dsh'` 写死 | 加一个工具要改两处；控制台展示的是 src 里那份，与声明面可能漂移 |
| A2b | 平台工具面被**抄了 5 遍** | `capabilities/*.yml` 的 `tools.platform` 36 项在 chat / chat-v2 / readonly / workspace / full 五份里取值完全一致（含 `sendVoice: false` / `ownerGroupAccess: false` / `ownerRelay: false`）；`platformFlags()` 取的是五份的**并集** | 并集 ≈ 那一份，「聊天」与「完全访问」在工具面上没有区别；按会话收紧的 `capabilityAllowsFlag` 因此从未产生过差异 —— 真正管权限的是 `session/permission.mjs` 的四档 |
| A3 | 能力档目录**只有 dsh 一份** | `profiles/agent-platforms/acp/capabilities/` 为空，其 `tools.yml` 是空表并写明「不照抄 dsh 清单」 | 没有第二个消费者，就没有真正的通用性检验；「换执行体」这条路只是理论上通 |

A3 里那句注释说明作者已经看见了问题，只是**没有把它做成词表** —— 本文把它做完。

### 1.4 三处控制台与计费问题（顺带修复）

| # | 现象 | 证据 | 后果 |
| --- | --- | --- | --- |
| U5 | 会话详情返回两个**死字段** | `/profile` 仍返回 `apply: runtimeOf(key).apply` 与 `presets: dshPresetIds.slice()`（注释还写着「页面靠它决定要不要显示预设那几张卡」）；`pages/sessions/page.js` 已无任何读取 | 契约里留着旧模型的名，下一个人会以为它还生效 |
| U6 | 会话详情把执行体专有名词写进字段 | `payload.dsh = getDshHealth(...)`、`detailDshLabel()`；`effectiveModel` 兜底写死 `deepseek-official` / `deepseek-flash` | 换成 ACP 后这几个名字全是错的；会话详情页「认识」某一个平台 |
| U7 | 会话模型**保存依赖实时目录** | PATCH 时 `modelCatalogCache.get()` 失败直接 503 拒存 | 执行体离线 / ACP 未填 command 时会话级模型改不了 —— 与「配置面不依赖对端在线」相反 |
| U8 | 价目表在**启动期固化**且只有一个来源 | `const priceTable = priceTableFromCatalog(declaredAgentCatalog(...))` 是模块级常量，`tokenLedger` 构造时捕获；用户没有任何编辑入口 | 换模型要改平台 yml 再重启；第三方模型无法报价 |
| U9 | 模型卡的选项**只认实时目录** | `fillModelFields()` 只在 `catalog.view.providers` 非空时铺选项，声明面 `declared.models` 完全没用上 | 目录不可用时「提供方 / 模型 / 思考强度」三个控件全灰，而声明面其实有 5 个模型与 7 个档位 |

这五条的修法在 §八。它们与主线（事件 / 动作 / 工具面 / 能力档）**互不依赖**，可以独立交付。

U5 / U6 / U7 已随 S7 修完（读口与写口见 §8.1 的落地口径）；U8 已随 S8 修完（读口与写口见 §8.2）；U9 归 S9。

---

## 二、参照实现

### 2.1 AstrBot（本机源码，18 个平台目录）

1. **`Platform` ABC + `PlatformMetadata` 声明面**：`support_streaming_message`、`support_proactive_message`、
   `default_config_tmpl`、`config_metadata`（驱动 WebUI 表单）、`logo_path`、`i18n_resources`。
2. **统一消息组件**：`ComponentType` 里的 `Poke` / `Face` / `Shake` 是**组件**而非平台开关 ——
   QQ 的戳一戳进站即被翻成 `Poke(id=target)`，平台无关地进了消息链。
3. **差异 = 基类默认实现 + 子类重写**：

```python
async def react(self, emoji: str) -> None:
    """默认实现为发送一条包含该表情的消息。如需原生反应，请在子类重写。"""
    await self.send(MessageChain([Plain(emoji)]))

async def send_typing(self): ...      # 默认空
async def get_group(self, ...): ...   # 默认用入站数据，子类可换成 API 查询
```

   没重写 = 有确定降级；重写 = 原生。**代价**：内核事先不知道这个平台能不能 react，只能调用后看结果。

### 2.2 OpenClaw（25+ 渠道）

1. **`ChannelPlugin` = 必选 4 项 + 十几个可选 adapter**：必选 `id` / `meta` / `capabilities` / `config`；
   可选 `outbound` / `messaging` / `actions` / `threading` / `heartbeat` / `streaming` / `allowlist` / `status` / `gateway` ……
2. **`capabilities` 是纯声明式布尔量**：`chatTypes` / `polls` / `reactions` / `edit` / `threads` / `media` / `nativeCommands` / `blockStreaming`。
3. **出站格式差异也声明化**：`textChunkLimit`（Telegram 4096 / Slack 40000 / Discord 2000）、`chunker`、`sanitizeText`。
4. **模型只看到一个 `message` 工具**：渠道不实现 send/edit/react 工具，只通过 `describeMessageTool`
   声明**动作子集**（`["send","edit","react","poll","reply","pin","sticker"]`）与 schema 片段；
   59 个动作名统一收在 `message-action-names.ts`。
5. **注册分三级**：`cli-metadata`（只读 package.json，不加载 JS）/ `discovery`（拿 capabilities，不建连接）/ `full`。

### 2.3 三者对比

| 维度 | 当前 nexus | AstrBot | OpenClaw |
| --- | --- | --- | --- |
| 差异表达 | 能力清单 + 段降级（最严） | 基类默认实现 + 子类重写 | 必选 capabilities + 可选 adapter 矩阵 |
| 入站正文 | 原始报文（未中立） | 统一组件链 | 统一 `MsgContext` |
| 通知类事件 | 绕开管线 | 组件化（`Poke`） | 独立事件 + 渠道 adapter |
| 动作面 | 无（内核直连 `bot`） | 事件方法（`react` / `get_group` / …） | 59 个 action 名 + `describeMessageTool` |
| 工具面 | 36 个 `qq_*` | 插件自行注册 | **单一 `message` 工具** |
| 缺能力时 | **抛错（fail-closed）** | 默认降级 | 核心跳过 adapter |
| 注册发现 | 静态注册表 | 装饰器 + 热重载清理 | 三级（元数据 / 发现 / 完整） |

**三者的共识只有三条，正好是 nexus 缺的：**

1. 统一的是**动作词表**，不是行为；
2. 差异用**能力声明**表达，缺能力必须有确定的降级或明确的报错；
3. **模型只看到一个入口**，平台差异落在参数与可用动作上。

### 2.4 为什么不全盘照抄

OpenClaw 的抽象复杂度是被 25 个渠道摊薄的，AstrBot 的是被 18 个平台目录摊薄的。
nexus 只有 1 个真实用户平台 + 2 个 Agent 执行体（dsh / acp）。抽象层数超过实现数量时，
用户学到的复杂度全是净成本 —— 与「界面不要过于复杂」直接冲突。

**结论：取三条共识，不取接口矩阵。**

---

## 三、契约设计

### 3.1 统一事件补通知类（用户侧）

在 `src/user-side/event.mjs` 的形状上补两个字段（`actor` / `notice`），其余不变：

```js
{
  v: 1,
  id: 'evt_17',
  time: 1763337600000,
  platform: 'qq', account: '',
  kind: 'notice',
  type: 'notice.poke',
  conversation: { type: 'group', id: '20001' },
  actor: { id: '30001', name: '群名片' },        // 谁做的
  notice: {
    type: 'poke' | 'recall' | 'reaction' | 'member.join' | 'member.leave' | 'member.card',
    target: { id: '30002' },                    // 作用于谁
    ref: { messageId: '123' },                  // 撤回/反应指向的消息
    detail: { subType: 'invite' },              // 归一后的细节
  },
  ext: { qq: { ... } },                          // 逃生舱：内核零读取
}
```

三条约束：

| 约束 | 说明 |
| --- | --- |
| `EVENT_KINDS` 不变 | 仍是 `message / notice / request / meta / agent`；新增的是 `notice.type` 的取值域 |
| `notice.type` 是闭集 | 平台特有的通知要么映射到已有类型，要么**不进**统一事件（留在 `ext`），不允许在 `type` 里自由发挥 |
| `ext` 只写不读 | `ext.<platform>` 由适配器写；`src/` 内零读取由门禁钉住（§5.1） |

**四个字段的分工**（全部由 `validateUnifiedEvent` 钉住，适配器不能自选）：

| 字段 | 语义 | 必需性 |
| --- | --- | --- |
| `actor` | **谁做的**：拍人的、撤回的、批准/踢人的 | `poke` / `reaction` 必需；`member.*` / `recall` 可缺（系统自动处理时没有操作者） |
| `notice.target.id` | **作用于谁**：被拍的人、进群/退群/改名片的人、被撤回消息的作者 | 除 `reaction` 外都应给 |
| `notice.ref.messageId` | 撤回 / 反应指向的那条消息 | 只有 `recall` / `reaction` 用 |
| `notice.detail` | 归一后的细节包：`subType` / `selfInvolved` / `cardNew` / `cardOld` / `poke.action`… | 可空；内核**不解释**其中任何键 |

`selfInvolved` 由适配器算（只有它知道本账号是哪个 id），内核不再拿 `self_id` 做比较 ——
这是「平台的 id 不出适配器」的最小可执行形式。

配套改动：

1. QQ 适配器新增 `noticeToUnified()`，`connectOneBot` 用 `client.onNotice(handler)` 订阅 ——
   通知与消息共用一个出口，老 SDK 没有不带类型的 `onNotice` 时把缺失写进入站 detail；
2. `notice_type` → 中立词的映射表只存在适配器；业务层的 `normalizeMemberNotice()` 换成读统一事件的
   `memberEventFromNotice()`（当事人 / 操作者 / 撤回指向分别从 `target` / `actor` / `ref` 取）；
3. `bridge.js` 删掉 `bot.onNotice('notify', handlePokeNotice)` 与四个成员事件挂载，
   `deliver()` 按 `event.kind` 分派；
4. `handlePokeNotice()` 删掉重复的 `passiveAllowed()`：准入判据只剩管线里那一份。

### 3.2 动作词表（用户侧）

新增 `src/user-side/actions.mjs`，与 `segments.mjs` 平级。**这是本文最核心的一张表**（13 项）：

| 动作 | risk | 作用域 | 缺能力时 | 说明 |
| --- | --- | --- | --- | --- |
| `message.send` | send | 会话 | — | 正文发送，必选能力 |
| `message.reply` | send | 会话 | 降级为 `message.send` | 引用回复 |
| `message.recall` | send | 会话 | 抛错 | 撤回 |
| `message.forward` | send | 会话 | 抛错 | 合并转发 |
| `reaction.add` | send | 会话 | **降级为 `message.send`（发一条表情消息）** | 学 AstrBot 的 `react()` 默认实现 |
| `poke.send` | send | 会话 | 抛错 | 与现有段降级口径一致：拍一拍不能降成文本 |
| `message.get` | read | 账号 | 抛错 | 按 id 取单条消息（引用原文解析、消息详情）；回执是统一事件 |
| `history.get` | read | 会话 | 抛错 | 历史消息（回执是统一事件数组，补收直接消费） |
| `forward.get` | read | 账号 | 抛错 | 合并转发正文（按 id 取，不属于某个会话） |
| `member.list` | read | 会话 | 抛错 | 成员列表 |
| `member.get` | read | 会话 | 抛错 | 成员详情 |
| `sticker.list` | read | 账号 | 抛错 | 收藏表情 |
| `sticker.save` | state | 账号 | 抛错 | 收藏表情写入 |

「作用域」决定 `params.conversation` 是否必填：`会话` 的动作不给完整地址（`type` 与 `id`）
内核直接抛错，不猜一个会话发出去；`账号` 的动作按平台对象寻址，原样传参。

平台侧声明（`adapters/qq/index.mjs`）：

```js
export const actions = Object.freeze([...]);                     // 敢接的中立动作，没列的一律视为做不到
export const actionHandler = async ({ name, params }) => { ... };  // 内部才允许 bot.raw / NapCat 私有动作
```

内核只调 `callAction(name, params)`：声明了就直接交给适配器，没声明按上表降级或抛
`capability_unsupported`（错误带 `name` 与 `platform`，排障时不用猜是哪一侧没配）。
**`bot.raw` / `bot.request` 只允许出现在 `adapters/*` 内**，由门禁钉住（§5.2）。

落地口径（QQ，9 项声明）：

- `message.reply` / `reaction.add` 不单独声明 —— 它们的入参与 `message.send` 同形，
  降级即「换个名字重走一遍」，不写死代码；
- `message.recall` / `message.forward` 不声明且当前无调用方 —— 缺能力时调用方拿到
  `capability_unsupported`，而不是一个静默成功的空结果；
- `message.get` 与 `history.get` 交回的是**统一事件**（过 `validateUnifiedEvent`）：
  引用解析、补收与实时入站读同一套字段，内核不解析 `get_msg` 回执；
- `sticker.save` 一个动作承载两种写：传 `stickerId` 只改备注，传 `bytes` 收藏新表情（可带备注）；
  NapCat 与 SnowLuma 的差异（base64 还是本地路径、回执里有没有 `emoji_id`）全部收在适配器内；
- `probeBackend()` 取代原来的 `readBackendInfo(data)`：「怎么问 get_version_info、回执算什么」
  收进适配器，桥接只拿 `{ name, version }` 用于显示，「是不是 NapCat」记在连接持有处（换连接即失效）。

`sticker.list` / `sticker.save` 背后是 NapCat 的 `fetch_custom_face_detail` / `add_custom_face` 系列 ——
它们从此只存在于 QQ 适配器，别的平台不声明就等于不存在。**这是「适配器变厚、内核变薄」的正确方向**：
平台私有的东西回到平台目录里，而不是留在 1MB 的 bridge.js。

### 3.3 工具面收敛（用户侧）

现有 37 个 flag / 50 个工具名收敛成 **8 个中立工具**，`qq_*` 全部降为别名（`catalog.mjs` 的 `names` 天生支持）：

| 中立工具 | 覆盖现有 flag | 说明 |
| --- | --- | --- |
| `read_messages` | getUnread / getRecent / getMyRecent / getMessageDetail / getImages / getForwardMsg / waitMessages | 读消息（含分页与等待） |
| `get_member` | getActiveMembers / personProfile | 成员与人物档案 |
| `send` | sendGroup / sendPrivate / reply / sendBurst / sendMessage / sendSticker / sendVoice / webImage | 发送（段数组入参） |
| `act` | sendPoke / collectSticker / setStickerRemark / stickerNote / listStickers / getStickerImage | **动作**，参数里带 `op` 动作名 |
| `conversation_state` | status / socialState / markRead / setWakeConfig | 会话状态与收尾 |
| `memory` | memory（6 个） | 本机轻量记忆 |
| `slang` | slangQuery / slangSubmit | 黑话 |
| `admin` | feedback / crossGroup / ownerGroupAccess / ownerRelay / schedule / getPrompt / getSelfImage | 管理端动作（保持 `admin` risk） |

工具描述由**当前平台声明的能力**动态生成（`describeToolGroups(declared)`），例如：

> 本平台支持：文本、@、引用、图片、语音、合并转发、收藏表情、拍一拍。不支持：线程、原生表情反应。

| 层 | 住哪 | 作用 |
| --- | --- | --- |
| `TOOL_GROUPS`（8 组） | `src/tools/catalog.mjs` | 模型看到的词表；模块加载期由 flag 推出 `ops` / `names` / 取最高档 `risk`，引用不存在的 flag 直接抛错 |
| `PLATFORM_TOOLS`（flag） | 同上 + `profiles/platforms/<id>/tools.yml` | 登记、权限与 `defaultOff` 的判定单位 |

`op` 名不是另起的：它就是宿主名去掉 `qq_` 前缀（`qq_send_message` → `send_message`），由 `opNamesOf()` 一处推出、两处消费（mcp 的 `op.enum` 与桥接的「可用 op」）。

登记项 37 个：`requestMode`（`qq_request_mode_change`）是零引用的死声明，已在 S4 删；`status`（`qq_status`）一直在 mcp 里注册却不在目录，T-050b 把它补进来（于是它终于能受平台声明与会话权限控制）。`qq_*` 名字不再是对外词表，但仍有两处用途：`catalogEntry()` 的旧名反查，以及未声明时的报错文案。

模型可见面的最后一步（MCP 逐条注册 → 8 组 facade）已于 2026-11-17 完成（T-050b）：进程内 `tools/list` 只出 8 个名字，组内 50 个 op 走 `op` 参数，提示词里点名的地方全部改成「组（op=x）」，并有常驻用例对照注册面校验。

facade 的 `inputSchema` 只能是 `z.object`：MCP SDK 1.32 的 `tools/list` 会把非 ZodObject（如 `z.discriminatedUnion`）静默降成空 schema，模型连参数名都看不到。所以组内参数取并集、互斥关系由运行期的 `required` 表校验。

### 3.4 Agent 侧：能力位已有，缺的是「效果词表」

Agent 侧**不需要**新建动作层 —— `AgentPort` 的 8 组能力位已经是正确形态。要改的是能力档的组成。

#### 3.4.1 拆分「意图」与「渲染」

| 层 | 现在住哪 | 改后住哪 | 内容 |
| --- | --- | --- | --- |
| 意图 | `capabilities/<id>.yml`（与渲染混在一起） | `capabilities/<id>.yml` | 用哪些**效果**、四轴 runtime 声明、行为档案、扩展授权 |
| 渲染 | 同上一份 yml 的 `rows` / `preset` / `tools.agent` | `agent-platforms/<id>/render.yml` + `adapters/render.mjs` | 效果 → 插件行 / 行序 / 权限档 / 人格文案的映射 |

改后一份能力档长这样（只剩意图）：

```yaml
version: 1
id: chat-v2
label: 聊天 Agent
note: 无本地工具，只做对话与问答
behavior: social-v1           # 绑哪份行为档案（由用户平台提供）
effects:                      # Agent 侧效果（中立名，见 §3.4.2）
  web.access: true            # 值不是布尔量时，是渲染层里的变体名
  user.ask: true
  todo.manage: true
runtime:
  apply: preset
  prompt: prefix
  peerPermission: ''          # 空 = 不碰，用执行体自己的默认权限档
audience: access
mcp: { allow: ['*'], tools: { allow: ['*'], deny: [] } }
skills: { allow: ['*'] }
```

落地时**没有** `actions` 段：用户侧动作仍由平台声明（`profiles/platforms/<id>/tools.yml`）
与会话权限级别决定，能力档只回答 Agent 侧「要什么效果」—— 写进来就是第二份平台面
（偏差见台账 §3 T-063）。

#### 3.4.2 效果词表

| 效果 | risk | DSH 的渲染 | ACP 的渲染 |
| --- | --- | --- | --- |
| `fs.read` | read | `@deepseek-ai/dsh-tool-fs`（只读） | 对端自带工具，桥接不渲染 |
| `fs.write` | write | `@deepseek-ai/dsh-tool-fs` | 同上 |
| `fs.search` | read | `@deepseek-ai/dsh-tool-fs-search` | 同上 |
| `shell.exec` | exec | `@deepseek-ai/dsh-tool-pwsh` | 同上 |
| `jobs.manage` | exec | `@deepseek-ai/dsh-tool-jobs` | 同上 |
| `web.access` | read | `@deepseek-ai/dsh-tool-web`（search/fetch 由 MCP 接管时置 false） | 同上 |
| `user.ask` | read | `@deepseek-ai/dsh-tool-ask-user` | 同上 |
| `todo.manage` | read | `@deepseek-ai/dsh-tool-todo` | 同上 |
| `approval.gate` | admin | `qq-agent-presets/qq-tool-restrict.mjs` | `session/request_permission` 审批 |

`profiles/agent-platforms/<id>/tools.yml` 的每一项带一个 `effects` 数组（一个模块可以承担多个效果：
`tool-fs` 同时是 `fs.read` 与 `fs.write`）。能力档只写效果名，不写模块名。
ACP 的 `tools.yml` 保持空表 —— 它是「不渲染任何行」的**正确事实**，不是漏写。

#### 3.4.3 渲染是编译，不是手写

DSH 的 `adapters/build.mjs` 改为：**读意图 → 查本平台 `render.yml` → 产出 preset 行**。
现在的 `rows` 段从能力档里消失，变成 `render.yml` 的 `effects` 段（每个效果一段行模板；
能力档里写的是变体名：`true` 取 `default`，字符串取同名变体，如 `web.access: mcp`）。
效果在当前执行体上不支持时，构建期产出两条结论：

- 装得上的照装；
- 装不上的进 `passthrough_degraded` 同类审计（与现有 `runtime.prompt: system` 降级同口径），
  并在控制台的能力档页直接写「这台执行体不提供 `shell.exec`，此项已被忽略」，**不静默失真**。

#### 3.4.4 工具目录去重

`src/tools/catalog.mjs` 的 `AGENT_MODULES` **删除**，改为读活动执行体的 `tools.yml`；
`provider: 'dsh'` 改为 `provider: activeAgentPlatformId()`。
`catalogFromAdapters()` 已经在做这件事，只是没人调用 —— 接到 `toolCatalogSnapshot()` 里即可。

#### 3.4.5 减法：五件事里两件该砍、一件该移

先定能力档**该独占**什么，再谈怎么拆。逐件称重：

| 现在装的东西 | 行数 | 谁在读 | 处置 |
| --- | --- | --- | --- |
| `tools.platform`（36 flag） | 36 × 5 份 | `platformFlags()` 取并集决定全局注册；`capabilityAllowsFlag` 按会话收紧 | **移出**：注册面属于平台声明，进 `profiles/platforms/qq/tools.yml`（`defaultOff` 表达「有此能力但不默认注册」） |
| `tools.agent`（dsh 模块名） | 3–8 | `agentModulesOf()` 恒返回 `[]`（注释已写「历史字段，已不再由能力决定」） | **删**：死字段，留着只会误导 |
| `preset.name` / `description` / `order` | 3 | DSH `adapters/build.mjs`、`presets/store.mjs` | **移**：DSH 预设元信息，进 `render.yml` |
| `preset.behavior` | 1 | 行为档案解析 | 留（中立：`social-v1` / `social-v2`） |
| `rows`（cordis 行列表） | 75 | DSH `adapters/build.mjs` 直接渲染 | **移**：平台语法，进 `render.yml` |
| `runtime` / `audience` / `behavior` / `mcp` / `skills` | 10 | 会话装配、受众门控、Hub 授权 | **留** —— 这才是能力档存在的唯一理由 |

为什么 `tools.platform` 是砍而**不是搬家**：五份出厂档的这一段逐项相同（§1.3 A2b），
说明它从未被用来区分档位；`capabilityAllowsFlag` 因此从未拒绝过任何一次调用（权限由
`session/permission.mjs` 的四档 + `LEVEL_ALLOWS` 负责，那份文件开头就写明「不依赖能力档」）。
它的实际语义只是「全局注册哪 36 个工具」的一张静态表 —— 属于平台目录：
平台声明自己能提供什么，内核全量注册，用户要收窄用会话权限级别与行为档案的 `narrow`。

改后一份能力档约 25 行：

```yaml
version: 1
id: chat-v2
label: 聊天 Agent
note: 无本地工具，只做对话与问答
behavior: social-v1
audience: access
effects: { web.access: true, user.ask: true, todo.manage: true }
runtime: { apply: preset, prompt: prefix, peerPermission: '' }
mcp: { allow: ['*'], tools: { allow: ['*'], deny: [] } }
skills: { allow: ['*'] }
```

控制台打开就是一张基本信息卡 + 四张结论表（§4.4），不再是 44 行开关墙。

> **与 [AGENT_PLATFORM_EVOLUTION.md](AGENT_PLATFORM_EVOLUTION.md) §三 的关系**：那一节把「中立 Agent IR」
> 判为**暂缓**，触发条件是「真要接第二个 Agent 平台（不是 PoC）」。ACP 在 C6 落地后该条件已经满足，
> 本文 §3.4 正是按它 §3.5 的步骤走的 —— **这不是新提案，是那份规划到期**。
> 另外：`profiles/agent-platforms/dsh/templates/rows.yml` 是**死文件**（注释指向已删除的
> `src/capabilities/build.mjs` 与 `build-capability-artifacts.mjs`），已在 S5/T-068 连同
> `templates/` 目录一起删除 —— 渲染材料直接进 `render.yml` + `adapters/`，不要再加一层模板目录。

---

## 四、界面

### 4.1 导航：管理 / 聊天行为 / 扩展

现状 14 个一级项、3 组，全部平铺（不再有折叠分组）：

| 组 | 页面 |
| --- | --- |
| **管理** | 运行总览 / 会话与审批 / 全局配置 / 平台配置 / 调试与运维 |
| **聊天行为** | 注入块 / 人格与角色 / 记忆 / 黑话词库 / 定时任务 |
| **扩展** | 插件 / 技能 / MCP / 命令 |

`consolePages` 的元数据表不变（标题 / 大标题 / 说明三件），只是 `#mainNav` 的 `nav-label` 分组调整 ——
`consolePageGroups` 从 DOM 推导，改分组不需要动路由代码。分组里没有可折叠容器，所以路由不再有
「选中项所在组自动展开」这一步；窄屏导航把 14 项平铺成一条横向滚动条。

### 4.2 平台详情页（用户侧）

现状：`概览 / 配置 / 话术与工具 / 行为` 四个标签，「概览」里是属性表 + 实例 + 资产 + 诊断。

改后：

```
← 平台配置
QQ   [默认实例]  [能收] [能发]  [入站已接管]
能收能发。支持 @、引用、图片、语音、合并转发、收藏表情、拍一拍；不支持线程与原生表情反应。
                                                    ↑ 这一句由声明自动生成，不可编辑

[概览]  [配置]  [能力]  [话术与行为]
```

| 标签 | 内容 | 与现状的差别 |
| --- | --- | --- |
| 概览 | 运行状态键值网格（实例、入站、默认实例、探活结论）+ 资产小卡 + 诊断表（仅 error） | 从「概览」抽出，只放**会变的东西**；整页一张大卡（页头、结论句、标签条与面板都在卡里），卡内按分区排，短字段走键值网格，计数是一张小卡一个数字 |
| 配置 | 配置表单（按 `configSchema`）+ 模型卡 | 「配置」单独一页，不再和其它内容挤在一起 |
| 能力 | 结论句 + 注册表下发的分组清单（发送能力 / 接收能力 / 不支持的消息段 / 平台工具），每项一枚「名字 + id」药丸；末尾是原始声明（普通下拉，默认折叠） | 新增；替代现在的 `capabilities` 标签串与把能力位摊成表格的做法 |
| 话术与行为 | 平台提示词卡 + 行为档案 | 「话术」与「行为」合成一页 |

能力标签**不给勾选框** —— 能力来自平台声明，用户改不了。这是「不要过于复杂」的关键：
把「能做什么」从**可编辑的矩阵**降级为**只读的结论**。

### 4.3 平台详情页（Agent 侧）

现状：`概览 / 能力 / 配置`，「概览」里有一张 **能力位矩阵**（能力位 / 应用方式 / 提示注入通道 / 对端权限档 / 能钉权限）。

改后：

```
← 平台配置
DSH  [默认执行体]  [已连接]
能装预设或直通；话术走首轮前缀；对端权限档可钉 4 档；提供联网、提问、任务清单三类效果。

[概览]  [配置]  [能力]
```

| 标签 | 内容 |
| --- | --- |
| 概览 | 键值网格（端点、鉴权、探活、默认执行体）+ 资产小卡 + 诊断表 |
| 配置 | 配置表单（含模型目录卡） |
| 能力 | 四组结论式清单（生效方式 / 提示注入 / 效果 / 对端权限档）+ 原始声明（普通下拉，默认折叠，含完整矩阵表） |

**矩阵表不删，但降级到「能力 › 原始声明」** —— 排查时要看得到，日常不该被它的五列占据视线。

### 4.4 能力档编辑器

现状（`capability-panel`）：一张 44 行的表（36 平台工具 + 8 Agent 模块），带类型筛选与搜索；
Agent 模块列只读展示。

改后：**一张基本信息卡 + 四张结论表**，可勾的只剩「扩展授权」两处（MCP 工具、技能）。

```
能力档 chat-v2
  基本信息    名称 / 备注可改；受众与生效方式由运行时读，卡头一句话写明
  效果        web.access → tool-web（可装）   user.ask → tool-ask-user（可装）   执行命令 ✗（本档没要）
  执行体工具面  8 个模块（来自 dsh/tools.yml），只读，可搜索
  MCP 服务器   勾选即写入 mcp.allow
  MCP 工具     只列已允许服务器的工具；取消勾选 = 把该服务器收窄到具体工具
  技能        勾选即写入 skills.allow
```

三点设计取舍：

1. **效果表只读、且写出「谁承担」**：模型看的是效果，用户看的是「这一行由哪个模块兑现、这台执行体装不装得上」。
   装不上的效果进 `passthrough_degraded` 审计，界面上直接写「这台执行体不提供 X，此项已被忽略」，不静默失真。
2. **执行体工具面只读**：模块清单归执行体，能力档里不再勾选；会话能用到哪一档由权限级别收紧（§4.5）。
3. **不再有 44 行表**：能力档是「跨平台可移植的一份意图」，不该长得像某个平台的开关墙。

### 4.5 会话页

「运行」卡与平台声明面（「平台 › 该 Agent 平台 › 能力」里的一句话结论 + 只读分组）的分工在这里定：会话只管它能改的，声明面归平台页。具体形状见 §8.1（10 块 → 3 张常驻卡 + 2 张折叠卡，删两个死字段；执行体那张已删）。此外增加一张折叠卡：

```
这个会话能用的工具（26）  ⌄
  来自 平台声明（QQ） ∩ 权限「只读」；能力档 chat-v2 决定注入方式与沙箱
  读消息   未读消息  最近消息  …               —
  发消息   群消息  私聊消息  引用回复  …       网图（平台声明里默认关闭）
  管理端   —                                   定时任务（权限「只读」不含管理类工具）
```

这张卡是**求交结果**，不是目录抄本 —— 用户点一次就知道「为什么我刚才让 AI 发表情它没发」。

参与求交的只有两个输入，因为工具面归平台声明（§4.2 的 `tools.yml`），能力档在 S5 之后只写意图：

| 输入 | 作用 | 判定 |
| --- | --- | --- |
| 平台声明 `profiles/platforms/<id>/tools.yml` | 这个平台注册了哪些 flag | 没声明 = 用不了；`defaultOff` = 默认关闭 |
| 会话权限级别 | 这一级还允许哪类风险 | `LEVEL_ALLOWS[level]` 不含该风险 = 用不了 |

行首那一组与模型看到的 8 个中立工具同构（`TOOL_GROUPS`），组内再分「能用 / 用不了」，用不了的原因写在 `title` 上。判定只在 `src/session/tools.mjs` 一份：`/api/sessions/<key>/profile` 的 `tools` 字段、控制台夹具与页面展示都读它。

### 4.6 页面改造的验收口径

| 页 | 验收 |
| --- | --- |
| 导航 | `test-console-static` 的分组快照更新；深链 `#platforms/qq/capabilities` 仍可用 |
| 平台详情（两侧） | 三个 tab 的 DOM 快照；「一句话结论」由接口下发而非前端拼字符串 |
| 能力档编辑器 | 效果表的「可装 / 装不出」与构建期 `degraded` 同源（同一份 `tools.yml` 声明）；执行体工具面按 `tools.yml` 行数校验 |
| 会话页 | 工具卡内容 = 平台声明 ∩ 权限级别，由 `src/session/tools.mjs` 一份判定算出；页面不复算 |
| 浏览器回归 | `test-console-ui` 零 pageerror（历史上一次标签函数缺参就表现为整块空白） |

---

## 五、批次与门禁

### 5.1 先加两条门禁（S0）

在 `scripts/verify-adaptation.mjs` 已有的词法扫描器上加两条断言：

| 断言 | 范围 | 为什么 |
| --- | --- | --- |
| `ext.raw` / `.ext?.raw` 的读取次数 = **0** | `src/` 全量，排除 `src/user-side/adapters/**` | 把 PLATFORM_DECOUPLING §3.2 从规格变成不变量 |
| `bot.raw(` / `bot.request(` / `bot.send*` 出现次数 = **0** | `src/` 全量，排除 `src/user-side/adapters/**` | 内核不得持有任何 OneBot / NapCat 词汇 |

**先加断言、后改代码**：断言先红，改完转绿，这是本轮唯一允许「先红后绿」的顺序 ——
否则没人知道旧代码到底有几处。

实测基线：门禁 1 **1 处**、门禁 2 **21 处**（逐条清单在台账 `_internal/CAPABILITY_CONTRACT_LEDGER.md` §2.14）。
S2 完成后门禁 2 已 **0 处**；S3b 完成后门禁 1 也已 **0 处**（`verify:adaptation` 102 通过 0 失败）。

### 5.2 批次

| 批 | 内容 | 改动面 | 验收 |
| --- | --- | --- | --- |
| **S0** | 两条门禁落地（先红） | `verify-adaptation.mjs` | 断言列出全部违规点，作为 S1–S3 的清单 |
| **S1** | 通知事件中立化：`event.mjs` 补 `actor` / `notice`；QQ 适配器补 `notice.*` 翻译；删 `bot.onNotice` 挂载 | event.mjs + adapters/qq/inbound.mjs + bridge.js 一处 | `test-unified-inbound` 增 4 个 notice 用例；戳一戳走通管线且能唤醒 |
| **S2** | 动作词表：`actions.mjs`（当时 12 项，S3b 补入 `message.get` 成 13 项）+ QQ 适配器 actions + bridge 21 处直连改 `callAction` | 新文件 + adapters/qq/actions.mjs + bridge.js | 拍一拍 / 收藏表情 / 转发 / 历史各一条回归；门禁 2 转绿 |
| **S3a** | 统一事件补齐 `handleIncoming` 下游真正在读的每个字段，**双写**（内核仍读 raw）；加断言：raw 的每个被读字段都能从统一事件同值取到 | bridge.js | 断言列出字段对照，全绿才进 S3b |
| **S3b** | 切读统一事件、删掉 raw 读取；`message.get` / `history.get` 回执也过校验器 | bridge.js（最大一批） | 门禁 1 转绿；`test:audit` 132/132 |
| **S4** | 工具面收敛：8 个中立工具 + `qq_*` 别名；能力档删平台白名单 | catalog.mjs + capabilities/store.mjs + bridge.js + mcp 脚本 + capability-panel + 10 份能力档 yml | `test-tool-catalog` 改断言（37 个 flag → 8 组）；旧 `qq_*` 名字仍可解析；`platformFlags()` 改读平台声明；契约重录后 `test:console-ui` 45/45 |
| **S5** | Agent 侧：能力档拆意图/渲染；`tools.yml` 加 `effects`；新增 `dsh/render.yml` + `adapters/render.mjs`；删 `AGENT_MODULES` 与 `templates/rows.yml` | 6 份能力档（5 份 dsh + 共用 `direct`）+ dsh 适配器 + catalog | `check-profiles` 自检；5 份 patch 的正文逐字节不变（只改写生成器在文件头那句来源说明，见台账 §1.2） |
| **S6** | 界面：导航分组、平台详情三段、能力档编辑器、会话工具卡 | `public/console/` | §4.6 五条 |
| **S7** | 会话详情重设计（§8.1） | `pages/sessions/page.js` + `bridge.js` 的 `/profile` | 10 块 → 3 张常驻卡 + 2 张折叠卡（执行体那张已删：声明面只在平台 › 能力）；`presets` / `apply` 删除；`dsh` → `health`；目录不可用时模型可存（回 warning） |
| **S8** | 价目表按默认模型匹配 + state 化（§8.2） | 新增 `src/pricing/store.mjs` + `bridge.js` + `components/pricing-panel` + `pages/config` | 只为全局默认模型匹配；本地覆盖生效且热刷新；删本地层回落声明；历史金额随表重算 |
| **S9** | 模型目录降级（§8.3） | `components/agent-model/agent-model.js`（平台详情与全局配置共用）+ Agent 平台写口 | 有声明面、无 live：模型与档位可选、保存回 warning 而非 400；无声明面（如 ACP）：保留原值、保存不报错 |

S7–S9 与 S1–S6 **互相独立**（S7 读能力档的 `apply`/`audience`，但不改它），可以先做 S7–S9 再回头做主线；若先做主线，S7 的字段调整要等 S5 定稿。

**S5 的关键断言**：改造前后，`artifacts/dsh/qq-agent-presets/presets/chat-v2.patch.yml` **内容不变**。
如果变了，说明渲染层拆分动到了语义，必须回退重做。
实测（2026-11-17）：5 份 patch 的行数与正文逐字节一致，唯一差异是文件头第 2 行的来源说明
（-20 字节/份）；剔除该行后 sha256 与基线完全相同。

### 5.3 验收指标

| 指标 | 现在 | 目标 |
| --- | --- | --- |
| 换一个用户平台需要改内核的点 | 9 处直连 + `handleIncoming` 整个函数 + 工具表 | **0** |
| `src/` 内 OneBot 词汇出现次数 | 15（3×`bot.raw` + 10×`bot.request` + 2×`bot.send*`） | **0**（排除 adapters） |
| 模型可见的工具组数 | 36 | **8**（2026-11-17 目录层与 MCP `tools/list` 都是 8） |
| 能力档里的平台专属字段 | `rows` / `preset` / `tools.agent` | **0**（全在 `render.yml`） |
| 5 份能力档总行数 | ≈ 770 | **≈ 115**（实测：dsh 5 份 98 行 + 共用直通 17 行） |
| `tools.platform` 的重复份数 | 5（逐项相同） | **0**（2026-11-17 已达成：注册面只读平台声明） |
| 会话详情死字段 | 2（`presets` / `apply`） | **0** |
| 价目表可否自定义 | 否（改平台 yml + 重启） | **是**（`state/pricing/`，热生效；只改单价，峰谷跟随声明面） |
| 目录不可用时可编辑的模型控件（有声明清单时） | 1 / 4（仅看图） | **3 / 4**（模型 / 档位 / 看图） |
| `bridge.js` 行数 | 18 531 | **净减少** |

最后一条是方向校验：**如果改完 bridge.js 变长了，说明抽象又做错了。**

---

## 六、明确不做

1. **不把「要不要戳」下放到平台层。** 平台只回答「能不能戳」，永不回答「该不该戳」。后者属于行为档案与人格；
   按平台分叉行为，才是真正的绑定。
2. **不为没有第二个实现的平台预留抽象。** OpenClaw 的十几个可选 adapter 是为 25 个渠道付的账。
3. **不放弃 fail-closed。** 缺能力时抛错，比 AstrBot 的静默降级与 OpenClaw 的静默跳过更贵但更安全 ——
   行为层承诺「不静默失真」，这一条不松。
4. **不做「能力矩阵可视化编辑器」。** 能力不是用户可配置项。
5. **不合并两侧契约。** 用户侧是「连接 + 消息 + 社交」，Agent 侧是「会话 + 提示 + 权限」，
   合并会得到谁都不好用的大接口（沿用 PLATFORM_UNIFICATION §十 的结论）。
6. **不改调度、记忆、权限判定、唤醒判据。** 本文只动边界与界面。

---

## 七、与既有规格的衔接

| 既有文档 | 本文的关系 |
| --- | --- |
| PLATFORM_DECOUPLING §3.2 / §3.3 | §3.2 的「`ext` 内核不读」由 §5.1 门禁执行；§3.3 的事件形状补 `actor` / `notice` |
| PLATFORM_DECOUPLING §3.4 段表 | 不新增段类型；`poke` / `sticker` 仍按原规则降级或抛错 |
| PLATFORM_UNIFICATION §六（用户侧三个缺口） | 三个缺口已修；本文接着修「正文与动作」两个新缺口 |
| EXECUTION_BODY_GENERALIZATION §能力档四轴 | 四轴不变；本文把「工具面」那一轴的词表改成 `effects`（用户侧动作词表仍在 `src/user-side/actions.mjs`），并把渲染材料移出能力档 |
| PROFILES_MODEL §存储分层 | 新增 `agent-platforms/<id>/render.yml` 一份**渲染层**资产；能力档目录结构与出厂副本契约不变 |
| AGENT_PLATFORM_EVOLUTION §三（P2 中立 IR，暂缓） | 触发条件已由 C6（ACP 落地）满足；本文 §3.4 按那份文档 §3.5 的步骤实施，不新建 `agents/` 目录；`templates/rows.yml`（死文件）已在 S5 删除，不复活 |
| CONSOLE.md | 本文 §四 是界面改造的规格，实施后 CONSOLE.md 的组件与页面章节按事实改写 |

---

## 八、三处顺带修复

### 8.1 会话详情（会话管理弹窗）重设计

**为什么重做而不是打补丁**：现状 `renderDetail()` 平铺 **10 块**（6 个 `card()`：显示名 / 准入 / 运行 / 人格 / 初始提示词 / 唤醒，加 4 个手写 `detail-card`：Agent 平台与执行体 / 记忆 / 定时任务 / 危险操作），把两种「权限」拆在两处、把能力档显示两遍，还夹着两个死字段与三个平台专有名词（U5 / U6）。继续补只会更深。

**目标：10 块 → 3 张常驻卡 + 2 张折叠卡。** 每一块都有去处，不允许哪一块悄悄消失（其中「Agent 平台与执行体」后来整块删掉：正文只在平台 › 能力，会话里复述一遍就是重复）：

| 现状块 | 归到 | 处置 |
| --- | --- | --- |
| 显示名 | **详情头部** | **删卡**：会话列表行已有「重命名」入口（`sessionRenameOverlay` + `SESSIONS_FIELDS.rename`），同一件事不做两个入口；头部改为只读显示名称 |
| 准入 | 唤醒与准入 | 合并（选项在上、名单在下） |
| 唤醒 | 唤醒与准入 | 合并；「调整全局准入」按钮留卡底 |
| 运行 | 运行 | 四项不变 + 一行结论 |
| 人格 | 人格与提示 | 合并 |
| 初始提示词 | 人格与提示 | 合并（一次性提示词属于「它怎么说」） |
| Agent 平台与执行体 | （删卡） | **删卡**：执行体与对端权限档的正文只在「平台›该 Agent 平台›能力」，会话里复述一遍只是重复；会话只留 `/agent` 的 `instanceForeign` 驱动危险操作里的重开 |
| 记忆 | 关联（`collapse`） | 只留计数 + 跳转，清空按钮移进折叠区 |
| 定时任务 | 关联（`collapse`） | 只留计数 + 跳转 |
| 危险操作 | 危险操作（`collapse`，默认收起） | 内容不变，默认收起 |

**常驻卡的排布**（顺序即「影响它说话的程度」；执行体那张已删，只剩三张常驻 + 两张折叠）：

| # | 卡 | 回答什么 | 可编辑 | 内容 |
| --- | --- | --- | --- | --- |
| 1 | **运行** | 它在哪儿说话、权限多大 | 是 | 能力档 / 行为档案 / 权限级别 / 本会话模型 + 结论行 |
| 2 | **人格与提示** | 它怎么说 | 是 | 人格模式 / 人格卡 / 初始提示词 |
| 3 | **唤醒与准入** | 谁、在什么条件下能叫它 | 是 | 模式 / 触发 / 关键词 / 调度只读 / 准入名单 +「调整全局准入」 |
| 4 | **关联**（`collapse`） | 还有什么挂在这个会话上 | 跳转 | 记忆计数 / 定时任务计数 / 两个跳转 |
| 5 | **危险操作**（`collapse`，默认收起） | 会丢什么 | 动作 | 重建 / 重置 / 跨平台重开 |

头部（`session-detail-head`）＝ `显示名或默认名` + 健康标签（`agentHealthTag`）+ `sessionId`。名称在头部**只读**，改走列表行的重命名弹窗。

**字段宿主**（字段名不变，只换宿主；页内 `card()` 助手的第三参由单个 host 改为 **host 数组**，一张卡可挂多个 `data-detail-form` 宿主 —— 页内函数，不新增组件）：

| 卡 | 宿主 | 字段 |
| --- | --- | --- |
| 运行 | `run` | `detailCapability` / `detailBehavior` / `detailPermission` / `detailModelProvider` / `detailModel` / `detailModelReasoning` |
| 人格与提示 | `persona` + `prompt` | `detailPersonaMode` / `detailPersonaName`，`detailPrompt` |
| 唤醒与准入 | `wake` + `access` | `detailWakeMode` / `detailWakeTriggers` / `detailWakeKeywords`，`detailAccess` |
| 关联 | — | `detailMemory` / `detailTasks` 只读块 + 两个跳转按钮 |
| 危险操作 | — | 三个按钮（重建 / 重置 / 跨平台重开） |

`关联` 与 `危险操作` 都用 `collapse`，**默认收起** —— 打开详情先看到三张可编辑 / 事实卡。

**运行卡的四项必须互相解释**，所以卡底加一行自动生成的结论（只读纯文本，不是表单字段）：

> 生效：能力档 chat-v2（装预设 · 按准入）· 行为 social-v2 · 权限 只读 · 模型 deepseek-v4-pro / high

取值规则（纯拼字符串，不新增字段）：

| 段 | 取什么 | 缺省怎么写 |
| --- | --- | --- |
| 能力档 | `data.capability || data.defaultCapability`；`apply === 'passthrough'` 写「直通」否则写「装预设」 | `无默认能力档` |
| 行为 | `data.behavior === 'inherit' ? data.defaultBehavior : data.behavior` | `未绑定` |
| 权限 | `data.permission.effective` 的中文名（后端已下发，页面不自带拷贝） | 同左 |
| 模型 | `data.effectiveModel.model` + `/` + `reasoning` | `未设置` |

**两个「权限」分开解释，不靠用户猜**：

| 名字 | 管什么 | 谁改 |
| --- | --- | --- |
| 权限级别 | 本会话能调用哪些**桥接工具**（`session/permission.mjs` 四档） | 运行卡 |
| 对端权限档 | **执行体那边**的沙箱档，由能力档在建会话时钉一次 | 平台›该 Agent 平台›能力（只读）；会话详情不复述 |

**字段调整（`/api/sessions/<key>/profile`）**：

| 字段 | 处置 |
| --- | --- |
| `presets` | **删**（前端零读取） |
| `apply` | **删顶层字段**（它只是能力档的应用方式）；唯一源改为 `capabilities[].apply`，结论行按当前生效档取 |
| `dsh` | **改名 `health`**；前端 `detailDshLabel` → `agentHealthTag` |
| `effectiveModel` | 去掉 `deepseek-official` / `deepseek-flash` 兜底：会话值 → 平台配置 → `null`；`null` 时界面写「未设置」 |
| `model` 的 PATCH | 目录不可用时**不再 503**：按原值保存并回 `warnings: ['模型未校验：目录不可用']`；目录可用时照旧校验 |
| `capabilities[]` | 每项加 `isDefault`（是否平台默认档）与 `apply`（`preset` / `passthrough`），省掉前端自己比 |

**约束**：

- 不新增组件：外壳用 `card`，折叠用 `collapse`，只读块用既有 `detail-readonly`，字段用 `renderFields`。
- 不新增 CSS：10 块改 6 卡是 DOM 重排，`session-detail-grid` 的间距规则不变；折叠外观全部来自 `collapse` 自带的样式。确需新的边距只允许进 `pages/sessions/page.css` 且用 `var(--space-*)`。
- **打开详情默认看不到危险按钮** —— 现状它与「显示名」同级平铺，视觉权重过高，删掉显示名卡之后这个问题会更明显。

**落地口径（2026-11-17）**：

- **读口**：`GET /api/sessions/<key>/profile` 已没有 `presets` 与顶层 `apply`；`capabilities[]` 每项带 `isDefault` 与 `apply`；健康度字段叫 `health`，列表行与详情头部共用同一个 `agentHealthTag()`（无会话写「未建」）。
- **生效模型**：`effectiveModel` 依次取「会话档案的模型」→「平台配置（`agentPlatform.provider` 与 `model` 都要有）」→ `null`，不补任何平台名当默认值；结论行的模型段写 `provider/model / reasoning`，`null` 写「未设置」。
- **写口**：`model` 在模型目录不可用时按原值保存并回 `warnings: ['模型未校验：目录不可用']`；目录可用时照旧校验，非法选择仍 400。
- **显示名的唯一写口**：列表行「重命名」按钮（`data-rename-key`，没有 `sessionId` 时置灰）打开 `sessionRenameOverlay`；`POST /api/session/rename` 改对端标题的同时写档案 `displayName`。`PATCH /profile` 收到 `displayName` 回 400，详情头部只读。
- **样式**：只有四条规则进 `pages/sessions/page.css` —— 折叠卡 `margin-top: 0`（否则与栅格 gap 叠成双倍）、折叠卡导语间距、结论行、危险区标题色（用 `var(--err)`；`--danger` 是提醒底色）。折叠外观其余部分全部来自 `collapse`。
- **门禁**：`test-console-ui` 的会话详情用例钉「三张常驻卡 + 两张折叠卡的默认态 + 结论行 + 重开按钮的显示条件」，并钉「详情里没有 `data-detail-form="agent"`」（声明面只在平台›能力）；`test-console-static` 的 S7 段钉住「宿主数组 / 无显示名字段 / 唯一改名入口 / 读口字段 / `warnings`」；`test-session-profiles` 断言 `health`、`capabilities[].isDefault|apply`、`effectiveModel` 与 `PATCH displayName` 400。

### 8.2 价目表：从「平台申报只读」到「state 可覆盖」

**问题**（U8）：`priceTable` 是模块级常量，启动时由平台 `modelCatalog` 生成，`tokenLedger` 构造时捕获；改价必须改平台 yml + 重启，平台没申报的模型一律不报价。

**跟随哪个模型**：价目表只为**全局配置里的默认模型**匹配 —— 平台取 `platforms.active.agent`，模型取 `platforms.agents.<id>.model`。查询串不再接受 `?agent=`，「现在哪个模型在跑」也不去猜：会话单独选过的模型交给账本的逐模型覆盖清单（`coverage`）回答，见下方「覆盖率」。默认模型在这一层没有价时，界面明说「没匹配到价目」，不显示 0 元。

**三层合并（后者覆盖前者）**：

| 层 | 位置 | 谁写 |
| --- | --- | --- |
| **内置官方价** | `src/pricing/builtins.mjs` 的 `BUILTIN_CATALOG`（官方单价 + 口径：CNY / ¥ / 1e6 / ×2 / 工作日 9–12、14–18）与 `model-prices.js` 的 `CN_HOLIDAYS` | 代码：`withBuiltin()` 垫在申报底下 —— 申报写了单价就用申报，只写了模型就补内置价并标 `origin: 'builtin'`；口径以内置为底、申报字段盖上去 |
| 平台申报 | `profiles/agent-platforms/<id>/agent-platform.yml` 的 `modelCatalog` | 平台作者 |
| **本地覆盖** | `state/pricing/<agentPlatformId>.yml` | 用户（控制台） |

**本地文件不是 `modelCatalog` 的副本**：`modelCatalog.models` 是**数组**（`[{ id, label, pricing: { cacheHit, cacheMiss, cacheWrite, output } }]`），本地层改成 **id → 扁平四价的 map**。原因是覆盖的语义就是「按 id 改几个字段」，数组合并必然退化成整段替换。两者进同一条合并管线，最终输出形状由 `priceTableFromCatalog()` 统一。

```yaml
version: 1
note: 本机覆盖：按模型 id 覆盖或新增；未写的字段回落平台申报
models:
  deepseek-v4-pro:
    label: DeepSeek-V4-Pro
    cacheHit: 0.15
    cacheMiss: 4.5
    cacheWrite: 4.5
    output: 13.5
```

**合并必须按字段**：本地只写 `output` 时其余三价回落平台申报；只在本地出现的 id 就是「本地新增」。`models` 是 **id → 报价的 map**，不做数组替换。

| 键 | 必需 | 说明 |
| --- | --- | --- |
| `models.<id>.cacheMiss` / `.output` | **是** | 算钱的基准；缺任一项则该模型不参与报价（与 `priceTableFromCatalog()` 同一条判据，不另立规则） |
| `models.<id>.cacheHit` | 否 | 缺省按 `cacheMiss` |
| `models.<id>.cacheWrite` | 否 | 缺省按 `cacheMiss` |
| `models.<id>.label` | 否 | 缺省用 id；本地新增的模型建议写，界面直接显示它 |

**峰谷口径不归本机层**：表级 `pricingPolicy` 与模型级 `pricingPolicy` 只出现在声明面（内置官方口径 + 平台申报）。`normalizeLocalPricing()` 遇到 `policy` / `pricingPolicy` 键直接丢弃，界面只给一行「跟随当前口径」的只读文案。理由：同一条用量若因「谁在什么时间读表」而变价，历史金额就不可复现；而账本恰恰靠「按当前表重算」来吸收后补的单价，前提是口径本身确定。声明面里仍然可以按模型另定峰谷（显式空数组 = 全天同价），那是平台作者的商业条款，不是本机编辑动作。

**新增模块 `src/pricing/store.mjs`**：

| 导出 | 职责 |
| --- | --- |
| `mergeCatalog(declaredCatalog, local)` | 纯函数（不碰 fs）：在**申报的原始形状**（`models` 数组 + `pricing` 对象）上按 id 逐字段合并，再交给 `priceTableFromCatalog()` 换算 —— 单位换算与「缺 `cacheMiss`/`output` 就不报价」的判据只有 `model-prices.js` 那处 |
| `createPricingStore({ root })` | 实例方法 `readLocal(agentId)` / `effective(agentId, declaredCatalog)` / `save(agentId, patch, declaredCatalog)` / `remove(agentId)`；`root` 传 `state/pricing`，备份根由 `path.dirname(root)` 推成 `state/platform-backups/pricing/<agent>/` |
| `normalizeLocalPricing(raw)` / `normalizePriceEntry(raw)` / `isEmptyLocalPricing(local)` | 归一与「算不算没有覆盖」的判据；**单价只含空白 = 没填**（`Number('  ') === 0` 不能当成免费价） |

**写入语义**：`save()` 是**整段替换** —— 没提交的模型即取消覆盖，归一后为空则直接删文件。本地新增（申报里没有的 id）必须同时给 `cacheMiss` 与 `output`，否则保存即抛错：写进去也不进价目表，用户会以为没生效。

**热生效**：

- `bridge.js` 的 `priceTable` 由 `const` 改 `let`，并提供 `refreshPriceTable()`（读本地层 + 平台申报 → `effectivePriceTable()` → 覆盖 `priceTable`），写价成功后调一次。
- `createTokenLedger` 的入参由 `priceTable` 改为 `getPriceTable`；**每个对外函数开头取一次** `const priceTable = getPriceTable()`，函数体其余不动 —— 现有 11 处 `priceTable` 表达式不用逐个改，也不会捕获旧表。
- 金额在**读取时**折算（`priceUsage()` 每次拿当前表算），所以刷新表即重算全部历史，**不需要迁移账本**。

**API**：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/pricing` | `{ agent, agentLabel, model, source: 'local'\|'declared'\|'builtin'\|'none', match: { model, label, priced, origin, off, tier, tierLabel, currency, symbol }, policy: { version, currency, symbol, unit, multiplier, windows, weekdays, holidayCount }, table, local, declared, coverage }`；平台与模型都取自全局配置，不接受 `?agent=` |
| PUT | `/api/pricing` | 覆盖本地层（整段写入 + 归一校验），成功后热刷新账本表 |
| DELETE | `/api/pricing` | 删本地层，回落上一层（申报 → 内置官方价） |

**界面**（全局配置 › 模型与行为 › **最后一张卡**）：

- 卡头只回答「这一层为什么存在」；正文首行写跟随的 `agentLabel / model` 与匹配结论（`已匹配「…」的价目` / `没匹配到价目`），没有平台 / 模型切换控件。
- 峰谷只有一行只读提示（“工作日 09:00–12:00、14:00–18:00 ×2，节假日按空闲价”，数字取自 `policy`），**没有**时间选择器。界面只展示，不代表可以编辑。
- 表格用 `dataTableHtml`，**动作按钮（添加模型 / 保存覆盖 / 还原默认价目）住在表格自带工具栏的右侧**，搜索与刷新也用同一栏。
- **添加模型**先加一行空白：模型 id 可编辑，单价等填；保存时才随补丁写进本机层（申报里没有的 id 必须同时给「未命中」与「输出」）。本机层里有条目的行带一个「移除覆盖」按钮，点了只是「保存时不再提交它」—— 整段写入，少哪条就等于撤掉哪条。
- **还原默认价目** = 删 `state/pricing/<agent>.yml`：改过的单价与手动添加的模型一起撤回「平台申报 + 内置官方价」，账本不动。
- 运行总览的「花费概览」在「刷新」与「清空账本」之间有一个同款「价目表」按钮（`data-page-tab="runtime"`）：跳到这张卡；默认模型没匹配到价目时，原本「每 3 秒自动同步」那行改成灰色提示，引导用户去补价目。

**覆盖率（未定价 / 后补价 / 只匹配一半）**：

- 账本只落 token 与模型名，**金额是读取时按当前表算的**（每行存「模型 × 档位」而非算好的钱）。所以：补上单价后历史金额当场重算（含已被压缩聚合的部分），不需要迁移账本，跨重启也可复现。
- 没价的模型只计 token：`totals.unpriced` / `unpricedTokens` 给合计，`coverage[]` 逐模型给 `{ model, label, tokens, cost, unpricedTokens, priced }`。界面把 `priced=false` 的行列成「待补价目」的空行（写「账本已记 51.2k token，没算钱」），补完即出金额。
- 「有默认模型的价、没有会话单独用的模型的价」与反过来：`match` 只回答默认模型，会话侧一律走 `coverage`。两个方向都不会被一句「有价 / 没价」盖掉，总览提示与价目卡的空行指向同一份覆盖率。
- 三层都没有的模型**不估算**：不拿别的模型顶替，金额显示「—」。

**两条必须写进界面的口径**：

1. **改价会重算历史金额**（金额在渲染时按表折算），不是「只影响以后」。
2. 三层都没有价的模型显示「—」，**不估算**、不拿别的模型顶替。

### 8.3 模型目录不可用时按声明面兜底

**根因**（U9）：选项只从 `view.providers` 铺，而 `live` 要求 AgentPort 真能 `listModels()`（DSH 未连上 / ACP 未填 `command` 就空）；`declared.models` 明明有内容却完全没用上。

**修法**：

| 控件 | live 可用 | live 不可用 |
| --- | --- | --- |
| 提供方 | 按 `view.providers` 铺 | **保持当前值、置灰**（provider 是 live 目录的概念，声明面没有这个维度） |
| 模型 | 按选中提供方铺 | **按 `declared.models` 铺，可编辑** |
| 思考强度 | 按选中模型的 `efforts` | **四级回落**：实时模型 `efforts` → 声明模型 `efforts` → `declared.efforts` 全集 → `declared.effortFallback`；声明面也没有就像模型一样只保留当前值 |
| 看图 | 可编辑 | 可编辑（不变） |

**保存口径统一**（与 §8.1 的会话模型、与平台写口既有约定一致）：

- 目录可用 → `validateModelSelection` 校验，非法 400
- 目录不可用 → **放行并回 `warnings`**，不 503、不静默丢弃

**提示条文案**（组件里的 `renderNotices`）：由「实时目录不可用…模型与档位暂时改不了」改为

> 实时目录不可用：以下选项来自平台的声明清单，保存时不校验。连上执行体后刷新一次即可看到实际可用的提供方。

**提示条删掉「暂时改不了」**：选项确实能改，文案只说明来源与「保存时不校验」。

**验收**：

- **DSH 有声明、实时目录读不到**：提供方灰且保持原值，模型按 `declared.models` 可改，档位按声明面铺（本例 7 档），保存 200 且回 `warnings: ['模型未校验：目录不可用']`，卡片回显这条 warning。
- **ACP 无 `modelCatalog`、未填 command**：两个下拉保持当前值并置灰（没有选项可铺时硬造空列表就是假开关），保存照常成功、不报错。这是当前最坏情况，也是「第三个平台」的默认状态。

**两处共用一套实现**：平台详情与全局配置挂的是同一个组件 `public/console/components/agent-model/agent-model.js`（`mountAgentModel(host, { agentId, config, prefix })`）。控件 id 带前缀（`platformModel*` / `agentModel*`），两段页面片段同时驻留也不会撞 id；挂载点由调用方给，平台由 `agentId` 给 —— 组件不认识「默认平台」这种概念。

**门禁**：`test-console-ui` 的「平台模型卡：实时目录不可用时按声明清单铺选项」用例钉 DSH 场景（夹具开关 `POST /__fixture/model-catalog`），`test-console-static` 的 S9 段钉源码口径。

---

## 附录 A：受影响的文件清单

| 文件 | 动作 |
| --- | --- |
| `src/user-side/event.mjs` | 补 `actor` / `notice` 校验 |
| `src/user-side/actions.mjs` | **新增**（动作词表 + 降级 + 门面） |
| `src/user-side/adapters/qq/inbound.mjs` | 补 `notice.*` 翻译 |
| `src/user-side/adapters/qq/actions.mjs` | **新增**（`bot.raw` / NapCat 私有动作的唯一住所） |
| `src/user-side/adapters/qq/index.mjs` | 导出 `actions` / `actionHandler` |
| `src/user-side/runtime-registry.mjs` + `transport.mjs` | 声明通道加 `actions` |
| `src/social/conversation-events.js` | `normalizeMemberNotice` 挪进适配器，本文件只留业务动作 |
| `src/bridge.js` | 删 `bot.onNotice`；`deliver()` 改签名；9 处直连改 `callAction` |
| `src/tools/catalog.mjs` | 36 → 8 组；删 `AGENT_MODULES`；`provider` 参数化 |
| `src/capabilities/store.mjs` | 读写 `effects` / `runtime` / `behavior` / `audience` / `mcp` / `skills`，不再读写 `rows` / `preset` / `tools.agent` |
| `profiles/agent-platforms/dsh/capabilities/*.yml` | 5 份改写成意图层 |
| `profiles/capabilities/direct.yml` | **新增**（直通档住共用目录，任何 Agent 平台都能选） |
| `profiles/agent-platforms/dsh/render.yml` | **新增**（效果 → 插件行 / 行序 / 权限档 / 人格文案） |
| `profiles/agent-platforms/*/tools.yml` | 每项加 `effects` 数组 |
| `profiles/agent-platforms/dsh/adapters/render.mjs` | **新增**（`renderPresetRows` / `renderPresetMeta`，构建与运行期共用） |
| `profiles/agent-platforms/dsh/adapters/build.mjs` | 改调渲染层（产物正文必须逐字节不变） |
| `public/console/` | 导航分组、平台详情三段、能力档编辑器、会话工具卡 |
| `scripts/verify-adaptation.mjs` | 两条新断言 |
| `src/pricing/store.mjs` | **新增**（三层价目合并 + 本地覆盖读写） |
| `state/pricing/<agent>.yml` | **新增**（用户覆盖层，运行时生成，出厂不带） |
| `src/token-ledger.js` | `priceTable` 改 getter，支持热刷新 |
| `public/console/pages/sessions/page.js` | 10 块 → 3 张常驻卡 + 2 张折叠卡（执行体那张已删）；删死字段读取；`dsh` → `health`；运行卡结论行 |
| `public/console/pages/overview/usage*.js` | 价目卡改可编辑 + 来源标签 + 恢复声明 |
| `public/console/components/agent-model/agent-model.js` | **新增**（模型卡唯一实现，平台详情与全局配置共用） |
| `public/console/pages/platforms/platform-detail.js` | 模型卡改为挂 `agent-model` 组件（`platformModel*` 前缀）；按 `declared` 兜底与 warning 口径由组件负责 |
| `docs/PLATFORM_DECOUPLING.md` | §3.2 标注「由门禁执行」 |

## 附录 B：动作 / 效果 / 能力位 三层对照

| 层 | 回答什么问题 | 谁声明 | 住哪 | 缺了怎么办 |
| --- | --- | --- | --- | --- |
| 能力位（AgentPort） | 这个执行体能做哪几类事 | Agent 平台 | `src/agent-side/port.mjs` | 抛 `capability_unsupported` |
| 效果（effect） | 这个执行体提供哪些具体工具能力 | Agent 平台 `tools.yml` | `profiles/agent-platforms/<id>/` | 构建期忽略 + 审计 + 界面标注 |
| 动作（action） | 这个用户平台能做哪些消息外的操作 | 用户平台 | `src/user-side/actions.mjs` | 按表降级或抛错 |
| 能力档 | 本次会话允许用哪些动作 / 效果 | 会话与会话档案 | `profiles/agent-platforms/<id>/capabilities/` | 未列即不允许（`visiblePlatformFlags` 口径） |
