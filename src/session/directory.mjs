/**
 * `state/sessions/` 目录：默认策略文件 + 每会话一个文件（SESSION_SUBSYSTEM.md §3）。
 *
 * 与旧的 `state/sessions.json` 不同，这里没有「一份大文件」：
 *   - 改一个会话只写它自己的文件，坏一个文件不影响别的会话；
 *   - 文件名就是 key，人工排查/备份/删除都直观；
 *   - 不维护索引文件，启动扫目录得到 `Map<key, profile>`。
 *
 * 安全不变量沿用 `store.mjs` 的两条：
 *   1. 读失败/内容损坏时**不回写**（`writable:false`），避免把损坏文件覆盖成空；
 *   2. 缺字段就地补齐，老文件不因为多一个少一个键就整份不可用。
 *
 * 本模块不 import 全局：`fs` / `path` / `atomicWriteJson` / `log` / `now` 都由调用方传入，
 * 测试可以指向临时目录。
 */

import { formatKey, parseKey } from './key.mjs';
import { createAccessConfig, normalizeAccessConfig } from './access.mjs';

export const SESSION_DIR_VERSION = 2;
/** 旧三态模型的默认值；只用于“有档案但没有 defaults.json”的迁移读取。 */
export const DEFAULT_ACCESS = { passive: 'deny', proactive: 'deny' };

const MODE_VALUES = new Set(['inherit', 'chat', 'reserved', 'reserved2']);
const AXES = ['passive', 'proactive'];

/** 会话 key → 相对路径（`qq/group/123.json`）；不合法返回 null。 */
export function keyPath(key) {
  const parsed = parseKey(key);
  if (!parsed) return null;
  const canonical = formatKey(parsed.platform, parsed.kind, parsed.id);
  return `${canonical.split(':').join('/')}.json`;
}

/**
 * 规范化 defaults：v2 名单原样规范化；旧字符串形状原样保留，交给迁移读取。
 * 迁移完成后 writer 只会再写 v2。
 */
export function normalizeDefaults(raw) {
  const v2 = normalizeAccessConfig(raw);
  if (v2) return v2;
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const axis of AXES) out[axis] = src[axis] === 'allow' ? 'allow' : 'deny';
  return out;
}

function normalizeString(value, max = 200) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

