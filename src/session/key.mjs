/**
 * 会话标识（session key）：`<platform>[@<account>]:<type>:<id>`，例如 `qq:group:100000003`。
 *
 * 每个维度各自解决一个具体问题（规格见 docs/PLATFORM_DECOUPLING.md §2）：
 *   - platform：哪个用户侧平台（qq / telegram / …）。启动时由 `platform.id` 固化。
 *   - account：同一平台上的哪个账号。SnowLuma 与 NapCat 各带一个 QQ 号同时在线时，
 *     同一个群号会指向两个不同的机器人身份；没有这一维，两边的会话数据互相覆盖。
 *     省略 = 该平台的默认账号（绝大多数部署只有它）。
 *   - type：会话类型。内核只对 group / direct / temp 有语义；平台自有类型
 *     （channel / thread / live …）原样保留在 key 里，按「多方会话」处理。
 *   - id：一律**字符串**。数字只是 QQ 的约定；int64 超过 2^53 后被 Number() 截断，
 *     截断出来的 key 仍然"合法"，这种错误在读取侧无法发现。
 *
 * 兼容策略：
 *   - `isSessionKey()` 只认新形态（写入侧用它校验）；
 *   - `parseKey()` / `legacyToKey()` 接受旧的 `group:<id>` / `private:<id>`——旧形态
 *     只存在于 QQ 单平台时代，按 `DEFAULT_PLATFORM` 解释；
 *   - 两种写法读出来能被 `sameSession()` 认成同一个会话。新形态是旧形态的超集，
 *     所以磁盘上已有的 key 不需要迁移（`qq:group:123` 在新文法下原样可读）。
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** 默认平台：配置里没写 `platform.id` 时用它（单平台部署不需要改配置） */
export const DEFAULT_PLATFORM = 'qq';

/** 内核理解的三种会话类型；其余类型一律按「多方会话」处理 */
export const KERNEL_TYPES = Object.freeze(['group', 'direct', 'temp']);

/** 类型别名：历史数据里 `private` 与 `direct` 指同一件事，`chat` 是更早的写法 */
const TYPE_ALIAS = Object.freeze({ private: 'direct', chat: 'direct', dm: 'direct' });
/** 类型 → 内核语义（多方 / 一对一 / 临时） */
const SHAPE_OF_TYPE = Object.freeze({ group: 'group', direct: 'direct', temp: 'temp' });

/** 平台名：小写字母开头，允许小写字母/数字/连字符，最长 16 字符 */
const PLATFORM_RE = /^[a-z][a-z0-9-]{0,15}$/;
/** 账号名：可选维度，字母或数字开头，允许 `.` `_` `-`；省略表示默认账号 */
const ACCOUNT_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
/** 类型：小写字母开头，允许字母/数字/`_`/`-`，最长 24 字符（开放，不枚举） */
const TYPE_RE = /^[a-z][a-z0-9_-]{0,23}$/;
/**
 * id：不透明字符串，1–128 字符，禁止路径分隔符、key 分隔符、空白与控制字符。
 * 排除这些不是为了好看：会话 key 同时是**目录名**（session/directory.mjs 把 `:` 换成 `/`）
 * 和各个 JSON 的主键，`/ \ : < > " | ? *` 会把 Windows 上的档案写坏。
 */
const ID_TEXT = '[^\\/\\\\:<>"|?*\\s\\u0000-\\u001f\\u007f]{1,128}';

/** 新形态：`<platform>[@<account>]:<type>:<id>`（大小写敏感，避免 `Admin` 与 `admin` 歧义） */
const KEY_RE = new RegExp(`^([a-z][a-z0-9-]{0,15})(?:@([a-z0-9][a-z0-9._-]{0,31}))?:([a-z][a-z0-9_-]{0,23}):(${ID_TEXT})$`);
/** 旧形态：`<kind>:<id>`（只有 QQ 单平台时代的数据长这样） */
const LEGACY_RE = new RegExp(`^(group|private):(${ID_TEXT})$`);

