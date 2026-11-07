# 桥接插件内核（PLUGIN_KERNEL）

> 状态：目标设计（v1.1.2 基线）· 实施阶段 P1
> 本文是插件机制的**唯一生效设计**。代码实现与本文不一致时，以本文为准并修正代码；新增能力先改本文再写代码。

---

## 0. 三个目录，三种东西，不要混

| 路径 | 是什么 | 由谁加载 | 例子 |
| --- | --- | --- | --- |
| `dsh-bundles/` | **给 DSH 加载的 npm bundle**（preset 行、`qq-mode` 设置命名空间） | DSH profile 的 `bundles` + `link:` | `qq-agent-presets`、`qq-mode-console` |
| `plugins/` | **桥接运行时插件**：本内核加载，进程内运行，只能通过 host-api 触碰桥接 | 桥接（`src/plugins/kernel.mjs`） | `soulkit-persona` |
| `src/plugins/` | 内核自身（发现、校验、钩子、权限、审计） | 桥接 | —— |

命名边界的原因：`plugins/` 是产品语义上的词，用户会以为「桥接的插件」在这里。v1.1.2 之前它装的是两个 DSH bundle，认知成本高；现在 bundle 归 `dsh-bundles/`，`plugins/` 留给本内核。

---

## 1. 为什么需要（接缝）

v1.1.2 的桥接把「入站 → 组 prompt → 调 DSH → 发 QQ」写在 `src/bridge.js` 一条主链上。要加一类横切能力（人格来源、消息过滤、发送后处理），只有两条路：

- 直接改 `bridge.js` 的对应位置 —— 每加一个能力就改一次主链，互相耦合；
- 或者在内核里定义**少量稳定钩子**，能力做成插件挂上去。

选后者。内核只承诺四个接缝，全部在 v1.1.2 里已收敛成单点：

| 钩子 | 挂载点（v1.1.2 行号） | 说明 |
| --- | --- | --- |
| `onInbound` | `handleIncoming()`（`src/bridge.js:12694`）入口 | 私聊/群聊/断线补收都经过这里；默认只观察，`filters.inbound=true` 且插件有 `inbound:filter` 时可丢/改 |
| `onPromptBuild` | `deliverPromptNow()` 的 `modelText` 组装处（`src/bridge.js:10918`） | 可向本轮 prompt 前/后追加文本 |
| `onReplyDecorate` | `auditAndSend()` → `sendToQQ()` 的逐段发送前（`src/bridge.js:9099`） | 只对模型回复；可改写或取消某一段，失败一律回落原文 |
| `onAfterSend` | `sendToQQ()`（`src/bridge.js:8832`）成功发出之后 | 观察发送结果 |
| `onShutdown` | 进程退出前 | 释放资源 |

人格是一个**服务**而不是钩子：`currentRoleHintV2()`（`src/bridge.js:11318`）与 `buildWakePromptV2Core()`（`src/bridge.js:12058`）需要「这个会话用哪张卡」，内核提供 provider 注册表，桥接优先问 provider，没有才回落 `roles/*.md`。

---

## 2. 目录与文件

```
plugins/
  soulkit-persona/
    plugin.json          # 清单（唯一权威描述）
    index.mjs            # 入口：export function activate(ctx)
    README.md            # 可选，给使用者看
  soulkit-memory/        # 记忆 provider（memory:provide，见 docs/MEMORY_SUBSYSTEM.md）
    plugin.json
    index.mjs
    README.md
src/plugins/
  kernel.mjs             # 发现、加载、钩子分发、人格注册表
  manifest.mjs           # 清单校验（纯函数，可单测）
  config.mjs             # plugins.json 读取、默认值、校验
  audit.mjs              # 审计落盘 + 轮转
  host-api.mjs           # 每个插件的 ctx 构造（权限在这里收口）
plugins.json             # 插件配置（独立文件，与 config.json 并列）
```

约定：

- 目录名必须等于清单里的 `id`（小写字母、数字、`-`，2–40 字符）。
- `main` 必须在插件目录内，禁止 `..` 与绝对路径。
- 一个插件一个入口；不允许插件目录里再嵌套插件。

---

## 3. 清单 `plugin.json`

```json
{
  "id": "soulkit-persona",
  "name": "soulkit 人格适配器",
  "version": "0.1.0",
  "description": "从 soulkit 取人格卡，替换 roles/*.md 作为人格来源",
  "main": "index.mjs",
  "apiVersion": 1,
  "permissions": ["persona:provide", "net:http"],
  "hooks": ["onInbound", "onPromptBuild"]
}
```

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `id` | 是 | `^[a-z][a-z0-9-]{1,39}$`，且等于目录名 |
| `name` | 是 | 1–60 字符 |
| `version` | 是 | `x.y.z` |
| `main` | 是 | 相对路径，不得越出插件目录 |
| `apiVersion` | 是 | 当前只接受 `1` |
| `permissions` | 是 | 数组，元素必须在权限表内（见 §8） |
| `hooks` | 否 | 声明会注册的钩子；未声明的钩子在注册时报错 |
| `description` | 否 | ≤ 200 字符 |

校验失败：该插件**不加载**，`/api/plugins` 显示 `invalid` 与原因，启动日志一行告警；不影响其它插件与桥接主链。

---

## 4. 配置文件 `plugins.json`

