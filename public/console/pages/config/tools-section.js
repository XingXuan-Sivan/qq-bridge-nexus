// 全局配置 → 拓展功能：QQ 工具开关（系统层 config.tools）+ 语音库调试（/api/voice/*）。
// 工具权限的按预设细化在预设页的 extensions.yml；这里只保留全局开关，避免两处各写一套解析。
import { api } from '../../js/api.js';
import { esc } from '../../js/ui.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';

// [key, 工具名, 说明, 分类]。分类用于表格筛选；新增工具时补上第四项。
const TOOLS = [
  ['getPrompt', 'qq_get_prompt', '查看角色卡、推荐值、可用工具、当前唤醒配置', '读取'],
  ['getUnread', 'qq_get_unread_messages', '查看未读消息，不自动标记已读', '读取'],
  ['getRecent', 'qq_get_recent_messages', '查看最近消息，支持 offset 扩大范围', '读取'],
  ['socialState', 'qq_social_state', '查看当前 WakeConfig、未读数、上次唤醒原因等', '会话'],
  ['sendGroup', 'qq_send_group_message', '向指定群发送一条纯文本消息', '发送'],
  ['sendPrivate', 'qq_send_private_message', '向指定好友发送一条纯文本消息', '发送'],
  ['reply', 'qq_reply', '引用/回复某条群消息并发送文本', '发送'],
  ['sendBurst', 'qq_send_burst', '按数组分多条发送，桥接自动加真人化间隔', '发送'],
  ['sendMessage', 'qq_send_message', '统一发送：一条/多条/引用/自定义或按字数计算间隔', '发送'],
  ['sendPoke', 'qq_send_poke', '发送 QQ 拍一拍（群聊传 targetUserId，私聊可省）', '发送'],
  ['waitMessages', 'qq_wait_for_messages', '短暂等待新消息，有新消息立即返回或超时返回', '读取'],
  ['feedback', 'qq_report_feedback', '向控制台反馈 AI 遇到的问题/困惑', '反馈与媒体'],
  ['getMyRecent', 'qq_get_my_recent_messages', '查看自己最近发过的消息，避免重复', '读取'],
  ['getMessageDetail', 'qq_get_message_detail', '按 message_id 查看单条消息完整内容', '读取'],
  ['getImages', 'qq_get_message_images', '查看消息中的图片/表情内容', '读取'],
  ['getForwardMsg', 'qq_get_forward_msg', '查看当前会话收到的合并转发消息内容', '读取'],
  ['getActiveMembers', 'qq_get_active_members', '查看最近活跃成员列表', '读取'],
  ['setWakeConfig', 'qq_set_wake_config', '设置唤醒/潜水条件：无限期、有限时间、@/名字/关键词/概率等', '会话'],
  ['markRead', 'qq_mark_read', '标记当前未读为已读（看过但决定不回复）', '读取'],
  ['memory', 'qq_memory_append / query / remove / clear', '轻量记忆：话题、想法、印象与规则（按会话隔离）', '记忆'],
  ['slangQuery', 'qq_slang_query', '查询已确认黑话/梗/网络表达', '记忆'],
  ['slangSubmit', 'qq_slang_submit', 'AI 提交陌生词/黑话给管理员筛选', '记忆'],
  ['listStickers', 'qq_list_stickers', '查看/搜索 QQ 收藏表情（含备注和本地笔记）', '表情与语音'],
  ['getStickerImage', 'qq_get_sticker_image', '看图理解没有备注的收藏表情', '表情与语音'],
  ['sendSticker', 'qq_send_sticker', '发送收藏表情（一条消息只能一张，不能带文字）', '表情与语音'],
  ['collectSticker', 'qq_collect_sticker', 'AI 偶尔收藏别人发的表情并写简短备注', '表情与语音'],
  ['personProfile', 'qq_get_person / qq_note_person', '按 QQ 号查看/记录人物档案（按共享策略过滤可见范围）', '记忆'],
  ['requestMode', 'qq_request_mode_change', '只在管理员私聊里登记模式切换申请；不能执行、不能确认', '管理与定时'],
  ['crossGroup', 'qq_cross_group_query', '跨群受控查询（还需 crossGroup.enabled 与链接授权）', '管理与定时'],
  ['ownerGroupAccess', 'qq_owner_peek_group / qq_owner_group_rule', '管理员私聊里只读查看白名单群消息和记忆，并给群设长期规则', '管理与定时'],
  ['ownerRelay', 'qq_ask_group_session', '管理员私聊里托付某个白名单群的会话去群里说话', '管理与定时'],
  ['getSelfImage', 'qq_get_self_image', '查看自己的默认 Q 版形象图片', '表情与语音'],
  ['stickerNote', 'qq_sticker_note', '给表情记录本地含义/标签/用法', '表情与语音'],
  ['setStickerRemark', 'qq_set_sticker_remark', '修改 QQ 官方表情备注（默认禁用，慎用）', '表情与语音'],
  ['sendVoice', 'qq_send_voice / qq_list_voices', '发送语音条（只能发语音库里的音频；偶然而为的强表达）', '表情与语音'],
  ['webImage', 'qq_search_images / qq_preview_image / qq_send_web_image', '搜图并发送（默认关）：只在管理员私聊里用', '反馈与媒体'],
  ['schedule', 'qq_schedule_create / list / update / delete', '定时任务：只在管理员私聊里能用，到点由桥接执行', '管理与定时'],
];

