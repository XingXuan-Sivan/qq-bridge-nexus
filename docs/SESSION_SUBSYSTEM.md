# 会话子系统（模型 / 准入 / 迁移 / 分阶段计划）

状态：**方案已定，代码未动**（2026-11-07）。本轮先落文档与偏差登记，确认后再按 P0 → P3 开工。
关系：替代 `PARITY.md` D-3 的「会话页 = 列表 + 改标题 + 清理」范围；把「全局唯一运行模式」改成「会话可固定运行模式」。差异见 `PLAN_DEVIATIONS.md` D7–D12；未完成项见 `STATUS.md` #16。

涉及：`state/sessions.json` v2、`src/session/`、`src/bridge.js` 的会话/准入/DSH 生命周期、控制台「会话与审批」页、访问与安全页、人格页与二代仿真页里按会话的入口、管理员模型。

## 1. 目标与不变量

目标：把现在散在 `state/sessions.json`、`state/current-role.json`、`state/initial-prompts.json`、`state/social-v2.json`、`config.json` 五处的「按会话配置」收成**一个会话档案**；把「谁能触发 bot」拆成被动/主动两根可解释的轴；让 DSH 会话成为可丢弃、可自愈的执行实例；把单管理员扩展成 owner + 管理员两级。

不变量（实现时不许破）：

1. **覆盖不污染全局**：会话级配置只在该会话生效，任何读取失败都回落全局默认，绝不把会话值写回全局配置。
2. **准入只有一个真相**：被动/主动的判定只读 `sessions.json` v2 的 `defaults` + `profiles`，不再有第二套白名单/豁免分支。
3. **显式拒绝优先**：`blocked` / 显式 `deny` 高于本会话 `allow`，也高于 owner/管理员豁免。
4. **运行模式不是过滤器**：`chat` / `reserved` / `reserved2` 是会话实际跑哪套仿真；`closed-agent` 是全局排他模式，不开放给会话级。
5. **DSH 实例可丢弃**：任何 RPC 返回 `session/not-found` 只允许「退役 → 重建 → 重试一次」；不允许无限重建，也不允许静默不回复。
6. **迁移一次、无旧读**：成功后删除旧文件与旧键，正式版本没有兼容读分支、没有 `.bak`、没有双写。
7. **服务端校验权限**：owner/管理员边界在 HTTP 层校验；控制台隐藏按钮只是体验，不是授权。

## 1.1 已拍板的决策

| 决策 | 结论 |
| --- | --- |
| 准入轴 | 被动、主动两根独立轴；每根轴都能切黑白名单（默认策略 + 每会话三态） |
| 迁移默认 | 完全保持现状：原 allow 会话被动/主动都开，原 deny 拒绝，`allowAllWhenEmpty` 决定默认 |
| 运行模式 | 会话可固定 `chat` / `reserved` / `reserved2`；closed-agent 仍全局排他，不开放会话级 |
| 覆盖范围 | P1：显示名、被动、主动、黑名单、人格、提示词、唤醒、记忆清空、DSH 状态；P2：运行模式、预设、模型 |
| 存储与迁移 | 一次性迁到 `sessions.json` v2；正式版本无旧文件、旧键、兼容读、`.bak` |
| 清空上下文 | 拆成「重建 DSH 会话」与「重置会话状态」两个动作 |
| 多管理员 | owner + 管理员两级；管理员不能改全局模式/权限/管理员名单 |
| 控制台多账号 | 本轮不做；P3 只做服务端身份与权限，控制台登录仍视为 owner |

## 2. 术语

| 术语 | 含义 |
| --- | --- |
| 会话（session） | 一个 QQ 群或私聊，key 形如 `qq:group:123` / `qq:private:456` |
| 会话档案（profile） | 这个会话的配置：显示名、准入、运行模式、人格、提示词、唤醒、模型、DSH 预算等 |
| 绑定（binding） | 会话 → 当前 DSH `sessionId` + 建会话时的策略指纹；运行态，不是配置 |
| 运行模式 | `chat`（聊天）/ `reserved`（一代仿真）/ `reserved2`（二代仿真）；会话可固定，也可跟随全局 |
| 被动 | 入站消息触发的回复（被 @、私聊、群内按策略参与） |
| 主动 | bot 自己发起：主动发言、定时任务、AI 向其它会话发送、主动唤醒 |
| owner | `config.json.ownerQQ`，唯一最高权限 |
| 管理员 | `config.json.admins[]`，按 capability 授权，不能改全局模式/权限/管理员名单 |

