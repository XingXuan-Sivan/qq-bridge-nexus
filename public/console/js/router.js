// 控制台路由：页面表、URL（hash）与首屏恢复、面包屑、导航点击。
//
// 设计：这里只管「切哪一页」，不碰任何页面的数据加载；页面自己用 onPageRefresh() 注册
// 「被切进来时要做什么」，避免路由器反过来 import 十几个页面模块。

import { showConsoleToast, applyPageA11y } from './ui.js';
import { initGroups } from '../components/groups/groups.js';
import { decorateSelects, initSelects } from '../components/select/select.js';
import { initDateFields } from '../components/date/date.js';
import { initTimeFields } from '../components/time/time.js';

// 下拉框统一外观：启动时装一次，之后动态插入的 select 由 MutationObserver 补。
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSelects, { once: true });
else initSelects();
// 日期字段（文本框 + 日历按钮）同理：静态部分启动时装，页面片段在 hydratePage 里补。
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { initDateFields(); initTimeFields(); }, { once: true });
else { initDateFields(); initTimeFields(); }

/** 页面元数据：[标题, 大标题, 说明]。新增页面必须同时加进 #mainNav 的 data-view。 */
export const consolePages = {
  overview: ['运行总览', '让每一次连接，都自然发生。', '掌握桥接状态，轻松管理你的 QQ 智能伙伴。'],
  sessions: ['会话与审批', '让每一段对话，都有迹可循。', '查看 QQ 与 DSH 的会话映射，以及等待你回复的审批和提问。'],
  persona: ['人格与角色', '给你的伙伴，一点独特个性。', '选择已有角色，或用自己的语言写下新的性格与表达方式。'],
  plugins: ['插件', '把能力，做成可插拔的一块。', '查看插件加载状态、钩子与最近错误；可启停、重载、安装与卸载，改配置仍重启生效。'],
  skills: ['技能', '让 AI 知道，自己会什么。', '只读查看 DSH 与仓库里可用的 SKILL.md 技能包，启停与安装交给 DSH 自己管。'],
  mcp: ['MCP', '把外部能力，接成标准接口。', '只读查看桥接自带的 MCP server；DSH 侧的 MCP 配置不在这里改。'],
  behaviors: ['管理行为', '命令与工具，一处看清。', '按注册表查看桥接命令（含迁移状态），并只读列出 DSH 会话命令与 Agent 工具。'],
  'social-v2': ['二代仿真', '自主参与，恰到好处。', '管理 AI 的工具、唤醒与发言节奏。展开需要调整的分组，修改后保存参数。'],
  'social-v1': ['一代仿真', '为自然对话，设定合适的节奏。', '调整参与概率、活跃周期和分条发送；所有配置项完整保留。'],
  slang: ['黑话词库', '读懂群聊里的，言外之意。', '从候选到确认，让 AI 逐渐熟悉大家的表达习惯。'],
  memory: ['记忆', '记住该记的，忘掉该忘的。', '选择注入源、管理记忆 provider 预算与本机轻量记忆，查看最近注入与主动回忆，并决定是否把对话写回记忆服务。'],
  scheduler: ['定时任务', '到点的事，交给桥接记着。', '按时区和规则定时发消息，或叫 AI 到点来说；可以发给管理员私聊、白名单好友和群。'],
  usage: ['令牌与花费', '每一次思考，都算得清楚。', '实时查看 AI 的 token 消耗与花费，可下钻到每个群、每个好友、每一轮对话。'],
  access: ['访问与安全', '明确边界，安心连接。', '管理允许对话的对象、管理员权限与控制台访问凭证。'],
  operations: ['调试与运维', '让桥接，始终井然有序。', '测试消息、引导 AI，或维护桥接进程与会话工作区。'],
  reference: ['工具参考', '每一种能力，都清晰可见。', '查看桥接提供给 DSH 的 MCP 工具与用途。'],
};

const PAGE_STORAGE_KEY = 'qqb-console-page';
let currentConsolePage = 'overview';

// 页面片段：这些页面的 DOM 放在 public/console/pages/<id>/page.html，由路由器按需注入。
// 已迁移页面按需注入；其余页面仍是 index.html 里的静态 section。
const PAGE_FRAGMENTS = new Set(['plugins', 'skills', 'mcp', 'behaviors', 'reference', 'access', 'social-v2', 'social-v1', 'slang', 'scheduler', 'usage', 'persona', 'operations', 'sessions', 'overview', 'memory']);
// 每页只取一次：并发切页复用同一个 Promise，避免重复注入与重复绑定事件。
const fragmentLoads = new Map();

