// 黑话词库页：候选（待研究/已研究）、已确认、已拒绝四栏与批量操作。
// 表格统一走 dataTableHtml（工具栏 + 搜索 + 分页），参数区走字段规格，新增/编辑走弹窗。
import { api } from '../../js/api.js';
import { esc } from '../../js/ui.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { closeModal, openModal, wireModal } from '../../components/modal/modal.js';
import { dataTableHtml, initDataTables, selectCellHtml } from '../../components/table/table.js';
import { bindSwitches, getSwitch, renderFields, setSwitch } from '../../components/form/form.js';
import { SLANG_FIELDS } from './fields.js';

let slangEntriesCache = [];
let slangSelected = new Set();
let slangActiveTab = 'candidate';
let slangModalId = null;
let slangModalMode = 'confirm'; // confirm | edit

// 「候选词-待研究 / 已研究」只是页面上的分栏：数据里都还是 status=candidate（确认、拒绝、研究接口都不变）。
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
    : '<span class="meta">—</span>';
}
// 研究「未确认」时 AI 给的推测（lastGuess）：只作参考，不是含义，不能凭它确认。
function slangGuessHtml(e) {
  const g = e?.lastGuess;
  if (!g || !(g.meaning || g.usage || g.example)) return '';
  const when = g.at ? new Date(g.at).toLocaleString('zh-CN', { hour12: false }) : '';
  return `<span class="meta slang-guess">AI 推测（未确认${when ? '，' + esc(when) : ''}）：${esc(g.meaning || '—')}`
    + (g.usage ? '；用法：' + esc(g.usage) : '') + (g.example ? '；例：' + esc(g.example) : '') + '</span>';
}
function slangHostId(status) {
  return status === 'candidate' ? 'slangCandidateList' : status === 'confirmed' ? 'slangConfirmedList' : 'slangRejectedList';
}
function slangPanelOf(tab) {
  const key = slangTabStatus(tab);
  return 'slangPanel' + key[0].toUpperCase() + key.slice(1);
}
function selectedIdsForStatus(status) {
  return [...slangSelected].filter((id) => slangEntriesCache.some((e) => e.id === id && e.status === status && (status !== 'candidate' || slangInTab(e, slangActiveTab))));
}
function setSlangMsg(text, ok = true) {
  const msg = document.getElementById('slangMsg');
  if (!msg) return;
  msg.textContent = text;
  msg.className = ok ? 'form-actions-status ok' : 'form-actions-status err';
}
function setSlangTab(tab) {
  slangActiveTab = tab;
  // 两个候选分栏共用一套批量按钮：切换时丢掉另一栏里看不见的勾选，批量操作只作用于当前栏
  for (const id of [...slangSelected]) {
    const e = slangEntriesCache.find((x) => x.id === id);
    if (e && e.status === 'candidate' && !slangInTab(e, tab)) slangSelected.delete(id);
  }
  document.querySelectorAll('.slang-tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.slangTab === tab));
  document.querySelectorAll('.slang-panel').forEach((panel) => panel.classList.toggle('active', panel.id === slangPanelOf(tab)));
  renderSlangPanel();
}

/** 表格里只放摘要：超长内容截断并塞进 title，完整内容去「编辑」里看。 */
function clampCell(text, max = 120) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';
  const short = raw.length > max ? `${raw.slice(0, max)}…` : raw;
  return `<div class="cell-clamp" title="${esc(raw)}">${esc(short)}</div>`;
}

const TRASH_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" '
  + 'stroke-width="1.8" stroke-linecap="round" aria-hidden="true">'
  + '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';

