// 价目表面板：内置官方价 → 平台申报 → 本机覆盖。
//
// 这里只做三件事：看清「现在这张表」、改「与申报不同的单价」、补「表里没有的模型」。所以：
//   · 平台与模型都自动取（活动 Agent 平台 + 全局配置里的默认模型），没有切换控件；
//   · 单价直接在格子里改；高峰时段（窗口 / 星期 / 倍数）在「操作」列里开弹窗改，
//     写进本机层的 policy —— 只盖写了的组，没写的组回落模型级申报 → 平台申报 → 内置口径；
//   · 账本里出现过、表里却没有的模型会列成空格子：它们的 token 已经记着，
//     补上单价后历史花费按新表重算，不需要重新记一遍账；
//   · 平台没申报的模型用「添加模型」手写一行，落进本机覆盖层；
//     「还原默认价目」把本机层整个撤掉，回到申报 + 内置官方价。
//
// 表格与弹窗都用 components 下的组件：表格走 dataTableHtml（与全局配置其它表同一套结构，
// 操作列用 .row-actions + btn small），时间字段走 timeFieldHtml（与定时任务同一条时间选择器），
// 星期与倍数走 checkboxGroup / numberField，行壳走 fieldRowHtml。页面不另拼一份控件。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { dataTableHtml, initDataTables } from '../table/table.js';
import { checkboxGroup, fieldRowHtml, inlineActions, numberField } from '../form/form.js';
import { initTimeFields, timeFieldHtml } from '../time/time.js';
import { closeModal, isModalOpen, modalHtml, openModal, wireModal } from '../modal/modal.js';
import { setMsg } from '../message/message.js';
import { confirmBox } from '../message-box/message-box.js';