独立文件，和 `config.json` 并列。不存在时用默认值（内核启用、只加载内置目录，不报错）。

```json
{
  "enabled": true,
  "dir": "plugins",
  "watch": false,
  "limits": {
    "hookTimeoutMs": 2000,
    "maxPlugins": 32,
    "maxPromptAppendChars": 4000
  },
  "audit": { "enabled": true, "maxBytes": 5242880, "keep": 3 },
  "install": { "enabled": true, "maxBytes": 5242880 },
  "filters": { "inbound": false },
  "persona": {
    "provider": "soulkit",
    "cache": { "ttlMs": 300000, "minRefreshGapMs": 30000, "staleMaxMs": 86400000 }
  },
  "plugins": {
    "soulkit-persona": {
      "enabled": true,
      "config": { "baseUrl": "http://127.0.0.1:3110", "timeoutMs": 1200 }
    }
  }
}
```

规则：

- `enabled: false` 时内核不加载任何插件（配置仍校验，便于先备好再开）。
- `plugins.<id>.enabled: false` 只停这一个；`config` 原样交给插件，内核不解释字段。
- `persona.provider`：只启用这一个 provider（多个插件都声明 `persona:provide` 时其余被忽略）；`null`/缺省 = 第一个注册成功的生效。
- `persona.cache` 是**内核**的缓存策略，不是 provider 的字段：`ttlMs` 多久算新鲜、`minRefreshGapMs` 两次尝试的最小间隔、`staleMaxMs` 旧卡最多用多久（超过就回落本地卡）。
- `install.enabled: false` 时 `POST /api/plugins/install` 一律拒绝；`install.maxBytes` 同时限制上传包与解压后总量（默认 5MB，1MB–50MB）。
- `filters.inbound: false`（默认）时 `onInbound` 只观察，任何返回值都被忽略；打开后只有声明 `inbound:filter` 的插件能丢消息或改文字（见 §6.1）。
- 未知 `id` 只告警，不阻断启动（插件可能还没装）。
- 所有数值有上限（`hookTimeoutMs` ≤ 10000、`maxPlugins` ≤ 128、`maxBytes` ≥ 64KB），越界取默认并告警。
- 插件代码**不得**读写 `plugins.json`；需要持久化的东西走 `ctx.state`。

---

## 5. 生命周期

```
读取 plugins.json
  → 扫描 plugins/<id>/plugin.json（按 id 排序，稳定）
  → 校验清单 + 权限 + main 存在
  → import(main)            // 每次加载带 ?v=<mtime>，绕过 ESM 缓存
  → activate(ctx)  // 返回 { hooks?, dispose? }
  → 注册钩子（只允许清单声明的）+ 注册 persona provider
  → 运行中：钩子分发（每个钩子独立超时 + try/catch）
  → 退出：onShutdown 钩子 → dispose()（超时 2s）
```

- `activate` 抛错 → 该插件 `failed`，记审计，不重试（重启桥接或手动重载再试），不影响其它插件。
- 钩子抛错/超时 → 记审计 + 日志一行；该次调用视为无返回，**主链继续**。
- 插件之间不共享状态；相同钩子按清单 id 字典序执行，前一个的返回值不传给后一个（避免隐式耦合）。

### 5.1 运行期管理（P2a）

| 动作 | 接口 | 语义 |
| --- | --- | --- |
| 停用 | `POST /api/plugins/:id/disable` | 拆掉钩子、注销 provider、调 `dispose()`；进程内生效，**不写 `plugins.json`** |
| 启用 | `POST /api/plugins/:id/enable` | 从磁盘重新加载并激活；同样只改进程内状态 |
| 重载 | `POST /api/plugins/:id/reload` | 先构建新实例（钩子与 provider 暂存），成功后才拆旧实例并提交 |
| 全部重载 | `POST /api/plugins/reload` | 按 id 顺序逐个重载，单个失败不影响其它 |

- 重载失败时**旧实例继续运行**，错误记在 `status().plugins[].error` 与审计 `reload-failed`；不会出现「重载一半、插件没了」。
- 新实例的钩子与 provider 在 `activate` 成功前不进入全局索引，因此失败的新实例不会顶掉正在工作的旧 provider。
- 管理动作串行执行（内核内部一把锁），避免并发 reload 把钩子索引写乱。
- 「启用/停用」重启后回到 `plugins.json` 的决定；要永久生效请改配置（P2c 会做文件监听）。
- 停用/重载时正在执行的钩子可能仍在飞：分发前对状态做了快照并检查 `active`，被停用的插件不会再被新调用。

### 5.2 安装与卸载（P2b）

| 动作 | 接口 | 语义 |
| --- | --- | --- |
| 从目录安装 | `POST /api/plugins/install` + `{ "path": "D:\\dev\\my-plugin" }` | 复制到 `plugins/.staging-*/plugin`，校验清单后原子改名到 `plugins/<id>` |
| 从 zip 安装 | `POST /api/plugins/install` + `Content-Type: application/zip`（body 为原始字节） | 解压到暂存，要求**恰好一个**含 `plugin.json` 的根，再走同一套校验 |
| 卸载 | `DELETE /api/plugins/:id` | 先把目录移到 `state/_trash/plugins-<id>-<时间戳>/`，再 dispose 并从索引移除；不硬删 |

