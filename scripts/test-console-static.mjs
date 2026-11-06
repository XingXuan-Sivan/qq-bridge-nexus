// 控制台静态校验：在无法跑 Playwright 的环境里，替代性地检查 HTML/JS 结构契约。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// 独立发语音工具在仓库上一级（不在本仓库里）：位置解析与"不在时怎么跳过"走共享口径。
import { hasVoiceTool, skipVoiceTool, voiceToolPath } from './voice-tool-locator.mjs';

import { consolePageDirs, readConsoleSource } from './console-source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readConsoleSource(ROOT);

let bad = 0;
const ok = (cond, name, extra = '') => {
  if (cond) console.log(`  OK   ${name}${extra ? ' — ' + extra : ''}`);
  else { bad++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

console.log('## 元素 ID');
const ids = [...html.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
const dups = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
ok(dups.length === 0, 'ID 唯一', dups.length ? `重复：${dups.join(', ')}` : `共 ${ids.length} 个`);
for (const id of ['voiceList', 'voiceRefreshBtn', 'voiceSendBtn', 'voiceSendTarget', 'voiceSendDryRun', 'voiceMsg']) {
  const n = (html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length;
  ok(n === 1, `语音面板元素 ${id}`, `${n} 处`);
}

console.log('## 视图 / 页面契约');
const views = [...new Set([...html.matchAll(/data-view="([a-z0-9-]+)"/g)].map((m) => m[1]))].sort();
const pages = [...new Set([...html.matchAll(/data-page="([a-z0-9-]+)"/g)].map((m) => m[1]))].sort();
ok(JSON.stringify(views) === JSON.stringify(pages), 'data-view 与 data-page 一一对应', `${views.length} 个：${views.join(', ')}`);

console.log('## 工具开关');
// 工具开关已从 page.html 搬进 fields.js 的规格里（V2_TOOLS），断言改读规格表。
const toolsStart = html.indexOf('export const V2_TOOLS = [');
const toolsBlock = toolsStart < 0 ? '' : html.slice(toolsStart, html.indexOf('\n];', toolsStart));
const tools = [...toolsBlock.matchAll(/value: '([A-Za-z]+)'/g)].map((m) => m[1]);
ok(tools.includes('sendVoice'), 'sendVoice 开关存在', `共 ${tools.length} 个开关`);
ok(new Set(tools).size === tools.length, '工具开关无重复');

console.log('## 语音面板接线');
ok(/id="voiceRefreshBtn"/.test(html) && /getElementById\('voiceRefreshBtn'\)\.addEventListener/.test(html), '刷新按钮已绑定事件');
ok(/getElementById\('voiceSendBtn'\)\.addEventListener/.test(html), '试发按钮已绑定事件');
ok(/api\('\/api\/voice\/list/.test(html), '面板调用 /api/voice/list（操作者通道，无需 key）');
ok(/api\('\/api\/voice\/send'/.test(html), '面板调用 /api/voice/send');
ok(/typeof loadVoiceLibrary === 'function'|async function loadVoiceLibrary/.test(html), 'loadVoiceLibrary 已定义');

console.log('## JS 语法');
// 控制台脚本已全部外置为 ES 模块，index 里不再有内联 <script>，
// 所以这里直接把每个模块复制成 .mjs 后交给 node --check 解析（import/export 用 new Function 解析不了）。
{
  const jsDir = path.join(ROOT, 'public', 'console', 'js');
  const moduleFiles = [];
  const collect = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (entry.name.endsWith('.js')) moduleFiles.push(full);
    }
  };
  collect(jsDir);
  collect(path.join(ROOT, 'public', 'console', 'gate')); // 门页 gate.js（整页文档的普通脚本）
  let failing = '';
  for (const file of moduleFiles) {
    const temp = path.join(os.tmpdir(), `console-check-${path.basename(file, '.js')}-${process.pid}.mjs`);
    fs.copyFileSync(file, temp);
    const result = spawnSync(process.execPath, ['--check', temp], { encoding: 'utf8' });
    fs.rmSync(temp, { force: true });
    if (result.status !== 0) failing ||= `${path.relative(ROOT, file)}: ${(result.stderr || '').split('\n').slice(0, 2).join(' ')}`;
  }
  ok(!failing, '全部控制台模块语法可解析', failing || `${moduleFiles.length} 个文件`);
}

console.log('## 人格快捷选择（v0.4.1）');
ok(/id="roleInput"[^>]*role="combobox"/.test(html) && /id="roleSuggest"[^>]*role="listbox"/.test(html), '切换人格输入框带下拉候选（combobox + listbox）');
{
  const src = /function filterRoleSuggestions\([\s\S]*?\n\}/.exec(html)?.[0];
  ok(!!src, 'filterRoleSuggestions 已定义');
  if (src) {
    const filter = new Function(`${src}; return filterRoleSuggestions;`)();
    const names = ['AAA', 'BBB', 'CCC', 'ABB'];
    ok(JSON.stringify(filter(names, '')) === JSON.stringify(names), '空输入列出全部人格');
    ok(JSON.stringify(filter(names, 'A')) === '["AAA","ABB"]', '输入 A → AAA、ABB');
    ok(JSON.stringify(filter(names, 'AA')) === '["AAA"]', '输入 AA → 只剩 AAA');
    ok(JSON.stringify(filter(names, 'a')) === '["AAA","ABB"]', '不区分大小写');
    ok(JSON.stringify(filter(names, 'B')) === '["BBB"]', '只按开头匹配（ABB 不因含 B 而出现）');
  }
  ok(/addEventListener\('mousedown', \(e\) => \{ e\.preventDefault\(\); pick\(name\)/.test(html), '点击候选填入输入框（mousedown 防失焦）');
  ok(/e\.key === 'ArrowDown'/.test(html) && /e\.key === 'Escape'/.test(html), '键盘 ↑↓ / 回车 / Esc');
}

console.log('## 语音图形界面的音量控件');
if (!hasVoiceTool()) {
  // 这一整段查的是独立工具自己的页面（voice.html），仓库里没有它。
  skipVoiceTool('voice.html 的音量控件断言（volRange/volLabel/volReset/normBox/loudnessSel/previewBtn、滑块范围、事件绑定、前端 JS 可解析）');
} else {
  const voice = fs.readFileSync(voiceToolPath('public', 'voice.html'), 'utf8');
  const ids = [...voice.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
  const dups = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
  ok(dups.length === 0, 'voice.html ID 唯一', dups.length ? `重复：${dups.join(', ')}` : `共 ${ids.length} 个`);
  for (const id of ['volRange', 'volLabel', 'volReset', 'normBox', 'loudnessSel', 'previewBtn']) {
    ok(ids.includes(id), `音量控件 ${id}`);
  }
  ok(/id="volRange"[^>]*min="10"[^>]*max="400"/.test(voice), '滑块范围 10%~400%');
  ok(/volRange'\)\.addEventListener\('input'/.test(voice), '滑块 input 事件已绑定');
  ok(/previewBtn'\)\.addEventListener/.test(voice), '试听按钮已绑定');
  ok(/api\/preview/.test(voice), '试听调 /api/preview（听处理后的效果）');
  ok(/body\.normalize = true/.test(voice) && /body\.volume = volValue\(\)/.test(voice), '发送时带上音量设置');
  const scripts = [...voice.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  try { new Function(scripts[0]); ok(true, 'voice.html 前端 JS 可解析'); }
  catch (e) { ok(false, 'voice.html 前端 JS 可解析', e.message); }
}

console.log('## fixture mock 覆盖');
const fixture = fs.readFileSync(path.join(ROOT, 'scripts', 'console-ui-fixture.mjs'), 'utf8');
ok(fixture.includes("case '/api/socialV2/voices'"), 'fixture mock 了 /api/socialV2/voices');
ok(fixture.includes("case '/api/voice/send'"), 'fixture mock 了 /api/voice/send');

console.log('## 路由与面包屑（B1–B3）');
ok(/PAGE_STORAGE_KEY/.test(html) && /sessionStorage\.getItem\(PAGE_STORAGE_KEY\)/.test(html) && /sessionStorage\.setItem\(PAGE_STORAGE_KEY/.test(html), '当前页写入 sessionStorage（刷新兜底）');
ok(/const hashPage = location\.hash\.slice\(1\)/.test(html) && /readStoredPage\(\)/.test(html), '首屏三层恢复：hash → sessionStorage → overview');
ok(/addEventListener\('hashchange'/.test(html) && /addEventListener\('popstate'/.test(html), 'hashchange 与 popstate 都监听');
ok(/function renderBreadcrumb\(page\)/.test(html) && /class="crumb-link"/.test(html) && /href="#overview"/.test(html), '面包屑父级是可点的链接');
ok(!/id="breadcrumbPage"/.test(html), '旧的纯文本面包屑 id 已移除');
ok(/function positionConsoleSearch\(\)/.test(html) && /document\.body\.appendChild\(searchResults\)/.test(html), '搜索候选挂到 body（脱离 page-heading 层叠上下文）');
ok(/\.search-results \{[\s\S]{0,240}?position:fixed/.test(html), '搜索候选改为 fixed 定位');

console.log('## 页面片段（运行总览 / 技能 / MCP / 管理行为 / 参考 / 访问 / 二代仿真 / 一代仿真 / 黑话词库 / 定时任务 / 用量与花费 / 人格与角色 / 调试与运维 / 会话与审批）');
const pageDirs = consolePageDirs(ROOT);
const pilotIds = ['plugins', 'skills', 'mcp', 'behaviors', 'reference', 'access', 'social-v2', 'social-v1', 'slang', 'scheduler', 'usage', 'persona', 'operations', 'sessions', 'overview'];
for (const id of pilotIds) {
  const page = pageDirs.find((entry) => entry.id === id);
  ok(!!page && !!page.html && !!page.css && !!page.js, `pages/${id}/ 有 page.html + page.css + page.js`);
  const fragment = page?.html ? fs.readFileSync(page.html, 'utf8') : '';
  ok(/<h2>/.test(fragment), `pages/${id}/page.html 自带标题`);
  const module = page?.js ? fs.readFileSync(page.js, 'utf8') : '';
  ok(/export function init\(/.test(module), `pages/${id}/page.js 导出 init()`);
}
for (const id of pilotIds) {
  ok(new RegExp(`id="section-${id}" data-page="${id}"[^>]*>\\s*(?:<!--[\\s\\S]*?-->\\s*)?<\\/section>`).test(html), `index.html 的 #section-${id} 已清空（只留容器）`);
}
ok(/const PAGE_FRAGMENTS = new Set\(\['plugins', 'skills', 'mcp', 'behaviors', 'reference', 'access', 'social-v2', 'social-v1', 'slang', 'scheduler', 'usage', 'persona', 'operations', 'sessions', 'overview'\]\)/.test(html), '路由器登记了片段页');
ok(/function hydratePage\(page\)/.test(html) && /void hydratePage\(page\)/.test(html), '切页时注入片段');
ok(/document\.querySelectorAll\('section\[data-page\]'\)[\s\S]{0,400}?if \(!heading\) return;/.test(html), '搜索索引跳过空 section（片段未注入时不报错）');
ok(/for \(const \[page, meta\] of Object\.entries\(consolePages\)\)/.test(html), '未注入的片段页仍可按标题搜到');
// 整块搬迁用「哨兵」占位是最容易漏的方式：脚本替换完忘了回填，页面就会多出裸文本。
ok(!/@@[A-Z][A-Z0-9_]*@@/.test(html), '控制台源码没有残留占位哨兵（@@SLOT@@ 之类）');

console.log('## 样式分层（tokens / base / layout / components / page）');
const cssDir = path.join(ROOT, 'public', 'console', 'css');
const tokensPath = path.join(cssDir, 'tokens.css');
ok(fs.existsSync(tokensPath), 'tokens.css 存在（设计令牌单独成层）');
const tokens = fs.existsSync(tokensPath) ? fs.readFileSync(tokensPath, 'utf8') : '';
ok(/^\/\* 设计令牌/.test(tokens.trim()) && /:root \{/.test(tokens), 'tokens.css 声明 :root 令牌');
ok(/\[data-theme="dark"\] \{/.test(tokens), 'tokens.css 收口深色主题覆盖');
const layers = ['base.css', 'layout.css', 'components.css'];
const layerText = {};
for (const name of layers) {
  const file = path.join(cssDir, name);
  ok(fs.existsSync(file), `样式分层文件存在：css/${name}`);
  layerText[name] = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}
ok(!fs.existsSync(path.join(cssDir, 'app.css')), 'app.css 已删除（拆成 base/layout/components 三件）');
// 组件样式与 js 同住在 components/<name>/，从 components.css 拆出（docs/CONSOLE_UI.md）。
const modalCssPath = path.join(ROOT, 'public', 'console', 'components', 'modal', 'modal.css');
const modalCss = fs.existsSync(modalCssPath) ? fs.readFileSync(modalCssPath, 'utf8') : '';
ok(/\.modal-overlay \{/.test(modalCss) && !/\.modal-overlay \{/.test(layerText['components.css']),
  'modal 样式只在 components/modal/modal.css，components.css 不再重复');
ok(!/\[data-theme="dark"\] \{/.test(layerText['base.css'] + layerText['layout.css'] + layerText['components.css'])
  && !/^:root \{/m.test(layerText['base.css'] + layerText['layout.css'] + layerText['components.css']),
'三个分层文件都不持有设计令牌（令牌只在 tokens.css）');
// 控制中心与控制台共用同一套令牌：它不再自带 :root，也不按系统媒体查询切主题。
const ccDir = path.join(ROOT, 'public', 'control-center');
const ccCss = fs.readFileSync(path.join(ccDir, 'app.css'), 'utf8');
const ccIndex = fs.readFileSync(path.join(ccDir, 'index.html'), 'utf8');
ok(!/:root\s*\{/.test(ccCss), '控制中心不再自带 :root 色板（令牌只在 tokens.css）');
ok(!/prefers-color-scheme/.test(ccCss), '控制中心主题走 data-theme，不再用系统媒体查询');
ok(ccIndex.indexOf('/shared/tokens.css') >= 0 && ccIndex.indexOf('/shared/tokens.css') < ccIndex.indexOf('/control-center/app.css'),
  '控制中心先加载共享 tokens，再加载自己的 app.css');
ok(ccIndex.includes('/shared/theme-boot.js'), '控制中心复用控制台的主题引导脚本');
// launcher 的 CSP 也已收紧：页面不能再靠内联 style / 内联事件处理器。
ok(!/\sstyle\s*=/.test(ccIndex) && !/<style[\s>]/i.test(ccIndex), '控制中心页面没有内联样式（CSP 已无 unsafe-inline）');
ok(!/\son[a-z]+\s*=/i.test(ccIndex), '控制中心页面没有内联事件处理器');
const ccJs = fs.readFileSync(path.join(ccDir, 'app.js'), 'utf8');
ok(!/\sstyle\s*=/.test(ccJs), '控制中心脚本不再拼接内联 style');
const launcherSrc = fs.readFileSync(path.join(ROOT, 'src', 'launcher', 'control-center.mjs'), 'utf8');
ok(!/unsafe-inline/.test(launcherSrc), '控制中心 CSP 不再放 unsafe-inline');
ok(!/#0f1216|#161b22|#1c232c|#2a333e|#e6edf3|#8b98a5|#4c9aff|#3fb950|#d29922|#f85149|#212a35/i.test(ccCss),
  '控制中心不再残留旧的硬编码色值');
const ccUsed = [...new Set([...ccCss.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]))];
const ccMissing = ccUsed.filter((name) => !tokens.includes(`--${name}:`));
ok(ccMissing.length === 0, `控制中心引用的 ${ccUsed.length} 个令牌都在 tokens.css 里${ccMissing.length ? `（缺 ${ccMissing.join(', ')}）` : ''}`);
ok(/^\* \{\n\s+box-sizing:border-box/m.test(layerText['base.css']) && /^html \{/m.test(layerText['base.css']),
  'base.css 承载盒模型重置与 html/body 基线');
ok(/\.sidebar \{/.test(layerText['layout.css']) && /\.workspace \{/.test(layerText['layout.css']), 'layout.css 承载三容器外壳');
ok(/\.card \{/.test(layerText['components.css']) && /\.modal-overlay \{/.test(modalCss), 'components.css 承载卡片，弹窗样式同住在 components/modal/');
const linkOrder = ['tokens.css', 'base.css', 'layout.css', 'components.css', 'utilities.css']
  .map((name) => html.indexOf(`<link rel="stylesheet" href="/console/css/${name}">`));
ok(linkOrder.every((at) => at >= 0) && linkOrder.every((at, i) => i === 0 || at > linkOrder[i - 1]),
  'index.html 按 tokens → base → layout → components → utilities 的顺序加载样式');
const utilitiesPath = path.join(cssDir, 'utilities.css');
ok(fs.existsSync(utilitiesPath), 'utilities.css 存在（内联样式的收口层）');
const utilities = fs.existsSync(utilitiesPath) ? fs.readFileSync(utilitiesPath, 'utf8') : '';
ok(/\.u-flex-1 \{/.test(utilities) && /\.u-w-80 \{/.test(utilities) && /\.u-mt-8 \{/.test(utilities),
  'utilities.css 提供 flex / 宽度 / 外边距三类工具类');
// CSP 已去掉 'unsafe-inline'：HTML 与页面模块里都不允许再出现 style 属性（动态尺寸走 CSSOM）。
const inlineFiles = [path.join(ROOT, 'public', 'console', 'index.html'), path.join(ROOT, 'public', 'console', 'gate', 'index.html')];
for (const id of fs.readdirSync(path.join(ROOT, 'public', 'console', 'pages'))) {
  const dir = path.join(ROOT, 'public', 'console', 'pages', id);
  for (const name of ['page.html', 'page.js']) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) inlineFiles.push(file);
  }
}
const inlineTotal = inlineFiles.reduce((n, file) => n + (fs.readFileSync(file, 'utf8').match(/\sstyle="/g)?.length ?? 0), 0);
ok(inlineTotal === 0, `HTML / 页面模块里没有内联 style（剩 ${inlineTotal} 处）`);
// 401 门页与 index 同一套 CSP：脚本/样式必须外链，否则无令牌时只剩白屏。
// 门页是整页文档（不是 console 片段），所以单独放 public/console/gate/，不并入 pages/。
const gateDir = path.join(ROOT, 'public', 'console', 'gate');
const gateHtml = fs.readFileSync(path.join(gateDir, 'index.html'), 'utf8');
ok(/^<!doctype html>/i.test(gateHtml.trim()), '401 门页是完整文档（不是控制台片段）');
ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(gateHtml), '401 门页没有内联脚本');
ok(/href="\/console\/css\/tokens\.css"/.test(gateHtml) && /src="\/console\/gate\/gate\.js"/.test(gateHtml)
  && /href="\/console\/gate\/gate\.css"/.test(gateHtml),
  '401 门页复用 tokens.css，私有样式与脚本同目录外链');
const inlineWidthInHtml = (() => {
  const files = [path.join(ROOT, 'public', 'console', 'index.html')];
  for (const id of fs.readdirSync(path.join(ROOT, 'public', 'console', 'pages'))) {
    const file = path.join(ROOT, 'public', 'console', 'pages', id, 'page.html');
    if (fs.existsSync(file)) files.push(file);
  }
  return files.reduce((n, file) => n + (fs.readFileSync(file, 'utf8').match(/style="[^"]*\bwidth:\d+px/g)?.length ?? 0), 0);
})();
ok(inlineWidthInHtml === 0, `HTML 里不再用内联 style 写固定宽度（剩 ${inlineWidthInHtml} 处）`);
const overviewPageCss = fs.readFileSync(path.join(ROOT, 'public', 'console', 'pages', 'overview', 'page.css'), 'utf8');
ok(/\.overview-summary/.test(overviewPageCss) && /@media \(max-width:760px\) \{/.test(overviewPageCss), '概览页私有规则（含窄屏覆盖）在 pages/overview/page.css');
const usagePageCss = fs.readFileSync(path.join(ROOT, 'public', 'console', 'pages', 'usage', 'page.css'), 'utf8');
ok(/#section-usage \.usage-chart/.test(usagePageCss) && !/#section-usage/.test(layerText['components.css']),
  '用量页私有规则在 pages/usage/page.css，组件层不再含页面选择器');

console.log('## 浏览器标签图标');
const faviconPath = path.join(ROOT, 'public', 'console', 'img', 'favicon.svg');
ok(/<link rel="icon" href="\/console\/img\/favicon\.svg" type="image\/svg\+xml">/.test(html), '控制台声明了 SVG favicon');
ok(fs.existsSync(faviconPath), 'favicon 文件存在（public/console/img/favicon.svg）');
const favicon = fs.existsSync(faviconPath) ? fs.readFileSync(faviconPath, 'utf8') : '';
ok(/^<svg [^>]*viewBox="0 0 32 32"/.test(favicon.trim()) && /aria-label="QQ Bridge"/.test(favicon), 'favicon 是可访问的 32×32 SVG');
ok(!/<script/i.test(favicon) && !/on\w+=/i.test(favicon), 'favicon 不含脚本（可安全内联为图标）');
// 图标必须与侧栏品牌标记同形（q + ↗ 两个字形），且不能画背景块——否则深色/浅色主题下会糊成一块。
ok(/<text[^>]*>q<\/text>/.test(favicon) && /<text[^>]*>↗<\/text>/.test(favicon), 'favicon 复用侧栏品牌标记的字形（q 与 ↗）');
ok(!/<rect|<circle|<path/i.test(favicon), 'favicon 只有字形、没有背景块或自绘图形');
ok(/prefers-color-scheme/.test(favicon), 'favicon 跟随系统深浅色切换颜色');
const ccFavicon = fs.readFileSync(path.join(ROOT, 'public', 'control-center', 'favicon.svg'), 'utf8');
ok(ccFavicon === favicon, '控制中心与桥接控制台用同一个图标文件');

console.log('## 片段页的浮层归属');
const pluginsModule = fs.readFileSync(path.join(ROOT, 'public', 'console', 'pages', 'plugins', 'page.js'), 'utf8');
ok(/document\.body\.appendChild\(overlay\)/.test(pluginsModule), '插件详情遮罩会被挂到 body（.card 的动画/滤镜会给 fixed 造包含块）');
ok(/wireModal\(document\.getElementById\('pluginDetailOverlay'\)/.test(pluginsModule), '插件详情弹窗走 components/modal.js 的 wireModal（Esc / 点遮罩统一）');

console.log('## 组件层（3.2）');
const componentDir = path.join(ROOT, 'public', 'console', 'components');
for (const name of ['message', 'table', 'modal', 'search-box', 'form']) {
  ok(fs.existsSync(path.join(componentDir, name, `${name}.js`)), `组件 ${name}.js 在 components/${name}/`);
  ok(fs.existsSync(path.join(componentDir, name, `${name}.css`)), `组件 ${name}.css 与 js 同住 components/${name}/`);
}
const messageModule = fs.readFileSync(path.join(componentDir, 'message', 'message.js'), 'utf8');
ok(/export function setMsg\(target, text, kind = 'info'\)/.test(messageModule), 'setMsg 收口「文案 + 配色」');
const modalModule = fs.readFileSync(path.join(componentDir, 'modal', 'modal.js'), 'utf8');
for (const fn of ['openModal', 'closeModal', 'isModalOpen', 'wireModal']) {
  ok(new RegExp(`export function ${fn}\\(`).test(modalModule), `modal.js 导出 ${fn}`);
}
const uiModule = fs.readFileSync(path.join(ROOT, 'public', 'console', 'js', 'ui.js'), 'utf8');
ok(!/function (simpleTable|renderTable)\(/.test(uiModule), 'ui.js 不再自带表格生成器（已搬到 components/table.js）');
// 搜索框：外观只有一处（components/search-box），页面里每个搜索输入都必须写明 type="search"。
const searchBoxCss = fs.readFileSync(path.join(componentDir, 'search-box', 'search-box.css'), 'utf8');
ok(/input\.search-box \{/.test(searchBoxCss), 'search-box.css 用 input.search-box 定义外观（不依赖 type 属性选择器）');
ok(!/\.search-wrap input\s*,?/.test(layerText['components.css']) && !/input\.search-box \{/.test(layerText['components.css']),
  'components.css 不再重复定义搜索框外观');
const searchInputs = [];
for (const id of fs.readdirSync(path.join(ROOT, 'public', 'console', 'pages'))) {
  const file = path.join(ROOT, 'public', 'console', 'pages', id, 'page.html');
  if (!fs.existsSync(file)) continue;
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/<input[^>]*search-box[^>]*>/g)) searchInputs.push({ id, tag: m[0] });
}
ok(searchInputs.length === 2, `页面级搜索框共 2 个（表格的搜索框在 table 组件工具栏里，不计入页面；实际 ${searchInputs.length}）`);
ok(searchInputs.every(({ tag }) => /type="search"/.test(tag)), `页面内搜索框都写明 type="search"（${searchInputs.filter(({ tag }) => !/type="search"/.test(tag)).map(({ id }) => id).join(', ') || '全部正确'}）`);
ok(/class="[^"]*search-box/.test(html.match(/<input id="consoleSearch"[^>]*>/)?.[0] ?? ''), '全局搜索框也走 search-box 组件类');
for (const id of ['skills', 'mcp', 'behaviors']) {
  const module = fs.readFileSync(path.join(ROOT, 'public', 'console', 'pages', id, 'page.js'), 'utf8');
  ok(/from '\.\.\/\.\.\/components\/table\/table\.js'/.test(module) && /tableHtml\(/.test(module), `${id} 页改用 components/table/table.js 的 tableHtml`);
}
// 表单组件：16 个工厂 + createForm 内核 + 字段注解，缺一个都会让页面迁移时踩空。
const formModule = fs.readFileSync(path.join(componentDir, 'form', 'form.js'), 'utf8');
for (const fn of ['textField', 'numberField', 'passwordField', 'textareaField', 'selectField', 'radioGroup', 'checkboxGroup', 'checkboxField', 'switchField', 'fileField', 'dateField', 'timeField', 'datetimeField', 'timeRangeField', 'readonlyField', 'formActions', 'formCallout', 'customField', 'checkListField', 'checkTableField', 'statusBadge', 'inlineActions', 'createForm', 'renderFields']) {
  ok(new RegExp(`export function ${fn}\\(`).test(formModule), `form.js 导出 ${fn}`);
}
ok(/type === 'section'/.test(formModule), 'renderFields 支持 section 分组');
ok(/form-cols/.test(formModule), 'renderFields 输出走 12 列栅格');
const formCss = fs.readFileSync(path.join(componentDir, 'form', 'form.css'), 'utf8');
ok(/.field-error {/.test(formCss) && /.form-actions {/.test(formCss), 'form.css 自带字段错误行与动作区样式');
ok(/.field-row {/.test(formCss), 'form.css 定义行原语 .field-row');
ok(/.field-block > .field-notes {/.test(formCss), '注解区在行外的 .field-notes 里');
ok(!/\.field-row > \.field-label \{[^}]*\b(min-)?height:/.test(formCss), '标签列不许自己写 height/min-height（高度由行决定）');
ok(/\.field-row > \.field-label \{[^}]*margin: 0 !important/.test(formCss), '标签列必须清空继承来的 margin');
ok(/\.field-block--switch/.test(formCss) && /field-block--switch/.test(formModule), '开关行走 .field-block--switch（仅页头工具条收成紧凑 auto/auto）');
ok(!/\bstyle=\"/.test(formModule), '表单组件不用内联 style（CSP style-src \'self\'）');

const msgUsers = ['public/console/js/app.js', ...['access', 'overview', 'persona', 'social-v2', 'usage'].map((id) => `public/console/pages/${id}/page.js`)];
const rawMsg = msgUsers.filter((rel) => /className = 'meta (ok|err)'/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
ok(rawMsg.length === 0, `没有页面再手写 className='meta ok|err'（${rawMsg.join(', ') || '全部走 setMsg'}）`);

// 基础层（CONSOLE_UI_REWORK.md §3）：栅格顺序、输入外观不按 type 属性、语义令牌齐全。
const gridIndex = html.indexOf('/console/css/grid.css');
ok(gridIndex > 0, 'index.html 引入 css/grid.css');
ok(gridIndex < html.indexOf('/console/css/components.css'), 'grid.css 在 components.css 之前加载（栅格先于组件）');
const tokensCss = fs.readFileSync(path.join(ROOT, 'public', 'console', 'css', 'tokens.css'), 'utf8');
for (const token of ['--space-4', '--radius-md', '--color-surface', '--bp-sm']) {
  ok(new RegExp(`${token}\\s*:`).test(tokensCss), `tokens.css 定义 ${token}`);
}
const gridCss = fs.readFileSync(path.join(ROOT, 'public', 'console', 'css', 'grid.css'), 'utf8');
ok(/\.cols \{/.test(gridCss) && /\.col-6 \{/.test(gridCss), 'grid.css 提供 12 列栅格（.cols/.col-*）');
ok(/@media \(min-width:760px\)/.test(gridCss) && /@media \(min-width:1180px\)/.test(gridCss), 'grid.css 带 sm/lg 两个响应式断点');
const strictInputRules = [...layerText['components.css'].replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/input\[type=(text|search|password|number)\][^{]*\{[^}]*background:/g)].map((m) => m[0]);
ok(strictInputRules.length === 0, `基础输入外观不再按 type 属性匹配（残留 ${strictInputRules.length} 处）`);
ok(/:where\(input:not\(\[type=checkbox\]\)/.test(layerText['components.css']), '基础输入外观改为元素级 :where() 选择器');
const barePageInputs = [];
for (const id of fs.readdirSync(path.join(ROOT, 'public', 'console', 'pages'))) {
  const file = path.join(ROOT, 'public', 'console', 'pages', id, 'page.html');
  if (!fs.existsSync(file)) continue;
  for (const m of fs.readFileSync(file, 'utf8').matchAll(/<input\b[^>]*>/g)) {
    if (!/\btype="/.test(m[0])) barePageInputs.push(`${id}: ${m[0].slice(0, 60)}`);
  }
}
ok(barePageInputs.length === 0, `页面里的 <input> 都写明 type（缺 ${barePageInputs.length} 处：${barePageInputs.slice(0, 3).join(' | ')}）`);

// 控件标尺与页面收口（方案 A / L4）：尺寸只能来自令牌，手写控件只降不升，页面不许拆行原语。
console.log('## 控件标尺与五类非字段控件');
for (const token of ['--control-h', '--control-h-sm', '--badge-h', '--field-label-w']) {
  ok(new RegExp(`${token}\\s*:`).test(tokensCss), `tokens.css 定义控件标尺 ${token}`);
}
const baseCssText = fs.readFileSync(path.join(ROOT, 'public', 'console', 'css', 'base.css'), 'utf8');
ok(/^\.btn \{[\s\S]*?height:\s*var\(--control-h/m.test(baseCssText), '控件按钮 .btn 高度取自 --control-h（裸 button 保持通用外观，不挂标尺）');
ok(/height:\s*var\(--control-h/.test(layerText['components.css']), '输入框/下拉框高度取自 --control-h');
ok(/\.field-switch \{[\s\S]*?height: var\(--control-h/m.test(formCss), '开关高度与控件同标尺');
ok(/\.control-row \{/.test(formCss) && /\.control-grow \{/.test(formCss), 'form.css 提供控件行原语 .control-row / .control-grow');
ok(/\.field-checklist \{/.test(formCss) && /\.field-check-item \{/.test(formCss), 'form.css 提供复核清单 .field-checklist / .field-check-item');
const tableComponentCss = fs.readFileSync(path.join(ROOT, 'public', 'console', 'components', 'table', 'table.css'), 'utf8');
ok(/\.table-wrap,[\s\S]*?\.tool-log-table \{/.test(tableComponentCss), '表格容器 .table-wrap / .tool-log-table 由 components/table/table.css 提供');
ok(!/\.field-table\b/.test(formCss), 'form.css 不自带表格外观（checkTable 复用表格组件）');
ok(/import \{ dataTableHtml \}/.test(formModule) && /dataTableHtml\(\{/.test(formModule), 'checkTableField 调用 components/table 的 dataTableHtml');
const tableComponentJs = fs.readFileSync(path.join(ROOT, 'public', 'console', 'components', 'table', 'table.js'), 'utf8');
ok(/export function dataTableHtml\(/.test(tableComponentJs) && /export function initDataTables\(/.test(tableComponentJs), '表格组件导出 dataTableHtml / initDataTables');
ok(/\.table-toolbar \{/.test(tableComponentCss) && /\.table-toolbar-main \{/.test(tableComponentCss), '表格工具栏 .table-toolbar 由表格组件提供');
ok(/\.table-footer \{/.test(tableComponentCss) && /\.pager \{/.test(tableComponentCss) && /\.pager-btn \{/.test(tableComponentCss), '分页 .table-footer / .pager /.pager-btn 由表格组件提供');
ok(/initDataTables\(/.test(fs.readFileSync(path.join(ROOT, 'public', 'console', 'pages', 'social-v2', 'page.js'), 'utf8')), 'social-v2 绑定 initDataTables（工具表搜索/分页）');
ok(/\.status-badge[\s\S]*?\.is-pill \{/.test(layerText['components.css']), '状态徽标 .status-badge / .is-pill 只在 components.css 定义一次');
ok(!/^\.status-badge \{/m.test(layerText['layout.css']), 'layout.css 不再定义状态徽标外观');

// 棘轮：social-v2 已清零，其余页面的手写控件数量只许下降；迁移一页就把基线改成该页的新值（最终全 0）。
const BARE_CONTROL_BASELINE = {
  slang: 0, overview: 0, 'social-v1': 0, plugins: 16, usage: 14,
  access: 12, operations: 10, sessions: 10, behaviors: 4, mcp: 0, skills: 0, reference: 0,
  'social-v2': 0, scheduler: 0, persona: 0,
};
const bareByPage = {};
for (const page of consolePageDirs(ROOT)) {
  if (!page.html) continue;
  const text = fs.readFileSync(page.html, 'utf8');
  // 弹窗右上角的关闭按钮属于 modal 组件的固定结构，不算「页面手写控件」。
  const raw = (text.match(/<(input|button|select|textarea)\b/g) || []).length;
  const modalChrome = (text.match(/<button class="modal-close"/g) || []).length;
  bareByPage[page.id] = raw - modalChrome;
}
const bareRegressed = Object.entries(bareByPage)
  .filter(([id, count]) => count > (BARE_CONTROL_BASELINE[id] ?? 0))
  .map(([id, count]) => `${id}: ${BARE_CONTROL_BASELINE[id] ?? 0} → ${count}`);
ok(bareRegressed.length === 0, `页面手写控件只降不升（${bareRegressed.join('；') || '全部在基线内'}）`);
ok(bareByPage['social-v2'] === 0, `社交二代页全部走字段规格（手写控件 ${bareByPage['social-v2'] ?? '缺失'} 个）`);

// 开关是 <button role="switch">，值在 aria-checked 上：页面没有 createForm 就必须自己 bindSwitches，
// 否则点击完全没反应、`.checked` 读出来是 undefined（scheduler 真踩过：开关点不动 + 保存把 enabled 写坏）。
const unboundSwitchPages = [];
for (const page of consolePageDirs(ROOT)) {
  const spec = page.fields ? fs.readFileSync(page.fields, 'utf8') : '';
  if (!/type:\s*'switch'|switchField\(/.test(spec)) continue;
  const js = page.js ? fs.readFileSync(page.js, 'utf8') : '';
  if (!/bindSwitches\(|createForm\(/.test(js)) unboundSwitchPages.push(page.id);
}
ok(unboundSwitchPages.length === 0, `用开关的页面都绑了点击委托（${unboundSwitchPages.join('、') || '全部已绑'}）`);

// 弹窗必须挂在 body 上（片段被注入 .card，.card 的动画/滤镜会给 position:fixed 造包含块），
// 且页面脚本要用组件 API（openModal/closeModal），不能自己切 hidden。
const schedulerJs = fs.readFileSync(path.join(ROOT, 'public/console/pages/scheduler/page.js'), 'utf8');
ok(html.includes('id="schedEditorOverlay"'), '定时任务编辑器弹窗挂在骨架里（#schedEditorOverlay）');
ok(/import \{[^}]*openModal[^}]*\} from '\.\.\/\.\.\/components\/modal\/modal\.js'/.test(schedulerJs), '定时任务页用 modal 组件打开编辑器（不自己切 hidden）');
ok(!/schedEditor'\)\.hidden/.test(schedulerJs), '定时任务页不再用 .hidden 控制编辑器显隐');

// 下拉框统一由 components/select 装饰（原生箭头方向固定、贴边、无展开动画）；
// 日期用 components/date 的「文本框 + 日历按钮 + 隐藏原生 date」——
// 原生 date 三段式输入不能整段键入（20261225 会变成 202612-02-05），所以可见控件是文本框。
const selectJs = fs.readFileSync(path.join(ROOT, 'public/console/components/select/select.js'), 'utf8');
const routerJs = fs.readFileSync(path.join(ROOT, 'public/console/js/router.js'), 'utf8');
const dateJs = fs.readFileSync(path.join(ROOT, 'public/console/components/date/date.js'), 'utf8');
ok(fs.existsSync(path.join(ROOT, 'public/console/components/select/select.css')), '下拉框组件有 select.css');
ok(/export function decorateSelects/.test(selectJs) && /export function initSelects/.test(selectJs), '下拉框组件导出 decorateSelects / initSelects');
ok(/initSelects/.test(routerJs), '路由器启动时调 initSelects（动态插入的 select 也会被装饰）');
ok(html.includes('/console/components/select/select.css'), 'index.html 引入 select.css');
ok(fs.existsSync(path.join(ROOT, 'public/console/components/date/date.css')), '日期字段组件有 date.css');
ok(/export function initDateFields/.test(dateJs), '日期字段组件导出 initDateFields');
ok(/initDateFields/.test(routerJs), '路由器启动时调 initDateFields');
ok(html.includes('/console/components/date/date.css'), 'index.html 引入 date.css');
ok(
  html.includes('class="date-field-text" id="schedStartDate"') && html.includes('data-date-native="schedStartDate"'),
  '定时任务编辑器用日期字段组件（文本框 + 日历按钮 + 隐藏原生 date）',
);

// 时间同理：原生 time 是两段式，不能整段键入；免打扰合并成「时间段 00:00 ～ 07:00」一行。
const timeJs = fs.readFileSync(path.join(ROOT, 'public/console/components/time/time.js'), 'utf8');
const schedFieldsJs = fs.readFileSync(path.join(ROOT, 'public/console/pages/scheduler/fields.js'), 'utf8');
ok(fs.existsSync(path.join(ROOT, 'public/console/components/time/time.css')), '时间字段组件有 time.css');
ok(/export function initTimeFields/.test(timeJs), '时间字段组件导出 initTimeFields');
ok(/initTimeFields/.test(routerJs), '路由器启动时调 initTimeFields');
ok(html.includes('/console/components/time/time.css'), 'index.html 引入 time.css');
ok(
  schedFieldsJs.includes('id="schedQuietStart"') && schedFieldsJs.includes('data-time-native="schedQuietStart"') && schedFieldsJs.includes('class="field-unit">～'),
  '免打扰合并为「时间段 起始 ～ 结束」一行（时间字段组件）',
);

const rowHacks = [];
for (const page of consolePageDirs(ROOT)) {
  if (!page.css) continue;
  const text = fs.readFileSync(page.css, 'utf8');
  for (const rule of text.matchAll(/\.field-(row|control|block)[^{]*\{[^}]*\}/g)) {
    if (/display:\s*(flex|grid)|grid-template-columns|(min-)?height:\s*\d/.test(rule[0])) rowHacks.push(`${page.id}: ${rule[0].replace(/\s+/g, ' ').slice(0, 50)}`);
  }
}
ok(rowHacks.length === 0, `页面样式不覆盖 .field-row/.field-control 布局（${rowHacks.length} 处：${rowHacks.slice(0, 2).join(' | ')}）`);

// 页面里用到的类名必须有样式定义；3 个历史遗留（未见任何 CSS/JS 使用）先进白名单，迁移该页时删掉。
const LEGACY_UNDEFINED_CLASSES = new Set(['dsh-model-row', 'u-overflow-auto', 'role-defaults']);
const cssFilesAll = [...['tokens', 'base', 'layout', 'grid', 'components', 'utilities'].map((name) => path.join(cssDir, `${name}.css`))];
for (const name of fs.readdirSync(componentDir)) {
  const file = path.join(componentDir, name, `${name}.css`);
  if (fs.existsSync(file)) cssFilesAll.push(file);
}
for (const page of consolePageDirs(ROOT)) if (page.css) cssFilesAll.push(page.css);
const cssAllText = cssFilesAll.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const definedClasses = new Set([...cssAllText.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]));
const undefinedClasses = [];
for (const page of consolePageDirs(ROOT)) {
  if (!page.html) continue;
  const text = fs.readFileSync(page.html, 'utf8');
  for (const m of text.matchAll(/class="([^"]+)"/g)) {
    for (const name of m[1].split(/\s+/)) {
      if (name && !definedClasses.has(name) && !LEGACY_UNDEFINED_CLASSES.has(name)) undefinedClasses.push(`${page.id}.${name}`);
    }
  }
}
ok(undefinedClasses.length === 0, `页面类名都有样式定义（未定义 ${undefinedClasses.length} 个：${[...new Set(undefinedClasses)].slice(0, 4).join(', ')}）`);

console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`);
if (bad > 0) process.exit(1);
