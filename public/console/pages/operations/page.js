// 调试与运维页：测试发送、桥接控制、后台控制端引导。
// 结构照搬迁移前 index.html 的 #section-test-send / #section-maintenance / #section-notify；
// 片段由路由器注入后再调 init()，这里直接绑定按钮。
import { api } from '../../js/api.js';
import { renderFields } from '../../components/form/form.js';
import { OPERATIONS_FIELDS } from './fields.js';

// 静态控件按字段规格渲染：页面只留卡片与宿主，渲染之后再取 id。
function renderOperationsFieldGroups() {
  document.querySelectorAll('[data-operations-fields]').forEach((host) => {
    const spec = OPERATIONS_FIELDS[host.dataset.operationsFields];
    if (spec) renderFields(host, spec.fields, { columns: 2 });
  });
}

export function init() {
  renderOperationsFieldGroups();
  document.getElementById('tsSend').addEventListener('click', async () => {
    const r = await api('/api/test-send', 'POST', {
      kind: document.getElementById('tsKind').value,
      id: document.getElementById('tsId').value.trim(),
      message: document.getElementById('tsMsg').value,
    });
    const msg = document.getElementById('tsMsg2');
    msg.textContent = r.ok ? ('✅ 已发送 message_id=' + r.message_id) : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'form-actions-status ok' : 'form-actions-status err';
  });

  document.getElementById('restartBtn').addEventListener('click', async () => {
    if (!confirm('确定重启桥接？')) return;
    const r = await api('/api/restart', 'POST', {});
    document.getElementById('restartMsg').textContent = r.message || '正在重启…';
  });

  // 紧急关闭：与重启同组（都是破坏性动作），行为与原来一致：二次确认 → 回到 L0 → 刷新状态。
  document.getElementById('panicBtn').addEventListener('click', async () => {
    if (!confirm('立即回到安全模式（L0 群友模式）？进行中的高权限会话会被停止。')) return;
    const msg = document.getElementById('panicMsg');
    msg.className = 'form-actions-status';
    msg.textContent = '正在关闭…';
    const r = await api('/api/admin/panic', 'POST', {});
    msg.textContent = r.ok ? '✅ 已回到 L0 群友模式' : ('❌ ' + (r.error || '紧急关闭失败，请直接停止桥接进程'));
    msg.className = r.ok ? 'form-actions-status ok' : 'form-actions-status err';
    // 模式确实变了：请顶栏与总览指标立刻补一次状态，不等下一轮轮询。
    document.dispatchEvent(new Event('console:refresh-status'));
  });

  document.getElementById('aiNotifySend').addEventListener('click', async () => {
    const kind = document.getElementById('aiNotifyKind').value;
    const id = document.getElementById('aiNotifyId').value.trim();
    const message = document.getElementById('aiNotifyMessage').value.trim();
    if (!id || !message) { alert('请填写群号/QQ 号和提醒内容'); return; }
    const r = await api('/api/console/notify-ai', 'POST', { key: kind + ':' + id, message });
    const msg = document.getElementById('aiNotifyMsg');
    msg.textContent = r.ok ? ('✅ 已投递到 DSH：' + r.sessionId) : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'form-actions-status ok' : 'form-actions-status err';
  });
}
