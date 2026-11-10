// 记忆页：注入源、provider、本机轻量记忆、工具开关、写回队列与最近活动。
// 规格见 docs/MEMORY_SUBSYSTEM.md §4；provider 卡片与列表依赖 /api/memory 的返回，由本文件渲染。
import { api } from '../../js/api.js';
import { esc } from '../../js/ui.js';
import { tableHtml, dataTableHtml, initDataTables } from '../../components/table/table.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { bindSwitches, getSwitch, renderFields, setSwitch } from '../../components/form/form.js';
import { closeModal, openModal, wireModal } from '../../components/modal/modal.js';
import { MEMORY_FIELDS } from './fields.js';

const PROVIDER_FALLBACK_LABEL = { 'local-digest': '本机轻量记忆', soulkit: 'soulkit 长期记忆' };
const STATUS_TEXT = { injected: '已注入', truncated: '已截断', empty: '空', error: '失败', off: '已关闭', idle: '未调用' };

let lastConfig = null;
let lastStatus = null;
let lastIngest = null;

function msg(id, text, kind = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = kind ? `form-actions-status ${kind}` : 'form-actions-status';
}

function num(id, fallback = 0) {
  const el = document.getElementById(id);
  const value = Number(el?.value);
  return Number.isFinite(value) ? value : fallback;
}

function val(id) {
  return String(document.getElementById(id)?.value ?? '').trim();
}

function providerLabel(id) {
  return lastConfig?.providers?.[id]?.label ?? PROVIDER_FALLBACK_LABEL[id] ?? id;
}

function providerStatusLine(id) {
  const item = (lastStatus?.providers ?? []).find((p) => p.id === id);
  if (!item) return '未注册';
  const parts = [`调用 ${item.calls ?? 0}`];
  if (item.hits) parts.push(`缓存命中 ${item.hits}`);
  if (item.failures) parts.push(`失败 ${item.failures}`);
  parts.push(`最近 ${STATUS_TEXT[item.lastStatus] ?? item.lastStatus ?? '未调用'}`);
  if (item.lastChars) parts.push(`${item.lastChars} 字`);
  if (item.lastError) parts.push(`错误：${item.lastError}`);
  return parts.join(' · ');
}

function renderProviderRadios(providers) {
  const host = document.getElementById('memoryProviderRadios');
  if (!host) return;
  const current = lastStatus?.inject?.provider ?? 'local-digest';
  host.innerHTML = providers.map((p) => `
    <label class="memory-radio">
      <input type="radio" name="memInjectProvider" value="${esc(p.id)}" ${p.id === current ? 'checked' : ''}>
      <span>${esc(p.label ?? providerLabel(p.id))}<code>${esc(p.id)}</code></span>
    </label>`).join('');
}

// status.providers 只带 id/label（内核清单），插件标记不一定在；核心 provider 只有本机实现。
const CORE_PROVIDERS = new Set(['local-digest']);

function providerFields(p, conf, status) {
  const isPlugin = p.plugin ? p.plugin !== 'core' : !CORE_PROVIDERS.has(p.id);
  const fields = [
    { name: `memProviderEnabled-${p.id}`, type: 'switch', label: '启用', checked: conf.enabled !== false },
  ];
  if (isPlugin) {
    fields.push({
      name: `memProviderBaseUrl-${p.id}`, type: 'text', label: '服务地址', span: 3,
      value: conf.baseUrl ?? '', placeholder: 'http://127.0.0.1:3110',
    });
  }
  fields.push({
    name: `memProviderMaxChars-${p.id}`, type: 'number', label: '单次上限', unit: '字',
    value: conf.maxChars ?? '', min: 0, max: 100000, step: 100, placeholder: '跟随注入',
    hint: `留空表示跟随注入上限（${status.maxChars ?? '—'} 字）。`,
  });
  fields.push({
    name: `memProviderTimeout-${p.id}`, type: 'number', label: '超时', unit: 'ms',
    value: Number(conf.timeoutMs) || 900, min: 100, max: 10000, step: 100,
  });
  return fields;
}

