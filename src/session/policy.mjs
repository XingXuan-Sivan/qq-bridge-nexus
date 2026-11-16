// 会话策略指纹：**什么变了，旧会话就必须退役**。
//
// 这段以前是 `bridge.js` 里的 `sessionPolicy()`，两个真实故障都跟它有关：
//
//   · 指纹漏算了一个决定工具面的量：换了 preset / 行为档案之后，旧会话仍然被判为
//     「当前」，于是模型继续用旧的预设跑 —— 看起来换成功了，实际没生效；
//   · 反过来，指纹算了不该算的东西（比如每次调用都变的临时值）：每次检查都判定「过期」，
//     会话被无限重建，表现为「AI 一直在重新读卡、token 哗哗烧」。
//
// 所以这里把「指纹由哪些量组成」写成一处，并把 `isCurrentSession` 的三条件（准入、
// 映射一致、指纹一致）也放进来——三条件缺一个都会出上面那类问题。
//
// 权限级别**不进指纹**：它是桥接侧的过滤器（见 src/session/permission.mjs），
// 每个工具调用现取，改级别不需要重建执行体会话。

/**
 * @param {object} deps
 * @param {() => string} deps.getMode                    会话的引擎（由行为档案决定：chat / reserved / reserved2）
 * @param {(key: string, mode: string) => string|null|undefined} deps.modePreset  该模式下要挂的执行体 preset
 * @param {(key: string) => string|null|undefined} [deps.getModel] 会话级模型签名（未指定返回空）
 */
export function createSessionPolicy({ getMode, modePreset, getModel } = {}) {
  if (typeof getMode !== 'function') throw new TypeError('createSessionPolicy: getMode 必须是函数');
  if (typeof modePreset !== 'function') throw new TypeError('createSessionPolicy: modePreset 必须是函数');

  /** 会话策略指纹。 */
  function policyOf(key) {
    const mode = getMode(key);
    const model = typeof getModel === 'function' ? (getModel(key) || '') : '';
    // 未指定会话级模型时不把空值写进指纹，避免升级后所有旧绑定因数组长度变化被重建一次。
    return JSON.stringify([
      mode,
      modePreset(key, mode) ?? '',
      ...(model ? [model] : []),
    ]);
  }

  /**
   * 这个 key 上的映射是不是「当前有效」的会话。
   * 三个条件缺一不可：准入、映射存在、指纹一致。
   */
  function isCurrent({ key, sessionId, registry, allowed } = {}) {
    if (!key || !sessionId || !registry) return false;
    if (typeof allowed === 'function' && !allowed(key)) return false;
    return registry.get(key) === sessionId && registry.policyOf(key) === policyOf(key);
  }

  return { policyOf, isCurrent };
}
