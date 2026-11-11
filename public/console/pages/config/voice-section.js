// 全局配置 → 拓展功能：语音库调试（/api/voice/*）。
// 平台工具的注册开关已并入能力预设的「平台工具」表，这里不再有全局 QQ 工具开关。
import { api } from '../../js/api.js';
import { esc } from '../../js/ui.js';

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

export function initVoiceSection() {
  const host = document.getElementById('voicePanel');
  if (!host) return;
  host.innerHTML = `<section class="card span-all">
    <h2>语音库与语音发送</h2>
    <p class="meta">语音库目录由 <code>config.voice.dir</code> 决定；试发走与 AI 通道相同的解析/校验/限流路径。AI 能否拿到发语音工具，由能力预设的「平台工具」表决定。</p>
    ${VOICE_HTML}
  </section>`;
  document.getElementById('voiceRefreshBtn').addEventListener('click', () => loadVoice(true));
  document.getElementById('voiceSendBtn').addEventListener('click', sendVoice);
  document.getElementById('voiceSendDryRun').addEventListener('click', (event) => {
    const button = event.currentTarget;
    const next = button.getAttribute('aria-checked') !== 'true';
    button.setAttribute('aria-checked', String(next));
    button.querySelector('span:last-child').textContent = next ? '开' : '关';
  });
  loadVoice(false);
}
