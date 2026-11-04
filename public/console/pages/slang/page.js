// 黑话词库页：候选（待研究/已研究）、已确认、已拒绝四栏与批量操作。
// 确认/编辑模态的 DOM 留在 index.html（共享 modal 宿主，不属于页面片段）；本模块只搬逻辑。
// 页面目录约定（docs/PLUGIN_ROADMAP.md §8.7）：page.js 导出 init()，路由器在片段注入后调用一次。
import { api } from '../../js/api.js';
import { esc } from '../../js/ui.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';

let slangEntriesCache = [];
let slangSelected = new Set();
let slangActiveTab = 'candidate';
let slangModalId = null;
let slangModalMode = 'confirm'; // confirm | edit

// 「候选词-待研究 / 已研究」只是页面上的分栏：数据里都还是 status=candidate（确认、拒绝、研究接口都不变）。
// 有含义、用法或示例之一就算已研究（DSH 研究结果或手填都算）。
function slangIsResearched(e) {
  return !!(String(e?.meaning ?? '').trim() || String(e?.usage ?? '').trim() || String(e?.example ?? '').trim());
}
function slangTabStatus(tab) { return tab === 'researched' ? 'candidate' : tab; }
function slangInTab(e, tab) {
  if (e.status !== slangTabStatus(tab)) return false;
  if (tab === 'candidate') return !slangIsResearched(e);
  if (tab === 'researched') return slangIsResearched(e);
  return true;
}
function slangStatusLabel(status) {
  return { candidate: '候选', confirmed: '已确认', rejected: '已拒绝' }[status] || esc(status);
}
function slangStatusClass(status) {
  return { candidate: 'pill b', confirmed: 'pill g', rejected: 'pill r' }[status] || 'pill';
}
function slangSourceLabel(e) {
  if (e.source === 'manual') return '手动';
  if (Array.isArray(e.evidence) && e.evidence.some((ev) => ev.sender === 'AI提交')) return 'AI提交';
  return '自动提取';
}
function slangEvidenceHtml(e) {
  return Array.isArray(e.evidence) && e.evidence.length
    ? e.evidence.slice(-2).map((ev) => `<span class="meta">${esc(String(ev.sender || '未知'))}：${esc(String(ev.text || '').slice(0, 30))}</span>`).join('<br>')
    : '<span class="meta">—</span>';
}
function slangSourcesHtml(e) {
  return Array.isArray(e.sources) && e.sources.length
    ? e.sources.slice(0, 5).map((s) => `<span class="meta">🔗 ${esc(s)}</span>`).join('<br>')
    : '';
}
// 研究「未确认」时 AI 给的推测（lastGuess）：只是给管理员参考，不是含义——
// 不算「已研究」、不能凭它确认，也不会注入提示词；「采用为含义」只是填进编辑框，保存仍由管理员点。
function slangGuessHtml(e) {
  const g = e?.lastGuess;
  if (!g || !(g.meaning || g.usage || g.example)) return '';
  const when = g.at ? new Date(g.at).toLocaleString('zh-CN', { hour12: false }) : '';
  return `<span class="meta slang-guess">AI 推测（未确认${when ? '，' + esc(when) : ''}）：${esc(g.meaning || '—')}`
    + (g.usage ? '；用法：' + esc(g.usage) : '') + (g.example ? '；例：' + esc(g.example) : '') + '</span>';
}
function slangSearchFields(e) {
  return [e.content, e.meaning, e.usage, e.example, e.risk, e.lastGuess?.meaning || '', Array.isArray(e.sources) ? e.sources.join(' ') : '', Array.isArray(e.evidence) ? e.evidence.map((x) => x.text || '').join(' ') : ''].join(' ').toLowerCase();
}
function getSlangLimit() {
  const id = slangTabStatus(slangActiveTab) === 'candidate' ? 'slangLimitCand' : slangActiveTab === 'confirmed' ? 'slangLimitConfirmed' : 'slangLimitRejected';
  return Math.max(10, Number(document.getElementById(id)?.value) || 100);
}
function getSlangSearch() {
  const id = slangTabStatus(slangActiveTab) === 'candidate' ? 'slangSearchCand' : slangActiveTab === 'confirmed' ? 'slangSearchConfirmed' : 'slangSearchRejected';
  return String(document.getElementById(id)?.value || '').trim().toLowerCase();
}
function selectedIdsForStatus(status) {
  return [...slangSelected].filter((id) => slangEntriesCache.some((e) => e.id === id && e.status === status && (status !== 'candidate' || slangInTab(e, slangActiveTab))));
}
function setSlangMsg(text, ok = true) {
  const msg = document.getElementById('slangMsg');
  if (!msg) return;
  msg.textContent = text;
  msg.className = ok ? 'meta ok' : 'meta err';
}
function setSlangTab(tab) {
  slangActiveTab = tab;
  // 两个候选分栏共用一套批量按钮：切换时丢掉另一栏里看不见的勾选，批量操作只作用于当前栏
  for (const id of [...slangSelected]) {
    const e = slangEntriesCache.find((x) => x.id === id);
    if (e && e.status === 'candidate' && !slangInTab(e, tab)) slangSelected.delete(id);
  }
  const panelKey = slangTabStatus(tab);
  document.querySelectorAll('.slang-tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.slangTab === tab));
  document.querySelectorAll('.slang-panel').forEach((panel) => panel.classList.toggle('active', panel.id === 'slangPanel' + panelKey[0].toUpperCase() + panelKey.slice(1)));
  renderSlangPanel();
}
function updateSlangSelectAll(status) {
  const id = status === 'candidate' ? 'slangCandidateSelectAll' : status === 'confirmed' ? 'slangConfirmedSelectAll' : 'slangRejectedSelectAll';
  const el = document.getElementById(id);
  if (!el) return;
  const list = slangEntriesCache.filter((e) => slangInTab(e, slangActiveTab));
  const q = getSlangSearch();
  const filtered = q ? list.filter((e) => slangSearchFields(e).includes(q)) : list;
  el.checked = filtered.length > 0 && filtered.every((e) => slangSelected.has(e.id));
  el.indeterminate = filtered.some((e) => slangSelected.has(e.id)) && !el.checked;
}

function renderSlangPanel() {
  const tab = slangActiveTab;
  const status = slangTabStatus(tab);
  const pendingN = slangEntriesCache.filter((e) => slangInTab(e, 'candidate')).length;
  const researchedN = slangEntriesCache.filter((e) => slangInTab(e, 'researched')).length;
  const cp = document.getElementById('slangCountPending'); if (cp) cp.textContent = pendingN ? `(${pendingN})` : '';
  const cr = document.getElementById('slangCountResearched'); if (cr) cr.textContent = researchedN ? `(${researchedN})` : '';
  const containerId = status === 'candidate' ? 'slangCandidateList' : status === 'confirmed' ? 'slangConfirmedList' : 'slangRejectedList';
  const box = document.getElementById(containerId);
  if (!box) return;
  const list = slangEntriesCache.filter((e) => slangInTab(e, tab));
  const q = getSlangSearch();
  const filtered = q ? list.filter((e) => slangSearchFields(e).includes(q)) : list;
  if (!filtered.length) {
    box.innerHTML = '<div class="meta u-p-8">' + (list.length ? '没有符合条件的词条' : (tab === 'researched' ? '暂无已研究的候选：送 DSH 深度研究、或在「编辑」里填写含义后会出现在这里' : status === 'candidate' ? '暂无待研究的候选，等 DSH 自动提取、AI 提交或手动添加' : status === 'confirmed' ? '暂无已确认黑话' : '暂无已拒绝词条')) + '</div>';
    updateSlangSelectAll(status);
    return;
  }
  const limit = getSlangLimit();
  const shown = filtered.slice(0, limit);
  let html = `<div class="meta u-p-6-8">共 ${filtered.length} 条，显示 ${shown.length} 条（可滚动查找）</div>`;
  html += '<table><tr><th>选择</th><th>词条</th><th>次数</th><th>来源</th><th>含义 / 用法 / 示例</th><th>参考来源</th><th>语境证据</th><th>操作</th></tr>';
  for (const e of shown) {
    const guessHtml = status === 'candidate' && !e.meaning ? slangGuessHtml(e) : '';
    const meaning = e.meaning ? esc(e.meaning) : (status === 'candidate'
      ? '<span class="meta">待研究</span>' + (guessHtml ? `<br>${guessHtml}<br><button class="small" data-slang-adopt="${esc(e.id)}" title="把推测填进编辑框，改好后再保存">采用为含义</button>` : '')
      : '<span class="meta">无</span>');
    const checked = slangSelected.has(e.id) ? ' checked' : '';
    const actions = [];
    if (status === 'candidate') {
      actions.push(`<button class="small" data-slang-confirm="${esc(e.id)}">确认</button>`);
      actions.push(`<button class="small" data-slang-edit="${esc(e.id)}">编辑</button>`);
      actions.push(`<button class="small" data-slang-reject="${esc(e.id)}">拒绝</button>`);
    } else if (status === 'confirmed') {
      actions.push(`<button class="small" data-slang-edit="${esc(e.id)}">编辑</button>`);
    } else {
      actions.push(`<button class="small" data-slang-restore="${esc(e.id)}">恢复候选</button>`);
    }
    actions.push(`<button class="small danger" data-slang-del="${esc(e.id)}">删</button>`);
    html += `<tr>
      <td><input type="checkbox" data-slang-select="${esc(e.id)}"${checked}></td>
      <td><b>${esc(e.content)}</b><br><span class="${slangStatusClass(status)}">${slangStatusLabel(status)}</span></td>
      <td>${esc(e.count)}</td>
      <td>${esc(slangSourceLabel(e))}</td>
      <td>${meaning}${e.usage ? '<br><span class="meta">用法：' + esc(e.usage) + '</span>' : ''}${e.example ? '<br><span class="meta">例：' + esc(e.example) + '</span>' : ''}${e.risk ? '<br><span class="meta">风险：' + esc(e.risk) + '</span>' : ''}</td>
      <td>${slangSourcesHtml(e) || '<span class="meta">—</span>'}</td>
      <td>${slangEvidenceHtml(e)}</td>
      <td class="row">${actions.join('')}</td>
    </tr>`;
  }
  box.innerHTML = html + '</table>';
  box.querySelectorAll('[data-slang-select]').forEach((cb) => cb.addEventListener('change', () => {
    const id = cb.dataset.slangSelect;
    if (cb.checked) slangSelected.add(id); else slangSelected.delete(id);
    updateSlangSelectAll(status);
  }));
  box.querySelectorAll('[data-slang-confirm]').forEach((btn) => btn.addEventListener('click', () => openSlangModal(btn.dataset.slangConfirm, 'confirm')));
  box.querySelectorAll('[data-slang-edit]').forEach((btn) => btn.addEventListener('click', () => openSlangModal(btn.dataset.slangEdit, 'edit')));
  box.querySelectorAll('[data-slang-adopt]').forEach((btn) => btn.addEventListener('click', () => openSlangModal(btn.dataset.slangAdopt, 'edit', { adoptGuess: true })));
  box.querySelectorAll('[data-slang-reject]').forEach((btn) => btn.addEventListener('click', async () => {
    const r2 = await api('/api/slang/' + btn.dataset.slangReject + '/reject', 'POST', {});
    if (!r2.ok) alert(r2.error || '拒绝失败');
    setSlangMsg(r2.ok ? '✅ 已拒绝' : ('❌ ' + (r2.error || '失败')), r2.ok);
    refreshSlang();
  }));
  box.querySelectorAll('[data-slang-restore]').forEach((btn) => btn.addEventListener('click', async () => {
    const e = slangEntriesCache.find((x) => x.id === btn.dataset.slangRestore);
    if (!e) return;
    const r2 = await api('/api/slang/' + e.id, 'PATCH', { status: 'candidate' });
    if (!r2.ok) alert(r2.error || '恢复失败');
    setSlangMsg(r2.ok ? '✅ 已恢复为候选' : ('❌ ' + (r2.error || '失败')), r2.ok);
    refreshSlang();
  }));
  box.querySelectorAll('[data-slang-del]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('确定删除该黑话？')) return;
    const r2 = await api('/api/slang/' + btn.dataset.slangDel, 'DELETE', {});
    if (!r2.ok) alert(r2.error || '删除失败');
    setSlangMsg(r2.ok ? '✅ 已删除' : ('❌ ' + (r2.error || '失败')), r2.ok);
    slangSelected.delete(btn.dataset.slangDel);
    refreshSlang();
  }));
  updateSlangSelectAll(status);
}

