# 能力预设 · 行为档案 · 工具目录 归一 SPEC

> 状态：**草案，待批准后再动代码**（2026-11-11）。
> 适用仓库：`qq-bridge-nexus` 单仓；前端在 `public/console`。
> 读完这份文档应当能按 §9 的顺序一步一步做完，不需要再猜设计；§0 是当前系统现状，§12 是权限方案，§13 是未完成清单与执行约束。
> 本 spec 推翻 `docs/RESOURCE_MODEL.md` §3.2「内置 id 不改名」与 §5.4 的两列表设计，
> 以本文为准；其余章节（权限矩阵、短时授权、适配器契约）继续有效。

---

## 0. 系统现状（2026-11-11 15:05 复核）

### 0.1 已完成并提交（HEAD `c5a54bf`，标签 `phase/1`–`phase/9.4`）

| 阶段 | 内容 | 提交 |
|---|---|---|
| P1 | 唤醒提示词改由注入块注册表拼装（26 块 / 7 槽位 / 3 档案），golden 逐字节夹具 | `4aef072` |
| P2 | 注入块独立页（清单/开关/上限/预览），插件页移除注入块卡；预算迁 `config.limits.promptBlocks` | `6a0de3c`（与 P3 合并） |
| P3 | `scheduler` / `silence` / `plugins` 设置迁入 `config.json`，状态文件瘦身 | `6a0de3c` |
| P4 | 运行方案数据层（`src/runtime/plans.mjs`、`state/runtime.json`、切换接口） | `52d4514` |
| P5 | 运行方案页（摘要/切换/清单/弹窗编辑器/导入导出），全局配置删运行模式卡，会话详情合并 `detailPlan` | `9bb70c9` |
| P6 | 方案驱动引擎/能力/行为/受众（`planOf`/`planMode`/`audience` 闸门 + `resolveEffectiveMode` 收紧） | `23884e7` |
| P7 | 行为 kind 接口（`src/behaviors/kinds/*`）、行为页档案表、能力工具收紧（`grants.disable`） | `23884e7` |
| P9.1 | 工具目录 `src/tools/catalog.mjs`（37 平台工具 + 6 风险级），能力改 `tools.visible`，删 `sandbox` | `1b5226e` |
| P9.2 | 平台提示词安装期组装（`src/runtime/prompt-compose.mjs`），5 个内置预设 diff 为零 | `37dc69e` |
| P9.3 | 两端适配器（`src/runtime/adapters.mjs` + 插件 `adapters:provide`），运行方案页显示平台/Agent | `87016d0` |
| P9.4 | 能力面板抽组件、行为页两标签、Agent 预设内置只读 + 克隆、导航更名 | `87016d0` |

门禁基线：全量 `node scripts/test-audit.mjs` = **111/111**（P9.4 后）；`test-console-ui.mjs` 35/35。

### 0.2 已设计但未实现 / 已回滚

| 项 | 状态 | 说明 |
|---|---|---|
| 权限等级 + `full` 短时授权（原 P9.5） | **设计完成、代码已回滚** | `src/session/permission.mjs` 与 bridge/UI 接线曾写完，因 `/perm` 命令、会话下拉、授权按钮、测试未接完而主动回滚；规格见 §12 与 `RESOURCE_MODEL.md` §6.5/§7 |
| 能力/行为/工具彻底归一（P10） | **本文档，待批准** | 见 §1–§11 |
| 「重启桥接」按钮 | **环境缺陷，未修** | 无守护进程时 `POST /api/restart` 直接停机（见 §13.3） |
| 桌面端（QQAgent Electron） | 未运行 | 目前桥接由手工 `node src/bridge.js` 拉起 |
| `❖` 运行方案图标 | 已提交，用户保留质疑 | 与行为档案 `◈` 同族，若改只需一行 |

### 0.3 运行环境现状

- 桥接进程：**手工启动**的 `node src/bridge.js`（无守护），`mode=reserved2`，DSH 会话在线 5 / 缺失 0。
- 前端：`public/console` 静态文件**现读磁盘**，刷新即最新；**后端（node 进程）必须重启**才加载新代码——这正是 14:34 那次「工具列表空白」的根因（进程 10:28 启动，早于 P9.1 代码）。
- 重启代价：`/api/restart` 会杀进程且不自动拉起；改完后端代码后，需手工 `node src/bridge.js` 或先启动桌面端守护。
- 文档矩阵：`UNIFY_PLAN.md`（P0–P8 契约）、`INJECTION_PROFILE_CONFIG.md`（注入块实现）、`RESOURCE_MODEL.md`（资源模型 + 权限设计）、**本文**（能力/行为/工具归一 + 权限 + 现状）、`GLOBAL_CONFIG.md`、`SESSION_SUBSYSTEM.md`、`STATUS.md`。

---

## 1. 问题与目标

### 1.1 现状（必须被这次重构消掉的四件事）

1. **同一个概念两个页面**：`pages/presets`（我改名成「Agent 预设」）与我在 `pages/behavior` 第二标签里新建的「能力预设」并存；后者只是桥接侧补丁，前者才是真预设 —— 用户看到的是两套。
2. **工具散在三处**：`extensions.yml` 的 MCP 服务器/工具与技能、DSH preset 里的插件行（`qq-tool-restrict`、`tool-fs` 等）、桥接侧 `config.capabilities[].tools.visible`。三处各自表达「能不能用」，没有单一目录。
3. **平台耦合没拆**：内置 id 是 `qq-chat` / `qq-chat-v2` / `qq-agent-*`；QQ 的平台话术与安全规则整段写死在 `agent.cordis.yml` 的 `persona.prefix`；`preset.yml` 还有 `behavior:` 反向绑定平台行为。
4. **行为档案没有提示词**：它只有节奏参数，平台表达无处安放，于是被塞进了 Agent 预设。

### 1.2 目标（按优先级）

- **一个页面、一份源**：预设页整体并入行为页第二标签，成为唯一的能力预设入口；桥接侧那份补丁页面删除。
- **一份文件表达一个能力预设**：新增 `capability.yml` 作为唯一可编辑源，`preset.yml` / `agent.cordis.yml` / `extensions.yml` / bundle patch 全部改为**生成物**。
- **工具目录归一**：平台工具、Agent 自身模块、MCP 服务器与工具、技能，四类都进同一张目录，按 `side` 与 `risk` 标注；能力预设只维护 `tools` 一节。
- **平台解耦**：能力预设 id 与内容里不出现任何 `qq` 字样；平台话术归行为档案（`prompt` 段）；安装产物不承载平台文本。
- **不留技术债**：旧的 `behavior:` 绑定、`config.capabilities`、`capability-panel` 组件、`/api/runtime/capabilities` 全部删除，不做兼容双写。

