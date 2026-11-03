// 控制台 API 客户端：令牌的保存/重试与 JSON 请求都在这里，页面代码只管「调哪个接口」。
//
// 令牌有三个来源，优先级从高到低：URL 的 ?token=（首次打开控制台时由服务端 401 页引导）、
// localStorage（同一浏览器后续访问）、以及 401 时的手动输入。令牌只存在本机浏览器，不回显。

/** 从 ?token= 落盘的引导逻辑；入口脚本在启动时调一次。 */
export function bootstrapConsoleToken() {
  const qs = new URLSearchParams(location.search);
  const token = qs.get('token');
  try { sessionStorage.removeItem('consoleTokenTried'); } catch { /* 隐私模式下不可用，忽略 */ }
  if (token) {
    localStorage.setItem('consoleToken', token);
    history.replaceState({}, '', location.pathname + location.hash);
  }
}

/**
 * 统一的 API 请求。
 * 401 时最多重试两次：先弹窗要令牌，要不到就清掉本地令牌并抛错。
 */
export async function api(path, method, body, _retried = 0) {
  const headers = body ? { 'content-type': 'application/json' } : {};
  const token = localStorage.getItem('consoleToken');
  if (token) headers['x-console-token'] = token;
  const res = await fetch(path, { method: method || 'GET', headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) {
    if (_retried >= 2) {
      localStorage.removeItem('consoleToken');
      throw new Error('未授权');
    }
    const t = prompt('请输入控制台访问令牌：');
    if (t) {
      localStorage.setItem('consoleToken', t.trim());
      return api(path, method, body, _retried + 1);
    }
    localStorage.removeItem('consoleToken');
    throw new Error('未授权');
  }
  return res.json();
}
