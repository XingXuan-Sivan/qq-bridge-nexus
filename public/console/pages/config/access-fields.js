// 访问与安全：白名单 / 安全拦截 / 控制台令牌。控件全部由规格生成，页面只留卡片与宿主。

// state/ 权限没收紧时的警示块（Windows 上需要管理员身份才能改 ACL）。
const STATE_WARN = `<div id="stateDirWarn" class="warn-box" hidden>
  <b>⚠️ state/ 目录权限未收紧</b>
  <div class="meta u-my-4">Windows 上改文件权限需要管理员身份，本次启动没能收紧 <code id="stateDirPath"></code>。它里面的控制台令牌、SnowLuma 令牌、各会话令牌与 QQ 聊天记录，本机任何已登录用户都可能读到。</div>
  <div class="meta">两种做法：① 用<b>管理员身份</b>打开终端执行下面这条命令（一次即可，可复制）；② 或者<b>用管理员身份重启桥接</b>，让它自己收紧。做完点下面的按钮复检。</div>
  <pre id="stateDirCmd" class="u-code-block"></pre>
  <div class="control-row">
    <button id="stateDirReharden" class="btn small">重新检测</button>
    <span class="meta" id="stateDirMsg"></span>
  </div>
</div>`;

// QQ 网关连着但收不到数据时的排查块（纯说明，没有控件）。
const SNOW_WARN = `<div id="snowlumaWarn" class="warn-box" hidden>
  <b>⚠️ QQ 网关连着，但收不到 QQ 的数据</b>
  <div class="meta u-my-4" id="snowlumaWarnHint"></div>
  <div class="meta" id="snowlumaWarnDiag">最近一个上游事件包：<b id="snowlumaWarnPkt">unknown</b>；SnowLuma 自评接收链路 good=<b id="snowlumaWarnGood">unknown</b>。</div>
  <div class="meta u-my-4">这是 <b>SnowLuma 自己那边</b>的问题：它的 <code>[Hook]</code> 没能从 QQ 客户端取到数据，所以桥接的 WebSocket 连上了却始终没有内容可收。桥接没有原生 / 注入组件，也不改 SnowLuma，一条上游事件包都不会替你凭空造出来。</div>
  <div class="meta">排查：打开 SnowLuma 的 <code>logs/snowluma-*.log</code>，搜 <code>[Hook]</code>，看有没有 <code>receive path stale</code> / <code>process enumeration timed out</code> 这类行；顺带考虑<b>升级 SnowLuma</b>（新版运行时对 hook 的兜底更好）。桥接这边不用重启。</div>
</div>`;

export const ACCESS_FIELDS = {
  whitelist: {
    fields: [
      {
        name: 'wlSummary',
        type: 'custom',
        span: 2,
        html: `<div class="meta" id="wlSummary">按会话的准入（被动 / 主动、黑名单）已迁到「会话与审批」页，每行点「管理」直接改；这里只保留管理员。</div>`,
      },
      {
        name: 'ownerQQ',
        type: 'text',
        label: '管理员 QQ',
        placeholder: '123456789',
        hint: 'ownerQQ，最高权限：唯一可执行管理命令 / 审批 / closed-agent 的 QQ；可留空清除（清除后无管理员，fail-closed）。',
        span: 2,
      },
      {
        name: 'adminsBlock',
        type: 'custom',
        span: 2,
        html: `<div class="meta">管理员（owner 之外）：可在自己的 QQ 私聊里审批、进入 closed-agent；每人的权限与上限单独设置。owner 永远不受此表限制。</div>
<table class="table admin-table">
  <thead><tr><th>QQ</th><th>称呼</th><th>权限</th><th>最高级别</th><th>通知</th><th>私聊被动豁免</th><th></th></tr></thead>
  <tbody id="adminRows"></tbody>
</table>
<div class="control-row u-mt-8"><button type="button" id="adminAdd" class="btn small">+ 添加管理员</button><span class="meta" id="adminMsg"></span></div>`,
      },
      {
        type: 'action',
        id: 'accessWhitelistActions',
        items: [{ id: 'wlSave', label: '保存管理员', variant: 'primary' }],
        status: 'wlMsg',
      },
      { name: 'wlNote', type: 'custom', span: 2, html: '<div class="meta">保存后立即生效并写入 config.json。会话准入请看 <a href="#sessions">会话与审批</a>。</div>' },
    ],
  },
  security: {
    fields: [
      {
        name: 'secInterceptNotify',
        type: 'switch',
        label: '拦截提示',
        hint: '开启：回复被安全拦截时会在群里提示；关闭：直接沉默，只在日志 / 活动记录里留下记录。',
      },
      {
        type: 'action',
        id: 'accessSecurityActions',
        items: [{ id: 'secSave', label: '保存安全设置', variant: 'primary' }],
        status: 'secMsg',
      },
      { name: 'accessStateWarn', type: 'custom', span: 2, html: STATE_WARN },
      { name: 'accessSnowWarn', type: 'custom', span: 2, html: SNOW_WARN },
    ],
  },
  token: {
    fields: [
      {
        name: 'consoleTokenField',
        type: 'custom',
        label: '新令牌',
        span: 2,
        html: `<span class="field-inline"><input type="password" id="consoleTokenInput" placeholder="输入新令牌（至少 16 位），留空则生成随机" autocomplete="new-password"></span>
<div class="meta">用于打开本控制台 / 调用管理 API 的令牌。可手动输入新令牌保存，或留空生成随机令牌；修改后当前页面会自动使用新令牌。</div>`,
      },
      {
        type: 'action',
        id: 'accessTokenActions',
        items: [
          { id: 'consoleTokenSave', label: '保存令牌', variant: 'primary' },
          { id: 'consoleTokenRandom', label: '生成随机令牌' },
        ],
        status: 'consoleTokenMsg',
      },
    ],
  },
};
