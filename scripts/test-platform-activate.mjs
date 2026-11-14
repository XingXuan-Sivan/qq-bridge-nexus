// 启动期平台激活：`platforms.active` 必须真的落到运行期（否则「改配置不切平台」）。
//
// 这层不碰网络也不读盘，但默认参数就是真的注册表 —— 所以除了注入的假注册表，
// 还要有一条用例走真实注册表，确认内置的 qq / dsh 能被点起来、拼错的 id 会被挡住。
import assert from 'node:assert/strict';
import test from 'node:test';

import { activatePlatforms } from '../src/platforms/activate.mjs';

/** 假注册表：记录被点了谁，非法 id 抛错（与真注册表同一套契约）。 */
function fakeRegistry(ids) {
  const calls = [];
  return {
    calls,
    use(id) {
      if (!ids.includes(id)) throw new Error(`平台未注册：${id}`);
      calls.push(id);
    },
    list() {
      return ids.map((id) => ({ id }));
    },
  };
}

const cfgWith = (active) => ({ platforms: { active } });

test('两侧都配了就各自激活一次', () => {
  const userRegistry = fakeRegistry(['qq', 'tg']);
  const agentRegistry = fakeRegistry(['dsh']);
  activatePlatforms(cfgWith({ user: 'tg', agent: 'dsh' }), { userRegistry, agentRegistry });
  assert.deepEqual(userRegistry.calls, ['tg']);
  assert.deepEqual(agentRegistry.calls, ['dsh']);
});

test('没配 active 就不干预（沿用注册表默认值，不算错）', () => {
  const userRegistry = fakeRegistry(['qq']);
  const agentRegistry = fakeRegistry(['dsh']);
  activatePlatforms({}, { userRegistry, agentRegistry });
  activatePlatforms(cfgWith({ user: '', agent: '   ' }), { userRegistry, agentRegistry });
  assert.deepEqual(userRegistry.calls, []);
  assert.deepEqual(agentRegistry.calls, []);
});

test('id 没注册：抛错并列出可用的 id，而不是带着错地址继续跑', () => {
  const userRegistry = fakeRegistry(['qq', 'tg']);
  const agentRegistry = fakeRegistry(['dsh']);
  assert.throws(
    () => activatePlatforms(cfgWith({ user: 'mastodon' }), { userRegistry, agentRegistry }),
    (error) => {
      assert.match(error.message, /platforms\.active\.user = mastodon 不可用/);
      assert.match(error.message, /qq \/ tg/, '要把可用的 id 说出来');
      return true;
    },
  );
  assert.deepEqual(userRegistry.calls, [], '失败的 id 不得被当成生效');
  assert.throws(
    () => activatePlatforms(cfgWith({ agent: 'openai' }), { userRegistry, agentRegistry }),
    /platforms\.active\.agent = openai 不可用.*已注册的Agent 平台：dsh/s,
  );
});

test('用户侧失败就不再激活 Agent 侧（fail-closed，不做半套）', () => {
  const userRegistry = fakeRegistry(['qq']);
  const agentRegistry = fakeRegistry(['dsh']);
  assert.throws(() => activatePlatforms(cfgWith({ user: 'nope', agent: 'dsh' }), { userRegistry, agentRegistry }));
  assert.deepEqual(agentRegistry.calls, []);
});

test('真实注册表：内置的 qq / dsh 能点起来，拼错的 id 被挡住', async () => {
  // 内置平台是在 builtin.mjs 的 import 期注册的（装配点）。生产里由 bridge.js 拉起的
  // user-platform / agent-side/runtime 间接求值；这里显式求值，才能真的验证「点得起来」。
  await import('../src/user-side/builtin.mjs');
  await import('../src/agent-side/builtin.mjs');
  const { listUserPlatforms, activeUserPlatformId } = await import('../src/user-side/runtime-registry.mjs');
  const { listAgentPlatforms, activeAgentPlatformId } = await import('../src/agent-side/runtime-registry.mjs');
  assert.ok(listUserPlatforms().some((item) => item.id === 'qq'));
  assert.ok(listAgentPlatforms().some((item) => item.id === 'dsh'));

  activatePlatforms(cfgWith({ user: 'qq', agent: 'dsh' }));
  assert.equal(activeUserPlatformId(), 'qq');
  assert.equal(activeAgentPlatformId(), 'dsh');

  assert.throws(() => activatePlatforms(cfgWith({ user: 'no-such-platform' })), /不可用/);
  assert.equal(activeUserPlatformId(), 'qq', '激活失败的调用不得把当前平台改坏');
});
