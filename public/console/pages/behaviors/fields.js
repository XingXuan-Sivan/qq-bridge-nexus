// 命令页：桥接命令注册表；权限与启用状态就地修改。
// 页面只留说明与宿主；工具条与表格宿主都在这里生成，id 与迁移前保持一致。

const TOOLBAR_HTML = `<div class="table-toolbar">
  <div class="table-toolbar-main">
    <button type="button" class="btn" id="behaviorsRefresh">刷新</button>
    <select class="table-filter" id="behaviorsFilter">
      <option value="all">全部来源</option>
      <option value="bridge">仅内置</option>
      <option value="plugin">仅插件</option>
    </select>
    <select class="table-filter" id="behaviorsPermission">
      <option value="">全部权限</option>
      <option value="owner">owner</option>
      <option value="admin">admin</option>
      <option value="all">所有人</option>
    </select>
    <input type="search" class="search-box search-box--w240" id="behaviorsSearch" placeholder="搜索命令或说明…">
  </div>
  <span class="table-toolbar-meta" id="behaviorsMeta">加载中…</span>
</div>`;

export const BEHAVIORS_FIELDS = {
  toolbar: { html: TOOLBAR_HTML },
  bridge: {
    html: `<div id="behaviorsBridge" hidden></div>
<div id="behaviorsEmpty" class="meta" hidden>没有匹配的命令，换个筛选或关键词试试。</div>`,
  },
};
