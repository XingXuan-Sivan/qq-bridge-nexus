// P3 配置归一：设置的新家是 config.json 的对应段，状态文件只留运行态。
// 覆盖四个纯模块适配点：定时任务设置、定时静默、插件配置、手动静默（手工部分由 bridge 负责）；
// 末尾一条走 bridge 夹具，把全局配置页每个分区的写口逐个打一遍，钉住「都落 config.json 顶层段」。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createScheduler, DEFAULT_SETTINGS } from '../src/scheduler/engine.js';
import { createSilenceSchedule, peakPresetRanges } from '../src/silence-schedule.js';
import { createPluginKernel } from '../src/plugins/kernel.mjs';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qqb-config-unify-'));

function schedulerAt(file, extra = {}) {
  return createScheduler({
    file,
    deliver: async () => ({ ok: true }),
    validateTarget: () => null,
    ownerKey: () => 'private:1',
    ...extra,
  });
}

test('定时任务：设置走 config（onSettingsChange），状态文件不再写 settings；首次读旧文件会迁移', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'scheduler.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, settings: { ...DEFAULT_SETTINGS, enabled: false }, tasks: [], history: [], counters: {}, nextId: 1 }));
  const seen = [];
  const s = schedulerAt(file, { settings: null, onSettingsChange: (next) => seen.push(next) });
  s.load();
  // 旧文件里的 settings 迁到 config 一次
  assert.equal(seen.length, 1);
  assert.equal(seen[0].enabled, false);
  s.updateSettings({ enabled: true }, { source: 'console' });
  assert.equal(seen.at(-1).enabled, true);
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(state.settings, undefined, '状态文件不应再存 settings');
  assert.equal(state.tasks.length, 0);
});

test('定时静默：时间段配置走 config，状态文件只留 override', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'silence-schedule.json');
  fs.writeFileSync(file, JSON.stringify({ config: { enabled: true, ranges: [{ id: 'r1', start: '23:00', end: '07:00', days: [1, 2, 3, 4, 5, 6, 7] }] } }));
  const seen = [];
  const sil = createSilenceSchedule({ file, config: null, onChange: (next) => seen.push(next) });
  assert.equal(seen.length, 1, '首次读旧文件应迁移到 config');
  sil.update({ enabled: false, ranges: [] });
  assert.equal(seen.at(-1).enabled, false);
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(state.config, undefined, '状态文件不应再存 config');
  // peakPresetRanges 仍可用来生成默认段（避免导入被摇树后忘了用）
  assert.ok(Array.isArray(peakPresetRanges([])));
});

test('插件配置：传入 config 时不再读写 plugins.json，保存走 saveConfig', async () => {
  const dir = tmpDir();
  const legacy = path.join(dir, 'plugins.json');
  fs.writeFileSync(legacy, JSON.stringify({ enabled: false }));
  const saved = [];
  const kernel = await createPluginKernel({
    rootDir: dir,
    stateDir: path.join(dir, 'state'),
    log: () => {},
    config: { enabled: true, plugins: {} },
    saveConfig: (next) => saved.push(next),
  });
  await kernel.init();
  assert.equal(kernel.status().enabled, true, '以传入的 config 为准，而不是 plugins.json');
  await kernel.close?.();
  assert.equal(fs.existsSync(legacy), true, '不应删除旧文件（迁移由 bridge 负责）');
  assert.equal(saved.length, 0, '初始化不写配置');
});

