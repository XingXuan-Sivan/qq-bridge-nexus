// 二代仿真（social-v2）页面：配置、语音库、工具日志、轻量记忆与唤醒状态。
// 页面由 router.js 注入 page.html 后调用 init()；所有 DOM 绑定都发生在这之后。
import { api } from '../../js/api.js';
import { esc } from '../../js/ui.js';
import { onPageRefresh } from '../../js/router.js';

// ── 一键补表情说明 ─────────────────────────────────────────────
let stickerDescribeTimer = null;
function renderStickerDescribe(r) {
  const el = document.getElementById('stickerDescribeStatus');
  const btn = document.getElementById('stickerDescribeBtn');
  if (!el || !r || !r.ok) { if (el) el.textContent = (r && r.error) || '读取失败'; return; }
  let text = `共 ${r.total} 张收藏表情，其中 ${r.undescribed} 张没有说明`;
  if (r.running) text = `⏳ 正在看图补说明：${r.progress.done}/${r.progress.total}…`;
  else if (r.last) text = (r.last.ok ? '✅ ' : '⚠️ ') + r.last.text;
  if (!r.running && r.blocker && r.undescribed) text += `（现在不能运行：${r.blocker}）`;
  el.textContent = text;
  btn.disabled = !!r.running || !r.undescribed || !!r.blocker;
  btn.textContent = r.undescribed ? `让 AI 看图补表情说明（${Math.min(r.undescribed, r.max)} 张）` : '所有表情都有说明了';
  clearTimeout(stickerDescribeTimer);
  if (r.running) stickerDescribeTimer = setTimeout(refreshStickerDescribe, 2500);
}
async function refreshStickerDescribe() {
  try { renderStickerDescribe(await api('/api/stickers/describe')); } catch {}
}

// ── 语音库与语音发送（调试面板） ───────────────────────────────────────────
// 试发走 /api/voice/send（操作者通道，凭控制台令牌），与 CLI 同一条路径 ——
// 所以这里能验证「白名单 / 时长体积上限 / 限流 / 文件名审计」是不是真的生效。
let voiceEntries = [];
let voiceLibraryLoaded = false;
// 只在首次进入/手动刷新时拉取：语音库会逐个 ffprobe 探测时长，放进 3 秒轮询会白白压网关。
async function loadVoiceLibrary(force) {
  if (voiceLibraryLoaded && force !== true) return;
  const box = document.getElementById('voiceList');
  const msg = document.getElementById('voiceMsg');
  try {
    const r = await api('/api/voice/list?probe=1');
    voiceEntries = Array.isArray(r.voices) ? r.voices : [];
    voiceLibraryLoaded = true;
    if (!voiceEntries.length) {
      box.innerHTML = '语音库是空的：把音频文件放进 <code>qq-bridge/audio/</code> 后点「刷新语音库」。';
      return;
    }
    const limits = r.limits || {};
    box.innerHTML = '共 ' + voiceEntries.length + ' 个（上限：' + (limits.maxSeconds || '?') + ' 秒 / '
      + Math.round((limits.maxBytes || 0) / 1024 / 1024) + ' MiB / ' + (limits.maxPerMinute || '?') + ' 每分钟）：<br>'
      + voiceEntries.map((v, i) => {
        const bad = v.ok === false;
        // v.name / v.error / v.detail 来自语音库的文件名与探测结果，属于**外部数据**：
        // 语音库目录里放一个名为 `x<img src=x onerror=...>.mp3` 的文件即可注入脚本
        // （CSP 允许 unsafe-inline，拦不住内联事件处理器）。所有插值都必须过 esc()。
        return '<label class="u-block-my-2">'
          + '<input type="radio" name="voicePick" value="' + i + '"' + (i === 0 ? ' checked' : '') + '> '
          + '<code>' + esc(v.name) + '</code> ' + (bad ? '❌ ' + esc(v.error || '不可用') : esc(v.detail || ''))
          + '</label>';
      }).join('');
  } catch (error) {
    box.textContent = '加载失败：' + (error && error.message ? error.message : error);
  }
  if (msg) msg.textContent = '';
}

async function sendVoiceFromConsole() {
  const msg = document.getElementById('voiceMsg');
  const target = document.getElementById('voiceSendTarget').value.trim();
  const dryRun = document.getElementById('voiceSendDryRun').checked;
  const pick = document.querySelector('input[name="voicePick"]:checked');
  if (!target) { msg.textContent = '❌ 请填发送目标（如 group:100005）'; msg.className = 'meta err'; return; }
  if (!pick) { msg.textContent = '❌ 先刷新语音库并选中一个音频'; msg.className = 'meta err'; return; }
  const entry = voiceEntries[Number(pick.value)];
  msg.textContent = '发送中…'; msg.className = 'meta';
  try {
    const r = await api('/api/voice/send', 'POST', { target, file: entry.name, dryRun });
    if (r.dryRun) {
      msg.textContent = '✅ 校验通过（未发送）：' + (r.detail || '');
      msg.className = 'meta ok';
    } else if (r.ok) {
      msg.textContent = '✅ 已发出 messageId=' + (r.messageId ?? '?')
        + (r.detail ? '（' + r.detail + '）' : '')
        + (r.verified ? '，已回读校验为语音段' : '，未能回读校验');
      msg.className = 'meta ok';
    } else {
      msg.textContent = '❌ ' + (r.error || '失败');
      msg.className = 'meta err';
    }
  } catch (error) {
    msg.textContent = '❌ ' + (error && error.message ? error.message : error);
    msg.className = 'meta err';
  }
}

