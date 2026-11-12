// 调试与运维：测试发送 / 桥接控制 / 后台控制端引导。
// 控件全部由规格生成，页面只留卡片与宿主；id 与迁移前保持一致（脚本与文档仍按这些 id 引用）。

const TARGET_ROW = (kindId, idId, idPlaceholder) => `<div class="control-row">
  <span class="control-fixed u-flex-basis-max-110"><select id="${kindId}">
    <option value="group">群</option>
    <option value="private">私聊</option>
  </select></span>
  <input class="control-grow" type="text" id="${idId}" placeholder="${idPlaceholder}">
</div>`;

export const OPERATIONS_FIELDS = {
  activity: {
    fields: [{ name: 'operationsActivity', type: 'custom', span: 2, html: '<pre id="activity" class="activity-log">（空）</pre>' }],
  },
  testSend: {
    fields: [
      { name: 'testSendTarget', type: 'custom', label: '目标', span: 2, html: TARGET_ROW('tsKind', 'tsId', '群号 / QQ 号') },
      { name: 'tsMsg', type: 'textarea', label: '消息内容', rows: 4, placeholder: '这是一条测试消息', span: 2 },
      {
        type: 'action',
        id: 'testSendActions',
        items: [{ id: 'tsSend', label: '发送测试', variant: 'primary' }],
        status: 'tsMsg2',
      },
      { name: 'testSendNote', type: 'custom', span: 2, html: '<div class="meta">目标必须在白名单内，否则拒绝。</div>' },
    ],
  },
  maintenance: {
    fields: [
      {
        type: 'action',
        id: 'maintenanceActions',
        className: 'form-actions--pair',
        items: [
          { id: 'restartBtn', label: '重启桥接', variant: 'danger', status: 'restartMsg' },
          { id: 'panicBtn', label: '紧急关闭', variant: 'danger', status: 'panicMsg' },
        ],
      },
      {
        name: 'maintenanceNote',
        type: 'custom',
        span: 2,
        html: '<div class="meta">由守护窗口启动时，重启后 5 秒自动恢复；「清空所有会话」在「会话与审批」页的表格工具栏。紧急关闭会立即回到 L0 群友模式，并停止进行中的高权限会话（不可撤销）。</div>',
      },
    ],
  },
  notify: {
    fields: [
      {
        name: 'notifyNote',
        type: 'custom',
        span: 2,
        html: '<div class="meta">直接向指定 QQ 会话的 DSH agent 投递一条「后台控制端提醒」，用于给 AI 引导/提醒；该消息不是群友消息。二代模式（reserved2）下会自动附带会话令牌和二代工具协议说明，AI 的文本输出不会自动转发，发言需通过发送工具。</div>',
      },
      {
        name: 'notifyTarget',
        type: 'custom',
        label: '目标',
        span: 2,
        html: TARGET_ROW('aiNotifyKind', 'aiNotifyId', '群号 / QQ 号'),
      },
      {
        name: 'aiNotifyMessage',
        type: 'textarea',
        label: '提醒内容',
        rows: 4,
        placeholder: '例如：接下来群里聊到某个话题时，你可以更主动一点；或：先潜水，等我叫你。',
        span: 2,
      },
      {
        type: 'action',
        id: 'notifyActions',
        items: [{ id: 'aiNotifySend', label: '发送到 DSH', variant: 'primary' }],
        status: 'aiNotifyMsg',
      },
    ],
  },
};
