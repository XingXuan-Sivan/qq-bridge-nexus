// 预设插件配置的表单规格：按 agent.cordis.yml 的插件行生成字段，
// 读表单时按行组装回 {id, config} 的 patch，交给 PUT /api/extensions/presets/<id>/agent。
import { getSwitch, renderFields } from '../../components/form/form.js';

const SWITCH = 'switch';
const NUMBER = 'number';
const SELECT = 'select';

// 每个插件行的可编辑字段。label 用中文，name 是行内配置路径。
const PLUGIN_FORMS = {
  'tool-web': {
    title: '联网工具（tool-web）',
    fields: [
      { key: 'search', type: SWITCH, label: '搜索', hint: '内置 web_search；QQ 场景通常关掉，统一走安全 MCP。' },
      { key: 'fetch', type: SWITCH, label: '抓取网页' },
      { key: 'searchTimeoutMs', type: NUMBER, label: '搜索超时', unit: '毫秒' },
    ],
  },
  'tool-fs-search': {
    title: '文件检索（tool-fs-search）',
    fields: [{ key: 'sampleOverCapGlobResults', type: SWITCH, label: '超限采样 glob 结果' }],
  },
  'tool-todo': {
    title: '待办（tool-todo）',
    fields: [{ key: 'allowParallelInProgress', type: SWITCH, label: '允许并行进行中的待办' }],
  },
  'qq-tool-restrict': {
    title: 'QQ 工具边界（qq-tool-restrict）',
    fields: [{
      key: 'profile',
      type: SELECT,
      label: '白名单档位',
      options: [
        { value: '', label: '默认（chat 最严白名单）' },
        { value: 'chat', label: 'chat' },
        { value: 'readonly-agent', label: 'readonly-agent' },
        { value: 'operator', label: 'operator' },
      ],
      hint: '决定执行期允许哪些 QQ 工具；chat 只放行聊天与记忆类。',
    }],
  },
  'qq-approval-gate': {
    title: '审批闸门（qq-approval-gate）',
    fields: [{
      key: 'level',
      type: SELECT,
      label: '权限级别',
      options: [
        { value: 'L1', label: 'L1 只读' },
        { value: 'L2', label: 'L2 工作区读写' },
        { value: 'L3', label: 'L3 高权限' },
      ],
    }],
  },
  'agent-instructions': {
    title: '指令文件（agent-instructions）',
    fields: [{ key: 'maxBytes', type: NUMBER, label: '最大字节', unit: '字节' }],
  },
};

const COMPACTION_FORM = {
  title: '上下文管理（compaction）',
  fields: [
    { key: 'isolate.compaction', type: SWITCH, label: '独立 compaction' },
    { key: 'isolate.toolResultPruner', type: SWITCH, label: '独立工具结果裁剪' },
    { key: 'pruner.thresholdChars', type: NUMBER, label: '裁剪阈值', unit: '字符' },
    { key: 'pruner.headChars', type: NUMBER, label: '保留开头', unit: '字符' },
    { key: 'pruner.tailChars', type: NUMBER, label: '保留结尾', unit: '字符' },
  ],
};

function fieldSpec(rowId, field) {
  const id = `${rowId}.${field.key}`;
  const base = { name: id, label: field.label, hint: field.hint, unit: field.unit };
  if (field.type === SWITCH) return { ...base, type: 'switch' };
  if (field.type === NUMBER) return { ...base, type: 'number', min: 0, step: 1 };
  return { ...base, type: 'select', options: field.options };
}

function hasRow(rows, id) {
  return rows.some((row) => row.id === id);
}

export function agentFormFields(rows) {
  const fields = [];
  for (const [rowId, spec] of Object.entries(PLUGIN_FORMS)) {
    if (!hasRow(rows, rowId)) continue;
    fields.push({ type: 'section', label: spec.title, card: true });
    for (const field of spec.fields) fields.push(fieldSpec(rowId, field));
  }
  if (hasRow(rows, 'compaction')) {
    fields.push({ type: 'section', label: COMPACTION_FORM.title, card: true });
    for (const field of COMPACTION_FORM.fields) fields.push(fieldSpec('compaction', field));
  }
  return fields;
}

