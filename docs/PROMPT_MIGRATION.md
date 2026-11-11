# 提示词迁移：原始备份、逐段对照与合并清单

> 时间：2026-11-11。范围：旧 5 个 DSH 预设的 persona 提示词、新的 4 个能力预设、`config/platform/qq.yml`、`config/behaviors/*.yml`。
> 目的：在动任何提示词之前，先把原始文本逐字备份，并给出「每一段从哪里来、到哪里去、怎么合并」的完整清单。
> 设计口径见 `docs/CAPABILITY_UNIFY_SPEC.md` §14（三层拆分与页面骨架）。

## 1. 原始提示词现在在哪

| 位置 | 内容 | 形态 |
| --- | --- | --- |
| `dsh/agent-presets/qq-chat/agent.cordis.yml` | 一代仿真全部提示词（persona.prefix，2318 字） | 手写原件 |
| `dsh/agent-presets/qq-chat-v2/agent.cordis.yml` | 二代仿真全部提示词（9405 字） | 手写原件 |
| `dsh/agent-presets/qq-agent-readonly/agent.cordis.yml` | L1 运维 Agent 提示词（712 字） | 手写原件 |
| `dsh/agent-presets/qq-agent-workspace/agent.cordis.yml` | L2 运维 Agent 提示词（733 字） | 手写原件 |
| `dsh/agent-presets/qq-agent-full/agent.cordis.yml` | L3 运维 Agent 提示词（727 字） | 手写原件 |
| `dsh/agent-presets/agent-{chat,readonly,workspace,full}/agent.cordis.yml` | 新能力的运行文件（420–477 字，只含安全边界） | 由 `capability.yml` 生成 |
| `dsh/agent-presets/<id>/capability.yml` | 能力源：`safety.*` + `prompt.base` | 新体系唯一源 |
| `config/platform/qq.yml` | P10.5 从 qq-chat-v2 抽出的「工具协议 + QQ 场景」共 8854 字 | 过渡落点（要收敛） |
| `config/behaviors/social-v1.yml`、`social-v2.yml` | 只有节奏参数，**没有 prompt** | 待新增 `prompt` |

## 2. 备份（已执行）

- 目录：`docs/archive/prompts/2026-11-11/`
- 内容：5 个旧预设的 `agent.cordis.yml` 原件、逐字提取的 `<id>.persona.md`、各预设的 `preset.yml` / `extensions.yml` / `qq-*.mjs` 守卫、`platform-qq.yml`、两个行为档案，共 **46 个文件**。
- 完整性：`SHA256SUMS.txt`（sha256 + 文件名）与 `manifest.json`（字节数、生成时间）。
- 还原方法：按 `SHA256SUMS.txt` 校验后，把 `<id>.<file>` 复制回 `dsh/agent-presets/<id>/<file>`；`platform-qq.yml` → `config/platform/qq.yml`；`behavior-*.yml` → `config/behaviors/`。
- 说明：备份是**逐字节原件**，不含任何改写；迁移完成前不要删除该目录。

## 3. 逐段对照（段落 → 去向）

### qq-chat

| 段落 | 字数 | 去向 |
| --- | ---: | --- |
| （前言 / 头句） | 54 | 保留在 `agent.cordis.yml` 的 persona 头句（不迁移） |
| 【QQ 群聊模式 —— 安全规则（最高优先级，不可违反）】 | 442 | → `dsh/agent-presets/agent-chat/capability.yml > safety`（v1/v2 两段取并集） |
| 【QQ 场景规则】 | 1156 | → `config/platform/qq.yml`（运维场景小节；聊天场景同名段去重） |
| 【发送与汇报禁令（违反即严重违规）】 | 666 | → `config/platform/qq.yml`（v1 666 字更详细，保留并去重） |

### qq-chat-v2