/** 一行 = 一个单元格数组；表格组件负责 thead/tbody 与分页、搜索。 */
function slangRowCells(e, status) {
  const guessHtml = status === 'candidate' && !e.meaning ? slangGuessHtml(e) : '';
  const meaning = e.meaning ? clampCell(e.meaning, 120) : (status === 'candidate'
    ? '<span class="meta">待研究</span>'
      + (guessHtml ? `<div class="cell-clamp" title="${esc(e.lastGuess?.meaning || '')}">${guessHtml}</div>`
        + `<button class="btn small" type="button" data-slang-adopt="${esc(e.id)}" title="把推测填进编辑框，改好后再保存">采用为含义</button>` : '')
    : '<span class="meta">无</span>');
  const actions = [];
  if (status === 'candidate') {
    actions.push(`<button class="btn small" type="button" data-slang-confirm="${esc(e.id)}">确认</button>`);
    actions.push(`<button class="btn small" type="button" data-slang-edit="${esc(e.id)}">编辑</button>`);
    actions.push(`<button class="btn small" type="button" data-slang-reject="${esc(e.id)}">拒绝</button>`);
  } else if (status === 'confirmed') {
    actions.push(`<button class="btn small" type="button" data-slang-edit="${esc(e.id)}">编辑</button>`);
  } else {
    actions.push(`<button class="btn small" type="button" data-slang-restore="${esc(e.id)}">恢复候选</button>`);
  }
  actions.push(`<button class="btn-icon" type="button" data-slang-del="${esc(e.id)}" title="删除" aria-label="删除 ${esc(e.content)}">${TRASH_SVG}</button>`);
  const sourceLinks = slangSourcesHtml(e);
  const evidence = Array.isArray(e.evidence) ? e.evidence : [];
  const evidenceLine = evidence[0]?.text
    ? `<div class="cell-clamp" title="${esc(evidence.map((x) => x.text).filter(Boolean).join('\n'))}">`
      + `<span class="meta">${esc(evidence[0].text)}</span></div>`
    : '';
  return [
    selectCellHtml({ value: e.id, checked: slangSelected.has(e.id), label: `选择 ${e.content}` }),
    `<b>${esc(e.content)}</b><br><span class="${slangStatusClass(status)}">${slangStatusLabel(status)}</span>${evidenceLine}`,
    esc(e.count),
    esc(slangSourceLabel(e)),
    meaning,
    clampCell(e.usage, 80) || '<span class="meta">—</span>',
    sourceLinks ? `<div class="cell-clamp">${sourceLinks}</div>` : '<span class="meta">—</span>',
    `<div class="row-actions">${actions.join('')}</div>`,
  ];
}

function slangEmptyText(tab, status) {
  return tab === 'researched'
    ? '暂无已研究的候选：送 DSH 深度研究、或在「编辑」里填写含义后会出现在这里'
    : status === 'candidate'
      ? '暂无待研究的候选，等 DSH 自动提取、AI 提交或手动添加'
      : status === 'confirmed' ? '暂无已确认黑话' : '暂无已拒绝词条';
}

function renderSlangPanel() {
  const tab = slangActiveTab;
  const status = slangTabStatus(tab);
  const pendingN = slangEntriesCache.filter((e) => slangInTab(e, 'candidate')).length;
  const researchedN = slangEntriesCache.filter((e) => slangInTab(e, 'researched')).length;
  const cp = document.getElementById('slangCountPending'); if (cp) cp.textContent = pendingN ? `(${pendingN})` : '';
  const cr = document.getElementById('slangCountResearched'); if (cr) cr.textContent = researchedN ? `(${researchedN})` : '';
  const host = document.getElementById(slangHostId(status));
  if (!host) return;
  const list = slangEntriesCache.filter((e) => slangInTab(e, tab));
  host.innerHTML = dataTableHtml({
    columns: [
      { label: '词条', width: 140 },
      { label: '次数', width: 70 },
      { label: '来源', width: 80 },
      { label: '含义', width: 200 },
      { label: '用法', width: 150 },
      { label: '参考来源', width: 110 },
      { label: '操作', width: 260 },
    ],
    rows: list.map((e) => slangRowCells(e, status)),
    pageSize: 20,
    sizes: [20, 50, 100],
    select: { label: '选择', width: 60 },
    search: { placeholder: tab === 'rejected' ? '搜索词条 / 拒绝原因' : '搜索词条 / 含义 / 用法 / 示例 / 来源' },
    refresh: true,
    actions: '<button class="btn" id="slangAddOpen" type="button">手动添加</button>',
    empty: slangEmptyText(tab, status),
  });
  initDataTables(host, { onRefresh: () => { void refreshSlang(); } });
  bindSlangRowEvents(host, status);
}

