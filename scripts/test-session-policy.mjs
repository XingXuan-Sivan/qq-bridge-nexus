// `src/session/policy.mjs`：会话策略指纹 + 「当前会话」的三条件判定。
//
// 指纹只算「决定执行体会话形态」的量（引擎 / preset / 会话级模型）。这三样各自对应一类真实故障：
//   · 漏了引擎或 preset → 换了运行方案后旧会话仍被判「当前」，模型继续用旧预设跑；
//   · 多算了易变量（权限级别、每次调用都变的临时值）→ 改一次设置就重建会话，
//     表现为「AI 一直在重新读卡、token 哗哗烧」；
//   · 指纹 / 准入 / 映射三条件只查两个 → 会话被复活或幽灵会话留在表里。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionPolicy } from '../src/session/policy.mjs';

function make({ mode = 'chat', preset = 'preset-a', model = '' } = {}) {
  const state = { mode, preset, model };
  const policy = createSessionPolicy({
    getMode: () => state.mode,
    modePreset: () => state.preset,
    getModel: () => state.model,
  });
  return { policy, state };
}

test('指纹只含引擎与 preset；没有 preset 时记空串（直通 / 私聊）', () => {
  const { policy } = make();
  assert.equal(policy.policyOf('group:1'), JSON.stringify(['chat', 'preset-a']));
  const { policy: bare } = make({ preset: null });
  assert.equal(bare.policyOf('group:1'), JSON.stringify(['chat', '']));
});

test('换运行方案（引擎或 preset）会让旧会话过期', () => {
  const { policy, state } = make({ mode: 'reserved2', preset: 'chat-v2' });
  const before = policy.policyOf('group:1');
  state.mode = 'chat';
  const afterMode = policy.policyOf('group:1');
  assert.notEqual(before, afterMode, '换引擎后指纹必须变化，否则旧会话会被判「当前」继续跑旧预设');
  state.preset = 'chat';
  assert.notEqual(afterMode, policy.policyOf('group:1'), '换 preset 后同样不能复用旧会话');
});

test('会话级模型才进指纹：未指定时不写空位', () => {
  const { policy, state } = make();
  assert.equal(JSON.parse(policy.policyOf('group:1')).length, 2, '空模型不占指纹位');
  state.model = 'deepseek-official/deepseek-pro/high';
  assert.equal(
    policy.policyOf('group:1'),
    JSON.stringify(['chat', 'preset-a', 'deepseek-official/deepseek-pro/high']),
  );
});

test('权限级别不进指纹：级别是过滤器，每次工具调用现取', () => {
  const consulted = [];
  const policy = createSessionPolicy({
    getMode: () => 'chat',
    modePreset: () => 'preset-a',
    getModel: () => '',
    // 调用方即便传了级别来源，指纹也不该读它 —— 改级别不重建会话。
    getLevel: () => { consulted.push('level'); return 'full-ask'; },
  });
  const before = policy.policyOf('group:9');
  assert.deepEqual(consulted, [], '级别不是指纹的输入');
  assert.equal(before, JSON.stringify(['chat', 'preset-a']));
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
  const stale = { get: () => 'sid-1', policyOf: () => JSON.stringify(['chat', 'old-preset']) };
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
  assert.throws(() => createSessionPolicy({ getMode: () => 'chat' }), /modePreset/);
});