## 3. 数据模型

文件：`state/sessions.json` v2（单文件；`src/session/store.mjs` 原子写盘）。

```json
{
  "version": 2,
  "defaults": {
    "passive": "deny",
    "proactive": "deny"
  },
  "profiles": {
    "qq:group:903621673": {
      "displayName": "技术闲聊群",
      "blocked": false,
      "access": {
        "passive": "inherit",
        "proactive": "deny"
      },
      "mode": "inherit",
      "persona": { "mode": "inherit", "name": null },
      "prompt": { "initialText": "", "updatedAt": 0 },
      "wake": { "config": null },
      "model": null,
      "presetId": null,
      "updatedAt": 0
    }
  },
  "bindings": {
    "qq:group:903621673": {
      "sessionId": "session-…",
      "workspaceId": "workspace-…",
      "fingerprint": "reserved2|qq-chat-v2|…",
      "status": "online",
      "checkedAt": 0,
      "createdAt": 0
    }
  }
}
```

字段约定：

- `defaults.passive/proactive`：全局默认策略，取值 `allow` / `deny`；切换它等于切换该轴的黑/白名单语义。
- `profiles[key].access.*`：`inherit` / `allow` / `deny` 三态；`blocked=true` 时两根轴都拒绝，优先级最高。
- `profiles[key].mode`：`inherit` / `chat` / `reserved` / `reserved2`；不允许 `closed-agent`。
- `profiles[key].persona`：`inherit`（按全局三层解析）/ `off`（本会话不挂卡）/ `card`（指定角色卡名）。
- `profiles[key].prompt.initialText`：首次唤醒时注入一次的会话背景；空串表示没有。
- `profiles[key].wake.config`：会话级唤醒配置；`null` 表示按推荐值/全局默认。
- `profiles[key].model`：`null` 表示跟随全局；否则 `{provider, model, reasoning}`，保存前按 DSH 目录校验。
- `profiles[key].presetId`：`null` 表示按运行模式推导；否则必须是预设安全清单里的 id。
- `bindings[key]`：运行态；`status` 取 `online` / `missing` / `unknown`；`fingerprint` 是建会话时的策略指纹，用于判断「需要重建」。
- `admins` 不放进这个文件：管理员是全局身份，放 `config.json`（见 §10），避免会话文件被误删导致提权/锁死。

写入规则：

- 只写变化的字段；保存一个卡片不覆盖其它卡片的值。
- 写盘用 `.tmp` + rename；迁移/写盘失败保留旧文件并报错，不产生 `.bak`。
- `profiles` 允许空桶（用户先建会话、后配置）；`bindings` 缺失不代表档案删了。
- 旧 `state.sessions` / `state.sessionPolicies` 两个顶层键在迁移后不存在；v2 读取路径只认 `bindings`。

## 4. 准入模型

### 4.1 两根独立的轴

- `passive`：能不能因为「别人发来消息」而回复。
- `proactive`：能不能由 bot 自己发起动作（主动发言、定时任务、跨会话发送、主动唤醒）。

两根轴各自有全局默认（`defaults.passive/proactive`）和每会话三态（`inherit/allow/deny`）。默认拒绝 + 例外允许 = 白名单；默认允许 + 例外拒绝 = 黑名单。

### 4.2 解析顺序

```
resolve(axis, key):
  profile = profiles[key]
  if profile.blocked: return deny
  if profile.access[axis] === deny: return deny
  if profile.access[axis] === allow:
      return allow
  # inherit
  if axis == passive and isOwnerPrivate(key): return allow
  if axis == passive and isAdminPrivate(key) and admin.exemptPassive: return allow
  return defaults[axis]
```

- `deny` 永远优先；owner 私聊豁免只在 `inherit` 时生效，显式拒绝仍然生效（控制台仍可改）。
- 管理员私聊被动默认豁免（可在管理员记录里关掉）；主动不豁免。
- 判定函数只接受 `(axis, key, snapshot)`，不读 `currentMode`、不读旧 `allow` 列表。

