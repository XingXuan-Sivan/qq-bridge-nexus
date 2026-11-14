/**
 * 会话引用（`agentRef`）的形状归一 —— C5 第三批。
 *
 * 以前会话绑定只存一个裸 sessionId（`state/sessions.json` 的
 * `{ "group:1": "sid-xxx" }`，会话档案里的 `binding.sessionId`）。那在「只有 DSH 一个平台」
 * 时是够用的，但接入 ACP 之后同一个字符串在 `dsh` 与 `acp:claude` 下都可能存在，
 * 光看字符串无法判断这条映射还能不能复用：
 *   - 换平台后把旧 id 当新平台的会话发过去，平台回 404，而桥接只会当作「会话丢了」重建，
 *     真正的病因（平台换了，引用该作废）被掩盖；
 *   - 反向更糟：ACP 侧恰好有个同名字符串，于是映射「意外命中」，两个平台的上下文串在一起。
 *
 * 因此落盘统一成 `{ instance, sessionId }`：
 *   - `instance` 是**产生这个 id 的 Agent 平台**（`dsh` / 未来的 `acp:claude`）；
 *   - `sessionId` 只在该平台内有意义。
 *
 * 迁移口径（为什么不写一次性迁移脚本）：老数据的 `instance` 是空的，本模块用
 * 「空 = 未知，按当前平台认领」来读。这样升级后第一次启动就能正常用旧会话（不丢上下文），
 * 而注册表在装载后会把认领结果**写回**（见 `normalizeAll`）—— 从那一刻起落盘里就有
 * 明确的 `instance`，之后再换平台，旧引用会被正确判成「不属于当前平台」而不是被误用。
 *
 * 与 `src/agent-side/port.mjs` 的 `normalizeSessionRef` 分工：那一份服务于**调用面**，
 * 值缺失就是编程错误，直接抛；这一份服务于**磁盘**，脏数据必须能兜住（返回 null 让调用方
 * 决定丢弃还是重建），绝不能因为一条坏记录让整个状态加载失败。
 */

/**
 * 把磁盘上的任意形态归一到 `{ instance, sessionId }`。
 *
 * 接受：`{ instance, sessionId }`、`{ sessionId }`（老档案的 binding 整体传入）、裸 sessionId。
 * `instance` 缺失时用 `fallbackInstance` 认领（空串表示「确实未知」，由调用方后续补写）。
 *
 * @param {unknown} value 落盘值（三种形态之一）
 * @param {string} [fallbackInstance] 未知 instance 时的认领口径（通常是当前 port 的 id）
 * @returns {{instance: string, sessionId: string} | null} 无法解释时返回 null
 */
export function readSessionRef(value, fallbackInstance = '') {
  const fallback = String(fallbackInstance ?? '').trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sessionId = String(value.sessionId ?? '').trim();
    if (!sessionId) return null;
    return { instance: String(value.instance ?? '').trim() || fallback, sessionId };
  }
  const sessionId = String(value ?? '').trim();
  if (!sessionId) return null;
  return { instance: fallback, sessionId };
}

/** 只要 id：多数读路径（事件订阅、健康对账、取消）不关心是谁家的 id。 */
export function sessionIdOf(value) {
  return readSessionRef(value)?.sessionId ?? null;
}

/** 引用是不是「当前平台的」。`instance` 为空视为未知（迁移期老数据），按当前平台认领。 */
export function refBelongsTo(value, instance) {
  const ref = readSessionRef(value);
  if (!ref) return false;
  const want = String(instance ?? '').trim();
  return !ref.instance || !want || ref.instance === want;
}