/** 类型的规范写法（`private` → `direct`）；空/非法返回 '' */
function canonicalType(value) {
  const t = String(value ?? '').trim().toLowerCase();
  if (!TYPE_RE.test(t)) return '';
  return TYPE_ALIAS[t] ?? t;
}

/** 平台 / 账号的规范写法；不合法返回 '' */
function canonicalPlatform(value) {
  const p = String(value ?? '').trim().toLowerCase();
  return PLATFORM_RE.test(p) ? p : '';
}

function canonicalAccount(value) {
  const a = String(value ?? '').trim().toLowerCase();
  return ACCOUNT_RE.test(a) ? a : '';
}

/** 纯数字 id 才给数值形态（过渡期用）；其余返回 null —— 不做四舍五入也不做截断 */
function numericId(id) {
  return /^\d+$/.test(id) ? Number(id) : null;
}

/**
 * 纯数字 id 去前导零（`0456` → `456`）：QQ 群号/QQ 号不会有前导零，而控制台、
 * 定时任务、限频表都靠 key 相等来认定「同一个会话」，两种写法必须归一。
 * 只删零、不做 Number() 转换 —— int64 超 2^53 会被截断。
 */
function stripLeadingZeros(text) {
  return /^\d+$/.test(text) ? text.replace(/^0+(?=\d)/, '') : text;
}

/** 配置里的平台名（`cfg.platform.id`），非法或缺省时回落 `qq` */
export function platformOfConfig(cfg, fallback = DEFAULT_PLATFORM) {
  const raw = cfg?.platform?.id;
  if (typeof raw !== 'string') return fallback;
  const id = raw.trim().toLowerCase();
  return PLATFORM_RE.test(id) ? id : fallback;
}

/** 配置里的账号名（`cfg.platform.account`），非法或缺省时返回 ''（默认账号） */
export function accountOfConfig(cfg) {
  const raw = cfg?.platform?.account;
  if (typeof raw !== 'string') return '';
  return canonicalAccount(raw);
}

/**
 * 组装 key：`platform[@account]:type:id`。
 *
 * 也接受一个对象（`formatKey({ platform, account, type, id })`），供适配器层使用。
 * 参数不合法时抛错——这里宁可在写日志/写状态前炸掉，也不要悄悄写出一个
 * `undefined:group:NaN` 这种永远匹配不上的 key。
 */
export function formatKey(platform, type, id, account = '') {
  if (platform && typeof platform === 'object' && type === undefined) {
    ({ platform, type, id, account = '' } = platform);
  }
  const p = canonicalPlatform(platform);
  const a = canonicalAccount(account);
  const t = String(type ?? '').trim().toLowerCase();
  const i = stripLeadingZeros(String(id ?? '').trim());
  if (!p) throw new Error(`会话 key 的平台名不合法：${JSON.stringify(platform)}`);
  if (account !== '' && account !== null && account !== undefined && !a) {
    throw new Error(`会话 key 的账号名不合法：${JSON.stringify(account)}`);
  }
  if (!TYPE_RE.test(t)) throw new Error(`会话 key 的类型不合法：${JSON.stringify(type)}（要小写字母开头）`);
  if (!new RegExp(`^${ID_TEXT}$`).test(i)) throw new Error(`会话 key 的 id 不合法：${JSON.stringify(id)}（1–128 字符，不含路径分隔符与空白）`);
  return `${p}${a ? `@${a}` : ''}:${t}:${i}`;
}

/** 平台段（含账号）的规范写法：`qq` / `qq@napcat`；不合法抛错 */
export function formatAddress(address) {
  const addr = normalizeAddress(address);
  return addr.account ? `${addr.platform}@${addr.account}` : addr.platform;
}

/**
 * 解析 key（新旧形态都认）。
 *
 * @returns {null | {platform: string, account: string, type: string, kind: string, id: string,
 *   idNum: number|null, shape: 'group'|'direct'|'temp', key: string}}
 *   `kind` 是 `type` 的历史别名（大量调用方按这个名字取），`key` 是规范写法，
 *   `shape` 是内核语义（多方 / 一对一 / 临时）。
 */
