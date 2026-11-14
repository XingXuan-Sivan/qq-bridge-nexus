// 平台页的静态字段：行为档案清单的宿主与「基本信息」（备注）。
// 动态的 v1/v2 表单由 behavior-form.js 按后端 kind 注册表生成，不在这里。
// 提示词由统一的提示词卡片组件（components/prompt-card）渲染，按钮也不在这里写。
export const BEHAVIOR_FIELDS = {
  list: {
    fields: [
      { name: 'behaviorTable', type: 'custom', span: 2, html: '<div id="behaviorTable"></div>' },
    ],
  },
  basics: {
    fields: [
      {
        name: 'behaviorFormLabel',
        type: 'text',
        label: '备注',
        maxlength: 40,
        hint: '只影响显示备注；文件仍按档案 id 保存。',
      },
    ],
  },
};
