#!/usr/bin/env node
// C3 统一入站管线（docs/PLATFORM_UNIFICATION.md §六）。
//
// 这条回归钉的是**顺序**，不是「能不能跑通」：
//   校验 → 准入 → 会话映射 → 唤醒
// 尤其是「校验必须在准入之前」—— 准入要按会话读状态，一条畸形事件如果先进到准入，
// 插件就等于拿它去探「这个会话存不存在」。
import assert from 'node:assert/strict';
import test from 'node:test';

import { INBOUND_DROP, createInboundPipeline } from '../src/user-side/inbound.mjs';
import { resetEventSequence, validateUnifiedEvent } from '../src/user-side/event.mjs';
import { noticeToUnified } from '../src/user-side/adapters/qq/inbound.mjs';

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

/** 一条合法的拍一拍通知（适配器产出的形状）。 */
function pokeEvent(overrides = {}) {
  return {
    kind: 'notice',
    type: 'notice.poke',
    conversation: { type: 'group', id: '20001' },
    actor: { id: '30001', name: '群友' },
    notice: { type: 'poke', target: { id: '99999' }, detail: {} },
    ...overrides,
  };
}

/** 记录调用顺序的夹具：任何一步被调用都留痕，用来断言顺序与短路。 */
function harness({ admit = () => true, resolve, deliver } = {}) {
  const calls = [];
  const drops = [];
  const pipeline = createInboundPipeline({
    origin: ORIGIN,
    admit: (event) => {
      calls.push(['admit', event?.type]);
      return admit(event);
    },
    resolve: (event) => {
      calls.push(['resolve', event?.conversation?.id]);
      return resolve ? resolve(event) : { key: 'qq:group:20001', type: 'group', id: '20001' };
    },
    deliver: async (payload) => {
      calls.push(['deliver', payload.key]);
      return deliver ? deliver(payload) : undefined;
    },
    onDrop: (drop) => drops.push(drop),
  });
  return { pipeline, calls, drops };
}

test('合法事件走完四步，唤醒拿到管线拼好的地址与 key', async () => {
  resetEventSequence();
  const { pipeline, calls, drops } = harness();
  const result = await pipeline.emit(validEvent());

  assert.equal(result.ok, true, result.errors?.join('；'));
  assert.equal(result.key, 'qq:group:20001');
  assert.deepEqual(result.address, {
    platform: 'qq',
    account: 'bot-1',
    conversation: { type: 'group', id: '20001' },
  });
  assert.equal(result.event.platform, 'qq', 'platform 只认内核给的 origin');
  assert.equal(result.event.message.text, '在吗', 'text 由段推导，不采信插件写的那份');
  assert.deepEqual(calls, [['admit', 'message.group'], ['resolve', '20001'], ['deliver', 'qq:group:20001']]);
  assert.deepEqual(drops, []);
});

