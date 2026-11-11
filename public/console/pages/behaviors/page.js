// 命令与工具页：桥接命令注册表（含迁移状态）+ 只读的 DSH 会话命令与 Agent 工具。
//
// 页面目录约定（docs/PLUGIN_ROADMAP.md §8.7）：page.js 导出 init()，路由器在片段注入后调用。
import { api } from '../../js/api.js';
import { esc } from '../../js/ui.js';
import { groupedTableHtml, initGroupedTables, tableHtml } from '../../components/table/table.js';
import { getCurrentPage, onPageRefresh } from '../../js/router.js';
import { BEHAVIORS_FIELDS } from './fields.js';

const BEHAVIOR_SCOPE_LABEL = { all: '全部会话', group: '仅群聊', private: '仅私聊' };

function behaviorGroupName(entry) {
  if (entry.group) return entry.group;
  return entry.source === 'plugin' ? `插件 ${entry.pluginId || '未命名'}` : '其他';
}

// 命令按 group 聚成指令组；组行可折叠，子行缩进——层级完全由注册时的 group 派生，不手工维护。
function behaviorTable(rows) {
  const groups = new Map();
  for (const entry of rows) {
    const name = behaviorGroupName(entry);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(entry);
  }
  // 分组可折叠表格交给表格组件（groupedTableHtml），页面只负责每组的单元格内容。
  return groupedTableHtml({
    openIndex: 0,
    columns: [
      { label: '指令', width: 200 },
      { label: '类型', width: 92 },
      { label: '所属', width: 118 },
      { label: '描述' },
      { label: '权限', width: 84 },
      { label: '状态', width: 84 },
      { label: '操作', width: 70 },
    ],
    groups: [...groups.entries()].map(([name, items]) => ({
      label: name,
      key: name,
      rows: items.map((entry) => {
        const migrated = entry.migrated ? '<span class="pill b">注册表</span>' : '<span class="pill">旧链</span>';
        const source = entry.source === 'plugin'
          ? `<span class="pill b">插件 ${esc(entry.pluginId || '')}</span>`
          : '<span class="pill n">内置</span>';
        const permission = entry.permission === 'owner'
          ? '<span class="pill r">owner</span>'
          : entry.permission === 'admin'
            ? '<span class="pill b">admin</span>'
            : '<span class="pill n">所有人</span>';
        const status = entry.source === 'plugin' ? '<span class="pill">随插件</span>' : '<span class="pill g">常开</span>';
        const action = entry.source === 'plugin'
          ? `<button class="btn small" data-plugin-action="detail" data-plugin-id="${esc(entry.pluginId || '')}">详情</button>`
          : '<span class="meta">—</span>';
        const aliases = (entry.aliases || []).length ? ` <span class="meta">别名 ${esc(entry.aliases.join('、'))}</span>` : '';
        return [
          `<code>${esc(entry.name)}</code>${aliases}`,
          migrated,
          source,
          `${esc(entry.help || '（没有说明）')} <span class="meta">· ${esc(BEHAVIOR_SCOPE_LABEL[entry.scope] || entry.scope || '')}</span>`,
          permission,
          status,
          action,
        ];
      }),
    })),
  });
}

async function refreshBehaviors() {
  const meta = document.getElementById('behaviorsMeta');
  const bridgeBox = document.getElementById('behaviorsBridge');
  const empty = document.getElementById('behaviorsEmpty');
  const dshBox = document.getElementById('behaviorsDsh');
  const toolsBox = document.getElementById('behaviorsTools');
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
    meta.textContent = `注册表 ${data.bridge?.builtin?.length ?? 0} 条内置 + ${data.bridge?.plugin?.length ?? 0} 条插件；显示 ${rows.length} 条`;
    bridgeBox.hidden = rows.length === 0;
    empty.hidden = rows.length !== 0;
    empty.textContent = '没有匹配的命令，换个筛选或关键词试试。';
    bridgeBox.innerHTML = rows.length ? behaviorTable(rows) : '';
    dshBox.innerHTML = (data.dsh ?? []).length
      ? tableHtml([{ label: '命令', width: '200px' }, { label: '说明' }], (data.dsh ?? []).map((item) => [`<code>${esc(item.name)}</code>`, esc(item.note || '')]))
      : '<div class="meta">桥接没有记录到会调用的 DSH 命令。</div>';
    toolsBox.innerHTML = (data.tools ?? []).length
      ? tableHtml([{ label: '工具', width: '220px' }, { label: '来源', width: '260px' }, { label: '管理方式' }],
        (data.tools ?? []).map((item) => [`<code>${esc(item.name)}</code>`, esc(item.source), esc(item.managed)]))
      : '<div class="meta">没有已登记的 Agent 工具。</div>';
  } catch (error) {
    meta.textContent = '';
    bridgeBox.hidden = true;
    bridgeBox.innerHTML = '';
    empty.hidden = false;
    empty.textContent = `读取失败：${error?.message || '未知错误'}`;
  }
}

export function init() {
  // 先渲染工具条与三块表格宿主，下面才取得到节点；select 的装饰由路由器在 init() 之后统一做。
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
  // 组行折叠由表格组件的 initGroupedTables 负责（事件委托绑在容器上，重新渲染 innerHTML 不用重绑）。
  initGroupedTables(document.getElementById('behaviorsBridge'));
  onPageRefresh('behaviors', () => { refreshBehaviors().catch(() => {}); });
  setInterval(() => { if (getCurrentPage() === 'behaviors' && !document.hidden) refreshBehaviors().catch(() => {}); }, 30_000);
  refreshBehaviors().catch(() => {});
}
