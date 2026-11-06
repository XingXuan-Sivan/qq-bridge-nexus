// 定时任务页的字段规格：页面本体只留分区骨架，控件全部由这里生成。
//
// 约定：控件 id 一律沿用旧 DOM id（page.js 用 schedEl(id) 直接读写），迁移只换外壳、不改行为。
// 「任务编辑器」是 13 种重复方式驱动的动态表单（page.js 按类型重建 #schedFields、按类型显隐行），
// 2026-11-07 起搬进 body 级弹窗 #schedEditorOverlay（index.html），不再作为 custom 块内联在页面里。


/** 每个 key 对应 page.html 里的 `<div data-sched-fields="key">`。 */
export const SCHED_FIELDS = {
  header: {
    fields: [
      { name: 'schedEnabled', type: 'switch', label: '启用定时任务' },
      { name: 'schedTimezone', type: 'select', label: '默认时区', options: [] },
    ],
  },
  headerActions: {
    fields: [
      {
        type: 'action',
        items: [{ id: 'schedSettingsSave', label: '保存', variant: 'primary' }],
        status: 'schedSettingsMsg',
      },
    ],
  },
  policy: {
    fields: [
      { name: 'schedAllowAiPrivate', type: 'switch', label: '允许 AI 在管理员私聊里登记任务' },
      { name: 'schedAllowAiGroup', type: 'switch', label: '允许 AI 登记发往群 / 其他好友的任务', hint: '登记后先暂停，需要你确认才会生效。' },
    ],
  },
  limits: {
    fields: [
      {
        name: 'schedLimitsSlot',
        type: 'custom',
        span: 2,
        html: '<div id="schedLimits" class="sched-limits"></div>',
      },
      { name: 'schedQuietEnabled', type: 'switch', span: 2, label: '定时任务免打扰', hint: '只拦定时任务发往群的消息，不影响 AI 平时被 @ 时回复。' },
      {
        // 开始与结束合成一行「时间段 00:00 ～ 07:00」：它们是同一个区间的两端，拆成两行读起来像两个独立设置。
        // 控件用 components/time（文本框 + 时钟按钮），和日期字段一致——原生 time 是两段式，整段键入不顺手。
        name: 'schedQuietRange',
        type: 'custom',
        span: 2,
        label: '免打扰时间段',
        hint: '按北京时间，精确到分钟。',
        html: '<div class="field-inline">'
          + '<span class="time-field"><input type="text" class="time-field-text" id="schedQuietStart" placeholder="HH:mm" inputmode="numeric" autocomplete="off" aria-label="免打扰开始时间">'
          + '<button type="button" class="time-field-btn btn-icon" aria-label="选择免打扰开始时间"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.6V8l2.4 1.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button>'
          + '<input type="time" data-time-native="schedQuietStart" tabindex="-1" aria-hidden="true"></span>'
          + '<span class="field-unit">～</span>'
          + '<span class="time-field"><input type="text" class="time-field-text" id="schedQuietEnd" placeholder="HH:mm" inputmode="numeric" autocomplete="off" aria-label="免打扰结束时间">'
          + '<button type="button" class="time-field-btn btn-icon" aria-label="选择免打扰结束时间"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.6V8l2.4 1.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button>'
          + '<input type="time" data-time-native="schedQuietEnd" tabindex="-1" aria-hidden="true"></span>'
          + '</div>',
      },
    ],
  },
  limitsActions: {
    fields: [
      {
        type: 'action',
        items: [
          { id: 'schedLimitsSave', label: '保存限制', variant: 'primary' },
          { id: 'schedLimitsReset', label: '恢复默认' },
        ],
        status: 'schedLimitsMsg',
      },
    ],
  },
  listActions: {
    fields: [
      {
        type: 'action',
        items: [{ id: 'schedNew', label: '＋ 新建任务', variant: 'primary', small: true }],
        status: 'schedCount',
      },
    ],
  },
  taskList: {
    fields: [{ name: 'schedListSlot', type: 'custom', span: 2, html: '<div id="schedList" class="data-slot"></div>' }],
  },
  history: {
    fields: [{ name: 'schedHistorySlot', type: 'custom', span: 2, html: '<div id="schedHistory"></div>' }],
  },
};
