#!/usr/bin/env node
// 两端适配器：描述校验、注册表、内置 QQ/DSH、与提示词变量打通。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADAPTER_KINDS,
  PROMPT_VAR_KEYS,
  builtinAdapters,
  createAdapterRegistry,
  normalizeAdapter,
} from '../src/runtime/adapters.mjs';
import { renderPlatformPrompt } from '../src/runtime/prompt-compose.mjs';

test('两端类型与提示词变量是固定集合', () => {
  assert.deepEqual([...ADAPTER_KINDS], ['platform', 'agent']);
  assert.deepEqual([...PROMPT_VAR_KEYS], ['platform', 'displayName', 'owner']);
});

test('normalizeAdapter：id 规则、capabilities 去重、vars 白名单', () => {
  const qq = normalizeAdapter('platform', {
    id: 'qq',
    label: 'QQ',
    capabilities: ['send', 'send', 'members', '', 42],
    vars: { platform: 'QQ', displayName: 'QQ群', secret: '不应保留' },
  }, 'core');
  assert.equal(qq.kind, 'platform');
  assert.deepEqual(qq.capabilities, ['send', 'members', '42']);
  assert.deepEqual(qq.vars, { platform: 'QQ', displayName: 'QQ群' });
  assert.throws(() => normalizeAdapter('platform', { id: 'Q Q' }), /id 不合法/);
  assert.throws(() => normalizeAdapter('nope', { id: 'qq' }), /未知适配器类型/);
});

test('注册表：注册/列出/快照/按插件卸载/占用保护', () => {
  const log = [];
  const registry = createAdapterRegistry({ log: (line) => log.push(line) });
  registry.register('platform', { id: 'qq', label: 'QQ' }, 'core');
  registry.register('agent', { id: 'dsh', label: 'DSH' }, 'core');
  registry.register('platform', { id: 'bili', label: 'B站' }, 'plugin-demo');
  assert.deepEqual(registry.list('platform').map((item) => item.id), ['qq', 'bili']);
  assert.equal(registry.get('agent', 'dsh').label, 'DSH');
  assert.equal(registry.get('agent', 'nope'), null);
  assert.throws(() => registry.register('platform', { id: 'qq' }, 'plugin-demo'), /已被占用/);
  registry.unregisterPlugin('plugin-demo');
  assert.deepEqual(registry.list('platform').map((item) => item.id), ['qq']);
  const snapshot = registry.snapshot();
  assert.equal(snapshot.platform.length, 1);
  assert.equal(snapshot.agent.length, 1);
  assert.ok(log.some((line) => line.includes('platform/bili')));
});

test('内置适配器：QQ 平台 + DSH Agent，变量能渲染提示词', () => {
  const registry = createAdapterRegistry();
  for (const adapter of builtinAdapters()) registry.register(adapter.kind, adapter, 'core');
  const snapshot = registry.snapshot();
  assert.equal(snapshot.platform[0].id, 'qq');
  assert.equal(snapshot.agent[0].id, 'dsh');
  assert.ok(snapshot.platform[0].capabilities.includes('send'));
  const vars = registry.platformVars();
  assert.equal(renderPlatformPrompt('你在 {platform}，管理人是 {owner}。', vars), '你在 QQ，管理人是 管理员。');
});