### 4.3 主动行为的检查点

| 入口 | 检查 |
| --- | --- |
| 二代仿真主动发言 / 主动唤醒 | `proactive` |
| 一代仿真主动参与 | `proactive` |
| 定时任务投递 | 目标会话 `proactive`；拒绝时任务标记「跳过（主动未授权）」并通知创建者 |
| AI 工具向其它会话发送（消息/表情/拍一拍/合并转发） | 目标会话 `proactive`；当前会话内、由入站触发的回复只走 `passive` |
| 控制台「测试发送」 | 不受限，但写审计（人工操作） |

定时任务/主动唤醒被拒绝时**不能静默**：至少写活动日志，并把原因回给创建者（owner/管理员）。

### 4.4 迁移映射（完全保持现状）

| 旧 | 新 | 说明 |
| --- | --- | --- |
| `allow.groups` / `allow.private` 中的 key | `profiles[key].access = {passive: allow, proactive: allow}` | 现在这些会话既能被动也能主动 |
| `deny.groups` / `deny.private` 中的 key | `profiles[key].blocked = true` | 显式拒绝优先 |
| `allowAllWhenEmpty=true` 且 allow 为空 | `defaults.passive = allow`、`defaults.proactive = allow` | 保持「谁都能触发」 |
| 其它情况 | `defaults.passive = deny`、`defaults.proactive = deny` | 保持「只允许名单内」 |
| 旧 `sessions` / `sessionPolicies` | `bindings[key]` | 指纹原样保留，迁移后第一次判定会按新指纹重建 |
| `current-role.json.byKey` | `profiles[key].persona` | 有卡名 → `{mode:'card', name}`；无 → `inherit` |
| `initial-prompts.json` | `profiles[key].prompt.initialText` | 保留更新时间 |
| `social-v2.json.conversations[key].wakeConfig` | `profiles[key].wake.config` | 仅迁配置；未读、agentToken 留在运行态存储 |
| `access` 页的 allow/deny 输入框 | 默认策略 + 会话档案 | 旧输入框删除，不再提供第二套编辑入口 |

迁移判定：

- 同一 key 同时在 allow 与 deny：按 `blocked`（拒绝优先）处理，不保留 allow。
- 新会话（迁移之后第一次出现）：`access` 全部 `inherit`；白名单默认下自然关闭，黑名单默认下跟随允许。
- 手工「新增会话」：写一条 `inherit` 档案；弹窗里主动默认 `deny`，即使用户当前是黑名单默认，也先不给主动——要放开需在详情页显式改。
- 自动发现的未知群/私聊：只建绑定或只记录，不自动写 `allow`；是否回复由 `defaults` 决定。

### 4.5 旧键删除

- 迁移成功后删除 `config.json` 的 `allow` / `deny` / `allowAllWhenEmpty`，删除 `state/current-role.json` 的 `byKey`、`state/initial-prompts.json`、`social-v2.json` 的 `wakeConfig`。
- 正式版本没有兼容读；发现 `version < 2` 时先迁移，迁移失败则拒绝启动会话子系统并给出明确错误（不静默降级到旧逻辑）。

## 5. 运行模式与执行指纹

### 5.1 有效运行模式

```
effectiveMode(key):
  if globalMode == 'closed-agent':
      return isOwnerOrAdminPrivate(key) ? 'closed-agent' : 'inactive'
  return profile.mode == 'inherit' ? globalMode : profile.mode
```

- `globalMode` 仍是 `config.json.currentMode`，但含义变成「默认模式」；会话可固定 `chat` / `reserved` / `reserved2`。
- **closed-agent 全局排他**：它开启时，所有会话级 chat/v1/v2 覆盖暂停，只保留 owner/管理员私聊；退出后按各自覆盖恢复。这样不会出现高权限 agent 与公开仿真混跑。
- 会话级 `mode` 改变会改变预设、工具集、提示词结构、记忆块与模型默认值，必须进入执行指纹（见 5.3）。

### 5.2 预设与模型

