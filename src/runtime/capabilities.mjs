// 能力预设在桥接侧的附加信息：沙箱（给人看，DSH 那边由权限预设兜底）与工具授予（grants）。
// 权威仍是不 DSH 的 preset（`dsh/agent-presets/<id>/`）；这里只存「桥接口径」的差异，免得改坏 preset.yml。
const s = (value, max) => String(value ?? '').trim().slice(0, max);
const normalizeString = (value, max) => s(value, max);

/** 可以在方案层收紧的工具：只列真正有副作用的写操作，读状态类不在这里。 */
export const GATEABLE_TOOLS = [
  { flag: 'sendMessage', label: '发送消息' },
  { flag: 'sendBurst', label: '分多条发送' },
  { flag: 'sendPoke', label: '拍一拍' },
  { flag: 'sendSticker', label: '发表情' },
  { flag: 'sendVoice', label: '发语音' },
  { flag: 'collectSticker', label: '收藏表情' },
  { flag: 'schedule', label: '定时任务' },
  { flag: 'markRead', label: '标记已读' },
  { flag: 'setWakeConfig', label: '调唤醒配置' },
];

const SANDBOX_IDS = ['read-only', 'workspace-write', 'danger-full-access'];

export function normalizeGrants(raw) {
  const disable = Array.isArray(raw?.disable)
    ? [...new Set(raw.disable.map((item) => normalizeString(item, 40)).filter((item) => GATEABLE_TOOLS.some((tool) => tool.flag === item)))]
    : [];
  return { disable };
}

export function normalizeCapability(raw, id = '') {
  const capabilityId = normalizeString(raw?.id ?? id, 64);
  if (!capabilityId) return null;
  const sandbox = SANDBOX_IDS.includes(raw?.sandbox) ? raw.sandbox : 'workspace-write';
  return {
    id: capabilityId,
    sandbox,
    grants: normalizeGrants(raw?.grants),
    note: normalizeString(raw?.note, 200),
  };
}

/**
 * 能力附加信息的注册表：list 时把 DSH 目录里的预设（catalog）与本文件的补丁合并。
 * `catalog` 由调用方给（`/api/presets` 已经把目录读好了，避免这里再读一次磁盘）。
 */
export function createCapabilityRegistry({ catalog = [], config = {}, onChange = null } = {}) {
  let store = { ...config };
  const catalogById = new Map((Array.isArray(catalog) ? catalog : []).map((item) => [item.id, item]));

  function list() {
    return [...catalogById.values()].map((item) => {
      const patch = normalizeCapability(store[item.id] ?? {}, item.id) ?? { id: item.id, sandbox: 'workspace-write', grants: { disable: [] }, note: '' };
      return { ...patch, label: item.label ?? item.id, builtin: item.builtin === true };
    });
  }

  function get(id) {
    return list().find((item) => item.id === id) ?? null;
  }

  function save(id, patch) {
    if (!catalogById.has(id)) throw new Error('没有这个能力预设');
    const next = normalizeCapability({ ...(store[id] ?? {}), ...patch, id }, id);
    store = { ...store, [id]: next };
    onChange?.(store);
    return next;
  }

  function grantsOf(id, flag) {
    const entry = get(id);
    return !(entry?.grants?.disable ?? []).includes(flag);
  }

  return { list, get, save, grantsOf };
}