| 段落 | 字数 | 去向 |
| --- | ---: | --- |
| （前言 / 头句） | 54 | 保留在 `agent.cordis.yml` 的 persona 头句（不迁移） |
| 【二代仿真模式 —— 安全规则（最高优先级，不可违反）】 | 287 | → `dsh/agent-presets/agent-chat/capability.yml > safety`（v1/v2 两段取并集） |
| 【二代仿真模式 —— 工具协议（最高优先级）】 | 3213 | → `config/behaviors/social-v2.yml > prompt`（引擎语义） |
| 【操作即动作，不是 API】 | 173 | → `config/platform/qq.yml` |
| 【群聊不是客服队列】 | 276 | → `config/platform/qq.yml` |
| 【反 AI 味：拒绝有求必应】 | 372 | → `config/platform/qq.yml` |
| 【保持主体性】 | 259 | → `config/platform/qq.yml` |
| 【该说/不该说】 | 278 | → `config/platform/qq.yml` |
| 【主动开话题（冷场/没人说话时）】 | 306 | → `config/platform/qq.yml` |
| 【等、回与沉睡前观察】 | 1262 | **拆**：`qq_wait_for_messages` 用法与静默参数 → `social-v2.yml > prompt`；社交判断（何时不硬接）→ `config/platform/qq.yml` |
| 【分条与节奏】 | 468 | → `config/platform/qq.yml` |
| 【像真人一样漏看/迟到/离场】 | 182 | → `config/platform/qq.yml` |
| 【记忆卫生】 | 151 | → `config/platform/qq.yml` |
| 【认人：只认 QQ 号】 | 523 | → `config/platform/qq.yml` |
| 【模式切换只能由管理员确认】 | 237 | → `config/platform/qq.yml` |
| 【学习群友策略】 | 203 | → `config/platform/qq.yml` |
| 【不要当群管家/主持人】 | 126 | → `config/platform/qq.yml` |
| 【QQ 场景规则】 | 618 | → `config/platform/qq.yml`（运维场景小节；聊天场景同名段去重） |
| 【发送与汇报禁令（违反即严重违规）】 | 417 | → `config/platform/qq.yml`（v1 666 字更详细，保留并去重） |

### qq-agent-readonly

| 段落 | 字数 | 去向 |
| --- | ---: | --- |
| （前言 / 头句） | 54 | 保留在 `agent.cordis.yml` 的 persona 头句（不迁移） |
| 【QQ 运维 Agent · L1 本地只读】 | 96 | → 对应能力 `capability.yml > prompt.base`（保留该级的权限表述） |
| 【权限边界（由桥接与工具守卫硬性执行，不是建议）】 | 357 | → 对应能力 `capability.yml > safety`（与该级工具面一致） |
| 【QQ 场景】 | 205 | → `config/platform/qq.yml`（运维场景小节；聊天场景同名段去重） |

### qq-agent-workspace

| 段落 | 字数 | 去向 |
| --- | ---: | --- |
| （前言 / 头句） | 54 | 保留在 `agent.cordis.yml` 的 persona 头句（不迁移） |
| 【QQ 运维 Agent · L2 工作区读写】 | 97 | → 对应能力 `capability.yml > prompt.base`（保留该级的权限表述） |
| 【权限边界（由桥接与工具闸门硬性执行）】 | 389 | → 对应能力 `capability.yml > safety`（与该级工具面一致） |
| 【QQ 场景】 | 193 | → `config/platform/qq.yml`（运维场景小节；聊天场景同名段去重） |

### qq-agent-full

| 段落 | 字数 | 去向 |
| --- | ---: | --- |
| （前言 / 头句） | 54 | 保留在 `agent.cordis.yml` 的 persona 头句（不迁移） |
| 【QQ 运维 Agent · L3 高权限】 | 95 | → 对应能力 `capability.yml > prompt.base`（保留该级的权限表述） |
| 【权限边界（由桥接与工具闸门硬性执行）】 | 385 | → 对应能力 `capability.yml > safety`（与该级工具面一致） |
| 【QQ 场景】 | 193 | → `config/platform/qq.yml`（运维场景小节；聊天场景同名段去重） |


## 4. 合并规则（决定“谁覆盖谁”）

