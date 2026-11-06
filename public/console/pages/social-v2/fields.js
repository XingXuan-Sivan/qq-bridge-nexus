// 二代仿真配置的字段规格：条目即字段，渲染由 components/form 的 renderFields 统一负责。
// page.html 只留分组外壳与说明文字，任何「控件」都必须写在这里，不要再往 HTML 里手写。
// 规格说明见 docs/CONSOLE_FORMS.md §4；非字段控件（动作条、自定义簇、状态位）见 §5。

// 工具开关清单。value 是 config.json 里 socialV2.tools 的键，缺省视为开启。
export const V2_TOOLS = [
  { value: 'getPrompt', label: 'qq_get_prompt', desc: '查看角色卡、推荐值、可用工具、当前唤醒配置' },
  { value: 'getUnread', label: 'qq_get_unread_messages', desc: '查看未读消息，不自动标记已读' },
  { value: 'getRecent', label: 'qq_get_recent_messages', desc: '查看最近消息，支持 offset 扩大范围' },
  { value: 'socialState', label: 'qq_social_state', desc: '查看当前 WakeConfig、未读数、上次唤醒原因等' },
  { value: 'sendGroup', label: 'qq_send_group_message', desc: '向指定群发送一条纯文本消息' },
  { value: 'sendPrivate', label: 'qq_send_private_message', desc: '向指定好友发送一条纯文本消息' },
  { value: 'reply', label: 'qq_reply', desc: '引用/回复某条群消息并发送文本' },
  { value: 'sendBurst', label: 'qq_send_burst', desc: '按数组分多条发送，桥接自动加真人化间隔' },
  { value: 'sendMessage', label: 'qq_send_message', desc: '统一发送：一条/多条/引用/自定义或按字数计算间隔' },
  { value: 'sendPoke', label: 'qq_send_poke', desc: '发送 QQ 拍一拍（群聊传 targetUserId，私聊可省）' },
  { value: 'waitMessages', label: 'qq_wait_for_messages', desc: '短暂等待新消息，有新消息立即返回或超时返回' },
  { value: 'feedback', label: 'qq_report_feedback', desc: '向控制台反馈 AI 遇到的问题/困惑' },
  { value: 'getMyRecent', label: 'qq_get_my_recent_messages', desc: '查看自己最近发过的消息，避免重复' },
  { value: 'getMessageDetail', label: 'qq_get_message_detail', desc: '按 message_id 查看单条消息完整内容' },
  { value: 'getImages', label: 'qq_get_message_images', desc: '查看消息中的图片/表情内容' },
  { value: 'getForwardMsg', label: 'qq_get_forward_msg', desc: '查看当前会话收到的合并转发消息内容' },
  { value: 'getActiveMembers', label: 'qq_get_active_members', desc: '查看最近活跃成员列表' },
  { value: 'setWakeConfig', label: 'qq_set_wake_config', desc: '设置唤醒/潜水条件：无限期、有限时间、@/名字/关键词/概率等' },
  { value: 'markRead', label: 'qq_mark_read', desc: '标记当前未读为已读（看过但决定不回复）' },
  { value: 'memory', label: 'qq_memory_append / qq_memory_query', desc: '轻量记忆：话题/想说的话/群友印象' },
  { value: 'slangQuery', label: 'qq_slang_query', desc: '查询已确认黑话/梗/网络表达' },
  { value: 'slangSubmit', label: 'qq_slang_submit', desc: 'AI 提交陌生词/黑话给管理员筛选' },
  { value: 'listStickers', label: 'qq_list_stickers', desc: '查看/搜索 QQ 收藏表情（含备注和本地笔记）' },
  { value: 'getStickerImage', label: 'qq_get_sticker_image', desc: '看图理解没有备注的收藏表情' },
  { value: 'sendSticker', label: 'qq_send_sticker', desc: '发送收藏表情（一条消息只能一张，不能带文字）' },
  { value: 'collectSticker', label: 'qq_collect_sticker', desc: 'AI 偶尔收藏别人发的表情并写简短备注' },
  { value: 'personProfile', label: 'qq_get_person / qq_note_person', desc: '按 QQ 号查看/记录人物档案（按共享策略过滤可见范围）' },
  { value: 'requestMode', label: 'qq_request_mode_change', desc: '只在管理员私聊里登记模式切换申请；不能执行、不能确认' },
  { value: 'crossGroup', label: 'qq_cross_group_query', desc: '跨群受控查询（还需 crossGroup.enabled 与链接授权）' },
  { value: 'ownerGroupAccess', label: 'qq_owner_peek_group / qq_owner_group_rule', desc: '管理员私聊里只读查看白名单群的消息和记忆，并给群设定长期规则（由桥接写进群会话记忆、每次唤醒注入；默认关闭，改动后需重启 DSH）' },
  { value: 'ownerRelay', label: 'qq_ask_group_session', desc: '管理员私聊里托付某个白名单群的会话去群里说话（默认关闭；由群会话自己组织语言发言，改动后需重启 DSH）' },
  { value: 'getSelfImage', label: 'qq_get_self_image', desc: '查看自己的默认 Q 版形象图片' },
  { value: 'stickerNote', label: 'qq_sticker_note', desc: '给表情记录本地含义/标签/用法' },
  { value: 'setStickerRemark', label: 'qq_set_sticker_remark', desc: '修改 QQ 官方表情备注（默认禁用，慎用）' },
  { value: 'sendVoice', label: 'qq_send_voice / qq_list_voices', desc: '发送语音条（只能发语音库里的音频；偶然而为的强表达）' },
  { value: 'webImage', label: 'qq_search_images / qq_preview_image / qq_send_web_image', desc: '搜图并发送（默认关）：只在管理员私聊里用，「找一张 xxx 的图发我」；必须先看图再发，搜索词会发给 Bing；改后重启 DSH 才会出现在工具列表' },
  { value: 'schedule', label: 'qq_schedule_create / list / update / delete', desc: '定时任务：只在管理员私聊里能用，AI 替你登记提醒、到点由桥接执行；默认只能发给你，登记后桥接另发确认（详见「定时任务」页面）' },
  { value: 'handoverMemory', label: '切到 agent 时带上私聊长期记忆', desc: '不是工具：切到 agent L1～L3 时，把二代仿真里 AI 在管理员私聊记下的话题、想说的话、印象一并交接给 agent（只取管理员私聊的，不含任何群；已脱敏）。关掉后只交接最近的私聊往来' },
];

