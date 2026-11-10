// soulkit 人格 provider（docs/PERSONA_PROVIDER.md）。
//
// 两件事：
//   1) 注入：把 soulkit 的 `GET /api/persona/card` 翻译成 persona-provider/1 的三态返回。
//      缓存 TTL、单飞、旧卡降级、失败节流全部在内核的注册表里。
//   2) 目录：把 soulkit 的 `GET/POST /api/souls*` 映射成控制台可用的「人格卡」增删改查。
//      soul 的正文是 prompt.md；soulkit 不提供删除与改名，这里也不假装提供。
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

function soulView(soul) {
  const id = String(soul?.id ?? '').trim();
  if (!id) return null;
  return {
    id,
    name: String(soul?.name ?? id).trim() || id,
    description: String(soul?.description ?? ''),
    chars: Number.isFinite(soul?.chars) ? soul.chars : String(soul?.text ?? '').length,
    updatedAt: Number.isFinite(soul?.updatedAt) ? soul.updatedAt : null,
  };
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

  async function readSoul(id) {
    const data = await call(`/api/soul?id=${encodeURIComponent(String(id))}`);
    const soul = data.soul ?? {};
    return {
      id: String(soul.id ?? id),
      name: String(soul.name ?? id),
      description: String(soul.description ?? ''),
      text: String(soul.text ?? ''),
      chars: Number.isFinite(soul.chars) ? soul.chars : String(soul.text ?? '').length,
      updatedAt: Number.isFinite(soul.updatedAt) ? soul.updatedAt : null,
    };
  }

  ctx.persona.register({
    id: 'soulkit',
    contract: 'persona-provider/1',
    capabilities: {
      perSession: true,
      conditional: true,
      listable: true,
      catalog: true,
      create: true,
      update: true,
      rename: false,
      remove: false,
    },
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

    // ── 目录扩展：人格卡列表与正文读写（不参与会话注入的缓存） ──
    async list() {
      const data = await call('/api/souls');
      return (Array.isArray(data.souls) ? data.souls : []).map(soulView).filter(Boolean);
    },
    async read(id) {
      return readSoul(id);
    },
    async update(id, { text } = {}) {
      const data = await call('/api/souls/prompt', { method: 'POST', body: { id: String(id), text: String(text ?? '') } });
      const soul = data.soul ?? {};
      return {
        id: String(soul.id ?? id),
        name: String(soul.name ?? id),
        text: String(soul.text ?? ''),
        chars: Number.isFinite(soul.chars) ? soul.chars : String(soul.text ?? '').length,
        updatedAt: Number.isFinite(soul.updatedAt) ? soul.updatedAt : null,
      };
    },
    async create({ id, name, text = '', description = '' } = {}) {
      const data = await call('/api/souls/create', {
        method: 'POST',
        body: { id: String(id ?? ''), name: String(name ?? ''), text: String(text), description: String(description) },
      });
      const soul = data.soul ?? {};
      return {
        id: String(soul.id ?? id),
        name: String(soul.name ?? name),
        description: String(soul.description ?? description),
        chars: Number.isFinite(soul.chars) ? soul.chars : 0,
        updatedAt: Number.isFinite(soul.updatedAt) ? soul.updatedAt : null,
      };
    },
    // 兼容旧调用：按 id 取正文，供「另存为内部人格」使用。
    async card(id) {
      const soul = await readSoul(id);
      return { name: soul.name, text: soul.text };
    },
  });

  // 没有钩子：刷新由内核实现在唤醒时机调用（kernel.personaWarm）。
  return {};
}
