// 行为档案页的静态字段：选择档案（下拉 + 刷新）与显示名。
// 动态的 v1/v2 表单由 behavior/behavior-form.js 按 schema 生成，不在这里。
export const BEHAVIOR_FIELDS = {
  list: {
    fields: [
      { name: 'behaviorTable', type: 'custom', span: 2, html: '<div id="behaviorTable"></div>' },
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
};
