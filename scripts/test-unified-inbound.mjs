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
import { resetEventSequence } from '../src/user-side/event.mjs';

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

test('非消息事件（notice/meta）同样进管线，但没有 message 载荷', async () => {
  const { pipeline } = harness();
  const result = await pipeline.emit({
    kind: 'notice',
    type: 'notice.notify',
    conversation: { type: 'group', id: '20001' },
    sender: { id: '30001', name: '群友' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.event.message, null);
});
