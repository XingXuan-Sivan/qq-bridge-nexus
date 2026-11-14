#!/usr/bin/env node
// 插件适配器注册表 + 平台声明面（C2b）。
//
// 两件事一起测：`adapters:provide` 的注册/卸载语义，以及「内置平台的 vars / configSchema
// 住在 profiles/* 里」这条不变式 —— 后者一旦退回代码里，就又是一个「新增平台要改 src/」。
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADAPTER_KINDS, createAdapterRegistry, normalizeAdapter } from '../src/platforms/adapter-registry.mjs';
import { PROMPT_VAR_KEYS, renderPlatformPrompt } from '../src/runtime/prompt-compose.mjs';
import { listAgentPlatformDirs, listPlatforms } from '../src/platforms/index.mjs';
import { normalizeConfigSchema } from '../src/plugins/config-schema.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLATFORMS = path.join(ROOT, 'profiles', 'platforms');
const AGENT_PLATFORMS = path.join(ROOT, 'profiles', 'agent-platforms');

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

test('注册表：注册/列出/按插件卸载/占用保护', () => {
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
  // 两侧仍然分开列：平台与 Agent 是两个 kind，不能合成一张表。
  assert.equal(registry.list('platform').length, 1);
  assert.equal(registry.list('agent').length, 1);
  assert.ok(log.some((line) => line.includes('platform/bili')));
});

test('平台声明面：vars 在 platform.yml，能渲染提示词占位符', () => {
  const profiles = listPlatforms({ root: PLATFORMS });
  assert.ok(profiles.length >= 1, 'profiles/platforms 下至少要有一个平台目录');
  const qq = profiles.find((item) => item.id === 'qq');
  assert.ok(qq, '内置平台 qq 的目录不见了');
  assert.equal(qq.vars.platform, 'QQ');
  assert.equal(qq.vars.owner, '管理员');
  assert.equal(
    renderPlatformPrompt('你在 {platform} 上说话，管理人是 {owner}。', qq.vars),
    '你在 QQ 上说话，管理人是 管理员。',
  );
});

test('平台声明面：两侧 configSchema 都能被同一套校验器解析', () => {
  for (const profile of listPlatforms({ root: PLATFORMS })) {
    const normalized = normalizeConfigSchema(profile.configSchema);
    assert.ok(normalized.ok, `${profile.id} 的 configSchema 不合法：${normalized.errors.join('；')}`);
    assert.ok(normalized.schema, `${profile.id} 缺 configSchema（控制台就没有表单，注册表也判不出 config_invalid）`);
    assert.equal(normalized.schema.additionalProperties, true,
      `${profile.id} 不该收紧 additionalProperties：行为选项不在这张表里穷举，收紧会把它们判成「未声明的配置项」`);
  }
  for (const profile of listAgentPlatformDirs({ root: AGENT_PLATFORMS })) {
    const normalized = normalizeConfigSchema(profile.configSchema);
    assert.ok(normalized.ok, `${profile.id} 的 configSchema 不合法：${normalized.errors.join('；')}`);
    assert.ok(normalized.schema, `${profile.id} 缺 configSchema`);
  }
});

test('内核不再持有内置平台清单', () => {
  // §4.4 删除清单：C2 之后 src/runtime/adapters.mjs 必须整份消失。
  // 保留一个空壳转发会让「顺手再加一个内置平台」重新变得比「写进 platform.yml」更容易。
  assert.equal(fs.existsSync(path.join(ROOT, 'src', 'runtime', 'adapters.mjs')), false,
    'src/runtime/adapters.mjs 应已删除：平台清单与 vars 的唯一源是 profiles/*');
});
