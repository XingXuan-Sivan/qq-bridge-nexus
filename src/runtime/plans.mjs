/**
 * 运行方案（runtime plan）：把「用哪套能力、用哪套行为、给谁用」打包成一个命名方案。
 *
 * 设计见 docs/UNIFY_PLAN.md §3、docs/RUNTIME_PROFILE_MODEL.md §3。
 * 这里只做纯函数：定义、归一、与旧「模式 + 级别」的互推。真正的切换与确认仍在
 * src/admin/mode-control.js（唯一闸门），本模块不碰状态文件、不碰网络。
 */

export const RUNTIME_PLATFORM = 'qq';
export const PLAN_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
export const PLAN_BEHAVIORS = ['none', 'inherit'];
export const PLAN_AUDIENCES = ['owner', 'access'];

/** 内置方案：数据而不是枚举，控制台里只读，可克隆成自定义方案。 */
/** 旧预设 id → 新能力 id（P10 迁移用）。控制台不再让用户看到 qq-*。 */
export const LEGACY_PRESET_TO_CAPABILITY = Object.freeze({
  'qq-chat': 'agent-chat',
  'qq-chat-v2': 'agent-chat',
  'qq-agent-readonly': 'agent-readonly',
  'qq-agent-workspace': 'agent-workspace',
  'qq-agent-full': 'agent-full',
});

/** 兼容旧配置：只给了预设 id 的方案，按对照表补出能力 id。 */
export function capabilityForTools(tools) {
  const id = normalizeString(tools, 80);
  if (!id) return '';
  return LEGACY_PRESET_TO_CAPABILITY[id] ?? (id.startsWith('agent-') ? id : '');
}

export const BUILTIN_PLANS = [
  {
    id: 'chat',
    label: '聊天模式',
    note: '白名单内，随时对话。',
    tools: 'qq-chat',
    capability: 'agent-chat',
    behavior: 'none',
    audience: 'access',
    builtin: true,
  },
  {
    id: 'social-v1',
    label: '一代仿真',
    note: '按策略自然参与群聊（v1 行为）。',
    tools: 'qq-chat',
    capability: 'agent-chat',
    behavior: 'social-v1',
    audience: 'access',
    builtin: true,
  },
  {
    id: 'social-v2',
    label: '二代仿真',
    note: '自主阅读、发言与潜水（v2 行为）。',
    tools: 'qq-chat-v2',
    capability: 'agent-chat',
    behavior: 'social-v2',
    audience: 'access',
    builtin: true,
  },
  {
    id: 'agent-readonly',
    label: 'Agent · 只读',
    note: '仅管理员私聊；只能读，不能改。',
    tools: 'qq-agent-readonly',
    capability: 'agent-readonly',
    behavior: 'none',
    audience: 'owner',
    builtin: true,
  },
  {
    id: 'agent-workspace',
    label: 'Agent · 工作区',
    note: '仅管理员私聊；可读写工作区。',
    tools: 'qq-agent-workspace',
    capability: 'agent-workspace',
    behavior: 'none',
    audience: 'owner',
    builtin: true,
  },
  {
    id: 'agent-full',
    label: 'Agent · 高权限',
    note: '仅管理员私聊；完全访问，每次切换需要确认码与 TOTP。',
    tools: 'qq-agent-full',
    capability: 'agent-full',
    behavior: 'none',
    audience: 'owner',
    builtin: true,
  },
];

/** 旧「级别」只用来推 DSH 预设与展示，不再作为独立配置项。 */
const LEVEL_BY_TOOLS = {
  'qq-agent-readonly': 'L1',
  'qq-agent-workspace': 'L2',
  'qq-agent-full': 'L3',
};

function normalizeString(value, max = 120) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

/**
 * 归一一套方案。`builtin: true` 的方案保留内置字段，只允许改 note/label（控制台另有限制）。
 * @returns {{id:string,label:string,note:string,tools:string,behavior:string,audience:string,builtin:boolean}|null}
 */
export function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = normalizeString(raw.id, 40);
  if (!PLAN_ID_RE.test(id)) return null;
  const capability = normalizeString(raw.capability, 40) || capabilityForTools(raw.tools);
  // P10.4 起以 capability 为准；tools 只作 P10.5 之前的安装目标，两者至少有一个。
  const tools = normalizeString(raw.tools, 80) || capability;
  if (!tools && !capability) return null;
  const behaviorRaw = normalizeString(raw.behavior, 80) || 'none';
  const behavior = PLAN_BEHAVIORS.includes(behaviorRaw) || PLAN_ID_RE.test(behaviorRaw) ? behaviorRaw : 'none';
  const audience = PLAN_AUDIENCES.includes(raw.audience) ? raw.audience : 'access';
  return {
    id,
    label: normalizeString(raw.label, 40) || id,
    note: normalizeString(raw.note, 200),
    tools,
    capability,
    behavior,
    audience,
    builtin: raw.builtin === true,
  };
}