/** 每会话文件的规范化；`key` 必须与路径一致，由调用方先校验。 */
export function normalizeProfile(raw, { key, now = Date.now } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const parsed = parseKey(key);
  if (!parsed) return null;
  const canonical = formatKey(parsed.platform, parsed.kind, parsed.id);
  if (raw.key !== canonical) return null;

  // 旧三态字段只在升级当次保留成 legacyAccess 供迁移读取；迁移完成后 writer 不再写它。
  // 迁移流程产出的档案本身就带 legacyAccess，所以这里也要认这个形状，否则读档会丢掉三态。
  const legacySource = raw.legacyAccess && typeof raw.legacyAccess === 'object' ? raw.legacyAccess : null;
  const rawAccess = raw.access && typeof raw.access === 'object'
    ? raw.access
    : legacySource?.access && typeof legacySource.access === 'object' ? legacySource.access : null;
  const legacyBlocked = raw.blocked === true || legacySource?.blocked === true;
  const legacyAccess = rawAccess || legacyBlocked
    ? {
      blocked: legacyBlocked,
      access: {
        passive: ['inherit', 'allow', 'deny'].includes(rawAccess?.passive) ? rawAccess.passive : 'inherit',
        proactive: ['inherit', 'allow', 'deny'].includes(rawAccess?.proactive) ? rawAccess.proactive : 'inherit',
      },
    }
    : null;

  const personaRaw = raw.persona && typeof raw.persona === 'object' ? raw.persona : {};
  const personaMode = ['inherit', 'off', 'card'].includes(personaRaw.mode) ? personaRaw.mode : 'inherit';
  const personaName = normalizeString(personaRaw.name, 80);

  const promptRaw = raw.prompt && typeof raw.prompt === 'object' ? raw.prompt : {};
  const initialText = typeof promptRaw.initialText === 'string' ? promptRaw.initialText.slice(0, 4000) : '';

  const wakeRaw = raw.wake && typeof raw.wake === 'object' ? raw.wake : {};
  const bindingRaw = raw.binding && typeof raw.binding === 'object' ? raw.binding : {};
  const modelRaw = raw.model && typeof raw.model === 'object' ? raw.model : null;

  return {
    version: SESSION_DIR_VERSION,
    key: canonical,
    displayName: normalizeString(raw.displayName, 120),
    ...(legacyAccess ? { legacyAccess } : {}),
    mode: MODE_VALUES.has(raw.mode) ? raw.mode : 'inherit',
    persona: { mode: personaMode, name: personaMode === 'card' ? personaName || null : null },
    prompt: { initialText, updatedAt: Number(promptRaw.updatedAt) > 0 ? Number(promptRaw.updatedAt) : 0 },
    wake: { config: wakeRaw.config && typeof wakeRaw.config === 'object' ? wakeRaw.config : null },
    model: modelRaw
      ? {
        provider: normalizeString(modelRaw.provider, 60) || null,
        model: normalizeString(modelRaw.model, 80) || null,
        reasoning: normalizeString(modelRaw.reasoning, 40) || null,
      }
      : null,
    presetId: normalizeString(raw.presetId, 80) || null,
    binding: {
      sessionId: normalizeString(bindingRaw.sessionId, 120) || null,
      workspaceId: normalizeString(bindingRaw.workspaceId, 120) || null,
      fingerprint: normalizeString(bindingRaw.fingerprint, 200) || null,
      status: ['online', 'missing', 'unknown'].includes(bindingRaw.status) ? bindingRaw.status : 'unknown',
      checkedAt: Number(bindingRaw.checkedAt) > 0 ? Number(bindingRaw.checkedAt) : 0,
      createdAt: Number(bindingRaw.createdAt) > 0 ? Number(bindingRaw.createdAt) : 0,
    },
    // 运行态的休眠标记（模式切换期间保留）；文档 §3 未列，但重启需要恢复，放在会话文件里避免第二个索引。
    dormant: raw.dormant && typeof raw.dormant === 'object' ? raw.dormant : null,
    updatedAt: Number(raw.updatedAt) > 0 ? Number(raw.updatedAt) : now(),
  };
}

/** 新建空档案（用户手动「新增会话」/迁移用）。 */
export function createProfile(key, patch = {}, now = Date.now) {
  const parsed = parseKey(key);
  if (!parsed) throw new Error('会话 key 不合法');
  const canonical = formatKey(parsed.platform, parsed.kind, parsed.id);
  const base = {
    version: SESSION_DIR_VERSION,
    key: canonical,
    displayName: '',
    mode: 'inherit',
    persona: { mode: 'inherit', name: null },
    prompt: { initialText: '', updatedAt: 0 },
    wake: { config: null },
    model: null,
    presetId: null,
    binding: { sessionId: null, workspaceId: null, fingerprint: null, status: 'unknown', checkedAt: 0, createdAt: now() },
    dormant: null,
    updatedAt: now(),
  };
  const profile = applyPatch(base, patch, now);
  // 迁移阶段还会传旧三态；这里先收进 legacyAccess，等 migrateAccessModel 翻译完再清掉。
  const legacySource = patch.legacyAccess && typeof patch.legacyAccess === 'object' ? patch.legacyAccess : null;
  const legacyAccess = legacySource?.access && typeof legacySource.access === 'object'
    ? legacySource.access
    : patch.access && typeof patch.access === 'object' ? patch.access : null;
  const legacyBlocked = patch.blocked === true || legacySource?.blocked === true;
  if (legacyAccess || legacyBlocked) {
    profile.legacyAccess = {
      blocked: legacyBlocked,
      access: {
        passive: ['inherit', 'allow', 'deny'].includes(legacyAccess?.passive) ? legacyAccess.passive : 'inherit',
        proactive: ['inherit', 'allow', 'deny'].includes(legacyAccess?.proactive) ? legacyAccess.proactive : 'inherit',
      },
    };
  }
  return profile;
}

