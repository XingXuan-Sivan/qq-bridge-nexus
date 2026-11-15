# 消息调度（合批 / 预算 / 档位 / 收尾）

> **本文是消息调度内核的唯一真源**：分层归属、档位定义、参数键、收尾判据、验收指标。
> 状态：合批 / 预算 / 档位 / 收尾 / 堆积触达 / 唤醒固定成本 / 入站在途对齐已上线（N0–N5，含 N4b）。
> 本文只写符号名、不写行号；改实现不需要动这里，改**语义**必须同步这里（见 §13）。

---

## 1. 范围

### 1.1 覆盖

入站消息从「进入会话」到「触发一次模型投递」之间的全部调度语义：

- 合批窗口（多条消息何时合成一次投递）
- 投递预算（一个会话允许多频繁被叫醒）
- 档位与优先级（谁可以让路、谁不能让）
- 未读游标与收尾判据（这一轮到底处理到哪）
- 溢出与漏看记账（缓冲挤掉的消息怎么交代）

### 1.2 不覆盖

| 不属于本文 | 归属 |
| --- | --- |
| 模型、执行体、权限档位 | `EXECUTION_BODY_GENERALIZATION.md` / `SESSION_SUBSYSTEM.md` |
| 准入（被动/主动两轴名单） | `SESSION_SUBSYSTEM.md` §4 |
| 手动静默、定时静默 | 准入层与投递闸门，见 `SESSION_SUBSYSTEM.md` |
| 提示词话术、人格、记忆注入 | 行为档案 `prompt.md` 与 `MEMORY_SUBSYSTEM.md` |
| 分条、连发间隔、长停顿 | 发送侧 `send` 段，与调度无关 |

### 1.3 四条不可破断言

| 编号 | 断言 | 实现落点 |
| --- | --- | --- |
| **A1** | 不调用发送工具永远不算失败。任何调度改造都不得引入「必须发言」路径 | 收尾判据只看「消息是否被处理」，不看「是否说话了」 |
| **A2** | 显式回执是终态，永不再补发 | `cursor` 三态里 `explicitAck` 优先级最高，先判先返回 |
| **A3** | 预算不足只允许降级，不允许丢弃 | `pacing` 打空 → `pendingAmbient` 搭车，不 `return` |
| **A4** | 档位与预算只影响「什么时候叫醒」，不改变「回不回」 | 所有唤醒只是投递 prompt；动作仍由模型自主决定 |

这四条是改造的验收前提：任何一条被破坏，方案即为错误，不接受「先上线再补」。

### 1.4 术语

| 术语 | 含义 |
| --- | --- |
| 入站 | 平台适配器把一条平台消息交给会话 |
| 投递 / 唤醒 | 向执行体投递一次 prompt，形成一次模型回合 |
| 档位（tier） | 本次投递的优先级分类，决定合批上限与预算桶 |
| 显式回执 | 模型带水位调用 `qq_mark_read` 或 `qq_set_wake_config`，表示「我看过这些了」 |
| 搭车（piggyback） | 预算不足时不单独叫醒，把内容并入下一次唤醒的 prompt |
| 溢出（overflow） | 消息因未读缓冲上限被挤出、模型从未被展示过 |
| 直通（pass-through） | 不合批、不限预算的调度策略，供默认 chat 模式使用；与档位 `direct` 同名不同义 |

---

## 2. 分层

### 2.1 三层归属

| 层 | 内容 | 判据 |
| --- | --- | --- |
| **L0 平台侧** | 连接、消息段解析（@群名片、引用、媒体）、发送 | 换一个用户侧平台就要换 |
| **L1 调度内核** `src/scheduling/` | 合批、预算、档位、游标、收尾、溢出记账 | 换平台**不该**改动；换行为档案**不该**改动 |
| **L2 行为档案** | 用哪些原语、参数取值、沉默语义、话术 | 换行为档案或换平台才改 |

**核心中立原则**：L1 里不出现「礼貌」「拟人」「该不该回」这类判断，只出现「投递一次的成本与顺序」。
判断某个改动该放哪一层，只问一句：**换一个平台或换一份行为档案，这段逻辑要不要跟着改？**

### 2.2 三种运行模式在分层里的位置