function bindSlangRowEvents(host, status) {
  // 多选列由表格组件生成（表头全选 + 行 data-select-row）；这里只把勾选状态同步进集合。
  host.addEventListener('change', (event) => {
    const box = event.target;
    if (!(box instanceof HTMLInputElement) || box.type !== 'checkbox') return;
    if (box.matches('[data-select-all]')) {
      for (const row of host.querySelectorAll('tbody input[data-select-row]')) {
        if (row.checked) slangSelected.add(row.value); else slangSelected.delete(row.value);
      }
      return;
    }
    if (box.matches('input[data-select-row]')) {
      if (box.checked) slangSelected.add(box.value); else slangSelected.delete(box.value);
    }
  });
  host.querySelectorAll('[data-slang-confirm]').forEach((btn) => btn.addEventListener('click', () => openSlangModal(btn.dataset.slangConfirm, 'confirm')));
  host.querySelectorAll('[data-slang-edit]').forEach((btn) => btn.addEventListener('click', () => openSlangModal(btn.dataset.slangEdit, 'edit')));
  host.querySelectorAll('[data-slang-adopt]').forEach((btn) => btn.addEventListener('click', () => openSlangModal(btn.dataset.slangAdopt, 'edit', { adoptGuess: true })));
  host.querySelectorAll('[data-slang-reject]').forEach((btn) => btn.addEventListener('click', async () => {
    const r2 = await api('/api/slang/' + btn.dataset.slangReject + '/reject', 'POST', {});
    if (!r2.ok) alert(r2.error || '拒绝失败');
    setSlangMsg(r2.ok ? '✅ 已拒绝' : ('❌ ' + (r2.error || '失败')), r2.ok);
    refreshSlang();
  }));
  host.querySelectorAll('[data-slang-restore]').forEach((btn) => btn.addEventListener('click', async () => {
    const e = slangEntriesCache.find((x) => x.id === btn.dataset.slangRestore);
    if (!e) return;
    const r2 = await api('/api/slang/' + e.id, 'PATCH', { status: 'candidate' });
    if (!r2.ok) alert(r2.error || '恢复失败');
    setSlangMsg(r2.ok ? '✅ 已恢复为候选' : ('❌ ' + (r2.error || '失败')), r2.ok);
    refreshSlang();
  }));
  host.querySelectorAll('[data-slang-del]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('确定删除该黑话？')) return;
    const r2 = await api('/api/slang/' + btn.dataset.slangDel, 'DELETE', {});
    if (!r2.ok) alert(r2.error || '删除失败');
    setSlangMsg(r2.ok ? '✅ 已删除' : ('❌ ' + (r2.error || '失败')), r2.ok);
    slangSelected.delete(btn.dataset.slangDel);
    refreshSlang();
  }));
}

async function refreshSlang() {
  try {
    const r = await api('/api/slang');
    slangEntriesCache = r.entries || [];
    renderSlangPanel();
  } catch (e) {
    const box = document.getElementById(slangHostId(slangTabStatus(slangActiveTab)));
    if (box) box.innerHTML = '<div class="meta u-p-8">加载失败</div>';
  }
}

function openSlangModal(id, mode, { adoptGuess = false } = {}) {
  const e = slangEntriesCache.find((x) => x.id === id);
  if (!e) return;
  slangModalId = id;
  slangModalMode = mode;
  document.getElementById('slangModalTitle').textContent = mode === 'confirm' ? `确认黑话：${e.content}` : `编辑黑话：${e.content}`;
  document.getElementById('slangModalContent').textContent = mode === 'confirm'
    ? '可以直接填写含义/用法并转正，也可以先送 DSH 深度联网研究，研究结果回来后在此处删改再确认。'
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
    for (const [field, inputId] of [['meaning', 'slangModalMeaning'], ['usage', 'slangModalUsage'], ['example', 'slangModalExample']]) {
      const input = document.getElementById(inputId);
      if (!input.value.trim() && e.lastGuess[field]) input.value = e.lastGuess[field];
    }
  }
  document.getElementById('slangModalDirectConfirm').textContent = mode === 'confirm' ? '直接确认（转正）' : '保存修改';
  document.getElementById('slangModalSendResearch').hidden = !(mode === 'confirm' && e.status === 'candidate');
  openModal(document.getElementById('slangModalOverlay'));
}
function closeSlangModal() {
  closeModal(document.getElementById('slangModalOverlay'));
  slangModalId = null;
}
function readSlangModalPayload() {
  return {
    meaning: document.getElementById('slangModalMeaning').value.trim(),
    usage: document.getElementById('slangModalUsage').value.trim(),
    example: document.getElementById('slangModalExample').value.trim(),
    risk: document.getElementById('slangModalRisk').value.trim(),
    sources: document.getElementById('slangModalSources').value.split(/\n/).map((s) => s.trim()).filter(Boolean),
  };
}

