// DSH 运行期适配器的静态部分：能力声明 + 权限/agent preset 映射。
//
// 这里只放「平台差异」——内核的四级权限、三级管理通道、审批闸门语义都在 src/ 里，
// 不在这里。新增一个 Agent 平台时照本文件实现一份，并在 src/agent-side/builtin.mjs 注册。
//
// 为什么映射必须住在这里：`qq-full-ask` 是 DSH 0.2.0-rc.2 的预设名，`danger-full-access`
// 是它的沙箱名，`readonly/workspace/full` 是本仓库装进 DSH 的 agent preset 名。这些字符串
// 一旦出现在 src/ 里，内核就等于认识 DSH 了，B5 换平台时要再翻一遍。
//
// DSH 0.2.0-rc.2 的事实（已对照安装包源码核实，见 docs/guides/ADMIN_CHANNEL.md §DSH 事实）：
//   · 权限预设 = 沙箱模式（read-only / workspace-write / danger-full-access）+ 审批策略（ask / never）。
//     dsh-base 默认表：read-only(ask)、workspace-write(ask)、danger-full-access(**never**)。
//   · 预设表只能通过 profile 的 cordis.patch.yml 覆盖 `id: permission` 行的 config 来扩展
//     （settings 只能改 volatile 的 defaultPreset）。adapters/install.mjs 负责加入 qq-full-ask。
//   · 单个会话的预设只能通过 `commands/execute(sessionId, "/permission <名字>")` 设置
//     （与 DSH 官方 Web UI 的做法相同）；session.create 没有权限参数。
//   · `sessions.prompt` 不解析斜杠命令：用户发来的 "/permission ..." 文字只会作为普通文本进模型。
//   · Windows 上 read-only 沙箱只限制写、且是 partial（硬链接/NUL 等缝隙），读不受限。
//     因此 L1 额外用 readonly agent preset 的**工具白名单守卫**挡掉写/执行类工具 ——
//     这道边界与操作系统无关。
//
// 绝不把管理通道映射到内置 danger-full-access（审批策略 never = 不弹审批直接执行）。

export const agentPlatform = 'dsh';
export const id = 'dsh';
export const label = 'DeepSeek Harness';

/**
 * 实现的能力面（声明顺序即控制台展示顺序）。
 *
 * C5 起前七项与 `AgentPort` 的能力位**同名**（`src/agent-side/port.mjs`）；
 * 多出来的 `events` 不是调用面（会话事件流走客户端的 `events.follow`），但控制台要展示；
 * 少的 `maintenance` 是 DSH 实现不了的自愈动作（0.2.0 的 API 里没有对应 RPC）。
 * `prompt` 不在榜上：它是任何平台都必须实现的核心方法，不是可以关掉的能力位。
 */
export const capabilities = Object.freeze([
  'session', 'rename', 'permission', 'models', 'settings', 'workspace', 'events', 'compact',
]);

// ── 权限预设 ────────────────────────────────────────────────────────────────

/** 内核四级（会话权限）→ DSH 权限预设。danger-full-access 只在这里出现。 */
export const PERMISSION_PRESET_FOR_LEVEL = Object.freeze({
  'read-only': 'read-only',
  'workspace-write': 'workspace-write',
  'full-ask': 'qq-full-ask',
  full: 'danger-full-access',
});

/** 管理通道三级 → DSH 权限预设。 */
export const LEVEL_PERMISSION_PRESET = Object.freeze({
  L1: 'read-only',
  L2: 'workspace-write',
  L3: 'qq-full-ask',
});

/** 禁止使用的权限预设：审批策略为 never 的一律不允许由桥接设置。 */
export const FORBIDDEN_PERMISSION_PRESETS = Object.freeze(['danger-full-access']);

/** L3 自定义预设的定义（install.mjs 写入 profile；这里是唯一权威）。 */
export const FULL_ASK_PRESET = Object.freeze({
  sandbox: 'danger-full-access',
  approval: 'ask',
  name: 'QQ 桥接 L3（完全访问 + 每次审批）',
  description: '由管理通道在 owner 确认 + TOTP 后启用；所有越权操作仍需 owner 审批',
});

/**
 * 装进 profile 的权限预设表。保留 DSH 内置三项只是为了不改变 Web UI 里用户原有的选择；
 * 桥接只「拥有」read-only / workspace-write / qq-full-ask 三项（见 BRIDGE_OWNED_PRESETS）。
 */
export const PERMISSION_PRESETS = Object.freeze({
  'read-only': { sandbox: 'read-only', approval: 'ask' },
  'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
  'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
  'qq-full-ask': FULL_ASK_PRESET,
});

/** 桥接拥有的预设：用户把它们改宽（例如 approval: never）会让 L1/L2/L3 的承诺失效，安装时强制改回。 */
export const BRIDGE_OWNED_PRESETS = Object.freeze(['read-only', 'workspace-write', 'qq-full-ask']);

// ── agent preset（装进 DSH 的 agent 行）───────────────────────────────────────

/**
 * 由桥接托管的 agent preset id。顺序即 bundle patch 层顺序。
 * 取值是**能力档名**，不带用户平台前缀：同一个 `readonly` preset 对任何用户侧平台都成立，
 * 平台相关的差异（分条、@、媒体能力）走 prompt 层，不进 preset 名。
 */