// ── 二代仿真模式（reserved2）配置 ─────────────────────────────────────────
async function loadV2Config() {
  try {
    const r = await api('/api/socialV2/config');
    const c = r.config || {};
    document.getElementById('v2Enabled').checked = c.enabled !== false;
    document.getElementById('v2AgentPreset').value = c.agentPreset || '';
    document.getElementById('v2ProvideRecommendations').checked = c.provideRecommendations !== false;
    document.querySelectorAll('[data-v2-tool]').forEach(el => {
      el.checked = (c.tools && c.tools[el.dataset.v2Tool] !== false);
    });
    const w = c.wake || {};
    document.getElementById('v2WakeDefaultMode').value = w.defaultMode === 'active' ? 'active' : 'diving';
    document.getElementById('v2RecDefaultInfinite').checked = w.recommendedDefaultInfinite !== false;
    document.getElementById('v2RecSleepMin').value = Math.round((w.recommendedSleepMinMs || 300000) / 60000);
    document.getElementById('v2RecSleepMax').value = Math.round((w.recommendedSleepMaxMs || 7200000) / 60000);
    document.getElementById('v2RecProb').value = w.recommendedProbability ?? 0.05;
    document.getElementById('v2RecKeywords').value = (w.recommendedKeywords || []).join(', ');
    document.getElementById('v2RecAt').checked = w.recommendedAtMention !== false;
    document.getElementById('v2RecName').checked = w.recommendedNameMention !== false;
    document.getElementById('v2RecQuestion').checked = w.recommendedQuestion !== false;
    document.getElementById('v2RecPoke').checked = w.recommendedPoke !== false;
    document.getElementById('v2WakeHint').value = w.recommendedHint || '';
    document.getElementById('v2SleepMinMs').value = Math.round((w.sleepMinMs || 60000) / 1000);
    document.getElementById('v2SleepMaxMs').value = Math.round((w.sleepMaxMs || 0) / 1000);
    document.getElementById('v2MaxWakeMin').value = w.maxWakePerMinute ?? 1;
    document.getElementById('v2MaxWakeHour').value = w.maxWakePerHour ?? 12;
    document.getElementById('v2BatchWindowMs').value = w.batchWindowMs ?? 8000;
    document.getElementById('v2NoActionLimit').value = w.noActionLimit ?? 3;
    document.getElementById('v2MaxWakeConfigReminders').value = w.maxWakeConfigReminders ?? 2;
    document.getElementById('v2PreSleepWaitEnabled').checked = w.preSleepWaitEnabled !== false;
    document.getElementById('v2PreSleepWaitMin').value = Number.isFinite(Number(w.preSleepWaitMs)) ? Math.round(Number(w.preSleepWaitMs) / 60000) : 5;
    const s = c.send || {};
    document.getElementById('v2BurstEnabled').checked = s.burstEnabled !== false;
    document.getElementById('v2BurstMax').value = s.burstMaxMessages ?? 8;
    document.getElementById('v2BurstMin').value = s.burstIntervalMinMs ?? 1000;
    document.getElementById('v2BurstMaxMs').value = s.burstIntervalMaxMs ?? 3000;
    document.getElementById('v2LongGapProb').value = s.longGapProbability ?? 0.2;
    document.getElementById('v2LongGapMin').value = s.longGapMinMs ?? 5000;
    document.getElementById('v2LongGapMax').value = s.longGapMaxMs ?? 10000;
    document.getElementById('v2MaxSendMin').value = s.maxSendPerMinute ?? 8;
    document.getElementById('v2MaxSendHour').value = s.maxSendPerHour ?? 60;
    document.getElementById('v2MaxMsgChars').value = s.maxMessageChars ?? 500;
    document.getElementById('v2MaxGapMs').value = s.maxGapMs ?? 10000;
    document.getElementById('v2GapBaseMs').value = s.gapBaseMs ?? 800;
    document.getElementById('v2GapPerCharMs').value = s.gapPerCharMs ?? 20;
    document.getElementById('v2SendHint').value = s.recommendedHint || '';
    const wt = c.wait || {};
    document.getElementById('v2WaitDefaultMs').value = wt.defaultMs ?? 30000;
    document.getElementById('v2WaitMinMs').value = wt.minMs ?? 5000;
    document.getElementById('v2WaitMaxMs').value = wt.maxMs ?? 600000;
    document.getElementById('v2WaitDefaultQuietMs').value = wt.defaultQuietMs ?? 8000;
    document.getElementById('v2MinQuietAfterNewMs').value = wt.minQuietAfterNewMs ?? 10000;
    document.getElementById('v2AutoReplyCheckSec').value = Math.round((c.autoReplyCheckMs || 30000) / 1000);
    const pa = c.proactive || {};
    document.getElementById('v2ProactiveEnabled').checked = pa.enabled !== false;
    document.getElementById('v2ProactiveIntervalMin').value = Math.round((pa.checkIntervalMinMs || 1800000) / 60000);
    document.getElementById('v2ProactiveIntervalMax').value = Math.round((pa.checkIntervalMaxMs || 5400000) / 60000);
    document.getElementById('v2ProactiveIdleThreshold').value = Math.round((pa.idleThresholdMs || 900000) / 60000);
    document.getElementById('v2ProactiveProbability').value = pa.probability ?? 0.3;
    const stk = c.sticker || {};
    document.getElementById('v2StickerEnabled').checked = stk.enabled !== false;
    document.getElementById('v2StickerSyncTtlSec').value = Math.round((stk.syncTtlMs || 60000) / 1000);
    document.getElementById('v2StickerMaxList').value = stk.maxListCount ?? 100;
    document.getElementById('v2StickerPromptMax').value = stk.promptMaxStickers ?? 8;
    document.getElementById('v2StickerIncludePrompt').checked = stk.includeInPrompt !== false;
    const stkCollect = stk.collect || {};
    document.getElementById('v2StickerCollectEnabled').checked = stkCollect.enabled !== false;
    document.getElementById('v2StickerCollectPerMin').value = stkCollect.maxPerMinute ?? 2;
    document.getElementById('v2StickerCollectPerHour').value = stkCollect.maxPerHour ?? 10;
    document.getElementById('v2StickerCollectRemarkMax').value = stkCollect.maxRemarkChars ?? 20;
    const ctx = c.context || {};
    document.getElementById('v2ContextRecentLimit').value = ctx.recentLimit ?? 100;
    document.getElementById('v2ContextUnreadLimit').value = ctx.unreadLimit ?? 30;
    document.getElementById('v2ContextWindow').value = ctx.contextWindow ?? 20;
    const fb = c.feedback || {};
    document.getElementById('v2FeedbackMaxLength').value = fb.maxLength ?? 500;
    document.getElementById('v2FeedbackNotifyOwner').checked = fb.notifyOwnerOnError === true;
  } catch {}
}

