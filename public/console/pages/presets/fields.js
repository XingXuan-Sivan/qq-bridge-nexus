// 预设页字段规格：主列表 + 内联编辑卡（元数据 / 扩展授权 / YAML 高级编辑）。
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
        label: '扩展授权',
        hint: 'extensions.yml：决定该预设能看见哪些外部 MCP 与技能；留空列表表示全部拒绝。',
        card: true,
      },
      {
        name: 'presetAuthPicker',
        type: 'custom',
        span: 2,
        html: '<div id="presetAuthPicker" class="preset-picker">正在读取真实 MCP / 技能目录…</div>',
      },
      {
        name: 'presetEditMcpAllow',
        type: 'textarea',
        label: '允许 MCP',
        rows: 3,
        mono: true,
        placeholder: 'server-id 或 *',
        hint: '每行一个 server id；* 表示全部。',
      },
      {
        name: 'presetEditSkillsAllow',
        type: 'textarea',
        label: '允许技能',
        rows: 3,
        mono: true,
        placeholder: 'skill-id 或 *',
        hint: '每行一个技能 id；* 表示全部。',
      },
      {
        name: 'presetEditMcpToolsAllow',
        type: 'textarea',
        label: '允许工具',
        rows: 3,
        mono: true,
        placeholder: 'tool-name 或 *',
        hint: '每行一个 MCP 工具名；留空表示不额外放行。',
      },
      {
        name: 'presetEditMcpToolsDeny',
        type: 'textarea',
        label: '禁用工具',
        rows: 3,
        mono: true,
        placeholder: 'tool-name',
        hint: 'deny 优先于 allow。',
      },
      {
        name: 'presetPromptSlot',
        type: 'custom',
        span: 2,
        html: '<div id="presetPromptMount"></div>',
      },
      {
        type: 'section',
        label: '插件配置',
        hint: '按 agent.cordis.yml 的插件行逐项编辑；保存后仍要「应用并安装」才会进入 DSH。',
        card: true,
      },
      {
        name: 'presetAgentForm',
        type: 'custom',
        span: 2,
        html: '<div id="presetAgentForm" class="agent-form-panel"></div>',
      },
      {
        type: 'section',
        label: '危险能力',
        hint: '当前 DSH 守卫是所有预设共用的一份 qq-tool-restrict；原生 read/write/pwsh 等工具不能按预设声明放行。需要高权限时请使用仓库里的 L1/L2/L3 运维预设。',
        card: true,
      },
    ],
  },

  // 新建预设：复制一个现有预设作为起点，id 即目录名。
  // 仿真提示词：跟随当前预设的 persona.prefix。放在编辑卡里、YAML 高级编辑上方，
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