// ── 全局配置页逐项核对 ──────────────────────────────────────────────────────
// 页面上的每个保存分区对应一次写口；这里按分区分区写一遍再读回 config.json 断言落点，
// 防止界面能改、实际却存进了 state/（或反过来只改内存）。
const CONSOLE = { 'x-console-token': 'fixture-console-token' };
function call(port, pathname, { method = 'GET', headers = {}, body } = {}) {
  const hd = { 'content-type': 'application/json', ...CONSOLE, ...headers };
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: hd }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { let json = null; try { json = JSON.parse(data); } catch {} resolve({ status: res.statusCode, json, body: data }); });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('全局配置页：每个分区都写 config.json 顶层段，准入与会话档案同住、手动静默只进 state', async () => {
  const h = await bridgeHarness({ files: { 'roles/审计卡.md': '# 审计卡\n你是审计用的一次性人格。' } });
  const configOf = () => JSON.parse(fs.readFileSync(path.join(h.temp, 'config.json'), 'utf8'));
  const server = h.startConsoleServer();
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const port = server.address().port;
  try {
    // [分区, 方法, 路径, 载荷, config.json 里的落点断言]
    const sections = [
      // 默认行为是用户平台的条目级键：写口与平台详情同一个（`platforms.users.<id>.defaultBehavior`）。
      ['默认行为', 'PATCH', '/api/platforms/registry/user/qq/config', { defaultBehavior: 'social-v2' },
        (c) => c.platforms?.users?.qq?.defaultBehavior === 'social-v2'],
      ['默认人格', 'POST', '/api/config/role-default', { value: '审计卡' },
        (c) => c.role?.default === '审计卡'],
      ['人格卡生效方式', 'POST', '/api/roles/limit', { saveApply: 'immediate' },
        (c) => c.role?.saveApply === 'immediate'],
      ['发言上限', 'POST', '/api/config/send-limit', { maxSendPerMinute: 5, maxSendPerHour: 20 },
        (c) => c.limits?.send?.maxSendPerMinute === 5 && c.limits?.send?.maxSendPerHour === 20],
      ['上下文压缩', 'POST', '/api/compact/config', { mode: 'early', thresholdWan: '6' },
        (c) => c.compact?.mode === 'early' && c.compact?.thresholdTokens === 60_000],
      ['所有者与管理员', 'POST', '/api/whitelist', { owner: '100001', admins: [] },
        (c) => c.owner?.id === '100001' && Array.isArray(c.admins)],
      // 权限级别只存默认值：旧字段（allowFull / fullTtlMin）能改写就改写，不回写进 config.json。
      ['权限级别', 'POST', '/api/config/permission', { default: 'workspace-write', allowFull: true, fullTtlMin: 30 },
        (c) => c.permission?.default === 'workspace-write' && c.permission?.allowFull === undefined && c.permission?.fullTtlMin === undefined],
      ['安全拦截', 'POST', '/api/security', { interceptNotify: false },
        (c) => c.security?.interceptNotify === false],
      ['定时静默', 'POST', '/api/silence', {
        enabled: true, timezone: 'Asia/Shanghai',
        ranges: [{ name: '夜间', enabled: true, start: '23:00', end: '07:00', days: 'every', weekdays: [], skipHolidays: false }],
      }, (c) => c.silence?.schedule?.enabled === true && c.silence.schedule.ranges.length === 1],
      ['注入块', 'PATCH', '/api/config/promptBlocks', { promptBlocks: { 'core-persona': { enabled: false, maxChars: 8000 } } },
        (c) => c.promptBlocks?.['core-persona']?.enabled === false && c.promptBlocks['core-persona'].maxChars === 8000],
      // 令牌放最后：它换的是后续请求的凭据，这里写回同一个值。
      ['控制台令牌', 'POST', '/api/console/token', { token: 'fixture-console-token' },
        (c) => c.consoleToken === 'fixture-console-token'],
    ];
    for (const [label, method, pathname, body, landed] of sections) {
      const r = await call(port, pathname, { method, body });
      assert.equal(r.status, 200, `${label} 写入失败：${r.body}`);
      assert.ok(landed(configOf()), `${label} 应落在 config.json 的顶层段`);
    }

    // 默认 Agent 平台与注册表同源：只写 platforms.active.agent，不另开 runtime.defaultAgent。
    h.saveActiveAgentPlatform('acp');
    const afterAgent = configOf();
    assert.equal(afterAgent.platforms?.active?.agent, 'acp', '默认 Agent 平台落 platforms.active.agent');
    assert.equal(afterAgent.runtime?.defaultAgent, undefined, '不另存一份默认 Agent 平台');
    const runtime = await call(port, '/api/config/runtime');
    assert.equal(runtime.status, 200, runtime.body);
    assert.equal(runtime.json.runtime.defaultAgent, 'acp', '读口也取自 platforms.active.agent');

    // 全局准入：与会话档案同住 state/profiles.json，config.json 不再留旧的 allow/deny。
    const current = await call(port, '/api/access');
    assert.equal(current.status, 200, current.body);
    const access = current.json.access;
    const patched = await call(port, '/api/access', { method: 'PATCH', body: {
      passive: { mode: access.passive.mode, entries: ['qq:group:123456789'] },
      proactive: { mode: access.proactive.mode, entries: [] },
    } });
    assert.equal(patched.status, 200, patched.body);
    const afterAccess = configOf();
    for (const key of ['allow', 'deny', 'allowAllWhenEmpty']) {
      assert.equal(afterAccess[key], undefined, `准入已是会话档案，config.json 不该再有 ${key}`);
    }

    // 手动静默：策略同样在 config.json（silence.manual），state/current-role.json 只留 mode 标记。
    const silent = await call(port, '/api/role-mode', { method: 'POST', body: { mode: 'silent', silent: {} } });
    assert.equal(silent.status, 200, silent.body);
    assert.equal(configOf().silence?.manual?.mode, 'full', '手动静默策略落 silence.manual');
    const roleState = JSON.parse(fs.readFileSync(path.join(h.temp, 'state', 'current-role.json'), 'utf8'));
    assert.equal(roleState.mode, 'silent', 'state/ 只记运行态');
    assert.equal(roleState.silent, undefined, '策略不再往状态文件里存一份');
    await call(port, '/api/role-mode', { method: 'POST', body: { mode: 'active' } });
    assert.equal(configOf().silence?.manual, null, '关掉手动静默后清空策略');
  } finally { await new Promise((r) => server.close(r)); }
});