async function refreshSlang() {
  try {
    const r = await api('/api/slang');
    slangEntriesCache = r.entries || [];
    renderSlangPanel();
  } catch (e) {
    const box = document.getElementById('slangCandidateList');
    if (box) box.innerHTML = '<span class="meta">加载失败</span>';
  }
}

function openSlangModal(id, mode, { adoptGuess = false } = {}) {
  const e = slangEntriesCache.find((x) => x.id === id);
  if (!e) return;
  slangModalId = id;
  slangModalMode = mode;
  document.getElementById('slangModalTitle').textContent = mode === 'confirm' ? `确认黑话：${e.content}` : `编辑黑话：${e.content}`;
  document.getElementById('slangModalContent').textContent = mode === 'confirm'
    ? '你可以直接填写含义/用法并转正，也可以先送 DSH 深度联网研究，研究结果回来后在此处删改再确认。'
    : '修改后保存；候选不会转正，已确认仍保持已确认。';
  document.getElementById('slangModalMeaning').value = e.meaning || '';
  document.getElementById('slangModalUsage').value = e.usage || '';
  document.getElementById('slangModalExample').value = e.example || '';
  document.getElementById('slangModalRisk').value = e.risk || '';
  document.getElementById('slangModalSources').value = Array.isArray(e.sources) ? e.sources.join('\n') : '';
  const guessBox = document.getElementById('slangModalGuess');
  const guessHtml = !e.meaning ? slangGuessHtml(e) : '';
  guessBox.innerHTML = guessHtml ? guessHtml + '<br>' + (adoptGuess ? '已把推测填进空着的栏位：请核对、修改后再保存（推测不一定对）。' : '可以参考它填写含义。') : '';
  guessBox.hidden = !guessHtml;
  if (adoptGuess && guessHtml) {
    // 只填空着的栏位，不覆盖管理员已经写的内容
    for (const [field, inputId] of [['meaning', 'slangModalMeaning'], ['usage', 'slangModalUsage'], ['example', 'slangModalExample']]) {
      const input = document.getElementById(inputId);
      if (!input.value.trim() && e.lastGuess[field]) input.value = e.lastGuess[field];
    }
  }
  document.getElementById('slangModalDirectConfirm').textContent = mode === 'confirm' ? '直接确认（转正）' : '保存修改';
  document.getElementById('slangModalSendResearch').hidden = !(mode === 'confirm' && e.status === 'candidate');
  document.getElementById('slangModalOverlay').classList.add('open');
}
function closeSlangModal() {
  document.getElementById('slangModalOverlay').classList.remove('open');
  slangModalId = null;
}
function readSlangModalPayload() {
  return {
    meaning: document.getElementById('slangModalMeaning').value.trim(),
    usage: document.getElementById('slangModalUsage').value.trim(),
    example: document.getElementById('slangModalExample').value.trim(),
    risk: document.getElementById('slangModalRisk').value.trim(),
    sources: document.getElementById('slangModalSources').value.split(/\n/).map((s) => s.trim()).filter(Boolean)
  };
}

