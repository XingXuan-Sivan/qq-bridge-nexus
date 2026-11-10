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
export const BUILTIN_PLANS = [
  {
    id: 'chat',
    label: '聊天模式',
    note: '白名单内，随时对话。',
    tools: 'qq-chat',
    behavior: 'none',
    audience: 'access',
    builtin: true,
  },
  {
    id: 'social-v1',
    label: '一代仿真',
    note: '按策略自然参与群聊（v1 行为）。',
    tools: 'qq-chat',
    behavior: 'social-v1',
    audience: 'access',
    builtin: true,
  },
  {
    id: 'social-v2',
    label: '二代仿真',
    note: '自主阅读、发言与潜水（v2 行为）。',
    tools: 'qq-chat-v2',
    behavior: 'social-v2',
    audience: 'access',
    builtin: true,
  },
  {
    id: 'agent-readonly',
    label: 'Agent · 只读',
    note: '仅管理员私聊；只能读，不能改。',
    tools: 'qq-agent-readonly',
    behavior: 'none',
    audience: 'owner',
    builtin: true,
  },
  {
    id: 'agent-workspace',
    label: 'Agent · 工作区',
    note: '仅管理员私聊；可读写工作区。',
    tools: 'qq-agent-workspace',
    behavior: 'none',
    audience: 'owner',
    builtin: true,
  },
  {
    id: 'agent-full',
    label: 'Agent · 高权限',
    note: '仅管理员私聊；完全访问，每次切换需要确认码与 TOTP。',
    tools: 'qq-agent-full',
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
  const tools = normalizeString(raw.tools, 80);
  if (!tools) return null;
  const behaviorRaw = normalizeString(raw.behavior, 80) || 'none';
  const behavior = PLAN_BEHAVIORS.includes(behaviorRaw) || PLAN_ID_RE.test(behaviorRaw) ? behaviorRaw : 'none';
  const audience = PLAN_AUDIENCES.includes(raw.audience) ? raw.audience : 'access';
  return {
    id,
    label: normalizeString(raw.label, 40) || id,
    note: normalizeString(raw.note, 200),
    tools,
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
      tools: builtin.tools, // 内置方案的「用哪套能力」不允许在控制台改，改就克隆
      behavior: builtin.behavior,
      audience: builtin.audience,
    });
    byId.delete(builtin.id);
  }
  for (const plan of byId.values()) merged.push({ ...plan, builtin: false });
  return merged;
}

/** 方案对应的旧模式（供 `effectiveMode` 与旧调用点投影；不是新的配置项）。 */
export function legacyModeOfPlan(plan) {
  if (!plan) return 'chat';
  if (String(plan.tools || '').startsWith('qq-agent-')) return 'closed-agent';
  if (plan.behavior === 'social-v2') return 'reserved2';
  if (plan.behavior === 'social-v1') return 'reserved';
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