const TOOL_CATEGORIES = ['读取', '发送', '会话', '记忆', '表情与语音', '管理与定时', '反馈与媒体'];

const VOICE_HTML = `<div class="control-row">
  <button id="voiceRefreshBtn" type="button" class="btn">刷新语音库</button>
  <span class="control-label">发送目标</span>
  <input class="control-grow" type="text" id="voiceSendTarget" placeholder="group:100005" aria-label="语音发送目标">
  <button type="button" class="field-switch" role="switch" id="voiceSendDryRun" aria-checked="false" data-on-label="开" data-off-label="关"><span class="field-switch-track" aria-hidden="true"></span><span>关</span></button>
  <span class="control-note">只校验不发送</span>
  <button id="voiceSendBtn" type="button" class="btn">试发选中语音</button>
  <span id="voiceMsg" class="control-note"></span>
</div>
<div id="voiceList" class="voice-list">点「刷新语音库」加载…</div>`;

let voiceEntries = [];
let voiceLoaded = false;

function toolsMsg(text, ok) {
  const node = document.getElementById('toolsMsg');
  if (!node) return;
  node.textContent = text;
  node.className = ok ? 'form-actions-status ok' : 'form-actions-status err';
}

function toolInput(key) {
  return document.querySelector(`#toolsPanel input[data-tool="${key}"]`);
}

async function refreshTools() {
  try {
    const result = await api('/api/config/tools');
    for (const [key] of TOOLS) {
      const input = toolInput(key);
      if (input) input.checked = result.tools?.[key] !== false;
    }
  } catch (error) {
    toolsMsg(`读取失败：${error?.message ?? error}`, false);
  }
}

async function saveTools() {
  const tools = {};
  for (const [key] of TOOLS) {
    tools[key] = Boolean(toolInput(key)?.checked);
  }
  try {
    const result = await api('/api/config/tools', 'POST', { tools });
    toolsMsg(result.ok ? '✅ 已保存；重启 DSH 后工具清单生效' : `❌ ${result.error || '保存失败'}`, result.ok);
  } catch (error) {
    toolsMsg(`❌ ${error?.message ?? error}`, false);
  }
}

function toolsTableHtml() {
  const rows = TOOLS.map(([key, label, desc, category]) => ({
    attrs: { 'data-filter-cat': category, 'data-tool-row': key },
    cells: [
      `<code>${esc(label)}</code>`,
      `<span class="table-tag">${esc(category)}</span>`,
      `<span class="meta">${esc(desc)}</span>`,
      `<label class="table-check"><input type="checkbox" data-tool="${esc(key)}" aria-label="启用 ${esc(label)}"></label>`,
    ],
  }));
  return dataTableHtml({
    columns: [
      { label: '工具', width: 300 },
      { label: '分类', width: 110 },
      { label: '说明' },
      { label: '开关', width: 80 },
    ],
    rows,
    search: { placeholder: '搜索工具名或说明…' },
    filters: [{ id: 'cat', label: '分类', options: [{ value: 'all', label: '全部分类' }, ...TOOL_CATEGORIES.map((c) => ({ value: c, label: c }))] }],
    meta: `共 ${TOOLS.length} 项`,
    actions: `<button type="button" class="btn small primary" id="toolsSave">保存工具开关</button>
      <span id="toolsMsg" class="form-actions-status"></span>`,
  });
}

