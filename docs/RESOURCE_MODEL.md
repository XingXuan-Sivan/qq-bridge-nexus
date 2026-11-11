# 资源模型：两端适配、能力、行为与权限（需求与方案稿 v2）

> 状态：**P9.1–P9.2 已实施**（P9.1 工具目录归一：`src/tools/catalog.mjs` + 能力 `tools.visible`；P9.2 平台提示词组装：`src/runtime/prompt-compose.mjs`，安装期拼进 persona.prefix，空值时产物逐字节不变）。其余分期见 §10。
> 上游：`docs/UNIFY_PLAN.md`（三线归一执行契约）、`docs/RUNTIME_PROFILE_MODEL.md`（运行方案）。
> v1 → v2 的变化：D1 取「安装期组装」；补齐**两端适配器**（用户端平台 / Agent 端运行时）、**工具目录归一**与**权限级别矩阵**；内置资源改为只读模板。

## 1. 需求清单

| # | 需求 | 落点 |
|---|---|---|
| R1 | 运行方案页可自定义、组合新方案 | §8.1 |
| R2 | 预设页改名「能力预设」，并入行为档案页作第二标签 | §8.2 |
| R3 | 能力预设与平台提示词分离，能力要通用 | §4 |
| R4 | 行为档案、能力预设都要统一抽象，不能旧结构+平台耦合 | §3 |
| R5 | 沙箱只在会话内有意义；全局可配默认；会话管理可改；管理员可聊天命令改 | §6 |
| R6 | 能力定义「给哪些工具」，权限规定「这个会话能用其中哪些」 | §5、§6 |
| R7 | 工具来源归一，不要多套体系 | §5 |
| R8 | 工具授予两列：可见 / 可执行 | §5.4 |
| R9 | 会话权限默认「跟随全局」，与人格/模型一致 | §6.3 |
| R10 | 平台字段现在加 | §3.2 |
| R11 | **两端都可替换**：行为档案对接用户端平台（QQ、将来的 B 站…），能力预设对接 Agent 端（DSH、将来的其他 Agent） | §3.1 |
| R12 | 两端都要能通过插件实现接口，适配具体平台 | §3.3 |
| R13 | 内置预设不可编辑/删除，但可作模板克隆 | §7 |
| R14 | 权限级别有哪些、各自准入哪类工具与能力，要成文成规范 | §6.2 |

## 2. 现状事实（已核实）

- **能力预设 = DSH agent preset 目录**（`dsh/agent-presets/<id>/`）：`agent.cordis.yml`（`persona` 插件行里塞着 QQ 平台规则 + 能力安全文案、工具模块行、`qq-tool-restrict`、`qq-approval-gate`、`compaction`）、`preset.yml`（名称/order/`behavior: social-v1|v2`）、`qq-tool-restrict.mjs`（re-export 壳）。
- 内置 5 个：`qq-chat`、`qq-chat-v2`（各 4 个工具）、`qq-agent-readonly`（+fs/fs-search）、`qq-agent-workspace`（+pwsh/jobs/approval-gate）、`qq-agent-full`（同 workspace）。
- **行为档案**（`config/behaviors/*.yml`）只有节奏参数，**没有一句提示词**；`src/behaviors/kinds/{v1,v2}.mjs` 已有字段表与 `platform:'qq'`。
- **工具授权三层**：① `config.tools` 44 布尔（MCP 是否注册，重启生效）② 能力预设插件行 + `qq-tool-restrict`（可见性，安装生效）③ `config.capabilities[id].grants.disable`（9 个写工具，桥接 403，即时）。
- **权限**：DSH 权限预设 = 沙箱（read-only/workspace-write/danger-full-access）+ 审批（ask/never）；`session.create` 无权限参数，建完用 `commands/execute(sessionId, '/permission <名>')` 钉住，**运行中可再执行改，即时生效**（`src/bridge.js:12726-12748`）。桥接现在按旧 level 映射：L1→read-only、L2→workspace-write、L3→qq-full-ask；群聊会话额外钉 read-only。
- **`config.capabilities[id].sandbox` 是死字段**（只有保存/审计读它）。
- **命令注册表**已存在（`/reset /status /role /silent /active`，支持 `permission: all|admin|owner`、`scope`），加 `/perm` 是小活。

## 3. 目标架构：两端适配 + 两层资源 + 方案 + 会话