test('校验在准入之前：畸形事件连 admit 都到不了', async () => {
  const { pipeline, calls, drops } = harness();
  // 插件伪造 platform 不算错（内核会覆盖），但 conversation.type 非法是硬错。
  const result = await pipeline.emit(validEvent({ conversation: { type: 'Group!', id: '20001' } }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, INBOUND_DROP.INVALID);
  assert.deepEqual(calls, [], '校验失败时后续三步一律不调用');
  assert.equal(drops.length, 1);
  assert.equal(drops[0].reason, INBOUND_DROP.INVALID);
  assert.ok(drops[0].errors.length > 0);
});

test('伪造的 platform / account 被内核覆盖，不会串到别的平台', async () => {
  const { pipeline } = harness();
  const result = await pipeline.emit(validEvent({ platform: 'wechat', account: 'someone-else' }));

  assert.equal(result.ok, true);
  assert.equal(result.platform ?? result.address.platform, 'qq');
  assert.equal(result.address.account, 'bot-1');
  assert.equal(result.event.platform, 'qq');
  assert.equal(result.event.account, 'bot-1');
});

test('准入拒绝：不映射、不唤醒', async () => {
  const { pipeline, calls, drops } = harness({ admit: () => false });
  const result = await pipeline.emit(validEvent());

  assert.equal(result.ok, false);
  assert.equal(result.reason, INBOUND_DROP.NOT_ADMITTED);
  assert.deepEqual(calls, [['admit', 'message.group']]);
  assert.equal(drops.length, 1);
  assert.deepEqual(drops[0].errors, [], '拒绝不是错误，不该带异常文本');
});

test('准入抛错按拒绝处理（fail-closed），异常不外抛', async () => {
  const { pipeline } = harness({
    admit: () => {
      throw new Error('准入状态读坏了');
    },
  });
  const result = await pipeline.emit(validEvent());

  assert.equal(result.ok, false);
  assert.equal(result.reason, INBOUND_DROP.NOT_ADMITTED);
  assert.match(result.errors[0], /准入状态读坏了/);
});

test('会话映射拿不到 key 就丢弃，不拿半成品去唤醒', async () => {
  const { pipeline, calls, drops } = harness({ resolve: () => null });
  const result = await pipeline.emit(validEvent());

  assert.equal(result.ok, false);
  assert.equal(result.reason, INBOUND_DROP.UNRESOLVED);
  assert.deepEqual(calls, [['admit', 'message.group'], ['resolve', '20001']]);
  assert.equal(drops.length, 1);
});

test('会话映射抛错同样丢弃，且原因可追溯', async () => {
  const { pipeline } = harness({
    resolve: () => {
      throw new Error('会话表损坏');
    },
  });
  const result = await pipeline.emit(validEvent());

  assert.equal(result.ok, false);
  assert.equal(result.reason, INBOUND_DROP.UNRESOLVED);
  assert.match(result.errors[0], /会话表损坏/);
});

test('唤醒抛错：报 deliver_failed，不把异常抛给 WS 回调', async () => {
  const { pipeline, drops } = harness({
    deliver: () => {
      throw new Error('DSH 不可达');
    },
  });
  const result = await pipeline.emit(validEvent());

  assert.equal(result.ok, false);
  assert.equal(result.reason, INBOUND_DROP.DELIVER_FAILED);
  assert.match(result.errors[0], /DSH 不可达/);
  assert.equal(drops.length, 1);
});

test('唤醒可以拒绝：业务体不处理这类事件时按该原因记丢弃', async () => {
  const { pipeline, calls, drops } = harness({
    // 事件已过校验与准入，但唤醒侧决定不处理它。
    deliver: () => ({ reason: 'not_for_agent', errors: ['这类会话不交给 agent'] }),
  });
  const result = await pipeline.emit(validEvent());

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_for_agent', '拒绝的原因码要原样透出，不能被归成 deliver_failed');
  assert.deepEqual(result.errors, ['这类会话不交给 agent']);
  assert.deepEqual(calls, [['admit', 'message.group'], ['resolve', '20001'], ['deliver', 'qq:group:20001']]);
  assert.equal(drops.length, 1);
  assert.equal(drops[0].reason, 'not_for_agent');
});

test('唤醒返回空对象（普通成功）不算拒绝', async () => {
  const { pipeline } = harness({ deliver: () => ({ messageId: '1' }) });
  const result = await pipeline.emit(validEvent());
  assert.equal(result.ok, true);
});

test('审计自己抛错不影响结论：事件该丢还是丢、该过还是过', async () => {
  const pipeline = createInboundPipeline({
    origin: ORIGIN,
    admit: () => true,
    resolve: () => ({ key: 'qq:group:1', type: 'group', id: '1' }),
    deliver: async () => {},
    onDrop: () => {
      throw new Error('审计写盘失败');
    },
  });
  const bad = await pipeline.emit({ kind: 'nope' });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, INBOUND_DROP.INVALID);

  const good = await pipeline.emit(validEvent({ conversation: { type: 'group', id: '1' } }));
  assert.equal(good.ok, true);
});

test('装配缺项当场报错：来源与三步策略都必须显式给', () => {
  const base = {
    origin: ORIGIN,
    admit: () => true,
    resolve: () => ({ key: 'k', type: 'group', id: '1' }),
    deliver: async () => {},
  };
  assert.throws(() => createInboundPipeline({ ...base, origin: {} }), /来源平台/);
  assert.throws(() => createInboundPipeline({ ...base, admit: undefined }), /准入函数/);
  assert.throws(() => createInboundPipeline({ ...base, resolve: undefined }), /会话映射函数/);
  assert.throws(() => createInboundPipeline({ ...base, deliver: undefined }), /唤醒函数/);
});

