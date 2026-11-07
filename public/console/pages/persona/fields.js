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
  switch: {
    fields: [
      {
        type: 'custom',
        name: 'roleSwitchPanel',
        label: '人格名',
        span: 2,
        html: `<div class="control-row">
  <input class="control-grow" type="text" id="roleInput" placeholder="选择已有角色或输入新角色名" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="roleSuggest">
  <button type="button" class="btn" id="roleSet">设置</button>
  <button type="button" class="btn" id="roleClear">清除</button>
</div>
<ul id="roleSuggest" class="role-suggest" role="listbox" aria-label="已有人格" hidden></ul>`,
      },
      {
        type: 'radio',
        name: 'roleApply',
        label: '生效方式',
        value: 'nextWake',
        options: [
          { value: 'nextWake', label: '下次唤醒时重新读卡' },
          { value: 'immediate', label: '立即切换（现在就唤醒各会话读新卡）' },
        ],
        span: 2,
        hint: '二代仿真的会话只在建立时读一次完整角色卡；切换、清除或修改当前人格后，桥接会把新卡写进各会话下一次的唤醒提示里。',
      },
      {
        type: 'custom',
        name: 'roleApplyResult',
        span: 2,
        html: '<div class="meta" id="roleApplyResult" hidden></div>',
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

  // ── 恢复默认人格 ──────────────────────────────────────────────────────────
  defaults: {
    fields: [
      {
        type: 'custom',
        name: 'roleDefaultsList',
        span: 2,
        html: '<div id="roleDefaultsList" class="role-defaults u-mt-8">加载中…</div>',
      },
      {
        type: 'custom',
        name: 'roleDefaultsMsg',
        span: 2,
        html: '<div class="meta" id="roleDefaultsMsg"></div>',
      },
    ],
  },

  // ── 仿真提示词（预设内置） ────────────────────────────────────────────────
  sim: {
    fields: [
      {
        type: 'custom',
        name: 'simPromptHead',
        label: '仿真代次',
        span: 2,
        html: `<div class="control-row">
  <span class="control-fixed u-flex-basis-max-280"><select id="simPromptPreset">
    <option value="qq-chat-v2">二代仿真（reserved2 · qq-chat-v2）</option>
    <option value="qq-chat">一代仿真（reserved · qq-chat）</option>
  </select></span>
  <span class="status-badge is-pill" id="simPromptStatus">加载中…</span>
  <span class="control-note">两代机制不同（一代空格分条 / 二代一切皆工具），提示词各自独立。</span>
</div>`,
      },
      {
        type: 'textarea',
        name: 'simPromptText',
        rows: 20,
        // 不要再用 .code-area：它是「带边框和内边距的容器」类，挂到 field-block 上会形成
        // 「外层容器一个框 + textarea 自己一个框」的双层边框。样式走 .field-block--code 里的 textarea 规则。
        className: 'field-block--code',
        spellcheck: false,
        readonly: true,
        span: 2,
      },
      {
        type: 'custom',
        name: 'simPromptWarnings',
        span: 2,
        html: '<div class="meta" id="simPromptWarnings"></div>',
      },
      {
        type: 'action',
        id: 'simPromptActions',
        items: [
          { id: 'simPromptEdit', label: '编辑' },
          { id: 'simPromptSave', label: '保存并同步到 DSH', variant: 'primary' },
          { id: 'simPromptRestore', label: '还原上次备份' },
          { id: 'simPromptCancel', label: '取消编辑' },
        ],
        status: 'simPromptMsg',
      },
      {
        type: 'custom',
        name: 'simPromptRestart',
        span: 2,
        html: '<div class="meta" id="simPromptRestart"></div>',
      },
    ],
  },
};
