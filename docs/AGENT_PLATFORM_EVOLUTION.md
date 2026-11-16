# Agent 平台适配层（AGENT_PLATFORM_EVOLUTION）

> **状态**：P0 目录迁移、P1 build/install 分离、P3 模式持久化 —— **已落地**；
> P2「中立 Agent IR」—— **已移交**，不再单独实施（见下方“P2 已移交”）。
>
> 最后更新：2026-11-14（补状态衔接；正文内容仍为 2026-11-13 版）。
>
> **⚠️ P2 已移交**：P2 的触发条件（“要接第二个 Agent 平台”）已满足，中立 Agent IR 的落地方式改由
> [PLATFORM_UNIFICATION.md](PLATFORM_UNIFICATION.md) §五（`AgentPort` 契约）与 C4–C6 接管；
> 本文 §三 保留为当时的设计意图与反模式清单，**不要单独照着实施**。P0 / P1 / P3 部分仍然现行。

---

## 一、要解决的问题

`profiles/` 与产物链此前是「读侧抽象了、写侧没抽象」：

| 位置 | 情况 |
| --- | --- |
| 读侧（`plans.agentPlatform`、`createAdapterRegistry`、`agentPlatformDir(id)`） | 已按平台 id 分发，加平台理论上可行 |
| 写侧（产物格式、构建器、安装器） | 100% 硬绑 DSH：源是 cordis 行列表、产物叫 `dsh-bundles`、安装是 448 行的 `setup-dsh.mjs` |
| `agent-platform.yml` 的 `artifacts:` 字段 | **死字段**：没有任何读者，值还指向早已删除的路径 |
| `templates/rows.yml` | 注释指向不存在的 `src/capabilities/build.mjs` / `build-capability-artifacts.mjs`（历史残留） |

结论：**平台假设泄漏到了本不该知道平台的地方**。修复方向不是「再加一层配置声明」，
而是把平台知识全部收进 `profiles/agent-platforms/<id>/adapters/`，调度层只做发现与调度。

---

## 二、已落地（P0 + P1 + P3）

### 2.1 目录分工

```
profiles/agent-platforms/<id>/
├── agent-platform.yml     # 元信息（id/label/tools/capabilities）——不声明产物路径
├── tools.yml              # 该平台的 Agent 模块目录（给人看 + 控制台用）
├── capabilities/<id>.yml  # 能力档：tools（拿到什么）+ preset（预设元信息）+ rows（预设正文）
│                          # C4 起原 agents/<agent>/（preset.yml + agent.cordis.yml + 守卫薄壳）并入这里
└── adapters/
    ├── build.mjs          # 源 → 产物（纯函数）
    ├── install.mjs        # 产物 → 运行时（幂等，有副作用）
    └── runtime.mjs        # 声明面：能力位、提示注入通道、权限权威和 modelCatalog

artifacts/<id>/            # 产物根，目录名 = agent 平台 id（当前只有 artifacts/dsh/）
```

`artifacts/dsh/qq-agent-presets/` 里两类文件性质不同，改之前先分清：

- **生成的**：`presets/*.patch.yml` —— 文件头写着「请勿手工编辑」，`npm run verify:artifacts` 会比对漂移。
- **手写的**：`qq-tool-restrict.mjs`（唯一权威守卫）、`qq-approval-gate.mjs`、`protected-paths.mjs`、`package.json` —— 构建不会覆盖它们。

### 2.2 适配器契约

`adapters/build.mjs`：

```js
export const agentPlatform = 'dsh';                      // 必须等于目录名，否则加载即报错
export function planArtifacts({ repoRoot }) {            // 纯函数
  return { files: [{ path, content }] };
}
```

- **必须是纯函数**：不写盘、不读 `process.env`、不依赖 cwd。
  否则 `--check`（只比对）与实际写入会走不同代码路径，「校验通过但产物不同」变成常态。
- `path` 必须落在 `repoRoot` 内且不重复，`content` 必须是字符串（可为空）——这些由
  `normalizeArtifactFiles()` 统一校验，适配器自己不用重复做。

`adapters/install.mjs`：

```js
export const agentPlatform = 'dsh';
export async function install({ repoRoot, profile, env, log }) {
  return { profile, runtimeHome, bundles: [...] };       // 失败抛错，不要 process.exit
}
```

- **必须抛错**：安装器被别的东西调用（测试、控制台 apply/rollback），`process.exit` 会杀宿主进程。
- 幂等：重复运行为同一结果；已存在的用户设置不覆盖。

`adapters/runtime.mjs` 是平台的**声明面**：能力位（`capabilities`）、提示注入通道（`RUNTIME_PROMPT`）、
权限权威支持面（`RUNTIME_PERMISSION`）、`apply` 认领（`RUNTIME_APPLY`），以及 B3 新增的 `modelCatalog`。

