// 命令注册表回归（docs/COMMAND_REGISTRY.md）。
//
// 钉住的是匹配与边界：最长优先、别名、带参数、元数据条目回退、权限与 scope、
// 以及「内置先注册者保留」这条冲突规则——它决定插件能不能悄悄抢走 /role。
import assert from 'node:assert/strict';
import test from 'node:test';

import { createCommandRegistry } from '../src/commands/registry.mjs';
import { createBuiltinCommands } from '../src/commands/builtin.mjs';
import { buildCommandsPayload } from '../src/commands/payload.mjs';

function makeRegistry() {
  const logs = [];
  const registry = createCommandRegistry({ log: (line) => logs.push(line) });
  return { registry, logs };
}

test('注册校验：名字必须 / 开头，id 与权限枚举拒绝非法值', () => {
  const { registry } = makeRegistry();
  assert.throws(() => registry.register({ id: 'x', name: 'role', handler: async () => {} }), /命令名不合法/);
  assert.throws(() => registry.register({ id: 'x', name: '/x', scope: 'world' }), /scope 不合法/);
  assert.throws(() => registry.register({ id: 'x', name: '/x', permission: 'root' }), /permission 不合法/);
  assert.throws(() => registry.register({ id: 'x', name: '/x', handler: 'nope' }), /handler 必须是函数/);
});

test('匹配：精确、别名、带参数；最长主名优先', () => {
  const { registry } = makeRegistry();
  registry.register({ id: 'role', name: '/role', handler: async () => {} });
  registry.register({ id: 'rolelist', name: '/rolelist', handler: async () => {} });

  assert.equal(registry.match('/role').entry.id, 'role');
  assert.equal(registry.match('/role 星苒').arg, '星苒');
  assert.equal(registry.match('/rolelist').entry.id, 'rolelist');
  assert.equal(registry.match('/roles'), null, '不能做前缀模糊匹配');
  assert.equal(registry.match('/role 星苒 extra').arg, '星苒 extra');
});

test('别名指向同一条目，且不会抢走主名', () => {
  const { registry } = makeRegistry();
  registry.register({ id: 'reset', name: '/reset', aliases: ['/new'], handler: async () => {} });
  assert.equal(registry.match('/new').entry.id, 'reset');
  assert.equal(registry.match('/new').name, '/new');
});

test('元数据条目（无 handler）不拦截，返回 handled:false 让调用方回退旧链', async () => {
  const { registry } = makeRegistry();
  registry.register({ id: 'silent', name: '/silent', help: '静默' });
  assert.equal(registry.list()[0].migrated, false);
  const result = await registry.dispatch('/silent', { isOwner: true });
  assert.deepEqual(result, { handled: false, matchedId: 'silent', migrated: false });
});

test('迁移条目：handler 收到 ctx 与参数，返回值透传', async () => {
  const { registry } = makeRegistry();
  let seen = null;
  registry.register({
    id: 'role', name: '/role', permission: 'owner',
    handler: async (ctx) => { seen = ctx; return { ok: true, echoed: ctx.arg }; },
  });
  const result = await registry.dispatch('/role 魅魔', { key: 'group:1', kind: 'group', isOwner: true });
  assert.equal(result.handled, true);
  assert.equal(result.result.echoed, '魅魔');
  assert.equal(seen.key, 'group:1');
  assert.equal(seen.commandName, '/role');
});

test('权限：非 owner 打 owner 命令被拒，且不执行 handler', async () => {
  const { registry } = makeRegistry();
  let called = false;
  registry.register({ id: 'role', name: '/role', permission: 'owner', handler: async () => { called = true; } });
  const result = await registry.dispatch('/role', { isOwner: false });
  assert.equal(result.denied, true);
  assert.equal(result.reason, 'permission');
  assert.equal(called, false);
});