### 1.3 非目标

- 不改 DSH 上游、不改注入块系统的既有 26 块语义（只新增 1 块，见 §4.3）。
- 本期不接第二个平台/第二个 agent 运行时；适配器只保留接口与两个内置实现。
- 不重写权限级别与 `full` 短时授权（规格见 §12，排在 P10 之后按 P11 执行）。

---

## 2. 终态对象与文件

### 2.1 对象

| 对象 | 归属 | 回答的问题 | 存储 |
|---|---|---|---|
| **能力预设** capability | Agent 端 | Agent 能做什么：工具集合 + 安全约束 | `dsh/agent-presets/<id>/capability.yml` |
| **行为档案** behavior | 平台端 | 在 QQ 里怎么说话、怎么等、平台提示词 | `config/behaviors/<id>.yml` |
| **运行方案** plan | 组合 | 用哪套能力 + 哪套行为 + 给谁用 | `config.runtime.plans[]` |
| **会话** | 实例 | 跟随全局 / 覆盖方案 + 人格 + 模型 + 权限 | `state/sessions/...` |

### 2.2 目录（终态）

```
dsh/agent-presets/
  agent-chat/            # 内置（只读模板，可克隆）
    capability.yml       # 唯一源：工具、安全约束、MCP、技能
    preset.yml           # 生成物（name/description/order，无 behavior）
    agent.cordis.yml     # 生成物（persona.prefix = safety + 通用底座 + 插件行）
    extensions.yml       # 生成物（仅当 tools.mcp/skills 非空）
  agent-readonly/
  agent-workspace/
  agent-full/
  <custom-id>/           # 自定义，同样结构

config/behaviors/
  qq-social-v1.yml       # params + prompt(平台提示词) + platform: qq
  qq-social-v2.yml

dsh-bundles/qq-agent-presets/presets/
  <id>.patch.yml         # 生成物（build-agent-preset-patches.mjs 产出）
```

**不新增目录、不新增 state 文件。** 运行方案、权限、会话字段都在既有位置。

### 2.3 内置集合（4 个能力 × 2 个行为 × 6 个方案）

能力（平台无关）：

| id | label | 工具面 |
|---|---|---|
| `agent-chat` | 聊天 Agent | 无本地工具；仅平台工具（QQ 工具经 MCP）+ ask_user_question/todo |
| `agent-readonly` | Agent · 只读 | 只读类 Agent 模块（fs 读、搜索、web、todo、ask） |
| `agent-workspace` | Agent · 工作区读写 | 只读 + 写/执行（工作区内），pwsh 受工作区约束 |
| `agent-full` | Agent · 完全访问 | 上述全部 + 跨工作区与进程管理 |

行为（平台相关）：`qq-social-v1`、`qq-social-v2`。

方案（内置 6 条，只改引用，不改语义）：

| 方案 | capability | behavior |
|---|---|---|
| `chat` | `agent-chat` | `qq-social-v1` |
| `social-v1` | `agent-chat` | `qq-social-v1` |
| `social-v2` | `agent-chat` | `qq-social-v2` |
| `agent-readonly` | `agent-readonly` | `none` |
| `agent-workspace` | `agent-workspace` | `none` |
| `agent-full` | `agent-full` | `none` |

> 合并说明：`qq-chat`（无 extensions.yml ⇒ Hub 全部拒绝）与 `qq-chat-v2`（`mcp/skills = '*'`）工具行完全相同，只是扩展策略与 persona 文本不同。合并后 `agent-chat` 采用 `allow: ['*']`（超集，避免聊天能力被 MCP 策略卡死）；差异记入 `docs/migration-report.md`。
>
> 说明：`chat` 与 `social-v1` 在 DSH 侧是同一个安装预设（`agent-chat`），差别只在行为是否注入平台提示词。这是**方案层**的差异，不再是两份重复预设 —— 这正是去重的目的。

---

## 3. 数据契约

### 3.1 `capability.yml`（唯一源，已实现 `src/capabilities/file.mjs`）

```yaml
version: 1
id: agent-chat                 # 必须与目录名一致
label: 聊天 Agent
note: 无本地工具，只做群聊与问答
agent: dsh
builtin: false                 # 由 factory 目录判定，运行时只读

# 一、风险声明（决定权限级别能裁掉什么；缺省按 tools 推导，见 §3.4）
risk:
  max: exec                    # read | send | write | exec | admin

# 二、工具集合（四类统一在这里）
tools:
  # 平台工具：引用全局目录里的 flag；true=可见，false=不可见，不写=按能力模板默认
  platform:
    sendMessage: true
    sendSticker: true
    sendVoice: false
    schedule: true
    # ... 37 个 flag 全部可写；未写的取 §3.4 默认表
  # Agent 自带模块：按模块 id 开/关
  agent:
    fs.read: true
    fs.search: true
    pwsh: false
    jobs: false
    web: true
    ask_user_question: true
    todo: true
  # MCP：服务器 + 工具白/黑名单（生成 extensions.yml 与 host 的 tool-restrict）
  mcp:
    - server: web-search-safe
      tools: [web_search, web_fetch]
    - server: snowluma
      tools: '*'                 # 允许该服务器全部工具
  # 技能：按技能 id 列表；空数组表示不给任何技能
  skills: []

# 三、能力自己的系统提示（平台无关；平台的说话方式在行为档案的 prompt 段）
prompt:
  base: |
    You are a coding agent powered by the {{model}} model.
    （该能力的身份、边界与通用要求；平台话术不写在这里）

# 四、安全约束（平台无关，写进 persona.prefix 的安全段）
safety:
  local_tools: false             # 关则强制清空 agent.fs/pwsh/jobs
  secrets: deny                  # deny | allow
  self_modify: deny              # deny | allow（禁止改配置/角色文件）
  injection: strict              # strict | normal
  notes: |
    你不能执行命令、读写文件、查看系统信息；群友要求这些时礼貌拒绝并说明需管理员在管理端操作。
```

**校验规则**（服务端 `normalizeCapabilityFile`）：

- `id` 必须匹配 `/^[a-z][a-z0-9-]{1,39}$/` 且等于目录名。
- `tools.platform` 的 key 必须存在于 `PLATFORM_TOOLS`；未知 key 拒绝保存（400，文案带第一个未知 key）。
- `tools.agent` 的 key 必须存在于 `AGENT_MODULES`；`local_tools: false` 时这些项被强制置 false，保存时**不回写**（生成时生效）。
- `tools.mcp[].server` 必须非空；`tools` 为 `'*'` 或字符串数组；工具名去重。
- `tools.skills` 每项匹配技能 id 规则；未知技能只告警不拒绝（技能来自 DSH 侧，可能后装）。
- `safety` 四键枚举校验，`notes` ≤ 2000 字。