// 语音库调试簇：输入框 + 开关 + 按钮共处一行，靠 .control-row 保证同高同基线。
const VOICE_PANEL = `<div class="control-row">
  <button id="voiceRefreshBtn" type="button" class="btn">刷新语音库</button>
  <span class="control-label">发送目标</span>
  <input class="control-grow" type="text" id="voiceSendTarget" placeholder="group:100005" aria-label="语音发送目标">
  <button type="button" class="field-switch" role="switch" id="voiceSendDryRun" aria-checked="false" data-on-label="开" data-off-label="关"><span class="field-switch-track" aria-hidden="true"></span><span>关</span></button>
  <span class="control-note">只校验不发送</span>
  <button id="voiceSendBtn" type="button" class="btn">试发选中语音</button>
  <span id="voiceMsg" class="control-note"></span>
</div>
<div id="voiceList" class="voice-list">点「刷新语音库」加载…</div>`;

// 「输入框 + 若干动作按钮」的行，用于日志/记忆/唤醒/初始提示词这类调试工具。
const keyRow = ({ id, placeholder, buttons, status }) => `<div class="control-row">
  <input class="control-grow" type="text" id="${id}" placeholder="${placeholder}" aria-label="${placeholder}">
  ${buttons.map((b) => `<button id="${b.id}" type="button" class="btn${b.variant ? ` ${b.variant}` : ''}">${b.label}</button>`).join('\n  ')}
  ${status ? `<span class="control-note" id="${status}"></span>` : ''}
</div>`;

const MEMORY_ROW = keyRow({
  id: 'v2MemoryKey',
  placeholder: 'group:123456789',
  buttons: [
    { id: 'v2MemoryLoad', label: '加载记忆' },
    { id: 'v2MemoryClearAll', label: '清空全部', variant: 'danger' },
  ],
  status: 'v2MemoryMsg',
});

