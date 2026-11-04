#!/usr/bin/env node
/**
 * 会话映射表（`src/session/registry.mjs`）。
 *
 * 这些用例守的是「映射与策略指纹成对维护」这条规则，以及一个容易回归的细节：
 * `loadState()` 会把 `state` 整体替换成新对象，注册表必须跟着换，否则启动后第一次
 * 绑定就写进了一个已经没人读的旧对象（表现为「会话刚建就判成过期、无限重建」）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRegistry } from '../src/session/registry.mjs';

const make = () => {
  let state = { sessions: {}, sessionPolicies: {}, dormantSessions: {} };
  const registry = createSessionRegistry(() => state);
  return {
    registry,
    replaceState(next) { state = next; },
    get state() { return state; },
  };
};

test('bindSession 同时写映射与策略指纹', () => {
  const { registry, state } = make();
  registry.bindSession('group:1', 'sid-a', 'policy-1');
  assert.equal(registry.get('group:1'), 'sid-a');
  assert.equal(registry.policyOf('group:1'), 'policy-1');
  assert.deepEqual(state.sessions, { 'group:1': 'sid-a' });
  assert.deepEqual(state.sessionPolicies, { 'group:1': 'policy-1' });
});

test('unbind 两格一起删；drop 只删映射', () => {
  const { registry, state } = make();
  registry.bindSession('group:1', 'sid-a', 'p');
  registry.drop('group:1');
  assert.equal(registry.get('group:1'), null);
  assert.equal(registry.policyOf('group:1'), 'p');
  registry.unbind('group:1');
  assert.deepEqual(state.sessions, {});
  assert.deepEqual(state.sessionPolicies, {});
});

test('isCurrent 三条同时成立才算当前会话', () => {
  const { registry } = make();
  registry.bindSession('group:1', 'sid-a', 'p1');
  assert.equal(registry.isCurrent('group:1', 'sid-a', 'p1'), true);
  assert.equal(registry.isCurrent('group:1', 'sid-a', 'p2'), false, '策略变了应判旧（级别/模式指纹变化）');
  assert.equal(registry.isCurrent('group:1', 'sid-b', 'p1'), false, '映射换了应判旧');
  assert.equal(registry.isCurrent('group:1', 'sid-a', 'p1', { allowed: false }), false, '被移出白名单应判旧');
});

test('keys/ids/entries 反映当前映射，has 不把原型链算进来', () => {
  const { registry } = make();
  registry.bindSession('a', 'sid-1', 'p');
  registry.bindSession('b', 'sid-2', 'p');
  assert.deepEqual(registry.keys().sort(), ['a', 'b']);
  assert.deepEqual(registry.ids().sort(), ['sid-1', 'sid-2']);
  assert.deepEqual(registry.entries().sort(), [['a', 'sid-1'], ['b', 'sid-2']]);
  assert.equal(registry.has('a'), true);
  assert.equal(registry.has('toString'), false);
});

test('clearAll 清空两格', () => {
  const { registry, state } = make();
  registry.bindSession('a', 'sid-1', 'p');
  registry.clearAll();
  assert.deepEqual(state.sessions, {});
  assert.deepEqual(state.sessionPolicies, {});
});

test('state 被整体替换后注册表跟着走（loadState 的路径）', () => {
  const { registry, replaceState } = make();
  registry.bindSession('a', 'sid-1', 'p');
  replaceState({ sessions: { b: 'sid-2' }, sessionPolicies: { b: 'p2' }, dormantSessions: {} });
  assert.equal(registry.get('a'), null);
  assert.equal(registry.get('b'), 'sid-2');
  registry.bindSession('c', 'sid-3', 'p3');
  assert.equal(registry.get('c'), 'sid-3');
});

test('底层字段缺失或被写坏时就地修好，不抛错', () => {
  let state = { sessions: undefined, sessionPolicies: ['not', 'a', 'map'] };
  const registry = createSessionRegistry(() => state);
  assert.equal(registry.get('a'), null);
  registry.bindSession('a', 'sid-1', 'p');
  assert.deepEqual(state.sessionPolicies, { a: 'p' });
  assert.equal(state.sessions.a, 'sid-1');
});
