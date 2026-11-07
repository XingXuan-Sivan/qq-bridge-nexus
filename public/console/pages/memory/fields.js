// 记忆页的字段规格：只有静态输入项写在这里，provider 卡片/最近回忆/本机记忆列表
// 依赖接口返回，由 page.js 渲染（见 docs/MEMORY_SUBSYSTEM.md §4）。
// 注意：renderFields 的每一项都要有 name（即控件 id）；custom 的 name 只用于 data-custom，不能和 html 里的 id 重名。
import { modalHtml } from '../../components/modal/modal.js';

const PROVIDER_RADIOS = '<div id="memoryProviderRadios" class="memory-radios">（加载中…）</div>';
const PROVIDER_CARDS = '<div id="memoryProviders" class="memory-providers">（加载中…）</div>';
const LOCAL_TABS = `<div class="page-tabs" role="tablist" id="memoryLocalTabs">
  <button type="button" class="page-tab active" role="tab" aria-selected="true" data-mem-cat="topic">话题 <span class="meta" data-mem-count="topic">0</span></button>
  <button type="button" class="page-tab" role="tab" aria-selected="false" data-mem-cat="thought">想法 <span class="meta" data-mem-count="thought">0</span></button>
  <button type="button" class="page-tab" role="tab" aria-selected="false" data-mem-cat="impression">印象 <span class="meta" data-mem-count="impression">0</span></button>
  <button type="button" class="page-tab" role="tab" aria-selected="false" data-mem-cat="rule">规则 <span class="meta" data-mem-count="rule">0</span></button>
</div>`;
const SESSION_HOST = '<div id="memorySessionTable">（正在读取会话…）</div>';
const MEM_MODAL = modalHtml({
  id: 'memMemoryModal',
  title: '会话记忆',
  wide: true,
  body: `<div id="memSessionView">
  <p class="meta" id="memModalHead"></p>
  ${LOCAL_TABS}
  <div id="memoryLocalTable"></div>
  <p class="form-actions-status" id="memLocalMsg" role="status"></p>
</div>
<div id="memEntryView" hidden>
  <div id="memEntryForm" class="form-grid"></div>
  <p class="form-actions-status" id="memEntryMsg" role="status"></p>
</div>`,
  footer: `<button type="button" class="btn" id="memFootClose" data-modal-close>关闭</button>
  <button type="button" class="btn" id="memEntryBack" hidden>返回列表</button>
  <button type="button" class="btn primary" id="memEntrySave" hidden>保存</button>`,
});
const SESSION_ADD_MODAL = modalHtml({
  id: 'memSessionAddModal',
  title: '新增会话',
  body: '<div id="memSessionAddForm" class="form-grid"></div>',
  footer: `<button type="button" class="btn" id="memSessionAddCancel" data-modal-close>取消</button>
  <button type="button" class="btn primary" id="memSessionAddSave">保存</button>`,
});
const INGEST_STATS = '<div id="memoryIngestStats" class="meta">写回未开启：不会向任何外部服务发送对话内容。</div>';
const HISTORY = '<div id="memoryHistory">（还没有注入或回忆记录）</div>';