test('通知事件同样走完四步：拿到 key 与地址，但没有 message 载荷', async () => {
  const { pipeline, calls, drops } = harness();
  const result = await pipeline.emit(pokeEvent());

  assert.equal(result.ok, true, result.errors?.join('；'));
  assert.equal(result.key, 'qq:group:20001');
  assert.equal(result.event.message, null);
  assert.equal(result.event.sender, null, '通知的当事人不叫 sender');
  assert.deepEqual(result.event.notice.target, { id: '99999' });
  assert.deepEqual(calls, [['admit', 'notice.poke'], ['resolve', '20001'], ['deliver', 'qq:group:20001']]);
  assert.deepEqual(drops, []);
});

test('通知类型是闭集：未知类型与 type 对不上都直接判非法，连 admit 都到不了', async () => {
  const { pipeline, calls } = harness();
  const unknown = await pipeline.emit(pokeEvent({ type: 'notice.typing', notice: { type: 'typing' } }));
  assert.equal(unknown.reason, INBOUND_DROP.INVALID);
  assert.match(unknown.errors.join('；'), /未知通知类型/);

  // type 与 notice.type 说的是同一件事，对不上说明适配器自己没想清楚。
  const mismatch = await pipeline.emit(pokeEvent({ type: 'notice.reaction' }));
  assert.equal(mismatch.reason, INBOUND_DROP.INVALID);
  assert.match(mismatch.errors.join('；'), /type 必须等于 notice\.poke/);
  assert.deepEqual(calls, [], '畸形通知不进准入');
});

test('拍一拍必须能回答「谁做的」；成员事件只认当事人', async () => {
  const { pipeline } = harness();
  const anonymous = await pipeline.emit(pokeEvent({ actor: undefined }));
  assert.equal(anonymous.ok, false);
  assert.match(anonymous.errors.join('；'), /必须带 actor/);

  // 系统自动处理的成员事件没有操作者：当事人放在 target 上就够了。
  const join = await pipeline.emit(pokeEvent({
    type: 'notice.member.join',
    actor: undefined,
    notice: { type: 'member.join', target: { id: '30002' }, detail: { subType: 'approve' } },
  }));
  assert.equal(join.ok, true, join.errors?.join('；'));
  assert.equal(join.event.actor, null);
  assert.deepEqual(join.event.notice.target, { id: '30002' });
});

test('非准入会话的通知被拦住：适配器不会自己放行', async () => {
  const { pipeline, calls, drops } = harness({ admit: () => false });
  const result = await pipeline.emit(pokeEvent());

  assert.equal(result.reason, INBOUND_DROP.NOT_ADMITTED);
  assert.deepEqual(calls, [['admit', 'notice.poke']]);
  assert.equal(drops.length, 1);
});

test('适配器：自己拍的不进管线；当事人与操作者分开，私聊里对端就是拍的人', () => {
  const unified = (raw) => validateUnifiedEvent(noticeToUnified(raw), ORIGIN);

  assert.equal(
    noticeToUnified({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', self_id: 999, group_id: 20001, sender_id: 999, target_id: 30001 }),
    null,
    '自己拍的不回灌：那不是我收到的事',
  );

  const poke = unified({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', self_id: 999, group_id: 20001, sender_id: 30001, target_id: 999, action: '拍了拍' });
  assert.equal(poke.ok, true, poke.errors?.join('；'));
  assert.equal(poke.event.type, 'notice.poke');
  assert.deepEqual(poke.event.actor, { id: '30001', name: '' });
  assert.equal(poke.event.notice.detail.selfInvolved, true, '被拍的是本账号');

  const direct = unified({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', self_id: 999, user_id: 30001, sender_id: 30001, target_id: 999 });
  assert.deepEqual(direct.event.conversation, { type: 'private', id: '30001' });

  const join = unified({ post_type: 'notice', notice_type: 'group_increase', sub_type: 'invite', group_id: 20001, user_id: 30002, operator_id: 30003 });
  assert.equal(join.event.type, 'notice.member.join');
  assert.deepEqual(join.event.notice.target, { id: '30002' });
  assert.deepEqual(join.event.actor, { id: '30003', name: '' });
  assert.equal(join.event.notice.detail.subType, 'invite');

  // 六种之外的 notice_type 不进统一事件：平台的开放词汇不该流进业务层。
  assert.equal(noticeToUnified({ post_type: 'notice', notice_type: 'group_ban', group_id: 20001, user_id: 30002 }), null);
});