async function saveV2Config() {
  const tools = {};
  document.querySelectorAll('[data-v2-tool]').forEach(el => { tools[el.dataset.v2Tool] = el.checked; });
  const body = {
    enabled: document.getElementById('v2Enabled').checked,
    agentPreset: document.getElementById('v2AgentPreset').value.trim(),
    provideRecommendations: document.getElementById('v2ProvideRecommendations').checked,
    autoReplyCheckMs: Math.round(Number(document.getElementById('v2AutoReplyCheckSec').value) || 30) * 1000,
    tools,
    wake: {
      defaultMode: document.getElementById('v2WakeDefaultMode').value,
      recommendedDefaultInfinite: document.getElementById('v2RecDefaultInfinite').checked,
      preSleepWaitEnabled: document.getElementById('v2PreSleepWaitEnabled').checked,
      preSleepWaitMs: (Number.isFinite(Number(document.getElementById('v2PreSleepWaitMin').value)) && Number(document.getElementById('v2PreSleepWaitMin').value) >= 0 ? Math.round(Number(document.getElementById('v2PreSleepWaitMin').value)) : 5) * 60000,
      recommendedSleepMinMs: (Math.round(Number(document.getElementById('v2RecSleepMin').value) || 5)) * 60000,
      recommendedSleepMaxMs: (Math.round(Number(document.getElementById('v2RecSleepMax').value) || 120)) * 60000,
      recommendedProbability: Number(document.getElementById('v2RecProb').value) || 0,
      recommendedKeywords: document.getElementById('v2RecKeywords').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      recommendedAtMention: document.getElementById('v2RecAt').checked,
      recommendedNameMention: document.getElementById('v2RecName').checked,
      recommendedQuestion: document.getElementById('v2RecQuestion').checked,
      recommendedPoke: document.getElementById('v2RecPoke').checked,
      recommendedHint: document.getElementById('v2WakeHint').value,
      sleepMinMs: (Math.round(Number(document.getElementById('v2SleepMinMs').value) || 0)) * 1000,
      sleepMaxMs: (Math.round(Number(document.getElementById('v2SleepMaxMs').value) || 0)) * 1000,
      maxWakePerMinute: Math.round(Number(document.getElementById('v2MaxWakeMin').value) || 0),
      maxWakePerHour: Math.round(Number(document.getElementById('v2MaxWakeHour').value) || 0),
      batchWindowMs: Math.round(Number(document.getElementById('v2BatchWindowMs').value) || 8000),
      noActionLimit: Math.round(Number(document.getElementById('v2NoActionLimit').value) || 3),
      maxWakeConfigReminders: Math.round(Number(document.getElementById('v2MaxWakeConfigReminders').value) || 2)
    },
    send: {
      burstEnabled: document.getElementById('v2BurstEnabled').checked,
      burstMaxMessages: Math.round(Number(document.getElementById('v2BurstMax').value) || 8),
      burstIntervalMinMs: Math.round(Number(document.getElementById('v2BurstMin').value) || 1000),
      burstIntervalMaxMs: Math.round(Number(document.getElementById('v2BurstMaxMs').value) || 3000),
      longGapProbability: Number(document.getElementById('v2LongGapProb').value) || 0,
      longGapMinMs: Math.round(Number(document.getElementById('v2LongGapMin').value) || 5000),
      longGapMaxMs: Math.round(Number(document.getElementById('v2LongGapMax').value) || 10000),
      maxSendPerMinute: Math.round(Number(document.getElementById('v2MaxSendMin').value) || 0),
      maxSendPerHour: Math.round(Number(document.getElementById('v2MaxSendHour').value) || 0),
      maxMessageChars: Math.round(Number(document.getElementById('v2MaxMsgChars').value) || 500),
      maxGapMs: Math.round(Number(document.getElementById('v2MaxGapMs').value) || 10000),
      gapBaseMs: Math.round(Number(document.getElementById('v2GapBaseMs').value) || 800),
      gapPerCharMs: Math.round(Number(document.getElementById('v2GapPerCharMs').value) || 20),
      recommendedHint: document.getElementById('v2SendHint').value
    },
    wait: {
      defaultMs: Math.round(Number(document.getElementById('v2WaitDefaultMs').value) || 5000),
      minMs: Math.round(Number(document.getElementById('v2WaitMinMs').value) || 1000),
      maxMs: Math.round(Number(document.getElementById('v2WaitMaxMs').value) || 10000),
      defaultQuietMs: Number.isFinite(Number(document.getElementById('v2WaitDefaultQuietMs').value)) ? Math.max(0, Math.round(Number(document.getElementById('v2WaitDefaultQuietMs').value))) : 8000,
      minQuietAfterNewMs: Number.isFinite(Number(document.getElementById('v2MinQuietAfterNewMs').value)) ? Math.max(0, Math.round(Number(document.getElementById('v2MinQuietAfterNewMs').value))) : 10000
    },
    proactive: {
      enabled: document.getElementById('v2ProactiveEnabled').checked,
      checkIntervalMinMs: Math.round(Number(document.getElementById('v2ProactiveIntervalMin').value) || 30) * 60000,
      checkIntervalMaxMs: Math.round(Number(document.getElementById('v2ProactiveIntervalMax').value) || 90) * 60000,
      idleThresholdMs: Math.round(Number(document.getElementById('v2ProactiveIdleThreshold').value) || 15) * 60000,
      probability: Number(document.getElementById('v2ProactiveProbability').value) || 0
    },
    sticker: {
      enabled: document.getElementById('v2StickerEnabled').checked,
      syncTtlMs: Math.max(1000, Math.round(Number(document.getElementById('v2StickerSyncTtlSec').value) || 60) * 1000),
      maxListCount: Math.min(500, Math.max(1, Math.round(Number(document.getElementById('v2StickerMaxList').value) || 100))),
      includeInPrompt: document.getElementById('v2StickerIncludePrompt').checked,
      promptMaxStickers: Math.min(30, Math.max(1, Math.round(Number(document.getElementById('v2StickerPromptMax').value) || 8))),
      collect: {
        enabled: document.getElementById('v2StickerCollectEnabled').checked,
        maxPerMinute: Math.max(0, Math.round(Number(document.getElementById('v2StickerCollectPerMin').value) || 0)),
        maxPerHour: Math.max(0, Math.round(Number(document.getElementById('v2StickerCollectPerHour').value) || 0)),
        maxRemarkChars: Math.min(50, Math.max(1, Math.round(Number(document.getElementById('v2StickerCollectRemarkMax').value) || 20)))
      }
    },
    context: {
      recentLimit: Math.round(Number(document.getElementById('v2ContextRecentLimit').value) || 100),
      unreadLimit: Math.round(Number(document.getElementById('v2ContextUnreadLimit').value) || 30),
      contextWindow: Math.round(Number(document.getElementById('v2ContextWindow').value) || 20)
    },
    feedback: {
      maxLength: Math.round(Number(document.getElementById('v2FeedbackMaxLength').value) || 500),
      notifyOwnerOnError: document.getElementById('v2FeedbackNotifyOwner').checked
    }
  };
  const r = await api('/api/socialV2/config', 'POST', body);
  const msg = document.getElementById('v2ConfigMsg');
  msg.textContent = r.ok ? '✅ 已保存' : ('❌ ' + (r.error || '失败'));
  msg.className = r.ok ? 'meta ok' : 'meta err';
  if (r.ok) loadV2Config();
}

