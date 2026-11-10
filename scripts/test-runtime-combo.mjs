// P6：运行方案的组合语义 —— 引擎由行为决定、能力由工具决定、受众由方案决定。
//
// 这三条一旦写死成「工具是 qq-agent-* 就只能闭门当 Agent」，就再也组合不出
// 「带人格的 Agent 进群聊」；这里用 bridge 内部函数把边界钉住。
import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const COMBO = {
  id: 'agent-chat',
  label: '带人格的 Agent',
  tools: 'qq-agent-full',
  behavior: 'social-v2',
  audience: 'owner',
};

test('Agent 工具 + 仿真行为：引擎按行为投影成 reserved2，能力仍是 agent 预设', async () => {
  const h = await bridgeHarness({ config: { runtime: { plans: [COMBO] } } });
  try {
    h.state.profiles['qq:group:456'] = { planId: 'agent-chat', mode: 'inherit' };
    assert.equal(h.effectiveMode('qq:group:456'), 'reserved2');
    h.state.profiles['qq:private:123'] = { planId: 'agent-chat', mode: 'inherit' };
    assert.equal(h.effectiveMode('qq:private:123'), 'reserved2');
  } finally {
    await h.close();
  }
});

test('受众 owner：群聊被拦下，管理员私聊照常', async () => {
  const h = await bridgeHarness({ config: { runtime: { plans: [COMBO] } } });
  try {
    h.state.profiles['qq:group:456'] = { planId: 'agent-chat', mode: 'inherit' };
    assert.equal(h.passiveAllowed('qq:group:456'), false);
    h.state.profiles['qq:private:123'] = { planId: 'agent-chat', mode: 'inherit' };
    assert.equal(h.passiveAllowed('qq:private:123'), true);
  } finally {
    await h.close();
  }
});

test('全局指针落后于 currentMode 时不采信：宁可退回旧投影', async () => {
  const h = await bridgeHarness({ config: { runtime: { plans: [COMBO] } } });
  try {
    // 指针写的是组合方案（投影 reserved2），但 currentMode 还是 chat —— 指针不可信。
    h.state.profiles['qq:group:456'] = { planId: '', mode: 'inherit' };
    h.state.runtime = { version: 1, active: { qq: 'agent-chat' } };
    assert.equal(h.effectiveMode('qq:group:456'), 'chat');
  } finally {
    await h.close();
  }
});

test('social-v2 全局方案下，未固定方案的会话按仿真引擎跑', async () => {
  const h = await bridgeHarness({ config: { runtime: { plans: [{ id: 'social-v2', tools: 'qq-chat-v2', behavior: 'social-v2', audience: 'access' }] } } });
  try {
    h.setMode('reserved2');
    h.state.profiles['qq:group:456'] = { mode: 'inherit' };
    assert.equal(h.effectiveMode('qq:group:456'), 'reserved2');
  } finally {
    await h.close();
  }
});
