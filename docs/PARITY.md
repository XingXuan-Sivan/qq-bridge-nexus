# PARITY：nexus 与 enhanced（手改版 / 上游新版）能力对齐与迁移评估

> 目的：把「nexus 还差什么、要不要补、怎么补」从口头讨论变成一张可复核的表。
> 用法：每次讨论「搬/补/重设计」先回到这里，逐条更新；结论只用四种：**保持 / 补齐 / 重设计 / 待定**。
> 证据要求：写 `文件:行` 或 release tag；没有证据的一律标「未核实」，不许写成结论。

## 1. 三条基线

| 代号 | 是什么 | 版本 / 提交 |
|---|---|---|
| **E-手改** | 你现在在用的 `qq-bridge-enhanced`，基于**旧版** enhanced 手改 | HEAD `a07f50d` + 《未提交改动 4 个源码文件》 |
| **E-上游** | enhanced 官方最新版（`h-D-ACE/dsh-qq`） | **v1.1.2**（2026-10-29） |
| **N** | 本次重构的 `qq-bridge-nexus`，基于 E-上游 v1.1.2 重写 | 分支 `feat/plugin-kernel` |

关键前提（用户 2026-11-06 说明）：E-手改 里手加的机制，有一部分在 E-上游 新版本里**已经原生具备**（只是实现方式不同）；因此评估顺序是「先看新版有没有、再看要不要用 nexus 的插件方式重做」，不是「照搬手改版」。

## 2. E-手改 到底改了什么（证据：`git -C qq-bridge-enhanced diff HEAD`）

46 个文件有差异，但**实质只有 4 个源码文件**：

| 文件 | 改动 | 解决什么问题 |
|---|---|---|
| `src/bridge.js`（+204 行） | ① `rotateIfPersonaChanged()` 人格守卫；② `personaSlots` 人格槽位；③ `POST /api/session/rotate`；④ 会话命名 D1（`sessions.rename`） | 换人格后旧会话还在用旧卡；切回人格想复用旧会话；侧栏标题难看 |
| `src/commands/builtins.js`（8 行） | `/人设 use <角色> [目标]` 目标可省略＝当前会话 | 少打一个参数 |
| `src/persona/service.js`（5 行） | 写绑定用 `action:'switch'`（旧绑定自动解） | 避免先 unbind 再 bind 的两步竞态 |
| `src/mcp-snowluma-safe.js`（6 行） | `messages` 收紧成 `z.array(z.string()).min(1)` | 防模型传裸字符串 |

## 3. 维度清单（核心表）

| # | 维度 | E-手改 | E-上游 v1.1.2 | N 现状 | 结论 |
|---|---|---|---|---|---|
| D1 | 按会话（群/私聊）分别设人格卡 | 手加 | **原生**（`byKey`） | **有**（`/api/roles/assign` + 控制台按会话设置） | 保持 |
| D2 | 切换角色入口 | `/人设 use` 写 soulkit 绑定；控制台 | `/role` 按会话改本地卡；全局只在控制台 | 本地卡：`/role` + 控制台**有**；soulkit 卡：**只读**（provider 无写绑定能力） | **补齐（待决策 D1）** |
| D3 | 换人格是否换会话 | 可轮换 / 可槽位复用 | 不换会话：指纹变了下次唤醒重读全文 | 同 E-上游（`src/role-refresh.js`） | **保持或补齐（待决策 D2）** |
| D4 | 人格提示词注入位置 / token 浪费 | 从「每轮全量注入」改成「系统提示词注入」 | v1.1.0 改为「指纹 + 只在变化时注入」；v1.1.1 把黑话/表情块也做成指纹注入（`state/prompt-blocks.json`）；v1.1.1 长会话自动压缩 | 同 E-上游：唤醒提示按需带卡（`bridge.js:11302-11303` `roleRefresh.markSeen`）、`core-skills`/`core-stickers`/`core-digest` 块化注入 | **保持（需实测 token 曲线）** |
| D5 | 工具列表 / 功能写死、不可扩展 | 直接改源码 | v1.1.x 仍是内置工具表 | **已解决**：插件内核 + 命令注册表 + 注入块 + 任务类型（`docs/PLUGIN_KERNEL.md`） | 保持（nexus 优势） |
| D6 | 人格 / 记忆与 soulkit 联动 | 写死直连 soulkit | 无（上游不认识 soulkit） | 插件 provider 只读取卡（`plugins/soulkit-persona`）；`core-digest` 记忆摘要 | **补齐（待决策 D1/D4）** |
| D7 | 专门的会话管理页面 | 无 | 无 | **无**（现有 15 页里没有"会话"页） | **重设计（参考 AstrBot）** |
| D8 | 会话标题（群名＋人格名） | 手加（D1 命名） | 无 | **无**（`grep sessions.rename` 0 命中） | **补齐（低成本）** |
| D9 | `messages` 严格数组 | 手加 | 无 | **无**（`src/mcp-snowluma-safe.js:676` 仍是 union） | **待定（本次决定：先不动）** |
| D10 | 部署切换（MCP 指向） | — | v1.1.2 升级不需要重跑 setup | MCP 区块指向 E-手改 的脚本（`~/.dsh/profiles/desktop/cordis.patch.yml:141-185`）⇒ 回复打到 3100 | **补齐（切换脚本）** |
| D11 | 数据迁移（绑定/会话/模式/任务/黑话/表情） | — | 升级不迁格式 | 无迁移工具（`scripts/import-enhanced.mjs` 未写） | **补齐（切换前）** |

