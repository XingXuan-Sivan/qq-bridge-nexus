// 能力预设文件（capability.yml）：唯一可编辑源。
//
// 之前的预设是「三份文件各写一半」：preset.yml 写名字与 behavior 绑定、
// agent.cordis.yml 写人格/插件行、extensions.yml 写 MCP 与技能。三者没有共同校验，
// 也没有地方回答「这个能力到底能干什么」。这里收敛成一份：
//   · tools 一节同时表达平台工具、Agent 模块、MCP、技能；
//   · safety 一节表达平台无关的安全约束（生成 persona 的安全段）；
//   · 另外三份文件全部由 src/capabilities/build.mjs 生成，不再手改。
//
// 纯函数 + 一个 save/load 薄壳，方便单测；不读 config、不碰网络。
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  AGENT_MODULES,
  PLATFORM_TOOLS,
  TOOL_RISKS,
  capabilityDefaults,
} from '../tools/catalog.mjs';

export const CAPABILITY_VERSION = 1;
export const CAPABILITY_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
export const SAFETY_ENUMS = Object.freeze({
  secrets: ['deny', 'allow'],
  self_modify: ['deny', 'allow'],
  injection: ['strict', 'normal'],
});
export const AGENT_ALIASES = Object.freeze({
  'fs.read': 'tool-fs',
  'fs.search': 'tool-fs-search',
  pwsh: 'tool-pwsh',
  jobs: 'tool-jobs',
  web: 'tool-web',
  ask_user_question: 'tool-ask-user',
  todo: 'tool-todo',
  approval_gate: 'qq-approval-gate',
});
const AGENT_IDS = new Set(AGENT_MODULES.map((module) => module.id));
const PLATFORM_FLAGS = new Set(PLATFORM_TOOLS.map((tool) => tool.flag));

function text(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function fail(message) {
  const error = new Error(message);
  error.code = 'CAPABILITY_INVALID';
  throw error;
}

/** 模块键（fs.read / tool-fs 都行）→ 目录 id；未知返回空串。 */
export function agentModuleId(key) {
  const value = text(key, 40);
  if (!value) return '';
  if (AGENT_IDS.has(value)) return value;
  return AGENT_ALIASES[value] ?? '';
}

/** 模块目录 id → 能力文件里的规范键（生成时统一写别名，便于人读）。 */
export function agentModuleKey(moduleId) {
  const found = Object.entries(AGENT_ALIASES).find(([, id]) => id === moduleId);
  return found ? found[0] : moduleId;
}

function normalizeMcpList(raw) {
  const list = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const server = text(item?.server, 80);
    if (!server) fail('tools.mcp 的每一项都要有 server');
    const tools = item?.tools === '*' || item?.tools === undefined
      ? '*'
      : [...new Set((Array.isArray(item.tools) ? item.tools : []).map((tool) => text(tool, 80)).filter(Boolean))];
    list.push({ server, tools });
  }
  return list;
}

/**
 * 校验并归一 capability.yml。
 * @param {unknown} raw YAML 解析结果
 * @param {{ id?: string }} options 目录名（缺失时用 raw.id）
 * @returns {{ capability: object, warnings: string[] }}
 */
