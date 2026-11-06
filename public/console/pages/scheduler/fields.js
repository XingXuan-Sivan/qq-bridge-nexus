// 定时任务页的字段规格：页面本体只留分区骨架，控件全部由这里生成。
//
// 约定：控件 id 一律沿用旧 DOM id（page.js 用 schedEl(id) 直接读写），迁移只换外壳、不改行为。
// 「任务编辑器」是 13 种重复方式驱动的动态表单（page.js 按类型重建 #schedFields、按类型显隐行），
// 这轮先作为 custom 块整体搬进来，不拆成字段——拆了就要重写整段联动逻辑，风险大于收益。

const EDITOR_HTML = `
<div id="schedEditor" class="sched-editor" hidden>
  <h3 class="u-mt-0" id="schedEditorTitle">新建任务</h3>
  <div class="grid u-gap-12">
    <div><label for="schedName">名称</label><input type="text" id="schedName" placeholder="早安"></div>
    <div><label for="schedTaskTz">时区</label><select id="schedTaskTz"></select></div>
  </div>
  <label for="schedType">重复方式</label>
  <select id="schedType">
    <option value="once">一次性</option>
    <option value="daily">每天</option>
    <option value="weekly">每周</option>
    <option value="workdays">工作日（周一至周五，跳过法定节假日）</option>
    <option value="monthly">每月几号</option>
    <option value="monthlyWeekday">每月第几个周几</option>
    <option value="yearly">每年</option>
    <option value="dates">特殊日期</option>
    <option value="everyNDays">每隔 N 天</option>
    <option value="interval">每隔 N 分钟</option>
    <option value="dailyRandom">每天随机几次</option>
    <option value="monthlyRandom">每月随机几次</option>
    <option value="cron">高级：cron 表达式</option>
  </select>
  <div class="sched-fields" id="schedFields"></div>
  <div class="grid u-gap-12">
    <div><label>有效期（可选）</label><div class="row"><input class="u-flex-basis-120" type="text" id="schedStartDate" placeholder="开始 YYYY-MM-DD"><input class="u-flex-basis-120" type="text" id="schedEndDate" placeholder="结束 YYYY-MM-DD"></div></div>
    <div><label for="schedMaxRuns">共执行几次后停止（可选）</label><input type="number" id="schedMaxRuns" min="1" placeholder="不限"></div>
  </div>
  <div class="grid u-gap-12">
    <div><label for="schedExclude">排除日期（可选，逗号分隔）</label><input type="text" id="schedExclude" placeholder="2026-12-25, 2027-01-01"></div>
    <div><label>其它</label><div class="row"><label class="sched-chip u-m-0"><input type="checkbox" id="schedSkipHolidays"> 跳过法定节假日</label>
      <select class="u-flex-basis-160" id="schedSilence" title="只对「叫 AI 来说」有效；固定文字在定时静默里照发"><option value="skip">定时静默时段内：跳过这次</option><option value="run">定时静默时段内：照常执行</option></select>
      <select class="u-flex-basis-160" id="schedMissed"><option value="grace">错过了：补发时间内补发，否则跳过</option><option value="skip">错过了：直接跳过</option></select></div></div>
  </div>
  <label>发给谁（可多选）</label>
  <div id="schedTargets"></div>
  <label>内容</label>
  <div class="row">
    <label class="sched-chip u-m-0"><input type="radio" name="schedKind" value="text" checked> 固定文字（桥接直接发）</label>
    <label class="sched-chip u-m-0"><input type="radio" name="schedKind" value="ai"> 叫 AI 来说（到点唤醒 AI）</label>
  </div>
  <div class="row u-mt-8" id="schedPluginKindRow" hidden>
    <label class="field u-flex-basis-240">插件任务类型<select id="schedPluginKind"></select></label>
    <span class="meta u-m-0">由插件注册；payload 见插件说明</span>
  </div>
  <textarea id="schedPayloadJson" rows="3" class="u-w-full u-mt-8" hidden placeholder='{"payload": {"week": "周一"}}'></textarea>
  <textarea class="u-w-full-mt-8" id="schedContent" rows="3" placeholder="早上好"></textarea>
  <div class="meta" id="schedPreview">接下来：—</div>
  <div class="form-actions form-actions--inline u-mt-10">
    <button class="btn primary" id="schedSave">保存任务</button>
    <button class="btn small" id="schedCancel">取消</button>
    <span class="form-actions-status" id="schedEditorMsg"></span>
  </div>
</div>`;

/** 每个 key 对应 page.html 里的 `<div data-sched-fields="key">`。 */
export const SCHED_FIELDS = {
  header: {
    fields: [
      { name: 'schedEnabled', type: 'switch', label: '启用定时任务' },
      { name: 'schedTimezone', type: 'select', label: '默认时区', options: [] },
    ],
  },
  headerActions: {
    fields: [
      {
        type: 'action',
        items: [{ id: 'schedSettingsSave', label: '保存', variant: 'primary' }],
        status: 'schedSettingsMsg',
      },
    ],
  },
  policy: {
    fields: [
      { name: 'schedAllowAiPrivate', type: 'switch', label: '允许 AI 在管理员私聊里登记任务' },
      { name: 'schedAllowAiGroup', type: 'switch', label: '允许 AI 登记发往群 / 其他好友的任务', hint: '登记后先暂停，需要你确认才会生效。' },
    ],
  },
  limits: {
    fields: [
      {
        name: 'schedLimitsSlot',
        type: 'custom',
        span: 2,
        html: '<div id="schedLimits" class="sched-limits"></div>',
      },
      { name: 'schedQuietEnabled', type: 'switch', label: '定时任务免打扰', hint: '只拦定时任务发往群的消息，不影响 AI 平时被 @ 时回复。' },
      { name: 'schedQuietStart', type: 'text', label: '免打扰开始', placeholder: '00:00', width: 120 },
      { name: 'schedQuietEnd', type: 'text', label: '免打扰结束', placeholder: '07:00', width: 120 },
    ],
  },
  limitsActions: {
    fields: [
      {
        type: 'action',
        items: [
          { id: 'schedLimitsSave', label: '保存限制', variant: 'primary' },
          { id: 'schedLimitsReset', label: '恢复默认' },
        ],
        status: 'schedLimitsMsg',
      },
    ],
  },
  listActions: {
    fields: [
      {
        type: 'action',
        items: [{ id: 'schedNew', label: '＋ 新建任务', variant: 'primary' }],
        status: 'schedCount',
      },
    ],
  },
  taskList: {
    fields: [{ name: 'schedListSlot', type: 'custom', span: 2, html: '<div id="schedList" class="data-slot"></div>' }],
  },
  editor: {
    fields: [{ name: 'schedEditorSlot', type: 'custom', span: 2, html: EDITOR_HTML }],
  },
  history: {
    fields: [{ name: 'schedHistorySlot', type: 'custom', span: 2, html: '<div id="schedHistory"></div>' }],
  },
};
