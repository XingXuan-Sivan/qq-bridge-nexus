// 配置 v2（`platforms` 段）：迁移、读归一、派生视图、补丁写回。
//
// 这一层不碰磁盘，所以全部用例都是纯函数。迁移只跑一次是**硬要求**：
// 它删掉 `platform` / `snowluma` / `dsh` 三个顶层键，重复跑会把空壳覆盖到用户数据上。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_ENDPOINT_KEYS,
  CONFIG_VERSION,
  USER_TRANSPORT_KEYS,
  agentPlatformConfig,
  flatPlatformEntry,
  flatPlatforms,
  migrateConfigToV2,
  patchPlatformConfig,
  platformViews,
  platformsForWrite,
  readPlatforms,
  userPlatformConfig,
} from '../src/config/platforms.mjs';

const V1 = {
  platform: { id: 'qq', account: 'napcat' },
  snowluma: { wsUrl: 'ws://127.0.0.1:3001', accessToken: 'tok', viaPlatform: true, backfill: { gapMs: 5000 } },
  dsh: { baseUrl: 'http://127.0.0.1:19387', authToken: 'launch', model: 'deepseek-flash', reasoningEffort: 'max' },
  consolePort: 3100,
};

test('v1 → v2：三个顶层键搬进 platforms，旧键删除，版本号写 2', () => {
  const { config, migrated, notes } = migrateConfigToV2(V1);
  assert.equal(migrated, true);
  assert.equal(config.configVersion, CONFIG_VERSION);
  assert.equal(config.platform, undefined);
  assert.equal(config.snowluma, undefined);
  assert.equal(config.dsh, undefined);
  // 与平台无关的段一律原样保留（迁移只搬它认识的东西）
  assert.equal(config.consolePort, 3100);
  assert.deepEqual(config.platforms.active, { user: 'qq', agent: 'dsh' });
  assert.deepEqual(config.platforms.users.qq.transport, {
    wsUrl: 'ws://127.0.0.1:3001', accessToken: 'tok', viaPlatform: true,
  });
  assert.deepEqual(config.platforms.users.qq.options, { backfill: { gapMs: 5000 } });
  assert.equal(config.platforms.users.qq.account, 'napcat');
  assert.deepEqual(config.platforms.agents.dsh.endpoint, {
    baseUrl: 'http://127.0.0.1:19387', authToken: 'launch',
  });
  assert.deepEqual(config.platforms.agents.dsh.options, { model: 'deepseek-flash', reasoningEffort: 'max' });
  assert.ok(notes.length >= 2, '迁移要说清楚搬了什么');
});

test('迁移幂等：迁完再跑一次是 no-op，不会把空壳盖回去', () => {
  const first = migrateConfigToV2(V1).config;
  const second = migrateConfigToV2(first);
  assert.equal(second.migrated, false);
  assert.deepEqual(second.config, first);
  assert.deepEqual(second.notes, []);
});

test('已是 v2 的配置不动（哪怕少了 active/条目）', () => {
  const v2 = { configVersion: 2, platforms: { users: { qq: { transport: { wsUrl: 'w' } } } } };
  const { config, migrated } = migrateConfigToV2(v2);
  assert.equal(migrated, false);
  assert.deepEqual(config, v2);
});

test('空配置：迁出 qq/dsh 空壳，active 指向它们', () => {
  const { config } = migrateConfigToV2({});
  assert.deepEqual(config.platforms.active, { user: 'qq', agent: 'dsh' });
  assert.ok(config.platforms.users.qq);
  assert.ok(config.platforms.agents.dsh);
  assert.deepEqual(config.platforms.users.qq.transport, {});
});

test('readPlatforms：写散的键按白名单归位，options 与 transport 合并', () => {
  const platforms = readPlatforms({
    platforms: {
      active: { user: 'TG' },
      users: {
        tg: { accessToken: 'a', wsUrl: 'w', transport: { httpUrl: 'h' }, options: { backfill: {} }, extra: 1 },
      },
    },
  });
  assert.equal(platforms.active.user, 'tg', 'active 的 id 大小写归一');
  assert.deepEqual(platforms.users.tg.transport, { accessToken: 'a', wsUrl: 'w', httpUrl: 'h' });
  assert.deepEqual(platforms.users.tg.options, { backfill: {}, extra: 1 });
});

test('readPlatforms：active 缺省时取目录里唯一的 id，其次才是内置默认', () => {
  assert.equal(readPlatforms({ platforms: { users: { telegram: {} } } }).active.user, 'telegram');
  assert.equal(readPlatforms({}).active.user, 'qq');
  assert.equal(readPlatforms({}).active.agent, 'dsh');
});

test('readPlatforms：active 指向不存在的 id 时原样保留（交给诊断，不静默改）', () => {
  const platforms = readPlatforms({ platforms: { active: { user: 'mastodon' }, users: { qq: {} } } });
  assert.equal(platforms.active.user, 'mastodon');
});

test('readPlatforms：非法平台 id 的条目被丢弃，不污染整份配置', () => {
  const platforms = readPlatforms({ platforms: { users: { 'Q Q': {}, qq: {} } } });
  assert.deepEqual(Object.keys(platforms.users), ['qq']);
});

