#!/usr/bin/env node
// QQ 入站（C3）：OneBot 报文 → 统一事件，以及 connect() 的订阅/退订契约。
//
// 这条回归盯的是「翻译是全函数」这件事：OneBot 生态里每天都在多出新的段类型
// （`face` 是内置表情，`json`/`xml` 是卡片），任何一条陌生段都不允许把整条消息
// 判成畸形 —— 入站是事实记录，宁可少一笔，也不能丢一条。
//
// 顺带钉住 connect() 的边界：
//   · 机器人自己发的消息不是入站（不剔掉会让 agent 模式回答自己）；
//   · 翻译只产出事件，不判白名单、不记审计（那是管线的活，两处都判就有两个原因）；
//   · close() 会真的退订；重复 connect() 不会把同一条消息投两遍。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  connectOneBot,
  isSelfMessage,
  oneBotSegmentsToNeutral,
  oneBotToUnified,
  resetOneBotClient,
  setOneBotClient,
} from '../src/user-side/adapters/qq/index.mjs';
import { INBOUND_DROP, createInboundPipeline } from '../src/user-side/inbound.mjs';
import { validateUnifiedEvent } from '../src/user-side/event.mjs';

/** 管线是异步的：push 之后要让出一轮事件循环，断言才能看到结果。 */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function groupMessage(overrides = {}) {
  return {
    post_type: 'message',
    message_type: 'group',
    self_id: 10000,
    time: 1731500000,
    message_id: 9001,
    message_seq: 12,
    group_id: 20001,
    user_id: 30001,
    message: [{ type: 'text', data: { text: '在吗' } }],
    raw_message: '在吗',
    sender: { user_id: 30001, nickname: '群友', card: '群名片' },
    ...overrides,
  };
}

function privateMessage(overrides = {}) {
  return {
    post_type: 'message',
    message_type: 'private',
    sub_type: 'friend',
    self_id: 10000,
    time: 1731500001,
    message_id: 9002,
    user_id: 30001,
    message: [{ type: 'text', data: { text: '私聊' } }],
    sender: { user_id: 30001, nickname: '好友' },
    ...overrides,
  };
}

/**
 * 假 WS 客户端：按 SDK 的真实分发语义实现订阅面 ——
 * `onMessage` 收全部消息，`onPrivateMessage` / `onGroupMessage` **各自只看自己那一类**
 * （如果两者都收全部，就测不出「同一个引用注册两次只剩一个」这类问题），
 * `onNotice` 只收通知。`notice: false` 模拟不带 onNotice 的老 SDK。
 */
function fakeClient({ sdk = 'onMessage', notice = true } = {}) {
  const routes = new Map(); // handler → { want, kind }
  const subscribe = (handler, route = {}) => {
    routes.set(handler, { want: null, kind: 'message', ...route });
    return () => routes.delete(handler);
  };
  const client = {
    isConnected: true,
    push(event) {
      for (const [handler, route] of [...routes]) {
        if (route.kind === 'notice' && event?.post_type !== 'notice') continue;
        if (route.kind === 'message' && event?.post_type === 'notice') continue;
        if (route.want && event?.message_type !== route.want) continue;
        handler(event);
      }
    },
    get listeners() {
      return routes.size;
    },
  };
  if (sdk === 'onMessage') client.onMessage = (handler) => subscribe(handler);
  else {
    client.onPrivateMessage = (handler) => subscribe(handler, { want: 'private' });
    client.onGroupMessage = (handler) => subscribe(handler, { want: 'group' });
  }
  if (notice) client.onNotice = (handler) => subscribe(handler, { kind: 'notice' });
  return client;
}

test('群消息：会话、发送者、正文与时间都翻译成中立形状', () => {
  const unified = oneBotToUnified(groupMessage());
  assert.equal(unified.kind, 'message');
  assert.equal(unified.type, 'message.group');
  assert.deepEqual(unified.conversation, { type: 'group', id: '20001' });
  // 三个名字各有用处：name 是「该叫这个人什么」，card / nickname 进人物库，role 进群角色。
  assert.deepEqual(unified.sender, { id: '30001', name: '群名片', card: '群名片', nickname: '群友' });
  // 翻译层只给 id，name 由内核在校验时补全。
  assert.deepEqual(unified.self, { id: '10000' });
  assert.equal(unified.message.seq, '12');
  assert.equal(unified.message.id, '9001');
  assert.deepEqual(unified.message.segments, [{ type: 'text', data: { text: '在吗' } }]);
  // OneBot 的 time 是秒：统一事件用毫秒，与 Date.now() 同尺度。
  assert.equal(unified.time, 1731500000000);
  // 原始报文必须原样留着：桥接侧的引用解析、合并转发、媒体下载都是 OneBot 形状。
  assert.equal(unified.ext.raw.message_seq, 12);
  // platform / account 不由适配器写：写了也会被内核的 origin 覆盖。
  assert.equal('platform' in unified, false);
});

test('私聊消息：type / 会话类型跟着 message_type 走', () => {
  const unified = oneBotToUnified(privateMessage());
  assert.equal(unified.type, 'message.private');
  assert.deepEqual(unified.conversation, { type: 'private', id: '30001' });
  assert.deepEqual(unified.sender, { id: '30001', name: '好友', nickname: '好友' });
});