- 安装成功即激活（走 `buildInstance`）；激活失败会把刚放进 `plugins/` 的目录移进 `_trash` 回滚，不留半装状态。
- 清单不合法、id 非法、目标已存在 → 拒绝，且暂存目录在 `finally` 里清掉。
- 拒绝：绝对路径、`..` 段、符号链接（源目录与解压产物都查）、zip 路径穿越、超过 `install.maxBytes`、非 deflate/store 的压缩方法、加密/分卷/zip64。
- 安装**就是执行代码**：接口只对控制台令牌（owner）开放，每次 install/uninstall 都写审计；不做签名与来源校验（明确不做，见 §13）。
- `.staging-*` 目录不会被 `init()` 扫描，进程在安装中途崩掉也不会被当成插件加载。

### 5.3 文件监听自动重载（P2c）

`plugins.json` 的 `"watch": true` 时，内核用 `fs.watch(plugins/, { recursive: true })` 监听插件目录，**默认关闭**。

- 只重载「变更文件所属的那一个插件」：路径按 `plugins/<id>/...` 解析成 id，其余插件不受影响。
- 同一插件 500ms 内的多次事件合并成一次重载（编辑器保存经常连发好几个事件）。
- 只重载 `active` 的插件；`disabled` / `invalid` 不动，避免删目录或半成品把状态刷成 `reload-failed`。
- 重载走与手动 `POST /api/plugins/:id/reload` 完全相同的 staging 流程：失败保留旧实例，审计记 `reload-failed`。
- 监听不可用（平台不支持 `recursive`、目录不可读、`watcher` 抛错）→ **降级为只手动重载**，日志一行，不影响桥接启动。
- 为什么默认关：开发时方便，生产上「保存到一半」会触发半成品重载；宁可手动点一次。

### 5.4 具名注入块（P4）

`ctx.prompt.registerBlock(def)` 注册一段**有名字、有优先级、有块级上限**的 prompt 内容，用来替代「所有插件共用一条 append 管道」的写法。

```js
ctx.prompt.registerBlock({
  id: 'memory-recent',      // 必填，^[a-z][a-z0-9-]{1,39}$，同一插件内唯一
  priority: 100,            // 可选，默认 100，小的先渲染
  maxChars: 800,            // 可选，默认取总预算
  async render(ctx) {       // 必填，返回字符串；空串 = 本轮不注入
    return `【最近记忆】\n${await load()}`;
  },
});
```

- 注册同样在 `commit` 阶段入表：activate 抛错、清单非法、重载失败都不会留下半截块；停用 / 卸载 / 重载时按 pluginId 批量注销。
- 渲染发生在 `deliverPromptNow` 组装完人格与钩子前后缀之后；文本用空行接到末尾。
- 排序：`priority` 升序，同优先级按 `id` 升序（稳定，不依赖插件加载顺序）。
- 限额：单块超过 `maxChars` 截断并在报告里记 `truncated`；所有块合计超过 `limits.maxPromptAppendChars` 时**整块跳过**（记 `budget`），不会出现半句话。
- 单块 `render` 抛错只跳过该块（记 `error`），不影响其它块与主链路。
- `status().promptBlocks` 返回 `{ total, maxTotalChars, renders, injected, skipped, blocks: [...] }`，控制台插件详情能看到每个块的状态；`/api/plugins` 的条目带 `blocks`（注册的 id 列表）。
- 与 `onPromptBuild` 的分工：钩子适合「改别人的文本、加前后缀」，注入块适合「稳定贡献一段有归属的内容」；两者共用同一个总预算。
- 内置段落也用同一套语义：贴纸参考（`core-stickers`）、技能清单（`core-skills`）与记忆摘要（`core-digest`）已迁到 bridge 自建的注册表，可用 `config.json` 的 `promptBlocks` 单独关闭或收紧限额（`{ "core-digest": { "enabled": false } }`）。**它与插件块分账**：插件块仍受 `plugins.json` 的 `limits.maxPromptAppendChars` 约束，内置段落维持原有长度，避免互挤；`/api/plugins` 的 `coreBlocks` 返回这几块的上限与调用次数。

### 5.5 统一注入块来源（计划，未实现）

> 本节描述**目标形态**，当前代码只有「插件注册 + 三个写死的内置块」。落地顺序与判据见 [PLUGIN_ROADMAP.md](PLUGIN_ROADMAP.md) §8.10。写在这里是为了先把契约定死，避免上线时又分成两套。

**要解决的问题**：现在加一个新的注入块（例如长期记忆、群规、天气）必须改 `src/bridge.js`——加一行 `registerCoreBlock(...)`、加一份配置白名单、再改控制台目录。希望做到「声明一个块」或「插件注册一个块」即可，源码不动。

**统一模型**：所有块进同一个 `promptBlocks` 注册表，用 `owner` 区分来源，渲染管线只有一条。

| `owner` | 谁注册 | 生命周期 |
| --- | --- | --- |
| `core` | 桥接自身（`registerCoreBlock`） | 随桥接启动，`config.json` 的 `promptBlocks` 可开关 |
| `plugin:<id>` | 插件 `ctx.prompt.registerBlock`（已有） | 随插件 activate/commit/reload/dispose |
| `declared` | 配置声明（新增） | 随配置热加载，无需重启 |

**`source` 四种（声明式块用它选数据来源）**：