test('userPlatformConfig / agentPlatformConfig：缺条目给空段，account 归一', () => {
  const platforms = readPlatforms({ platforms: { active: { user: 'qq', agent: 'dsh' } } });
  const user = userPlatformConfig(platforms);
  assert.deepEqual(user, { id: 'qq', account: '', transport: {}, options: {} });
  const agent = agentPlatformConfig(platforms);
  assert.deepEqual(agent, { id: 'dsh', endpoint: {}, options: {} });

  const withBadAccount = readPlatforms({ platforms: { users: { qq: { account: '坏 名字' } } } });
  assert.equal(userPlatformConfig(withBadAccount).account, '');
});

test('platformViews：连接参数与选项拍平，内核只认平台中立的两个视图', () => {
  const platforms = readPlatforms(migrateConfigToV2(V1).config);
  const views = platformViews(platforms);
  assert.deepEqual(views.platform, { id: 'qq', account: 'napcat' });
  assert.equal(views.userPlatform.accessToken, 'tok');
  assert.deepEqual(views.userPlatform.backfill, { gapMs: 5000 });
  assert.equal(views.agentPlatform.model, 'deepseek-flash');
  assert.equal(views.agentPlatform.baseUrl, 'http://127.0.0.1:19387');
});

test('patchPlatformConfig：按白名单分到 endpoint/options，不改变其它平台', () => {
  const base = readPlatforms(migrateConfigToV2(V1).config);
  const patched = patchPlatformConfig(base, 'agent', { model: 'deepseek-v4', authToken: 'next' });
  assert.equal(patched.agents.dsh.options.model, 'deepseek-v4');
  assert.equal(patched.agents.dsh.endpoint.authToken, 'next');
  assert.equal(patched.agents.dsh.options.reasoningEffort, 'max', '未提到的选项保持原值');
  assert.equal(patched.users.qq.transport.accessToken, 'tok', '另一侧不受影响');

  const userPatched = patchPlatformConfig(base, 'user', { accessToken: 'tok2', backfill: { gapMs: 1 }, account: 'snow' });
  assert.equal(userPatched.users.qq.transport.accessToken, 'tok2');
  assert.deepEqual(userPatched.users.qq.options.backfill, { gapMs: 1 });
  assert.equal(userPatched.users.qq.account, 'snow');
});

test('platformsForWrite：只回写三段结构，不把读时的推断带进文件', () => {
  const platforms = readPlatforms({ platforms: { active: { user: 'qq' }, users: { qq: { wsUrl: 'w' } } } });
  assert.deepEqual(platformsForWrite(platforms), {
    active: { user: 'qq', agent: 'dsh' },
    users: { qq: { account: '', transport: { wsUrl: 'w' }, options: {} } },
    agents: {},
  });
});

test('白名单本身是封闭集合：连接参数只能是列出来的那几个键', () => {
  assert.ok(USER_TRANSPORT_KEYS.includes('accessToken'));
  assert.ok(!USER_TRANSPORT_KEYS.includes('model'), '模型是选项而不是连接参数');
  assert.ok(AGENT_ENDPOINT_KEYS.includes('baseUrl'));
  assert.ok(!AGENT_ENDPOINT_KEYS.includes('reasoningEffort'));
  assert.ok(Object.isFrozen(USER_TRANSPORT_KEYS) && Object.isFrozen(AGENT_ENDPOINT_KEYS));
});

test('flatPlatformEntry：段内三段（transport/options/endpoint）对调用方不可见', () => {
  const platforms = readPlatforms(migrateConfigToV2(V1).config);
  assert.deepEqual(flatPlatformEntry(platforms, 'user', 'qq'), {
    account: 'napcat',
    wsUrl: 'ws://127.0.0.1:3001',
    accessToken: 'tok',
    viaPlatform: true,
    backfill: { gapMs: 5000 },
  });
  assert.deepEqual(flatPlatformEntry(platforms, 'agent', 'dsh'), {
    baseUrl: 'http://127.0.0.1:19387',
    authToken: 'launch',
    model: 'deepseek-flash',
    reasoningEffort: 'max',
  });
  // 没有这一项时给空对象，而不是把 undefined 漏给调用方拼字符串
  assert.deepEqual(flatPlatformEntry(platforms, 'user', 'mastodon'), { account: '' });
  assert.deepEqual(flatPlatformEntry(platforms, 'agent', 'nope'), {});
});

test('flatPlatforms：整份投影保留 active 与全部 id，值都是扁平的', () => {
  const platforms = readPlatforms(migrateConfigToV2(V1).config);
  const flat = flatPlatforms(platforms);
  assert.deepEqual(flat.active, { user: 'qq', agent: 'dsh' });
  assert.deepEqual(Object.keys(flat.users), ['qq']);
  assert.deepEqual(Object.keys(flat.agents), ['dsh']);
  assert.equal(flat.users.qq.accessToken, 'tok');
  assert.equal(flat.users.qq.transport, undefined, '投影里不得再出现 transport 这一层');
  assert.equal(flat.agents.dsh.endpoint, undefined);
  // 已经归一过的对象再投影一次结果不变（注册表会被反复调用）
  assert.deepEqual(flatPlatforms(flat), flat);
});
