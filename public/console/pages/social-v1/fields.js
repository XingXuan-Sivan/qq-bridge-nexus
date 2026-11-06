// 一代仿真（reserved）页的字段规格（2026-11-07 迁移）。
// 约定：字段用 name（渲染后就是控件 id），范围用 custom 拼一行「起始 ～ 结束」。
const numAttrs = ({ min, max, step }) =>
  `${min === undefined ? '' : ` min="${min}"`}${max === undefined ? '' : ` max="${max}"`}${step === undefined ? '' : ` step="${step}"`}`;

// 一段「A ～ B」的数值区间：两个输入框 + 分隔符，单位写在后面。
const range = (name, label, a, b, opts = {}) => {
  const at = numAttrs(opts);
  const unit = opts.unit ? `<span class="control-note">${opts.unit}</span>` : '';
  return {
    name,
    type: 'custom',
    label,
    hint: opts.hint,
    html: `<div class="control-row s1-range">
  <input class="control-fixed" type="number" id="${a}"${at}>
  <span class="control-note">～</span>
  <input class="control-fixed" type="number" id="${b}"${at}>
  ${unit}
</div>`,
  };
};

const num = (name, label, opts = {}) => ({ name, type: 'number', label, ...opts });

export const SOCIAL_V1_FIELDS = {
  core: {
    fields: [
      num('sTrigger', '触发概率', { min: 0, max: 1, step: 0.05, hint: '观望期收到普通消息时，按这个概率起念回应。' }),
      range('sCheckRange', '检测间隔', 'sCheckMin', 'sCheckMax', { min: 5, unit: '秒', hint: '活跃期每隔这么久批量看一次新消息，区间内随机。' }),
      range('sActiveDelayRange', '回复延迟', 'sActiveDelayMin', 'sActiveDelayMax', { min: 0, unit: '秒' }),
    ],
  },
  timeout: {
    fields: [
      { name: 'sActiveDurationEnabled', type: 'switch', label: '启用主动退出', hint: '到点后提示 AI 说一句收尾话再回观望；私聊不自动退场。' },
      range('sActiveDurationRange', '最长持续时间', 'sActiveDurationMin', 'sActiveDurationMax', { min: 1, unit: '分' }),
      num('sIdleWindow', '冷场窗口', { min: 1, unit: '分', hint: '群里安静这么久算冷场。' }),
      num('sIdleRetry', '冷场试探概率', { min: 0, max: 1, step: 0.05 }),
      num('sIdleWait', '试探等待', { min: 1, unit: '分' }),
      num('sSkipProb', '沉默概率', { min: 0, max: 1, step: 0.05, hint: '活跃期看到普通消息，按这个概率选择不说。' }),
      num('sSurrenderProb', '抬杠退让概率', { min: 0, max: 1, step: 0.05 }),
      num('sContextWindow', '上下文条数', { min: 1, max: 100, unit: '条' }),
      num('sMaxChars', '长度上限', { min: 1, unit: '字' }),
    ],
  },
  burst: {
    fields: [
      { name: 'sBurstEnabled', type: 'switch', label: '启用分条发送' },
      range('sBurstIntervalRange', '条间间隔', 'sBurstIntervalMin', 'sBurstIntervalMax', { min: 0, unit: '毫秒' }),
      num('sLongGapProb', '长间隔概率', { min: 0, max: 1, step: 0.05 }),
      range('sLongGapRange', '长间隔范围', 'sLongGapMin', 'sLongGapMax', { min: 0, unit: '毫秒' }),
      {
        name: 'sKeywords',
        type: 'text',
        label: '必回关键词',
        placeholder: 'deepseek, 在吗',
        hint: '逗号分隔；命中就一定要回。',
      },
    ],
  },
  proactive: {
    fields: [
      { name: 'sProactiveEnabled', type: 'switch', label: '启用主动开话题' },
      num('sProactiveIdle', '安静判定', { min: 1, unit: '分' }),
      range('sProactiveCheckRange', '判定间隔', 'sProactiveCheckMin', 'sProactiveCheckMax', { min: 1, unit: '分' }),
      num('sProactiveProb', '成功概率', { min: 0, max: 1, step: 0.05 }),
    ],
  },
  actions: {
    fields: [
      {
        type: 'action',
        id: 'socialActions',
        items: [
          { id: 'socialSave', label: '保存社交配置', variant: 'primary' },
          { id: 'socialFlush', label: '立刻投喂摘要' },
        ],
        status: 'socialMsg',
      },
    ],
  },
  state: {
    fields: [
      {
        type: 'custom',
        name: 'sStatePanel',
        label: '会话状态',
        span: 2,
        html: `<div class="control-row">
  <span class="control-grow"><select id="sStateKey"><option value="">选择会话</option></select></span>
  <button class="btn small" id="sStateActive" type="button">设为活跃</button>
  <button class="btn small" id="sStateIdle" type="button">设为观望</button>
</div>`,
        hint: '只切这一个会话的状态，不影响保存的配置。',
      },
    ],
  },
};
