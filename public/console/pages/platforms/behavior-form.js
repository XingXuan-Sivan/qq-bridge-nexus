// 行为档案表单（v1 / v2）：字段规格由后端 kind 注册表下发（GET /api/behaviors/kinds），渲染交给 components/form。
// 权威存储是 profiles/platforms/<平台>/behaviors/<id>.yml；后端 GET 返回结构化 data，PUT 收 {data}。
import { renderFields, setSwitch } from '../../components/form/form.js';

export function behaviorFields(fields) {
  return Array.isArray(fields) ? fields : [];
}

export function fillBehaviorForm(host, fields, config = {}) {
  const values = {};
  const defaults = {};
  for (const item of behaviorFields(fields)) {
    if (!item.name) continue;
    const value = item.name.includes('_')
      ? item.name.split('_').reduce((node, key) => (node == null ? undefined : node[key]), config)
      : config[item.name];
    if (item.default !== undefined) defaults[item.name] = item.default;
    if (item.type === 'textarea' && Array.isArray(value)) values[item.name] = value.join('\n');
    else if (value != null) values[item.name] = value;
    // 开关只有开/关，没有「没写」这个状态：缺省必须落在真实生效值上，
    // 否则界面显示「关」而内核默认是「开」。
    else if (item.type === 'switch') values[item.name] = item.default ?? false;
    // 数字字段没写就是「没写」：留空，不要填 0。填 0 会在保存时把默认值覆盖成 0；
    // 实际生效的默认值放到 placeholder 里（见下方回填）。
    else values[item.name] = '';
  }
  // 列宽充足时两列（form 组件的 md 断点自动折回单列）；字段多，单列会让整页过长。
  renderFields(host, behaviorFields(fields), { columns: 2 });
  for (const [name, value] of Object.entries(values)) {
    const el = host.querySelector(`#${CSS.escape(name)}`);
    if (!el) continue;
    // 开关的状态在 aria-checked 上、文案在最后一个 span 里，必须用 setSwitch 一起改。
    if (el.getAttribute('role') === 'switch') setSwitch(el, !!value);
    else if (el.type === 'checkbox') el.checked = !!value;
    else if (value === '') {
      el.value = '';
      if (defaults[name] != null) el.placeholder = `默认 ${defaults[name]}`;
    } else el.value = String(value);
  }
}

export function readBehaviorForm(host, fields) {
  const config = {};
  for (const item of behaviorFields(fields)) {
    if (!item.name) continue;
    const el = host.querySelector(`#${CSS.escape(item.name)}`);
    let value;
    if (item.type === 'switch' || el?.type === 'checkbox') {
      if (item.type === 'switch') {
        value = el?.getAttribute('aria-checked') === 'true';
        // 与默认值相同就不写键：档案只记「与内核默认不同」的偏差，
        // 否则在这页保存一次，就会把所有没动过的开关固化成 false。
        if (item.default !== undefined && value === item.default) continue;
      } else value = !!el?.checked;
    }
    else if (el?.type === 'number' || item.type === 'number') {
      // 空值 = 不写这个键，交给运行时默认值（见 src/scheduling/policy.mjs）。
      if (el?.value === '') continue;
      value = Number(el.value);
      if (!Number.isFinite(value)) continue;
    } else if (item.list) value = String(el?.value ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    else value = el?.value ?? '';
    if (item.name.includes('_')) {
      const [group, key] = item.name.split('_');
      config[group] = config[group] ?? {};
      config[group][key] = value;
    } else {
      config[item.name] = value;
    }
  }
  return config;
}

