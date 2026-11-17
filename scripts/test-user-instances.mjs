// P3 多实例（docs/EXECUTION_BODY_GENERALIZATION.md §8.5 / §9）。
//
// 「一个实例 = `platforms.users` 里的一条条目（平台 + 账号）」。这一批把它变成**可装配的东西**，
// 所以这里钉住的是三个接口而不是某个平台：
//   · 配置面：`enabled` 是条目级键（不是发给平台的选项），`userInstances()` 把表摊成清单；
//   · 注册表：`enabled` / `inboundState` / `outbound` 三个读视图，外加「只在配置里存在」
//     的条目也必须可见 —— 否则那条实例在控制台上无处可改。
import assert from 'node:assert/strict';
import test from 'node:test';

import { flatPlatformEntry, patchPlatformConfig, readPlatforms, setActivePlatform, userInstances } from '../src/config/platforms.mjs';
import { DIAGNOSTIC_CODES, buildPlatformRegistry, findRegistryPlatform } from '../src/platforms/registry.mjs';

/** 只读一条用户条目的归一化结果（`readPlatforms` 是配置面的公开读口）。 */
function entryOf(raw) {
  return readPlatforms({ platforms: { users: { qq: raw } } }).users.qq;
}

test('enabled 是条目级键：不落进 options，缺省即启用', () => {
  const off = entryOf({ enabled: false, wsUrl: 'ws://127.0.0.1:3001' });
  assert.equal(off.enabled, false);
  assert.equal('enabled' in off.options, false, '平台适配器不该收到一个与它无关的键');
  assert.equal(off.transport.wsUrl, 'ws://127.0.0.1:3001', '连接参数照旧按白名单归位');

  assert.equal(entryOf({ account: 'bot-2' }).enabled, true, '没写就是启用');
  // 写散的 enabled 也要被提出去（手改 config.json 的常态）。
  const loose = entryOf({ transport: {}, options: { enabled: false } });
  assert.equal(loose.enabled, false);
  assert.equal('enabled' in loose.options, false);
});

test('userInstances()：一条条目一个实例，停用的也返回，顺序稳定', () => {
  const platforms = {
    active: { user: 'qq', agent: 'dsh' },
    users: {
      qq: { account: 'main', transport: { wsUrl: 'ws://127.0.0.1:3001' } },
      wx: { enabled: false },
      'qq-backup': { account: 'bot-2', options: { backfill: true } },
    },
    agents: {},
  };
  const list = userInstances(platforms);
  assert.deepEqual(list.map((item) => item.id), ['qq', 'qq-backup', 'wx'], '按 id 排序，控制台与日志顺序一致');
  assert.equal(list.find((item) => item.id === 'wx').enabled, false, '停用的实例仍然返回，由装配方跳过');
  assert.equal(list.find((item) => item.id === 'qq').transport.wsUrl, 'ws://127.0.0.1:3001');
  assert.equal(list.find((item) => item.id === 'qq-backup').options.backfill, true);
});

test('扁平投影带上 enabled：控制台读的就是这一份', () => {
  const platforms = readPlatforms({ platforms: { users: { qq: { enabled: false, account: 'main' } } } });
  const flat = flatPlatformEntry(platforms, 'user', 'qq');
  assert.equal(flat.enabled, false);
  assert.equal(flat.account, 'main');
});

test('按 id 只改那一条：写 enabled 不动别的实例，也不动默认实例', () => {
  const base = {
    active: { user: 'qq', agent: 'dsh' },
    users: { qq: { transport: { wsUrl: 'ws://127.0.0.1:3001' } }, wx: {} },
    agents: {},
  };
  const next = patchPlatformConfig(base, 'user', 'wx', { enabled: false, wsUrl: 'ws://127.0.0.1:3002' });
  assert.equal(next.users.wx.enabled, false);
  assert.equal(next.users.wx.transport.wsUrl, 'ws://127.0.0.1:3002', '连接参数进 transport');
  assert.equal(next.active.user, 'qq', '写非默认实例不改默认');
  assert.equal(next.users.qq.enabled, true, '另一条条目的开关不受影响');
});

test('切换默认实例只改指针；指向没配过的 id 时补一条空壳（否则报 active_unregistered）', () => {
  const next = setActivePlatform({ active: { user: 'qq', agent: 'dsh' }, users: { qq: {} }, agents: {} }, 'user', 'wx');
  assert.equal(next.active.user, 'wx');
  assert.equal(next.users.qq.enabled, true, '条目是「怎么连」，与「默认用谁」无关');
  assert.equal(next.users.wx.enabled, true, '补出来的空壳是启用状态');
  assert.equal(next.active.agent, 'dsh', '用户侧切换不碰 Agent 侧');
});