// 页面进来时要跑的回调：由页面模块注册，路由器只负责触发。
const pageRefreshers = new Map();
// 搜索框的关闭动作由搜索模块注入：路由器不该知道搜索框长在哪。
let searchCloser = () => {};

export function getCurrentPage() { return currentConsolePage; }
export function onPageRefresh(page, fn) { pageRefreshers.set(page, fn); }

// 全局刷新按钮只知道自己被点了，不知道当前页该怎么刷：让页面注册的 refresher 去刷。
export function refreshCurrentPage() {
  const fn = pageRefreshers.get(getCurrentPage());
  return typeof fn === 'function' ? fn() : undefined;
}
export function setSearchCloser(fn) { searchCloser = typeof fn === 'function' ? fn : () => {}; }

// 导航分组从 DOM 推导，避免「页面表加了一页、面包屑忘了改」这种漂移。
export const consolePageGroups = (() => {
  const groups = [];
  const byPage = {};
  let current = null;
  document.querySelectorAll('#mainNav > *').forEach((el) => {
    if (el.classList.contains('nav-label')) {
      current = { label: el.textContent.trim(), pages: [] };
      groups.push(current);
    } else if (current && el.dataset && el.dataset.view) {
      current.pages.push(el.dataset.view);
      byPage[el.dataset.view] = current.label;
    }
  });
  const firstPageOf = (label) => groups.find((group) => group.label === label)?.pages[0] ?? 'overview';
  return { groups, byPage, firstPageOf };
})();

export function readStoredPage() {
  try { return sessionStorage.getItem(PAGE_STORAGE_KEY); } catch { return null; }
}

export function rememberPage(page) {
  try { sessionStorage.setItem(PAGE_STORAGE_KEY, page); } catch { /* 隐私模式下写不进去，刷新回首页可接受 */ }
}

export function renderBreadcrumb(page) {
  const breadcrumb = document.querySelector('.breadcrumb');
  if (!breadcrumb) return;
  const group = consolePageGroups.byPage[page] ?? '工作空间';
  const link = document.createElement('a');
  link.className = 'crumb-link';
  link.href = '#' + consolePageGroups.firstPageOf(group);
  link.textContent = group;
  const separator = document.createElement('span');
  separator.className = 'crumb-sep';
  separator.setAttribute('aria-hidden', 'true');
  separator.textContent = '/';
  const current = document.createElement('span');
  current.className = 'crumb-current';
  current.setAttribute('aria-current', 'page');
  current.textContent = consolePages[page][0];
  breadcrumb.replaceChildren(link, separator, current);
}

/** 片段页的 DOM 在 pages/<id>/page.html：取一次、注入空 section、再动态 import 页面模块。
 *  失败时只在该 section 里显示占位文案，不影响其它页面（页面之间互不牵连）。 */
