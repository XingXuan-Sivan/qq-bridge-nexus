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
const views = ['overview', 'config', 'sessions', 'persona', 'plugins', 'skills', 'mcp', 'behaviors', 'slang', 'memory', 'scheduler', 'operations'];
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
  await page.goto(fixture.url);
  // 控制台已片段化：各页 HTML 在第一次进入该页时才注入（router.hydratePage）。
  // 所以这里先逐页 hydrate 一遍，后面「全量 legacy ID 都在」以及按 id 取元素才有东西可取。
  await page.waitForFunction(() => document.querySelectorAll('#mainNav [data-view]').length > 0);
  const allPages = await page.evaluate(() => [...document.querySelectorAll('#mainNav [data-view]')].map(node => node.dataset.view));
  async function hydrate(view) {
    await page.evaluate(v => { if (location.hash !== `#${v}`) location.hash = `#${v}`; }, view);
    // 片段 HTML 到位 ≠ 页面可用：字段由 fields.js 的规格在 init() 里渲染（router 在 init 之后打 pageReady）。
    await page.waitForFunction(v => (document.querySelector(`[data-page="${v}"]`)?.children.length ?? 0) > 0, view);
    await page.waitForFunction(v => document.querySelector(`[data-page="${v}"]`)?.dataset.pageReady === '1', view);
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
    assert.equal(new Set(ids).size, ids.length, 'Duplicate DOM IDs detected');
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
    // 工具区由表格组件渲染（分页 + 工具栏搜索），不再是手写清单。
    assert.equal(await page.locator('#mcpList [data-table]').count(), 1, 'MCP 工具区应使用表格组件');
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
    await page.waitForSelector('#pluginsList [data-plugin-action="detail"]');
    await page.click('#pluginsList [data-plugin-action="detail"]');
    await page.waitForFunction(() => document.getElementById('pluginDetailOverlay')?.classList.contains('open'));
    await page.waitForSelector('#cfg__baseUrl');
    assert.equal(await page.locator('#cfg__baseUrl').inputValue(), 'http://127.0.0.1:3110');
    assert.equal(await page.locator('#cfg__timeoutMs').inputValue(), '1200');
    assert.equal(await page.locator('#pluginConfigTest').count(), 1, '配置区应有测试按钮');
    await page.click('#pluginConfigTest');
    await page.waitForTimeout(250);
    const recorded = await (await fetch(`${fixture.url}/__fixture/requests`)).json();
    const call = recorded.requests.find((entry) => entry.method === 'POST' && entry.path === '/api/plugins/demo-plugin/test');
    assert.ok(call, '测试按钮应 POST /api/plugins/demo-plugin/test');
    assert.equal(call.body.config.timeoutMs, 1200);
    await page.click('#pluginDetailClose');
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

  await test('默认行为档案在全局配置，行为档案独立成页', async () => {
    await hydrate('config');
    assert.equal(await page.locator('[data-config-section="behavior"]').count(), 0);
    await page.waitForFunction(() => document.getElementById('behaviorDefaultSelect')?.options.length >= 2);
    assert.equal(await page.locator('#behaviorDefaultSelect').inputValue(), 'social-v2');
    await page.selectOption('#behaviorDefaultSelect', 'social-v1');
    await saveBarWrite('/api/config/behavior-default');
    assert.deepEqual(fixture.requests.at(-1).body, { value: 'social-v1' });

    await navigate('behavior');
    await page.waitForFunction(() => document.getElementById('behaviorFormSelect')?.options.length >= 2);
    await page.waitForFunction(() => document.getElementById('behaviorFormLabel')?.value === '一代仿真默认行为');
    await page.locator('#behaviorFormPanel [data-field="contextWindow"]').fill('25');
    await page.locator('#behaviorFormSave').click({ force: true });
    await page.waitForTimeout(600);
    const body = fixture.requests.filter((r) => r.method === 'PUT' && r.path.includes('/api/config/behaviors/')).at(-1)?.body;
    assert.equal(body?.data?.kind, 'v1');
    assert.equal(body?.data?.config?.contextWindow, 25);
  });

  await test('Runtime plan switch contracts', async () => {
    await navigate('runtime');
    // 切换走运行方案页：方案 id 由下拉给出，OTP 留空；确认、审计与回落仍由管理通道负责。
    await reveal('#runtimePlan');
    await page.selectOption('#runtimePlan', 'social-v2');
    assert.deepEqual(await clickWrite('#runtimeSwitch', '/api/runtime/switch'), { planId: 'social-v2', totp: '' });
  });

  await test('Prompt layer tabs contracts', async () => {
    await navigate('behavior');
    await reveal('[data-behavior-tab="platform"]');
    await page.click('[data-behavior-tab="platform"]');
    await page.waitForSelector('#platformSave', { timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('#platformMsg')?.textContent?.includes('字'), null, { timeout: 5000 });
    await reveal('#behaviorPromptSave');
    assert.ok(await page.locator('#behaviorPromptSave').count(), '行为提示词保存按钮');
    await page.click('[data-behavior-tab="capabilities"]');
    await page.waitForSelector('#capabilityCreate', { timeout: 5000 });
    await page.click('[data-behavior-tab="behaviors"]');
  });

  await test('Runtime plan editor contracts', async () => {
    await navigate('runtime');
    await reveal('#runtimeNew');
    await page.click('#runtimeNew');
    await page.waitForSelector('#runtimePlanEditor .modal', { timeout: 5000 });
    await page.fill('#runtimeEditId', 'my-agent');
    await page.fill('#runtimeEditLabel', '我的 Agent');
    await page.selectOption('#runtimeEditTools', 'agent-chat');
    await page.selectOption('#runtimeEditBehavior', 'social-v2');
    await page.selectOption('#runtimeEditAudience', 'owner');
    await page.fill('#runtimeEditNote', '带人格进群');
    assert.deepEqual(await clickWrite('#runtimeEditSave', '/api/runtime/plans'), {
      id: 'my-agent', label: '我的 Agent', capability: 'agent-chat', behavior: 'social-v2', audience: 'owner', note: '带人格进群',
    });
  });

  await test('Capability file contracts', async () => {
    await navigate('behavior');
    await page.click('[data-behavior-tab="capabilities"]');
    await reveal('#capabilityTable [data-cap-edit]');
    await page.click('#capabilityTable [data-cap-edit]');
    await page.waitForSelector('#capabilityEditor [data-cap-platform="sendPoke"]', { state: 'attached' });
    await page.fill('#capabilityLabel', '聊天（改）');
    await page.click('[data-cap-platform="sendPoke"]');
    await page.fill('#capabilitySafetyNotes', '不主动私聊。');
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/api/runtime/capabilities/agent-chat' && r.request().method() === 'PATCH'),
      page.click('#capabilitySave'),
    ]);
    assert.equal(response.status(), 200, 'PATCH /api/runtime/capabilities/agent-chat should succeed');
    const body = fixture.requests.at(-1)?.body ?? {};
    assert.equal(body.label, '聊天（改）');
    assert.equal(body.tools?.platform?.sendPoke, false, '取消勾选的平台工具要写成 false');
    assert.equal(body.tools?.platform?.sendMessage, true, '其余平台工具保持 true');
    assert.equal(body.tools?.agent?.['tool-web'], true, 'Agent 模块按勾选写成 true');
    assert.equal(body.safety?.notes, '不主动私聊。');
    assert.equal(body.tools?.visible, undefined, '可见集不再直接提交，由能力文件推导');
    assert.equal(body.sandbox, undefined, '沙箱不再由能力预设承载');
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
    await fill('ownerQQ', '100001');
    assert.deepEqual(await clickWrite('#wlSave', '/api/whitelist'), { ownerQQ: '100001', admins: [] });
    await check('secInterceptNotify', false);
    assert.deepEqual(await saveBarWrite('/api/security'), { interceptNotify: false });
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


  if (!original) await test('人格提示词：注入上限与生效方式在全局配置里一起保存', async () => {
    await navigate('config');
    await page.locator('[data-config-section="runtime"]').click();
    const max = page.locator('#personaInjectMax');
    await max.waitFor();
    assert.equal(Number(await max.inputValue()), 6000, '默认上限应为 6000');
    await max.fill('8000');
    await page.locator('input[name="personaSaveApply"][value="immediate"]').check();
    const body = await saveBarWrite('/api/roles/limit');
    assert.equal(body.maxInjectChars, 8000);
    assert.equal(body.saveApply, 'immediate');
    await page.waitForFunction(() => /已保存/.test(document.getElementById('actionDockResults')?.textContent || ''));
    // 改回默认
    await max.fill('6000');
    await page.locator('input[name="personaSaveApply"][value="nextWake"]').check();
    await saveBarWrite('/api/roles/limit');
  });

  if (!original) await test('DSH 模型：提供方 / 模型 / 思考强度联动、来自目录、明示全局副作用与第三方隐私', async () => {
    await navigate('config');
    await page.locator('[data-config-section="runtime"]').click();
    await page.waitForFunction(() => document.getElementById('dshEffortSelect')?.options.length > 0);
    const efforts = async () => page.locator('#dshEffortSelect option').evaluateAll((nodes) => nodes.map((n) => n.value));
    assert.deepEqual(await efforts(), ['off', 'low', 'high', 'max'], `档位应来自 DSH 目录，实际 ${(await efforts()).join(',')}`);
    assert.equal(await page.locator('#dshEffortSelect').inputValue(), 'max', '默认应为 max');
    assert.match(await page.locator('#dshEffortSideEffect').textContent(), /全局默认/, '必须说明会连带改 DSH 全局默认');
    // 选 off：提示可能影响质量
    await page.locator('#dshEffortSelect').selectOption('off');
    assert.match(await page.locator('#dshModelNotices').textContent(), /思考已关闭/);
    // 换到第三方提供方：模型联动、无档位模型置灰、提示隐私和价格未覆盖、看图未知
    await page.locator('#dshProviderSelect').selectOption('example-cloud');
    assert.equal(await page.locator('#dshModelSelect').inputValue(), 'example-chat');
    assert.equal(await page.locator('#dshEffortSelect').isDisabled(), true, '无档位模型的强度下拉置灰');
    const notices = await page.locator('#dshModelNotices').textContent();
    assert.match(notices, /不是 DeepSeek 自家的提供方/);
    assert.match(notices, /价格表没有覆盖/);
    assert.match(notices, /能不能看图未知/);
    await page.locator('#dshModelSelect').selectOption('example-reasoner');
    assert.deepEqual(await efforts(), ['minimal', 'medium', 'xhigh'], '档位跟着模型变');
    // 全局 handler 已经统一 accept 弹窗（见文件上方的 page.on('dialog')），这里再挂一个
    // 会二次 accept 同一个 dialog 而抛错，所以只等响应，不重复处理。
    const [saved] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/dsh/model' && r.request().method() === 'POST'),
      (async () => { await saveBarWrite('/api/dsh/model'); })(),
    ]);
    assert.equal(saved.status(), 200);
    assert.deepEqual(saved.request().postDataJSON(), { provider: 'example-cloud', model: 'example-reasoner', reasoningEffort: 'medium', vision: 'auto' });
    await page.waitForFunction(() => /example-reasoner/.test(document.getElementById('actionDockResults')?.textContent || ''));
    // 改回默认，避免影响后续断言
    await page.locator('#dshProviderSelect').selectOption('deepseek-official');
    await page.locator('#dshModelSelect').selectOption('deepseek-flash');
    await page.locator('#dshEffortSelect').selectOption('max');
    await saveBarWrite('/api/dsh/model');
    await page.waitForFunction(() => document.getElementById('dshProviderText').textContent === 'deepseek-official' && document.getElementById('dshEffortSelect').value === 'max');
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
