#!/usr/bin/env node
/** Real-browser tests against an isolated fixture. Never starts qq-bridge or sends real messages. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startConsoleFixture } from './console-ui-fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const original = args.includes('--original');
// --record-baseline 只允许对改版前的控制台录基线（真正的 oracle）。
// --accept-contracts 是有意为之的「按当前控制台重录」：仅在契约确实变了、且准备把差异
// 写进提交说明时使用；它会打印受影响的条数，避免悄悄放宽断言。
const acceptContracts = args.includes('--accept-contracts');
const record = args.includes('--record-baseline') || acceptContracts;
const artifacts = args.find(x => x.startsWith('--artifacts='))?.slice('--artifacts='.length);
const views = ['overview', 'config', 'sessions', 'persona', 'plugins', 'skills', 'mcp', 'behaviors', 'slang', 'memory', 'scheduler', 'operations', 'platforms'];
const retiredIds = new Set(existsSync(join(here, 'console-ui-retired-ids.json'))
  ? JSON.parse((await readFile(join(here, 'console-ui-retired-ids.json'), 'utf8')).replace(/^\uFEFF/, ''))
  : []);
const legacyIds = JSON.parse((await readFile(join(here, 'console-ui-legacy-ids.json'), 'utf8')).replace(/^\uFEFF/, ''));
const baselinePath = join(here, 'console-ui-contracts.json');
if (record && !original && !acceptContracts) throw new Error('--record-baseline requires --original; use --accept-contracts to re-record from the current console on purpose.');

async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright'].filter(Boolean)) {
    try { return require(candidate); } catch {}
  }
  throw new Error('Playwright not found. Install with npm install --no-save playwright, or set PLAYWRIGHT_MODULE to its package directory.');
}

const { chromium } = await loadPlaywright();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || [
  join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
  join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
].find(x => existsSync(x));
const fixture = await startConsoleFixture({ original });
let browser;
const results = [];
const errors = [];
const blockedRequests = [];
// 用例失败时弹窗往往还开着，后面每个用例都会卡在「拦截点击」上：收尾先把遗留遮罩关掉，
// 让失败只影响它自己。
let activePage = null;
function closeStrayOverlays() {
  if (!activePage) return Promise.resolve();
  return activePage.evaluate(() => {
    for (const overlay of document.querySelectorAll('.modal-overlay.open')) {
      overlay.querySelector('[data-modal-close]')?.click();
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
    }
  }).catch(() => {});
}
async function test(name, fn) {
  const start = Date.now();
  try { await fn(); results.push({ name, ok: true, durationMs: Date.now() - start }); console.log(`PASS ${name}`); }
  catch (error) {
    results.push({ name, ok: false, error: error.message, durationMs: Date.now() - start });
    console.error(`FAIL ${name}: ${error.message}`);
    await closeStrayOverlays();
  }
}

try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  // Even if a future console accidentally references an external endpoint, tests cannot reach it.
  await context.route('**/*', async route => {
    const requested = new URL(route.request().url());
    if (requested.origin === fixture.url) return route.continue();
    blockedRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', (dialog) => { dialog.accept().catch(() => {}); });
  // 控制台的 confirm/alert 已换成 in-page 的 message-box（confirmBox/alertBox）。
  // 既有用例默认「弹确认就点确定」，与上面原生 dialog 的 accept 行为保持一致。
  await page.addInitScript(() => {
    const clickConfirm = () => {
      document.querySelectorAll('[data-box-confirm]').forEach((button) => button.click());
    };
    const start = () => {
      clickConfirm();
      new MutationObserver(clickConfirm).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  });
  await page.goto(fixture.url);
  // 控制台已片段化：各页 HTML 在第一次进入该页时才注入（router.hydratePage）。
  // 所以这里先逐页 hydrate 一遍，后面「全量 legacy ID 都在」以及按 id 取元素才有东西可取。
  await page.waitForFunction(() => document.querySelectorAll('#mainNav [data-view]').length > 0);
  const allPages = await page.evaluate(() => [...document.querySelectorAll('#mainNav [data-view]')].map(node => node.dataset.view));
  // 导航的初始形态要在逐页 hydrate 前断言。
  await test('Navigation ships three flat groups', async () => {
    assert.deepEqual(await page.$$eval('#mainNav .nav-label', (nodes) => nodes.map((node) => node.textContent.trim())),
      ['管理', '聊天行为', '扩展'], '导航按三组排列');
    assert.equal(await page.locator('#mainNav details').count(), 0, '导航不再用折叠分组');
    assert.equal(await page.locator('#mainNav [data-view]').count(), 14, '三组下仍是 14 个入口');
  });
  async function hydrate(view) {
    await page.evaluate(v => { if (location.hash !== `#${v}`) location.hash = `#${v}`; }, view);
    // 片段 HTML 到位 ≠ 页面可用：字段由 fields.js 的规格在 init() 里渲染（router 在 init 之后打 pageReady）。
    try {
      await page.waitForFunction(v => (document.querySelector(`[data-page="${v}"]`)?.children.length ?? 0) > 0, view);
      await page.waitForFunction(v => document.querySelector(`[data-page="${v}"]`)?.dataset.pageReady === '1', view);
    } catch (error) {
      // init() 抛错时 pageReady 永远不会打上：把页面自己的报错带出来，否则只剩一行超时。
      const detail = errors.length ? `；页面错误：${errors.join(' | ')}` : '';
      throw new Error(`页面 ${view} 未就绪：${error.message}${detail}`);
    }
  }
  for (const view of allPages) await hydrate(view);
  await hydrate('overview');
  // 片段化之后，「某个 id 属于哪一页」不能在元素不存在时反查（reveal 的老写法会直接超时）。
  // 这里在全部页面都已注入的时刻拍一张 id → 页面的快照；刷新后各页 DOM 会被清掉，
  // 但快照仍然有效，reveal() 先按快照切页再定位。
  const idPage = await page.evaluate(() => {
    const map = {};
    for (const section of document.querySelectorAll('main section[data-page]')) {
      for (const node of section.querySelectorAll('[id]')) map[node.id] = section.dataset.page;
    }
    return map;
  });

  async function navigate(view) {
    if (original) return;
    if (await page.locator(`[data-page="${view}"]:visible`).count()) {
      await hydrate(view);
      return;
    }
    const nav = page.locator(`[data-view="${view}"]`).first();
    if (!await nav.isVisible()) {
      const toggle = page.locator('#navToggle, [data-nav-toggle], [aria-controls="sidebar"], button[aria-label*="导航"]').first();
      if (await toggle.count()) await toggle.click();
    }
    await nav.click();
    // 配置页有未保存修改时会拦下切页（三选一弹窗）：测试里一律按「不保存，直接离开」继续，
    // 弹窗本身在专门的用例里断言。
    const leaveDialog = page.locator('#unsavedLeaveModal [data-leave="discard"]');
    if (await leaveDialog.count()) await leaveDialog.click();
    await hydrate(view);
  }
  async function reveal(selector) {
    // 片段化之后元素只存在于自己那一页里：先按 id 快照切页，再定位。
    // 元素不存在时老写法（对 locator 调 evaluate 反查父页）会直接超时。
    const id = selector.match(/^#([\w-]+)/)?.[1];
    const view = id ? idPage[id] : null;
    if (view) await navigate(view);
    const target = page.locator(selector).first();
    for (const details of await target.locator('xpath=ancestor::details').all()) {
      if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
    }
    return target;
  }
  // 平台页是清单 + 二级页：卡片在折叠组里，先展开所在组再点卡片，等地址栏落到子路由。
  async function openPlatform(key) {
    await navigate('platforms');
    const tile = page.locator(`[data-tile-id="${key}"]`).first();
    await tile.waitFor({ state: 'attached', timeout: 5000 });
    for (const details of await tile.locator('xpath=ancestor::details').all()) {
      if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
    }
    await tile.click();
    await page.waitForFunction((k) => location.hash === `#platforms/${k}`, key);
    await page.waitForSelector('[data-platform-view="detail"]:not([hidden]) [data-platform-panel-body] > *', { timeout: 5000 });
  }
  async function fill(id, value) { await (await reveal(`#${id}`)).fill(String(value)); }
  async function check(id, checked) { await (await reveal(`#${id}`)).setChecked(checked); }
  async function clickWrite(selector, path, method = 'POST') {
    const target = await reveal(selector);
    const [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === method),
      target.click(),
    ]);
    assert.equal(response.status(), 200, `${method} ${path} should succeed`);
    assert.equal((await response.json()).ok, true);
    return fixture.requests.at(-1)?.body;
  }
  // 页面级保存：右下角 action-dock 的保存动作。输入事件到「脏」有 60ms 合并窗口，先等它可用，再点保存。
  async function saveBarWrite(path, method = 'POST') {
    // 保存按钮常驻：等它可用（=当前确有脏分区）再点，否则会点到禁用态。
    await page.waitForFunction(() => {
      const btn = document.getElementById('actionDock-save');
      return !!btn && !btn.disabled && !document.getElementById('actionDock')?.hidden;
    }, null, { timeout: 5000 });
    return clickWrite('#actionDock-save', path, method);
  }

  await test('Legacy config IDs remain present and every DOM ID is unique', async () => {
    const ids = await page.locator('[id]').evaluateAll(nodes => nodes.map(x => x.id));
    // G3 删除了 social-v1 / social-v2 / access 三页；这些页的旧 id 记在 retired 基线里，
    // 其余历史 id 仍必须存在，避免后续改版悄悄删掉仍在用的字段。
    assert.equal(legacyIds.length, 196);
    const missing = legacyIds.filter(x => !ids.includes(x) && !retiredIds.has(x));
    assert.deepEqual(missing, []);
    const dupIds = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
    assert.equal(new Set(ids).size, ids.length, `Duplicate DOM IDs detected: ${dupIds.join(',')}`);
  });

  if (!original) await test('All navigation destinations work and preserve unsaved form values across polling', async () => {
    for (const view of views) {
      await navigate(view);
      // page-stack 是 display:contents，section 自身没有盒子，不能用 getClientRects 判断可见性；
      // 这里只认 main 的直接子 section，按 hidden 属性判断。
      const visiblePages = await page.locator('main section[data-page]').evaluateAll(nodes => nodes.filter(x => !x.hidden).map(x => x.dataset.page));
      assert(visiblePages.length > 0, `${view} has no visible content`);
      assert(visiblePages.every(x => x === view), `${view} exposes another page: ${visiblePages.join(', ')}`);
    }
    // 轮询每秒刷新状态，但不应覆盖尚未提交的草稿；分页保持，避免把“页面重新初始化”误判为轮询。
    await navigate('config');
    await page.locator('[data-config-section="runtime"]').click();
    await fill('sendLimitMin', '7');
    await page.waitForTimeout(3300);
    assert.equal(await page.locator('#sendLimitMin').inputValue(), '7', 'sendLimitMin lost its draft');
    await navigate('operations');
    await fill('tsMsg', '未发送的测试消息');
    await page.waitForTimeout(3300);
    assert.equal(await page.locator('#tsMsg').inputValue(), '未发送的测试消息', 'tsMsg lost its draft');
    // 「手动添加」表单已搬进弹窗（关闭状态不可见，fill 会超时）：直接写 DOM 值，仍然验证「轮询不吞草稿」。
    await navigate('slang');
    await page.evaluate(() => { document.getElementById('slangMeaning').value = '未保存的含义'; });
    await page.waitForTimeout(3300);
    assert.equal(await page.evaluate(() => document.getElementById('slangMeaning').value), '未保存的含义', 'slangMeaning lost its draft');
    // Restore fixture defaults so the independent payload baseline remains deterministic.
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#mainNav [data-view]').length > 0);
    await hydrate('config');
  });

  await test('MCP page merges the tool reference and shows the real tool inventory', async () => {
    await navigate('mcp');
    // 主从布局：左栏是 server 列表，右栏是选中 server 的详情与工具清单。
    await page.waitForFunction(() => document.querySelectorAll('#mcpSplit .split-item').length >= 2);
    // 右栏是两节卡（属性 / 工具），两节都由表格组件渲染（分页与筛选也在组件里）。
    assert.equal(await page.locator('#mcpSplit [data-split-detail] > .card').count(), 2, 'MCP 详情是属性与工具两张卡');
    assert.equal(await page.locator('#mcpSplit [data-split-detail] [data-table]').count(), 2, 'MCP 详情应使用表格组件');
    // 工具栏在左栏：筛选与搜索只作用于这份清单，页面级不再有一整条工具栏。
    assert.equal(await page.locator('#mcpSplit .split-toolbar #mcpServerSearch').count(), 1, '工具栏在 split-view 的工具栏槽里');
    assert.match(await page.locator('#mcpSplit .split-item').first().innerText(), /个工具/, '列表项带一行摘要');
    const summary = await page.locator('#mcpSummary').innerText();
    assert.match(summary, /2 个 server · 2 个工具 · 1 个技能/);
    assert.ok(await page.locator('#mcpSplit .split-item').first().getAttribute('aria-selected') === 'true', '默认选中第一个 server');
    const detail = page.locator('#mcpList [data-split-detail]');
    assert.match(await detail.innerText(), /snowluma_status/, '内置 server 详情应列出工具');

    await page.locator('#mcpSplit .split-item[data-split-key="test-ext"]').click();
    await page.waitForFunction(() => document.querySelector('#mcpList [data-split-detail]')?.textContent.includes('demo_tool'));
    const externalActions = detail.locator('[data-mcp-act]');
    assert.equal(await externalActions.count(), 4, '外部 MCP 操作有编辑/测试/日志/删除');
    assert.equal(await page.locator('#mcpFilterSource').count(), 1);
    assert.equal(await page.locator('#mcpFilterStatus').count(), 1);
    assert.equal(await page.locator('#mcpServerSearch').count(), 1);

    // 筛选：只看外部 → 左栏剩 test-ext；清空后恢复两条。
    await page.selectOption('#mcpFilterSource', 'external');
    await page.waitForTimeout(120);
    assert.equal(await page.locator('#mcpSplit .split-item').count(), 1, '按来源筛选只留外部 server');
    await page.selectOption('#mcpFilterSource', 'all');

    await detail.locator('[data-mcp-act="delete"]').click();
    await page.waitForTimeout(350);
    const recorded = await (await fetch(`${fixture.url}/__fixture/requests`)).json();
    assert.ok(
      recorded.requests.some((entry) => entry.method === 'DELETE' && entry.path === '/api/extensions/mcp/test-ext'),
      '删除按钮应发出无 body 的 DELETE /api/extensions/mcp/test-ext',
    );
    assert.equal(await page.locator('[data-view="reference"]').count(), 0, '工具参考已并入 MCP 页，不再有独立导航');
    assert.equal(await page.locator('#section-reference').count(), 0, '旧工具参考容器应已移除');
  });

  await test('MCP editor uses a transport template and exposes a draft test button', async () => {
    await navigate('mcp');
    await page.click('[data-mcp-new]');
    await page.waitForFunction(() => document.getElementById('mcpEditor')?.classList.contains('open'));
    assert.equal(await page.locator('#mcpEditTest').count(), 1, '弹窗底栏应有测试连接');
    assert.match(await page.locator('#mcpEditConfig').inputValue(), /"command"/, '新建 stdio 默认带模板');
    await page.selectOption('#mcpEditTransport', 'streamable_http');
    assert.match(await page.locator('#mcpEditConfig').inputValue(), /"url"/, '切换 HTTP 应换成 URL 模板');
    assert.equal(await page.locator('#mcpEditAllowPrivate').isVisible(), true);
    assert.equal(await page.locator('#mcpEditAllowArbitrary').isVisible(), false);
    await page.click('#mcpEditor [data-modal-close]');
  });

  await test('Plugin detail renders its configSchema form and posts a draft test', async () => {
    await navigate('plugins');
    await page.waitForSelector('#pluginsList [data-tile-id="demo-plugin"]');
    // 插件详情是二级页：整卡可点，地址栏落到 #plugins/<id>。
    await page.click('#pluginsList [data-tile-id="demo-plugin"]');
    await page.waitForFunction(() => location.hash === '#plugins/demo-plugin');
    // 与平台详情同构：概览 → 配置 → 审计，默认落在概览。
    assert.deepEqual(await page.$$eval('[data-plugin-tab]', (nodes) => nodes.map((node) => node.dataset.pluginTab)),
      ['overview', 'config', 'audit'], '插件详情三页：概览 / 配置 / 审计');
    assert.equal(await page.locator('[data-plugin-tab="overview"].active').count(), 1, '默认落在概览');
    assert.equal(await page.locator('[data-plugins-view="detail"] .detail-panel').count(), 1, '插件详情整页是一张大卡');
    assert.equal(await page.locator('[data-plugins-view="detail"] .detail-panel > .detail-head').count(), 1, '页头也在这张卡里');
    assert.equal(await page.locator('[data-plugin-panel-body] .detail-panel-card--metric').count(), 3, '调用统计是三张小卡');
    await page.click('[data-plugin-tab="config"]');
    await page.waitForSelector('[data-plugins-view="detail"]:not([hidden]) #cfg__baseUrl', { timeout: 5000 });
    assert.equal(await page.locator('#cfg__baseUrl').inputValue(), 'http://127.0.0.1:3110');
    assert.equal(await page.locator('#cfg__timeoutMs').inputValue(), '1200');
    assert.equal(await page.locator('#pluginConfigTest').count(), 1, '配置区应有测试按钮');
    assert.equal(await page.locator('#pluginPersistMount').count(), 0, '配置页不再有单独「启用状态」区块');
    await page.click('#pluginConfigTest');
    await page.waitForTimeout(250);
    const recorded = await (await fetch(`${fixture.url}/__fixture/requests`)).json();
    const call = recorded.requests.find((entry) => entry.method === 'POST' && entry.path === '/api/plugins/demo-plugin/test');
    assert.ok(call, '测试按钮应 POST /api/plugins/demo-plugin/test');
    assert.equal(call.body.config.timeoutMs, 1200);
    // 返回清单写空 sub：地址栏回到 #plugins，详情视图拆掉、清单重新可见。
    await page.click('[data-detail-back]');
    await page.waitForFunction(() => location.hash === '#plugins');
    assert.equal(await page.locator('[data-plugins-view="detail"]').isHidden(), true, '返回后回到清单');
    // 卡片动作条：配置在最前、卸载是项目自带的红边危险按钮。
    assert.equal(await page.locator('#pluginsList [data-plugin-config="demo-plugin"]').count(), 1, '卡片上应有「配置」按钮');
    assert.match(await page.getAttribute('#pluginsList [data-plugin-action="uninstall"]', 'class'), /\bdanger\b/, '卸载用红边危险按钮');
    // 点「配置」直接落详情页的配置标签。
    await page.click('#pluginsList [data-plugin-config="demo-plugin"]');
    await page.waitForFunction(() => location.hash === '#plugins/demo-plugin/config');
    await page.waitForSelector('[data-plugins-view="detail"]:not([hidden]) #cfg__baseUrl', { timeout: 5000 });
    assert.equal(await page.locator('[data-plugin-tab="config"].active').count(), 1, '「配置」落到配置标签');
    await page.click('[data-detail-back]');
    await page.waitForFunction(() => location.hash === '#plugins');
  });



  await test('Global config renders field rows with aligned labels', async () => {
    await hydrate('config');
    const geom = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#section-config [data-field-wrap]'));
      let worst = 0;
      for (const w of rows) {
        if (w.classList.contains('field-block--checklist') || w.classList.contains('field-block--table') || w.classList.contains('field-block--textarea')) continue;
        const l = w.querySelector('.field-label');
        const c = w.querySelector('.field-control');
        if (!l || !c) continue;
        const lb = l.getBoundingClientRect();
        const cb = c.getBoundingClientRect();
        worst = Math.max(worst, Math.abs((lb.top + lb.height / 2) - (cb.top + cb.height / 2)));
      }
      return { rows: rows.length, worst: Math.round(worst) };
    });
    assert.ok(geom.rows > 0, 'config page should render field rows');
    assert.ok(geom.worst <= 1, 'label and control centres must align, got ' + geom.worst + 'px');
  });

  await test('Config action rows keep one button height', async () => {
    await hydrate('config');
    const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#section-config .form-actions')).map((row) => {
      const hs = Array.from(row.querySelectorAll('button')).map((b) => Math.round(b.getBoundingClientRect().height)).filter((h) => h > 0);
      return { cls: row.className, heights: [...new Set(hs)] };
    }));
    const mixed = rows.filter((row) => row.heights.length > 1);
    assert.deepEqual(mixed, [], 'every action row must use a single button height, got ' + JSON.stringify(mixed));
    assert.ok(rows.length > 0, 'expected at least one action row on config');
  });

  await test('默认行为挂在用户平台条目上，行为档案在平台详情', async () => {
    await hydrate('config');
    assert.equal(await page.locator('[data-config-section="behavior"]').count(), 0);
    // 默认行为不是全局配置项：它按用户平台（实例）各一份，字段在平台详情 › 配置里。
    assert.equal(await page.locator('#runtimeDefaultSelect').count(), 0, '全局配置不再有默认行为下拉');

    await openPlatform('user:qq');
    await page.click('[data-platform-tab="config"]');
    await page.waitForSelector('#platformDefaultBehavior', { timeout: 5000 });
    await page.waitForFunction(() => document.getElementById('platformDefaultBehavior')?.options.length >= 2);
    assert.equal(await page.locator('#platformDefaultBehavior').inputValue(), 'social-v2', '下拉回填条目上的默认行为');
    await page.selectOption('#platformDefaultBehavior', 'social-v1');
    const patch = await clickWrite('#platformConfigSave', '/api/platforms/registry/user/qq/config', 'PATCH');
    assert.equal(patch.defaultBehavior, 'social-v1', '默认行为随条目保存一起提交');
    await page.selectOption('#platformDefaultBehavior', 'social-v2');
    const restored = await clickWrite('#platformConfigSave', '/api/platforms/registry/user/qq/config', 'PATCH');
    assert.equal(restored.defaultBehavior, 'social-v2', '改回去再存一次，不影响后面的用例');

    // 行为档案是用户平台的子资源：在「平台 › 话术与行为」里改，不再有独立整页。
    await page.click('[data-platform-tab="voice"]');
    await page.waitForSelector('#behaviorTable [data-behavior-edit="social-v1"]', { timeout: 5000 });
    await page.click('#behaviorTable [data-behavior-edit="social-v1"]');
    await page.waitForFunction(() => document.getElementById('behaviorFormLabel')?.value === '一代仿真默认行为');
    await page.locator('#behaviorFormPanel [data-field="contextWindow"]').fill('25');
    await page.locator('#behaviorFormSave').click({ force: true });
    await page.waitForTimeout(600);
    const body = fixture.requests.filter((r) => r.method === 'PUT' && r.path.includes('/api/config/behaviors/')).at(-1)?.body;
    assert.equal(body?.data?.kind, 'social-v1');
    assert.equal(body?.data?.config?.contextWindow, 25);
  });

  await test('Platform detail keeps the behavior panel and the prompt card apart', async () => {
    await openPlatform('user:qq');
    await page.click('[data-platform-tab="voice"]');
    await reveal('#behaviorFormSave');
    assert.equal(await page.locator('#behaviorPromptSave').count(), 0, '提示词卡不再有独立保存按钮');
    // 平台话术与行为档案同在「话术与行为」，但各自有自己的宿主与保存路径。
    assert.equal(await page.locator('#platformPromptCard').count(), 1, '平台话术卡在「话术与行为」里');
    await page.waitForSelector('#behaviorPromptCard .prompt-card-body', { timeout: 5000 });
    assert.ok(await page.locator('#behaviorPromptCard [data-prompt-edit], #behaviorPromptCard [data-prompt-save]').count() > 0, '提示词卡有编辑/保存按钮');
    // 版式跟能力页同一套：面板自己出两段分区（清单 / 内容），分区里不再套一层卡。
    assert.deepEqual(await page.$$eval('#platformBehaviorsHost .detail-section-head h2', (nodes) => nodes.map((node) => node.textContent.trim())),
      ['档案清单', '档案内容'], '行为档案按两段分区排，与能力页同构');
    assert.equal(await page.locator('#platformBehaviorsHost .card').count(), 0, '分区里不再套一层卡');
    const groupGap = await page.$eval('#behaviorFormPanel', (el) => parseFloat(getComputedStyle(el).rowGap) || 0);
    assert.ok(groupGap > 0, `字段分组之间留出间距（${groupGap}px）`);
  });

  await test('Platform detail splits the prompt card and the tool table across two tabs', async () => {
    await openPlatform('user:qq');
    await page.click('[data-platform-tab="voice"]');
    await page.waitForSelector('#platformPromptCard .prompt-card-body', { timeout: 5000 });
    assert.equal(await page.locator('#platformSave').count(), 0, '平台话术卡不再自带独立保存按钮');
    assert.ok(await page.locator('#platformPromptCard [data-prompt-edit]').count() > 0, '平台提示词卡有编辑按钮');
    await page.click('[data-platform-tab="capabilities"]');
    await page.waitForSelector('[data-platform-panel-body] [data-table]', { timeout: 5000 });
    assert.ok(await page.locator('[data-platform-panel-body] [data-table]').count() > 0, '平台工具走表格组件');
    assert.equal(await page.locator('#platformPromptCard').count(), 0, '话术卡只在「话术与行为」里');
  });

  await test('Platforms page lists both sides and hides the clean diagnostics card', async () => {
    await navigate('platforms');
    await page.waitForSelector('[data-tile-id="user:qq"]', { timeout: 5000 });
    // 整页是一张非折叠的清单卡：工具栏 + 两个普通下拉分组，分类不以卡片形式出现。
    assert.equal(await page.locator('#platformHost [data-platform-view="list"] > .card').count(), 1, '清单只有一张非折叠卡');
    assert.equal(await page.locator('#platformHost details.settings-group:not(.is-plain)').count(), 0, '清单里不再有折叠卡片');
    assert.equal(await page.locator('#platformToolbar [data-table-search]').count(), 1, '清单带搜索');
    assert.equal(await page.locator('#platformToolbar [data-table-refresh]').count(), 1, '清单带刷新');
    // 诊断为空时那一块是空的（fixture 的 diagnostics: []）。
    assert.equal(await page.locator('#platformDiagnostics [data-table]').count(), 0, '没有诊断时不渲染诊断表');
    assert.equal(await page.locator('[data-tile-id="user:qq"]').count(), 1, '用户平台在清单里');
    assert.equal(await page.locator('[data-tile-id="user:wx"]').count(), 1, '第二条用户实例也在清单里');
    assert.equal(await page.locator('[data-tile-id="agent:dsh"]').count(), 1, 'Agent 平台在清单里');
    assert.equal(await page.locator('[data-tile-id="agent:acp"]').count(), 1, '第二个 Agent 平台也在清单里');
    assert.equal(await page.locator('[data-platform-list] .tile--interactive').count(), 4, '每条注册的平台都是一张可点的卡片');
    assert.equal(await page.locator('#platformGroup-user, #platformGroup-agent').count(), 2, '两侧各一个分类分组');
    assert.equal(await page.locator('#platformGroup-user.is-plain, #platformGroup-agent.is-plain').count(), 2, '分组是普通下拉栏，不是卡片');
    // 条目徽标挂在卡片上：停用的实例不该看起来像在跑。
    const wx = page.locator('[data-tile-id="user:wx"]');
    assert.equal(await wx.locator('.tag').filter({ hasText: '已停用' }).count(), 1, '停用的实例在清单里标出');
    assert.equal(await page.locator('[data-tile-id="user:qq"] .tag').filter({ hasText: '已接管' }).count(), 1, '在跑的实例标出入站结论');
  });

  await test('Platform detail answers its questions with four tabs and one conclusion', async () => {
    await openPlatform('user:qq');
    // 页头那句话由注册表算好下发：前端不拼「能收能发 / 能发几种段」。
    const promise = (await page.textContent('[data-platform-view="detail"] .platform-promise')).trim();
    assert.match(promise, /^能收能发；能发 \d+ 种段；/, `结论行从能力事实开头：${promise}`);
    assert.deepEqual(await page.$$eval('[data-platform-tab]', (nodes) => nodes.map((node) => node.dataset.platformTab)),
      ['overview', 'config', 'capabilities', 'voice'], '用户平台：概览 / 配置 / 能力 / 话术与行为');
    assert.equal(await page.locator('[data-platform-tab="overview"].active').count(), 1, '默认落在概览');
    assert.equal(await page.locator('[data-platform-tab="advanced"]').count(), 0, '不再有「高级」标签');

    // 概览：整页一张大卡（页头与标签条也在卡里），卡内按「运行状态 / 资产」两段排；资产是四张小卡。
    assert.equal(await page.locator('[data-platform-view="detail"] .detail-panel').count(), 1, '整页是一张大卡');
    assert.equal(await page.locator('[data-platform-view="detail"] .detail-panel > .detail-head').count(), 1, '页头就在这张卡里，卡外不留裸露底色');
    assert.equal(await page.locator('[data-platform-view="detail"] .detail-panel > .page-tabs').count(), 1, '标签条也在卡里');
    assert.deepEqual((await page.$$eval('[data-platform-panel-body] .detail-section-head h2', (nodes) => nodes.map((node) => node.textContent.trim()))).slice(0, 2),
      ['运行状态', '资产'], '概览按两段排，不再一段一张卡');
    assert.equal(await page.locator('[data-platform-panel-body] .detail-panel-card--metric').count(), 4, '资产的四项是四张小卡');
    // 同一行的小卡高度由网格拉伸决定：内容长短不再造成参差（逐行比对，不假设一行能摆下四张）。
    const cardRows = await page.$$eval('[data-platform-panel-body] .detail-panel-card--metric', (nodes) => {
      const byRow = new Map();
      for (const node of nodes) {
        const box = node.getBoundingClientRect();
        const key = Math.round(box.top);
        byRow.set(key, [...(byRow.get(key) ?? []), Math.round(box.height)]);
      }
      return [...byRow.values()];
    });
    assert.ok(cardRows.every((heights) => new Set(heights).size === 1), `同一行的小卡等高：${JSON.stringify(cardRows)}`);
    assert.equal(await page.locator('[data-platform-panel-body] [data-table]').count(), 0, '概览不用表格');

    await page.click('[data-platform-tab="capabilities"]');
    await page.waitForSelector('[data-platform-panel-body] [data-table]', { timeout: 5000 });
    // 能力页只摆结论：一组一张带边框小卡，工具表另起一段。
    assert.deepEqual((await page.$$eval('[data-platform-panel-body] .detail-section-head h2', (nodes) => nodes.map((node) => node.textContent.trim()))).slice(0, 2),
      ['能力清单', '平台工具'], '能力页按「能力清单 / 平台工具」两段排');
    assert.deepEqual((await page.$$eval('[data-platform-panel-body] .detail-panel-card h4', (nodes) => nodes.map((node) => node.textContent.trim()))).slice(0, 3),
      ['发送能力', '接收能力', '不支持的消息段'], '能力清单按组摆结论');
    assert.ok(await page.locator('[data-platform-panel-body] .cap-pill').count() > 0, '每项是一条药丸（名字 + id）');
    // 能不能做是平台声明的事实，不是控制台能改的开关：结论里没有勾选框。
    assert.equal(await page.locator('[data-platform-panel-body] .cap-pill-row input, [data-platform-panel-body] .cap-pill-row select, [data-platform-panel-body] .cap-pill-row [role="switch"]').count(), 0, '能力清单只读');
    const sources = await page.$$eval('[data-platform-panel-body] .detail-panel-card-head .tag', (nodes) => nodes.map((node) => node.textContent.trim()));
    assert.ok(sources.includes('内核段表 ∩ 平台声明') && sources.includes('平台声明'), `来源标签也由注册表给：${[...new Set(sources)].join('/')}`);
  });

  await test('Agent platform keeps the declaration matrix folded inside capabilities', async () => {
    await openPlatform('agent:dsh');
    assert.match(await page.textContent('[data-platform-view="detail"] .platform-promise'), /^能装预设或直通；话术走/,
      'Agent 结论行由它自己的声明拼出');
    assert.deepEqual(await page.$$eval('[data-platform-tab]', (nodes) => nodes.map((node) => node.dataset.platformTab)),
      ['overview', 'config', 'capabilities'], 'Agent 平台没有话术页');
    await page.click('[data-platform-tab="capabilities"]');
    await page.waitForSelector('[data-platform-panel-body] [data-table]', { timeout: 5000 });
    assert.deepEqual((await page.$$eval('[data-platform-panel-body] .detail-panel-card h4', (nodes) => nodes.map((node) => node.textContent.trim()))).slice(0, 4),
      ['生效方式', '提示注入', '效果', '对端权限档'], '能力标签给四组结论');
    assert.equal(await page.locator('[data-platform-panel-body] .cap-pill-row input, [data-platform-panel-body] .cap-pill-row select').count(), 0, 'Agent 侧结论同样只读');

    // 五列能力位矩阵降级到「能力 › 原始声明」，且默认折叠：主标签不拿它占地方。
    const raw = page.locator('details[data-collapse-id="platform-raw-agent-dsh"]');
    await raw.waitFor({ state: 'attached', timeout: 5000 });
    assert.equal(await raw.getAttribute('open'), null, '原始声明默认折叠');
    assert.match(await raw.locator(':scope > summary').textContent(), /原始声明/, '折叠标题说明这是原始声明');
    await raw.locator(':scope > summary').click();
    assert.equal(await raw.getAttribute('open'), '', '点开后展开');
    const rawText = await raw.textContent();
    assert.match(rawText, /能力位/, '展开后是逐条能力位');
    assert.match(rawText, /应用方式/);
    assert.match(rawText, /对端权限档/);
  });

  await test('Navigation highlights the page a deep link lands on', async () => {
    assert.equal(await page.locator('#mainNav [data-view]').count(), 14, '三组下仍是 14 个入口');
    // 扁平分组不会再展开任何容器：深链落在「全局配置」时高亮项应当在侧边栏里直接可见。
    await navigate('config');
    assert.equal(await page.locator('#mainNav [data-view="config"].active').count(), 1, '导航高亮当前页');
    assert.ok(await page.locator('#mainNav [data-view="config"]').isVisible(), '高亮项在侧边栏里可见');
  });

  await test('Platform detail restores from a deep link and steps back', async () => {
    await navigate('platforms');
    // 深链直接带 sub 与 tab：刷新后应该落到同一个平台的同一个标签。
    await page.evaluate(() => { location.hash = '#platforms/agent:dsh/config'; });
    await page.waitForSelector('[data-platform-view="detail"]:not([hidden]) #platformConfigMount [data-field="cfg__baseUrl"]', { timeout: 5000 });
    assert.equal(await page.locator('[data-platform-tab="config"].active').count(), 1, '深链还原到配置标签');
    // 标签与返回都写地址栏：后退回清单，前进回同一个标签。
    await page.evaluate(() => history.back());
    await page.waitForSelector('[data-platform-view="list"]:not([hidden])', { timeout: 5000 });
    assert.equal(await page.locator('[data-platform-view="detail"]').isHidden(), true, '后退回清单');
    await page.evaluate(() => history.forward());
    await page.waitForSelector('[data-platform-view="detail"]:not([hidden])', { timeout: 5000 });
    assert.equal(await page.locator('[data-platform-tab="config"].active').count(), 1, '前进回同一个标签');
  });

  await test('User platform config is writable and carries the entry switch', async () => {
    await openPlatform('user:qq');
    await page.click('[data-platform-tab="config"]');
    await page.waitForSelector('#platformConfigMount [data-field="cfg__wsUrl"]', { timeout: 5000 });
    // 与 Agent 平台同一张表单：字段来自 configSchema，值来自注册表条目的那一份 config。
    assert.equal(await page.locator('#cfg__wsUrl').inputValue(), 'ws://127.0.0.1:3001');
    // 用户平台多一个条目级开关（不在 schema 里）：它决定这条实例装配不装配。
    assert.equal(await page.locator('[role="switch"][data-field="platformEnabled"]').count(), 1, '条目开关排在表单首位');
    assert.equal(await page.locator('#platformEnabled').getAttribute('aria-checked'), 'true', '启用的实例开关是开的');
    await page.locator('#cfg__wsUrl').fill('ws://127.0.0.1:3002');
    const patch = await clickWrite('#platformConfigSave', '/api/platforms/registry/user/qq/config', 'PATCH');
    assert.equal(patch.wsUrl, 'ws://127.0.0.1:3002', '保存提交改过的连接地址');
    assert.equal(patch.enabled, true, '条目开关随表单一起提交');
    // 保存成功后重新拉快照：标签留在配置页，字段显示刚写进去的值。
    await page.waitForFunction(() => document.getElementById('cfg__wsUrl')?.value === 'ws://127.0.0.1:3002', null, { timeout: 5000 });
  });

  await test('Agent platform config form covers connection fields only', async () => {
    await openPlatform('agent:dsh');
    await page.click('[data-platform-tab="config"]');
    await page.waitForSelector('#platformConfigMount [data-field="cfg__baseUrl"]', { timeout: 5000 });
    // 连接面由 configSchema 生成；模型选择搬到了同一页的模型卡，不再混进这张表单。
    assert.equal(await page.locator('[data-field="cfg__provider"], [data-field="cfg__model"], [data-field="cfg__reasoningEffort"]').count(), 0, '模型字段不再由 configSchema 生成');
    assert.equal(await page.locator('[role="switch"][data-field="cfg__allowRemote"]').count(), 1, '布尔字段走开关');
    await page.locator('#cfg__baseUrl').fill('http://127.0.0.1:3080');
    const patch = await clickWrite('#platformConfigSave', '/api/platforms/registry/agent/dsh/config', 'PATCH');
    // 补丁是整张表单的现值：写口按 schema 校验合并后的整份，只落盘这里给的键。
    assert.equal(patch.baseUrl, 'http://127.0.0.1:3080', '保存应提交改过的连接地址');
    assert.equal(patch.authPrefix, 'Bearer', '未改动的字段照旧提交现值');
    // 保存成功后重新拉快照：标签保留在配置页，字段显示刚写进去的值。
    await page.waitForFunction(() => document.getElementById('cfg__baseUrl')?.value === 'http://127.0.0.1:3080', null, { timeout: 5000 });
  });

  await test('Agent platform probe reports its conclusion in the overview', async () => {
    await openPlatform('agent:dsh');
    await page.waitForSelector('#platformProbe', { timeout: 5000 });
    await clickWrite('#platformProbe', '/api/platforms/registry/agent/dsh/probe');
    // 探活结论进注册表快照（entry.probe），刷新后由「默认与探活」卡画出来。
    await page.waitForFunction(() => document.querySelector('[data-platform-panel-body]')?.textContent.includes('上次探活通过'), null, { timeout: 5000 });
  });

  await test('Session detail run card saves capability / behavior / permission', async () => {
    await navigate('sessions');
    await page.waitForSelector('#sessionList [data-manage-key="group:100003"]');
    await page.click('#sessionList [data-manage-key="group:100003"]');
    await page.waitForSelector('#detailCapability');
    // 三项都默认跟随：能力档空 = 平台默认，行为 inherit = 平台默认，权限 inherit = 全局默认。
    assert.equal(await page.locator('#detailCapability').inputValue(), '');
    assert.equal(await page.locator('#detailBehavior').inputValue(), 'inherit');
    assert.equal(await page.locator('#detailPermission').inputValue(), 'inherit');
    assert.deepEqual(await page.$$eval('#detailCapability option', (nodes) => nodes.map((node) => node.value)),
      ['', 'chat', 'chat-v2', 'readonly', 'direct'], '能力档选项来自平台声明的能力档');
    assert.ok((await page.locator('#detailCapability option').first().textContent()).includes('跟随平台默认'), '空值写明是平台默认');
    await page.selectOption('#detailCapability', 'chat');
    await page.selectOption('#detailBehavior', 'social-v1');
    await page.selectOption('#detailPermission', 'read-only');
    assert.deepEqual(await clickWrite('#sessionDetailSave', '/api/sessions/group%3A100003/profile', 'PATCH'), {
      capability: 'chat', behavior: 'social-v1', permission: 'read-only',
    }, '只提交改过的三项，不混入其它字段');
    await page.locator('#sessionDetailOverlay [data-modal-close]').first().click();
  });

  await test('Session detail folds the tool intersection and says why each tool is missing', async () => {
    await navigate('sessions');
    await page.waitForSelector('#sessionList [data-manage-key="group:100003"]');
    await page.click('#sessionList [data-manage-key="group:100003"]');
    const card = page.locator('#sessionDetailBody details[data-collapse-id="session-tools"]');
    await card.waitFor({ state: 'attached', timeout: 5000 });
    assert.equal(await card.getAttribute('open'), null, '工具卡默认折叠');
    assert.match(await card.locator(':scope > summary').textContent(), /这个会话能用的工具（\d+）/, '卡头写出可用数量');
    await card.locator(':scope > summary').click();
    const text = await card.textContent();
    // 结论行写出来源：平台声明 ∩ 权限级别（求交在后端算，前端只摆版式）。
    assert.match(text, /平台声明（QQ）[\s\S]*权限「/, `结论行写出求交来源：${text.slice(0, 80)}`);
    assert.ok(await card.locator('[data-table]').count() >= 1, '工具卡用表格组件摆三列');
    const reasons = await card.locator('.tag--warning[title]').evaluateAll((nodes) => nodes.map((node) => node.title));
    assert.ok(reasons.length > 0, '用不了的工具挂上原因');
    assert.ok(reasons.every((reason) => /平台没有声明|默认关闭|权限/.test(reason)), `原因口径统一：${[...new Set(reasons)].join(' / ')}`);
    await page.locator('#sessionDetailOverlay [data-modal-close]').first().click();
  });

  await test('Session detail is three cards with a run conclusion and folded danger', async () => {
    await navigate('sessions');
    await page.waitForSelector('#sessionList [data-manage-key="group:123456789"]');
    await page.click('#sessionList [data-manage-key="group:123456789"]');
    await page.waitForSelector('#detailCapability');
    // 三张常驻卡按「影响它说话的程度」排；关联与危险操作是折叠卡，不算常驻卡。
    assert.deepEqual(await page.$$eval('#sessionDetailBody .session-detail-grid > .detail-card > h4', (nodes) => nodes.map((node) => node.textContent.trim())),
      ['运行', '人格与提示', '唤醒与准入'], '详情只剩三张常驻卡 + 两张折叠卡');
    assert.equal(await page.locator('#detailDisplayName').count(), 0, '显示名不再有表单字段');
    const links = page.locator('#sessionDetailBody details[data-collapse-id="session-links"]');
    const danger = page.locator('#sessionDetailBody details[data-collapse-id="session-danger"]');
    assert.equal(await links.count(), 1, '关联是一张折叠卡');
    assert.equal(await danger.count(), 1, '危险操作是一张折叠卡');
    assert.equal(await links.getAttribute('open'), null, '关联默认收起');
    assert.equal(await danger.getAttribute('open'), null, '危险操作默认收起');
    // 执行体与对端权限档不在会话里复述：正文只在「平台 › 该 Agent 平台 › 能力」。
    assert.equal(await page.locator('#sessionDetailBody [data-detail-form="agent"]').count(), 0, '详情不再挂执行体只读卡');
    const conclusion = await page.locator('#sessionDetailBody .detail-conclusion').textContent();
    assert.match(conclusion, /^生效：能力档 Agent · 只读（.+仅主人私聊）/, `结论行从当前生效档取：${conclusion}`);
    assert.match(conclusion, /· 行为 social-v2 · 权限 工作区读写 · 模型 deepseek-official\/deepseek-flash \/ max$/, `四项都写出来：${conclusion}`);
    await page.locator('#sessionDetailOverlay [data-modal-close]').first().click();
  });

  await test('Session list rename writes the display name through the rename modal', async () => {
    await navigate('sessions');
    await page.waitForSelector('#sessionList [data-rename-key="group:100003"]');
    await page.click('#sessionList [data-rename-key="group:100003"]');
    await page.waitForSelector('#sessionRenameInput');
    assert.equal(await page.locator('#sessionRenameInput').inputValue(), '', '每次都从当前显示名开始改');
    await page.fill('#sessionRenameInput', '开发群');
    assert.deepEqual(await clickWrite('#sessionRenameSave', '/api/session/rename', 'POST'),
      { key: 'group:100003', title: '开发群' }, '改名只交 key 与 title');
    await page.waitForFunction(() => document.querySelector('#sessionList [data-manage-key="group:100003"]')?.closest('tr')?.textContent.includes('开发群'));
  });

  await test('Capability file contracts', async () => {
    // 能力档是 Agent 平台的资产：编辑器在「能力」里，和结论分组同页但不混排。
    await openPlatform('agent:dsh');
    await page.click('[data-platform-tab="capabilities"]');
    await page.waitForSelector('#platformCapabilityList [data-cap-edit]', { timeout: 5000 });
    await page.click('#platformCapabilityList [data-cap-edit]');
    await page.waitForSelector('#platformCapabilityEditor #capabilityLabel', { timeout: 5000 });
    // 效果表：能力档只声明「要什么」，每一行写出当前执行体里承担它的模块与可装结论。
    await page.waitForFunction(
      () => document.querySelectorAll('#capEditorEffects tbody tr').length === 3,
      null, { timeout: 5000 },
    );
    const effectTexts = await page.$$eval('#capEditorEffects tbody tr', (rows) => rows.map((row) => row.textContent));
    assert.ok(effectTexts.some((text) => text.includes('web.access') && text.includes('tool-web') && text.includes('可装')),
      'web.access 由 tool-web 承担，标为可装');
    assert.equal(await page.locator('#capEditorEffects tbody input').count(), 0, '效果表只读：没有勾选框');
    // 执行体工具面：模块清单来自 dsh/tools.yml（8 个模块），同样只读 —— 会话能用到哪一档由权限级别收紧。
    await page.waitForFunction(
      () => document.querySelectorAll('#capEditorAgent tbody tr').length === 8,
      null, { timeout: 5000 },
    );
    assert.equal(await page.locator('#capEditorAgent tbody input').count(), 0, '工具面归执行体声明，能力档里不再勾选');
    const search = page.locator('#capEditorAgent [data-table-search]');
    await search.waitFor({ state: 'visible', timeout: 5000 });
    await search.fill('pwsh');
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('#capEditorAgent tbody tr')].filter((row) => !row.hidden);
      return rows.length === 1 && rows[0].textContent.includes('tool-pwsh');
    }, null, { timeout: 5000 });
    assert.equal(await page.locator('#capabilityLabel').getAttribute('readonly'), '', '内置能力的名称只读');
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/api/runtime/capabilities/chat' && r.request().method() === 'PATCH'),
      page.click('#capabilitySave'),
    ]);
    assert.equal(response.status(), 200, 'PATCH /api/runtime/capabilities/chat should succeed');
    const body = fixture.requests.at(-1)?.body ?? {};
    assert.equal(body.label, '聊天 Agent', '内置名称保持原值');
    assert.deepEqual(body.mcp, { allow: ['*'], tools: { allow: ['*'], deny: [] } }, 'MCP 授权原样写回，通配不收窄');
    assert.deepEqual(body.skills, { allow: ['*'] }, '技能授权原样写回');
    assert.equal(body.tools, undefined, '工具面归执行体声明，能力档不再提交');
    assert.equal(body.effects, undefined, '效果是意图，不在这个面板改');
    assert.equal(body.runtime, undefined, '生效方式只在基本信息卡里明示，不随保存提交');
  });

  await test('Agent platform becomes the default executor only after a successful probe', async () => {
    await openPlatform('agent:acp');
    await page.waitForSelector('#platformSetDefault', { timeout: 5000 });
    const body = await clickWrite('#platformSetDefault', '/api/config/runtime');
    assert.deepEqual(body, { defaultAgent: 'acp' }, '设为默认只提交 Agent 平台 id，不夹带其它配置');
    // 切换只落盘：本进程仍装配 dsh，于是「待重启」同时出现在详情与清单，外加一条可复查的诊断。
    await page.waitForFunction(() => document.querySelector('[data-platform-panel-body]')?.textContent.includes('已设为默认，重启后生效'), null, { timeout: 5000 });
    assert.equal(await page.locator('#platformSetDefault').count(), 0, '已设为默认的平台不再显示同一个按钮');
    // 诊断结论写在本平台的概览里（清单的诊断卡只收 error，这条是 warning）。
    assert.match(await page.textContent('[data-platform-panel-body]'), /active_pending_restart/, '配置面与运行期不一致时给一条诊断');
    // 徽标在清单页：返回后卡片应同时标出待重启与诊断。
    await page.click('[data-detail-back]');
    await page.waitForSelector('[data-platform-view="list"]:not([hidden])');
    assert.equal(await page.locator('[data-tile-id="agent:acp"] .tag').filter({ hasText: '待重启' }).count(), 1, '清单里标出待重启');
    assert.equal(await page.locator('[data-tile-id="agent:acp"] .tag').filter({ hasText: '警告' }).count(), 1, '清单卡片标出诊断结论');
  });

  await test('User instance becomes the default one from the instance card', async () => {
    await openPlatform('user:wx');
    // 概览把这三件事实分开写：条目开关、入站结论、出站实现。
    const overview = await page.textContent('[data-platform-panel-body]');
    assert.match(overview, /已停用/, '停用的实例在概览里写明不会装配');
    assert.match(overview, /插件 transport/, '出站写清楚走的是插件 transport');
    await page.waitForSelector('#platformSetUserDefault', { timeout: 5000 });
    const body = await clickWrite('#platformSetUserDefault', '/api/config/runtime');
    assert.deepEqual(body, { defaultUser: 'wx' }, '设为默认实例只提交实例 id');
    await page.waitForFunction(() => document.querySelector('[data-platform-panel-body]')?.textContent.includes('已设为默认，重启后生效'), null, { timeout: 5000 });
    assert.equal(await page.locator('#platformSetUserDefault').count(), 0, '已设为默认的实例不再显示同一个按钮');
    assert.match(await page.textContent('[data-platform-panel-body]'), /active_pending_restart/, '用户平台的默认实例与运行期不一致时也给一条诊断');
  });

  await test('Role creation, selection, clearing and silent-mode contracts', async () => {
    await navigate('persona');
    // 新建人格走弹窗：人格名 + 提示词编辑器（弹窗关闭后列表里出现新卡）。
    await page.locator('#roleNew').click();
    await page.waitForSelector('#personaEditor.open', { timeout: 5000 });
    await page.locator('#personaName').fill('契约测试角色');
    await page.locator('#personaEditor .cm-content').first().click();
    await page.keyboard.type('温柔、有耐心，回答简洁。');
    const [createRequest, createResponse] = await Promise.all([
      page.waitForRequest(r => new URL(r.url()).pathname === '/api/roles/create' && r.method() === 'POST'),
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/roles/create' && r.request().method() === 'POST'),
      page.locator('#personaSave').click(),
    ]);
    assert.equal(createResponse.status(), 200);
    // 生效方式已搬到「全局配置 › 人格提示词」：保存人格卡不再自带 apply，由后端取全局默认。
    assert.deepEqual(JSON.parse(createRequest.postData() || '{}'), { name: '契约测试角色', content: '温柔、有耐心，回答简洁。' });
    // 设为默认：卡片墙的「设为默认」写统一目录的 /api/personas/default（本地卡 = local:<名字>）。
    const [defaultRequest] = await Promise.all([
      page.waitForRequest(r => new URL(r.url()).pathname === '/api/personas/default' && r.method() === 'POST'),
      page.locator('#roleList .tile').filter({ hasText: '契约测试角色' }).locator('[data-act="default"]').click(),
    ]);
    assert.deepEqual(JSON.parse(defaultRequest.postData() || '{}'), { uid: 'local:契约测试角色' });
    // 清除默认人格走全局配置页的下拉（空选项 = 不挂人格卡）。
    await navigate('config');
    const roleOptions = await page.$$eval('#roleDefaultSelect option', (els) => els.map((el) => el.textContent));
    assert.ok(roleOptions.some((text) => text.includes('（外部')), '默认人格下拉应列出外部人格');
    await page.selectOption('#roleDefaultSelect', '');
    assert.deepEqual(await saveBarWrite('/api/config/role-default'), { value: '' });
    // 手动静默按钮在总览页；这里只校验表单契约与按钮可用，实际写请求由后端测试覆盖。
    await reveal('#silentToggle');
    assert.equal(await page.evaluate(() => document.getElementById('silentToggle').disabled), false);
    assert.equal((await page.textContent('#silentToggle')).trim(), '开启手动静默');
    assert.equal(await page.evaluate(() => document.getElementById('manualSilenceStages').querySelectorAll('input[type="checkbox"]').length), 5);
    assert.deepEqual(await page.evaluate(async () => {
      const res = await fetch('/api/role-mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-console-token': localStorage.getItem('consoleToken') },
        body: JSON.stringify({
          mode: 'silent',
          silent: {
            mode: 'full',
            stages: { passive: true, proactive: true, scheduledAi: true, scheduledText: true, pluginTasks: true },
            adminApplies: false,
            recordMessages: true,
            catchUp: true,
          },
        }),
      });
      return { ok: res.ok, body: await res.json() };
    }), { ok: true, body: { ok: true } });
    assert.deepEqual(await page.evaluate(async () => {
      const res = await fetch('/api/role-mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-console-token': localStorage.getItem('consoleToken') },
        body: JSON.stringify({ mode: 'active' }),
      });
      return { ok: res.ok, body: await res.json() };
    }), { ok: true, body: { ok: true } });
  });

  await test('Admin list save contract', async () => {
    await navigate('config');
    await page.locator('[data-config-section="security"]').click();
    // 字段语义：这是全局唯一的所有者（owner），不是管理员列表里的管理员。
    assert.equal((await page.locator('[data-field-wrap="owner"] .field-label').innerText()).trim(), '所有者地址');
    // 点「添加管理员」必须真的出现一行：表格 rows 只吃单元格数组，直接塞 <tr> 字符串会在有行时抛错。
    await page.locator('#adminAdd').click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#adminTableHost tbody tr').count(), 1, '点「添加管理员」应出现一行');
    assert.equal(await page.locator('[data-admin-field="qq"]').count(), 1, '新行应带管理员地址输入框');
    await page.locator('[data-admin-remove]').click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#adminTableHost tbody tr').count(), 0, '移除后应回到空表');
    await fill('owner', '100001');
    assert.deepEqual(await clickWrite('#wlSave', '/api/whitelist'), { owner: '100001', admins: [] });
    await check('secInterceptNotify', false);
    assert.deepEqual(await saveBarWrite('/api/security'), { interceptNotify: false });
  });

  // 全局准入不能只靠右下角浮层保存：卡片自己有保存按钮，改完当场落盘。
  await test('Global access card saves from its own button', async () => {
    await navigate('config');
    await page.locator('[data-config-section="access"]').click();
    await page.waitForFunction(() => document.getElementById('accessPassiveEntries')?.value.includes('123456789'));
    await page.locator('#accessPassiveEntries').fill('qq:group:123456789\nqq:group:200002');
    const body = await clickWrite('#globalAccessSave', '/api/access', 'PATCH');
    assert.equal(body.passive.mode, 'allow');
    assert.deepEqual(body.passive.entries, ['qq:group:123456789', 'qq:group:200002']);
    await page.waitForFunction(() => /已保存/.test(document.getElementById('globalAccessSaveMsg')?.textContent || ''));
  });

  // 会话弹窗的权限档位必须与全局配置页同一套措辞：四档都来自后端，不再有总开关与限时授权。
  await test('Session permission levels mirror global wording', async () => {
    await navigate('sessions');
    await page.waitForSelector('#sessionList [data-manage-key]');
    await page.locator('#sessionList [data-manage-key]').first().click();
    await page.waitForSelector('#detailPermission');
    const readOptions = () => page.locator('#detailPermission option').evaluateAll((nodes) => nodes.map((node) => ({
      value: node.value,
      label: node.textContent.trim(),
    })));
    const sessionOptions = await readOptions();
    assert.deepEqual(sessionOptions.map((o) => o.value), ['inherit', 'read-only', 'workspace-write', 'full-ask', 'full'], '四档全部可选，inherit 排在最前');
    assert.match(sessionOptions[0].label, /^跟随全局（当前：工作区读写）$/, 'inherit 项的文案带生效档');
    assert.deepEqual(sessionOptions.slice(1).map((o) => o.label), ['只读', '工作区读写', '完全访问 · 每次确认', '完全访问'], '档位措辞与后端 PERMISSION_LABEL 一致');
    await page.locator('#sessionDetailOverlay [data-modal-close]').first().click();

    await navigate('config');
    await page.locator('[data-config-section="security"]').click();
    // 全局默认级别用后端下发的 levels / labels 铺选项：页面不自带第二份档位表。
    await page.waitForFunction(() => document.getElementById('permissionDefault')?.options.length === 4);
    const defaultOptions = await page.locator('#permissionDefault option').evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
    assert.deepEqual(defaultOptions, ['只读', '工作区读写', '完全访问 · 每次确认', '完全访问'], '全局默认级别用同一套标签');
    assert.equal(await page.locator('#permissionDefault').inputValue(), 'read-only', '回填当前默认级别');
    assert.equal(await page.locator('#permissionAllowFull, #permissionTtl').count(), 0, '总开关与限时授权已随权限模型删除');
    // 改一级再存：保存条只在确有未保存修改时才可点。
    await page.locator('#permissionDefault').selectOption('workspace-write');
    assert.deepEqual(await saveBarWrite('/api/config/permission'), { default: 'workspace-write' }, '写口径只有 default 一项');
  });

  // state/ 的 ACL 收紧需要管理员权限，未提权时桥接会明确报告 hardened:false。
  // 控制台必须把这件事**显式**呈现（含可复制的提权命令），而不是让用户以为已经安全；
  // 用户按提示处理后点「重新检测」应当转为成功态。
  await test('Unhardened state directory surfaces a warning with the exact command', async () => {
    await navigate('config');
    await page.locator('[data-config-section="security"]').click();
    await page.waitForFunction(() => document.getElementById('stateDirWarn')?.hidden === false);
    const shown = await page.evaluate(() => ({
      path: document.getElementById('stateDirPath').textContent,
      cmd: document.getElementById('stateDirCmd').textContent,
    }));
    assert.match(shown.path, /state/, '应当显示 state 目录路径');
    assert.match(shown.cmd, /icacls/, '应当给出可复制的提权命令');
    // 只验证按钮确实发起「重新检测」请求，**不**写进/触发 baseline 的写载荷契约
    // （baseline 记录的是改版前控制台的表单写载荷，这条不算表单写）。
    await page.waitForFunction(() => document.getElementById('stateDirReharden') !== null);
    const [request] = await Promise.all([
      page.waitForRequest(r => new URL(r.url()).pathname === '/api/security' && r.method() === 'POST'),
      page.click('#stateDirReharden'),
    ]);
    assert.deepEqual(JSON.parse(request.postData() || '{}'), { rehardenStateDir: true });
    await page.waitForFunction(() => document.getElementById('stateDirWarn')?.hidden === true);
  });

  await test('Global config send-limit contract', async () => {
    await navigate('config');
    await page.locator('[data-config-section="runtime"]').click();
    await fill('sendLimitMin', 7);
    await fill('sendLimitHour', 0);
    assert.deepEqual(await saveBarWrite('/api/config/send-limit'), { maxSendPerMinute: 7, maxSendPerHour: 0 });
    await page.waitForFunction(() => /已保存/.test(document.getElementById('actionDockResults')?.textContent || ''));
  });

  await test('Slang add, search, confirm modal, tab switching and parameter contracts', async () => {
    // 新增走弹窗：先打开，填完再提交。
    await (await reveal('#slangAddOpen')).click();
    for (const [id, value] of Object.entries({ slangContent: '测试词条', slangMeaning: '很棒', slangUsage: '赞美', slangExample: '这个效果很棒。' })) await fill(id, value);
    assert.deepEqual(await clickWrite('#slangAdd', '/api/slang'), { content: '测试词条', meaning: '很棒', usage: '赞美', example: '这个效果很棒。' });
    await (await reveal('.slang-tab[data-slang-tab="confirmed"]')).click();
    // 搜索框在表格组件自带工具栏里（页面不再自己画搜索行）。
    await page.fill('#slangConfirmedList [data-table-search]', '测试词条');
    // 分页/搜索只切行显隐，不删 DOM：断言可见行数。
    assert.equal(await page.locator('#slangConfirmedList tbody tr:not([hidden])').count(), 1, 'Filtered table should show only the matching entry');
    // demo-candidate 已有含义：在「候选词-已研究」栏，不在「待研究」栏
    await (await reveal('.slang-tab[data-slang-tab="candidate"]')).click();
    assert.equal(await page.locator('#slangCandidateList [data-slang-confirm="demo-candidate"]').count(), 0, '有含义的候选不在待研究栏');
    await (await reveal('.slang-tab[data-slang-tab="researched"]')).click();
    await page.locator('[data-slang-confirm="demo-candidate"]').click();
    // 弹窗组件标准结构：头（标题 + 自带关闭）、体（唯一滚动区）、脚（动作按钮）。
    const chrome = await page.evaluate(() => {
      const ov = document.getElementById('slangModalOverlay');
      const panel = ov?.querySelector('.modal[data-modal-panel]');
      const body = panel?.querySelector('.modal-body');
      const foot = panel?.querySelector('.modal-foot');
      const close = panel?.querySelector('.modal-head [data-modal-close]');
      return {
        open: ov?.classList.contains('open'),
        head: !!panel?.querySelector('.modal-head h3'),
        close: !!close,
        bodyScrolls: body ? getComputedStyle(body).overflowY === 'auto' : false,
        footVisible: foot ? foot.getBoundingClientRect().height > 20 : false,
        footInside: foot && panel ? panel.getBoundingClientRect().bottom - foot.getBoundingClientRect().bottom < 2 : false,
      };
    });
    assert.deepEqual(chrome, { open: true, head: true, close: true, bodyScrolls: true, footVisible: true, footInside: true }, 'modal should be header/body/footer with a built-in close button');
    await fill('slangModalMeaning', '感到安慰');
    await fill('slangModalUsage', '轻松聊天');
    await fill('slangModalExample', '有被治愈到。');
    await fill('slangModalRisk', '无');
    await fill('slangModalSources', 'https://example.invalid/offline-source');
    assert.deepEqual(await clickWrite('#slangModalDirectConfirm', '/api/slang/demo-candidate/confirm'), { meaning: '感到安慰', usage: '轻松聊天', example: '有被治愈到。', risk: '无', sources: ['https://example.invalid/offline-source'] });
    await fill('slangExtractMin', 14);
    await fill('slangThresholds', '3，6 12');
    const config = await clickWrite('#slangConfigSave', '/api/slang/config');
    assert.equal(config.extractMinMessages, 14);
    assert.deepEqual(config.inferenceThresholds, [3, 6, 12]);
  });

  await test('Test message and AI notification reach only the mock endpoints', async () => {
    await (await reveal('#tsKind')).selectOption('group');
    await fill('tsId', '123456789');
    await fill('tsMsg', '离线测试，不会发往 QQ。');
    assert.deepEqual(await clickWrite('#tsSend', '/api/test-send'), { kind: 'group', id: '123456789', message: '离线测试，不会发往 QQ。' });
    await (await reveal('#aiNotifyKind')).selectOption('private');
    await fill('aiNotifyId', '100001');
    await fill('aiNotifyMessage', '离线提醒，不会发往 DSH。');
    assert.deepEqual(await clickWrite('#aiNotifySend', '/api/console/notify-ai'), { key: 'private:100001', message: '离线提醒，不会发往 DSH。' });
  });

  if (record) {
    assert(results.every(x => x.ok), 'Cannot record a baseline from a failed suite');
    await writeFile(baselinePath, JSON.stringify(fixture.requests, null, 2) + '\n');
    console.log(`${acceptContracts ? 'Accepted current console contracts' : 'Recorded original API contracts'}: ${baselinePath} (${fixture.requests.length} entries)`);
  } else await test('All submitted payloads exactly match the pre-redesign console baseline', async () => {
    const expected = JSON.parse(await readFile(baselinePath, 'utf8'));
    assert.deepEqual(fixture.requests, expected);
  });

  // 插件详情是子路由：深链直接落到 #plugins/<id>，前进/后退跟得上。
  // 这里会多发两次 GET，所以放在契约基线比对之后。
  await test('Plugin detail restores from a deep link and steps back', async () => {
    await navigate('plugins');
    await page.evaluate(() => { location.hash = '#plugins/demo-plugin/config'; });
    await page.waitForSelector('[data-plugins-view="detail"]:not([hidden]) #cfg__baseUrl', { timeout: 5000 });
    assert.equal(await page.locator('[data-plugin-tab="config"].active').count(), 1, '深链还原到配置标签');
    assert.match(await page.textContent('[data-plugins-view="detail"] .detail-head-main h3'), /演示插件/, '页头写出插件名');
    await page.evaluate(() => history.back());
    await page.waitForSelector('[data-plugins-view="list"]:not([hidden])', { timeout: 5000 });
    assert.equal(await page.locator('[data-plugins-view="detail"]').isHidden(), true, '后退回清单');
    await page.evaluate(() => history.forward());
    await page.waitForSelector('[data-plugins-view="detail"]:not([hidden]) #cfg__baseUrl', { timeout: 5000 });
  });

  // 插件详情页头带完整的插件状态动作：启停 / 重载 / 卸载；与清单卡片同一组接口。
  await test('Plugin detail header carries the state actions and posts them', async () => {
    await navigate('plugins');
    await page.evaluate(() => { location.hash = '#plugins/demo-plugin'; });
    await page.waitForSelector('[data-plugins-view="detail"]:not([hidden]) .detail-head-actions', { timeout: 5000 });
    assert.deepEqual(await page.$$eval('[data-plugin-state]', (nodes) => nodes.map((node) => node.dataset.pluginState)),
      ['disable', 'reload', 'uninstall'], '页头三颗按钮：停用 / 重载 / 卸载');
    assert.match(await page.getAttribute('[data-plugin-state="uninstall"]', 'class'), /\bdanger\b/, '卸载用红边危险按钮');
    await page.click('[data-plugin-state="disable"]');
    await page.waitForSelector('[data-plugin-state="enable"]', { timeout: 5000 });
    const recorded = await (await fetch(`${fixture.url}/__fixture/requests`)).json();
    assert.ok(recorded.requests.some((entry) => entry.method === 'POST' && entry.path === '/api/plugins/demo-plugin/disable'),
      '点停用应 POST /api/plugins/demo-plugin/disable');
    assert.equal(await page.locator('[data-plugin-state="uninstall"]').count(), 1, '状态变了按钮不丢');
  });

  // 会话详情的「运行」卡要写出平台默认行为（不能只显示一个破折号）；
  // “人格”下拉每次打开都重读目录——人格页新建卡后回来立刻能看到，不需要刷新页面。
  // 这段带写请求，所以必须放在契约基线比对之后。
  await test('Session detail shows the platform default behavior and re-reads the persona catalog', async () => {
    const openDetail = async () => {
      await navigate('sessions');
      await page.waitForSelector('#sessionList [data-manage-key]');
      await page.locator('#sessionList [data-manage-key]').first().click();
      await page.waitForSelector('#detailBehavior');
    };
    const closeDetail = () => page.locator('#sessionDetailOverlay [data-modal-close]').first().click();
    const personaNames = () => page.locator('#detailPersonaName option').allTextContents();

    await openDetail();
    const behaviorLabel = await page.locator('#detailBehavior option').first().textContent();
    assert.match(behaviorLabel, /跟随平台默认（当前：social-v2）/, '跟随项要写出平台默认行为，不能只显示一个破折号');
    const before = await personaNames();
    await closeDetail();

    const created = '会话下拉回归卡';
    await navigate('persona');
    await page.waitForSelector('#roleNew');
    await page.locator('#roleNew').click();
    await page.waitForSelector('#personaEditor.open', { timeout: 5000 });
    await page.locator('#personaName').fill(created);
    await page.locator('#personaEditor .cm-content').first().click();
    await page.keyboard.type('仅用于下拉刷新回归');
    const [createRes] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/api/roles/create' && r.request().method() === 'POST'),
      page.locator('#personaSave').click(),
    ]);
    assert.equal(createRes.status(), 200);
    await page.waitForFunction((n) => [...document.querySelectorAll('#roleList .tile strong')].some((el) => el.textContent === n), created);

    await openDetail();
    const after = await personaNames();
    assert.equal(before.some((label) => label.includes(created)), false, '新建前不应该已经在这张卡');
    assert.ok(after.some((label) => label.includes(created)), '新建的人格卡不用刷新页面就该出现在会话下拉里');

    // 收拾现场：回人格页删掉这张回归卡，不影响后面的用例。
    await closeDetail();
    await navigate('persona');
    await page.locator('#roleList .tile').filter({ hasText: created }).locator('[data-act="edit"]').click();
    await page.waitForSelector('#personaEditor.open', { timeout: 5000 });
    await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/api/roles/delete'),
      page.locator('#personaDelete').click(),
    ]);
  });

  await test('Memory page: session modal with tabs, entry add/edit/delete and limits', async () => {
    await navigate('memory');
    await page.waitForSelector('#memorySessionTable [data-mem-session-add]');
    await page.click('#memorySessionTable [data-mem-session-add]');
    await page.waitForFunction(() => document.getElementById('memSessionAddModal')?.classList.contains('open'));
    await fill('memSessionKey', 'group:123456789');
    await page.click('#memSessionAddSave');
    await page.waitForSelector('#memorySessionTable [data-mem-open]');
    await page.click('#memorySessionTable [data-mem-open]');
    await page.waitForFunction(() => document.getElementById('memMemoryModal')?.classList.contains('open'));
    await page.waitForFunction(() => (document.getElementById('memoryLocalTable')?.textContent || '').includes('话题为空'));
    assert.equal(await page.inputValue('#memLimitMaxTopics'), '50', '存储上限应从配置回填');

    await page.click('#memoryLocalTable [data-mem-add]');
    await page.waitForFunction(() => document.getElementById('memEntryView') && !document.getElementById('memEntryView').hidden);
    await fill('memEntryContent', '周末一起看书');
    await page.click('#memEntrySave');
    await page.waitForFunction(() => (document.getElementById('memoryLocalTable')?.textContent || '').includes('周末一起看书'));

    await page.click('#memoryLocalTable [data-mem-edit]');
    await page.waitForFunction(() => document.getElementById('memEntryView') && !document.getElementById('memEntryView').hidden);
    await fill('memEntryContent', '周末一起看展');
    await page.click('#memEntrySave');
    await page.waitForFunction(() => (document.getElementById('memoryLocalTable')?.textContent || '').includes('周末一起看展'));

    await page.click('#memoryLocalTabs [data-mem-cat="rule"]');
    await page.click('#memoryLocalTable [data-mem-add]');
    await page.waitForFunction(() => document.getElementById('memEntryView') && !document.getElementById('memEntryView').hidden);
    await fill('memEntryContent', '本群不聊工作');
    await page.click('#memEntrySave');
    await page.waitForFunction(() => (document.getElementById('memoryLocalTable')?.textContent || '').includes('本群不聊工作'));

    await page.click('#memoryLocalTable [data-mem-del]');
    await page.waitForFunction(() => !(document.getElementById('memoryLocalTable')?.textContent || '').includes('本群不聊工作'));
    assert.match(await page.textContent('#memLocalMsg'), /已删除/);

    await page.click('#memMemoryModal [data-modal-close]');
    await page.waitForFunction(() => !document.getElementById('memMemoryModal')?.classList.contains('open'));

    await page.click('#memorySessionTable [data-mem-session-del]');
    await page.waitForFunction(() => (document.getElementById('memorySessionTable')?.textContent || '').includes('还没有会话记忆'));
  });

  if (!original) await test('Token usage panel renders totals, per-conversation and per-turn cost', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigate('overview');
    await page.waitForFunction(() => document.getElementById('metricUsageTokens')?.textContent !== '—');

    // 四个总览指标
    assert.match((await page.textContent('#metricUsageCost')).trim(), /^¥\d/, '总花费应渲染成货币金额');
    assert.match((await page.textContent('#metricUsageTokens')).trim(), /\d/, '累计 token 应有数值');
    assert.match((await page.textContent('#metricUsageHitRate')).trim(), /%$/, '缓存命中率应为百分比');
    assert.match((await page.textContent('#metricUsagePerTurn')).trim(), /^¥\d/, '平均每轮应为货币金额');

    // 按会话（群 / 私聊 / 内部）明细
    const conversations = await page.textContent('#usageConversations');
    assert.match(conversations, /group:123456789/, '按会话表应列出群会话');
    assert.match(conversations, /private:100001/, '按会话表应列出私聊会话');
    assert.match(conversations, /internal:黑话学习/, '按会话表应列出内部（黑话学习）用量');
    assert.match(conversations, /¥/, '按会话表应显示花费列');
    assert.match(conversations, /未命中输入/, '按会话表应拆分缓存命中 / 未命中');

    // 会话名是链接：点它跳到「会话与审批」，并把搜索框预填成这个 key
    await page.click('#usageConversations [data-open-session="group:123456789"]');
    await page.waitForFunction(() => location.hash === '#sessions');
    await page.waitForFunction(
      () => (document.querySelector('[data-sessions-panel="sessions"] [data-table-search]')?.value || '') === 'group:123456789',
    );
    assert.equal(
      await page.inputValue('[data-sessions-panel="sessions"] [data-table-search]'),
      'group:123456789',
      '跳转后应把会话 key 预填进搜索框',
    );
    await navigate('overview');
    await page.waitForFunction(() => (document.getElementById('usageConversations')?.textContent || '').includes('group:123456789'));

    // 三张表统一由表格组件渲染（工具栏 / 分页都在组件内）
    assert.equal(await page.locator('#usageConversations [data-table]').count(), 1, '按会话表应使用表格组件');
    assert.equal(await page.locator('#usageConversations [data-pager]').count(), 1, '按会话表应带分页');
    assert.equal(await page.locator('#usageRecent [data-table]').count(), 1, '最近流水应使用表格组件');

    // 价目表不在总览页：这里只剩一个跳转按钮，夹在「刷新」与「清空账本」之间，样式与刷新一致。
    const actionButtons = await page.$$eval('#section-usage-summary [data-usage-fields="actions"] button',
      (nodes) => nodes.map((node) => ({ id: node.id, cls: node.className })));
    assert.deepEqual(actionButtons.map((b) => b.id), ['usageRefresh', 'usagePricingJump', 'usageClear'], '价目表按钮在刷新与清空账本之间');
    assert.equal(actionButtons[1].cls, actionButtons[0].cls, '价目表按钮与刷新按钮同一样式');
    // 默认模型有价目：状态行照旧提示自动同步（没匹配上时才变成灰色提示）。
    await page.waitForFunction(() => document.getElementById('usageMsg')?.textContent.includes('每 3 秒自动同步'));

    // 下钻逐轮：会话选择器就在工具栏里，选中即加载（不再有「加载」按钮）
    await page.selectOption('#usageTurns [data-filter="key"]', 'group:123456789');
    await page.waitForFunction(() => /#\d+/.test(document.getElementById('usageTurns')?.textContent || ''));
    const turns = await page.textContent('#usageTurns');
    assert.match(turns, /#42/, '逐轮明细应显示轮次编号');
    assert.match(turns, /步数/, '逐轮明细应显示步数');
    assert.match(turns, /空闲|高峰|跨时段/, '逐轮明细应标注峰谷时段');
    assert.match(turns, /¥/, '逐轮明细应显示每轮花费');
    assert.equal(await page.locator('#usageTurns [data-pager]').count(), 1, '逐轮明细应带分页');

    // 会话筛选与逐轮表同步
    assert.equal(await page.inputValue('#usageTurns [data-filter="key"]'), 'group:123456789', '筛选器应跟随选中的会话');

    // 实时流水
    assert.match(await page.textContent('#usageRecent'), /group:123456789|private:100001/, '最近流水应列出采样');
  });

  // 价目表：跟着全局配置里的默认模型匹配，没有平台 / 模型切换；单价在格子里改，
  // 高峰口径走「操作 › 编辑高峰」的弹窗，写进本机覆盖层。
  // 这段带写请求，所以放在契约基线比对之后。
  if (!original) await test('Pricing card follows the default model and only writes price overrides', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigate('overview');
    await page.waitForFunction(() => document.getElementById('usageMsg')?.textContent.includes('每 3 秒自动同步'));
    const costBefore = (await page.textContent('#metricUsageCost')).trim();

    // 总览「价目表」按钮 → 「全局配置 › 行为与模型」的最后一张卡（切标签 + 滚动都由路由负责）。
    await page.click('#usagePricingJump');
    await page.waitForFunction(() => location.hash.startsWith('#config'));
    await page.waitForFunction(() => document.querySelector('[data-config-section="runtime"]')?.classList.contains('active'));
    await page.waitForFunction(() => {
      const card = document.getElementById('section-pricing');
      if (!card) return false;
      const top = card.getBoundingClientRect().top;
      return top >= -2 && top < 200;
    }, null, { timeout: 5000 });

    const card = '#section-pricing';
    assert.match(await page.textContent(card), /价目表/, '最后一张卡是价目表');
    assert.match(await page.textContent(`${card} [data-pricing-agent]`), /DSH/, '平台自动取活动 Agent 平台');
    assert.match(await page.textContent(`${card} [data-pricing-model]`), /deepseek-flash/, '模型自动取全局配置里的默认模型');
    assert.equal(await page.locator(`${card} [data-pricing-table] [data-table]`).count(), 1, '价目表用表格组件渲染');
    assert.equal(await page.locator(`${card} [data-pricing-table] [data-table-search]`).count(), 1, '工具栏带搜索');
    assert.equal(await page.locator(`${card} [data-pricing-table] [data-table-refresh]`).count(), 1, '工具栏带刷新');
    assert.equal(await page.locator(`${card} [data-price-row="deepseek-flash"] [data-price-peak]`).count(), 1, '高峰时段有编辑入口（操作列）');
    assert.equal(await page.locator(`${card} [data-price-row="deepseek-flash"] .row-actions`).count(), 1, '操作列用表格统一的 .row-actions');
    assert.equal(await page.locator(`${card} [data-pricing-scope]`).count(), 0, '不再有平台 / 模型的手动切换');

    // 默认模型命中申报价：结论行、来源与峰谷口径都只读展示。
    assert.match(await page.textContent(`${card} [data-pricing-status]`), /已匹配「DeepSeek-V4\.1-Flash」的价目/);
    assert.match(await page.textContent(`${card} [data-pricing-source]`), /平台申报/);
    const flashRow = `${card} [data-price-row="deepseek-flash"]`;
    assert.equal(await page.inputValue(`${flashRow} [data-price-key="output"]`), '4', '输入框回填申报的输出价');
    assert.match(await page.textContent(flashRow), /工作日 09:00–12:00、14:00–18:00 ×2/, '峰谷列只展示口径');
    assert.match(await page.textContent(`${card} [data-pricing-policy]`), /平台申报的高峰口径.*「操作」里单独改/, '口径提示写明可以按模型覆盖');

    // 账本里出现过、表里没有的模型：单独一行，并说清楚已经记了多少 token。
    const gapRow = `${card} [data-price-row="deepseek-chat-0715"]`;
    assert.match(await page.textContent(gapRow), /待补价目/, '没有价目的模型标出来');
    assert.match(await page.textContent(gapRow), /账本已记 51\.2k token/, '说明这部分 token 已经记着');
    assert.match(await page.textContent(`${card} [data-pricing-gap]`), /deepseek-chat-0715/);

    // 给它补上单价：只提交这个模型与改过的字段（没改的字段回落申报）。
    await page.fill(`${gapRow} [data-price-key="cacheMiss"]`, '2');
    await page.fill(`${gapRow} [data-price-key="output"]`, '8');
    const [saved] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/api/pricing' && r.request().method() === 'PUT'),
      page.click(`${card} #pricingSave`),
    ]);
    assert.equal(saved.status(), 200);
    assert.deepEqual(fixture.requests.at(-1)?.body, { models: { 'deepseek-chat-0715': { cacheMiss: 2, output: 8 } } }, '只提交补价的那个模型');
    await page.waitForFunction(() => document.getElementById('pricingSaveMsg')?.textContent.includes('已保存覆盖（1 个模型）'));
    await page.waitForFunction(() => (document.querySelector('#section-pricing [data-pricing-source]')?.textContent || '').includes('本机覆盖'));
    assert.doesNotMatch(await page.textContent(gapRow), /待补价目/, '补价后这一行不再缺价');

    // 已经记着的 token 按新表重算：总览的总花费与缺价提示当场变化，不需要重新记账。
    await navigate('overview');
    await page.waitForFunction((prev) => (document.getElementById('metricUsageCost')?.textContent || '').trim() !== prev, costBefore, { timeout: 5000 });
    assert.match((await page.textContent('#metricUsageCost')).trim(), /^¥\d/, '补价后总花费仍是金额');
    assert.doesNotMatch(await page.textContent('#usageConversations'), /没有价目/, '补价后不再提示缺价');

    // 恢复申报：删掉本机覆盖，金额与缺价提示一起回到原样。
    await navigate('config');
    await page.locator('[data-config-section="runtime"]').click();
    // 确认框由测试的 init 脚本同步点掉，所以监听必须先于触发器落地。
    const resetPromise = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/pricing' && r.request().method() === 'DELETE');
    await page.click(`${card} #pricingReset`);
    const reset = await resetPromise;
    assert.equal(reset.status(), 200);
    await page.waitForFunction(() => (document.querySelector('#section-pricing [data-pricing-source]')?.textContent || '').includes('平台申报'));
    assert.equal(await page.inputValue(`${gapRow} [data-price-key="output"]`), '', '恢复后这一行又回到没有价目');
    assert.match(await page.textContent(gapRow), /待补价目/);
    await navigate('overview');
    await page.waitForFunction((prev) => (document.getElementById('metricUsageCost')?.textContent || '').trim() === prev, costBefore, { timeout: 5000 });

    // 另一侧：默认模型换成没价目的模型 → 同步那行换成灰色提示，卡片直说没匹配上。
    await fetch(`${fixture.url}/__fixture/pricing`, { method: 'POST', body: JSON.stringify({ defaultModel: 'deepseek-chat-0715' }) });
    try {
      await navigate('overview');
      await page.waitForFunction(() => /价目表/.test(document.getElementById('usageMsg')?.textContent || ''), null, { timeout: 6000 });
      const hint = await page.evaluate(() => ({ text: document.getElementById('usageMsg').textContent, cls: document.getElementById('usageMsg').className }));
      assert.doesNotMatch(hint.text, /每 3 秒自动同步/, '缺价时不再盖着「自动同步」说一切正常');
      assert.match(hint.text, /deepseek-chat-0715/, '提示点名没价的那个模型');
      assert.match(hint.text, /价目表/, '提示引导去配价目表');
      assert.equal(hint.cls, 'meta', '提示是灰色说明（不用成功 / 错误态）');

      await page.click('#usagePricingJump');
      await page.waitForFunction(() => (document.querySelector('#section-pricing [data-pricing-status]')?.textContent || '').includes('价目表里没有'));
      assert.match(await page.textContent(`${card} [data-pricing-status]`), /价目表里没有「deepseek-chat-0715」/, '卡片直说默认模型没匹配上');
      assert.equal(await page.locator(`${card} [data-price-row="deepseek-chat-0715"]`).count(), 1, '没匹配上时默认模型也占一行，就地可补价');
      assert.equal(await page.inputValue(`${gapRow} [data-price-key="output"]`), '', '没价目时单价框是空的，不显示一个假 0');
      assert.equal(await page.inputValue(`${flashRow} [data-price-key="output"]`), '4', '其他模型的价目不受影响');
    } finally {
      await fetch(`${fixture.url}/__fixture/pricing`, { method: 'POST', body: JSON.stringify({ defaultModel: 'deepseek-flash' }) });
    }
    await navigate('overview');
    await page.waitForFunction(() => document.getElementById('usageMsg')?.textContent.includes('每 3 秒自动同步'));
  });

  // 手动加模型与撤覆盖：申报里没有的 id 只能靠本机层报价；整段写入让「移除」不需要额外接口。
  if (!original) await test('Pricing card adds a model by hand and drops a local override', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigate('config');
    await page.locator('[data-config-section="runtime"]').click();
    const card = '#section-pricing';
    await page.waitForFunction(() => document.querySelectorAll('#section-pricing [data-price-row]').length >= 2);

    // 「添加模型」先给一行空白：id 可编辑，单价等填，保存前不落盘。
    await page.click(`${card} #pricingAdd`);
    const draft = `${card} [data-price-draft]`;
    assert.equal(await page.locator(draft).count(), 1, '点一下多一行草稿');
    await page.fill(`${draft} [data-price-id]`, 'deepseek-pro-legacy');
    await page.fill(`${draft} [data-price-key="cacheMiss"]`, '4.5');
    await page.fill(`${draft} [data-price-key="output"]`, '13.5');
    const [added] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/api/pricing' && r.request().method() === 'PUT'),
      page.click(`${card} #pricingSave`),
    ]);
    assert.equal(added.status(), 200);
    assert.deepEqual(fixture.requests.at(-1)?.body, { models: { 'deepseek-pro-legacy': { cacheMiss: 4.5, output: 13.5 } } }, '只提交新增那一行的单价');
    const addedRow = `${card} [data-price-row="deepseek-pro-legacy"]`;
    await page.waitForSelector(addedRow);
    assert.match(await page.textContent(addedRow), /本机覆盖/, '新增的模型标本机覆盖');
    assert.equal(await page.locator(draft).count(), 0, '保存后草稿行变成正式行');

    // 高峰口径：弹窗里用项目的时间组件与复选框组改，确定后表格当场显示，保存时随单价一起提交。
    await page.click(`${addedRow} [data-price-peak]`);
    await page.waitForSelector('#pricingPeakOverlay.open');
    assert.equal(await page.locator('#pricingPeakOverlay .time-field-text').count(), 4, '初值回填平台申报的两段（时间组件：开始 + 结束）');
    assert.equal(await page.locator('#pricingPeakOverlay input[name="pricingPeakWeekdays"]').count(), 7, '星期是一组可多选的复选框');
    // 清掉旧的两段，再添一段 10:00–12:00；星期只留周一，倍数 1.8。
    while (await page.locator('#pricingPeakOverlay [data-peak-del]').count()) {
      await page.click('#pricingPeakOverlay [data-peak-del] >> nth=0');
    }
    await page.click('#pricingPeakOverlay [data-peak-add]');
    await page.fill('#pricingPeakOverlay .time-field-text >> nth=0', '10:00');
    await page.fill('#pricingPeakOverlay .time-field-text >> nth=1', '12:00');
    for (const day of ['2', '3', '4', '5']) await page.uncheck(`#pricingPeakOverlay input[name="pricingPeakWeekdays"][value="${day}"]`);
    await page.fill('#pricingPeakOverlay #pricingPeakMultiplier', '1.8');
    await page.click('#pricingPeakOverlay [data-peak-apply]');
    assert.equal(await page.locator('#pricingPeakOverlay.open').count(), 0, '确定后弹窗关闭');
    assert.match(await page.textContent(addedRow), /周一 10:00–12:00 ×1\.8/, '表格当场显示新高口径');
    assert.match(await page.textContent(addedRow), /本机口径/, '本机改过的口径有标记，不与申报混在一起');
    const [withPeak] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/api/pricing' && r.request().method() === 'PUT'),
      page.click(`${card} #pricingSave`),
    ]);
    assert.equal(withPeak.status(), 200);
    assert.deepEqual(fixture.requests.at(-1)?.body, {
      models: { 'deepseek-pro-legacy': { cacheMiss: 4.5, output: 13.5, policy: { peakWindows: [[10, 12]], peakWeekdays: [1], peakMultiplier: 1.8 } } },
    }, '口径随单价一起提交（policy）');
    await page.waitForFunction(() => document.getElementById('pricingSaveMsg')?.textContent.includes('已保存覆盖'));

    // 行内「移除」：整段写入时这条不在补丁里，就等于撤掉。
    await page.click(`${addedRow} [data-price-drop="deepseek-pro-legacy"]`);
    const [dropped] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/api/pricing' && r.request().method() === 'PUT'),
      page.click(`${card} #pricingSave`),
    ]);
    assert.equal(dropped.status(), 200);
    assert.deepEqual(fixture.requests.at(-1)?.body, { models: {} }, '撤掉本机覆盖也要提交（否则撤不掉）');
    assert.equal(await page.locator(addedRow).count(), 0, '撤掉后这一行不再出现');
  });

  if (!original) await test('Token usage trend chart renders bars, tiers and range/metric switching', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await navigate('overview');
    await page.waitForFunction(() => document.querySelectorAll('#usageChart svg rect.usage-bar-off, #usageChart svg rect.usage-bar-peak').length > 0);

    // 柱：空闲与高峰两类都要画出来（fixture 按真实峰谷规则生成）
    const bars = await page.evaluate(() => ({
      off: document.querySelectorAll('#usageChart svg rect.usage-bar-off').length,
      peak: document.querySelectorAll('#usageChart svg rect.usage-bar-peak').length,
      mixed: document.querySelectorAll('#usageChart svg rect.usage-bar-mixed').length,
      grid: document.querySelectorAll('#usageChart svg line.usage-grid').length,
      axis: document.querySelectorAll('#usageChart svg text.usage-axis').length,
    }));
    assert(bars.off > 0 && bars.peak > 0, `走势图应画出空闲与高峰两类柱（${JSON.stringify(bars)}）`);
    assert.equal(bars.grid, 3, '应有 3 条横向网格线');
    assert(bars.axis >= 4, '应有纵轴刻度与横轴时间标签');

    // 悬停提示：每个柱都要带 <title>，能读出该格的花费与时段
    const titles = await page.$$eval('#usageChart svg title', (nodes) => nodes.map((n) => n.textContent));
    assert(titles.length > 0, '每个格子都应带悬停提示');
    assert(titles.some((t) => /花费：¥/.test(t)), '提示里应包含该格花费');
    assert(titles.some((t) => /时段：高峰/.test(t)), '提示里应标注高峰时段');

    // 汇总行与"图外还有多少"的说明
    assert.match(await page.textContent('#usageChartTotal'), /^¥\d/, '应显示窗口内合计花费');
    assert.match(await page.textContent('#usageChartHint'), /每格 \d+ 分钟/, '应说明每格代表多长时间');
    assert.match(await page.textContent('#usageChartNote'), /不在上图里/, '应说明时间轴之外还有多少花费（避免图合计 ≠ 总花费引起误解）');

    // 切范围：重新请求并按生产同一套桶宽阶梯换粒度
    // （24h→30min / 3d→2h / 7d→6h / 30d→24h，桶数始终 ≤ 48）
    await page.click('#usageChartControls [data-usage-hours="168"]');
    await page.waitForFunction(() => /每格 \d+ 分钟/.test(document.getElementById('usageChartHint')?.textContent || '')
      && document.querySelector('#usageChartControls [data-usage-hours="168"]')?.classList.contains('active'));
    assert.match(await page.textContent('#usageChartHint'), /每格 360 分钟/, '切到 7 天后桶宽变成 6 小时');

    // 粗桶会把高峰窗口整个包在中间 → 必须标『跨时段』（细桶边界对齐则不会，这也是真账本的行为）
    await page.click('#usageChartControls [data-usage-hours="720"]');
    await page.waitForFunction(() => /每格 \d+ 分钟/.test(document.getElementById('usageChartHint')?.textContent || '')
      && document.querySelector('#usageChartControls [data-usage-hours="720"]')?.classList.contains('active'));
    assert.match(await page.textContent('#usageChartHint'), /每格 1440 分钟/, '切到 30 天后桶宽变成 24 小时');
    const coarse = await page.evaluate(() => ({
      mixed: document.querySelectorAll('#usageChart svg rect.usage-bar-mixed').length,
      buckets: document.querySelectorAll('#usageChart svg rect.usage-hit').length,
    }));
    assert(coarse.mixed > 0, `跨时段的粗桶应标为「跨时段」（${JSON.stringify(coarse)}）`);
    assert(coarse.buckets <= 48, `30 天视图的桶数仍受上限约束（实得 ${coarse.buckets}）`);

    // 切纵轴：不重新请求，直接重画成 token
    await page.click('#usageChartControls [data-usage-metric="tokens"]');
    assert.match(await page.textContent('#usageChartTotal'), /token/, '切到 token 后合计显示 token 数');
    assert.equal(await page.getAttribute('#usageChartControls [data-usage-metric="tokens"]', 'class'), 'tag active', 'token 按钮应处于选中态');
    await page.click('#usageChartControls [data-usage-metric="cost"]');
    assert.match(await page.textContent('#usageChartTotal'), /^¥\d/, '切回花费');

    // 回到 24 小时，避免影响后续断言
    await page.click('#usageChartControls [data-usage-hours="24"]');
    await page.waitForFunction(() => document.querySelector('#usageChartControls [data-usage-hours="24"]')?.classList.contains('active'));
  });

  if (!original) await test('Mobile and tablet layouts have no document-level horizontal overflow', async () => {
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      for (const view of views) {
        await navigate(view);
        const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
        assert(dimensions.document <= dimensions.viewport + 1, `${width}px / ${view}: ${JSON.stringify(dimensions)}`);
        if (artifacts && width === 390 && ['overview', 'config', 'slang'].includes(view)) {
          await mkdir(resolve(artifacts), { recursive: true });
          await page.screenshot({ path: resolve(artifacts, `mobile-${view}.png`), fullPage: true, animations: 'disabled' });
        }
      }
    }
  });

  if (!original) await test('Dark mode toggles, persists across reload and stays overflow-free', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const snapshot = () => page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      stored: localStorage.getItem('qq-console-theme'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(document.body).color,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      toggle: document.getElementById('themeToggle').getAttribute('aria-pressed'),
    }));
    const light = await snapshot();
    assert.equal(light.theme, 'light', '测试环境系统偏好为浅色，默认应为浅色');
    await page.locator('#themeToggle').click();
    const dark = await snapshot();
    assert.equal(dark.theme, 'dark');
    assert.equal(dark.stored, 'dark', '主题选择需要写入 localStorage');
    assert.equal(dark.toggle, 'true', 'aria-pressed 需要反映当前主题');
    assert.equal(dark.scheme, 'dark', 'color-scheme 需同步，滚动条与表单控件才会跟随');
    assert.notEqual(dark.bodyBg, light.bodyBg, 'body 背景色必须真的改变');
    assert.notEqual(dark.text, light.text, '正文颜色必须真的改变');
    const ratio = await page.evaluate(() => {
      const parse = value => value.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number);
      const luminance = rgb => { const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const background = luminance(parse(getComputedStyle(document.body).backgroundColor));
      const heading = luminance(parse(getComputedStyle(document.querySelector('h1')).color));
      return (Math.max(background, heading) + 0.05) / (Math.min(background, heading) + 0.05);
    });
    assert(ratio >= 7, `深色下标题与背景对比度不足：${ratio.toFixed(2)}`);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('statusText')?.textContent !== '正在连接…');
    assert.equal((await snapshot()).theme, 'dark', '刷新后应保持深色');
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
      assert(dimensions.document <= dimensions.viewport + 1, `深色 ${width}px 出现横向溢出：${JSON.stringify(dimensions)}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#themeToggle').click();
    assert.equal((await snapshot()).theme, 'light', '应能切回浅色');
  });

  if (!original) await test('Console follows the system preference when no theme was chosen', async () => {
    const systemDark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark', serviceWorkers: 'block' });
    await systemDark.route('**/*', route => new URL(route.request().url()).origin === fixture.url ? route.continue() : route.abort('blockedbyclient'));
    const systemPage = await systemDark.newPage();
    systemPage.on('pageerror', error => errors.push(error.message));
    await systemPage.goto(fixture.url);
    await systemPage.waitForFunction(() => document.getElementById('statusText')?.textContent !== '正在连接…');
    assert.equal(await systemPage.evaluate(() => document.documentElement.dataset.theme), 'dark', '系统偏好深色时应默认深色');
    await systemDark.close();
  });

  if (!original) await test('Reduced-motion preference disables decorative motion', async () => {
    const calm = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await calm.route('**/*', route => new URL(route.request().url()).origin === fixture.url ? route.continue() : route.abort('blockedbyclient'));
    const calmPage = await calm.newPage();
    calmPage.on('pageerror', error => errors.push(error.message));
    await calmPage.goto(fixture.url);
    await calmPage.waitForFunction(() => document.getElementById('statusText')?.textContent !== '正在连接…');
    const motion = await calmPage.evaluate(() => ({
      decor: getComputedStyle(document.querySelector('.bg-decor'), '::before').animationName,
      page: getComputedStyle(document.querySelector('[data-page="overview"]')).animationName,
      transition: getComputedStyle(document.querySelector('button')).transitionDuration,
    }));
    assert.equal(motion.decor, 'none', '背景动效应在 reduced-motion 下关闭');
    assert.equal(motion.page, 'none', '页面切换动画应在 reduced-motion 下关闭');
    assert.equal(motion.transition, '0s', '过渡应在 reduced-motion 下关闭');
    await calm.close();
  });

  if (!original) await test('外部人格：读取提示词 → 编辑保存 → 另存为内部人格', async () => {
    await navigate('persona');
    await page.waitForFunction(
      () => [...document.querySelectorAll('#roleList .tile')].some((el) => el.textContent.includes('星苒')),
      null,
      { timeout: 8000 },
    );
    const card = page.locator('#roleList .tile').filter({ hasText: '星苒' }).first();
    assert.match(await card.textContent(), /外部 · soulkit/);
    await card.locator('[data-act="edit"]').click();
    await page.waitForSelector('#personaEditor.open', { timeout: 5000 });
    await page.waitForFunction(() => (document.getElementById('personaText')?.value || '').length > 0);
    // 外部卡的人名归插件管理：只读，只能改提示词。
    assert.equal(await page.locator('#personaName').evaluate((el) => el.readOnly), true);
    await page.locator('#personaSaveAsBlock').waitFor({ state: 'visible' });
    await page.locator('#personaEditor .cm-content').first().click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('雨停了，天台上风很大。');
    const [updateRequest, updateResponse] = await Promise.all([
      page.waitForRequest(r => new URL(r.url()).pathname === '/api/personas/update' && r.method() === 'POST'),
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/personas/update' && r.request().method() === 'POST'),
      page.locator('#personaSave').click(),
    ]);
    assert.equal(updateResponse.status(), 200);
    const updateBody = JSON.parse(updateRequest.postData() || '{}');
    assert.equal(updateBody.uid, 'soulkit:星苒');
    assert.match(updateBody.text, /雨停了/);
    // 另存为内部：名字来自弹窗字段（默认「星苒-内部」）。
    await page.waitForFunction(
      () => [...document.querySelectorAll('#roleList .tile')].some((el) => el.textContent.includes('星苒')),
      null,
      { timeout: 8000 },
    );
    await page.locator('#roleList .tile').filter({ hasText: '星苒' }).first().locator('[data-act="edit"]').click();
    await page.waitForSelector('#personaEditor.open', { timeout: 5000 });
    await page.locator('#personaSaveAsName').fill('星苒内部');
    const [saveAsRequest, saveAsResponse] = await Promise.all([
      page.waitForRequest(r => new URL(r.url()).pathname === '/api/persona/external/save-as-role'),
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/persona/external/save-as-role'),
      page.locator('#personaSaveAs').click(),
    ]);
    assert.equal(saveAsResponse.status(), 200);
    assert.equal(JSON.parse(saveAsRequest.postData() || '{}').as, '星苒内部');
    await page.waitForFunction(
      () => [...document.querySelectorAll('#roleList .tile strong')].some((el) => el.textContent === '星苒内部'),
      null,
      { timeout: 8000 },
    );
  });

  if (!original) await test('人格管理：新建 → 载入编辑 → 保存修改 → 删除', async () => {
    await navigate('persona');
    const created = '回归人格A';
    const namesInList = () => page.locator('#roleList .tile strong').allTextContents();
    await page.locator('#roleNew').click();
    await page.waitForSelector('#personaEditor.open', { timeout: 5000 });
    await page.locator('#personaName').fill(created);
    await page.locator('#personaEditor .cm-content').first().click();
    await page.keyboard.type('回归人格A 用于回归测试');
    const [createRes] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/roles/create' && r.request().method() === 'POST'),
      page.locator('#personaSave').click(),
    ]);
    assert.equal(createRes.status(), 200);
    await page.waitForFunction((n) => [...document.querySelectorAll('#roleList .tile strong')].some((el) => el.textContent === n), created);
    // 点卡片打开编辑：人格名回填、提示词载入。
    await page.locator('#roleList .tile').filter({ hasText: created }).locator('[data-act="edit"]').click();
    await page.waitForSelector('#personaEditor.open', { timeout: 5000 });
    await page.waitForFunction(() => (document.getElementById('personaText')?.value || '').includes('用于回归测试'));
    assert.equal(await page.locator('#personaName').inputValue(), created);
    await page.locator('#personaEditor .cm-content').first().click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('回归人格A 已修改');
    const [updateRes] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/roles/update' && r.request().method() === 'POST'),
      page.locator('#personaSave').click(),
    ]);
    assert.equal(updateRes.status(), 200);
    // 删除（确认框由全局 dialog handler 接受）。
    await page.waitForFunction((n) => [...document.querySelectorAll('#roleList .tile strong')].some((el) => el.textContent === n), created);
    await page.locator('#roleList .tile').filter({ hasText: created }).locator('[data-act="edit"]').click();
    await page.waitForSelector('#personaEditor.open', { timeout: 5000 });
    const [deleteRes] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/roles/delete' && r.request().method() === 'POST'),
      page.locator('#personaDelete').click(),
    ]);
    assert.equal(deleteRes.status(), 200);
    await page.waitForFunction((n) => ![...document.querySelectorAll('#roleList .tile strong')].some((el) => el.textContent === n), created);
    assert.ok((await namesInList()).length >= 1);
  });


  if (!original) await test('人格提示词：上限在注入块页管理，全局配置只留生效方式', async () => {
    await navigate('config');
    await page.locator('[data-config-section="runtime"]').click();
    assert.equal(await page.locator('#personaInjectMax').count(), 0, '注入上限已移到注入块页，全局配置不应再有输入框');
    const hint = await page.locator('[data-field-wrap="personaSaveApply"]').textContent();
    assert.match(hint, /注入块/, '全局配置要说明上限改去哪管');
    await page.locator('input[name="personaSaveApply"][value="immediate"]').check();
    const body = await saveBarWrite('/api/roles/limit');
    assert.equal(body.saveApply, 'immediate');
    assert.equal(body.maxInjectChars, undefined, '全局配置不再提交上限');
    await page.waitForFunction(() => /已保存/.test(document.getElementById('actionDockResults')?.textContent || ''));
    await page.locator('input[name="personaSaveApply"][value="nextWake"]').check();
    await saveBarWrite('/api/roles/limit');

    // 注入块页：人格卡作为虚拟块，开关与上限都在这里。
    await navigate('prompt-blocks');
    await page.waitForFunction(() => !!document.querySelector('[data-block-max="core-persona"]'), null, { timeout: 8000 });
    assert.equal(await page.locator('[data-block-enabled="core-persona"]').count(), 1, '人格卡也要能给开关');
    // 注入块表要能按槽位 / 来源筛选；人格卡虚拟块单独成一类。
    assert.equal(await page.locator('#pbTable [data-filter="slot"]').count(), 1, '应有槽位筛选');
    assert.equal(await page.locator('#pbTable [data-filter="source"]').count(), 1, '应有来源筛选');
    await page.selectOption('#pbTable [data-filter="source"]', 'persona');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#pbTable tbody tr:not([hidden])').count(), 1, '来源=人格卡应只剩一行');
    assert.equal(await page.locator('[data-block-max="core-persona"]').count(), 1);
    await page.selectOption('#pbTable [data-filter="source"]', '');
    await page.waitForTimeout(150);
    assert.match(await page.locator('#pbSummaryRow').textContent(), /人格卡注入上限/);
    const input = page.locator('[data-block-max="core-persona"]');
    const previous = await input.inputValue();
    // 保存后 load() 会重绘表格：等这次 GET 回来，否则下一次点击会落在旧的 DOM 上。
    const saveBlocks = async () => {
      const [req] = await Promise.all([
        page.waitForRequest((r) => r.url().includes('/api/config/promptBlocks') && r.method() !== 'GET'),
        page.waitForResponse((r) => r.url().endsWith('/api/prompt-blocks') && r.request().method() === 'GET'),
        page.evaluate(() => document.getElementById('pbSave').click()),
      ]);
      await page.waitForTimeout(200);
      return req.postDataJSON();
    };
    // 表格可能正在重绘：直接写 DOM 再触发 change，避免 Playwright 的可见性等待。
    await input.evaluate((el, next) => {
      el.value = next;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, '9000');
    const saved = await saveBlocks();
    assert.equal(saved.promptBlocks['core-persona'].maxChars, 9000, '上限应写进 core-persona 块');

    // 关掉人格卡：载荷带 enabled:false，摘要卡片直接提示「已关闭」。
    await page.locator('[data-block-enabled="core-persona"]').click();
    const off = await saveBlocks();
    assert.equal(off.promptBlocks['core-persona'].enabled, false, '关掉人格卡要写进 enabled');
    await page.waitForFunction(() => /人格卡已关闭/.test(document.getElementById('pbSummaryRow')?.textContent || ''), null, { timeout: 5000 });
    assert.match(await page.locator('#pbTable tbody tr[data-filter-source="persona"]').textContent(), /已关闭/, '关闭态直接标在行里');

    // 开回来并还原上限，别把关闭状态和测试值留给后面的用例。
    await page.locator('[data-block-enabled="core-persona"]').click();
    await page.locator('[data-block-max="core-persona"]').evaluate((el, next) => {
      el.value = next;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, previous);
    const back = await saveBlocks();
    assert.equal(back.promptBlocks['core-persona'].enabled, true, '开关能改回去');
    await page.waitForFunction(() => !/人格卡已关闭/.test(document.getElementById('pbSummaryRow')?.textContent || ''), null, { timeout: 5000 });
  });

  if (!original) await test('平台模型卡：提供方 / 模型 / 思考强度取自平台目录，第三方先确认再写', async () => {
    await openPlatform('agent:dsh');
    await page.click('[data-platform-tab="config"]');
    await page.waitForSelector('#platformModelMount #platformModelProvider', { timeout: 5000 });
    await page.waitForFunction(() => document.getElementById('platformModelProvider')?.options.length > 1);
    // 已配置的提供方 / 模型原样回填；档位中文名来自声明面，选项来自实时目录。
    assert.equal(await page.locator('#platformModelProvider').inputValue(), 'deepseek-official');
    assert.equal(await page.locator('#platformModel').inputValue(), 'deepseek-flash');
    const efforts = async () => page.locator('#platformModelEffort option').evaluateAll((nodes) => nodes.map((n) => n.value));
    assert.deepEqual(await efforts(), ['off', 'low', 'high', 'max'], `档位应来自平台目录，实际 ${(await efforts()).join(',')}`);
    assert.equal(await page.locator('#platformModelEffort').inputValue(), 'max', '已配置的档位应回填');
    assert.match(await page.locator('#platformModelEffort option:checked').textContent(), /最高/, '档位名用声明里的中文');
    // 换成第三方提供方：模型联动、无档位模型置灰、提示第三方（会话内容会发给它）。
    await page.locator('#platformModelProvider').selectOption('example-cloud');
    assert.equal(await page.locator('#platformModel').inputValue(), 'example-chat');
    assert.equal(await page.locator('#platformModelEffort').isDisabled(), true, '无档位模型的强度下拉置灰');
    assert.match(await page.locator('#platformModelNotices').textContent(), /第三方提供方/);
    await page.locator('#platformModel').selectOption('example-reasoner');
    assert.deepEqual(await efforts(), ['minimal', 'medium', 'xhigh'], '档位跟着模型变');
    // 切到第三方提供方要再确认一次；写口与「配置」同一个（PATCH …/config）。
    // 确认框由测试的 init 脚本自动点掉，这里挂观察器记下弹过什么，再等同一个写请求。
    await page.evaluate(() => {
      window.__boxTexts = [];
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof Element && node.querySelector('[data-box-confirm]')) window.__boxTexts.push(node.textContent);
          }
        }
      }).observe(document.body, { childList: true });
    });
    const savedPromise = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/platforms/registry/agent/dsh/config' && r.request().method() === 'PATCH');
    await page.click('#platformModelSave');
    const saved = await savedPromise;
    assert.equal(saved.status(), 200);
    assert.deepEqual(saved.request().postDataJSON(), { provider: 'example-cloud', model: 'example-reasoner', reasoningEffort: 'medium', vision: 'auto' });
    const boxes = await page.evaluate(() => window.__boxTexts);
    assert.ok(boxes.some((text) => text.includes('切换第三方提供方')), `切第三方应先弹确认，实际 ${JSON.stringify(boxes)}`);
    // 写成功后重拉注册表：卡片重画成刚写进去的那一份配置。
    await page.waitForFunction(() => document.getElementById('platformModelProvider')?.value === 'example-cloud' && document.getElementById('platformModel')?.value === 'example-reasoner');
    // 改回第一方：切回来不需要确认。
    await page.locator('#platformModelProvider').selectOption('deepseek-official');
    await page.locator('#platformModel').selectOption('deepseek-flash');
    await page.locator('#platformModelEffort').selectOption('max');
    const restoredPromise = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/platforms/registry/agent/dsh/config' && r.request().method() === 'PATCH');
    await page.click('#platformModelSave');
    const restored = await restoredPromise;
    assert.equal(restored.status(), 200);
    const boxesAfter = await page.evaluate(() => window.__boxTexts.length);
    assert.equal(boxesAfter, boxes.length, '切回第一方不再弹确认');
    await page.waitForFunction(() => document.getElementById('platformModelProvider')?.value === 'deepseek-official' && document.getElementById('platformModel')?.value === 'deepseek-flash');
  });

  if (!original) await test('平台模型卡：实时目录不可用时按声明清单铺选项，保存成功并回 warning', async () => {
    const control = await fetch(`${fixture.url}/__fixture/model-catalog`, { method: 'POST', body: JSON.stringify({ down: true }) });
    assert.equal((await control.json()).down, true);
    try {
      await openPlatform('agent:dsh');
      await page.click('[data-platform-tab="config"]');
      await page.waitForSelector('#platformModelMount #platformModelProvider', { timeout: 5000 });
      // 目录有 30 秒缓存（上一条用例刚读过）：必须先点「刷新」拿到这一次的结论。
      await page.click('#platformModelRefresh');
      await page.waitForFunction(() => /声明清单/.test(document.getElementById('platformModelNotices')?.textContent || ''), null, { timeout: 5000 });
      // 提供方是实时目录的概念（声明面没有这一维）：保持原值并置灰；模型与档位按声明清单铺。
      assert.equal(await page.locator('#platformModelProvider').isDisabled(), true, '没有实时目录时提供方不可改');
      assert.equal(await page.locator('#platformModelProvider').inputValue(), 'deepseek-official', '提供方保持原值');
      assert.equal(await page.locator('#platformModel').isDisabled(), false, '模型按声明清单可选');
      assert.deepEqual(await page.locator('#platformModel option').evaluateAll((nodes) => nodes.map((node) => node.value)),
        ['deepseek-flash', 'deepseek-v4-pro'], '模型选项来自 platform 声明的 modelCatalog');
      assert.deepEqual(await page.locator('#platformModelEffort option').evaluateAll((nodes) => nodes.map((node) => node.value)),
        ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], '档位按声明清单的全集铺，不再只给 3 个内置档');
      assert.match(await page.textContent('#platformModelNotices'), /声明清单[\s\S]*保存时不校验/);
      // 保存成功后状态位要带上服务端的 warning（否则界面分不清「校验过了」与「根本没校」）。
      await page.evaluate(() => {
        window.__modelMsg = [];
        const target = document.getElementById('platformModelMsg');
        new MutationObserver(() => window.__modelMsg.push(target.textContent)).observe(target, { childList: true, characterData: true, subtree: true });
      });
      await page.locator('#platformModel').selectOption('deepseek-v4-pro');
      await page.locator('#platformModelEffort').selectOption('high');
      const savedPromise = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/platforms/registry/agent/dsh/config' && r.request().method() === 'PATCH');
      await page.click('#platformModelSave');
      const saved = await savedPromise;
      assert.equal(saved.status(), 200, '目录不可用不阻塞保存');
      assert.deepEqual(saved.request().postDataJSON(), { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high', vision: 'auto' });
      assert.deepEqual((await saved.json()).warnings, ['模型未校验：目录不可用']);
      await page.waitForFunction(() => (window.__modelMsg || []).some((text) => /模型未校验/.test(text)), null, { timeout: 5000 });
      // 改回原值，别把演示目录的状态留给后面的用例。
      await page.waitForFunction(() => document.getElementById('platformModel')?.value === 'deepseek-v4-pro');
      await page.locator('#platformModel').selectOption('deepseek-flash');
      await page.locator('#platformModelEffort').selectOption('max');
      const backPromise = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/platforms/registry/agent/dsh/config' && r.request().method() === 'PATCH');
      await page.click('#platformModelSave');
      assert.equal((await backPromise).status(), 200);
    } finally {
      await fetch(`${fixture.url}/__fixture/model-catalog`, { method: 'POST', body: JSON.stringify({ down: false }) });
    }
  });

  await test('Form component: typed values, depends, cross-field validation, switch and reset', async () => {
    await page.goto(`${fixture.url}/console/components/form/demo.html`);
    await page.waitForFunction(() => Boolean(window.__demoForm));
    const result = await page.evaluate(() => {
      const form = window.__demoForm;
      const presetWrap = document.querySelector('[data-field-wrap="demoPreset"]');
      const out = {};
      out.fieldCount = document.querySelectorAll('[data-field-wrap]').length;
      out.values = form.getValues();
      out.initialMode = form.getValue('demoMode');
      out.presetVisibleOnReserved2 = !presetWrap.hidden;
      form.setValues({ demoMode: 'chat' });
      out.presetVisibleOnChat = !presetWrap.hidden;
      document.querySelector('input[name="demoMode"][value="reserved2"]').click();
      out.presetVisibleAfterClick = !presetWrap.hidden;
      out.modeAfterClick = form.getValue('demoMode');
      form.setValues({ demoText: '' });
      out.requiredError = form.validate().errors.demoText ?? null;
      form.setValues({ demoText: '星苒', demoNumber: 999 });
      out.rangeError = form.validate().errors.demoNumber ?? null;
      form.setValues({ demoNumber: 20, demoQuiet: { from: '08:00', to: '08:00' } });
      out.equalRangeError = form.validate().errors.demoQuiet ?? null;
      form.setValues({ demoQuiet: { from: '23:00', to: '07:00' } });
      out.overnightOk = form.validate().ok;
      out.switchBefore = form.getValue('demoSwitch');
      document.querySelector('[role="switch"][data-field="demoSwitch"]').click();
      out.switchAfter = form.getValue('demoSwitch');
      out.dirtyBeforeReset = form.dirty();
      form.reset();
      out.dirtyAfterReset = form.dirty();
      out.textareaMono = document.getElementById('demoTextarea').className;
      return out;
    });
    assert.equal(result.fieldCount, 17, '演示页应渲染 17 个字段');
    assert.equal(typeof result.values.demoNumber, 'number');
    assert.deepEqual(result.values.demoKinds, ['text', 'image']);
    assert.deepEqual(result.values.demoQuiet, { from: '23:00', to: '07:00' });
    assert.equal(result.values.demoSwitch, true);
    assert.equal(result.initialMode, 'reserved2');
    assert.equal(result.presetVisibleOnReserved2, false, 'reserved2 下预设字段应隐藏');
    assert.equal(result.presetVisibleOnChat, true, 'chat 下预设字段应显示');
    assert.equal(result.presetVisibleAfterClick, false, '点回 reserved2 应立即隐藏');
    assert.equal(result.modeAfterClick, 'reserved2');
    assert.equal(result.requiredError, '不能为空');
    assert.equal(result.rangeError, '不能大于 200');
    assert.equal(result.equalRangeError, '开始与结束不能相同');
    assert.equal(result.overnightOk, true, '跨零点的时间段应通过校验');
    assert.equal(result.switchBefore, true);
    assert.equal(result.switchAfter, false);
    assert.equal(result.dirtyBeforeReset, true);
    assert.equal(result.dirtyAfterReset, false);
    assert.equal(result.textareaMono, 'field-textarea-mono');
    await page.goto(`${fixture.url}#overview`);
    await page.waitForSelector('#metricSessions');
  });

  // P5：执行体与对端权限档的正文只在「平台 › 该 Agent 平台 › 能力」；
  // 会话详情只保留「换过平台才给重开」这一条依赖 /agent 的行为。
  if (!original) await test('会话详情不再复述执行体与对端权限档', async () => {
    await navigate('sessions');
    await page.waitForSelector('#sessionList [data-manage-key="private:100001"]');
    await page.click('#sessionList [data-manage-key="private:100001"]');
    await page.waitForSelector('#detailCapability');
    assert.equal(await page.locator('#sessionDetailBody [data-detail-form="agent"]').count(), 0, '详情不再挂执行体只读卡');
    // 会话里只留一句指路：正文（工具面、对端权限档、注入方式）在平台的能力页。
    assert.match(await page.locator('#sessionDetailBody').textContent(),
      /对端权限档、注入方式）在「平台 › 该 Agent 平台 › 能力」/, '会话把对端权限档指回平台 › 能力');
    assert.equal(await page.locator('.detail-danger [data-detail-agent-reopen]').count(), 0, '实例没换过就不给重开按钮');
    await page.locator('#sessionDetailOverlay [data-modal-close]').first().click();

    // 正文那座只读面（注入通道 / 对端权限档）在平台的「能力 › 原始声明」里。
    await openPlatform('agent:dsh');
    await page.click('[data-platform-tab="capabilities"]');
    const raw = page.locator('[data-platform-panel-body] details[data-collapse-id="platform-raw-agent-dsh"]');
    await raw.waitFor({ state: 'attached', timeout: 5000 });
    assert.equal(await raw.getAttribute('open'), null, '原始声明默认折叠');
    await raw.locator(':scope > summary').click();
    const matrix = await raw.textContent();
    assert.match(matrix, /提示注入通道/, '注入通道在平台的「能力」里读');
    assert.match(matrix, /对端权限档/, '对端权限档在平台的「能力」里读');
  });

  if (!original) await test('全局配置：Agent 平台一张卡管默认平台与模型，动作是刷新 / 探活 / 保存', async () => {
    await navigate('config');
    await page.waitForFunction(() => document.getElementById('agentDefaultSelect')?.options.length >= 2);
    // 前面的用例可能已经把默认平台改成 acp：这里跟着当前值走，结束时换回原来那个。
    const initial = await page.locator('#agentDefaultSelect').inputValue();
    assert.ok(['dsh', 'acp'].includes(initial), `默认 Agent 平台应来自注册表，实际 ${initial}`);
    // 运行期事实不再单占一行只读：换默认的后果写在选择框提示里，当下连通结论交给「探活」。
    assert.equal(await page.locator('#agentRunningReadout').count(), 0, '卡片里没有「当前运行」只读行');
    // 一张卡：平台选择与模型控件同属 #section-agent，不再拆出第二张「模型与思考强度」。
    assert.equal(await page.locator('#section-agent-model').count(), 0, '不再拆出单独的模型卡');
    assert.equal(await page.locator('#section-agent #agentModelMount').count(), 1, '模型控件住在同一张卡里');
    // 动作条三个按钮，探活排在刷新后面且同一档样式。
    const cardButtons = await page.locator('#section-agent .form-actions button')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
    assert.deepEqual(cardButtons, ['刷新', '探活', '保存'], '一处动作条：刷新 / 探活 / 保存');
    assert.equal(await page.locator('#agentProbe').getAttribute('class'),
      await page.locator('#agentRefresh').getAttribute('class'), '探活与刷新同一档样式');
    assert.equal(await page.locator('#platformModelMount, #dshProviderSelect, #section-dsh').count(), 0, '全局配置页没有平台详情那份模型卡');
    await page.selectOption('#agentDefaultSelect', 'dsh');
    await page.waitForSelector('#agentModelMount #agentModelProvider', { timeout: 5000 });
    await page.waitForFunction(() => document.getElementById('agentModelProvider')?.options.length > 1);
    assert.equal(await page.locator('#agentModelProvider').inputValue(), 'deepseek-official', '回填该平台自己的配置');
    assert.equal(await page.locator('#agentModel').inputValue(), 'deepseek-flash');

    // 探活：问一次选中的平台，只把结论写进状态位（与平台详情页同一个写口）。
    const [probed] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/api/platforms/registry/agent/dsh/probe'),
      page.click('#agentProbe'),
    ]);
    assert.equal(probed.request().method(), 'POST', '探活走 POST .../probe');
    assert.equal(probed.status(), 200);
    await page.waitForFunction(() => (document.getElementById('agentMsg')?.textContent || '').includes('探活通过'));
    assert.equal(await page.locator('#agentProbe').isEnabled(), true, '探活完按钮恢复可用');
    assert.equal(await page.locator('#agentSave').isEnabled(), true, '探活不会把保存留在禁用态');

    // 没声明 models 能力位的平台：只少模型控件，卡片与三个按钮都还在。
    await page.selectOption('#agentDefaultSelect', 'acp');
    await page.waitForFunction(() => !document.getElementById('agentModelProvider'));
    assert.equal(await page.locator('#section-agent').isVisible(), true, '没有模型能力时卡片本身不消失');
    assert.equal(await page.locator('#agentProbe').isVisible(), true, '没有模型可配时探活仍然可用');
    await page.selectOption('#agentDefaultSelect', initial);

    // 保存只改一半也能收场：先切到另一个平台写盘，再换回来。
    const other = initial === 'dsh' ? 'acp' : 'dsh';
    const saveAgentCard = async (agentId) => {
      await page.selectOption('#agentDefaultSelect', agentId);
      const written = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/config/runtime' && r.method() === 'POST');
      await page.click('#agentSave');
      assert.deepEqual((await written).postDataJSON(), { defaultAgent: agentId }, '保存把配置面的默认平台写盘');
    };

    await saveAgentCard(other);
    await page.waitForFunction((value) => (document.getElementById('agentMsg')?.textContent || '')
      .includes('已把默认 Agent 平台改为') && document.getElementById('agentDefaultSelect')?.value === value, other);
    assert.match(await page.locator('#agentMsg').textContent(), /重启桥接后生效/, '换默认只落盘，提示里写明要重启');

    // 收拾现场：恢复进入本用例前的配置面，别把「待重启」状态改了。
    await saveAgentCard(initial);
    await page.waitForFunction((value) => {
      const text = document.getElementById('agentMsg')?.textContent || '';
      return document.getElementById('agentDefaultSelect')?.value === value && /^已/.test(text);
    }, initial);
  });

  if (artifacts) {
    await mkdir(resolve(artifacts), { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const view of original ? ['overview'] : ['overview', 'config', 'persona', 'slang', 'operations']) {
      await navigate(view);
      await page.screenshot({ path: resolve(artifacts, `${original ? 'original' : 'desktop'}-${view}.png`), fullPage: true, animations: 'disabled' });
    }
    if (!original) {
      await page.locator('#themeToggle').click();
      for (const view of ['overview', 'config']) {
        await navigate(view);
        await page.screenshot({ path: resolve(artifacts, `dark-${view}.png`), fullPage: true, animations: 'disabled' });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await navigate('overview');
      await page.screenshot({ path: resolve(artifacts, 'dark-mobile-overview.png'), fullPage: true, animations: 'disabled' });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.locator('#themeToggle').click();
    }
  }
  await test('No JavaScript errors, unknown API routes or external requests', async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(fixture.unknownRequests, []);
    assert.deepEqual(blockedRequests, []);
  });
} finally {
  if (browser) await browser.close();
  await fixture.close();
  if (artifacts) {
    await mkdir(resolve(artifacts), { recursive: true });
    await writeFile(resolve(artifacts, 'test-results.json'), JSON.stringify({ original, results, requests: fixture.requests, errors, blockedRequests }, null, 2) + '\n');
  }
}
const failed = results.filter(x => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; ${fixture.requests.length} isolated mock writes.`);
if (failed.length) process.exitCode = 1;
