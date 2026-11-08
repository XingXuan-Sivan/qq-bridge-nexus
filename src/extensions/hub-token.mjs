// Hub 自己的凭据：只存在本机 state 目录，0600。
// 用途：mcp-bridge-ext 进程调 bridge 的 /api/extensions/hub/*，证明「我是本机 Hub」；
// 真正的会话身份仍由 x-agent-token 提供。两者分开，避免把控制台全权令牌交给 MCP 子进程。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TOKEN_BYTES = 24;
const TOKEN_RE = /^[0-9a-f]{48}$/;

export function ensureHubToken(file, { log = () => {} } = {}) {
  const target = path.resolve(file);
  try {
    const existing = fs.readFileSync(target, 'utf8').trim();
    if (TOKEN_RE.test(existing)) return existing;
    log('[extensions] hub token 文件内容无效，重新生成');
  } catch (error) {
    if (error?.code !== 'ENOENT') log(`[extensions] hub token 读取失败: ${error?.message ?? error}`);
  }
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, token + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, target);
  try { fs.chmodSync(target, 0o600); } catch {}
  log('[extensions] 已生成本机 Hub 凭据');
  return token;
}

export function hubTokenMatches(supplied, expected) {
  const a = Buffer.from(String(supplied ?? ''), 'utf8');
  const b = Buffer.from(String(expected ?? ''), 'utf8');
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