function renderProviderCards(providers) {
  const host = document.getElementById('memoryProviders');
  if (!host) return;
  host.innerHTML = providers.map((p) => {
    const status = (lastStatus?.providers ?? []).find((x) => x.id === p.id) ?? {};
    return `
      <div class="memory-provider" data-provider="${esc(p.id)}">
        <div class="memory-provider-head">
          <strong>${esc(p.label ?? providerLabel(p.id))}</strong>
          <code>${esc(p.id)}</code>
          <span class="pill">${p.sync ? '同步' : '异步'} · ${p.capabilities?.write ? '可写' : '只读'}</span>
          <span class="meta">${esc(providerStatusLine(p.id))}</span>
        </div>
        <div data-provider-fields></div>
        ${status.lastError ? `<div class="meta err">最近错误：${esc(status.lastError)}</div>` : ''}
      </div>`;
  }).join('');
  providers.forEach((p) => {
    const card = host.querySelector(`.memory-provider[data-provider="${p.id}"]`);
    const slot = card?.querySelector('[data-provider-fields]');
    if (!slot) return;
    const conf = lastConfig?.providers?.[p.id] ?? {};
    const status = (lastStatus?.providers ?? []).find((x) => x.id === p.id) ?? {};
    renderFields(slot, providerFields(p, conf, status), { columns: 3 });
  });
  // 卡片每次刷新都会重建，开关的点击需要重新挂；bindSwitches 只处理还没绑过的元素。
  bindSwitches(host);
}

function renderHistory(history) {
  const host = document.getElementById('memoryHistory');
  if (!host) return;
  const rows = (history ?? []).slice().reverse();
  if (!rows.length) {
    host.innerHTML = '<div class="meta">（还没有注入或回忆记录）</div>';
    return;
  }
  host.innerHTML = `<div class="table-wrap">${tableHtml(
    [{ label: '时间', width: '150px' }, { label: '类型', width: '90px' }, { label: '来源', width: '150px' }, { label: '会话', width: '240px' }, { label: '字数', width: '80px' }, { label: '状态', width: '100px' }],
    rows.map((h) => [
      esc(new Date(h.at ?? Date.now()).toLocaleString('zh-CN', { hour12: false })),
      h.kind === 'recall' ? '主动回忆' : '注入',
      esc(h.provider ?? ''),
      esc(String(h.key ?? '').slice(0, 40)),
      String(h.chars ?? 0),
      esc(STATUS_TEXT[h.status] ?? h.status ?? ''),
    ]),
  )}</div>`;
}

function renderIngest() {
  const host = document.getElementById('memoryIngestStats');
  if (!host) return;
  const ingest = lastIngest ?? {};
  if (!ingest.enabled) {
    host.className = 'meta';
    host.textContent = '写回未开启：不会向任何外部服务发送对话内容。';
    return;
  }
  const parts = [
    `队列 ${ingest.pending ?? 0} 条`,
    `已发 ${ingest.sent ?? 0} 条（接受 ${ingest.accepted ?? 0}）`,
    `失败 ${ingest.failed ?? 0}`,
  ];
  if (ingest.lastAt) parts.push(`最近发送 ${new Date(ingest.lastAt).toLocaleTimeString('zh-CN', { hour12: false })}`);
  if (ingest.lastError) parts.push(`最近错误：${ingest.lastError}`);
  host.className = ingest.lastError ? 'meta err' : 'meta';
  host.textContent = parts.join(' · ');
}

﻿let localView = null;
let localCategory = 'topic';
let localEdit = null;
let localSessionKey = '';
let sessionCache = [];

const CATEGORY_LABEL = { topic: '话题', thought: '想法', impression: '印象', rule: '规则' };
const CATEGORY_COUNT_KEY = { topic: 'topics', thought: 'thoughts', impression: 'impressions', rule: 'rules' };

function localKey() {
  return localSessionKey;
}

function platformOf(key = '') {
  const [platform = 'qq', kind = ''] = String(key).split(':');
  return { platform, kind };
}

function kindText(kind) {
  return kind === 'group' ? '群' : kind === 'private' ? '私聊' : kind || '—';
}

async function sessionMemoryCounts(key) {
  try {
    const data = await api(`/api/memory/entries?key=${encodeURIComponent(key)}`);
    return (data.ok && data.data && data.data.counts) || {};
  } catch {
    return {};
  }
}

