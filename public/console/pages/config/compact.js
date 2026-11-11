// 上下文压缩（socialV2.compact）：原挂在运行总览，现归入「全局配置 → 行为与模型」。
// 数据仍在桥接的 socialV2.compact；这里只做表单与读写，不碰运行总览。
// 本卡不设自己的保存按钮：和同页其他表单一起走页面底部保存栏（compactSection）。
import { api } from '../../js/api.js';
import { renderFields } from '../../components/form/form.js';

const FIELDS = [
  {
    name: 'compactMode', type: 'radio', label: '压缩方式',
    options: [
      { value: 'early', label: '提前压缩（桥接自己压，最省）' },
      { value: 'dsh', label: '交给 DSH 自己压缩' },
    ],
  },
  {
    name: 'compactWan', type: 'number', label: '提前压缩阈值', unit: '万 token',
    min: 5, max: 80, step: 1,
    hint: '默认 30；数字越小越省钱，很早的聊天细节也越早变成摘要（可填 5～80）。',
  },
];

const HTML = `<div class="form-stack" id="compactForm"></div>
<p class="meta usage-compact-note">提前压缩：桥接把较早的历史换成一段摘要，最近约 15 万 token 原样保留；每个会话两次自动压缩至少隔 2 小时，会话正忙时不压，等它空下来。交给 DSH：deepseek-flash 的窗口是 100 万，DSH 在窗口的 80% 左右自己压缩，保留细节最多，但每一步读得最多、最贵。</p>
<p class="meta" id="compactSessions">—</p>`;

let refreshCompactSessions = null;

export const compactSection = {
  id: 'compact',
  label: '上下文压缩',
  read: () => ({
    mode: document.querySelector('input[name="compactMode"]:checked')?.value || '',
    thresholdWan: Number(document.getElementById('compactWan')?.value) || 30,
  }),
  save: async (value) => {
    if (!value?.mode) return { ok: false, message: '请先选一种压缩方式' };
    const r = await api('/api/compact/config', 'POST', value);
    if (!r?.ok) return { ok: false, message: r?.error || '保存失败' };
    await refreshCompactSessions?.();
    return { ok: true, message: '已保存，下一轮结束时生效' };
  },
};

export function mountCompact(host) {
  if (!host) return null;
  host.innerHTML = HTML;
  renderFields(document.getElementById('compactForm'), FIELDS, { columns: 1 });

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

  // 选「提前压缩」时把阈值顺手勾上；这里只做交互便利，不改数据。
  document.getElementById('compactWan')?.addEventListener('focus', () => {
    const early = document.querySelector('input[name="compactMode"][value="early"]');
    if (early) early.checked = true;
  });

  refreshCompactSessions = load;
  load();
  return { load };
}
