// 管理行为页：桥接命令注册表（含迁移状态）+ 只读的 DSH 会话命令与 Agent 工具。
import { api } from '../api.js';
import { esc, simpleTable } from '../ui.js';
import { getCurrentPage, onPageRefresh } from '../router.js';

const BEHAVIOR_PERMISSION_LABEL = { all: '所有人', admin: 'admin', owner: 'owner' };
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
  const head = '<thead><tr><th style="width:200px">指令</th><th style="width:92px">类型</th>'
    + '<th style="width:118px">所属</th><th>描述</th><th style="width:84px">权限</th>'
    + '<th style="width:84px">状态</th><th style="width:70px">操作</th></tr></thead>';
  const body = [...groups.entries()].map(([name, items], index) => {
    const open = index === 0;
    const groupRow = `<tr class="group-row${open ? ' open' : ''}" data-group="${esc(name)}">`
      + `<td colspan="7"><span class="caret">▸</span> ${esc(name)} <span class="meta">${items.length} 条</span></td></tr>`;
    const childRows = items.map((entry) => {
      const migrated = entry.migrated ? '<span class="pill b">注册表</span>' : '<span class="pill">旧链</span>';
      const source = entry.source === 'plugin' ? `插件 ${entry.pluginId || ''}` : '内置';
      const status = entry.source === 'plugin' ? '<span class="pill">随插件</span>' : '<span class="pill g">常开</span>';
      const action = entry.source === 'plugin'
        ? `<button class="small" data-plugin-action="detail" data-plugin-id="${esc(entry.pluginId || '')}">详情</button>`
        : '<span class="meta">—</span>';
      const aliases = (entry.aliases || []).length ? ` <span class="meta">别名 ${esc(entry.aliases.join('、'))}</span>` : '';
      return `<tr class="group-child${open ? '' : ' hidden'}" data-group="${esc(name)}">`
        + `<td><code>${esc(entry.name)}</code>${aliases}</td>`
        + `<td>${migrated}</td><td>${esc(source)}</td>`
        + `<td>${esc(entry.help || '（没有说明）')} <span class="meta">· ${esc(BEHAVIOR_SCOPE_LABEL[entry.scope] || entry.scope || '')}</span></td>`
        + `<td>${esc(BEHAVIOR_PERMISSION_LABEL[entry.permission] || entry.permission)}</td>`
        + `<td>${status}</td><td>${action}</td></tr>`;
    }).join('');
    return groupRow + childRows;
  }).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
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
      ? simpleTable([{ label: '命令', width: '200px' }, { label: '说明' }], (data.dsh ?? []).map((item) => [`<code>${esc(item.name)}</code>`, esc(item.note || '')]))
      : '<div class="meta">桥接没有记录到会调用的 DSH 命令。</div>';
    toolsBox.innerHTML = (data.tools ?? []).length
      ? simpleTable([{ label: '工具', width: '220px' }, { label: '来源', width: '260px' }, { label: '管理方式' }],
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

export function initBehaviorsPage() {
  document.getElementById('behaviorsRefresh')?.addEventListener('click', () => { refreshBehaviors().catch(() => {}); });
  document.getElementById('behaviorsFilter')?.addEventListener('change', () => { refreshBehaviors().catch(() => {}); });
  document.getElementById('behaviorsPermission')?.addEventListener('change', () => { refreshBehaviors().catch(() => {}); });
  let searchTimer = null;
  document.getElementById('behaviorsSearch')?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { refreshBehaviors().catch(() => {}); }, 180);
  });
  // 组行点击折叠/展开：层级由 group 派生，展开状态只在前端。
  document.getElementById('behaviorsBridge')?.addEventListener('click', (event) => {
    const row = event.target.closest?.('tr.group-row');
    if (!row) return;
    row.classList.toggle('open');
    const name = row.dataset.group;
    document.querySelectorAll(`#behaviorsBridge tr.group-child[data-group="${CSS.escape(name)}"]`)
      .forEach((child) => child.classList.toggle('hidden'));
  });
  onPageRefresh('behaviors', () => { refreshBehaviors().catch(() => {}); });
  setInterval(() => { if (getCurrentPage() === 'behaviors' && !document.hidden) refreshBehaviors().catch(() => {}); }, 30_000);
  refreshBehaviors().catch(() => {});
}
