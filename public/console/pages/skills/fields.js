// 技能页：只读清单。控件全部由规格生成，页面只留标题、说明与宿主 div。
export const SKILLS_FIELDS = {
  main: {
    fields: [
      {
        type: 'action',
        id: 'skillsActions',
        items: [{ id: 'skillsRefresh', label: '刷新' }],
        status: 'skillsMeta',
      },
      {
        name: 'skillsListHost',
        type: 'custom',
        span: 2,
        html: '<div id="skillsList">加载中…</div>',
      },
    ],
  },
};
