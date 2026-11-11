// 能力预设的桥接侧补丁：工具可见集与平台提示词补充。
//
// 权威源仍是 DSH 的预设目录（dsh/agent-presets/<id>/），这里只存「桥接这一侧」
// 需要知道的东西：
//   · tools.visible —— 这套能力允许会话调用哪些平台工具（null = 全部）；
//   · prompt.personaPrefix —— 拼给 Agent 的平台补充（占位符渲染在 P9.2 接上）。
// 沙箱与审批归 DSH 的权限预设，不在这里重复一份（config.capabilities 里不再有
// sandbox 字段；P7 旧数据的 grants.disable 会被迁移成 tools.visible）。
import {
  AGENT_MODULES,
  PLATFORM_TOOLS,
  capabilityCovers,
  platformToolFlags,
} from '../tools/catalog.mjs';

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PERMISSIONS = ['read-only', 'workspace-write', 'full-ask', 'full'];

const str = (value, max) => String(value ?? '').trim().slice(0, max);

/** 能力可见集：null/缺省 = 全部；数组 = 只允许这些。未知 flag 丢弃。 */
export function normalizeVisible(raw) {
  if (raw === null || raw === undefined || raw === 'all' || raw === '*') return null;
  const list = Array.isArray(raw) ? raw : [raw];
  const known = platformToolFlags();
  const seen = new Set();
  for (const item of list) {
    const flag = str(item, 64);
    if (flag && known.includes(flag)) seen.add(flag);
  }
  return [...seen];
}

/** 可见集 → 是否允许某个 flag（null 视为全开）。 */
export function visibleAllows(visible, flag) {
  if (visible === null || visible === undefined) return true;
  return visible.includes(flag);
}

/** 把 P7 时代的 grants.disable 迁移成 tools.visible。 */
function migrateGrants(raw) {
  const disabled = Array.isArray(raw?.grants?.disable) ? raw.grants.disable : [];
  if (!disabled.length) return null;
  const blocked = new Set(disabled.map((item) => str(item, 64)).filter(Boolean));
  return normalizeVisible(platformToolFlags().filter((flag) => !blocked.has(flag)));
}

export function normalizeCapability(raw, id = '') {
  const key = str(raw?.id ?? id, 64);
  if (!key || !ID_RE.test(key)) return null;
  const visibleSource = raw?.tools?.visible !== undefined ? raw.tools.visible : migrateGrants(raw);
  return {
    id: key,
    agent: 'dsh',
    tools: { visible: normalizeVisible(visibleSource) },
    prompt: { personaPrefix: str(raw?.prompt?.personaPrefix, 20000) },
    suggestedPermission: PERMISSIONS.includes(raw?.suggestedPermission) ? raw.suggestedPermission : '',
    note: str(raw?.note, 200),
  };
}

/**
 * 注册表：把 DSH 目录里的预设与桥接侧补丁合并成一份可读视图。
 * onChange 收到的是「可直接写回 config.json 的补丁表」。
 */
export function createCapabilityRegistry({ catalog = [], config = {}, onChange = null } = {}) {
  const patches = new Map();
  for (const [id, raw] of Object.entries(config ?? {})) {
    const normalized = normalizeCapability(raw, id);
    if (normalized) patches.set(id, normalized);
  }

  function entryOf(id) {
    return (catalog ?? []).find((item) => item.id === id) ?? { id, label: id, builtin: false };
  }

  function merge(id) {
    const patch = patches.get(id);
    const entry = entryOf(id);
    return {
      id,
      label: entry.label || id,
      builtin: entry.builtin === true,
      agent: 'dsh',
      tools: { visible: patch ? patch.tools.visible : null },
      prompt: { personaPrefix: patch ? patch.prompt.personaPrefix : '' },
      suggestedPermission: patch ? patch.suggestedPermission : '',
      note: patch ? patch.note : '',
    };
  }

  function toConfig() {
    return Object.fromEntries([...patches.entries()].map(([id, value]) => {
      const { id: _id, ...rest } = value;
      return [id, rest];
    }));
  }

  function list() {
    const ids = new Set([...(catalog ?? []).map((item) => item.id), ...patches.keys()]);
    return [...ids].map(merge);
  }

  function get(id) {
    const key = str(id, 64);
    if (!key) return null;
    const inCatalog = (catalog ?? []).some((item) => item.id === key);
    if (!inCatalog && !patches.has(key)) return null;
    return merge(key);
  }

  function save(id, patch = {}) {
    const current = get(id);
    if (!current) throw new Error('没有这个能力预设');
    const nextRaw = {
      id,
      agent: 'dsh',
      tools: { visible: patch?.tools?.visible !== undefined ? patch.tools.visible : current.tools.visible },
      prompt: { personaPrefix: patch?.prompt?.personaPrefix !== undefined ? patch.prompt.personaPrefix : current.prompt.personaPrefix },
      suggestedPermission: patch?.suggestedPermission !== undefined ? patch.suggestedPermission : current.suggestedPermission,
      note: patch?.note !== undefined ? patch.note : current.note,
    };
    const normalized = normalizeCapability(nextRaw, id);
    if (!normalized) throw new Error('能力预设格式不合法');
    patches.set(id, normalized);
    onChange?.(toConfig());
    return merge(id);
  }

  /** 这套能力是否允许某个平台工具（读类不受能力限制）。 */
  function allows(presetId, flag) {
    const capability = get(presetId);
    if (!capability) return true;
    if (!capabilityCovers(flag)) return true;
    return visibleAllows(capability.tools.visible, flag);
  }

  return { list, get, save, toConfig, allows };
}

export { AGENT_MODULES, PLATFORM_TOOLS };