test('翻译产物能过内核的事件校验（与管线的契约对齐）', () => {
  const checked = validateUnifiedEvent(oneBotToUnified(groupMessage()), { platform: 'qq', account: '10000' });
  assert.equal(checked.ok, true, checked.errors.join('；'));
  assert.equal(checked.event.platform, 'qq');
  assert.equal(checked.event.message.text, '在吗', 'text 由段推导');
});

test('自己发的消息：isSelfMessage 认得，翻译层会把它剔掉', () => {
  assert.equal(isSelfMessage(groupMessage({ user_id: 10000, sender: { user_id: 10000 } })), true);
  assert.equal(isSelfMessage(groupMessage()), false);
  // 没有 self_id 的报文（老网关/夹具）不当作自己：宁可多收一条，也不能吞掉别人的消息。
  assert.equal(isSelfMessage({ user_id: 10000 }), false);
});

test('陌生态降级成占位文本，绝不整条消息判成畸形', () => {
  const unified = oneBotToUnified(groupMessage({
    message: [
      { type: 'face', data: { id: '14' } },
      { type: 'json', data: { data: '{}' } },
      { type: 'at', data: { qq: '30002' } },
      { type: 'at', data: { qq: 'all' } },
      { type: 'text', data: { text: '看这个' } },
      { type: 'mface', data: { summary: '[动画表情]', url: 'https://public.invalid/e.gif' } },
    ],
  }));
  assert.deepEqual(unified.message.segments, [
    { type: 'text', data: { text: '[表情]' } },
    { type: 'text', data: { text: '[卡片消息]' } },
    { type: 'mention', data: { target: '30002' } },
    { type: 'text', data: { text: '@全体成员' } },
    { type: 'text', data: { text: '看这个' } },
    { type: 'sticker', data: { url: 'https://public.invalid/e.gif' } },
  ]);
  // 落进管线也要能过：陌生段不该把一条正常消息变成 INVALID。
  const checked = validateUnifiedEvent(unified, { platform: 'qq', account: '10000' });
  assert.equal(checked.ok, true, checked.errors.join('；'));
});

test('媒体段：有地址就保留，只有 id 没有地址就降成占位', () => {
  assert.deepEqual(oneBotSegmentsToNeutral([{ type: 'image', data: { file: 'abc.image', url: 'https://public.invalid/a.png' } }]), [
    { type: 'image', data: { file: 'abc.image', url: 'https://public.invalid/a.png' } },
  ]);
  // OneBot 的 record 是中立名 voice。
  assert.deepEqual(oneBotSegmentsToNeutral([{ type: 'record', data: { file: 'a.amr' } }]), [
    { type: 'voice', data: { file: 'a.amr' } },
  ]);
  // image 既没有 file 也没有 url：中立段判定非法 → 占位文本，消息本身还在。
  assert.deepEqual(oneBotSegmentsToNeutral([{ type: 'image', data: {} }]), [
    { type: 'text', data: { text: '[image]' } },
  ]);
});

test('CQ 字符串形态当一个文本段处理（不解析别家的语法）', () => {
  const unified = oneBotToUnified(groupMessage({ message: '你好[CQ:face,id=14]' }));
  assert.deepEqual(unified.message.segments, [{ type: 'text', data: { text: '你好[CQ:face,id=14]' } }]);
  assert.deepEqual(oneBotSegmentsToNeutral(''), []);
  assert.deepEqual(oneBotSegmentsToNeutral(null), []);
});

test('connect 没有客户端就当场报错（装配问题不该等到收不到消息才发现）', async () => {
  resetOneBotClient();
  await assert.rejects(connectOneBot({ onEvent: () => {} }), /还没有把 WS 客户端交给适配器/);
  await assert.rejects(connectOneBot({}), /缺少 onEvent/);
});

test('connect：订阅、投递、剔自己、close 退订、状态回调各就各位', async () => {
  resetOneBotClient();
  const client = fakeClient();
  setOneBotClient(() => client);
  const states = [];
  const seen = [];
  const handle = await connectOneBot({
    signal: null,
    onEvent: (event) => seen.push(event.conversation.id),
    onStatus: (status) => states.push(status.state),
  });
  assert.equal(client.listeners, 2, '消息一条订阅 + 通知一条订阅');
  assert.deepEqual(states, ['open']);

  client.push(groupMessage());
  client.push(privateMessage());
  // 自己发的：不进管线（reserved2 下 AI 会回答自己，chat 下可能自问自答）。
  client.push(groupMessage({ user_id: 10000, sender: { user_id: 10000 } }));
  assert.deepEqual(seen, ['20001', '30001']);

  await handle.close();
  assert.equal(client.listeners, 0, 'close() 必须真的退订');
  client.push(groupMessage());
  assert.equal(seen.length, 2, '退订后不再投递');
  assert.deepEqual(states, ['open', 'closed']);
  await handle.close();
  assert.deepEqual(states, ['open', 'closed'], 'close 幂等');
});

