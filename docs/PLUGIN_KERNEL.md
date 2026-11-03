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
| `onInbound` | `handleIncoming()`（`src/bridge.js:12694`）入口 | 私聊/群聊/断线补收都经过这里，只观察，不改消息 |
| `onPromptBuild` | `deliverPromptNow()` 的 `modelText` 组装处（`src/bridge.js:10918`） | 可向本轮 prompt 前/后追加文本 |
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
- 内置段落也用同一套语义：贴纸参考（`core-stickers`）与记忆摘要（`core-digest`）已迁到 bridge 自建的注册表，可用 `config.json` 的 `promptBlocks` 单独关闭或收紧限额（`{ "core-digest": { "enabled": false } }`）。**它与插件块分账**：插件块仍受 `plugins.json` 的 `limits.maxPromptAppendChars` 约束，内置段落维持原有长度，避免互挤；`/api/plugins` 的 `coreBlocks` 返回这两块的上限与调用次数。

---

## 6. 钩子契约

### 6.1 `onInbound(payload)`

```js
{ key, kind: 'private'|'group', userId, groupId, text, at, backfill: boolean }
```

只读观察（P1）。返回值忽略。用途：预热缓存、统计、审计。

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

### 6.3 `onAfterSend(payload)`

```js
{ key, text, ok: boolean, error?: string }
```

只读观察。用途：记账、失败告警、触发后续动作（后续动作也要走 host-api）。

### 6.4 `onShutdown()`

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
| `ctx.commands.register(def)` | `commands` | 注册插件命令（P3b，见 [COMMAND_REGISTRY.md](COMMAND_REGISTRY.md) §8）；卸载/停用/重载时按 pluginId 自动注销 |
| `ctx.prompt.registerBlock(def)` | `prompt:provide` | 注册具名注入块（P4，见 §5.4）；卸载/停用/重载时按 pluginId 自动注销 |
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

规则：

- 清单申请了但代码没用：允许（权限是上界，不是必须）。
- 代码用了但清单没申请：`ctx` 上根本没有该属性，调用即 `TypeError`。
- 权限变更必须改清单并重启桥接；内核不做热更新（P1 明确不做）。

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
- 字段：`{ ts, plugin, event, detail?, durationMs?, error? }`；`event ∈ {activate, error, timeout, deactivate, enable, disable, enable-failed, reload, reload-failed, install, install-failed, uninstall, uninstall-failed}`。
- 轮转：超过 `audit.maxBytes`（默认 5MB）时 rename 为 `.1`…`.N`（保留 `keep` 份），当前文件清空。
- `audit.enabled: false` 时只写日志，不落盘。
- 钩子成功调用**不逐条**记审计（噪声），只记 `activate/error/timeout`；批量统计见 `/api/plugins` 的计数。

---

## 11. 控制台

- 导航新增一项「桥接插件」（`data-view="plugins"`，`section-plugins`），位于「人格与角色」之后。
- 页面内容：启用状态与插件目录、人格 provider 来源、每个插件的 id/名称/版本/状态/hooks/调用与失败次数/最近错误；每张卡片带「启用/停用」「重载」「详情」「卸载」。
- 「安装插件」折叠区：上传 zip 或填服务器本地目录；安装即执行代码，页面上有明确提示。
- 「详情」弹窗显示：清单（权限/钩子/入口）、配置、计数（调用/失败/重载）、最近变更、最近错误、该插件最近 20 条审计。
- 页面明确提示：启用/停用只改本次运行，改配置或永久生效仍需重启桥接（P2c 才会做文件监听）。
- 接口：
  - `GET /api/plugins` → `{ enabled, dir, limits, audit, persona: { id, plugin, ... } | null, plugins: [{ id, name, version, status, hooks, error, updatedAt, counters: { hookCalls, hookErrors, lastHookAt, lastErrorAt, reloads } }] }`（没有 provider 生效时 `persona` 为 `null`）
  - `GET /api/plugins/:id` → `{ ok, plugin: { ...插件摘要, manifest, permissions, apiVersion, config, source: { dir, main }, audit: [最近 20 条] } }`
  - `POST /api/plugins/:id/reload` → `{ ok, plugin }`；失败 `{ ok: false, error, plugin }`（旧实例继续跑）
  - `POST /api/plugins/:id/enable` / `disable` → `{ ok, plugin }`
  - `POST /api/plugins/reload` → `{ ok, results: [{ id, ok, error }] }`
  - `POST /api/plugins/install` → 目录安装收 `{ path }`（JSON），zip 安装收原始 body；成功 `{ ok, plugin }`，失败 `{ ok: false, error }`
  - `DELETE /api/plugins/:id` → `{ ok, id, trash }`（`trash` 为相对路径；失败 `{ ok: false, error }`）
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

- P1：内核（发现、校验、配置、钩子、权限、审计、人格注册表）；`onInbound` / `onPromptBuild` / `onAfterSend` 接线；人格 provider 生效于 `currentRoleHintV2` + `buildWakePromptV2Core`；第一个插件 `soulkit-persona`；控制台只读页。
- P2a：运行期启用/停用/重载/详情（见 §5.1 / §11），控制台操作按钮与详情弹窗。
- P2b：本地目录 / zip 安装、卸载进 `state/_trash`、控制台安装区与「卸载」按钮（见 §5.2）。
- P2c：`watch: true` 时按文件变更自动重载对应插件（见 §5.3）；默认关闭。
- P4：具名注入块 `ctx.prompt.registerBlock`（见 §5.4），注册随 `commit` 入表、停用按 pluginId 注销，按 priority 排序、块级限额、超总预算整块跳过。

**明确不做（避免半成品）**：

- 插件市场、下载、签名、来源校验。
- 插件访问 MCP 工具或 DSH 内部对象。
- 多 provider 竞争（同一时刻只有一个 `persona:provide` 生效，后注册者覆盖并告警）。
- 事件总线式的任意钩子（只认 §6 四个名字）。

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
10. `npm run test:audit` 通过；`test-plugin-kernel.mjs`（清单/配置/超时/关闭/启停重载/监听/命令/注入块）、`test-plugin-install.mjs`（安装/回滚/穿越/卸载）与 `test-soulkit-persona.mjs`（拉卡/缓存/回落/TTL）全绿。
