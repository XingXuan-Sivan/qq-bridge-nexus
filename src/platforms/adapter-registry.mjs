// 插件提供的两端适配器（`adapters:provide`）注册表。
//
// 名字里的「适配器」是**描述**，不是实现：它告诉控制台与提示词「这一端能做什么、
// 提示词里怎么称呼自己」，具体收发消息仍由平台实现与内核的既有路径完成。
//
// 内置平台的描述已经不在代码里：`profiles/platforms/<id>/platform.yml` 的
// `vars` / `configSchema` 与 `profiles/agent-platforms/<id>/agent-platform.yml` 的
// `configSchema` 是唯一源（C2b）。本文件只剩一条通道 —— 插件注册一份描述，内核按
// id 查得到就行。于是「新增一个内置平台」不再需要改 src/。
//
// 与旧 src/runtime/adapters.mjs 的差别：那边还有 `builtinAdapters()`（硬编码 QQ/DSH
// 清单）与 `platformVars()`（取「第一个」平台适配器）。前者已删除，后者换成调用方
// 按 id 取 —— 「第一个」这个语义在多平台并存时是错的，只是过去只有一个内置平台才
// 没暴露。
import { normalizePromptVars } from '../runtime/prompt-compose.mjs';

const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

export const ADAPTER_KINDS = Object.freeze(['platform', 'agent']);

const str = (value, max) => String(value ?? '').trim().slice(0, max);

export function normalizeAdapter(kind, raw, owner = 'core') {
  if (!ADAPTER_KINDS.includes(kind)) throw new Error(`未知适配器类型：${kind}`);
  const id = str(raw?.id, 64);
  if (!ID_RE.test(id)) throw new Error(`适配器 id 不合法：${id || '(空)'}`);
  const capabilities = Array.isArray(raw?.capabilities)
    ? [...new Set(raw.capabilities.map((item) => str(item, 40)).filter(Boolean))]
    : [];
  return {
    id,
    kind,
    owner: str(owner, 64) || 'core',
    label: str(raw?.label, 80) || id,
    note: str(raw?.note, 200),
    capabilities,
    vars: normalizePromptVars(raw?.vars),
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

  // 注：曾经有过 snapshot()（给 /api/runtime 与 /api/runtime/adapters 各列一份）与
  // platformVars()（取首个平台适配器的 vars）。前者在 C1 随旧端点一起删除，后者在
  // C2b 随 vars 搬进 platform.yml 一起删除：两端的清单统一由 /api/platforms/registry
  // 给出，提示词变量按平台 id 现取。
  return { register, unregisterPlugin, get, list };
}
