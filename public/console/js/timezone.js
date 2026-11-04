// 时区下拉：定时任务页与定时静默共用（浏览器认得的全部时区，每项带当前 UTC 偏移）。
import { esc } from './ui.js';

// 时区下拉：浏览器认得的全部时区，每项后面带当前的 UTC 偏移（有夏令时的地区会随季节变）；常用的放最前。
const TZ_COMMON = [
  ['Asia/Shanghai', '北京时间'], ['Asia/Hong_Kong', '香港'], ['Asia/Taipei', '台北'], ['Asia/Singapore', '新加坡'], ['Asia/Tokyo', '东京'], ['Asia/Seoul', '首尔'],
  ['Asia/Kolkata', '印度'], ['Europe/London', '伦敦'], ['Europe/Paris', '巴黎'], ['Europe/Berlin', '柏林'], ['Europe/Moscow', '莫斯科'],
  ['America/New_York', '美东'], ['America/Chicago', '美中'], ['America/Denver', '美山地'], ['America/Los_Angeles', '美西'], ['Australia/Sydney', '悉尼'], ['UTC', '协调世界时'],
];
function tzOffset(tz) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || '';
    return name === 'GMT' || name === 'UTC' ? 'UTC+0' : name.replace(/^GMT/, 'UTC');
  } catch { return ''; }
}
function tzMinutes(label) {
  const m = /^UTC([+-])(\d+)(?::(\d+))?$/.exec(label);
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
}
export function tzOptionsHtml(withFollow) {
  const all = (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : TZ_COMMON.map(([z]) => z));
  const common = new Set(TZ_COMMON.map(([z]) => z));
  const opt = (z, extra = '') => { const off = tzOffset(z); return `<option value="${esc(z)}">${esc(z)}（${esc(off)}${extra ? '，' + esc(extra) : ''}）</option>`; };
  const rest = all.filter((z) => !common.has(z)).map((z) => [z, tzOffset(z)]).sort((a, b) => tzMinutes(a[1]) - tzMinutes(b[1]) || a[0].localeCompare(b[0]));
  return (withFollow ? '<option value="">跟随默认时区</option>' : '')
    + `<optgroup label="常用">${TZ_COMMON.map(([z, n]) => opt(z, n)).join('')}</optgroup>`
    + `<optgroup label="全部时区（按 UTC 偏移排序）">${rest.map(([z]) => opt(z)).join('')}</optgroup>`;
}
export function tzSet(select, tz) {
  if (tz && ![...select.options].some((o) => o.value === tz)) select.insertAdjacentHTML('afterbegin', `<option value="${esc(tz)}">${esc(tz)}（${esc(tzOffset(tz))}）</option>`);
  select.value = tz || '';
}
