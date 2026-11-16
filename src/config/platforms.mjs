/**
 * 配置 v2：平台配置的唯一真源是 config.json 的 `platforms` 段。
 *
 * 为什么必须集中：v1 用三个**顶层键**分别描述「用哪个平台」和「它怎么连」——
 * `platform.id`（用户侧 id）、`snowluma.*`（QQ 的连接参数）、`dsh.*`（DSH 的连接参数）。
 * 三者各自绑定了一个具体平台，于是「支持一个新平台」永远等于「在内核里加一段顶层键」，
 * 而 `cfg.snowluma.viaPlatform` 这种名字会把 QQ 的实现细节漏进内核的每一层。
 *
 * v2 把「哪个平台 + 它怎么连」收进一张按 id 索引的表：
 *
 *   platforms: {
 *     active: { user: 'qq', agent: 'dsh' },
 *     users:  { qq:  { account: '', transport: {…}, options: {…} } },
 *     agents: { dsh: { endpoint: {…}, options: {…} } },
 *   }
 *
 * 一、两侧的目录都是**多条目**的：`agents` 里可以有多个 Agent 平台各自带端点与选项，
 * `active` 只决定「默认用哪一个」（`agentRuntime()` 按它装配）。没被选中的条目照样
 * 可读、可写、可探活 —— 切换默认执行体不该要求先把另一条配置删掉。
 *
 * 字段归属靠白名单：`transport` / `endpoint` 是「怎么连上」（URL、token、端口、进程目录），
 * 其余一律进 `options`。白名单之外的新字段不需要改本文件 —— 它落到 options 即可。
 *
 * 三条约束：
 *   1. 本文件只有纯函数和数据形状；读写盘留给调用方（桥接与控制中心各有一套写盘工具）；
 *   2. 迁移是**一次性**的：迁完删掉三个旧顶层键并写 `configVersion: 2`，不留别名双读；
 *   3. `active` 指向不存在的 id 时**不静默回退**：保留原值，由统一注册表的
 *      `active_unregistered` 诊断和启动期的明确报错把它暴露出来。
 *
 * 版本仍是 2：「默认执行体」不是第二个配置键，它就是 `platforms.active.agent`
 * （控制台与 `/api/config/runtime` 读的是同一个值）。两处各存一份必然漂移 —— 一个由
 * 控制台写、一个由手改 config.json 写，而装配时只能有一个赢家。
 */

/** 当前配置结构版本。缺失或小于它即视为 v1，需要迁移。 */
export const CONFIG_VERSION = 2;

/** v1 没有「Agent 平台选择」这一项：`dsh.*` 段就是 DSH 自己的。 */
export const DEFAULT_USER_PLATFORM = 'qq';
export const DEFAULT_AGENT_PLATFORM = 'dsh';

/**
 * 「怎么连上」的字段白名单。
 *
 * 用户侧列的是 OneBot 网关的连接与进程参数：地址、令牌、端点跟随、静默告警阈值、
 * 启动器与数据目录。其余（如 backfill、社交策略）是行为选项，不属于连接。
 * Agent 侧列的是底座地址与鉴权；provider / model / reasoningEffort 属于选项。
 */
export const USER_TRANSPORT_KEYS = Object.freeze([
  'wsUrl', 'httpUrl', 'accessToken', 'followDiscoveredEndpoint',
  'viaPlatform', 'silenceWarnMs', 'launcherPath', 'homeDir',
]);
export const AGENT_ENDPOINT_KEYS = Object.freeze([
  'baseUrl', 'authToken', 'authTokenExplicit', 'authHeader', 'authPrefix', 'allowRemote',
]);

/** 平台 id 与会话 key 同一套文法（见 src/session/key.mjs），避免「配置能用、key 写不出」。 */
const PLATFORM_ID_RE = /^[a-z][a-z0-9-]{0,15}$/;
const ACCOUNT_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
/** 平台目录里每个平台自己的几个键；其余键视为「想写 transport/options 但写散了」。 */
const ENTRY_KEYS = Object.freeze(['account', 'enabled', 'transport', 'options', 'endpoint']);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** 平台 id：不合法时回落给定的默认值（只用于 id 形状，不用于「这个平台存不存在」）。 */
function platformId(raw, fallback) {
  const id = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return PLATFORM_ID_RE.test(id) ? id : fallback;
}

