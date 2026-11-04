// 会话重置（P7 第三步：把 resetSession 的清理序列从 bridge.js 搬出来）。
//
// 这个模块只做一件事：给定「会话 key」，按固定顺序把桥接里所有按 key / 旧 sessionId
// 记账的内存态与外部资源清干净。它不 import 桥接的任何东西，所有需要碰的状态都由
// deps 注入——这样清理序列可以脱离 bridge.js 单测（`scripts/test-session-reset.mjs`
// 用假 Map 逐项断言），以后新增缓存只要在 deps 里登记，测试会立刻发现「漏清」。
//
// 顺序是有意义的，别随手调整：
//   1. 先删挂账（state.sessions / 策略 / 旧 sessionId 索引），后清定时器与队列；
//   2. 先清桥接内存态，再落盘（saveSocialV2State / saveState）；
//   3. 最后才停 DSH 侧工作与归档会话（这两步是网络调用，失败只记日志），
//      再回执「已重置会话」。反过来会在清理没做完时就让用户看到成功。
//
// 契约见 docs/COMMAND_REGISTRY.md §9 与 docs/PLUGIN_KERNEL.md 的会话章节。

/**
 * @param {{
 *   state: { sessions: Record<string, string>, sessionPolicies: Record<string, any> },
 *   bumpEpoch: () => void,
 *   bySessionId: Record<string, Map<any, any> | Set<any>>,
 *   pending: Map<string, { timer?: any }>,
 *   cancelPendingEntry: (entry: any) => Promise<any>,
 *   queued: Map<string, any>, queuedHintAt: Map<string, any>, sessionPromises: Map<string, any>,
 *   drainPromptQueue: (key: string, reason: string) => void,
 *   approvals: { removeKey: (key: string) => any[], forgetSession: (sid: string) => void },
 *   social: Record<string, Map<any, any> | Set<any>>,
 *   socialV2: { conversations: Map<string, any> },
 *   slang: { windows: Map<string, any>, extractionCooldowns: Map<string, any>, submitTimes: Map<string, any> },
 *   wake: { pending: Set<string>, updated: Set<string>, markRead: Set<string>, missCount: Map<string, any> },
 *   mediaStore: Map<string, any>, seenForwardIds: Set<string>,
 *   cancelSocialTimers: (key: string) => void,
 *   clearSocialV2Timers: (key: string) => void,
 *   forgetAgentToken: (key: string) => void,
 *   forgetConversationCaches: (key: string) => void,
 *   discardDormantForReset: (key: string) => void,
 *   saveSocialV2State: () => void,
 *   saveState: () => void,
 *   send: (key: string, text: string) => Promise<any>,
 *   api: { stopSessionWork: (sid: string) => Promise<any>, archiveSession: (args: { sessionId: string }) => Promise<any> },
 *   withTimeout: (promise: Promise<any>, ms: number, label: string) => Promise<any>,
 *   dshControlTimeoutMs: number,
 *   log: (msg: string) => void,
 * }} deps
 * @returns {(key: string) => Promise<{ ok: boolean, note?: string }>}
 */
export function createSessionResetter(deps) {
  const {
    state, bumpEpoch, pending, cancelPendingEntry, queued, queuedHintAt, sessionPromises,
    drainPromptQueue, approvals, social, socialV2, slang, wake, mediaStore, seenForwardIds,
    cancelSocialTimers, clearSocialV2Timers, forgetAgentToken, forgetConversationCaches,
    discardDormantForReset, saveSocialV2State, saveState, send, api, withTimeout,
    dshControlTimeoutMs, log,
  } = deps;
  const bySessionId = deps.bySessionId ?? {};

  return async function resetSession(key) {
    const old = state.sessions[key];
    if (!old) return { ok: true, note: 'no-session' };
    bumpEpoch();
    delete state.sessions[key];
    for (const map of Object.values(bySessionId)) map.delete(old);
    delete state.sessionPolicies[key];
    const pe = pending.get(key);
    if (pe) {
      clearTimeout(pe.timer);
      cancelPendingEntry(pe).catch(() => {});
    }
    pending.delete(key);
    for (const e of approvals.removeKey(key)) void cancelPendingEntry({ ...e, kind: 'approval' }).catch(() => {});
    approvals.forgetSession(old);
    queued.delete(key);
    queuedHintAt.delete(key);
    sessionPromises.delete(key);
    drainPromptQueue(key, '会话已重置');
    mediaStore.delete(key);
    for (const map of Object.values(social)) map.delete(key);
    for (const map of Object.values(slang)) map.delete(key);
    cancelSocialTimers(key);
    clearSocialV2Timers(key);
    wake.pending.delete(key);
    wake.updated.delete(key);
    wake.markRead.delete(key);
    wake.missCount.delete(key);
    forgetAgentToken(key);
    socialV2.conversations.delete(key);
    seenForwardIds.delete(key);
    // 按 key 记账的其余内存态（qq_wait_for_messages 的等待租约、发送失败标记、限流时间戳等）一并清掉：
    // 以前漏了等待租约，重置后新会话仍被旧租约挡住最长 15 分钟（「该会话已有一个等待中的 qq_wait_for_messages」）。
    forgetConversationCaches(key);
    discardDormantForReset(key);
    saveSocialV2State();
    saveState();
    // 与 retireSession 一致：先终止 DSH 侧排队的工作，再归档（归档只隐藏会话）。
    try { await withTimeout(api.stopSessionWork(old), dshControlTimeoutMs, 'stopSessionWork'); }
    catch (error) { log(`⚠️ 停止旧会话失败 ${key}：${error?.message ?? error}；请在 DSH 检查旧任务`); }
    try { await withTimeout(api.archiveSession({ sessionId: old }), dshControlTimeoutMs, 'archiveSession'); } catch {}
    await send(key, '已重置会话，下次消息将开新上下文');
    return { ok: true };
  };
}
