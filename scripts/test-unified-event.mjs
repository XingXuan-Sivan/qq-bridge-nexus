#!/usr/bin/env node
// B6 统一入站事件（docs/PLATFORM_DECOUPLING.md §3.3）。
//
// 这条回归的重点不是「能不能校验」，而是**谁能决定 platform**：
// 插件 transport 产出的事件里写 `platform: 'qq'` 必须被内核覆盖掉，否则一个插件
// 可以冒充 qq 的事件，绕开按平台分流的准入与限流（§5.3 第 1 条）。
import assert from 'node:assert/strict';
import test from 'node:test';

import { EVENT_KINDS, validateUnifiedEvent, resetEventSequence } from '../src/user-side/event.mjs';

const ORIGIN = { platform: 'qq', account: 'bot-1' };

function validEvent(overrides = {}) {
  return {
    kind: 'message',
    type: 'message.group',
    conversation: { type: 'group', id: '20001' },
    sender: { id: '30001', name: '群友' },
    message: { id: '123456', segments: [{ type: 'text', data: { text: '在吗' } }] },
    ...overrides,
  };
}

test('事件大类恰好五种', () => {
  assert.deepEqual([...EVENT_KINDS], ['message', 'notice', 'request', 'meta', 'agent']);
});

test('合法消息事件通过，并补全 v / time / platform / account', () => {
  resetEventSequence();
  const before = Date.now();
  const result = validateUnifiedEvent(validEvent(), ORIGIN);
  assert.equal(result.ok, true, result.errors.join('；'));
  const event = result.event;
  assert.equal(event.v, 1);
  assert.equal(event.platform, 'qq');
  assert.equal(event.account, 'bot-1');
  assert.equal(event.id, 'evt_1', '缺省 id 用本进程单调序号');
  assert.ok(event.time >= before);
  assert.deepEqual(event.conversation, { type: 'group', id: '20001' });
  assert.equal(event.message.text, '在吗', 'text 由段推导');
  assert.deepEqual(event.ext, {});
});

test('插件伪造的 platform/account 被内核覆盖', () => {
  const result = validateUnifiedEvent(validEvent({ platform: 'wechat', account: 'someone-else' }), ORIGIN);
  assert.equal(result.ok, true);
  assert.equal(result.event.platform, 'qq');
  assert.equal(result.event.account, 'bot-1');
});

test('内核不给 platform 时拒绝接收（不让插件自带来源）', () => {
  const result = validateUnifiedEvent(validEvent(), {});
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /内核未提供 platform/);
});

test('形状不合法逐条报错：kind / type / conversation / message', () => {
  assert.equal(validateUnifiedEvent(validEvent({ kind: 'weird' }), ORIGIN).ok, false);
  assert.equal(validateUnifiedEvent(validEvent({ type: 'notice.group' }), ORIGIN).ok, false, 'type 必须以 kind 开头');
  assert.equal(validateUnifiedEvent(validEvent({ type: '' }), ORIGIN).ok, false);
  assert.equal(validateUnifiedEvent(validEvent({ conversation: { type: 'Group!' } }), ORIGIN).ok, false);
  assert.equal(validateUnifiedEvent(validEvent({ conversation: { type: 'group', id: '' } }), ORIGIN).ok, false);
  assert.equal(validateUnifiedEvent(validEvent({ message: undefined }), ORIGIN).ok, false);
  assert.equal(validateUnifiedEvent(validEvent({ message: { segments: [{ type: 'nope' }] } }), ORIGIN).ok, false);
  assert.equal(validateUnifiedEvent(null, ORIGIN).ok, false);
});

test('非消息事件不需要 message；通知必须带 notice 与当事人', () => {
  const noPayload = validateUnifiedEvent({
    kind: 'notice',
    type: 'notice.poke',
    conversation: { type: 'private', id: '30001' },
    actor: { id: '30001' },
  }, ORIGIN);
  assert.equal(noPayload.ok, false, '没带 notice 的通知是半成品');
  assert.match(noPayload.errors.join('；'), /必须带 notice/);

  const notice = validateUnifiedEvent({
    kind: 'notice',
    type: 'notice.poke',
    conversation: { type: 'private', id: '30001' },
    actor: { id: '30001', name: '好友' },
    notice: { type: 'poke', target: { id: '30002' } },
  }, ORIGIN);
  assert.equal(notice.ok, true, notice.errors.join('；'));
  assert.equal(notice.event.message, null);
  assert.equal(notice.event.sender, null, '通知的当事人不叫 sender');
  assert.deepEqual(notice.event.actor, { id: '30001', name: '好友' });
  assert.deepEqual(notice.event.notice.target, { id: '30002' });
  assert.deepEqual(notice.event.notice.detail, {}, '没给细节就是一个空包');
});

test('事件 id 单调递增，已有的 id 保留', () => {
  resetEventSequence();
  const a = validateUnifiedEvent(validEvent(), ORIGIN).event;
  const b = validateUnifiedEvent(validEvent(), ORIGIN).event;
  const c = validateUnifiedEvent(validEvent({ id: 'vendor-42' }), ORIGIN).event;
  assert.deepEqual([a.id, b.id, c.id], ['evt_1', 'evt_2', 'vendor-42']);
});

test('ext 是平台逃生舱：原样保留，不被内核解释', () => {
  const ext = { qq: { raw_type: 'group_message', seq: 7 } };
  const result = validateUnifiedEvent(validEvent({ ext }), ORIGIN);
  assert.deepEqual(result.event.ext, ext);
});
