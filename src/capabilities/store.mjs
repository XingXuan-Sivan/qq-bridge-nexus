// 能力目录（dsh/agent-presets/<id>/capability.yml）的唯一读取口。
// 桥接只认这里：工具可见、Agent 模块、MCP/技能、安全段都从 capability.yml 派生，
// 运行期只有 capability.yml 一份源，不再有运行期补丁。
import path from 'node:path';
import fs from 'node:fs';
import { loadCapabilityFile, normalizeCapabilityFile, saveCapabilityFile, defaultCapability } from './file.mjs';
import { writeArtifacts } from './build.mjs';
import { capabilityCovers, capabilityDefaults, PLATFORM_TOOLS, AGENT_MODULES } from '../tools/catalog.mjs';

/** 目录名即能力 id；只认带 capability.yml 的子目录。 */
function capabilityDirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(root, name, 'capability.yml')));
}

/** 平台工具可见集：显式写了就按显式，没写按能力的默认模板。 */
export function visiblePlatformFlags(capability) {
  const preset = capabilityDefaults(capability.id) ?? capabilityDefaults('agent-chat');
  const allVisible = preset?.platform === true;
  const defaults = new Set(Array.isArray(preset?.platform) ? preset.platform : []);
  const explicit = capability.tools?.platform ?? {};
  const visible = [];
  for (const tool of PLATFORM_TOOLS) {
    const value = explicit[tool.flag];
    if (value === true || (value === undefined && (allVisible || defaults.has(tool.flag)))) visible.push(tool.flag);
  }
  return visible;
}

/** 这套能力允许该工具吗？只对「可收紧」的副作用工具有意义（读类恒 true）。 */
export function capabilityAllowsFlag(capability, flag) {
  if (!capabilityCovers(flag)) return true;
  if (!capability) return true;
  return visiblePlatformFlags(capability).includes(flag);
}

/** 能力的 Agent 模块 id 列表（`tools.agent` 里为 true 的键）。 */
export function agentModulesOf(capability) {
  const ids = [];
  for (const [key, value] of Object.entries(capability.tools?.agent ?? {})) {
    if (value !== true) continue;
    const module = AGENT_MODULES.find((item) => item.id === key || key.replaceAll('_', '-') === item.id);
    ids.push(module?.id ?? key);
  }
  return ids;
}

export function createCapabilityStore({ root, log = () => {} } = {}) {
  const cache = new Map();

  function decorate(capability) {
    return {
      ...capability,
      builtin: true,
      platformVisible: visiblePlatformFlags(capability),
      agentModules: agentModulesOf(capability),
    };
  }

  function list() {
    const items = [];
    for (const id of capabilityDirs(root)) {
      const loaded = loadCapabilityFile(path.join(root, id), { id });
      if (!loaded) continue;
      items.push(decorate(loaded.capability));
    }
    return items.sort((a, b) => a.id.localeCompare(b.id));
  }

  function get(id) {
    const name = String(id ?? '').trim();
    if (!name) return null;
    const loaded = loadCapabilityFile(path.join(root, name), { id: name });
    return loaded ? decorate(loaded.capability) : null;
  }

  /** 保存 = 写回 capability.yml 并立刻重建三份产物（产物是能力的纯函数）。 */
  function save(id, patch = {}) {
    const dir = path.join(root, id);
    const current = loadCapabilityFile(dir, { id })?.capability ?? defaultCapability(id);
    const next = {
      ...current,
      ...pick(patch, ['label', 'note', 'order', 'risk']),
      prompt: { ...current.prompt, ...(patch.prompt ?? {}) },
      safety: { ...current.safety, ...(patch.safety ?? {}) },
      tools: {
        platform: patch.tools?.platform ? { ...patch.tools.platform } : current.tools.platform,
        agent: patch.tools?.agent ? { ...patch.tools.agent } : current.tools.agent,
        mcp: patch.tools?.mcp ?? current.tools.mcp,
        skills: patch.tools?.skills ?? current.tools.skills,
      },
    };
    const normalized = normalizeCapabilityFile(next, { id });
    saveCapabilityFile(dir, normalized.capability);
    writeArtifacts(dir, normalized.capability);
    cache.delete(id);
    log(`[capabilities] 已保存 ${id}${normalized.warnings.length ? `（${normalized.warnings.length} 条告警）` : ''}`);
    return decorate(normalized.capability);
  }

  /** 删除自定义能力；内置四条不允许删（只能克隆改）。 */
  function remove(id) {
    const name = String(id ?? '').trim();
    const current = get(name);
    if (!current) throw new Error('没有这个能力预设');
    if (current.builtin) throw new Error('内置能力预设只读：请先克隆一份再改');
    fs.rmSync(path.join(root, name), { recursive: true, force: true });
    cache.delete(name);
    return { id: name };
  }

  return { list, get, save, remove, root };
}

function pick(source, keys) {
  const out = {};
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}