`modelCatalog` 是平台自描述的只读元数据：模型清单（`models`）、思考强度可选值、压缩策略的近似 token 数、
价目（`pricing` + `pricingPolicy`）。控制台与内核只消费它、不内置任何一家的模型名或价格——
没有声明就不报价、只计 token，压缩阈值也不猜。它与 `configSchema` 分工明确：前者是平台作者的只读元数据，
后者是用户可写的平台选项，混用会把作者笔误报成用户配置非法。注册表把它投影成
`GET /api/platforms/registry/agent/<id>/models` 的 `declared`，`live` 部分由平台自己的探活会话提供。

### 2.3 调度层（零平台知识）

| 脚本 | 职责 | 命令 |
| --- | --- | --- |
| `scripts/agent-platform-adapters.mjs` | 发现与校验适配器（约定优于声明：只看 `adapters/<kind>.mjs` 是否存在，**不读 `agent-platform.yml`**） | — |
| `scripts/build-artifacts.mjs` | 遍历平台 → `planArtifacts()` → 校验 → 写盘；`--check` 只比对 | `npm run build:artifacts` / `npm run verify:artifacts` |
| `scripts/install-agent-platform.mjs` | **先 build 再 install**（避免装旧产物） | `node scripts/install-agent-platform.mjs dsh [profile]` |
| `scripts/setup-dsh.mjs` | 兼容薄壳，等价于上一条 | 同旧用法 |

`scripts/build-agent-preset-patches.mjs` 也保留为兼容薄壳（re-export 旧 API），仓库里仍有测试按这个名字 import。

调度层刻意**只依赖 Node 内置模块、不 import `src/`**：离线夹具只要拷 `scripts/` 子集 + `profiles/` 整棵就能跑
（`scripts/test-audit-setup.mjs` 依赖这一点）。

### 2.4 模式持久化（P3）

`src/runtime/mode-store.mjs` 把「模式存哪、怎么读、怎么写」收成两个 backend：

| backend | 介质 | 语义 |
| --- | --- | --- |
| `local-file` | `state/mode.json` | 始终写，作为远端不可用时的兜底 |
| `dsh-settings` | DSH `qq-mode` 命名空间 | 尽力而为；`skipped: true` 表示「没有远端后端」而不是失败 |

边界很清楚：**store 只管存取**。模式别名归一、级别判定、提权（TOTP）仍然在 `bridge.js`，
因为那是业务语义，不是存储细节。`bridge.js` 不再自己拼 `state/mode.json` 的读写（有断言钉住）。

### 2.5 验收标准（已通过）

```bash
npm run test:artifact-pipeline   # 发现/校验/幂等/mock 平台隔离/入口存在
npm run verify:artifacts         # dsh 产物与源一致
npm run test:setup-idempotent    # 安装幂等
npm run verify:repo              # 含 P1/P3 的文本断言与全量语法检查
```

`test:artifact-pipeline` 里有一条**关键**用例：在临时仓库里只放一个 `profiles/agent-platforms/mock/adapters/build.mjs`，
不改任何调度代码，就能被发现、构建、且 `--check` 幂等 —— 这是「加平台不改调度器」的机械证明。

### 2.6 维护不变式

1. **不要在两个调度器里加平台分支**。发现 `if (platform === 'dsh')` 就说明抽象破了。
2. **不要把手写文件交给构建器**。`planArtifacts` 只负责 `presets/*.patch.yml`。
3. **不要让适配器读全局状态**（`process.env` / cwd / 当前时间）。产物必须可复现。
4. **安装失败要抛错**，由调用方决定退出码。
5. **新增平台只加目录**：`profiles/agent-platforms/<id>/` + `adapters/{build,install}.mjs`。

---

## 三、P2 规划：中立 Agent IR（暂缓，先看触发条件）

### 3.1 目标

把 `agents/<id>/agent.cordis.yml`（DSH 的 cordis 行列表）抽成平台无关的声明
`agents/<id>/agent.yml`，再由各平台适配器把它渲染成自己的格式。收益是**同一份 Agent 定义可装到多个 Agent 平台**。

> **2026-11-14 补记（C4）**：`agents/<id>/` 已经不存在——源是 `capabilities/<id>.yml` 的 `preset` + `rows` 段，
> 渲染产物是 `artifacts/dsh/qq-agent-presets/presets/<id>.patch.yml`（golden 已立：`build-artifacts --check` 逐字节比对）。
> 下文 §3.2–§3.5 里的 `agents/<id>/agent.yml` 请读作「能力档里的平台无关声明 + `platformSpecific.dsh.rows` 逃生舱」，
> 不要新建 `agents/` 目录。

### 3.2 提议结构（草案，不是最终版）

```yaml
version: 1
id: chat
label: QQ 聊天角色
order: 10
behavior: social-v1

prompt:
  persona: |            # 人格正文（平台无关）
    …
  platformText: qq      # 平台话术从 profiles/platforms/ 取，不在这里抄写

capabilities:           # 「能拿到什么」，与现有 capability 预设同构
  local: { fs: none, shell: none }   # none / read / write
  network: read
  mcp: [snowluma-safe, snowluma-host, web-search-safe]
  skills: allow

policy:
  approval: { mode: ask, except: [read] }
  compaction: { enabled: true, isolate: true }

platformSpecific:       # 逃生舱：原样注入某个平台，不做翻译
  dsh:
    rows: [ … ]         # 只放中立 IR 表达不了的行（见 §3.3）
```

