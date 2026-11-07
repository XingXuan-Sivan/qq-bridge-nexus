// 记忆写回（ingest）队列：把 QQ 会话里的 user / assistant 文本攒成事件，批量写给记忆服务。
//
// 设计取舍（docs/MEMORY_SUBSYSTEM.md S5）：
// - 默认关闭：写回会把对话文本发给外部服务，必须由用户显式打开；
// - 关闭时一行都不发，连队列也不建（audit 断言「关闭时无外发请求」）；
// - 队列落盘到 state/，soulkit 停机或桥接重启不丢；成功才删；
// - 单批失败只保留队列并记 lastError，不抛给调用方——消息处理不能被记忆服务拖死。
import fs from 'node:fs';
import path from 'node:path';

export const INGEST_DEFAULTS = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:3110',
  maxQueue: 200,
  batchSize: 40,
  flushIntervalMs: 1500,
  timeoutMs: 5000,
};

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function trimUrl(value, fallback) {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return text.replace(/\/+$/, '');
}

/** 只认 http(s)；写回地址不允许是空串或奇怪的协议。 */
export function normalizeIngestConfig(raw = {}, fallback = INGEST_DEFAULTS) {
  const baseUrl = trimUrl(raw.baseUrl, fallback.baseUrl);
  return {
    enabled: raw.enabled === true,
    baseUrl: /^https?:\/\//.test(baseUrl) ? baseUrl : fallback.baseUrl,
    maxQueue: clampInt(raw.maxQueue, 10, 2000, fallback.maxQueue),
    batchSize: clampInt(raw.batchSize, 1, 200, fallback.batchSize),
    flushIntervalMs: clampInt(raw.flushIntervalMs, 500, 60_000, fallback.flushIntervalMs),
    timeoutMs: clampInt(raw.timeoutMs, 300, 30_000, fallback.timeoutMs),
  };
}

/** QQ 会话键 → soulkit 的 chat 标识（`qq:group:123` → `group:123`）。 */
export function ingestChat(key) {
  const text = String(key ?? '');
  const match = /^[a-z][a-z0-9-]{0,15}:((?:group|private):\d+)$/i.exec(text);
  return match ? match[1] : text;
}

function eventOf({ key, role, text, ts, sender, name, id, origin }) {
  return {
    platform: 'qq',
    chat: ingestChat(key),
    ts: Number(ts) || Date.now(),
    role: role === 'assistant' ? 'assistant' : 'user',
    text: String(text ?? '').slice(0, 4000),
    sender: { account: String(sender ?? 'unknown'), displayName: String(name ?? '') },
    origin: String(origin ?? 'qq'),
    sourceId: String(id ?? ''),
  };
}

export function createMemoryIngest({ log = () => {}, config = {}, stateFile, now = Date.now, fetchImpl = fetch } = {}) {
  let current = normalizeIngestConfig(config);
  let queue = [];
  let timer = null;
  let flushing = false;
  const stats = { enqueued: 0, sent: 0, accepted: 0, batches: 0, failed: 0, lastError: '', lastAt: 0, lastStatus: 'idle' };

  function persist() {
    if (!stateFile) return;
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      if (!queue.length) {
        fs.rmSync(stateFile, { force: true });
        return;
      }
      fs.writeFileSync(stateFile, JSON.stringify({ queue }), 'utf8');
    } catch (error) {
      log(`⚠️ [memory] 写回队列落盘失败：${error?.message ?? error}`);
    }
  }

  function restore() {
    if (!stateFile || !fs.existsSync(stateFile)) return 0;
    try {
      const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (Array.isArray(raw?.queue)) queue = raw.queue.slice(-current.maxQueue);
      return queue.length;
    } catch {
      return 0;
    }
  }

  /** 入队：关闭时直接返回 false，不产生任何副作用（也不落盘）。 */
  function enqueue(input) {
    if (!current.enabled) return false;
    const event = eventOf(input ?? {});
    if (!event.text.trim() || !event.chat) return false;
    queue.push(event);
    if (queue.length > current.maxQueue) queue.splice(0, queue.length - current.maxQueue);
    stats.enqueued += 1;
    persist();
    return true;
  }

  async function flush() {
    if (!current.enabled || flushing || !queue.length) return { ok: true, skipped: true };
    flushing = true;
    const batch = queue.slice(0, current.batchSize);
    try {
      const response = await fetchImpl(`${current.baseUrl}/api/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(current.timeoutMs),
      });
      stats.batches += 1;
      stats.lastAt = now();
      stats.lastStatus = response.ok ? 'ok' : 'error';
      if (!response.ok) {
        stats.failed += 1;
        stats.lastError = `HTTP ${response.status}`;
        return { ok: false, error: stats.lastError, pending: queue.length };
      }
      let accepted = 0;
      try {
        const body = await response.json();
        accepted = Number(body?.accepted) || 0;
      } catch {
        accepted = 0;
      }
      stats.sent += batch.length;
      stats.accepted += accepted || batch.length;
      stats.lastError = '';
      queue.splice(0, batch.length);
      persist();
      return { ok: true, sent: batch.length, accepted, pending: queue.length };
    } catch (error) {
      stats.failed += 1;
      stats.lastAt = now();
      stats.lastStatus = 'error';
      stats.lastError = error?.message ?? String(error);
      return { ok: false, error: stats.lastError, pending: queue.length };
    } finally {
      flushing = false;
    }
  }

  function tick() {
    if (!current.enabled) return;
    flush().catch(() => {});
  }

  function start() {
    if (timer) return;
    restore();
    timer = setInterval(tick, current.flushIntervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function setConfig(next = {}) {
    current = normalizeIngestConfig({ ...current, ...next }, current);
    if (current.enabled) start();
    else {
      stop();
      // 关闭时清空队列：避免“关了还在偷偷攒”，也让状态里的 pending 归零。
      queue = [];
      persist();
    }
    return current;
  }

  function status() {
    return {
      ...current,
      pending: queue.length,
      ...stats,
      flushing,
    };
  }

  return { enqueue, flush, start, stop, status, setConfig, getConfig: () => ({ ...current }), restore };
}
