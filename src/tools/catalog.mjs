// 工具目录：平台工具与 Agent 工具的唯一定义处。
//
// 之前有三份清单：config.tools 的 37 个注册开关（控制台手写）、能力预设里的
// 插件行与 qq-tool-restrict 白名单、以及 config.capabilities[id].grants.disable。
// 这里把它们收敛成一份目录 + 一份风险分级：
//   · 目录条目描述「这个工具是什么、来自哪一端、风险等级」；
//   · 能力预设只存 tools.visible（平台工具白名单）；
//   · 权限级别按风险等级决定「这个会话能用哪一类」。
//
// 目录本身是只读投影，不存配置。宿主工具名（qq_get_unread_messages 等）保留在
// names 里，便于报错文案与旧配置迁移。

/** 风险等级（越往后越危险）。 */
export const TOOL_RISKS = Object.freeze(['read', 'send', 'state', 'write', 'exec', 'admin']);

/** 平台侧（QQ 桥接提供的工具）。flag 即 config.tools 的键，也是能力预设里 tools.visible 的元素。 */
export const PLATFORM_TOOLS = Object.freeze([
  { flag: 'getPrompt', label: '读取提示词', names: ['qq_get_prompt'], risk: 'read' },
  { flag: 'getUnread', label: '读取未读消息', names: ['qq_get_unread_messages'], risk: 'read' },
  { flag: 'getRecent', label: '读取最近消息', names: ['qq_get_recent_messages'], risk: 'read' },
  { flag: 'getMyRecent', label: '读取自己发过的消息', names: ['qq_get_my_recent_messages'], risk: 'read' },
  { flag: 'getMessageDetail', label: '查看单条消息', names: ['qq_get_message_detail'], risk: 'read' },
  { flag: 'getImages', label: '查看消息图片', names: ['qq_get_message_images'], risk: 'read' },
  { flag: 'getForwardMsg', label: '查看合并转发', names: ['qq_get_forward_msg'], risk: 'read' },
  { flag: 'getActiveMembers', label: '查看活跃成员', names: ['qq_get_active_members'], risk: 'read' },
  { flag: 'waitMessages', label: '等待新消息', names: ['qq_wait_for_messages'], risk: 'read' },
  { flag: 'socialState', label: '查看会话状态', names: ['qq_social_state'], risk: 'read' },
  { flag: 'listStickers', label: '查看收藏表情', names: ['qq_list_stickers'], risk: 'read' },
  { flag: 'getStickerImage', label: '查看表情图片', names: ['qq_get_sticker_image'], risk: 'read' },
  { flag: 'getSelfImage', label: '查看自己的形象', names: ['qq_get_self_image'], risk: 'read' },
  { flag: 'personProfile', label: '查看/记录群友档案', names: ['qq_get_person', 'qq_note_person'], risk: 'read' },
  { flag: 'memory', label: '本机轻量记忆', names: ['qq_memory_append', 'qq_memory_query', 'qq_memory_remove', 'qq_memory_clear', 'qq_memory_recall', 'qq_memory_note'], risk: 'state' },
  { flag: 'slangQuery', label: '查询黑话', names: ['qq_slang_query'], risk: 'read' },
  { flag: 'slangSubmit', label: '提交黑话候选', names: ['qq_slang_submit'], risk: 'state' },
  { flag: 'markRead', label: '标记已读', names: ['qq_mark_read'], risk: 'state' },
  { flag: 'setWakeConfig', label: '调整唤醒配置', names: ['qq_set_wake_config'], risk: 'state' },
  { flag: 'stickerNote', label: '记录表情含义', names: ['qq_sticker_note'], risk: 'state' },
  { flag: 'setStickerRemark', label: '设置表情备注', names: ['qq_set_sticker_remark'], risk: 'state' },
  { flag: 'collectSticker', label: '收藏表情', names: ['qq_collect_sticker'], risk: 'state' },
  { flag: 'sendGroup', label: '发送群消息', names: ['qq_send_group_message'], risk: 'send' },
  { flag: 'sendPrivate', label: '发送私聊消息', names: ['qq_send_private_message'], risk: 'send' },
  { flag: 'reply', label: '引用回复', names: ['qq_reply'], risk: 'send' },
  { flag: 'sendBurst', label: '分多条发送', names: ['qq_send_burst'], risk: 'send' },
  { flag: 'sendMessage', label: '统一发送', names: ['qq_send_message'], risk: 'send' },
  { flag: 'sendPoke', label: '拍一拍', names: ['qq_send_poke'], risk: 'send' },
  { flag: 'sendSticker', label: '发表情', names: ['qq_send_sticker'], risk: 'send' },
  { flag: 'sendVoice', label: '发语音', names: ['qq_send_voice', 'qq_list_voices'], risk: 'send' },
  { flag: 'webImage', label: '搜索/发送网图', names: ['qq_search_images', 'qq_preview_image', 'qq_send_web_image'], risk: 'send' },
  { flag: 'feedback', label: '向管理端反馈', names: ['qq_report_feedback'], risk: 'admin' },
  { flag: 'requestMode', label: '申请切换模式', names: ['qq_request_mode_change'], risk: 'admin' },
  { flag: 'crossGroup', label: '跨群查询', names: ['qq_cross_group_query'], risk: 'admin' },
  { flag: 'ownerGroupAccess', label: 'owner 群权限管理', names: ['qq_owner_peek_group', 'qq_owner_group_rule'], risk: 'admin' },
  { flag: 'ownerRelay', label: '让群会话代为转达', names: ['qq_ask_group_session'], risk: 'admin' },
  { flag: 'schedule', label: '定时任务', names: ['qq_schedule_create', 'qq_schedule_list', 'qq_schedule_update', 'qq_schedule_delete'], risk: 'admin' },
]);