- 预设：`profile.presetId` 优先；否则由有效模式推导（chat → `qq-chat`，reserved → `qq-chat`，reserved2 → `qq-chat-v2`；closed-agent 由管理员级别固定）。保存前校验安全清单。
- 模型：`profile.model` 优先；否则用 `cfg.dsh` 全局默认。校验 provider/model 是否在 DSH 目录中；不在则拒绝保存并提示。
- 会话级模型/预设保存后不保证当前 DSH 会话立刻换模型：下一次唤醒前按指纹判断重建；UI 明示「下次唤醒生效」。

### 5.3 执行指纹与重建

指纹输入（顺序固定、可读）：`effectiveMode | presetId | provider/model/reasoning | persona 目标与内容哈希 | closed-agent level | 工具集版本`。

- `ensureChatModel` 的「已应用」缓存只用于省 RPC，**不再用于判断会话是否存活**。
- 指纹变化 → 退役旧绑定 → 新建 DSH 会话 → 写入新指纹。
- 新建后立即 `session.rename`（见 §7），标题不参与指纹。
- 会话级 `agentToken` 轮换不重建会话，只让下一次唤醒带新 token；UI 提示「下一次唤醒生效」。

## 6. 会话可覆盖配置

**P1（档案与详情页）**

| 项 | 行为 |
| --- | --- |
| 显示名 / DSH 标题 | 自定义名同步写 DSH；空则用 `QQ·群 <id>` / `QQ·私聊 <id>` |
| 被动 / 主动 | 三态；见 §4 |
| 黑名单 / 删除档案 | `blocked`；删除档案同时删绑定，可选连带删人格/提示词/记忆/唤醒 |
| 人格来源 | `inherit` / `off` / `card`；卡名必须在本地角色库中 |
| 初始提示词 | 编辑 / 清除；首次唤醒注入一次 |
| 唤醒配置 | `inherit`（推荐值）/ 自定义 / 重置 |
| 记忆 | 只读计数、清空本会话；provider/预算/工具仍全局 |
| DSH 状态 | 在线/缺失/未建；重建；轮换 agentToken |

**P2（运行模式与模型）**

| 项 | 行为 |
| --- | --- |
| 运行模式 | `inherit` / `chat` / `reserved` / `reserved2`；closed-agent 不出现 |
| DSH 预设 | `inherit`（按模式推导）/ 安全清单内指定 |
| 模型 | `inherit` / 指定 provider + model + 思考强度 |
| 定时任务 | 详情页只读列出指向本会话的任务；不在此改任务 |

**明确仍全局**：回复风格与分条参数、静默时段/免打扰、上下文压缩阈值、记忆 provider 与预算、AI 工具总开关、closed-agent 权限级别（P3 起按管理员配置）。

说明：用户最初写的「允许模式」是笔误，实际是**运行模式**；本轮不引入「每会话可选哪些模式」的过滤器概念。

## 7. DSH 生命周期

### 7.1 创建与命名

- `ensureSession(key)` 创建后立即 `session.rename`，默认标题：
  - 群：`QQ·群 <群号>`
  - 私聊：`QQ·私聊 <QQ号>`
- 有 `displayName` 时用显示名；改名通过 `POST /api/sessions/<key>/rename` 同步 DSH。
- 提供一次性的「整理历史标题」动作：把仍是 `【当前时间】…` 的绑定按默认标题重命名；失败逐条报告，不中断其它。

### 7.2 自愈

- 任何 RPC（`prompt` / `selectModel` / 事件流 follow）返回 `session/not-found`：标记绑定 `missing` → 解绑 → 重建 → 重试一次；仍失败才向用户报错。
- 重试只做一次，避免风暴；同一会话 60 秒内连续 not-found 超过 3 次则暂停自动重建并告警（防止配置性错误导致无限建会话）。
- `ensureChatModel` 不再用缓存判断存活；存活由实际 RPC 与对账决定。

### 7.3 启动对账

- 启动时调用 `sessions.list` 与 `bindings` 比对：DSH 不存在的绑定标记 `missing` 并解绑；存在的标记 `online`。
- `sessions.list` 不可用/超时：全部标记 `unknown`，不删除绑定；下一次实际 RPC 再判定。
- 对账失败不阻断启动。

### 7.4 重建与重置