| `source.type` | 取数方式 | 典型用途 |
| --- | --- | --- |
| `builtin` | 由桥接内部函数提供（`builtin: stickers` / `skills` / `digest` / `memory`） | 需要运行时状态的块 |
| `text` | 配置里的静态文本，支持 `{{date}}` 等少量占位 | 固定提醒、群规摘要 |
| `file` | 读一个文件，带 TTL 与最大字节数 | 外部维护的记忆/规则文件 |
| `http` | `GET`/`POST` 一个本地地址，JSON 取文本字段，带超时与 TTL 缓存 | soulkit 这类外部记忆服务 |
| `memory` | 走 memory provider（§9.4） | 长期记忆，与 `persona:provide` 同构 |

**声明写法**（`config.json`，与现有 `promptBlocks` 合并为一节）：

```jsonc
{
  "promptBlocks": {
    "core-digest": { "enabled": true },
    "group-rules": {
      "enabled": true,
      "label": "群规",
      "priority": 140,
      "maxChars": 600,
      "source": { "type": "file", "path": "state/group-rules.md", "ttlMs": 60000 }
    },
    "soulkit-memory": {
      "enabled": true,
      "label": "长期记忆",
      "priority": 120,
      "maxChars": 900,
      "source": { "type": "memory", "provider": "soulkit", "timeoutMs": 1500 }
    }
  }
}
```

**渲染与隔离（沿用 §5.4 的既有语义，不新增规则）**：

- 排序按 `priority` 升序、同优先级按 `id`；单块 `maxChars` 截断记 `truncated`；总预算超限**整块跳过**记 `budget`。
- 单块取数失败（文件不存在、HTTP 非 2xx、provider 抛错、超时）→ 只跳过该块并记 `error`，写审计，不影响其它块与主链路。
- 声明式块与内置块**共用同一预算**；账号级总预算仍由 `limits.maxPromptAppendChars` 控制，内置块可用 `maxChars` 单独收紧。
- `status().promptBlocks` 与 `/api/plugins` 的 `coreBlocks` 合并成一张表：`{ id, owner, label, priority, maxChars, calls, lastChars, truncated, skipped }`，控制台「内置注入块」区按 owner 分组展示。

**明确不做**：不允许声明式块执行任意脚本（不做 `source.type = "script"`）；需要计算能力的块必须写成插件，走已定义的钩子与权限。

**验收判据**（落地时按此验收）：

1. 新增一个 `source.type = "file"` 的块只改 `config.json`，重启后出现在 `/api/plugins` 的块表里、唤醒提示里能看到，源码无改动。
2. 该块路径写错时唤醒照常完成，日志一条 warn、审计一条 `error`，其它块不受影响。
3. 关掉块后提示词里整段消失、字数预算立即回收。
4. `test-prompt-blocks` 增加「声明式块：正常 / 文件缺失 / 超预算 / 热关」四个用例。

---

## 6. 钩子契约

### 6.1 `onInbound(payload)`

```js
{ key, kind: 'private'|'group', userId, groupId, text, textContent, at, backfill: boolean }
```

`text` 是当前消息自己的文字（不含引用原文），`textContent` 带引用上下文，两者都已通过模式校验与空文本过滤。

默认（`plugins.json` 里 `"filters": { "inbound": false }`）**只读观察**，返回值忽略。打开过滤后，声明了 `inbound:filter` 权限的插件可以返回：

```js
undefined                      // 不干预
{ drop: true }                 // 整条消息丢弃：不记录、不唤醒、不走命令
{ text: '替换后的正文' }        // 替换 text 与 textContent
```

- 多个插件按 id 顺序链式执行，前一个的 `text` 是后一个的输入；`drop` 直接短路，后面前插件不再执行。
- 没申请 `inbound:filter` 的插件返回动作会被忽略（审计 `inbound-denied`），只观察不受影响。
- 替换文本上限 4000 字，超了忽略并记审计；`drop` 发生在写入社交历史之前，消息不会留痕——只该用于垃圾消息/明确拦截。
- 钩子抛错或超时：保留上一步结果，主链按当前文本继续。

### 6.2 `onPromptBuild(payload)`

```js
{
  key, sessionId, mode,               // 会话
  text,                               // 本轮已组装好的 prompt（只读）
  persona: { name, source } | null    // 当前生效人格（provider 或 roles）
}
```

返回值：

```js
{ prependText?: string, appendText?: string }
```

- 只接受字符串；超过 `limits.maxPromptAppendChars` 截断并告警。
- 多个插件都追加时，按 id 顺序：prepend 依次前插，append 依次后接。
- 不允许修改 `text` 本身（要改写就自己返回新块，别偷偷替换别人的内容）。

### 6.3 `onReplyDecorate(payload)`

```js
{ key, text, partIndex, totalParts }
```

发送前逐段调用（只对模型回复生效，确认语/系统通知不装饰）。返回值：

- 字符串：替换这一段；
- `{ text }`：同上，便于以后加字段；
- `{ drop: true }`：取消这一段（其余段照发）；
- `undefined` / `null`：不改。

按插件 id 顺序**链式**执行，后一个拿到前一个改过的 `text`。任何一步抛错或超时都保留上一步的结果（最差是原文），装饰失败不会让消息发不出去；装饰后的文本仍会再过一次敏感信息审计，不能借装饰绕过。

