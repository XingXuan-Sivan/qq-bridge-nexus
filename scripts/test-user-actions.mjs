// 用户侧动作面：内核词表 + 声明通道 + QQ 适配器的落地口径。
//
// 为什么单独成文件而不并进 test-platform-adapters：
// 那边钉的是「适配器目录与静态描述」，这里钉的是**动作被执行时**的行为 ——
// 谁声明了什么、没声明时降级还是抛错、参数变成哪个 OneBot 动作。
// 这些一旦悄悄改变，用户看到的是「有时拍得动有时没反应」，而不是一条异常。
import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTIONS, ACTION_NAMES, ActionUnsupportedError, actionSpec, callAction } from '../src/user-side/actions.mjs';
import { registerUserPlatform, unregisterUserPlatform, requireUserPlatform } from '../src/user-side/runtime-registry.mjs';
import { registerBuiltinUserPlatforms } from '../src/user-side/builtin.mjs';
import * as qq from '../src/user-side/adapters/qq/index.mjs';
import { setOneBotClient, resetOneBotClient } from '../src/user-side/adapters/qq/index.mjs';
import { setOneBotBackend, resetOneBotBackend } from '../src/user-side/adapters/qq/index.mjs';

// 最小合法 GIF（1x1）：收藏表情要真字节，但不需要真图片。
const GIF = Buffer.from('47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b', 'hex');

/** 记录每次调用并按动作名返回假回执的 OneBot 客户端。 */
function fakeClient(log, replies = {}) {
  const reply = (action) => {
    const fn = replies[action];
    if (typeof fn === 'function') return fn();
    if (fn) return fn;
    return { status: 'ok', retcode: 0, data: null };
  };
  return {
    request: async (action, params, opts) => { log.push({ via: 'request', action, params, opts }); return reply(action); },
    raw: async (action, params, opts) => { log.push({ via: 'raw', action, params, opts }); return reply(action); },
    sendGroupMessage: async (id, message) => { log.push({ via: 'sendGroupMessage', id, message }); return reply('sendGroupMessage'); },
    sendPrivateMessage: async (id, message) => { log.push({ via: 'sendPrivateMessage', id, message }); return reply('sendPrivateMessage'); },
  };
}

const json = (value) => JSON.parse(JSON.stringify(value));

test('词表与规格 §3.2 一致：13 项，每项都有 risk / fallback / scope', () => {
  assert.deepEqual(ACTION_NAMES, [
    'message.send', 'message.reply', 'message.recall', 'message.forward',
    'reaction.add', 'poke.send', 'message.get',
    'history.get', 'forward.get',
    'member.list', 'member.get',
    'sticker.list', 'sticker.save',
  ]);
  for (const [name, spec] of Object.entries(ACTIONS)) {
    assert.ok(['send', 'read', 'state'].includes(spec.risk), `${name} 的 risk 必须是 send / read / state`);
    assert.ok(['conversation', 'global'].includes(spec.scope), `${name} 的 scope 必须是 conversation / global`);
    assert.ok(Object.hasOwn(spec, 'fallback'), `${name} 必须显式声明 fallback`);
  }
  // 三档处置各有一个代表：基本盘不许缺、可以降成发消息、只能抛。
  assert.equal(ACTIONS['message.send'].fallback, null);
  assert.equal(ACTIONS['message.reply'].fallback, 'message.send');
  assert.equal(ACTIONS['message.recall'].fallback, 'throw');
  // 按 id 寻址的动作不属于任何会话；写错名字直接抛，不静默降级。
  assert.equal(ACTIONS['forward.get'].scope, 'global');
  assert.equal(ACTIONS['sticker.list'].scope, 'global');
  // 引用解析只需要一个 message id，拿不到会话地址。
  assert.equal(ACTIONS['message.get'].scope, 'global');
  assert.throws(() => actionSpec('message.teleport'), /未知的用户侧动作/);
});

