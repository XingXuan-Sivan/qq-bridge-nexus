// `src/session/policy.mjs`：会话策略指纹 + 「当前会话」的三条件判定。
//
// 这两个东西以前只能靠集成测试间接覆盖，而它们各自对应一类真实故障：
//   · 指纹漏了级别 → 管理通道提权后旧会话仍被判「当前」，模型继续按低权限跑；
//   · 指纹多算了易变量 → 每次检查都「过期」，会话无限重建（重新读卡、token 飞涨）；
//   · 指纹 / 准入 / 映射三条件只查两个 → 会话被复活或幽灵会话留在表里。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionPolicy } from '../src/session/policy.mjs';

function make({ mode = 'chat', preset = 'preset-a', owner = 10001, level = 'L1', plan } = {}) {
  const state = { mode, preset, owner, level, plan: plan ?? { ok: true, permissionPreset: 'pp-a' } };
  const policy = createSessionPolicy({
    getMode: () => state.mode,
    modePreset: (key) => (key.startsWith('private:') ? null : state.preset),
    getOwnerQQ: () => state.owner,
    getLevel: () => state.level,
    getClosedAgentPlan: () => state.plan,
  });
  return { policy, state };
}

function registryFor(entries) {
  const map = new Map(entries);
  return { get: (key) => map.get(key), policyOf: () => undefined, map };
}

test('chat 模式：指纹只含模式与模式预设', () => {
  const { policy } = make();
  assert.equal(policy.policyOf('group:1'), JSON.stringify(['chat', 'preset-a', null]));
});

test('私聊（modePreset 返回 null）也稳定：不会因为 undefined 变成两个不同指纹', () => {
  const { policy } = make();
  assert.equal(policy.policyOf('private:10001'), policy.policyOf('private:10001'));
  assert.equal(policy.policyOf('private:10001'), JSON.stringify(['chat', '', null]));
});

test('closed-agent：级别进指纹 —— L1 → L2 必须让旧会话过期', () => {
  const { policy, state } = make({ mode: 'closed-agent', level: 'L1' });
  const l1 = policy.policyOf('private:10001');
  state.level = 'L2';
  const l2 = policy.policyOf('private:10001');
  assert.notEqual(l1, l2, '提权后指纹必须变化，否则旧会话会被判「当前」继续用低权限');
  assert.match(l2, /L2/);
});

test('closed-agent：管理员与权限预设进指纹', () => {
  const { policy, state } = make({ mode: 'closed-agent' });
  const before = policy.policyOf('private:10001');
  state.plan = { ok: true, permissionPreset: 'pp-b' };
  assert.notEqual(before, policy.policyOf('private:10001'), '权限预设变化要触发重建');
  state.owner = 20002;
  assert.match(policy.policyOf('private:10001'), /20002/);
});

test('closed-agent 但授权未完成（plan.ok=false）：仍算级别，预设位记空串', () => {
  const { policy } = make({ mode: 'closed-agent', plan: { ok: false, error: 'L0' } });
  assert.equal(policy.policyOf('private:10001'), JSON.stringify(['closed-agent', '', 10001, 'L1', '']));
});

test('非 closed-agent 模式：级别变化不影响指纹（避免无谓重建）', () => {
  const { policy, state } = make({ mode: 'reserved2' });
  const before = policy.policyOf('group:9');
  state.level = 'L3';
  assert.equal(before, policy.policyOf('group:9'));
});

test('isCurrent：三条件都为真才成立', () => {
  const { policy } = make();
  const fp = policy.policyOf('group:1');
  const registry = { get: () => 'sid-1', policyOf: () => fp };
  assert.equal(policy.isCurrent({ key: 'group:1', sessionId: 'sid-1', registry, allowed: () => true }), true);
  // 准入被拒
  assert.equal(policy.isCurrent({ key: 'group:1', sessionId: 'sid-1', registry, allowed: () => false }), false);
  // 映射变了（DSH 换了会话）
  assert.equal(policy.isCurrent({ key: 'group:1', sessionId: 'sid-2', registry, allowed: () => true }), false);
  // 指纹过期
  const stale = { get: () => 'sid-1', policyOf: () => JSON.stringify(['chat', 'old-preset', null]) };
  assert.equal(policy.isCurrent({ key: 'group:1', sessionId: 'sid-1', registry: stale, allowed: () => true }), false);
});

test('isCurrent：缺参数时返回 false，不抛异常（调用方在定时器里）', () => {
  const { policy } = make();
  assert.equal(policy.isCurrent({}), false);
  assert.equal(policy.isCurrent({ key: 'group:1' }), false);
  assert.equal(policy.isCurrent(), false);
});

test('依赖缺失时构造即报错（别让它变成运行期 undefined 调用）', () => {
  assert.throws(() => createSessionPolicy({}), /getMode/);
});
