# 本目录有意为空

`capabilities/<id>.yml` 在 DSH 那侧的含义是「一份要渲染成 `cordis.patch.yml` 的预设正文
（`rows`）+ 工具面（`tools`）+ 预设元信息（`preset`）」。ACP 没有对应的落点：

- **工具面在对端**：ACP 的 Agent 自己决定有哪些工具，桥接不往里装东西；
- **agent / 模型名单在 `session/new` 的回执里**：`configOptions` 的 `agent` / `model` 项
  （见 `src/agent-side/adapters/acp/port.mjs` 的 `listPresets` / `listModels`），是会话级的
  运行期数据，不是可以提前写进仓库的静态表。

因此这里不放任何 `*.yml`。放一个空壳能力档会让 `scripts/check-profiles.mjs` 与产物链
以为「存在一个可安装的预设」，那是假数据。

能力位（会话 / 权限 / 模型）与权限档映射见 `../adapters/runtime.mjs`。

本文件必须有：`check-profiles` 要求每个 Agent 平台目录存在 `capabilities/`，而 Git 不跟踪
空目录。