async function renderSessionTable() {
  const host = document.getElementById('memorySessionTable');
  if (!host) return;
  host.innerHTML = '<div class="meta">正在读取会话…</div>';
  try {
    const data = await api('/api/memory/sessions');
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    sessionCache = sessions;
    const platformSet = new Set();
    const kindSet = new Set();
    const rows = sessions.map((s) => {
      const { platform, kind } = platformOf(s.key);
      platformSet.add(platform);
      kindSet.add(kind);
      const c = s.counts || {};
      const action = `<button type="button" class="btn small" data-mem-open="${esc(s.key)}">管理</button> <button type="button" class="btn small danger" data-mem-clear="${esc(s.key)}">清空</button> <button type="button" class="btn small danger" data-mem-session-del="${esc(s.key)}">删除</button>`;
      const cells = [
        `<span class="mono">${esc(s.key)}</span>`,
        esc(platform),
        esc(kindText(kind)),
        String(Number(c.topics) || 0),
        String(Number(c.thoughts) || 0),
        String(Number(c.impressions) || 0),
        String(Number(c.rules) || 0),
        action,
      ];
      return { cells, attrs: { 'data-filter-platform': platform, 'data-filter-kind': kind } };
    });
    host.innerHTML = dataTableHtml({
      columns: [
        { label: '会话' }, { label: '平台', width: 90 }, { label: '类型', width: 80 },
        { label: '话题', width: 80 }, { label: '想法', width: 80 }, { label: '印象', width: 80 }, { label: '规则', width: 80 },
        { label: '操作', width: 210 },
      ],
      rows,
      empty: '还没有会话记忆；点「新增会话」填一个 key，或在 QQ 里先聊一句。',
      pageSize: 20,
      sizes: [10, 20, 50],
      search: { placeholder: '搜索会话…' },
      refresh: true,
      filters: [
        {
          id: 'platform',
          label: '平台',
          value: 'all',
          options: [{ value: 'all', label: '全部平台' }, ...[...platformSet].map((p) => ({ value: p, label: p }))],
        },
        {
          id: 'kind',
          label: '类型',
          value: 'all',
          options: [{ value: 'all', label: '全部类型' }, ...[...kindSet].map((k) => ({ value: k, label: kindText(k) }))],
        },
      ],
      actions: '<button type="button" class="btn primary" data-mem-session-add>新增会话</button>',
      meta: `${sessions.length} 个会话`,
    });
    initDataTables(host, { onRefresh: renderSessionTable });
  } catch (error) {
    host.innerHTML = `<div class="meta">❌ ${esc(error.message)}</div>`;
  }
}

function showSessionView() {
  const sessionView = document.getElementById('memSessionView');
  const entryView = document.getElementById('memEntryView');
  if (sessionView) sessionView.hidden = false;
  if (entryView) entryView.hidden = true;
  const title = document.getElementById('memMemoryModal-title');
  if (title) title.textContent = '会话记忆';
  setEntryFoot(false);
}

function setEntryFoot(entry) {
  const close = document.getElementById('memFootClose');
  if (close) close.hidden = entry;
  for (const id of ['memEntryBack', 'memEntrySave']) {
    const b = document.getElementById(id);
    if (b) b.hidden = !entry;
  }
}

function openSessionModal(key) {
  localSessionKey = key;
  localView = null;
  localCategory = 'topic';
  localEdit = null;
  const overlay = document.getElementById('memMemoryModal');
  if (!overlay) return;
  const head = document.getElementById('memModalHead');
  if (head) head.textContent = key ? `${key}（话题 / 想法 / 印象 / 规则都在这个弹窗里维护）` : '';
  showSessionView();
  renderLocal();
  openModal(overlay);
  if (key) loadLocalMemory();
  renderSessionTable();
}

function fmtAt(ts) {
  const n = Number(ts) || 0;
  return n ? new Date(n).toLocaleString('zh-CN', { hour12: false }) : '—';
}

function actionCell(id) {
  return `<button type="button" class="btn small" data-mem-edit="${esc(String(id))}">编辑</button> <button type="button" class="btn small danger" data-mem-del="${esc(String(id))}">删除</button>`;
}

