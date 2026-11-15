// ACP 运行期适配器的静态部分：能力声明 + 权限档映射 + 管理通道计划。
//
// 与 dsh 那份（profiles/agent-platforms/dsh/adapters/runtime.mjs）同一个分工：这里只放
// 「平台差异」，内核的四级权限、三级管理通道、审批闸门语义都在 src/ 里。
//
// ACP 为什么比 DSH 短很多，三条都是协议决定的，不是没写完：
//
//   1. **没有可安装的东西**：对端是任意实现了 ACP v1 的 Agent 进程，由适配器 spawn 并
//      托管（PLATFORM_UNIFICATION §十一 Q5）。没有 profile 要打补丁，因此没有
//      PERMISSION_PRESETS / BRIDGE_OWNED_PRESETS（那两个常量的用途是「安装时把被改宽的
//      预设收紧回去」，这里没有可收紧的对象）。
//   2. **模式名由对端定**：ACP 不规定 `availableModes` 里叫什么（`read-only` 与
//      `readOnly` 都合法）。桥接**不猜**：下面用与内核四级同名的规范名，对端没有这个名字
//      就 fail-closed —— 猜错的代价是「L1 被设成一个完全放开的模式」，比拒绝更贵。
//   3. **没有 agent preset 概念**：部分实现用无分类的 `agent` config option 暴露名单
//      （§9.1），那由 port 的 `listPresets` 动态读。这里不声明静态清单，
//      `resolveLevelPlan` 的 `agentPreset` 因此恒为空串（= 用对端默认 agent）。
//
// 只导出内核确实会读的成员（经 src/agent-side/runtime-registry.mjs 与
// src/admin/agent-permission.js）：多导一份没人读的表，下次换平台时就是第二个真源。

export const agentPlatform = 'acp';
export const id = 'acp';
export const label = 'ACP（Agent Client Protocol）';

/**
 * 实现的能力面（声明顺序即控制台展示顺序）。
 *
 * 前三个与 `AgentPort` 的能力位同名（`src/agent-side/port.mjs`），并且是**上限**：
 * port 会在 `initialize` 之后按对端回执收缩 `session` 组（对端没声明 `session/close`
 * 就没有 archiveSession）。没有 rename / settings / workspace / compact / maintenance ——
 * ACP v1 里没有对应方法，不为缺口造伪能力（§十 第 3 条）。
 *
 * `events` 不是调用面：会话事件流经 `onEvent` 出口交给桥接（见 adapters/acp/port.mjs）。
 */
export const capabilities = Object.freeze(['session', 'permission', 'models', 'events']);

/**
 * 认领的能力档生效方式。
 *
 * `preset` 对 ACP 的含义是「用 `session/set_config_option` 选对端的 agent 档」——
 * 没有可安装的 profile，但对端声明了 `agent` 选项时这套选择确实成立；
 * `passthrough` 则不指定 agent，会话直接跑在对端默认环境里。
 */
export const RUNTIME_APPLY = Object.freeze(['preset', 'passthrough']);

/**
 * 认领的提示注入通道。
 *
 * ACP 的 `session/new` 带 `systemPrompt`（`append` 语义，2026-11-06 起稳定）：这是唯一
 * 能在**会话创建时**把话术交给对端的通道。`prefix` 不声明——ACP 没有「首轮前缀」这种
 * 概念，硬拼进第一条 prompt 会把平台规则混进用户消息。`tool` 仍是兜底。
 */
export const RUNTIME_PROMPT = Object.freeze(['system', 'tool']);

// ── 权限档 ──────────────────────────────────────────────────────────────────

/**
 * 内核四级（会话权限）→ ACP 的模式名。
 *
 * 规范名与内核四级同名：ACP 没有标准模式表，桥接唯一能保证的是「名字对得上就用，
 * 对不上就报错」。`full` 只在 owner 短时授权期间出现，因此对端必须真的提供一个叫
 * `full` 的模式才会成功 —— 这条路径不接受模糊匹配。
 */
