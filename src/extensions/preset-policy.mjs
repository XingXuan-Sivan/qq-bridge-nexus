// 预设级扩展策略：每个能力档用自己的 extensions 段声明允许哪些外部 MCP / 工具 / 技能。
// 缺省为空 = 全部拒绝；只读，不反向写。
//
// C4 起不再有独立的 extensions.yml：能力档 id = Agent 预设 id，这份策略就住在
// profiles/agent-platforms/dsh/capabilities/<id>.yml 的 extensions 段（Hub 与预设编辑器读同一处）。
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

/**
 * 策略提供者。@param {{ capabilities: object, log?: Function }} options
 * capabilities 是 createCapabilityStore() 的返回值（需要 root 与 get(id)）。
 * 缓存按能力档文件的 mtime/size 失效：权限检查在每条外部工具调用上都会发生，每次都重新
 * 解析几千字符的预设正文太贵，但改了 extensions 段又必须立刻生效。
 */
export function createPresetPolicy({ capabilities, log = () => {} }) {
  if (!capabilities?.root || typeof capabilities.get !== 'function') {
    throw new Error('createPresetPolicy: 缺少能力档存储');
  }
  const root = path.resolve(capabilities.root);
  const cache = new Map();

  function fileFor(preset) {
    if (typeof preset !== 'string' || !PRESET_ID_RE.test(preset)) {
      throw new Error('preset 名称不合法');
    }
    const file = path.resolve(root, `${preset}.yml`);
    if (!file.startsWith(root + path.sep)) throw new Error('preset 路径越界');
    return file;
  }

  function read(preset) {
    let file;
    try {
      file = fileFor(preset);
    } catch {
      log(`[extensions] preset 名称不合法：${preset}`);
      return emptyPolicy();
    }
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
      policy = normalizePresetPolicy(capabilities.get(preset)?.extensions ?? {});
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
      try {
        cache.delete(fileFor(preset));
      } catch {}
    },
  };
}
