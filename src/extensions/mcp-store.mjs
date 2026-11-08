// 外部 MCP 配置存储：一条 server 一个目录 extensions/mcp/<id>/server.json。
// 这里只做静态校验与持久化；连接/调用在 mcp-runtime，授权在 hub + preset-policy。
import fs from 'node:fs';
import path from 'node:path';

export const MCP_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
export const MCP_TRANSPORTS = ['stdio', 'streamable_http', 'sse'];
export const STDIO_ALLOWLIST = [
  'node', 'npx', 'python', 'python3', 'uv', 'uvx', 'deno', 'bun', 'bunx',
];
const SECRET_REF_RE = /^secret:[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_KEY_RE = /^[A-Za-z0-9-]{1,80}$/;
const MAX_ARGS = 64;
const MAX_ARG_CHARS = 2000;
const MAX_SECRET_REFS = 40;

export class McpStoreError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'McpStoreError';
    this.code = code;
  }
}

function text(value, label, max = 500) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new McpStoreError(`${label} 必须是字符串`);
  const out = value.trim();
  if (out.length > max) throw new McpStoreError(`${label} 过长`);
  if (out.includes('\0')) throw new McpStoreError(`${label} 含非法字符`);
  return out;
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function secretRefs(map, label) {
  if (map == null) return {};
  if (typeof map !== 'object' || Array.isArray(map)) throw new McpStoreError(`${label} 必须是对象`);
  const out = {};
  for (const [key, value] of Object.entries(map)) {
    if (Object.keys(out).length >= MAX_SECRET_REFS) throw new McpStoreError(`${label} 条目过多`);
    const name = label === 'env' ? key : key;
    const keyOk = label === 'env' ? ENV_KEY_RE.test(name) : HEADER_KEY_RE.test(name);
    if (!keyOk) throw new McpStoreError(`${label} 名称不合法：${name}`);
    if (typeof value !== 'string' || !SECRET_REF_RE.test(value)) {
      throw new McpStoreError(`${label}.${name} 只能填写 secret:<name> 引用`);
    }
    out[name] = value;
  }
  return out;
}

function commandName(command) {
  const base = path.basename(String(command)).toLowerCase().replace(/\.(exe|cmd|bat)$/i, '');
  return base;
}

function isPrivateHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  if (host === '0.0.0.0' || host === '169.254.169.254' || host === '100.100.100.200') return true;
  if (host.startsWith('127.') || host.startsWith('10.') || host.startsWith('192.168.')) return true;
  const m = /^172\.(\d{1,2})\./.exec(host);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  return false;
}

function metadataHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  return host === '169.254.169.254'
    || host === 'metadata.google.internal'
    || host === '100.100.100.200'
    || host === 'metadata';
}

function normalizeTimeout(value, fallback, label) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1000 || n > 300000) throw new McpStoreError(`${label} 必须在 1000–300000ms 之间`);
  return Math.round(n);
}

export function normalizeMcpConfig(raw, { id, now = Date.now, previous = null } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new McpStoreError('配置必须是对象');
  const serverId = String(id ?? raw.id ?? '');
  if (!MCP_ID_RE.test(serverId)) throw new McpStoreError('id 必须是小写字母开头的 2–40 位小写字母/数字/短横线');
  const transport = String(raw.transport ?? previous?.transport ?? 'stdio');
  if (!MCP_TRANSPORTS.includes(transport)) throw new McpStoreError('transport 只能是 stdio / streamable_http / sse');
  const base = {
    schemaVersion: 1,
    id: serverId,
    name: text(raw.name ?? previous?.name ?? serverId, '名称', 80) || serverId,
    description: text(raw.description ?? previous?.description ?? '', '说明', 500),
    transport,
    enabled: bool(raw.enabled, previous?.enabled ?? true),
    trust: text(raw.trust ?? previous?.trust ?? 'owner', 'trust', 40) || 'owner',
    timeoutMs: normalizeTimeout(raw.timeoutMs ?? previous?.timeoutMs, 60000, '调用超时'),
    createdAt: Number(previous?.createdAt) > 0 ? Number(previous.createdAt) : now(),
    updatedAt: now(),
  };
  if (transport === 'stdio') {
    const command = text(raw.command ?? previous?.command ?? '', '命令', 300);
    if (!command) throw new McpStoreError('stdio 必须填写命令');
    const name = commandName(command);
    const arbitrary = bool(raw.allowArbitraryCommand, previous?.allowArbitraryCommand ?? false);
    if (!arbitrary && !STDIO_ALLOWLIST.includes(name)) {
      throw new McpStoreError(`stdio 命令 ${name || '(空)'} 不在允许列表内；确需使用请显式开启 allowArbitraryCommand`);
    }
    const argsRaw = raw.args ?? previous?.args ?? [];
    if (!Array.isArray(argsRaw) || argsRaw.length > MAX_ARGS) throw new McpStoreError('args 必须是最多 64 项的数组');
    const args = argsRaw.map((arg, i) => {
      const item = text(arg, `args[${i}]`, MAX_ARG_CHARS);
      if (item.length === 0) throw new McpStoreError(`args[${i}] 不能为空`);
      return item;
    });
    const cwd = text(raw.cwd ?? previous?.cwd ?? '', 'cwd', 500);
    if (cwd && !path.isAbsolute(cwd)) throw new McpStoreError('cwd 必须是绝对路径');
    return {
      ...base,
      command,
      args,
      cwd: cwd || null,
      env: secretRefs(raw.env ?? previous?.env ?? {}, 'env'),
      allowArbitraryCommand: arbitrary,
    };
  }
  const urlText = text(raw.url ?? previous?.url ?? '', 'URL', 1000);
  let url;
  try {
    url = new URL(urlText);
  } catch {
    throw new McpStoreError('URL 格式不合法');
  }
  if (!['https:', 'http:'].includes(url.protocol)) throw new McpStoreError('URL 只支持 http/https');
  if (url.username || url.password) throw new McpStoreError('URL 不能内嵌账号密码');
  if (metadataHost(url.hostname)) throw new McpStoreError('不允许连接云元数据地址');
  const allowPrivate = bool(raw.allowPrivateNetwork, previous?.allowPrivateNetwork ?? false);
  if (url.protocol === 'http:' && !allowPrivate) throw new McpStoreError('HTTP 地址需要显式开启 allowPrivateNetwork');
  if (!allowPrivate && isPrivateHost(url.hostname)) throw new McpStoreError('私网地址需要显式开启 allowPrivateNetwork');
  return {
    ...base,
    url: url.toString(),
    headers: secretRefs(raw.headers ?? previous?.headers ?? {}, 'headers'),
    allowPrivateNetwork: allowPrivate,
  };
}

