// MCP 页：只读清单。控件全部由规格生成，页面只留卡片与宿主 div。
export const MCP_FIELDS = {
  main: {
    fields: [
      {
        type: 'action',
        id: 'mcpActions',
        items: [{ id: 'mcpRefresh', label: '刷新' }],
        status: 'mcpMeta',
      },
      {
        name: 'mcpListHost',
        type: 'custom',
        span: 2,
        html: '<div id="mcpList">加载中…</div>',
      },
    ],
  },
};
