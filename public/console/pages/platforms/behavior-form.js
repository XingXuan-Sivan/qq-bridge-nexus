// 行为档案表单：字段规格由后端类型注册表下发（GET /api/behaviors/kinds），渲染交给 components/form。
// 权威存储是 profiles/platforms/<平台>/behaviors/<id>.yml；后端 GET 返回结构化 data，PUT 收 {data}。
//
// 档案是「默认值 + 覆盖」的全量快照：表单每次读都把默认值填进控件，每次写都把全部字段写回，
// 存档里因此不会出现「没这个键」和「和默认值相同」两种含义不清的状态。
import { renderFields, setSwitch } from '../../components/form/form.js';

export function behaviorFields(fields) {
  return Array.isArray(fields) ? fields : [];
}

/** 字段名里的下划线段数 = 嵌套深度：`sticker_collect_enabled` → config.sticker.collect.enabled。 */
const segmentsOf = (name) => String(name ?? '').split('_').filter(Boolean);

function readPath(value, name) {
  return segmentsOf(name).reduce((node, key) => (node == null ? undefined : node[key]), value);
}

function writePath(target, name, value) {
  const parts = segmentsOf(name);
  let node = target;
  for (const key of parts.slice(0, -1)) {
    node[key] = node[key] ?? {};
    node = node[key];
  }
  node[parts[parts.length - 1]] = value;
}

export function fillBehaviorForm(host, fields, config = {}) {
  const values = {};
  for (const item of behaviorFields(fields)) {
    if (!item.name) continue;
    const value = item.name.includes('_') ? readPath(config, item.name) : config[item.name];
    if (item.type === 'textarea' && Array.isArray(value)) values[item.name] = value.join('\n');
    else if (value != null) values[item.name] = value;
    // 档案缺键时控件要显示真实生效值（引擎默认值），否则界面会把默认开着的开关画成关。
    else values[item.name] = item.default;
  }
  // 列宽充足时两列（form 组件的 md 断点自动折回单列）；字段多，单列会让整页过长。
  renderFields(host, behaviorFields(fields), { columns: 2 });
  for (const [name, value] of Object.entries(values)) {
    const el = host.querySelector(`#${CSS.escape(name)}`);
    if (!el) continue;
    // 开关的状态在 aria-checked 上、文案在最后一个 span 里，必须用 setSwitch 一起改。
    if (el.getAttribute('role') === 'switch') setSwitch(el, !!value);
    else if (el.type === 'checkbox') el.checked = !!value;
    else if (value === undefined || value === null) el.value = '';
    else el.value = Array.isArray(value) ? value.join('\n') : String(value);
  }
}

export function readBehaviorForm(host, fields) {
  const config = {};
  for (const item of behaviorFields(fields)) {
    if (!item.name) continue;
    const el = host.querySelector(`#${CSS.escape(item.name)}`);
    let value;
    if (item.type === 'switch') value = el?.getAttribute('aria-checked') === 'true';
    else if (el?.type === 'checkbox') value = !!el?.checked;
    else if (el?.type === 'number' || item.type === 'number') {
      // 空值 = 用默认值：全量快照没有「不写这个键」，控件清空就是回到默认。
      value = el?.value === '' ? item.default : Number(el?.value);
      if (!Number.isFinite(value)) value = item.default;
    } else if (item.list) value = String(el?.value ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    else value = el?.value ?? item.default ?? '';
    writePath(config, item.name, value);
  }
  return config;
}