export const MEMORY_FIELDS = {
  inject: [
    { name: 'memProviderRadiosBlock', type: 'custom', html: PROVIDER_RADIOS, span: 2 },
    {
      name: 'memInjectMaxChars', type: 'number', label: '注入上限（字）', min: 0, max: 20000, step: 100, unit: '字',
      hint: '每次唤醒最多注入多少字；0 表示不截断。与 provider 自己的上限同时存在时取更小的。',
    },
    {
      name: 'memInjectTimeout', type: 'number', label: '预热超时（ms）', min: 100, max: 10000, step: 100, unit: 'ms',
      hint: '异步 provider 在这段时间内没返回就按缓存或空块处理，不拖慢唤醒。',
    },
    {
      name: 'memInjectCacheTtl', type: 'number', label: '缓存有效期（ms）', min: 0, max: 3600000, step: 1000, unit: 'ms',
      hint: '同一会话 + 同一句 query 在有效期内不重复请求；0 表示每次都重新取。',
    },
    { type: 'action', items: [{ id: 'memInjectSave', label: '保存注入设置', variant: 'primary' }], status: 'memInjectMsg' },
  ],
  providers: [
    { name: 'memProvidersBlock', type: 'custom', html: PROVIDER_CARDS, span: 2 },
    { type: 'action', items: [{ id: 'memProvidersSave', label: '保存 provider 设置' }], status: 'memProvidersMsg' },
  ],
  local: [
    {
      name: 'memLimitInjectTopics', type: 'number', label: '话题注入（条）', min: 0, max: 50, step: 1,
      hint: '每次唤醒带几条进行中的话题；0 表示不注入。',
    },
    { name: 'memLimitInjectThoughts', type: 'number', label: '想法注入（条）', min: 0, max: 50, step: 1 },
    { name: 'memLimitInjectImpressions', type: 'number', label: '印象注入（条）', min: 0, max: 100, step: 1 },
    { name: 'memLimitMaxTopics', type: 'number', label: '话题最多存（条）', min: 1, max: 500, step: 1, hint: '存储上限：超出的旧条目按时间裁掉。' },
    { name: 'memLimitMaxThoughts', type: 'number', label: '想法最多存（条）', min: 1, max: 500, step: 1 },
    { name: 'memLimitMaxImpressions', type: 'number', label: '印象最多存（条）', min: 1, max: 1000, step: 1 },
    { name: 'memLimitMaxRules', type: 'number', label: '规则最多存（条）', min: 1, max: 50, step: 1 },
    { name: 'memLimitMaxTraits', type: 'number', label: '每人标签上限（个）', min: 1, max: 30, step: 1 },
    { name: 'memLimitTraitChars', type: 'number', label: '单个标签最长（字）', min: 10, max: 200, step: 1 },
    { name: 'memLimitItemChars', type: 'number', label: '单条最长（字）', min: 20, max: 2000, step: 10 },
    {
      name: 'memLimitStaleHours', type: 'number', label: '话题过期（小时）', min: 0, max: 720, step: 1,
      hint: '超过这么久没再被提起的话题会被清掉；0 表示不过期。',
    },
    { type: 'action', items: [{ id: 'memLocalSaveLimits', label: '保存上限设置' }], status: 'memLocalLimitsMsg' },
    { name: 'memLocalSessionsBlock', type: 'custom', html: SESSION_HOST, span: 2 },
    { name: 'memLocalModalBlock', type: 'custom', html: MEM_MODAL, span: 2 },
    { name: 'memSessionAddModalBlock', type: 'custom', html: SESSION_ADD_MODAL, span: 2 },
  ],
  tools: [
    { name: 'memToolRecall', type: 'switch', label: 'qq_memory_recall', onLabel: '开', offLabel: '关', hint: '让 AI 主动翻旧事；默认开。' },
    { name: 'memToolNote', type: 'switch', label: 'qq_memory_note', onLabel: '开', offLabel: '关', hint: '让 AI 主动记一句话；默认关，写回落在本机轻量记忆（soulkit 只读）。' },
    { name: 'memToolLocal', type: 'switch', label: '本机轻量记忆工具', onLabel: '开', offLabel: '关', hint: 'qq_memory_append / query / remove / clear 四个工具的总开关。' },
    { name: 'memHandover', type: 'switch', label: '切 agent 时带上私聊记忆', onLabel: '开', offLabel: '关', hint: '切到 closed-agent 时，把管理员私聊里的记录交给 agent；不含任何群。' },
    { type: 'action', items: [{ id: 'memToolsSave', label: '保存工具设置' }], status: 'memToolsMsg' },
  ],
  ingest: [
    {
      name: 'memIngestEnabled', type: 'switch', label: '写回记忆服务', onLabel: '开', offLabel: '关',
      hint: '开启后，QQ 会话里的用户消息与 AI 回复会批量发给记忆服务（soulkit 的 /api/ingest）；关闭时一行都不发。',
    },
    {
      name: 'memIngestUrl', type: 'text', label: '记忆服务地址', span: 2,
      placeholder: '留空则跟随 soulkit provider 的地址',
      hint: '只接受 http(s)。默认 http://127.0.0.1:3110。',
    },
    { name: 'memIngestMaxQueue', type: 'number', label: '队列上限（条）', min: 10, max: 2000, step: 10 },
    { name: 'memIngestBatch', type: 'number', label: '每批条数', min: 1, max: 200, step: 1 },
    { name: 'memIngestInterval', type: 'number', label: '发送间隔（ms）', min: 500, max: 60000, step: 100, unit: 'ms' },
    { name: 'memIngestTimeout', type: 'number', label: '发送超时（ms）', min: 300, max: 30000, step: 100, unit: 'ms' },
    { type: 'action', items: [{ id: 'memIngestSave', label: '保存写回设置' }], status: 'memIngestMsg' },
    { name: 'memIngestStatsBlock', type: 'custom', html: INGEST_STATS, span: 2 },
  ],
  history: [
    { name: 'memHistoryBlock', type: 'custom', html: HISTORY, span: 2 },
  ],
};
