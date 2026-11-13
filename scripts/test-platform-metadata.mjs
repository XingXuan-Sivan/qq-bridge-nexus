// B7 平台元数据（docs/PLATFORM_DECOUPLING.md §6 的 B7 行）。
//
// 控制台 / 健康检查拿到的「有哪些平台、每个平台能做什么」只来自这两个纯查询。
// 这里钉住四件事：
//   · 元数据必须**只含常量**（函数、Socket、配置一条都不能漏进 /api 响应）；
//   · 内置与插件两来源合成一张表，且插件那侧带 owner（卸载时要按它批量清）；
//   · resolveSendTarget 的校验顺序：平台已注册 → 会话类型被声明 → 才拼 key；
//   · 声明为空时不校验类型（插件可以只实现发送），但平台不存在一定抛错。
import assert from 'node:assert/strict';
import test from 'node:test';

import { userPlatformMetadata, userPlatformDescriptor, resolveSendTarget } from '../src/user-side/metadata.mjs';
import { registerTransport, resetTransports } from '../src/user-side/transport.mjs';
import { activeUserPlatformId, userPlatform } from '../src/user-side/runtime-registry.mjs';
import { agentPlatformMetadata } from '../src/agent-side/metadata.mjs';
import { activeAgentPlatformId } from '../src/agent-side/runtime-registry.mjs';

/** 元数据的每个字段都必须是可 JSON 化的常量：函数会变成 undefined，进而静默丢字段。 */
function assertPlainJson(value, label) {
  const json = JSON.stringify(value);
  assert.equal(json, JSON.stringify(JSON.parse(json)), `${label} 必须可无损 JSON 化`);
  assert.ok(!json.includes('function'), `${label} 里混进了函数`);
}

test('内置平台出现在元数据里，且带 limits 与 source/active', () => {
  const meta = userPlatformMetadata();
  assert.equal(meta.active, activeUserPlatformId());
  const qq = meta.platforms.find((p) => p.id === 'qq');
  assert.ok(qq, '内置平台必须在内置清单里');
  assert.equal(qq.source, 'builtin');
  assert.equal(qq.owner, null);
  assert.equal(qq.active, true);
  // limits 是控制台画表单要用的：B7 之前 listUserPlatforms 漏了它，控制台只能自己写死 4000。
  assert.equal(qq.limits.chunkChars, 4000);
  assert.equal(qq.limits.markdown, false);
  assertPlainJson(meta, 'userPlatformMetadata');
});

test('插件 transport 并入同一张表，带 owner 与自己的声明', () => {
  resetTransports();
  registerTransport({
    id: 'demo-plat', label: '演示', capabilities: ['text', 'image'],
    conversationTypes: ['Group', 'thread'], limits: { chunkChars: 1024 },
    send: async () => ({ messageId: 'x' }),
  }, 'plugin-a');
  const meta = userPlatformMetadata();
  const demo = meta.platforms.find((p) => p.id === 'demo-plat');
  assert.ok(demo, '插件注册的平台必须出现在元数据里');
  assert.equal(demo.source, 'plugin');
  assert.equal(demo.owner, 'plugin-a');
  assert.equal(demo.active, false, '插件平台不是当前平台时不标 active');
  assert.deepEqual(demo.conversationTypes, ['group', 'thread'], '会话类型按小写归一');
  assert.deepEqual(demo.capabilities, ['text', 'image']);
  assert.equal(demo.limits.chunkChars, 1024);
  resetTransports();
});

test('会话类型与限制也能只写在 create() 的产物上（B6 的注册形态）', () => {
  resetTransports();
  const instance = {
    conversationTypes: ['direct'],
    limits: { markdown: true },
    capabilities: ['mention'],
    send: async () => ({ messageId: 'y' }),
  };
  registerTransport({ id: 'inst-plat', instance }, 'plugin-b');
  const desc = userPlatformDescriptor('inst-plat');
  assert.deepEqual(desc.conversationTypes, ['direct']);
  assert.equal(desc.limits.markdown, true);
  assert.deepEqual(desc.capabilities, ['mention']);
  assert.equal(desc.source, 'plugin');
  resetTransports();
});

test('未注册的平台返回 null 描述；resolveSendTarget 抛错而不是拼一个假 key', () => {
  assert.equal(userPlatformDescriptor('nope'), null);
  assert.throws(() => resolveSendTarget({ platform: 'nope', type: 'group', id: '1' }), /用户平台未注册：nope/);
});

test('resolveSendTarget：平台缺省取当前平台，id 去前导零，account 进 key', () => {
  const plain = resolveSendTarget({ type: 'group', id: '00123456' });
  assert.deepEqual(plain, {
    platform: activeUserPlatformId(),
    account: '',
    type: 'group',
    id: '123456',
    key: `${activeUserPlatformId()}:group:123456`,
  });
  const withAccount = resolveSendTarget({ platform: 'qq', account: 'napcat', type: 'private', id: 42 });
  assert.equal(withAccount.key, 'qq@napcat:private:42');
  assert.equal(withAccount.account, 'napcat');
});

test('resolveSendTarget：平台没声明的会话类型被拒绝，且错误里带支持列表', () => {
  assert.throws(
    () => resolveSendTarget({ type: 'channel', id: '1' }),
    /平台 qq 不支持会话类型 channel（支持：group \/ private）/,
  );
});

test('resolveSendTarget：private 与 direct 是同一语义，按 shape 放行', () => {
  // key 里保留调用方给的写法（`private` 不改写成 `direct`）：改写的后果是同一会话
  // 在状态表里出现两个 key，历史消息对不上。
  const target = resolveSendTarget({ type: 'direct', id: '7' });
  assert.equal(target.key, 'qq:direct:7');
  assert.equal(target.type, 'direct');
});

test('resolveSendTarget：空 id 与空类型都给出可读错误', () => {
  assert.throws(() => resolveSendTarget({ type: 'group', id: '   ' }), /缺少会话 id（qq:group）/);
  assert.throws(() => resolveSendTarget({ id: '1' }), /缺少会话类型/);
});

test('resolveSendTarget：插件没声明会话类型时不校验类型（只实现发送也算合法平台）', () => {
  resetTransports();
  registerTransport({ id: 'send-only', send: async () => ({ messageId: 'z' }) }, 'plugin-c');
  const target = resolveSendTarget({ platform: 'send-only', type: 'whatever', id: 'abc' });
  assert.equal(target.key, 'send-only:whatever:abc');
  resetTransports();
});

test('插件平台与内置平台同名时以内置为准（注册表已拒绝冲突，描述侧也只出一份）', () => {
  assert.ok(userPlatform('qq'), '内置 qq 必须在注册表里');
  assert.equal(userPlatformDescriptor('qq').source, 'builtin');
  const ids = userPlatformMetadata().platforms.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, '元数据里平台 id 不得重复');
});

test('Agent 侧元数据：形状与 active 标记，且不泄漏 protocol', () => {
  const meta = agentPlatformMetadata();
  assert.equal(meta.active, activeAgentPlatformId());
  const dsh = meta.platforms.find((p) => p.id === 'dsh');
  assert.ok(dsh, '内置 Agent 平台必须在清单里');
  assert.equal(dsh.active, true);
  assertPlainJson(meta, 'agentPlatformMetadata');
  assert.ok(!JSON.stringify(meta).includes('NodeApiClient'), 'protocol 不该出现在 /api 响应里');
});