```
┌ 用户端适配器（PlatformAdapter）───────┐      ┌ Agent 端适配器（AgentAdapter）────────┐
│ qq（内置）/ 将来 bilibili 等          │      │ dsh（内置）/ 将来其他 agent 运行时     │
│ 发送、成员、历史、显示名、平台工具目录 │      │ 预设清单/安装、权限预设/应用、工具目录 │
└───────────────┬──────────────────────┘      └───────────────┬───────────────────────┘
                │                                             │
        ┌───────▼────────┐                            ┌───────▼────────┐
        │ 行为档案        │  平台相关：节奏参数 + 平台表达 │ 能力预设        │  Agent 相关：工具集合 + 能力安全约束
        │ platform: qq   │                            │ agent: dsh     │
        └───────┬────────┘                            └───────┬────────┘
                └──────────────► 运行方案 plan ◄──────────────┘
                        { capability, behavior, audience }
                                   │
                    全局按平台一个方案；会话可 planId 覆盖
                                   │
                     会话级：人格 / 模型 / 权限级别（三条平行）
```

### 3.1 两端适配器契约

**PlatformAdapter**（用户端）

```js
{
  id: 'qq', label: 'QQ',
  capabilities: { send: true, members: true, history: true, media: true },
  send(target, message), members(target), history(target, opts), displayName(target),
  tools: () => ToolCatalogEntry[],      // 平台提供的工具（qq_* 由 snowluma MCP 提供）
}
```

**AgentAdapter**（Agent 端运行时）

```js
{
  id: 'dsh', label: 'DeepSeek Harness',
  presets: { list(), read(id), install(id, files), remove(id) },
  permissions: { catalog(), apply(sessionId, name), current(sessionId) },
  tools: () => ToolCatalogEntry[],      // agent 自带工具（fs/pwsh/web/jobs/...）
  compose: (capability, behavior) => files   // 安装期组装，见 §4
}
```

- 现有实现各一个：`src/adapters/platform/qq.mjs`、`src/adapters/agent/dsh.mjs`（把现在散在 `bridge.js`、`presets/store.mjs`、`dsh-permission.js` 的能力收进去）。
- 方案里不写平台/agent：解析 `(会话平台, plan.capability)` 与 `(会话平台, plan.behavior)`。
- 迁移期保留 `RUNTIME_PLATFORM='qq'` 常量作默认，不破坏现有 key。

### 3.2 数据字段

- 能力预设：`{ id, agent:'dsh', label, note, tools:{visible:[...]}, safety, builtin, appliedAt }`
- 行为档案：`{ id, platform:'qq', kind:'v1'|'v2', label, params:{...}, prompt, builtin }`
- 内置 id 不改名（`qq-chat` 等），避免迁移；新建默认 `<agent>-` / `<platform>-` 前缀。

### 3.3 插件扩展点（R12）

插件清单新增声明（`plugins.json > plugins.<id>.adapters`）：

```jsonc
{ "adapters": { "platform": [{ "id": "bilibili" }], "agent": [{ "id": "other" }] } }
```

- 插件 `index.mjs` 导出 `registerAdapters({ registerPlatform, registerAgent })`，内核启动时调用；适配器实现上述契约即可被资源页/方案页识别。
- 约束：同一 id 只允许一个实现（内置优先，冲突忽略并记日志）；适配器必须通过 `validate()`（字段齐全、工具目录条目合法），否则不注册。
- 本期只交付**接口 + 校验 + 两个内置实现**，不写第三方示例（避免半成品示范）。

## 4. D1 定稿：安装期组装（A）

- 能力预设存「工具集合 + 能力安全约束（safety）」；行为档案存「节奏参数 + 平台表达（prompt）」。
- 安装/应用时：`compose(capability, behavior) → agent.cordis.yml + preset.yml`，`persona.prefix` = `safety` + `\n\n` + `prompt` + `\n\n` + 通用底座；`preset.yml` 不再写 `behavior:` 绑定（方案负责组合）。
- 生成物 = 预设目录内容；保留最近一次成功生成结果，安装失败回滚并 fail-closed（不建会话）。
- 页面提供「查看生成的 YAML」（只读）与「应用」按钮；改行为或能力后状态显示 `有未应用的修改`。
- 验收：拆分后对 5 个内置预设重新生成，**与现有文件逐字 diff 为零**（除 `behavior:` 行按计划移除，需在 golden 中显式放行）。

## 5. 工具目录归一（R7，核心）

### 5.1 单一目录

