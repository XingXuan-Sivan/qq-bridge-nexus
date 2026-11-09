// 人格与角色页的字段规格：page.js 的 init() 第一件事是把这里渲染进 page.html 的
// 每个 [data-persona-fields] 宿主。id 全是页面长期依赖的老 id（脚本、测试、QQ 命令都用），
// 迁移时只改「谁来写这些控件」，不改 id。
//
// 约定：
// - 字段用 name（renderFields 据此生成 id / name / data-field），不要用 id；
// - 动作项用 id/label/variant（inlineActions 读 label，不读 text）；
// - 纯列表、复合行用 custom，但内部控件必须是公共类：.control-row / .control-grow /
//   .control-label / .control-note / .btn / .status-badge，不要另写样式。

export const PERSONA_FIELDS = {
  // ── 编辑人格提示词 ────────────────────────────────────────────────────────
  edit: {
    fields: [
      {
        type: 'custom',
        name: 'roleEditorMeta',
        span: 2,
        html: '<div class="meta" id="roleEditorMeta">当前是「新建」模式：填好名称与内容后点「新建人格」。</div>',
      },
      {
        type: 'custom',
        name: 'roleInjectMaxPanel',
        label: '注入上限（字符）',
        span: 2,
        html: `<div class="control-row">
  <input class="control-fixed u-w-140" type="number" id="roleInjectMax" min="1000" max="20000" step="500">
  <button type="button" class="btn" id="roleInjectMaxSave">保存上限</button>
  <span class="control-note" id="roleInjectMaxMsg">每条约 4~6k token 的成本护栏；按模式筛完小节后才截断。</span>
</div>`,
      },
      {
        type: 'text',
        name: 'newRoleName',
        label: '人格名',
        placeholder: '如：猫娘',
        hint: '中文 / 字母 / 数字 / 横线；改名会同时重命名 roles/ 里的文件。',
        span: 2,
      },
      {
        type: 'textarea',
        name: 'newRoleContent',
        label: '人格提示词（Markdown）',
        placeholder: '- 性格：…\n- 说话风格：…\n- 背景设定：…',
        rows: 12,
        className: 'role-editor',
        span: 2,
        hint: '这一段会拼在仿真提示词之后，决定「AI 是谁、怎么说话」。保存即生效。',
      },
      {
        type: 'action',
        id: 'roleEditActions',
        items: [
          { id: 'roleCreate', label: '新建人格', variant: 'primary' },
          { id: 'roleDuplicate', label: '另存为副本' },
          { id: 'roleDelete', label: '删除', variant: 'danger' },
          { id: 'roleFormReset', label: '清空表单' },
        ],
        status: 'roleCreateMsg',
      },
      {
        type: 'radio',
        name: 'roleSaveApply',
        label: '生效方式',
        value: 'nextWake',
        options: [
          { value: 'nextWake', label: '下次唤醒时重新读卡' },
          { value: 'immediate', label: '立即生效（现在就唤醒各会话读新卡）' },
        ],
        span: 2,
        hint: '只对正在启用的人格起作用；编辑其它人格时这里不影响任何会话。',
      },
      {
        type: 'custom',
        name: 'roleEditorWarnings',
        span: 2,
        html: '<div class="meta err" id="roleEditorWarnings"></div>',
      },
    ],
  },

  // ── 切换当前启用的人格 ────────────────────────────────────────────────────
  toolbar: {
    fields: [
      {
        type: 'custom',
        name: 'roleToolbar',
        span: 2,
        html: `<div class="table-toolbar">
  <div class="table-toolbar-main">
    <input id="roleSearch" class="search-input" type="search" placeholder="搜索人格名或说明…" aria-label="搜索人格">
    <select id="roleFilter" class="u-w-190" aria-label="筛选人格">
      <option value="all">全部人格</option>
      <option value="used">已用于会话</option>
      <option value="unused">未使用</option>
    </select>
  </div>
  <div class="table-toolbar-side">
    <button type="button" class="btn" id="roleRefresh">刷新</button>
    <button type="button" class="btn primary" id="roleNew">新建人格</button>
  </div>
</div>`,
      },
    ],
  },

  // ── 按会话设置人格（入口已迁到会话与审批页，这里不再生成控件） ────────────

  // ── 人格来源（只读） ──────────────────────────────────────────────────────
  sources: {
    fields: [
      {
        type: 'action',
        id: 'personaSourceActions',
        items: [{ id: 'personaSourceRefresh', label: '刷新' }],
        status: 'personaSourceMeta',
      },
      {
        type: 'custom',
        name: 'personaSourceList',
        span: 2,
        html: '<div class="u-mt-8" id="personaSourceList">加载中…</div>',
      },
    ],
  },

  // ── 恢复默认人格：并入列表每一行的「恢复初始」操作，不再单独一组 ──────────

  // ── 外部人格编辑弹窗（provider 侧角色卡；只开放覆盖与角色追加） ─────────────
  externalEditor: {
    fields: [
      {
        type: 'text',
        name: 'extName',
        label: '人格名',
        readonly: true,
        hint: '来自 soulkit 的角色卡；改名在下方「新名字」里操作。',
        span: 2,
      },
      {
        type: 'text',
        name: 'extNewName',
        label: '新名字',
        placeholder: '留空表示不改名',
        hint: '只改显示名与目录名，不改 soul；改名后请点「改名」。',
        span: 2,
      },
      {
        type: 'text',
        name: 'extSaveAsName',
        label: '另存为名字',
        hint: '点「另存为内部人格」时写进 roles/<名字>.md；同名会先备份。',
        span: 2,
      },
      {
        type: 'textarea',
        name: 'extDescription',
        label: '描述',
        rows: 2,
        maxlength: 500,
        span: 2,
      },
      {
        type: 'textarea',
        name: 'extOverlay',
        label: '世界内覆盖',
        rows: 8,
        mono: true,
        maxlength: 20000,
        span: 2,
        hint: '写进这张卡的 overlay.md：当前世界的额外设定，拼在 soul 提示词之前。',
      },
      {
        type: 'textarea',
        name: 'extSystemAppend',
        label: '角色追加',
        rows: 5,
        mono: true,
        maxlength: 2000,
        span: 2,
        hint: '写进这张卡的 persona.systemAppend：拼在 soul 提示词之后，适合放这个角色额外的口径。',
      },
      {
        type: 'action',
        id: 'extActions',
        items: [
          { id: 'extSave', label: '保存到 soulkit', variant: 'primary' },
          { id: 'extRename', label: '改名' },
          { id: 'extSaveAs', label: '另存为内部人格' },
          { id: 'extClose', label: '关闭' },
        ],
        status: 'extMsg',
      },
    ],
  },
};