function localColumns() {
  if (localCategory === 'topic') return [{ label: '话题' }, { label: '参与者', width: 160 }, { label: '待追问', width: 200 }, { label: '最近提起', width: 170 }, { label: '操作', width: 130 }];
  if (localCategory === 'thought') return [{ label: '想法' }, { label: '动机', width: 120 }, { label: '过期时间', width: 170 }, { label: '操作', width: 130 }];
  if (localCategory === 'impression') return [{ label: '对象', width: 160 }, { label: '标签' }, { label: '互动次数', width: 100 }, { label: '最近', width: 170 }, { label: '操作', width: 130 }];
  return [{ label: '编号', width: 70 }, { label: '规则内容' }, { label: '设定时间', width: 170 }, { label: '操作', width: 130 }];
}

function localRows() {
  const view = localView || {};
  if (localCategory === 'topic') {
    return (view.topics || []).map((t) => [esc(String(t.text || '')), esc((t.participants || []).join('、') || '—'), esc(String(t.pendingQuestion || '—')), fmtAt(t.lastMentionAt), actionCell(t.id)]);
  }
  if (localCategory === 'thought') {
    return (view.thoughts || []).map((t) => [esc(String(t.text || '')), esc(String(t.motivation || '—')), fmtAt(t.expiresAt), actionCell(t.id)]);
  }
  if (localCategory === 'impression') {
    return (view.impressions || []).map((t) => [esc(String(t.target || '')), esc((t.traits || []).join('、') || '—'), String(Number(t.interactionCount) || 0), fmtAt(t.lastSeenAt), actionCell(t.id)]);
  }
  return (view.rules || []).map((t) => [`#${esc(String(t.id))}`, esc(String(t.text || '')), fmtAt(t.at), actionCell(t.id)]);
}

function renderLocalTabs() {
  const counts = (localView && localView.counts) || {};
  document.querySelectorAll('#memoryLocalTabs [data-mem-cat]').forEach((btn) => {
    const cat = btn.dataset.memCat;
    const active = cat === localCategory;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    const slot = btn.querySelector(`[data-mem-count="${cat}"]`);
    if (slot) slot.textContent = String(Number(counts[CATEGORY_COUNT_KEY[cat]]) || 0);
  });
}

function renderLocal() {
  const host = document.getElementById('memoryLocalTable');
  if (!host) return;
  renderLocalTabs();
  if (!localKey()) { host.innerHTML = '<div class="meta">关闭弹窗后，可在会话表里点「管理」重新打开。</div>'; return; }
  if (!localView) { host.innerHTML = '<div class="meta">加载中…</div>'; return; }
  const rows = localRows();
  const counts = localView.counts || {};
  host.innerHTML = dataTableHtml({
    columns: localColumns(),
    rows,
    empty: `（${CATEGORY_LABEL[localCategory]}为空）`,
    pageSize: 10,
    sizes: [10, 20, 50],
    search: { placeholder: `搜索${CATEGORY_LABEL[localCategory]}…` },
    actions: `<button type="button" class="btn primary" data-mem-add>新增${CATEGORY_LABEL[localCategory]}</button>`,
    meta: `${Number(counts[CATEGORY_COUNT_KEY[localCategory]]) || 0} 条`,
  });
  initDataTables(host);
}

async function loadLocalMemory({ quiet = false } = {}) {
  const key = localKey();
  if (!key) { msg('memLocalMsg', '先选一个会话', 'err'); return; }
  if (!quiet) msg('memLocalMsg', '加载中…');
  try {
    const data = await api(`/api/memory/entries?key=${encodeURIComponent(key)}`);
    if (!data.ok) { msg('memLocalMsg', `❌ ${data.error || '失败'}`, 'err'); return; }
    localView = data.data || null;
    renderLocal();
    if (!quiet) msg('memLocalMsg', '', '');
  } catch (error) {
    msg('memLocalMsg', `❌ ${error.message}`, 'err');
  }
}

async function clearSessionMemory(key) {
  if (!key) return;
  if (!window.confirm(`清空 ${key} 的全部记忆（话题 / 想法 / 印象 / 规则）？`)) return;
  try {
    const data = await api('/api/memory/entries/clear', 'POST', { key, category: '' });
    if (!data.ok) { window.alert(data.error || '清空失败'); return; }
    if (localSessionKey === key) {
      localView = null;
      if (document.getElementById('memMemoryModal')?.classList.contains('open')) loadLocalMemory({ quiet: true });
    }
    renderSessionTable();
  } catch (error) {
    window.alert(error.message);
  }
}

