/**
 * 会话标识（session key）：`<platform>:<group|private>:<id>`，例如 `qq:group:903621673`。
 *
 * 为什么不继续用 `group:<id>` / `private:<id>`（P8）：
 *   旧形态把「平台」写死成 QQ——同一个 key 在 Discord/Telegram 接入时无法表达，
 *   而 key 是 sessions.json / 模式判定 / 定时任务 target / 控制台会话列表的共同主键。
 *   趁只有一个平台时一次性迁到带平台前缀的形态，以后加平台不改内核。
 *
 * 兼容策略：
 *   - `isSessionKey()` 只认新形态（写入侧用它校验）；
 *   - `parseKey()` / `legacyToKey()` 接受旧形态（读取侧与迁移脚本用），
 *     这样迁移期间新旧数据同时可读，不需要"停服改完再开"。
 */

/** 默认平台：配置里没写 `platform.id` 时用它（单平台部署不需要改配置） */
export const DEFAULT_PLATFORM = 'qq';

/** 平台名：小写字母开头，允许小写字母/数字/连字符，最长 16 字符 */
const PLATFORM_RE = /^[a-z][a-z0-9-]{0,15}$/;
/** 会话类型：目前只有群聊与私聊 */
const KIND_RE = /^(group|private)$/;
/** 群号/QQ 号：纯数字（OneBot 的 id 是 int64，序列化可能是数字或字符串） */
const ID_RE = /^\d+$/;

/** 新形态：`<platform>:<kind>:<id>` */
const KEY_RE = /^([a-z][a-z0-9-]{0,15}):(group|private):(\d+)$/;
/** 旧形态：`<kind>:<id>`（只有 QQ 时代的数据长这样） */
const LEGACY_RE = /^(group|private):(\d+)$/;

/** 配置里的平台名（`cfg.platform.id`），非法或缺省时回落 `qq` */
export function platformOfConfig(cfg, fallback = DEFAULT_PLATFORM) {
  const raw = cfg?.platform?.id;
  if (typeof raw !== 'string') return fallback;
  const id = raw.trim().toLowerCase();
  return PLATFORM_RE.test(id) ? id : fallback;
}

/**
 * 组装 key。参数不合法时抛错——这里宁可在写日志/写状态前炸掉，
 * 也不要悄悄写出一个 `undefined:group:NaN` 这种永远匹配不上的 key。
 */
export function formatKey(platform, kind, id) {
  const p = String(platform ?? '').trim().toLowerCase();
  const k = String(kind ?? '').trim();
  const i = String(id ?? '').trim();
  if (!PLATFORM_RE.test(p)) throw new Error(`会话 key 的平台名不合法：${JSON.stringify(platform)}`);
  if (!KIND_RE.test(k)) throw new Error(`会话 key 的类型不合法：${JSON.stringify(kind)}（只支持 group/private）`);
  if (!ID_RE.test(i)) throw new Error(`会话 key 的 id 不合法：${JSON.stringify(id)}（只支持数字）`);
  return `${p}:${k}:${i}`;
}

/** 解析 key（新旧形态都认），返回 `{ platform, kind, id }`；不合法返回 null */
export function parseKey(key) {
  if (typeof key !== 'string') return null;
  const modern = KEY_RE.exec(key);
  if (modern) return { platform: modern[1], kind: modern[2], id: Number(modern[3]) };
  const legacy = LEGACY_RE.exec(key);
  if (legacy) return { platform: DEFAULT_PLATFORM, kind: legacy[1], id: Number(legacy[2]) };
  return null;
}

/** 只认新形态（写入侧校验用） */
export function isSessionKey(key) {
  return typeof key === 'string' && KEY_RE.test(key);
}

/** 旧形态转新形态；已经是新形态的原样返回；不认识返回 null */
export function legacyToKey(key, platform = DEFAULT_PLATFORM) {
  if (isSessionKey(key)) return key;
  const legacy = LEGACY_RE.exec(typeof key === 'string' ? key : '');
  if (!legacy) return null;
  return formatKey(platform, legacy[1], legacy[2]);
}

/** 取平台名（新旧形态都认）；不合法返回 null */
export function platformOfKey(key) {
  return parseKey(key)?.platform ?? null;
}

/** 取会话类型（`group` / `private`）；不合法返回 null */
export function kindOfKey(key) {
  return parseKey(key)?.kind ?? null;
}

/** 取数字 id；不合法返回 null */
export function idOfKey(key) {
  return parseKey(key)?.id ?? null;
}

/** 两个 key 是否指同一个会话（`qq:group:1` 与 `group:1` 视为同一个） */
export function sameSession(a, b) {
  const pa = parseKey(a);
  const pb = parseKey(b);
  if (!pa || !pb) return false;
  return pa.platform === pb.platform && pa.kind === pb.kind && pa.id === pb.id;
}

/** 是否群聊 key（新旧形态都认） */
export function isGroupKey(key) {
  return kindOfKey(key) === 'group';
}

/** 是否私聊 key（新旧形态都认） */
export function isPrivateKey(key) {
  return kindOfKey(key) === 'private';
}

// ── 进程内默认格式 ────────────────────────────────────────────────────────────
// 各业务模块（社交、记忆、托付、MCP 工具……）都在产 key。给每个模块塞一个
// `keyOf` 依赖会把签名搞得很脏；这里改成一个进程级设置，启动时按配置设一次，
// 之后所有模块 `import { key }` 就得到与内核一致的形态。
let active = { platform: DEFAULT_PLATFORM, keyed: false };

/** 启动时调用一次：把配置里的平台与形态固化下来（不合法时回落默认，不抛错） */
export function configureKeys({ platform, keyedFormat } = {}) {
  const p = String(platform ?? '').trim().toLowerCase();
  active = {
    platform: PLATFORM_RE.test(p) ? p : DEFAULT_PLATFORM,
    keyed: keyedFormat === true,
  };
  return { ...active };
}

/** 当前进程的 key 形态（测试与状态页用） */
export function keyFormat() {
  return { ...active };
}

/**
 * 按当前形态组装 key：`keyed=false` 时仍是旧的 `group:<id>`（行为与迁移前逐字一致），
 * `keyed=true` 时是 `<platform>:<group|private>:<id>`。
 * 参数非法时同样抛错，不产出半个 key。
 */
export function key(kind, id) {
  if (!KIND_RE.test(String(kind ?? '').trim())) {
    throw new Error(`会话 key 的类型不合法：${JSON.stringify(kind)}（只支持 group/private）`);
  }
  const i = String(id ?? '').trim();
  if (!ID_RE.test(i)) throw new Error(`会话 key 的 id 不合法：${JSON.stringify(id)}（只支持数字）`);
  return active.keyed ? formatKey(active.platform, kind, i) : `${kind}:${i}`;
}

