// 运行期组合语义：引擎由行为档案决定、能力由能力档决定、受众由能力档申报。
//
// 这三条一旦被写死成「装了 Agent 工具就只能闭门当 Agent」，就再也组合不出
// 「带人格的 Agent 进群聊」；这里用 bridge 内部函数把边界钉住。
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const GROUP = 'qq:group:456';
const PRIVATE = 'qq:private:123';

test('能力档与行为解耦：owner 能力档 + 仿真行为，引擎仍按行为投影成 reserved2', async () => {
  const h = await bridgeHarness();
  try {
    h.state.profiles[GROUP] = { capability: 'full', behavior: 'social-v2' };
    assert.equal(h.effectiveMode(GROUP), 'reserved2');
    h.state.profiles[PRIVATE] = { capability: 'full', behavior: 'social-v2' };
    assert.equal(h.effectiveMode(PRIVATE), 'reserved2');
  } finally {
    await h.close();
  }
});

test('受众 owner：群聊被拦下，管理员私聊照常', async () => {
  const h = await bridgeHarness();
  try {
    h.state.profiles[GROUP] = { capability: 'full', behavior: 'social-v2' };
    assert.equal(h.passiveAllowed(GROUP), false);
    h.state.profiles[PRIVATE] = { capability: 'full', behavior: 'social-v2' };
    assert.equal(h.passiveAllowed(PRIVATE), true);
  } finally {
    await h.close();
  }
});

test('未单独指定行为的会话走用户平台条目的 defaultBehavior', async () => {
  const h = await bridgeHarness({ config: { platforms: { users: { qq: { defaultBehavior: 'social-v1' } } } } });
  try {
    h.state.profiles[GROUP] = { behavior: 'inherit' };
    assert.equal(h.effectiveMode(GROUP), 'reserved');
  } finally {
    await h.close();
  }
});

test('未单独指定能力档的会话走 Agent 平台申报的 defaultCapability', async () => {
  const h = await bridgeHarness();
  try {
    // chat-v2 的 audience 是缺省的 access：群里不因受众被拦。
    h.state.profiles[GROUP] = { behavior: 'none' };
    assert.equal(h.passiveAllowed(GROUP), true);
    // 缺省档不直通：权限仍归桥接，引擎按行为走聊天。
    assert.equal(h.permissionAuthorityOf(GROUP), 'bridge');
    assert.equal(h.effectiveMode(GROUP), 'chat');
  } finally {
    await h.close();
  }
});
