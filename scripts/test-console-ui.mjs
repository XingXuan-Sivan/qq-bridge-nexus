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
const views = ['overview', 'config', 'sessions', 'persona', 'plugins', 'skills', 'mcp', 'behaviors', 'slang', 'memory', 'scheduler', 'operations', 'platforms', 'plans'];
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
async function test(name, fn) {
  const start = Date.now();
  try { await fn(); results.push({ name, ok: true, durationMs: Date.now() - start }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false, error: error.message, durationMs: Date.now() - start }); console.error(`FAIL ${name}: ${error.message}`); }
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
    await page.waitForSelector('[data-plugins-view="detail"]:not([hidden]) #cfg__baseUrl', { timeout: 5000 });
    assert.equal(await page.locator('#cfg__baseUrl').inputValue(), 'http://127.0.0.1:3110');
    assert.equal(await page.locator('#cfg__timeoutMs').inputValue(), '1200');
    assert.equal(await page.locator('#pluginConfigTest').count(), 1, '配置区应有测试按钮');
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

  await test('默认运行方案挂在用户平台条目上，行为档案在平台详情', async () => {
    await hydrate('config');
    assert.equal(await page.locator('[data-config-section="behavior"]').count(), 0);
    // 默认方案不是全局配置项：它按用户平台（实例）各一份，字段在平台详情 › 配置里。
    assert.equal(await page.locator('#runtimeDefaultSelect').count(), 0, '全局配置不再有默认方案下拉');

    await openPlatform('user:qq');
    await page.click('[data-platform-tab="config"]');
    await page.waitForSelector('#platformDefaultPlan', { timeout: 5000 });
    await page.waitForFunction(() => document.getElementById('platformDefaultPlan')?.options.length >= 2);
    assert.equal(await page.locator('#platformDefaultPlan').inputValue(), 'social-v2', '下拉回填条目上的默认方案');
    await page.selectOption('#platformDefaultPlan', 'chat');
    const patch = await clickWrite('#platformConfigSave', '/api/platforms/registry/user/qq/config', 'PATCH');
    assert.equal(patch.defaultPlan, 'chat', '默认方案随条目保存一起提交');

    // 行为档案是用户平台的子资源：在「平台 › 详情 › 行为」里改，不再有独立整页。
    await page.click('[data-platform-tab="behaviors"]');
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

  await test('Plans page keeps no switch control', async () => {
    await navigate('plans');
    await page.waitForSelector('#planSummary', { timeout: 5000 });
    // 方案切换卡已删除：全局只保留「默认方案」（在全局配置），会话可单独覆盖。
    assert.equal(await page.locator('#planSwitch, #planDefaultSelect').count(), 0, '方案页不再有切换控件');
    assert.equal(await page.locator('#runtimeSwitch, #runtimePlan').count(), 0, '旧方案切换控件已随 pages/runtime 删除');
  });

  await test('Platform detail merges behavior prompt into one save', async () => {
    await openPlatform('user:qq');
    await page.click('[data-platform-tab="behaviors"]');
    await reveal('#behaviorFormSave');
    assert.equal(await page.locator('#behaviorPromptSave').count(), 0, '提示词卡不再有独立保存按钮');
    // 平台话术只在另一个标签里；行为标签里不应再出现它。
    assert.equal(await page.locator('#platformPromptCard').count(), 0, '行为标签不再混入平台话术卡');
    await page.waitForSelector('#behaviorPromptCard .prompt-card-body', { timeout: 5000 });
    assert.ok(await page.locator('#behaviorPromptCard [data-prompt-edit], #behaviorPromptCard [data-prompt-save]').count() > 0, '提示词卡有编辑/保存按钮');
  });

  await test('Platform detail voice tab owns the prompt card', async () => {
    await openPlatform('user:qq');
    await page.click('[data-platform-tab="voice"]');
    await page.waitForSelector('#platformPromptCard .prompt-card-body', { timeout: 5000 });
    assert.equal(await page.locator('#platformSave').count(), 0, '平台话术卡不再自带独立保存按钮');
    assert.ok(await page.locator('#platformPromptCard [data-prompt-edit]').count() > 0, '平台提示词卡有编辑按钮');
    assert.ok(await page.locator('[data-platform-panel-body] [data-table]').count() > 0, '平台工具走表格组件');
  });

  await test('Platforms page lists both sides and hides the clean diagnostics card', async () => {
    await navigate('platforms');
    await page.waitForSelector('[data-tile-id="user:qq"]', { timeout: 5000 });
    // 两侧平台都列在折叠分组的卡片网格里；诊断为空时汇总卡不占地方（fixture 的 diagnostics: []）。
    assert.equal(await page.locator('[data-tile-id="user:qq"]').count(), 1, '用户平台在清单里');
    assert.equal(await page.locator('[data-tile-id="user:wx"]').count(), 1, '第二条用户实例也在清单里');
    assert.equal(await page.locator('[data-tile-id="agent:dsh"]').count(), 1, 'Agent 平台在清单里');
    assert.equal(await page.locator('[data-tile-id="agent:acp"]').count(), 1, '第二个 Agent 平台也在清单里');
    assert.equal(await page.locator('#platformDiagnosticsCard').count(), 0, '没有诊断时不渲染诊断卡');
    assert.equal(await page.locator('[data-platform-list] .tile--interactive').count(), 4, '每条注册的平台都是一张可点的卡片');
    assert.equal(await page.locator('#platformGroup-user, #platformGroup-agent').count(), 2, '两侧各一个折叠分组');
    // 条目徽标挂在卡片上：停用的实例不该看起来像在跑。
    const wx = page.locator('[data-tile-id="user:wx"]');
    assert.equal(await wx.locator('.tag').filter({ hasText: '已停用' }).count(), 1, '停用的实例在清单里标出');
    assert.equal(await page.locator('[data-tile-id="user:qq"] .tag').filter({ hasText: '已接管' }).count(), 1, '在跑的实例标出入站结论');
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

  await test('Plans page editor contracts', async () => {
    await navigate('plans');
    await page.click('#planNew');
    await page.waitForSelector('#planEditor .modal', { timeout: 5000 });
    await page.fill('#planEditId', 'my-agent');
    await page.fill('#planEditLabel', '我的 Agent');
    // 方案不绑用户平台，默认跟随全局 Agent 平台；钉具体 id 只在需要时（下拉只列声明了能力档的平台）。
    assert.equal(await page.locator('#planEditPlatform').count(), 0, '用户侧平台字段已从方案里移除');
    assert.deepEqual(await page.$$eval('#planEditAgentPlatform option', (nodes) => nodes.map((node) => node.value)), ['auto', 'dsh']);
    assert.equal(await page.locator('#planEditAgentPlatform').inputValue(), 'auto', '新建方案默认 auto');
    assert.equal(await page.locator('#runtimeEditAgent').count(), 0, '旧 runtime 编辑器 id 已随 pages/runtime 删除');
    await page.selectOption('#planEditTools', 'chat');
    await page.selectOption('#planEditBehavior', 'social-v2');
    await page.selectOption('#planEditAudience', 'owner');
    await page.fill('#planEditNote', '带人格进群');
    assert.deepEqual(await clickWrite('#planEditSave', '/api/plans'), {
      id: 'my-agent', label: '我的 Agent', agentPlatform: 'auto',
      capability: 'chat', behavior: 'social-v2', audience: 'owner', note: '带人格进群',
    });
  });

  await test('Capability file contracts', async () => {
    // 能力档是 Agent 平台的资产：只有声明了能力档的 Agent 平台才有「能力」标签。
    await openPlatform('agent:dsh');
    await page.click('[data-platform-tab="capabilities"]');
    await page.waitForSelector('#platformCapabilityList [data-cap-edit]', { timeout: 5000 });
    await page.click('#platformCapabilityList [data-cap-edit]');
    await page.waitForSelector('#platformCapabilityEditor #capabilityLabel', { timeout: 5000 });
    // 平台工具表分页展示，先用搜索把 sendPoke 筛出来再勾选。
    const search = page.locator('#capEditorPlatform [data-table-search]');
    await search.waitFor({ state: 'visible', timeout: 5000 });
    await search.fill('sendPoke');
    await page.waitForSelector('#platformCapabilityEditor [data-cap-platform="sendPoke"]', { state: 'attached' });
    assert.equal(await page.locator('#capabilityLabel').getAttribute('readonly'), '', '内置能力的名称只读');
    await page.click('[data-cap-platform="sendPoke"]');
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/api/runtime/capabilities/chat' && r.request().method() === 'PATCH'),
      page.click('#capabilitySave'),
    ]);
    assert.equal(response.status(), 200, 'PATCH /api/runtime/capabilities/chat should succeed');
    const body = fixture.requests.at(-1)?.body ?? {};
    assert.equal(body.label, '聊天 Agent', '内置名称保持原值');
    assert.equal(body.tools?.platform?.sendPoke, false, '取消勾选的平台工具要写成 false');
    assert.equal(body.tools?.platform?.sendMessage, true, '其余平台工具保持 true');
    assert.equal(body.tools?.agent, undefined, 'Agent 模块由预设定，不再随能力保存');
    assert.equal(body.safety, undefined, '安全补充字段已删除，不再提交');
    assert.equal(body.tools?.visible, undefined, '可见集不再直接提交，由能力文件推导');
    assert.equal(body.sandbox, undefined, '沙箱不再由能力预设承载');
  });

  await test('Agent platform becomes the default executor only after a successful probe', async () => {
    await openPlatform('agent:acp');
    await page.waitForSelector('#platformSetDefault', { timeout: 5000 });
    const body = await clickWrite('#platformSetDefault', '/api/config/runtime');
    assert.deepEqual(body, { defaultAgent: 'acp' }, '设为默认只提交 Agent 平台 id，不夹带默认方案');
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

  // 会话弹窗的权限档位必须与全局配置页同一套措辞；full 档只在总开关打开时出现。
  await test('Session permission levels mirror global wording and hide full until enabled', async () => {
    await navigate('sessions');
    await page.waitForSelector('#sessionList [data-manage-key]');
    await page.locator('#sessionList [data-manage-key]').first().click();
    await page.waitForSelector('#detailPermission');
    const readOptions = () => page.locator('#detailPermission option').evaluateAll((nodes) => nodes.map((node) => ({
      value: node.value,
      label: node.textContent.trim(),
    })));
    let options = await readOptions();
    assert.deepEqual(options.map((o) => o.value), ['inherit', 'read-only', 'workspace-write', 'full-ask'], '总开关关闭时不应出现 full 档');
    assert.ok(options.every((o) => o.label !== 'inherit'), '不应出现裸 inherit 选项');
    assert.match(options[0].label, /跟随全局（当前：只读（read-only））/);
    assert.match(options[3].label, /完全访问 · 每次确认（qq-full-ask）/);
    await page.locator('#sessionDetailOverlay [data-modal-close]').first().click();

    await navigate('config');
    await page.locator('[data-config-section="security"]').click();
    // 全局配置页的「默认级别」同样按总开关算档位：关着没有 full，打开后补上，选中值不被冲掉。
    const defaultOptions = () => page.locator('#permissionDefault option').evaluateAll((nodes) => nodes.map((node) => node.value));
    await page.waitForFunction(() => document.getElementById('permissionDefault')?.options.length >= 3);
    assert.deepEqual(await defaultOptions(), ['read-only', 'workspace-write', 'full-ask'], '总开关关闭时「默认级别」也没有 full 档');
    await check('permissionAllowFull', true);
    await page.waitForFunction(() => document.getElementById('permissionDefault')?.options.length === 4);
    assert.deepEqual(await defaultOptions(), ['read-only', 'workspace-write', 'full-ask', 'full'], '总开关打开后 full 档出现在下拉里');
    assert.equal(await page.locator('#permissionDefault').inputValue(), 'read-only', '重算选项不改变当前选中值');
    assert.deepEqual(await saveBarWrite('/api/config/permission'), { default: 'read-only', allowFull: true, fullTtlMin: 30 });

    await navigate('sessions');
    await page.waitForSelector('#sessionList [data-manage-key]');
    await page.locator('#sessionList [data-manage-key]').first().click();
    await page.waitForSelector('#detailPermission');
    options = await readOptions();
    assert.equal(options.at(-1).value, 'full', '总开关打开后应出现 full 档');
    assert.match(options.at(-1).label, /完全访问 · 短时授权（danger-full-access）/);
    await page.locator('#sessionDetailOverlay [data-modal-close]').first().click();
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
    await page.evaluate(() => { location.hash = '#plugins/demo-plugin'; });
    await page.waitForSelector('[data-plugins-view="detail"]:not([hidden]) #cfg__baseUrl', { timeout: 5000 });
    assert.match(await page.textContent('[data-plugins-view="detail"] .detail-head-main h3'), /演示插件/, '页头写出插件名');
    await page.evaluate(() => history.back());
    await page.waitForSelector('[data-plugins-view="list"]:not([hidden])', { timeout: 5000 });
    assert.equal(await page.locator('[data-plugins-view="detail"]').isHidden(), true, '后退回清单');
    await page.evaluate(() => history.forward());
    await page.waitForSelector('[data-plugins-view="detail"]:not([hidden]) #cfg__baseUrl', { timeout: 5000 });
  });

  // 会话详情：“运行方案”要写出全局方案的名字（不能只有一个破折号）；
  // “人格”下拉每次打开都重读目录——人格页新建卡后回来立刻能看到，不需要刷新页面。
  // 这段带写请求，所以必须放在契约基线比对之后。
  await test('Session detail shows the active plan label and re-reads the persona catalog', async () => {
    const openDetail = async () => {
      await navigate('sessions');
      await page.waitForSelector('#sessionList [data-manage-key]');
      await page.locator('#sessionList [data-manage-key]').first().click();
      await page.waitForSelector('#detailPlan');
    };
    const closeDetail = () => page.locator('#sessionDetailOverlay [data-modal-close]').first().click();
    const personaNames = () => page.locator('#detailPersonaName option').allTextContents();

    await openDetail();
    const planLabel = await page.locator('#detailPlan option').first().textContent();
    assert.match(planLabel, /跟随平台默认（当前：聊天）/, '跟随项要写出平台默认方案的名字，不能只显示一个破折号');
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

    // 四张表统一由表格组件渲染（工具栏 / 分页都在组件内）
    assert.equal(await page.locator('#usageConversations [data-table]').count(), 1, '按会话表应使用表格组件');
    assert.equal(await page.locator('#usageConversations [data-pager]').count(), 1, '按会话表应带分页');
    assert.equal(await page.locator('#usageRecent [data-table]').count(), 1, '最近流水应使用表格组件');
    assert.equal(await page.locator('#usagePrices [data-table]').count(), 1, '价目表应使用表格组件');

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

    // 实时流水与价目表
    assert.match(await page.textContent('#usageRecent'), /group:123456789|private:100001/, '最近流水应列出采样');
    assert.match(await page.textContent('#usagePrices'), /deepseek-flash/, '价目表应列出模型单价');
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

  // P5：直通运行期把「谁能改权限档」摆到界面上。管理员私聊走直通方案（权限归 Agent 平台），
  // 群聊走「聊天」（桥接钉档）——两种权威都要能从同一个详情里读出来。
  if (!original) await test('会话详情：Agent 平台与权限按权威分两态，直通会话改档后漂移消失', async () => {
    // 会话 key 里带冒号，请求路径里是百分号编码的：比对前先解回来。
    const pathOf = (url) => decodeURIComponent(new URL(url).pathname);
    await navigate('sessions');
    await page.waitForSelector('#sessionList [data-manage-key="private:100001"]');
    await page.click('#sessionList [data-manage-key="private:100001"]');
    await page.waitForSelector('#detailAgentPreset');
    const agentCard = page.locator('#sessionDetailBody [data-detail-form="agent"]');
    let text = await agentCard.textContent();
    assert.match(text, /DeepSeek Harness/, 'Agent 平台名字要写出来');
    assert.match(text, /权限档：Agent 平台自身/, '直通档的权限权威是 Agent 平台自身');
    assert.match(text, /系统提示/, '话术按能力档声明的 system 通道注入');
    assert.match(text, /漂移：对端现在是 default/, '桥接基线与对端现值不一致要写出来');
    assert.deepEqual(await page.locator('#detailAgentPreset option').evaluateAll((nodes) => nodes.map((node) => node.value)), ['read-only', 'workspace-write', 'default'], '档位目录来自 Agent 平台');
    assert.equal(await page.locator('#detailAgentPreset').inputValue(), 'default');

    const [written] = await Promise.all([
      page.waitForResponse((r) => pathOf(r.url()) === '/api/sessions/private:100001/permission' && r.request().method() === 'POST'),
      page.selectOption('#detailAgentPreset', 'workspace-write'),
    ]);
    assert.equal(written.status(), 200);
    assert.deepEqual(fixture.requests.at(-1)?.body, { preset: 'workspace-write' }, '改档只提交目标档位');
    await page.waitForFunction(() => document.getElementById('detailAgentPreset')?.value === 'workspace-write');
    text = await agentCard.textContent();
    assert.equal(/漂移/.test(text), false, '写后核对一致，漂移结论应消失');
    assert.equal(await page.locator('.detail-danger [data-detail-agent-reopen]').count(), 1, 'Agent 平台权威给出「在新 Agent 平台上重开」，且归入危险操作卡');
    await page.locator('#sessionDetailOverlay [data-modal-close]').first().click();

    // 群聊走桥接钉档：只读展示生效档位，没有改档下拉，也不给重开按钮。
    await page.click('#sessionList [data-manage-key="group:123456789"]');
    await page.waitForFunction(() => (document.querySelector('#sessionDetailBody [data-detail-form="agent"]')?.textContent || '').includes('桥接钉档'));
    const bridgeText = await agentCard.textContent();
    assert.match(bridgeText, /桥接权威：这一档由桥接钉住并自动改回/);
    assert.equal(await page.locator('#detailAgentPreset').count(), 0, '桥接权威不给改档下拉');
    assert.equal(await page.locator('.detail-danger [data-detail-agent-reopen]').count(), 0, '实例没换过就不给重开按钮');
    await page.locator('#sessionDetailOverlay [data-modal-close]').first().click();
  });

  if (!original) await test('方案页：应用方式 / 权限权威只读展示，改能力档跳到平台的能力标签', async () => {
    await navigate('plans');
    await page.waitForSelector('#planCard [data-plan-edit="agent-direct"]');
    const table = await page.locator('#planCard').textContent();
    assert.match(table, /应用方式/);
    assert.match(table, /权限权威/);
    assert.match(table, /不做工具级限制/, '直通方案行要标记不做工具级限制');
    assert.match(table, /Agent 平台自身/);
    assert.match(table, /桥接钉档/);

    await page.click('#planCard [data-plan-edit="agent-direct"]');
    await page.waitForSelector('#planRuntimeSummary');
    let summary = await page.locator('#planRuntimeSummary').textContent();
    assert.match(summary, /应用方式 直通（不装预设）/);
    assert.match(summary, /权限权威 Agent 平台自身/);
    // 换能力档：只读块跟着重画，但不往保存体里加字段。
    await page.selectOption('#planEditTools', 'chat');
    summary = await page.locator('#planRuntimeSummary').textContent();
    assert.match(summary, /应用方式 装预设/);
    assert.match(summary, /权限权威 桥接钉档/);

    await page.selectOption('#planEditTools', 'direct');
    await page.locator('[data-plan-cap-jump]').click();
    // 跳转直接落到「平台 › 能力」二级页：sub 与 tab 一起写进地址栏。
    await page.waitForFunction(() => location.hash === '#platforms/agent:dsh/capabilities');
    await page.waitForSelector('[data-platform-tab="capabilities"].active');
    await page.waitForSelector('#platformCapabilityList [data-cap-edit]');
    assert.equal(await page.locator('#planEditor').count(), 0, '跳转前先关掉方案编辑器');
    assert.match(await page.textContent('[data-platform-view="detail"] .detail-head-main h3'), /DeepSeek Harness/, '能力档属于声明它的平台');
  });

  if (!original) await test('全局配置：Agent 平台卡区分配置面与运行期，切换默认平台只落盘', async () => {
    await navigate('config');
    await page.waitForFunction(() => document.getElementById('agentDefaultSelect')?.options.length >= 2);
    // 前面的用例可能已经把默认平台改成 acp：这里跟着当前值走，结束时换回原来那个。
    const initial = await page.locator('#agentDefaultSelect').inputValue();
    assert.ok(['dsh', 'acp'].includes(initial), `默认 Agent 平台应来自注册表，实际 ${initial}`);
    const running = await page.locator('#agentRunningReadout').textContent();
    assert.match(running, /DeepSeek Harness/);
    assert.match(running, /连接方式 HTTP/);
    assert.match(running, /已就绪/);
    // 模型与思考强度只属于平台详情的「配置」标签：全局配置页不再有模型卡。
    assert.equal(await page.locator('#platformModelMount, #dshProviderSelect, #section-dsh').count(), 0, '全局配置页不再有模型卡');

    // 先归位到运行中的 dsh：这条用例只验证「切到另一个 → 待重启」，不依赖前面的用例怎么收场。
    if (initial !== 'dsh') {
      await page.selectOption('#agentDefaultSelect', 'dsh');
      await clickWrite('#agentSwitchBtn', '/api/config/runtime');
      await page.waitForFunction(() => document.getElementById('agentDefaultSelect')?.value === 'dsh');
      // 「当前运行」那一行在选出值之后才重写：等它把上一个用例留下的「待重启」提示抹掉。
      await page.waitForFunction(() => !/配置面已改为/.test(document.getElementById('agentRunningReadout')?.textContent || ''));
    }

    await page.selectOption('#agentDefaultSelect', 'acp');
    assert.deepEqual(await clickWrite('#agentSwitchBtn', '/api/config/runtime'), { defaultAgent: 'acp' });
    await page.waitForFunction(() => (document.getElementById('agentSwitchMsg')?.textContent || '').includes('已把默认 Agent 平台改为 ACP 执行体'));
    const switched = await page.locator('#agentRunningReadout').textContent();
    assert.match(switched, /配置面已改为 acp，重启后生效/);
    assert.match(switched, /DeepSeek Harness/, '本进程仍在跑 dsh');

    // 收拾现场：恢复进入本用例前的配置面，别把「待重启」状态改了。
    await page.waitForFunction(() => document.getElementById('agentDefaultSelect')?.value === 'acp');
    await page.selectOption('#agentDefaultSelect', initial);
    assert.deepEqual(await clickWrite('#agentSwitchBtn', '/api/config/runtime'), { defaultAgent: initial });
    await page.waitForFunction((value) => document.getElementById('agentDefaultSelect')?.value === value, initial);
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