export function parseKey(key) {
  if (typeof key !== 'string') return null;
  const text = key.trim();
  const modern = KEY_RE.exec(text);
  if (modern) {
    const platform = modern[1].toLowerCase();
    const account = (modern[2] ?? '').toLowerCase();
    // type 保留原文（`private` 不改写成 `direct`）：调用方拿它去见平台适配器，
    // 改写会让人以为 QQ 也有 `direct` 这种会话。语义归一在 shape 里做。
    const type = modern[3].toLowerCase();
    const id = stripLeadingZeros(modern[4]);
    return {
      platform, account, type, kind: type, id, idNum: numericId(id),
      shape: SHAPE_OF_TYPE[canonicalType(type)] ?? 'group',
      key: formatKey(platform, type, id, account),
    };
  }
  const legacy = LEGACY_RE.exec(text);
  if (legacy) {
    const type = legacy[1].toLowerCase();
    const id = stripLeadingZeros(legacy[2]);
    return {
      platform: DEFAULT_PLATFORM, account: '', type, kind: type, id, idNum: numericId(id),
      shape: SHAPE_OF_TYPE[canonicalType(type)] ?? 'group',
      key: formatKey(DEFAULT_PLATFORM, type, id),
    };
  }
  return null;
}

/** 解析结果 → 规范 key；不合法返回 null（读取侧的入口） */
export function canonicalKey(parsed) {
  if (!parsed) return null;
  return formatKey(parsed.platform, parsed.type ?? parsed.kind, parsed.id, parsed.account ?? '');
}

/** 任意写法 → 规范 key；不合法返回 null */
export function normalizeKey(raw) {
  return canonicalKey(parseKey(raw));
}

/** 只认新形态（写入侧校验用） */
export function isSessionKey(key) {
  return typeof key === 'string' && KEY_RE.test(key.trim());
}

/** 旧形态转新形态；已经是新形态的原样返回；不认识返回 null */
export function legacyToKey(key, platform = DEFAULT_PLATFORM) {
  const parsed = parseKey(key);
  if (!parsed) return null;
  if (isSessionKey(key)) return parsed.key;
  return formatKey(platform, parsed.type, parsed.id);
}

/** 取平台名（新旧形态都认）；不合法返回 null */
export function platformOfKey(key) {
  return parseKey(key)?.platform ?? null;
}

/** 取账号名（默认账号返回 ''）；不合法返回 null */
export function accountOfKey(key) {
  return parseKey(key)?.account ?? null;
}

/** 取会话类型（原文，`private` 不改写成 `direct`）；不合法返回 null */
export function kindOfKey(key) {
  return parseKey(key)?.type ?? null;
}

/** 取 id（字符串）；不合法返回 null */
export function idOfKey(key) {
  return parseKey(key)?.id ?? null;
}

/** 取纯数字 id 的数值形态（过渡期用；非数字 id 返回 null）；不合法返回 null */
export function idNumOfKey(key) {
  return parseKey(key)?.idNum ?? null;
}

/** 内核语义：`group` / `direct` / `temp`；不合法返回 null */
export function shapeOfKey(key) {
  return parseKey(key)?.shape ?? null;
}

/** 类型 → 内核语义（平台自有类型按「多方会话」处理）；空/非法返回 null */
export function shapeOfType(type) {
  const t = canonicalType(type);
  return t ? (SHAPE_OF_TYPE[t] ?? 'group') : null;
}

/** 两个 key 是否指同一个会话（新旧写法、`private` 与 `direct` 都视为同一个） */
export function sameSession(a, b) {
  const pa = parseKey(a);
  const pb = parseKey(b);
  if (!pa || !pb) return false;
  return pa.platform === pb.platform && pa.account === pb.account
    && canonicalType(pa.type) === canonicalType(pb.type) && pa.id === pb.id;
}

