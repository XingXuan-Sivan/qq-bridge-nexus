// 注入块页的字段规格：全部走 renderFields，页面只提供宿主。
// 表格与预览输出是动态内容，用 custom 字段挂一个空壳，由 page.js 填。

export const PROMPT_BLOCK_FIELDS = {
  summary: [
    { name: 'pbSummary', type: 'custom', span: 2, html: '<div class="row" id="pbSummaryRow"><span class="meta">加载中…</span></div>' },
  ],
  limits: [
    {
      name: 'pbTotalLimit',
      type: 'number',
      label: '总预算',
      hint: '整段唤醒提示词的字数上限；0 = 不限。用完时排在后面的块整块跳过。',
      value: 0,
    },
    {
      name: 'pbBlockLimit',
      type: 'number',
      label: '单块默认上限',
      hint: '只对「没有单独配过上限」的内置块生效；0 = 不限。',
      value: 0,
    },
    { name: 'pbSaveMsg', type: 'custom', span: 2, html: '<div class="meta" id="pbSaveMsg" role="status"></div>' },
  ],
  table: [
    { name: 'pbTableHost', type: 'custom', span: 2, html: '<div id="pbTable" class="u-mt-8-grid"><span class="meta">加载中…</span></div>' },
  ],
  preview: [
    { name: 'pbPreviewKey', type: 'select', label: '会话', options: [], hint: '选一个真实会话；预览只读，不影响它的状态。' },
    {
      name: 'pbPreviewProfile',
      type: 'select',
      label: '提示词档案',
      options: [
        { value: 'wake', label: '唤醒（wake）' },
        { value: 'reminder', label: '收尾提醒（reminder）' },
        { value: 'context', label: '前置上下文（context）' },
      ],
      value: 'wake',
    },
    {
      name: 'pbPreviewReason',
      type: 'select',
      label: '唤醒原因',
      options: [
        { value: 'atMention', label: '@ / 引用（atMention）' },
        { value: 'question', label: '被提问（question）' },
        { value: 'private', label: '私聊（private）' },
        { value: 'proactiveCheck', label: '主动检查（proactiveCheck）' },
        { value: 'replyCheck', label: '回复检查（replyCheck）' },
        { value: 'timeout', label: '潜水到期（timeout）' },
        { value: 'memberJoin:member_start', label: '新人入群（memberJoin）' },
        { value: 'roleRefresh', label: '角色卡刷新（roleRefresh）' },
        { value: 'silenceEnded', label: '静默结束（silenceEnded）' },
        { value: 'scheduled', label: '定时任务（scheduled）' },
        { value: 'ownerRelay', label: '管理员托付（ownerRelay）' },
        { value: 'poke', label: '拍一拍（poke）' },
      ],
      value: 'atMention',
    },
    {
      type: 'action',
      id: 'pbPreviewActions',
      items: [{ id: 'pbPreviewGo', label: '生成预览', variant: 'primary', status: 'pbPreviewMsg' }],
    },
  ],
  previewOut: [
    { name: 'pbPreviewOut', type: 'custom', span: 2, html: '<div id="pbPreviewBody"><span class="meta">还没有预览。选好会话与原因后点「生成预览」。</span></div>' },
  ],
};