### 6.4 `onAfterSend(payload)`

```js
{ key, text, ok: boolean, error?: string }
```

只读观察。用途：记账、失败告警、触发后续动作（后续动作也要走 host-api）。

### 6.5 `onShutdown()`

无参数，同步或异步均可，超时 2s。

---

## 7. host-api（`ctx`）

每个插件拿到的 `ctx` 是**按权限裁剪**的：没申请的能力，对应属性为 `undefined`。

| 属性 | 权限 | 说明 |
| --- | --- | --- |
| `ctx.id` / `ctx.version` | —— | 清单里的值（只读） |
| `ctx.log(message)` | —— | 带 `[plugin:<id>]` 前缀，进桥接日志 |
| `ctx.config` | —— | `plugins.json` 里该插件的 `config`，深冻结 |
| `ctx.state.read(name)` | `state` | 读 `state/plugins/<id>/<name>.json`，不存在返回 `null` |
| `ctx.state.write(name, value)` | `state` | 原子写（临时文件 + rename），值必须可 JSON 序列化 |
| `ctx.persona.register(provider)` | `persona:provide` | 注册人格 provider（§8），同时只能有一个生效 |
| `ctx.persona.unregister()` | `persona:provide` | 注销自己注册的 provider |
| `ctx.memory.registerProvider(provider)` | `memory:provide` | 注册记忆 provider（[MEMORY_SUBSYSTEM.md](MEMORY_SUBSYSTEM.md) §2.1）；同一时刻可以有多个，注入源由 `memory.inject.provider` 单选 |
| `ctx.memory.unregisterProvider()` | `memory:provide` | 注销自己注册的记忆 provider |
| `ctx.commands.register(def)` | `commands` | 注册插件命令（P3b，见 [COMMAND_REGISTRY.md](COMMAND_REGISTRY.md) §8）；卸载/停用/重载时按 pluginId 自动注销 |
| `ctx.prompt.registerBlock(def)` | `prompt:provide` | 注册具名注入块（P4，见 §5.4）；卸载/停用/重载时按 pluginId 自动注销 |
| `ctx.scheduler.registerTaskType(def)` | `task-type:provide` | 注册一种定时任务类型（见 §8.1）；任务存在 `state/scheduler.json`，重启后仍在 |
| `ctx.qq.send(key, text)` | `send:qq` | 走桥接的 `sendToQQ`，受现有发送限流与白名单约束 |
| `ctx.http.requestJson(url, opts)` | `net:http` | 同上，但返回 `{ status, etag, json }`；`304` 时 `json: null`（条件请求用） |
| `ctx.http.fetchJson(url, opts)` | `net:http` | 仅 `http/https`、超时、响应体上限 256KB；只返回 JSON |
| `ctx.now()` / `ctx.random()` | —— | 便于测试注入 |

约束：

- `ctx.state` 的文件名只允许 `^[a-z0-9][a-z0-9-]{0,40}$`，禁止 `..`。
- `ctx.qq.send` 的目标 `key` 必须已存在于桥接的会话表；不存在直接拒绝（防止插件凭空造会话）。
- `ctx.http.fetchJson` 不允许访问环回地址以外的内网段（与 `safe-fetch.js` 的策略一致），供 soulkit 这类本机服务例外放行需在配置里显式声明 `allowLoopback: true`。

---

## 8. 权限表

| 权限 | 含义 | 风险 |
| --- | --- | --- |
| `state` | 读写自己的状态目录 | 低（隔离在 `state/plugins/<id>/`） |
| `persona:provide` | 提供人格卡 | 中（影响 AI 说话方式） |
| `send:qq` | 主动发 QQ 消息 | 高（可能骚扰） |
| `net:http` | 出站 HTTP | 中（数据外发） |
| `commands` | 注册插件命令 | 中（命令会被用户直接调用；内置命令优先，冲突不覆盖） |
| `prompt:provide` | 注册具名注入块 | 中（影响 AI 每轮看到的内容；有块级与总预算上限） |
| `task-type:provide` | 注册定时任务类型 | 中（到点会真的发消息；走现有白名单、限额、免打扰与模式判定） |
| `inbound:filter` | 入站丢消息/改文字 | 高（丢消息不留痕、改文字会影响命令判定；默认 `filters.inbound=false` 时不生效） |

规则：

- 清单申请了但代码没用：允许（权限是上界，不是必须）。
- 代码用了但清单没申请：`ctx` 上根本没有该属性，调用即 `TypeError`。
- 权限变更必须改清单并重启桥接；内核不做热更新（P1 明确不做）。

### 8.1 定时任务类型（`task-type:provide`）

插件可以让「定时任务」里出现自己的类型，比如「每周一抓一次周报发给我」。桥接只负责**到点、发去哪儿、限额、免打扰**，具体做什么由插件实现。

```js
ctx.scheduler.registerTaskType({
  id: 'weekly-digest',          // 小写 + 连字符，和插件 id 同一套规则
  label: '周报摘要',             // 控制台下拉里显示的名字
  description: '把最近 7 天群聊做成摘要', // 可选，一句话说明
  // 可选：把用户填的表单（任意 JSON）规范成要存进任务的 payload；抛错即拒绝保存。
  validate(input) {
    const week = String(input?.payload?.week ?? '').trim();
    if (!week) throw new Error('要填哪一周');
    return { week };
  },
  // 必填：每个发送对象调用一次；返回 { status: 'sent' | 'skipped' | 'failed', reason? }。
  async run(task, context) {
    // task.payload 是上面 validate 的返回值；task.targets / task.schedule 也可读
    // context: { target, manual, scheduledAt, whenText, log }
    await context.log(`跑 ${task.id} 给 ${context.target}`);
    return { status: 'sent' };
  },
});
```

