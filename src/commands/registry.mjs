// 桥接命令注册表（契约见 docs/COMMAND_REGISTRY.md）。
//
// 这里只做三件事：匹配、权限、元数据。handler 由调用方提供（内置在 bridge.js，
// 插件在自己的 index.mjs），模块本身不 import 桥接的任何东西——否则又会变成一个
// 谁都能改的全局单例。

export const COMMAND_SCOPES = ['all', 'private', 'group'];
export const COMMAND_PERMISSIONS = ['all', 'admin', 'owner'];

const NAME_RE = /^\/[a-z][a-z0-9_-]{0,39}$/i;

function normalizeName(raw) {
  const name = String(raw ?? '').trim();
  if (!NAME_RE.test(name)) throw new Error(`命令名不合法：${JSON.stringify(raw)}（必须 / 开头、字母打头、≤40 字符）`);
  return name.toLowerCase();
}

/**
 * @param {object} options
 * @param {(msg:string)=>void} [options.log]
 */
export function createCommandRegistry({ log = () => {} } = {}) {
  const entries = [];
  const byId = new Map();
  const names = new Map(); // 主名与别名 → entry
  // 控制台的逐条调整（权限 / 启用）按 id 存；注册元数据本身仍然不可变。
  const overrides = new Map();

  function claimName(name, entry) {
    const existing = names.get(name);
    if (existing) {
      if (existing !== entry) log(`[commands] 命令名冲突：${name} 已被 ${existing.id} 占用，忽略 ${entry.id}`);
      return false;
    }
    names.set(name, entry);
    return true;
  }

  /**
   * @param {{
   *   id: string, name: string, aliases?: string[],
   *   scope?: 'all'|'private'|'group', permission?: 'all'|'admin'|'owner',
   *   help?: string, group?: string, source?: 'bridge'|'plugin',
   *   pluginId?: string|null, handler?: ((ctx:object)=>Promise<any>)|null,
   * }} input
   */
  function register(input) {
    const id = String(input?.id ?? '').trim();
    if (!id) throw new Error('命令 id 不能为空');
    if (byId.has(id)) {
      log(`[commands] 命令 id 重复：${id}，忽略后注册的条目`);
      return false;
    }
    const name = normalizeName(input.name);
    const aliases = [...new Set((input.aliases ?? []).map(normalizeName))].filter((alias) => alias !== name);
    const scope = input.scope ?? 'all';
    const permission = input.permission ?? 'admin';
    if (!COMMAND_SCOPES.includes(scope)) throw new Error(`命令 ${id} 的 scope 不合法：${scope}`);
    if (!COMMAND_PERMISSIONS.includes(permission)) throw new Error(`命令 ${id} 的 permission 不合法：${permission}`);
    if (input.handler != null && typeof input.handler !== 'function') throw new Error(`命令 ${id} 的 handler 必须是函数`);

    const entry = Object.freeze({
      id,
      name,
      aliases: Object.freeze(aliases),
      scope,
      permission,
      help: String(input.help ?? '').trim(),
      group: String(input.group ?? '其他').trim() || '其他',
      source: input.source === 'plugin' ? 'plugin' : 'bridge',
      pluginId: input.pluginId ?? null,
      migrated: typeof input.handler === 'function',
      handler: input.handler ?? null,
    });

    const claimed = claimName(name, entry);
    for (const alias of aliases) claimName(alias, entry);
    if (!claimed) return false;

    byId.set(id, entry);
    entries.push(entry);
    return true;
  }

  /** 文本匹配：只看主名/别名，带参数时要求空格分隔；同长度取先注册者。 */
  function match(text) {
    const raw = String(text ?? '').trim();
    let best = null;
    for (const entry of entries) {
      for (const candidate of [entry.name, ...entry.aliases]) {
        if (raw !== candidate && !raw.startsWith(candidate + ' ')) continue;
        if (!best || candidate.length > best.name.length) best = { entry, name: candidate };
      }
    }
    if (!best) return null;
    return { entry: best.entry, name: best.name, arg: raw.slice(best.name.length).trim() };
  }

  function permitted(entry, ctx) {
    const permission = overrides.get(entry.id)?.permission ?? entry.permission;
    if (permission === 'all') return true;
    return Boolean(ctx?.isOwner);
  }

  async function dispatch(text, ctx = {}) {
    const hit = match(text);
    if (!hit) return { handled: false };
    const { entry, name, arg } = hit;
    if (!entry.handler) return { handled: false, matchedId: entry.id, migrated: false };
    if (overrides.get(entry.id)?.enabled === false) return { handled: true, denied: true, matchedId: entry.id, reason: 'disabled' };
    if (entry.scope === 'private' && ctx.kind !== 'private') return { handled: true, denied: true, matchedId: entry.id, reason: 'scope' };
    if (entry.scope === 'group' && ctx.kind !== 'group') return { handled: true, denied: true, matchedId: entry.id, reason: 'scope' };
    if (!permitted(entry, ctx)) return { handled: true, denied: true, matchedId: entry.id, reason: 'permission' };
    try {
      const result = await entry.handler({ ...ctx, text: String(text ?? '').trim(), arg, commandName: name });
      return { handled: true, matchedId: entry.id, result };
    } catch (error) {
      log(`[commands] ${entry.id} 执行失败：${error?.message ?? error}`);
      return { handled: true, matchedId: entry.id, error };
    }
  }

  /** 给控制台/接口用：去掉 handler，避免被序列化成源码；权限与启用状态按覆盖后的有效值返回。 */
  function list() {
    return entries.map(({ handler, ...rest }) => {
      const override = overrides.get(rest.id);
      return {
        ...rest,
        aliases: [...rest.aliases],
        defaultPermission: rest.permission,
        permission: override?.permission ?? rest.permission,
        enabled: override?.enabled !== false,
        overridden: Boolean(override),
      };
    });
  }

  /** 控制台保存单条命令的权限/启用状态；传 null 属性表示恢复默认。 */
  function setOverride(id, patch = {}) {
    const entry = byId.get(String(id ?? ''));
    if (!entry) throw new Error(`没有这条命令：${id}`);
    const current = overrides.get(entry.id) ?? {};
    const next = { ...current };
    if ('permission' in patch) {
      if (patch.permission == null || patch.permission === entry.permission) delete next.permission;
      else if (!COMMAND_PERMISSIONS.includes(patch.permission)) throw new Error(`权限不合法：${patch.permission}`);
      else next.permission = patch.permission;
    }
    if ('enabled' in patch) {
      if (patch.enabled == null || patch.enabled === true) delete next.enabled;
      else next.enabled = false;
    }
    if (Object.keys(next).length) overrides.set(entry.id, next);
    else overrides.delete(entry.id);
    return list().find((item) => item.id === entry.id) ?? null;
  }

  /** 启动时把 config.json 里存的覆盖值套上；未知 id 只记日志。 */
  function loadOverrides(map = {}) {
    for (const [id, patch] of Object.entries(map ?? {})) {
      try {
        setOverride(id, patch);
      } catch (error) {
        log(`[commands] 忽略无效覆盖 ${id}：${error?.message ?? error}`);
      }
    }
  }

  function overrideSnapshot() {
    return Object.fromEntries([...overrides.entries()].map(([id, patch]) => [id, { ...patch }]));
  }

  function get(id) {
    return byId.get(String(id ?? '')) ?? null;
  }

  function unregister(id) {
    const entry = byId.get(String(id ?? ''));
    if (!entry) return false;
    byId.delete(entry.id);
    const index = entries.indexOf(entry);
    if (index >= 0) entries.splice(index, 1);
    for (const candidate of [entry.name, ...entry.aliases]) {
      if (names.get(candidate) === entry) names.delete(candidate);
    }
    return true;
  }

  function unregisterPlugin(pluginId) {
    return entries.filter((entry) => entry.pluginId === pluginId).map((entry) => entry.id).filter(unregister).length;
  }

  return { register, dispatch, match, list, get, unregister, unregisterPlugin, setOverride, loadOverrides, overrideSnapshot, get size() { return entries.length; } };
}