- **重建 DSH 会话**：归档旧会话（能归档则归档）→ 解绑 → 新建 → 新指纹；保留人格/提示词/唤醒/记忆/未读。
- **重置会话状态**：清唤醒配置、agentToken、未读、队列/审批、活动状态，归档旧会话（现有 `/api/session/reset` 语义）；人格/提示词/记忆是否保留由弹窗勾选，默认保留。
- 两个动作分开命名、分开确认文案；不再用「清空上下文」这样一个词覆盖两种后果。

## 8. 控制台

### 8.1 会话列表

数据源：`profiles` ∪ `bindings` ∪ 现有 `conversations`（已知会话）的并集；没有 DSH 映射的会话也要显示，状态 `未建`。

列：会话（显示名 + key）/ 平台 / 类型 / 被动 / 主动 / 运行模式 / 人格 / 模型 / DSH / 未读 / 最近活动 / 操作。

- 工具栏：搜索、平台/类型/被动/主动/运行模式/DSH 筛选、刷新、新增会话。
- 行操作：管理（进详情）、清空上下文（重置状态）、删除档案。
- 批量：先不做批量改准入；等真实使用反馈再评估。

### 8.2 详情子页

路由：`#sessions/<url-encoded key>`；返回列表保留筛选与滚动位置。

卡片（每卡独立保存、独立脏值状态）：

1. 基本信息：显示名、key、类型、创建时间、DSH 状态/最后检查/重建/轮换 token。
2. 准入：被动、主动、blocked、运行模式（P2）。
3. 人格与提示词：人格来源/卡名、初始提示词。
4. 模型与预设（P2）：provider/model/思考强度、DSH 预设。
5. 唤醒：配置摘要、当前状态、重置。
6. 上下文与用量：DSH 会话 id、压缩入口、重建入口。
7. 记忆：计数、打开记忆页并过滤到本会话、清空。
8. 危险操作：重置会话状态、删除档案（勾选连带删除项）。

### 8.3 入口迁移

- persona 页：删除「按会话设置人格」卡（全局角色库保留）。
- social-v2 页：删除「唤醒状态」「初始提示词」「白名单快速选择」卡；唤醒推荐值仍在，但按会话的编辑在详情页。
- access 页：保留默认策略（被动/主动）、黑名单、管理员、令牌、拦截提示；删除 allow/deny 名单编辑与会话白名单快速选择。
- 迁移完成后旧入口不留「已迁移」提示或死链接。

### 8.4 权限

- owner：全部。
- 管理员：按 capability；没有 `sessions` 权限时列表只读、详情页不出现保存按钮。
- 控制台是单 token，本轮不改：控制台请求一律按 owner 处理；管理员只在 QQ 侧获得能力（审批、命令、通知、closed-agent），控制台多账号另立项。

## 9. 迁移与回滚

步骤：

1. 备份：**迁移代码不生成 `.bak`**。如本机需要人工快照，放在仓库外，验证后删除；仓库与 `state/` 正式版本不保留备份文件。
2. 读取旧文件与旧键，构建 v2 内存对象；校验 key 形态、引用完整性。
3. 写 `sessions.json.tmp` → rename；成功后才删除旧文件/旧键。
4. 启动后跑一次对账；打印迁移摘要（会话数、allow/deny 数、人格/提示词/唤醒迁移数）。
5. 迁移失败：保持旧文件原样、记录明确错误、拒绝进入会话子系统；修复后重跑（幂等）。
6. 回滚：回滚代码提交 + 人工恢复仓库外快照；不提供运行时回滚工具（与 §6 原则一致）。

判据：

- 迁移前后同一批会话的被动/主动判定一致（用固定样例表断言）。
- 迁移后旧文件与旧键不存在；`grep` 不到旧读取路径。
- 迁移重复执行不改变结果（幂等）。

## 10. 多管理员

配置：

```json
"ownerQQ": "2897715886",
"admins": [
  { "qq": "123456789", "name": "副管理员", "caps": ["approve", "sessions", "scheduler", "memory"], "maxLevel": "L2", "notify": true, "exemptPassive": true }
]
```