| 模式 | 调度方式 | L1 参与方式 |
| --- | --- | --- |
| 默认 chat | 无调度，入站直接投递 | 直通策略：窗口 0、预算不设限、不参与收尾判据 |
| social-v1 | 四阶段状态机（观望/活跃/试探/退场）+ 随机拟人停顿 | 接入但零参与：不合批、单桶不启用、游标不启用 |
| social-v2 | 触发条件 → 唤醒调度 | 完整策略 |

三种模式共用同一套 L1 原语，差别只在**策略取值**，不靠分支实现。

### 2.3 参数归属

参数只有一条解析链：**内核兜底 → 平台档案覆盖 → 策略对象**。

- 内核兜底住在 `src/scheduling/policy.mjs` 的 `SCHEDULING_DEFAULTS`
- 平台档案 `profiles/platforms/<id>/behavior-types/social-v2.yml` 是覆盖层，写了某键就以档案为准
- 会话态**不再承载**任何节奏参数；会话只存「桶里还剩多少」（`wake.pacing`）这类运行期状态

注意解析链的边界：行为档案的 `wake:` 段是**整段替换**而不是深合并（`behaviorV2View = { ...cfg.socialV2, ...behavior.config }`），所以档案里没写的子键由 `SCHEDULING_DEFAULTS` 兜底，**不是**由 `defaultSocialV2.wake` 兜底。节奏参数只允许住在这两处之一。

平台档案里保留某个键而内核改了同名默认值，会出现「内核改了、该平台不生效」的反向结果。因此档案只写「这个平台的默认值确实不同」的键，其余一律删除。

---

## 3. 缺陷与目标

### 3.1 缺陷清单（social-v2 专属）

| 编号 | 缺陷 | 表现 |
| --- | --- | --- |
| **D1** | 固定合批窗口对私聊、@、群闲聊一视同仁 | 点名类消息白等一个窗口 |
| **D2** | 固定计数预算，且不论原因 | 低价值唤醒用掉额度后，点名类被推到 45~60 秒后；实测一个运行窗口 90 次唤醒里有 88 次撞限频 |
| **D3** | 暂存队列每个 turn-end 只消费一条 | 连发多条时其余滞留到下一次回合结束；实测同窗口 暂存 148 / 补发 32 / 误跳 49 |
| **D4** | 未命中触发条件时没有任何唤醒源 | 普通群消息可能长时间无人看；再发一条命中条件才被顺手处理 |

D1~D2 造成「响应慢」，D3~D4 造成「消息被略过 / 回复中被吞」。

### 3.2 目标指标

| 指标 | 目标 |
| --- | --- |
| `direct` 入站 → 投递 P90 | < 3s |
| `budgetDenied(direct)` | 0 |
| `directMissed` | 0 |
| 「暂存 : 补发 : 误跳」 | 暂存 ≈ 补发；误跳仅来自 `explicitAck` |
| `ambient` 每小时唤醒次数 | 不高于现状基线（token 不涨） |

---

## 4. L1 内核

三个纯函数模块 + 一个策略解析器。全部不认平台、不认运行模式，输入输出都是普通对象，便于单测与等价性回归。

### 4.1 `batching.mjs` — 动态合批（含硬上限）

```
gap    = now - lastIncomingAt          // 距上一条入站
delay  = min(maxWait - (now - firstAt), max(base, round(0.8 * gap)))
delay <= 0  → 立即投递
```

- 有新消息就续期，但**永不超过 `maxWait`**（AstrBot `tg_adapter` 的 debounce + max_wait 范式）
- 单条消息只等 `base`，不陪跑满 `maxWait`
- `maxWait` 不得大于基线值：动态化只允许变快，不允许变慢
- 状态拆两处：批次态 `pendingWakeBatch = { firstAt, lastAt, tier }` + 提升后的原因 `pendingWakeReason`；原因取批次内最高优先级者
- `adaptiveDebounce=false` 时退化为 `delay = maxWait`，用于等价性回归与排障

### 4.2 `pacing.mjs` — 双桶预算

```
tokens = min(capacity, stored + (now - lastRefillAt) / refillMs)
tokens >= 1 → 扣 1，放行
tokens <  1 → direct：照常投递并记 directOverflow（宁多发一次，不漏）
              ambient：转 pendingAmbient 搭车，不单独叫醒
```