约束与行为：

- 同一 id 只保留**先注册**的那个：后注册的插件只记日志（不覆盖、不报错）。
- 任务保存时调用 `validate`；它返回的值就是 `payload`，必须可 JSON 序列化（建议对象）。
- 到点执行时每个 target 调一次 `run`，单次超时 60 秒；抛错记 `failed`，任务**不自动停用**，下次照常。
- 停用/卸载/重载插件时按 pluginId 注销类型：已存在的任务**保留在文件里**（不会删），执行时返回 `failed`（原因「任务类型未注册」），控制台里的类型名显示为空。
- 类型未注册时不能新建这类任务（`未知任务类型「x」`），编辑已有任务时也一样。
- 执行仍受既有约束：会话在当前模式下可用、定时静默策略、每日条数/间隔限额、白名单。

---

## 9. 人格 provider 契约

完整设计（三层优先级、缓存与降级、控制台）见 [`PERSONA_PROVIDER.md`](PERSONA_PROVIDER.md)。这里只写插件作者必须遵守的部分。

### 9.1 接口（`persona-provider/1`）

```js
ctx.persona.register({
  id: 'soulkit',
  contract: 'persona-provider/1',
  capabilities: { perSession: true, conditional: true, listable: false },
  async get(key, { etag } = {}) {
    // 三选一：
    return { status: 'card', card: { name: '星苒', text: '……' }, etag: 'W/"1"' };
    // return { status: 'none', reason: 'unbound' };          // 这个会话没有卡
    // return { status: 'not-modified', etag: 'W/"1"' };      // 条件请求命中 304
  },
});
```

- `get` 允许异步；桥接的注入点是同步的，由内核的注册表在唤醒时 `warm()` 一次，注入时只读缓存。
- 返回 `card` 时 `name`/`text` 必填；**指纹不用给**，内核按 `name + text` 算（16 位十六进制，供角色刷新去重）。
- `get` 抛错 = 本次不可用：注册表保留旧卡（`staleMaxMs` 内继续用），超时后回落本地卡；连续失败只告警一次。
- TTL、单飞、最小刷新间隔、旧卡降级、持久化都在注册表里。**provider 不要自己再写一套缓存**，否则会出现两份 TTL、两套行为。

### 9.2 与桥接的接线

| 位置 | 行为 |
| --- | --- |
| `currentRoleHintV2(key)`（注入正文） | 三层解析：L1 会话覆盖 → L2 provider 缓存卡 → L3 全局本地卡；`off` 硬覆盖 |
| `currentRoleFingerprintV2(key)` | 同一张卡的指纹，决定是否注入「角色卡已更新」；没卡时也给稳定指纹 |
| `buildWakePromptV2Core` / `buildWakeReminderPromptV2` / `qq_get_prompt` | 角色名用同一解析结果，不再各自读 `roles/*.md` |
| `deliverPromptNow(key)`（唤醒时） | 先 `personaWarm(key)`（异步、有超时、失败不阻塞），再组 prompt |
| `/role` 命令与「人格与角色」页 | 仍管理 `roles/*.md` 与会话覆盖（L1/L3）；provider 不接管选择，`off` 对 provider 生效 |

### 9.3 soulkit 适配器（第一个插件）

- 端点已实现（`soulkit/src/api/http.mjs`）：`GET {baseUrl}/api/persona/card?platform=qq&key=<group:…|private:…>`。
  - 命中 → `{ ok: true, mode: 'card', name, text, sha, chars, etag, … }` + `ETag`。
  - 未绑定 → `{ ok: true, mode: 'none', reason: 'unbound' }`；没有 key → `reason: 'no-key'`。
  - 带 `If-None-Match` 命中缓存 → `304`。
- 适配器把 `mode: 'none'` 映射为 `status: 'none'`，把卡片正文开头的 `【人格卡：名字｜sha】` 行剥掉（桥接自己会注入【当前角色】），其余原样交给注册表。
- `baseUrl` 默认 `http://127.0.0.1:3110`；`timeoutMs` 默认 1200（200–5000）。插件没有钩子，刷新时机由内核决定。
- `plugins.json` 建议显式写 `persona.provider: "soulkit"`：多个 provider 插件同时装着时，避免「谁先注册谁生效」的隐式行为。

---

## 10. 审计

- 文件：`state/plugin-audit.jsonl`，一行一个 JSON。
- 字段：`{ ts, plugin, event, detail?, durationMs?, error? }`；`event ∈ {activate, error, timeout, deactivate, enable, disable, enable-failed, reload, reload-failed, install, install-failed, uninstall, uninstall-failed, inbound-denied}`。
- `inbound-denied`：插件返回了入站动作但没有 `inbound:filter`，或替换文本超长——动作被忽略，原消息继续。
- 轮转：超过 `audit.maxBytes`（默认 5MB）时 rename 为 `.1`…`.N`（保留 `keep` 份），当前文件清空。
- `audit.enabled: false` 时只写日志，不落盘。
- 钩子成功调用**不逐条**记审计（噪声），只记 `activate/error/timeout`；批量统计见 `/api/plugins` 的计数。

