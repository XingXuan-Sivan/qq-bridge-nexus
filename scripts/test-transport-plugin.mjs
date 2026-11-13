#!/usr/bin/env node
// B6 出站链路：插件 transport 与内置平台的两条路（docs/PLATFORM_DECOUPLING.md §5.2 / §5.3）。
//
// 这条回归钉住四件事：
//   1. 插件不能顶替内置平台（id 冲突拒绝），也不能顶替别的插件的平台（换 owner 拒绝）；
//   2. 降级发生在交给 transport **之前** —— 插件收不到超出自己能力声明的段；
//   3. QQ 的 OneBot 报文逐字段不变（动作名、group_id/user_id、at/record/reply 的还原），
//      这条断言是「收口没改行为」的唯一凭证；
//   4. 卸载按 owner 批量清干净，close() 留给内核上超时。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  registerTransport,
  getTransport,
  listTransports,
  unregisterTransportsByOwner,
  resetTransports,
} from '../src/user-side/transport.mjs';
import { sendAction, previewSegments } from '../src/user-side/outbound.mjs';
import { configureUserPlatformBackend, activeUserPlatformId } from '../src/user-side/user-platform.mjs';

const GROUP = { platform: 'qq', account: '10000', conversation: { type: 'group', id: '123456' } };

/** 记录一次发送的调用参数，返回可控的 messageId。 */
function recorder() {
  const calls = [];
  const send = async (payload) => {
    calls.push(payload);
    return { messageId: `m${calls.length}`, raw: { message_id: calls.length } };
  };
  return { calls, send };
}

/** 假 fetch：断言 URL 与 body，回一份 OneBot 成功回执。 */
function fakeFetch(responses = []) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init, body: init?.body ? JSON.parse(init.body) : null });
    const preset = responses.shift() ?? { status: 'ok', retcode: 0, data: { message_id: seen.length } };
    const status = preset.httpStatus ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => preset,
    };
  };
  fetchImpl.seen = seen;
  return fetchImpl;
}

test('内置平台 id 不许被插件顶替', () => {
  assert.equal(activeUserPlatformId(), 'qq');
  assert.throws(
    () => registerTransport({ id: 'qq', send: async () => ({}) }, 'evil'),
    /与内置平台冲突/,
  );
  assert.equal(getTransport('qq'), null);
  assert.equal(listTransports().length, 0);
});

test('id 与 send 是硬要求：非法 id 与缺 send 都拒绝', () => {
  assert.throws(() => registerTransport({ id: 'Q Q', send: async () => ({}) }, 'p1'), /id 不合法/);
  assert.throws(() => registerTransport({ id: 'x', send: async () => ({}) }, 'p1'), /id 不合法/);
  assert.throws(() => registerTransport({ id: 'demo', send: 'nope' }, 'p1'), /必须提供 send/);
});

test('换 owner 抢同一个 id 被拒绝，同 owner 允许覆盖（热重载）', () => {
  const first = registerTransport({ id: 'demo', label: '演示', capabilities: ['text'], send: async () => ({}) }, 'p1');
  assert.equal(first.owner, 'p1');
  assert.throws(
    () => registerTransport({ id: 'demo', send: async () => ({}) }, 'p2'),
    /平台 id 已被占用：demo（p1）/,
  );
  const again = registerTransport({ id: 'demo', label: '演示 v2', send: async () => ({}) }, 'p1');
  assert.equal(again.label, '演示 v2');
  assert.equal(listTransports().length, 1);
  resetTransports();
});

test('能力声明缺项时，transport 收到的是降级后的段（降级先于实现）', async () => {
  const { calls, send } = recorder();
  registerTransport({ id: 'demo', capabilities: ['text'], send }, 'p1');
  const result = await sendAction(
    { platform: 'demo', conversation: { type: 'channel', id: 'c1' } },
    [
      { type: 'mention', data: { target: '42' } },
      { type: 'text', data: { text: '你好' } },
      { type: 'image', data: { file: 'x.png' } },
    ],
  );
  assert.equal(calls.length, 1);
  // 声明里只有 text：mention 变正文、image 变占位符，transport 看不到原始段。
  assert.deepEqual(calls[0].segments, [
    { type: 'text', data: { text: '@42' } },
    { type: 'text', data: { text: '你好' } },
    { type: 'text', data: { text: '[图片]' } },
  ]);
  assert.deepEqual(result.degraded.map((item) => item.type), ['mention', 'image']);
  assert.equal(result.messageId, 'm1');
  resetTransports();
});

test('插件 transport 优先于内置适配器：未注册的平台不静默落到 QQ', async () => {
  resetTransports();
  const { calls, send } = recorder();
  registerTransport({ id: 'demo', capabilities: ['text'], send }, 'p1');
  await sendAction({ platform: 'demo', conversation: { type: 'direct', id: 'u1' } }, [{ type: 'text', data: { text: 'hi' } }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].address.platform, 'demo');
  await assert.rejects(
    sendAction({ platform: 'wechat', conversation: { type: 'direct', id: 'u1' } }, [{ type: 'text', data: { text: 'hi' } }]),
    /用户平台未注册：wechat/,
  );
  resetTransports();
});

