# 人格 provider：三层解析、缓存与降级

> 状态：v1.2.0 已实现。入口在 `src/persona-resolve.mjs`（优先级）、`src/plugins/persona.mjs`（缓存与降级）、`plugins/soulkit-persona/`（第一个实现）。

## 0. 一句话

桥接不再从唯一的 `roles/` 目录里取人格，而是按 **会话覆盖 → 外部 provider → 全局本地卡** 三层解析；provider 只负责「怎么拿到一张卡」，缓存、降级、持久化由内核统一负责。

## 1. 为什么需要

`soulkit` 的记忆与人格按会话绑定（`group:…` / `private:…`），而桥接的人格原来是「一个全局默认 + 按会话指定的本地卡文件」。两边都能决定「这个会话是谁」，如果各写一套，就会出现：

- 两边都能改、都不是最终状态，用户不知道以谁为准；
- 一边换了卡，另一边的注入还在用旧的；
- 桥接的 `roleRefreshBlockV2`、`qq_get_prompt`、唤醒提示词各自读一次 `roles/`，接上外部来源后必然出现「注入 A、刷新块写 B」。

所以这里定的是**权威归属**，不是「再加一个来源」。

## 2. 三层优先级

| 层 | 来源 | 谁写 | 说明 |
| --- | --- | --- | --- |
| L1 会话覆盖 | `state/current-role.json` 的 `byKey[key]` | `/role 名字`、`/role off`、控制台「按会话设置人格」 | `off` = 本会话不挂卡，**硬覆盖** provider；名字指向本地 `roles/<名字>.md` |
| L2 provider | 插件注册的人格卡（按 key 取） | 外部服务（soulkit 等） | 按会话取卡；缓存与降级由内核负责 |
| L3 全局本地卡 | `state/current-role.json` 的 `role` → `roles/<名字>.md` | 控制台「当前启用的人格」 | 没有 L1、provider 也没有卡时的兜底 |

解析规则（`src/persona-resolve.mjs`）：

1. `byKey[key] === null` → `off`，到此为止（provider 不参与）。
2. `byKey[key]` 是名字且本地卡存在 → 用它。
3. 名字存在但本地卡不存在 → 记一行告警，继续往下（不因为一张删掉的卡让会话失去人格）。
4. provider 有缓存卡 → 用它（带 `stale` 标记）。
5. 全局 `role` 且本地卡存在 → 用它。
6. 都没有 → `none`（桥接按「没有角色卡」处理）。

每条解析结果都带 `source`（`session` / `provider` / `global` / `off` / `none`），控制台「人格来源」页展示的就是这个字段。

## 3. provider 契约（`persona-provider/1`）

```js
ctx.persona.register({
  id: 'soulkit',
  contract: 'persona-provider/1',
  capabilities: { perSession: true, conditional: true, listable: false },
  async get(key, { etag } = {}) {
    // 三选一
    return { status: 'card', card: { name: '星苒', text: '……' }, etag: 'W/"1"' };
    // return { status: 'none', reason: 'unbound' };
    // return { status: 'not-modified', etag: 'W/"1"' };
  },
});
```

- **`get` 可以异步**：注入链路是同步的，内核在唤醒时 `warm()` 一次，注入时只读内存缓存。
- **指纹不用给**：内核按 `name + text` 算 16 位十六进制，用于「角色卡是否变了」去重（与 `role-refresh` 的指纹格式一致）。
- **`not-modified`**：provider 带 `etag` 做条件请求、拿到 304 时返回它，内核只刷新时间戳，不动正文。
- **抛错 = 本次不可用**：注册表保留旧卡（`staleMaxMs` 内继续用），超过就回落 L3；失败日志每个会话只告警一次，成功即重置。
- **provider 不写缓存**：TTL、单飞、最小刷新间隔、旧卡降级、持久化都在注册表里。否则会出现两份 TTL、两套行为。

## 4. 缓存与降级（注册表）

配置文件 `plugins.json`：

```json
{
  "persona": {
    "provider": "soulkit",
    "cache": { "ttlMs": 300000, "minRefreshGapMs": 30000, "staleMaxMs": 86400000 }
  }
}
```

