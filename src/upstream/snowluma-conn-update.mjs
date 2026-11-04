// SnowLuma 连接参数的自愈决策：**发现到的端点该不该用**、**两个 token 各修哪一个**。
//
// 这两条都是踩过的坑，以前埋在 `applyHealedTokens` 里：
//
//   1. **HTTP token 与 WS token 是两个不同的值**（实测：同一账号也不同；config.json 只能
//      存一个，存的是 HTTP 那个）。只修其中一个，桥接仍会以 1006 反复重连。
//   2. **端点跟随是可关的**（`snowluma.followDiscoveredEndpoint: false`）。自愈会拿发现
//      到的 wsUrl 覆盖配置并写回 config.json —— 在「换了账号所以端口变了」时是对的（端口
//      确实是 per-account），但它不区分「用户写的过期值」和「用户就是要指向别处」：想跑
//      第二个实例 / 指向另一份安装时，会被静默改回去，表现为「消息发到了另一个账号」。
//      经接口平台（`snowluma.viaPlatform`）时同样不能跟随——端点只能是平台的兼容入口。
//
// 这里只做决策与算术，**不动物件、不写文件**：调用方拿到结果再去改 `bot.*` / `cfg.*`
// 并落盘，于是「follow=false 时绝不写 URL」这条不变量能在测试里直接断言。

/**
 * @param {object} input
 * @param {{ wsToken: string|undefined, wsUrl: string|undefined }} input.current  客户端当前值
 * @param {{ accessToken?: string, wsUrl?: string }} input.config                config.json 里的值
 * @param {{ token?: string, wsToken?: string, wsUrl?: string, baseUrl?: string, source?: string }} input.discovered
 * @param {boolean} [input.followDiscoveredEndpoint]  配置项，缺省视为 true
 * @param {boolean} [input.viaPlatform]               经接口平台连接时一律不跟随
 */
export function resolveConnectionUpdate({
  current = {},
  config = {},
  discovered = {},
  followDiscoveredEndpoint = true,
  viaPlatform = false,
} = {}) {
  const followEndpoint = followDiscoveredEndpoint !== false && viaPlatform !== true;

  const httpToken = discovered.token ?? config.accessToken ?? '';
  const wsToken = discovered.wsToken || discovered.token || current.wsToken || '';
  const configWsUrl = config.wsUrl ?? current.wsUrl ?? '';
  const wsUrl = followEndpoint ? (discovered.wsUrl || configWsUrl) : configWsUrl;

  const wsChanged = wsToken !== (current.wsToken ?? '') || wsUrl !== (current.wsUrl ?? '');
  // 「发现到的端点与配置不同、但因为开关没跟随」——调用方要能把这件事讲给用户听，
  // 否则用户只会看到「我设的端点没生效」。
  const endpointIgnored = !followEndpoint && Boolean(discovered.wsUrl) && discovered.wsUrl !== configWsUrl;
  const httpTokenChanged = httpToken !== (config.accessToken ?? '');
  // 只有跟随端点时才允许把 URL 写回 config.json；否则持久化会把「用户设的别处」抹掉。
  const persistUrl = followEndpoint && Boolean(wsUrl);

  return {
    followEndpoint,
    httpToken,
    wsToken,
    wsUrl,
    configWsUrl,
    wsChanged,
    httpTokenChanged,
    endpointIgnored,
    persistUrl,
    source: discovered.source ?? '',
  };
}
