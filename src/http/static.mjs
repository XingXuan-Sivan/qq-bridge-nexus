// 静态资源服务：只允许「白名单前缀 → 白名单扩展名 → 根内真实文件」。
// 约定与拒绝清单见 docs/HTTP_BOUNDARY.md §1。这里的原则是「默认拒绝」：
// 任何一步没通过都返回同一个 404，不区分原因、不回显路径。
import fs from 'node:fs';
import path from 'node:path';
import { securityHeaders } from './security.mjs';

export const STATIC_MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
});

// 单文件上限：静态资源都是手写的页面与图片，超过这个体积多半是配错了目录。
const MAX_STATIC_BYTES = 8 * 1024 * 1024;

function reject(reason) {
  return { ok: false, reason };
}

/**
 * 把 URL 路径安全地映射到 root 下的真实文件。
 * @param {string} root 静态根目录（必须是已解析的绝对路径）
 * @param {string} pathname 形如 /console/js/app.js（可含百分号编码）
 * @param {{prefix?: string, index?: string}} [options]
 *   prefix：允许访问的 URL 前缀，例如 '/console/'；默认 '/'。
 *   index：目录尾斜杠时的默认文件，默认 'index.html'。
 * @returns {{ok: true, abs: string, mime: string, size: number} | {ok: false, reason: string}}
 */
export function resolveStaticPath(root, pathname, options = {}) {
  const prefix = options.prefix ?? '/';
  const index = options.index ?? 'index.html';
  if (typeof root !== 'string' || !path.isAbsolute(root)) return reject('root');
  if (typeof pathname !== 'string' || !pathname) return reject('pathname');
  if (!pathname.startsWith(prefix)) return reject('prefix');

  // 只解码一次：解码两次会把 %252e 变成 %2e 再变成 .，等于自己给自己开穿越口子。
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return reject('encoding');
  }
  // 控制字符、反斜杠（Windows 分隔符）与空字节一律拒绝。
  if (/[\0-\x1f\\]/.test(decoded)) return reject('charset');
  // 冒号覆盖盘符（C:）、NTFS 备用流（file.txt::$DATA）与 UNC（\\server\share 已被反斜杠挡住）。
  if (decoded.includes(':')) return reject('colon');

  const relRaw = decoded.slice(prefix.length);
  const rel = relRaw.endsWith('/') || relRaw === '' ? `${relRaw}${index}` : relRaw;
  if (!rel || rel.includes('//')) return reject('segments');

  const abs = path.resolve(root, rel);
  const relToRoot = path.relative(root, abs);
  if (!relToRoot || relToRoot === '..' || relToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relToRoot)) {
    return reject('traversal');
  }

  const mime = STATIC_MIME[path.extname(abs).toLowerCase()];

  let stat;
  try {
    stat = fs.lstatSync(abs);
  } catch {
    return reject('missing');
  }
  // 符号链接一律拒绝：即使它现在指向根内，以后也可能被换成根外。
  if (stat.isSymbolicLink()) return reject('symlink');
  if (!stat.isFile()) return reject('not-file');
  if (!mime) return reject('type');
  if (stat.size > MAX_STATIC_BYTES) return reject('too-large');

  return { ok: true, abs, mime, size: stat.size };
}

/**
 * 把已解析的静态文件写进响应；失败同样回 404（不泄露是因为不存在还是读不了）。
 * @param {import('node:http').ServerResponse} res
 * @param {ReturnType<typeof resolveStaticPath>} resolved
 */
export function serveStaticFile(res, resolved) {
  if (!resolved?.ok) {
    res.writeHead(404, securityHeaders({ 'content-type': 'application/json; charset=utf-8' }));
    res.end(JSON.stringify({ ok: false, error: 'not found' }, null, 2));
    return false;
  }
  let body;
  try {
    body = fs.readFileSync(resolved.abs);
  } catch {
    res.writeHead(404, securityHeaders({ 'content-type': 'application/json; charset=utf-8' }));
    res.end(JSON.stringify({ ok: false, error: 'not found' }, null, 2));
    return false;
  }
  res.writeHead(200, securityHeaders({
    'content-type': resolved.mime,
    'content-length': String(body.length),
  }));
  res.end(body);
  return true;
}

/** 给未知端点用的统一 404（语义见 docs/HTTP_BOUNDARY.md §2）。 */
export function sendNotFound(res) {
  res.writeHead(404, securityHeaders({ 'content-type': 'application/json; charset=utf-8' }));
  res.end(JSON.stringify({ ok: false, error: 'not found' }, null, 2));
}
