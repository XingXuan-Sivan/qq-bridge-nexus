// 能力 / 效果 / 消息段 / 会话类型的中文名 —— 只有这一份。
//
// 为什么住在后端：平台详情页顶上那句「能收能发，支持…，不支持…」由注册表算出来
// （`entry.promise`），前端只负责摆版式，不再拿一堆 id 自己拼句子。句子里的中文名
// 与控制台别处用的必须是同一张表，所以表在后端，控制台经 `/api/platforms/registry`
// 的 `labels` 取同一份；插件新增的能力 / 效果 / 段不需要改前端就能显示。

/** 能力位（用户侧的平台能力 + Agent 侧 AgentPort 能力位，两侧同名不冲突）。 */
export const CAPABILITY_LABELS = Object.freeze({
  // 用户侧
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
  // Agent 侧（AgentPort 契约）
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

/** 中立消息段（`src/user-side/segments.mjs` 的 SEGMENT_TYPES）。 */
export const SEGMENT_LABELS = Object.freeze({
  text: '文本',
  mention: '@ 提醒',
  reply: '引用回复',
  image: '图片',
  voice: '语音',
  video: '视频',
  file: '文件',
  sticker: '表情',
  forward: '合并转发',
  poke: '拍一拍',
  ext: '平台私有段',
});

/** Agent 侧效果词表（能力档 `effects` 与 `tools.yml` 模块 `effects` 共用）。 */
export const EFFECT_LABELS = Object.freeze({
  'fs.read': '读文件',
  'fs.write': '写文件',
  'fs.search': '搜索文件',
  'shell.exec': '执行命令',
  'jobs.manage': '后台任务',
  'web.access': '联网',
  'user.ask': '提问',
  'todo.manage': '任务清单',
  'approval.gate': '审批闸门',
});

/** 能力档的生效方式（`runtime.apply` 与执行体的 `applies` 声明）。 */
export const APPLY_LABELS = Object.freeze({
  preset: '装预设',
  passthrough: '直通（不装预设）',
});

/** 提示注入通道（`runtime.prompt` 与执行体的 `promptChannels` 声明）。 */
export const PROMPT_LABELS = Object.freeze({
  none: '不注入',
  system: '系统提示',
  prefix: '首轮前缀',
  tool: '工具拉取',
});

/** 会话类型（用户平台声明的 `conversationTypes`）。 */
export const CONVERSATION_LABELS = Object.freeze({
  group: '群聊',
  private: '私聊',
  direct: '私聊',
  temp: '临时会话',
  channel: '频道',
  thread: '帖子',
  live: '直播',
});

/** 表里没有的 id 原样返回：插件扩展不用先登记就能显示。 */
export function labelOf(table, id) {
  const key = String(id ?? '').trim();
  if (!key) return '';
  return table?.[key] ?? key;
}

/** 注册表下发给控制台的那一份（同一张表，不在前端再存一遍）。 */
export function labelsPayload() {
  return {
    capabilities: { ...CAPABILITY_LABELS },
    segments: { ...SEGMENT_LABELS },
    effects: { ...EFFECT_LABELS },
    apply: { ...APPLY_LABELS },
    prompt: { ...PROMPT_LABELS },
    conversations: { ...CONVERSATION_LABELS },
  };
}