/** Agent 侧工具模块（装进 DSH 预设的插件行）。只用于展示与预设生成，不在桥接里逐调用拦截。 */
export const AGENT_MODULES = Object.freeze([
  { id: 'tool-fs', label: '文件读写', risk: 'write' },
  { id: 'tool-fs-search', label: '文件检索', risk: 'read' },
  { id: 'tool-pwsh', label: '执行命令', risk: 'exec' },
  { id: 'tool-jobs', label: '后台任务', risk: 'exec' },
  { id: 'tool-web', label: '联网搜索/抓取', risk: 'read' },
  { id: 'tool-ask-user', label: '向用户提问', risk: 'read' },
  { id: 'tool-todo', label: '任务列表', risk: 'read' },
  { id: 'qq-approval-gate', label: '审批闸门', risk: 'admin' },
]);

/**
 * 权限级别 → 允许的风险类别。
 * 平台侧（read/send/state）在只读级别就全放行：禁掉发送会让机器人哑掉，
 * 禁掉 state 会让记忆/已读失效；真正需要收紧的是 admin。
 * Agent 侧（write/exec）才按级别递增。
 */
export const LEVEL_ALLOWS = Object.freeze({
  'read-only': Object.freeze(['read', 'send', 'state']),
  'workspace-write': Object.freeze(['read', 'send', 'state', 'write']),
  'full-ask': Object.freeze(['read', 'send', 'state', 'write', 'exec', 'admin']),
  full: Object.freeze(['read', 'send', 'state', 'write', 'exec', 'admin']),
});

/** 每一级额外需要确认的风险类别（审批由 DSH 权限预设或桥接审批闸门负责）。 */
export const LEVEL_ASKS = Object.freeze({
  'read-only': Object.freeze([]),
  'workspace-write': Object.freeze([]),
  'full-ask': Object.freeze(['exec', 'admin']),
  full: Object.freeze([]),
});

/** 可被能力预设按会话收紧的平台工具（副作用类；读类只受 config.tools 注册控制）。 */
export const CAPABILITY_GATED_RISKS = Object.freeze(['send', 'state', 'admin']);

/** 工具来源两侧（平台 = QQ 桥接；Agent = DSH 运行时）。 */
export const TOOL_SIDES = Object.freeze(['platform', 'agent']);

/**
 * 统一目录条目。平台工具以 flag 为 id，Agent 模块以 module id 为 id。
 * `gated` = 能力预设可以收紧；读类恒 false（只受 config.tools 注册开关控制）。
 * `alwaysAllowed` 是这句话的正面表述，供生成器与 UI 直接读。
 */
export const CATALOG_ENTRIES = Object.freeze([
  ...PLATFORM_TOOLS.map((tool) => Object.freeze({
    id: tool.flag,
    flag: tool.flag,
    label: tool.label,
    names: tool.names,
    side: 'platform',
    provider: 'qq',
    source: 'builtin',
    risk: tool.risk,
    gated: CAPABILITY_GATED_RISKS.includes(tool.risk),
    alwaysAllowed: !CAPABILITY_GATED_RISKS.includes(tool.risk),
  })),
  ...AGENT_MODULES.map((module) => Object.freeze({
    id: module.id,
    label: module.label,
    side: 'agent',
    provider: 'dsh',
    source: 'builtin',
    risk: module.risk,
    gated: true,
    alwaysAllowed: false,
  })),
]);

