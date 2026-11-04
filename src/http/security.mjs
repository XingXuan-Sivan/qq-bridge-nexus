// 安全响应头：集中一处，避免各请求分支各写一份导致「有的页面有 CSP、有的没有」。
// 约定见 docs/HTTP_BOUNDARY.md §3。改这里等于改全部 HTTP 响应，务必跑 test:audit。

// 控制台已完全外置：主题引导是 /console/js/theme-boot.js，样式全是 <link>，
// HTML 里不再有内联 <style>/<script> 与 style 属性（2026-11-05 收口），所以这里不再放 'unsafe-inline'。
// 动态宽度（搜索候选框定位、用量进度条）走 CSSOM 写入，不受 style-src 限制。
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
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
