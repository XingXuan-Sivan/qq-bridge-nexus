// 记忆 provider 注册表。
//
// 与 persona 注册表同构：插件内核负责 staging → commit（activate 成功才调用这里的
// register），停用/重载按 pluginId 注销；这里只管「运行时有哪些 provider、注入哪一个、
// 缓存与状态」。设计见 docs/MEMORY_SUBSYSTEM.md §2.1。
//
// 两条取数路径：
// - sync provider（如内置 local-digest）：注入时直接 fetchSync，必须快、不发网络请求。
// - async provider（如 soulkit）：唤醒前 warm（带超时）写入缓存，注入时只读缓存；
//   缓存未命中就注入空串，绝不阻塞唤醒。
import { MEMORY_INJECT_DEFAULT_CHARS, MEMORY_CACHE_TTL_MS, MEMORY_TIMEOUT_MS } from './defaults.mjs';

export const MEMORY_PROVIDER_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
export const MEMORY_CONTRACT = 'memory-provider/1';

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = Math.round(n);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

// memory.* 的规范化：只保留认识的字段，范围一律夹紧；未知 provider 配置原样保留（插件自己读）。
export function normalizeMemoryConfig(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const inject = src.inject && typeof src.inject === 'object' && !Array.isArray(src.inject) ? src.inject : {};
  const providers = src.providers && typeof src.providers === 'object' && !Array.isArray(src.providers) ? src.providers : {};
  const outProviders = {};
  for (const [id, value] of Object.entries(providers)) {
    if (!MEMORY_PROVIDER_ID_RE.test(id)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const conf = {};
    if (typeof value.enabled === 'boolean') conf.enabled = value.enabled;
    if (typeof value.baseUrl === 'string') conf.baseUrl = value.baseUrl.trim().slice(0, 300);
    if (value.maxChars === null || value.maxChars === 0) conf.maxChars = 0;
    else if (Number.isInteger(Number(value.maxChars))) conf.maxChars = clampInt(value.maxChars, 0, 100000, MEMORY_INJECT_DEFAULT_CHARS);
    if (Number.isInteger(Number(value.timeoutMs))) conf.timeoutMs = clampInt(value.timeoutMs, 100, 10000, MEMORY_TIMEOUT_MS);
    if (value.limits && typeof value.limits === 'object' && !Array.isArray(value.limits)) {
      const limits = {};
      for (const [k, [min, max]] of Object.entries({
        topics: [0, 50],
        thoughts: [0, 50],
        impressions: [0, 50],
        impressionsMax: [0, 200],
        topicStaleHours: [0, 24 * 30],
        itemChars: [20, 2000],
      })) {
        if (value.limits[k] === undefined) continue;
        limits[k] = clampInt(value.limits[k], min, max, undefined);
        if (limits[k] === undefined) delete limits[k];
      }
      conf.limits = limits;
    }
    outProviders[id] = conf;
  }
  const tools = src.tools && typeof src.tools === 'object' && !Array.isArray(src.tools) ? src.tools : {};
  const handover = src.handover && typeof src.handover === 'object' && !Array.isArray(src.handover) ? src.handover : {};
  const ingest = src.ingest && typeof src.ingest === 'object' && !Array.isArray(src.ingest) ? src.ingest : {};
  return {
    inject: {
      provider: typeof inject.provider === 'string' && MEMORY_PROVIDER_ID_RE.test(inject.provider) ? inject.provider : 'local-digest',
      maxChars: inject.maxChars === 0 ? 0 : clampInt(inject.maxChars, 0, 20000, MEMORY_INJECT_DEFAULT_CHARS),
      timeoutMs: clampInt(inject.timeoutMs, 100, 10000, MEMORY_TIMEOUT_MS),
      cacheTtlMs: clampInt(inject.cacheTtlMs, 0, 60 * 60 * 1000, MEMORY_CACHE_TTL_MS),
    },
    providers: outProviders,
    tools: {
      recall: tools.recall !== false,
      note: tools.note === true,
    },
    handover: { enabled: handover.enabled !== false },
    ingest: { enabled: ingest.enabled === true },
  };
}

export function createMemoryRegistry({ log = () => {}, config = null, now = () => Date.now() } = {}) {
  const providers = new Map();
  const cache = new Map(); // `${provider}\u0000${key}\u0000${query}` -> { at, text, truncated, chars }
  const stats = new Map(); // providerId -> { calls, warms, hits, failures, lastError, lastAt, lastChars, lastStatus }
  let cfg = normalizeMemoryConfig(config);

  const statsOf = (id) => {
    if (!stats.has(id)) stats.set(id, { calls: 0, warms: 0, hits: 0, failures: 0, lastError: null, lastAt: null, lastChars: 0, lastStatus: 'idle' });
    return stats.get(id);
  };

  const providerConf = (id) => cfg.providers?.[id] ?? {};
  const isEnabled = (provider) => providerConf(provider.id).enabled !== false;

  function setConfig(next) {
    cfg = normalizeMemoryConfig(next);
    return cfg;
  }

  function register(provider, pluginId = null) {
    if (!provider || typeof provider !== 'object') throw new Error('memory provider 必须是对象');
    const id = String(provider.id || '');
    if (!MEMORY_PROVIDER_ID_RE.test(id)) throw new Error(`memory provider id 非法：${id || '(空)'}`);
    if (provider.contract !== MEMORY_CONTRACT) throw new Error(`memory provider 契约不符：${id} 需要 ${MEMORY_CONTRACT}`);
    if (typeof provider.fetchSync !== 'function' && typeof provider.fetch !== 'function') {
      throw new Error(`memory provider 缺少 fetch/fetchSync：${id}`);
    }
    const capabilities = provider.capabilities && typeof provider.capabilities === 'object' ? provider.capabilities : {};
    if (capabilities.sync === true && typeof provider.fetchSync !== 'function') {
      throw new Error(`memory provider 声明 sync 但没有 fetchSync：${id}`);
    }
    providers.set(id, {
      id,
      label: String(provider.label || id).slice(0, 60),
      pluginId: pluginId || provider.pluginId || 'core',
      capabilities: { sync: capabilities.sync === true, write: capabilities.write === true, listable: capabilities.listable !== false },
      fetch: typeof provider.fetch === 'function' ? provider.fetch : null,
      fetchSync: typeof provider.fetchSync === 'function' ? provider.fetchSync : null,
      registeredAt: now(),
    });
    statsOf(id).lastStatus = 'idle';
    return true;
  }

  function unregister(id) {
    const provider = providers.get(id);
    if (!provider) return false;
    providers.delete(id);
    for (const cacheKey of [...cache.keys()]) {
      if (cacheKey.startsWith(`${id}\u0000`)) cache.delete(cacheKey);
    }
    stats.delete(id);
    return true;
  }

  function unregisterPlugin(pluginId) {
    let removed = 0;
    for (const provider of [...providers.values()]) {
      if (provider.pluginId === pluginId) {
        unregister(provider.id);
        removed += 1;
      }
    }
    return removed;
  }

  function list() {
    return [...providers.values()].map((provider) => {
      const st = statsOf(provider.id);
      const conf = providerConf(provider.id);
      return {
        id: provider.id,
        label: provider.label,
        pluginId: provider.pluginId,
        enabled: isEnabled(provider),
        injectable: cfg.inject.provider === provider.id,
        sync: provider.capabilities.sync,
        write: provider.capabilities.write,
        maxChars: conf.maxChars === undefined ? (provider.capabilities.sync ? cfg.inject.maxChars : 0) : conf.maxChars,
        timeoutMs: conf.timeoutMs ?? cfg.inject.timeoutMs,
        calls: st.calls,
        warms: st.warms,
        hits: st.hits,
        failures: st.failures,
        lastError: st.lastError,
        lastAt: st.lastAt,
        lastChars: st.lastChars,
        lastStatus: st.lastStatus,
      };
    });
  }

  function injectProvider() {
    const provider = providers.get(cfg.inject.provider);
    if (!provider || !isEnabled(provider)) return null;
    return provider;
  }

  // 唤醒前预热：只对 async provider 发一次请求，超时/失败都只影响自己。
  async function warm({ key, query = '' } = {}) {
    if (!key) return;
    const jobs = [];
    for (const provider of providers.values()) {
      if (!isEnabled(provider)) continue;
      if (provider.capabilities.sync) continue;
      const cacheKey = `${provider.id}\u0000${key}\u0000${query}`;
      const hit = cache.get(cacheKey);
      if (hit && cfg.inject.cacheTtlMs > 0 && now() - hit.at < cfg.inject.cacheTtlMs) {
        statsOf(provider.id).hits += 1;
        continue;
      }
      jobs.push((async () => {
        const st = statsOf(provider.id);
        st.warms += 1;
        const timeoutMs = providerConf(provider.id).timeoutMs ?? cfg.inject.timeoutMs;
        let timer;
        try {
          const result = await Promise.race([
            provider.fetch({ key, query, limit: cfg.inject.maxChars }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`记忆 provider ${provider.id} 超时 ${timeoutMs}ms`)), timeoutMs); }),
          ]);
          clearTimeout(timer);
          const text = normalizeText(result?.text ?? result?.block?.text ?? result ?? '');
          const chars = text.length;
          cache.set(cacheKey, { at: now(), text, chars });
          st.lastStatus = text ? 'injected' : 'empty';
          st.lastChars = chars;
          st.lastAt = now();
          st.lastError = null;
        } catch (error) {
          clearTimeout(timer);
          st.failures += 1;
          st.lastError = String(error?.message || error);
          st.lastStatus = 'error';
          log(`⚠️ 记忆 provider ${provider.id} 预热失败：${st.lastError}`);
        }
      })());
    }
    if (jobs.length) await Promise.allSettled(jobs);
  }

  function normalizeText(value) {
    if (typeof value === 'string') return value.trim();
    return '';
  }

  function truncate(text, maxChars) {
    if (!maxChars || maxChars <= 0) return { text, truncated: false };
    if (text.length <= maxChars) return { text, truncated: false };
    return { text: text.slice(0, maxChars), truncated: true };
  }

  // 注入路径：必须是同步的（renderBlockSync 不接受 Promise）。
  function injectionSync({ key, query = '' } = {}) {
    const provider = injectProvider();
    if (!provider) return { provider: null, text: '', status: 'off', chars: 0, truncated: false };
    const st = statsOf(provider.id);
    const providerMax = providerConf(provider.id).maxChars ?? 0;
    const budget = Math.min(cfg.inject.maxChars || Infinity, providerMax || Infinity);
    const maxChars = Number.isFinite(budget) ? budget : 0;
    st.calls += 1;
    try {
      let text = '';
      if (provider.capabilities.sync) {
        const result = provider.fetchSync({ key, query, limit: maxChars, limits: providerConf(provider.id).limits ?? {} });
        text = normalizeText(result?.text ?? result ?? '');
      } else {
        const hit = cache.get(`${provider.id}\u0000${key}\u0000${query}`) ?? cache.get(`${provider.id}\u0000${key}\u0000`);
        text = hit?.text ?? '';
        if (hit) st.hits += 1;
      }
      const cut = truncate(text, maxChars);
      st.lastChars = cut.text.length;
      st.lastAt = now();
      st.lastStatus = cut.truncated ? 'truncated' : (cut.text ? 'injected' : 'empty');
      st.lastError = null;
      return { provider: provider.id, text: cut.text, status: st.lastStatus, chars: cut.text.length, truncated: cut.truncated };
    } catch (error) {
      st.failures += 1;
      st.lastError = String(error?.message || error);
      st.lastStatus = 'error';
      log(`⚠️ 记忆 provider ${provider.id} 注入失败：${st.lastError}`);
      return { provider: provider.id, text: '', status: 'error', chars: 0, truncated: false };
    }
  }

  function status() {
    return {
      inject: { provider: cfg.inject.provider, maxChars: cfg.inject.maxChars, timeoutMs: cfg.inject.timeoutMs, cacheTtlMs: cfg.inject.cacheTtlMs },
      providers: list(),
      tools: { ...cfg.tools },
      handover: { ...cfg.handover },
      ingest: { ...cfg.ingest },
      cacheEntries: cache.size,
    };
  }

  return {
    register,
    unregister,
    unregisterPlugin,
    list,
    status,
    setConfig,
    getConfig: () => cfg,
    injectProvider,
    warm,
    injectionSync,
    has: (id) => providers.has(id),
  };
}