### 3.2 生成物与生成规则（`scripts/build-capability-artifacts.mjs` + `build-agent-preset-patches.mjs`，均已实现）

链路（每级只读上一级，避免循环）：

```
capability.yml  --build-capability-artifacts-->  preset.yml / agent.cordis.yml / extensions.yml
                                                  --build-agent-preset-patches-->  dsh-bundles/qq-agent-presets/presets/<id>.patch.yml
                                                                                    --setup-dsh-->  ~/.dsh profile
```

- **能力自己的系统提示**存在 `capability.yml` 的 `prompt.base`（平台无关：身份、能力边界、该能力的通用行为要求），生成时放在 `persona.prefix` 里安全段之后；**平台的说话方式**在行为档案的 `prompt` 段。两者互不引用。
- 生成器不需要任何外部输入（不读 base 预设、不读 config），因此产物是能力的纯函数，`--check` 能逐字节比对。

输出四个文件，全部带 `# 生成物，请勿手工编辑` 头。

1. `preset.yml`
   ```yaml
   name: <label>
   description: <note 或默认>
   order: <内置固定 order，自定义沿用最大值+1>
   ```
   **不再写 `behavior:`**。
2. `agent.cordis.yml`
   - `persona.prefix` = `renderSafety(safety)` + `\n\n` + `prompt.base`。
   - 插件行按 `tools.agent` 生成：`fs.read/fs.search` → `tool-fs`/`tool-fs-search` 行；`pwsh` → `tool-pwsh` + 工作区参数；`web` → `tool-web`；`jobs` → `tool-jobs`；`ask_user_question`/`todo` → 对应行。
   - `local_tools: false` 时**不生成**任何 `tool-fs/tool-pwsh/tool-jobs` 行，只保留 `tool-web`/`tool-ask-user`/`tool-todo`。
   - `qq-tool-restrict` 行：**仅当 `safety.local_tools === false`** 时挂载（它是「仿真会话不得有本地执行能力」的注册期铁律；Agent 能力必须不挂）。插件改为读取行配置 `allow`（生成的平台工具/MCP 工具名集合），未提供 allow 时沿用现有硬编码兜底，行为不变——**这是对 bundle 内唯一实现的参数化，不新增插件**。
3. `extensions.yml`（`tools.mcp`/`skills` 任一非空时；**由桥接 Hub 读取，DSH 不解析**）
   ```yaml
   mcp:
     allow: [web-search-safe, snowluma]
     tools:
       allow: ['*']        # 或具体工具名
       deny: []
   skills:
     allow: ['*']
   ```
   缺文件/空文件 = 全部拒绝（Hub 语义），所以生成器必须显式写 `allow`。
4. bundle patch：`composeRows(...)` 逻辑不变，只把输入换成生成后的行列表（`build-agent-preset-patches.mjs` 仍只读 `preset.yml` + `agent.cordis.yml`，不直接读 `capability.yml`——生成与打包各自单向）。

**`--check` 语义**：逐字节比对四个产物与源；不一致 exit 1。迁移完成后，5 个旧预设 → 4 个新能力的产物必须与手工迁移前的 `agent.cordis.yml`（去掉 QQ 段与 `behavior:`）逐字一致，作为验收（§8 G3）。

### 3.3 两道的分工（不合并、不互相替代）

| 层 | 文件 | 作用域 | 数据来源 |
|---|---|---|---|
| 注册期隐藏 + 执行期白名单 | `dsh-bundles/qq-agent-presets/qq-tool-restrict.mjs`（权威唯一实现） | 仅 `local_tools:false` 的仿真能力 | 行配置 `allow`（生成）；缺省用现有硬编码名单 |
| MCP / 技能可见性 | `dsh/agent-presets/<id>/extensions.yml` | 所有能力 | 生成自 `tools.mcp`/`tools.skills` |

两者不是二选一：restrict 保证「本地执行工具根本不在清单里」，extensions 保证「外部 MCP/技能按能力裁剪」。

### 3.4 工具目录 `ToolCatalog`（唯一投影）

条目结构（`src/tools/catalog.mjs` 扩展）：

```js
{
  id: 'qq_send_message',      // 平台工具：flag；Agent 模块：module id
  label: '发送消息',
  side: 'platform' | 'agent',
  provider: 'qq' | 'dsh',
  risk: 'read' | 'send' | 'state' | 'write' | 'exec' | 'admin',
  source: 'builtin' | 'mcp:snowluma' | 'plugin:<id>',
  gated: true,                // 能力预设可收紧
  alwaysAllowed: false,       // 读类为 true（不受 visible 影响）
  defaults: { ... }           // 各能力模板的默认值（见下）
}
```

四类来源：

| side | 来源 | 覆盖 |
|---|---|---|
| platform | `PLATFORM_TOOLS`（37 个 flag） | 能力 `tools.platform` |
| platform | `tools.mcp` 的服务器/工具 | 能力 `tools.mcp`（生成 extensions） |
| agent | `AGENT_MODULES`（8 个模块） | 能力 `tools.agent` |
| agent | `tools.skills` | 能力 `tools.skills` |

- `visible` 不再是数组：能力文件里写 `true/false`，**读接口**统一投影成 `{ [flag]: boolean }` 与 `visibleList`（兼容旧前端字段到 P10.8 删除）。
- 默认值表 `CAPABILITY_DEFAULTS`：
  - `agent-chat`：平台工具全开；agent 仅 `ask_user_question`/`todo`/`web`。
  - `agent-readonly`：agent `fs.read`/`fs.search`/`web`/`todo`/`ask`；平台工具全开。
  - `agent-workspace`：只读能力 + `fs.write`/`pwsh`（工作区）。
  - `agent-full`：全部。
  - 自定义：从克隆源复制。
- `risk` 是权限级别唯一判据（矩阵不变）；`gated` = risk ∈ {send,state,admin} 或 skill/mcp 条目（可收紧）。

### 3.5 行为档案 schema 扩展

`config/behaviors/<id>.yml` 顶层增加：

```yaml
platform: qq
prompt:
  text: |
    【QQ 场景规则】
    - 回复保持简短（一般 3~5 句）……
    可用占位符：{platform} {displayName} {owner}
  updatedAt: 1762...
```

