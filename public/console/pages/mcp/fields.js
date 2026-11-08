// MCP 页：内置 server 概览 + 外部 MCP 管理 + 工具参考。
// 控件由规格生成；外部 MCP 的编辑弹窗复用同一套 form 组件。
export const MCP_FIELDS = {
  main: {
    fields: [
      {
        type: 'action',
        id: 'mcpActions',
        items: [
          { id: 'mcpRefresh', label: '刷新' },
          { id: 'mcpNew', label: '新增 MCP', variant: 'primary' },
        ],
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
  edit: {
    fields: [
      { name: 'mcpEditId', type: 'text', label: 'ID', hint: '小写字母开头，2–40 位小写字母/数字/短横线；保存后不可改', required: true },
      { name: 'mcpEditName', type: 'text', label: '名称' },
      { name: 'mcpEditDescription', type: 'text', label: '说明' },
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
      { name: 'mcpEditCommand', type: 'text', label: '命令', hint: 'stdio：node / npx / python 等（默认 allowlist）' },
      { name: 'mcpEditArgs', type: 'textarea', label: '参数', rows: 3, hint: 'stdio：每行一个参数' },
      { name: 'mcpEditUrl', type: 'text', label: 'URL', hint: 'HTTP/SSE 地址；默认要求 https' },
      { name: 'mcpEditTimeout', type: 'number', label: '调用超时 ms', min: 1000, max: 300000, step: 1000 },
      { name: 'mcpEditEnabled', type: 'switch', label: '启用', default: true, onLabel: '开', offLabel: '关' },
      { name: 'mcpEditAllowArbitrary', type: 'switch', label: '允许任意命令', default: false, onLabel: '是', offLabel: '否' },
      { name: 'mcpEditAllowPrivate', type: 'switch', label: '允许私网 HTTP', default: false, onLabel: '是', offLabel: '否' },
      { name: 'mcpEditSecrets', type: 'textarea', label: '秘密', rows: 3, hint: '每行 name=value；只写入 state/extensions/secrets.json，不写 server.json' },
      { name: 'mcpEditEnv', type: 'textarea', label: '环境变量', rows: 3, hint: '每行 KEY=secret:name；stdio 使用' },
      { name: 'mcpEditHeaders', type: 'textarea', label: '请求头', rows: 3, hint: '每行 Header=secret:name；HTTP 使用' },
    ],
  },
};