---

## 11. 控制台

- 导航新增一项「桥接插件」（`data-view="plugins"`，`section-plugins`），位于「人格与角色」之后。
- 页面内容：启用状态与插件目录、人格 provider 来源、每个插件的 id/名称/版本/状态/hooks/调用与失败次数/最近错误；每张卡片带「启用/停用」「重载」「详情」「卸载」。
- 「安装插件」折叠区：上传 zip 或填服务器本地目录；安装即执行代码，页面上有明确提示。
- 「详情」弹窗显示：清单（权限/钩子/入口）、配置、计数（调用/失败/重载）、最近变更、最近错误、该插件最近 20 条审计。
- 「内置注入块」折叠区：`core-stickers` / `core-digest` 的开关与字符上限；保存写 `config.json`，**立即生效**。
- 「运行设置」折叠区：`filters.inbound`、`watch`、高级里的 `limits.hookTimeoutMs` / `limits.maxPromptAppendChars`、`install.enabled`；保存写 `plugins.json`，除 `persona.provider` 外都**立即生效**。
- 「详情」弹窗底部可把该插件写回 `plugins.json`（`plugins.<id>.enabled`），重启后保持；卡片上的启用/停用仍只改运行态。
- 页面明确提示：启用/停用只改本次运行；写配置的开关保存后立即生效，但 `persona.provider` 与插件启用状态需重启。
- 接口：
  - `GET /api/plugins` → `{ enabled, dir, watch, watching, filters: { inbound }, install: { enabled, maxBytes }, limits, audit, persona: { id, plugin, ... } | null, plugins: [...], coreBlocks: { total, maxTotalChars, blocks, catalog: [{ id, label, enabled, maxChars, registered, calls }] } }`（没有 provider 生效时 `persona` 为 `null`）
  - `GET /api/plugins/:id` → `{ ok, plugin: { ...插件摘要, manifest, permissions, apiVersion, config, source: { dir, main }, audit: [最近 20 条] } }`
  - `POST /api/plugins/:id/reload` → `{ ok, plugin }`；失败 `{ ok: false, error, plugin }`（旧实例继续跑）
  - `POST /api/plugins/:id/enable` / `disable` → `{ ok, plugin }`
  - `POST /api/plugins/reload` → `{ ok, results: [{ id, ok, error }] }`
  - `POST /api/plugins/install` → 目录安装收 `{ path }`（JSON），zip 安装收原始 body；成功 `{ ok, plugin }`，失败 `{ ok: false, error }`
  - `DELETE /api/plugins/:id` → `{ ok, id, trash }`（`trash` 为相对路径；失败 `{ ok: false, error }`）
  - `PATCH /api/plugins/settings` → body 只认 `watch`、`filters.inbound`、`limits.{hookTimeoutMs,maxPromptAppendChars}`、`install.enabled`、`persona.provider`、`plugins.<id>.enabled`；其余字段忽略；校验失败整份不落盘，返回 `{ ok: false, error }`；成功 `{ ok, config, restartRequired, warnings }`
  - `PATCH /api/config/promptBlocks` → body `{ promptBlocks: { <id>: { enabled?, maxChars? } } }`；`maxChars: null` 表示恢复默认；成功 `{ ok, promptBlocks, coreBlocks }`
- 读取需要控制台令牌；这些接口都不在 agent token 白名单里，QQ 会话内的 AI 调不到。
- 所有写接口要求 `Content-Type: application/json`（控制台的 `api()` 已自动带），否则返回 415；例外是插件 zip 上传（`application/zip`）与插件卸载的 `DELETE`（无请求体），Origin 校验对两者同样生效。

---

## 12. 失败隔离与上限

| 情况 | 行为 |
| --- | --- |
| 清单非法 | 不加载，`invalid`，启动日志一行 |
| `activate` 抛错 | `failed`，记审计，不重试 |
| 钩子抛错 | 记审计 + 日志，主链继续 |
| 钩子超时 | 记 `timeout`，主链继续（超时的 Promise 不取消，但结果丢弃） |
| prompt 追加超长 | 截断到 `maxPromptAppendChars`，日志一行 |
| 插件数超 `maxPlugins` | 按 id 排序截断，日志告警 |
| 重载失败 | 旧实例继续跑，错误记 `reload-failed`；新实例的钩子/provider 未提交，不会污染注册表 |
| 停用 | 拆钩子 + 注销 provider + `dispose()`；正在飞的钩子调用结果仍会被丢弃（状态快照在调用前） |
| 管理动作并发 | 内核串行执行，后到的动作排队，不会写乱钩子索引 |
| 安装失败（清单/加载） | 刚放进 `plugins/` 的目录移进 `state/_trash` 回滚；暂存目录在 `finally` 清掉；记 `install-failed` |
| 安装/卸载期间进程崩溃 | 残留 `.staging-*` 不被 `init()` 扫描；已提交的安装目录若清单坏了也只是 `invalid`，不影响其它插件 |
| 卸载失败（目录移不走） | 返回错误且**不** dispose 运行实例，记 `uninstall-failed`，避免「目录还在、插件却没了」 |
| 文件监听不可用 | `fs.watch` 抛错或 `watcher` 发 error → 停止监听、日志一行，后续只手动重载；不影响桥接启动 |

