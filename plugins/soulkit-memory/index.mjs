// soulkit 记忆 provider（docs/MEMORY_SUBSYSTEM.md §2.1）。
//
// 只做一件事：把 soulkit 的 `POST /api/recall` 翻译成 memory-provider/1。
// 缓存、超时、单飞、截断、失败静默全部在内核的注册表里——这里再写一套就会有两份 TTL、
// 两份告警，行为和状态页对不上。
const DEFAULT_BASE_URL = 'http://127.0.0.1:3110';
const DEFAULT_TIMEOUT_MS = 900;
// soulkit 的检索是“按关键词/主题回忆”，喂整段历史没有意义，也会拖慢它；与 dsh-memory 适配器一致取尾部 600 字。
const MAX_QUERY_CHARS = 600;

// soulkit 的绑定按 `<group|private>:<id>` 存（它只服务 QQ，平台由 `platform` 参数表达），
// 而桥接的会话 key 是 `<platform>:<kind>:<id>`。这里只做一次形态转换：
// 认得出新形态就削掉平台前缀，认不出（旧形态或别处传进来的自定义 key）就原样透传。
const PLATFORM_KEY_RE = /^[a-z][a-z0-9-]{0,15}:(group|private):(\d+)$/;

function normalizeBaseUrl(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return DEFAULT_BASE_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_BASE_URL;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

function clampTimeout(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.min(5000, Math.max(200, Math.trunc(n)));
}

function soulkitChat(key) {
  const raw = String(key ?? '');
  const m = PLATFORM_KEY_RE.exec(raw);
  return m ? `${m[1]}:${m[2]}` : raw;
}

// 兼容几代返回形状：新版本给 text，旧版本给 block / block.text。
function recallText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.text === 'string') return payload.text;
  if (typeof payload.block === 'string') return payload.block;
  if (payload.block && typeof payload.block.text === 'string') return payload.block.text;
  return '';
}

export async function activate(ctx) {
  const baseUrl = normalizeBaseUrl(ctx.config?.baseUrl);
  const timeoutMs = clampTimeout(ctx.config?.timeoutMs);
  const view = typeof ctx.config?.view === 'string' && ctx.config.view.trim() ? ctx.config.view.trim() : 'self';
  const recallUrl = `${baseUrl}/api/recall`;

  ctx.memory.registerProvider({
    id: 'soulkit',
    label: 'soulkit 长期记忆',
    contract: 'memory-provider/1',
    // async：唤醒前由内核预热、注入时只读缓存，soulkit 慢或停机都不会拖住唤醒。
    capabilities: { sync: false, write: false, listable: true },
    async fetch({ key, query } = {}) {
      if (!key) return { text: '' };
      const body = {
        platform: 'qq',
        chat: soulkitChat(String(key)),
        view,
      };
      const q = String(query ?? '').trim().slice(0, MAX_QUERY_CHARS);
      if (q) body.query = q;
      // 不传 limit：内核给的是“字符预算”，soulkit 的 limit 是“条数”，语义不同；
      // 截断由注册表按 memory.inject.maxChars 与 provider maxChars 取小后统一做。

      const response = await ctx.http.requestJson(recallUrl, {
        method: 'POST',
        timeoutMs,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response?.status !== 200) throw new Error(`soulkit recall HTTP ${response?.status ?? '?'}`);
      const payload = response.json;
      const text = recallText(payload).trim();
      // abstained（没有匹配）是正常结果，不是错误：返回空文本，让块整段消失。
      return { text };
    },
  });
}