- `kind`/`version`/`v1`/`v2` 参数段**不变**。
- `label` 变成 `QQ · 一代仿真节奏` 这类平台前缀命名（id 也改，见 §5）。
- 迁移：把 4 段 QQ 话术从 `qq-chat/agent.cordis.yml` 的 persona 里抽出，放进 `qq-social-v1` 与 `qq-social-v2` 的 `prompt.text`（两代共用同一份文本；差异只在节奏参数）。
- 注入：新增注入块 `core-platform-prompt`（`profiles:['wake']`，`timing:'every-wake'`，`slot:'behavior'`，priority 145，`maxChars` 走 `config.limits.promptBlocks`），由 `wakePromptCtx` 读取「当前方案的行为档案 prompt」并渲染占位符。**这是唯一新增的块**。

### 3.6 `config.json` / `state` 变化

| 键 | 动作 |
|---|---|
| `config.capabilities` | **删除**（能力信息全部回到 capability.yml） |
| `config.runtime.plans[].tools` | 改名为 `capability`（迁移见 §5；旧键读一次） |
| `config.platforms.qq.prompt` | 不新增；平台提示词在行为档案 |
| `config.tools` | 保留，语义=`部署开关`，文案改「平台工具注册（需重启）」 |
| `config.behavior.default` | 保留（默认行为档案） |
| `state/runtime.json` | 不变 |
| `state/sessions/**` | `presetId` 继续存在，值改为能力预设 id |

---

## 4. 运行时组装与解析

### 4.1 安装（build → install）

1. 控制台「保存」→ 写 `capability.yml` → 调 `buildPreset(id)`（新增，抽自 build 脚本，可被服务端 import）→ 生成四个产物 → `presetStore.install(id)`（既有 `/api/extensions/presets/<id>/apply`）。
2. 生成失败：不写半成品，返回 400 + 首个错误；磁盘保持上一次成功产物（先写 `.tmp` 再 rename）。
3. 应用失败：回滚到备份（`state/preset-backups/<id>/<ts>/`，已有机制），会话创建 fail-closed（沿用现状）。

### 4.2 会话建链

```
session.planId → plan → capability(安装预设 id) + behavior(id)
  presetId  = plan.capability
  behavior  = plan.behavior（none 则不注入平台提示词）
  prompt 注入 = core-platform-prompt(behavior.prompt.text + 占位符)
  behaviorFor() 只读 behavior 参数（不再看 presetId/模式）
```

- `activePlan()` / `sessionPlanOf()` 不变。
- 删除 `behaviorFor` 里的 `presetBehaviors` 兜底与 `preset.yml > behavior` 绑定。

### 4.3 工具执行闸门

- 解析顺序不变：`plan.capability` → capability.yml 的 `tools` → `visible`。
- 执行前：`visible && riskAllowed(level)`；`alwaysAllowed` 直接放行。
- 生成时按**默认级别**裁剪模型可见工具（安装期），运行中改级别由 403 兜底（P9.5 不变）。

### 4.4 平台/Agent 适配器

- `PlatformAdapter.tools()` 返回 `PLATFORM_TOOLS + mcp 条目`；`AgentAdapter.tools()` 返回 `AGENT_MODULES + skills`。
- 注册表不变（P9.3 已实现），只是 catalog 改为从两个适配器汇总，不再硬编码数组。

---

## 5. ID 与迁移

### 5.1 改名表

| 旧 | 新 | 备注 |
|---|---|---|
| `qq-chat` | `agent-chat` | |
| `qq-chat-v2` | `agent-chat` | **合并**；两代差异由行为（`qq-social-v1/v2`）承担 |
| `qq-agent-readonly` | `agent-readonly` | |
| `qq-agent-workspace` | `agent-workspace` | |
| `qq-agent-full` | `agent-full` | |
| `social-v1` | `qq-social-v1` | |
| `social-v2` | `qq-social-v2` | |

### 5.2 引用迁移（一次性脚本 `scripts/migrate-capability-unify.mjs`）

按顺序执行，全部幂等：

1. 目录改名：`dsh/agent-presets/<旧>/` → `<新>/`；`qq-chat` 与 `qq-chat-v2` 都映射 `agent-chat`，合并规则：插件行取并集（两者相同）、extensions 取更宽的一侧（`'*'`）、persona 的平台文本以 `qq-chat-v2` 为准（较新）；原目录移到 `state/migrated/<旧>/`。
2. 生成 `capability.yml`：解析旧 `agent.cordis.yml` 的插件行 → `tools.agent`；解析 `extensions.yml` → `tools.mcp`/`skills`；抽取 persona 里的 QQ 段 → 写入两个行为档案的 `prompt.text`；剩余 persona 文本 → `safety.notes` 与 `BASE_PROMPT`。
3. 行为档案改名 + 加 `platform: qq` + `prompt.text`（去重：两份相同）。
4. 方案：`plan.tools` → `plan.capability`（按 5.1 表），`plan.behavior` 按 5.1 映射；`chat` 与 `social-v1` 都指向 `agent-chat`。
5. 会话：`profile.presetId` 按表改；`profile.planId` 不变。
6. `config.capabilities` 的内容（`tools.visible`、`prompt.personaPrefix`）合并进对应 `capability.yml` 后**删除该键**。
7. 删除 `preset.yml` 的 `behavior:` 行（产物生成时本就不写）。
8. 备份：执行前把 `dsh/agent-presets/`、`config/behaviors/`、`config.json`、`state/sessions/` 复制到 `state/migration-backup/<ts>/`；失败自动还原。

**验收查询**：
- `grep -R "qq-chat\|qq-agent-\|behavior:" dsh/agent-presets config/behaviors config.json` 只应命中迁移备份目录。
- 所有方案引用的 capability 目录存在；所有会话 `presetId` 命中能力目录。

### 5.3 回滚

`node scripts/migrate-capability-unify.mjs --rollback <ts>`：还原备份、恢复 `config.capabilities`、删除生成物。保留脚本至 P10.8 后再删（文档注明）。

---

## 6. 页面与接口

### 6.1 行为页（唯一入口）

`pages/behavior` 两标签：

