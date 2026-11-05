// 会话策略指纹：**什么变了，旧会话就必须退役**。
//
// 这段以前是 `bridge.js` 里的 `sessionPolicy()`，两个真实故障都跟它有关：
//
//   · 指纹只算模式不算**级别**：管理通道把 closed-agent 从 L1 提到 L2 之后，旧会话仍然
//     被判为「当前」，于是模型继续用低权限的预设跑 —— 提权看起来成功了，实际没生效；
//   · 反过来，指纹算了不该算的东西（比如每次调用都变的临时值）：每次检查都判定「过期」，
//     会话被无限重建，表现为「AI 一直在重新读卡、token 哗哗烧」。
//
// 所以这里把「指纹由哪些量组成」写成一处，并把 `isCurrentSession` 的三条件（准入、
// 映射一致、指纹一致）也放进来——三条件缺一个都会出上面那类问题。

/**
 * @param {object} deps
 * @param {() => string} deps.getMode                    当前模式
 * @param {(key: string, mode: string) => string|null|undefined} deps.modePreset  模式预设（chat/reserved 用）
 * @param {() => string|number|null} deps.getOwnerQQ      管理员 QQ（只有 closed-agent 进指纹）
 * @param {() => string} deps.getLevel                    当前权限级别（L0/L1/L2/L3）
 * @param {() => { ok: boolean, permissionPreset?: string, error?: string }|null} deps.getClosedAgentPlan
 */
export function createSessionPolicy({ getMode, modePreset, getOwnerQQ, getLevel, getClosedAgentPlan } = {}) {
  if (typeof getMode !== 'function') throw new TypeError('createSessionPolicy: getMode 必须是函数');
  if (typeof modePreset !== 'function') throw new TypeError('createSessionPolicy: modePreset 必须是函数');
  if (typeof getOwnerQQ !== 'function') throw new TypeError('createSessionPolicy: getOwnerQQ 必须是函数');
  if (typeof getLevel !== 'function') throw new TypeError('createSessionPolicy: getLevel 必须是函数');
  if (typeof getClosedAgentPlan !== 'function') throw new TypeError('createSessionPolicy: getClosedAgentPlan 必须是函数');

  /**
   * 会话策略指纹。级别与权限预设只在 closed-agent 下进指纹：
   * 其它模式里它们不影响 AI 能做什么，算进去只会造成无谓重建。
   */
  function policyOf(key) {
    const mode = getMode();
    const closed = mode === 'closed-agent';
    const plan = closed ? getClosedAgentPlan() : null;
    return JSON.stringify([
      mode,
      modePreset(key, mode) ?? '',
      closed ? (getOwnerQQ() ?? null) : null,
      ...(closed ? [getLevel(), plan?.ok ? plan.permissionPreset : ''] : []),
    ]);
  }

  /**
   * 这个 key 上的映射是不是「当前有效」的会话。
   * 三个条件缺一不可：准入（模式/白名单）、映射存在、指纹一致。
   */
  function isCurrent({ key, sessionId, registry, allowed } = {}) {
    if (!key || !sessionId || !registry) return false;
    if (typeof allowed === 'function' && !allowed(key)) return false;
    return registry.get(key) === sessionId && registry.policyOf(key) === policyOf(key);
  }

  return { policyOf, isCurrent };
}
