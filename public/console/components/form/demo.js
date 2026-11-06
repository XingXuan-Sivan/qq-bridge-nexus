// 临时演示页：把 16 个控件、三类字段注解、条件显示与跨字段校验都铺一遍。
// 不属于控制台导航；验完即删。
import {
  textField, numberField, passwordField, textareaField, selectField, radioGroup,
  checkboxGroup, checkboxField, switchField, fileField, dateField, timeField,
  datetimeField, timeRangeField, readonlyField, formActions, formCallout, createForm,
} from './form.js';

const form = document.getElementById('demoForm');
const col = (cls, html) => `<div class="${cls}">${html}</div>`;

form.innerHTML = [
  formCallout({ tone: 'info', title: '关于这页', body: '所有控件都由 components/form 的工厂渲染；下面同时放了 hint / warn / danger 三类注解。' }),
  `<section class="form-section"><legend>基础输入</legend>
    <div class="cols form-grid">
      ${col('col-12 col-md-6', textField({ id: 'demoText', label: '显示名称', value: '星苒', placeholder: '例如：星苒', maxlength: 24, counter: true, required: true, hint: '显示在侧栏与会话标题里' }))}
      ${col('col-12 col-md-6', numberField({ id: 'demoNumber', label: '每天上限', value: 20, min: 0, max: 200, step: 1, unit: '条/天', required: true, hint: '按北京时间自然日统计' }))}
      ${col('col-12 col-md-6', passwordField({ id: 'demoPassword', label: '访问令牌', value: 's3cret-token', hint: '只在本机保存，不会出现在日志里' }))}
      ${col('col-12 col-md-6', selectField({ id: 'demoSelect', label: '运行模式', value: 'reserved2', options: [{ value: 'chat', label: '聊天模式' }, { value: 'closed-agent', label: '封闭 Agent' }, { value: 'reserved2', label: '二代仿真' }], hint: '切换后立即生效' }))}
      ${col('col-12', textareaField({ id: 'demoTextarea', label: '备注', value: '第一行\n第二行', rows: 3, maxlength: 200, counter: true, mono: true, hint: '支持多行，最多 200 字' }))}
    </div>
  </section>`,
  `<section class="form-section"><legend>选择与开关</legend>
    <div class="cols form-grid">
      ${col('col-12', radioGroup({ id: 'demoMode', label: '仿真模式', value: 'reserved2', cards: true, required: true, options: [
        { value: 'chat', label: '聊天模式', desc: '白名单内随时对话' },
        { value: 'closed-agent', label: '封闭 Agent', desc: '仅管理员私聊，L1/L2/L3 分级' },
        { value: 'reserved2', label: '二代仿真', desc: '自主阅读、发言与潜水' },
      ] }))}
      ${col('col-12 col-md-6', checkboxGroup({ id: 'demoKinds', label: '允许的消息类型', columns: 2, selectAll: true, value: ['text', 'image'], options: [
        { value: 'text', label: '文本' }, { value: 'image', label: '图片' }, { value: 'voice', label: '语音' }, { value: 'forward', label: '合并转发' },
      ], hint: '未勾选的类型会被忽略' }))}
      ${col('col-12 col-md-6', switchField({ id: 'demoSwitch', label: '自动重载', checked: true, onLabel: '开', offLabel: '关', hint: '文件变化后 500ms 内重载' }))}
      ${col('col-12 col-md-6', checkboxField({ id: 'demoAgree', label: '我已知晓修改会立即生效', checked: false, hint: '高风险操作需要二次确认' }))}
      ${col('col-12 col-md-6', fileField({ id: 'demoFile', label: '插件包', accept: '.zip', maxBytes: 5 * 1024 * 1024, warn: '只允许包含 plugin.json 的 zip，解压时会拒绝符号链接' }))}
      ${col('col-12 col-md-6', textField({ id: 'demoPreset', label: 'Agent 预设', value: 'qq-chat', hint: '仅聊天模式与封闭 Agent 生效' }))}
    </div>
  </section>`,
  `<section class="form-section"><legend>日期与时间</legend>
    <div class="cols form-grid">
      ${col('col-12 col-md-6', dateField({ id: 'demoDate', label: '开始日期', value: '2026-11-06', quick: true }))}
      ${col('col-12 col-md-6', timeField({ id: 'demoTime', label: '提醒时间', value: '08:30', quick: true }))}
      ${col('col-12 col-md-6', datetimeField({ id: 'demoDatetime', label: '一次性任务时间', value: '2026-11-06T08:30' }))}
      ${col('col-12 col-md-6', timeRangeField({ id: 'demoQuiet', label: '静默时段', from: '23:00', to: '07:00', warn: '这段时间内群消息不会被唤醒；跨零点表示到次日' }))}
    </div>
  </section>`,
  `<section class="form-section"><legend>只读与危险提示</legend>
    <div class="cols form-grid">
      ${col('col-12 col-md-6', readonlyField({ id: 'demoReadonly', label: '控制台令牌', value: 'ccd5f763bac3fff497a4308a62607c317111115fec0d391c', hint: '重启后会变化' }))}
      ${col('col-12 col-md-6', textField({ id: 'demoDanger', label: '清空后不可恢复', value: '', placeholder: '输入「确认」才允许继续', danger: '清空会删除本地全部记忆与会话映射，且不可恢复。' }))}
    </div>
  </section>`,
  formActions({ primary: '保存', secondary: [{ label: '重置', action: 'reset' }], meta: '改动会立即写回配置' }),
].join('');

const instance = createForm(form, {
  rules: {
    demoText: { type: 'string', required: true, maxLength: 24 },
    demoNumber: { type: 'integer', required: true, min: 0, max: 200 },
    demoMode: { type: 'string', required: true },
    demoKinds: { type: 'array', maxItems: 3 },
    demoQuiet: { type: 'timeRange', allowOvernight: true, allowEqual: false },
    demoDate: { type: 'date' },
    demoTime: { type: 'time' },
  },
  depends: { demoPreset: { on: 'demoMode', in: ['chat', 'closed-agent'] } },
  onSubmit: async (values) => {
    document.getElementById('demoOut').textContent = `提交取值：${JSON.stringify(values)}`;
  },
});

form.querySelector('[data-action="reset"]')?.addEventListener('click', () => instance.reset());

// 供自动化测试读取（演示页专用，不进控制台导航）
window.__demoForm = instance;
