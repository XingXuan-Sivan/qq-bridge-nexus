#!/usr/bin/env node
/**
 * 会话准入闸门（src/session/mode-gate.mjs）。
 *
 * 这些判断以前埋在 bridge.js 里，只能起整个桥接才能验证；搬出来之后
 * 这里用纯函数用例锁住三种语义：白名单优先于「默认放行」、deny 优先于 allow、
 * closed-agent 只放行 owner 私聊。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { allowed, modeAllowed, isSessionAllowedInCurrentMode } from '../src/session/mode-gate.mjs';

const cfg = (over = {}) => ({
  allow: { group: [], private: [] },
  deny: { group: [], private: [] },
  allowAllWhenEmpty: false,
  ownerQQ: 100001,
  ...over,
});

test('白名单为空时按 allowAllWhenEmpty 决定', () => {
  assert.equal(allowed('group', 123, cfg()), false);
  assert.equal(allowed('group', 123, cfg({ allowAllWhenEmpty: true })), true);
});

test('allow 列表命中才放行，且兼容单复数键名与字符串 id', () => {
  const c = cfg({ allow: { groups: [123, 456] } });
  assert.equal(allowed('group', '123', c), true);
  assert.equal(allowed('group', 127, c), false);
  // 复数键名同样对 private 生效
  assert.equal(allowed('private', 100001, cfg({ allow: { privates: [100001] } })), true);
});

test('deny 优先于 allow', () => {
  const c = cfg({ allow: { group: [123] }, deny: { groups: [123] } });
  assert.equal(allowed('group', 123, c), false);
});

test('closed-agent 只允许 owner 私聊，且不看白名单', () => {
  const c = cfg({ allowAllWhenEmpty: true, ownerQQ: '100001' });
  assert.equal(modeAllowed('private:100001', 'private', 100001, c, 'closed-agent'), true);
  assert.equal(modeAllowed('private:100002', 'private', 100002, c, 'closed-agent'), false);
  assert.equal(modeAllowed('group:123', 'group', 123, c, 'closed-agent'), false);
});

test('chat / reserved / reserved2 走白名单', () => {
  const c = cfg({ allow: { group: [123] } });
  for (const mode of ['chat', 'reserved', 'reserved2']) {
    assert.equal(modeAllowed('group:123', 'group', 123, c, mode), true, mode);
    assert.equal(modeAllowed('group:124', 'group', 124, c, mode), false, mode);
  }
});

test('isSessionAllowedInCurrentMode 只接受 group:/private: 形式', () => {
  const c = cfg({ allowAllWhenEmpty: true });
  assert.equal(isSessionAllowedInCurrentMode('group:123', c, 'chat'), true);
  assert.equal(isSessionAllowedInCurrentMode('private:100001', c, 'chat'), true);
  assert.equal(isSessionAllowedInCurrentMode('group:abc', c, 'chat'), false);
  assert.equal(isSessionAllowedInCurrentMode('team:123', c, 'chat'), false);
  assert.equal(isSessionAllowedInCurrentMode('', c, 'chat'), false);
});
