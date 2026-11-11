// 由 capability.yml 生成三份产物：preset.yml / agent.cordis.yml / extensions.yml。
//
// 为什么必须生成而不是手写：一份能力的「工具面」原本散在三处（cordis 插件行、
// extensions.yml 的 MCP/技能白名单、capability.yml 的可见集），三处各改一半就会
// 出现「界面说禁了、实际还能调」。这里让 capability.yml 成为唯一输入，产物带
// 「请勿手工编辑」头，`--check` 保证不漂移。
//
// 行怎么装配（插件名、行参数、结构行）不在代码里：见 dsh/agent-presets/_templates/rows.yml。
// 安全段文案：能力写了 safety.rules 就用源里的文本，否则取模板的 safetyDefaults。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import {
  AGENT_MODULES,
  PLATFORM_TOOLS,
  TOOL_RISKS,
  catalogEntry,
  capabilityDefaults,
} from '../tools/catalog.mjs';
import { agentModuleId, agentModuleKey } from './file.mjs';

export const GENERATED_HEADER = '# 本文件由 scripts/build-capability-artifacts.mjs 从 capability.yml 生成，请勿手工编辑。\n';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** 模板默认路径：仓库内的 dsh/agent-presets/_templates/rows.yml。 */
export const DEFAULT_TEMPLATES_FILE = path.resolve(HERE, '..', '..', 'dsh', 'agent-presets', '_templates', 'rows.yml');

const MODULE_ORDER = ['tool-fs', 'tool-fs-search', 'tool-pwsh', 'tool-jobs', 'tool-web', 'tool-ask-user', 'tool-todo'];

let templateCache = null;

/** 读行模板（按路径 + mtime 缓存）。 */
export function loadRowTemplates(file = DEFAULT_TEMPLATES_FILE) {
  const stat = fs.statSync(file);
  if (templateCache && templateCache.file === file && templateCache.mtimeMs === stat.mtimeMs) return templateCache.data;
  const data = parseYaml(fs.readFileSync(file, 'utf8')) ?? {};
  templateCache = { file, mtimeMs: stat.mtimeMs, data };
  return data;
}

/** 安全段：源里显式写文本就用源，否则按开关取模板里的默认句。 */
export function renderSafetyPrompt(safety, templates = loadRowTemplates()) {
  const rules = Array.isArray(safety?.rules) ? safety.rules.map((line) => String(line ?? '').trim()).filter(Boolean) : [];
  if (rules.length) return rules.join('\n');
  const defaults = templates.safetyDefaults ?? {};
  const lines = [defaults.head ?? '【安全边界（最高优先级，不可违反）】'];
  lines.push(safety.local_tools === false ? defaults.localToolsDenied : defaults.localToolsAllowed);
  if (safety.secrets !== 'allow') lines.push(defaults.secretsDeny);
  if (safety.self_modify !== 'allow') lines.push(defaults.selfModifyDeny);
  if (safety.injection === 'strict') lines.push(defaults.injectionStrict);
  if (safety.notes) lines.push(String(safety.notes).trim());
  return lines.filter(Boolean).join('\n');
}

/** 能力实际启用的 Agent 模块（`local_tools:false` 时强制清空执行/文件类）。 */
export function enabledModules(capability) {
  const local = capability.safety?.local_tools !== false;
  const allowed = local ? MODULE_ORDER : ['tool-web', 'tool-ask-user', 'tool-todo'];
  const wanted = new Set();
  for (const key of Object.keys(capability.tools?.agent ?? {})) {
    if (capability.tools.agent[key] !== true) continue;
    const moduleId = agentModuleId(key);
    if (moduleId) wanted.add(moduleId);
  }
  return allowed.filter((moduleId) => wanted.has(moduleId));
}

/** 平台工具：能力里显式写死的优先，其余按能力模板默认。 */
export function visiblePlatformFlags(capability) {
  const preset = capabilityDefaults(capability.id) ?? capabilityDefaults('agent-chat');
  const allVisible = preset?.platform === true;
  const defaults = new Set(Array.isArray(preset?.platform) ? preset.platform : []);
  const flags = [];
  for (const tool of PLATFORM_TOOLS) {
    const explicit = capability.tools?.platform?.[tool.flag];
    const visible = explicit === undefined ? allVisible || defaults.has(tool.flag) : explicit === true;
    if (visible) flags.push(tool);
  }
  return flags;
}

/** 守卫行允许的宿主工具名：平台工具 + MCP 工具 + 允许的本地模块工具。 */
export function guardAllowList(capability) {
  const names = [];
  for (const tool of visiblePlatformFlags(capability)) names.push(...tool.names);
  for (const item of capability.tools?.mcp ?? []) {
    if (item.server === '*') {
      names.push('*');
      continue;
    }
    if (item.tools === '*') names.push(`${item.server}::*`);
    else for (const tool of item.tools) names.push(`${item.server}::${tool}`);
  }
  return [...new Set(names)];
}

