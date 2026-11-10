// 运行方案页字段规格：只描述控件，值由 page.js 回填。
export const RUNTIME_FIELDS = {
  summary: {
    fields: [
      { name: 'runtimeSummary', type: 'custom', span: 2, html: '<div class="row" id="runtimeSummary"></div>' },
    ],
  },
  switch: {
    fields: [
      {
        name: 'runtimePlan',
        type: 'select',
        label: '运行方案',
        options: [],
        hint: '切换即时生效；Agent · 高权限需要 TOTP 动态码。',
      },
      {
        name: 'runtimeTotp',
        type: 'text',
        label: 'TOTP',
        placeholder: '6 位动态码',
        hint: '只有 Agent · 高权限需要；其余方案留空即可。',
      },
      {
        name: 'runtimeApply',
        type: 'action',
        items: [{ id: 'runtimeSwitch', label: '切换方案', variant: 'primary', status: 'runtimeMsg' }],
      },
    ],
  },
  table: {
    fields: [
      { name: 'runtimeTable', type: 'custom', span: 2, html: '<div id="runtimeTable"></div>' },
    ],
  },
  caps: {
    fields: [
      { name: 'runtimeCaps', type: 'custom', span: 2, html: '<div id="runtimeCaps"></div>' },
    ],
  },
};