- **行为档案**（现状强化）：列表（id/平台/类型/被方案引用/内置）+ 表单（`kind` 字段 + 节奏参数 + 新增「平台提示词」textarea + 占位符提示）。内置行只读，按钮「克隆」。
- **能力预设**（并入现有预设编辑器）：
  - 列表列：能力预设 / 工具概览（平台 N·Agent M·MCP K·技能 S）/ 风险上限 / 被方案引用 / 操作（编辑·克隆·删除）。
  - 编辑器（同一个面板，不再有第二个页面）：
    1. 基本信息：id（新建时可填，之后只读）、label、note；
    2. 工具：四个分区，全部用 `checkListField` / 表格组件渲染 —— 平台工具（按 risk 分组）、Agent 模块、MCP（服务器 + 工具二级勾选；允许 `*`）、技能；
    3. 安全约束：`local_tools/secrets/self_modify/injection` 四个 select + notes textarea；
    4. 生成预览：只读 `<pre>` 显示 `agent.cordis.yml` 与 `extensions.yml`（生成物）；
    5. 底部动作：保存 / 应用并安装 / 查看产物 / 克隆（内置）/ 删除（自定义）。
  - 内置项：服务端拒绝写；前端隐藏保存与应用，只留克隆。

### 6.2 删除项（必须删干净，见 §10）

- `public/console/components/capability-panel/`（整个目录）。
- `pages/runtime` 的能力卡（P9.4 已移走，确认无残留）与 `capsPayload` 之外的能力代码。
- 导航「Agent 预设」项与其 `consolePages`/`PAGE_FRAGMENTS`/`section`/静态基线/legacy id。
- 桥接 `/api/runtime/capabilities`、`config.capabilities`、`capabilityAllows()` 的旧实现（改为读能力文件）。

### 6.3 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/capabilities` | 列表（含工具概览、风险上限、usedBy、builtin） |
| GET | `/api/capabilities/<id>` | 详情（`capability.yml` + 生成预览） |
| POST | `/api/capabilities` | 新建（可带 `from` 克隆） |
| PUT | `/api/capabilities/<id>` | 保存（校验 + 重建产物 + 可选应用） |
| DELETE | `/api/capabilities/<id>` | 删除（内置 400；被方案引用 409） |
| POST | `/api/capabilities/<id>/apply` | 应用并安装（DSH） |
| GET | `/api/capabilities/<id>/preview` | 生成物纯文本 |
| GET/POST | `/api/behaviors/*` | 沿用，新增 `prompt` 字段读写 |
| GET | `/api/tool-catalog` | 纯目录投影（调试用） |

旧的 `/api/extensions/presets/*` 保留为底层实现，不再对外暴露给前端（P10.8 决定是否删）。

---

## 7. 分步执行计划（每步可独立提交 + 验收）

> 约定：每步结束跑 `node --check` 涉及文件 + 该步验收命令；提交信息 `refactor(capability): ... (P10.x)`，打 `phase/10.x` 标签。

**P10.1 工具目录归一（无 UI 改动）**
- 扩展 `src/tools/catalog.mjs`：加 `CAPABILITY_DEFAULTS`、`TOOL_SOURCES`、`catalogFromAdapters(platform, agent)`；条目加 `side/provider/source/defaults/alwaysAllowed`。
- 加单测 `test-tool-catalog.mjs`（目录完整性、risk 覆盖、默认表）。
- 验收：`node scripts/test-tool-catalog.mjs`、全量 audit 不降。

**P10.2 `capability.yml` 读写与生成器**
- 新增 `src/capabilities/file.mjs`（normalize/load/save/validate）、`src/capabilities/build.mjs`（生成四产物）。
- `scripts/build-agent-preset-patches.mjs` 改为调用 `build.mjs`（行为不变）。
- 验收：`test-capability-file.mjs`；对现有 5 个预设跑 `--check` 仍全绿（生成物未变）。

**P10.3 迁移脚本 + 内置 4 能力**
- 写 `scripts/migrate-capability-unify.mjs`（含 `--dry-run`/`--rollback`），实现 §5。
- 手工确认 4 个 `capability.yml` 的 tools/safety 与旧预设等价；跑 `--check`（新产物 vs 旧产物，放行 `behavior:` 行与 persona 平台段的差异，逐项 diff 记录在 `docs/migration-report.md`）。
- 验收：§8 G3/G4。

**P10.4 服务端切换读取源**
- `src/bridge.js`：能力/工具/行为/安装全部改读 `capability.yml`；删 `config.capabilities` 读路径；`/api/capabilities/*` 落地；`plan.tools` 迁移为 `plan.capability`（旧键读一次并写回）。
- 删 `capabilityAllows` 旧实现，`v2ToolEnabled` 改走新解析。
- 验收：`test-runtime-capabilities.mjs` 重写通过、存量会话建链回归（`test-runtime-combo`）。

**P10.5 平台提示词注入块**
- 行为档案加 `prompt`；迁移脚本抽取 QQ 段；新增 `core-platform-prompt` 块 + `wakePromptCtx` 取值；golden 夹具更新（新增 1 块，其余逐字不变）。
- 验收：`test-prompt-golden.mjs`（更新基线并说明差异）、`test-prompt-compose`。

**P10.6 前端合并**
- 行为页两标签，能力预设编辑器整体迁入（复用现有 `presets/page.js` 的表单与 YAML 查看器，改造为 capability 表单）。
- 删除 `capability-panel/`、导航项、`pages/presets` 页面与路由（或保留为内部重定向，P10.8 决定）。
- 静态基线、`pilotIds`、legacy/retired id、契约重录。
- 验收：`test-console-static`、`test-console-ui`（新增能力工具勾选用例）。

**P10.7 清理与红线核查**
- 按 §10 清单逐项删除/断言；`grep` 清单进 `test-capability-unify.mjs`（例如「代码里不得出现 `config.capabilities`」）。
- 验收：全量 audit、`node scripts/test-capability-unify.mjs`。

**P10.8 文档收尾**
- 更新 `RESOURCE_MODEL.md`（以本文为准）、`GLOBAL_CONFIG.md`、`INJECTION_PROFILE_CONFIG.md`（新增 1 块）、`STATUS.md`（D22）。
- 决定并执行：`/api/extensions/presets/*` 是否降级为内部、`docs/migration-report.md` 留档。

---

## 8. 测试与验收矩阵

