// 工具目录：平台工具与 Agent 工具的唯一定义处。
//
// 两个层次，职责不重叠：
//   · TOOL_GROUPS —— 模型可见的 **8 个中立工具**；换平台不改这一层；
//   · PLATFORM_TOOLS —— 组内的单项（flag）。一个 flag 对应若干宿主工具名（qq_*）。
//     flag 仍只是登记与权限判定的单位，宿主名只用于解析旧名与报错文案。
//
// 目录本身是只读投影，不存配置：发哪些工具由平台声明（profiles/platforms/<id>/tools.yml）
// 决定，能用到哪一档由会话权限级别（src/session/permission.mjs）收紧。
//
// Agent 侧的工具模块**不在这里**：它属于当前执行体，由 `profiles/agent-platforms/<id>/tools.yml`
// 声明（`readAgentPlatformTools()`），快照时并进 `entries`。写死在内核里会让「换执行体」
// 只换了名字、没换工具面。

/** 风险等级（越往后越危险）。 */
export const TOOL_RISKS = Object.freeze(['read', 'send', 'state', 'write', 'exec', 'admin']);

/** 平台侧（QQ 桥接提供的工具）。flag 即能力预设 tools.platform 的键，也是推导注册开关时的键。 */
export const PLATFORM_TOOLS = Object.freeze([
  { flag: 'status', label: '机器人登录状态', names: ['qq_status'], risk: 'read' },
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
  { flag: 'setStickerRemark', label: '设置表情备注', names: ['qq_set_sticker_remark'], risk: 'state', defaultOff: true },
  { flag: 'collectSticker', label: '收藏表情', names: ['qq_collect_sticker'], risk: 'state' },
  { flag: 'sendGroup', label: '发送群消息', names: ['qq_send_group_message'], risk: 'send' },
  { flag: 'sendPrivate', label: '发送私聊消息', names: ['qq_send_private_message'], risk: 'send' },
  { flag: 'reply', label: '引用回复', names: ['qq_reply'], risk: 'send' },
  { flag: 'sendBurst', label: '分多条发送', names: ['qq_send_burst'], risk: 'send' },
  { flag: 'sendMessage', label: '统一发送', names: ['qq_send_message'], risk: 'send' },
  { flag: 'sendPoke', label: '拍一拍', names: ['qq_send_poke'], risk: 'send' },
  { flag: 'sendSticker', label: '发表情', names: ['qq_send_sticker'], risk: 'send' },
  { flag: 'sendVoice', label: '发语音', names: ['qq_send_voice', 'qq_list_voices'], risk: 'send', defaultOff: true },
  { flag: 'webImage', label: '搜索/发送网图', names: ['qq_search_images', 'qq_preview_image', 'qq_send_web_image'], risk: 'send', defaultOff: true },
  { flag: 'feedback', label: '向管理端反馈', names: ['qq_report_feedback'], risk: 'admin' },
  { flag: 'crossGroup', label: '跨群查询', names: ['qq_cross_group_query'], risk: 'admin' },
  { flag: 'ownerGroupAccess', label: 'owner 群权限管理', names: ['qq_owner_peek_group', 'qq_owner_group_rule'], risk: 'admin', defaultOff: true },
  { flag: 'ownerRelay', label: '让群会话代为转达', names: ['qq_ask_group_session'], risk: 'admin', defaultOff: true },
  { flag: 'schedule', label: '定时任务', names: ['qq_schedule_create', 'qq_schedule_list', 'qq_schedule_update', 'qq_schedule_delete'], risk: 'admin' },
]);

/** 可被会话权限与能力预设收紧的平台工具（副作用类；读类只受平台声明的注册结果控制）。 */
export const CAPABILITY_GATED_RISKS = Object.freeze(['send', 'state', 'admin']);

/**
 * 模型可见的 8 个中立工具：`id` 是模型看到的工具名，`covers` 是它背后的平台 flag。
 * 平台声明里没写的 flag 就是「这个平台做不到」，由 `describeToolGroups()` 写进描述。
 */
