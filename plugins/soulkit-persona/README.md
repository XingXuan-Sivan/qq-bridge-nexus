# soulkit-persona

把 soulkit 的人格卡接成桥接的人格来源。启用后，唤醒 prompt 里的 `【当前角色】` 与角色卡正文
来自 soulkit；soulkit 不可用时自动回落 `roles/*.md`。

> 状态：适配器与接口契约已实现并有离线测试（`scripts/test-soulkit-persona.mjs`）。
> soulkit 侧目前还没有 `/api/persona/card` 这个端点，所以**现实运行时会一直回落 `roles/*.md`**；
> 等 soulkit 补上该端点即可生效。插件默认加载（未在 `plugins.json` 里配置时也加载），
> 不想让它尝试拉取时在 `plugins.json` 里设 `"enabled": false`。

## 配置

在仓库根目录的 `plugins.json` 里：

```json
{
  "plugins": {
    "soulkit-persona": {
      "enabled": true,
      "config": {
        "baseUrl": "http://127.0.0.1:3110",
        "holder": "",
        "timeoutMs": 1200
      }
    }
  }
}
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:3110` | soulkit 服务地址 |
| `holder` | 空 | soulkit 侧的人格持有者；空 = soulkit 默认 |
| `timeoutMs` | `1200` | 单次拉取超时（200–5000） |

## 行为

- 启动时拉一次；`onInbound` 时缓存超过 5 分钟则后台刷新，不阻塞消息。
- 刷新失败保留上一份缓存；没有缓存则回落到 `roles/*.md`。
- 缓存落在 `state/plugins/soulkit-persona/card.json`。
- 插件只读取卡片，不写 soulkit，也不影响 `/role` 命令与控制台「人格与角色」页（它们管理 `roles/*.md`）。

## 接口约定

`GET {baseUrl}/api/persona/card?holder=<holder>` →

```json
{ "name": "星苒", "text": "……角色卡全文……", "fingerprint": "可选" }
```