### D1 按会话人格卡：为什么判「保持」

- E-上游 v1.1.2 的原生实现：`state/current-role.json` 增 `byKey`，值为 `null` 表示「这个会话不挂卡」；`/role 名字|off|default` 只作用于当前会话；全局人格只能在控制台改；`POST /api/roles/assign` 只开给控制台，AI 令牌一律拒绝。
- N 的等价物：`src/bridge.js:4926` `/api/roles/assign` + `public/console/pages/persona/` 的「按会话设置」；`/role` 命令按会话（27 处引用）。
- 结论：**功能不缺**，缺的是「当人格来源是 soulkit 时，按会话切换谁」——见 D2/D6。

### D2/D6 soulkit 人格与记忆：真正的缺口

现状（真机证据，2026-11-05 23:47）：

- `plugins.json` 里 `persona.provider = soulkit`；`/api/persona/sources` 返回 `private:2897715886 → source: 'provider', name: '魅魔2'` ⇒ **N 能从 soulkit 取到按会话的卡**。
- 但 N **没有**写 soulkit 绑定的入口：`grep bindings` 0 命中，`/人设` 命令不存在，`src/persona/service.js` 在 N 里不存在；`GET http://127.0.0.1:3110/api/bindings` 返回 404（正确路径待确认，可能在 `/api/persona/*` 下）。
- 结论：读通了、写没通。要「在 QQ/控制台里换 soulkit 角色」，需要新增一个**可选的 provider 能力**（例如 `persona-bind/1`），由插件实现；内核不写死 soulkit。

### D3 换人格是否换会话：先不动，等真机反馈

- E-手改 的两条路（轮换 / 槽位复用）解决的是「旧会话里还带旧人设」。
- E-上游 与 N 走另一条：**不换会话**，指纹变了下一轮把新卡全文放最前（`src/role-refresh.js`；控制台可选 `nextWake` / `immediate`）。
- 差别：N 省（不丢上下文、不产生孤儿会话），但**不隔离**——旧历史里仍有旧人格的发言。
- 判定：这是产品取舍，不是版本新旧。**先保持**，等真机跑一段看是否真的被旧上下文困扰；需要时再补 `rotate`，那时也知道该轮换还是槽位。

### D4 注入位置与 token：N 已继承上游的两级省钱机制

| 机制 | 上游出处 | N 对应 |
|---|---|---|
| 人格卡只在变化时注入 | v1.1.0 | `role-refresh.js` + `bridge.js:11302` `markSeen` |
| 黑话/表情/记忆块指纹注入 | v1.1.1 | `core-stickers` / `core-skills` / `core-digest`（P4 块化）+ `promptBlocks.decide` |
| 长会话自动压缩 | v1.1.1（默认 30 万 token） | `autoCompactLib`（`src/auto-compact.js`）+ `POST /api/session/compact` |

**待办（实测）**：在真机上量「每个会话每步读多少 token」，对比 E-手改 的曲线，把结论写回本表。目前只有上游自述数据（群 A 679k → 33k），N 未实测。

### D7 会话管理页面：参考 AstrBot

AstrBot 的成熟做法（源码在工作目录）：

- `dashboard/src/views/conversation/ConversationWorkspacePage.vue`：左侧会话列表（可按会话分组）、筛选（关键词 / UMO）、预览面板、批量导出、删除、改标题、翻页、原始数据开关。
- 可借鉴点：**「会话」是一个一等对象**（有标题、有身份、有筛选维度），而不是调试页里的一个表格。

N 的现状：会话相关能力散在「运行总览」「会话与审批」两页，没有「按会话看历史 / 改标题 / 清理」的入口；DSH 侧栏的会话标题也难看（D8）。

### D10/D11 切换与迁移