| 编号 | 内容 | 命令/判据 |
|---|---|---|
| G1 | 目录与归一 | `test-tool-catalog.mjs`：37 平台 + 8 Agent + MCP/技能条目齐全，四类 side/risk 正确 |
| G2 | 生成器确定性 | 同一 `capability.yml` 连跑两次 byte-diff 为 0 |
| G3 | 迁移等价 | 4 个内置：迁移后 `agent.cordis.yml` 与旧文件 diff 只允许「QQ 段移除 + behavior 行移除 + 生成头」 |
| G4 | 迁移幂等 | 连跑两次迁移脚本，第二次无改动、exit 0 |
| G5 | 旧键清除 | `grep -R "config.capabilities\|behavior:" src/ public/console/ config.json` 命中数为 0（除迁移脚本/文档） |
| G6 | 平台脱钩 | 能力目录与 `capability.yml` 中 `grep -ri "qq"` 命中数 0 |
| G7 | 建链回归 | `test-runtime-combo.mjs` + 手动：6 个方案各建一次会话，presetId/behavior 符合 §2.3 |
| G8 | 工具闸门 | 只读会话调 `qq_send_poke` 被拒（403/工具不存在）；`sendMessage` 放行 |
| G9 | 提示词 | `test-prompt-golden.mjs` 仅新增 `core-platform-prompt` 段；占位符渲染正确 |
| G10 | 前端 | `test-console-static`、`test-console-ui`（含能力工具勾选、内置只读、克隆）全绿 |
| G11 | 全量门禁 | `test-audit.mjs` ≥ 115/115 |

---

## 9. 实施顺序依赖（总顺序）

```
P10.1 ─→ P10.2 ─→ P10.3 ─→ P10.4 ─→ P10.5
                     └─────────────→ P10.6 ─→ P10.7 ─→ P10.8
                                                          └─→ P11.1 ─→ P11.2 ─→ P11.3 ─→ P11.4
```

**为什么权限（P11）排在能力归一（P10）之后**：
1. 权限钉的是 **DSH 权限预设**，而会话建链要拿到 `presetId`；P10 会把 `plan.tools` 改成 `plan.capability`、内置 id 改成 `agent-*`，先做 P10 可以避免权限代码跟着改两遍。
2. 权限的 UI（会话详情下拉、全局配置卡）与 P10.6 的页面合并会同时动 `sessions/page.js` 与 `config/page.js`，顺序执行避免冲突。
3. `danger-full-access` 一旦解禁就是真实风险，必须放在归一之后、在结构稳定的树上做，便于隔离回滚。

**阶段纪律**
- 每步：改代码 → `node --check` → 该步验收命令 → `git add` 指定文件 → 提交 `refactor(xxx): ... (P10.x)` / `feat(xxx): ... (P11.x)` → 打 `phase/10.x` / `phase/11.x` 标签。**不把两步混在一个提交里**。
- 后端每步完成后必须**重启桥接**再验 UI（前端现读磁盘、后端不是）。
- 任一步失败：`git revert` 该步提交；迁移类步骤用 `state/migration-backup/` 恢复；不得带着半生成产物进入下一步。
- 全量 audit 每 1–2 步跑一次（约 6–8 分钟），失败项必须当步修到 0。

## 10. 删除清单（红线：以下任一项残留 = 未完成）

**代码/文件**
- [ ] `public/console/components/capability-panel/`（整目录）
- [ ] `public/console/pages/presets/`（页面本体；表单组件若被行为页复用则移到 `components/`，原页面删除）
- [ ] `src/runtime/capabilities.mjs`（被 `src/capabilities/*` 取代）
- [ ] `capabilityAllows()` 旧实现、`config.capabilities` 读写
- [ ] `preset.yml` 的 `behavior:` 字段与 `presetBehaviors`/`assertPresetBehaviorBindings`/`resolveBehavior` 兜底
- [ ] `agent.cordis.yml` 里的 QQ 平台话术（只保留 safety + 底座）

**配置/状态**
- [ ] `config.json > capabilities`
- [ ] `config.json > runtime.plans[].tools`（改 `capability`）
- [ ] `state/prompt-blocks.json` 旧名（已于 P2 迁移，确认无残留）
- [ ] 迁移脚本生成物 `state/migrated/<旧 id>/` 只在文档说明，不进运行时

**文档/界面**
- [ ] 导航「Agent 预设」、`consolePages.presets`、`PAGE_FRAGMENTS.presets`
- [ ] 页面文案里「沙箱」「grant」「可见集」等实现词（统一为「工具」「权限级别」）
- [ ] `RESOURCE_MODEL.md` 中与本文冲突的两处（§3.2 id 不改名、§5.4 两列）

---

## 11. 待确认（影响执行顺序，默认值已给）

1. **平台提示词注入位置**：默认「行为档案 `prompt` + 每次唤醒注入块」，不再进 `persona.prefix`。代价：平台话术从系统提示降到消息级；安全约束仍在系统提示。
2. **`qq-chat` 与 `qq-chat-v2` 合并为 `agent-chat`**：两代差异只由行为档案承载。若两者工具面确有不同，请在批准前指出，否则按合并执行。
3. **旧 `/api/extensions/presets/*`**：默认保留为底层实现（不对外），P10.8 再决定是否删除。

§12（权限）**不需要再确认**：口径已由你在 14:01 裁决（允许 `full`，但只在 allowFull + 一次性码 + TTL 内），本节即该口径的实现规格；§12.2 的 `default=read-only`、`allowFull=false`、TTL=30 是当时确认的默认值。

---

## 12. 权限等级与 `full` 短时授权（P11）

> 这一节是 P9.5 的正式版本：设计已完成、代码曾实现后**主动回滚**（原因见 §0.2）。照本节可一次做完，不再出现「半套权限系统」。

### 12.1 目标与边界

- 权限是**会话级**属性：每个 QQ 会话（群/私聊）可以有自己的级别；默认跟随全局。
- 四档：`read-only`（只读）/ `workspace-write`（工作区读写）/ `full-ask`（完全访问·每次确认）/ `full`（完全访问·短时授权）。
- **chat 类方案恒 `read-only`**，不可被会话覆盖（安全底线，也是现有 `admin.pinChatReadOnly` 的替代）。
- `full` 不常驻：只有「全局允许 + 授权窗口内」才可钉；窗口结束、重启、会话重建、关闭开关任一发生即回落 `full-ask`。
- 权限**不进运行方案**：方案决定「这套会话能做什么（工具/行为/受众）」，权限决定「这套会话被批准到什么程度」。两者在会话详情并列展示。

### 12.2 数据契约

`config.json` 新增一段：

```json
"permission": { "default": "read-only", "allowFull": false, "fullTtlMin": 30 }
```

- `default` ∈ 前三档（**不允许 `full`**）；缺省 `read-only`。
- `allowFull`：`true` 才允许签发/钉 `full`；打开时必须过一次确认码（复用 `mode-control` 的 TOTP/确认码校验）。
- `fullTtlMin` ∈ `{10, 30, 60}`，缺省 30。

会话档案（`state/sessions/<platform>/<kind>/<id>.json`）新增：

```json
"permission": "inherit"   // inherit | read-only | workspace-write | full-ask | full
```