- **桶计的是投递次数，不是消息条数**：合批窗口内十句话合成一次投递，只消耗 1
- `direct` 与 `ambient` 物理隔离，`ambient` 打空永远不影响 `direct`
- `direct` 桶是「异常熔断」而不是「限流」：`budgetDenied(direct)=0` 是正常运行的前提，一旦出现就告警（真人不会一分钟叫 3 次以上）
- `tokens` 必须保留小数（`stored` 落盘），否则回填会取整成 0 而永不恢复
- 桶状态落在会话档案 `profiles/<key>.json` 的 `wake.pacing`，重启不清零（否则重启即可绕过预算）
- 落盘必须保留并列键：`profile.wake = { ...profile.wake, config, pacing }`。整段覆写会把桶一起清掉，结果是每次落盘都回到满桶、预算形同虚设
- 桶状态不暴露给模型，也不作为 `qq_set_wake_config` 的入参；只在 `/api/socialV2/states` 读侧给控制台看剩余额度

### 4.3 `cursor.mjs` — 游标与三态收尾判据

```
explicitAck  lastReadThroughSeq >= seq                     → 终态，不补发（A2）
unreadStill  unread.some(m => m.seq >= seq)                → 必须补发
overflowed   seq 已被挤出且从未展示                         → 记溢出，随下次唤醒告知
```

- 判定顺序必须是 `explicitAck → unreadStill → overflowed`，先判终态
- **turn-end 一次性消费整个 `pendingWakeReasons`**，合并成一条唤醒（原因取最高优先级，附「期间另有 N 次」），不再逐条 shift
- 溢出不再静默跨过：记 `{ count, fromSeq, toSeq, at }`，下一次唤醒的 prompt 里明确写出「有 N 条消息因缓冲上限未被展示」
- 水位仍然推进（否则 `throughSeq` 会被上限校验拒绝而死锁），但推进必须伴随一条溢出记录，不允许无声

### 4.4 策略解析

| 模式 | 策略 |
| --- | --- |
| social-v2 | 完整：两档 + 双桶 + 游标 + 溢出记账 + 堆积触达 |
| social-v1 | 接入但零参与：`adaptiveDebounce=false`、单桶不启用、游标不启用。手感不变，由等价性门禁逐项保证 |
| 默认 chat | 直通：窗口 0、预算不设限、不参与收尾判据 |

策略解析结果是一个普通对象，`bridge.js` 只负责把事件喂给内核、把内核结论执行掉，不再内嵌节奏常量。

---

## 5. 档位

### 5.1 两档定义

| 档 | 包含的唤醒原因 | 理由 |
| --- | --- | --- |
| `direct` | `private`、`atMention`、`ownerRelay`、`speaker` | 明确冲 bot 来的，被其他唤醒挤掉即为事故 |
| `ambient` | `nameMention`、`question`、`keyword`、`poke`、`memberJoin`、`anyMessage`、`probability`、`backlog` | 有价值但不该抢道 |

`poke` 归 `ambient`：群里大量拍一拍是群友互拍，与 bot 无关，不该占用 `direct` 额度。

### 5.2 不设第三档

三档会导致「每个原语各三套参数 + 界面多一列」，而 `nameMention`/`question` 这类介于中间的信号，用「批次内取最高优先级原因」已经足够表达。收益不抵维护成本。

### 5.3 定时器类例外

`timeout`、`replyCheck`、`proactiveCheck`、`scheduled`、`admin`、`silenceEnded`、`roleRefresh`、`bootstrap` 属于**时钟**而非**机会**：

- 不消耗预算、不受桶限制
- 仍经合批与防重入
- 理由：`timeout` 被预算拦住会让会话停在「潜水已到期 + 没有任何定时器」的静默态，是比省一次唤醒严重得多的事故

### 5.4 与准入轴正交

档位回答「多快、占多少预算」，准入回答「允不允许叫醒」，两条轴互不推导：

| 轴 | 真源 | 取值 | 不满足时 |
| --- | --- | --- | --- |
| 准入轴 | `WAKE_REASON_AXES`（`src/session/access.mjs`） | `passive` / `proactive` / `operator` | 丢弃，不投递 |
| 档位轴 | 本文 §5.1 | `direct` / `ambient`；时钟类走 §5.3 | 降级或搭车，不丢弃（A3） |