- D10：`~/.dsh/profiles/desktop/cordis.patch.yml` 的 `# === qq-bridge MCP BEGIN/END ===` 区块指向 E-手改 的 `src/mcp-*.js`；那些脚本按自己的 `ROOT` 读 E-手改 的 `consolePort: 3100` 与 `state/console-token` ⇒ 真机里 AI 的发送工具全部 `ECONNREFUSED 127.0.0.1:3100`。修法：跑 N 的 `scripts/setup-dsh.mjs` 重写该区块，再重启 DSH（会中断当前会话）。
- D11：切换前要迁的数据：`state/persona-bindings.json`、`state/sessions.json`、`state/mode.json`、`state/scheduler.json`、`state/room-*`、`state/slang`、`state/stickers.json`、`roles/*.md`。需要 `scripts/import-enhanced.mjs`：默认 dry-run 对照，`--apply` 才写，写前备份。

## 4. 调研结论

### 已完成

- **E-上游 v1.1.0/1.1.1/1.1.2 逐版读完**（releases.atom）。三条与本议题直接相关：
  1. **按会话人格卡是 v1.1.2 原生能力**，不是只有手改版有；E-手改 的对应实现是「早于官方、写法不同」。
  2. **人格生效**在上游走「指纹 + 下次唤醒注入新卡」，**不换会话**；手改版的 rotate/slots 是另一条路。
  3. **token 浪费**上游分两步治：v1.1.0 治人格卡重复注入，v1.1.1 治黑话/表情块重复注入 + 长会话压缩。N 两条都继承。
- **AstrBot 会话管理页定位**：`ConversationWorkspacePage.vue`（见 D7）。
- **N 的能力盘点**：15 个控制台页面、插件内核、5 类注入块、命令注册表、任务类型、模式闸门、P7 五步收口、`test:audit` 89/89。

### 待完成

- [ ] soulkit 绑定接口的正确路径与语义（`/api/bindings` 404；需要在 soulkit 源码里确认，或在它的控制台里看网络请求）。
- [ ] N 的 token 实测（每会话每步 input tokens），与 E-手改 对比。
- [ ] AstrBot 的会话模型细读（`ConversationWorkspacePage` 的数据结构与接口），产出 N 的会话页信息架构。
- [ ] `scripts/import-enhanced.mjs` 的字段映射表（E-手改 的 `state/*.json` → N 的 `state/*.json`）。

## 5. 需要拍板的决策

| 编号 | 问题 | 选项 | 建议 |
|---|---|---|---|
| **D-1** | soulkit 人格/记忆怎么联动 | A 只读（现状）；B 新增可选 provider 能力 `persona-bind/1`，插件实现写绑定；C nexus 直接调 soulkit API | **B**：内核不写死 soulkit，换实现只换插件 |
| **D-2** | 换人格要不要换会话 | A 不换（现状）；B 补 rotate；C 补槽位 | **A 先保持**，真机反馈后再定 |
| **D-3** | 会话管理页做到什么程度 | A 只读列表；B 列表 + 改标题 + 清理；C 列表 + 历史预览 + 导出（AstrBot 级） | **B 先做**，C 看是否真的需要 |
| **D-4** | 本地卡与 soulkit 卡的主次 | A soulkit 优先、本地卡兜底（现状 provider 缺省回落）；B 本地卡优先；C 二选一显式配置 | **A**，但控制台要能看出「这张卡来自哪」 |

## 6. 与其它文档的关系

- `docs/STATUS.md`：总清单（Done/Partial/Blocked）；本文件的每个维度落地后，回去改那一行。
- `docs/PLUGIN_ROADMAP.md`：nexus 自身功能路线；本文件只讨论「与 enhanced 的对齐」，不重复路线图条目。
- `docs/PLUGIN_KERNEL.md`：插件契约；若 D-1 选 B，新增的 `persona-bind/1` 要写进它的能力表。

## 7. 2026-11-06 决策与补充调研

### 7.1 决策落定（覆盖 §5 的「建议」列）

| 编号 | 决定 | 说明 |
|---|---|---|
| D-1 | **B** | 新增可选 provider 能力 `persona-bind/1`，由插件实现「写绑定」；内核不写死 soulkit |
| D-2 | 先调研再决定 | 调研结论见 7.2，倾向「保持不换会话」 |
| D-3 | **B，且「是否切换会话」做成可配置项** | 会话列表与平台解耦、面板删改与 DSH 同步见 7.3 |
| D-4 | 待评估后讨论 | 见 7.4 |

### 7.2 D-2：换人格是否换会话 —— AstrBot 的做法

- AstrBot **不靠换会话**解决长对话：同一 conversation 内超阈值就压缩上下文（`llm_compress_keep_recent_ratio: 0.15`、`max_context_length`），压缩摘要继续留在原会话；新建会话是用户显式 `/new`（`astrbot/core/conversation_mgr.py:92 new_conversation`）。
- 证据：`astrbot/core/astr_main_agent.py:219,2015,2022`；`astrbot/core/agent_runner.py:22,115-129`。
- 结论：成熟实现（AstrBot）用「压缩 + 手动新建」，不用「自动换会话」。
- 建议：nexus 保持「不换会话」；enhanced 手改版的 rotate / slots 作为**可选增强**（默认关），等真机出现「旧上下文污染新人格」再开。

