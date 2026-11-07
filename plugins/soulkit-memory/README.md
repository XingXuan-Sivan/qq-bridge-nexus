# soulkit 记忆适配器

把 soulkit 的 `POST /api/recall` 接成桥接的 `memory-provider/1`，作为唤醒时的记忆来源。

- 权限：`memory:provide`（注册 provider）、`net:http`（调 soulkit）。
- 形态：`capabilities { sync:false, write:false, listable:true }`——异步 provider，唤醒前由内核预热，注入时只读缓存；soulkit 慢或停机都不会拖住唤醒。
- 检索词：内核传入本轮最后一条真实用户消息（尾部 300 字），这里再截到 600 字发给 soulkit。
- 会话 key：桥接的 `qq:group:123` / `qq:private:123` 削成 soulkit 的 `group:123` / `private:123`；认不出的 key 原样透传。
- 返回：只取 `text`（兼容旧版 `block` / `block.text`）；`abstained` / 空块视为正常，返回空文本让记忆段整段消失。
- 配置（`config.json` 的 `memory.providers['soulkit']`）：`baseUrl`（默认 `http://127.0.0.1:3110`）、`timeoutMs`（默认 900）、`maxChars`（默认由 `memory.inject.maxChars` 兜底）。

缓存 TTL、超时、截断、失败记录都在内核的记忆注册表里（`src/memory/registry.mjs`），插件不再自己写一套。
