// 行为档案的字段规格：控制台与后端共用（GET /api/behaviors/kinds 下发）。
// 只描述字段与取值映射，渲染交给 components/form 的 renderFields。

const num = (name, label, extra = {}) => ({ name, label, type: 'number', step: 'any', ...extra });
const sw = (name, label) => ({ name, label, type: 'switch' });

const FIELDS = [
  { type: 'section', card: true, label: '触发与上下文' },
  num('triggerProbability', '触发概率', { min: 0, max: 1, step: 0.01, hint: '0–1' }),
  num('contextWindow', '上下文条数', { min: 1 }),
  num('maxReplyChars', '单条最大字数', { min: 0 }),
  { name: 'mustReplyKeywords', label: '必回关键词', type: 'textarea', rows: 4, list: true, hint: '每行一个' },

  { type: 'section', card: true, label: '主动检查' },
  num('activeCheckMinMs', '主动检查最小间隔', { hint: '毫秒' }),
  num('activeCheckMaxMs', '主动检查最大间隔', { hint: '毫秒' }),
  num('activeReplyDelayMinMs', '主动回复延迟最小', { hint: '毫秒' }),
  num('activeReplyDelayMaxMs', '主动回复延迟最大', { hint: '毫秒' }),
  sw('activeDurationEnabled', '主动持续'),
  num('activeDurationMinMs', '主动持续最小', { hint: '毫秒' }),
  num('activeDurationMaxMs', '主动持续最大', { hint: '毫秒' }),

  { type: 'section', card: true, label: '主动机会' },
  sw('proactiveEnabled', '主动机会'),
  num('proactiveIdleThresholdMs', '触发主动的空闲阈值', { hint: '毫秒' }),
  num('proactiveCheckMinMs', '主动机会检查最小间隔', { hint: '毫秒' }),
  num('proactiveCheckMaxMs', '主动机会检查最大间隔', { hint: '毫秒' }),
  num('proactiveProbability', '主动机会概率', { min: 0, max: 1, step: 0.01 }),

  { type: 'section', card: true, label: '空闲重试' },
  num('idleWindowMs', '空闲窗口', { hint: '毫秒' }),
  num('idleRetryProbability', '空闲重试概率', { min: 0, max: 1, step: 0.01 }),
  num('idleRetryWaitMs', '空闲重试等待', { hint: '毫秒' }),

  { type: 'section', card: true, label: '连发与间隔' },
  sw('burstEnabled', '连发'),
  num('burstIntervalMinMs', '连发最小间隔', { hint: '毫秒' }),
  num('burstIntervalMaxMs', '连发最大间隔', { hint: '毫秒' }),
  num('longGapProbability', '长停顿概率', { min: 0, max: 1, step: 0.01 }),
  num('longGapMinMs', '长停顿最小', { hint: '毫秒' }),
  num('longGapMaxMs', '长停顿最大', { hint: '毫秒' }),

  { type: 'section', card: true, label: '其它' },
  num('skipProbability', '跳过概率', { min: 0, max: 1, step: 0.01 }),
  num('surrenderProbability', '放弃概率', { min: 0, max: 1, step: 0.01 }),
];
export const kind = 'v1';
export const label = '一代仿真行为';
export const platform = 'qq';
export const fields = FIELDS;
