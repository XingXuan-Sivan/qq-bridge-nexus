// ACP 的连接层：连接就是 spawn 一个子进程，进程边界即信任边界。
//
// 与 DSH 的结构差异（都不是遗漏）：
//   · 没有地址发现与凭据猜测：stdio 传输没有 baseUrl，也没有 launch token；
//   · 没有「端口重新识别」：地址不是可变的，probe 失败只记账，不重试换地址；
//   · 事件是**归一后**的形状（AGENT_EVENT_KINDS），不是 wire 事件，因此收集器按
//     kind 累加文本、以 turn-end 收口，而不是识别 DSH 的 turn/start。
import { createAcpClient } from './client.mjs';
import { createAcpPort } from './port.mjs';
import { createAgentPort } from '../../port.mjs';
import * as declaration from '../../../../profiles/agent-platforms/acp/adapters/runtime.mjs';

/** 归一事件按会话收成一轮：text 累加，turn-end 收口。 */
function createCollector() {
  const turns = new Map(); // sessionId -> { text }
  return {
    push(event) {
      const sessionId = String(event?.sessionId ?? '');
      if (event?.kind === 'text') {
        const turn = turns.get(sessionId) ?? { text: '' };
        turn.text += String(event.delta ?? '');
        turns.set(sessionId, turn);
        return null;
      }
      if (event?.kind === 'turn-end') {
        const turn = turns.get(sessionId) ?? { text: '' };
        turns.delete(sessionId);
        return { text: turn.text, event };
      }
      return null;
    },
  };
}

export function createRuntime({ config = {}, log = () => {} } = {}) {
  let client = null;
  let port = null;

  function ensureClient() {
    if (!client) {
      client = createAcpClient({
        command: config.command,
        args: Array.isArray(config.args) ? config.args : [],
        cwd: String(config.cwd ?? ''),
        logger: log,
      });
    }
    return client;
  }

  function ensurePort() {
    if (!port) {
      const { impl, capabilities } = createAcpPort({ client: ensureClient() });
      port = createAgentPort({
        id: declaration.id,
        label: declaration.label,
        capabilities,
        impl,
      });
    }
    return port;
  }

  return {
    id: declaration.id,
    label: declaration.label,
    mode: 'stdio',

    /** stdio 没有凭据可猜；显式填了就带上，没有就算了（对端自己决定要不要）。 */
    prepareAuth(cfg = {}) {
      return { authToken: String(cfg.authToken ?? ''), tokenExplicit: Boolean(cfg.authToken) };
    },

    /** stdio 没有地址：把配置原样交回，调用方据此知道「没有可识别的端点」。 */
    async prepareEndpoint(cfg = {}) {
      return { baseUrl: String(cfg.baseUrl ?? ''), auto: false, discovered: false, reachable: false };
    },

    client() {
      return ensureClient();
    },

    port() {
      return ensurePort();
    },

    collector() {
      return createCollector();
    },

    /** 连续失败计数：对端退出 / 超时由调用方给出的错误决定，这里只管次数。 */
    health({ threshold = 2 } = {}) {
      const need = Math.max(1, Math.floor(Number(threshold) || 2));
      let failures = 0;
      let reason = null;
      return {
        threshold: need,
        fail(error) {
          failures += 1;
          reason = { kind: 'other', label: String(error?.message ?? error ?? '探活失败').slice(0, 120) };
          return { failures, reason, unavailable: failures >= need };
        },
        ok() {
          const result = { recoveredFrom: failures, reason };
          failures = 0;
          reason = null;
          return result;
        },
        get failures() { return failures; },
      };
    },

    /**
     * 探活：拉起子进程并握手（由 AgentPort 的 probe 完成 initialize）。
     * 失败不重试换地址——stdio 没有可换的地址。
     */
    probe() {
      return {
        async check() {
          try {
            const result = await ensurePort().probe();
            if (!result.ok) throw new Error(result.detail || 'ACP 探活失败');
            return { ok: true, error: null, rediscovered: false, url: null };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error : new Error(String(error ?? '探活失败')), rediscovered: false, url: null };
          }
        },
      };
    },

    /** 子进程没有「读错凭据目录」这一类问题。 */
    authHint() {
      return null;
    },

    /** 没有凭据被拒的提示，也就不存在「最近提示过」。 */
    authRecentlyFailed() {
      return false;
    },

    /** 没有限频的提示，重置无操作。 */
    resetAuthHint() {},

    async close() {
      port = null;
      if (typeof client?.close === 'function') await client.close();
      client = null;
    },
  };
}
