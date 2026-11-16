// 插件详情：二级页（#plugins/<id>）的正文。
//
// 与平台详情同构：一张页头（components/detail-head）+ 分节卡（属性 / 配置 / 启用状态 / 最近审计）。
// 数据来自 /api/plugins/<id>：清单只给摘要，审计与计数器只有这个接口才有。
// 保存配置与落盘开关都写同一批端点；成功后只让清单刷新，本页不重挂——
// 重挂会把状态位文案与用户刚敲的值一起冲掉。
import { esc, showConsoleToast } from '../../js/ui.js';
import { api } from '../../js/api.js';
import { cardHtml } from '../../components/card/card.js';
import { detailHeadHtml } from '../../components/detail-head/detail-head.js';
import { tag } from '../../components/tag/tag.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { bindSwitches, getSwitch, inlineActions, renderFields } from '../../components/form/form.js';
import { readSchemaPatch, schemaFields } from '../../components/form/schema.js';
import { PERSIST_FIELDS, pluginStatusTag } from './fields.js';

const BACK_LABEL = '返回插件清单';
const CONFIG_MOUNT = '<div id="pluginConfigMount"></div>';
const PERSIST_MOUNT = '<div id="pluginPersistMount"></div>';

let root = null; // 详情视图容器（page.js 的 [data-plugins-view="detail"]）
let plugin = null; // 当前插件（/api/plugins/<id> 的 plugin）
let schema = null; // 它的 configSchema；没有就只展示原始配置
let loadToken = 0; // 换插件 / 离开时让在途响应作废
let onBack = null; // 返回清单：由 page.js 把 sub 写空
let onChanged = null; // 写成功后的刷新回调（由 page.js 提供：重拉清单）

/** 一组短标记；空数组写「—」，别留空单元格。 */
function tagsOf(list) {
  const items = (list ?? []).map((name) => tag(name));
  return items.length ? items.join(' ') : '<span class="meta">—</span>';
}

/** 属性表：清单卡片上只够放摘要，这里把入口、计数器与最近一次错误都摊开。 */
function propertyRows(item) {
  const counters = item.counters ?? {};
  const rows = [
    ['状态', pluginStatusTag(item.status)],
    ['版本', `<code>${esc(item.version || '—')}</code>`],
    ['权限', tagsOf(item.permissions)],
    ['钩子', tagsOf(item.hooks)],
    ['命令', tagsOf(item.commands)],
    ['注入块', tagsOf(item.blocks)],
    ['入口', `<code>${esc(item.source?.dir || '—')}</code><div class="meta"><code>${esc(item.source?.main || '—')}</code></div>`],
    ['调用', `调用 ${Number(counters.hookCalls) || 0} 次 · 失败 ${Number(counters.hookErrors) || 0} 次 · 重载 ${Number(counters.reloads) || 0} 次`],
  ];
  if (item.updatedAt) rows.push(['最近变更', `<code>${esc(item.updatedAt)}</code>`]);
  rows.push(['最近错误', item.error ? `<span class="meta err">${esc(item.error)}</span>` : '<span class="meta">没有记录</span>']);
  return rows;
}

/** 审计正文：一行一条，字段按 key=value 摊平（时间与事件名放在最前）。 */
function auditText(item) {
  const audit = Array.isArray(item.audit) ? item.audit.slice(-12) : [];
  if (!audit.length) return '暂无审计记录';
  return audit.map((entry) => {
    const fields = Object.entries(entry)
      .filter(([key]) => key !== 'ts' && key !== 'event')
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' ');
    return `${entry.ts || ''} ${entry.event || ''} ${fields}`.trimEnd();
  }).join('\n');
}

function configCard(item) {
  const declared = Boolean(item.configSchema);
  return cardHtml({
    title: '配置',
    description: declared
      ? '表单字段就是 <code>configSchema</code> 那几项：保存后写入 <code>plugins.json</code> 并重载该插件。'
      : '该插件没有声明 <code>configSchema</code>：下面只展示 <code>plugins.json</code> 里的原始配置。',
    body: CONFIG_MOUNT,
  });
}

function shellHtml(item) {
  return `
    ${detailHeadHtml({
    title: item.name || item.id,
    code: item.id,
    meta: esc(item.description || '这个插件没有写说明。'),
    badges: [pluginStatusTag(item.status), item.version ? tag(`v${item.version}`, { type: 'primary' }) : ''],
    backLabel: BACK_LABEL,
  })}
    ${cardHtml({
    title: '属性',
    body: dataTableHtml({
      columns: [{ label: '项目', width: '120px' }, { label: '值' }],
      rows: propertyRows(item).map(([label, value]) => ({ cells: [esc(label), value] })),
      pageSize: 20,
    }),
  })}
    ${configCard(item)}
    ${cardHtml({
    title: '启用状态',
    description: '这个开关写的是持久值：打开并保存后重启桥接仍然生效；只改本次运行请用清单卡片上的启用 / 停用。',
    body: PERSIST_MOUNT,
  })}
    ${cardHtml({
    title: '最近审计',
    description: '内核把安装、卸载与配置写入都记在这里（最近 12 条）。',
    body: `<pre class="plugin-log-pre" id="pluginDetailLogs">${esc(auditText(item))}</pre>`,
  })}`;
}

