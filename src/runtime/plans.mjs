// 运行方案：组合「用户侧平台的行为档案」与「Agent 侧平台的能力档」。
//
// 权威源：profiles/plans/<id>.yml。内置方案带 builtin: true，控制台只读、可克隆；
// 自定义方案同目录，删改都落文件。桥接只依赖 createPlanStore().list()/get()/save()/remove()。
// 方案**不绑用户平台**：行为档案本来就按平台走，方案只引用行为 id。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { PLANS_ROOT } from '../profiles/paths.mjs';
// 方案里的 capability 就是能力档 id，也**就是** Agent 平台托管的 preset id（C4 后不再单写 agent）。
// 哪个 preset 属于管理通道哪一级由平台适配器声明（AGENT_PRESET_FOR_LEVEL），这里不写死任何 preset 名。
import { agentPresetLevel } from '../agent-side/runtime-registry.mjs';
import '../agent-side/builtin.mjs';

// 方案里的 agentPlatform 取值 `auto` = 跟随全局默认执行体（config 的 platforms.active.agent）。
// 写具体 id 只在「这个方案必须跑在某个执行体上」时才需要：内置方案全部写 auto。
export const AGENT_PLATFORM_AUTO = 'auto';
export const PLAN_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
export const PLAN_AUDIENCES = ['owner', 'access'];
export const BUILTIN_PLAN_ORDER = ['chat', 'social-v1', 'social-v2', 'agent-readonly', 'agent-workspace', 'agent-full'];

const PLAN_FILE_HEADER = '# 运行方案：组合 behavior（行为档案）+ agentPlatform（Agent 侧平台，auto = 跟随全局）\n'
  + '# 与 capability（能力档 id，也是 Agent 侧的 preset id）。方案不绑用户平台。\n'
  + '# builtin: true 为只读方案，可克隆，不可改删。';

function text(value, max = 120) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function plain(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value;
}

/**
 * 归一并校验一份方案；字段缺失或引用非法直接报错（不做静默兜底）。
 *
 * 不再读 `platform`：方案不绑用户平台。旧文件里的这个字段由 planWarnings() 报告，
 * 保存时自然被丢掉（planText 不写它）。
 */
export function normalizePlan(raw, { source = 'plan' } = {}) {
  const value = plain(raw, source);
  const id = text(value.id, 40);
  if (!PLAN_ID_RE.test(id)) throw new Error(`${source}.id 不合法：${id || '(空)'}`);
  const agentPlatform = text(value.agentPlatform, 40) || AGENT_PLATFORM_AUTO;
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
    agentPlatform,
    behavior,
    capability,
    audience,
  };
}

/** 旧文件里已经不生效的字段：读时报告，但不阻断加载。 */
export function planWarnings(raw) {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const warnings = [];
  if (Object.hasOwn(value, 'platform')) {
    warnings.push({ code: 'plan_warn', message: 'platform 字段已不生效：方案不再绑用户平台，保存后会被删除' });
  }
  if (value.agentPlatform && String(value.agentPlatform) !== AGENT_PLATFORM_AUTO && value.builtin === true) {
    warnings.push({ code: 'plan_warn', message: '内置方案的 agentPlatform 应保持 auto，否则换全局执行体时本方案会被拉回旧平台' });
  }
  return warnings;
}

function planText(plan) {
  const body = YAML.stringify({
    version: plan.version,
    id: plan.id,
    label: plan.label,
    note: plan.note,
    builtin: plan.builtin === true,
    agentPlatform: plan.agentPlatform,
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
    // 旧字段不阻断加载，但要让调用方看得到：控制台与 check-profiles 都读 warnings。
    const warnings = planWarnings(raw);
    const plan = normalizePlan({ ...raw, id: raw?.id ?? id }, { source: `plans/${file}` });
    return warnings.length ? { ...plan, warnings } : plan;
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
    const plan = normalizePlan(input, {});
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
  if (agentPresetLevel(plan.capability)) return 'closed-agent';
  return 'chat';
}

/** 方案对应的旧级别（仅带权限级别的能力档有；其余 L0）。 */
export function legacyLevelOfPlan(plan) {
  return agentPresetLevel(plan?.capability) ?? 'L0';
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

/**
 * 校验方案里的引用与结构性约束（check-profiles 与运行时自检共用）。
 *
 * `capabilities` / `agentPlatforms` 可以传 id 的 Set（只查存在性），也可以传
 * id → 事实的 Map（能查「apply: preset 必须有 rows」「passthrough 必须有执行体认领」）。
 * 返回 [{code, message}]：`capability_invalid` / `plan_invalid` 是错，`plan_warn` 只是提示。
 *
 * 执行体侧的约束只在方案**写死了具体 id** 时才能判：`auto` 跑在哪个执行体由全局默认决定，
 * 那时留给装配期 fail-closed（无法钉权限档的执行体会在会话建立时直接报错，不静默退化）。
 */
export function validatePlanReferences(plan, { behaviors, capabilities, agentPlatforms } = {}) {
  const issues = [];
  const fail = (code, message) => issues.push({ code, message });

  if (behaviors && plan.behavior !== 'none' && !behaviors.has(plan.behavior)) {
    fail('plan_invalid', `behavior ${plan.behavior} 不存在`);
  }

  const capability = capabilities instanceof Map ? capabilities.get(plan.capability) : null;
  if (capabilities instanceof Map) {
    if (!capability) fail('capability_invalid', `capability ${plan.capability} 不存在`);
    else if (capability.apply !== 'passthrough' && capability.hasRows !== true) {
      fail('capability_invalid', `capability ${plan.capability} 是 apply: preset 但 rows 为空（预设正文不能为空）`);
    }
  } else if (capabilities && !capabilities.has(plan.capability)) {
    fail('capability_invalid', `capability ${plan.capability} 不存在`);
  }

  if (plan.agentPlatform !== AGENT_PLATFORM_AUTO) {
    const facts = agentPlatforms instanceof Map ? agentPlatforms.get(plan.agentPlatform) : null;
    if (agentPlatforms && !facts && !(agentPlatforms instanceof Set && agentPlatforms.has(plan.agentPlatform))) {
      fail('plan_invalid', `agentPlatform ${plan.agentPlatform} 不存在（写 auto 可跟随全局默认执行体）`);
    } else if (facts) {
      if (capability?.apply === 'passthrough' && !facts.apply.includes('passthrough')) {
        fail('plan_invalid', `agentPlatform ${plan.agentPlatform} 不支持 apply: passthrough（改用 auto，或换一个认领直通的执行体）`);
      }
      if (capability?.permission === 'bridge' && facts.permission !== true) {
        fail('plan_invalid', `agentPlatform ${plan.agentPlatform} 没有权限预设映射，无法支撑 permission: bridge（禁止静默退化成不设权限）`);
      }
    }
  }

  if (capability?.apply === 'passthrough' && plan.audience === 'access') {
    issues.push({ code: 'plan_warn', message: '群聊直通：对端的工具与权限对群友可见，安全边界只由执行体自身承担' });
  }

  return issues;
}
