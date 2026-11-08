/**
 * 会话准入：被动 / 主动两根独立的轴，每根轴是一份**全局名单**（SESSION_SUBSYSTEM.md §4）。
 *
 * 名单只有两种模式，没有第三种：
 *   - allow（白名单）：名单内允许，名单外拒绝；空名单 = 全部拒绝。
 *   - deny（黑名单）：名单内拒绝，名单外允许；空名单 = 全部允许。
 *
 * 名单是唯一真相：会话详情里的“允许/拒绝”开关只是往这份名单里增删该会话，
 * 不再有 per-profile 的 inherit/allow/deny，也没有 owner/管理员豁免（管理命令走独立通道）。
 */

import { formatKey, parseKey } from './key.mjs';

export const ACCESS_AXES = ['passive', 'proactive'];
export const ACCESS_MODES = ['allow', 'deny'];
export const ACCESS_VERSION = 2;

export function isAccessAxis(axis) {
  return ACCESS_AXES.includes(axis);
}

/** 只保底 allow/deny；非法值按白名单处理（空名单=全拒，最保守）。 */
export function normalizeAccessMode(value) {
  return value === 'deny' ? 'deny' : 'allow';
}

/**
 * 一条名单项 → 规范 key（`qq:group:123` / `qq:private:456`）。
 * 接受 `qq:` 前缀、`group:123` / `private:456`，也接受完整 key；其余一律视为非法。
 */
export function parseAccessEntry(raw, platform = 'qq') {
  if (typeof raw !== 'string') return null;
  let text = raw.trim().toLowerCase();
  if (!text) return null;
  if (!text.includes(':')) return null;
  if (/^(group|private):/.test(text)) text = `${platform}:${text}`;
  const parsed = parseKey(text);
  if (!parsed) return null;
  return formatKey(parsed.platform, parsed.kind, parsed.id);
}

/** 名单数组 → `{entries, invalid}`；去重并保持首次出现顺序。 */
export function normalizeAccessEntries(raw, platform = 'qq') {
  const list = Array.isArray(raw) ? raw : [];
  const entries = [];
  const invalid = [];
  const seen = new Set();
  for (const item of list) {
    const key = parseAccessEntry(item, platform);
    if (!key) {
      if (typeof item === 'string' && item.trim()) invalid.push(item.trim());
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(key);
  }
  return { entries, invalid };
}

/** 新建一个空名单配置；默认白名单（空=全部拒绝），全新安装可传 deny 得到“黑名单空=全部允许”。 */
export function createAccessConfig(mode = 'allow') {
  const config = { version: ACCESS_VERSION };
  for (const axis of ACCESS_AXES) config[axis] = { mode: mode === 'deny' ? 'deny' : 'allow', entries: [] };
  return config;
}

/** 已迁移到 v2 的 defaults 才返回配置，否则返回 null（调用方负责迁移）。 */
export function normalizeAccessConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Number(raw.version) !== ACCESS_VERSION) return null;
  const config = { version: ACCESS_VERSION };
  for (const axis of ACCESS_AXES) {
    const src = raw[axis] && typeof raw[axis] === 'object' && !Array.isArray(raw[axis]) ? raw[axis] : {};
    const { entries } = normalizeAccessEntries(src.entries);
    config[axis] = { mode: normalizeAccessMode(src.mode), entries };
  }
  return config;
}

export function isAccessConfigV2(raw) {
  return Boolean(normalizeAccessConfig(raw));
}

/**
 * @param {'passive'|'proactive'} axis
 * @param {string} key
 * @param {{defaults?: object}|object} snapshot state 或 defaults 本体
 * @returns {{mode:'allow'|'deny', member:boolean, value:'allow'|'deny'}}
 */
export function accessState(axis, key, snapshot) {
  if (!isAccessAxis(axis)) throw new Error(`未知的准入轴：${axis}`);
  const raw = snapshot?.defaults ?? snapshot;
  const config = normalizeAccessConfig(raw);
  if (!config) throw new Error('准入配置尚未迁移到名单模式');
  const list = config[axis];
  const member = list.entries.includes(key);
  const value = (list.mode === 'allow') === member ? 'allow' : 'deny';
  return { mode: list.mode, member, value };
}

export function resolveAccess(axis, key, snapshot) {
  return accessState(axis, key, snapshot).value;
}

/** 一次解析两根轴（控制台列表/详情用）。 */
export function resolveAccessSummary(key, snapshot) {
  const out = {};
  for (const axis of ACCESS_AXES) {
    const state = accessState(axis, key, snapshot);
    out[axis] = state.value;
    out[`${axis}Mode`] = state.mode;
    out[`${axis}Member`] = state.member;
  }
  return out;
}

/** 名单模式的中文文案（控制台提示用）。 */
export function defaultPolicyText(mode) {
  return mode === 'deny' ? '黑名单（名单外全部允许）' : '白名单（名单外全部拒绝）';
}

/** 名单为空时的后果文案；非空返回空串。 */
export function emptyListWarning(axisConfig) {
  if (!axisConfig || axisConfig.entries.length > 0) return '';
  return axisConfig.mode === 'allow' ? '白名单为空：全部拒绝' : '黑名单为空：全部允许';
}

/** “这个会话为什么是允许/拒绝”的一句话说明。 */
export function accessReasonText(axis, key, snapshot) {
  const state = accessState(axis, key, snapshot);
  if (state.mode === 'allow') {
    return state.member ? '白名单成员' : '不在白名单（默认拒绝）';
  }
  return state.member ? '黑名单成员（拒绝）' : '不在黑名单（默认允许）';
}
