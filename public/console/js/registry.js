// 平台注册表前端快照：页面只问这里「有哪些平台、叫什么、能不能用、哪里坏了」。
//
// 数据只来自 /api/platforms/registry（统一注册表，C1）—— 用户侧与 Agent 侧是**同一份响应**，
// 前端不自己拼第二张表。C7 之前这里只留 `side === 'user'`，于是「Agent 侧接了谁、能不能跑」
// 在界面上无处可问；现在两侧都在，调用方靠参数说明要哪一侧，缺省仍是用户侧（旧调用点零改动）。
//
// 为什么查询是同步的：页面首屏渲染不等网络。app.js 启动时预热一次，页面拿到的是
// 上一次的快照；空快照的降级是「只显示数据里出现过的平台」，不会把页面挂住。
// 加载失败时保留旧快照 —— 控制台在半启动（平台还没装配）时也要能渲染。

import { api } from './api.js';

let meta = { active: { user: '', agent: '' }, platforms: [], diagnostics: [], summary: null };
let loaded = false;
let inflight = null;

/** 当前快照 `{ active: {user,agent}, platforms, diagnostics, summary }`。 */
export function registryMeta() {
  return meta;
}

export function platformsLoaded() {
  return loaded;
}

/**
 * 拉取平台注册表（幂等，并发调用共用一次请求）。
 * @param {{force?: boolean}} [opts] force=true 用于「桥接刚重启、插件刚装」后的刷新
 */
export async function loadPlatforms({ force = false } = {}) {
  if (loaded && !force) return meta;
  if (inflight && !force) return inflight;
  inflight = (async () => {
    try {
      const res = await api('/api/platforms/registry');
      if (res && Array.isArray(res.platforms)) {
        meta = {
          active: { user: String(res.active?.user ?? ''), agent: String(res.active?.agent ?? '') },
          platforms: res.platforms,
          diagnostics: Array.isArray(res.diagnostics) ? res.diagnostics : [],
          summary: res.summary ?? null,
        };
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

/** 当前运行期平台 id（用户侧；未加载时为空串）。 */
export function activePlatformId() {
  return meta.active.user;
}

/** 当前运行期 Agent 平台 id（未加载时为空串）。 */
export function activeAgentPlatformId() {
  return meta.active.agent;
}

/**
 * 某一侧的平台条目。
 * @param {'user'|'agent'} [side] 缺省 user —— 保持 C7 之前的签名语义
 */
export function listPlatforms(side = 'user') {
  return meta.platforms.filter((item) => item.side === side);
}

/** 按 id 取平台描述；未登记返回 null。 */
export function platformOfId(id, side = 'user') {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key) return null;
  return meta.platforms.find((item) => item.side === side && item.id === key) ?? null;
}

/** 平台显示名：登记过就用它的 label，否则原样回 id（数据里出现但已下线的平台也能显示）。 */
export function platformLabel(id, side = 'user') {
  const platform = platformOfId(id, side);
  return platform?.label || String(id ?? '').trim();
}

/** 平台所在的一侧（未登记时按调用方给的方向兜底）。 */
export function platformSideOf(id, side = 'user') {
  return meta.platforms.find((item) => item.id === String(id ?? '').trim().toLowerCase())?.side ?? side;
}

/** 该平台的诊断（详情页顶部用）。 */
export function diagnosticsOf(side, id, snapshot = meta) {
  return (snapshot.diagnostics ?? []).filter((item) => item.side === side && item.platformId === id);
}

/**
 * 平台下拉选项：登记过的平台在前，其次补上数据里出现过的 id。
 * 补这一步是为了「注册表还没加载完」时筛选不至于丢项。
 */
export function platformFilterOptions(seenIds = [], { allLabel = '全部平台', side = 'user' } = {}) {
  const ids = [...new Set([
    ...listPlatforms(side).map((p) => p.id),
    ...seenIds.map((id) => String(id ?? '').trim().toLowerCase()).filter(Boolean),
  ])].sort();
  return [{ value: 'all', label: allLabel }, ...ids.map((id) => ({ value: id, label: platformLabel(id, side) }))];
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
export function conversationTypesOf(platformId, side = 'user') {
  return platformOfId(platformId, side)?.conversationTypes ?? [];
}

/**
 * 用户实例的入站结论 → 中文。
 *
 * 这些结论由桥接在装配时写进注册表（见 src/bridge.js 的 `userInbound`）：它们是「这条实例
 * 此刻到底怎么样」的唯一事实，前端不再自己推。空值 = 本次运行还没走到装配那一步。
 */
const INBOUND_STATE_LABEL = Object.freeze({
  open: '已接管',
  closed: '连接已断开',
  error: '装配失败',
  disabled: '已停用',
  'send-only': '只出不进',
  unregistered: '没有实现',
});

export function inboundStateLabel(state) {
  const key = String(state ?? '').trim().toLowerCase();
  return key ? (INBOUND_STATE_LABEL[key] || key) : '待装配';
}

/** 入站状态标签的色调：接管成功绿、装不起来红、断开黄，其余中性。 */
export function inboundStateTone(state) {
  const key = String(state ?? '').trim().toLowerCase();
  if (key === 'open') return 'tag--success';
  if (key === 'error') return 'tag--danger';
  if (key === 'closed') return 'tag--warning';
  return '';
}

/** 出站实现的中文名（`adapter` = 平台适配器，`transport` = 插件接管）。 */
export function outboundViaLabel(via) {
  const key = String(via ?? '').trim().toLowerCase();
  if (key === 'transport') return '插件 transport';
  if (key === 'adapter') return '平台适配器';
  return '没有发送实现';
}

/** 某平台的分条与格式上限（`chunkChars` / `markdown`）；未声明返回空对象。 */
export function platformLimits(platformId, side = 'user') {
  return platformOfId(platformId, side)?.limits ?? {};
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
  // Agent 侧能力位（AgentPort 契约）：两侧同名时不冲突，名字本来就不同。
  session: '会话',
  rename: '改名',
  permission: '权限',
  models: '模型',
  settings: '设置',
  workspace: '工作区',
  compact: '压缩',
  maintenance: '维护',
  events: '事件流',
});

export function capabilityLabel(name) {
  const key = String(name ?? '').trim().toLowerCase();
  return CAPABILITY_LABEL[key] || key;
}

/** 一排能力标签的文案（逗号分隔），用于卡片上的「平台能力」一行。 */
export function capabilitySummary(names = []) {
  return names.map(capabilityLabel).join(' · ');
}
