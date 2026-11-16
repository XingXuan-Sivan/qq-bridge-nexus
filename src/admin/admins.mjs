/**
 * 管理员名单与能力判定（纯函数）。
 *
 * 设计约束（见 docs/SESSION_SUBSYSTEM.md §10）：
 *   · owner 永远拥有全部能力；管理员只拿显式 caps，且不能改名单与控制台令牌。
 *   · 命令的可执行性由命令自己申报的权限档（all / admin / owner）决定，名单不携带级别。
 *   · owner 与名单都按**地址**（平台 + 账号 + id）比对，不按裸 id：同一个号码在不同账号下
 *     是不同的两个人，多平台/多账号并存时裸 id 比对会把两边的权限串起来。
 *   · 所有判定都在这里收敛，bridge 只负责把事件解析成地址再询问。
 */

import { formatKey, keyFormat, parseKey } from '../session/key.mjs';

export const ADMIN_CAPS = ['approve', 'sessions', 'scheduler', 'memory'];

/** 直达语义的类型：`private` / `direct` / `dm` / `chat`。群地址不能当"某一个人"。 */
const DIRECT_TYPES = Object.freeze(['private', 'direct', 'dm', 'chat']);
const isDirectType = (type) => DIRECT_TYPES.includes(String(type ?? '').trim().toLowerCase());

const asText = (value, max) => {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, max) : '';
};

export function normalizeCaps(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const cap = String(item ?? '').trim();
    if (ADMIN_CAPS.includes(cap) && !out.includes(cap)) out.push(cap);
  }
  return out;
}

/** 已是规范地址对象（三个字段都是字符串）就不必再过一遍 key 解析。 */
function isAddressShape(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && typeof value.platform === 'string' && typeof value.id === 'string'
    && (value.account === undefined || typeof value.account === 'string');
}

/**
 * 一处地址 → `{ platform, account, id }`。
 *
 * 接受三种写法：
 *   · 对象 `{ platform, account, id }`（或旧的 `{ qq }`）
 *   · 完整 key：`qq:private:123` / `qq@napcat:private:123`（`private` 段也接受
 *     `direct` / `dm` / `chat`）
 *   · 裸 id：`123`，平台与账号取 `context`（缺省取本进程 `configureKeys` 的地址）
 *
 * 群地址（`qq:group:123`）一律判非法 —— 管理员与 owner 都是人，不是群。
 * 非法返回 `null`；要不要抛错由调用方决定（配置写入时抛，运行时查询时静默）。
 */
export function normalizeActorAddress(raw, context = {}) {
  const fallbackPlatform = context.platform || keyFormat().platform;
  const fallbackAccount = context.account ?? keyFormat().account ?? '';
  if (isAddressShape(raw)) {
    return { platform: raw.platform, account: raw.account ?? fallbackAccount, id: raw.id };
  }
  const build = (platform, account, id) => {
    const p = platform || fallbackPlatform;
    // 账号只在同一个平台下继承：写 `telegram:...` 时不能把本进程的 QQ 账号名贴上去。
    const a = account ?? (p === fallbackPlatform ? fallbackAccount : '');
    try {
      const parsed = parseKey(formatKey(p, 'private', id, a));
      return parsed ? { platform: parsed.platform, account: parsed.account, id: parsed.id } : null;
    } catch {
      return null;
    }
  };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    // `{ address: 'telegram:private:42' }` 这种写法：address 本身是完整 key。
    if (typeof raw.address === 'string' && raw.address.trim() && raw.id === undefined && raw.qq === undefined) {
      return normalizeActorAddress(raw.address, { platform: raw.platform ?? fallbackPlatform, account: raw.account ?? fallbackAccount });
    }
    const id = String(raw.id ?? raw.qq ?? '').trim();
    if (!id) return null;
    // 控制台那一列既能填裸 id，也能直接贴完整 key。
    if (id.includes(':')) {
      return normalizeActorAddress(id, { platform: raw.platform ?? fallbackPlatform, account: raw.account ?? fallbackAccount });
    }
    return build(raw.platform, raw.account, id);
  }
  const text = String(raw ?? '').trim();
  if (!text) return null;
  // 没有冒号 = 裸 id，平台与账号都靠上下文补齐。
  if (!text.includes(':')) return build(fallbackPlatform, fallbackAccount, text);
  // 有冒号但不带平台前缀（`private:123`）：补上上下文平台再解析。
  const withPlatform = isDirectType(text.split(':')[0]) ? `${fallbackPlatform}:${text}` : text;
  const parsed = parseKey(withPlatform);
  if (!parsed || !isDirectType(parsed.type)) return null;
  // key 里没写账号时沿用上下文账号，但仅限同一个平台（配置里的 owner 属于"当前这个号"）。
  const samePlatform = parsed.platform === fallbackPlatform;
  return { platform: parsed.platform, account: parsed.account || (samePlatform ? fallbackAccount : ''), id: parsed.id };
}

