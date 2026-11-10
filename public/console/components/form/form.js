// 表单组件：16 个控件工厂 + createForm 内核（取值/校验/条件显示/提交态/脏值）。
// 设计口径见 docs/CONSOLE_FORMS.md。所有工厂返回 HTML 字符串，与 components/table 的 dataTableHtml 一致；
// 事件绑定、校验、回填交给 createForm()，页面不再自己读 DOM。
import { esc } from '../../js/ui.js';
import { dataTableHtml } from '../table/table.js';

/* ---------------------------------------------------------------- 基础工具 */

const has = (value) => value !== undefined && value !== null && value !== false && value !== '';

function attrs(map) {
  const parts = [];
  for (const [key, value] of Object.entries(map)) {
    if (!has(value)) continue;
    if (value === true) parts.push(key);
    else parts.push(`${key}="${esc(String(value))}"`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function describedBy(ids) {
  const list = ids.filter(Boolean);
  return list.length ? list.join(' ') : '';
}

/** 字段注解（hint/warn/danger/docs）——统一渲染，页面不许手写文案块。 */
function fieldNotes(id, { hint, warn, danger, docs }) {
  const out = [];
  if (hint) out.push(`<p class="field-hint" id="${esc(id)}-hint">${esc(hint)}</p>`);
  if (warn) out.push(`<p class="field-warn" id="${esc(id)}-warn" role="note">${esc(warn)}</p>`);
  if (danger) out.push(`<p class="field-danger" id="${esc(id)}-danger" role="alert">${esc(danger)}</p>`);
  if (docs) {
    const href = esc(docs.href ?? docs);
    const text = esc(docs.text ?? '查看说明');
    out.push(`<p class="field-docs field-hint" id="${esc(id)}-docs"><a href="${href}" target="_blank" rel="noreferrer">${text}</a></p>`);
  }
  return { html: out.join(''), ids: ['hint', 'warn', 'danger', 'docs'].filter((key) => Boolean({ hint, warn, danger, docs }[key])).map((key) => `${id}-${key}`) };
}

/** 字段外壳：label + 控件 + 注解 + 错误行。`labelFor` 只给「控件不是单个可标记元素」的自定义槽用。 */
function fieldShell({ id, label, required, control, hint, warn, danger, docs, hintExtra = '', className = '', labelFor = id }) {
  const notes = fieldNotes(id, { hint, warn, danger, docs });
  const errorId = `${id}-error`;
  const wrapClass = ['field-block', className].filter(Boolean).join(' ');
  // 没有标签的字段（例如自带表头的表格、整块警示文案）不渲染空标签列，也不给它包 .field-row：
  // .field-row 有 min-height:40px，空壳会白白占掉一行高度（access 页两个隐藏警示块曾多出 102px）。
  const labelHtml = label
    ? `<label class="field-label"${labelFor ? ` for="${esc(labelFor)}"` : ''}>${required ? '<span class="field-req" aria-hidden="true">*</span>' : ''}${esc(label)}</label>`
    : '';
  const rowHtml = label
    ? `<div class="field-row">
    ${labelHtml}
    <div class="field-control">${control}</div>
  </div>`
    : control;
  const notesHtml = [notes.html, hintExtra].filter(Boolean).join('');
  const errorHtml = `<p class="field-error" id="${esc(errorId)}" role="alert" hidden></p>`;
  // 有标签的字段保留注解区（错误文案要和控件左边缘对齐）；无标签字段没有注解就不必留空壳。
  const notesBlock = (label || notesHtml) ? `<div class="field-notes">${notesHtml}${errorHtml}</div>` : errorHtml;
  return `<div class="${wrapClass}" data-field-wrap="${esc(id)}">
  ${rowHtml}
  ${notesBlock}
</div>`;
}

const base = ({ id, hint, warn, danger, docs, extraDesc = [], required }) => {
  const desc = describedBy([...extraDesc, hint ? `${id}-hint` : '', warn ? `${id}-warn` : '', danger ? `${id}-danger` : '', docs ? `${id}-docs` : '', required ? `${id}-error` : '']);
  return attrs({ 'aria-describedby': desc, 'aria-invalid': null, 'data-field': id });
};

/* ---------------------------------------------------------------- 控件工厂 */

export function textField({ id, label, value = '', placeholder, hint, warn, danger, docs, maxlength, counter = false, readonly = false, disabled = false, required = false, autocomplete = 'off', inputmode }) {
  const counterHtml = counter
    ? `<span class="field-counter" data-counter-for="${esc(id)}" data-max="${esc(String(maxlength ?? ''))}">${esc(String(value ?? '').length)}${maxlength ? ` / ${esc(String(maxlength))}` : ''}</span>`
    : '';
  const control = `<input${attrs({ id, type: 'text', value, placeholder, maxlength, readonly, disabled, autocomplete, inputmode, required })}${base({ id, hint, warn, danger, docs, required })}>${counterHtml}`;
  return fieldShell({ id, label, required, control, hint, warn, danger, docs });
}

export function numberField({ id, label, value, placeholder, hint, warn, danger, docs, min, max, step = 1, unit, integer = false, disabled = false, required = false }) {
  const control = `<input${attrs({ id, type: 'number', value: value ?? '', placeholder, min, max, step, disabled, required })}${base({ id, hint, warn, danger, docs, required })}>${unit ? `<span class="field-unit">${esc(unit)}</span>` : ''}`;
  return fieldShell({ id, label, required, control, hint, warn, danger, docs });
}

export function passwordField({ id, label, value = '', placeholder, hint, warn, danger, docs, reveal = true, required = false, autocomplete = 'new-password' }) {
  const control = `<input${attrs({ id, type: 'password', value, placeholder, autocomplete, required })}${base({ id, hint, warn, danger, docs, required })}>${reveal ? `<button type="button" class="field-reveal" data-reveal-for="${esc(id)}" aria-label="显示或隐藏内容">显示</button>` : ''}`;
  return fieldShell({ id, label, required, control, hint, warn, danger, docs });
}

export function textareaField({ id, label, value = '', placeholder, hint, warn, danger, docs, rows = 4, maxlength, counter = false, mono = false, required = false, autosize = false, readonly = false, disabled = false, spellcheck = true, className = '' }) {
  const counterHtml = counter
    ? `<span class="field-counter" data-counter-for="${esc(id)}" data-max="${esc(String(maxlength ?? ''))}">${esc(String(value ?? '').length)}${maxlength ? ` / ${esc(String(maxlength))}` : ''}</span>`
    : '';
  const control = `<textarea${attrs({ id, rows, placeholder, maxlength, required, readonly, disabled, spellcheck: spellcheck ? null : 'false', class: [mono ? 'field-textarea-mono' : '', className].filter(Boolean).join(' ') || null })}${base({ id, hint, warn, danger, docs, required })}>${esc(value ?? '')}</textarea>${counterHtml}`;
  void autosize;
  // 多行控件很高：标签要贴顶，不能垂直居中（否则标签飘在文本域中间）。
  return fieldShell({ id, label, required, control, hint, warn, danger, docs, className: ['field-block--textarea', className].filter(Boolean).join(' ') });
}

export function selectField({ id, label, options = [], value, placeholder, hint, warn, danger, docs, disabled = false, required = false }) {
  const render = (option) => (option.group
    ? `<optgroup label="${esc(option.group)}">${option.options.map(render).join('')}</optgroup>`
    : `<option value="${esc(option.value)}"${String(option.value) === String(value ?? '') ? ' selected' : ''}>${esc(option.label)}</option>`);
  const head = placeholder ? `<option value=""${has(value) ? '' : ' selected'}>${esc(placeholder)}</option>` : '';
  const control = `<select${attrs({ id, disabled, required })}${base({ id, hint, warn, danger, docs, required })}>${head}${options.map(render).join('')}</select>`;
  return fieldShell({ id, label, required, control, hint, warn, danger, docs });
}

export function radioGroup({ id, label, options = [], value, inline = true, cards = false, hint, warn, danger, docs, required = false, disabled = false }) {
  const name = id;
  const items = options.map((option) => {
    const checked = String(option.value) === String(value ?? '');
    if (cards) {
      return `<label class="field-card"><input${attrs({ type: 'radio', name, value: option.value, 'data-field': id, checked: checked || null, disabled })}><span class="field-card-title">${esc(option.label)}</span>${option.desc ? `<span class="field-card-desc">${esc(option.desc)}</span>` : ''}</label>`;
    }
    return `<label><input${attrs({ type: 'radio', name, value: option.value, 'data-field': id, checked: checked || null, disabled })}>${esc(option.label)}</label>`;
  }).join('');
  const cls = cards ? 'field-cards' : `field-inline${inline ? '' : ' field-inline-cols'}`;
  const control = `<div class="${cls}" role="radiogroup" aria-label="${esc(label)}">${items}</div>`;
  // 走统一的 fieldShell（148px 标签列 + 行内控件），不再用老的 .field 竖排结构：
  // 老结构没有 .field-block/.field-row，混在表单里会「标签在上、控件在下」，边距也和别的行对不齐。
  return fieldShell({ id, label, required, control, hint, warn, danger, docs, labelFor: '' });
}

export function checkboxGroup({ id, label, options = [], value = [], inline = true, columns, hint, warn, danger, docs, selectAll = false, required = false, disabled = false }) {
  const picked = new Set((value ?? []).map(String));
  const items = options.map((option) => `<label><input${attrs({ type: 'checkbox', name: id, value: option.value, 'data-field': id, checked: picked.has(String(option.value)) || null, disabled })}>${esc(option.label)}</label>`).join('');
  const style = columns ? ` data-columns="${Number(columns) || 2}"` : '';
  const cls = inline ? 'field-inline' : 'field-inline-cols';
  const control = `<div class="${cls}" role="group" aria-label="${esc(label)}"${style}>${items}</div>${selectAll ? `<label class="field-hint"><input type="checkbox" data-check-all="${esc(id)}"> 全选</label>` : ''}`;
  // 与 radioGroup 同理：统一走 fieldShell，别再回到「标签在上」的老 .field 结构。
  return fieldShell({ id, label, required, control, hint, warn, danger, docs, labelFor: '' });
}

export function checkboxField({ id, label, checked = false, hint, warn, danger, docs, disabled = false }) {
  const control = `<input${attrs({ id, type: 'checkbox', 'data-field': id, checked: checked || null, disabled })}>`;
  const notes = fieldNotes(id, { hint, warn, danger, docs });
  return `<div class="field" data-field-wrap="${esc(id)}">
  <div class="field-control">${control}</div>
  ${notes.html}
  <p class="field-error" id="${esc(id)}-error" role="alert" hidden></p>
</div>`;
}

export function switchField({ id, label, checked = false, onLabel = '开', offLabel = '关', hint, warn, danger, docs, disabled = false }) {
  const control = `<button type="button" class="field-switch" role="switch" id="${esc(id)}" data-field="${esc(id)}" data-on-label="${esc(onLabel)}" data-off-label="${esc(offLabel)}" aria-checked="${checked ? 'true' : 'false'}"${disabled ? ' disabled' : ''}><span class="field-switch-track" aria-hidden="true"></span><span>${esc(checked ? onLabel : offLabel)}</span></button>`;
  const shell = `<div class="field-block field-block--switch" data-field-wrap="${esc(id)}">
  <div class="field-row">
    <span class="field-label" id="${esc(id)}-label">${esc(label)}</span>
    <div class="field-control">${control}</div>
  </div>
  <div class="field-notes">${fieldNotes(id, { hint, warn, danger, docs }).html}<p class="field-error" id="${esc(id)}-error" role="alert" hidden></p></div>
</div>`;
  return shell;
}

/* 开关（switch 字段）渲染成 <button role="switch">，状态在 aria-checked 上，不在 .checked。
   页面如果没走 createForm，就必须用下面三个函数读写，否则会像 scheduler 那样：
   赋值 .checked 只加了个普通属性（视觉不变），读回来是 undefined（保存时把开关写坏）。 */
export function getSwitch(el) {
  if (!el) return false;
  return el.tagName === 'BUTTON' ? el.getAttribute('aria-checked') === 'true' : Boolean(el.checked);
}

export function setSwitch(el, on) {
  if (!el) return false;
  const value = Boolean(on);
  if (el.tagName !== 'BUTTON') { el.checked = value; return value; }
  el.setAttribute('aria-checked', value ? 'true' : 'false');
  const text = el.querySelector('span:last-child');
  if (text) text.textContent = value ? (el.dataset.onLabel ?? '开') : (el.dataset.offLabel ?? '关');
  return value;
}

/** 给一段 DOM 装上开关的点击委托（toggle + 文案）。返回解绑函数。 */
export function bindSwitches(root) {
  if (!root) return () => {};
  const handler = (event) => {
    const button = event.target.closest?.('[role="switch"][data-field]');
    if (!button || !root.contains(button) || button.disabled) return;
    event.preventDefault();
    setSwitch(button, !getSwitch(button));
  };
  root.addEventListener('click', handler);
  return () => root.removeEventListener('click', handler);
}

export function fileField({ id, label, accept, hint, warn, danger, docs, maxBytes, required = false }) {  const control = `<input${attrs({ id, type: 'file', accept, required })}${base({ id, hint, warn, danger, docs, required })}>`;
  const extra = maxBytes ? `<p class="field-hint" id="${esc(id)}-max">单个文件最大 ${esc(String(Math.round(maxBytes / 1024)))} KB</p>` : '';
  return fieldShell({ id, label, required, control, hint, warn, danger, docs, hintExtra: extra });
}

export function dateField({ id, label, value = '', min, max, hint, warn, danger, docs, quick = false, required = false }) {
  const control = `<input${attrs({ id, type: 'date', value, min, max, required })}${base({ id, hint, warn, danger, docs, required })}>${quick ? `<span class="field-inline" data-quick-for="${esc(id)}"><button type="button" class="field-reveal" data-quick="today">今天</button><button type="button" class="field-reveal" data-quick="tomorrow">明天</button><button type="button" class="field-reveal" data-quick="+7">+7 天</button></span>` : ''}`;
  return fieldShell({ id, label, required, control, hint: hint ?? '按北京时间', warn, danger, docs });
}

export function timeField({ id, label, value = '', min, max, step = 60, hint, warn, danger, docs, quick = false, required = false }) {
  const control = `<input${attrs({ id, type: 'time', value, min, max, step, required })}${base({ id, hint, warn, danger, docs, required })}>${quick ? `<span class="field-inline" data-quick-for="${esc(id)}"><button type="button" class="field-reveal" data-quick="now">现在</button><button type="button" class="field-reveal" data-quick="00:00">00:00</button><button type="button" class="field-reveal" data-quick="22:00">22:00</button></span>` : ''}`;
  return fieldShell({ id, label, required, control, hint: hint ?? '按北京时间，精确到分钟', warn, danger, docs });
}

export function datetimeField({ id, label, value = '', min, max, hint, warn, danger, docs, required = false }) {
  const control = `<input${attrs({ id, type: 'datetime-local', value, min, max, required })}${base({ id, hint, warn, danger, docs, required })}>`;
  return fieldShell({ id, label, required, control, hint: hint ?? '按北京时间', warn, danger, docs });
}

export function timeRangeField({ id, label, from = '', to = '', hint, warn, danger, docs, allowEqual = true, overnight = true, required = false }) {
  const control = `<input${attrs({ id: `${id}From`, type: 'time', value: from, step: 60, required })}${base({ id, hint, warn, danger, docs, required })} data-part="from">
    <span class="field-unit">到</span>
    <input${attrs({ id: `${id}To`, type: 'time', value: to, step: 60, required })} data-field="${esc(id)}" data-part="to">`;
  const note = hint ?? `按北京时间${overnight ? '；结束早于开始表示跨到次日' : ''}${allowEqual ? '' : '；结束必须晚于开始'}`;
  return fieldShell({ id, label, required, control, hint: note, warn, danger, docs });
}

export function readonlyField({ id, label, value = '', hint, warn, danger, docs, copy = true }) {
  const control = `<span class="field-readonly"><code id="${esc(id)}-value">${esc(String(value ?? ''))}</code>${copy ? `<button type="button" class="field-reveal" data-copy-from="${esc(id)}-value">复制</button>` : ''}</span>`;
  const shell = `<div class="field" data-field-wrap="${esc(id)}">
  <span class="field-label" id="${esc(id)}-label">${esc(label)}</span>
  <div class="field-control">${control}</div>
  ${fieldNotes(id, { hint, warn, danger, docs }).html}
</div>`;
  return shell;
}

/**
 * 自定义控件槽：外壳（标签列、行高、注解、错误行）仍由表单给，只有控件内容由页面决定。
 * 用于「输入框 + 开关 + 按钮 + 说明」这类复合控件（语音库、会话 key 组），
 * 让它们不必退回手写 `.row` 而破坏对齐。槽里的元素不参与 createForm 的取值。
 */
export function customField({ id, label, html = '', hint, warn, danger, docs, className = '' }) {
  return fieldShell({
    id,
    label,
    control: `<div class="field-custom" data-custom="${esc(id)}">${html}</div>`,
    hint,
    warn,
    danger,
    docs,
    className: ['field-block--custom', className].filter(Boolean).join(' '),
    labelFor: '',
  });
}

/**
 * 复选清单：一列可勾选的条目（工具开关、能力清单），值是一组字符串。
 * 每项都带 data-field=id，createForm 视为数组字段（规则里写 type:'array'）。
 */
export function checkListField({ id, label, options = [], value = [], columns = 2, hint, warn, danger, docs }) {
  const picked = new Set((Array.isArray(value) ? value : []).map(String));
  const items = options.map((option) => `<label class="field-check-item">
    <input type="checkbox"${attrs({ name: id, value: option.value, checked: picked.has(String(option.value)) || null, 'data-field': id })}>
    <span><b>${esc(option.label)}</b>${option.desc ? `<span class="field-check-desc">${esc(option.desc)}</span>` : ''}</span>
  </label>`).join('');
  return fieldShell({
    id,
    label,
    control: `<div class="field-checklist" id="${esc(id)}" data-columns="${esc(String(columns))}">${items}</div>`,
    hint,
    warn,
    danger,
    docs,
    className: 'field-block--checklist',
    labelFor: '',
  });
}

/** 可勾选的表格：一行一个条目，三列（启用 / 名称 / 说明）。
 *  复用 components/table 的 dataTableHtml（工具栏 + 表体 + 分页都在组件里），
 *  这里只把每个单元格拼成「复选框 / 名称 / 说明」，不再自带一套表格样式。
 *  `search`/`refresh`/`pageSize` 透传给 dataTableHtml；分页只隐藏行，勾选值随表单一起读。 */
export function checkTableField({
  id,
  label,
  options = [],
  value = [],
  hint,
  warn,
  danger,
  docs,
  nameHeader = '名称',
  descHeader = '说明',
  search = null,
  refresh = false,
  pageSize = 20,
}) {
  const picked = new Set((Array.isArray(value) ? value : []).map(String));
  const columns = [
    { label: '启用', width: '80px' },
    { label: nameHeader, width: '220px' },
    { label: descHeader },
  ];
  const rows = options.map((option) => [
    `<input type="checkbox"${attrs({ name: id, value: option.value, checked: picked.has(String(option.value)) || null, 'data-field': id, 'aria-label': option.label })}>`,
    `<b>${esc(option.label)}</b>`,
    esc(option.desc ?? ''),
  ]);
  const table = `<div id="${esc(id)}">${dataTableHtml({
    columns,
    rows,
    pageSize,
    search,
    refresh,
    empty: '没有匹配的工具。',
  })}</div>`;
  return fieldShell({ id, label, control: table, hint, warn, danger, docs, className: 'field-block--table', labelFor: '' });
}

/** 状态徽标：圆点 + 文字（默认）/ 药丸（pill）。页面状态文案统一用它，不要用裸 .meta。 */
export function statusBadge({ id = '', text = '', tone = '', pill = true, dot = true }) {
  const cls = ['status-badge', pill ? 'is-pill' : '', tone, dot ? '' : 'no-dot'].filter(Boolean).join(' ');
  return `<span class="${cls}"${id ? ` id="${esc(id)}"` : ''} role="status">${esc(text)}</span>`;
}

/** 行内动作条：按钮组 + 右侧（或紧随）状态位，用于「加载 / 清空 / 提示」这类工具行。
 *  每个 item 可以自带 status/statusText，用于「多个按钮各带一个状态位」的场景。 */
export function inlineActions({ items = [], status = '', statusText = '', className = '' }) {
  const parts = [];
  for (const item of items) {
    // 默认「标准」40px（与输入框同高）；只有明确写 small:true 的紧凑行（卡片头、表格行）才降一档。
    // 同一行动作条里不要混用两档——高度不一致看起来像没对齐（2026-11-07 修过）。
    const cls = ['btn', item.variant === 'danger' ? 'danger' : '', item.variant === 'primary' ? 'primary' : '', item.small === true ? 'small' : '', item.className ?? ''].filter(Boolean).join(' ');
    parts.push(`<button type="button"${item.id ? ` id="${esc(item.id)}"` : ''}${cls ? ` class="${esc(cls)}"` : ''}>${esc(item.label)}</button>`);
    if (item.status) parts.push(`<span class="form-actions-status" id="${esc(item.status)}">${esc(item.statusText ?? '')}</span>`);
  }
  const statusHtml = status ? `<span class="form-actions-status" id="${esc(status)}">${esc(statusText)}</span>` : '';
  return `<div class="form-actions form-actions--inline${className ? ` ${esc(className)}` : ''}">${parts.join('')}${statusHtml}</div>`;
}

export function formActions({ primary = '保存', secondary = [], sticky = false, meta = '' }) {
  const buttons = [
    ...secondary.map((item) => `<button type="button" class="btn" data-action="${esc(item.action ?? item.label)}">${esc(item.label)}</button>`),
    `<button type="submit" class="btn primary" data-action="submit">${esc(primary)}</button>`,
  ];
  return `<div class="form-actions${sticky ? ' form-actions-sticky' : ''}">${meta ? `<p class="meta">${esc(meta)}</p>` : ''}${buttons.join('')}</div>`;
}

export function formCallout({ tone = 'info', title = '', body = '' }) {
  return `<div class="form-callout" data-tone="${esc(tone)}"${tone === 'danger' ? ' role="alert"' : ''}>${title ? `<strong>${esc(title)}</strong>` : ''}${body ? `<span>${esc(body)}</span>` : ''}</div>`;
}

const FIELD_FACTORIES = {
  text: textField,
  number: numberField,
  password: passwordField,
  textarea: textareaField,
  select: selectField,
  radio: radioGroup,
  checkboxGroup,
  checkbox: checkboxField,
  switch: switchField,
  file: fileField,
  date: dateField,
  time: timeField,
  datetime: datetimeField,
  timeRange: timeRangeField,
  readonly: readonlyField,
  custom: customField,
  checkList: checkListField,
  checkTable: checkTableField,
};

/**
 * 规格渲染：把「字段数据」铺成统一的表单 HTML，再交给 createForm 接管。
 * 见 docs/CONSOLE_FORMS.md §4。spec 里每一项是工厂参数 + `name`（即控件 id）；
 * `type: 'section'` 开一个新分组，`type: 'callout'` / `'actions'` / `'action'` / `'status'` 直接插入对应块。
 * `span` 表示占几列（默认 1；等于 columns 时整行）。
 * options.layout = 'grid'（默认，铺 .cols 栅格）| 'inline'（不铺栅格，字段直接排在父级 flex 行里，用于工具栏条）。
 */
export function renderFields(host, spec, options = {}) {
  if (!host) throw new Error('renderFields: 缺少容器');
  const columns = Math.max(1, Math.min(4, Number(options.columns) || 2));
  const inlineLayout = options.layout === 'inline';
  const items = Array.isArray(spec) ? spec : [];
  const out = [];
  let inSection = false;
  let sectionClose = '</fieldset>';
  let gridOpen = false;
  let count = 0;
  const openGrid = () => { if (!inlineLayout && !gridOpen) { out.push('<div class="cols form-cols">'); gridOpen = true; } };
  const closeGrid = () => { if (gridOpen) { out.push('</div>'); gridOpen = false; } };
  const closeSection = () => {
    if (!inSection) return;
    closeGrid();
    out.push(sectionClose);
    inSection = false;
  };
  const spanClass = (span) => {
    if (span >= columns) return 'col-12';
    // 两列在 md（900）就分开，三/四列留到 lg（1180），窄屏一律整行。
    const breakpoint = columns <= 2 ? 'md' : 'lg';
    return `col-12 col-${breakpoint}-${Math.round((12 * span) / columns)}`;
  };
  for (const raw of items) {
    const item = raw ?? {};
    if (item.type === 'section') {
      closeSection();
      // 分组必须落在栅格外面：若前面已有字段，先关掉 .form-cols，
      // 否则 fieldset 会被塞进栅格当列，整套 section 变成一列窄条。
      closeGrid();
      if (item.card === true && item.collapsed === true) {
        // 默认收起的卡片：复用全局的 .card.is-group + details.settings-group（social-v2 / 插件页同一套），
        // 不在这里另写折叠样式；.span-all 让它和其它 section 一样占满整行栅格。
        out.push(`<section class="card is-group span-all"><details class="settings-group" data-default-open="closed"><summary>${esc(item.label ?? '')}</summary><div class="settings-content">${item.hint ? `<p class="form-section-hint">${esc(item.hint)}</p>` : ''}`);
        sectionClose = '</div></details></section>';
      } else if (item.card === true) {
        out.push(`<section class="form-section form-section--card"><div class="form-section-head"><h3>${esc(item.label ?? '')}</h3></div>${item.hint ? `<p class="form-section-hint">${esc(item.hint)}</p>` : ''}`);
        sectionClose = '</section>';
      } else {
        out.push(`<fieldset class="form-section"><legend>${esc(item.label ?? '')}</legend>${item.hint ? `<p class="form-section-hint">${esc(item.hint)}</p>` : ''}`);
        sectionClose = '</fieldset>';
      }
      inSection = true;
      openGrid();
      continue;
    }
    if (item.type === 'callout') {
      closeGrid();
      out.push(formCallout(item));
      continue;
    }
    if (item.type === 'actions') {
      closeGrid();
      out.push(formActions(item));
      continue;
    }
    // 行内动作条与状态位不是字段：只排版，不参与取值。
    if (item.type === 'action') {
      closeGrid();
      const html = inlineActions(item);
      out.push(inlineLayout ? html : `<div class="col-12">${html}</div>`);
      continue;
    }
    if (item.type === 'status') {
      const html = statusBadge({ id: item.name, text: item.text, tone: item.tone, pill: item.pill !== false, dot: item.dot !== false });
      if (inlineLayout) { out.push(html); continue; }
      closeGrid();
      out.push(`<div class="col-12">${html}</div>`);
      continue;
    }
    if (!item.name) throw new Error('renderFields: 字段缺少 name');
    const factory = FIELD_FACTORIES[item.type];
    if (!factory) throw new Error(`renderFields: 未知字段类型 ${item.type}`);
    const span = Math.max(1, Math.min(columns, Number(item.span) || 1));
    const colClass = spanClass(span);
    const { name, span: _span, ...props } = item;
    openGrid();
    const html = factory({ ...props, id: name });
    out.push(inlineLayout ? html : `<div class="${colClass}">${html}</div>`);
    count += 1;
  }
  closeSection();
  closeGrid();
  host.innerHTML = out.join('');
  return count;
}

/* ---------------------------------------------------------------- 内核 */

const DEFAULT_MESSAGES = {
  required: '不能为空',
  integer: '必须是整数',
  number: '必须是数字',
  min: (rule) => `不能小于 ${rule.min}`,
  max: (rule) => `不能大于 ${rule.max}`,
  minItems: (rule) => `最多 ${rule.maxItems} 项`,
  minLength: (rule) => `至少 ${rule.minLength} 个字符`,
  maxLength: (rule) => `最多 ${rule.maxLength} 个字符`,
  pattern: '格式不正确',
  time: '时间格式应为 HH:mm',
  date: '日期格式应为 YYYY-MM-DD',
  greaterThan: (rule) => `必须晚于「${rule.label ?? rule.greaterThan}」`,
  lessThan: (rule) => `必须早于「${rule.label ?? rule.lessThan}」`,
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toMinutes(value) {
  if (!TIME_RE.test(String(value ?? ''))) return null;
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}

/**
 * 表单内核：取值类型化、字段与跨字段校验、条件显示、提交态、脏值。
 * 见 docs/CONSOLE_FORMS.md §3。
 */
export function createForm(root, options = {}) {
  if (!root) throw new Error('createForm: 缺少根节点');
  const { rules = {}, depends = {}, onSubmit } = options;
  const wraps = () => [...root.querySelectorAll('[data-field-wrap]')];
  const wrapOf = (name) => root.querySelector(`[data-field-wrap="${cssEscape(name)}"]`);
  const control = (name) => [...root.querySelectorAll(`[data-field="${cssEscape(name)}"]`)];
  const listeners = new Set();
  let initial = null;
  let busy = false;

  const isVisible = (name) => {
    const wrap = wrapOf(name);
    return Boolean(wrap) && !wrap.hidden;
  };

  function readOne(name, element) {
    const rule = rules[name] ?? {};
    const type = rule.type ?? inferType(element);
    if (element.tagName === 'BUTTON') return getSwitch(element);
    if (type === 'array') {
      return control(name).filter((input) => input.type === 'checkbox' && input.checked).map((input) => input.value);
    }
    if (type === 'boolean') return Boolean(element.checked);
    if (type === 'integer') return element.value === '' ? null : Number.parseInt(element.value, 10);
    if (type === 'number') return element.value === '' ? null : Number(element.value);
    if (type === 'time' || type === 'date') return element.value ? element.value : null;
    return element.value;
  }

  function inferType(element) {
    if (!element) return 'string';
    if (element.tagName === 'BUTTON') return 'boolean';
    if (element.type === 'checkbox') return element.dataset.checkAll ? 'string' : 'boolean';
    if (element.type === 'radio') return 'string';
    if (element.type === 'number') return 'number';
    return 'string';
  }

  function readField(name) {
    const rule = rules[name] ?? {};
    const list = control(name);
    // 多选清单（工具开关这类），值是「被勾选的全部 value」。必须先判，
    // 否则只会读到第一个 checkbox 的布尔值。规则里不必写 type:'array'。
    if (list.length > 1 && list[0].type === 'checkbox') {
      return list.filter((input) => input.checked).map((input) => input.value);
    }
    if (rule.type === 'timeRange' || rule.type === 'array') {
      if (rule.type === 'array') return readOne(name, control(name)[0]);
      const fromEl = control(name).find((input) => input.dataset.part === 'from');
      const toEl = control(name).find((input) => input.dataset.part === 'to');
      return { from: fromEl?.value || null, to: toEl?.value || null };
    }
    const element = control(name)[0];
    if (!element) return undefined;
    // 单选组：值来自被选中的那个，而不是 DOM 里第一个 radio
    if (element.type === 'radio') {
      const picked = control(name).find((input) => input.checked);
      return picked ? picked.value : null;
    }
    return readOne(name, element);
  }

  function getValues() {
    const values = {};
    for (const name of Object.keys(rules)) {
      if (!isVisible(name)) continue;
      const value = readField(name);
      if (value !== undefined) values[name] = value;
    }
    // 没有规则但存在的字段也一并带上，避免「表单里有的但没配规则」时丢值。
    for (const wrap of wraps()) {
      const name = wrap.dataset.fieldWrap;
      if (name in values) continue;
      const value = readField(name);
      if (value !== undefined) values[name] = value;
    }
    return values;
  }

  function setValues(partial = {}) {
    for (const [name, value] of Object.entries(partial)) {
      const rule = rules[name] ?? {};
      if (rule.type === 'timeRange' && value && typeof value === 'object') {
        const fromEl = control(name).find((input) => input.dataset.part === 'from');
        const toEl = control(name).find((input) => input.dataset.part === 'to');
        if (fromEl) fromEl.value = value.from ?? '';
        if (toEl) toEl.value = value.to ?? '';
        continue;
      }
      const list = control(name);
      if (!list.length) continue;
      const first = list[0];
      if (rule.type === 'array' || (first.type === 'checkbox' && list.length > 1)) {
        const picked = new Set((Array.isArray(value) ? value : []).map(String));
        for (const input of list) input.checked = picked.has(String(input.value));
        continue;
      }
      if (first.tagName === 'BUTTON') {
        setSwitch(first, value);
        continue;
      }
      if (first.type === 'checkbox') {
        first.checked = Boolean(value);
        continue;
      }
      if (first.type === 'radio') {
        for (const input of list) input.checked = String(input.value) === String(value ?? '');
        continue;
      }
      first.value = value ?? '';
      updateCounter(first);
    }
    applyDepends();
  }

  function updateCounter(element) {
    const counter = root.querySelector(`[data-counter-for="${cssEscape(element.id)}"]`);
    if (!counter) return;
    const max = counter.dataset.max;
    counter.textContent = max ? `${element.value.length} / ${max}` : String(element.value.length);
    counter.dataset.over = max && element.value.length > Number(max) ? 'true' : 'false';
  }

  function applyDepends() {
    for (const [name, condition] of Object.entries(depends)) {
      const wrap = wrapOf(name);
      if (!wrap) continue;
      const source = condition.on;
      const current = readField(source);
      let visible = true;
      if ('equals' in condition) visible = String(current) === String(condition.equals);
      else if ('in' in condition) visible = (condition.in ?? []).map(String).includes(String(current));
      else if ('notEquals' in condition) visible = String(current) !== String(condition.notEquals);
      else if ('truthy' in condition) visible = Boolean(current);
      wrap.hidden = !visible;
    }
  }

  function clearError(name) {
    const error = root.querySelector(`#${cssEscape(name)}-error`);
    if (!error) return;
    error.hidden = true;
    error.textContent = '';
    for (const input of control(name)) input.removeAttribute('aria-invalid');
  }

  function writeError(name, message) {
    const error = root.querySelector(`#${cssEscape(name)}-error`);
    if (error) {
      error.hidden = false;
      error.textContent = message;
    }
    for (const input of control(name)) input.setAttribute('aria-invalid', 'true');
  }

  function validateField(name) {
    const rule = rules[name] ?? {};
    if (!isVisible(name)) return null;
    const value = readField(name);
    const empty = value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0) || (rule.type === 'timeRange' && !value?.from && !value?.to);
    if (empty) {
      if (rule.required) return rule.message ?? DEFAULT_MESSAGES.required;
      return null;
    }
    if (rule.type === 'integer' && !Number.isInteger(Number(value))) return rule.message ?? DEFAULT_MESSAGES.integer;
    if (rule.type === 'number' && Number.isNaN(Number(value))) return rule.message ?? DEFAULT_MESSAGES.number;
    if (rule.min !== undefined && Number(value) < Number(rule.min)) return rule.message ?? DEFAULT_MESSAGES.min(rule);
    if (rule.max !== undefined && Number(value) > Number(rule.max)) return rule.message ?? DEFAULT_MESSAGES.max(rule);
    if (rule.type === 'time' && !TIME_RE.test(String(value))) return rule.message ?? DEFAULT_MESSAGES.time;
    if (rule.type === 'date' && !DATE_RE.test(String(value))) return rule.message ?? DEFAULT_MESSAGES.date;
    if (rule.type === 'array' && rule.maxItems !== undefined && value.length > rule.maxItems) return rule.message ?? DEFAULT_MESSAGES.minItems(rule);
    if (rule.minLength !== undefined && String(value).length < rule.minLength) return rule.message ?? DEFAULT_MESSAGES.minLength(rule);
    if (rule.maxLength !== undefined && String(value).length > rule.maxLength) return rule.message ?? DEFAULT_MESSAGES.maxLength(rule);
    if (rule.pattern && !(rule.pattern instanceof RegExp ? rule.pattern : new RegExp(rule.pattern)).test(String(value))) return rule.message ?? DEFAULT_MESSAGES.pattern;
    if (rule.lessThan) {
      const other = readField(rule.lessThan);
      if (other != null && String(value) >= String(other)) return rule.message ?? DEFAULT_MESSAGES.lessThan(rule);
    }
    if (rule.greaterThan) {
      const other = readField(rule.greaterThan);
      if (other != null && String(value) <= String(other)) return rule.message ?? DEFAULT_MESSAGES.greaterThan(rule);
    }
    if (rule.type === 'timeRange' && value.from && value.to) {
      const from = toMinutes(value.from);
      const to = toMinutes(value.to);
      if (from !== null && to !== null) {
        const overnight = rule.allowOvernight !== false;
        if (!overnight && to <= from) return rule.message ?? '结束时间必须晚于开始时间';
        if (rule.allowEqual === false && to === from) return rule.message ?? '开始与结束不能相同';
      }
    }
    return null;
  }

  function validate() {
    const errors = {};
    for (const name of Object.keys(rules)) {
      const message = validateField(name);
      if (message) {
        errors[name] = message;
        writeError(name, message);
      } else clearError(name);
    }
    const first = Object.keys(errors)[0];
    if (first) {
      const input = control(first)[0];
      input?.focus?.();
      input?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }
    return { ok: !first, errors };
  }

  function setErrors(errors = {}) {
    for (const [name, message] of Object.entries(errors)) writeError(name, message);
  }

  function snapshot() {
    return JSON.stringify(getValues());
  }

  function dirty() {
    if (initial === null) initial = snapshot();
    return snapshot() !== initial;
  }

  function reset() {
    if (initial === null) initial = snapshot();
    setValues(JSON.parse(initial));
    for (const name of Object.keys(rules)) clearError(name);
    initial = snapshot();
  }

  function emit(name) {
    const payload = { name, value: readField(name), values: getValues() };
    for (const handler of listeners) handler(payload);
  }

  function toggleSwitch(button) {
    setSwitch(button, !getSwitch(button));
    emit(button.dataset.field);
  }

  function onClick(event) {
    const reveal = event.target.closest('[data-reveal-for]');
    if (reveal) {
      const input = root.querySelector(`#${cssEscape(reveal.dataset.revealFor)}`);
      if (input) {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        reveal.textContent = show ? '隐藏' : '显示';
      }
      return;
    }
    const copy = event.target.closest('[data-copy-from]');
    if (copy) {
      const source = root.querySelector(`#${cssEscape(copy.dataset.copyFrom)}`);
      if (source) navigator.clipboard?.writeText(source.textContent ?? '');
      return;
    }
    const quick = event.target.closest('[data-quick]');
    if (quick) {
      const holder = quick.closest('[data-quick-for]');
      const input = holder ? root.querySelector(`#${cssEscape(holder.dataset.quickFor)}`) : null;
      if (!input) return;
      const today = new Date();
      const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      if (quick.dataset.quick === 'today') input.value = iso(today);
      else if (quick.dataset.quick === 'tomorrow') input.value = iso(new Date(today.getTime() + 86400000));
      else if (quick.dataset.quick === '+7') input.value = iso(new Date(today.getTime() + 7 * 86400000));
      else if (quick.dataset.quick === 'now') input.value = `${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`;
      else input.value = quick.dataset.quick;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const toggle = event.target.closest('[role="switch"][data-field]');
    if (toggle && !toggle.disabled) {
      toggleSwitch(toggle);
      return;
    }
    const all = event.target.closest('[data-check-all]');
    if (all) {
      const name = all.dataset.checkAll;
      for (const input of control(name)) if (input.type === 'checkbox') input.checked = all.checked;
      emit(name);
    }
  }

  function onInput(event) {
    const target = event.target;
    if (target.matches('[data-field]')) {
      if (target.type !== 'checkbox' && target.type !== 'radio') updateCounter(target);
      emit(target.dataset.field);
      applyDepends();
    }
  }

  function onBlur(event) {
    const target = event.target;
    if (!target.matches?.('[data-field]')) return;
    const name = target.dataset.field;
    if (!(name in rules)) return;
    const message = validateField(name);
    if (message) writeError(name, message);
    else clearError(name);
  }

  function onKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const toggle = event.target.closest?.('[role="switch"][data-field]');
    if (!toggle) return;
    event.preventDefault();
    toggleSwitch(toggle);
  }

  async function onSubmitEvent(event) {
    event.preventDefault();
    if (busy) return;
    const { ok } = validate();
    if (!ok) return;
    if (!onSubmit) return;
    const button = root.querySelector('[data-action="submit"]');
    busy = true;
    if (button) {
      button.dataset.label = button.textContent;
      button.textContent = '保存中…';
      button.setAttribute('aria-busy', 'true');
    }
    try {
      await onSubmit(getValues(), { form: api, event });
      initial = snapshot();
    } finally {
      busy = false;
      if (button) {
        button.textContent = button.dataset.label ?? '保存';
        button.removeAttribute('aria-busy');
      }
    }
  }

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);
  root.addEventListener('focusout', onBlur);
  root.addEventListener('keydown', onKeydown);
  root.addEventListener('submit', onSubmitEvent);

  applyDepends();
  initial = snapshot();

  const api = {
    getValues,
    getValue: (name) => readField(name),
    setValues,
    validate,
    setErrors,
    dirty,
    reset,
    on(event, handler) {
      if (event === 'change') listeners.add(handler);
      return () => listeners.delete(handler);
    },
    destroy() {
      root.removeEventListener('click', onClick);
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onInput);
      root.removeEventListener('focusout', onBlur);
      root.removeEventListener('keydown', onKeydown);
      root.removeEventListener('submit', onSubmitEvent);
      listeners.clear();
    },
  };
  return api;
}

/* ---------------------------------------------------------------- 就地增强 */

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}
