// 技能页字段规格：主列表 + 编辑弹窗 + ZIP 导入弹窗。
// 所有控件走统一表单；技能正文保留完整 SKILL.md（含 frontmatter），前端不重排 YAML。
export const SKILLS_FIELDS = {
  main: {
    fields: [
      {
        name: 'skillsListHost',
        type: 'custom',
        span: 2,
        html: '<div id="skillsList">加载中…</div>',
      },
    ],
  },
  edit: {
    fields: [
      {
        type: 'section',
        label: '技能',
        hint: '正文是完整 SKILL.md；frontmatter 必须是 name / description，导入与保存都会校验。',
        card: true,
      },
      {
        name: 'skillEditId',
        type: 'text',
        label: 'ID',
        placeholder: '小写字母开头，例如 group-helper',
        hint: '保存后不可修改；只用于外部技能目录名。',
      },
      {
        name: 'skillEditContent',
        type: 'textarea',
        label: 'SKILL.md',
        rows: 18,
        mono: true,
        span: 2,
        placeholder: '---\nname: 技能名\ndescription: 一句话说明\n---\n\n这里写技能正文。',
        hint: '保存时会按 frontmatter 校验；只读来源的正文不能改。',
      },
    ],
  },
  import: {
    fields: [
      {
        type: 'section',
        label: '导入 ZIP',
        hint: '压缩包内放一个 SKILL.md（根目录或一级目录均可），其它文件会一并解压到该技能目录。',
        card: true,
      },
      {
        name: 'skillImportId',
        type: 'text',
        label: 'ID',
        placeholder: '留空则用压缩包一级目录名',
        hint: '可选；同名技能已存在时会拒绝覆盖。',
      },
      {
        name: 'skillImportFileHost',
        type: 'custom',
        span: 2,
        html: '<div class="field-row"><span class="field-label">ZIP 文件</span><div class="field-control"><input type="file" id="skillImportFile" accept=".zip,application/zip"></div></div>',
      },
    ],
  },
};
