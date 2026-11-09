// 行为档案表单（v1 / v2）：只描述字段与取值映射，渲染交给 components/form。
// 权威存储仍是 config/behaviors/<id>.yml；后端 GET 返回结构化 data，PUT 收 {data}。
import { renderFields } from '../../components/form/form.js';

const num = (name, label, extra = {}) => ({ name, label, type: 'number', step: 'any', ...extra });
const sw = (name, label) => ({ name, label, type: 'switch' });

// ── 一代仿真（social-v1）：按能力分组（与 v2 一致的 section 形态，不额外包卡片） ──
const V1_FIELDS = [
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

// ── 二代仿真（social-v2）：按能力分组 ────────────────────────────────────────
const V2_FIELDS = [
  num('autoReplyCheckMs', '自动回复检查间隔', { hint: '毫秒' }),
  sw('provideRecommendations', '提供推荐值'),
  { type: 'section', card: true, label: '唤醒' },
  { name: 'wake_defaultMode', label: '默认潜水方式', type: 'select', options: [{ value: 'diving', label: '潜水' }, { value: 'active', label: '活跃' }] },
  sw('wake_preSleepWaitEnabled', '睡前观察'),
  num('wake_preSleepWaitMs', '睡前观察时长', { hint: '毫秒' }),
  sw('wake_recommendedDefaultInfinite', '推荐无限期潜水'),
  num('wake_sleepMinMs', '潜水最短', { hint: '毫秒' }),
  num('wake_sleepMaxMs', '潜水最长', { hint: '毫秒；0 表示无限' }),
  num('wake_recommendedSleepMinMs', '推荐潜水最短', { hint: '毫秒' }),
  num('wake_recommendedSleepMaxMs', '推荐潜水最长', { hint: '毫秒' }),
  num('wake_recommendedProbability', '推荐唤醒概率', { min: 0, max: 1, step: 0.01 }),
  { name: 'wake_recommendedKeywords', label: '推荐唤醒关键词', type: 'textarea', rows: 4, list: true, hint: '每行一个' },
  sw('wake_recommendedAtMention', '推荐：@ 唤醒'),
  sw('wake_recommendedNameMention', '推荐：名字唤醒'),
  sw('wake_recommendedQuestion', '推荐：提问唤醒'),
  sw('wake_recommendedPoke', '推荐：拍一拍唤醒'),
  { name: 'wake_recommendedHint', label: '唤醒推荐提示词', type: 'textarea', rows: 3 },
  num('wake_batchWindowMs', '多条合并窗口', { hint: '毫秒' }),
  num('wake_maxWakePerMinute', '每分钟最多唤醒' ),
  num('wake_maxWakePerHour', '每小时最多唤醒'),
  num('wake_noActionLimit', '无动作上限' ),
  num('wake_maxWakeConfigReminders', '唤醒配置提醒上限' ),
  { type: 'section', card: true, label: '发送' },
  sw('send_burstEnabled', '连发'),
  num('send_burstMaxMessages', '连发最多条数'),
  num('send_burstIntervalMinMs', '连发最小间隔', { hint: '毫秒' }),
  num('send_burstIntervalMaxMs', '连发最大间隔', { hint: '毫秒' }),
  num('send_longGapProbability', '长停顿概率', { min: 0, max: 1, step: 0.01 }),
  num('send_longGapMinMs', '长停顿最小', { hint: '毫秒' }),
  num('send_longGapMaxMs', '长停顿最大', { hint: '毫秒' }),
  num('send_maxMessageChars', '单条最大字数'),
  num('send_maxGapMs', '条间最大间隔', { hint: '毫秒' }),
  num('send_gapBaseMs', '条间基础间隔', { hint: '毫秒' }),
  num('send_gapPerCharMs', '每字追加间隔', { hint: '毫秒' }),
  { name: 'send_recommendedHint', label: '发送推荐提示词', type: 'textarea', rows: 3 },
  { type: 'section', card: true, label: '等待' },
  num('wait_defaultMs', '默认等待', { hint: '毫秒' }),
  num('wait_minMs', '最短等待', { hint: '毫秒' }),
  num('wait_maxMs', '最长等待', { hint: '毫秒' }),
  num('wait_defaultQuietMs', '默认静默窗口', { hint: '毫秒' }),
  num('wait_minQuietAfterNewMs', '新消息后最少静默', { hint: '毫秒' }),
  { type: 'section', card: true, label: '主动机会' },
  sw('proactive_enabled', '主动机会'),
  num('proactive_checkIntervalMinMs', '检查最小间隔', { hint: '毫秒' }),
  num('proactive_checkIntervalMaxMs', '检查最大间隔', { hint: '毫秒' }),
  num('proactive_idleThresholdMs', '空闲阈值', { hint: '毫秒' }),
  num('proactive_probability', '主动概率', { min: 0, max: 1, step: 0.01 }),
  { type: 'section', card: true, label: '表情' },
  sw('sticker_enabled', '表情包'),
  num('sticker_syncTtlMs', '同步缓存时长', { hint: '毫秒' }),
  num('sticker_maxListCount', '列表最多条数'),
  sw('sticker_includeInPrompt', '写进提示词'),
  num('sticker_promptMaxStickers', '提示词里最多表情'),
  num('sticker_maxBytes', '单个表情大小上限', { hint: '字节' }),
  sw('sticker_collect_enabled', '收藏表情'),
  num('sticker_collect_maxPerMinute', '每分钟最多收藏'),
  num('sticker_collect_maxPerHour', '每小时最多收藏'),
  num('sticker_collect_maxRemarkChars', '收藏备注字数上限'),
  { type: 'section', card: true, label: '上下文' },
  num('context_recentLimit', '最近消息条数'),
  num('context_unreadLimit', '未读条数上限'),
  num('context_contextWindow', '上下文条数'),
  sw('context_inlineWakeMessages', '唤醒消息内联'),
  num('context_wakeMessageLimit', '唤醒消息条数'),
  num('context_wakeRecentLimit', '唤醒最近条数'),
  num('context_wakeMaxChars', '唤醒最大字符'),
  { type: 'section', card: true, label: '反馈' },
  num('feedback_maxLength', '反馈最大长度'),
  sw('feedback_notifyOwnerOnError', '出错通知 owner'),
];

export function behaviorFields(kind) {
  return kind === 'v1' ? V1_FIELDS : V2_FIELDS;
}

export function fillBehaviorForm(host, kind, config = {}) {
  const values = {};
  for (const item of behaviorFields(kind)) {
    if (!item.name) continue;
    const value = item.name.includes('_')
      ? item.name.split('_').reduce((node, key) => (node == null ? undefined : node[key]), config)
      : config[item.name];
    if (item.type === 'textarea' && Array.isArray(value)) values[item.name] = value.join('\n');
    else if (value != null) values[item.name] = value;
    else values[item.name] = item.type === 'switch' ? false : item.type === 'number' ? 0 : '';
  }
  // 列宽充足时两列（form 组件的 md 断点自动折回单列）；字段多，单列会让整页过长。
  renderFields(host, behaviorFields(kind), { columns: 2 });
  for (const [name, value] of Object.entries(values)) {
    const el = host.querySelector(`#${CSS.escape(name)}`);
    if (!el) continue;
    if (el.getAttribute('role') === 'switch') el.setAttribute('aria-checked', String(!!value));
    else if (el.type === 'checkbox') el.checked = !!value;
    else el.value = String(value);
  }
}

export function readBehaviorForm(host, kind) {
  const config = {};
  for (const item of behaviorFields(kind)) {
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