---

## 13. 已实现范围与明确不做

**已实现**：

- P1：内核（发现、校验、配置、钩子、权限、审计、人格注册表）；`onInbound` / `onPromptBuild` / `onReplyDecorate` / `onAfterSend` 接线；人格 provider 生效于 `currentRoleHintV2` + `buildWakePromptV2Core`；第一个插件 `soulkit-persona`；控制台只读页。
- P2a：运行期启用/停用/重载/详情（见 §5.1 / §11），控制台操作按钮与详情弹窗。
- P2b：本地目录 / zip 安装、卸载进 `state/_trash`、控制台安装区与「卸载」按钮（见 §5.2）。
- P2c：`watch: true` 时按文件变更自动重载对应插件（见 §5.3）；默认关闭。
- P4：具名注入块 `ctx.prompt.registerBlock`（见 §5.4），注册随 `commit` 入表、停用按 pluginId 注销，按 priority 排序、块级限额、超总预算整块跳过；内置段 `core-stickers` / `core-digest` 已走同一注册表（单独预算）。
- 出站装饰：`onReplyDecorate` 链式改写/取消模型回复的某一段（见 §6.3），装饰失败或超时一律回落原文。
- 入站过滤：`filters.inbound: true` 时 `onInbound` 可返回 `{ drop }` / `{ text }`（见 §6.1），需 `inbound:filter` 权限；默认关闭，关闭时返回值全部忽略。
- 定时任务类型：`ctx.scheduler.registerTaskType`（见 §8.1），需 `task-type:provide`；类型按 pluginId 注销，任务本身留在 `state/scheduler.json`。

**明确不做（避免半成品）**：

- 插件市场、下载、签名、来源校验。
- 插件访问 MCP 工具或 DSH 内部对象。
- 多 provider 竞争（同一时刻只有一个 `persona:provide` 生效，后注册者覆盖并告警）。
- 事件总线式的任意钩子（只认 §6 五个名字）。

> P2 及以后的规划（启停/重载、安装卸载、命令注册、注入块、MCP/Skills 门槛）见 [PLUGIN_ROADMAP.md](PLUGIN_ROADMAP.md)。本文件只描述**已经实现**的能力；路线图里的条目在落地前不会写进这里。

---

## 14. 验收

1. `plugins.json` 不存在 → 桥接正常启动，`/api/plugins` 返回空列表 + 默认配置。
2. 非法清单（坏 JSON / id 与目录不符 / 越界 `main`）→ 该插件 `invalid`，其它插件正常。
3. 钩子抛错或卡死 → 消息照常处理，审计有 `error`/`timeout` 记录。
4. 启用 `soulkit-persona` 且 soulkit 在线 → 唤醒 prompt 里的人格来自 soulkit，`【当前角色】` 名字一致；soulkit 离线 → 回落 `roles/*.md`，不报错。
5. 未申请 `send:qq` 的插件拿不到 `ctx.qq`。
6. P2a：停用后钩子不再被调用、provider 不再解析；启用后恢复；重载读到新代码与新版本；重载一个 `activate` 抛错的插件 → 旧实例仍在、错误可见。
7. P2b：目录安装成功即激活、重复安装被拒；坏清单不残留目录与暂存；zip 里 `../`、超限、多个根都被拒；卸载把目录移进 `state/_trash` 且运行实例先被 dispose。
8. P2c：默认 `watch:false`；设 `true` 后改 `plugins/<id>/index.mjs` 会在 5 秒内重载该插件（`counters.reloads` 增长），改 `plugins.json` 本身不会触发热生效；监听不可用时桥接照常启动。
9. P4：两个插件各注册一个块 → prompt 末尾按 priority 顺序出现；单块超 `maxChars` 被截断、合计超总预算的块整块跳过；停用其中一个 → 它的块立即消失；`onPromptBuild` 的旧用法不受影响。
10. 出站装饰：两个插件链式改写 → 后一个看到前一个的结果；`{ drop: true }` 取消该段；装饰抛错或超时 → 原文照发；停用后链自动缩短。
11. 入站过滤：默认 `filters.inbound:false` 时插件返回 `{ drop }` 不生效、消息照常处理；打开后同一条消息被丢弃/改写；没申请 `inbound:filter` 的插件动作被忽略并记 `inbound-denied`；替换文本超 4000 字被忽略。
12. 定时任务类型：插件注册后控制台「定时任务」的内容区出现该类型；保存时 `validate` 抛错会被拦下；到点每个 target 调一次 `run`，超 60 秒或抛错记 `failed` 且任务不停用；停用插件后类型消失、已有任务仍在文件里、编辑这类任务被拒（`未知任务类型`）。
13. `npm run test:audit` 通过；`test-plugin-kernel.mjs`（清单/配置/超时/关闭/启停重载/监听/命令/注入块/出站装饰/入站过滤/任务类型）、`test-plugin-install.mjs`（安装/回滚/穿越/卸载）、`test-scheduler.mjs`（时区/规则/引擎/命令/桥接/控制台/插件任务类型）与 `test-soulkit-persona.mjs`（拉卡/缓存/回落/TTL）全绿。
