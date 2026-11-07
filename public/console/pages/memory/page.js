// 记忆页：注入源、provider、本机轻量记忆、工具开关、写回队列与最近活动。
// 规格见 docs/MEMORY_SUBSYSTEM.md §4；provider 卡片与列表依赖 /api/memory 的返回，由本文件渲染。
import { api } from '../../js/api.js';
import { esc } from '../../js/ui.js';
import { tableHtml } from '../../components/table/table.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { bindSwitches, getSwitch, renderFields, setSwitch } from '../../components/form/form.js';
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

function switchHtml(id, on, onLabel = '开', offLabel = '关') {
  return `<button type="button" class="field-switch" role="switch" id="${esc(id)}" data-field="${esc(id)}" data-on-label="${esc(onLabel)}" data-off-label="${esc(offLabel)}" aria-checked="${on ? 'true' : 'false'}"><span class="field-switch-track" aria-hidden="true"></span><span>${esc(on ? onLabel : offLabel)}</span></button>`;
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

function renderProviderCards(providers) {
  const host = document.getElementById('memoryProviders');
  if (!host) return;
  host.innerHTML = providers.map((p) => {
    const conf = lastConfig?.providers?.[p.id] ?? {};
    const status = (lastStatus?.providers ?? []).find((x) => x.id === p.id) ?? {};
    const isPlugin = p.plugin && p.plugin !== 'core';
    return `
      <div class="memory-provider" data-provider="${esc(p.id)}">
        <div class="memory-provider-head">
          <strong>${esc(p.label ?? providerLabel(p.id))}</strong>
          <code>${esc(p.id)}</code>
          <span class="pill">${p.sync ? '同步' : '异步'} · ${p.capabilities?.write ? '可写' : '只读'}</span>
          <span class="meta">${esc(providerStatusLine(p.id))}</span>
        </div>
        <div class="memory-provider-fields">
          <label class="memory-field"><span>启用</span>${switchHtml(`memProviderEnabled-${p.id}`, conf.enabled !== false)}</label>
          ${isPlugin ? `<label class="memory-field"><span>服务地址</span><input type="text" id="memProviderBaseUrl-${esc(p.id)}" value="${esc(conf.baseUrl ?? '')}" placeholder="http://127.0.0.1:3110"></label>` : ''}
          <label class="memory-field"><span>单次上限（字）</span><input type="number" id="memProviderMaxChars-${esc(p.id)}" min="0" max="100000" step="100" value="${conf.maxChars ?? ''}" placeholder="跟随注入" title="留空=跟随注入上限（${status.maxChars ?? ''} 字）"></label>
          <label class="memory-field"><span>超时（ms）</span><input type="number" id="memProviderTimeout-${esc(p.id)}" min="100" max="10000" step="100" value="${Number(conf.timeoutMs) || 900}"></label>
        </div>
        ${status.lastError ? `<div class="meta err">最近错误：${esc(status.lastError)}</div>` : ''}
      </div>`;
  }).join('');
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

function renderLocalMemory(data) {
  const box = document.getElementById('memoryLocalOutput');
  if (!box) return;
  if (!data || !data.ok) {
    box.innerHTML = '<span class="meta">加载失败</span>';
    return;
  }
  const raw = data.raw || {};
  const topics = Array.isArray(raw.activeTopics) ? raw.activeTopics : [];
  const thoughts = Array.isArray(raw.pendingThoughts) ? raw.pendingThoughts : [];
  const impressions = raw.memberImpressions && typeof raw.memberImpressions === 'object' ? raw.memberImpressions : {};
  const rules = Array.isArray(raw.ownerRules) ? raw.ownerRules : [];
  let html = '<div class="memory-list">';
  html += '<div class="memory-section"><b>进行中的话题</b> <button type="button" class="btn small" data-mem-action="clear" data-cat="activeTopic">清空</button>';
  if (!topics.length) html += '<div class="meta">（空）</div>';
  for (const t of topics) {
    const text = esc(String(t?.text || ''));
    const extra = t?.pendingQuestion ? `；待追问：${esc(String(t.pendingQuestion))}` : '';
    html += `<div class="memory-item">📌 ${text}${extra} <button type="button" class="btn small" data-mem-action="edit" data-cat="activeTopic" data-content="${esc(String(t?.text || ''))}">编辑</button> <button type="button" class="btn small" data-mem-action="remove" data-cat="activeTopic" data-content="${esc(String(t?.text || ''))}">删除</button></div>`;
  }
  html += '</div>';
  html += '<div class="memory-section"><b>你想说但还没说的</b> <button type="button" class="btn small" data-mem-action="clear" data-cat="pendingThought">清空</button>';
  if (!thoughts.length) html += '<div class="meta">（空）</div>';
  for (const t of thoughts) {
    html += `<div class="memory-item">💭 ${esc(String(t?.text || ''))}${t?.motivation ? `（${esc(String(t.motivation))}）` : ''} <button type="button" class="btn small" data-mem-action="edit" data-cat="pendingThought" data-content="${esc(String(t?.text || ''))}">编辑</button> <button type="button" class="btn small" data-mem-action="remove" data-cat="pendingThought" data-content="${esc(String(t?.text || ''))}">删除</button></div>`;
  }
  html += '</div>';
  html += '<div class="memory-section"><b>对群友的印象</b> <button type="button" class="btn small" data-mem-action="clear" data-cat="memberImpression">清空</button>';
  const names = Object.keys(impressions);
  if (!names.length) html += '<div class="meta">（空）</div>';
  for (const name of names) {
    const im = impressions[name] || {};
    const traits = Array.isArray(im.traits) ? im.traits : [];
    html += `<div class="memory-item">👤 ${esc(name)}：${traits.length ? esc(traits.join('、')) : '暂无记录'}（互动 ${Number(im.interactionCount) || 0} 次） <button type="button" class="btn small" data-mem-action="edit" data-cat="memberImpression" data-target="${esc(name)}" data-traits="${esc(traits.join(', '))}">编辑</button> <button type="button" class="btn small" data-mem-action="remove" data-cat="memberImpression" data-target="${esc(name)}">删除</button></div>`;
  }
  html += '</div>';
  html += '<div class="memory-section"><b>管理员长期规则</b> <span class="pill">只读</span>';
  if (!rules.length) html += '<div class="meta">（空）管理员私聊里用 <code>qq_owner_group_rule</code> 设定后出现在这里，并在注入时排在最前面。</div>';
  for (const rule of rules) html += `<div class="memory-item">📜 ${esc(String(rule?.text ?? rule ?? ''))}</div>`;
  html += '</div></div>';
  box.innerHTML = html;
}

async function loadLocalMemory() {
  const key = val('memLocalKey');
  if (!key) { msg('memLocalMsg', '请先填会话 key', 'err'); return; }
  msg('memLocalMsg', '加载中…');
  try {
    const data = await api(`/api/socialV2/memory?key=${encodeURIComponent(key)}`);
    renderLocalMemory(data);
    msg('memLocalMsg', data.ok ? '✅ 已加载' : `❌ ${data.error || '失败'}`, data.ok ? 'ok' : 'err');
  } catch (error) {
    msg('memLocalMsg', `❌ ${error.message}`, 'err');
  }
}

async function clearLocalMemory(category = '') {
  const key = val('memLocalKey');
  if (!key) { msg('memLocalMsg', '请先填会话 key', 'err'); return; }
  try {
    const data = await api('/api/socialV2/memory-clear', 'POST', { key, category });
    msg('memLocalMsg', data.ok ? '✅ 已清空' : `❌ ${data.error || '失败'}`, data.ok ? 'ok' : 'err');
    if (data.ok) loadLocalMemory();
  } catch (error) {
    msg('memLocalMsg', `❌ ${error.message}`, 'err');
  }
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
  setNum('memLimitTopics', limits.topics ?? 10);
  setNum('memLimitThoughts', limits.thoughts ?? 10);
  setNum('memLimitImpressions', limits.impressions ?? 10);
  setNum('memLimitImpressionsMax', limits.impressionsMax ?? 50);
  setNum('memLimitStaleHours', limits.topicStaleHours ?? 24);
  setNum('memLimitItemChars', limits.itemChars ?? 200);
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
          topics: num('memLimitTopics'), thoughts: num('memLimitThoughts'), impressions: num('memLimitImpressions'),
          impressionsMax: num('memLimitImpressionsMax'), topicStaleHours: num('memLimitStaleHours'), itemChars: num('memLimitItemChars'),
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
  document.getElementById('memLocalLoad')?.addEventListener('click', () => { loadLocalMemory(); });
  document.getElementById('memLocalClear')?.addEventListener('click', () => { clearLocalMemory(''); });
  document.getElementById('memLocalSaveLimits')?.addEventListener('click', saveLocalLimits);
  document.getElementById('memToolsSave')?.addEventListener('click', saveTools);
  document.getElementById('memIngestSave')?.addEventListener('click', saveIngest);

  document.getElementById('memoryLocalOutput')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-mem-action]');
    if (!button) return;
    const action = button.dataset.memAction;
    const cat = button.dataset.cat || '';
    const key = val('memLocalKey');
    if (!key) return;
    if (action === 'clear') { clearLocalMemory(cat); return; }
    if (action === 'remove') {
      const body = { key, category: cat, content: button.dataset.content || '', target: button.dataset.target || '' };
      const r = await api('/api/socialV2/memory-remove', 'POST', body);
      msg('memLocalMsg', r.ok ? '✅ 已删除' : `❌ ${r.error || '失败'}`, r.ok ? 'ok' : 'err');
      if (r.ok) loadLocalMemory();
      return;
    }
    if (action === 'edit') {
      const current = cat === 'memberImpression' ? (button.dataset.traits || '') : (button.dataset.content || '');
      const next = window.prompt('修改内容（留空则不改）', current);
      if (next === null || next === current) return;
      const body = { key, category: cat, oldContent: button.dataset.content || '', target: button.dataset.target || '', newContent: next, newExtra: {} };
      const r = await api('/api/socialV2/memory-update', 'POST', body);
      msg('memLocalMsg', r.ok ? '✅ 已保存' : `❌ ${r.error || '失败'}`, r.ok ? 'ok' : 'err');
      if (r.ok) loadLocalMemory();
    }
  });

  onPageRefresh('memory', () => { loadMemory({ quiet: true }); });
  loadMemory();
  setInterval(() => {
    if (getCurrentPage() === 'memory' && !document.hidden) loadMemory({ quiet: true });
  }, 30_000);
}