/** 两条用户实例：qq 在跑、wx 停用。注册表条目要能同时回答「装配没装配」与「发消息走谁」。 */
function twoInstances(extra = {}) {
  const config = {
    active: { user: 'qq' },
    users: {
      qq: { enabled: true, account: 'main' },
      wx: { enabled: false },
    },
  };
  const snapshot = buildPlatformRegistry({
    profilePlatforms: [
      { id: 'qq', label: 'QQ', behaviors: [], prompt: {}, tools: [] },
      { id: 'wx', label: '微信', behaviors: [], prompt: {}, tools: [] },
    ],
    userRuntime: {
      active: 'qq',
      platforms: [
        { id: 'qq', label: 'QQ', source: 'builtin', inbound: true },
        { id: 'wx', label: '微信', source: 'builtin', inbound: true },
      ],
    },
    config,
    userInbound: { qq: { state: 'open', detail: '', at: '2026-11-15T10:00:00.000Z' } },
    ...extra,
  });
  return snapshot;
}

test('注册表按实例给出 enabled / 入站状态 / 出站实现', () => {
  const snapshot = twoInstances();
  const qq = findRegistryPlatform(snapshot, 'user', 'qq');
  assert.equal(qq.enabled, true);
  assert.equal(qq.inboundState.state, 'open', '入站结论是桥接记账的那一份');
  assert.deepEqual(qq.outbound, { via: 'adapter', owner: null });

  const wx = findRegistryPlatform(snapshot, 'user', 'wx');
  assert.equal(wx.enabled, false, '停用的实例照样列出，否则改不回去');
  assert.equal(wx.inboundState, null, '没装配过就是 null，而不是编一个状态');
});

test('插件 transport 接管时出站写 transport，并带上 owner', () => {
  const snapshot = buildPlatformRegistry({
    userRuntime: {
      active: 'bot',
      platforms: [{ id: 'bot', label: '演示机器人', source: 'plugin', owner: 'plugin-a', inbound: true }],
    },
    config: { users: { bot: {} } },
  });
  const bot = findRegistryPlatform(snapshot, 'user', 'bot');
  assert.deepEqual(bot.outbound, { via: 'transport', owner: 'plugin-a' });
});

test('只在配置里存在的实例仍然可见，并报 config_only（否则那条无处可改）', () => {
  const snapshot = buildPlatformRegistry({
    userRuntime: { active: 'qq', platforms: [{ id: 'qq', label: 'QQ', source: 'builtin', inbound: true }] },
    config: { active: { user: 'qq' }, users: { qq: {}, ghost: { enabled: true } } },
    userInbound: { ghost: { state: 'unregistered', detail: '没有运行期实现' } },
  });
  const ghost = findRegistryPlatform(snapshot, 'user', 'ghost');
  assert.ok(ghost, '配置里有它就必须在表里');
  assert.equal(ghost.source, 'config-only');
  assert.deepEqual(ghost.outbound, { via: 'none', owner: null });
  assert.equal(ghost.inboundState.state, 'unregistered');
  const diag = snapshot.diagnostics.find((item) => item.code === DIAGNOSTIC_CODES.CONFIG_ONLY && item.platformId === 'ghost');
  assert.ok(diag);
  assert.equal(diag.level, 'warn');
});

test('默认实例指向只在配置里的条目：仍然算 active_unregistered（装不上就是错误）', () => {
  const snapshot = buildPlatformRegistry({
    userRuntime: { active: 'ghost', platforms: [] },
    config: { active: { user: 'ghost' }, users: { ghost: {} } },
  });
  const diag = snapshot.diagnostics.find((item) => item.code === DIAGNOSTIC_CODES.ACTIVE_UNREGISTERED);
  assert.ok(diag, '只有配置条目不能把「当前平台装不上」降级成警告');
  assert.equal(diag.level, 'error');
});

test('停用的实例不额外制造诊断：它是有意关掉的，不是故障', () => {
  const snapshot = twoInstances();
  const diags = snapshot.diagnostics.filter((item) => item.platformId === 'wx');
  assert.deepEqual(diags, [], '「已停用」由条目字段表达，不是诊断');
});