/** 内置能力的默认工具集：平台全开；Agent 按能力递增（见 SPEC §3.4）。 */
export const CAPABILITY_DEFAULTS = Object.freeze({
  'agent-chat': Object.freeze({
    platform: true,
    agent: Object.freeze(['tool-web', 'tool-ask-user', 'tool-todo']),
    mcp: Object.freeze({ allow: Object.freeze(['*']), tools: Object.freeze({ allow: Object.freeze(['*']), deny: Object.freeze([]) }) }),
    skills: Object.freeze(['*']),
  }),
  'agent-readonly': Object.freeze({
    platform: true,
    agent: Object.freeze(['tool-fs', 'tool-fs-search', 'tool-web', 'tool-ask-user', 'tool-todo']),
    mcp: Object.freeze({ allow: Object.freeze(['*']), tools: Object.freeze({ allow: Object.freeze(['*']), deny: Object.freeze([]) }) }),
    skills: Object.freeze(['*']),
  }),
  'agent-workspace': Object.freeze({
    platform: true,
    agent: Object.freeze(['tool-fs', 'tool-fs-search', 'tool-pwsh', 'tool-jobs', 'tool-web', 'tool-ask-user', 'tool-todo']),
    mcp: Object.freeze({ allow: Object.freeze(['*']), tools: Object.freeze({ allow: Object.freeze(['*']), deny: Object.freeze([]) }) }),
    skills: Object.freeze(['*']),
  }),
  'agent-full': Object.freeze({
    platform: true,
    agent: Object.freeze(AGENT_MODULES.map((module) => module.id)),
    mcp: Object.freeze({ allow: Object.freeze(['*']), tools: Object.freeze({ allow: Object.freeze(['*']), deny: Object.freeze([]) }) }),
    skills: Object.freeze(['*']),
  }),
});

/** 内置能力的默认工具集；未知 id 返回 null（调用方决定回落）。 */
export function capabilityDefaults(id) {
  return CAPABILITY_DEFAULTS[String(id ?? '')] ?? null;
}

/** 目录条目（id → 条目）。 */
export function catalogEntry(id) {
  const value = String(id ?? '');
  return CATALOG_ENTRIES.find((entry) => entry.id === value
    || entry.flag === value
    || (entry.names ?? []).includes(value)) ?? null;
}

/**
 * 由两端适配器声明的工具合并出目录条目（适配器只声明 id/label/risk）。
 * 内置条目优先；重复 id 时以适配器声明覆盖 label/risk，但保留 source。
 */
export function catalogFromAdapters({ platform = [], agent = [] } = {}) {
  const merged = new Map(CATALOG_ENTRIES.map((entry) => [entry.id, entry]));
  const add = (side, provider, items) => {
    for (const item of Array.isArray(items) ? items : []) {
      const id = String(item?.id ?? '').trim();
      if (!id) continue;
      const risk = TOOL_RISKS.includes(item?.risk) ? item.risk : 'admin';
      const existing = merged.get(id);
      merged.set(id, Object.freeze({
        ...(existing ?? {}),
        id,
        flag: existing?.flag ?? null,
        label: String(item?.label ?? existing?.label ?? id),
        names: existing?.names ?? [],
        side,
        provider,
        source: existing?.source ?? 'builtin',
        risk,
        gated: existing ? existing.gated : CAPABILITY_GATED_RISKS.includes(risk),
        alwaysAllowed: existing ? existing.alwaysAllowed : !CAPABILITY_GATED_RISKS.includes(risk),
      }));
    }
  };
  add('platform', 'qq', platform);
  add('agent', 'dsh', agent);
  return [...merged.values()];
}

/** 平台工具 flag 列表（按目录顺序）。 */
export function platformToolFlags() {
  return PLATFORM_TOOLS.map((tool) => tool.flag);
}

/** flag → 目录条目。 */
export function platformTool(flag) {
  return PLATFORM_TOOLS.find((tool) => tool.flag === flag) ?? null;
}

/** flag → 风险等级；未知 flag 当作 admin（失败关闭）。 */
export function platformToolRisk(flag) {
  return platformTool(flag)?.risk ?? 'admin';
}

/** 某个权限级别是否允许这个平台工具。 */
export function platformToolAllowedAt(level, flag) {
  const allowed = LEVEL_ALLOWS[level];
  if (!allowed) return false;
  return allowed.includes(platformToolRisk(flag));
}

/** 能力预设是否覆盖这个工具（读类不在能力覆盖范围内）。 */
export function capabilityCovers(flag) {
  return CAPABILITY_GATED_RISKS.includes(platformToolRisk(flag));
}

/** 供控制台展示的目录快照。 */
export function toolCatalogSnapshot() {
  return {
    risks: TOOL_RISKS,
    levels: Object.keys(LEVEL_ALLOWS),
    levelAllows: LEVEL_ALLOWS,
    levelAsks: LEVEL_ASKS,
    gatedRisks: CAPABILITY_GATED_RISKS,
    platform: PLATFORM_TOOLS.map((tool) => ({ ...tool, gated: capabilityCovers(tool.flag) })),
    agent: AGENT_MODULES.map((module) => ({ ...module })),
    entries: CATALOG_ENTRIES,
    defaultAgents: Object.fromEntries(Object.entries(CAPABILITY_DEFAULTS).map(([id, value]) => [id, value.agent])),
  };
}