async function deleteSessionMemory(key) {
  if (!key) return;
  if (!window.confirm(`删除会话 ${key} 及其全部记忆？删除后这一行会消失，之后在 QQ 里再产生记忆时会重新出现。`)) return;
  try {
    const data = await api('/api/memory/sessions', 'DELETE', { key });
    if (!data.ok) { window.alert(data.error || '删除失败'); return; }
    if (localSessionKey === key) localSessionKey = '';
    renderSessionTable();
  } catch (error) {
    window.alert(error.message);
  }
}

function openSessionAdd() {
  const form = document.getElementById('memSessionAddForm');
  if (!form) return;
  renderFields(form, [{
    name: 'memSessionKey',
    type: 'text',
    label: '会话 key',
    span: 2,
    placeholder: 'qq:group:123456789 或 private:…',
    hint: '支持 qq:group:… / group:… / qq:private:… / private:…；建好后在「管理」里加条目。',
  }], { columns: 1 });
  openModal(document.getElementById('memSessionAddModal'));
}

async function saveSessionAdd() {
  const input = document.getElementById('memSessionKey');
  const key = (input?.value || '').trim();
  if (!key) { window.alert('会话 key 不能为空'); return; }
  try {
    const data = await api('/api/memory/sessions', 'POST', { key });
    if (!data.ok) { window.alert(data.error || '新增失败'); return; }
    closeModal(document.getElementById('memSessionAddModal'));
    renderSessionTable();
  } catch (error) {
    window.alert(error.message);
  }
}

function entryFields(cat, item) {
  if (cat === 'topic') {
    return [
      { name: 'memEntryContent', type: 'textarea', label: '话题内容', value: item?.text || '', rows: 4, hint: '一条进行中的话题，会被注入到之后的唤醒提示里。' },
      { name: 'memEntryParticipants', type: 'text', label: '参与者', value: (item?.participants || []).join(', '), hint: '逗号分隔，可留空。' },
      { name: 'memEntryPending', type: 'text', label: '待追问', value: item?.pendingQuestion || '', hint: '可选：下次想接着问的问题。' },
    ];
  }
  if (cat === 'thought') {
    return [
      { name: 'memEntryContent', type: 'textarea', label: '想法内容', value: item?.text || '', rows: 4, hint: '「想说但还没说」的一句话。' },
      { name: 'memEntryMotivation', type: 'text', label: '动机', value: item?.motivation || '', hint: '可选，例如 curiosity / sociability。' },
    ];
  }
  if (cat === 'impression') {
    return [
      { name: 'memEntryTarget', type: 'text', label: '对象', value: item?.target || '', hint: '群友的昵称或 QQ 号。' },
      { name: 'memEntryTraits', type: 'text', label: '标签', value: (item?.traits || []).join(', '), hint: '逗号分隔，例如 爱熬夜, 说话直。' },
      { name: 'memEntryContent', type: 'textarea', label: '备注', value: item?.text || '', rows: 3, hint: '可选：更完整的印象描述。' },
      { name: 'memEntryCount', type: 'number', label: '互动次数', value: String(Number(item?.interactionCount) || 0) },
    ];
  }
  return [
    { name: 'memEntryContent', type: 'textarea', label: '规则内容', value: item?.text || '', rows: 4, hint: '管理员对本群的长期要求；每次唤醒都会注入。' },
  ];
}

function openEntryEditor(item = null) {
  const cat = localCategory;
  const overlay = document.getElementById('memMemoryModal');
  const form = document.getElementById('memEntryForm');
  if (!overlay || !form) return;
  localEdit = { cat, id: item ? item.id : '' };
  const title = document.getElementById('memMemoryModal-title');
  if (title) title.textContent = `${item ? '编辑' : '新增'}${CATEGORY_LABEL[cat]}`;
  const sessionView = document.getElementById('memSessionView');
  const entryView = document.getElementById('memEntryView');
  if (sessionView) sessionView.hidden = true;
  if (entryView) entryView.hidden = false;
  setEntryFoot(true);
  msg('memEntryMsg', '', '');
  form.innerHTML = '';
  renderFields(form, entryFields(cat, item), { columns: 1 });
  if (!overlay.classList.contains('open')) openModal(overlay);
  setTimeout(() => document.getElementById('memEntryContent')?.focus(), 30);
}