const TOOL_GROUP_DEFS = Object.freeze([
  {
    id: 'read_messages',
    label: '读消息',
    note: '读取会话里的消息：未读、最近、我发过的、单条详情、图片、合并转发，以及等新消息。',
    covers: ['getUnread', 'getRecent', 'getMyRecent', 'getMessageDetail', 'getImages', 'getForwardMsg', 'waitMessages'],
  },
  {
    id: 'get_member',
    label: '看成员',
    note: '查看群成员活跃度与群友档案（可读可记）。',
    covers: ['getActiveMembers', 'personProfile'],
  },
  {
    id: 'send',
    label: '发消息',
    note: '向会话发送消息（段数组入参：文本、@、引用、图片、表情、语音、网图）。',
    covers: ['sendGroup', 'sendPrivate', 'reply', 'sendBurst', 'sendMessage', 'sendSticker', 'sendVoice', 'webImage'],
  },
  {
    id: 'act',
    label: '做动作',
    note: '消息之外的动作：拍一拍、收藏表情、写表情备注、查看收藏。',
    covers: ['sendPoke', 'collectSticker', 'setStickerRemark', 'stickerNote', 'listStickers', 'getStickerImage'],
  },
  {
    id: 'conversation_state',
    label: '会话状态',
    note: '查看机器人登录状态与会话状态、标记已读、调整唤醒配置。',
    covers: ['status', 'socialState', 'markRead', 'setWakeConfig'],
  },
  {
    id: 'memory',
    label: '本机记忆',
    note: '本机轻量记忆：写入、查询、召回、删除。',
    covers: ['memory'],
  },
  {
    id: 'slang',
    label: '黑话',
    note: '查群黑话，或提交新候选。',
    covers: ['slangQuery', 'slangSubmit'],
  },
  {
    id: 'admin',
    label: '管理端',
    note: '管理端动作：反馈、跨群、owner 群权限、代为转达、定时任务、读提示词、自画像。',
    covers: ['feedback', 'crossGroup', 'ownerGroupAccess', 'ownerRelay', 'schedule', 'getPrompt', 'getSelfImage'],
  },
]);

/** 组内动作名：op 就是宿主名去掉平台前缀（qq_send_message → send_message）；一个 flag 可以有多条宿主名。 */
export function opNamesOf(tool) {
  return (tool.names ?? []).map((name) => String(name).replace(/^qq_/, ''));
}

/**
 * 由 flag 定义推出 8 组：风险取组内最高的一档（组只是模型侧的词表，判定仍按 flag）。
 * 组里引用了不存在的 flag 会在模块加载期直接抛错 —— 那是目录自己的笔误，不该留到运行期。
 */
export const TOOL_GROUPS = Object.freeze(TOOL_GROUP_DEFS.map((group) => {
  const ops = group.covers
    .map((flag) => PLATFORM_TOOLS.find((tool) => tool.flag === flag))
    .filter(Boolean);
  const unknown = group.covers.filter((flag) => !ops.some((tool) => tool.flag === flag));
  if (unknown.length) throw new Error(`工具组 ${group.id} 引用了不在目录里的 flag：${unknown.join('、')}`);
  const risk = ops.reduce((worst, tool) => (TOOL_RISKS.indexOf(tool.risk) > TOOL_RISKS.indexOf(worst) ? tool.risk : worst), 'read');
  return Object.freeze({
    id: group.id,
    label: group.label,
    note: group.note,
    covers: Object.freeze([...group.covers]),
    ops: Object.freeze(ops.map((tool) => Object.freeze({ flag: tool.flag, label: tool.label, risk: tool.risk, names: tool.names }))),
    names: Object.freeze(ops.flatMap((tool) => tool.names)),
    risk,
    gated: CAPABILITY_GATED_RISKS.includes(risk),
    alwaysAllowed: !CAPABILITY_GATED_RISKS.includes(risk),
  });
}));

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

/** 每级额外需要确认的风险类别：由执行体自己的权限档/审批策略执行，桥接这一侧只做 allow/deny。 */
export const LEVEL_ASKS = Object.freeze({
  'read-only': Object.freeze([]),
  'workspace-write': Object.freeze([]),
  'full-ask': Object.freeze(['exec', 'admin']),
  full: Object.freeze([]),
});

/** 工具来源两侧（平台 = 用户侧平台；Agent = 执行体运行时）。 */
export const TOOL_SIDES = Object.freeze(['platform', 'agent']);

/**
 * 统一目录条目（内置部分）：平台侧以 8 个组的 id 为 id（组内的 flag 列在 `flags`）。
 * `gated` = 会话权限与能力预设可以收紧；读类组恒 false。
 * `flag` 只有经旧名或 flag 反查时才填，直接按组 id 取到的是 null。
 * Agent 侧的条目由 `toolCatalogSnapshot()` 从活动执行体的 tools.yml 并入。
 */
export const CATALOG_ENTRIES = Object.freeze([
  ...TOOL_GROUPS.map((group) => Object.freeze({
    id: group.id,
    flag: null,
    group: group.id,
    label: group.label,
    names: group.names,
    flags: group.covers,
    side: 'platform',
    provider: 'platform',
    source: 'builtin',
    risk: group.risk,
    gated: group.gated,
    alwaysAllowed: group.alwaysAllowed,
    desc: group.note,
  })),
]);

/**
 * 平台侧目录条目（组 id → 条目）。旧名仍可解析：宿主工具名（qq_send_message）与组内 flag
 * 都落到它所属的那一组，并把命中的 flag / 宿主名一并带出来。
 *
 * Agent 侧的模块条目不在静态表里（它跟着执行体变），要看拼好的全集请用 `toolCatalogSnapshot()`。
 */