const PRICE_KEYS = ['cacheHit', 'cacheMiss', 'cacheWrite', 'output'];
const PRICE_KEY_LABELS = { cacheHit: '缓存命中', cacheMiss: '缓存未命中', cacheWrite: '缓存写入', output: '输出' };
const WEEKDAY_TEXT = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '日' };
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
/** 没有任何口径可继承时的空峰谷：全天同价、倍数 1。 */
const NO_PEAK = { peakMultiplier: 1, peakWindows: [], peakWeekdays: [] };
const TRASH = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.6h10M6.3 4.6V3.1h3.4v1.5M4.9 4.6l.6 8.3h5l.6-8.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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
  let dirty = false;    // 有未保存的改动
  let loading = false;
  // 手动新增的模型行还只活在界面上：保存时随补丁一起写进本机覆盖层。
  let drafts = [];
  let draftSeq = 0;
  // 界面上正在敲的值：重画表格（加一行、搜索、刷新）不能把没保存的输入丢掉。
  const typedPrices = new Map();   // 行 key（模型 id 或草稿 key）→ 四个单价
  const typedIds = new Map();      // 草稿 key → 模型 id
  // 弹窗里改过的峰谷口径：行 key → { peakWindows, peakWeekdays, peakMultiplier }。
  const typedPolicies = new Map();
  const dropped = new Set();       // 本次点「移除」的行：补丁里没有它就算撤掉
  const restored = new Set();      // 本次把高峰口径改回申报的模型：单价没变也要允许提交
  // 高峰口径弹窗：挂在 document.body 上，peakKey 指向正在编辑的那一行。
  let peakOverlay = null;
  let peakKey = '';
  let peakWindowSeq = 0;

  // ── 行数据 ───────────────────────────────────────────────────────────────
  /** 表级口径（含本机覆盖后的最终值）：本地新增的模型没有自己的口径时按它显示。 */
  function tablePeak() {
    const table = view?.table;
    if (!table) return null;
    return { peakMultiplier: table.peakMultiplier, peakWindows: table.peakWindows, peakWeekdays: table.peakWeekdays };
  }

  /** 平台申报的表级口径（不含本机覆盖）：本地新增的模型没有自己的口径时，「恢复」回落到这一层。 */
  function declaredTablePeak() {
    const table = view?.declared;
    if (!table) return NO_PEAK;
    return {
      peakMultiplier: table.peakMultiplier ?? 1,
      peakWindows: table.peakWindows ?? [],
      peakWeekdays: table.peakWeekdays ?? [],
    };
  }

  function declaredPeakOf(id) {
    return view?.declared?.models?.[id]?.peak ?? declaredTablePeak();
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
        key: id,
        label: effective[id]?.label ?? declared[id]?.label ?? usageOf(id)?.label ?? id,
        origin: local[id] ? 'local' : (effective[id]?.origin ?? 'declared'),
        priced: Boolean(effective[id]),
        isDefault: id === view?.model,
        usage: usageOf(id),
        value,
        peak: effective[id]?.peak ?? tablePeak() ?? NO_PEAK,
        declaredPeak: declaredPeakOf(id),
        policyLocal: Boolean(local[id]?.policy),
      };
    }).filter((row) => !dropped.has(row.id));
  }

  /** 这一行现在该显示哪个口径：弹窗改过的 → 本机已存的 → 恢复申报后的 → 最终生效值。 */
  function peakOf(row) {
    if (typedPolicies.has(row.key)) return { peak: typedPolicies.get(row.key), local: true };
    if (restored.has(row.id)) return { peak: row.declaredPeak, local: false };
    return { peak: row.peak, local: row.policyLocal };
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
    // 标签跟模型 id 同一行：单独占一行会把这一列撑成三段，与右边四列的单价格子错行。
    return `<div class="pricing-model-head"><code>${esc(row.id)}</code>${rowTags(row)}</div>`
      + `<div class="meta">${esc(row.label)}</div>${hint}`;
  }

  /** 高峰时段格：一句话口径；本机改过的加一个标签，免得以为是平台申报。 */
  function peakCell(peak, local) {
    return `<div class="pricing-peak-cell"><span class="meta">${esc(peakText(peak))}</span>`
      + (local ? '<span class="tag tag--primary">本机口径</span>' : '')
      + '</div>';
  }

  /**
   * 操作列：编辑高峰（正式行与草稿行都有）、移除本机覆盖（只有本机层有这条时）。
   * 移除不是删文件，而是保存时不再提交它 —— 整段覆盖写入，少哪条就等于撤掉哪条。
   */
  function rowActions(row) {
    const drop = view?.local?.models?.[row.id]
      ? `<button type="button" class="btn small danger" data-price-drop="${esc(row.id)}"`
        + ' title="移除这一行的本机覆盖（单价与高峰口径），保存后生效">移除</button>'
      : '';
    return `<div class="row-actions">`
      + `<button type="button" class="btn small" data-price-peak="${esc(row.key)}"`
      + ' title="编辑这个模型的高峰时段、星期与倍数">编辑高峰</button>'
      + drop
      + '</div>';
  }

  /** 手动新增的一行：模型 id 可编辑，单价空着等填，保存时写进本机覆盖层。 */
  function draftRow(draft, unit) {
    const id = typedIds.get(draft.key) ?? '';
    const peak = typedPolicies.get(draft.key) ?? tablePeak() ?? NO_PEAK;
    return {
      attrs: { 'data-price-draft': draft.key },
      cells: [
        `<input type="text" class="pricing-price-input" data-price-id value="${esc(id)}"`
          + ' placeholder="模型 id" aria-label="新增模型的 id">',
        ...PRICE_KEYS.map((key) => `<input type="number" min="0" step="0.0001" class="pricing-price-input"`
          + ` data-price-key="${key}" value="${esc(String(typedPrices.get(draft.key)?.[key] ?? ''))}"`
          + ` aria-label="新增模型 ${PRICE_KEY_LABELS[key]}单价（${esc(unit)}）">`),
        peakCell(peak, typedPolicies.has(draft.key)),
        `<div class="row-actions">`
          + `<button type="button" class="btn small" data-price-peak="${esc(draft.key)}"`
          + ' title="编辑这一行的高峰时段、星期与倍数">编辑高峰</button>'
          + `<button type="button" class="btn small danger" data-price-draft-del="${esc(draft.key)}"`
          + ' title="移除这一行（还没保存）">移除</button>'
          + '</div>',
      ],
    };
  }

  function rowsHtml(base) {
    const unit = unitText(view?.table?.unit ?? 1e6);
    const rows = base.map((row) => {
      const { peak, local } = peakOf(row);
      return {
        attrs: { 'data-price-row': row.id },
        cells: [
          modelCell(row),
          ...PRICE_KEYS.map((key) => priceInput(row, key, unit)),
          peakCell(peak, local),
          rowActions(row),
        ],
      };
    });
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
    return `表里是空闲价；平台申报的高峰口径：${peak}${holiday}。`
      + '每个模型可以在「操作」里单独改高峰时段、星期与倍数，保存后进本机覆盖层。';
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
        // 模型 id 与状态标签排在同一行，这一列不用再为「标签另占一行」留宽。
        { label: '模型', width: 250 },
        // 四个单价格子只要装得下 4 位小数；省下来的宽度留给高峰时段那列的一句话口径。
        { label: '缓存命中', width: 110 },
        { label: '缓存未命中', width: 120 },
        { label: '缓存写入', width: 110 },
        { label: '输出', width: 100 },
        // 不写宽度：让它吸收剩余宽度（table-layout: fixed 下其余列会按比例摊）。
        { label: '高峰时段' },
        { label: '操作', width: 150 },
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
   * 覆盖补丁：与申报价相同的字段不提交，空字段不提交（= 回落申报）。
   * 峰谷口径从弹窗的状态里取，不读 DOM —— 时段是动态行，重画后仍靠行 key 找回。
   * 表里没出现的模型就等于取消覆盖，所以「移除」不需要额外的删除接口。
   */
  function pricingPatch() {
    const declared = view?.declared?.models ?? {};
    const models = {};
    const seen = new Set();
    el.table.querySelectorAll('tbody tr[data-price-row], tbody tr[data-price-draft]').forEach((row) => {
      const draftKey = row.dataset.priceDraft ?? '';
      const rowKey = draftKey || row.dataset.priceRow || '';
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
      // 本机已存的这一条与用户真敲过的格子：只有这两类值才写成覆盖。
      // 其余格子里的数是继承来的（申报价 / 内置价 / 缺省按未命中价），写进去只会把派生值固化成覆盖；
      // 反过来，本机已存的值必须原样带上 —— 整段写入，少写一个键就等于把它删了。
      const storedEntry = view?.local?.models?.[id] ?? null;
      const typedEntry = typedPrices.get(rowKey) ?? null;
      const entry = {};
      for (const key of PRICE_KEYS) {
        const raw = row.querySelector(`[data-price-key="${key}"]`)?.value.trim() ?? '';
        if (!raw) continue;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) continue;
        if (baseOff && Number(baseOff[key]) === value) continue;
        if (storedEntry?.[key] === undefined && typedEntry?.[key] === undefined) continue;
        entry[key] = value;
      }
      // 申报里没有的模型要能算钱：缺「未命中」或「输出」就进不了价目表。
      // 只对「真要写它」的行报错：账本里没价的旧行原样留着时，不该拦住保存。
      if (!declared[id] && (entry.cacheMiss === undefined || entry.output === undefined)
        && (draftKey || Object.keys(entry).length)) {
        throw new Error(`新模型 ${id} 要同时填「未命中」与「输出」单价，否则算不了钱`);
      }
      // 本机层已有的口径要随行带上：整段写入，少写一组的代价是「保存一次就把高峰口径洗掉」。
      // 被弹窗「恢复申报口径」标记过的行例外 —— 那一次要的就是不再提交它。
      const stored = id && !restored.has(id) ? view?.local?.models?.[id]?.policy : null;
      const policy = typedPolicies.get(rowKey) ?? (stored ? { ...stored } : null);
      if (policy) entry.policy = policy;
      if (Object.keys(entry).length) models[id] = entry;
    });
    return { models };
  }

  /** 界面上的临时状态（草稿行、未保存的输入、待移除的覆盖、弹窗里改过的口径）整体清掉。 */
  function clearEdits() {
    dirty = false;
    drafts = [];
    typedPrices.clear();
    typedIds.clear();
    typedPolicies.clear();
    dropped.clear();
    restored.clear();
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
    // 只点了「移除」/「恢复申报口径」也要提交：整段写入，这条不在补丁里就等于撤掉。
    if (!models && !dropped.size && !restored.size) {
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
      // 重读会清掉界面态，弹窗里正在改的口径也就没意义了：先关掉。
      if (isModalOpen(peakOverlay)) closeModal(peakOverlay);
      peakKey = '';
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
    // 弹窗挂在 body 上，不在 panel 里：只看 activeElement 会漏掉「正在弹窗里改口径」。
    if (isModalOpen(peakOverlay)) return true;
    const active = document.activeElement;
    return Boolean(active && panel.contains(active));
  }

  // ── 高峰口径弹窗 ────────────────────────────────────────────────────────
  // 单价在格子里改，峰谷是「窗口 × 星期 × 倍数」三组，一行里放不下，所以单独开弹窗。
  // 时间用项目自带的时间组件（可见文本框 + 时钟按钮 + 隐藏原生输入，与定时任务同一套）。
  /** 解析 HH:mm；分钟必须为 0 —— 价目表的窗口按整点存。 */
  function parseClock(text) {
    const match = String(text ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 24 || minute > 59) return null;
    return { hour, minute };
  }

  function peakWindowHtml(slot = [9, 18]) {
    const index = ++peakWindowSeq;
    const [start, end] = slot;
    return '<div class="pricing-peak-window" data-peak-window>'
      + timeFieldHtml({ id: `pricingPeakFrom${index}`, value: padHour(start), label: '高峰开始时间', attrs: { 'data-peak-from': '1' } })
      + '<span class="field-unit">到</span>'
      + timeFieldHtml({ id: `pricingPeakTo${index}`, value: padHour(end), label: '高峰结束时间', attrs: { 'data-peak-to': '1' } })
      + `<button type="button" class="btn-icon" data-peak-del aria-label="删掉这个高峰时段" title="删掉这个时段">${TRASH}</button>`
      + '</div>';
  }

  function renderPeakWindows(windows) {
    const host = peakOverlay?.querySelector('[data-peak-windows]');
    if (!host) return;
    host.innerHTML = windows.length
      ? windows.map((slot) => peakWindowHtml(slot)).join('')
      : '<p class="meta">一个时段都没有 = 这个模型全天同价。</p>';
    // 动态插入的时间字段要重新装组件，否则只有文本框、没有时钟按钮。
    initTimeFields(host);
  }

  function ensurePeakModal() {
    if (peakOverlay) return peakOverlay;
    // 切页再回来时 mount 会重建闭包：旧的遮罩还挂在 body 上，先清掉再建，免得同 id 两份。
    document.getElementById('pricingPeakOverlay')?.remove();
    const wrap = document.createElement('div');
    wrap.innerHTML = modalHtml({
      id: 'pricingPeakOverlay',
      title: '编辑高峰时段',
      // 三行都由组件出标记：行壳 fieldRowHtml、星期 checkboxGroup、倍数 numberField。
      body: '<div class="form-stack">'
        + '<div data-peak-windows-row></div>'
        + '<div data-peak-weekdays></div>'
        + '<div data-peak-multiplier></div>'
        + '</div>',
      footer: '<span class="modal-status" data-peak-msg></span>'
        + '<button type="button" class="btn" data-peak-restore>恢复申报口径</button>'
        + '<button type="button" class="btn" data-modal-close>取消</button>'
        + '<button type="button" class="btn primary" data-peak-apply>确定</button>',
    });
    const overlay = wrap.firstElementChild;
    // 遮罩必须挂在 body 上：片段注入在 .card 里时，卡片动画会给 position:fixed 造包含块。
    document.body.appendChild(overlay);
    overlay.querySelector('[data-peak-windows-row]').innerHTML = fieldRowHtml({
      label: '高峰时段',
      control: '<div class="pricing-peak-windows" data-peak-windows></div>'
        + '<button type="button" class="btn small" data-peak-add>＋ 添加时段</button>',
      hint: '按整点计（分钟填 00），每个时段「起点 < 终点」；跨夜请拆成两段。',
    });
    overlay.querySelector('[data-peak-weekdays]').innerHTML = checkboxGroup({
      id: 'pricingPeakWeekdays',
      label: '高峰星期',
      options: WEEKDAYS.map((day) => ({ value: String(day), label: `周${WEEKDAY_TEXT[day]}` })),
      value: [],
      hint: '高峰只在这些星期生效；法定节假日不计高峰。',
    });
    overlay.querySelector('[data-peak-multiplier]').innerHTML = numberField({
      id: 'pricingPeakMultiplier',
      label: '高峰倍数',
      value: 1,
      min: 0.01,
      step: 0.1,
      unit: '× 空闲单价',
      hint: '高峰时段按空闲单价乘这个倍数计费。',
    });
    wireModal(overlay, { onClose: () => { peakKey = ''; } });
    overlay.addEventListener('click', (event) => {
      if (event.target.closest('[data-peak-add]')) { addPeakWindow(); return; }
      const del = event.target.closest('[data-peak-del]');
      if (del) { del.closest('[data-peak-window]')?.remove(); return; }
      if (event.target.closest('[data-peak-apply]')) { applyPeak(); return; }
      if (event.target.closest('[data-peak-restore]')) restorePeak();
    });
    peakOverlay = overlay;
    return overlay;
  }

  function setPeakMsg(text, tone = '') {
    const node = peakOverlay?.querySelector('[data-peak-msg]');
    if (!node) return;
    node.textContent = text;
    node.className = 'modal-status' + (tone ? ` ${tone}` : '');
  }

  /** 这一行当前的口径与「申报口径」：弹窗初值与恢复目标都从这里取。 */
  function peakTargetOf(key) {
    const row = pricingRowsOf().find((item) => item.key === key);
    if (row) {
      return {
        key,
        label: row.label || row.id,
        peak: typedPolicies.get(key) ?? peakOf(row).peak,
        declared: row.declaredPeak,
      };
    }
    const draft = drafts.find((item) => item.key === key);
    if (!draft) return null;
    return {
      key,
      label: (typedIds.get(key) ?? '').trim() || '新增模型',
      peak: typedPolicies.get(key) ?? tablePeak() ?? NO_PEAK,
      declared: declaredTablePeak(),
    };
  }

  function addPeakWindow() {
    const host = peakOverlay?.querySelector('[data-peak-windows]');
    if (!host) return;
    // 空态提示先清掉，否则新行会接在「一个时段都没有」后面。
    host.querySelector('.meta')?.remove();
    host.insertAdjacentHTML('beforeend', peakWindowHtml());
    initTimeFields(host);
    host.lastElementChild?.querySelector('.time-field-text')?.focus();
  }

  function openPeak(key) {
    const target = peakTargetOf(key);
    if (!target) return;
    const overlay = ensurePeakModal();
    peakKey = key;
    overlay.querySelector('.modal-head h3').textContent = `编辑高峰时段 · ${target.label}`;
    setPeakMsg('');
    renderPeakWindows(target.peak?.peakWindows ?? []);
    const days = target.peak?.peakWeekdays ?? [];
    overlay.querySelectorAll('input[name="pricingPeakWeekdays"]').forEach((box) => {
      box.checked = days.includes(Number(box.value));
    });
    overlay.querySelector('#pricingPeakMultiplier').value = String(target.peak?.peakMultiplier ?? 1);
    openModal(overlay);
  }

  /** 确定：校验后写进 typedPolicies，表格当场显示新口径；落盘等「保存覆盖」。 */
  function applyPeak() {
    const overlay = peakOverlay;
    if (!overlay || !peakKey) return;
    const windows = [];
    for (const row of overlay.querySelectorAll('[data-peak-window]')) {
      const from = row.querySelector('[data-peak-from]')?.value ?? '';
      const to = row.querySelector('[data-peak-to]')?.value ?? '';
      // 两个都空着 = 不要这一段；只填一个就是没填完。
      if (!from.trim() && !to.trim()) continue;
      const start = parseClock(from);
      const end = parseClock(to);
      if (!start || !end) { setPeakMsg('时间要填成 HH:mm（例如 09:00）', 'err'); return; }
      if (start.minute || end.minute) { setPeakMsg('高峰时段按整点算，分钟请填 00', 'err'); return; }
      if (start.hour >= end.hour) { setPeakMsg('每段的起点要早于终点；跨夜请拆成两段', 'err'); return; }
      windows.push([start.hour, end.hour]);
    }
    const weekdays = [...overlay.querySelectorAll('input[name="pricingPeakWeekdays"]:checked')]
      .map((box) => Number(box.value)).sort((a, b) => a - b);
    // 空星期 + 有时段 = 高峰永不生效，但界面会写成「每天」，所以这里挡住。
    if (windows.length && !weekdays.length) {
      setPeakMsg('至少勾一天；想整天不计高峰就把时段清空', 'err');
      return;
    }
    const multiplier = Number(overlay.querySelector('#pricingPeakMultiplier')?.value);
    if (!Number.isFinite(multiplier) || multiplier <= 0) { setPeakMsg('高峰倍数要大于 0', 'err'); return; }
    const key = peakKey;
    const row = pricingRowsOf().find((item) => item.key === key);
    typedPolicies.set(key, { peakWindows: windows, peakWeekdays: weekdays, peakMultiplier: multiplier });
    if (row) restored.delete(row.id);
    dirty = true;
    closeModal(overlay);
    paintTable();
    setSaveMsg('高峰口径已改：点「保存覆盖」写入本机层。');
  }

  /** 恢复申报口径：删掉弹窗里的改动；本机层本来有这一条时靠「不再提交」表达。 */
  function restorePeak() {
    const key = peakKey;
    const target = peakTargetOf(key);
    if (!target) return;
    const row = pricingRowsOf().find((item) => item.key === key);
    typedPolicies.delete(key);
    if (row?.policyLocal) restored.add(row.id);
    dirty = true;
    closeModal(peakOverlay);
    paintTable();
    setSaveMsg('已改回平台申报口径：保存后生效。');
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
    if (action === 'add') { void addDraft(); return; }
    if (action === 'save') { void save(); return; }
    if (action === 'reset') { void reset(); return; }
    const peak = event.target.closest('[data-price-peak]');
    if (peak) { openPeak(peak.dataset.pricePeak); return; }
    // 草稿行还没落盘：删掉就是丢掉这一行，不涉及本机层。
    const draftDel = event.target.closest('[data-price-draft-del]');
    if (draftDel) {
      const key = draftDel.dataset.priceDraftDel;
      drafts = drafts.filter((item) => item.key !== key);
      typedPrices.delete(key);
      typedIds.delete(key);
      typedPolicies.delete(key);
      dirty = true;
      paintTable();
      setSaveMsg('已移除新增的那一行。');
      return;
    }
    const drop = event.target.closest('[data-price-drop]');
    if (!drop) return;
    const id = drop.dataset.priceDrop;
    dropped.add(id);
    typedPrices.delete(id);
    typedPolicies.delete(id);
    restored.delete(id);
    dirty = true;
    // 重画（行按 dropped 过滤）而不是只摘掉节点：搜索 / 翻页后仍要保持「已移除」。
    paintTable();
    setSaveMsg(`已移除「${id}」的本机覆盖：保存后生效。`);
  });

  void load({ force: true });
  return { load, busy, get priced() { return view?.match?.priced === true; } };
}