function rowConfig(row) {
  return row?.config && typeof row.config === 'object' && !Array.isArray(row.config) ? row.config : {};
}

function nestedConfig(row) {
  const config = rowConfig(row).config;
  return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
}

function prunerConfig(row) {
  const list = Array.isArray(rowConfig(row).config) ? rowConfig(row).config : [];
  const pruner = list.find((item) => item?.id === 'tool-result-pruner');
  return pruner?.config && typeof pruner.config === 'object' ? pruner.config : {};
}

function valueFor(row, field) {
  const [head, tail] = field.key.split('.');
  if (row.id === 'compaction') {
    if (head === 'isolate') return Boolean(rowConfig(row).isolate?.[tail]);
    if (head === 'pruner') return prunerConfig(row)[tail] ?? 0;
  }
  return nestedConfig(row)[field.key] ?? (field.type === SWITCH ? false : '');
}

export function fillAgentForm(host, rows) {
  for (const [rowId, spec] of Object.entries(PLUGIN_FORMS)) {
    const row = rows.find((item) => item.id === rowId);
    if (!row) continue;
    for (const field of spec.fields) {
      const el = host.querySelector(`[data-field="${rowId}.${field.key}"]`);
      if (!el) continue;
      const value = valueFor(row, field);
      if (field.type === SWITCH) {
        const on = Boolean(value);
        el.setAttribute('aria-checked', on ? 'true' : 'false');
        el.textContent = on ? '开' : '关';
      } else if (field.type === SELECT) {
        el.value = String(value ?? '');
      } else {
        el.value = value === '' ? '' : String(value);
      }
    }
  }
  const compaction = rows.find((item) => item.id === 'compaction');
  if (compaction) {
    for (const field of COMPACTION_FORM.fields) {
      const el = host.querySelector(`[data-field="compaction.${field.key}"]`);
      if (!el) continue;
      const value = valueFor(compaction, field);
      if (field.type === SWITCH) {
        const on = Boolean(value);
        el.setAttribute('aria-checked', on ? 'true' : 'false');
        el.textContent = on ? '开' : '关';
      } else {
        el.value = String(value ?? 0);
      }
    }
  }
}

export function renderAgentForm(host, rows) {
  renderFields(host, agentFormFields(rows), { columns: 2 });
  fillAgentForm(host, rows);
}

function readOne(el, type) {
  if (type === SWITCH) return getSwitch(el);
  if (type === NUMBER) {
    const value = Number(el.value);
    return Number.isFinite(value) ? value : 0;
  }
  return el.value;
}

export function readAgentForm(host, rows) {
  const patches = new Map();
  const ensure = (rowId) => {
    if (!patches.has(rowId)) patches.set(rowId, { id: rowId, config: {} });
    return patches.get(rowId);
  };
  for (const [rowId, spec] of Object.entries(PLUGIN_FORMS)) {
    if (!hasRow(rows, rowId)) continue;
    const patch = ensure(rowId);
    const config = {};
    for (const field of spec.fields) {
      const el = host.querySelector(`[data-field="${rowId}.${field.key}"]`);
      if (!el) continue;
      config[field.key] = readOne(el, field.type);
    }
    patch.config = { config };
  }
  const compactionRow = rows.find((item) => item.id === 'compaction');
  if (compactionRow) {
    const isolate = { ...rowConfig(compactionRow).isolate };
    const pruner = { ...prunerConfig(compactionRow) };
    for (const field of COMPACTION_FORM.fields) {
      const el = host.querySelector(`[data-field="compaction.${field.key}"]`);
      if (!el) continue;
      const value = readOne(el, field.type);
      const [head, tail] = field.key.split('.');
      if (head === 'isolate') isolate[tail] = value;
      if (head === 'pruner') pruner[tail] = value;
    }
    const list = (Array.isArray(rowConfig(compactionRow).config) ? rowConfig(compactionRow).config : []).map((item) => (
      item?.id === 'tool-result-pruner' ? { ...item, config: pruner } : item
    ));
    const patch = ensure('compaction');
    patch.config = { isolate, config: list };
  }
  return [...patches.values()];
}
