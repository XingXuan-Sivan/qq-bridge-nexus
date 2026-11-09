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
<div class="form-stack">
  <div class="field-row">
    <label class="field-label" for="accessPassiveEntries">被动行为</label>
    <div class="field-control">
      <div class="control-row">
        <button type="button" class="field-switch" id="accessPassiveMode" role="switch" data-field="accessPassiveMode" aria-checked="true" data-on-label="白名单" data-off-label="黑名单">
          <span class="field-switch-track" aria-hidden="true"></span><span>白名单</span>
        </button>
        <span class="meta">普通消息是否回复</span>
      </div>
    </div>
  </div>
  <textarea id="accessPassiveEntries" rows="5" class="access-textarea" spellcheck="false" placeholder="group:123456789&#10;private:100001&#10;也可以写完整的 qq:group:… / qq:private:…"></textarea>
  <p class="field-hint">每行一个会话，支持 group:群号、private:QQ号；白名单为空=全部拒绝，黑名单为空=全部允许。</p>
  <div class="field-row">
    <label class="field-label" for="accessProactiveEntries">主动行为</label>
    <div class="field-control">
      <div class="control-row">
        <button type="button" class="field-switch" id="accessProactiveMode" role="switch" data-field="accessProactiveMode" aria-checked="true" data-on-label="白名单" data-off-label="黑名单">
          <span class="field-switch-track" aria-hidden="true"></span><span>白名单</span>
        </button>
        <span class="meta">定时任务与主动发言是否允许</span>
      </div>
    </div>
  </div>
  <textarea id="accessProactiveEntries" rows="5" class="access-textarea" spellcheck="false" placeholder="group:123456789&#10;private:100001"></textarea>
  <p class="field-hint">每行一个会话；白名单为空=全部拒绝，黑名单为空=全部允许。</p>
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