function loadSlangConfig() {
  api('/api/slang').then((r) => {
    const c = r.config || {};
    setSwitch(document.getElementById('slangEnabled'), c.enabled !== false);
    document.getElementById('slangExtractMin').value = c.extractMinMessages ?? 10;
    document.getElementById('slangCooldown').value = c.extractCooldownMs ?? 300000;
    document.getElementById('slangThresholds').value = (c.inferenceThresholds || [2, 4, 8]).join(', ');
    document.getElementById('slangInjectMax').value = c.injectMax ?? 8;
    document.getElementById('slangLearnerPreset').value = c.learnerPreset || 'qq-chat';
    document.getElementById('slangWorkspaceTitle').value = c.workspaceTitle || 'QQ 黑话学习';
    setSwitch(document.getElementById('slangAutoResearch'), c.autoResearch !== false);
  }).catch(() => {});
}

export function init() {
  const root = document.getElementById('section-slang');
  // 字段规格先渲染，后面所有 getElementById 才取得到节点。
  root.querySelectorAll('[data-slang-fields]').forEach((host) => {
    const spec = SLANG_FIELDS[host.dataset.slangFields];
    if (!spec) return;
    // 分栏切换与批量操作条不是字段：规格里给 html，整段注入（控件仍写在 fields.js，页面不手写）。
    if (spec.html) { host.innerHTML = spec.html; return; }
    renderFields(host, spec.fields, { columns: 2 });
  });
  const addHost = document.getElementById('slangAddFields');
  if (addHost) renderFields(addHost, SLANG_FIELDS.add.fields, { columns: 1 });
  // 开关是 <button role="switch">，点击委托必须显式绑。
  bindSwitches(root);
  bindSwitches(document.getElementById('slangAddOverlay'));

  document.querySelectorAll('.slang-tab').forEach((btn) => btn.addEventListener('click', () => setSlangTab(btn.dataset.slangTab)));

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

  // 手动添加：弹窗打开 → 填词条/含义 → 保存（旧的「添加入库」按钮改为弹窗里的提交）。
  // 按钮在表格自带工具栏里，每次刷新都会重建，所以用 document 级委托。
  const addOverlay = document.getElementById('slangAddOverlay');
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('#slangAddOpen')) return;
    for (const id of ['slangContent', 'slangMeaning', 'slangUsage', 'slangExample']) document.getElementById(id).value = '';
    openModal(addOverlay);
    document.getElementById('slangContent').focus();
  });
  document.getElementById('slangAddCancel').addEventListener('click', () => closeModal(addOverlay));
  wireModal(addOverlay, { onClose: () => {} });
  document.getElementById('slangAdd').addEventListener('click', async () => {
    const content = document.getElementById('slangContent').value.trim();
    const meaning = document.getElementById('slangMeaning').value.trim();
    const usage = document.getElementById('slangUsage').value.trim();
    const example = document.getElementById('slangExample').value.trim();
    const msg = document.getElementById('slangAddMsg');
    if (!content) { msg.textContent = '词条不能为空'; msg.className = 'modal-status err'; return; }
    const r = await api('/api/slang', 'POST', { content, meaning, usage, example });
    if (!r.ok) { msg.textContent = '❌ ' + (r.error || '失败'); msg.className = 'modal-status err'; return; }
    msg.textContent = '';
    closeModal(addOverlay);
    setSlangMsg(`✅ 已添加「${content}」`, true);
    refreshSlang();
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
      enabled: getSwitch(document.getElementById('slangEnabled')),
      extractMinMessages: Number(document.getElementById('slangExtractMin').value) || 10,
      extractCooldownMs: Number(document.getElementById('slangCooldown').value) || 300000,
      inferenceThresholds: document.getElementById('slangThresholds').value.split(/[,，\s]+/).map(Number).filter(Boolean),
      injectMax: Number(document.getElementById('slangInjectMax').value) || 8,
      learnerPreset: document.getElementById('slangLearnerPreset').value.trim(),
      workspaceTitle: document.getElementById('slangWorkspaceTitle').value.trim(),
      autoResearch: getSwitch(document.getElementById('slangAutoResearch')),
    });
    const msg = document.getElementById('slangConfigMsg');
    msg.textContent = r.ok ? '✅ 已保存' : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'form-actions-status ok' : 'form-actions-status err';
    if (r.ok) loadSlangConfig();
  });

  // 编辑/确认弹窗：DOM 在 index.html，启动即存在；init 只跑一次。
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
  wireModal(document.getElementById('slangModalOverlay'), { closeOnEscape: false });

  onPageRefresh('slang', () => { refreshSlang(); });
  setInterval(() => { if (getCurrentPage() === 'slang' && !document.hidden) refreshSlang(); }, 3000);
  refreshSlang();
  loadSlangConfig();
}