/** 账号名：不合法或空都归成空串（= 该平台的默认账号）。 */
function accountName(raw) {
  const name = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return ACCOUNT_RE.test(name) ? name : '';
}

/**
 * 按白名单切成「怎么连上」与「其余」两半。
 * 白名单外的键一律进 options —— 这样新增一个业务选项不需要改本文件。
 */
function splitByKeys(raw, keys) {
  const connection = {};
  const options = {};
  if (!isPlainObject(raw)) return { connection, options };
  for (const [key, value] of Object.entries(raw)) {
    if (keys.includes(key)) connection[key] = value;
    else options[key] = value;
  }
  return { connection, options };
}

/** 把平台条目里写散的键（既不在 transport 也不在 options 的）收进待切分的集合。 */
function looseKeys(entry) {
  const loose = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!ENTRY_KEYS.includes(key)) loose[key] = value;
  }
  return loose;
}

/**
 * 先合再切：`transport/options` 各自展开，最后叠写散的键。
 *
 * 顺序不能反：写散的键是调用方（控制台保存 / token 自愈）刚算出来的新值，
 * 它必须盖过段里的旧值，否则「改了没生效」会在保存接口看起来成功。
 */
function normalizeUserEntry(entry) {
  const src = isPlainObject(entry) ? entry : {};
  const merged = {
    ...(isPlainObject(src.transport) ? src.transport : {}),
    ...(isPlainObject(src.options) ? src.options : {}),
    ...looseKeys(src),
  };
  // `enabled` 是**条目级开关**（这条实例装配不装配），不是发给平台的选项：
  // 写进 options 里会让适配器收到一个与它无关的键。缺省即启用。
  const wanted = src.enabled !== undefined ? src.enabled : merged.enabled;
  delete merged.enabled;
  const { connection, options } = splitByKeys(merged, USER_TRANSPORT_KEYS);
  return { account: accountName(src.account), enabled: wanted !== false, transport: connection, options };
}

function normalizeAgentEntry(entry) {
  const src = isPlainObject(entry) ? entry : {};
  const merged = {
    ...(isPlainObject(src.endpoint) ? src.endpoint : {}),
    ...(isPlainObject(src.options) ? src.options : {}),
    ...looseKeys(src),
  };
  const { connection, options } = splitByKeys(merged, AGENT_ENDPOINT_KEYS);
  return { endpoint: connection, options };
}

/** 目录段：只保留 id 合法的条目（其余是脏数据，不该让整个配置读不出来）。 */
function normalizeCollection(raw, normalizeEntry) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const id = platformId(key, '');
    if (!id) continue;
    out[id] = normalizeEntry(value);
  }
  return out;
}

/**
 * v1 → v2 迁移（纯函数，不读写盘）。
 *
 * `raw` 是**已经 `JSON.parse` 过的配置对象**，不是文件路径：传路径会被当成空配置，
 * 一声不响地（不报错）返回空表 —— 这类静默失败正是本模块要消灭的。
 *
 * @returns {{config: object, migrated: boolean, notes: string[]}}
 *   `migrated: true` 时调用方负责备份 + 写盘；`notes` 是要打到日志里的人话。
 */
export function migrateConfigToV2(raw) {
  const src = isPlainObject(raw) ? raw : {};
  if (Number(src.configVersion) >= CONFIG_VERSION && isPlainObject(src.platforms)) {
    return { config: src, migrated: false, notes: [] };
  }

  const notes = [];
  const next = { ...src };
  const legacyPlatform = isPlainObject(next.platform) ? next.platform : {};
  const legacyUser = isPlainObject(next.snowluma) ? next.snowluma : {};
  const legacyAgent = isPlainObject(next.dsh) ? next.dsh : {};

  const userId = platformId(legacyPlatform.id, DEFAULT_USER_PLATFORM);
  const agentId = DEFAULT_AGENT_PLATFORM;

  const users = {};
  const agents = {};
  // 空段落也照搬一个空壳：`active` 指向的平台必须在 users/agents 里出现，否则注册表会报
  // `active_unregistered` —— 而这里迁出来的恰恰就是「当前平台」。
  users[userId] = normalizeUserEntry({ account: legacyPlatform.account, ...legacyUser });
  agents[agentId] = normalizeAgentEntry(legacyAgent);
  if (Object.keys(legacyUser).length) notes.push(`snowluma.* → platforms.users.${userId}`);
  if (Object.keys(legacyAgent).length) notes.push(`dsh.* → platforms.agents.${agentId}`);
  if (legacyPlatform.id || legacyPlatform.account) notes.push(`platform.* → platforms.active.user + platforms.users.${userId}`);

  next.configVersion = CONFIG_VERSION;
  next.platforms = { active: { user: userId, agent: agentId }, users, agents };
  delete next.platform;
  delete next.snowluma;
  delete next.dsh;
  return { config: next, migrated: true, notes };
}

