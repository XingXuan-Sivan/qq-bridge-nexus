// 调试与运维页：测试发送、桥接控制、后台控制端引导。
// 结构照搬迁移前 index.html 的 #section-test-send / #section-maintenance / #section-notify；
// 片段由路由器注入后再调 init()，这里直接绑定按钮。
import { api } from '../../js/api.js';

export function init() {
  document.getElementById('tsSend').addEventListener('click', async () => {
    const r = await api('/api/test-send', 'POST', {
      kind: document.getElementById('tsKind').value,
      id: document.getElementById('tsId').value.trim(),
      message: document.getElementById('tsMsg').value,
    });
    const msg = document.getElementById('tsMsg2');
    msg.textContent = r.ok ? ('✅ 已发送 message_id=' + r.message_id) : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'meta ok' : 'meta err';
  });

  document.getElementById('restartBtn').addEventListener('click', async () => {
    if (!confirm('确定重启桥接？')) return;
    const r = await api('/api/restart', 'POST', {});
    document.getElementById('restartMsg').textContent = r.message || '正在重启…';
  });

  document.getElementById('clearWsBtn').addEventListener('click', async () => {
    if (!confirm('确定清空整个「QQ 聊天」工作区？\n将归档全部 QQ 会话、清除所有上下文映射、清空活动日志。\n此操作不可撤销。')) return;
    const r = await api('/api/workspace/reset', 'POST', {});
    const msg = document.getElementById('clearWsMsg');
    msg.textContent = r.ok ? (`✅ 已归档 ${r.archivedCount} 个会话，工作区已清空`) : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'meta ok' : 'meta err';
    // 会话表与活动日志由各自页面在进入时刷新；全局指标由 app.js 的轮询更新。
  });

  document.getElementById('aiNotifySend').addEventListener('click', async () => {
    const kind = document.getElementById('aiNotifyKind').value;
    const id = document.getElementById('aiNotifyId').value.trim();
    const message = document.getElementById('aiNotifyMessage').value.trim();
    if (!id || !message) { alert('请填写群号/QQ 号和提醒内容'); return; }
    const r = await api('/api/console/notify-ai', 'POST', { key: kind + ':' + id, message });
    const msg = document.getElementById('aiNotifyMsg');
    msg.textContent = r.ok ? ('✅ 已投递到 DSH：' + r.sessionId) : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'meta ok' : 'meta err';
  });
}
