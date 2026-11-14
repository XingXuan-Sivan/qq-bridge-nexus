// 用户侧平台注册表：profiles/platforms/<id>/ 是唯一源。
// 平台只提供接口与必要的公共配置；具体行为档案、话术与工具清单都放在平台目录里。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { normalizePromptVars } from '../runtime/prompt-compose.mjs';

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
 * Agent 平台声明目录：profiles/agent-platforms/<id>/ 是唯一源。
 *
 * 与 listPlatforms 同一个理由：控制台要能列出「配置面声明了哪些 Agent 平台」，
 * 包括那些**还没装配进内核**的目录（它们的 `runtime.mjs` 可能不存在，或尚未写进
 * src/agent-side/builtin.mjs）。这类目录在统一注册表里报 `profile_only`，
 * 而不是凭空消失。
 *
 * 能力档（capabilities/）是唯一真源：C4 起一份能力档同时带着工具面（tools）、
 * 预设元信息（preset）与预设正文（rows），不再有并列的 agents/ 目录。
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
        hasRuntime: fs.existsSync(path.join(dir, 'adapters', 'runtime.mjs')),
        configSchema: meta.configSchema ?? null,
      };
    });
}
