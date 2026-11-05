// 会话 key 迁移脚本的纯函数测试（不碰真实 state/）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { platformizeKey, platformizeTree } from './migrate-session-keys.mjs';

test('platformizeKey 只认整串 key', () => {
  assert.equal(platformizeKey('private:123', 'qq'), 'qq:private:123');
  assert.equal(platformizeKey('group:456', 'qq'), 'qq:group:456');
  assert.equal(platformizeKey('private:123abc', 'qq'), null);
  assert.equal(platformizeKey('x:private:123', 'qq'), null);
  assert.equal(platformizeKey('qq:private:123', 'qq'), null, '已是新形态，不重复加前缀');
  assert.equal(platformizeKey('', 'qq'), null);
});

test('platformizeTree 同时改键与值', () => {
  const before = { sessions: { 'group:1': { id: 's' }, 'private:2': { id: 't' } }, note: 'private:3' };
  const stats = { keys: 0, values: 0 };
  const { value: after } = platformizeTree(before, 'qq', stats);
  assert.deepEqual(Object.keys(after.sessions), ['qq:group:1', 'qq:private:2']);
  assert.equal(after.note, 'qq:private:3');
  assert.equal(stats.keys, 2);
  assert.equal(stats.values, 1);
});

test('platformizeTree 不改数组元素顺序与普通字符串', () => {
  const before = { list: ['group:1', 'hello', 'private:2'], nested: [{ key: 'private:9' }] };
  const stats = { keys: 0, values: 0 };
  const { value: after } = platformizeTree(before, 'qq', stats);
  assert.deepEqual(after.list, ['qq:group:1', 'hello', 'qq:private:2']);
  assert.equal(after.nested[0].key, 'qq:private:9');
  assert.equal(stats.values, 3);
});

test('platformizeTree 幂等：跑第二遍不再变化', () => {
  const before = { 'group:1': 'private:2' };
  const first = platformizeTree(before, 'qq').value;
  const stats = { keys: 0, values: 0 };
  const second = platformizeTree(first, 'qq', stats).value;
  assert.deepEqual(second, first);
  assert.equal(stats.keys + stats.values, 0);
});

test('platformizeTree 保留非 key 字段与 null', () => {
  const before = { token: 'VbwT', at: null, ok: true, n: 3, target: 'group:7' };
  const stats = { keys: 0, values: 0 };
  const { value: after } = platformizeTree(before, 'qq', stats);
  assert.equal(after.token, 'VbwT');
  assert.equal(after.at, null);
  assert.equal(after.ok, true);
  assert.equal(after.n, 3);
  assert.equal(after.target, 'qq:group:7');
});