function loadSlangConfig() {
  api('/api/slang').then(r => {
    const c = r.config || {};
    document.getElementById('slangEnabled').checked = c.enabled !== false;
    document.getElementById('slangExtractMin').value = c.extractMinMessages ?? 10;
    document.getElementById('slangCooldown').value = c.extractCooldownMs ?? 300000;
    document.getElementById('slangThresholds').value = (c.inferenceThresholds || [2, 4, 8]).join(', ');
    document.getElementById('slangInjectMax').value = c.injectMax ?? 8;
    document.getElementById('slangLearnerPreset').value = c.learnerPreset || 'qq-chat';
    document.getElementById('slangWorkspaceTitle').value = c.workspaceTitle || 'QQ 黑话学习';
    document.getElementById('slangAutoResearch').checked = c.autoResearch !== false;
  }).catch(() => {});
}

export function init() {
  document.querySelectorAll('.slang-tab').forEach((btn) => btn.addEventListener('click', () => setSlangTab(btn.dataset.slangTab)));
  document.getElementById('slangSearchCand').addEventListener('input', renderSlangPanel);
  document.getElementById('slangSearchConfirmed').addEventListener('input', renderSlangPanel);
  document.getElementById('slangSearchRejected').addEventListener('input', renderSlangPanel);
  document.getElementById('slangLimitCand').addEventListener('change', renderSlangPanel);
  document.getElementById('slangLimitConfirmed').addEventListener('change', renderSlangPanel);
  document.getElementById('slangLimitRejected').addEventListener('change', renderSlangPanel);
  document.getElementById('slangCandidateSelectAll').addEventListener('change', (e) => {
    const list = slangEntriesCache.filter((x) => slangInTab(x, slangActiveTab));
    const q = getSlangSearch();
    const filtered = q ? list.filter((x) => slangSearchFields(x).includes(q)) : list;
    for (const x of filtered) { if (e.target.checked) slangSelected.add(x.id); else slangSelected.delete(x.id); }
    renderSlangPanel();
  });
  document.getElementById('slangConfirmedSelectAll').addEventListener('change', (e) => {
    const list = slangEntriesCache.filter((x) => x.status === 'confirmed');
    const q = getSlangSearch();
    const filtered = q ? list.filter((x) => slangSearchFields(x).includes(q)) : list;
    for (const x of filtered) { if (e.target.checked) slangSelected.add(x.id); else slangSelected.delete(x.id); }
    renderSlangPanel();
  });
  document.getElementById('slangRejectedSelectAll').addEventListener('change', (e) => {
    const list = slangEntriesCache.filter((x) => x.status === 'rejected');
    const q = getSlangSearch();
    const filtered = q ? list.filter((x) => slangSearchFields(x).includes(q)) : list;
    for (const x of filtered) { if (e.target.checked) slangSelected.add(x.id); else slangSelected.delete(x.id); }
    renderSlangPanel();
  });
  document.getElementById('slangBatchResearch').addEventListener('click', async () => {
    const ids = selectedIdsForStatus('candidate');
    if (!ids.length) { alert('请先勾选要研究的候选词'); return; }
    const r = await api('/api/slang/research', 'POST', { ids });
    setSlangMsg(r.ok ? `✅ 已送 ${r.count} 条候选到 DSH 深度联网研究，完成后刷新查看结果` : ('❌ ' + (r.error || '失败')), r.ok);
    if (r.ok) refreshSlang();
  });
  document.getElementById('slangBatchConfirm').addEventListener('click', async () => {
    const ids = selectedIdsForStatus('candidate');
    if (!ids.length) { alert('请先勾选要确认的候选词'); return; }
    if (!confirm(`确定批量确认 ${ids.length} 条候选？缺少含义的会被跳过。`)) return;
    const r = await api('/api/slang/batch-confirm', 'POST', { ids });
    setSlangMsg(r.ok ? `✅ 已确认 ${r.confirmedCount} 条，跳过 ${r.skippedCount} 条` : ('❌ ' + (r.error || '失败')), r.ok);
    if (r.ok) { slangSelected.clear(); refreshSlang(); }
  });
  document.getElementById('slangBatchReject').addEventListener('click', async () => {
    const ids = selectedIdsForStatus('candidate');
    if (!ids.length) { alert('请先勾选要拒绝的候选词'); return; }
    if (!confirm(`确定拒绝 ${ids.length} 条候选？`)) return;
    const r = await api('/api/slang/batch-reject', 'POST', { ids });
    setSlangMsg(r.ok ? `✅ 已拒绝 ${r.rejectedCount} 条` : ('❌ ' + (r.error || '失败')), r.ok);
    if (r.ok) { slangSelected.clear(); refreshSlang(); }
  });
  document.getElementById('slangBatchDeleteCand').addEventListener('click', async () => {
    const ids = selectedIdsForStatus('candidate');
    if (!ids.length) { alert('请先勾选要删除的候选词'); return; }
    if (!confirm(`确定删除 ${ids.length} 条候选？此操作不可恢复！`)) return;
    const r = await api('/api/slang/batch-delete', 'POST', { ids });
    setSlangMsg(r.ok ? `✅ 已删除 ${r.removedCount} 条候选` : ('❌ ' + (r.error || '失败')), r.ok);
    if (r.ok) { slangSelected.clear(); refreshSlang(); }
  });
  document.getElementById('slangBatchDeleteConfirmed').addEventListener('click', async () => {
    const ids = selectedIdsForStatus('confirmed');
    if (!ids.length) { alert('请先勾选要删除的已确认词条'); return; }
    if (!confirm(`确定删除 ${ids.length} 条已确认黑话？此操作不可恢复！`)) return;
    const r = await api('/api/slang/batch-delete', 'POST', { ids });
    setSlangMsg(r.ok ? `✅ 已删除 ${r.removedCount} 条已确认` : ('❌ ' + (r.error || '失败')), r.ok);
    if (r.ok) { slangSelected.clear(); refreshSlang(); }
  });
  document.getElementById('slangBatchDeleteRejected').addEventListener('click', async () => {
    const ids = selectedIdsForStatus('rejected');
    if (!ids.length) { alert('请先勾选要删除的已拒绝词条'); return; }
    if (!confirm(`确定删除 ${ids.length} 条已拒绝词条？此操作不可恢复！`)) return;
    const r = await api('/api/slang/batch-delete', 'POST', { ids });
    setSlangMsg(r.ok ? `✅ 已删除 ${r.removedCount} 条已拒绝` : ('❌ ' + (r.error || '失败')), r.ok);
    if (r.ok) { slangSelected.clear(); refreshSlang(); }
  });
  document.getElementById('slangBatchRestore').addEventListener('click', async () => {
    const ids = selectedIdsForStatus('rejected');
    if (!ids.length) { alert('请先勾选要恢复的已拒绝词条'); return; }
    let okCount = 0;
    for (const id of ids) {
      const r = await api('/api/slang/' + id, 'PATCH', { status: 'candidate' });
      if (r.ok) okCount++;
    }
    setSlangMsg(`✅ 已恢复 ${okCount}/${ids.length} 条为候选`);
    if (okCount) { slangSelected.clear(); refreshSlang(); }
  });
  document.getElementById('slangModalDirectConfirm').addEventListener('click', async () => {
    if (!slangModalId) return;
    const payload = readSlangModalPayload();
    if (!payload.meaning) { alert('请先填写含义，确认后才会注入 AI 上下文'); return; }
    const e = slangEntriesCache.find((x) => x.id === slangModalId);
    if (!e) return;
    const path = slangModalMode === 'confirm' ? `/api/slang/${e.id}/confirm` : `/api/slang/${e.id}`;
    const r2 = await api(path, slangModalMode === 'confirm' ? 'POST' : 'PATCH', payload);
    if (!r2.ok) alert(r2.error || '保存失败');
    setSlangMsg(r2.ok ? (slangModalMode === 'confirm' ? '✅ 已确认转正' : '✅ 已保存') : ('❌ ' + (r2.error || '失败')), r2.ok);
    closeSlangModal();
    refreshSlang();
  });
  document.getElementById('slangModalSendResearch').addEventListener('click', async () => {
    if (!slangModalId) return;
    const r = await api('/api/slang/research', 'POST', { ids: [slangModalId] });
    setSlangMsg(r.ok ? `✅ 已送「${slangEntriesCache.find((x) => x.id === slangModalId)?.content || ''}」到 DSH 深度联网研究，稍后刷新查看结果` : ('❌ ' + (r.error || '失败')), r.ok);
    closeSlangModal();
    refreshSlang();
  });
  document.getElementById('slangModalCancel').addEventListener('click', closeSlangModal);
  document.getElementById('slangModalOverlay').addEventListener('click', (e) => { if (e.target.id === 'slangModalOverlay') closeSlangModal(); });
  document.getElementById('slangAdd').addEventListener('click', async () => {
    const content = document.getElementById('slangContent').value.trim();
    const meaning = document.getElementById('slangMeaning').value.trim();
    const usage = document.getElementById('slangUsage').value.trim();
    const example = document.getElementById('slangExample').value.trim();
    if (!content) { alert('词条不能为空'); return; }
    const r = await api('/api/slang', 'POST', { content, meaning, usage, example });
    document.getElementById('slangMsg').textContent = r.ok ? '✅ 已添加' : ('❌ ' + (r.error || '失败'));
    document.getElementById('slangMsg').className = r.ok ? 'meta ok' : 'meta err';
    if (r.ok) {
      document.getElementById('slangContent').value = '';
      document.getElementById('slangMeaning').value = '';
      document.getElementById('slangUsage').value = '';
      document.getElementById('slangExample').value = '';
      refreshSlang();
    }
  });
  document.getElementById('slangExtract').addEventListener('click', async () => {
    const r = await api('/api/slang/extract', 'POST', {});
    setSlangMsg(r.ok ? '✅ 已触发提取' : ('❌ ' + (r.error || '失败')), r.ok);
  });
  document.getElementById('slangResearch').addEventListener('click', async () => {
    const r = await api('/api/slang/research', 'POST', {});
    setSlangMsg(r.ok ? ('✅ 已触发研究 ' + r.count + ' 条') : ('❌ ' + (r.error || '失败')), r.ok);
  });
  document.getElementById('slangConfigSave').addEventListener('click', async () => {
    const r = await api('/api/slang/config', 'POST', {
      enabled: document.getElementById('slangEnabled').checked,
      extractMinMessages: Number(document.getElementById('slangExtractMin').value) || 10,
      extractCooldownMs: Number(document.getElementById('slangCooldown').value) || 300000,
      inferenceThresholds: document.getElementById('slangThresholds').value.split(/[,，\s]+/).map(Number).filter(Boolean),
      injectMax: Number(document.getElementById('slangInjectMax').value) || 8,
      learnerPreset: document.getElementById('slangLearnerPreset').value.trim(),
      workspaceTitle: document.getElementById('slangWorkspaceTitle').value.trim(),
      autoResearch: document.getElementById('slangAutoResearch').checked
    });
    const msg = document.getElementById('slangConfigMsg');
    msg.textContent = r.ok ? '✅ 已保存' : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'meta ok' : 'meta err';
    if (r.ok) loadSlangConfig();
  });

  // 模态的键盘支持（DOM 在 index.html，启动即存在；init 只会跑一次，不会重复绑定）。
  let modalPreviousFocus;
  const slangOverlay = document.getElementById('slangModalOverlay');
  new MutationObserver(() => {
    if (slangOverlay.classList.contains('open')) {
      modalPreviousFocus = document.activeElement;
      document.getElementById('slangModalMeaning').focus();
    } else modalPreviousFocus?.focus();
  }).observe(slangOverlay, { attributes: true, attributeFilter: ['class'] });
  slangOverlay.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeSlangModal(); }
    if (event.key === 'Tab') {
      const controls = [...slangOverlay.querySelectorAll('button,input,textarea,select')].filter(el => !el.disabled && el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  // 被切回本页时重读词库；定时轮询只在本页可见时跑（原来 3 秒一次，搬过来后不再拖累其它页）。
  onPageRefresh('slang', () => { refreshSlang(); });
  setInterval(() => { if (getCurrentPage() === 'slang' && !document.hidden) refreshSlang(); }, 3000);
  refreshSlang();
  loadSlangConfig();
}