export const AGENT_PRESET_IDS = Object.freeze(['chat', 'chat-v2', 'readonly', 'workspace', 'full']);

/** 群友（非管理通道）会话用的 preset：不能拿来当 closed-agent 的自选建议。 */
export const CHAT_AGENT_PRESETS = Object.freeze(['chat', 'chat-v2']);

/** 管理通道三级 → agent preset（都由本平台的 bundle 提供；缺失时 fail-closed）。 */
export const AGENT_PRESET_FOR_LEVEL = Object.freeze({
  // L2/L3 带桥接自己的审批闸门（qq-approval-gate）：rc.2 的审批只在「越过沙箱」时触发，
  // 不加闸门的话 L2 工作区内的命令、L3 的一切操作都不会弹审批。
  L1: 'readonly',
  L2: 'workspace',
  L3: 'full',
});

/**
 * 0.1.x 装出去的旧 preset 名 → 新名。
 *
 * 旧 profile 里可能还挂着 `qq-agent-readonly` 行，会话状态里也可能存着旧名；
 * 读到时归一即可，不必等用户重装。
 */
export const AGENT_PRESET_ALIASES = Object.freeze({
  'qq-chat': 'chat',
  'qq-chat-v2': 'chat-v2',
  'qq-agent-readonly': 'readonly',
  'qq-agent-workspace': 'workspace',
  'qq-agent-full': 'full',
});

/** 旧名归一为新名；不认识的名字原样返回（自建 preset 不能被改名）。 */
export function normalizeAgentPreset(name) {
  const value = String(name ?? '').trim();
  return AGENT_PRESET_ALIASES[value] ?? value;
}

/** 内核四级 → 本平台的权限预设名（`presetForLevel` 用）。 */
export function permissionPresetFor(level) {
  return PERMISSION_PRESET_FOR_LEVEL[level] ?? null;
}

// ── 管理通道计划 ─────────────────────────────────────────────────────────────

/**
 * 计算某个级别应使用的 agent preset 与权限预设。
 * @param {'L1'|'L2'|'L3'} level
 * @param {object} ctx
 * @param {string[]} ctx.presetIds           agentPresets/list 返回的 id
 * @param {string} ctx.closedAgentPreset     控制台配置的 closed-agent preset（仅 allowCustomAgentPreset=true 时对 L2/L3 生效）
 * @param {boolean} ctx.allowCustomAgentPreset  允许 L2/L3 改用自选 preset（**没有审批闸门**）
 * @param {string[]|null} ctx.permissionCatalog  permissionPresets/catalog 的 value 列表；null = 未知
 * @returns {{ok:true, agentPreset:string, permissionPreset:string, custom?:boolean}|{ok:false, error:string}}
 */
export function resolveLevelPlan(level, { presetIds = [], closedAgentPreset = '', allowCustomAgentPreset = false, permissionCatalog = null } = {}) {
  const permissionPreset = LEVEL_PERMISSION_PRESET[level];
  if (!permissionPreset) return { ok: false, error: `未知权限级别 ${level}` };
  if (FORBIDDEN_PERMISSION_PRESETS.includes(permissionPreset)) return { ok: false, error: '禁止映射到免审批的完全访问预设' };
  if (Array.isArray(permissionCatalog) && !permissionCatalog.includes(permissionPreset)) {
    return {
      ok: false,
      error: level === 'L3'
        ? `DSH 中没有权限预设 ${permissionPreset}（完全访问 + 审批）。请运行 node scripts/setup-dsh.mjs 并重启 DSH；桥接不会退回到免审批的 danger-full-access`
        : `DSH 中没有权限预设 ${permissionPreset}`,
    };
  }
  const available = new Set((presetIds ?? []).map((x) => normalizeAgentPreset(x)));
  const custom = normalizeAgentPreset(closedAgentPreset);
  if (level !== 'L1' && allowCustomAgentPreset && custom && available.has(custom) && !CHAT_AGENT_PRESETS.includes(custom)) {
    return { ok: true, agentPreset: custom, permissionPreset, custom: true };
  }
  const agentPreset = AGENT_PRESET_FOR_LEVEL[level];
  if (!available.has(agentPreset)) {
    return { ok: false, error: `${level} 需要 agent preset ${agentPreset}${level === 'L1' ? '（只读工具白名单）' : '（带桥接审批闸门）'}，但它不在 DSH 可用清单中；请运行 node scripts/setup-dsh.mjs 并重启 DSH` };
  }
  return { ok: true, agentPreset, permissionPreset };
}

/** 从 `/permission` 命令结果文本判断是否生效（rc.2 成功时返回 "preset <name>"）。 */
export function permissionCommandSucceeded(result, wanted) {
  const r = result?.result ?? result;
  if (!r || r.kind !== 'success') return false;
  const text = String(r.text ?? '');
  return text.includes(wanted);
}

/** 控制台与静态校验用的描述（B7 会把它变成 /api/agent-platforms 的响应）。 */
export function describe() {
  return {
    id,
    label,
    capabilities: [...capabilities],
    agentPresets: [...AGENT_PRESET_IDS],
    chatPresets: [...CHAT_AGENT_PRESETS],
    permissionLevels: Object.keys(LEVEL_PERMISSION_PRESET),
    permissionPresets: Object.keys(PERMISSION_PRESETS),
  };
}
