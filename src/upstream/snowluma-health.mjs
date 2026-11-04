/**
 * SnowLuma 上游的接收链路健康度（P7 第四步：上游适配）。
 *
 * 这里收的是一整个**故障面判断**，不是几个字段：
 *
 * - 「SnowLuma 自报 good=false」是**确认坏**——它的 [Hook] 收不到 QQ 客户端数据，消息进不来；
 * - 「长时间没有事件包」只是**静默**——连 30 秒一次的心跳都没了，说明它的 OneBot 服务/进程
 *   可能卡住或不在了，这是另一个故障面，措辞必须分开（对用户来说排查方向完全不同）。
 *
 * 早先这两件事混在一个 `degraded` 布尔里、状态机散在 bridge 的 200 行里，既没法单测，
 * 也很容易把「静默」误报成「接收链路坏了」。现在它们都由本模块给出，桥接只喂事件。
 *
 * 模块不读全局：`log` / `fetchImpl` / 时钟 / 定时器 / 阈值全部注入，测试可用假时钟驱动。
 */

const DEFAULT_STATUS_POLL_MS = 60_000;
const DEFAULT_HEARTBEAT_MS = 30_000;

export function createSnowlumaHealth({
  log = () => {},
  fetchImpl = (...args) => fetch(...args),
  silenceWarnMs = 10 * 60_000,
  statusPollMs = DEFAULT_STATUS_POLL_MS,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  now = () => Date.now(),
  timers = { setTimeout, setInterval },
} = {}) {
  const state = {
    lastPacketAt: 0,      // 最近一个来自 SnowLuma 的事件包（含 meta/心跳）
    lastPacketKind: '',
    accountOnline: null,  // bot_status 的 online/offline（需要较新的 SnowLuma 运行时）
    good: null,           // 接收链路健康度：来自心跳 status.good / get_status.good
    goodSource: '',       // 'heartbeat' | 'get_status' —— 便于诊断「这条判断从哪来」
    goodError: '',
    goodCheckedAt: 0,
    connected: false,     // bot 的 open/close 维护
    degraded: false,      // 当前是否处于「已告警」状态（边沿触发，避免刷屏）
    reason: '',
  };

  /** 记录一次「上游还活着」的证据（任何事件包都算，含心跳）。 */
  function notePacket(kind) {
    state.lastPacketAt = now();
    state.lastPacketKind = String(kind ?? '');
  }

  /** 记下一次接收链路健康度。非布尔值忽略（老版本 SnowLuma 不报这个字段）。 */
  function noteReceiveHealth(good, source) {
    if (typeof good !== 'boolean') return;
    state.good = good;
    state.goodSource = source;
    state.goodError = '';
    state.goodCheckedAt = now();
  }

  function setConnected(value) { state.connected = Boolean(value); }
  function setAccountOnline(value) { if (typeof value === 'boolean') state.accountOnline = value; }
  function setReceiveError(message) { state.goodError = String(message ?? ''); }

  /** 供 /api/status 与控制台使用的只读快照。 */
  function snapshot() {
    const at = now();
    const agoMs = state.lastPacketAt ? at - state.lastPacketAt : null;
    const silent = state.lastPacketAt > 0 && agoMs > silenceWarnMs;
    // 只有 SnowLuma **明确自报** good=false 才算「确认坏了」（接收链路）。
    const confirmed = state.good === false;
    let hint = null;
    if (confirmed) {
      hint = 'SnowLuma 自报接收链路异常（good=false）：它的 [Hook] 收不到 QQ 客户端的数据，'
        + '消息进不来。这不是桥接的问题。请查看 SnowLuma 的 logs/snowluma-*.log 里的 [Hook] 行'
        + '（receive path stale / process enumeration timed out），并考虑升级 SnowLuma。';
    } else if (silent) {
      hint = `已连接但 ${Math.round(agoMs / 60000)} 分钟没有收到任何事件包（连 30 秒一次的心跳都没有）。`
        + '这说明 SnowLuma 的 OneBot 服务/进程本身可能已经卡住或不在了，而不只是收不到 QQ 数据；'
        + '请直接查看 SnowLuma 的 logs/snowluma-*.log。';
    }
    return {
      connected: state.connected,
      accountOnline: state.accountOnline,
      good: state.good,
      goodSource: state.goodSource || null,
      goodError: state.goodError || null,
      lastPacketAgoMs: agoMs,
      lastPacketKind: state.lastPacketKind || null,
      silent,
      degraded: confirmed || silent,
      hint,
    };
  }

  /** 边沿触发地告警/恢复，避免每轮探测都刷一行日志。 */
  function report() {
    const snap = snapshot();
    if (snap.degraded && !state.degraded) {
      state.degraded = true;
      state.reason = snap.hint ?? '';
      log(`⚠️ SnowLuma 上游不健康：${snap.hint}`);
      log('   这不是桥接的问题：桥接没有任何原生/注入面，也不控制 SnowLuma 或 QQ。');
      log('   排查：SnowLuma 的 logs/snowluma-*.log 里搜 [Hook]（看是否有 "receive path stale" 或 "process enumeration timed out"）。');
    } else if (!snap.degraded && state.degraded) {
      state.degraded = false;
      state.reason = '';
      log('✅ SnowLuma 上游已恢复正常（good≠false 且事件包在流动）');
    }
  }

  /**
   * 问一次 SnowLuma 的 `get_status`：账号在不在线、它自评的接收链路是否健康。
   *
   * ⚠️ 必须用 `get_status` —— `get_login_info` 只返回 `{ user_id, nickname }`，
   * 从它身上取 good 会永远拿到 undefined（而且不会报错）。
   * 这里只是**兜底轮询**：主路径是每 30 秒一次的心跳（免费）。
   *
   * @param {{ httpUrl?: string, accessToken?: string }} options 每次调用现取（支持热改配置）
   */
  async function pollStatus({ httpUrl = 'http://127.0.0.1:3000', accessToken = '' } = {}) {
    const base = String(httpUrl).replace(/\/+$/, '');
    try {
      const res = await fetchImpl(`${base}/get_status`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: '{}',
        signal: AbortSignal.timeout(8000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status !== 'ok') {
        setReceiveError(`HTTP ${res.status}${body?.wording ? ` ${body.wording}` : ''}`);
      } else {
        noteReceiveHealth(body.data?.good, 'get_status');
        setAccountOnline(body.data?.online);
      }
    } catch (error) {
      setReceiveError(error?.message ?? String(error));
    }
    state.goodCheckedAt = now();
    report();
  }

  /**
   * 起兜底轮询。`getConfig()` 每次现取，配置热改后下一轮即生效。
   * @param {() => ({ httpUrl?: string, accessToken?: string })} getConfig
   */
  function startWatch(getConfig = () => ({})) {
    if (state.watchStarted) return false;
    state.watchStarted = true;
    // 首次延后一点，避免与启动时的连接/自愈抢时序
    timers.setTimeout(() => { void pollStatus(getConfig()); }, 5000);
    const pollTimer = timers.setInterval(() => { void pollStatus(getConfig()); }, statusPollMs);
    pollTimer?.unref?.();
    // 边沿告警的兜底心跳：主信号（心跳 status.good）到达时会立刻评估，这里只防「心跳也没了」
    const reportTimer = timers.setInterval(report, heartbeatMs);
    reportTimer?.unref?.();
    return true;
  }

  return {
    notePacket,
    noteReceiveHealth,
    setConnected,
    setAccountOnline,
    setReceiveError,
    snapshot,
    report,
    pollStatus,
    startWatch,
  };
}
