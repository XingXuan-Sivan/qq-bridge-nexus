# soulkit-persona

把 soulkit 的人格卡接成桥接的人格 provider（`persona-provider/1`）。启用后，唤醒 prompt 里的人格正文与角色名来自 soulkit，按会话取卡；soulkit 不可用时内核保留旧卡，超过 24 小时回落 `roles/*.md`。

> 状态：v1.2.0 已实现，离线测试见 `scripts/test-soulkit-persona.mjs`。
> soulkit 侧 `/api/persona/card` 已实现（`soulkit/src/api/http.mjs`），按 `platform + key` 取卡。

## 配置

仓库根目录的 `plugins.json`：

```json
{
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

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `config.baseUrl` | `http://127.0.0.1:3110` | soulkit 服务地址（只接受 http/https） |
| `config.timeoutMs` | `1200` | 单次请求超时（200–5000 ms） |
| `persona.provider` | `null` | 指定哪个 provider 生效；同时装了多个 provider 插件时建议显式写 |
| `persona.cache.*` | 见上 | 内核级缓存策略，插件不感知 |

## 行为

- 插件没有钩子：唤醒时由内核调用 `personaWarm(key)` 触发刷新，5 分钟内复用缓存。
- 取卡：`GET {baseUrl}/api/persona/card?platform=qq&key=<group:…|private:…>`，带 `If-None-Match` 时 `304` 只刷新时间戳。
- `mode: "none"`（未绑定 / 没有 key）→ 本会话没有 provider 卡，解析继续落到全局本地卡；不会伪造一张卡。
- 卡片正文开头的 `【人格卡：名字｜sha】` 行由适配器剥掉（桥接自己会注入`【当前角色】`），其余原样。
- 失败保留旧卡、只告警一次；连续失败不会每次唤醒都打日志。
- 只读：不写 soulkit，也不影响 `/role` 命令与「按会话设置人格」——它们管理的是 L1/L3，`off` 对 provider 生效。

## 接口约定

```http
GET /api/persona/card?platform=qq&key=group:1047096216
If-None-Match: "257399a91c:..."   # 可选
```

命中：

```json
{
  "ok": true,
  "mode": "card",
  "key": "group:1047096216",
  "name": "星苒",
  "text": "【人格卡：星苒｜257399a91c】\n\n……",
  "sha": "257399a91c",
  "chars": 6563,
  "etag": "\"257399a91c:ce7f390a1c49b\""
}
```

未绑定 / 无 key：

```json
{ "ok": true, "mode": "none", "reason": "unbound" }
```

契约细节（三层优先级、缓存与降级、控制台）见 [`docs/PERSONA_PROVIDER.md`](../../docs/PERSONA_PROVIDER.md)。
