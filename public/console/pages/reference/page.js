// 工具参考：纯静态页（表格 + 说明），没有接口请求，也没有事件绑定。
// 表格由字段规格生成（复用 tableHtml 的表头/边框样式），所以 init() 只做一次渲染。
import { renderFields } from '../../components/form/form.js';
import { REFERENCE_FIELDS } from './fields.js';

export function init() {
  document.querySelectorAll('[data-reference-fields]').forEach((host) => {
    const spec = REFERENCE_FIELDS[host.dataset.referenceFields];
    if (spec) renderFields(host, spec.fields, { columns: 2 });
  });
}