test('没声明的动作抛 capability_unsupported（带动作名与平台 id）', async () => {
  const platform = {
    id: 'bare', label: 'Bare',
    conversationTypes: ['group'], capabilities: [],
    actions: ['message.send'],
    actionHandler: async () => ({ messageId: '1' }),
  };
  registerUserPlatform(platform);
  try {
    await assert.rejects(
      callAction('message.recall', { conversation: { type: 'group', id: '1' } }, { platform: 'bare' }),
      (error) => {
        assert.equal(error.code, 'capability_unsupported');
        assert.equal(error.action, 'message.recall');
        assert.equal(error.platform, 'bare');
        assert.ok(error instanceof ActionUnsupportedError);
        return true;
      },
    );
  } finally {
    unregisterUserPlatform('bare');
  }
});

test('降级：reply / reaction 在只有 message.send 的平台上变成发一条消息', async () => {
  const seen = [];
  const platform = {
    id: 'bare', label: 'Bare',
    conversationTypes: ['group'], capabilities: [],
    actions: ['message.send', 'forward.get'],
    actionHandler: async ({ name, params }) => { seen.push({ name, params }); return { messageId: '1' }; },
  };
  registerUserPlatform(platform);
  try {
    await callAction('message.reply', { conversation: { type: 'group', id: '1' }, text: '嗯' }, { platform: 'bare' });
    await callAction('reaction.add', { conversation: { type: 'group', id: '1' }, text: '嗯' }, { platform: 'bare' });
    assert.deepEqual(seen.map((x) => x.name), ['message.send', 'message.send']);
    // 降级不拼新参数：目标动作的入参就是一条消息的入参。
    assert.deepEqual(json(seen[0].params), { conversation: { type: 'group', id: '1' }, text: '嗯' });
  } finally {
    unregisterUserPlatform('bare');
  }
});

test('会话语义：作用于会话的动作必须给地址，按 id 寻址的动作不需要', async () => {
  const seen = [];
  registerUserPlatform({
    id: 'bare', label: 'Bare',
    conversationTypes: ['group'], capabilities: [],
    actions: ['message.send', 'forward.get'],
    actionHandler: async ({ name, params }) => { seen.push({ name, params }); return {}; },
  });
  try {
    // 缺地址：不许猜一个会话发出去。
    await assert.rejects(
      callAction('message.send', { text: 'x' }, { platform: 'bare' }),
      /需要 params\.conversation/,
    );
    // 空字段也算缺：type 或 id 少一个就已经不是完整地址。
    await assert.rejects(
      callAction('message.send', { conversation: { type: 'group', id: '' }, text: 'x' }, { platform: 'bare' }),
      /会话不完整/,
    );
    // global 动作原样传参，不塞一个伪造的会话。
    await callAction('forward.get', { id: 'f-1' }, { platform: 'bare' });
    assert.deepEqual(json(seen[0].params), { id: 'f-1' });
  } finally {
    unregisterUserPlatform('bare');
  }
});

// ── QQ 适配器的落地口径（T-035 的四条回归） ─────────────────────────────────

test('拍一拍：群走 group_poke、私聊走 send_poke，id 按数字传', async () => {
  const log = [];
  setOneBotClient(() => fakeClient(log));
  try {
    await qq.actionHandler({ name: 'poke.send', params: { conversation: { type: 'group', id: '123' }, targetId: '456' } });
    await qq.actionHandler({ name: 'poke.send', params: { conversation: { type: 'private', id: '456' } } });
    assert.deepEqual(log.map((x) => x.action), ['group_poke', 'send_poke']);
    assert.deepEqual(json(log[0].params), { group_id: 123, user_id: 456 });
    // 私聊拍一拍不需要目标：send_poke 自动路由到当前私聊对象。
    assert.deepEqual(json(log[1].params), { user_id: 456 });
  } finally {
    resetOneBotClient();
  }
});

