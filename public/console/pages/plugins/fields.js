// 桥接插件：工具行、插件卡片列表、注入块/运行设置/安装三块设置、插件详情弹窗。
// 页面只留三折说明与宿主；控件全在这里生成，id 与迁移前保持一致（page.js 按 id 取值）。
// 开关是 <button role="switch">，渲染后由页面统一 bindSwitches，读写走 getSwitch/setSwitch。

const TOOLBAR = [
  {
    type: 'action',
    items: [
      { id: 'pluginsRefresh', label: '刷新' },
      { id: 'pluginsReloadAll', label: '全部重载' },
    ],
    status: 'pluginsMeta',
    statusText: '加载中…',
  },
];

const RUNTIME_FIELDS = [
  { type: 'switch', name: 'pluginFilterInbound', label: '入站过滤', hint: '打开后，申请了 inbound:filter 的插件可以丢弃或改写消息，改完立即生效。' },
  { type: 'switch', name: 'pluginWatch', label: '文件监听自动重载', hint: '只影响开发时的自动重载，不影响线上发送。' },
  { type: 'number', name: 'pluginHookTimeout', label: '钩子超时', unit: 'ms', min: 100, max: 10000, step: 100, hint: '插件钩子单次执行的上限；留空表示不改。' },
  { type: 'number', name: 'pluginAppendLimit', label: '插件注入上限', unit: '字符', min: 0, max: 20000, step: 100, hint: '插件往 prompt 追加内容的总长度上限；留空表示不改。' },
  { type: 'switch', name: 'pluginInstallEnabled', label: '允许安装', hint: '关掉后安装接口直接拒绝，已安装的插件不受影响。' },
  {
    type: 'action',
    items: [{ id: 'pluginSettingsSave', label: '保存运行设置', variant: 'primary' }],
    status: 'pluginSettingsMsg',
  },
];

const INSTALL_HTML = `<div class="row">
  <input class="u-flex-1-minw-220" type="file" id="pluginInstallZip" accept=".zip,application/zip">
  <button class="btn" type="button" id="pluginInstallZipBtn">上传安装</button>
</div>`;

const INSTALL_PATH_FIELDS = [
  { type: 'text', name: 'pluginInstallPath', label: '本地目录', placeholder: '服务器本地目录，例如 D:\\dev\\my-plugin', hint: '读的是桥接所在机器上的目录，不是浏览器所在机器。' },
  {
    type: 'action',
    items: [{ id: 'pluginInstallPathBtn', label: '从目录安装' }],
    status: 'pluginInstallMsg',
  },
];

const DETAIL_HTML = `<div class="modal-overlay" id="pluginDetailOverlay">
  <div class="modal u-maxw-860" data-modal-panel role="dialog" aria-modal="true" aria-labelledby="pluginDetailTitle" tabindex="-1">
    <header class="modal-head">
      <h3 id="pluginDetailTitle">插件详情</h3>
      <button class="modal-close" type="button" data-modal-close aria-label="关闭">×</button>
    </header>
    <div class="modal-body">
      <div class="meta plugin-detail-summary" id="pluginDetailBody"></div>
      <div id="pluginConfigMount"></div>
      <div class="plugin-log-head">最近审计</div>
      <pre class="plugin-log-pre" id="pluginDetailLogs">—</pre>
      <div id="pluginPersistMount"></div>
    </div>
    <footer class="modal-foot">
      <span class="modal-status" id="pluginPersistMsg"></span>
      <button id="pluginDetailClose" class="btn" type="button">关闭</button>
      <button id="pluginPersistSave" class="btn" type="button">保存启用状态</button>
    </footer>
  </div>
</div>`;

const PERSIST_FIELDS = [
  { type: 'switch', name: 'pluginPersistEnabled', label: '写入 plugins.json', hint: '打开并保存后重启仍生效；只改本次运行请用卡片上的启用/停用。' },
];

export const PLUGINS_FIELDS = {
  toolbar: { fields: TOOLBAR },
  list: { html: '<div id="pluginsList" class="tile-list">加载中…</div>' },
  promptBlockActions: {
    fields: [
      {
        type: 'action',
        items: [{ id: 'promptBlockSave', label: '保存注入块', variant: 'primary' }],
        status: 'promptBlockMsg',
      },
    ],
  },
  runtime: { fields: RUNTIME_FIELDS },
  install: { html: INSTALL_HTML },
  installPath: { fields: INSTALL_PATH_FIELDS },
  detail: { html: DETAIL_HTML, fields: PERSIST_FIELDS, mount: 'pluginPersistMount', columns: 1 },
};