async function viewV2State() {
  const key = document.getElementById('v2StateKey').value.trim();
  if (!key) { alert('请输入会话 key'); return; }
  const r = await api('/api/socialV2/state?key=' + encodeURIComponent(key));
  document.getElementById('v2StateOutput').textContent = JSON.stringify(r, null, 2);
}

function v2ToolLogStatus(entry) {
  if (entry.type === 'result') {
    const ok = entry.ok !== false;
    return `<span class="pill ${ok ? 'g' : 'r'}">${ok ? '成功' : '失败'}</span>`;
  }
  return '<span class="pill b">调用</span>';
}
function summarizeToolArgs(tool, args) {
  let obj = args;
  if (typeof args === 'string') {
    try { obj = JSON.parse(args); } catch { return args || ''; }
  }
  if (!obj || typeof obj !== 'object') return String(obj ?? '');
  const parts = [];
  const push = (k, v) => {
    if (v === undefined || v === null || v === '') return;
    parts.push(`${k}=${v}`);
  };
  const t = String(tool || '');
  if (t.includes('qq_set_wake_config')) {
    const cfg = (obj.config && typeof obj.config === 'object') ? obj.config : obj;
    push('mode', cfg.mode);
    push('infinite', cfg.infinite);
    const sleepUntil = cfg.sleepUntil || obj.sleepUntil;
    const sleepMs = cfg.sleepMs !== undefined ? cfg.sleepMs : obj.sleepMs;
    if (sleepUntil) push('sleepUntil', sleepUntil);
    else if (sleepMs !== undefined) push('sleepMs', sleepMs + 'ms');
    else push('sleep', '未设置时间');
    const tr = (cfg.triggers && typeof cfg.triggers === 'object') ? cfg.triggers : {};
    const trigs = [];
    if (tr.atMention) trigs.push('@');
    if (tr.nameMention) trigs.push('名字');
    if (tr.question) trigs.push('提问');
    if (tr.poke) trigs.push('拍一拍');
    if (Array.isArray(tr.keywords) && tr.keywords.length) trigs.push('关键词:' + tr.keywords.join(','));
    if (Array.isArray(tr.speakerIds) && tr.speakerIds.length) trigs.push('指定成员:' + tr.speakerIds.join(','));
    if (tr.anyMessage) trigs.push('anyMessage');
    if (Number(tr.probability) > 0) trigs.push('概率:' + tr.probability);
    if (trigs.length) push('triggers', trigs.join('|'));
  } else if (t.includes('qq_wait_for_messages')) {
    push('timeoutMs', obj.timeoutMs != null ? obj.timeoutMs : '默认30000');
    push('minNewMessages', obj.minNewMessages != null ? obj.minNewMessages : 1);
    push('quietMs', obj.quietMs != null ? obj.quietMs : '默认8000');
  } else if (t.includes('qq_send_message')) {
    const msgs = Array.isArray(obj.messages) ? obj.messages : (obj.messages != null ? [obj.messages] : []);
    push('条数', msgs.length);
    if (msgs.length) push('首条', String(msgs[0]).slice(0, 30));
    push('gapMode', obj.gapMode || 'auto');
    if (obj.gapMs != null) push('gapMs', obj.gapMs);
    if (Array.isArray(obj.gaps) && obj.gaps.length) push('gaps', obj.gaps.join(','));
    if (obj.replyToMessageId != null && obj.replyToMessageId !== '') push('引用id', obj.replyToMessageId);
  } else if (t.includes('qq_send_burst')) {
    const msgs = Array.isArray(obj.messages) ? obj.messages : [];
    push('条数', msgs.length);
    if (msgs.length) push('首条', String(msgs[0]).slice(0, 30));
  } else if (t.includes('qq_send_poke')) {
    push('key', obj.key);
    if (obj.targetUserId != null && obj.targetUserId !== '') push('target', obj.targetUserId);
  } else if (t.includes('qq_get_forward_msg')) {
    push('key', obj.key);
    if (obj.id != null && obj.id !== '') push('id', String(obj.id).slice(0, 40));
  } else if (t.includes('qq_mark_read')) {
    push('key', obj.key);
  } else if (t.includes('qq_get_prompt') || t.includes('qq_get_unread_messages') || t.includes('qq_get_recent_messages') || t.includes('qq_social_state') || t.includes('qq_get_my_recent_messages') || t.includes('qq_get_message_detail') || t.includes('qq_get_active_members')) {
    push('key', obj.key);
    if (obj.messageId != null) push('messageId', obj.messageId);
    if (obj.limit != null) push('limit', obj.limit);
  } else {
    push('key', obj.key);
  }
  return parts.join(' | ') || JSON.stringify(obj);
}
function v2ToolLogCell(value, tool) {
  const text = value == null ? '' : String(value);
  if (!text) return '<span class="meta">-</span>';
  const summary = tool ? summarizeToolArgs(tool, text) : text;
  const short = summary.length > 100 ? summary.slice(0, 100) + '…' : summary;
  return `<span class="tool-log-cell" data-full="${esc(text)}" data-short="${esc(short)}" title="点击查看完整 JSON">${esc(short)}</span>`;
}
function renderV2ToolLog(entries) {
  const box = document.getElementById('v2ToolLogOutput');
  const list = entries || [];
  if (!list.length) { box.innerHTML = '<span class="meta">（空）</span>'; return; }
  let html = '<table><tr><th>时间</th><th>会话 key</th><th>工具名</th><th>状态</th><th>参数</th><th>错误信息</th></tr>';
  for (const e of list) {
    const time = e.time ? new Date(e.time).toLocaleString() : '-';
    const key = esc(e.key || '');
    const tool = esc(e.tool || '-');
    const status = v2ToolLogStatus(e);
    const params = e.type === 'call' ? v2ToolLogCell(e.args, e.tool) : '<span class="meta">-</span>';
    const error = e.type === 'result' ? v2ToolLogCell(e.error) : '<span class="meta">-</span>';
    html += `<tr><td>${esc(time)}</td><td>${key}</td><td>${tool}</td><td>${status}</td><td>${params}</td><td>${error}</td></tr>`;
  }
  html += '</table>';
  box.innerHTML = html;
}
function loadV2ToolLog() {
  return api('/api/socialV2/tool-log?limit=200')
    .then(r => { renderV2ToolLog(r.entries || []); })
    .catch(() => { renderV2ToolLog([]); });
}