- 旧档案缺该字段 → 读取时按 `'inherit'`；**迁移时冻结**：首次启动迁移脚本把当时生效值写死（见 12.9）。

`full` 授权不落盘：内存 `Map<key, { expiresAt, timer }>`；桥接重启即全部失效（这是有意设计）。

审计事件（`state/admin/audit.jsonl`）：

| 事件 | 触发 | 字段 |
|---|---|---|
| `permission.change` | 会话权限被改 / 钉成功 | `key, from, to, level, preset` |
| `permission.full_grant` | 签发授权 | `key, ttlMin, expiresAt, by` |
| `permission.full_revoke` | 到期/手动/关开关 | `key, reason` |
| `permission.pin_failed` | DSH 钉权限失败 | `key, preset, error` |
| `permission.full_call` | 授权窗口内 exec/admin 工具每次调用 | `key, tool` |

### 12.3 解析（唯一入口 `src/session/permission.mjs`）

```js
PERMISSION_LEVELS   = ['read-only','workspace-write','full-ask','full']
SESSION_PERMISSIONS = ['inherit', ...PERMISSION_LEVELS]
DSH_PRESET = {
  'read-only': 'read-only',
  'workspace-write': 'workspace-write',
  'full-ask': 'qq-full-ask',
  full: 'danger-full-access',
}

function effectiveLevel({ profile, global, chat, grantActive }) {
  if (chat) return 'read-only';
  const want = profile?.permission && profile.permission !== 'inherit' ? profile.permission : global.default;
  if (want === 'full') return global.allowFull && grantActive ? 'full' : 'full-ask';
  return want;
}
```

- `pinPresetFor(level)` = `DSH_PRESET[level]`；**`danger-full-access` 只出现在这一张表里**（验收 G14 会 grep 断言）。
- `normalizePermissionConfig(raw)`：`default` 非法回落 `read-only`；`allowFull` 严格 `=== true`；`fullTtlMin` 非法回落 30。
- `normalizeSessionPermission(raw)`：非法/空 → `inherit`。
- 纯函数，无 IO，可直接单测。

### 12.4 钉权限：时机、失败策略

`pinSessionPermission(key, { reason, throwOnError })`：

1. `effective = effectiveLevel(...)`；`preset = pinPresetFor(effective)`。
2. `sessionId = sessions.get(key)?.sessionId`；无会话则跳过（建链时会再钉）。
3. `commands.execute(sessionId, '/permission ' + preset)`；**等返回**。
4. 失败：写 `permission.pin_failed` 审计；`throwOnError` 为真时 **archive 该 DSH 会话并抛错**（fail-closed，宁可不建也不建一个权限不明的会话）；否则记日志继续。
5. 成功：写 `permission.change` 审计（`from` 为上次记录的 preset）。

调用点：
- **建会话后**（`ensureSessionV2` 里 agent 路径与 chat 路径各一处）：`throwOnError: true`。
- **改 `profile.permission` 的 PATCH**：保存成功后立即重钉（`throwOnError: false`，失败只在响应里报 `dshSynced: false`）。
- **`/api/config/permission` 的 PATCH**：`allowFull` 由 true→false 时，先对所有活跃授权 `revokeFull(reason='allow_full_off')` 并重钉回落。
- **授权到期 / `DELETE .../permission/full`**：`revokeFull` → 重钉 `full-ask`。

### 12.5 `full` 授权流程

主入口（控制台，需 TOTP）：会话详情「权限」卡 → 选 `full` 或点「申请短时完全访问」→ 弹窗输入 TOTP → `POST /api/sessions/<key>/permission/full { totp }`。

- 服务端校验：`config.permission.allowFull === true`；TOTP 正确（复用 `mode-control` 的 `verifyTotp`）；否则 400/403。
- 成功：生成 6 位一次性码（60 秒有效，仅用于私聊确认，可不实现也可留接口）、写 `permission.full_grant`、`timer = setTimeout(revoke, ttlMin*60*1000)`（**必须 `timer.unref()`**，否则进程无法退出）、重钉 `danger-full-access`。
- 返回 `{ ok, expiresAt, preset }`；UI 显示倒计时 pill 和「收回」按钮。

副入口（私聊命令，owner）：`/perm 完全 <码>`、`/perm 只读|工作区|完全-每次`、`/perm 状态`。

- 命令注册在 `src/commands/builtin.mjs`，`permission: 'owner'`；`/perm 完全` 必须带有效一次性码，否则回复「先到控制台申请」。
- 其余级别直接改 `profile.permission` 并重钉（同一套 12.4）。

`full` 窗口内的行为：
- `exec`/`admin` 类工具（`tool.fs` 写、`tool-pwsh`、`tool-jobs` 等）**不再每次要审批**（因为已钉 `danger-full-access`，DSH 自身也不问）；
- 桥接侧每次调用写 `permission.full_call` 审计（不阻断），满足「全程可追溯」；
- 行为档案与工具可见集不变：**权限只放宽审批，不放宽工具清单**。

### 12.6 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/config/permission` | `{ ok, permission }` |
| PATCH | `/api/config/permission` | `{ default?, allowFull?, fullTtlMin?, totp? }`；打开 `allowFull` 必带 `totp`；关闭时立即收回全部授权并重钉 |
| GET | `/api/sessions/<key>` | 档案内增 `permission: { value, effective, options: [{value,label,desc}], fullAllowed, grantExpiresAt }` |
| PATCH | `/api/sessions/<key>/profile` | 接受 `permission`；非法 400；保存后重钉 |
| POST | `/api/sessions/<key>/permission/full` | `{ totp }` → `{ ok, expiresAt }` |
| DELETE | `/api/sessions/<key>/permission/full` | 收回 → `{ ok }` |

### 12.7 UI

**全局配置 › 安全与静默 › 权限级别**（新卡，走 `save-dock` 的 section）：
- `permissionDefault`：select（只读 / 工作区读写 / 完全访问·每次确认）；hint「会话没有单独设置时用这个」。
- `permissionAllowFull`：`switch` 字段；打开时弹确认码输入（复用 `modalHtml`），提交带 `totp`；关闭时提示「会立刻收回所有进行中的完全访问」。
- `permissionTtl`：select（10 / 30 / 60 分钟）；hint「到期自动回落『完全访问·每次确认』；重启桥接也会回落」。
- 保存走 `PATCH /api/config/permission`，与现有 save-dock 卡片一致。

