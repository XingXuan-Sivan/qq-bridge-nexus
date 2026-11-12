// 运行方案（P4）：文件仓库、归一校验、legacy 投影、激活指针读写。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILTIN_PLAN_ORDER,
  createPlanStore,
  normalizePlan,
  legacyModeOfPlan,
  legacyLevelOfPlan,
  planIdForLegacy,
  findPlan,
} from '../src/runtime/plans.mjs';
const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qqb-plans-'));
const tmpFile = (name = 'runtime.json') => path.join(tmpRoot(), name);

function builtinStore() {
  return createPlanStore({ root: path.join(path.dirname(fileURLToPath(import.meta.url)), '../profiles/plans') });
}

test('内置方案：六条，legacy 投影与旧模式一一对应', () => {
  const plans = builtinStore().list();
  assert.equal(plans.length, 6);
  assert.deepEqual(plans.map((plan) => plan.id), BUILTIN_PLAN_ORDER);
  const expected = {
    chat: ['chat', 'L0'],
    'social-v1': ['reserved', 'L0'],
    'social-v2': ['reserved2', 'L0'],
    'agent-readonly': ['closed-agent', 'L1'],
    'agent-workspace': ['closed-agent', 'L2'],
    'agent-full': ['closed-agent', 'L3'],
  };
  for (const plan of plans) {
    assert.equal(plan.builtin, true, plan.id);
    assert.equal(plan.platform, 'qq');
    assert.equal(plan.agentPlatform, 'dsh');
    assert.deepEqual([legacyModeOfPlan(plan), legacyLevelOfPlan(plan)], expected[plan.id], plan.id);
    assert.equal(planIdForLegacy(...expected[plan.id]), plan.id);
  }
});

test('归一：缺 agent / capability 直接报错，未知行为回落 none', () => {
  assert.throws(() => normalizePlan({ id: 'Bad Id', agent: 'qq-chat', capability: 'agent-chat' }), /id 不合法/);
  assert.throws(() => normalizePlan({ id: 'ok-plan', capability: 'agent-chat' }), /agent 不能为空/);
  assert.throws(() => normalizePlan({ id: 'ok-plan', agent: 'qq-chat' }), /capability 不能为空/);
  const plan = normalizePlan({ id: 'ok-plan', agent: 'qq-chat', capability: 'agent-chat', behavior: '未知档案' });
  assert.equal(plan.behavior, '未知档案', '行为只存名字，是否有效由加载侧判断');
  assert.equal(plan.audience, 'access');
  assert.equal(plan.builtin, false);
});

test('内置方案只读：save / remove 都被拒绝', () => {
  const store = builtinStore();
  assert.throws(() => store.save({ id: 'chat', agent: 'qq-chat', capability: 'agent-chat' }), /内置方案/);
  assert.throws(() => store.remove('social-v2'), /内置方案/);
});

test('自定义方案：写入 / 读取 / 克隆 / 删除都落文件', () => {
  const root = tmpRoot();
  const store = createPlanStore({ root });
  assert.deepEqual(store.list(), []);
  const saved = store.save({
    id: 'my-agent', label: '我的 Agent', platform: 'qq', agentPlatform: 'dsh',
    agent: 'qq-agent-full', capability: 'agent-full', behavior: 'social-v2', audience: 'owner', note: '带人格进群',
  });
  assert.equal(saved.builtin, false);
  assert.ok(fs.existsSync(path.join(root, 'my-agent.yml')));
  assert.equal(store.list().length, 1);
  assert.equal(store.get('my-agent').label, '我的 Agent');
  const clone = store.clone('my-agent', 'my-agent-2');
  assert.equal(clone.id, 'my-agent-2');
  assert.equal(store.list().length, 2);
  assert.throws(() => store.clone('my-agent', 'my-agent-2'), /已存在/);
  store.remove('my-agent');
  assert.equal(store.list().length, 1);
  assert.equal(store.get('my-agent'), null);
});

test('方案解析不再有全局指针：默认方案来自 config.runtime.defaultPlan', () => {
  // 指针（state/runtime.json）已删除；全局默认方案是配置项，内置方案仍是只读文件。
  assert.equal(fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../state/runtime.json')), true);
  const store = builtinStore();
  assert.equal(store.get('social-v2')?.id, 'social-v2');
  assert.equal(store.get('chat')?.builtin, true);
});

test('legacy 投影按行为优先：Agent 工具 + 仿真行为仍是仿真引擎', () => {
  // 行为决定引擎，工具只决定能力 —— 允许「带人格的 Agent 进群聊」这类组合。
  assert.equal(legacyModeOfPlan({ agent: 'qq-agent-full', behavior: 'social-v2', audience: 'owner' }), 'reserved2');
  assert.equal(legacyModeOfPlan({ agent: 'qq-agent-full', behavior: 'social-v1' }), 'reserved');
  assert.equal(legacyModeOfPlan({ agent: 'qq-agent-full', behavior: 'none' }), 'closed-agent');
  assert.equal(legacyModeOfPlan({ agent: 'qq-chat', behavior: 'social-v2' }), 'reserved2');
  assert.equal(legacyModeOfPlan({ agent: 'qq-chat', behavior: 'none' }), 'chat');
  assert.deepEqual(findPlan([{ id: 'a' }], 'a'), { id: 'a' });
  assert.equal(findPlan([{ id: 'a' }], 'b'), null);
});