| 参数 | 默认 | 含义 |
| --- | --- | --- |
| `ttlMs` | 5 分钟 | 多久算新鲜；过期后唤醒时会尝试刷新 |
| `minRefreshGapMs` | 30 秒 | 两次尝试的最小间隔（负结果也复用这个间隔，不单独做负缓存） |
| `staleMaxMs` | 24 小时 | 旧卡最多还能用多久；超过就回落 L3 |

行为：

- **单飞**：同一个 key 同时只有一个刷新请求，其余唤醒复用同一个 Promise。
- **降级**：`ttlMs` 过后进入 degraded（页面可见），仍用旧卡；`staleMaxMs` 后不再用。
- **持久化**：`state/persona-cache.json`（`version: 1`，最多 200 条，按 `fetchedAt` LRU 裁剪，原子写）。重启后第一句话就能用上旧卡，不需要等第一次网络请求。
- **超时**：注册表给 provider 的 `get` 一个预算（默认 1200ms），超时按失败处理，不阻塞唤醒。

## 5. 与桥接的接线

| 位置 | 行为 |
| --- | --- |
| `currentRoleHintV2(key)` | 解析结果的正文；provider 卡原样 trim，本地卡过 `sanitizeRoleTextV2`（一代指令行过滤、示例空格改写），再按 `role.maxInjectChars`（默认 8000）截断 |
| `currentRoleName(key)` | 解析结果的 `name`；`buildWakePromptV2Core`、`buildWakeReminderPromptV2`、`qq_get_prompt` 都用它 |
| `currentRoleFingerprintV2(key)` | 同一张卡的指纹；没卡时也返回稳定值，避免每次唤醒重复注入「角色卡已更新」 |
| `roleRefreshBlockV2(key)` | 名字改用 `currentRoleName`，不再读 `roleNameForKey` |
| `deliverPromptNow(key)` | 唤醒时先 `personaWarm(key)`：异步、有超时、失败只记日志，不挡消息 |
| `/role` 与「按会话设置人格」 | 仍写 `state/current-role.json`（L1/L3）；`off` 对 provider 生效 |
| 控制台「人格来源」 | `GET /api/persona/sources`，只读，返回 `source/name/stale`，不含正文 |

## 6. 控制台

- 「人格与角色 → 人格来源（只读）」：每个会话一行，显示来源层、人格名、是否在用过期卡。
- 15 秒随人格页一起刷新；改动入口仍然只有「当前启用的人格」和「按会话设置人格」两处。
- 「桥接插件」页显示 provider 的 id/契约/能力与缓存状态（`/api/plugins` 的 `persona` 字段）。

## 7. 明确不做（P1）

- **不写穿**：桥接改人格不回调 soulkit。`/role` 与按会话设置只写本地 `current-role.json`；要让外部服务知道，得在它那边改绑定。
- **不做多 provider 竞争**：`persona.provider` 指定一个；没指定时第一个注册成功的生效，其余记日志忽略。
- **不做 provider 热切换**：改 `plugins.json` 后重启桥接。
- **不内置 HTTP provider**：契约足够简单，需要的人照 §3 写十行；先让 soulkit 这个真实实现把接口磨稳。
- **不接管 `/role` 的命令语义**：外部服务的人格切换命令归外部服务，桥接不镜像。

## 8. 验收

- `scripts/test-persona-resolve.mjs`：L1 优先、`off` 硬覆盖、缺卡回落、L3 回落、`none`、`stale` 透传、`warm` 委托。
- `scripts/test-soulkit-persona.mjs`：注册形态、URL 参数、标题行剥离、ETag/304、未绑定与空 key、坏响应抛错、`baseUrl`/`timeoutMs` 边界。
- `scripts/test-plugin-kernel.mjs`：注册表的 `warm` 前后行为、指纹格式、`status().persona`。
- 手测：`GET /api/persona/sources` 与控制台只读页；把 soulkit 停掉后旧卡继续用、超过 24h 回落本地卡（`state/persona-cache.json` 可手工改 `fetchedAt` 验证）。
