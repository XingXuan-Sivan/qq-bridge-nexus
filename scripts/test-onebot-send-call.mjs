#!/usr/bin/env node
// OneBot 发送调用收口：动作名、id 字段、以及「不猜」的两处抛错。
//
// 这条回归钉住 B1 的收口结果：原先 bridge.js 里有四处完全相同的三元式，现在都走
// oneBotSendCall。一旦有人把「未知 kind 当 group」或「空 id 转成 0」的宽容行为加回来，
// 消息就会静默发到错误会话 —— 所以这里必须抛错，不能兜底。
import assert from 'node:assert/strict';
import test from 'node:test';
import { ONEBOT_CONVERSATIONS, oneBotSendCall } from '../src/user-side/adapters/qq/onebot.mjs';

test('group 用 send_group_msg + group_id', () => {
  const message = [{ type: 'text', data: { text: 'hi' } }];
  const { action, params } = oneBotSendCall('group', '123456', message);
  assert.equal(action, 'send_group_msg');
  assert.deepEqual(params, { group_id: 123456, message });
});

test('private 用 send_private_msg + user_id', () => {
  const { action, params } = oneBotSendCall('private', 987654, []);
  assert.equal(action, 'send_private_msg');
  assert.deepEqual(params, { user_id: 987654, message: [] });
});

test('数字 id 原样转换，字符串 id 也接受', () => {
  assert.deepEqual(oneBotSendCall('group', 42, []).params.group_id, 42);
  assert.deepEqual(oneBotSendCall('group', ' 42 ', []).params.group_id, 42);
});

test('未知会话类型抛错，不猜成群聊', () => {
  for (const kind of [undefined, null, '', 'channel', 'GROUP', 'temp']) {
    assert.throws(() => oneBotSendCall(kind, '1', []), /未知会话类型/, `kind=${String(kind)}`);
  }
});

test('空 id 与非法 id 抛错，不静默发到 0 号会话', () => {
  for (const id of [undefined, null, '', '   ', 'abc', NaN, Infinity]) {
    assert.throws(() => oneBotSendCall('group', id, []), /需要数字 id/, `id=${String(id)}`);
  }
});

test('动作表只有 OneBot 真实存在的两种，字段名不可漂移', () => {
  assert.deepEqual(Object.keys(ONEBOT_CONVERSATIONS).sort(), ['group', 'private']);
  assert.equal(ONEBOT_CONVERSATIONS.group.action, 'send_group_msg');
  assert.equal(ONEBOT_CONVERSATIONS.group.field, 'group_id');
  assert.equal(ONEBOT_CONVERSATIONS.private.action, 'send_private_msg');
  assert.equal(ONEBOT_CONVERSATIONS.private.field, 'user_id');
});