### 3.3 为什么暂缓（硬证据）

1. **`cordis:group` 嵌套**：现有 `agent.cordis.yml` 用 `group: true` + `config: [子行]` 做上下文隔离层，
   中立 IR 若只描述「有哪些模块」，`walk()` 的层级信息就会丢，产物必须二次猜测分组。
2. **`isolate.compaction`、`row.id` 与 loader 名绑定**：这些是 DSH 的行装配语义（决定 compaction 是否隔离、
   行在 patch 里按什么 id 定位），不是「Agent 想做什么」。硬塞进中立 IR 只能变成 `platformSpecific` 逃生舱 ——
   那就等于**把行列表换个地方放**，没换来任何中立性。
3. **当前只有一个平台**：单平台下的 IR 是「给自己加一层翻译」——多一次序列化、多一处可能不一致，
   唯一的收益方是「将来」。而将来真接第二个平台时，第一手需求（新平台要什么）才会把 IR 的真实形状*逼*出来，
   现在设计只能靠猜。

**判断标准**：什么时候 IR 叫「设计」而不是「占位」？—— 当它必须同时满足两个平台、且第二个平台的适配器
不改中立层就能写出来的时候。

### 3.4 触发条件（满足任意一条再启动）

- 真要接第二个 Agent 平台（不是 PoC，是要能跑会话的）；
- 控制台需要**跨平台编辑**同一份 Agent（否则编辑器只需要认 `capabilities/<id>.yml` 的字段约定）；
- DSH 的 cordis 行格式连续两次破坏性变更（说明「把格式当源」的代价已经超过迁移成本）。

### 3.5 实施步骤（届时按序）

1. **先立黄金测试**：把现有 5 个预设的产物（现为 `artifacts/dsh/qq-agent-presets/presets/*.patch.yml`）固化成 golden；
   写「IR → dsh 行列表」的渲染器，逐字节等于 golden 才算迁移成功（不允许「语义等价」）。
2. 写能力档里的平台无关声明（原计划为 `agents/<id>/agent.yml`，现为 `capabilities/<id>.yml` 的 `preset` 段），只搬能被两个平台理解的部分；
   搬不动的原样留在 `platformSpecific.dsh.rows`，并**统计数量作为债务指标**（目标：逐版本下降，但不必归零）。
3. `adapters/build.mjs` 改为读 IR；对 `platformSpecific` 做「原样注入 + 位置校验」（仍要过 `normalizeRows` 的
   id 唯一、相对名改写、必需行检查）。
4. 校验器的硬要求：**任何平台无法表达的能力必须报错**，禁止静默降级（安全边界不能因为「那个平台不支持」而消失）。
5. 迁移期间保持现有产物可读：先用 IR 生成 `presets/*.patch.yml`，diff 为零后再删旧渲染路径。

### 3.6 验收标准

- 5 个 preset 的产物 diff 为零（逐字节）；
- `test-artifact-pipeline` 增加一个**第二个 mock 平台**，它能从同一份 IR 渲染出自己的格式；
- `platformSpecific` 的行数作为指标打印在 build 日志里；
- 安全相关（守卫名单、审批闸门、sandbox 语义）**全部仍在 `profiles/agent-platforms/dsh/` 内**，
  中立层只出现 `local.fs / network / mcp / skills` 这类粗粒度声明。

### 3.7 反模式（明确不要做）

- ❌ **只改名**：把 `agent.cordis.yml` 改成 `agent.yml` 但内容还是行列表 —— 零收益，纯 churn。
- ❌ **把 DSH 知识抽象掉**：工具白名单（67 个名字）、审批闸门挂载点、`danger-full-access` 的取舍，
  这些是**对 DSH 的理解**，属于平台目录；提到中立层只会让两边都读不懂。
- ❌ **中立层做默认值兜底**：`platformSpecific` 缺行时不要「猜一个合理的」，要报错。
- ❌ **跨平台迁移运行时会话**：IR 只描述「怎么装」，不描述「已经跑起来的会话怎么搬」。

---

## 四、变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-13 | P0：`dsh-bundles/` → `artifacts/dsh/`（代码与脚本里的引用全部替换，文档中只保留本搬迁记录） |
| 2026-11-13 | P1：build/install 拆进 `profiles/agent-platforms/dsh/adapters/`；新增三个调度脚本；`setup-dsh.mjs`、`build-agent-preset-patches.mjs` 降级为兼容薄壳 |
| 2026-11-13 | P3：`src/runtime/mode-store.mjs`（local-file + dsh-settings 两个 backend） |
| 2026-11-13 | 删除死字段 `agent-platform.yml` 的 `artifacts:`；新增 `test-artifact-pipeline.mjs` 与三条 npm scripts |