**会话与审批 › 会话详情 › 权限**：
- select：`跟随全局（当前：只读）` + 三档；`allowFull` 打开时多一项「完全访问·短时授权（30 分钟）」。
- 选 `full` 时不直接保存，先弹 TOTP 弹窗，成功后刷新并显示倒计时 pill「完全访问 · 剩 27:31」+「收回」按钮。
- 保存走既有 `PATCH /api/sessions/<key>/profile`（`permission` 字段）。

**能力面板**（P10.6 后）里保留「权限建议」列：只是提示，不自动套用。

### 12.8 测试与验收

| 编号 | 判据 |
|---|---|
| G12 | `test-session-permission.mjs`：四档归一、chat 恒只读、inherit 落全局、`full` 在 `allowFull=false`/无授权时降级 `full-ask`、非法值回落 |
| G13 | `test-config-permission.mjs`：`allowFull` 打开需 totp、关闭触发 `revokeFull` + 重钉、`fullTtlMin` 非法回落 30 |
| G14 | `grep -R "danger-full-access" src/ public/console/` 命中仅 `src/session/permission.mjs` 与 `src/admin/dsh-permission.js`（后者 P11 时删除或改为引用） |
| G15 | `test-console-ui.mjs`：配置卡保存 payload、会话权限下拉保存 payload、申请授权弹窗（TOTP 必填） |
| G16 | 全量 audit ≥ 118/118；手工：切 `full` → 发一条私聊 → 审计有 `full_call`；等 TTL（可临时改 1 分钟）→ 自动回落且 `/permission` 生效值可查 |

### 12.9 迁移与回滚

- **存量会话冻结**：迁移脚本对每个 `state/sessions/**/*.json`：若 `permission` 缺失，写入**当前生效值**（chat 会话写 `read-only`，agent 会话按当时 global default），不收紧也不放宽；写 `state/migration-backup/permission-<时间戳>/` 后再改，可 `--rollback`。
- **`admin.pinChatReadOnly`** 保留一个版本周期：P11 起 chat 恒只读由 `permission.mjs` 决定，旧配置读一次后删除并记日志。
- 回滚：`git revert` + 恢复备份；`config.permission` 段保留（缺省不影响旧逻辑），`profile.permission` 字段旧代码会忽略。

---

## 13. 系统现状、未完成清单与执行约束

### 13.1 未完成清单（可勾选，阶段收尾必须逐项核对）

| 编号 | 项 | 依赖 | 完成判据 | 优先级 |
|---|---|---|---|---|
| U1 | P10.1 工具目录扩展（side/provider/source/defaults） | — | `test-tool-catalog.mjs` 通过 | 高 |
| U2 | P10.2 `capability.yml` 读写 + 生成器 | U1 | 5 个既有预设 `--check` 全绿 | 高 |
| U3 | P10.3 迁移脚本 + 4 内置能力 | U2 | G3/G4 | 高 |
| U4 | P10.4 服务端读源切换（删 `config.capabilities`） | U3 | G5/G7/G8 | 高 |
| U5 | P10.5 平台提示词注入块 `core-platform-prompt` | U4 | G9 | 高 |
| U6 | P10.6 前端合并（行为页两标签、删 presets 页） | U4 | G10 | 高 |
| U7 | P10.7 红线清理 + `test-capability-unify.mjs` | U5,U6 | 该测试通过 + 全量 audit | 中 |
| U8 | P10.8 文档转正 + presets API 降级决定 | U7 | 文档无冲突、audit 绿 | 中 |
| U9 | P11 权限等级 + full 授权（§12） | U4（建议 U8 后） | G12–G16 | 高 |
| U10 | 「重启桥接」按钮守护化（见 13.3） | — | 点按钮后 5 秒内 `/api/status` 恢复 | 中 |
| U11 | 桌面端（Electron）启动流程 | U10 | 双击启动即可守护桥接 | 低 |
| U12 | `❖` 图标最终确认 | — | 用户点头 | 低 |

### 13.2 每步的验证命令（照抄即可）

```powershell
node --check <改动的 .js/.mjs>            # 语法
node scripts/test-<相关>.mjs              # 该步单测
node scripts/test-console-static.mjs      # 改了前端片段时
node scripts/test-console-ui.mjs          # 改了交互时（约 1 分钟）
node scripts/build-agent-preset-patches.mjs --check   # 改了预设生成时
node scripts/test-audit.mjs               # 每 1–2 步一次（约 6–8 分钟，111 项）
```

后端改动后**必须重启桥接**再验页面：

```powershell
# 当前无守护进程，直接杀旧进程再拉起（会短暂离线）
Get-Process node | Where-Object { $_.Path -like '*node*' } | Select-Object Id,StartTime
Start-Process node -ArgumentList 'src/bridge.js' -WorkingDirectory (Get-Location) -WindowStyle Hidden
```

### 13.3 环境风险与约束

| 风险 | 现状 | 处置 |
|---|---|---|
| 「重启桥接」按钮停机 | `POST /api/restart` 直接杀 node；无守护进程时不自动拉起，已实际发生一次约 1 分钟离线 | U10：按钮改为「有守护进程才由守护拉起，无守护则拒绝并提示手工启动」；或双击启动 Electron |
| 后端旧、前端新 | 前端静态文件现读磁盘；node 进程不热载 | 每次改后端后重启；能力页对「目录缺失」已有重启提示 |
| 磁盘紧张 | 本机约 3.1 GB 可用，曾触发 ENOSPC | 一次性脚本/日志/截图放 `.tmp-*`（已 gitignore），用完即删；迁移备份写 `state/migration-backup/` 后及时清理 |
| 全量 audit 慢 | 111 项约 6–8 分钟，内含 dsh-client 模拟失败日志（正常） | 后台跑，别与另一个 audit 并行（同一日志文件会锁） |
| 迁移破坏存量会话 | 改 id/字段会让旧 `sessionKey → presetId` 失配 | 迁移脚本先备份、先 dry-run、幂等；P10.4 用「旧键读一次并写回」过渡 |
| `danger-full-access` 解禁 | P11 引入 | 只允许在 allowFull + 授权窗口内钉；fail-closed 钉权限；全量审计；G14 grep 兜底 |

### 13.4 明确不做（避免范围膨胀）

- 不引入第二个 Agent 运行时（DSH 之外）——适配器接口留好，不实现。
- 不做「方案继承」「方案模板市场」「按群批量套方案」。
- 不改 DSH 自身的权限预设定义（`read-only`/`workspace-write`/`qq-full-ask`/`danger-full-access` 是 DSH 的概念，我们只引用）。
- 不重写 MCP Hub 的扩展分发；只改它读的 `extensions.yml` 的来源（生成物）。
- 不做权限的「按工具粒度逐项授权」——工具可见集已在能力层，权限只管审批档位。

