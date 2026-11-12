// 运行方案页字段规格：只描述控件，值由 page.js 回填。
// 运行方案已并入「行为档案 › 运行方案」标签，切换卡与全局指针一起移除。
export const RUNTIME_FIELDS = {
  summary: {
    fields: [
      { name: 'runtimeSummary', type: 'custom', span: 2, html: '<div class="row" id="runtimeSummary"></div>' },
    ],
  },
  table: {
    fields: [
      { name: 'runtimeTable', type: 'custom', span: 2, html: '<div id="runtimeTable"></div>' },
    ],
  },
};