test('历史消息：群/私聊落到不同动作，成功判据收在适配器里', async () => {
  const log = [];
  setOneBotClient(() => fakeClient(log, {
    get_group_msg_history: { status: 'ok', retcode: 0, data: { messages: [{ message_id: 1 }, { message_id: 2 }] } },
    get_friend_msg_history: { status: 'failed', retcode: 1200, wording: '权限不足' },
  }));
  try {
    const res = await qq.actionHandler({ name: 'history.get', params: { conversation: { type: 'group', id: '123' }, count: 50 } });
    assert.equal(res.messages.length, 2);
    // 返回的每一条都是统一事件：补收与实时入站读同一套字段。
    assert.equal(res.messages[0].message.id, '1');
    assert.equal(res.messages[0].kind, 'message');
    assert.deepEqual(json(log[0].params), { group_id: 123, count: 50 });
    await assert.rejects(
      qq.actionHandler({ name: 'history.get', params: { conversation: { type: 'private', id: '456' }, count: 50 } }),
      /get_friend_msg_history 失败.*权限不足/,
    );
    assert.deepEqual(json(log[1].params), { user_id: 456, count: 50 });
    // count 有上下界：内核传什么都没能把网关的拉取量放开到 500 以上。
    await qq.actionHandler({ name: 'history.get', params: { conversation: { type: 'group', id: '123' }, count: 9999 } });
    assert.equal(log[2].params.count, 500);
  } finally {
    resetOneBotClient();
  }
});

test('按 id 取消息：message.get 返回统一事件，取不到时给 null', async () => {
  const log = [];
  setOneBotClient(() => fakeClient(log, {
    get_msg: {
      status: 'ok', retcode: 0,
      data: {
        message_id: 9001, message_type: 'group', group_id: 456, user_id: 123, self_id: 999,
        message: [{ type: 'text', data: { text: '被引用的原文' } }],
        sender: { user_id: 123, card: '管理员' },
      },
    },
  }));
  try {
    const res = await qq.actionHandler({ name: 'message.get', params: { messageId: '9001', timeoutMs: 4321 } });
    assert.deepEqual(json(log[0].params), { message_id: 9001 });
    assert.equal(log[0].opts.timeoutMs, 4321, '慢取超时要透传给网关');
    assert.equal(res.event.message.id, '9001');
    assert.equal(res.event.message.text, '被引用的原文');
    assert.deepEqual(json(res.event.conversation), { type: 'group', id: '456' });
    assert.equal(res.event.sender.id, '123');

    // 回执里没有消息（已撤回等）：给 null 而不是抛，调用方当「引用原文不可用」。
    setOneBotClient(() => fakeClient(log, { get_msg: { status: 'ok', retcode: 0, data: null } }));
    assert.equal((await qq.actionHandler({ name: 'message.get', params: { messageId: '9002' } })).event, null);
    // 没有 id 是调用错误，不是平台能力缺失。
    await assert.rejects(qq.actionHandler({ name: 'message.get', params: {} }), /需要 messageId/);
  } finally {
    resetOneBotClient();
  }
});

test('合并转发：按 id 走 get_forward_msg，超时透传，原始回执原样返回', async () => {
  const log = [];
  setOneBotClient(() => fakeClient(log, { get_forward_msg: { status: 'ok', retcode: 0, data: { messages: [] } } }));
  try {
    const res = await qq.actionHandler({ name: 'forward.get', params: { id: 'f-9', timeoutMs: 4321 } });
    assert.deepEqual(log.map((x) => x.action), ['get_forward_msg']);
    assert.deepEqual(json(log[0].params), { id: 'f-9' });
    assert.equal(log[0].opts.timeoutMs, 4321);
    assert.deepEqual(json(res.raw), { status: 'ok', retcode: 0, data: { messages: [] } });
  } finally {
    resetOneBotClient();
  }
});