function renderV2Memory(data) {
  const box = document.getElementById('v2MemoryOutput');
  if (!data || !data.ok) {
    box.innerHTML = '<span class="meta">加载失败</span>';
    return;
  }
  const raw = data.raw || {};
  const topics = Array.isArray(raw.activeTopics) ? raw.activeTopics : [];
  const thoughts = Array.isArray(raw.pendingThoughts) ? raw.pendingThoughts : [];
  const impressions = raw.memberImpressions && typeof raw.memberImpressions === 'object' ? raw.memberImpressions : {};
  let html = '<div class="u-p-8">';
  html += '<div class="memory-section"><b>进行中的话题</b> <button class="small" data-action="clear" data-cat="activeTopic">清空</button>';
  if (!topics.length) html += '<div class="meta">（空）</div>';
  for (const t of topics) {
    const text = esc(String(t?.text || ''));
    const extra = t?.pendingQuestion ? `；待追问：${esc(String(t.pendingQuestion))}` : '';
    html += `<div class="u-my-4">📌 ${text}${extra} <button class="small" data-action="edit" data-cat="activeTopic" data-content="${esc(String(t?.text || ''))}">编辑</button> <button class="small" data-action="remove" data-cat="activeTopic" data-content="${esc(String(t?.text || ''))}">删除</button></div>`;
  }
  html += '</div>';
  html += '<div class="memory-section"><b>你想说但还没说的</b> <button class="small" data-action="clear" data-cat="pendingThought">清空</button>';
  if (!thoughts.length) html += '<div class="meta">（空）</div>';
  for (const t of thoughts) {
    html += `<div class="u-my-4">💭 ${esc(String(t?.text || ''))}${t?.motivation ? `（${esc(String(t.motivation))}）` : ''} <button class="small" data-action="edit" data-cat="pendingThought" data-content="${esc(String(t?.text || ''))}">编辑</button> <button class="small" data-action="remove" data-cat="pendingThought" data-content="${esc(String(t?.text || ''))}">删除</button></div>`;
  }
  html += '</div>';
  html += '<div class="memory-section"><b>对群友的印象</b> <button class="small" data-action="clear" data-cat="memberImpression">清空</button>';
  const names = Object.keys(impressions);
  if (!names.length) html += '<div class="meta">（空）</div>';
  for (const name of names) {
    const im = impressions[name] || {};
    const traits = Array.isArray(im.traits) ? im.traits : [];
    html += `<div class="u-my-4">👤 ${esc(name)}：${traits.length ? esc(traits.join('、')) : '暂无记录'}（互动 ${Number(im.interactionCount) || 0} 次） <button class="small" data-action="edit" data-cat="memberImpression" data-target="${esc(name)}" data-traits="${esc(traits.join(', '))}">编辑</button> <button class="small" data-action="remove" data-cat="memberImpression" data-target="${esc(name)}">删除</button></div>`;
  }
  html += '</div></div>';
  box.innerHTML = html;
}
function loadV2Memory() {
  const key = document.getElementById('v2MemoryKey').value.trim();
  const msg = document.getElementById('v2MemoryMsg');
  if (!key) { msg.textContent = '请输入会话 key'; msg.className = 'meta err'; return; }
  msg.textContent = '加载中…';
  msg.className = 'meta';
  return api('/api/socialV2/memory?key=' + encodeURIComponent(key))
    .then(r => {
      renderV2Memory(r);
      msg.textContent = r.ok ? '✅ 已加载' : ('❌ ' + (r.error || '失败'));
      msg.className = r.ok ? 'meta ok' : 'meta err';
    })
    .catch(e => {
      msg.textContent = '❌ ' + (e.message || e);
      msg.className = 'meta err';
    });
}

