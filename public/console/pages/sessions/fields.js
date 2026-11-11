// 会话与审批：会话映射 / 审批提问两块用页内标签切换；表格统一走 dataTableHtml。
// 页面只留卡片与宿主，标签条、面板宿主与改名弹窗里的字段都在这里生成。

const TABS_HTML = `<div class="page-tabs">
  <button type="button" class="page-tab active" data-sessions-tab="sessions">会话映射 <span class="meta" id="sessionsTabCount"></span></button>
  <button type="button" class="page-tab" data-sessions-tab="pending">审批 / 提问 <span class="meta" id="pendingTabCount"></span></button>
</div>`;

export const SESSIONS_FIELDS = {
  tabs: { html: TABS_HTML },
  access: {
    fields: [
      {
        name: 'accessBlock',
        type: 'custom',
        html: `
<div class="meta" id="globalAccessSummary" aria-live="polite">正在读取…</div>
<div class="access-columns">
  <section class="access-field">
    <div class="access-head">
      <span class="access-title">被动行为</span>
      <button type="button" class="field-switch" id="accessPassiveMode" role="switch" data-field="accessPassiveMode" aria-checked="true" data-on-label="白名单" data-off-label="黑名单">
        <span class="field-switch-track" aria-hidden="true"></span><span>白名单</span>
      </button>
    </div>
    <textarea id="accessPassiveEntries" rows="6" class="access-textarea" spellcheck="false" placeholder="group:123456789&#10;private:100001&#10;也可以写完整的 qq:group:… / qq:private:…"></textarea>
    <p class="field-hint">控制「别人发消息、@、私聊」是否唤醒并回复。每行一个会话，支持 <code>group:群号</code>、<code>private:QQ号</code>；<b>白名单为空 = 全部拒绝，黑名单为空 = 全部允许</b>。owner 私聊始终放行。</p>
  </section>
  <section class="access-field">
    <div class="access-head">
      <span class="access-title">主动行为</span>
      <button type="button" class="field-switch" id="accessProactiveMode" role="switch" data-field="accessProactiveMode" aria-checked="true" data-on-label="白名单" data-off-label="黑名单">
        <span class="field-switch-track" aria-hidden="true"></span><span>白名单</span>
      </button>
    </div>
    <textarea id="accessProactiveEntries" rows="6" class="access-textarea" spellcheck="false" placeholder="group:123456789&#10;private:100001"></textarea>
    <p class="field-hint">控制「定时任务、主动冒泡」是否允许在该会话发生。每行一个会话，格式同上；<b>白名单为空 = 全部拒绝，黑名单为空 = 全部允许</b>。它不能绕过被动名单：被动没放行的会话，主动也不会进。</p>
  </section>
</div>
<p class="field-warn" id="accessWarning" hidden></p>`,
      },
    ],
  },
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
