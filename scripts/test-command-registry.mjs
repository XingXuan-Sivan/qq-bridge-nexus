// 命令注册表回归（docs/COMMAND_REGISTRY.md）。
//
// 钉住的是匹配与边界：最长优先、别名、带参数、元数据条目回退、权限与 scope、
// 以及「内置先注册者保留」这条冲突规则——它决定插件能不能悄悄抢走 /role。
import assert from 'node:assert/strict';
import test from 'node:test';

import { createCommandRegistry } from '../src/commands/registry.mjs';

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
