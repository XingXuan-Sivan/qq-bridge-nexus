// `src/session/mode.mjs`：会话级运行模式的解析规则。
//
// 两条容易写错的边界：
//   1) closed-agent 是全局引擎，档案里的覆盖不能把它盖回 chat/仿真；
//   2) P6 起「谁可以用」不在这里判断——改由运行方案的 audience + 会话准入决定。
import test from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_MODES, isUsableMode, normalizeSessionMode, resolveEffectiveMode } from '../src/session/mode.mjs';

test('SESSION_MODES 只暴露四个可选值', () => {
  assert.deepEqual(SESSION_MODES, ['inherit', 'chat', 'reserved', 'reserved2']);
  assert.equal(isUsableMode('inactive'), false);
  assert.equal(isUsableMode('closed-agent'), true);
  assert.equal(isUsableMode('reserved2'), true);
});

test('inherit 跟随全局；非法覆盖值按 inherit 处理', () => {
  assert.equal(resolveEffectiveMode('chat', 'inherit'), 'chat');
  assert.equal(resolveEffectiveMode('reserved2', undefined), 'reserved2');
  assert.equal(resolveEffectiveMode('chat', 'closed-agent'), 'chat');
  assert.equal(resolveEffectiveMode('chat', 'nonsense'), 'chat');
  assert.equal(normalizeSessionMode('reserved2'), 'reserved2');
  assert.equal(normalizeSessionMode('closed-agent'), 'inherit');
});

test('普通模式下会话覆盖生效', () => {
  assert.equal(resolveEffectiveMode('chat', 'reserved2', { owner: false }), 'reserved2');
  assert.equal(resolveEffectiveMode('reserved2', 'chat', { owner: true }), 'chat');
});

test('closed-agent 全局排他：owner 仍是 closed-agent，覆盖无效', () => {
  assert.equal(resolveEffectiveMode('closed-agent', 'reserved2', { owner: true }), 'closed-agent');
  assert.equal(resolveEffectiveMode('closed-agent', 'chat', { owner: true }), 'closed-agent');
});

test('closed-agent 对所有会话生效（受众由方案 audience 决定，不在这里判 inactive）', () => {
  assert.equal(resolveEffectiveMode('closed-agent', 'inherit'), 'closed-agent');
  assert.equal(resolveEffectiveMode('closed-agent', 'reserved2'), 'closed-agent');
});