- owner 永远拥有全部 caps 与 L3；管理员不能改 `currentMode`、closed-agent 权限、管理员名单、控制台令牌。
- 审批：同一会话内任一有 `approve` 的管理员可答复；通知 owner + `notify=true` 的管理员（去重）；审计写 actor QQ。
- closed-agent：只允许 owner/管理员私聊；每人 `maxLevel` 限制可开启级别；owner 可降级/回收。
- 管理员私聊被动默认豁免；可关。
- 审计与活动日志：涉及管理动作的行加 `actor`；控制台展示操作者。

## 11. 分阶段计划

| 阶段 | 内容 | 关键文件 | 完成判据 |
| --- | --- | --- | --- |
| P0 稳定性 | DSH 自愈、启动对账、确定性命名、详情页只读 DSH 状态与重建按钮 | `src/bridge.js`、`src/session/registry.mjs`、`src/session/store.mjs`、`pages/sessions/` | 手动删 DSH 会话后下一条消息自动重建并回复；启动对账把缺失标 `missing`；新会话标题为 `QQ·群/私聊 …`；`scripts/test-session-lifecycle.mjs` 全过 |
| P1 档案与详情页 | `sessions.json` v2、迁移、准入双轴、列表并集、详情页 P1、入口迁移、双清空动作 | `src/session/profiles.mjs`（新）、`src/session/access.mjs`（新）、`src/bridge.js`、`pages/sessions/`、`pages/persona/`、`pages/social-v2/`、`pages/access/` | 迁移样例判定与旧配置一致；旧文件/旧键不存在；列表显示无 DSH 映射的会话；详情页每卡独立保存；删除档案不影响其它会话；`test-session-profiles` + UI 全过 |
| P2 运行模式与模型 | 会话级 mode/model/preset、全量 `currentMode` 调用点改 `effectiveMode`、主动检查点（scheduler/AI 跨会话工具）、任务跳过通知 | `src/session/profiles.mjs`、`src/session/mode-gate.mjs`、`src/bridge.js`、`src/scheduler/`、`pages/sessions/` | 同一时刻两个群可分别跑 v1/v2；改运行模式后下一次唤醒重建且工具集正确；主动被拒时任务跳过并通知；`test-session-mode` 全过 |
| P3 多管理员 | `admins[]`、capability、审批多人、通知、closed-agent 级别、审计 actor、访问页 | `src/admin/`、`src/bridge.js`、`pages/access/`、`pages/sessions/` | 管理员能审批但不能改全局模式/权限/名单；owner 可增删管理员；审计有 actor；`test-admins` 全过 |

### 11.1 任务清单（执行时逐项勾，防止跳步）

**P0 稳定性**

- [ ] 统一 RPC 错误分类：识别 `session/not-found`（code 与 message 两种形态），其它错误不触发重建。
- [ ] `ensureSession` 创建后写标题；标题规则集中在一处，详情页改标题复用。
- [ ] 自愈：prompt / selectModel / follow 失败 → 退役 → 重建 → 重试一次；同会话 60 秒 3 次失败暂停并告警。
- [ ] 启动对账：`sessions.list` 与 `bindings` 比对，缺失标 `missing`、超时标 `unknown`，不阻断启动。
- [ ] `POST /api/sessions/<key>/rebuild`、`GET /api/sessions/<key>/dsh`；控制台只读状态 + 重建按钮。
- [ ] `scripts/test-session-lifecycle.mjs`：删除后自愈、对账、标题、只重试一次。

**P1 档案与详情页**

- [ ] `src/session/profiles.mjs`：schema、默认值、读取/合并、三态解析、`blocked` 优先。
- [ ] `src/session/access.mjs`：被动/主动判定唯一入口；替换旧 `allowed()` 调用。
- [ ] `sessions.json` v2 迁移：旧绑定、人格、提示词、唤醒、allow/deny → 新结构；成功后删旧文件/旧键。
- [ ] 迁移幂等与失败保护：`.tmp` + rename；失败保留旧文件并报错，不产生 `.bak`。
- [ ] 控制台列表改并集数据源；筛选、搜索、新增会话、行操作。
- [ ] 详情子页 `#sessions/<key>`：P1 八卡、每卡独立保存、脏值守卫、返回保留筛选。
- [ ] 迁走 persona / social-v2 / access 的按会话入口；旧入口删除，不留死链。
- [ ] 双清空动作：重建 DSH 会话 / 重置会话状态（文案、勾选项、权限）。
- [ ] `test-session-profiles.mjs` + `test-session-migrate.mjs` + UI 用例。