export function catalogEntry(id) {
  const value = String(id ?? '');
  const direct = CATALOG_ENTRIES.find((entry) => entry.id === value);
  if (direct) return direct;
  for (const entry of CATALOG_ENTRIES) {
    const group = TOOL_GROUPS.find((item) => item.id === entry.id);
    const op = group?.ops.find((item) => item.flag === value || item.names.includes(value));
    if (op) return { ...entry, flag: op.flag, name: op.names.includes(value) ? value : op.names[0] ?? null };
  }
  return null;
}

/** 组 id / 组内 flag / 宿主工具名 → 所属的组（用于注册期过滤与报错文案）。 */
export function toolGroup(id) {
  const value = String(id ?? '');
  return TOOL_GROUPS.find((group) => group.id === value
    || group.covers.includes(value)
    || group.names.includes(value)) ?? null;
}

/**
 * 工具描述：由本平台声明的工具项生成（输入是 profiles/platforms/<id>/tools.yml 读出的那份）。
 * 声明里没有的 flag 就是「这个平台做不到」，写进描述让模型别去试。
 */
export function describeToolGroups(declared = []) {
  const flags = new Set((Array.isArray(declared) ? declared : [])
    .map((item) => String(item?.flag ?? ''))
    .filter(Boolean));
  return TOOL_GROUPS.map((group) => {
    const supported = group.ops.filter((op) => flags.has(op.flag));
    const missing = group.ops.filter((op) => !flags.has(op.flag));
    const parts = [group.note];
    if (supported.length) parts.push(`本平台支持：${supported.map((op) => op.label).join('、')}。`);
    if (missing.length) {
      parts.push(supported.length
        ? `不支持：${missing.map((op) => op.label).join('、')}。`
        : '本平台不支持这组能力，调用会得到 capability_unsupported。');
    }
    return Object.freeze({
      id: group.id,
      label: group.label,
      description: parts.join(''),
      supported: supported.map((op) => op.flag),
      missing: missing.map((op) => op.flag),
    });
  });
}

/**
 * 由两端适配器声明的工具合并出目录条目（适配器只声明 id/label/risk）。
 * 内置条目优先；重复 id 时以适配器声明覆盖 label/risk，但保留 source。
 */
export function catalogFromAdapters({ platform = [], agent = [], platformProvider = 'platform', agentProvider = 'agent' } = {}) {
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
  add('platform', platformProvider, platform);
  add('agent', agentProvider, agent);
  return [...merged.values()];
}

/** 平台工具 flag 列表（按目录顺序）。 */
export function platformToolFlags() {
  return PLATFORM_TOOLS.map((tool) => tool.flag);
}

/** 全量平台工具白名单：新建能力档时的显式起点（键齐、值统一）。 */
export function platformToolMap(value = false) {
  return Object.fromEntries(PLATFORM_TOOLS.map((tool) => [tool.flag, value]));
}

/**
 * 平台声明的注册开关：声明了就是「这个平台有」，`defaultOff` 的不默认注册。
 * 这是工具面唯一的开关来源（能力档不再保存 tools.platform）。
 */
export function declaredToolFlags(declared = []) {
  const flags = {};
  for (const item of Array.isArray(declared) ? declared : []) {
    const flag = String(item?.flag ?? '').trim();
    if (!flag) continue;
    flags[flag] = item.defaultOff !== true;
  }
  return flags;
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

/**
 * 会话权限闸门：返回 `allow` / `deny`。
 * 权限级别是**过滤器**——不改变会话已注入的能力，只决定这一级还能不能调用这类工具。
 * 未知级别一律 deny（失败关闭）。
 */
export function platformToolGateAt(level, flag) {
  return platformToolAllowedAt(level, flag) ? 'allow' : 'deny';
}

/** 能力预设是否覆盖这个工具（读类不在能力覆盖范围内）。 */
export function capabilityCovers(flag) {
  return CAPABILITY_GATED_RISKS.includes(platformToolRisk(flag));
}

/**
 * 供控制台展示的目录快照：组是模型看到的，platform 是组内的单项（带所属组），
 * agent 是**当前执行体**声明的模块（来自它的 tools.yml，由调用方读好传进来）。
 *
 * 执行体由 `agentPlatform` 指定，并作为 agent 条目的 `provider` —— 换成 ACP，
 * 控制台看到的模块名与 provider 就跟着变，回不到写死的那份。
 */
export function toolCatalogSnapshot({ agentPlatform = '', agentTools = [] } = {}) {
  const agent = Array.isArray(agentTools) ? agentTools : [];
  return {
    risks: TOOL_RISKS,
    levels: Object.keys(LEVEL_ALLOWS),
    levelAllows: LEVEL_ALLOWS,
    levelAsks: LEVEL_ASKS,
    gatedRisks: CAPABILITY_GATED_RISKS,
    groups: TOOL_GROUPS.map((group) => ({ ...group })),
    platform: PLATFORM_TOOLS.map((tool) => ({
      ...tool,
      group: toolGroup(tool.flag)?.id ?? '',
      gated: capabilityCovers(tool.flag),
    })),
    agent,
    entries: catalogFromAdapters({ agent, agentProvider: agentPlatform || 'agent' }),
  };
}