const WAKE_STATUS_ROW = keyRow({
  id: 'v2WakeKey',
  placeholder: 'group:123456789',
  buttons: [{ id: 'v2WakeStatusLoad', label: '查看唤醒状态' }],
  status: 'v2WakeStatusMsg',
});

const INIT_PROMPT_ROW = keyRow({
  id: 'v2InitPromptKey',
  placeholder: 'group:123456789（可从「白名单会话快速选择」带过来）',
  buttons: [
    { id: 'v2InitPromptLoad', label: '加载' },
    { id: 'v2InitPromptSave', label: '保存' },
    { id: 'v2InitPromptClear', label: '删除', variant: 'danger' },
  ],
  status: 'v2InitPromptMsg',
});

const SESSION_ROW = `<div class="control-row">
  <select class="control-grow" id="v2SessionSelect"><option value="">选择白名单群/私聊…</option></select>
  <button id="v2SessionRefresh" type="button" class="btn">刷新</button>
</div>`;

const STATE_ROW = `<div class="control-row">
  <input class="control-grow" type="text" id="v2StateKey" placeholder="group:123456789" aria-label="要查看的会话 key">
  <button id="v2StateView" type="button" class="btn">查看</button>
  <button id="v2ForceWake" type="button" class="btn">立即唤醒</button>
  <button id="v2StatesList" type="button" class="btn">列出全部会话状态</button>
</div>`;