1. **安全段合并**：`qq-chat` 的 442 字与 `qq-chat-v2` 的 287 字取**并集**（逐条比对，重复条目只留一份，措辞以更严格的一条为准），写入 `agent-chat/capability.yml > safety.rules`；`agent-*` 的「权限边界」段按级各自保留，不与聊天能力的合并。
2. **平台话术去重**：`QQ 场景规则`（v1 1156 / v2 618）与 `发送与汇报禁令`（v1 666 / v2 417）是同一主题的两版，**保留更完整的 v1 文本**，把 v2 里 v1 没有的条目补进去；其余 v2 段落按顺序拼接。
3. **引擎语义只留行为档案**：v2 的「工具协议」（3213）整段进 `social-v2.prompt`；「等、回与沉睡前观察」（1262）按工具用法 / 社交判断拆成两半，分别进 `social-v2.prompt` 与 `platform/qq.yml`。
4. **v1 语义必须补写**：`social-v1.prompt` 新增 300–500 字，写清「文本会自动转发、`[SILENT]` 表示不说、不需要调发送工具」；这是 qq-chat 与 qq-chat-v2 合并成 `agent-chat` 后，一代引擎唯一的语义来源。
5. **运维 Agent 三段**：「运维 Agent·L1/L2/L3」进各自 `capability.yml > prompt.base`；「权限边界」进各自 `safety`；「QQ 场景」进 `platform/qq.yml` 的运维小节（与聊天场景并列，不合并）。
6. **不迁移**：persona 头句（`You are a coding agent…`）保留在 `agent.cordis.yml`，由生成器统一加。

## 5. 目标体量（去重后预估）

| 目标 | 现状 | 迁移后预估 |
| --- | --- | --- |
| `config/platform/qq.yml` | 8854 字（v2 抽取） | 约 6000–6500 字（并入 v1 的 1824 字、去重后） |
| `config/behaviors/social-v2.yml > prompt` | 0 | 约 3800–4200 字（工具协议 3213 + 等回拆分约 700） |
| `config/behaviors/social-v1.yml > prompt` | 0 | 约 300–500 字（新写） |
| `agent-chat/capability.yml > safety` | 420 | 约 600–700 字（442 ∪ 287） |
| `agent-{readonly,workspace,full}/capability.yml` | 461 / 468 / 477 | 约 700–760 字（现有安全段 ∪ 各自权限边界） |

## 6. 执行与校验

1. 迁移脚本读 `docs/archive/prompts/2026-11-11/*.persona.md`，按上表写入目标文件（幂等，重复执行不追加）。
2. 校验：`node scripts/test-capability-unify.mjs`（不得出现平台话术进能力）、`node scripts/build-capability-artifacts.mjs --check`、`grep -n "【" dsh/agent-presets/agent-*/agent.cordis.yml` 只允许出现安全段标题。
3. 人工抽样：v1 的 `[SILENT]`、v2 的「必须调发送工具」、平台的「发送禁令」各出现一次且仅一次。
4. 回滚：从备份目录复制回原文件；`state/` 与 `~/.dsh/.agent-presets` 不受本迁移影响（旧预设未删除，也不重新安装）。

## 7. 待确认

- 「等、回与沉睡前观察」的拆分比例：我按“工具用法 / 社交判断”粗切成两半，具体句子在 P10.9.7 执行时逐句归类，可能有一两句归属调整。
- 平台话术里 v1/v2 的「发送与汇报禁令」是否合成一节，还是保留两小节（v1 聊天 / v2 仿真）便于对照；我倾向前者合成一节，用注释标出仅在仿真生效的条目。

## 8. 生成物的边界（与迁移同步核对）

迁移只改「源文件」，产物由生成器派生：

- 源：`dsh/agent-presets/<id>/capability.yml`（能力工具面 + 安全开关 + 身份底稿）、`config/platform/<platform>.yml`（平台话术）、`config/behaviors/<id>.yml > prompt`（引擎语义）。
- 产物：`preset.yml`（名字/顺序）、`agent.cordis.yml`（插件行 + 安全段与身份底稿）、`extensions.yml`（MCP/技能白名单）。
- 迁移执行后必须跑 `build-capability-artifacts --check`；产物里不得出现源文件没有的属性（行参数、顺序、安全段文字都要有来源，见 SPEC §14.7）。
- 旧 `qq-*` 预设原件已备份，迁移完成后删除（避免与 `agent-*` 双份知识）。
