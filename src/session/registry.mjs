/**
 * 会话映射表的唯一入口（P7 第三步收尾 / C5 第三批）。
 *
 * 以前 `state.sessions[key]` 与 `state.sessionPolicies[key]` 被 bridge.js 直接读写 40 多次，
 * 「映射 + 策略指纹」必须**成对**维护这条规则只存在于人脑里：
 *   - 只写映射不写指纹 ⇒ `isCurrentSession()` 永远判旧，会话被无限重建；
 *   - 只删映射不删指纹 ⇒ 下次拿到同 id 时指纹恰好相同，旧会话被误当新会话。
 * 收进这里以后，「绑定 = 写两格」「解绑 = 删两格」变成默认操作，单点可测。
 *
 * 落盘形状（C5 第三批）：`state.sessions[key]` 是 `{ instance, sessionId }` 而不是裸 id。
 * `instance` 记的是**产生这个 id 的平台**，换平台后旧引用必须判废而不是被误用（原因见
 * `src/session/ref.mjs` 文件头）。为了不把「形状」泄漏给四十多个调用点：
 *   - `get` / `ids` / `entries` / `raw` 仍然产出**裸 sessionId**（读侧零改动）；
 *   - 需要知道「是谁家的」时用 `ref(key)` / `instanceOf(key)`；
 *   - 写入统一走 `bindSession`，`instance` 由构造时传入的 getter 决定。
 *
 * 注册表本身不持久化：底层仍是 `state.sessions` / `state.sessionPolicies` 两个普通对象，
 * 由 `src/session/directory.mjs` 写进每个会话的档案（`binding.agentRef`）。传入 `getState`
 * 而不是 state 对象，是因为启动时 `loadState()` 会把 `state` 整体替换成新对象，闭包里的
 * 旧引用会立刻过期。`instance` 同理传 getter：平台在 `loadState()` 之后才装好。
 */
import { readSessionRef } from './ref.mjs';

/**
 * @param {() => object} getState
 * @param {{instance?: () => string}} [options]
 *   `instance`：当前 Agent 平台 id 的 getter。只在**写入**与**认领空 instance** 时使用，
 *   读一个已有明确 instance 的引用时它不参与判断。
 */
export function createSessionRegistry(getState, { instance = () => '' } = {}) {
  const instanceId = () => String(instance() ?? '').trim();

  const maps = () => {
    const state = getState() ?? {};
    if (!state.sessions || typeof state.sessions !== 'object') state.sessions = {};
    if (!state.sessionPolicies || typeof state.sessionPolicies !== 'object' || Array.isArray(state.sessionPolicies)) state.sessionPolicies = {};
    return { sessions: state.sessions, policies: state.sessionPolicies };
  };

  /** 落盘值 → 归一引用；`instance` 为空的老数据按当前平台认领（迁移口径）。 */
  const refOf = (value) => readSessionRef(value, instanceId());

  return {
    /** 当前绑定：key → sessionId（读侧不需要知道 instance，所以不返回对象）。 */
    get: (key) => refOf(maps().sessions[key])?.sessionId ?? null,
    /** 完整引用：`{ instance, sessionId }`，判断「这条映射还属不属于当前平台」时用。 */
    ref: (key) => refOf(maps().sessions[key]),
    /** 这条映射是哪个平台建的（老数据返回当前平台 id，与 `ref` 的认领口径一致）。 */
    instanceOf: (key) => refOf(maps().sessions[key])?.instance ?? null,
    /** 该会话建起时的策略指纹（可能比当前策略旧，正是「该重建」的信号）。 */
    policyOf: (key) => maps().policies[key] ?? null,
    has: (key) => Object.prototype.hasOwnProperty.call(maps().sessions, key),
    keys: () => Object.keys(maps().sessions),
    ids: () => Object.values(maps().sessions).map((value) => refOf(value)?.sessionId).filter(Boolean),
    entries: () => Object.entries(maps().sessions)
      .map(([key, value]) => [key, refOf(value)?.sessionId])
      .filter(([, sessionId]) => !!sessionId),
    /** 只读快照（`key → sessionId`），给需要整体遍历/传参的地方用（不要拿它改）。 */
    raw: () => Object.fromEntries(
      Object.entries(maps().sessions)
        .map(([key, value]) => [key, refOf(value)?.sessionId])
        .filter(([, sessionId]) => !!sessionId),
    ),

    /**
     * 绑定映射与策略指纹（两格必须一起写）。
     *
     * `policy` 传 `undefined` 表示「指纹由调用方紧接着自己写」（`setPolicy`）——
     * 老实现会把它写成 `undefined`，看起来等价，但落盘时字段消失，读回来是 `null`，
     * 于是「指纹恰好为空」的会话会被判成同一个。这里显式跳过，让缺省与空值不再是同一件事。
     */
    bindSession(key, target, policy) {
      const ref = readSessionRef(target, instanceId());
      if (!ref) throw new Error(`bindSession: 会话引用为空（${key}）`);
      const { sessions, policies } = maps();
      sessions[key] = ref;
      if (policy !== undefined) policies[key] = policy;
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
     *
     * 这里刻意**不看 instance**：「还是不是同一个会话」与「这个会话还归不归当前平台」
     * 是两个判断，后者由调用方用 `instanceOf` 显式处理 —— 混在一起会让「换平台重建」的
     * 日志与「策略变了重建」的日志长得一模一样，排查时分不清。
     */
    isCurrent(key, sessionId, policy, { allowed = true } = {}) {
      const { sessions, policies } = maps();
      return allowed && refOf(sessions[key])?.sessionId === sessionId && policies[key] === policy;
    },

    /**
     * 把「instance 为空」的老数据认领成当前平台，返回被补写的条数。
     *
     * 只写空值，不覆盖已经明确的 instance —— 那可能是**上一个平台**留下的映射，
     * 覆盖掉等于把它伪造成「当前平台的会话」，正是本批要消灭的那种误用。
     * 调用方在平台装好之后、任何 `saveState()` 之前调一次即可（幂等）。
     */
    normalizeAll() {
      const { sessions } = maps();
      const current = instanceId();
      if (!current) return 0;
      let changed = 0;
      for (const [key, value] of Object.entries(sessions)) {
        const ref = readSessionRef(value);
        if (ref && !ref.instance) {
          sessions[key] = { instance: current, sessionId: ref.sessionId };
          changed += 1;
        }
      }
      return changed;
    },

    clearAll() {
      const state = getState() ?? {};
      state.sessions = {};
      state.sessionPolicies = {};
    },
  };
}