- 新增一个唤醒原因必须**两侧同时登记**：漏登记准入会被主动轴拦掉（失败关闭），漏登记档位会落到 `ambient`
- `scripts/test-session-proactive.mjs` 扫描 `src/bridge.js` 与 `src/social/conversation-events.js` 的原因字面量，漏登记直接失败；本文 §5.1 与它必须同批改
- `backlog` 归 `passive`：触发源是别人发来的消息，被动轴关闭的会话不会被堆积触达叫醒
- 两轴唯一的耦合是顺序：先过准入，再算档位与预算；预算宽裕不能补偿准入拒绝

---

## 6. 参数（唯一真源）

### 6.1 键名规则

| 形式 | 形态 | 示例 |
| --- | --- | --- |
| 落盘键 | `config.wake.<name>`，**两段** | `config.wake.directMaxWaitMs` |
| 表单字段 | `wake_<name>` | `wake_directMaxWaitMs` |
| 允许的层级 | 最多两段 |

`readBehaviorForm` 对字段名只做一次 `split('_')`，三段及以上会在写回时静默丢数据；深层结构只能在 `src/scheduling/` 内部规整，不落盘。

### 6.2 参数表

| 键 | 核心默认 | QQ 档案 | 语义 |
| --- | --- | --- | --- |
| `wake.adaptiveDebounce` | `true` | 不写（继承） | 动态合批开关；`false` = 固定 `maxWait` |
| `wake.directBaseMs` | `1200` | 不写 | `direct` 单条消息的最短等待 |
| `wake.directMaxWaitMs` | `3000` | 不写 | `direct` 的合批硬上限 |
| `wake.ambientBaseMs` | `4000` | 不写 | `ambient` 单条消息的最短等待 |
| `wake.ambientMaxWaitMs` | `8000` | 不写 | `ambient` 的合批硬上限（取现状窗口，不允许更长） |
| `wake.directBudgetCapacity` | `3` | 不写 | `direct` 桶容量（突发） |
| `wake.directRefillMs` | `20000` | 不写 | 每回填 1 个 `direct` token 的间隔（= 3/分） |
| `wake.ambientBudgetCapacity` | `6` | 不写 | `ambient` 桶容量（突发） |
| `wake.ambientRefillMs` | `300000` | 不写 | 每回填 1 个 `ambient` token 的间隔（= 12/时） |
| `wake.backlogEnabled` | `true` | 不写 | 堆积触达开关 |
| `wake.backlogWakeAfter` | `3` | 不写 | 连续多少条未触发过唤醒才触达 |
| `wake.backlogQuietMs` | `60000` | 不写 | 最后一条入站后静默多久才触达 |

`ambient` 的 `refillMs=300000` 刻意与基线长期速率对齐：买到的只是**突发容忍度**，长期唤醒量不变，token 不涨。

### 6.3 删除的键与路径（不保留双读）

| 删除项 | 出现位置 | 处理 | 批次 / 状态 |
| --- | --- | --- | --- |
| `batchWindowMs`（会话态） | `defaultWakeConfigV2`、`scheduleWakeV2`、`/api/socialV2/wake-config` 的入参白名单 | 字段删除；旧档案里的残留键读到即丢弃 | N2 已完成 |
| `config.batchWindowMs` | MCP 工具 `qq_set_wake_config` 的 schema | 从工具 schema 删除，模型不再能改自己的调度窗口 | N2 已完成 |
| `wake_batchWindowMs` | 行为档案字段表 `behaviors/kinds/v2.mjs`、QQ 档案 | 删除 | N2 已完成 |
| `maxWakePerMinute` / `maxWakePerHour` | `defaultSocialV2.wake`、限频分支、字段表、QQ 档案 | 删除，由双桶替代 | N1 已完成 |
| `wakeTimes`（会话态数组） | 会话状态、落盘、`/api/socialV2/states` 间接暴露 | 删除，由 `wake.pacing` 桶状态承载 | N1 已完成 |
| 兼容双读 | — | **不实现**：旧键读到即丢弃，不做新旧并行 | — |

---

## 7. 收尾与沉默

### 7.1 沉默出口清单（必须原样保留）

| 出口 | 生效范围 |
| --- | --- |
| 本轮不调发送工具 | 所有模式 |
| `qq_mark_read`（带水位） | social-v2 |
| `qq_set_wake_config`（可带水位） | social-v2 |
| `[SILENT]` 标记 | 仅 social-v1 |
| 手动静默（full / sendOnly，按环节） | 全部 |
| 定时静默（`stopWakes` / `directWakes` / `recordMessages`） | 全部 |
| 概率门槛与无行动门槛 | social-v2 |

