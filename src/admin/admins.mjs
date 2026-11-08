/**
 * 管理员名单与能力判定（纯函数）。
 *
 * 设计约束（见 docs/SESSION_SUBSYSTEM.md §10）：
 *   · owner 永远拥有全部能力与 L3；管理员只拿显式 caps，且不能改全局模式/权限/名单/控制台令牌。
 *   · 所有判定都在这里收敛，bridge 只负责把 QQ 号解析成 actor 再询问。
 */

export const ADMIN_CAPS = ['approve', 'sessions', 'scheduler', 'memory'];
export const ADMIN_LEVELS = ['L1', 'L2', 'L3'];

const QQ_RE = /^[1-9]\d{4,11}$/;

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

/**
 * 归一化 config.admins。
 * 非法 QQ 直接抛错（配置错误应在启动时暴露，不能静默丢掉一个管理员）。
 * owner 本人若也出现在名单里，会被移除——owner 的权限不来自名单。
 */
export function normalizeAdmins(raw, { ownerQQ = null } = {}) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('admins 必须是数组');
  const owner = ownerQQ === null || ownerQQ === undefined ? null : String(ownerQQ);
  const out = [];
  const seen = new Set();
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`admins[${index}] 必须是对象`);
    const qq = String(entry.qq ?? '').trim();
    if (!QQ_RE.test(qq)) throw new Error(`admins[${index}].qq 必须是 QQ 号`);
    if (owner && qq === owner) return;
    if (seen.has(qq)) throw new Error(`admins 里 QQ ${qq} 重复`);
    seen.add(qq);
    const maxLevelRaw = String(entry.maxLevel ?? 'L2').trim().toUpperCase();
    out.push({
      qq,
      name: asText(entry.name, 40) || `管理员 ${qq.slice(-4)}`,
      caps: normalizeCaps(entry.caps),
      maxLevel: ADMIN_LEVELS.includes(maxLevelRaw) ? maxLevelRaw : 'L2',
      notify: entry.notify !== false,
      exemptPassive: entry.exemptPassive !== false,
    });
  });
  return out;
}

export function findAdmin(admins, qq) {
  const key = String(qq ?? '').trim();
  if (!key) return null;
  return (Array.isArray(admins) ? admins : []).find((a) => a.qq === key) ?? null;
}

/** 把任意 QQ 解析成统一 actor；非 owner/非管理员返回 role='user'。 */
export function actorForQQ({ ownerQQ = null, admins = [], qq = '' } = {}) {
  const id = String(qq ?? '').trim();
  const owner = ownerQQ === null || ownerQQ === undefined ? '' : String(ownerQQ);
  if (id && owner && id === owner) {
    return {
      qq: id, role: 'owner', name: '管理员（owner）', caps: ADMIN_CAPS.slice(),
      maxLevel: 'L3', notify: true, exemptPassive: true,
      can: (cap) => ADMIN_CAPS.includes(cap),
    };
  }
  const admin = findAdmin(admins, id);
  if (admin) {
    return {
      qq: id, role: 'admin', name: admin.name, caps: admin.caps.slice(),
      maxLevel: admin.maxLevel, notify: admin.notify, exemptPassive: admin.exemptPassive,
      can: (cap) => admin.caps.includes(cap),
    };
  }
  return { qq: id, role: 'user', name: '', caps: [], maxLevel: 'L0', notify: false, exemptPassive: false, can: () => false };
}

export function isAdminQQ({ ownerQQ = null, admins = [], qq = '' } = {}) {
  return actorForQQ({ ownerQQ, admins, qq }).role !== 'user';
}

/** 管理员私聊的被动豁免；owner 永远豁免，管理员按 exemptPassive。 */
export function isPrivilegedPrivate({ ownerQQ = null, admins = [], qq = '', kind = '', id = '' } = {}) {
  if (kind !== 'private') return false;
  const actor = actorForQQ({ ownerQQ, admins, qq: id });
  if (actor.role === 'owner') return true;
  return actor.role === 'admin' && actor.exemptPassive;
}

/** closed-agent 只对 owner / 可进入的管理员私聊开放；返回允许的最高级别。 */
export function closedAgentMaxLevel(actor) {
  if (!actor || actor.role === 'user') return null;
  if (actor.role === 'owner') return 'L3';
  return ADMIN_LEVELS.includes(actor.maxLevel) ? actor.maxLevel : 'L2';
}

export function levelRank(level) {
  return ADMIN_LEVELS.indexOf(String(level ?? '').toUpperCase());
}

export function canOpenLevel(actor, level) {
  const max = closedAgentMaxLevel(actor);
  if (!max) return false;
  return levelRank(level) >= 0 && levelRank(level) <= levelRank(max);
}