/** 局部更新：只覆盖传入的顶层/二级字段，其余保留。 */
export function applyPatch(profile, patch, now = Date.now) {
  const next = structuredClone(profile);
  const p = patch && typeof patch === 'object' ? patch : {};
  for (const field of ['displayName', 'mode', 'presetId']) {
    if (Object.hasOwn(p, field)) next[field] = p[field];
  }
  if (p.persona && typeof p.persona === 'object') {
    if (Object.hasOwn(p.persona, 'mode')) next.persona.mode = p.persona.mode;
    if (Object.hasOwn(p.persona, 'name')) next.persona.name = p.persona.name;
  }
  if (p.prompt && typeof p.prompt === 'object') {
    if (Object.hasOwn(p.prompt, 'initialText')) next.prompt.initialText = p.prompt.initialText;
    if (Object.hasOwn(p.prompt, 'updatedAt')) next.prompt.updatedAt = p.prompt.updatedAt;
  }
  if (Object.hasOwn(p, 'wake')) next.wake = p.wake && typeof p.wake === 'object' ? p.wake : { config: null };
  if (Object.hasOwn(p, 'model')) next.model = p.model && typeof p.model === 'object' ? p.model : null;
  if (p.binding && typeof p.binding === 'object') next.binding = { ...next.binding, ...p.binding };
  if (Object.hasOwn(p, 'dormant')) next.dormant = p.dormant && typeof p.dormant === 'object' ? p.dormant : null;
  next.updatedAt = now();
  return next;
}

function listSessionFiles(fs, path, dir, log) {
  const out = [];
  const walk = (base, depth, parts) => {
    let entries;
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') log(`⚠️ 会话目录读取失败：${base}（${error?.message ?? error}）`);
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory() && depth < 2) {
        walk(path.join(base, entry.name), depth + 1, [...parts, entry.name]);
      } else if (entry.isFile() && depth === 2 && entry.name.endsWith('.json')) {
        out.push({ file: path.join(base, entry.name), parts: [...parts, entry.name.replace(/\.json$/, '')] });
      }
    }
  };
  walk(dir, 0, []);
  return out;
}

/**
 * 扫描 `state/sessions/`，返回与旧 store 同形的 state（外加 `profiles`/`defaults`）。
 *
 * @returns {{ state: object, writable: boolean, corrupt: string[], exists: boolean }}
 */
export function loadSessionDirectory({ dir, fs, path, log = () => {}, now = Date.now }) {
  const state = {
    sessions: {},
    sessionPolicies: {},
    dormantSessions: {},
    profiles: {},
    defaults: { ...DEFAULT_ACCESS },
    migratedAt: 0,
  };
  const corrupt = [];
  let exists = true;
  let writable = true;

  const defaultsFile = path.join(dir, 'defaults.json');
  try {
    const raw = fs.readFileSync(defaultsFile, 'utf8');
    const parsed = raw.trim() ? JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw) : null;
    if (!parsed || typeof parsed !== 'object') throw new Error('defaults.json 内容为空');
    state.defaults = normalizeDefaults(parsed.defaults);
    state.migratedAt = Number(parsed.migratedAt) > 0 ? Number(parsed.migratedAt) : 0;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      exists = false;
    } else {
      writable = false;
      corrupt.push(defaultsFile);
      log(`⚠️ defaults.json 读取失败，已降级为「只读不写」：${error?.message ?? error}`);
    }
  }

  // 即使 defaults.json 缺失（首次启动 / 手工拷贝目录）也要扫描会话文件：
  // 否则只带着会话档案、没有 defaults 的目录会被当成空目录，档案被静默忽略。
  if (fs.existsSync(dir)) {
    for (const { file, parts } of listSessionFiles(fs, path, dir, log)) {
      const [platform, kind, id] = parts;
      let key = null;
      try {
        key = formatKey(platform, kind, id);
      } catch {
        log(`⚠️ 忽略无法识别层级的会话文件：${file}`);
        continue;
      }
      let profile = null;
      try {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = raw.trim() ? JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw) : null;
        profile = normalizeProfile(parsed, { key, now });
        if (!profile) throw new Error('key 与路径不一致或字段非法');
      } catch (error) {
        const target = `${file}.corrupt-${now()}`;
        try { fs.renameSync(file, target); } catch (renameError) { log(`⚠️ 隔离损坏会话文件失败：${target}（${renameError?.message ?? renameError}）`); }
        corrupt.push(file);
        log(`⚠️ 会话文件损坏，已隔离为 ${target}：${error?.message ?? error}`);
        continue;
      }
      const previous = state.profiles[key];
      if (previous) {
        const prevWins = (previous.updatedAt ?? 0) >= (profile.updatedAt ?? 0);
        const keep = prevWins ? previous : profile;
        const keepFile = prevWins ? state.profileFiles?.[key] : file;
        const dropFile = prevWins ? file : state.profileFiles?.[key];
        if (dropFile) {
          try { fs.renameSync(dropFile, `${dropFile}.corrupt-${now()}`); } catch { /* 尽力而为 */ }
        }
        corrupt.push(dropFile ?? file);
        log(`⚠️ 同一会话存在多份档案，保留 updatedAt 最新的一份：${key}`);
        state.profiles[key] = keep;
        state.profileFiles = state.profileFiles ?? {};
        state.profileFiles[key] = keepFile ?? file;
      } else {
        state.profiles[key] = profile;
        state.profileFiles = state.profileFiles ?? {};
        state.profileFiles[key] = file;
      }
    }
  }

  for (const [key, profile] of Object.entries(state.profiles)) {
    if (profile.binding?.sessionId) {
      state.sessions[key] = profile.binding.sessionId;
      if (profile.binding.fingerprint) state.sessionPolicies[key] = profile.binding.fingerprint;
    }
    if (profile.dormant) state.dormantSessions[key] = profile.dormant;
  }

  // 没有 defaults.json：全新安装给黑名单空名单（空=全部允许），避免首次启动把所有人挡在外面；
  // 只有档案没有 defaults 的老目录保留旧形状，交给迁移按“默认拒绝”翻译。
  if (!exists) {
    state.defaults = Object.keys(state.profiles).length > 0
      ? { ...DEFAULT_ACCESS }
      : createAccessConfig('deny');
  }

  return { state, writable, corrupt, exists };
}