任何新增唤醒路径都必须先通过这七条的检查：**唤醒 ≠ 要求回复**。

### 7.2 显式回执是唯一强信号

`[SILENT]` 在 social-v2 被禁用，「不调发送工具」是**没有动作**而不是一个状态。调度层因此分不清「看过决定不回」与「根本没看到」。

本文确立：**带水位的显式回执 = 看过并决定不回，是终态（A2）；没有回执 = 尚未处理，必须补。**
这一步让"可以不回"从「副作用」变成「被尊重、被记录的终态」，而不会把沉默扭成条条都回。

### 7.3 合并唤醒

turn-end 把所有暂存原因合并成**一条**唤醒：

- 原因取批次内最高优先级（便于模型理解「为什么被叫」）
- 附「期间另有 N 次唤醒机会被合并」计数
- 只消耗对应档位的 1 个 token

### 7.4 溢出交代

未读缓冲上限保持 `context.unreadLimit=30` 不变（提高上限会挤占内联注入预算 `wakeMaxChars`，属于另一条预算线）。溢出改用告知：

- 记录 `{ count, fromSeq, toSeq, at }`
- 下一次唤醒的 prompt 明确写出「有 N 条消息因缓冲上限未被展示」
- 溢出事件进入审计，而不是从日志里消失

### 7.5 入站在途对齐

**问题**：一条消息从「收到」到「记进未读」之间隔着几次等待（引用原文最远等 `REPLY_INGEST_WAIT_MS`，群名片解析也是一次往返）。§7.2 / §7.3 的两个判活点都读未读缓冲 —— 它们若落在这段窗口里，读到的是一个「还不存在这条消息」的世界：prompt 里没有它，补偿也判成「没有未读」。

**做法**：给入站登记在途标记（按会话，进程内），两个判活点在读未读**之前**先对齐：

| 判活点 | 对齐方式 |
| --- | --- |
| 唤醒投递（`deliverPromptNow` 的唤醒分支） | `await` 在途入站全部落地后再拼 prompt |
| 回合结束补偿（`replayPendingWakeReasonsV2`） | 三态判定前顺延一轮，落地后重跑；只顺延一次，避免洪峰下无限后推 |

**边界**：

- 等待上限取 `REPLY_INGEST_WAIT_MS`（入站自己允许卡住的最大值），超时照常往下走 —— 宁可少带一条，不能把唤醒卡在网关手上。
- 只对齐同一个会话；别的会话的入站不拖慢这一枪。
- 它只影响时序，不改变「回不回」：不进未读、不叫醒的路径（命令、审批回答、插件丢弃）照原样返回。

---

## 8. 堆积触达

**原语在 L1，开关与阈值在 L2。**

L1 只提供能力：当「距上次成功唤醒后新增入站 ≥ `backlogWakeAfter` 条」且「最后一条入站后静默 ≥ `backlogQuietMs`」时，产生一次 `backlog` 原因的 `ambient` 唤醒。

- 该唤醒受 `ambient` 桶约束，不占用 `direct` 额度
- prompt 里写明来由：`wakeTaskTextFor` 的 `backlog` 分支给出【补看积压】段（「无人点名，只是消息积压到阈值」「看一眼即可，不必接话」），不让它看起来像一次被点名
- 默认值：social-v2 开（3 条 / 60s），social-v1 关，chat 不适用
- 准入轴上归 `passive`（触发源是别人的消息），被动轴关闭的会话不会被它叫醒，见 §5.4
- 它只解决 D4 的「没有唤醒源」，不强制任何回复动作（A1/A4）
- 它与 `probability` 共用同一个 `ambient` 桶：热闹群里额度本来就被概率唤醒吃满，它基本加不进来；安静群里它填的是闲置额度（上限仍是回填速率 12 次/小时）

---

## 9. 界面与文档同步

### 9.1 界面

