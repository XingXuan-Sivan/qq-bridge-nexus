// 插件配置 schema（plugin.json 的可选 configSchema）。
//
// 只支持控制台表单需要的那一小撮 JSON Schema：object + 标量属性 + 枚举 + 数组。
// 不引入完整 JSON Schema 依赖——插件清单是启动路径，宁可小而可预测，也不要半套校验。
const SUPPORTED_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array']);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function fail(errors, path, message) {
  errors.push(path ? `${path}: ${message}` : message);
}

function normalizeProperty(path, raw, errors) {
  if (!isPlainObject(raw)) {
    fail(errors, path, '必须是对象');
    return null;
  }
  const type = raw.type ?? (Array.isArray(raw.enum) ? 'enum' : 'string');
  if (type === 'enum') {
    if (!Array.isArray(raw.enum) || raw.enum.length === 0) {
      fail(errors, path, 'enum 必须是非空数组');
      return null;
    }
    if (!raw.enum.every((value) => ['string', 'number', 'boolean'].includes(typeof value))) {
      fail(errors, path, 'enum 只接受字符串/数字/布尔值');
      return null;
    }
  } else if (!SUPPORTED_TYPES.has(type)) {
    fail(errors, path, `不支持的 type "${String(type)}"`);
    return null;
  }
  const property = { type };
  if (typeof raw.title === 'string' && raw.title.trim()) property.title = raw.title.trim().slice(0, 80);
  if (typeof raw.description === 'string' && raw.description.trim()) property.description = raw.description.trim().slice(0, 300);
  if (raw.default !== undefined) {
    property.default = clone(raw.default);
  }
  if (raw.enum !== undefined) property.enum = raw.enum.map((value) => clone(value));
  if (raw.format === 'textarea') property.format = 'textarea';
  if (type === 'array') {
    if (raw.items === undefined) {
      fail(errors, path, 'array 必须声明 items');
      return null;
    }
    property.items = normalizeProperty(`${path}.items`, raw.items, errors);
    if (!property.items) return null;
    if (raw.minItems !== undefined) {
      if (!Number.isInteger(raw.minItems) || raw.minItems < 0) fail(errors, path, 'minItems 必须是非负整数');
      else property.minItems = raw.minItems;
    }
    if (raw.maxItems !== undefined) {
      if (!Number.isInteger(raw.maxItems) || raw.maxItems < 0) fail(errors, path, 'maxItems 必须是非负整数');
      else property.maxItems = raw.maxItems;
    }
  }
  for (const key of ['minimum', 'maximum']) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key])) fail(errors, path, `${key} 必须是数字`);
    else property[key] = raw[key];
  }
  for (const key of ['minLength', 'maxLength']) {
    if (raw[key] === undefined) continue;
    if (!Number.isInteger(raw[key]) || raw[key] < 0) fail(errors, path, `${key} 必须是非负整数`);
    else property[key] = raw[key];
  }
  if (property.minimum !== undefined && property.maximum !== undefined && property.minimum > property.maximum) {
    fail(errors, path, 'minimum 不能大于 maximum');
    return null;
  }
  return property;
}

/** 校验并规范化 configSchema；没有 schema 时返回 null（兼容旧插件）。 */
export function normalizeConfigSchema(raw) {
  if (raw === undefined || raw === null) return { ok: true, errors: [], schema: null };
  const errors = [];
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['configSchema 必须是对象'], schema: null };
  }
  if (raw.type !== 'object') errors.push('configSchema.type 只接受 object');
  if (!isPlainObject(raw.properties)) {
    errors.push('configSchema.properties 必须是对象');
    return { ok: false, errors, schema: null };
  }
  const properties = {};
  for (const [key, value] of Object.entries(raw.properties)) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(key)) {
      errors.push(`configSchema.properties.${key}: 字段名不合法`);
      continue;
    }
    const property = normalizeProperty(key, value, errors);
    if (property) properties[key] = property;
  }
  const required = raw.required === undefined ? [] : raw.required;
  if (!Array.isArray(required) || required.some((key) => typeof key !== 'string' || !key)) {
    errors.push('configSchema.required 必须是字符串数组');
  } else {
    for (const key of required) {
      if (!properties[key]) errors.push(`configSchema.required 引用了未声明字段 "${key}"`);
    }
  }
  if (raw.additionalProperties !== undefined && typeof raw.additionalProperties !== 'boolean') {
    errors.push('configSchema.additionalProperties 必须是布尔值');
  }
  if (errors.length) return { ok: false, errors, schema: null };
  return {
    ok: true,
    errors: [],
    schema: {
      type: 'object',
      properties,
      required: [...new Set(required)],
      additionalProperties: raw.additionalProperties !== false,
    },
  };
}

function checkValue(value, property, path, errors) {
  const type = property.type;
  if (type === 'enum') {
    if (!property.enum.some((candidate) => candidate === value)) {
      fail(errors, path, `只能是 ${property.enum.map((item) => JSON.stringify(item)).join(' / ')}`);
    }
    return;
  }
  if (type === 'string') {
    if (typeof value !== 'string') { fail(errors, path, '必须是字符串'); return; }
    if (property.minLength !== undefined && value.length < property.minLength) fail(errors, path, `至少 ${property.minLength} 个字符`);
    if (property.maxLength !== undefined && value.length > property.maxLength) fail(errors, path, `最多 ${property.maxLength} 个字符`);
    return;
  }
  if (type === 'boolean') {
    if (typeof value !== 'boolean') fail(errors, path, '必须是 true/false');
    return;
  }
  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) { fail(errors, path, '必须是数字'); return; }
    if (type === 'integer' && !Number.isInteger(value)) fail(errors, path, '必须是整数');
    if (property.minimum !== undefined && value < property.minimum) fail(errors, path, `不能小于 ${property.minimum}`);
    if (property.maximum !== undefined && value > property.maximum) fail(errors, path, `不能大于 ${property.maximum}`);
    return;
  }
  if (type === 'array') {
    if (!Array.isArray(value)) { fail(errors, path, '必须是数组'); return; }
    if (property.minItems !== undefined && value.length < property.minItems) fail(errors, path, `至少 ${property.minItems} 项`);
    if (property.maxItems !== undefined && value.length > property.maxItems) fail(errors, path, `最多 ${property.maxItems} 项`);
    value.forEach((item, index) => checkValue(item, property.items, `${path}[${index}]`, errors));
  }
}

/** 按 schema 填默认值、校验类型/范围；没有 schema 的插件原样透传。 */
export function applyPluginConfig(schema, raw) {
  if (!schema) return { ok: true, errors: [], value: isPlainObject(raw) ? clone(raw) : {} };
  const errors = [];
  const source = raw === undefined || raw === null ? {} : raw;
  if (!isPlainObject(source)) return { ok: false, errors: ['插件配置必须是对象'], value: {} };
  const value = {};
  for (const [key, property] of Object.entries(schema.properties)) {
    const input = source[key];
    if (input === undefined) {
      if (property.default !== undefined) value[key] = clone(property.default);
      else if (schema.required.includes(key)) fail(errors, key, '必填项不能为空');
      continue;
    }
    const before = errors.length;
    checkValue(input, property, key, errors);
    if (errors.length === before) value[key] = clone(input);
  }
  if (!schema.additionalProperties) {
    for (const key of Object.keys(source)) {
      if (!schema.properties[key]) fail(errors, key, '未声明的配置项');
    }
  } else {
    for (const [key, item] of Object.entries(source)) {
      if (!schema.properties[key]) value[key] = clone(item);
    }
  }
  return { ok: errors.length === 0, errors, value };
}
