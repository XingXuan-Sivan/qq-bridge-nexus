// 命令与工具：桥接命令注册表（含迁移状态）+ 只读的 DSH 会话命令与 Agent 工具。
// 页面只留说明与宿主；工具条、三块表格宿主都在这里生成，id 与迁移前保持一致。

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
  dsh: {
    html: `<h3 class="u-mt-18">DSH 会话命令 <span class="meta">只读</span></h3>
<div id="behaviorsDsh">加载中…</div>`,
  },
  tools: {
    html: `<h3 class="u-mt-18">Agent 工具 <span class="meta">只读</span></h3>
<div id="behaviorsTools">加载中…</div>`,
  },
};