| 改动 | 文件 | 状态 |
| --- | --- | --- |
| 字段表：删 3 个旧键、新增 12 个两段扁平键（新开「投递节奏」分组） | `src/behaviors/kinds/v2.mjs` | 已完成 |
| 档案：删 3 个旧键，新键一律不写（继承内核默认）；字段表与实例/默认值两份档案同批改 | `profiles/platforms/qq/behavior-types/social-v2.yml`、`behaviors/social-v2.yml`、`.defaults/social-v2.yml` | 已完成 |
| 表单：数字字段缺省留空、空值不写键 —— 否则新增的 12 个数字键会首存即被写成 0，合批窗口归零 | `public/console/pages/platforms/behavior-form.js` | 已完成 |
| MCP：`qq_set_wake_config` 的 schema 删 `batchWindowMs`，模型不再能改自己的调度窗口 | `src/mcp-snowluma-safe.js` | 已完成 |
| 唤醒卡片：文案改指平台行为档案；只读行（两档 token、暂存、未读溢出）从 `/api/socialV2/states` 读 | `public/console/pages/sessions/page.js` | 已完成 |
| 不动字段表：v1 的调度策略由 `kind` 固定为零参与，不开开关，避免出现设了也无效果的配置项 | `src/behaviors/kinds/v1.mjs` | 已完成（未加任何节奏键） |
| `/api/socialV2/states` 的 `wakeConfig` 不再含 `batchWindowMs` | `src/bridge.js` | 已完成 |

`renderFields` 通用渲染，页面 HTML/CSS 零改动。

### 9.2 文档

| 文档 | 同步内容 |
| --- | --- |
| 本文 | 参数、档位、批次状态的唯一真源 |
| `SESSION_SUBSYSTEM.md` | 唤醒章节改为指针（准入、投递闸门仍留在原处）；§4.3 的 `WAKE_REASON_AXES` 增补 `backlog`，归 `passive`；§6 会话详情清单里「更细的批次窗口等参数仍在『二代仿真』页」改为指向平台行为档案 |
| `PROFILES_MODEL.md` | 参数归属：节奏参数不再落会话态 |
| `docs/README.md` | 索引状态随批次推进更新 |
| `CHANGELOG.md` | 按批次记录，不逐条复制本文 |

---

## 10. 批次

| 批次 | 内容 | 手感变化 | 关键门禁 | 状态 |
| --- | --- | --- | --- | --- |
| **N0** | 建 `src/scheduling/` 三模块 + 策略解析；`bridge.js` 改为经内核调度；参数从内核默认 + QQ 档案解析 | 无（等价搬迁） | 等价性回归逐项一致；既有门禁全绿 | 已完成 |
| **N1** | 双桶预算替代固定计数；定时器类脱离预算；`ambient` 打空转搭车 | 有 | `budgetDenied(direct)=0` | 已完成 |
| **N2** | 动态合批替代固定窗口；删会话态窗口字段与 MCP 入口 | 有 | `direct` P90 < 3s | 已完成 |
| **N3** | 三态收尾判据 + 全量消费 + 溢出交代 | 有 | 暂存≈补发；误跳仅来自 `explicitAck` | 已完成 |
| **N4** | 人格/记忆预热并行；入站解析并行；堆积触达原语 | 有 | 唤醒固定成本 ≤ 400ms | 已完成 |
| **N4b** | 入站在途对齐：唤醒与回合结束补偿先等正在解析的入站记账落地 | 无（只影响时序） | 「引用解析中到达的消息不被跨过」用例通过 | 已完成（见 §7.5） |
| **N5** | v1 接入（零行为变化）+ 界面 + 文档 + 复核 §6.3 已全部删除 | v1 无 | `check-profiles`、控制台门禁 | 已完成 |

每批独立提交、独立验收；**删除清单在对应批次内完成，不跨版本遗留**。

---

## 11. 验收

### 11.1 等价性门禁（N0 必须项）

`scripts/test-scheduling.mjs` 两层断言：

- 内核纯函数逐项：`batchDelayMs`（含硬上限与 `adaptiveDebounce=false` 退化）、`tighterTier`、`takeToken`/`refundToken`、`normalizePacingState`、`pacingSnapshot`、`classifyPendingWake`、`noteOverflow`/`clearAcknowledgedOverflow`、`resolveSchedulingPolicy`/`tierOf`/`batchLimits`
- 桥接接线：无人点名堆积到阈值才出 `backlog`、投递后计数归零、积压唤醒的 prompt 带【补看积压】且写明可以不接、溢出交代进 prompt、窗口内 @ 把原因升为 `atMention` 且档位转 `direct`、在途入站未落地时唤醒不投递（§7.5）

