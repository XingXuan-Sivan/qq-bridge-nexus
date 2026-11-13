// 平台元数据（B7）：页面只问这里「有哪些平台、叫什么、有哪些会话类型、上限多少」。
//
// 数据来自 /api/runtime/platforms（运行期注册表：内置 + 插件），不是硬编码的 `qq`。
// 于是新增一个用户侧平台（内置或插件）之后，控制台的下拉、标签与提示自动跟着变，
// 不需要改前端任何一行。
//
// 为什么查询是同步的：页面首屏渲染不等网络。app.js 启动时预热一次，页面拿到的是
// 上一次的快照；空快照的降级是「只显示会话里出现过的平台」，不会把页面挂住。
// 加载失败时保留旧快照 —— 控制台在半启动（平台还没装配）时也要能渲染。

import { api } from './api.js';

let meta = { active: '', platforms: [] };
let loaded = false;
let inflight = null;

/** 当前快照 `{ active, platforms }`。 */
export function platformMeta() {
  return meta;
}

export function platformsLoaded() {
  return loaded;
}

/**
 * 拉取平台元数据（幂等，并发调用共用一次请求）。
 * @param {{force?: boolean}} [opts] force=true 用于「桥接刚重启、插件刚装」后的刷新
 */
export async function loadPlatforms({ force = false } = {}) {
  if (loaded && !force) return meta;
  if (inflight && !force) return inflight;
  inflight = (async () => {
    try {
      const res = await api('/api/runtime/platforms');
      if (res && Array.isArray(res.platforms)) {
        meta = { active: String(res.active ?? ''), platforms: res.platforms };
        loaded = true;
      }
    } catch {
      // 端点不可用（桥接半启动、控制台被裁剪过）：保持旧快照，页面按空表降级。
    } finally {
      inflight = null;
    }
    return meta;
  })();
  return inflight;
}

/** 当前运行期平台 id（未加载时为空串）。 */
export function activePlatformId() {
  return meta.active;
}

export function listPlatforms() {
  return meta.platforms;
}

/** 按 id 取平台描述；未登记返回 null。 */
export function platformOfId(id) {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key) return null;
  return meta.platforms.find((p) => p.id === key) ?? null;
}

/** 平台显示名：登记过就用它的 label，否则原样回 id（会话里出现但已下线的平台也能显示）。 */
export function platformLabel(id) {
  const platform = platformOfId(id);
  return platform?.label || String(id ?? '').trim();
}

/**
 * 平台下拉选项：登记过的平台在前，其次补上数据里出现过的 id。
 * 补这一步是为了「注册表还没加载完」时筛选不至于丢项。
 */
export function platformFilterOptions(seenIds = [], { allLabel = '全部平台' } = {}) {
  const ids = [...new Set([
    ...meta.platforms.map((p) => p.id),
    ...seenIds.map((id) => String(id ?? '').trim().toLowerCase()).filter(Boolean),
  ])].sort();
  return [{ value: 'all', label: allLabel }, ...ids.map((id) => ({ value: id, label: platformLabel(id) }))];
}

/** 内核语义的会话类型 → 中文。平台自有类型不在这里登记，原样显示。 */
const TYPE_LABEL = Object.freeze({
  group: '群聊',
  private: '私聊',
  direct: '私聊',
  temp: '临时会话',
  channel: '频道',
  thread: '帖子',
  live: '直播',
});

/** 会话类型的中文名；未知类型原样返回（插件新增类型不需要先登记就能显示）。 */
export function conversationTypeLabel(type) {
  const key = String(type ?? '').trim().toLowerCase();
  return TYPE_LABEL[key] || key;
}

/** 类型标签的色调：多方会话绿、一对一蓝、其余中性。 */
export function conversationTypeTone(type) {
  const key = String(type ?? '').trim().toLowerCase();
  if (key === 'group') return 'tag--success';
  if (key === 'private' || key === 'direct') return 'tag--primary';
  return '';
}

/** 某平台声明的会话类型（空数组 = 平台没声明，表单不限制）。 */
export function conversationTypesOf(platformId) {
  return platformOfId(platformId)?.conversationTypes ?? [];
}

/** 某平台的分条与格式上限（`chunkChars` / `markdown`）；未声明返回空对象。 */
export function platformLimits(platformId) {
  return platformOfId(platformId)?.limits ?? {};
}

/** 能力名 → 中文。没登记的能力原样显示：插件扩展能力不需要改前端。 */
const CAPABILITY_LABEL = Object.freeze({
  group: '群聊',
  direct: '私聊',
  temp: '临时会话',
  mention: '@ 提醒',
  reply: '引用回复',
  recall: '撤回',
  poke: '拍一拍',
  image: '图片',
  voice: '语音',
  video: '视频',
  file: '文件',
  sticker: '表情',
  forward: '合并转发',
  'member-list': '成员列表',
  'member-info': '成员详情',
  ext: '平台私有段',
});

export function capabilityLabel(name) {
  const key = String(name ?? '').trim().toLowerCase();
  return CAPABILITY_LABEL[key] || key;
}

/** 一排能力标签的文案（逗号分隔），用于卡片上的「平台能力」一行。 */
export function capabilitySummary(names = []) {
  return names.map(capabilityLabel).join(' · ');
}