test('QQ 报文逐字段不变：动作名、数字 id、at/record/reply 还原', async () => {
  const fetchImpl = fakeFetch();
  configureUserPlatformBackend(() => ({ httpUrl: 'http://127.0.0.1:3000/', accessToken: 'tk', fetch: fetchImpl }));
  const result = await sendAction(GROUP, [
    { type: 'reply', data: { messageId: '900' } },
    { type: 'mention', data: { target: '42' } },
    { type: 'text', data: { text: '看图' } },
    { type: 'image', data: { file: 'base64://xx' } },
    { type: 'voice', data: { file: 'a.silk' } },
  ]);
  assert.equal(fetchImpl.seen.length, 1);
  const call = fetchImpl.seen[0];
  assert.ok(call.url.endsWith('/send_group_msg'), call.url);
  assert.equal(call.url, 'http://127.0.0.1:3000/send_group_msg');
  assert.equal(call.init.headers.authorization, 'Bearer tk');
  assert.equal(typeof call.body.group_id, 'number');
  assert.equal(call.body.group_id, 123456);
  assert.deepEqual(call.body.message, [
    { type: 'reply', data: { id: '900' } },
    { type: 'at', data: { qq: '42' } },
    { type: 'text', data: { text: '看图' } },
    { type: 'image', data: { file: 'base64://xx' } },
    { type: 'record', data: { file: 'a.silk' } },
  ]);
  assert.equal(result.messageId, '1');
  assert.deepEqual(result.degraded, []);
});

test('QQ 私聊走 send_private_msg，id 落到 user_id', async () => {
  const fetchImpl = fakeFetch();
  configureUserPlatformBackend(() => ({ httpUrl: 'http://127.0.0.1:3000', accessToken: '', fetch: fetchImpl }));
  await sendAction(
    { platform: 'qq', conversation: { type: 'private', id: '777' } },
    [{ type: 'text', data: { text: 'hi' } }],
  );
  const call = fetchImpl.seen[0];
  assert.ok(call.url.endsWith('/send_private_msg'), call.url);
  assert.equal(call.body.user_id, 777);
  assert.equal(call.init.headers.authorization, undefined);
});

test('OneBot 回执异常时统一措辞，426 附带 httpUrl 指向 WS 端口的提示', async () => {
  const fetchImpl = fakeFetch([
    { httpStatus: 200, status: 'failed', retcode: 1200, wording: 'bad' },
    { httpStatus: 426, status: 'failed', retcode: 0 },
  ]);
  configureUserPlatformBackend(() => ({ httpUrl: 'http://127.0.0.1:3000', fetch: fetchImpl }));
  await assert.rejects(
    sendAction(GROUP, [{ type: 'text', data: { text: 'a' } }]),
    /OneBot send_group_msg 失败: bad/,
  );
  await assert.rejects(
    sendAction(GROUP, [{ type: 'text', data: { text: 'b' } }]),
    /HTTP 426：snowluma\.httpUrl 可能指向了 WebSocket 端口/,
  );
});

test('按 owner 注销：返回被移除的条目，别人的平台不受影响', () => {
  resetTransports();
  const a = registerTransport({ id: 'alpha', send: async () => ({}) }, 'p1');
  registerTransport({ id: 'beta', send: async () => ({}) }, 'p2');
  const removed = unregisterTransportsByOwner('p1');
  assert.deepEqual(removed.map((entry) => entry.id), ['alpha']);
  assert.equal(getTransport('alpha'), null);
  assert.equal(getTransport('beta')?.owner, 'p2');
  assert.equal(a.close, null);
  resetTransports();
  assert.equal(listTransports().length, 0);
});

test('create(config) 的产物挂在 instance 上，close 由内核在卸载时调用', async () => {
  let closed = 0;
  const instance = { close: async () => { closed += 1; } };
  const entry = registerTransport({ id: 'gamma', instance, send: async () => ({}) }, 'p1');
  assert.equal(entry.instance, instance);
  assert.equal(typeof entry.close, 'function');
  const [removed] = unregisterTransportsByOwner('p1');
  await removed.close();
  assert.equal(closed, 1);
});

test('previewSegments 只降级不发送（控制台预览用）', () => {
  const preview = previewSegments('qq', [{ type: 'poke', data: { target: '42' } }]);
  // QQ 声明了 poke 能力，所以原样保留，不会走「拍一拍」文本替身。
  assert.deepEqual(preview.segments, [{ type: 'poke', data: { target: '42' } }]);
  assert.deepEqual(preview.degraded, []);
  const demo = previewSegments('qq', [{ type: 'text', data: { text: 'x' } }]);
  assert.equal(demo.segments.length, 1);
});

test('同进程多平台在线：地址里的平台各自生效，既不串号也不回落 QQ', async () => {
  resetTransports();
  const alpha = recorder();
  const beta = recorder();
  registerTransport({ id: 'alpha', capabilities: ['text'], send: alpha.send }, 'p1');
  registerTransport({ id: 'beta', capabilities: ['text'], send: beta.send }, 'p2');
  const fetchImpl = fakeFetch();
  configureUserPlatformBackend(() => ({ httpUrl: 'http://127.0.0.1:3000', fetch: fetchImpl }));

  await sendAction({ platform: 'alpha', conversation: { type: 'dm', id: '1' } }, [{ type: 'text', data: { text: 'A' } }]);
  await sendAction({ platform: 'beta', conversation: { type: 'dm', id: '2' } }, [{ type: 'text', data: { text: 'B' } }]);
  await sendAction(GROUP, [{ type: 'text', data: { text: 'Q' } }]);

  assert.equal(alpha.calls.length, 1);
  assert.equal(beta.calls.length, 1);
  assert.equal(alpha.calls[0].segments[0].data.text, 'A');
  assert.equal(beta.calls[0].segments[0].data.text, 'B');
  assert.deepEqual(alpha.calls[0].address.conversation, { type: 'dm', id: '1' });
  assert.equal(fetchImpl.seen.length, 1, '只有 qq 那条落到内置适配器');
  assert.ok(fetchImpl.seen[0].url.endsWith('/send_group_msg'));

  // 两个插件平台分属不同 owner：注销一个不动另一个。
  unregisterTransportsByOwner('p1');
  assert.equal(getTransport('alpha'), null);
  assert.equal(getTransport('beta')?.owner, 'p2');
  resetTransports();
});
