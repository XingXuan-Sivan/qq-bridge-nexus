// 命令页：桥接命令注册表；每条命令可改权限（all/admin/owner）与启用状态，改动即时写入 config.json.commands。
//
// 页面目录约定（docs/PLUGIN_ROADMAP.md §8.7）：page.js 导出 init()，路由器在片段注入后调用。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { groupedTableHtml, initGroupedTables } from '../../components/table/table.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { BEHAVIORS_FIELDS } from './fields.js';

const BEHAVIOR_SCOPE_LABEL = { all: '全部会话', group: '仅群聊', private: '仅私聊' };
const PERMISSION_LABEL = { all: '所有人', admin: '管理员', owner: '所有者' };

function behaviorGroupName(entry) {
  if (entry.group) return entry.group;
  return entry.source === 'plugin' ? `插件 ${entry.pluginId || '未命名'}` : '其他';
}

function permissionSelect(entry) {
  const options = ['all', 'admin', 'owner'].map((value) => `<option value="${value}"${entry.permission === value ? ' selected' : ''}>${PERMISSION_LABEL[value]}</option>`).join('');
  return `<select class="table-select" data-command-permission="${esc(entry.id)}" aria-label="命令权限">${options}</select>`;
}

// 命令按 group 聚成指令组；组行可折叠，子行缩进——层级完全由注册时的 group 派生，不手工维护。
function behaviorTable(rows) {
  const groups = new Map();
  for (const entry of rows) {
    const name = behaviorGroupName(entry);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(entry);
  }
  return groupedTableHtml({
    openIndex: 0,
    columns: [
      { label: '指令', width: 200 },
      { label: '所属', width: 118 },
      { label: '描述' },
      { label: '权限', width: 120 },
      { label: '启用', width: 84 },
    ],
    groups: [...groups.entries()].map(([name, items]) => ({
      label: name,
      key: name,
      rows: items.map((entry) => {
        const source = entry.source === 'plugin'
          ? `<span class="tag tag--primary">插件 ${esc(entry.pluginId || '')}</span>`
          : '<span class="tag tag--info">内置</span>';
        const enabled = `<button type="button" class="field-switch" role="switch" data-command-enabled="${esc(entry.id)}" aria-checked="${entry.enabled !== false ? 'true' : 'false'}" aria-label="启用 ${esc(entry.name)}"><span class="field-switch-track" aria-hidden="true"></span><span>${entry.enabled !== false ? '开' : '关'}</span></button>`;
        const aliases = (entry.aliases || []).length ? ` <span class="meta">别名 ${esc(entry.aliases.join('、'))}</span>` : '';
        return [
          `<code>${esc(entry.name)}</code>${aliases}`,
          source,
          `${esc(entry.help || '（没有说明）')} <span class="meta">· ${esc(BEHAVIOR_SCOPE_LABEL[entry.scope] || entry.scope || '')}</span>`,
          permissionSelect(entry),
          enabled,
        ];
      }),
    })),
  });
}

let currentRows = [];

async function saveCommand(id, patch) {
  try {
    const result = await api(`/api/commands/${encodeURIComponent(id)}`, 'POST', patch);
    if (!result?.ok) throw new Error(result?.error || '保存失败');
    showConsoleToast('已保存命令设置');
    await refreshBehaviors();
  } catch (error) {
    showConsoleToast(`❌ ${String(error?.message ?? error)}`);
    await refreshBehaviors();
  }
}

async function refreshBehaviors() {
  const meta = document.getElementById('behaviorsMeta');
  const bridgeBox = document.getElementById('behaviorsBridge');
  const empty = document.getElementById('behaviorsEmpty');
  if (!meta || !bridgeBox) return;
  try {
    const data = await api('/api/commands');
    const filter = document.getElementById('behaviorsFilter').value;
    const permission = document.getElementById('behaviorsPermission').value;
    const keyword = (document.getElementById('behaviorsSearch').value || '').trim().toLowerCase();
    const all = [...(data.bridge?.builtin ?? []), ...(data.bridge?.plugin ?? [])];
    const rows = all.filter((entry) => {
      if (filter !== 'all' && entry.source !== filter) return false;
      if (permission && entry.permission !== permission) return false;
      if (!keyword) return true;
      return [entry.name, entry.help, ...(entry.aliases ?? [])].join(' ').toLowerCase().includes(keyword);
    });
    currentRows = rows;
    meta.textContent = `注册表 ${data.bridge?.builtin?.length ?? 0} 条内置 + ${data.bridge?.plugin?.length ?? 0} 条插件；显示 ${rows.length} 条`;
    bridgeBox.hidden = rows.length === 0;
    empty.hidden = rows.length !== 0;
    empty.textContent = '没有匹配的命令，换个筛选或关键词试试。';
    bridgeBox.innerHTML = rows.length ? behaviorTable(rows) : '';
  } catch (error) {
    meta.textContent = '';
    bridgeBox.hidden = true;
    bridgeBox.innerHTML = '';
    empty.hidden = false;
    empty.textContent = `读取失败：${error?.message || '未知错误'}`;
  }
}

export function init() {
  // 先渲染工具条与表格宿主，下面才取得到节点；select 的装饰由路由器在 init() 之后统一做。
  document.querySelectorAll('[data-behaviors-fields]').forEach((host) => {
    const spec = BEHAVIORS_FIELDS[host.dataset.behaviorsFields];
    if (spec?.html) host.innerHTML = spec.html;
  });
  document.getElementById('behaviorsRefresh')?.addEventListener('click', () => { refreshBehaviors().catch(() => {}); });
  document.getElementById('behaviorsFilter')?.addEventListener('change', () => { refreshBehaviors().catch(() => {}); });
  document.getElementById('behaviorsPermission')?.addEventListener('change', () => { refreshBehaviors().catch(() => {}); });
  let searchTimer = null;
  document.getElementById('behaviorsSearch')?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { refreshBehaviors().catch(() => {}); }, 180);
  });
  const bridge = document.getElementById('behaviorsBridge');
  // 权限与启用：改完立刻保存，不另设「保存」按钮（表格会被重绘，事件委托绑在容器上）。
  bridge?.addEventListener('change', (event) => {
    const permission = event.target.closest('[data-command-permission]');
    if (permission) void saveCommand(permission.dataset.commandPermission, { permission: permission.value });
  });
  bridge?.addEventListener('click', (event) => {
    const enabled = event.target.closest('[data-command-enabled]');
    if (!enabled) return;
    const next = enabled.getAttribute('aria-checked') !== 'true';
    enabled.setAttribute('aria-checked', String(next));
    const label = enabled.querySelector('span:last-child');
    if (label) label.textContent = next ? '开' : '关';
    void saveCommand(enabled.dataset.commandEnabled, { enabled: next });
  });
  // 组行折叠由表格组件的 initGroupedTables 负责（事件委托绑在容器上，重新渲染 innerHTML 不用重绑）。
  initGroupedTables(bridge);
  onPageRefresh('behaviors', () => { refreshBehaviors().catch(() => {}); });
  setInterval(() => { if (getCurrentPage() === 'behaviors' && !document.hidden) refreshBehaviors().catch(() => {}); }, 30_000);
  refreshBehaviors().catch(() => {});
}
