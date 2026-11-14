// QQ（OneBot v11 HTTP）出站实现：中立段 → OneBot 动作 → HTTP POST。
//
// 这段代码原先散在 bridge.js 的四处（语音 / 表情 / 搜图 / 文本），每处都自带一份
// 「拼 URL、加鉴权头、判 status/retcode、认 426」。收进适配器之后：
//   · 内核只调 `sendAction(address, segments)`，不认识 OneBot 动作名；
//   · 加新平台是新增一个适配器目录，不是再来四处 copy-paste。
//
// 后端地址与 token 用**提供者函数**注入而不是模块级常量：bridge 的 config 是可热改的
// （控制台改当前平台的 `transport.httpUrl` 后不必重启），每次发送都读当下的值，行为与收口前一致。
import { oneBotSendCall } from './onebot.mjs';
import { toOneBotSegments } from './segments.mjs';

const DEFAULT_HTTP_URL = 'http://127.0.0.1:3000';
const DEFAULT_TIMEOUT_MS = 15000;

/** @type {() => {httpUrl?: string, accessToken?: string, fetch?: Function}} */
let backendProvider = () => ({});

/**
 * 注入后端配置来源（bridge 启动时调用一次）。
 * 返回 { httpUrl, accessToken, fetch }；缺失的键用默认值。
 */
export function setOneBotBackend(provider) {
  backendProvider = typeof provider === 'function' ? provider : () => ({});
}

/** 测试用：恢复成「什么都没配」的默认状态。 */
export function resetOneBotBackend() {
  backendProvider = () => ({});
}

function resolveBackend() {
  let raw = {};
  try {
    raw = backendProvider() ?? {};
  } catch {
    raw = {};
  }
  const httpUrl = String(raw.httpUrl || DEFAULT_HTTP_URL).replace(/\/+$/, '');
  const accessToken = String(raw.accessToken || '');
  const fetchImpl = typeof raw.fetch === 'function' ? raw.fetch : globalThis.fetch;
  return { httpUrl, accessToken, fetchImpl };
}

/**
 * 发送一组中立段（已由内核校验与降级）。
 *
 * @param {{address: {platform: string, account: string, conversation: {type: string, id: string}},
 *          segments: unknown[], opts?: {timeoutMs?: number}}} payload
 * @returns {Promise<{messageId: string|null, raw: any}>}
 */
export async function sendOneBotAction({ address, segments, opts = {} }) {
  const { httpUrl, accessToken, fetchImpl } = resolveBackend();
  const conversation = address?.conversation ?? {};
  const { action, params } = oneBotSendCall(conversation.type, conversation.id, toOneBotSegments(segments));
  const timeoutMs = Math.max(1000, Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS);

  const res = await fetchImpl(`${httpUrl}/${action}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.status !== 'ok' || body.retcode !== 0) {
    // 426 几乎只有一个原因：httpUrl 指到了 WebSocket 端口。这条提示原先在四处各写一遍，
    // 措辞还不一样；现在统一到一处，排障时只有一种说法。
    const hint = res.status === 426 ? '（HTTP 426：httpUrl 可能指向了 WebSocket 端口，请检查 config.json 里当前平台的 transport.httpUrl 是否为 OneBot HTTP API 地址）' : '';
    throw new Error(`OneBot ${action} 失败: ${body.wording || body.retcode || res.status}${hint}`);
  }
  const messageId = body.data?.message_id ?? null;
  return { messageId: messageId === null ? null : String(messageId), raw: body.data ?? null };
}
