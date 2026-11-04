// DSH 探活策略：**什么时候探、探不到时要不要重新识别地址**。
//
// 为什么单独拆出来：这段以前长在 `checkDsh` 里，和「健康度记账 / 模式刷新 / 队列补投」搅在
// 同一个闭包里，只能靠起整桥接 + 关掉 DSH 来验证。真正容易写错的是两个**策略**：
//
//   1. 自动识别地址（`dsh.baseUrl` 留空）时，DSH 每次启动都换随机端口 —— 只在启动时
//      识别一次的话，DSH 重启后桥接就再也连不上；
//   2. 但重新识别不能每 5 秒来一次：`resolveDshBaseUrl` 要扫进程/端口，代价不小。
//      这里按 `rediscoverIntervalMs`（默认 10s）节流，**且只在探活失败时触发**。
//
// 探活/识别/改地址都由调用方注入，所以这里可以纯函数式地测「失败才重识别」「重识别只
// 在节流窗口外发生」「重识别成功但探活仍失败时如实返回 false」。

const DEFAULT_REDISCOVER_MS = 10_000;

/**
 * @param {object} deps
 * @param {() => Promise<void>} deps.probe          探活一次（抛错即失败）
 * @param {() => Promise<{ reachable: boolean, url?: string } | null>} deps.rediscover  重新识别地址
 * @param {(url: string) => void} deps.applyUrl     把识别到的地址应用到客户端
 * @param {() => boolean} deps.isAutoBaseUrl        当前是否处于「地址留空、自动识别」状态
 * @param {() => number} [deps.now]
 * @param {number} [deps.rediscoverIntervalMs]
 * @param {(message: string) => void} [deps.log]
 */
export function createDshProbe({
  probe,
  rediscover,
  applyUrl,
  isAutoBaseUrl,
  now = () => Date.now(),
  rediscoverIntervalMs = DEFAULT_REDISCOVER_MS,
  log = () => {},
} = {}) {
  if (typeof probe !== 'function') throw new TypeError('createDshProbe: probe 必须是函数');
  if (typeof rediscover !== 'function') throw new TypeError('createDshProbe: rediscover 必须是函数');
  if (typeof applyUrl !== 'function') throw new TypeError('createDshProbe: applyUrl 必须是函数');
  if (typeof isAutoBaseUrl !== 'function') throw new TypeError('createDshProbe: isAutoBaseUrl 必须是函数');

  let lastRediscoverAt = 0;
  // 首轮允许立即重识别（0 - 0 < interval 会挡住第一轮，所以用 null 表示「还没试过」）。
  let everRediscovered = false;

  const throttled = () => everRediscovered && now() - lastRediscoverAt < rediscoverIntervalMs;

  /**
   * 探一次；失败且处于自动识别模式时，按节流窗口重新识别地址并重试一次。
   * @returns {Promise<{ ok: boolean, error: Error|null, rediscovered: boolean, url: string|null }>}
   */
  async function check() {
    let error = null;
    try {
      await probe();
      return { ok: true, error: null, rediscovered: false, url: null };
    } catch (e) {
      error = e instanceof Error ? e : new Error(String(e ?? '探活失败'));
    }

    if (!isAutoBaseUrl() || throttled()) {
      return { ok: false, error, rediscovered: false, url: null };
    }

    everRediscovered = true;
    lastRediscoverAt = now();

    let endpoint = null;
    try {
      endpoint = await rediscover();
    } catch {
      return { ok: false, error, rediscovered: false, url: null };
    }
    if (!endpoint?.reachable || !endpoint.url) {
      return { ok: false, error, rediscovered: false, url: null };
    }

    applyUrl(endpoint.url);
    log(`DSH 地址已变化，重新识别为 ${endpoint.url}`);
    try {
      await probe();
      return { ok: true, error: null, rediscovered: true, url: endpoint.url };
    } catch (e) {
      // 识别到了新地址但连不上：如实报失败，让上层去记账（别把「改了地址」当成「已恢复」）。
      return {
        ok: false,
        error: e instanceof Error ? e : new Error(String(e ?? '探活失败')),
        rediscovered: true,
        url: endpoint.url,
      };
    }
  }

  return { check };
}
