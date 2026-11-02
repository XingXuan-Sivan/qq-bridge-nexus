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
  "limits": {
    "hookTimeoutMs": 2000,
    "maxPlugins": 32,
    "maxPromptAppendChars": 4000
  },
  "audit": { "enabled": true, "maxBytes": 5242880, "keep": 3 },
  "plugins": {
    "soulkit-persona": {
      "enabled": true,
      "config": { "baseUrl": "http://127.0.0.1:3110", "timeoutMs": 1200, "holder": "star" }
    }
  }
}
```

规则：

- `enabled: false` 时内核不加载任何插件（配置仍校验，便于先备好再开）。
- `plugins.<id>.enabled: false` 只停这一个；`config` 原样交给插件，内核不解释字段。
- 未知 `id` 只告警，不阻断启动（插件可能还没装）。
- 所有数值有上限（`hookTimeoutMs` ≤ 10000、`maxPlugins` ≤ 128、`maxBytes` ≥ 64KB），越界取默认并告警。
- 插件代码**不得**读写 `plugins.json`；需要持久化的东西走 `ctx.state`。

---

## 5. 生命周期

```
读取 plugins.json
  → 扫描 plugins/<id>/plugin.json（按 id 排序，稳定）
  → 校验清单 + 权限 + main 存在
  → import(main)
  → activate(ctx)  // 返回 { hooks?, dispose? }
  → 注册钩子（只允许清单声明的）
  → 运行中：钩子分发（每个钩子独立超时 + try/catch）
  → 退出：dispose()（超时 2s）→ onShutdown 钩子
