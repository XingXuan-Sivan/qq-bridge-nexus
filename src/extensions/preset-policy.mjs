// 预设级扩展策略：每个 DSH preset 通过同目录的 extensions.yml 声明
// 允许哪些外部 MCP / 工具 / 技能。缺省为空 = 全部拒绝；只读 YAML，不反向写。
//
// 为什么不是 agent.cordis.yml：该文件的根节点是插件数组（- id: ...），
// 不能再追加顶层 mapping；扩展策略单独成文件，避免破坏 DSH preset 解析。
//
// 结构：
// mcp:
//   allow: ['*']            # server id 白名单，'*' 表示全部
//   tools:
//     allow: ['*']          # 允许调用的工具；支持 'server__tool'
//     deny: ['bad__*']      # 显式拒绝优先于 allow
// skills:
//   allow: ['*']
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const PRESET_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const MAX_LIST_ITEMS = 300;
const MAX_ITEM_CHARS = 120;

function normalizeList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  const out = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string') throw new Error(`${label} 只能包含字符串`);
    const text = item.trim();
    if (!text || text.length > MAX_ITEM_CHARS) throw new Error(`${label} 条目为空或过长`);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length > MAX_LIST_ITEMS) throw new Error(`${label} 条目过多`);
  }
  return out;
}

export function normalizePresetPolicy(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  // 新格式是 extensions.yml 的顶层 mcp/skills；兼容旧草稿的 extensions: 包裹。
  const extensions = source.mcp || source.skills
    ? source
    : (source.extensions && typeof source.extensions === 'object' ? source.extensions : {});
  const mcp = extensions.mcp && typeof extensions.mcp === 'object' ? extensions.mcp : {};
  const tools = mcp.tools && typeof mcp.tools === 'object' ? mcp.tools : {};
  return {
    mcp: {
      allow: normalizeList(mcp.allow, 'extensions.mcp.allow'),
      tools: {
        allow: normalizeList(tools.allow, 'extensions.mcp.tools.allow'),
        deny: normalizeList(tools.deny, 'extensions.mcp.tools.deny'),
      },
    },
    skills: {
      allow: normalizeList(extensions.skills?.allow, 'extensions.skills.allow'),
    },
  };
}

function emptyPolicy() {
  return { mcp: { allow: [], tools: { allow: [], deny: [] } }, skills: { allow: [] } };
}

function matches(list, value) {
  return list.some((pattern) => {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
    return pattern === value;
  });
}

export function mcpServerAllowed(policy, serverId) {
  return Boolean(policy) && matches(policy.mcp?.allow ?? [], serverId);
}

export function mcpToolAllowed(policy, serverId, toolName) {
  if (!policy) return false;
  const deny = policy.mcp?.tools?.deny ?? [];
  if (matches(deny, '*') || matches(deny, toolName) || matches(deny, `${serverId}__${toolName}`)) return false;
  const allow = policy.mcp?.tools?.allow ?? [];
  return matches(allow, '*') || matches(allow, toolName) || matches(allow, `${serverId}__${toolName}`);
}

export function skillAllowed(policy, skillId) {
  return Boolean(policy) && matches(policy.skills?.allow ?? [], skillId);
}

export function createPresetPolicy({ root, log = () => {} }) {
  if (!root) throw new Error('createPresetPolicy: 缺少 preset 根目录');
  const presetsRoot = path.resolve(root);
  const cache = new Map();

  function fileFor(preset) {
    if (typeof preset !== 'string' || !PRESET_ID_RE.test(preset)) {
      throw new Error('preset 名称不合法');
    }
    const file = path.resolve(presetsRoot, preset, 'extensions.yml');
    if (!file.startsWith(presetsRoot + path.sep)) throw new Error('preset 路径越界');
    return file;
  }

  function read(preset) {
    const file = fileFor(preset);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyPolicy();
      log(`[extensions] preset policy stat 失败 ${preset}: ${error?.message ?? error}`);
      return emptyPolicy();
    }
    const cached = cache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.policy;
    let policy;
    try {
      const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      const parsed = yaml.load(text, { json: true }) ?? {};
      policy = normalizePresetPolicy(parsed);
    } catch (error) {
      log(`[extensions] preset policy 解析失败 ${preset}: ${error?.message ?? error}`);
      policy = emptyPolicy();
    }
    cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, policy });
    return policy;
  }

  return {
    get: read,
    clear(preset) {
      const file = fileFor(preset);
      cache.delete(file);
    },
  };
}