function hydratePage(page) {
  if (!PAGE_FRAGMENTS.has(page)) return Promise.resolve();
  if (fragmentLoads.has(page)) return fragmentLoads.get(page);
  const host = document.getElementById(`section-${page}`);
  if (!host) return Promise.resolve();
  const load = (async () => {
    const response = await fetch(`/console/pages/${page}/page.html`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    host.innerHTML = await response.text();
    if (!document.querySelector(`link[data-page-css="${page}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.dataset.pageCss = page;
      link.href = `/console/pages/${page}/page.css`;
      document.head.appendChild(link);
    }
    const module = await import(`/console/pages/${page}/page.js`);
    module.init?.();
    // 折叠分组：默认展开第一组，之后按页面记忆用户展开过哪些（跨页一致的体验）。
    // 必须放在 init() 之后——有些页面的分组是 init() 里渲染出来的。
    initGroups(host, { pageId: page });
    decorateSelects(host);
    initDateFields(host);
    initTimeFields(host);
    applyPageA11y(host);
    // 就绪标记：字段由 fields.js 的规格在 init() 里渲染，片段 HTML 到位 ≠ 页面可用。
    // 浏览器回归（test-console-ui）与深链定位都等这个标记，避免量到「还没渲染」的空壳。
    host.dataset.pageReady = '1';
  })().catch((error) => {
    host.innerHTML = `<div class="meta">页面加载失败：${error?.message || '未知错误'}（刷新重试）</div>`;
    console.error(`[console] 页面片段加载失败：${page}`, error);
  });
  fragmentLoads.set(page, load);
  return load;
}

/** 切页：只做展示层与 URL，数据加载交给各页面注册的回调。 */
export function setConsolePage(page, { updateHash = true, focus = false, target = '', persist = true } = {}) {
  if (!Object.hasOwn(consolePages, page)) page = 'overview';
  currentConsolePage = page;
  if (persist) rememberPage(page);
  // 只切「页面宿主」（main 里的 section）的显隐：分页器按钮也带 data-page 的数字属性，
  // 不能用全局 [data-page] 选择器，否则点过一次分页后按钮会被当成页面宿主隐藏。
  document.querySelectorAll('main section[data-page]').forEach((el) => {
    el.hidden = el.dataset.page !== page;
    // 非片段页（参考页）的 DOM 直接在 index.html 里，切到即就绪；片段页由 hydratePage 标记。
    if (el.dataset.page === page && !PAGE_FRAGMENTS.has(page)) el.dataset.pageReady = '1';
  });
  void hydratePage(page);
  document.querySelectorAll('#mainNav [data-view]').forEach((button) => {
    const selected = button.dataset.view === page;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  renderBreadcrumb(page);
  document.getElementById('pageTitle').textContent = consolePages[page][1];
  document.getElementById('pageDescription').textContent = consolePages[page][2];
  document.title = consolePages[page][0] + ' · QQ 桥接控制台';
  if (updateHash && location.hash !== '#' + page) history.pushState({}, '', '#' + page);
  searchCloser();
  // 页面自己的刷新节奏（语音库按需探测、人格页重读、插件/技能/MCP 重新拉取等）都由页面注册。
  const refreshPage = pageRefreshers.get(page);
  if (refreshPage) setTimeout(() => { try { refreshPage(); } catch { /* 页面自己的错误自己记 */ } }, 0);
  if (focus) {
    document.getElementById('mainContent').focus({ preventScroll: true });
    const targetId = target || 'mainContent';
    const reveal = () => document.getElementById(targetId)?.scrollIntoView({ block: 'start', behavior: 'instant' });
    // 目标可能在尚未注入的页面片段里（如概览指标卡跳 #section-pending）：等片段加载完再滚。
    if (document.getElementById(targetId)) reveal();
    else void hydratePage(page).then(reveal);
  }
}

/** 首屏恢复：hash（深链）→ sessionStorage（同标签页刷新）→ overview。 */
function restoreInitialPage() {
  const hashPage = location.hash.slice(1);
  const storedPage = readStoredPage();
  const initialPage = Object.hasOwn(consolePages, hashPage) ? hashPage
    : Object.hasOwn(consolePages, storedPage ?? '') ? storedPage
      : 'overview';
  const badHash = hashPage && !Object.hasOwn(consolePages, hashPage);
  setConsolePage(initialPage, { updateHash: false });
  if (location.hash.slice(1) !== initialPage) history.replaceState({}, '', '#' + initialPage);
  if (badHash) showConsoleToast('没有这个页面，已回到上次停留的位置');
}

/** 绑定导航、hash、popstate 与首屏恢复；入口脚本在所有页面模块加载后调一次。 */
export function initRouter() {
  // 事件委托：片段页里的 [data-view]（例如概览页的「已建立会话 / 待处理请求」指标卡）
  // 是在 initRouter 之后才注入的，启动时直接 querySelectorAll 绑定会漏掉它们。
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (!button) return;
    setConsolePage(button.dataset.view, { focus: true, target: button.dataset.target });
  });
  window.addEventListener('hashchange', () => {
    const page = location.hash.slice(1);
    if (!page) { setConsolePage(readStoredPage() ?? 'overview', { updateHash: false }); return; }
    if (Object.hasOwn(consolePages, page)) { setConsolePage(page, { updateHash: false }); return; }
    // 未知 hash：回落到上次停留页/首页，并把地址栏改回来，避免 URL 与页面长期不一致。
    setConsolePage(readStoredPage() ?? 'overview', { updateHash: false });
    history.replaceState({}, '', '#' + currentConsolePage);
  });
  // 前进/后退时 hash 也会变，hashchange 已覆盖；这里兜住「只改了 history.state」的情况。
  window.addEventListener('popstate', () => {
    const page = location.hash.slice(1);
    if (Object.hasOwn(consolePages, page)) setConsolePage(page, { updateHash: false });
  });
  document.querySelector('.skip-link')?.addEventListener('click', (event) => {
    event.preventDefault();
    document.getElementById('mainContent').focus();
    document.getElementById('mainContent').scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  restoreInitialPage();
}