test('connect：老 SDK 只有 onPrivateMessage/onGroupMessage 时同样能收', async () => {
  resetOneBotClient();
  const client = fakeClient({ sdk: '分开了' });
  setOneBotClient(() => client);
  const seen = [];
  const handle = await connectOneBot({ onEvent: (event) => seen.push(event.type) });
  assert.equal(client.listeners, 3, '私聊 + 群聊 + 通知');
  client.push(groupMessage());
  assert.deepEqual(seen, ['message.group']);
  await handle.close();
  assert.equal(client.listeners, 0);
});

test('重复 connect 会先摘掉旧订阅：同一条消息不能投两遍', async () => {
  resetOneBotClient();
  const client = fakeClient();
  setOneBotClient(() => client);
  const seen = [];
  const first = await connectOneBot({ onEvent: () => seen.push('first') });
  const second = await connectOneBot({ onEvent: () => seen.push('second') });
  assert.equal(client.listeners, 2, '旧订阅必须已经摘掉');
  client.push(groupMessage());
  assert.deepEqual(seen, ['second']);
  await first.close();
  assert.equal(client.listeners, 2, '关旧句柄不能把新连接一起关掉');
  await second.close();
  assert.equal(client.listeners, 0);
});

test('通知走同一条出口：拍一拍/入群翻成统一事件，自己拍的不进管线', async () => {
  resetOneBotClient();
  const client = fakeClient();
  setOneBotClient(() => client);
  const seen = [];
  const states = [];
  const handle = await connectOneBot({
    onEvent: (event) => seen.push(event),
    onStatus: (status) => states.push(status),
  });
  assert.deepEqual(states.map((s) => s.state), ['open']);

  client.push({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', self_id: 10000, group_id: 20001, user_id: 30001, sender_id: 30001, target_id: 10000 });
  client.push({ post_type: 'notice', notice_type: 'group_increase', group_id: 20001, user_id: 30002 });
  await flush();
  assert.deepEqual(seen.map((e) => e.type), ['notice.poke', 'notice.member.join']);
  assert.deepEqual(seen[0].conversation, { type: 'group', id: '20001' });
  assert.deepEqual(seen[0].notice.target, { id: '10000' });

  // 自己拍的是我发出的事，不是收到的；六种之外的 notice_type 不进内核。
  client.push({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', self_id: 10000, group_id: 20001, sender_id: 10000, target_id: 30001 });
  client.push({ post_type: 'notice', notice_type: 'group_ban', group_id: 20001, user_id: 30002 });
  await flush();
  assert.equal(seen.length, 2);
  await handle.close();
});

test('老 SDK 没有 onNotice：入站照常打开，状态里写明通知收不到', async () => {
  resetOneBotClient();
  const client = fakeClient({ notice: false });
  setOneBotClient(() => client);
  const states = [];
  const handle = await connectOneBot({ onEvent: () => {}, onStatus: (status) => states.push(status) });
  assert.equal(client.listeners, 1, '只有消息订阅');
  assert.equal(states[0].state, 'open');
  assert.match(states[0].detail, /没有 onNotice/);
  await handle.close();
});

test('signal 已中止：不订阅、不投递', async () => {
  resetOneBotClient();
  const client = fakeClient();
  setOneBotClient(() => client);
  const controller = new AbortController();
  controller.abort();
  const handle = await connectOneBot({ signal: controller.signal, onEvent: () => {}, onStatus: () => {} });
  assert.equal(client.listeners, 0, '中止的 signal 不该建立订阅');
  await handle.close();
});

test('onEvent 抛错不影响后续消息：WS 回调整条链不能因为下游失败而断', async () => {
  resetOneBotClient();
  const client = fakeClient();
  setOneBotClient(() => client);
  const errors = [];
  let calls = 0;
  const handle = await connectOneBot({
    onEvent: () => {
      calls += 1;
      throw new Error('下游炸了');
    },
    onStatus: (status) => { if (status.state === 'error') errors.push(status.detail); },
  });
  client.push(groupMessage());
  client.push(groupMessage());
  assert.equal(calls, 2);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /下游炸了/);
  await handle.close();
});

test('翻译不判准入：白名单/审计只该有一处（管线），适配器只管把报文交出去', async () => {
  resetOneBotClient();
  const client = fakeClient();
  setOneBotClient(() => client);
  const drops = [];
  const delivered = [];
  const inbound = createInboundPipeline({
    origin: { platform: 'qq', account: '10000' },
    admit: () => false, // 一律拒绝
    resolve: (event) => ({ key: `qq:${event.conversation.type}:${event.conversation.id}`, type: event.conversation.type, id: event.conversation.id }),
    deliver: (payload) => delivered.push(payload),
    onDrop: (drop) => drops.push(drop),
  });
  const handle = await connectOneBot({ onEvent: (event) => inbound.emit(event) });
  client.push(groupMessage());
  await flush();
  assert.deepEqual(delivered, [], '没准入就不该唤醒');
  assert.equal(drops.length, 1);
  assert.equal(drops[0].reason, INBOUND_DROP.NOT_ADMITTED);
  await handle.close();
});