新增 `ToolCatalog`，条目由两端适配器提供 + 插件贡献：

```js
{ id:'qq_send_message', label:'发送群消息', side:'platform', provider:'qq',
  risk:'send', visibleTo:['qq-chat', ...], gated:true, installedBy:'mcp:snowluma' }
{ id:'fs_write', label:'写文件', side:'agent', provider:'dsh',
  risk:'write', gated:true, installedBy:'preset:tool-fs' }
```

- **`risk`** 是权限级别的唯一判据：`read` / `send` / `write` / `exec` / `admin`。
- **`side`** 区分「平台给的工具」与「agent 自带的工具」；页面按 side 分组展示。
- 目录是**只读投影**：`config.tools`（注册开关）与 DSH 预设（安装）都是它的下游，不再各自维护一份清单。

### 5.2 三层 → 两层

| 原层 | 处置 |
|---|---|
| ① `config.tools` 注册开关 | 保留，但降级为「平台工具目录的部署开关」，只在全局配置里，标注需重启 |
| ② DSH 预设可见性 | 由**能力预设的 `tools.visible`** 生成，不再手写 |
| ③ `grants.disable` | **删除**；可执行性由「可见 ∩ 权限级别」推导，桥接按可见集在调用前拦截 |

于是：**能力预设只维护一份 `visible` 列表**；桥接与 DSH 都从它派生，配置只有一处。

### 5.3 权限级别 × 工具风险（R14 规范）

| 级别 | read | send | write（工作区内） | exec | admin |
|---|---|---|---|---|---|
| 只读 `read-only` | ✅ | ✅ | ❌ | ❌ | ❌ |
| 工作区读写 `workspace-write` | ✅ | ✅ | ✅ | ❌ | ❌ |
| 完全访问·每次确认 `full-ask` | ✅ | ✅ | ✅ | ✅（每次确认） | ✅（确认） |
| 完全访问·不确认 `full` | ✅ | ✅ | ✅ | ✅ | ✅ |

- `send` 在只读级别也放行：聊天是本职，禁掉会让机器人哑掉。
- 级别在**会话级**生效：`allowed = visible ∩ riskAllowed(level)`；桥接在执行前按它拦，DSH 沙箱作第二道。
- 一个能力若声明了某工具为 visible，但当前级别不允许该类，则该工具**不出现**在模型工具列表里（安装/应用时按会话级别裁剪），而不是「出现了再 403」——只有运行中改权限才需要 403 兜底。

### 5.4 能力预设编辑页的两列（R8）

| 列 | 含义 | 写回 | 生效 |
|---|---|---|---|
| 可见 | 模型能看到并调用 | 能力 `tools.visible` → 生成预设 | 安装后 |
| 可执行 | 当前部署允许它真的执行 | 由 `visible ∩ 权限级别` 自动推导，只读展示 | 即时 |

- 「可执行」列不是独立配置，而是**投影**：显示「在当前默认权限下能否执行」，避免第二套开关。
- 不可收紧的只读工具显示「始终允许」。

## 6. 权限级别（R5/R6/R9）

### 6.1 名称与取值

对用户统一叫**权限级别**；四档与上文矩阵一致。第 4 档默认不出现。

### 6.2 存储与生效

- 全局默认：`config.permission = { default:'read-only', allowFull:false, fullTtlMin:30 }`
- 会话覆盖：会话档案 `permission: 'inherit' | 'read-only' | 'workspace-write' | 'full-ask' | 'full'`
- 生效：建会话时取「会话覆盖 → 全局默认」，`/permission <预设名>` 钉住；运行中修改直接再执行一次，即时生效；每次变更写审计 `permission.change` + 私聊通知 owner。
- 旧 `level` 仅保留在 `mode-control` 内部做审计/兼容，不再出现在任何界面。

**迁移策略（不打扰）**：升级时把每个已存在会话的 `permission` 冻结为它当时实际生效的值（agent 会话按其 level 对应预设，chat 会话 `read-only`），不收紧、不放宽；只有升级后**新建**的会话才走「全局默认」。这样 P9.5 的行为变化只影响新会话。

**当前策略（P9.5 之前，供对照）**：没有会话级权限——`currentLevel` 是全局的，agent 会话建会话时按当前 level 钉权限预设（L1 只读 / L2 工作区 / L3 完全+每次确认），chat 会话恒钉 `read-only`；改权限只能通过切换运行方案（间接改 level），不能按会话调。

### 6.3 入口（三个）