function formatWakeStatus(r) {
  if (!r || !r.ok) return '<span class="meta">加载失败</span>';
  const wc = r.wakeConfig || {};
  const lines = [];
  const mode = wc.mode === 'active' ? '活跃（任何消息都会唤醒）' : (wc.mode === 'diving' ? '潜水' : (wc.mode || '未知'));
  lines.push(`<div><b>模式：</b>${esc(mode)}</div>`);
  lines.push(`<div><b>无限期：</b>${wc.infinite ? '是' : '否'}</div>`);
  const safety = r.wakeSafety || {};
  const badge = safety.guaranteed ? '🟢 已保证' : '🔴 无保证';
  lines.push(`<div><b>唤醒保证：</b>${badge}${safety.stale ? '（配置较旧，未确认）' : ''}</div>`);
  let next = '';
  if (wc.mode === 'active' || wc.triggers?.anyMessage) {
    next = '任何新消息都会唤醒';
  } else if (wc.sleepUntil) {
    const until = new Date(wc.sleepUntil).getTime();
    const remain = until - Date.now();
    if (!Number.isFinite(remain)) next = '时间格式无效';
    else if (remain > 0) next = `约 ${Math.max(1, Math.round(remain / 1000))} 秒后（${new Date(wc.sleepUntil).toLocaleString()}）`;
    else next = '已到期，等待下一次唤醒';
  } else if (wc.infinite) {
    next = '无限期潜水，等待指定条件';
  } else {
    next = '未设置时间';
  }
  lines.push(`<div><b>下次唤醒：</b>${esc(next)}</div>`);
  const tr = wc.triggers || {};
  const conds = [];
  if (tr.atMention) conds.push('@');
  if (tr.nameMention) conds.push('名字');
  if (Array.isArray(tr.keywords) && tr.keywords.length) conds.push('关键词：' + tr.keywords.join('、'));
  if (Array.isArray(tr.speakerIds) && tr.speakerIds.length) conds.push('指定成员：' + tr.speakerIds.join('、'));
  if (tr.question) conds.push('提问');
  if (tr.poke) conds.push('拍一拍');
  if (tr.anyMessage) conds.push('任何消息');
  if (Number(tr.probability) > 0) conds.push('普通消息概率 ' + Number(tr.probability));
  lines.push(`<div><b>提前唤醒条件：</b>${conds.length ? esc(conds.join('；')) : '（无）'}</div>`);
  lines.push(`<div><b>最近唤醒原因：</b>${esc(r.lastWakeReason || '-')}</div>`);
  lines.push(`<div><b>唤醒次数：</b>${Number(wc.wakeCount) || 0}</div>`);
  if (wc.confirmedAt) {
    const ago = Math.max(0, Math.round((Date.now() - wc.confirmedAt) / 60000));
    lines.push(`<div><b>配置确认：</b>${ago} 分钟前（${esc(wc.confirmedBy || 'unknown')}）</div>`);
  }
  if (r.lastAiReplyAt) {
    const ago = Math.max(0, Math.round((Date.now() - r.lastAiReplyAt) / 60000));
    lines.push(`<div><b>上次发言：</b>${ago} 分钟前</div>`);
  }
  lines.push(`<div><b>未读：</b>${Number(r.unreadCount) || 0} 条</div>`);
  return '<div class="u-p-8">' + lines.join('') + '</div>';
}
function loadV2WakeStatus() {
  const key = document.getElementById('v2WakeKey').value.trim();
  const msg = document.getElementById('v2WakeStatusMsg');
  if (!key) { msg.textContent = '请输入会话 key'; msg.className = 'meta err'; return; }
  msg.textContent = '加载中…';
  msg.className = 'meta';
  return api('/api/socialV2/state?key=' + encodeURIComponent(key))
    .then(r => {
      document.getElementById('v2WakeStatusOutput').innerHTML = formatWakeStatus(r);
      msg.textContent = r.ok ? '✅ 已加载' : ('❌ ' + (r.error || '失败'));
      msg.className = r.ok ? 'meta ok' : 'meta err';
    })
    .catch(e => {
      msg.textContent = '❌ ' + (e.message || e);
      msg.className = 'meta err';
    });
}

// ── 初始提示词（每个会话一份，只在 AI 首次唤醒时注入一次） ────────────────────
let v2InitPromptTextEl = null;
function v2InitPromptKeyValue() { return document.getElementById('v2InitPromptKey').value.trim(); }
function setV2InitPromptMsg(text, kind) {
  const msg = document.getElementById('v2InitPromptMsg');
  msg.textContent = text;
  msg.className = 'meta' + (kind ? ' ' + kind : '');
}
function updateV2InitPromptCount() {
  document.getElementById('v2InitPromptCount').textContent = String(v2InitPromptTextEl.value.length);
}
function applyV2InitPromptMax(maxChars) {
  const max = Math.round(Number(maxChars));
  if (!Number.isFinite(max) || max <= 0) return;
  document.getElementById('v2InitPromptMax').textContent = String(max);
  v2InitPromptTextEl.maxLength = max;
}
function renderV2InitPromptEntries(entries) {
  const box = document.getElementById('v2InitPromptList');
  if (!Array.isArray(entries) || !entries.length) { box.textContent = '（还没有任何会话设置初始提示词）'; return; }
  box.innerHTML = entries.map((e) => {
    const when = Number(e.updatedAt) > 0 ? new Date(Number(e.updatedAt)).toLocaleString() : '未知时间';
    return `<div class="u-my-3"><code>${esc(e.key)}</code> · ${Number(e.chars) || 0} 字符 · ${esc(when)} <button class="small" data-init-prompt-key="${esc(e.key)}">编辑</button></div>`;
  }).join('');
}
async function loadV2InitialPrompt() {
  const key = v2InitPromptKeyValue();
  setV2InitPromptMsg('加载中…');
  try {
    const r = await api('/api/socialV2/initial-prompt' + (key ? '?key=' + encodeURIComponent(key) : ''));
    if (!r.ok) { setV2InitPromptMsg('❌ ' + (r.error || '失败'), 'err'); return; }
    applyV2InitPromptMax(r.maxChars);
    const readOnly = r.writable === false;
    if (!key) {
      renderV2InitPromptEntries(r.entries);
      setV2InitPromptMsg(readOnly ? '⚠️ 文件不可写（只读降级），只显示已有内容' : `✅ 共 ${(r.entries || []).length} 条`, readOnly ? 'err' : 'ok');
      return;
    }
    v2InitPromptTextEl.value = r.text || '';
    updateV2InitPromptCount();
    document.getElementById('v2InitPromptList').textContent = r.exists
      ? '该会话已设置初始提示词；再点「保存」会覆盖。'
      : '该会话还没有设置初始提示词；填写后点「保存」新建。';
    if (readOnly) setV2InitPromptMsg('⚠️ 文件不可写（只读降级）：能看不能存', 'err');
    else setV2InitPromptMsg(r.exists ? '✅ 已加载' : '（空）', r.exists ? 'ok' : '');
  } catch (e) {
    setV2InitPromptMsg('❌ ' + (e.message || e), 'err');
  }
}
async function saveV2InitialPrompt() {
  const key = v2InitPromptKeyValue();
  if (!key) { setV2InitPromptMsg('请输入会话 key（group:群号 或 private:QQ号）', 'err'); return; }
  setV2InitPromptMsg('保存中…');
  try {
    const r = await api('/api/socialV2/initial-prompt', 'POST', { key, text: v2InitPromptTextEl.value });
    if (!r.ok) { setV2InitPromptMsg('❌ ' + (r.error || '失败'), 'err'); return; }
    applyV2InitPromptMax(r.maxChars);
    if (r.deleted) {
      v2InitPromptTextEl.value = '';
      updateV2InitPromptCount();
      setV2InitPromptMsg('✅ 内容为空，已删除该会话的初始提示词', 'ok');
    } else {
      setV2InitPromptMsg(`✅ 已保存（${r.chars} 字符），该会话下一次首次唤醒时注入`, 'ok');
    }
  } catch (e) {
    setV2InitPromptMsg('❌ ' + (e.message || e), 'err');
  }
}