退化等价由 `adaptiveDebounce=false` 的用例保证：此时 `delay` 必须精确等于该档 `maxWaitMs`，与固定窗口的旧手感逐毫秒一致。它是后续各步的地基：既有门禁（`scripts/test-audit.mjs`）整体不得回归。

### 11.2 指标

| 指标 | 采集点 |
| --- | --- |
| `wakeLatencyP90(tier)` | 入站时间 → 投递时间 |
| `budgetDenied(tier)` | 桶不足次数 |
| `directOverflow` | `direct` 桶打空仍投递的次数（应为 0，非 0 即告警） |
| `directMissed` | `direct` 档消息最终未进入任何回合的数量 |
| `overflowCount` | 被挤出且从未展示的消息数 |
| `piggybackCount` | 搭车投递次数 |

指标写入 `state/scheduling.jsonl`（`noteSchedulingEvent`，封顶 5000 行），供控制台与回归比对：`deliver` / `directOverflow` / `piggyback` / `overflow` / `backlog`。

### 11.3 反向指标（防止过度唤醒）

- `ambient` 每小时唤醒次数不得高于基线
- 单会话每小时总投递次数不得高于基线
- `direct` 与 `ambient` 的 token 消耗分别统计，涨幅超过基线 20% 视为不通过

### 11.4 同批必须改的测试与夹具

| 文件 | 原因 | 状态 |
| --- | --- | --- |
| `scripts/test-audit-regressions.mjs` | 直接构造 `wakeTimes` 占满窗口 | 已重写：R3 改 ambient 桶打空转 `pendingAmbient`，新增 R3b（direct 打空照常投递） |
| `scripts/test-token-economy.mjs` | 直接设置 `wakeTimes` 与 `maxWakePerMinute` | 已重写：用 `ambientBudgetCapacity`/`ambientRefillMs` |
| `scripts/test-quote-forward.mjs` | 用 `batchWindowMs: 60000` 制造窗口 | 已改为 `adaptiveDebounce: false` + `ambientMaxWaitMs: 60000` |
| `scripts/test-v2-initial-prompt.mjs` | 用 `behavior.v2.wake.batchWindowMs` | 已同步 |
| `scripts/test-session-proactive.mjs` | 扫描唤醒原因字面量，未登记 `backlog` 即失败 | `WAKE_REASON_AXES` 已登记 `backlog: passive` |
| `scripts/audit-bridge-harness.mjs` | 需要注入新内核符号；引用解析需要一个能拖慢的 `get_msg` 桩 | 已按命名空间整包注入 `src/scheduling/`；`FakeBot.getMessage` 支持 `fetchDelay.get_msg` |
| `scripts/test-scheduling.mjs` | 内核与接线缺单测 | 已新增并登记进 `test-audit` |

---

## 12. 风险与边界

| 风险 | 处置 |
| --- | --- |
| N0 写成"结构调整但顺手改了行为" | 等价性门禁必须通过后才进 N1 |
| `ambient` 桶回填过慢导致活跃群长期只能搭车 | 搭车仍会看（A3），但需实测手感；回填速率是唯一可直接调的旋钮 |
| 溢出告知把 prompt 撑大 | 只给条数与 seq 范围，不给正文；正文仍受 `wakeMaxChars` 约束 |
| 堆积触达把"可以不回"变成"条条都回" | 它只是多一次「看一眼」的投递；`explicitAck` 仍是终态（A2） |
| 双桶让「热闹群」唤醒变多 | `ambient` 长期速率与基线对齐，只买突发 |

---

## 13. 维护约定

| 你改了什么 | 必须同步本文哪一节 |
| --- | --- |
| 新增/删除/改名参数键 | §6.2 参数表 + 对应行为档案 + 字段表 |
| 新增唤醒原因 | §5.1 档位 + §5.4 准入轴登记（`WAKE_REASON_AXES` 与 `test-session-proactive`） |
| 调整档位归属（某原因换档） | §5.1 |
| 新增沉默出口 | §7.1，并复核 A1–A4 |
| 新增调度原语 | §4，并补等价性回归用例 |
| 新增用户侧平台 | 无需改本文；只需写平台档案（覆盖层只写差异键） |
| 推进批次 | §10 状态 + `CHANGELOG.md` |

本文不写行号、不写函数签名细节：那些由实现与单测承载。