1. **全局配置 › 安全与静默 › 权限级别卡**（回答「开关放哪」）：
   - `默认权限级别` 下拉：`只读 / 工作区读写 / 完全访问（每次确认）`；
   - `允许完全访问（不确认）` 开关，默认关；打开需在弹窗里输入确认码（复用现有 `consoleSet` 确认流程），旁注红字说明风险；
   - 关闭开关时，所有 `full` 会话自动降为 `full-ask` 并记审计。
   - 选择这里而不是运行方案页：权限是**部署安全策略**，与「管理员/访问令牌/静默」同属安全面；方案页只管「组合什么能力」。
2. **会话与审批 › 会话详情**：权限下拉，首项「跟随全局（当前：只读）」。
3. **聊天命令**：
   - `/perm` 查看（含来源：跟随全局/会话覆盖）；
   - `/perm 只读|工作区|确认` 修改（owner；群聊仅 owner），降级/平级免确认；
   - `/perm 完全` 走单独的短时授权流程（见 §6.5），不走 mode-control 的 TOTP。

### 6.5 `full` 档的短时授权（独立流程）

设计目标：单会话、短时、可自动回落、不用每次开验证器。**不复用** mode-control 的「确认码 + TOTP」——那是全局状态机的强度，用在单会话动作上过重。

1. owner 在私聊发 `/perm 完全`；
2. 桥接生成 **6 位一次性确认码**（60 秒有效），私聊回发，说明「将会开启完全访问，N 分钟后自动回落」；
3. owner 回 `/perm 完全 123456`；
4. 校验通过后对该会话执行 `/permission danger-full-access`，写审计 `permission.full_grant`，私聊回执含到期时间；
5. TTL（默认 30 分钟，可配 10/30/60）到期自动执行 `/permission qq-full-ask` 回落，私聊通知「已自动回落」；`/perm 确认` 可提前回落；
6. 桥接重启、会话重建、或全局 `allowFull` 被关闭 → `full` 立即失效并回落。

护栏：
- `allowFull=false` 时 `/perm 完全` 直接拒绝，提示去「全局配置 › 安全与静默」打开；
- `full` 期间每个 exec/admin 类工具调用仍写一条 `permission.full_call` 审计（只记不拦）；
- 确认码错误 3 次作废；确认码只对发起的会话有效。

### 6.4 与方案的关系

方案不含权限；「全权 agent 进群」= 方案 `agent-full 工具` + 该会话权限 `full` + 受众按准入。三者各管一件事，界面不互相替代。

## 7. 内置资源：只读模板（R13）

- 能力预设、行为档案的内置项：`builtin: true`，编辑/删除按钮替换为「克隆为自定义」（已有部分实现：能力预设页可克隆）。
- 克隆生成的 id 默认 `<原 id>-copy`（冲突递增），可改；克隆后自由编辑。
- 内置项不可删除的判断在**服务端**（`remove` 抛错），不只靠前端隐藏。
- 页面在内置行加「内置模板」pill，说明「改它请克隆」。

## 8. 页面与信息架构

### 8.1 运行方案页

摘要 / 切换 / 清单 / 新建 / 克隆 / 编辑 / 删除 / 导入导出（已实现）。补：
- 编辑器字段：能力预设（含「新建能力预设」跳转）、行为档案（含「新建」跳转）、受众；
- 保存后提示「引用的 N 套资源中有 M 套未应用」。

### 8.2 行为档案页（两个标签）

```
行为档案 ｜ 能力预设
```

- **行为档案**：列表（id / 平台 / 类型 / 被方案引用 / 模板）+ 「平台表达」编辑区（prompt 多行 + 占位符说明）。
- **能力预设**：列表（id / agent / 工具数 / 被方案引用 / 生效状态 / 模板）+ 编辑（名称、说明、工具授予两列表、safety 文本、查看生成的 YAML）。
- 原「预设」页移出导航，`pages/presets/` 仅保留只读查看器。

### 8.3 其他

- 全局配置：删运行模式卡（已删）；「安全与静默」加权限级别卡；「拓展功能」工具卡改名「平台工具目录」。
- 会话详情：模式+预设已合并为运行方案；新增权限级别下拉。

## 9. 数据契约

