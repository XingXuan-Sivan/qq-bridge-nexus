// 用户侧平台注册表：profiles/platforms/<id>/ 是唯一源。
// 平台只提供接口与必要的公共配置；具体行为档案、话术与工具清单都放在平台目录里。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

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
      const behaviorsDir = path.join(dir, 'behaviors');
      const behaviors = fs.existsSync(behaviorsDir)
        ? fs.readdirSync(behaviorsDir).filter((name) => /\.ya?ml$/i.test(name)).map((name) => name.replace(/\.ya?ml$/i, '')).sort()
        : [];
      return {
        id,
        label: String(meta.label ?? meta.name ?? id),
        kind: String(meta.kind ?? 'user-platform'),
        source: path.join('profiles', 'platforms', id),
        behaviors,
        behaviorCount: behaviors.length,
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