test('scope：私聊命令在群里被拒，群命令在私聊被拒', async () => {
  const { registry } = makeRegistry();
  registry.register({ id: 'p', name: '/p', scope: 'private', permission: 'all', handler: async () => {} });
  registry.register({ id: 'g', name: '/g', scope: 'group', permission: 'all', handler: async () => {} });
  assert.equal((await registry.dispatch('/p', { kind: 'group', isOwner: true })).reason, 'scope');
  assert.equal((await registry.dispatch('/g', { kind: 'private', isOwner: true })).reason, 'scope');
  assert.equal((await registry.dispatch('/p', { kind: 'private', isOwner: false })).handled, true);
});

test('handler 抛错：主链继续，结果带 error', async () => {
  const { registry, logs } = makeRegistry();
  registry.register({ id: 'boom', name: '/boom', permission: 'all', handler: async () => { throw new Error('kaboom'); } });
  const result = await registry.dispatch('/boom', { isOwner: true });
  assert.equal(result.handled, true);
  assert.match(result.error.message, /kaboom/);
  assert.ok(logs.some((line) => line.includes('执行失败')));
});

test('冲突：先注册者保留，后注册者告警但不覆盖', () => {
  const { registry, logs } = makeRegistry();
  assert.equal(registry.register({ id: 'builtin', name: '/role', handler: async () => 'builtin' }), true);
  assert.equal(registry.register({ id: 'plugin-x', name: '/role', source: 'plugin', pluginId: 'x', handler: async () => 'plugin' }), false);
  assert.equal(registry.match('/role').entry.id, 'builtin');
  assert.ok(logs.some((line) => line.includes('命令名冲突')));
  assert.equal(registry.list().length, 1);
});

test('list 去掉 handler；unregisterPlugin 只删该插件的命令', () => {
  const { registry } = makeRegistry();
  registry.register({ id: 'a', name: '/a', source: 'plugin', pluginId: 'p1', handler: async () => {} });
  registry.register({ id: 'b', name: '/b', source: 'plugin', pluginId: 'p2', handler: async () => {} });
  registry.register({ id: 'c', name: '/c', handler: async () => {} });
  assert.equal('handler' in registry.list()[0], false);
  assert.equal(registry.unregisterPlugin('p1'), 1);
  assert.equal(registry.get('a'), null);
  assert.ok(registry.get('b'));
  assert.ok(registry.get('c'));
});

// ── P7 第二步：内置命令的「壳」从 bridge.js 抽到 src/commands/builtin.mjs ──────────
// 用假 deps 单测文案与状态写入，不需要起桥接、也不碰真实 state 目录。

function makeBuiltinHarness(overrides = {}) {
  const sent = [];
  const writes = [];
  const logs = [];
  const harness = {
    sent, writes, logs,
    roleState: { role: '星苒', mode: 'active', byKey: {} },
    sessionIds: { 'group:1': 'sess-1' },
  };
  const deps = {
    send: async (key, text) => { sent.push({ key, text }); },
    session: {
      current: (key) => harness.sessionIds[key] ?? null,
      reset: async (key) => { writes.push(['reset', key]); return { ok: true }; },
    },
    acl: { allowed: () => true },
    role: {
      read: () => harness.roleState,
      writeFull: (next) => { harness.roleState = next; writes.push(['writeFull', next]); },
      withKeyFor: (state, key, mode, name) => ({
        ...state,
        byKey: { ...state.byKey, [key]: name ? { mode, role: name } : { mode } },
      }),
      nameFor: (state, key) => {
        const own = state.byKey?.[key];
        if (own?.mode === 'off') return null;
        if (own?.role) return own.role;
        return state.role ?? null;
      },
      sourceFor: (state, key) => {
        const own = state.byKey?.[key];
        if (own?.mode === 'off') return 'off';
        if (own?.role) return 'key';
        return 'global';
      },
      sanitize: (name) => String(name ?? '').replace(/[^\w\u4e00-\u9fff-]/g, ''),
      exists: (name) => name === '星苒' || name === '魅魔',
      setGlobalMode: (mode) => { harness.roleState = { ...harness.roleState, mode }; writes.push(['mode', mode]); },
    },
    log: (line) => logs.push(line),
    ...overrides,
  };
  const registry = createCommandRegistry({ log: (line) => logs.push(line) });
  for (const definition of createBuiltinCommands(deps)) registry.register(definition);
  const run = (text, ctx = {}) => registry.dispatch(text, { key: 'group:1', kind: 'group', id: '1', cfg: {}, isOwner: true, ...ctx });
  return { registry, harness, run };
}

