// `src/session/mode.mjs`：会话级运行模式的解析规则。
//
// 两条容易写错的边界：
//   1) closed-agent 是 owner 专属的全局排他模式，档案里的覆盖不能把它盖掉；
//   2) 其它会话在 closed-agent 下应判为 inactive（不许回落到 chat 偷跑）。
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

test('closed-agent 下非 owner 判为 inactive，不能回落 chat', () => {
  assert.equal(resolveEffectiveMode('closed-agent', 'inherit', { owner: false }), 'inactive');
  assert.equal(resolveEffectiveMode('closed-agent', 'reserved2', { owner: false }), 'inactive');
});
