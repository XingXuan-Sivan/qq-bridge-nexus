// 行为档案页的静态字段：清单动作、选择档案（下拉 + 刷新）、两处提示词编辑区。
// 动态的 v1/v2 表单由 behavior/behavior-form.js 按 schema 生成，不在这里。
export const BEHAVIOR_FIELDS = {
  list: {
    fields: [
      { name: 'behaviorTable', type: 'custom', span: 2, html: '<div id="behaviorTable"></div>' },
      {
        name: 'behaviorListActions',
        type: 'action',
        items: [
          { id: 'behaviorCreate', label: '新建' },
          { id: 'behaviorClone', label: '克隆' },
          { id: 'behaviorDelete', label: '删除', variant: 'danger' },
        ],
      },
    ],
  },
  main: {
    fields: [
      {
        name: 'behaviorPicker',
        type: 'custom',
        label: '选择档案',
        html: `<div class="control-row">
  <select id="behaviorFormSelect" class="u-w-190"></select>
  <button class="btn" type="button" id="behaviorFormRefresh">刷新</button>
</div>`,
        hint: '档案保存在 config/behaviors；预设用 preset.yml 的 behavior 引用它，未绑定时用全局配置里的「默认行为档案」。',
      },
      {
        name: 'behaviorFormLabel',
        type: 'text',
        label: '名称',
        maxlength: 40,
        hint: '只影响显示名；文件仍按档案 id 保存。',
      },
    ],
  },
  prompt: {
    fields: [
      { name: 'behaviorPromptEditor', type: 'custom', span: 2, html: '<div id="behaviorPromptEditor"></div>' },
      {
        name: 'behaviorPromptActions',
        type: 'action',
        items: [{ id: 'behaviorPromptSave', label: '保存提示词', variant: 'primary' }],
        status: 'behaviorPromptMsg',
      },
    ],
  },
  platform: {
    fields: [
      {
        name: 'platformPromptSelect',
        type: 'custom',
        label: '平台',
        html: '<select id="platformPromptId" class="u-w-190"></select>',
      },
      { name: 'platformPromptEditor', type: 'custom', span: 2, html: '<div id="platformPromptEditor"></div>' },
      {
        name: 'platformActions',
        type: 'action',
        items: [
          { id: 'platformSave', label: '保存', variant: 'primary' },
          { id: 'platformRestore', label: '还原出厂' },
        ],
        status: 'platformMsg',
      },
    ],
  },
};