```

- `activate` 抛错 → 该插件 `failed`，记审计，不重试（重启桥接再试），不影响其它插件。
- 钩子抛错/超时 → 记审计 + 日志一行；该次调用视为无返回，**主链继续**。
- 插件之间不共享状态；相同钩子按清单 id 字典序执行，前一个的返回值不传给后一个（避免隐式耦合）。

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
| `ctx.qq.send(key, text)` | `send:qq` | 走桥接的 `sendToQQ`，受现有发送限流与白名单约束 |
| `ctx.http.fetchJson(url, opts)` | `net:http` | 仅 `http/https`、超时、响应体上限 256KB；不跟随跨域重定向 |
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

规则：

- 清单申请了但代码没用：允许（权限是上界，不是必须）。
- 代码用了但清单没申请：`ctx` 上根本没有该属性，调用即 `TypeError`。
- 权限变更必须改清单并重启桥接；内核不做热更新（P1 明确不做）。

---

## 9. 人格 provider 契约

### 9.1 接口

```js
{
  id: 'soulkit',                       // 稳定标识
  async refresh(key) {},               // 可选：拉取/刷新缓存，失败抛错由内核记为日志
  resolve(key) {                       // 同步；只读缓存
    return { name: '星苒', text: '……', fingerprint: 'sha256:…' } | null;
  }
}
```

- `resolve` 必须同步（prompt 组装是同步链路）。需要网络的 provider 自己在 `refresh` 里预取，`resolve` 只读缓存。
- 返回 `null` 表示「这个会话我不提供」，桥接回落到 `roles/*.md`。
- `fingerprint` 用于「换卡后是否需要重新注入」；缺省时内核用 `sha256(name + '\n' + text)`。

### 9.2 与桥接的接线

- `currentRoleHintV2(key)`：先 `plugins.persona.resolve(key)`，有值用它的 `text`；否则走 `roleHintForMode('v2', key)`。
- `buildWakePromptV2Core(key)`：`roleName` 先取 provider 的 `name`，否则 `roleNameForKey(key)`。
- 控制台的「人格与角色」页与 `/role` 命令**不受** provider 影响（P1）：它们管理的是 `roles/*.md`；provider 只替换注入内容。文档与页面需明确写这一句。

### 9.3 soulkit 适配器（第一个插件）

- `GET {baseUrl}/api/persona/card?holder=<holder>` 取卡；响应 `{ name, text, fingerprint? }`（缺 `name`/`text` 视为坏卡）。
- **依赖状态**：soulkit 侧尚未实现该端点，适配器已按契约实现并有离线测试；端点上线条前运行时会一直回落 `roles/*.md`。
- 缓存：内存 + `ctx.state`（`card.json`），TTL 5 分钟；`onInbound` 时若缓存过期则后台 `refresh`（不阻塞消息处理）。
- `baseUrl` 默认 `http://127.0.0.1:3110`；`holder` 默认空（soulkit 用默认 holder）。
- 失败策略：保留上一份缓存；一次失败期内只打一行日志（成功后重置），异常不抛到主链。

---

## 10. 审计

- 文件：`state/plugin-audit.jsonl`，一行一个 JSON。
- 字段：`{ ts, plugin, event, detail?, durationMs?, error? }`；`event ∈ {activate, hook, error, timeout, deactivate}`。
- 轮转：超过 `audit.maxBytes`（默认 5MB）时 rename 为 `.1`…`.N`（保留 `keep` 份），当前文件清空。
- `audit.enabled: false` 时只写日志，不落盘。
- 钩子成功调用**不逐条**记审计（噪声），只记 `activate/error/timeout`；批量统计见 `/api/plugins` 的计数。

---

## 11. 控制台

- 导航新增一项「桥接插件」（`data-view="plugins"`，`section-plugins`），位于「人格与角色」之后。
- 页面内容（P1 只读）：启用状态与插件目录、人格 provider 来源、每个插件的 id/名称/版本/状态/hooks/调用与失败次数/最近错误。**不做启停开关**：P1 没有写配置的接口，开关会变成「点了但没生效」的假按钮；启停请改 `plugins.json` 后重启桥接，页面明确提示这一点。
- 接口：
  - `GET /api/plugins` → `{ enabled, dir, limits, audit, persona: { id, plugin } | null, plugins: [{ id, name, version, status, hooks, error, counters: { hookCalls, hookErrors, lastHookAt, lastErrorAt } }] }`
  - `POST /api/plugins/reload`（P1 只返回 `{ ok: false, restartRequired: true }` + 409，不做热重载）
- 读取需要控制台令牌；两个接口都不在 agent token 白名单里，QQ 会话内的 AI 调不到。

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

---

## 13. P1 范围（本次实现）与明确不做

**做**：

- 内核：发现、校验、配置、钩子、权限、审计、人格注册表。
- 接线：`onInbound`（`handleIncoming` 入口）、`onPromptBuild`（`deliverPromptNow` 的 `modelText` 处）、`onAfterSend`（`sendToQQ` 成功处）。
- 人格 provider 生效于 `currentRoleHintV2` + `buildWakePromptV2Core`。
- 第一个插件：`soulkit-persona`。
- 控制台一页 + 两个接口。
- 单测：清单校验、配置默认值/越界、钩子隔离与超时、provider 回落、审计轮转。

**不做（P1 明确不做，避免半成品）**：

- 热重载/热更新（改 `plugins.json` 需重启）。
- 插件市场、下载、签名。
- 插件访问 MCP 工具或 DSH 内部对象。
- 多 provider 竞争（同一时刻只有一个 `persona:provide` 生效，后注册者覆盖并告警）。
- 事件总线式的任意钩子（只认 §6 四个名字）。

---

## 14. 验收

1. `plugins.json` 不存在 → 桥接正常启动，`/api/plugins` 返回空列表 + 默认配置。
2. 非法清单（坏 JSON / id 与目录不符 / 越界 `main`）→ 该插件 `invalid`，其它插件正常。
3. 钩子抛错或卡死 → 消息照常处理，审计有 `error`/`timeout` 记录。
4. 启用 `soulkit-persona` 且 soulkit 在线 → 唤醒 prompt 里的人格来自 soulkit，`【当前角色】` 名字一致；soulkit 离线 → 回落 `roles/*.md`，不报错。
5. 未申请 `send:qq` 的插件拿不到 `ctx.qq`。
6. `npm run test:audit` 通过；`test-plugin-kernel.mjs`（清单/配置/超时/关闭）与 `test-soulkit-persona.mjs`（拉卡/缓存/回落/TTL）全绿。
