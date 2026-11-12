// 运行方案：组合「用户侧平台的行为档案」与「Agent 侧平台的能力预设」。
//
// 权威源：profiles/plans/<id>.yml。内置方案带 builtin: true，控制台只读、可克隆；
// 自定义方案同目录，删改都落文件。桥接只依赖 createPlanStore().list()/get()/save()/remove()。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { PLANS_ROOT } from '../profiles/paths.mjs';

export const RUNTIME_PLATFORM = 'qq';
export const PLAN_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
export const PLAN_AUDIENCES = ['owner', 'access'];
export const BUILTIN_PLAN_ORDER = ['chat', 'social-v1', 'social-v2', 'agent-readonly', 'agent-workspace', 'agent-full'];

const PLAN_FILE_HEADER = '# 运行方案：组合 platform（用户侧平台）+ agentPlatform（Agent 侧平台）\n'
  + '# 的 behavior / capability / agent。builtin: true 为只读方案，可克隆，不可改删。';

function text(value, max = 120) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function plain(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value;
}

/** 归一并校验一份方案；字段缺失或引用非法直接报错（不做静默兜底）。 */
export function normalizePlan(raw, { source = 'plan' } = {}) {
  const value = plain(raw, source);
  const id = text(value.id, 40);
  if (!PLAN_ID_RE.test(id)) throw new Error(`${source}.id 不合法：${id || '(空)'}`);
  const platform = text(value.platform, 40) || RUNTIME_PLATFORM;
  const agentPlatform = text(value.agentPlatform, 40) || 'dsh';
  const agent = text(value.agent, 80);
  if (!agent) throw new Error(`${source}.agent 不能为空`);
  const capability = text(value.capability, 40);
  if (!capability) throw new Error(`${source}.capability 不能为空`);
  const behavior = text(value.behavior, 80) || 'none';
  const audience = PLAN_AUDIENCES.includes(value.audience) ? value.audience : 'access';
  return {
    id,
    label: text(value.label, 40) || id,
    note: text(value.note, 200),
    version: Number.isInteger(Number(value.version)) ? Number(value.version) : 1,
    builtin: value.builtin === true,
    platform,
    agentPlatform,
    agent,
    behavior,
    capability,
    audience,
  };
}

function planText(plan) {
  const body = YAML.stringify({
    version: plan.version,
    id: plan.id,
    label: plan.label,
    note: plan.note,
    builtin: plan.builtin === true,
    platform: plan.platform,
    agentPlatform: plan.agentPlatform,
    agent: plan.agent,
    behavior: plan.behavior,
    capability: plan.capability,
    audience: plan.audience,
  }, { lineWidth: 0, singleQuote: true }).replace(/\n+$/, '');
  return `${PLAN_FILE_HEADER}\n\n${body}\n`;
}

function orderOf(plan) {
  const index = BUILTIN_PLAN_ORDER.indexOf(plan.id);
  return index >= 0 ? index : BUILTIN_PLAN_ORDER.length + (plan.builtin ? 0 : 1);
}

/**
 * 方案文件仓库。`root` 默认 profiles/plans，测试可注入临时目录。
 */
export function createPlanStore({ root = PLANS_ROOT, log = () => {} } = {}) {
  function files() {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  function read(file) {
    const id = file.replace(/\.ya?ml$/i, '');
    const text_ = fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '');
    let raw;
    try {
      raw = YAML.parse(text_);
    } catch (error) {
      throw new Error(`方案 ${file} YAML 解析失败：${error?.message ?? error}`);
    }
    return normalizePlan({ ...raw, id: raw?.id ?? id }, { source: `plans/${file}` });
  }

  function list() {
    const plans = files().map(read).sort((a, b) => orderOf(a) - orderOf(b) || a.id.localeCompare(b.id));
    return plans;
  }

  function get(id) {
    const name = text(id, 40);
    if (!name) return null;
    return list().find((plan) => plan.id === name) ?? null;
  }

  function save(input) {
    const plan = normalizePlan(input);
    const existing = get(plan.id);
    if (existing?.builtin) throw new Error('内置方案是只读的，请先克隆一份再改');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, `${plan.id}.yml`), planText({ ...plan, builtin: false }), 'utf8');
    log(`[plans] 已保存 ${plan.id}`);
    return { ...plan, builtin: false };
  }

  function remove(id) {
    const plan = get(id);
    if (!plan) throw new Error('没有这个方案');
    if (plan.builtin) throw new Error('内置方案不能删除');
    fs.rmSync(path.join(root, `${plan.id}.yml`), { force: true });
    log(`[plans] 已删除 ${plan.id}`);
    return { id: plan.id };
  }

  function clone(id, to) {
    const source = get(id);
    if (!source) throw new Error('没有这个方案');
    const nextId = text(to, 40);
    if (!nextId) throw new Error('克隆需要新 id');
    if (get(nextId)) throw new Error('方案 id 已存在');
    return save({
      ...source,
      id: nextId,
      label: `${source.label}（副本）`,
      builtin: false,
    });
  }

  function reset(id) {
    const plan = get(id);
    if (!plan?.builtin) throw new Error('只有内置方案可以重置');
    const factory = path.join(root, '.defaults', `${plan.id}.yml`);
    if (!fs.existsSync(factory)) throw new Error('缺少出厂副本，无法重置');
    fs.copyFileSync(factory, path.join(root, `${plan.id}.yml`));
    log(`[plans] 已重置 ${plan.id}`);
    return get(plan.id);
  }

  return { root, list, get, save, remove, clone, reset };
}

/** 方案对应的旧模式（供 effectiveMode 与旧调用点投影；不是新的配置项）。 */
export function legacyModeOfPlan(plan) {
  if (!plan) return 'chat';
  if (plan.behavior === 'social-v2') return 'reserved2';
  if (plan.behavior === 'social-v1') return 'reserved';
  if (String(plan.agent || '').startsWith('qq-agent-')) return 'closed-agent';
  return 'chat';
}

const LEVEL_BY_AGENT = {
  'qq-agent-readonly': 'L1',
  'qq-agent-workspace': 'L2',
  'qq-agent-full': 'L3',
};

/** 方案对应的旧级别（仅 agent 方案有；其余 L0）。 */
export function legacyLevelOfPlan(plan) {
  return LEVEL_BY_AGENT[plan?.agent] ?? 'L0';
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

/** 校验方案里的引用是否都存在（check-profiles 与启动自检共用）。 */
export function validatePlanReferences(plan, { behaviors, capabilities, agents, platforms, agentPlatforms }) {
  const problems = [];
  if (platforms && !platforms.has(plan.platform)) problems.push(`platform ${plan.platform} 不存在`);
  if (agentPlatforms && !agentPlatforms.has(plan.agentPlatform)) problems.push(`agentPlatform ${plan.agentPlatform} 不存在`);
  if (behaviors && plan.behavior !== 'none' && !behaviors.has(plan.behavior)) problems.push(`behavior ${plan.behavior} 不存在`);
  if (capabilities && !capabilities.has(plan.capability)) problems.push(`capability ${plan.capability} 不存在`);
  if (agents && !agents.has(plan.agent)) problems.push(`agent ${plan.agent} 不存在`);
  return problems;
}
