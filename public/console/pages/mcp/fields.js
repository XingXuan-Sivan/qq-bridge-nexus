// MCP 页：内置 server 概览 + 外部 MCP 管理 + 工具参考。
// 控件由规格生成；外部 MCP 的编辑弹窗复用同一套 form 组件。
export const MCP_FIELDS = {
  main: {
    fields: [
      {
        name: 'mcpListHost',
        type: 'custom',
        span: 2,
        html: '<div id="mcpList">加载中…</div>',
      },
    ],
  },
  edit: {
    fields: [
      { type: 'section', card: true, label: '基本信息', hint: 'ID 保存后不可修改；名称只用于控制台显示。' },
      { name: 'mcpEditId', type: 'text', label: 'ID', hint: '小写字母开头，2–40 位小写字母/数字/短横线', required: true },
      { name: 'mcpEditName', type: 'text', label: '名称' },
      { name: 'mcpEditDescription', type: 'text', label: '说明', span: 2 },
      { name: 'mcpEditEnabled', type: 'switch', label: '启用', default: true, onLabel: '开', offLabel: '关' },

      { type: 'section', card: true, label: '连接', hint: '连接方式决定配置模板，切换后会自动套用对应模板；不同方式只显示自己需要的选项。' },
      {
        name: 'mcpEditTransport',
        type: 'select',
        label: '连接方式',
        options: [
          { value: 'stdio', label: 'stdio（本机命令）' },
          { value: 'streamable_http', label: 'Streamable HTTP' },
          { value: 'sse', label: 'SSE（旧）' },
        ],
      },
      { name: 'mcpEditTimeout', type: 'number', label: '调用超时 ms', min: 1000, max: 300000, step: 1000 },
      {
        name: 'mcpEditConfig',
        type: 'textarea',
        label: '连接配置',
        rows: 8,
        mono: true,
        span: 2,
        hint: 'stdio 填 command / args / env；HTTP 与 SSE 填 url / headers。env 与 headers 的值用 secret:name 引用凭据。',
      },
      { name: 'mcpEditAllowArbitrary', type: 'switch', label: '允许任意命令', default: false, onLabel: '是', offLabel: '否' },
      { name: 'mcpEditAllowPrivate', type: 'switch', label: '允许私网 HTTP', default: false, onLabel: '是', offLabel: '否' },

      { type: 'section', card: true, label: '凭据', hint: '秘密只写入 state/extensions/secrets.json，不写进 server.json。编辑时留空表示保持已有凭据不变。' },
      {
        name: 'mcpEditSecrets',
        type: 'textarea',
        label: '凭据',
        rows: 3,
        span: 2,
        placeholder: '例如：\napiKey=sk-...\nauthorization=Bearer ...',
        hint: '每行 name=value；在连接配置里用 secret:name 引用。',
      },
    ],
  },
};