async function loadVoice(force) {
  if (voiceLoaded && force !== true) return;
  const box = document.getElementById('voiceList');
  const msg = document.getElementById('voiceMsg');
  try {
    const result = await api('/api/voice/list?probe=1');
    voiceEntries = Array.isArray(result.voices) ? result.voices : [];
    voiceLoaded = true;
    const limits = result.limits ?? {};
    if (!voiceEntries.length) {
      box.innerHTML = `<span class="meta">语音库是空的：把音频文件放进 qq-bridge/audio/ 后点「刷新语音库」。</span>`;
      return;
    }
    box.innerHTML = `<div class="meta">共 ${voiceEntries.length} 个（上限：${limits.maxSeconds || '?'} 秒 / ${limits.maxBytes || '?'} 字节）</div>`
      + voiceEntries.map((voice, index) => `<label class="voice-item"><input type="radio" name="voicePick" value="${index}"${index === 0 ? ' checked' : ''}> ${esc(voice.name)} <span class="meta">${esc(voice.detail || (voice.seconds ? `${Math.round(Number(voice.seconds))} 秒` : ''))}</span></label>`).join('');
    msg.textContent = '';
  } catch (error) {
    box.innerHTML = `<span class="meta err">读取失败：${esc(error?.message ?? error)}</span>`;
  }
}

async function sendVoice() {
  const msg = document.getElementById('voiceMsg');
  const target = document.getElementById('voiceSendTarget').value.trim();
  const pick = document.querySelector('input[name="voicePick"]:checked');
  const dryRun = document.getElementById('voiceSendDryRun')?.getAttribute('aria-checked') === 'true';
  if (!target) { msg.textContent = '先填发送目标'; return; }
  if (!pick) { msg.textContent = '先选一个语音'; return; }
  const entry = voiceEntries[Number(pick.value)];
  try {
    const result = await api('/api/voice/send', 'POST', { target, file: entry.name, dryRun });
    msg.textContent = result.ok ? (dryRun ? '✅ 校验通过（未发送）' : '✅ 已发送') : `❌ ${result.error || '发送失败'}`;
    msg.className = result.ok ? 'control-note ok' : 'control-note err';
  } catch (error) {
    msg.textContent = `❌ ${error?.message ?? error}`;
    msg.className = 'control-note err';
  }
}

export function initToolsSection() {
  const host = document.getElementById('toolsPanel');
  if (!host) return;
  host.innerHTML = `<section class="card span-all">
    <h2>QQ 工具</h2>
    <p class="meta">系统层开关决定 AI 能拿到哪些 QQ 工具；按预设的细化授权在「预设」页的扩展授权里。改动后重启 DSH 才会刷新工具清单。</p>
    <div id="toolsTable">${toolsTableHtml()}</div>
  </section>
  <section class="card span-all">
    <h2>语音库与语音发送</h2>
    <p class="meta">语音库目录由 <code>config.voice.dir</code> 决定；试发走与 AI 通道相同的解析/校验/限流路径。</p>
    ${VOICE_HTML}
  </section>`;
  initDataTables(document.getElementById('toolsTable'));
  document.getElementById('toolsSave').addEventListener('click', saveTools);
  document.getElementById('voiceRefreshBtn').addEventListener('click', () => loadVoice(true));
  document.getElementById('voiceSendBtn').addEventListener('click', sendVoice);
  document.getElementById('voiceSendDryRun').addEventListener('click', (event) => {
    const button = event.currentTarget;
    const next = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(next));
    button.querySelector('span:last-child').textContent = next ? '开' : '关';
  });
  loadVoice(false);
  refreshTools();
}