test('收藏表情（含备注）：先 add_custom_face 再用回执 id 写 modify_custom_face', async () => {
  const log = [];
  setOneBotClient(() => fakeClient(log, { add_custom_face: { status: 'ok', retcode: 0, data: { emoji_id: 'e-1' } } }));
  try {
    const res = await qq.actionHandler({
      name: 'sticker.save',
      params: { bytes: GIF, mimeType: 'image/gif', remark: '好图' },
    });
    assert.equal(res.id, 'e-1');
    assert.equal(res.remark, '好图');
    assert.deepEqual(log.map((x) => x.action), ['add_custom_face', 'modify_custom_face']);
    assert.match(log[0].params.file, /^base64:\/\//, 'SnowLuma 收 base64://');
    assert.deepEqual(json(log[1].params), { emoji_id: 'e-1', desc: '好图' });
  } finally {
    resetOneBotClient();
  }
});

test('只改备注：给 stickerId 时不收藏新表情，只调一次 modify_custom_face', async () => {
  const log = [];
  setOneBotClient(() => fakeClient(log));
  try {
    const res = await qq.actionHandler({ name: 'sticker.save', params: { stickerId: 'e-2', remark: '改过的备注' } });
    assert.equal(res.id, 'e-2');
    assert.deepEqual(log.map((x) => x.action), ['modify_custom_face']);
    assert.deepEqual(json(log[0].params), { emoji_id: 'e-2', desc: '改过的备注' });
  } finally {
    resetOneBotClient();
  }
});

test('表情列表：条目已经是中立形状，complete 由「拿到的比要的少」判定', async () => {
  const log = [];
  setOneBotClient(() => fakeClient(log, {
    fetch_custom_face_detail: {
      status: 'ok', retcode: 0,
      data: [{ emoji_id: 'e-1', resId: 'r-1', url: 'https://public.invalid/1.gif', md5: 'AA', desc: '第一张' }],
    },
  }));
  try {
    const res = await qq.actionHandler({ name: 'sticker.list', params: { count: 10 } });
    assert.deepEqual(json(res.entries), [{ id: 'e-1', resId: 'r-1', url: 'https://public.invalid/1.gif', md5: 'AA', desc: '第一张' }]);
    assert.equal(res.complete, true, '要 10 张只拿到 1 张 = 这就是全部');
    assert.deepEqual(json(log[0].params), { count: 10 });
  } finally {
    resetOneBotClient();
  }
});

test('后端身份：探测结果跟着连接走，换连接就重新问', async () => {
  try {
    setOneBotBackend(() => ({ stickerTempDir: '' }));
    // 连接 A：后端是 NapCat。base64 被拒后用一次探测确认身份。
    const log = [];
    setOneBotClient(() => fakeClient(log, {
      add_custom_face: (() => {
        let first = true;
        return () => {
          if (first) { first = false; return { status: 'failed', retcode: 200, wording: 'ENAMETOOLONG' }; }
          return { status: 'ok', retcode: 0, data: { result: 0 } };
        };
      })(),
      get_version_info: () => ({ status: 'ok', retcode: 0, data: { app_name: 'NapCat.Onebot' } }),
      fetch_custom_face_detail: { status: 'ok', retcode: 0, data: [{ emoId: 1, resId: 'r-1', md5: 'X' }] },
    }));
    // 找不到刚收藏的那张会报错，但探测已经发生 —— 这一步只验证探测本身。
    await qq.actionHandler({ name: 'sticker.save', params: { bytes: GIF, mimeType: 'image/gif' } }).catch(() => {});
    assert.ok(log.some((x) => x.action === 'get_version_info'), 'base64 被拒后问了后端身份');
    assert.equal(log.filter((x) => x.action === 'add_custom_face').length, 2, 'NapCat 会换本地路径再试一次');

    // 连接 B：换成另一个网关。不能沿用上一条连接的结论。
    const log2 = [];
    setOneBotClient(() => fakeClient(log2, {
      add_custom_face: { status: 'failed', retcode: 200, wording: 'ENAMETOOLONG' },
      get_version_info: () => ({ status: 'ok', retcode: 0, data: { app_name: 'SnowLuma' } }),
    }));
    await assert.rejects(qq.actionHandler({ name: 'sticker.save', params: { bytes: GIF, mimeType: 'image/gif' } }));
    assert.equal(log2.filter((x) => x.action === 'add_custom_face').length, 1, '不是 NapCat 就只试一次');
  } finally {
    resetOneBotClient();
    resetOneBotBackend();
  }
});

test('QQ 适配器声明的 9 个动作 = 当前确实实现的那些', () => {
  assert.deepEqual([...qq.actions], [
    'message.send', 'poke.send', 'message.get', 'history.get', 'forward.get',
    'member.list', 'member.get', 'sticker.list', 'sticker.save',
  ]);
  // 声明是超集的下限：词表里的每个声明都必须能在 handler 里落地。
  for (const name of qq.actions) assert.ok(ACTION_NAMES.includes(name), `${name} 不在词表里`);
  // 注册表（T-033）：控制台与内核读的就是这一份，不是另外抄一份。
  registerBuiltinUserPlatforms();
  assert.deepEqual([...requireUserPlatform('qq').actions], [...qq.actions]);
});