/**
 * 读 platforms 段（v2 形状）。对磁盘上的脏输入宽容：缺段给空表，写散的键按白名单归位。
 *
 * `active` 缺省时的推断顺序：目录里唯一的 id → 内置默认。这是「用户没选」的默认，
 * 不是「选错了替他改」—— 指向不存在 id 时原样保留，交给诊断暴露。
 */
export function readPlatforms(raw) {
  const section = isPlainObject(raw?.platforms) ? raw.platforms : {};
  const users = normalizeCollection(section.users, normalizeUserEntry);
  const agents = normalizeCollection(section.agents, normalizeAgentEntry);
  const pick = (value, ids, fallback) => {
    const id = platformId(value, '');
    if (id) return id;
    const first = Object.keys(ids).sort()[0];
    return first || fallback;
  };
  return {
    active: {
      user: pick(section.active?.user, users, DEFAULT_USER_PLATFORM),
      agent: pick(section.active?.agent, agents, DEFAULT_AGENT_PLATFORM),
    },
    users,
    agents,
  };
}

/** 当前用户侧平台的配置：`{ id, account, enabled, transport, options }`（缺条目给空段）。 */
export function userPlatformConfig(platforms) {
  const id = platformId(platforms?.active?.user, DEFAULT_USER_PLATFORM);
  const entry = normalizeUserEntry(platforms?.users?.[id]);
  return { id, ...entry };
}

/** 当前 Agent 侧平台的配置：`{ id, endpoint, options }`（缺条目给空段）。 */
export function agentPlatformConfig(platforms) {
  const id = platformId(platforms?.active?.agent, DEFAULT_AGENT_PLATFORM);
  const entry = normalizeAgentEntry(platforms?.agents?.[id]);
  return { id, ...entry };
}

/**
 * 内核用的派生视图。
 *
 * `userPlatform` / `agentPlatform` 是**扁平**的：连接参数在前、选项在后，于是既有的
 * `cfg.userPlatform.accessToken` 与 `cfg.userPlatform.backfill` 都能直接读，不必让每个
 * 调用点都关心「这个键属于 transport 还是 options」。名字不带平台名是刻意的 ——
 * 内核不认识 QQ 或 DSH。
 */
export function platformViews(platforms) {
  const user = userPlatformConfig(platforms);
  const agent = agentPlatformConfig(platforms);
  return {
    platform: { id: user.id, account: user.account },
    userPlatform: { ...user.transport, ...user.options },
    agentPlatform: { ...agent.endpoint, ...agent.options },
  };
}

/**
 * 从**解析后的原始配置**（尚未迁移）得到派生视图：先做一次性迁移，再切段，再拍平。
 *
 * 桥接启动时 `loadConfig()` 会先迁移再落盘；独立脚本、MCP 侧进程、探针都不经过它，
 * 直接读文件时很可能是 v1（三个顶层键）—— 此时 `readPlatforms()` 只能读到空表。
 * 凡是「自己读 config.json」的地方都走这里，不要各自忘记那一步。
 */
export function configViews(raw) {
  return platformViews(readPlatforms(migrateConfigToV2(raw).config));
}

/**
 * 当前活动的 Agent 平台 id：自己读 config.json 的独立进程（MCP 脚本等）用它定位
 * `profiles/agent-platforms/<id>/`，不必自己重做一遍迁移与归一。
 */
export function activeAgentPlatformId(raw) {
  return readPlatforms(migrateConfigToV2(raw).config).active.agent;
}

/**
 * 某个平台条目的**扁平**形状：连接参数在前、选项在后。
 *
 * 为什么需要：`configSchema` / 控制台表单 / 迁移前的 `snowluma.*` 都是扁平字段，
 * 它们不该知道 transport/options 这层分法。分法只属于本文件与写盘路径。
 */