test('内置命令：五条都在注册表里，且都挂了 handler', () => {
  const { registry } = makeBuiltinHarness();
  const ids = registry.list().map((entry) => entry.id).sort();
  assert.deepEqual(ids, ['active', 'reset', 'role', 'silent', 'status']);
  assert.ok(registry.list().every((entry) => entry.migrated === true && entry.source === 'bridge'));
  assert.equal(registry.match('/quiet').entry.id, 'silent');
  assert.equal(registry.match('/speak').entry.id, 'active');
});

test('/status：回执里有会话、白名单、角色与模式', async () => {
  const { harness, run } = makeBuiltinHarness();
  const result = await run('/status');
  assert.equal(result.handled, true);
  assert.equal(harness.sent.length, 1);
  assert.match(harness.sent[0].text, /会话 sess-1；白名单 通过；角色 星苒；模式 active/);
});

test('/status：会话不存在时显示「未创建」，白名单拦截时显示「拦截」', async () => {
  const { harness, run } = makeBuiltinHarness({ acl: { allowed: () => false } });
  await run('/status', { key: 'group:404' });
  assert.match(harness.sent[0].text, /会话 未创建；白名单 拦截/);
});

test('/reset：调用 session.reset，并把它的结果透传出去', async () => {
  const { harness, run } = makeBuiltinHarness();
  await run('/reset');
  assert.deepEqual(harness.writes, [['reset', 'group:1']]);
  const empty = makeBuiltinHarness({ session: { current: () => null, reset: async () => ({ ok: true, note: 'no-session' }) } });
  const result = await empty.run('/new');
  assert.deepEqual(result.result, { ok: true, note: 'no-session' });
});

test('/role：查看、切换、off、default 与不存在的角色', async () => {
  const { harness, run } = makeBuiltinHarness();

  await run('/role');
  assert.match(harness.sent.at(-1).text, /本会话跟随全局默认（「星苒」）/);

  await run('/role 魅魔');
  assert.equal(harness.roleState.byKey['group:1'].role, '魅魔');
  assert.match(harness.sent.at(-1).text, /已切换角色：魅魔/);

  await run('/role');
  assert.match(harness.sent.at(-1).text, /本会话单独用「魅魔」/);

  await run('/role off');
  assert.equal(harness.roleState.byKey['group:1'].mode, 'off');
  assert.match(harness.sent.at(-1).text, /已关闭本会话的角色卡/);

  await run('/role default');
  assert.equal(harness.roleState.byKey['group:1'].mode, 'default');
  assert.match(harness.sent.at(-1).text, /已回到全局默认/);

  await run('/role 不存在的角色');
  assert.match(harness.sent.at(-1).text, /不存在。角色文件放 qq-bridge\/roles\/ 目录/);
});

test('/silent 与 /active：只改全局模式并回执', async () => {
  const { harness, run } = makeBuiltinHarness();
  await run('/silent');
  assert.equal(harness.roleState.mode, 'silent');
  assert.match(harness.sent.at(-1).text, /已进入静默模式/);
  await run('/speak');
  assert.equal(harness.roleState.mode, 'active');
  assert.match(harness.sent.at(-1).text, /已退出静默模式/);
});

test('payload：按来源分组，DSH 命令与工具清单原样返回', () => {
  const { registry } = makeBuiltinHarness();
  registry.register({ id: 'demo', name: '/demo', source: 'plugin', pluginId: 'x', handler: async () => {} });
  const payload = buildCommandsPayload(registry);
  assert.equal(payload.ok, true);
  assert.equal(payload.bridge.builtin.length, 5);
  assert.deepEqual(payload.bridge.plugin.map((entry) => entry.id), ['demo']);
  assert.deepEqual(payload.dsh.map((entry) => entry.name), ['/compact', '/permission']);
  assert.deepEqual(payload.tools.map((entry) => entry.name), ['web_search', 'web_fetch', 'snowluma_status']);
  assert.equal('handler' in payload.bridge.builtin[0], false);
});
