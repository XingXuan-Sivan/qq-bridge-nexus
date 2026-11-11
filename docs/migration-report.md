# 能力归一迁移报告（P10.3）

日期：2026-11-11
范围：`dsh/agent-presets/` 新增 4 个平台无关能力；旧预设未动，运行方案仍指向旧 id。

## 1. 新增了什么

| 新能力 | 来源 | 工具面 | 守卫 |
|---|---|---|---|
| `agent-chat` | `qq-chat` + `qq-chat-v2` 合并 | 平台工具全开；Agent 仅 `tool-web/tool-ask-user/tool-todo` | `qq-tool-restrict`（`profile: simulation` + 生成的 `allow`） |
| `agent-readonly` | `qq-agent-readonly` | + `tool-fs`、`tool-fs-search` | 无 |
| `agent-workspace` | `qq-agent-workspace` | + `tool-pwsh`、`tool-jobs` | 无 |
| `agent-full` | `qq-agent-full` | 同 workspace（完全访问由权限档 `danger-full-access` 决定，见 SPEC §12） | 无 |

每目录三份产物（`preset.yml` / `agent.cordis.yml` / `extensions.yml`）全部由
`scripts/build-capability-artifacts.mjs` 从 `capability.yml` 生成，带「勿手改」头。

## 2. 与旧预设的差异

1. **`qq-chat` 与 `qq-chat-v2` 合并为 `agent-chat`**
   - 插件行两者本来就完全相同；
   - extensions：`qq-chat` 没有 `extensions.yml`（Hub 语义＝全部拒绝），`qq-chat-v2` 是 `mcp/skills = '*'`。
     合并后采用 `'*'`（超集），避免聊天能力被 MCP 策略卡死；如果日后要收紧，改
     `capability.yml` 的 `tools.mcp` / `tools.skills` 再重新生成。
2. **`preset.yml` 不再有 `behavior:`**：行为由方案持有（SPEC §2.3），预设不再反向绑定。
3. **人格文本暂时变短**：旧 `agent.cordis.yml` 的 `persona.prefix` 里混着 QQ 群聊协议与
   QQ 运维话术。能力只保留平台无关的身份与安全边界；平台文本按 SPEC §3.2 在 **P10.4**
   搬进行为档案的 `prompt` 段（群聊走 `qq-social-v1/v2`，运维走新增的 `qq-ops`）。
   在 P10.4 完成前，旧预设仍是运行方案的实际目标，所以线上行为不变。
4. **安全段顺序**：生成物把「安全边界」放在 `persona.prefix` 最前，随后才是能力的 base
   提示；这是为了满足「能力自己兜底、不依赖平台注入」（SPEC §3.2）。

## 3. 校验

- `node scripts/migrate-capability-unify.mjs --check`：4 个能力与产物一致（exit 0）。
- `node scripts/build-capability-artifacts.mjs --check`：同上（exit 0）。
- `node scripts/build-agent-preset-patches.mjs --check`：5 个旧预设的 bundle patch 未受影响（exit 0）。
- `node scripts/test-capability-artifacts.mjs`：4/4（目录齐全、无 `behavior:`、扩展显式 allow、
  守卫只在聊天能力、persona 顺序）。

## 4. 回滚

删除 `dsh/agent-presets/agent-chat|agent-readonly|agent-workspace|agent-full/` 四个目录即可；
旧预设与方案引用未改动，桥接与 DSH 均不受影响（这 4 个目录在 P10.5 前不会被安装）。