/** 是否多方会话 key（新旧形态、平台自有类型都认） */
export function isGroupKey(key) {
  return shapeOfKey(key) === 'group';
}

/** 是否一对一会话 key（`private` / `direct` 都算） */
export function isPrivateKey(key) {
  return shapeOfKey(key) === 'direct';
}

// ── 进程默认地址与地址上下文 ──────────────────────────────────────────────────
// 各业务模块（社交、记忆、托付、MCP 工具……）都在产 key。给每个模块塞一个
// `keyOf` 依赖会把签名搞得很脏；这里用两层：
//   1. 进程默认地址：启动时按配置设一次（单平台部署只用到这一层）；
//   2. 地址上下文（AsyncLocalStorage）：入站消息处理期间由 bridge 用 withAddress
//      包住，所有下游模块的 key() 自动跟着事件走 —— 多平台并存时不会串号。
// 两层都没有时才回落 DEFAULT_PLATFORM，且 strict 模式下直接抛错（见 key()）。
const addressContext = new AsyncLocalStorage();
let active = { platform: DEFAULT_PLATFORM, account: '', strict: false };

/**
 * 启动时调用一次：把配置里的平台/账号固化下来（不合法时回落默认，不抛错）。
 * `strict: true` 表示「多平台并存」——此时没有地址上下文就构造 key 属于编程错误。
 */
export function configureKeys({ platform, account = '', strict = false } = {}) {
  active = {
    platform: canonicalPlatform(platform) || DEFAULT_PLATFORM,
    account: canonicalAccount(account),
    strict: strict === true,
  };
  return { ...active };
}

/** 当前进程的默认地址（测试与状态页用） */
export function keyFormat() {
  return { ...active };
}

/** 当前进程的默认地址（`{ platform, account }`，可直接喂给 withAddress） */
export function defaultAddress() {
  return { platform: active.platform, account: active.account };
}

/** 地址对象 → `{ platform, account }`；不合法抛错（地址是主键的一部分，猜不得） */
export function normalizeAddress(address) {
  if (!address || typeof address !== 'object' || Array.isArray(address)) {
    throw new Error(`地址必须是 { platform, account }：${JSON.stringify(address)}`);
  }
  const platform = canonicalPlatform(address.platform);
  if (!platform) throw new Error(`地址的平台名不合法：${JSON.stringify(address.platform)}`);
  const raw = address.account ?? '';
  const account = canonicalAccount(raw);
  if (String(raw).trim() !== '' && !account) throw new Error(`地址的账号名不合法：${JSON.stringify(raw)}`);
  return { platform, account };
}

/** 当前异步上下文里的地址；不在任何上下文里返回 null */
export function currentAddress() {
  const store = addressContext.getStore();
  return store ? { ...store } : null;
}

/** 在指定地址的上下文里执行 fn（同步/异步都行，Promise 原样透传） */
export function withAddress(address, fn) {
  if (typeof fn !== 'function') throw new Error('withAddress(address, fn) 需要一个函数');
  const addr = normalizeAddress(address);
  return addressContext.run(addr, fn);
}

/**
 * 按地址组装 key：`platform[@account]:type:id`。
 *
 * 地址来源优先级：显式传参 > withAddress 上下文 > 进程默认地址。
 * `strict` 模式下（多平台部署）没有上下文也不给地址就直接抛错——静默落到某个
 * 平台的默认账号上，正是本函数要消灭的错误。
 */
export function keyFor(platform, type, id, account = '') {
  return formatKey(platform, type, id, account);
}

/** 按当前地址组装 key（主流程用这个） */
export function key(type, id, address) {
  if (address) return formatKey(address.platform, type, id, address.account ?? '');
  const ctx = addressContext.getStore();
  if (ctx) return formatKey(ctx.platform, type, id, ctx.account);
  if (active.strict) {
    throw new Error(`多平台部署下构造会话 key 必须先确定地址：用 withAddress({ platform, account }, …) 包住调用，或改用 keyFor()`);
  }
  return formatKey(active.platform, type, id, active.account);
}
