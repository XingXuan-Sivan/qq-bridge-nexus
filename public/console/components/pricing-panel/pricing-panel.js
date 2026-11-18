// 价目表面板：内置官方价 → 平台申报 → 本机覆盖。
//
// 这里只做三件事：看清「现在这张表」、改「与申报不同的单价」、补「表里没有的模型」。所以：
//   · 平台与模型都自动取（活动 Agent 平台 + 全局配置里的默认模型），没有切换控件；
//   · 高峰时段只显示声明面的口径，不给编辑入口 —— 改口径就改平台申报，本机层只存单价；
//   · 账本里出现过、表里却没有的模型会列成空格子：它们的 token 已经记着，
//     补上单价后历史花费按新表重算，不需要重新记一遍账；
//   · 平台没申报的模型用「添加模型」手写一行，落进本机覆盖层；
//     「还原默认价目」把本机层整个撤掉，回到申报 + 内置官方价。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { dataTableHtml, initDataTables } from '../table/table.js';
import { inlineActions } from '../form/form.js';
import { setMsg } from '../message/message.js';
import { confirmBox } from '../message-box/message-box.js';

const PRICE_KEYS = ['cacheHit', 'cacheMiss', 'cacheWrite', 'output'];
const PRICE_KEY_LABELS = { cacheHit: '缓存命中', cacheMiss: '缓存未命中', cacheWrite: '缓存写入', output: '输出' };
const WEEKDAY_TEXT = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' };
const SOURCE_TAGS = {
  local: '<span class="tag tag--primary">本机覆盖</span>',
  declared: '<span class="tag tag--success">平台申报</span>',
  builtin: '<span class="tag">内置官方价</span>',
  none: '<span class="tag tag--danger">没有价目</span>',
};
const SAVE_MSG_ID = 'pricingSaveMsg';
/** 模型 id 会成为 state/pricing/<agent>.yml 的键：先挡住空白与奇怪符号。 */
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function padHour(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function hoursText(windows) {
  return (windows ?? []).map(([start, end]) => `${padHour(start)}–${padHour(end)}`).join('、');
}

function weekdaysText(days) {
  const list = [...new Set(days ?? [])].sort((a, b) => a - b);
  if (!list.length || list.length === 7) return '每天';
  if (list.join(',') === '1,2,3,4,5') return '工作日';
  if (list.join(',') === '6,7') return '周末';
  return `周${list.map((day) => WEEKDAY_TEXT[day] ?? day).join('、')}`;
}

/** 一个模型的高峰口径一句话：「全天同价」或「工作日 09:00–12:00、14:00–18:00 ×2」。 */
function peakText(peak) {
  const windows = peak?.peakWindows ?? [];
  if (!windows.length) return '全天同价';
  return `${weekdaysText(peak.peakWeekdays)} ${hoursText(windows)} ×${peak.peakMultiplier ?? 1}`;
}

function unitText(unit) {
  const n = Number(unit) || 1e6;
  return n >= 1e6 ? `${Number((n / 1e6).toFixed(2))} 百万 token` : `${n} token`;
}

function tokensText(tokens) {
  const n = Number(tokens) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

/**
 * 挂载面板。
 *
 * @param {HTMLElement} host 卡片里的挂载点
 * @param {{onSaved?:()=>void}} [options] `onSaved`：价目变了（账本会重算），通知宿主重读用量
 */
export function mountPricingPanel(host, { onSaved } = {}) {
  if (!host) return null;
  host.innerHTML = `<div class="pricing-panel">
    <div class="row pricing-head">
      <span class="meta">平台</span><span class="tag" data-pricing-agent>—</span>
      <span class="meta">默认模型</span><code data-pricing-model>—</code>
      <span data-pricing-source></span>
    </div>
    <p class="meta" data-pricing-status role="status"></p>
    <p class="meta" data-pricing-policy></p>
    <p class="meta" data-pricing-gap hidden></p>
    <div data-pricing-table></div>
  </div>`;

  const panel = host.firstElementChild;
  const el = {
    agent: panel.querySelector('[data-pricing-agent]'),
    model: panel.querySelector('[data-pricing-model]'),
    source: panel.querySelector('[data-pricing-source]'),
    status: panel.querySelector('[data-pricing-status]'),
    policy: panel.querySelector('[data-pricing-policy]'),
    gap: panel.querySelector('[data-pricing-gap]'),
    table: panel.querySelector('[data-pricing-table]'),
  };

  let view = null;      // 最近一次 /api/pricing 快照
  let dirty = false;    // 有未保存的单价改动
  let loading = false;
  // 手动新增的模型行还只活在界面上：保存时随补丁一起写进本机覆盖层。
  let drafts = [];
  let draftSeq = 0;
  // 界面上正在敲的值：重画表格（加一行、搜索、刷新）不能把没保存的输入丢掉。
  const typedPrices = new Map();   // 行 key（模型 id 或草稿 key）→ 四个单价
  const typedIds = new Map();      // 草稿 key → 模型 id
  const dropped = new Set();       // 本次点「移除覆盖」的行：补丁里没有它就算撤掉

  // ── 行数据 ───────────────────────────────────────────────────────────────
  /** 表级口径（平台声明）：本地新增的模型没有自己的口径时按它显示。 */
  function tablePeak() {
    const table = view?.table;
    if (!table) return null;
    return { peakMultiplier: table.peakMultiplier, peakWindows: table.peakWindows, peakWeekdays: table.peakWeekdays };
  }

  function usageOf(id) {
    return (view?.coverage ?? []).find((item) => item.model === id) ?? null;
  }

  function pricingRowsOf() {
    const declared = view?.declared?.models ?? {};
    const effective = view?.table?.models ?? {};
    const local = view?.local?.models ?? {};
    const ids = new Set([...Object.keys(declared), ...Object.keys(effective), ...Object.keys(local)]);
    // 默认模型即使三层都没报价也要有一行：那一行就是用户补价的地方。
    if (view?.model) ids.add(view.model);
    // 账本里用过、但表里没有的模型同理（会话单独选过的模型常常只出现在这里）。
    for (const item of view?.coverage ?? []) if (item.model) ids.add(item.model);
    return [...ids].sort((a, b) => a.localeCompare(b)).map((id) => {
      const baseOff = declared[id]?.off ?? null;
      const override = local[id] ?? {};
      const value = {};
      for (const key of PRICE_KEYS) {
        // 本机层只存改过的字段：没写的回落申报价（与账本取价同一条规则）。
        value[key] = override[key] ?? baseOff?.[key] ?? effective[id]?.off?.[key] ?? '';
      }
      return {
        id,
        label: effective[id]?.label ?? declared[id]?.label ?? usageOf(id)?.label ?? id,
        origin: local[id] ? 'local' : (effective[id]?.origin ?? 'declared'),
        priced: Boolean(effective[id]),
        isDefault: id === view?.model,
        usage: usageOf(id),
        value,
        peak: effective[id]?.peak ?? tablePeak(),
      };
    });
  }

  function rowTags(row) {
    return [
      row.isDefault ? '<span class="tag tag--primary">默认模型</span>' : '',
      row.origin === 'local' ? SOURCE_TAGS.local : '',
      row.origin === 'builtin' ? SOURCE_TAGS.builtin : '',
      row.priced ? '' : '<span class="tag tag--danger">待补价目</span>',
    ].filter(Boolean).join('');
  }

  function priceInput(row, key, unit) {
    const value = typedPrices.get(row.id)?.[key] ?? row.value[key] ?? '';
    return `<input type="number" min="0" step="0.0001" class="pricing-price-input"`
      + ` data-price-key="${key}" value="${esc(String(value))}"`
      + ` aria-label="${esc(row.id)} ${PRICE_KEY_LABELS[key]}单价（${esc(unit)}）">`;
  }

  function modelCell(row) {
    const usage = row.usage;
    const hint = usage && !row.priced
      ? `<div class="meta">账本已记 ${esc(tokensText(usage.tokens))} token，没算钱</div>`
      : '';
    // 移除只给「本机层里有这一条」的行：申报里的模型删了下次读表又回来。
    // 移除不是删文件，而是保存时不再提交它 —— 整段覆盖写入，少哪条就等于撤掉哪条。
    const drop = view?.local?.models?.[row.id] && !row.isDefault
      ? `<button type="button" class="btn small danger" data-price-drop="${esc(row.id)}"`
        + ' title="删掉这一行的本机覆盖，保存后生效">移除覆盖</button>'
      : '';
    return `<code>${esc(row.id)}</code><div class="meta">${esc(row.label)}</div>`
      + `<div class="pricing-row-tags">${rowTags(row)}${drop}</div>${hint}`;
  }

  /** 手动新增的一行：模型 id 可编辑，单价空着等填，保存时写进本机覆盖层。 */
  function draftRow(draft, unit) {
    const id = typedIds.get(draft.key) ?? '';
    return {
      attrs: { 'data-price-draft': draft.key },
      cells: [
        `<input type="text" class="pricing-price-input" data-price-id value="${esc(id)}"`
          + ' placeholder="模型 id" aria-label="新增模型的 id">'
          + '<div class="pricing-row-tags"><span class="tag tag--danger">新增待填</span></div>',
        ...PRICE_KEYS.map((key) => `<input type="number" min="0" step="0.0001" class="pricing-price-input"`
          + ` data-price-key="${key}" value="${esc(String(typedPrices.get(draft.key)?.[key] ?? ''))}"`
          + ` aria-label="新增模型 ${PRICE_KEY_LABELS[key]}单价（${esc(unit)}）">`),
        `<span class="meta">${esc(peakText(tablePeak()))}</span>`,
      ],
    };
  }

  function rowsHtml(base) {
    const unit = unitText(view?.table?.unit ?? 1e6);
    const rows = base.map((row) => ({
      attrs: { 'data-price-row': row.id },
      cells: [
        modelCell(row),
        ...PRICE_KEYS.map((key) => priceInput(row, key, unit)),
        `<span class="meta">${esc(peakText(row.peak))}</span>`,
      ],
    }));
    return [...rows, ...drafts.map((draft) => draftRow(draft, unit))];
  }

  // ── 渲染 ─────────────────────────────────────────────────────────────────
  function statusFor() {
    if (!view) return ['价目表读取中…', 'info'];
    if (!view.model) {
      return ['还没有默认模型：先在「模型与思考强度」里选一个，价目表跟着它匹配。', 'info'];
    }
    if (view.match?.priced) {
      const tier = view.match.tierLabel ? ` · 现在${view.match.tierLabel}` : '';
      return [`已匹配「${view.match.label || view.model}」的价目${tier}`, 'ok'];
    }
    return [`价目表里没有「${view.model}」：在下面这一行填好单价并保存，历史花费会按新表重算。`, 'err'];
  }

  function policyText() {
    const policy = view?.policy;
    if (!policy) return '这个 Agent 平台没有任何价目口径：单价只能在这里补，补完才有峰谷之分。';
    const peak = policy.windows?.length
      ? `${weekdaysText(policy.weekdays)} ${hoursText(policy.windows)} ×${policy.multiplier}`
      : '全天同价';
    const holiday = policy.holidayCount ? ` · 法定节假日 ${policy.holidayCount} 天不计高峰` : '';
    return `表里是空闲价，高峰时段跟随当前口径：${peak}${holiday}（口径由平台申报决定，本页只改单价）。`;
  }

  function gapText() {
    const gaps = (view?.coverage ?? []).filter((item) => !item.priced);
    if (!gaps.length) return '';
    const names = gaps.map((item) => item.label || item.model).join('、');
    return `账本里还有 ${gaps.length} 个模型没有价目（${names}）：token 都记着，补上单价后金额立即重算。`;
  }

  function paintTable() {
    const base = pricingRowsOf();
    const rows = rowsHtml(base);
    el.table.innerHTML = dataTableHtml({
      columns: [
        { label: '模型', width: 320 },
        { label: '缓存命中', width: 130 },
        { label: '缓存未命中', width: 140 },
        { label: '缓存写入', width: 130 },
        { label: '输出', width: 120 },
        { label: '高峰时段', width: 240 },
      ],
      rows,
      pageSize: 20,
      search: { placeholder: '搜索模型' },
      refresh: true,
      meta: `${base.length} 个模型 · ${unitText(view?.table?.unit ?? 1e6)}`,
      actions: inlineActions({
        items: [
          { id: 'pricingAdd', label: '添加模型', small: true, attrs: { 'data-price-action': 'add' } },
          { id: 'pricingSave', label: '保存覆盖', variant: 'primary', small: true, attrs: { 'data-price-action': 'save' } },
          { id: 'pricingReset', label: '还原默认价目', variant: 'danger', small: true, attrs: { 'data-price-action': 'reset' } },
        ],
        status: SAVE_MSG_ID,
      }),
      empty: '这里还没有可报价的模型。',
      fit: true,
    });
    // 工具栏的刷新按钮走表格组件的钩子，不在宿主上另接一次（否则一下点出两个请求）。
    initDataTables(el.table, { onRefresh: () => void load({ force: true }) });
  }

  function render(next) {
    view = next;
    el.agent.textContent = view?.agentLabel || view?.agent || '未选平台';
    el.model.textContent = view?.model || '未设置';
    el.source.innerHTML = SOURCE_TAGS[view?.source] ?? '';
    const [text, kind] = statusFor();
    setMsg(el.status, text, kind);
    el.policy.textContent = policyText();
    const gap = gapText();
    el.gap.hidden = !gap;
    setMsg(el.gap, gap, 'err');
    paintTable();
  }

  /** 读不到快照时不画空表：留白表会让人以为是「这个平台没有模型」。 */
  function renderFailure(message) {
    view = null;
    el.agent.textContent = '—';
    el.model.textContent = '—';
    el.source.innerHTML = '';
    setMsg(el.status, `价目表读取失败：${message}`, 'err');
    el.policy.textContent = '';
    el.gap.hidden = true;
    el.table.innerHTML = '';
  }

  // ── 交互 ─────────────────────────────────────────────────────────────────
  /**
   * 单价补丁：与申报价相同的字段不提交，空字段不提交（= 回落申报）。
   * 表里没出现的模型就等于取消覆盖，所以「移除覆盖」「不要把某行提交」都不需要额外的删除接口。
   */
  function pricingPatch() {
    const declared = view?.declared?.models ?? {};
    const models = {};
    const seen = new Set();
    el.table.querySelectorAll('tbody tr[data-price-row], tbody tr[data-price-draft]').forEach((row) => {
      const draftKey = row.dataset.priceDraft ?? '';
      const id = (draftKey
        ? String(row.querySelector('[data-price-id]')?.value ?? '')
        : String(row.dataset.priceRow ?? '')).trim();
      if (!id) {
        if (draftKey) throw new Error('新增的那一行还没填模型 id');
        return;
      }
      if (draftKey && !MODEL_ID_RE.test(id)) {
        throw new Error(`模型 id 只能用字母、数字、点、下划线与连字符：${id}`);
      }
      if (seen.has(id)) throw new Error(`模型 id 重复：${id}`);
      seen.add(id);
      const baseOff = declared[id]?.off ?? null;
      const entry = {};
      for (const key of PRICE_KEYS) {
        const raw = row.querySelector(`[data-price-key="${key}"]`)?.value.trim() ?? '';
        if (!raw) continue;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) continue;
        if (baseOff && Number(baseOff[key]) === value) continue;
        entry[key] = value;
      }
      // 申报里没有的模型要能算钱：缺「未命中」或「输出」就进不了价目表。
      // 只对「真要写它」的行报错：账本里没价的旧行原样留着时，不该拦住保存。
      if (!declared[id] && (entry.cacheMiss === undefined || entry.output === undefined)
        && (draftKey || Object.keys(entry).length)) {
        throw new Error(`新模型 ${id} 要同时填「未命中」与「输出」单价，否则算不了钱`);
      }
      if (Object.keys(entry).length) models[id] = entry;
    });
    return { models };
  }

  /** 界面上的临时状态（草稿行、未保存的输入、待移除的覆盖）整体清掉。 */
  function clearEdits() {
    dirty = false;
    drafts = [];
    typedPrices.clear();
    typedIds.clear();
    dropped.clear();
  }

  function setSaveMsg(text, tone = '') {
    const node = document.getElementById(SAVE_MSG_ID);
    if (!node) return;
    node.textContent = text;
    node.className = 'form-actions-status' + (tone ? ` ${tone}` : '');
  }

  async function save() {
    let patch;
    try {
      patch = pricingPatch();
    } catch (error) {
      setSaveMsg(`❌ ${error?.message || '单价不完整'}`, 'err');
      return;
    }
    const models = Object.keys(patch.models).length;
    // 只点了「移除覆盖」也要提交：整段写入，这条不在补丁里就等于撤掉。
    if (!models && !dropped.size) {
      setSaveMsg('单价与当前价目一致，没有需要保存的覆盖。');
      return;
    }
    setSaveMsg('保存中…');
    try {
      const r = await api('/api/pricing', 'PUT', patch);
      if (!r.ok) { setSaveMsg(`❌ ${r.error || '保存失败'}`, 'err'); return; }
      clearEdits();
      render(r);
      setSaveMsg(models ? `已保存覆盖（${models} 个模型）` : '已撤掉本机覆盖', 'ok');
      showConsoleToast('价目已保存，账本按新表重算历史金额');
      onSaved?.();
    } catch (error) {
      setSaveMsg(`❌ ${error?.message || '保存失败'}`, 'err');
    }
  }

  async function reset() {
    const agent = view?.agent || '';
    if (!(await confirmBox({
      title: '还原默认价目',
      message: `删除 state/pricing/${agent || '<agent>'}.yml 的本机覆盖：改过的单价与手动添加的模型一起撤回平台申报 + 内置官方价。\n账本里的 token 与调用流水不删，金额会按默认价重算。`,
      confirmText: '还原',
      danger: true,
    }))) return;
    setSaveMsg('还原中…');
    try {
      const r = await api('/api/pricing', 'DELETE');
      if (!r.ok) { setSaveMsg(`❌ ${r.error || '还原失败'}`, 'err'); return; }
      clearEdits();
      render(r);
      setSaveMsg('已还原默认价目', 'ok');
      onSaved?.();
    } catch (error) {
      setSaveMsg(`❌ ${error?.message || '还原失败'}`, 'err');
    }
  }

  /** 读一次价目（表单里正在敲字时不覆盖，除非 force）。 */
  async function load({ force = false } = {}) {
    if (loading) return;
    if (!force && busy()) return;
    loading = true;
    try {
      const snapshot = await api('/api/pricing');
      // 老进程 / 代理缺路由时回的是 404 JSON：当成快照画就会变成「0 个模型」的假象。
      if (snapshot?.ok !== true) throw new Error(snapshot?.error || '接口没有返回价目');
      clearEdits();
      render(snapshot);
    } catch (error) {
      renderFailure(error?.message || '未知错误');
    } finally {
      loading = false;
    }
  }

  function busy() {
    if (dirty) return true;
    const active = document.activeElement;
    return Boolean(active && panel.contains(active));
  }

  /** 加一行空白的模型行，焦点落到 id 输入框；单价保留上一次输入，重画不丢。 */
  function addDraft() {
    const key = `draft-${++draftSeq}`;
    drafts.push({ key });
    paintTable();
    // 分页是「只隐藏行」：刚加的那行可能在第二页，显式拉回当前页再聚焦。
    const row = el.table.querySelector(`tbody tr[data-price-draft="${key}"]`);
    if (row) {
      row.hidden = false;
      row.querySelector('[data-price-id]')?.focus();
    }
    dirty = true;
    setSaveMsg('填好 id 与单价后点「保存覆盖」。');
  }

  panel.addEventListener('input', (event) => {
    const row = event.target.closest('tr');
    if (!row) return;
    const draftKey = row.dataset.priceDraft ?? '';
    const rowKey = draftKey || row.dataset.priceRow || '';
    if (!rowKey) return;
    const idInput = event.target.closest('[data-price-id]');
    if (idInput) {
      typedIds.set(rowKey, idInput.value);
    } else {
      const priceKey = event.target.closest('[data-price-key]')?.dataset.priceKey;
      if (!priceKey) return;
      const bucket = typedPrices.get(rowKey) ?? {};
      bucket[priceKey] = event.target.value;
      typedPrices.set(rowKey, bucket);
    }
    dirty = true;
  });
  panel.addEventListener('click', (event) => {
    const action = event.target.closest('[data-price-action]')?.dataset.priceAction;
    if (action === 'add') void addDraft();
    else if (action === 'save') void save();
    else if (action === 'reset') void reset();
    const drop = event.target.closest('[data-price-drop]');
    if (!drop) return;
    const id = drop.dataset.priceDrop;
    dropped.add(id);
    typedPrices.delete(id);
    drop.closest('tr')?.remove();
    dirty = true;
    setSaveMsg(`已移除「${id}」的本机覆盖：保存后生效。`);
  });

  void load({ force: true });
  return { load, busy, get priced() { return view?.match?.priced === true; } };
}
