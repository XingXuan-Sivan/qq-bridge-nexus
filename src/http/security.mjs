// 安全响应头：集中一处，避免各请求分支各写一份导致「有的页面有 CSP、有的没有」。
// 约定见 docs/HTTP_BOUNDARY.md §3。改这里等于改全部 HTTP 响应，务必跑 test:audit。

// 现状（2026-11-04）：控制台仍是单文件内联样式/脚本，所以暂时保留 'unsafe-inline'。
// 前端分层（PLUGIN_ROADMAP §8.7）完成后收成 script-src 'self'; style-src 'self'。
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export const SECURITY_HEADERS = Object.freeze({
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
});

/** 在安全头基础上追加/覆盖本次响应特有的头（不修改冻结的原对象）。 */
export function securityHeaders(extra = {}) {
  return { ...SECURITY_HEADERS, ...extra };
}