### 7.3 D-3 拆出的三个新维度

**D12 会话标识与平台解耦**

- 现状：nexus 的 key 是 `group:<id>` / `private:<id>`（`src/session/mode-gate.mjs` 正则 `^(group|private):(\d+)$`），平台隐含为 QQ。
- AstrBot：以 `unified_msg_origin`（UMO）为唯一键（形如 `平台:消息类型:会话id`），所有子系统按同一 key 索引 ⇒ 天然多平台。
- 方案（待批准）：key 改为 `<platform>:<group|private>:<id>`；旧数据一次性迁移（`qq:group:…`）；`mode-gate` 正则同步；控制台会话列表按平台分组。
- 代价：所有以 key 为索引的状态文件（`state/sessions.json`、`persona-bindings.json`、`mode.json`、`social-v2.json`、`scheduler.json` 的 target）都要迁移，一次做干净，之后不再改。

**D13 面板删改 ↔ DSH 会话同步（边界表）**

| 情形 | 行为 |
|---|---|
| 面板删除会话 | 先归档 DSH 会话（`api.workspace.archiveSession`），成功后再删本地映射 |
| DSH 侧 404（已不存在） | 视为成功，继续删本地映射，不报错 |
| 本地有映射、DSH 无会话 | 清理本地映射（孤儿） |
| DSH 有会话、本地无映射 | 列表标「未接管」，提供「接管 / 归档」两个动作 |
| 会话正在唤醒或挂着定时任务 | 先取消挂账与定时任务，再归档 |
| 归档失败 | 保留映射 + 报错；**不回滚本地**（否则出现「面板说删了、DSH 还活着」） |
| 面板改标题 | 只改本地标题表，DSH 侧不动（DSH 没有标题概念） |

- AstrBot 对应做法：`ConversationManager.register_on_session_deleted` 事件钩子，别的模块订阅后清理。nexus 可加等价的 `session.deleted` 本地事件。

**D14 自动轮转（按轮数 / 按天）**

- 调研结论：AstrBot **没有**该功能（`auto.*conversation` 0 命中；`轮转` 2 命中都是日志文件轮转；`新的一天`/`次日` 0 命中）。
- 判断：**不建议默认开启**。理由：① 陪伴产品的价值在连续性，自动换会话＝定期失忆；② 长会话成本已有压缩（v1.1.1 自动 compact）解决；③ 真需要时，「按天归档 + 次日新建（可回看）」比「按轮数」安全——按轮数会和压缩阈值打架。
- 若要做：做成可配置的归档策略（保留旧会话可查），先做「手动归档」验证需求。

### 7.4 D-4：本地卡与 soulkit 卡的主次（待评估）

- 现状：`persona.provider = soulkit` 时 provider 优先，返回 `none` 才回落本地卡（`src/persona-resolve.mjs`）。
- 问题：soulkit 的卡与本地 `roles/*.md` 是两套内容源，同名不同内容时用户无法判断「这张卡哪来的」。
- 待评估：控制台来源页是否显示三级来源（会话覆盖 / provider / 本地卡）与指纹；是否需要「锁定本地卡」开关。

### 7.5 dsh-bundles 手改审计（已完成）

- 方法：逐文件比对 `git show upstream/main:plugins/<f>` 与 `git show HEAD:dsh-bundles/<f>`（12 个文件）。
- 结果：**只有 1 处内容差异**——`qq-agent-presets/protected-paths.mjs` 顶部注释里的路径（`plugins/` → `dsh-bundles/`，本次改名带来的）；其余 11 个文件仅行尾 CRLF 不同。
- 结论：`dsh-bundles/` 里没有手改的功能逻辑；手改都在 `qq-bridge-enhanced` 的 `src/`（已审计 4 个文件）。

### 7.6 扩展便利性（新增计划项，未实施）

缺口清单（每项都要有判据）：

- 插件 UI 面板：`/plugin-ui/<id>/` 沙箱页 + 按插件隔离的鉴权（现为 0 行代码）。
- 插件配置 schema 化：现在是手写 HTML 表单，想要「manifest 声明字段 → 自动渲染」。
- 插件 i18n、依赖与版本约束、命令/工具的静态声明（manifest `commands`）。
- 运行时注册 DSH 工具、MCP 清单：都卡在 DSH 侧能力（见 STATUS 第 2、3 行）。
- 安装来源校验与版本（市场式安装）。

归属：写进 `docs/PLUGIN_ROADMAP.md` §9.4，不混进本次迁移评估。