export const PERMISSION_PRESET_FOR_LEVEL = Object.freeze({
  'read-only': 'read-only',
  'workspace-write': 'workspace-write',
  'full-ask': 'full-ask',
  full: 'full',
});

/** 管理通道三级 → ACP 的模式名。L3 = 完全访问，审批由 `session/request_permission` 兜。 */
export const LEVEL_PERMISSION_PRESET = Object.freeze({
  L1: 'read-only',
  L2: 'workspace-write',
  L3: 'full-ask',
});

// ── 管理通道计划 ─────────────────────────────────────────────────────────────

/**
 * 计算某个级别应使用的 agent preset 与模式。
 *
 * @param {'L1'|'L2'|'L3'} level
 * @param {object} ctx
 * @param {string[]} ctx.presetIds           `agentPort.listPresets()` 返回的 id（对端给的 agent 名单）
 * @param {string} ctx.closedAgentPreset     控制台配置的 closed-agent preset（仅 allowCustomAgentPreset=true 时对 L2/L3 生效）
 * @param {boolean} ctx.allowCustomAgentPreset
 * @param {string[]|null} ctx.permissionCatalog  `listPermissionPresets()` 的 value 列表；null = 读不到
 * @returns {{ok:true, agentPreset:string, permissionPreset:string, custom?:boolean}|{ok:false, error:string}}
 */
export function resolveLevelPlan(level, {
  presetIds = [],
  closedAgentPreset = '',
  allowCustomAgentPreset = false,
  permissionCatalog = null,
} = {}) {
  const permissionPreset = LEVEL_PERMISSION_PRESET[level];
  if (!permissionPreset) return { ok: false, error: `未知权限级别 ${level}` };

  // 名单为空数组也照样拦：那意味着对端确实没提供任何模式，此时「设置成功」不可能成立。
  // 只有 null（读不到：探测会话没建起来）才继续往下走 —— 真正写模式的是
  // port.applyPermission，它会拿实时 modes 再校一次，报错会说清是「没有这个名字」。
  if (Array.isArray(permissionCatalog) && !permissionCatalog.includes(permissionPreset)) {
    return {
      ok: false,
      error: `${level} 需要模式 ${permissionPreset}，但 ACP 对端没有提供（它提供：${permissionCatalog.join(' / ') || '无'}）。`
        + '桥接不会退回到对端存在的更宽模式 —— 那会让「只读」变成一句假话',
    };
  }

  // agent 名单是动态的：只有确实出现在对端清单里才采用自选档，否则留空（用对端默认）。
  const custom = String(closedAgentPreset ?? '').trim();
  const available = Array.isArray(presetIds) ? presetIds : [];
  if (level !== 'L1' && allowCustomAgentPreset && custom && available.includes(custom)) {
    return {
      ok: true, agentPreset: custom, permissionPreset, custom: true,
    };
  }
  return { ok: true, agentPreset: '', permissionPreset };
}

/**
 * `applyPermission` 的回执算不算成功。
 *
 * 与 DSH 的差别：ACP 的 `session/set_mode` **没有回执值**，`session/set_config_option`
 * 回的是新的 option。能确认的只有「RPC 成功 + 我们请求的就是这个名字」，
 * `current_mode_update` 是事件，不保证先于响应到达。所以判据是「回执说 ok 且名字一致」，
 * 不假装能读到对端的最终状态（要读就再调 `readPermission`）。
 */
export function permissionCommandSucceeded(result, wanted) {
  const r = result && typeof result === 'object' ? result : {};
  if (r.ok !== true) return false;
  return String(r.modeId ?? '') === String(wanted ?? '');
}

/** 控制台与静态校验用的描述。模式清单是运行期数据，故不在静态描述里编一份。 */
export function describe() {
  return {
    id,
    label,
    capabilities: [...capabilities],
    applies: [...RUNTIME_APPLY],
    promptChannels: [...RUNTIME_PROMPT],
    // 两者都由对端在 session/new 的回执里给（configOptions），桥接没有静态清单。
    agentPresets: [],
    chatPresets: [],
    permissionLevels: Object.keys(LEVEL_PERMISSION_PRESET),
    permissionPresets: [],
  };
}
