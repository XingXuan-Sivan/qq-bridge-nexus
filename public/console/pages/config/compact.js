// 上下文压缩（config.compact）：原挂在运行总览，现归入「全局配置 → 行为与模型」。
// 「平台自己什么时候压」由 Agent 平台在 agent-platform.yml 的 modelCatalog.compact 申报，
// 这里只按申报值渲染阈值的上下界与说明，桥接不内置任何平台的数字。
// 本卡不设自己的保存按钮：和同页其他表单一起走页面底部保存栏（compactSection）。
import { api } from '../../js/api.js';
import { renderFields } from '../../components/form/form.js';

const MODE_OPTIONS = [
  { value: 'early', label: '提前压缩（桥接自己压，最省）' },
  { value: 'agent', label: '交给 Agent 平台自己压缩' },
];

/** 字段规格：阈值留空 = 跟随平台申报点，所以值可能为空串。 */
function fieldsOf({ mode, thresholdTokens, approxTokens }) {
  const pointWan = approxTokens ? Math.round(approxTokens / 10_000) : null;
  return [
    { name: 'compactMode', type: 'radio', label: '压缩方式', options: MODE_OPTIONS, value: mode },
    {
      name: 'compactWan', type: 'number', label: '提前压缩阈值', unit: '万 token',
      value: thresholdTokens ? Math.round(thresholdTokens / 10_000) : '',
      placeholder: pointWan ? String(pointWan) : '',
      min: 5, max: pointWan ?? undefined, step: 1,
      hint: pointWan
        ? `这个平台自己在 ${pointWan} 万 token 左右压；填得比它早才省钱。留空 = 用它的 ${pointWan} 万。`
        : '这个平台没申报自动压缩点：填 5 万起；留空则不做提前压缩。',
    },
  ];
}

const HTML = `<div class="form-stack" id="compactForm"></div>
<p class="meta usage-compact-note">提前压缩：桥接把较早的历史换成一段摘要，近期对话原样保留；每个会话两次自动压缩至少隔 2 小时，会话正忙时不压，等它空下来。交给平台：由 Agent 平台按自己的策略压缩，保留细节最多，但每一步读得最多、也最贵。</p>
<p class="meta" id="compactSessions">—</p>`;

let refreshCompactSessions = null;

export const compactSection = {
  id: 'compact',
  label: '上下文压缩',
  read: () => ({
    mode: document.querySelector('input[name="compactMode"]:checked')?.value || '',
    // 空串照原样交给服务端：它表示「跟随平台申报点」。
    thresholdWan: document.getElementById('compactWan')?.value ?? '',
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
  const form = document.getElementById('compactForm');
  let rendered = ''; // 上次渲染依据（模式 / 阈值 / 平台申报点）：这三点没变就不重渲染，免得覆盖正在填的数
  const render = (data) => {
    renderFields(form, fieldsOf(data), { columns: 1 });
    rendered = `${data.mode}|${data.thresholdTokens ?? ''}|${data.approxTokens ?? ''}`;
  };
  render({ mode: 'early', thresholdTokens: null, approxTokens: null });

  async function load() {
    const r = await api('/api/compact/config');
    if (!r?.ok) return;
    const data = { mode: r.mode, thresholdTokens: r.thresholdTokens ?? null, approxTokens: r.approxTokens ?? null };
    if (`${data.mode}|${data.thresholdTokens ?? ''}|${data.approxTokens ?? ''}` !== rendered) render(data);
    const list = (r.sessions || []).sort((a, b) => b.inputTokens - a.inputTokens).slice(0, 6);
    const sessions = document.getElementById('compactSessions');
    if (sessions) {
      sessions.textContent = list.length
        ? '上一步读了多少：' + list.map((x) => `${x.key} ${Math.round(x.inputTokens / 10_000)} 万`).join('，')
        : '桥接这次启动后还没有会话跑过，暂时看不到每个会话读了多少';
    }
  }

  // 填阈值就等于选「提前压缩」；这里只做交互便利，不改数据（事件委托，重渲染后依然有效）。
  form.addEventListener('focusin', (event) => {
    if (event.target?.id !== 'compactWan') return;
    const early = form.querySelector('input[name="compactMode"][value="early"]');
    if (early) early.checked = true;
  });

  refreshCompactSessions = load;
  load();
  return { load };
}
