// 人格页字段：只负责工具条；卡片墙、编辑弹窗与操作都在 page.js 里生成。
// 「注入上限 / 生效方式」已搬到「全局配置 › 人格提示词」，这里不再重复一份。

const toolbarHtml = () => `
  <div class="table-toolbar">
    <div class="table-toolbar-main">
      <input id="roleSearch" class="search-input" type="search" placeholder="搜索人格名或说明…" aria-label="搜索人格">
      <select id="roleFilter" class="u-w-190" aria-label="按来源筛选">
        <option value="all">全部人格</option>
        <option value="local">内部人格</option>
        <option value="provider">外部人格</option>
        <option value="cached">仅缓存</option>
      </select>
    </div>
    <div class="table-toolbar-side">
      <button class="btn small" id="roleRefresh" type="button">刷新</button>
      <button class="btn primary" id="roleNew" type="button">新建人格</button>
    </div>
  </div>`;

export const PERSONA_FIELDS = {
  toolbar: {
    fields: [{ name: 'roleToolbar', type: 'custom', span: 2, html: toolbarHtml() }],
  },
};
