// soulkit 人格 provider（docs/PERSONA_PROVIDER.md）。
//
// 只做一件事：把 soulkit 的 `GET /api/persona/card` 翻译成 persona-provider/1 的三态返回。
// 缓存 TTL、单飞、旧卡降级、失败节流全部在内核的注册表里——这里再写一套就会有两份 TTL、
// 两份告警、行为不一致。
const DEFAULT_BASE_URL = 'http://127.0.0.1:3110';
const DEFAULT_TIMEOUT_MS = 1200;
// soulkit 的卡片正文以「【人格卡：星苒｜257399a91c】」开头；桥接自己会注入【当前角色】，
// 这一行留着就是重复，剥掉。
const CARD_HEADER_RE = /^【人格卡：[^】]*】[ \t]*\r?\n?/;

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

// soulkit 的绑定按 `<group|private>:<id>` 存（它只服务 QQ，平台由 `platform` 参数表达），
// 而桥接的会话 key 是 `<platform>:<kind>:<id>`。这里只做一次形态转换：
// 认得出新形态就剥掉平台前缀，认不出（旧形态或别处传进来的自定义 key）就原样透传。
const PLATFORM_KEY_RE = /^[a-z][a-z0-9-]{0,15}:(group|private):(\d+)$/;

function soulkitKey(key) {
  const raw = String(key ?? '');
  const m = PLATFORM_KEY_RE.exec(raw);
  return m ? `${m[1]}:${m[2]}` : raw;
}

function cardUrl(baseUrl, key) {
  const url = new URL(`${baseUrl}/api/persona/card`);
  url.searchParams.set('platform', 'qq');
  url.searchParams.set('key', soulkitKey(key));
  return url.href;
}

export async function activate(ctx) {
  const baseUrl = normalizeBaseUrl(ctx.config.baseUrl);
  const timeoutMs = clampTimeout(ctx.config.timeoutMs);
  const world = typeof ctx.config.world === 'string' && ctx.config.world.trim() ? ctx.config.world.trim() : 'main';

  async function call(path, { method = 'GET', body } = {}) {
    const url = new URL(`${baseUrl}${path}`);
    if (method === 'GET') {
      if (!url.searchParams.has('world')) url.searchParams.set('world', world);
    }
    const response = await ctx.http.requestJson(url.href, {
      timeoutMs,
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify({ ...body, world: body.world ?? world }),
    });
    return response.json ?? {};
  }

  ctx.persona.register({
    id: 'soulkit',
    contract: 'persona-provider/1',
    capabilities: { perSession: true, conditional: true, listable: true },
    async get(key, options = {}) {
      if (!key) return { status: 'none', reason: 'no-key' };
      const etag = typeof options.etag === 'string' && options.etag ? options.etag : null;
      const response = await ctx.http.requestJson(cardUrl(baseUrl, String(key)), {
        timeoutMs,
        headers: etag ? { 'if-none-match': etag } : undefined,
      });
      if (response.status === 304) {
        return { status: 'not-modified', etag: response.etag ?? etag };
      }

      const data = response.json ?? {};
      if (data.mode === 'none') {
        return { status: 'none', reason: typeof data.reason === 'string' ? data.reason : 'unbound' };
      }
      if (data.mode !== 'card') throw new Error(`soulkit 返回未知 mode: ${String(data.mode)}`);

      const name = String(data.name ?? '').trim();
      const text = String(data.text ?? '').replace(CARD_HEADER_RE, '').trim();
      if (!name) throw new Error('soulkit 返回的人格卡缺少 name');
      if (!text) throw new Error('soulkit 返回的人格卡缺少正文');

      // 指纹由内核注册表按最终正文计算：soulkit 的 sha 覆盖的是它的拼装输入，
      // 不是桥接这里剥掉标题行之后的正文，直接透传会出现「内容变了指纹没变」。
      return { status: 'card', card: { name, text }, etag: response.etag ?? null };
    },

    // ── 可选扩展：供控制台列出 / 编辑灵魂侧的角色卡（不参与会话注入的缓存） ──
    async list() {
      const data = await call('/api/characters');
      return Array.isArray(data.characters) ? data.characters : [];
    },
    async getByName(name) {
      const data = await call(`/api/character?slug=${encodeURIComponent(String(name))}`);
      return data.character ?? null;
    },
    async save(patch) {
      const data = await call('/api/characters/save', { method: 'POST', body: patch });
      return data.character ?? null;
    },
    async create({ name, from = '' } = {}) {
      const data = await call('/api/characters/create', { method: 'POST', body: { name, from } });
      return data.character ?? null;
    },
    async rename({ name, nextName } = {}) {
      const data = await call('/api/characters/rename', { method: 'POST', body: { slug: name, name: nextName } });
      return data.character ?? null;
    },
    async card(name) {
      const data = await call('/api/characters/card', { method: 'POST', body: { slug: String(name) } });
      return data.card ?? null;
    },
  });

  // 没有钩子：刷新由内核实现在唤醒时机调用（kernel.personaWarm）。
  return {};
}