async function saveEntry() {
  if (!localEdit) return;
  const key = localKey();
  if (!key) { msg('memEntryMsg', '请先选择一个会话', 'err'); return; }
  const cat = localEdit.cat;
  const body = { key, category: cat, content: val('memEntryContent') };
  if (cat === 'topic') {
    body.extra = {
      participants: val('memEntryParticipants').split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
      pendingQuestion: val('memEntryPending'),
    };
  } else if (cat === 'thought') {
    body.extra = { motivation: val('memEntryMotivation') };
  } else if (cat === 'impression') {
    body.extra = {
      target: localEdit.id ? undefined : val('memEntryTarget'),
      traits: val('memEntryTraits').split(/[,，、]/).map((s) => s.trim()).filter(Boolean),
      interactionCount: num('memEntryCount'),
    };
  }
  const method = localEdit.id ? 'PATCH' : 'POST';
  if (localEdit.id) body.id = localEdit.id;
  try {
    const r = await api('/api/memory/entries', method, body);
    if (!r.ok) { msg('memEntryMsg', `❌ ${r.error || '保存失败'}`, 'err'); return; }
    localEdit = null;
    showSessionView();
    msg('memLocalMsg', '✅ 已保存', 'ok');
    loadLocalMemory({ quiet: true });
  } catch (error) {
    msg('memEntryMsg', `❌ ${error.message}`, 'err');
  }
}

async function removeEntry(id) {
  const key = localKey();
  if (!key || !id) return;
  if (!window.confirm(`删除这条${CATEGORY_LABEL[localCategory]}？`)) return;
  try {
    const r = await api('/api/memory/entries', 'DELETE', { key, category: localCategory, id });
    msg('memLocalMsg', r.ok ? '✅ 已删除' : `❌ ${r.error || '失败'}`, r.ok ? 'ok' : 'err');
    if (r.ok) loadLocalMemory({ quiet: true });
  } catch (error) {
    msg('memLocalMsg', `❌ ${error.message}`, 'err');
  }
}

function findLocalItem(id) {
  const view = localView || {};
  const pool = localCategory === 'topic' ? view.topics : localCategory === 'thought' ? view.thoughts : localCategory === 'impression' ? view.impressions : view.rules;
  return (pool || []).find((x) => String(x.id) === String(id)) || null;
}

function applyConfig(data, status, ingest = null) {
  lastConfig = data ?? null;
  lastStatus = status ?? null;
  const inject = status?.inject ?? {};
  const providers = status?.providers ?? [];
  renderProviderRadios(providers);
  renderProviderCards(providers);
  renderHistory(status?.history);
  // 顶层 ingest 是队列实时状态（含生效的 baseUrl 与待发条数）；status.ingest 只是配置副本。
  // 配置里可能没写过 baseUrl（留空=跟随 soulkit），所以优先用状态里实际生效的值回填。
  lastIngest = ingest ?? data?.ingest ?? status?.ingest ?? lastIngest;
  renderIngest();
  const confIngest = lastIngest ?? {};
  setSwitch(document.getElementById('memIngestEnabled'), confIngest.enabled === true);
  const setNum = (id, value) => { const el = document.getElementById(id); if (el && value != null) el.value = String(value); };
  setNum('memInjectMaxChars', inject.maxChars);
  setNum('memInjectTimeout', inject.timeoutMs);
  setNum('memInjectCacheTtl', inject.cacheTtlMs);
  setNum('memIngestMaxQueue', confIngest.maxQueue ?? status?.ingest?.maxQueue);
  setNum('memIngestBatch', confIngest.batchSize ?? status?.ingest?.batchSize);
  setNum('memIngestInterval', confIngest.flushIntervalMs ?? status?.ingest?.flushIntervalMs);
  setNum('memIngestTimeout', confIngest.timeoutMs ?? status?.ingest?.timeoutMs);
  const url = document.getElementById('memIngestUrl');
  if (url) url.value = confIngest.baseUrl || '';
  const tools = data?.tools ?? status?.tools ?? {};
  setSwitch(document.getElementById('memToolRecall'), tools.recall !== false);
  setSwitch(document.getElementById('memToolNote'), tools.note === true);
  const localTools = data?.providers?.['local-digest']?.tools;
  setSwitch(document.getElementById('memToolLocal'), localTools?.enabled !== false);
  setSwitch(document.getElementById('memHandover'), (data?.handover ?? status?.handover)?.enabled !== false);
  const limits = data?.providers?.['local-digest']?.limits ?? {};
  setNum('memLimitInjectTopics', limits.injectTopics ?? 10);
  setNum('memLimitInjectThoughts', limits.injectThoughts ?? 10);
  setNum('memLimitInjectImpressions', limits.injectImpressions ?? 10);
  setNum('memLimitMaxTopics', limits.maxTopics ?? 50);
  setNum('memLimitMaxThoughts', limits.maxThoughts ?? 50);
  setNum('memLimitMaxImpressions', limits.maxImpressions ?? 200);
  setNum('memLimitMaxRules', limits.maxRules ?? 10);
  setNum('memLimitMaxTraits', limits.maxTraits ?? 10);
  setNum('memLimitTraitChars', limits.traitChars ?? 50);
  setNum('memLimitItemChars', limits.itemChars ?? 200);
  setNum('memLimitStaleHours', limits.staleHours ?? 24);
}