/** 配置表单：字段由 configSchema 生成；动作条（保存 / 测试）跟在字段后面。 */
function mountConfig(item) {
  const host = root?.querySelector('#pluginConfigMount');
  if (!host) return;
  schema = item.configSchema ?? null;
  if (!schema) {
    const raw = Object.keys(item.config ?? {}).length
      ? `<pre class="plugin-log-pre" id="pluginConfigRaw">${esc(JSON.stringify(item.config, null, 2))}</pre>`
      : '';
    host.innerHTML = `<div class="plugin-config-none">该插件未声明配置项。${raw ? '下面是 plugins.json 里的原始配置。' : ''}</div>${raw}`;
    return;
  }
  renderFields(host, schemaFields(schema, item.config ?? {}), { columns: 1 });
  bindSwitches(host);
  host.insertAdjacentHTML('beforeend', inlineActions({
    items: [
      { id: 'pluginConfigSave', label: '保存配置', variant: 'primary' },
      { id: 'pluginConfigTest', label: '测试配置' },
    ],
    status: 'pluginConfigMsg',
  }));
}

/** 落盘开关：值来自 plugins.json 的 enabled（缺省算开）。 */
function mountPersist(item) {
  const host = root?.querySelector('#pluginPersistMount');
  if (!host) return;
  const checked = item.config?.enabled !== false;
  renderFields(host, PERSIST_FIELDS.map((field) => ({ ...field, checked })), { columns: 1 });
  bindSwitches(host);
  host.insertAdjacentHTML('beforeend', inlineActions({
    items: [{ id: 'pluginPersistSave', label: '保存启用状态', variant: 'primary' }],
    status: 'pluginPersistMsg',
  }));
}

/** 状态位文字写在该卡的动作条里；卡已被重画时什么也不做。 */
function setStatus(id, text) {
  const el = root?.querySelector(`#${id}`);
  if (el) el.textContent = text;
}

async function saveConfig(testOnly) {
  if (!plugin || !schema) return;
  let patch;
  try {
    patch = readSchemaPatch(schema, root?.querySelector('#pluginConfigMount'));
  } catch (error) {
    setStatus('pluginConfigMsg', `配置不是合法 JSON：${error?.message || '解析失败'}`);
    return;
  }
  setStatus('pluginConfigMsg', testOnly ? '测试中…' : '保存中…');
  try {
    const data = testOnly
      ? await api(`/api/plugins/${encodeURIComponent(plugin.id)}/test`, 'POST', { config: patch })
      : await api(`/api/plugins/${encodeURIComponent(plugin.id)}/config`, 'PATCH', { config: patch });
    if (!data?.ok) throw new Error(data?.error || '未知错误');
    setStatus('pluginConfigMsg', testOnly ? '配置校验通过' : (data.warning || '已保存并重载'));
    showConsoleToast(testOnly ? '配置校验通过' : `${plugin.id} 配置已保存`);
    if (!testOnly) onChanged?.();
  } catch (error) {
    setStatus('pluginConfigMsg', `${testOnly ? '测试' : '保存'}失败：${error?.message || '未知错误'}`);
  }
}

async function savePersist() {
  if (!plugin) return;
  const enabled = getSwitch(root?.querySelector('#pluginPersistEnabled'));
  setStatus('pluginPersistMsg', '保存中…');
  try {
    const data = await api('/api/plugins/settings', 'PATCH', { plugins: { [plugin.id]: { enabled } } });
    setStatus('pluginPersistMsg', data?.restartRequired ? '已写入 plugins.json，重启后生效' : '已保存');
    showConsoleToast('插件配置已写入 plugins.json');
  } catch (error) {
    setStatus('pluginPersistMsg', `保存失败：${error?.message || '未知错误'}`);
  }
}

/** 写口按钮的事件委托：页面重画后不需要重新绑定。 */
function onClick(event) {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest('[data-detail-back]')) { onBack?.(); return; }
  if (event.target.closest('#pluginConfigSave')) { void saveConfig(false); return; }
  if (event.target.closest('#pluginConfigTest')) { void saveConfig(true); return; }
  if (event.target.closest('#pluginPersistSave')) void savePersist();
}

function paint(item) {
  if (!root) return;
  root.innerHTML = shellHtml(item);
  mountConfig(item);
  mountPersist(item);
  // 属性表交给表格组件（工具栏 / 分页都在组件里）。
  initDataTables(root);
}

async function load(id) {
  const mine = ++loadToken;
  root.innerHTML = detailHeadHtml({ title: id, meta: '读取中…', backLabel: BACK_LABEL });
  try {
    const data = await api(`/api/plugins/${encodeURIComponent(id)}`);
    if (mine !== loadToken || !root) return;
    if (!data?.plugin) throw new Error('插件不存在');
    plugin = data.plugin;
    paint(plugin);
  } catch (error) {
    if (mine !== loadToken || !root) return;
    plugin = null;
    schema = null;
    root.innerHTML = `${detailHeadHtml({ title: id, meta: '读取失败', backLabel: BACK_LABEL })}
      ${cardHtml({ title: '读取失败', body: `<p class="meta err">${esc(error?.message || '未知错误')}</p>` })}`;
  }
}

/**
 * 在二级页的宿主里挂载某个插件的详情。
 * @param {HTMLElement} target 详情视图容器（page.js 的 [data-plugins-view="detail"]）
 * @param {string} id 插件 id（来自子路由）
 * @param {{onBack?: () => void, onChanged?: () => void}} [options]
 *   onBack 返回清单（page.js 把 sub 写空）；onChanged 写成功后的清单刷新
 */
export function mountPluginDetail(target, id, options = {}) {
  unmountPluginDetail();
  if (!target || !id) return;
  root = target;
  onBack = options.onBack ?? null;
  onChanged = options.onChanged ?? null;
  root.addEventListener('click', onClick);
  void load(id);
}

/** 拆掉详情（回清单 / 换插件时调）：清掉在途请求、委托监听与模块级状态。 */
export function unmountPluginDetail() {
  if (!root) return;
  loadToken += 1;
  root.removeEventListener('click', onClick);
  root.innerHTML = '';
  root = null;
  plugin = null;
  schema = null;
  onBack = null;
  onChanged = null;
}
