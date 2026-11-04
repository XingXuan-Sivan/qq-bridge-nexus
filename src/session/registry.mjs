/**
 * 会话映射表的唯一入口（P7 第三步收尾）。
 *
 * 以前 `state.sessions[key]` 与 `state.sessionPolicies[key]` 被 bridge.js 直接读写 40 多次，
 * 「映射 + 策略指纹」必须**成对**维护这条规则只存在于人脑里：
 *   - 只写映射不写指纹 ⇒ `isCurrentSession()` 永远判旧，会话被无限重建；
 *   - 只删映射不删指纹 ⇒ 下次拿到同 id 时指纹恰好相同，旧会话被误当新会话。
 * 收进这里以后，「绑定 = 写两格」「解绑 = 删两格」变成默认操作，单点可测。
 *
 * 注册表本身不持久化：底层仍是 `state.sessions` / `state.sessionPolicies` 两个普通对象，
 * 由 `src/session/store.mjs` 统一落盘（`sessions.json`）。传入 `getState` 而不是 state 对象，
 * 是因为启动时 `loadState()` 会把 `state` 整体替换成新对象，闭包里的旧引用会立刻过期。
 */

export function createSessionRegistry(getState) {
  const maps = () => {
    const state = getState() ?? {};
    if (!state.sessions || typeof state.sessions !== 'object') state.sessions = {};
    if (!state.sessionPolicies || typeof state.sessionPolicies !== 'object' || Array.isArray(state.sessionPolicies)) state.sessionPolicies = {};
    return { sessions: state.sessions, policies: state.sessionPolicies };
  };

  return {
    /** 当前绑定：key → DSH 会话 id。 */
    get: (key) => maps().sessions[key] ?? null,
    /** 该会话建起时的策略指纹（可能比当前策略旧，正是「该重建」的信号）。 */
    policyOf: (key) => maps().policies[key] ?? null,
    has: (key) => Object.prototype.hasOwnProperty.call(maps().sessions, key),
    keys: () => Object.keys(maps().sessions),
    ids: () => Object.values(maps().sessions),
    entries: () => Object.entries(maps().sessions),
    /** 只读快照，给需要整体遍历/传参的地方用（不要拿它改）。 */
    raw: () => maps().sessions,

    /** 绑定映射与策略指纹（两格必须一起写）。 */
    bindSession(key, sessionId, policy) {
      const { sessions, policies } = maps();
      sessions[key] = sessionId;
      policies[key] = policy;
    },
    setPolicy(key, policy) {
      maps().policies[key] = policy;
    },
    /** 只解绑映射（保留指纹的场合：调用方紧接着自己重设）。 */
    drop(key) {
      delete maps().sessions[key];
    },
    dropPolicy(key) {
      delete maps().policies[key];
    },
    /** 解绑并清指纹 —— 绝大多数「撤销映射」应该用它。 */
    unbind(key) {
      const { sessions, policies } = maps();
      delete sessions[key];
      delete policies[key];
    },

    /**
     * 三条一起成立才算「当前会话」：仍被模式/白名单允许、映射没换、策略指纹没变。
     * 少了任何一条都会出现「桥接以为还活着、DSH 那边已经是另一个会话」。
     */
    isCurrent(key, sessionId, policy, { allowed = true } = {}) {
      const { sessions, policies } = maps();
      return allowed && sessions[key] === sessionId && policies[key] === policy;
    },

    clearAll() {
      const state = getState() ?? {};
      state.sessions = {};
      state.sessionPolicies = {};
    },
  };
}
