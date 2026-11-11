// 人格三层解析回归（docs/PERSONA_PROVIDER.md §4）。
//
// 钉住的是「优先级」而不是具体 provider：provider（外部，第一来源）→ 会话本地卡 → 全局本地卡，
// 以及两个容易写错的分支：off 必须硬覆盖 provider；provider 没卡时才回落本地。
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

test('provider 是外部第一来源：有卡时压过会话卡', () => {
  const { resolver } = makeResolver({ source: 'key', sessionName: '魅魔', cards: { 魅魔: '魅魔卡' }, provider: () => ({ name: '星苒', text: 'provider 卡' }) });
  const hit = resolver.resolve('group:1');
  assert.equal(hit.source, 'provider');
  assert.equal(hit.text, 'provider 卡');
  assert.equal(hit.stale, false);
});

test('provider 没卡时回落会话卡（本地是兜底，不告警）', () => {
  const { resolver, logs } = makeResolver({ source: 'key', sessionName: '魅魔', cards: { 魅魔: '魅魔卡' }, provider: () => null });
  assert.deepEqual(resolver.resolve('group:1'), { kind: 'card', source: 'session', name: '魅魔', text: '魅魔卡', fingerprint: 'fp-魅魔' });
  assert.equal(logs.some((line) => line.includes('魅魔')), false);
});

test('off 是硬覆盖：provider 与全局都不生效', () => {
  const { resolver } = makeResolver({ source: 'off', provider: () => ({ name: '星苒', text: 'provider 卡' }) });
  assert.deepEqual(resolver.resolve('group:1'), { kind: 'off', source: 'session' });
});

test('会话指定的本地卡不存在、provider 也没卡：告警并落到 none/全局', () => {
  const { resolver, logs } = makeResolver({ source: 'key', sessionName: '不存在的卡', globalName: null, provider: () => null });
  assert.deepEqual(resolver.resolve('group:1'), { kind: 'none', source: 'none' });
  assert.ok(logs.some((line) => line.includes('外部服务与本地都没取到')));
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
  // 新一轮语义：先普通预热，若仍没有 provider 卡（测试里 provider 恒为 null）再强制拉一次。
  assert.equal(warmed.length, 2);
  assert.equal(warmed[0].key, 'group:1');
  assert.equal(warmed[1].opts?.force, true);

  const bare = createPersonaResolver({ roleSourceFor: () => 'global', roleNameFor: () => null, roleCardFor: () => null, globalRoleName: () => null });
  assert.equal(await bare.warm('group:1'), null);
});
