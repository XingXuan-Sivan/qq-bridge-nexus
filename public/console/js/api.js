// 控制台 API 客户端：令牌的保存与 JSON 请求都在这里，页面代码只管「调哪个接口」。
//
// 令牌有两个来源：URL 的 ?token=（首次打开控制台时由 401 门页引导）与 localStorage
// （同一浏览器后续访问）。401 不再弹原生 prompt——那和门页是两套登录 UI；统一跳回门页
// 重新登录，并带上当前 hash 与 reauth=1（服务端据此强制回门页、忽略仍然有效的 cookie）。

/** 从 ?token= 落盘的引导逻辑；入口脚本在启动时调一次。 */
export function bootstrapConsoleToken() {
  const qs = new URLSearchParams(location.search);
  const token = qs.get('token');
  if (token) {
    localStorage.setItem('consoleToken', token);
    history.replaceState({}, '', location.pathname + location.hash);
  }
}

let reauthing = false;

/**
 * 统一的 API 请求。
 * 401 说明页面手里的令牌已经不能用了（换过令牌、或 localStorage 被清过）：
 * 交给门页重新登录，登录后按 hash 回到原来那一页。不在控制台里再放一个登录弹窗。
 */
export async function api(path, method, body) {
  const verb = String(method || 'GET').toUpperCase();
  const hasBody = body !== undefined && body !== null;
  // 写请求一律带 application/json 和 JSON 体：服务端的 CSRF 校验只接受 JSON 请求。
  // 以前「没有 body 就不带 content-type」，于是「重建会话」「重载插件」这类无参 POST
  // 会被拦成 415「请求必须是 application/json」。
  const headers = verb === 'GET' ? {} : { 'content-type': 'application/json' };
  const payload = verb === 'GET' ? undefined : JSON.stringify(hasBody ? body : {});
  const token = localStorage.getItem('consoleToken');
  if (token) headers['x-console-token'] = token;
  const res = await fetch(path, { method: verb, headers, body: payload });
  if (res.status === 401) {
    // reauth=1 让服务端忽略仍然有效的页面 cookie 强制返回门页——否则「cookie 有效但
    // 页面拿不到令牌」会变成 401 → 控制台 → 401 的循环。
    if (!reauthing) {
      reauthing = true;
      location.replace('/?reauth=1' + (location.hash || ''));
    }
    throw new Error('未授权');
  }
  return res.json();
}
