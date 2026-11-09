// 上下文压缩（socialV2.compact）：原先挂在运行总览，现归入「全局配置 → 运行与模型」。
// 数据仍在桥接的 socialV2.compact；这里只做表单与读写，不碰运行总览。
import { api } from '../../js/api.js';
import { setMsg } from '../../components/message/message.js';

const HTML = `<div class="usage-compact">
  <div class="field-block">
    <div class="field-row">
      <span class="field-label">压缩方式</span>
      <div class="field-control">
        <div class="field-inline">
          <label><input type="radio" name="compactMode" value="early"> 提前压缩（桥接自己压，最省）</label>
          <label><input type="radio" name="compactMode" value="dsh"> 交给 DSH 自己压缩</label>
        </div>
      </div>
    </div>
  </div>
  <div class="field-block">
    <div class="field-row">
      <span class="field-label">提前压缩阈值</span>
      <div class="field-control">
        <span class="field-inline">
          <input id="compactWan" type="number" min="5" max="80" step="1" aria-label="提前压缩阈值（万 token）">
          <span class="field-unit">万 token</span>
        </span>
      </div>
    </div>
    <div class="field-notes"><p class="field-hint">默认 30；数字越小越省钱，很早的聊天细节也越早变成摘要（可填 5～80）。</p></div>
  </div>
  <p class="meta usage-compact-note">提前压缩：桥接把较早的历史换成一段摘要，最近约 15 万 token 原样保留；每个会话两次自动压缩至少隔 2 小时，会话正忙时不压，等它空下来。交给 DSH：deepseek-flash 的窗口是 100 万，DSH 在窗口的 80% 左右自己压缩，保留细节最多，但每一步读得最多、最贵。</p>
  <div class="row u-mt-10-between">
    <span class="meta u-m-0" id="compactSessions">—</span>
    <div class="form-actions">
      <button class="btn primary" type="button" id="compactSave">保存压缩设置</button>
      <span class="form-actions-status" id="compactMsg" role="status"></span>
    </div>
  </div>
</div>`;

export function mountCompact(host) {
  if (!host) return null;
  host.innerHTML = HTML;

  async function load() {
    const r = await api('/api/compact/config');
    if (!r?.ok) return;
    document.querySelectorAll('input[name="compactMode"]').forEach((c) => { c.checked = c.value === r.mode; });
    const wan = document.getElementById('compactWan');
    if (wan && document.activeElement !== wan) wan.value = Math.round(r.thresholdTokens / 10_000);
    const list = (r.sessions || []).sort((a, b) => b.inputTokens - a.inputTokens).slice(0, 6);
    const sessions = document.getElementById('compactSessions');
    if (sessions) {
      sessions.textContent = list.length
        ? '上一步读了多少：' + list.map((x) => `${x.key} ${Math.round(x.inputTokens / 10_000)} 万`).join('，')
        : '桥接这次启动后还没有会话跑过，暂时看不到每个会话读了多少';
    }
  }

  document.getElementById('compactSave')?.addEventListener('click', async () => {
    const mode = (document.querySelector('input[name="compactMode"]:checked') || {}).value;
    const msg = document.getElementById('compactMsg');
    if (!mode) { setMsg(msg, '请先选一种压缩方式', 'err'); return; }
    const r = await api('/api/compact/config', 'POST', {
      mode,
      thresholdWan: Number(document.getElementById('compactWan').value),
    });
    if (r?.ok) {
      setMsg(msg, '✅ 已保存，下一轮结束时生效', 'ok');
      load();
    } else {
      setMsg(msg, '❌ ' + (r?.error || '保存失败'), 'err');
    }
  });
  document.getElementById('compactWan')?.addEventListener('focus', () => {
    const early = document.querySelector('input[name="compactMode"][value="early"]');
    if (early) early.checked = true;
  });

  load();
  return { load };
}