**P2 运行模式与模型**

- [ ] 列出全部 `currentMode === …`、`modeAllowed(`、`modePreset(` 调用点，形成清单后再改。
- [ ] `effectiveMode(key)`：会话覆盖、closed-agent 排他、inactive 语义。
- [ ] 会话级 preset/model 保存校验（安全清单、DSH 目录）与指纹变化重建。
- [ ] 主动检查点：v1/v2 主动发言、scheduler、AI 跨会话工具。
- [ ] 主动被拒的通知与活动日志（任务跳过原因回给创建者）。
- [ ] 详情页 P2 控制项与「下次唤醒生效」提示。
- [ ] `test-session-mode.mjs`：两群 v1/v2 并存、重建、主动拒绝、closed-agent 排他。

**P3 多管理员**

- [ ] `config.admins[]` 归一化与校验（QQ、caps、maxLevel、notify、exemptPassive）。
- [ ] 服务端 capability 校验；owner 独占全局模式/权限/名单/控制台令牌。
- [ ] 审批：同会话任一有 `approve` 的管理员可答复；通知去重；审计 actor。
- [ ] closed-agent：owner/管理员私聊 + 各自 maxLevel。
- [ ] 访问与安全页管理员列表；会话页按权限隐藏/禁用保存。
- [ ] `test-admins.mjs`：越权拒绝、审批、通知、level。

每阶段收尾固定动作：`node scripts/test-console-static.mjs`、`PLAYWRIGHT_MODULE=playwright-core node scripts/test-console-ui.mjs`、`npm run test:audit`、更新 `STATUS.md` 与 `PLAN_DEVIATIONS.md`、一阶段一提交。

## 12. 执行中的偏差与防偏离清单

登记规则见 `PLAN_DEVIATIONS.md`：一旦做法与本文不同，当天登记；影响判据的先改本文再登记。

本轮预先登记的偏差：D7 配置物理合并、D8 删除旧白名单键、D9 备份策略、D10 会话页范围扩大、D11 会话级运行模式、D12 多管理员。

每个阶段收尾必须逐条核对：

- [ ] 没有新增第二条准入路径（`grep` 旧 `allowAllWhenEmpty` / `allowed(` 的其它调用）。
- [ ] 没有保留旧读取分支、旧键、旧文件、`.bak`。
- [ ] 会话级写入没有回写全局配置。
- [ ] 迁移幂等；失败不覆盖原文件。
- [ ] 主动检查点覆盖 scheduler、AI 跨会话工具、v1/v2 主动发言。
- [ ] `currentMode === …` 的调用点清单全部过一遍，没有漏用 `effectiveMode`。
- [ ] 控制台权限在服务端校验，不只隐藏按钮。
- [ ] 门禁数字与 `STATUS.md` 一致；偏差表没有 `未处理` 条目。

## 13. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 会话级运行模式触碰大量全局分支 | P2 前先列 `currentMode` / `modeAllowed` 调用点清单；按清单逐个改，先加矩阵测试再改 |
| DSH 会话被删后无限重建 | 只重试一次；60 秒窗口内 3 次失败暂停并告警 |
| 迁移写坏 state | `.tmp` + rename；失败保留旧文件；迁移前人工快照放仓库外并限期删除 |
| 旧配置残留导致“两个真相” | 迁移后删除旧键；启动校验 version；grep 门禁 |
| 会话级模型与全局目录不一致 | 保存前校验 DSH 目录；不在目录中拒绝保存；明确“下次唤醒生效” |
| 多管理员提权 | owner 保留最高权限；管理员不能改模式/权限/名单；审计 actor |
| 控制台单 token 与多管理员冲突 | P3 只做服务端身份与权限，控制台多账号另立项；在此之前控制台操作视为 owner |
| 主动拒绝静默失败 | 定时任务/主动唤醒拒绝时写日志并通知创建者 |

## 14. 变更记录

- 2026-11-07：初稿。确定双轴三态、会话级运行模式、P1/P2 覆盖清单、v2 单文件、无备份/无旧读、双清空动作、owner+管理员。