/** 两个地址是否同一个人。 */
export function sameAddress(a, b) {
  return Boolean(a) && Boolean(b)
    && a.platform === b.platform && (a.account ?? '') === (b.account ?? '') && a.id === b.id;
}

/** 地址 → 可直接比较的规范 key（日志、去重用）。 */
export function addressKey(address) {
  if (!address) return '';
  try {
    return formatKey(address.platform, 'private', address.id, address.account ?? '');
  } catch {
    return '';
  }
}

/**
 * owner 归一化：接受裸 id、完整 key 或 `{ platform, account, id }`。
 * 非法直接抛错 —— 配置错误必须在启动时暴露；静默丢掉 owner 会让审批通道无声失效。
 */
export function normalizeOwner(raw, context = {}) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'string' && !raw.trim()) return null;
  const address = normalizeActorAddress(raw, context);
  if (!address) {
    throw new Error('owner 必须是直达地址（123456 / qq:private:123456 / { platform, account, id }）');
  }
  return address;
}

/**
 * 归一化 config.admins。
 *
 * 每项接受 `{ id }`（或旧的 `{ qq }`）、可选的 `platform` / `account` 覆盖、
 * 以及完整 key 写法 `{ address: 'telegram:private:42' }`。
 * 非法项直接抛错（配置错误应在启动时暴露，不能静默丢掉一个管理员）。
 * owner 本人若也出现在名单里，会被移除 —— owner 的权限不来自名单。
 */
export function normalizeAdmins(raw, options = {}) {
  const { ownerQQ = null, owner: ownerRaw = null, platform, account = '' } = options;
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('admins 必须是数组');
  const context = { platform, account };
  // 旧写法（ownerQQ 单值）与新写法（owner 对象）都要能剔除 owner 自己。
  const owner = normalizeOwner(ownerRaw ?? ownerQQ, context);
  const out = [];
  const seen = new Set();
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`admins[${index}] 必须是对象`);
    const address = normalizeActorAddress({
      address: entry.address,
      platform: entry.platform ?? platform,
      account: entry.account ?? account,
      id: entry.id ?? entry.qq,
    }, context);
    if (!address) throw new Error(`admins[${index}] 的地址不合法（要 id，或 platform:private:id）`);
    if (sameAddress(address, owner)) return;
    const identity = addressKey(address);
    if (seen.has(identity)) throw new Error(`admins 里地址 ${identity} 重复`);
    seen.add(identity);
    out.push({
      platform: address.platform,
      account: address.account,
      id: address.id,
      qq: address.id, // 旧字段名：控制台表格与既有配置仍按它读
      name: asText(entry.name, 40) || `管理员 ${address.id.slice(-4)}`,
      caps: normalizeCaps(entry.caps),
      notify: entry.notify !== false,
      exemptPassive: entry.exemptPassive !== false,
    });
  });
  return out;
}

