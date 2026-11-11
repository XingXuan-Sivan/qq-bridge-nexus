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

/**
 * 唤醒原因 → 准入轴。投递闸门 `sendWakePromptV2Impl`（`src/bridge.js`）按这张表判定
 * 一次唤醒要不要过主动轴；表是唯一分类处，新增唤醒原因必须登记（`test-session-proactive`
 * 会扫描 `src/bridge.js` 里的原因字面量，漏登记直接失败）。
 *
 * - `passive`：由别人发来的消息/动作触发。被动轴在闸门里由 `isSessionAllowedInCurrentMode`
 *   （= `passiveAllowed`）统一拦截，这里登记是为了让分类完整、便于阅读与测试。
 * - `proactive`：没有新消息、由 bot 自己或定时器发起 —— 产品定义见控制台「主动行为」：
 *   主动冒泡、潜水超时、回复检查等无人触发的唤醒。
 * - `operator`：操作者/系统通道，不受会话准入约束。定时任务在调度器里已按目标会话的主动轴
 *   判定（并会通知创建者），这里不重复拦；管理员中继、控制台手动唤醒、首次引导同理。
 */
export const WAKE_REASON_AXES = Object.freeze({
  // 入站消息与它的触发条件
  private: 'passive',
  anyMessage: 'passive',
  atMention: 'passive',
  nameMention: 'passive',
  keyword: 'passive',
  question: 'passive',
  speaker: 'passive',
  poke: 'passive',
  // 按概率随机唤醒没有人在找它，是 bot 自己冒泡 —— 归主动轴。
  probability: 'proactive',
  // 静默结束后给「静默期间被直接找过」的会话补一次唤醒：触发源是被动消息。
  silenceEnded: 'passive',
  // bot 自己发起
  timeout: 'proactive',
  replyCheck: 'proactive',
  proactiveCheck: 'proactive',
  memberJoin: 'proactive',
  memberLeave: 'proactive',
  roleRefresh: 'proactive',
  // 操作者/系统通道
  bootstrap: 'operator',
  admin: 'operator',
  scheduled: 'operator',
  ownerRelay: 'operator',
});

/**
 * 一次唤醒该走哪根准入轴；未知原因按 `proactive` 处理（失败关闭：宁可拦住 bot 自发的唤醒，
 * 也不让新加的定时路径悄悄绕过准入）。返回 `'passive' | 'proactive' | 'operator'`。
 */
export function wakeAccessAxis(reason) {
  const base = String(reason ?? '').trim().split(':')[0];
  if (!base) return 'proactive';
  return Object.hasOwn(WAKE_REASON_AXES, base) ? WAKE_REASON_AXES[base] : 'proactive';
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
