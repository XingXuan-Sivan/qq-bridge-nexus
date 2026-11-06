// 会话与审批：会话映射 / 审批提问两块用页内标签切换；表格统一走 dataTableHtml。
// 页面只留卡片与宿主，标签条、面板宿主与改名弹窗里的字段都在这里生成。

const TABS_HTML = `<div class="page-tabs">
  <button type="button" class="page-tab active" data-sessions-tab="sessions">会话映射 <span class="meta" id="sessionsTabCount"></span></button>
  <button type="button" class="page-tab" data-sessions-tab="pending">审批 / 提问 <span class="meta" id="pendingTabCount"></span></button>
</div>`;

export const SESSIONS_FIELDS = {
  tabs: { html: TABS_HTML },
  sessionsPanel: { html: '<div id="sessionList"></div>' },
  pendingPanel: { html: '<div id="pendingList"></div>' },
  rename: {
    fields: [
      {
        name: 'sessionRenameInput',
        type: 'text',
        label: '标题',
        maxlength: 60,
        placeholder: '例如：群聊·喵喵屋｜星苒',
        hint: '最多 60 字，侧栏直接显示。',
      },
    ],
  },
};