/**
 * 合并内置方案与配置里的方案定义：同 id 以配置为准（可覆盖 label/note/行为），
 * 配置里多出来的就是自定义方案。返回按「内置顺序 + 自定义顺序」排好的数组。
 */
export function normalizePlans(raw) {
  const custom = Array.isArray(raw) ? raw.map(normalizePlan).filter(Boolean) : [];
  const byId = new Map(custom.map((plan) => [plan.id, plan]));
  const merged = [];
  for (const builtin of BUILTIN_PLANS) {
    const override = byId.get(builtin.id);
    merged.push({
      ...builtin,
      label: override?.label || builtin.label,
      note: override?.note || builtin.note,
      tools: builtin.tools, // 安装目标（P10.5 起与 capability 同名）
      capability: builtin.capability, // 内置方案的能力不允许在控制台改，改就克隆
      behavior: builtin.behavior,
      audience: builtin.audience,
    });
    byId.delete(builtin.id);
  }
  for (const plan of byId.values()) merged.push({ ...plan, builtin: false });
  return merged;
}

/**
 * 方案对应的旧模式（供 `effectiveMode` 与旧调用点投影；不是新的配置项）。
 *
 * P6 起**行为优先**：有社会行为 kind 的方案跑仿真引擎，工具只决定能力。
 * 这样「Agent 工具 + 仿真行为 + 任意受众」可以组合出来（例如带人格的 Agent 进群聊），
 * 不再被「工具是 qq-agent-* 就只能闭门当 Agent」写死。
 */
export function legacyModeOfPlan(plan) {
  if (!plan) return 'chat';
  if (plan.behavior === 'social-v2') return 'reserved2';
  if (plan.behavior === 'social-v1') return 'reserved';
  if (String(plan.tools || '').startsWith('qq-agent-')) return 'closed-agent';
  return 'chat';
}

/** 方案对应的旧级别（仅 agent 方案有；其余 L0）。 */
export function legacyLevelOfPlan(plan) {
  const level = LEVEL_BY_TOOLS[plan?.tools];
  return level ?? 'L0';
}

/** 旧「模式 + 级别」→ 最接近的方案 id（迁移与会话覆盖用，不参与运行时判断）。 */
export function planIdForLegacy(mode, level = 'L0') {
  if (mode === 'closed-agent') {
    return { L1: 'agent-readonly', L2: 'agent-workspace', L3: 'agent-full' }[level] ?? 'agent-readonly';
  }
  if (mode === 'reserved2') return 'social-v2';
  if (mode === 'reserved') return 'social-v1';
  return 'chat';
}

export function findPlan(plans, planId) {
  return (plans || []).find((plan) => plan.id === planId) ?? null;
}

/** 只保留要写进配置的字段：builtin 是投影出来的，不落盘。 */
export function planToConfig(plan) {
  const normalized = normalizePlan(plan);
  if (!normalized) return null;
  const { builtin, ...rest } = normalized;
  return rest;
}

/**
 * 在自定义方案列表里新增或更新一条。内置方案的 id 不允许占用（要改就克隆）。
 * @returns {{plans:object[], plan:object}} 新的自定义方案数组（不含内置）
 */
export function upsertCustomPlan(current, input) {
  const plan = planToConfig(input);
  if (!plan) throw new Error('方案 id 或能力预设不合法');
  if (BUILTIN_PLANS.some((builtin) => builtin.id === plan.id)) {
    throw new Error('内置方案是只读的，请先克隆一份再改');
  }
  const list = (Array.isArray(current) ? current : []).map(planToConfig).filter(Boolean);
  const index = list.findIndex((item) => item.id === plan.id);
  if (index >= 0) list[index] = plan;
  else list.push(plan);
  return { plans: list, plan };
}

/** 删除一条自定义方案；内置不可删。 */
export function removeCustomPlan(current, planId) {
  if (BUILTIN_PLANS.some((builtin) => builtin.id === planId)) {
    throw new Error('内置方案不能删除');
  }
  const list = (Array.isArray(current) ? current : []).map(planToConfig).filter(Boolean);
  const next = list.filter((item) => item.id !== planId);
  if (next.length === list.length) throw new Error('没有这个方案');
  return next;
}

