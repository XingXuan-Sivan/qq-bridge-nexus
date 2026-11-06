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
      { name: 'schedQuietEnabled', type: 'switch', label: '定时任务免打扰', hint: '只拦定时任务发往群的消息，不影响 AI 平时被 @ 时回复。' },
      { name: 'schedQuietStart', type: 'text', label: '免打扰开始', placeholder: '00:00', width: 120 },
      { name: 'schedQuietEnd', type: 'text', label: '免打扰结束', placeholder: '07:00', width: 120 },
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