async function loadV2SessionOptions() {
  const sel = document.getElementById('v2SessionSelect');
  const prev = sel.value;
  try {
    const r = await api('/api/status');
    const groups = Array.isArray(r.allowGroups) ? r.allowGroups : [];
    const privates = Array.isArray(r.allowPrivate) ? r.allowPrivate : [];
    const options = [{ value: '', label: '选择白名单群/私聊…' }];
    for (const g of groups) options.push({ value: 'group:' + g, label: '群 ' + g });
    for (const p of privates) options.push({ value: 'private:' + p, label: '私聊 ' + p });
    sel.innerHTML = options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
    if (prev && options.some((o) => o.value === prev)) sel.value = prev;
  } catch (e) {
    sel.innerHTML = '<option value="">无法加载白名单</option>';
  }
}

async function refreshV2Activity() {
  try {
    const r = await api('/api/socialV2/activity');
    const el = document.getElementById('v2ActivityStatus');
    el.textContent = r.paused ? '已暂停' : '运行中';
    el.className = r.paused ? 'meta err' : 'meta ok';
  } catch {}
}

// 片段页在 app.js 启动之后才注入，启动时统一做的无障碍/主按钮增强不会命中这里。
// 按 app.js 的同一套规则补一遍，避免迁移后保存按钮配色和 live region 丢失。


