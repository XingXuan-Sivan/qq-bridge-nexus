// DSH 的连接层：地址与凭据怎么发现、客户端怎么建、事件怎么收成一轮、失败怎么分类。
//
// 内核只经 src/agent-side/runtime.mjs 的 agentRuntime() 调这里的方法名；本文件与
// 同目录的 client / endpoint / health / port / auth-hint / probe 是「连一个常驻 HTTP 服务」
// 这一整类实现的归口。换执行体时只替换这一层，AgentPort 的调用面不受影响。
import { NodeApiClient, discoverDshLaunchToken, resolveDshHome } from './client.mjs';
import { createDshEventPlane } from './events-plane.mjs';
import { resolveDshBaseUrl } from './endpoint.mjs';
import { createDshHealth } from './health.mjs';
import { createDshProbe } from './probe.mjs';
import { buildDshAuthHint, createAuthHintGate, isDshAuthError } from './auth-hint.mjs';
import { DSH_AGENT_CAPABILITIES, createDshPort } from './port.mjs';
import { createAgentPort } from '../../port.mjs';
import { createAgentTurnCollector } from '../../collector.mjs';
import * as declaration from '../../../../profiles/agent-platforms/dsh/adapters/runtime.mjs';

/** 地址重新识别的开销不小（扫进程监听端口），失败时按这个间隔节流。 */
const REDISCOVER_INTERVAL_MS = 10_000;

/**
 * 建一个 DSH 运行期句柄。
 *
 * @param {object} opts
 * @param {object} opts.config   `platforms.agents.dsh` 的活引用（endpoint + options 拍平后的视图）
 * @param {(message: string) => void} [opts.log]
 * @param {(url: string) => void} [opts.onBaseUrlChange]  重新识别到新地址时回调（由调用方决定要不要落盘）
 */
export function createRuntime({ config = {}, log = () => {}, onBaseUrlChange } = {}) {
  let client = null;
  let port = null;
  let events = null;
  let autoBaseUrl = false;
  const authHintGate = createAuthHintGate();
  /** 挂起表：`requestId -> { clientId, eventId, sessionId }`，事件面写入、端口读出。 */
  const approvals = new Map();

  /** 懒建：地址与凭据都就绪后才建客户端。 */
  function ensureClient() {
    if (client) return client;
    if (!config.baseUrl) throw new Error('DSH 连接层尚未准备地址：先调用 prepareEndpoint');
    client = new NodeApiClient(config.baseUrl, undefined, {
      token: config.authToken,
      // true = 用户在配置里显式填的；false = 从启动日志猜的。猜来的不优先于离线铸造的 Cookie。
      tokenExplicit: config.authTokenExplicit === true,
      header: config.authHeader,
      prefix: config.authPrefix,
      // 默认只允许把 launch token 交给回环地址；远程 DSH 需要显式 opt-in。
      allowRemote: config.allowRemote === true,
    });
    return client;
  }

  /** 懒建端口：AgentPort 的调用面在这里装配，连接层不碰具体动词。 */
  function ensurePort() {
    if (!port) {
      port = createAgentPort({
        id: declaration.id,
        label: declaration.label,
        capabilities: DSH_AGENT_CAPABILITIES,
        impl: createDshPort({ client: ensureClient(), approvals }),
      });
    }
    return port;
  }

  /** 懒建事件面：wire 帧的翻译全在 events-plane，这里只接上客户端的连接。 */
  function ensureEvents() {
    if (!events) events = createDshEventPlane({ getClient: ensureClient, approvals });
    return events;
  }

  return {
    id: declaration.id,
    label: declaration.label,
    mode: 'http',

    /**
     * 连接前补全凭据。
     *
     * launch token 是每进程现生成的随机数、不落盘，只有启动器把 `dsh web` 的 stdout
     * 重定向到文件时才读得到；因此这里发现的只是兜底，主路径是客户端用数据目录里
     * 持久化的签名密钥离线铸造 Cookie。
     */
    prepareAuth(cfg = {}) {
      const explicit = Boolean(cfg.authToken);
      return {
        authToken: explicit ? String(cfg.authToken) : discoverDshLaunchToken(),
        tokenExplicit: explicit,
      };
    },

    /** 连接前补全地址：留空时按候选端口 + 进程监听端口识别。 */
    async prepareEndpoint(cfg = {}) {
      const endpoint = await resolveDshBaseUrl(cfg.baseUrl);
      autoBaseUrl = endpoint.auto === true;
      if (endpoint.url) config.baseUrl = endpoint.url;
      return {
        baseUrl: endpoint.url,
        auto: autoBaseUrl,
        discovered: endpoint.discovered === true,
        reachable: endpoint.reachable === true,
      };
    },

    client() {
      return ensureClient();
    },

    /** 事件流订阅面：mux 产的是归一事件，wire 帧不出适配器。 */
    events() {
      return ensureEvents();
    },

    port() {
      return ensurePort();
    },

    collector() {
      return createAgentTurnCollector();
    },

    health(options = {}) {
      return createDshHealth(options);
    },

    /**
     * 探活 + 失败时按节流窗口重新识别地址。
     *
     * 「探活」用 AgentPort 的查询语义（失败返 ok:false 不抛），这里是抛错语义；
     * 翻译放在连接层，「什么算不可用」的策略仍由调用方记账。
     */
    probe() {
      return createDshProbe({
        probe: async () => {
          const result = await ensurePort().probe();
          if (!result.ok) throw new Error(result.detail || 'DSH 探活失败');
        },
        isAutoBaseUrl: () => autoBaseUrl,
        rediscover: async () => {
          const endpoint = await resolveDshBaseUrl('', { timeoutMs: 600 });
          return endpoint ? { reachable: endpoint.reachable === true, url: endpoint.url } : null;
        },
        // 换地址只能由客户端自己做：它是唯一知道 baseUrl 与凭据绑定关系的地方。
        applyUrl: (url) => {
          if (client?.setBaseUrl?.(url)) {
            config.baseUrl = url;
            onBaseUrlChange?.(url);
          }
        },
        rediscoverIntervalMs: REDISCOVER_INTERVAL_MS,
        log,
      });
    },

    /** 401 时给一段「读的是哪个凭据目录」的诊断；不需要提示时返回 null。 */
    authHint(error) {
      if (!isDshAuthError(error)) return null;
      if (!authHintGate.fail()) return null;
      return buildDshAuthHint({ dshHome: resolveDshHome() });
    },

    /** 最近是否刚提示过凭据被拒：给「连上就断」那类日志做归因。 */
    authRecentlyFailed() {
      return authHintGate.recentlyFailed();
    },

    /** 探活恢复后重置提示限频：下一次 401 应该立即提示。 */
    resetAuthHint() {
      authHintGate.reset();
    },

    async close() {
      port = null;
      events = null;
      approvals.clear();
      if (typeof client?.close === 'function') await client.close();
      client = null;
    },
  };
}
