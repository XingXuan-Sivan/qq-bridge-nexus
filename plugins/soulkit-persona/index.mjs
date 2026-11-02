// soulkit 人格适配器（docs/PLUGIN_KERNEL.md §9.3）。
//
// 为什么 resolve 是纯同步的：桥接在组装 prompt 的同步链路里问「这个会话用哪张卡」。
// 网络请求放到 refresh 里，onInbound 时按 TTL 触发；拿不到新卡就保留旧缓存，
// 缓存也没有就返回 null，桥接自然回落到 roles/*.md —— 插件永远不该成为消息链路的故障点。
import { createHash } from 'node:crypto';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3110';
const DEFAULT_TIMEOUT_MS = 1200;
const CARD_TTL_MS = 5 * 60 * 1000;
const MIN_REFRESH_GAP_MS = 30 * 1000;

function normalizeBaseUrl(raw) {
  const value = String(raw ?? '').trim() || DEFAULT_BASE_URL;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`baseUrl 不是合法 URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`baseUrl 只允许 http/https，收到 ${url.protocol}`);
  }
  return url;
}

function clampTimeout(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.max(200, Math.min(5000, Math.trunc(value)));
}

function fingerprintOf(name, text) {
  return `sha256:${createHash('sha256').update(`${name}\n${text}`, 'utf8').digest('hex')}`;
}

function isUsableCard(card) {
  return Boolean(card && typeof card.name === 'string' && card.name.trim() && typeof card.text === 'string' && card.text.trim());
}

export async function activate(ctx) {
  const baseUrl = normalizeBaseUrl(ctx.config.baseUrl);
  const holder = String(ctx.config.holder ?? '').trim();
  const timeoutMs = clampTimeout(ctx.config.timeoutMs);

  let cache = null;
  try {
    const stored = ctx.state.read('card');
    if (isUsableCard(stored)) cache = stored;
  } catch (error) {
    ctx.log(`读取人格卡缓存失败，将从空缓存开始: ${error?.message ?? error}`);
  }

  let refreshing = null;
  let lastAttemptAt = 0;
  let consecutiveFailures = 0;
  let warned = false;

  const cardUrl = () => {
    const url = new URL('api/persona/card', baseUrl.href.endsWith('/') ? baseUrl.href : `${baseUrl.href}/`);
    if (holder) url.searchParams.set('holder', holder);
    return url.href;
  };

  async function refresh() {
    if (refreshing) return refreshing;
    const now = ctx.now();
    // lastAttemptAt 为 0 表示「还没试过」；否则第一次刷新会被最小间隔挡掉（测试用的假时钟从 0 起）。
    if (lastAttemptAt > 0 && now - lastAttemptAt < MIN_REFRESH_GAP_MS) return undefined;
    lastAttemptAt = now;

    refreshing = (async () => {
      const data = await ctx.http.fetchJson(cardUrl(), { timeoutMs });
      const name = String(data?.name ?? '').trim();
      const text = String(data?.text ?? '');
      if (!name || !text.trim()) throw new Error('soulkit 返回的人格卡缺少 name/text');

      cache = {
        name,
        text,
        holder,
        baseUrl: baseUrl.href,
        fetchedAt: ctx.now(),
        fingerprint: typeof data?.fingerprint === 'string' && data.fingerprint
          ? data.fingerprint
          : fingerprintOf(name, text),
      };
      ctx.state.write('card', cache);
      consecutiveFailures = 0;
      warned = false;
      ctx.log(`人格卡已更新：${name}（${text.length} 字）`);
    })()
      .catch((error) => {
        consecutiveFailures += 1;
        if (!warned) {
          ctx.log(`人格卡刷新失败（保留旧缓存，第 ${consecutiveFailures} 次）：${error?.message ?? error}`);
          warned = true;
        }
      })
      .finally(() => {
        refreshing = null;
      });

    return refreshing;
  }

  function isStale() {
    if (!cache) return true;
    return ctx.now() - Number(cache.fetchedAt ?? 0) > CARD_TTL_MS;
  }

  ctx.persona.register({
    id: 'soulkit',
    refresh: () => refresh(),
    // 单一人格：soulkit 目前只有一套卡，key 参数保留给以后的按会话卡。
    resolve: () => (isUsableCard(cache)
      ? { name: cache.name, text: cache.text, fingerprint: cache.fingerprint }
      : null),
  });

  // 启动时先拉一次；失败只留日志，不影响桥接启动。
  void refresh();

  return {
    hooks: {
      onInbound() {
        if (isStale()) void refresh();
      },
      onShutdown() {
        // 没有定时器/连接需要释放；保留钩子是为了让「插件在退出时该做什么」有明确位置。
      },
    },
  };
}
