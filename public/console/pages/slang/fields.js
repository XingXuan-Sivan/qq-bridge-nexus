// 黑话词库页的字段规格（2026-11-07 迁移）。
// - config：黑话系统参数，折叠在 settings-group 里；
// - add：手动添加词条的表单，宿主在 index.html 的 #slangAddOverlay 弹窗里；
// - tabs / bar*：分栏切换与三个分栏的批量操作条，用 html 原样注入（它们不是字段，是工具栏）。
// 约定：字段用 name（renderFields 拿它当控件 id），动作项用 id/label/variant。
const TABS_HTML = `<div class="slang-tabs">
  <button class="slang-tab active" type="button" data-slang-tab="candidate" title="还没有含义 / 用法 / 示例的候选">候选词-待研究 <span class="meta" id="slangCountPending"></span></button>
  <button class="slang-tab" type="button" data-slang-tab="researched" title="已有含义 / 用法 / 示例（研究结果或手填），等你确认或拒绝">候选词-已研究 <span class="meta" id="slangCountResearched"></span></button>
  <button class="slang-tab" type="button" data-slang-tab="confirmed">已确认</button>
  <button class="slang-tab" type="button" data-slang-tab="rejected">已拒绝</button>
</div>`;

const bar = (status, buttons) => `<div class="slang-bar">
  <label class="slang-check"><input type="checkbox" id="${status}SelectAll"> 全选本页</label>
  ${buttons}
</div>`;

export const SLANG_FIELDS = {
  tabs: { html: TABS_HTML },
  listActions: {
    html: `<div class="row-actions"><button class="btn" id="slangAddOpen" type="button">手动添加</button></div>`,
  },
  barCandidate: {
    html: bar('slangCandidate', `
    <button class="btn small" id="slangBatchResearch" type="button">批量送研究</button>
    <button class="btn small" id="slangBatchConfirm" type="button">批量确认</button>
    <button class="btn small" id="slangBatchReject" type="button">批量拒绝</button>
    <button class="btn small danger" id="slangBatchDeleteCand" type="button">批量删除</button>
    <span class="slang-bar-sep"></span>
    <button class="btn small" id="slangExtract" type="button">立即提取候选</button>
    <button class="btn small" id="slangResearch" type="button">研究全部候选</button>`),
  },
  barConfirmed: {
    html: bar('slangConfirmed', `<button class="btn small danger" id="slangBatchDeleteConfirmed" type="button">批量删除已确认</button>`),
  },
  barRejected: {
    html: bar('slangRejected', `
    <button class="btn small" id="slangBatchRestore" type="button">恢复为候选</button>
    <button class="btn small danger" id="slangBatchDeleteRejected" type="button">批量删除已拒绝</button>`),
  },
  config: {
    fields: [
      {
        name: 'slangEnabled',
        type: 'switch',
        label: '启用黑话学习',
        hint: '关闭后不再自动提取候选，也不会把黑话注入 AI 上下文。',
      },
      {
        name: 'slangExtractMin',
        type: 'number',
        label: '触发提取最少消息数',
        min: 1,
        unit: '条',
        hint: '攒够这么多条新消息才跑一次提取，太小会让 DSH 频繁开会话。',
      },
      {
        name: 'slangCooldown',
        type: 'number',
        label: '提取冷却',
        min: 0,
        step: 1000,
        unit: '毫秒',
        hint: '两次提取之间的最小间隔；300000 即 5 分钟。',
      },
      {
        name: 'slangThresholds',
        type: 'text',
        label: '研究触发阈值',
        placeholder: '2,4,8',
        hint: '逗号分隔：某个候选被提到第 2、4、8 次时自动送 DSH 深度研究。',
      },
      {
        name: 'slangInjectMax',
        type: 'number',
        label: '注入最大条数',
        min: 1,
        max: 30,
        unit: '条',
        hint: '每次注入提示词最多带几条已确认黑话；太多会挤占上下文。',
      },
      {
        name: 'slangLearnerPreset',
        type: 'text',
        label: '学习会话 preset',
        placeholder: 'qq-chat',
        hint: '送研究时用哪个 DSH 预设开会话，一般保持 qq-chat。',
      },
      {
        name: 'slangWorkspaceTitle',
        type: 'text',
        label: '学习工作区名',
        placeholder: 'QQ 黑话学习',
      },
      {
        name: 'slangAutoResearch',
        type: 'switch',
        label: '自动联网研究',
        hint: '候选达到阈值时自动送研究，不用手动点「研究全部候选」。',
      },
      {
        type: 'action',
        id: 'slangConfigActions',
        items: [{ id: 'slangConfigSave', label: '保存黑话参数', variant: 'primary' }],
        status: 'slangConfigMsg',
      },
    ],
  },
  add: {
    fields: [
      {
        name: 'slangContent',
        type: 'text',
        label: '词条',
        placeholder: '绝绝子',
        required: true,
        hint: '要收录的词或短语本身。',
      },
      {
        name: 'slangMeaning',
        type: 'text',
        label: '含义',
        placeholder: '很好、很棒',
        required: true,
        hint: '填了含义才会注入 AI 上下文；只写词条不填含义会留在「待研究」。',
      },
      {
        name: 'slangUsage',
        type: 'text',
        label: '用法',
        placeholder: '用于夸赞，多带夸张语气',
      },
      {
        name: 'slangExample',
        type: 'text',
        label: '示例',
        placeholder: '这波操作绝绝子',
      },
    ],
  },
};