export function flatPlatformEntry(platforms, side, id) {
  const wanted = platformId(id, '');
  if (!wanted) return {};
  if (side === 'agent') {
    const entry = normalizeAgentEntry(platforms?.agents?.[wanted]);
    return { ...entry.endpoint, ...entry.options };
  }
  const raw = platforms?.users?.[wanted];
  const entry = normalizeUserEntry(raw);
  // `account` / `enabled` 都是条目级字段，但它们只对**存在的条目**有意义：
  // 缺条目时给空段，不编一个「已启用」让调用方以为这条实例在用。
  const own = raw === undefined ? { account: entry.account } : { account: entry.account, enabled: entry.enabled };
  return { ...own, ...entry.transport, ...entry.options };
}

/**
 * 用户实例清单：`users` 里每个条目就是一个可装配的实例（平台 + 账号 + 连接参数）。
 *
 * 停用的条目照样返回，`enabled: false` 由装配方自己跳过 —— 这里只回答「表里有什么」，
 * 不替调用方做「该不该连」的决定。按 id 排序，控制台与日志的列表顺序因此稳定。
 */
export function userInstances(platforms) {
  const base = readPlatforms({ platforms });
  return Object.keys(base.users).sort().map((id) => ({ id, ...base.users[id] }));
}

/**
 * 整份 platforms 的扁平投影：`{ active, users: { <id>: 扁平 }, agents: { <id>: 扁平 } }`。
 * 统一注册表与只读接口消费这个形状，于是「配置存成三段」不会泄露给前端。
 */
export function flatPlatforms(platforms) {
  const base = readPlatforms({ platforms });
  const users = {};
  const agents = {};
  for (const id of Object.keys(base.users)) users[id] = flatPlatformEntry(base, 'user', id);
  for (const id of Object.keys(base.agents)) agents[id] = flatPlatformEntry(base, 'agent', id);
  return { active: { ...base.active }, users, agents };
}

/**
 * 就地打补丁：按白名单把 `patch` 分到 transport/endpoint 与 options，返回新的 platforms。
 *
 * `id` 是**寻址**：给空串表示「写当前平台」（模型选择、token 自愈这类写我正在用的那条），
 * 给具体 id 就写那一条（控制台的平台配置页写的是选中实例，不一定是 active）。
 * 非法 id 直接返回原表、不写 —— 路由层已经用同一套文法校过，纯函数不再猜。
 *
 * 写配置的四条路径（控制台选模型、改思考强度、token 自愈、控制中心换目录）形状不同但语义相同，
 * 都从这里走，避免各自拼 `file.dsh = {...}` 把 v2 结构写坏。
 */
export function patchPlatformConfig(platforms, side, id, patch) {
  const base = readPlatforms({ platforms });
  if (!isPlainObject(patch)) return base;
  // 空串 = 写当前平台；给了具体 id 就必须过同一套文法。非法 id 返回原表，
  // 不悄悄回落到 active —— 否则「写了 acp」会变成「改了 dsh」。
  const given = typeof id === 'string' ? id.trim().toLowerCase() : '';
  if (typeof id === 'string' && id !== '' && !PLATFORM_ID_RE.test(given)) return base;
  const target = given || (side === 'agent' ? base.active.agent : base.active.user);
  if (!target) return base;
  if (side === 'agent') {
    base.agents[target] = normalizeAgentEntry({ ...base.agents[target], ...patch });
  } else {
    base.users[target] = normalizeUserEntry({ ...base.users[target], account: base.users[target]?.account, ...patch });
  }
  return base;
}

/**
 * 切换默认平台：只改 `active` 指向，不动条目（条目是「这台平台怎么连」，与「默认用谁」无关）。
 *
 * 条目不存在时补一条空壳：`active` 必须能在该侧目录里找到 —— 否则注册表会报
 * `active_unregistered`，而这条说的恰恰是「刚被设为默认的那个平台」。
 */
export function setActivePlatform(platforms, side, id) {
  const base = readPlatforms({ platforms });
  const wanted = platformId(id, '');
  if (!wanted) return base;
  if (side === 'agent') {
    base.active.agent = wanted;
    if (!base.agents[wanted]) base.agents[wanted] = normalizeAgentEntry({});
  } else {
    base.active.user = wanted;
    if (!base.users[wanted]) base.users[wanted] = normalizeUserEntry({});
  }
  return base;
}

/** 写盘前的序列化形状：只保留 structural 的三段，不把读时的归一化垃圾带回去。 */
export function platformsForWrite(platforms) {
  return {
    active: { user: platforms.active.user, agent: platforms.active.agent },
    users: platforms.users,
    agents: platforms.agents,
  };
}