export const V2_FIELDS = {
  header: {
    label: '顶部开关与预设',
    fields: [
      { name: 'v2Enabled', type: 'switch', label: '启用二代模式' },
      { name: 'v2ProvideRecommendations', type: 'switch', label: '提供推荐值给 AI', hint: '关闭后 qq_get_prompt 不再返回推荐值，AI 完全自主判断。' },
      { name: 'v2AgentPreset', type: 'text', label: 'agentPreset', placeholder: 'qq-chat-v2' },
    ],
  },
  tools: {
    label: '工具开关',
    fields: [
      { name: 'v2Tools', type: 'checkTable', span: 2, options: V2_TOOLS },
    ],
  },
  voice: {
    label: '语音库与语音发送（调试）',
    fields: [
      { name: 'voicePanel', type: 'custom', label: '语音库', span: 2, html: VOICE_PANEL },
    ],
  },
  2: {
    label: '唤醒推荐值（仅参考，AI 可不遵守）',
    fields: [
      { name: 'v2WakeDefaultMode', type: 'select', label: '默认模式', options: [{ value: 'diving', label: '潜水' }, { value: 'active', label: '活跃' }] },
      { name: 'v2RecDefaultInfinite', type: 'switch', label: '无限期（永久）' },
      { name: 'v2RecSleepMin', type: 'number', label: '潜水时长（分）', min: 1 },
      { name: 'v2RecSleepMax', type: 'number', label: '时长上限（分）', min: 1 },
      { name: 'v2RecProb', type: 'number', label: '普通消息概率', min: 0, max: 1, step: 0.05 },
      { name: 'v2RecKeywords', type: 'text', span: 2, label: '关键词（逗号分隔）', placeholder: '小鲸鱼, DeepSeek' },
      { name: 'v2RecAt', type: 'switch', label: '@ 唤醒' },
      { name: 'v2RecName', type: 'switch', label: '名字唤醒' },
      { name: 'v2RecQuestion', type: 'switch', label: '提问唤醒' },
      { name: 'v2RecPoke', type: 'switch', label: '拍一拍唤醒' },
      { name: 'v2WakeHint', type: 'textarea', span: 2, rows: 2, label: '唤醒推荐提示（给 AI 看的文字）', placeholder: '例如：如果你在潜水，推荐 5~120 分钟、普通消息概率 0.05…' },
    ],
  },
  3: {
    label: '唤醒硬限制',
    fields: [
      { name: 'v2SleepMinMs', type: 'number', label: '最小潜水（秒）', min: 0 },
      { name: 'v2SleepMaxMs', type: 'number', label: '最大潜水（秒，0=不限）', min: 0 },
      { name: 'v2MaxWakeMin', type: 'number', label: '每分钟最多唤醒', min: 0 },
      { name: 'v2MaxWakeHour', type: 'number', label: '每小时最多唤醒', min: 0 },
      { name: 'v2BatchWindowMs', type: 'number', label: '合并窗口（毫秒）', min: 1000, step: 500 },
      { name: 'v2NoActionLimit', type: 'number', label: '无行动兜底次数', min: 1 },
      { name: 'v2MaxWakeConfigReminders', type: 'number', label: '唤醒收尾提醒次数', min: 1 },
      { name: 'v2PreSleepWaitEnabled', type: 'switch', label: '启用沉睡前强制等待' },
      { name: 'v2PreSleepWaitMin', type: 'number', label: '沉睡前强制等待（分）', min: 0, step: 1 },
    ],
  },
  4: {
    label: '发送限制',
    fields: [
      { name: 'v2BurstEnabled', type: 'switch', label: '允许多条发送' },
      { name: 'v2BurstMax', type: 'number', label: '单次最多条数', min: 1 },
      { name: 'v2BurstMin', type: 'number', label: '条间间隔（毫秒）', min: 0 },
      { name: 'v2BurstMaxMs', type: 'number', label: '连发窗口 · 上限（毫秒）', min: 0 },
      { name: 'v2LongGapProb', type: 'number', label: '长间隔概率', min: 0, max: 1, step: 0.05 },
      { name: 'v2LongGapMin', type: 'number', label: '长间隔范围（毫秒）', min: 0 },
      { name: 'v2LongGapMax', type: 'number', label: '长间隔 · 上限（毫秒）', min: 0 },
      { name: 'v2MaxSendMin', type: 'number', label: '每分钟最多发送', min: 0 },
      { name: 'v2MaxSendHour', type: 'number', label: '每小时最多发送', min: 0 },
      { name: 'v2MaxMsgChars', type: 'number', label: '单条最大字符', min: 1 },
      { name: 'v2MaxGapMs', type: 'number', label: '最大条间隔（毫秒，防止过长）', min: 100 },
      { name: 'v2GapBaseMs', type: 'number', label: '按字数基础间隔（毫秒）', min: 0 },
      { name: 'v2GapPerCharMs', type: 'number', label: '每字追加（毫秒）', min: 0 },
      { name: 'v2SendHint', type: 'textarea', span: 2, rows: 2, label: '发送推荐提示（给 AI 看的文字）', placeholder: '例如：普通闲聊建议一次 1~3 条，条间 1~3 秒…' },
    ],
  },
  5: {
    label: '等待工具参数（qq_wait_for_messages）',
    fields: [
      { name: 'v2WaitDefaultMs', type: 'number', label: '默认等待（毫秒）', min: 100 },
      { name: 'v2WaitMinMs', type: 'number', label: '最小等待（毫秒）', min: 100 },
      { name: 'v2WaitMaxMs', type: 'number', label: '最大等待（毫秒）', min: 100 },
      { name: 'v2WaitDefaultQuietMs', type: 'number', label: '默认静默窗口（毫秒）', min: 0 },
      { name: 'v2MinQuietAfterNewMs', type: 'number', label: '收到新消息后最小静默（毫秒）', min: 0 },
      { name: 'v2AutoReplyCheckSec', type: 'number', label: '回复检查延迟（秒）', min: 1 },
    ],
  },
  6: {
    label: '主动机会参数（proactive：群安静时 AI 主动冒泡）',
    fields: [
      { name: 'v2ProactiveEnabled', type: 'switch', label: '启用主动机会' },
      { name: 'v2ProactiveIntervalMin', type: 'number', label: '检查间隔（分）', min: 1 },
      { name: 'v2ProactiveIntervalMax', type: 'number', label: '主动冒泡间隔 · 上限（分）', min: 1 },
      { name: 'v2ProactiveIdleThreshold', type: 'number', label: '安静阈值（分）', min: 1 },
      { name: 'v2ProactiveProbability', type: 'number', label: '触发概率', min: 0, max: 1, step: 0.05 },
    ],
  },
  7: {
    label: '表情包参数（sticker：QQ 收藏表情体系）',
    fields: [
      { name: 'v2StickerEnabled', type: 'switch', label: '启用表情包体系' },
      { name: 'v2StickerSyncTtlSec', type: 'number', label: '同步缓存 TTL（秒）', min: 1 },
      { name: 'v2StickerMaxList', type: 'number', label: '列表最大返回数', min: 1, max: 500 },
      { name: 'v2StickerPromptMax', type: 'number', label: '提示中列出常用表情数', min: 1, max: 30 },
      { name: 'v2StickerIncludePrompt', type: 'switch', label: '在 prompt/唤醒里附带表情摘要' },
      { name: 'v2StickerCollectEnabled', type: 'switch', label: 'AI 收藏表情' },
      { name: 'v2StickerCollectPerMin', type: 'number', label: '每分钟最多收藏', min: 0 },
      { name: 'v2StickerCollectPerHour', type: 'number', label: '每小时最多收藏', min: 0 },
      { name: 'v2StickerCollectRemarkMax', type: 'number', label: '收藏备注最大字数', min: 1, max: 50 },
    ],
  },
  stickerActions: {
    label: '表情说明补全',
    fields: [
      { type: 'action', items: [{ id: 'stickerDescribeBtn', label: '让 AI 看图补表情说明' }], status: 'stickerDescribeStatus', statusText: '加载中…' },
    ],
  },
  8: {
    label: '上下文参数（recent / unread / contextWindow）',
    fields: [
      { name: 'v2ContextRecentLimit', type: 'number', label: '最近消息上限', min: 1 },
      { name: 'v2ContextUnreadLimit', type: 'number', label: '未读上限', min: 1 },
      { name: 'v2ContextWindow', type: 'number', label: '上下文窗口', min: 1 },
    ],
  },
  9: {
    label: '反馈工具参数（qq_report_feedback）',
    fields: [
      { name: 'v2FeedbackMaxLength', type: 'number', label: '反馈最大长度', min: 1 },
      { name: 'v2FeedbackNotifyOwner', type: 'switch', label: '错误级通知 owner' },
    ],
  },
  feedbackActions: {
    label: 'AI 反馈',
    fields: [
      { type: 'action', items: [{ id: 'v2FeedbackLoad', label: '加载 AI 反馈' }, { id: 'v2FeedbackClear', label: '清空 AI 反馈', variant: 'danger' }], status: 'v2FeedbackMsg' },
    ],
  },
  toolLog: {
    label: '工具调用日志',
    fields: [
      { type: 'action', items: [{ id: 'v2ToolLogLoad', label: '加载工具日志' }, { id: 'v2ToolLogClear', label: '清空工具日志', variant: 'danger' }], status: 'v2ToolLogMsg' },
    ],
  },
  memory: {
    label: '轻量记忆',
    fields: [
      { name: 'v2MemoryKeyField', type: 'custom', span: 2, label: '会话 key', html: MEMORY_ROW },
    ],
  },
  wakeStatus: {
    label: '唤醒状态',
    fields: [
      { name: 'v2WakeKeyField', type: 'custom', span: 2, label: '会话 key', html: WAKE_STATUS_ROW },
    ],
  },
  initPrompt: {
    label: '初始提示词',
    fields: [
      { name: 'v2InitPromptKeyField', type: 'custom', span: 2, label: '会话 key', html: INIT_PROMPT_ROW },
      { name: 'v2InitPromptText', type: 'textarea', span: 2, rows: 5, label: '提示词正文', placeholder: '例如：这是一个偏技术的闲聊群，群友喜欢玩梗、聊模型和本地部署；氛围轻松，别长篇大论，遇到配置问题直接给结论。' },
    ],
  },
  sessionPick: {
    label: '白名单会话',
    fields: [
      { name: 'v2SessionPickField', type: 'custom', span: 2, label: '会话', html: SESSION_ROW },
    ],
  },
  stateView: {
    label: '会话状态',
    fields: [
      { name: 'v2StateKeyField', type: 'custom', span: 2, label: '会话 key', html: STATE_ROW },
    ],
  },
  saveBar: {
    label: '保存',
    fields: [
      { type: 'action', items: [
        { id: 'v2PauseBtn', label: '暂停二代 AI', variant: 'danger', small: false },
        { id: 'v2ResumeBtn', label: '恢复二代 AI', small: false },
        { id: 'v2ResetBtn', label: '重置二代状态', variant: 'danger', small: false },
        { id: 'v2ConfigSave', label: '保存当前参数（写入 config.json）', variant: 'primary', small: false },
      ], status: 'v2ConfigMsg' },
    ],
  },
};
