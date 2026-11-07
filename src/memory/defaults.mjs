// 记忆子系统的默认值。集中放这里，避免 registry / bridge / 控制台三处各写一份。
export const MEMORY_INJECT_DEFAULT_CHARS = 2400;
export const MEMORY_CACHE_TTL_MS = 60_000;
export const MEMORY_TIMEOUT_MS = 900;

// local-digest（旧的轻量记忆）默认上限：与迁移前 formatMemoryV2 的硬编码保持一致，
// 这样不配 memory.providers['local-digest'].limits 时行为等价。
export const LOCAL_DIGEST_LIMITS = Object.freeze({
  topics: 10,
  thoughts: 10,
  impressions: 10,
  impressionsMax: 50,
  topicStaleHours: 24,
  itemChars: 200,
});
