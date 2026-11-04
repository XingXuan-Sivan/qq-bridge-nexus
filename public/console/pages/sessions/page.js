// 会话与审批页（会话映射 / 挂起审批与提问）。
// 页面片段由路由器注入，本模块负责：拉取两张表、绑「清除上下文」、注册刷新、自己首次加载与可见时轮询。
// 概览页的 #metricSessions / #metricPending 与导航角标 #pendingCount 不总在本页，
// 所以写之前一律判空：离开本页后由 app.js 的 refreshSessionMetrics() 继续更新。
import { api } from '../../js/api.js';
import { esc } from '../../js/ui.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';

async function refreshSessions() {
  try {
    const s = await api('/api/sessions');
    const box = document.getElementById('sessionList');
    const metric = document.getElementById('metricSessions');
    if (metric) metric.textContent = s.sessions.length;
    if (!box) return;
    if (!s.sessions.length) {
      box.innerHTML = '<div class="empty-state"><strong>还没有会话</strong><p>白名单中的群或好友发来消息后，会话会显示在这里。</p></div>';
      return;
    }
    let html = '<table><tr><th>QQ 会话</th><th>DSH 会话 ID</th><th>类型</th><th></th></tr>';
    for (const x of s.sessions) {
      const isP = x.key.startsWith('private:');
      const type = isP ? '<span class="pill b">私聊</span>' : '<span class="pill g">群</span>';
      const ownerTag = x.owner ? ' <span class="pill r">管理员</span>' : '';
      html += `<tr><td>${esc(x.key)}${ownerTag}</td><td><code>${esc(x.sessionId)}</code></td><td>${type}</td><td><button class="small" data-reset-key="${esc(x.key)}">清除上下文</button></td></tr>`;
    }
    box.innerHTML = html + '</table>';
    box.querySelectorAll('[data-reset-key]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!confirm('确定清除该会话的上下文？下次消息将开新会话。')) return;
      const r = await api('/api/session/reset', 'POST', { key: btn.dataset.resetKey });
      alert(r.ok ? '✅ 已清除上下文' : ('❌ ' + (r.error || '失败')));
      refreshSessions();
    }));
  } catch {}
}

async function refreshPending() {
  try {
    const p = await api('/api/pending');
    const box = document.getElementById('pendingList');
    const metric = document.getElementById('metricPending');
    if (metric) metric.textContent = p.pending.length;
    const navCount = document.getElementById('pendingCount');
    if (navCount) navCount.textContent = p.pending.length;
    if (!box) return;
    if (!p.pending.length) {
      box.innerHTML = '<div class="empty-state"><strong>暂时没有待处理请求</strong><p>AI 的提问或工具审批会出现在这里，请前往对应 QQ 会话回复。</p></div>';
      return;
    }
    let html = '<table><tr><th>会话</th><th>类型</th><th>详情</th></tr>';
    for (const x of p.pending) {
      const kind = x.kind === 'approval' ? '<span class="pill r">审批</span>' : '<span class="pill b">提问</span>';
      let detail = '';
      if (x.kind === 'approval') detail = `${esc(x.toolName)}${x.reason ? '：' + esc(x.reason) : ''}`;
      else if (x.questions) detail = x.questions.map((q) => esc(q.question)).join(' / ');
      html += `<tr><td>${esc(x.key)}</td><td>${kind}</td><td>${detail}</td></tr>`;
    }
    box.innerHTML = html + '</table>';
  } catch {}
}

function refreshSessionsPage() {
  refreshSessions();
  refreshPending();
}

export function init() {
  // 只在本页可见时轮询：两张表不会在别的页面白白多打接口。
  setInterval(() => {
    if (getCurrentPage() !== 'sessions') return;
    refreshSessionsPage();
  }, 3000);

  onPageRefresh('sessions', () => setTimeout(refreshSessionsPage, 0));
  // 首次进入时片段刚注入，延后一拍再刷。
  setTimeout(refreshSessionsPage, 0);
}