export function createMcpStore({ root, now = Date.now, log = () => {} }) {
  if (!root) throw new Error('createMcpStore: 缺少扩展根目录');
  const rootDir = path.resolve(root);
  fs.mkdirSync(rootDir, { recursive: true });

  function dirFor(id) {
    if (!MCP_ID_RE.test(String(id))) throw new McpStoreError('id 不合法');
    const dir = path.resolve(rootDir, id);
    if (!dir.startsWith(rootDir + path.sep)) throw new McpStoreError('路径越界');
    return dir;
  }

  function fileFor(id) {
    return path.join(dirFor(id), 'server.json');
  }

  function writeAtomic(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (error) {
      try { fs.unlinkSync(tmp); } catch {}
      throw error;
    }
  }

  function readRaw(id) {
    const file = fileFor(id);
    let textValue;
    try {
      textValue = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    } catch (error) {
      if (error?.code === 'ENOENT') throw new McpStoreError(`外部 MCP 不存在：${id}`, 'not_found');
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(textValue);
    } catch {
      throw new McpStoreError(`外部 MCP 配置损坏：${id}`, 'invalid');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new McpStoreError(`外部 MCP 配置损坏：${id}`, 'invalid');
    return parsed;
  }

  function get(id) {
    const raw = readRaw(id);
    return normalizeMcpConfig(raw, { id, now, previous: raw });
  }

  function list() {
    const out = [];
    let entries = [];
    try {
      entries = fs.readdirSync(rootDir, { withFileTypes: true });
    } catch (error) {
      log(`[extensions] mcp 目录读取失败: ${error?.message ?? error}`);
      return out;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || !MCP_ID_RE.test(entry.name)) continue;
      try {
        out.push(get(entry.name));
      } catch (error) {
        out.push({
          schemaVersion: 1,
          id: entry.name,
          name: entry.name,
          description: '',
          transport: 'stdio',
          enabled: false,
          trust: 'owner',
          error: error?.message ?? String(error),
          invalid: true,
        });
      }
    }
    return out;
  }

  function save(id, input, { create = true } = {}) {
    if (!MCP_ID_RE.test(String(id))) throw new McpStoreError('id 必须是小写字母开头的 2–40 位小写字母/数字/短横线');
    const exists = fs.existsSync(fileFor(id));
    if (create && exists) throw new McpStoreError(`外部 MCP 已存在：${id}`, 'exists');
    if (!create && !exists) throw new McpStoreError(`外部 MCP 不存在：${id}`, 'not_found');
    const previous = exists ? readRaw(id) : null;
    const merged = { ...(previous ?? {}), ...input, id };
    const config = normalizeMcpConfig(merged, { id, now, previous });
    writeAtomic(fileFor(id), config);
    log(`[extensions] 保存外部 MCP ${id} (${config.transport})`);
    return config;
  }

  function remove(id) {
    const dir = dirFor(id);
    if (!fs.existsSync(dir)) throw new McpStoreError(`外部 MCP 不存在：${id}`, 'not_found');
    fs.rmSync(dir, { recursive: true, force: true });
    log(`[extensions] 删除外部 MCP ${id}`);
    return { id, removed: true };
  }

  return { root: rootDir, dirFor, fileFor, list, get, save, remove };
}
