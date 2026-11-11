// 两端适配器：用户端平台（QQ / 将来的 B 站…）与 Agent 端运行时（DSH / 将来的其它）。
//
// 适配器是**描述**，不是实现：它告诉控制台「这一端能做什么、提示词里怎么称呼自己」，
// 具体收发消息仍由桥接的既有代码路径完成。这样换平台时，行为档案、能力预设与
// 运行方案都不用改，只换一份适配器描述（或装一个提供适配器的插件）。
const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

export const ADAPTER_KINDS = Object.freeze(['platform', 'agent']);

const str = (value, max) => String(value ?? '').trim().slice(0, max);

/** 允许出现在提示词变量里的键（与 prompt-compose 的占位符一致）。 */
export const PROMPT_VAR_KEYS = Object.freeze(['platform', 'displayName', 'owner']);

export function normalizeAdapter(kind, raw, owner = 'core') {
  if (!ADAPTER_KINDS.includes(kind)) throw new Error(`未知适配器类型：${kind}`);
  const id = str(raw?.id, 64);
  if (!ID_RE.test(id)) throw new Error(`适配器 id 不合法：${id || '(空)'}`);
  const capabilities = Array.isArray(raw?.capabilities)
    ? [...new Set(raw.capabilities.map((item) => str(item, 40)).filter(Boolean))]
    : [];
  const vars = {};
  for (const key of PROMPT_VAR_KEYS) {
    const value = str(raw?.vars?.[key], 200);
    if (value) vars[key] = value;
  }
  return {
    id,
    kind,
    owner: str(owner, 64) || 'core',
    label: str(raw?.label, 80) || id,
    note: str(raw?.note, 200),
    capabilities,
    vars,
  };
}

export function createAdapterRegistry({ log = () => {} } = {}) {
  /** @type {Map<string, Map<string, object>>} kind → id → adapter */
  const tables = new Map(ADAPTER_KINDS.map((kind) => [kind, new Map()]));

  function register(kind, raw, owner = 'core') {
    const adapter = normalizeAdapter(kind, raw, owner);
    const table = tables.get(kind);
    const demo = table.get(adapter.id);
    if (demo && demo.owner !== adapter.owner) {
      throw new Error(`适配器 id 已被占用：${kind}/${adapter.id}`);
    }
    table.set(adapter.id, adapter);
    log(`[adapters] 注册 ${kind}/${adapter.id}（${adapter.owner}）`);
    return adapter;
  }

  function unregisterPlugin(owner) {
    for (const table of tables.values()) {
      for (const [id, adapter] of table.entries()) {
        if (adapter.owner === owner) table.delete(id);
      }
    }
  }

  function get(kind, id) {
    return tables.get(kind)?.get(str(id, 64)) ?? null;
  }

  function list(kind) {
    const table = tables.get(kind);
    return table ? [...table.values()] : [];
  }

  /** 供接口与页面用：两端各一份列表。 */
  function snapshot() {
    return {
      kinds: [...ADAPTER_KINDS],
      platform: list('platform'),
      agent: list('agent'),
    };
  }

  /** 平台侧提示词变量（首个平台适配器；找不到给空对象）。 */
  function platformVars() {
    return { ...(list('platform')[0]?.vars ?? {}) };
  }

  return { register, unregisterPlugin, get, list, snapshot, platformVars };
}

/** 内置两份适配器：QQ（SnowLuma）与 DSH。 */
export function builtinAdapters() {
  return [
    {
      kind: 'platform',
      id: 'qq',
      label: 'QQ（SnowLuma）',
      note: '群聊、私聊、引用回复、表情、语音与拍一拍。',
      capabilities: ['send', 'members', 'history', 'pokes', 'stickers', 'voice', 'files'],
      vars: { platform: 'QQ', displayName: 'QQ', owner: '管理员' },
    },
    {
      kind: 'agent',
      id: 'dsh',
      label: 'DeepSeek Harness',
      note: 'DSH 预设、权限预设、工具面与会话。',
      capabilities: ['presets', 'permissions', 'tools', 'skills', 'sessions', 'commands'],
      vars: {},
    },
  ];
}