```jsonc
// config.json
{
  "permission": { "default": "read-only", "allowFull": false },
  "capabilities": {
    "qq-chat": {
      "agent": "dsh", "platform": "qq", "label": "QQ 聊天能力", "builtin": true,
      "tools": { "visible": ["ask_user_question", "todo", "web_search", "web_fetch", "qq_send_message", "qq_send_poke"] },
      "safety": "你没有本地工具……",
      "appliedAt": "2026-11-11T02:00:00.000Z"
    }
  }
}

// config/behaviors/social-v2.yml（新增 prompt 段）
{ "version": 1, "kind": "v2", "label": "二代仿真默认行为", "platform": "qq",
  "prompt": "QQ 场景规则……（可含 {{tools}} 占位）", "v2": { "...": "节奏参数不变" } }

// 会话档案 state/sessions/qq/group/<id>.json
{ "planId": "social-v2", "permission": "inherit", "persona": {}, "model": {} }
```

## 10. 分期（每期一个提交 + 验收）

| 期 | 内容 | 行为变化 | 验收 |
|---|---|---|---|
| **P9.1** ✅ | 工具目录 `src/tools/catalog.mjs`（37 个平台工具 + 风险分级 + 权限矩阵）、能力 `tools.visible` 取代 `grants.disable`、`v2ToolEnabled(flag,key)` 按会话方案收紧、能力编辑器改「允许调用的工具 + 权限建议 + 平台提示词」、`test-runtime-capabilities` 5/5 | 已完成 |
| **P9.2** ✅ | `src/runtime/prompt-compose.mjs`：`renderPlatformPrompt`（`{platform}/{displayName}/{owner}` 占位符）、`appendPlatformPrompt`、`composeRows`（只动 persona 行）、`readPlatformPromptFromConfig`；`scripts/build-agent-preset-patches.mjs` 生成 patch 时按 `config.capabilities[id].prompt.personaPrefix` 拼接；`test-prompt-compose` 5/5，内置 5 个预设 `--check` 仍逐字一致 | 已完成（拼接发生在安装期，不改仓库源文件） |
| **P9.3** | 两端适配器契约 + dsh/qq 内置实现 + 插件扩展点与校验 | 否 | 适配器单测；插件注册/冲突用例 |
| **P9.4** | 行为档案页两标签 + 预设页只读 + 内置只读/克隆 + 导航与静态基线 | 否 | UI 35/35 + 契约重录 |
| **P9.5** | 权限级别：全局默认 + `allowFull` 开关 + 会话覆盖 + `/perm` + 审计 + 删 `capabilities.sandbox` | **是**（权限改为显式默认/覆盖） | `/perm` 实测；只读档下执行类工具不可见 |
| **P9.6** | 文档转正（本文 + GLOBAL_CONFIG + RUNTIME_PROFILE_MODEL + STATUS） | 否 | 文档互相引用一致 |

顺序理由：先归一数据（P9.1/P9.2 不改行为），再落页面（P9.4），最后动权限语义（P9.5）——权限是唯一会改变现有会话行为的一步，放在有完整测试与审计之后。

## 11. 风险

1. **组装失败 → 建不出会话**：保留最近成功产物 + 失败回滚 + fail-closed；应用前先 dry-run 生成并校验 YAML。
2. **工具目录来源漂移**：DSH 工具与 MCP 工具由适配器动态读取，目录需带 `source` 与 `discoveredAt`，页面显示「上次发现时间」。
3. **权限默认变紧**：P9.5 后 agent 会话默认只读（现在是 level 隐含），需提前在文档与更新说明里写清。
4. **适配器半成品**：本期只交付接口 + 两个内置实现，第三方适配器不写示例；扩展点未验证前不宣传「支持多平台」。
5. **`visible` 裁剪的工具列表在运行中改权限会过期**：运行中改级别后需要重建或热更工具列表，先做「改级别提示重开会话」，后续再优化。

## 12. 已定与待确认

已定：

1. 只读级别放行 `send`（平台发送类），否则只读会话无法聊天。
2. `full` 档走 §6.5 的独立短时授权（一次性码 + TTL + 自动回落 + 重启失效），不用 TOTP。
3. 全局默认权限 = `read-only`；迁移时冻结现有会话为当前生效值，只影响新建会话。
4. 能力可带 `suggestedPermission`（如 `agent-workspace` → `workspace-write`），会话详情给「采用建议」提示，不自动应用。

待确认：

1. `fullTtlMin` 默认 30 分钟、可选 10/30/60——接受吗？
2. `full` 期间 exec/admin 每次调用记审计（不阻断）——够不够，还是要「首次调用需再确认一次」？