export function normalizeCapabilityFile(raw, { id } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('capability.yml 必须是映射');
  const value = raw;
  const dirId = text(id ?? value.id, 80);
  if (!CAPABILITY_ID_RE.test(dirId)) fail(`capability id 不合法：${dirId || '(空)'}`);
  if (value.id !== undefined && text(value.id, 80) !== dirId) fail(`capability id 与目录名不一致：${value.id} ≠ ${dirId}`);
  const warnings = [];

  const tools = value.tools && typeof value.tools === 'object' ? value.tools : {};
  const platform = {};
  for (const [key, flagValue] of Object.entries(tools.platform ?? {})) {
    if (!PLATFORM_FLAGS.has(key)) fail(`tools.platform 里有未知工具：${key}`);
    if (typeof flagValue !== 'boolean') fail(`tools.platform.${key} 必须是 true/false`);
    platform[key] = flagValue;
  }
  const agent = {};
  for (const [key, enabled] of Object.entries(tools.agent ?? {})) {
    const moduleId = agentModuleId(key);
    if (!moduleId) fail(`tools.agent 里有未知模块：${key}`);
    if (typeof enabled !== 'boolean') fail(`tools.agent.${key} 必须是 true/false`);
    agent[moduleId] = enabled;
  }
  const mcp = normalizeMcpList(tools.mcp);
  const skills = [...new Set((Array.isArray(tools.skills) ? tools.skills : []).map((skill) => text(skill, 80)).filter(Boolean))];
  for (const skill of skills) {
    if (skill === '*') continue;
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(skill)) fail(`tools.skills 里有非法技能 id：${skill}`);
  }

  const safetyRaw = value.safety && typeof value.safety === 'object' ? value.safety : {};
  const safety = {
    local_tools: safetyRaw.local_tools !== false,
    secrets: SAFETY_ENUMS.secrets.includes(safetyRaw.secrets) ? safetyRaw.secrets : 'deny',
    self_modify: SAFETY_ENUMS.self_modify.includes(safetyRaw.self_modify) ? safetyRaw.self_modify : 'deny',
    injection: SAFETY_ENUMS.injection.includes(safetyRaw.injection) ? safetyRaw.injection : 'strict',
    notes: text(safetyRaw.notes, 2000),
  };
  if (safety.local_tools === false) {
    for (const [moduleId, enabled] of Object.entries(agent)) {
      if (enabled) warnings.push(`safety.local_tools=false：生成时强制忽略 ${agentModuleKey(moduleId)}`);
    }
  }

  const riskMaxRaw = text(value.risk?.max, 10);
  const riskMax = TOOL_RISKS.includes(riskMaxRaw) ? riskMaxRaw : '';
  if (riskMaxRaw && !riskMax) fail(`risk.max 不合法：${riskMaxRaw}`);

  const capability = {
    version: CAPABILITY_VERSION,
    id: dirId,
    label: text(value.label, 60) || dirId,
    note: text(value.note, 400),
    agent: text(value.agent, 20) || 'dsh',
    risk: { max: riskMax },
    // 能力自己的系统提示（与平台无关）；平台的说话方式在行为档案的 prompt 段。
    prompt: { base: text(value.prompt?.base, 8000) },
    tools: { platform, agent, mcp, skills },
    safety,
  };
  if (capability.agent !== 'dsh') fail(`agent 目前只支持 dsh：${capability.agent}`);
  return { capability, warnings };
}

/** 能力文件的默认值（新建空白能力时用）。 */
export function defaultCapability(id, { label = '', from = '' } = {}) {
  // 缺省按同 id 的内置模板（agent-full 就是全量），自定义 id 回落到 agent-chat。
  const defaults = capabilityDefaults(from) ?? capabilityDefaults(id) ?? capabilityDefaults('agent-chat');
  const agent = {};
  for (const moduleId of defaults.agent) agent[agentModuleKey(moduleId)] = true;
  return {
    version: CAPABILITY_VERSION,
    id,
    label: label || id,
    note: '',
    agent: 'dsh',
    risk: { max: '' },
    prompt: { base: '' },
    tools: {
      platform: {},
      agent,
      mcp: defaults.mcp.allow.includes('*') ? [{ server: '*', tools: '*' }] : defaults.mcp.allow.map((server) => ({ server, tools: '*' })),
      skills: [...defaults.skills],
    },
    safety: {
      local_tools: defaults.agent.some((moduleId) => !['tool-web', 'tool-ask-user', 'tool-todo'].includes(moduleId)),
      secrets: 'deny',
      self_modify: 'deny',
      injection: 'strict',
      notes: '',
    },
  };
}

/** 读一份 capability.yml；文件不存在返回 null。 */
export function loadCapabilityFile(dir, { id } = {}) {
  const file = path.join(dir, 'capability.yml');
  if (!fs.existsSync(file)) return null;
  const { capability, warnings } = normalizeCapabilityFile(parseYaml(fs.readFileSync(file, 'utf8')), { id });
  return { capability, warnings, file };
}

/** 写 capability.yml（原子写，0600）。 */
export function saveCapabilityFile(dir, capability) {
  const { capability: normalized } = normalizeCapabilityFile(capability, { id: capability?.id });
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'capability.yml');
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, stringifyYaml(normalized, { lineWidth: 0, aliasDuplicateObjects: false, singleQuote: true }), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
  return normalized;
}
