// 行为档案表单（v1 / v2）：字段规格由后端 kind 注册表下发（GET /api/behaviors/kinds），渲染交给 components/form。
// 权威存储仍是 config/behaviors/<id>.yml；后端 GET 返回结构化 data，PUT 收 {data}。
import { renderFields } from '../../components/form/form.js';

export function behaviorFields(fields) {
  return Array.isArray(fields) ? fields : [];
}

export function fillBehaviorForm(host, fields, config = {}) {
  const values = {};
  for (const item of behaviorFields(fields)) {
    if (!item.name) continue;
    const value = item.name.includes('_')
      ? item.name.split('_').reduce((node, key) => (node == null ? undefined : node[key]), config)
      : config[item.name];
    if (item.type === 'textarea' && Array.isArray(value)) values[item.name] = value.join('\n');
    else if (value != null) values[item.name] = value;
    else values[item.name] = item.type === 'switch' ? false : item.type === 'number' ? 0 : '';
  }
  // 列宽充足时两列（form 组件的 md 断点自动折回单列）；字段多，单列会让整页过长。
  renderFields(host, behaviorFields(fields), { columns: 2 });
  for (const [name, value] of Object.entries(values)) {
    const el = host.querySelector(`#${CSS.escape(name)}`);
    if (!el) continue;
    if (el.getAttribute('role') === 'switch') el.setAttribute('aria-checked', String(!!value));
    else if (el.type === 'checkbox') el.checked = !!value;
    else el.value = String(value);
  }
}

export function readBehaviorForm(host, fields) {
  const config = {};
  for (const item of behaviorFields(fields)) {
    if (!item.name) continue;
    const el = host.querySelector(`#${CSS.escape(item.name)}`);
    let value;
    if (item.type === 'switch' || el?.type === 'checkbox') value = el?.getAttribute('aria-checked') === 'true' || !!el?.checked;
    else if (el?.type === 'number' || item.type === 'number') value = el?.value === '' ? 0 : Number(el.value);
    else if (item.list) value = String(el?.value ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
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

