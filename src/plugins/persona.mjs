// 人格 provider 注册表与缓存策略（docs/PERSONA_PROVIDER.md）。
//
// 两层职责分得很开：
// - provider 只回答「这个会话现在该用哪张卡」——有没有卡、卡是什么、ETag 是多少；
// - 注册表负责「什么时候问、问不到怎么办」——TTL、最小刷新间隔、单飞、旧卡降级、持久化。
//
// 这样换实现（soulkit / 本地文件 / 远端服务）不用重写缓存与降级，缓存与降级也不会
// 每个 provider 各写一套、各有一套 bug。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PERSONA_CONTRACT = 'persona-provider/1';
const CACHE_VERSION = 1;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MIN_REFRESH_GAP_MS = 30 * 1000;
const DEFAULT_STALE_MAX_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEGRADE_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_BUDGET_MS = 1200;

export function fingerprintOf(name, text) {
  // 只认 16 位小写十六进制：桥接的角色刷新记录器（src/role-refresh.js）用它做去重，
  // 格式不对的指纹会被直接丢掉，卡片就会每次唤醒都被当成「刚更新」。
  return crypto.createHash('sha256').update(`${name}\u0000${text}`).digest('hex').slice(0, 16);
}

const FINGERPRINT_RE = /^[0-9a-f]{16}$/;

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} 超时（${ms}ms）`);
      error.code = 'PERSONA_TIMEOUT';
      reject(error);
    }, Math.max(1, ms));
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function normalizeCard(card) {
  if (!card || typeof card !== 'object') throw new Error('card 必须是对象');
  const name = String(card.name ?? '').trim();
  const text = String(card.text ?? '').trim();
  if (!name) throw new Error('card.name 不能为空');
  if (!text) throw new Error('card.text 不能为空');
  const fingerprint = typeof card.fingerprint === 'string' && FINGERPRINT_RE.test(card.fingerprint)
    ? card.fingerprint
    : fingerprintOf(name, text);
  return { name, text, fingerprint };
}

function validateProvider(provider) {
  if (!provider || typeof provider !== 'object') return 'provider 必须是对象';
  if (typeof provider.id !== 'string' || !provider.id.trim()) return 'provider.id 必须是非空字符串';
  if (provider.contract !== PERSONA_CONTRACT) return `provider.contract 必须是 "${PERSONA_CONTRACT}"`;
  const caps = provider.capabilities;
  if (!caps || typeof caps !== 'object') return 'provider.capabilities 必须是对象';
  for (const field of ['perSession', 'conditional', 'listable']) {
    if (typeof caps[field] !== 'boolean') return `provider.capabilities.${field} 必须是布尔值`;
  }
  // 目录能力（catalog/create/update/rename/remove）是可选的：
  // 老 provider 不声明就按「只读、不提供 CRUD」处理，不能被判为非法。
  for (const field of ['catalog', 'create', 'update', 'rename', 'remove']) {
    if (caps[field] !== undefined && typeof caps[field] !== 'boolean') return `provider.capabilities.${field} 必须是布尔值`;
  }
  if (typeof provider.get !== 'function') return 'provider.get 必须是函数';
  return null;
}

/**
 * @param {object} options
 * @param {(message: string) => void} [options.log]
 * @param {string|null} [options.stateFile]      持久化缓存路径；null 表示只在内存里
 * @param {number} [options.ttlMs]
 * @param {number} [options.minRefreshGapMs]
 * @param {number} [options.staleMaxMs]
 * @param {number} [options.degradeAfterMs]
 * @param {number} [options.maxEntries]
 * @param {() => number} [options.now]
 */
export function createPersonaRegistry({
  log = () => {},
  stateFile = null,
  ttlMs,
  minRefreshGapMs,
  staleMaxMs,
  degradeAfterMs,
  maxEntries,
  now = () => Date.now(),
} = {}) {
  const ttl = clampNumber(ttlMs, DEFAULT_TTL_MS, 60_000, 3_600_000);
  const minGap = clampNumber(minRefreshGapMs, DEFAULT_MIN_REFRESH_GAP_MS, 5_000, 300_000);
  const staleMax = clampNumber(staleMaxMs, DEFAULT_STALE_MAX_MS, 3_600_000, 604_800_000);
  const degradeAfter = clampNumber(degradeAfterMs, DEFAULT_DEGRADE_AFTER_MS, 60_000, 3_600_000);
  const limit = clampNumber(maxEntries, DEFAULT_MAX_ENTRIES, 1, 2000);

  let active = null;
  /** 并列的目录 provider：注入只认 active，列表/读写按 id 分派。 */
  const catalog = new Map();
  let loaded = false;
  /** @type {Map<string, {state: 'card'|'none', name?: string, text?: string, fingerprint?: string, etag?: string|null, fetchedAt: number, failures: number}>} */
  const entries = new Map();
  const inFlight = new Map();
  const lastAttempt = new Map();
  let lastError = null;
  let lastErrorAt = null;
  let lastRefreshAt = null;

  function load() {
    if (loaded) return;
    loaded = true;
    if (!stateFile) return;
    try {
      const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (raw?.version !== CACHE_VERSION || typeof raw?.entries !== 'object' || !raw.entries) return;
      for (const [key, entry] of Object.entries(raw.entries)) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry.state === 'card') {
          const card = normalizeCard(entry);
          entries.set(key, { state: 'card', ...card, etag: entry.etag ?? null, fetchedAt: Number(entry.fetchedAt) || 0, failures: 0 });
        } else if (entry.state === 'none') {
          entries.set(key, { state: 'none', fetchedAt: Number(entry.fetchedAt) || 0, failures: 0 });
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') log(`⚠️ 人格缓存读取失败，按空缓存继续：${error?.message ?? error}`);
    }
  }

  function persist() {
    if (!stateFile) return;
    try {
      if (entries.size > limit) {
        const sorted = [...entries.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
        for (const [key] of sorted.slice(0, entries.size - limit)) entries.delete(key);
      }
      const payload = { version: CACHE_VERSION, provider: active?.provider.id ?? null, entries: Object.fromEntries(entries) };
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      const temporary = `${stateFile}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(temporary, JSON.stringify(payload));
      fs.renameSync(temporary, stateFile);
    } catch (error) {
      log(`⚠️ 人格缓存写入失败：${error?.message ?? error}`);
    }
  }

  function resolve(key) {
    if (!active) return null;
    load();
    const entry = entries.get(String(key));
    if (!entry || entry.state !== 'card') return null;
    const age = now() - entry.fetchedAt;
    if (age > staleMax) return null;
    return {
      name: entry.name,
      text: entry.text,
      fingerprint: entry.fingerprint,
      source: active.provider.id,
      stale: age > ttl,
    };
  }

  async function warm(key, { force = false, budgetMs = DEFAULT_BUDGET_MS } = {}) {
    if (!active) return null;
    load();
    const conversation = String(key);
    const entry = entries.get(conversation);
    const attemptedAt = lastAttempt.get(conversation) ?? 0;
    if (!force) {
      if (entry?.state === 'card' && now() - entry.fetchedAt <= ttl) return resolve(conversation);
      // 失败与「这个会话没有卡」共用同一个最小间隔：两者都不该每次唤醒都打一次。
      if (entry?.state === 'none' && now() - entry.fetchedAt <= ttl) return null;
      if (attemptedAt > 0 && now() - attemptedAt < minGap) return resolve(conversation);
    }
    if (inFlight.has(conversation)) return inFlight.get(conversation);

    lastAttempt.set(conversation, now());
    const task = (async () => {
      try {
        const result = await withTimeout(
          Promise.resolve(active.provider.get(conversation, { etag: entry?.etag ?? null })),
          Math.max(200, Math.min(8000, Number(budgetMs) || DEFAULT_BUDGET_MS)),
          `人格 provider(${active.provider.id})`,
        );
        if (!result || typeof result !== 'object') throw new Error('provider 返回值不是对象');
        if (result.status === 'card') {
          const card = normalizeCard(result.card);
          entries.set(conversation, {
            state: 'card',
            ...card,
            etag: result.etag ?? entry?.etag ?? null,
            fetchedAt: now(),
            failures: 0,
          });
          lastRefreshAt = new Date(now()).toISOString();
          lastError = null;
          lastErrorAt = null;
          persist();
          return resolve(conversation);
        }
        if (result.status === 'none') {
          entries.set(conversation, { state: 'none', fetchedAt: now(), failures: 0 });
          lastRefreshAt = new Date(now()).toISOString();
          lastError = null;
          lastErrorAt = null;
          persist();
          return null;
        }
        if (result.status === 'not-modified') {
          if (entry?.state !== 'card') throw new Error('provider 返回 not-modified，但本地没有该会话的缓存卡');
          entries.set(conversation, { ...entry, etag: result.etag ?? entry.etag, fetchedAt: now(), failures: 0 });
          lastRefreshAt = new Date(now()).toISOString();
          lastError = null;
          lastErrorAt = null;
          persist();
          return resolve(conversation);
        }
        throw new Error(`provider 返回未知状态: ${result.status}`);
      } catch (error) {
        const failures = (entries.get(conversation)?.failures ?? 0) + 1;
        const previous = entries.get(conversation);
        if (previous) entries.set(conversation, { ...previous, failures });
        lastError = String(error?.message ?? error);
        lastErrorAt = new Date(now()).toISOString();
        // 只在第一次失败时告警：连续失败时每次唤醒刷一行日志没有信息量。
        if (failures === 1) log(`⚠️ 人格卡刷新失败（保留旧缓存）：${lastError}`);
        persist();
        return resolve(conversation);
      } finally {
        inFlight.delete(conversation);
      }
    })();
    inFlight.set(conversation, task);
    return task;
  }

  function register(provider, pluginId = 'unknown') {
    const problem = validateProvider(provider);
    if (problem) throw new Error(problem);
    if (active) log(`⚠️ 人格 provider "${active.provider.id}" 将被 "${provider.id}" 覆盖（插件 ${pluginId}）`);
    active = { provider, plugin: pluginId };
    // 目录可以并列多个 provider；注入（get/warm）只认 active。
    catalog.set(provider.id, { provider, plugin: pluginId });
    loaded = false;
    load();
    log(`[plugins] 人格 provider 已注册：${provider.id}（插件 ${pluginId}）`);
  }

  function unregister(pluginId) {
    for (const [id, entry] of catalog) {
      if (entry.plugin === pluginId) {
        catalog.delete(id);
        if (active?.plugin === pluginId && active.provider.id === id) active = null;
      }
    }
    if (active?.plugin === pluginId) {
      const fallback = [...catalog.values()].find((entry) => typeof entry.provider.get === 'function');
      active = fallback ? { provider: fallback.provider, plugin: fallback.plugin } : null;
    }
    if (!active) log('[plugins] 人格 provider 已注销');
    else log(`[plugins] 人格 provider 已注销，改用 ${active.provider.id}`);
  }

  function describe() {
    if (!active) return null;
    return {
      id: active.provider.id,
      plugin: active.plugin,
      contract: active.provider.contract,
      capabilities: { ...active.provider.capabilities },
    };
  }

  /** 当前 provider 的只读引用：桥接的「外部人格」接口用它做列表 / 读写代理。 */
  function provider() {
    return active?.provider ?? null;
  }

  /** 全部并列的目录 provider（带 plugin / capabilities）。 */
  function providers() {
    return [...catalog.values()].map(({ provider: item, plugin }) => ({
      id: item.id,
      plugin,
      contract: item.contract,
      capabilities: { ...item.capabilities },
      provider: item,
    }));
  }

  function providerById(id) {
    return catalog.get(String(id))?.provider ?? null;
  }

  function status() {
    load();
    const nowMs = now();
    let cards = 0;
    let stale = 0;
    let failures = 0;
    for (const entry of entries.values()) {
      failures += entry.failures ?? 0;
      if (entry.state !== 'card') continue;
      cards += 1;
      if (nowMs - entry.fetchedAt > degradeAfter) stale += 1;
    }
    return {
      provider: describe(),
      keys: entries.size,
      cards,
      stale,
      degraded: stale > 0 || Boolean(lastError),
      lastError,
      lastErrorAt,
      lastRefreshAt,
      failures,
    };
  }

  return { register, unregister, resolve, warm, describe, status, provider, providers, providerById };
}