/** 按地址查管理员；`address` 也可以是裸 id（按上下文平台解释）。 */
export function findAdmin(admins, address, context = {}) {
  const target = normalizeActorAddress(address, context);
  if (!target) return null;
  const list = Array.isArray(admins) ? admins : [];
  for (const admin of list) {
    if (sameAddress(normalizeActorAddress(admin, context), target)) return admin;
  }
  return null;
}

/**
 * 把一处地址解析成统一 actor；非 owner / 非管理员返回 role='user'。
 *
 * 参数同时接受新写法 `{ owner, admins, address }` 与旧写法
 * `{ ownerQQ, admins, qq }`（旧写法按上下文平台解释，等价于单人单平台）。
 */
export function actorForAddress(options = {}) {
  const { owner = null, ownerQQ = null, admins = [], address = null, platform, account = '' } = options;
  const context = { platform, account };
  const target = normalizeActorAddress(address, context);
  const blank = {
    platform: target?.platform ?? (platform || keyFormat().platform),
    account: target?.account ?? account,
    id: target?.id ?? '',
    qq: target?.id ?? '',
    role: 'user', name: '', caps: [], notify: false, exemptPassive: false,
    can: () => false,
  };
  if (!target) return blank;
  let ownerAddress = null;
  try {
    ownerAddress = normalizeOwner(owner ?? ownerQQ, context);
  } catch {
    ownerAddress = null; // 运行时查询不因配置写错而抛；启动路径已由 normalizeOwner 暴露
  }
  const base = {
    platform: target.platform, account: target.account, id: target.id, qq: target.id,
  };
  if (sameAddress(target, ownerAddress)) {
    return {
      ...base,
      role: 'owner', name: '管理员（owner）', caps: ADMIN_CAPS.slice(),
      notify: true, exemptPassive: true,
      can: (cap) => ADMIN_CAPS.includes(cap),
    };
  }
  const admin = findAdmin(admins, target, context);
  if (admin) {
    // 名单项可能未经 normalizeAdmins（测试与旧调方直接传 { qq }），这里逐项兜底。
    const caps = Array.isArray(admin.caps) ? admin.caps.slice() : [];
    return {
      ...base,
      role: 'admin', name: admin.name || `管理员 ${target.id.slice(-4)}`, caps,
      notify: admin.notify !== false, exemptPassive: admin.exemptPassive !== false,
      can: (cap) => caps.includes(cap),
    };
  }
  return blank;
}

/** 旧入口：按裸 id 判定（平台与账号取上下文）。保留给既有调用方与测试。 */
export function actorForQQ({ ownerQQ = null, owner = null, admins = [], qq = '', platform, account = '' } = {}) {
  return actorForAddress({ owner, ownerQQ, admins, address: String(qq ?? '').trim(), platform, account });
}

export function isAdminAddress({ owner = null, ownerQQ = null, admins = [], address = null, platform, account = '' } = {}) {
  return actorForAddress({ owner, ownerQQ, admins, address, platform, account }).role !== 'user';
}

/** 旧名保留。 */
export function isAdminQQ(options = {}) {
  const { qq = '', ...rest } = options;
  return isAdminAddress({ ...rest, address: String(qq ?? '').trim() });
}

/**
 * 管理员私聊的被动豁免；owner 永远豁免，管理员按 exemptPassive。
 * 只对直达会话生效：群聊里 owner 发言不产生豁免。
 *
 * 接受新写法 `{ owner, admins, address }`，也接受旧写法
 * `{ ownerQQ, admins, qq, kind, id }`。
 */
export function isPrivilegedPrivate(options = {}) {
  const { kind = '', qq = '', id = '', address = null, ...rest } = options;
  if (address === null && kind && !isDirectType(kind)) return false;
  const target = address ?? (String(id ?? '').trim() || String(qq ?? '').trim());
  if (!target) return false;
  const actor = actorForAddress({ ...rest, address: target });
  if (actor.role === 'owner') return true;
  return actor.role === 'admin' && actor.exemptPassive;
}