async function loadMemory({ quiet = false } = {}) {
  try {
    const data = await api('/api/memory');
    lastConfig = data.config;
    lastStatus = data.status;
    applyConfig(data.config, data.status, data.ingest);
    if (!quiet) msg('memInjectMsg', '');
  } catch (error) {
    if (!quiet) msg('memInjectMsg', `❌ 读取失败：${error.message}`, 'err');
  }
}

async function patchMemory(body, statusId, okText = '✅ 已保存') {
  msg(statusId, '保存中…');
  try {
    const data = await api('/api/memory', 'PATCH', body);
    if (!data.ok) { msg(statusId, `❌ ${data.error || '保存失败'}`, 'err'); return; }
    applyConfig(data.memory, data.status, data.ingest);
    msg(statusId, okText, 'ok');
  } catch (error) {
    msg(statusId, `❌ ${error.message}`, 'err');
  }
}

function selectedProvider() {
  return document.querySelector('input[name="memInjectProvider"]:checked')?.value ?? 'local-digest';
}

function saveInject() {
  patchMemory({
    inject: { provider: selectedProvider(), maxChars: num('memInjectMaxChars'), timeoutMs: num('memInjectTimeout'), cacheTtlMs: num('memInjectCacheTtl') },
  }, 'memInjectMsg');
}

function saveProviders() {
  const providers = {};
  for (const el of document.querySelectorAll('.memory-provider')) {
    const id = el.dataset.provider;
    const enabled = getSwitch(document.getElementById(`memProviderEnabled-${id}`));
    const baseUrl = document.getElementById(`memProviderBaseUrl-${id}`)?.value.trim();
    const rawMax = String(document.getElementById(`memProviderMaxChars-${id}`)?.value ?? '').trim();
    const timeoutMs = Number(document.getElementById(`memProviderTimeout-${id}`)?.value);
    providers[id] = { enabled, ...(baseUrl ? { baseUrl } : {}), ...(rawMax === '' ? {} : { maxChars: Number(rawMax) }), timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 900 };
  }
  patchMemory({ providers }, 'memProvidersMsg');
}

function saveLocalLimits() {
  patchMemory({
    providers: {
      'local-digest': {
        limits: {
          injectTopics: num('memLimitInjectTopics'), injectThoughts: num('memLimitInjectThoughts'), injectImpressions: num('memLimitInjectImpressions'),
          maxTopics: num('memLimitMaxTopics'), maxThoughts: num('memLimitMaxThoughts'), maxImpressions: num('memLimitMaxImpressions'),
          maxRules: num('memLimitMaxRules'), maxTraits: num('memLimitMaxTraits'), traitChars: num('memLimitTraitChars'),
          itemChars: num('memLimitItemChars'), staleHours: num('memLimitStaleHours'),
        },
      },
    },
  }, 'memLocalLimitsMsg');
}