function bindEvents() {
  document.getElementById('v2ToolLogOutput').addEventListener('click', (ev) => {
    const cell = ev.target.closest('.tool-log-cell');
    if (!cell) return;
    const full = cell.dataset.full;
    const short = cell.dataset.short;
    if (cell.classList.contains('expanded')) {
      cell.classList.remove('expanded');
      cell.textContent = short;
    } else {
      cell.classList.add('expanded');
      cell.textContent = full;
    }
  });
  document.getElementById('v2MemoryLoad').addEventListener('click', loadV2Memory);
  document.getElementById('v2MemoryClearAll').addEventListener('click', async () => {
    const key = document.getElementById('v2MemoryKey').value.trim();
    const msg = document.getElementById('v2MemoryMsg');
    if (!key) { msg.textContent = '请输入会话 key'; msg.className = 'meta err'; return; }
    if (!confirm('确定清空该会话全部轻量记忆？')) return;
    const r = await api('/api/socialV2/memory-clear', 'POST', { key, category: '' });
    msg.textContent = r.ok ? '✅ 已清空全部记忆' : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'meta ok' : 'meta err';
    if (r.ok) loadV2Memory();
  });
  document.getElementById('v2MemoryOutput').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const key = document.getElementById('v2MemoryKey').value.trim();
    const msg = document.getElementById('v2MemoryMsg');
    if (!key) { msg.textContent = '请输入会话 key'; msg.className = 'meta err'; return; }
    const cat = btn.dataset.cat;
    const action = btn.dataset.action;
    let r;
    if (action === 'clear') {
      r = await api('/api/socialV2/memory-clear', 'POST', { key, category: cat });
    } else if (action === 'edit') {
      let newContent;
      let newExtra = {};
      if (cat === 'memberImpression') {
        const input = prompt(`编辑对 ${btn.dataset.target} 的印象特质（逗号分隔）：`, btn.dataset.traits || '');
        if (input === null) return;
        newContent = input;
      } else {
        const input = prompt(`编辑${cat === 'activeTopic' ? '话题' : '想法'}内容：`, btn.dataset.content || '');
        if (input === null) return;
        newContent = input;
      }
      r = await api('/api/socialV2/memory-update', 'POST', { key, category: cat, oldContent: btn.dataset.content || '', target: btn.dataset.target || '', newContent, newExtra });
    } else {
      r = await api('/api/socialV2/memory-remove', 'POST', { key, category: cat, content: btn.dataset.content || '', target: btn.dataset.target || '' });
    }
    msg.textContent = r.ok ? '✅ 已更新' : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'meta ok' : 'meta err';
    if (r.ok) loadV2Memory();
  });
  document.getElementById('v2WakeStatusLoad').addEventListener('click', loadV2WakeStatus);
  document.getElementById('v2InitPromptLoad').addEventListener('click', loadV2InitialPrompt);
  document.getElementById('v2InitPromptSave').addEventListener('click', saveV2InitialPrompt);
  document.getElementById('v2InitPromptClear').addEventListener('click', async () => {
    const key = v2InitPromptKeyValue();
    if (!key) { setV2InitPromptMsg('请输入会话 key', 'err'); return; }
    if (!confirm(`确定删除 ${key} 的初始提示词？`)) return;
    try {
      const r = await api('/api/socialV2/initial-prompt', 'POST', { key, delete: true });
      if (!r.ok) { setV2InitPromptMsg('❌ ' + (r.error || '失败'), 'err'); return; }
      v2InitPromptTextEl.value = '';
      updateV2InitPromptCount();
      setV2InitPromptMsg('✅ 已删除', 'ok');
    } catch (e) {
      setV2InitPromptMsg('❌ ' + (e.message || e), 'err');
    }
  });
  v2InitPromptTextEl.addEventListener('input', updateV2InitPromptCount);
  document.getElementById('v2InitPromptList').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-init-prompt-key]');
    if (!btn) return;
    document.getElementById('v2InitPromptKey').value = btn.dataset.initPromptKey || '';
    loadV2InitialPrompt();
  });
  document.getElementById('v2SessionRefresh').addEventListener('click', loadV2SessionOptions);
  document.getElementById('v2SessionSelect').addEventListener('change', (ev) => {
    const key = ev.target.value;
    if (!key) return;
    document.getElementById('v2StateKey').value = key;
    document.getElementById('v2MemoryKey').value = key;
    document.getElementById('v2WakeKey').value = key;
    document.getElementById('v2InitPromptKey').value = key;
  });
  document.getElementById('v2ConfigSave').addEventListener('click', saveV2Config);
  document.getElementById('v2ConfigSaveTop').addEventListener('click', saveV2Config);
  document.getElementById('voiceRefreshBtn').addEventListener('click', () => loadVoiceLibrary(true));
  document.getElementById('voiceSendBtn').addEventListener('click', sendVoiceFromConsole);
  document.getElementById('v2PauseBtn').addEventListener('click', async () => {
    await api('/api/socialV2/activity', 'POST', { paused: true });
    refreshV2Activity();
  });
  document.getElementById('v2ResumeBtn').addEventListener('click', async () => {
    await api('/api/socialV2/activity', 'POST', { paused: false });
    refreshV2Activity();
  });
  document.getElementById('v2ResetBtn').addEventListener('click', async () => {
    if (!confirm('确定重置二代 AI 状态？\n将清空所有二代会话、唤醒配置、未读消息和定时器；工具调用日志会保留。')) return;
    const r = await api('/api/socialV2/reset', 'POST', {});
    const msg = document.getElementById('v2ConfigMsg');
    msg.textContent = r.ok ? '✅ 已重置二代状态' : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'meta ok' : 'meta err';
    refreshV2Activity();
    document.getElementById('v2AllStatesOutput').textContent = '（全部会话状态：空）';
    document.getElementById('v2StateOutput').textContent = '（空）';
  });
  document.getElementById('v2StateView').addEventListener('click', viewV2State);
  document.getElementById('v2ForceWake').addEventListener('click', async () => {
    const key = document.getElementById('v2StateKey').value.trim();
    if (!key) { alert('请输入会话 key'); return; }
    const r = await api('/api/socialV2/wake', 'POST', { key, reason: 'admin' });
    const msg = document.getElementById('v2ConfigMsg');
    msg.textContent = r.ok ? '✅ 已发送唤醒' : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'meta ok' : 'meta err';
  });
  document.getElementById('v2StatesList').addEventListener('click', async () => {
    const r = await api('/api/socialV2/states');
    document.getElementById('v2AllStatesOutput').textContent = JSON.stringify(r.conversations || [], null, 2);
  });
  document.getElementById('v2FeedbackLoad').addEventListener('click', async () => {
    const r = await api('/api/socialV2/feedback');
    document.getElementById('v2FeedbackOutput').textContent = JSON.stringify(r.entries || [], null, 2);
  });
  document.getElementById('v2FeedbackClear').addEventListener('click', async () => {
    if (!confirm('确定清空全部 AI 反馈？')) return;
    const r = await api('/api/socialV2/feedback-clear', 'POST', {});
    const msg = document.getElementById('v2FeedbackMsg');
    msg.textContent = r.ok ? '✅ 已清空' : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'meta ok' : 'meta err';
    if (r.ok) document.getElementById('v2FeedbackOutput').textContent = '（空）';
  });
  document.getElementById('v2ToolLogLoad').addEventListener('click', async () => {
    const msg = document.getElementById('v2ToolLogMsg');
    msg.textContent = '';
    await loadV2ToolLog();
  });
  document.getElementById('v2ToolLogClear').addEventListener('click', async () => {
    if (!confirm('确定清空全部工具调用日志？')) return;
    const r = await api('/api/socialV2/tool-log/clear', 'POST', {});
    const msg = document.getElementById('v2ToolLogMsg');
    msg.textContent = r.ok ? '✅ 已清空' : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'meta ok' : 'meta err';
    renderV2ToolLog([]);
  });
  const stickerDescribeBtn = document.getElementById('stickerDescribeBtn');
  if (stickerDescribeBtn) stickerDescribeBtn.addEventListener('click', async () => {
    const r = await api('/api/stickers/describe', 'POST', {});
    if (!r.ok) { alert(r.error || '启动失败'); refreshStickerDescribe(); return; }
    renderStickerDescribe(r);
  });
}

let pageInitialized = false;
export function init() {
  if (pageInitialized) return;
  pageInitialized = true;
  v2InitPromptTextEl = document.getElementById('v2InitPromptText');
  bindEvents();
  // 原 app.js 启动批次里的页面加载顺序：配置 → 活动状态 → 工具日志 → 会话选项。
  void loadV2Config();
  void refreshV2Activity();
  void loadV2ToolLog();
  void loadV2SessionOptions();
  // 语音库首次进入按需拉取（会逐个 ffprobe，不能放进轮询）。
  void loadVoiceLibrary(false);
  void refreshStickerDescribe();
  onPageRefresh('social-v2', () => {
    void loadVoiceLibrary();
    void loadV2Config();
    void refreshV2Activity();
    if (document.getElementById('v2WakeKey')?.value.trim()) void loadV2WakeStatus();
  });
}
