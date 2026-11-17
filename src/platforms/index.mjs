// 用户侧平台注册表：profiles/platforms/<id>/ 是唯一源。
// 平台只提供接口与必要的公共配置；具体行为档案、话术与工具清单都放在平台目录里。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { normalizePromptVars } from '../runtime/prompt-compose.mjs';
import { normalizePricingPolicy } from '../pricing/policy.mjs';

export const PLATFORM_TOOL_RISKS = ['read', 'write', 'send', 'state', 'exec', 'admin'];

export function platformRootOf(root, id) {
  return path.join(root, id);
}

function readYaml(file) {
  try {
    return YAML.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 目录下的 yml/ya?ml 文件名（去后缀、排序）；目录不存在时给空数组。 */
function listYamlIds(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /\.ya?ml$/i.test(name))
    .map((name) => name.replace(/\.ya?ml$/i, ''))
    .sort();
}

/** 目录下的子目录名（排序）；目录不存在时给空数组。 */
function listSubdirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function listPlatforms({ root } = {}) {
  if (!root || !fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => fs.existsSync(path.join(root, id, 'platform.yml')))
    .sort()
    .map((id) => {
      const meta = readYaml(path.join(root, id, 'platform.yml')) ?? {};
      const dir = path.join(root, id);
      const behaviors = listYamlIds(path.join(dir, 'behaviors'));
      return {
        id,
        label: String(meta.label ?? meta.name ?? id),
        kind: String(meta.kind ?? 'user-platform'),
        source: path.join('profiles', 'platforms', id),
        behaviors,
        behaviorCount: behaviors.length,
        // 话术与配置面：控制台的平台页据此决定画不画「话术」标签与配置表单。
        // 只给布尔，不把文件内容带进列表（内容走各自的读接口）。
        prompt: {
          active: Boolean(meta.prompt?.active),
          hasDefault: Boolean(meta.prompt?.default),
        },
        // 提示词变量（C2b）：此前硬编码在 src/runtime/adapters.mjs 的 builtinAdapters 里。
        // 构建期（产物渲染）与运行期（唤醒提示词）都读这一份，换平台就换一份 vars。
        vars: normalizePromptVars(meta.vars),
        configSchema: meta.configSchema ?? null,
      };
    });
}

export function readPlatformTools({ root, id } = {}) {
  const file = path.join(root, id, 'tools.yml');
  if (!fs.existsSync(file)) return [];
  const data = readYaml(file) ?? {};
  const tools = Array.isArray(data.tools) ? data.tools : [];
  return tools
    .map((tool) => ({
      flag: String(tool.flag ?? tool.id ?? ''),
      label: String(tool.label ?? ''),
      desc: String(tool.desc ?? ''),
      risk: String(tool.risk ?? 'read'),
      defaultOff: tool.defaultOff === true,
    }))
    .filter((tool) => tool.flag && PLATFORM_TOOL_RISKS.includes(tool.risk));
}

export function loadPlatform({ root, id } = {}) {
  const list = listPlatforms({ root });
  const meta = list.find((item) => item.id === id);
  if (!meta) return null;
  return { ...meta, tools: readPlatformTools({ root, id }) };
}

/**
 * 模型目录的规范化：平台作者写的**只读元数据**（有哪些模型、怎么计费、能压到多少）。
 *
 * 它与 `configSchema` 是两套语义 —— 后者校验用户可写的平台选项（`vetPlatformConfig`），
 * 前者不进任何校验器：作者写错目录只该让界面少显示一项，不该让用户配置变成「非法」。
 * 全部字段可缺省；整段不声明时返回 `null`，界面按无该能力降级，不阻塞聊天。
 */
function normalizeModelCatalog(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const num = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const models = (Array.isArray(raw.models) ? raw.models : [])
    .map((item) => {
      const id = String(item?.id ?? item?.model ?? '').trim();
      if (!id) return null;
      const given = item?.pricing && typeof item.pricing === 'object' ? item.pricing : {};
      const pricing = {
        cacheHit: num(given.cacheHit),
        cacheMiss: num(given.cacheMiss),
        cacheWrite: num(given.cacheWrite),
        output: num(given.output),
      };
      // 模型级口径：只写要偏离平台声明的那几项，没写就回落平台（含「显式空窗口 = 全天同价」）。
      const policy = normalizePricingPolicy(item?.pricingPolicy);
      return {
        id,
        label: String(item?.label ?? id).trim() || id,
        contextWindow: num(item?.contextWindow),
        vision: item?.vision === true,
        // 四个桶一个都没写 = 不报单价，界面显示「未声明」而不是拿兜底价猜。
        pricing: Object.values(pricing).some((rate) => rate !== null) ? pricing : null,
        pricingPolicy: Object.keys(policy).length ? policy : null,
      };
    })
    .filter(Boolean);
  const efforts = (Array.isArray(raw.efforts) ? raw.efforts : [])
    .map((item) => {
      const id = String(item?.id ?? '').trim();
      return id ? { id, label: String(item?.label ?? id).trim() || id } : null;
    })
    .filter(Boolean);
  const approxTokens = num(raw.compact?.approxTokens);
  const catalog = {
    models,
    pricingPolicy: normalizePricingPolicy(raw.pricingPolicy),
    efforts,
    effortFallback: (Array.isArray(raw.effortFallback) ? raw.effortFallback : [])
      .map((id) => String(id ?? '').trim())
      .filter(Boolean),
    compact: approxTokens > 0 ? { approxTokens: Math.round(approxTokens) } : null,
  };
  // 既没模型也没档位 = 平台什么都没声明，按「没有目录」处理，不含部分空壳。
  return models.length || efforts.length ? catalog : null;
}

/**
 * Agent 平台声明目录：profiles/agent-platforms/<id>/ 是唯一源。
 *
 * 与 listPlatforms 同一个理由：控制台要能列出「配置面声明了哪些 Agent 平台」，
 * 包括那些**还没装配进内核**的目录（它们的 `runtime.mjs` 可能不存在，或尚未写进
 * src/agent-side/builtin.mjs）。这类目录在统一注册表里报 `profile_only`，
 * 而不是凭空消失。
 *
 * 平台目录里装两样与执行体强相关的东西：`capabilities/`（意图层，跨平台可读）与
 * `tools.yml`（本执行体提供哪些模块、各承担哪个效果）。插件名、行序与人格文案
 * 不在这里，那是 `adapters/render.yml` 的事。
 */
export function listAgentPlatformDirs({ root } = {}) {
  if (!root || !fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => fs.existsSync(path.join(root, id, 'agent-platform.yml')))
    .sort()
    .map((id) => {
      const dir = path.join(root, id);
      const meta = readYaml(path.join(dir, 'agent-platform.yml')) ?? {};
      return {
        id,
        label: String(meta.label ?? meta.name ?? id),
        source: path.join('profiles', 'agent-platforms', id),
        capabilities: listYamlIds(path.join(dir, 'capabilities')),
        // 该平台给「没单独指定能力档的会话」用的默认档（空串 = 由内核按聊天处理）。
        // 它是平台作者的声明，与用户配置无关，所以与 modelCatalog 同在声明面。
        defaultCapability: String(meta.defaultCapability ?? '').trim(),
        hasRuntime: fs.existsSync(path.join(dir, 'adapters', 'runtime.mjs')),
        modelCatalog: normalizeModelCatalog(meta.modelCatalog),
        configSchema: meta.configSchema ?? null,
      };
    });
}

/**
 * Agent 侧工具声明：`profiles/agent-platforms/<id>/tools.yml` 的 `modules`。
 *
 * 每个模块声明自己承担哪些**效果**（`fs.read` / `shell.exec` …），能力档只写效果、不写模块 id；
 * 控制台的 Agent 工具表与构建期的渲染层都读这一份。目录缺失或没写 `modules` 时给空数组 ——
 * 空的执行体不是错误，它的工具面就是空的。
 */
export function readAgentPlatformTools({ root, id } = {}) {
  if (!root || !id) return [];
  const file = path.join(root, String(id), 'tools.yml');
  if (!fs.existsSync(file)) return [];
  const data = readYaml(file) ?? {};
  const modules = Array.isArray(data.modules) ? data.modules : [];
  return modules
    .map((module) => ({
      id: String(module.id ?? ''),
      label: String(module.label ?? ''),
      desc: String(module.desc ?? ''),
      risk: String(module.risk ?? 'read'),
      effects: (Array.isArray(module.effects) ? module.effects : []).map(String).filter(Boolean),
    }))
    .filter((module) => module.id && PLATFORM_TOOL_RISKS.includes(module.risk));
}