/**
 * 目录写入器：每次 `save(state)` 只写变化的会话文件；删除档案用 `remove(key)`。
 * 内存里的 `state.profiles` 是唯一真相，binding 从 `sessions/sessionPolicies` 回填。
 */
export function createSessionDirectoryWriter({ dir, fs, path, atomicWriteJson, log = () => {}, now = Date.now }) {
  const last = new Map();
  let lastDefaults = null;

  const fileFor = (key) => path.join(dir, keyPath(key));

  const syncProfile = (state, key) => {
    const profile = state.profiles?.[key];
    if (!profile) return null;
    const binding = {
      ...profile.binding,
      sessionId: state.sessions?.[key] ?? null,
      fingerprint: state.sessionPolicies?.[key] ?? null,
    };
    const next = {
      ...profile,
      binding,
      dormant: state.dormantSessions?.[key] ?? null,
      updatedAt: profile.updatedAt ?? now(),
    };
    state.profiles[key] = next;
    return next;
  };

  return {
    save(state) {
      const defaults = {
        version: SESSION_DIR_VERSION,
        defaults: normalizeDefaults(state.defaults),
        migratedAt: Number(state.migratedAt) > 0 ? Number(state.migratedAt) : 0,
      };
      const defaultsText = JSON.stringify(defaults);
      if (defaultsText !== lastDefaults) {
        atomicWriteJson(path.join(dir, 'defaults.json'), defaults);
        lastDefaults = defaultsText;
      }
      for (const key of Object.keys(state.profiles ?? {})) {
        const profile = syncProfile(state, key);
        if (!profile) continue;
        const text = JSON.stringify(profile);
        if (last.get(key) === text) continue;
        atomicWriteJson(fileFor(key), profile);
        last.set(key, text);
      }
      for (const key of [...last.keys()]) {
        if (state.profiles?.[key]) continue;
        const file = fileFor(key);
        try { fs.rmSync(file, { force: true }); } catch (error) { log(`⚠️ 删除会话档案失败：${file}（${error?.message ?? error}）`); }
        last.delete(key);
      }
    },
    remove(key) {
      const file = fileFor(key);
      try {
        fs.rmSync(file, { force: true });
        last.delete(key);
        return true;
      } catch (error) {
        log(`⚠️ 删除会话档案失败：${file}（${error?.message ?? error}）`);
        return false;
      }
    },
    resetCache() { last.clear(); lastDefaults = null; },
  };
}