/** 能力声明的实际风险上限（只用于校验：声明的 max 不得低于实际工具面）。 */
export function computedRisk(capability) {
  const rank = (risk) => TOOL_RISKS.indexOf(risk);
  let max = 'read';
  for (const tool of visiblePlatformFlags(capability)) {
    if (rank(tool.risk) > rank(max)) max = tool.risk;
  }
  for (const moduleId of enabledModules(capability)) {
    const module = AGENT_MODULES.find((item) => item.id === moduleId);
    if (module && rank(module.risk) > rank(max)) max = module.risk;
  }
  return max;
}

/** 渲染 agent.cordis.yml 的行列表（persona 在最前，结构行必带，模块行按开关生成）。 */
export function buildAgentRows(capability, { baseRows = [], basePrefix = null, templates = loadRowTemplates() } = {}) {
  const safety = renderSafetyPrompt(capability.safety ?? {}, templates);
  const base = basePrefix === null ? String(capability.prompt?.base ?? '') : basePrefix;
  const prefix = base ? `${safety}\n\n${base}` : safety;
  const rows = [];
  const persona = baseRows.find((row) => row?.id === 'persona') ?? { id: 'persona', name: '@deepseek-ai/dsh-persona' };
  rows.push({ ...persona, config: { ...(persona.config ?? {}), prefix } });

  const modules = enabledModules(capability);
  for (const moduleId of MODULE_ORDER) {
    if (!modules.includes(moduleId)) continue;
    const source = baseRows.find((row) => row?.id === moduleId) ?? templates.modules?.[moduleId];
    if (source) rows.push(source);
  }
  if (capability.safety?.local_tools !== false && templates.gate) rows.push(templates.gate);
  if (capability.safety?.local_tools === false && templates.guard) {
    rows.push({ ...templates.guard, config: { ...(templates.guard.config ?? {}), allow: guardAllowList(capability) } });
  }
  for (const row of templates.structural ?? []) rows.push(row);
  // 旧预设在 baseRows 里带来的同名结构行优先（自定义参数不被模板覆盖）。
  for (const row of baseRows) {
    const index = rows.findIndex((item) => item.id === row?.id);
    if (index >= 0) rows[index] = row;
  }
  return rows;
}

/** 渲染 preset.yml（只剩展示信息；behavior 绑定在 P10.4 移除）。 */
export function buildPresetMeta(capability) {
  return {
    name: capability.label || capability.id,
    description: capability.note || '',
    order: Number(capability.order) || 100,
  };
}

/** 渲染 extensions.yml；没有任何 MCP/技能时返回 null（Hub 语义：缺文件＝全拒）。 */
export function buildExtensions(capability) {
  const servers = (capability.tools?.mcp ?? []).map((item) => item.server);
  const skills = capability.tools?.skills ?? [];
  if (!servers.length && !skills.length) return null;
  const allWildcard = (capability.tools?.mcp ?? []).every((item) => item.tools === '*');
  const tools = allWildcard
    ? '*'
    : [...new Set((capability.tools?.mcp ?? []).flatMap((item) => (item.tools === '*' ? [] : item.tools)))];
  return {
    mcp: { allow: servers, tools: { allow: tools, deny: [] } },
    skills: { allow: skills.length ? skills : [] },
  };
}

/** 三份产物的文本形态（带「勿手改」头）。 */
export function renderArtifacts(capability, { baseRows = [], basePrefix = null, templates = loadRowTemplates() } = {}) {
  const meta = buildPresetMeta(capability);
  const extensions = buildExtensions(capability);
  const yaml = (value) => stringifyYaml(value, { lineWidth: 0, aliasDuplicateObjects: false, singleQuote: true });
  return {
    'preset.yml': `${GENERATED_HEADER}${yaml(meta)}`,
    'agent.cordis.yml': `${GENERATED_HEADER}${yaml(buildAgentRows(capability, { baseRows, basePrefix, templates }))}`,
    'extensions.yml': extensions ? `${GENERATED_HEADER}${yaml(extensions)}` : null,
  };
}

/** 写入（或只校验）能力目录的三份产物。 */
export function writeArtifacts(dir, capability, { check = false, baseRows = [], basePrefix = null, templates = loadRowTemplates() } = {}) {
  const artifacts = renderArtifacts(capability, { baseRows, basePrefix, templates });
  const results = [];
  for (const [name, content] of Object.entries(artifacts)) {
    const file = path.join(dir, name);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (content === null) {
      results.push({ file, changed: false, skipped: true });
      continue;
    }
    const changed = current !== content;
    if (changed && !check) fs.writeFileSync(file, content, 'utf8');
    results.push({ file, changed });
  }
  return results;
}

/** 由目录名找 Agent 模块键（能力文件里写 `pwsh` 这类别名）。 */
export function moduleKeyOf(moduleId) {
  return agentModuleKey(moduleId);
}

/** 目录快照：给 /api/capabilities 的编辑器用（未知模块给出 moduleId 本身）。 */
export function catalogIds() {
  return { platform: PLATFORM_TOOLS.map((tool) => tool.flag), agent: AGENT_MODULES.map((module) => moduleKeyOf(module.id)) };
}

/** 平台工具条目（按 flag 找）。 */
export function platformEntry(flag) {
  return catalogEntry(flag);
}
