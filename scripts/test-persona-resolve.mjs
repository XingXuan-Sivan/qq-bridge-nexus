// 人格三层解析回归（docs/PERSONA_PROVIDER.md §4）。
//
// 钉住的是「优先级」而不是具体 provider：会话覆盖 → provider → 全局本地卡，
// 以及两个容易写错的分支：off 必须硬覆盖 provider；会话指定的本地卡缺失时要继续往下落。
import assert from 'node:assert/strict';
import test from 'node:test';

import { createPersonaResolver } from '../src/persona-resolve.mjs';

function makeResolver({ source = 'global', sessionName = null, globalName = '星苒', cards = {}, provider = null } = {}) {
  const logs = [];
  const warmed = [];
  const resolver = createPersonaResolver({
    plugins: provider ? { personaResolve: (key) => provider(key), personaWarm: (key, opts) => { warmed.push({ key, opts }); return Promise.resolve('warmed'); } } : null,
    roleSourceFor: () => source,
    roleNameFor: () => sessionName,
    roleCardFor: (name) => (cards[name] ? { text: cards[name], fingerprint: `fp-${name}` } : null),
    globalRoleName: () => globalName,
    log: (line) => logs.push(line),
  });
  return { resolver, logs, warmed };
}

test('L1 会话卡优先于 provider 与全局', () => {
  const { resolver } = makeResolver({ source: 'key', sessionName: '魅魔', cards: { 魅魔: '魅魔卡' }, provider: () => ({ name: '星苒', text: 'provider 卡' }) });
  assert.deepEqual(resolver.resolve('group:1'), { kind: 'card', source: 'session', name: '魅魔', text: '魅魔卡', fingerprint: 'fp-魅魔' });
});

test('off 是硬覆盖：provider 与全局都不生效', () => {
  const { resolver } = makeResolver({ source: 'off', provider: () => ({ name: '星苒', text: 'provider 卡' }) });
  assert.deepEqual(resolver.resolve('group:1'), { kind: 'off', source: 'session' });
});

test('会话指定的本地卡不存在：告警并落到 provider', () => {
  const { resolver, logs } = makeResolver({ source: 'key', sessionName: '不存在的卡', provider: () => ({ name: '星苒', text: 'provider 卡' }) });
  const result = resolver.resolve('group:1');
  assert.equal(result.source, 'provider');
  assert.equal(result.text, 'provider 卡');
  assert.ok(logs.some((line) => line.includes('不存在的卡')));
});

test('没有 provider 命中时回落到全局本地卡', () => {
  const { resolver } = makeResolver({ cards: { 星苒: '全局卡' }, provider: () => null });
  assert.equal(resolver.resolve('group:1').source, 'global');
  assert.equal(resolver.resolve('group:1').text, '全局卡');
});

test('三层都没有卡：返回 none，不编造内容', () => {
  const { resolver } = makeResolver({ globalName: null, provider: () => null });
  assert.deepEqual(resolver.resolve('group:1'), { kind: 'none', source: 'none' });
});

test('provider 卡带 stale 标记时原样透传（供控制台显示）', () => {
  const { resolver } = makeResolver({ provider: () => ({ name: '星苒', text: '旧卡', fingerprint: 'fp-x', stale: true }) });
  const result = resolver.resolve('group:1');
  assert.equal(result.source, 'provider');
  assert.equal(result.stale, true);
  assert.equal(result.fingerprint, 'fp-x');
});

test('warm 委托给内核；没有内核时是安全的空操作', async () => {
  const { resolver, warmed } = makeResolver({ provider: () => null });
  assert.equal(await resolver.warm('group:1'), 'warmed');
  assert.deepEqual(warmed, [{ key: 'group:1', opts: undefined }]);

  const bare = createPersonaResolver({ roleSourceFor: () => 'global', roleNameFor: () => null, roleCardFor: () => null, globalRoleName: () => null });
  assert.equal(await bare.warm('group:1'), null);
});
