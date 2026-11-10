// 预设页字段规格：主列表 + 内联编辑卡（元数据 / 扩展授权 / 插件配置）。
//
// 扩展授权是两张页面级卡片：MCP（服务器表 + 工具表联动）与技能。
// 卡里只放 custom 槽位，表格由 page.js 按 /api/extensions 的真实目录渲染；
// 这里不再出现要手填的 allow/deny 文本框。
export const PRESETS_FIELDS = {
  main: {
    fields: [
      {
        name: 'presetListHost',
        type: 'custom',
        span: 2,
        html: '<div id="presetList">加载中…</div>',
      },
    ],
  },
  edit: {
    fields: [
      {
        type: 'section',
        label: '基本信息',
        hint: 'preset.yml：控制台显示名、说明与排序；保存后需要「应用」才会进入 DSH。',
        card: true,
      },
      { name: 'presetEditName', type: 'text', label: '名称', span: 2 },
      { name: 'presetEditDescription', type: 'text', label: '说明', span: 2 },
      { name: 'presetEditOrder', type: 'number', label: '排序', hint: '数字越小越靠前。' },

      {
        type: 'section',
        label: '扩展授权 · MCP',
        hint: 'extensions.yml 的 mcp.allow 与 mcp.tools.allow / deny：先勾选服务器（一个都不勾表示全部拒绝），下面的工具表只列已勾选服务器的工具，勾上=允许、不勾=拒绝（拒绝优先）。',
        card: true,
      },
      {
        name: 'presetMcpServers',
        type: 'custom',
        span: 2,
        html: '<div class="preset-auth" id="presetMcpServers">正在读取 MCP 目录…</div>',
      },
      {
        name: 'presetMcpTools',
        type: 'custom',
        span: 2,
        html: '<div class="preset-auth preset-auth-tools" id="presetMcpTools">正在读取 MCP 目录…</div>',
      },

      {
        type: 'section',
        label: '扩展授权 · 技能',
        hint: 'extensions.yml 的 skills.allow：勾选这个预设能加载的技能；一个都不勾表示全部拒绝。',
        card: true,
      },
      {
        name: 'presetSkills',
        type: 'custom',
        span: 2,
        html: '<div class="preset-auth" id="presetSkills">正在读取技能目录…</div>',
      },

      {
        type: 'section',
        label: '仿真提示词',
        hint: '本预设 persona.prefix：规定 AI 怎么调工具、怎么参与群聊。保存会写回源文件，重启 DSH 生效。',
        card: true,
      },
      {
        name: 'presetPromptSlot',
        type: 'custom',
        span: 2,
        html: '<div id="presetPromptMount"></div>',
      },

      {
        type: 'section',
        label: '高级配置',
        hint: 'agent.cordis.yml 全文（含 persona 提示词，那段也可以在上面的「仿真提示词」卡里改）。平时收起；保存时后端会校验语法与必填插件行，保存后仍要「应用并安装」才会进入 DSH。',
        card: true,
        collapsed: true,
      },
      {
        name: 'presetAgentYamlHead',
        type: 'custom',
        span: 2,
        html: '<span class="meta" id="presetAgentYamlStatus">加载中…</span>',
      },
      {
        name: 'presetAgentYamlText',
        type: 'textarea',
        label: '',
        rows: 18,
        mono: true,
        span: 2,
        readonly: true,
        className: 'code-editor-field',
      },
      {
        type: 'action',
        id: 'presetAgentYamlActions',
        items: [
          { id: 'agentYamlEdit', label: '编辑' },
          { id: 'agentYamlSave', label: '保存 YAML', variant: 'primary' },
          { id: 'agentYamlCancel', label: '取消' },
        ],
        status: 'agentYamlMsg',
      },

      {
        type: 'section',
        label: '危险能力',
        hint: '当前 DSH 守卫是所有预设共用的一份 qq-tool-restrict；原生 read/write/pwsh 等工具不能按预设声明放行。需要高权限时请使用仓库里的 L1/L2/L3 运维预设。',
        card: true,
      },
    ],
  },

  // 仿真提示词：跟随当前预设的 persona.prefix。放在编辑卡里、插件配置上方，
  // 控件仍走统一的字段渲染（页面里不手写 input/textarea/button）。
  simPrompt: {
    fields: [
      {
        type: 'custom',
        name: 'simPromptHead',
        span: 2,
        html: '<span class="meta" id="presetPromptStatus">加载中…</span>',
      },
      {
        type: 'textarea',
        name: 'simPromptText',
        label: '',
        rows: 16,
        mono: true,
        span: 2,
        readonly: true,
        className: 'code-editor-field',
      },
      {
        type: 'action',
        id: 'simPromptActions',
        items: [
          { id: 'simPromptEdit', label: '编辑' },
          { id: 'simPromptSave', label: '保存提示词', variant: 'primary' },
          { id: 'simPromptCancel', label: '取消' },
          { id: 'simPromptReset', label: '还原初始提示词' },
        ],
        status: 'simPromptMsg',
      },
      {
        type: 'custom',
        name: 'simPromptWarnings',
        span: 2,
        html: '<p class="meta" id="simPromptWarnings"></p>',
      },
    ],
  },
};