function saveTools() {
  patchMemory({
    tools: { recall: getSwitch(document.getElementById('memToolRecall')), note: getSwitch(document.getElementById('memToolNote')) },
    handover: { enabled: getSwitch(document.getElementById('memHandover')) },
    providers: { 'local-digest': { tools: { enabled: getSwitch(document.getElementById('memToolLocal')) } } },
  }, 'memToolsMsg');
}

function saveIngest() {
  patchMemory({
    ingest: {
      enabled: getSwitch(document.getElementById('memIngestEnabled')),
      baseUrl: val('memIngestUrl'),
      maxQueue: num('memIngestMaxQueue'), batchSize: num('memIngestBatch'),
      flushIntervalMs: num('memIngestInterval'), timeoutMs: num('memIngestTimeout'),
    },
  }, 'memIngestMsg');
}

export function init() {
  document.querySelectorAll('[data-memory-fields]').forEach((host) => {
    const spec = MEMORY_FIELDS[host.dataset.memoryFields];
    if (spec) renderFields(host, spec, { columns: 2 });
  });
  // 一次性在整页上装开关委托：provider 卡片是后渲染的，靠事件委托才点得动。
  bindSwitches(document.getElementById('section-memory') ?? document);

  document.getElementById('memInjectSave')?.addEventListener('click', saveInject);
  document.getElementById('memProvidersSave')?.addEventListener('click', saveProviders);
  document.getElementById('memLocalSaveLimits')?.addEventListener('click', saveLocalLimits);
  document.getElementById('memToolsSave')?.addEventListener('click', saveTools);
  document.getElementById('memIngestSave')?.addEventListener('click', saveIngest);

  document.getElementById('memoryLocalTabs')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mem-cat]');
    if (!button) return;
    localCategory = button.dataset.memCat;
    renderLocal();
  });

  document.getElementById('memoryLocalTable')?.addEventListener('click', (event) => {
    const add = event.target.closest('[data-mem-add]');
    if (add) { openEntryEditor(null); return; }
    const edit = event.target.closest('[data-mem-edit]');
    if (edit) { openEntryEditor(findLocalItem(edit.dataset.memEdit)); return; }
    const del = event.target.closest('[data-mem-del]');
    if (del) removeEntry(del.dataset.memDel);
  });

  document.getElementById('memorySessionTable')?.addEventListener('click', (event) => {
    const add = event.target.closest('[data-mem-session-add]');
    if (add) { openSessionAdd(); return; }
    const drop = event.target.closest('[data-mem-session-del]');
    if (drop) { deleteSessionMemory(drop.dataset.memSessionDel); return; }
    const clear = event.target.closest('[data-mem-clear]');
    if (clear) { clearSessionMemory(clear.dataset.memClear); return; }
    const open = event.target.closest('[data-mem-open]');
    if (open) openSessionModal(open.dataset.memOpen);
  });

  const memoryModal = document.getElementById('memMemoryModal');
  if (memoryModal && memoryModal.parentElement !== document.body) document.body.appendChild(memoryModal);
  if (memoryModal) {
    wireModal(memoryModal, {
      onClose: () => {
        localEdit = null;
        showSessionView();
        renderSessionTable();
      },
    });
  }
  const sessionAddModal = document.getElementById('memSessionAddModal');
  if (sessionAddModal && sessionAddModal.parentElement !== document.body) document.body.appendChild(sessionAddModal);
  if (sessionAddModal) wireModal(sessionAddModal, { onClose: () => {} });
  document.getElementById('memSessionAddSave')?.addEventListener('click', saveSessionAdd);
  document.getElementById('memSessionAddCancel')?.addEventListener('click', () => closeModal('memSessionAddModal'));
  document.getElementById('memEntrySave')?.addEventListener('click', saveEntry);
  document.getElementById('memEntryBack')?.addEventListener('click', () => { localEdit = null; showSessionView(); });

  renderSessionTable();

  onPageRefresh('memory', () => { loadMemory({ quiet: true }); });
  loadMemory();
  setInterval(() => {
    if (getCurrentPage() === 'memory' && !document.hidden) loadMemory({ quiet: true });
  }, 30_000);
}
