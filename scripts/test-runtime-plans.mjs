// 运行方案（P4）：定义归一、legacy 投影、激活指针的读写与一次性迁移。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BUILTIN_PLANS,
  normalizePlan,
  normalizePlans,
  legacyModeOfPlan,
  legacyLevelOfPlan,
  planIdForLegacy,
  findPlan,
  upsertCustomPlan,
  removeCustomPlan,
  planToConfig,
} from '../src/runtime/plans.mjs';
import { createRuntimeState, RUNTIME_STATE_VERSION } from '../src/runtime/active.mjs';

const tmpFile = (name = 'runtime.json') => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qqb-runtime-')), name);

test('内置方案：六条，legacy 投影与旧模式一一对应', () => {
  assert.equal(BUILTIN_PLANS.length, 6);
  const expected = {
    chat: ['chat', 'L0'],
    'social-v1': ['reserved', 'L0'],
    'social-v2': ['reserved2', 'L0'],
    'agent-readonly': ['closed-agent', 'L1'],
    'agent-workspace': ['closed-agent', 'L2'],
    'agent-full': ['closed-agent', 'L3'],
  };
  for (const plan of BUILTIN_PLANS) {
    assert.deepEqual([legacyModeOfPlan(plan), legacyLevelOfPlan(plan)], expected[plan.id], plan.id);
    assert.equal(planIdForLegacy(...expected[plan.id]), plan.id);
  }
});

test('归一：内置方案的「能力」不可被配置覆盖，自定义方案原样保留', () => {
  const plans = normalizePlans([
    { id: 'social-v2', label: '我的二代', tools: 'qq-agent-full', behavior: 'none', audience: 'owner' },
    { id: 'my-agent', label: '我的 Agent', tools: 'qq-agent-full', behavior: 'none', audience: 'owner' },
  ]);
  const v2 = findPlan(plans, 'social-v2');
  assert.equal(v2.label, '我的二代', 'label/note 可覆盖');
  assert.equal(v2.tools, 'qq-chat-v2', '内置方案的能力不可覆盖（要改就克隆）');
  assert.equal(v2.behavior, 'social-v2');
  assert.equal(v2.builtin, true);
  const custom = findPlan(plans, 'my-agent');
  assert.equal(custom.builtin, false);
  assert.equal(custom.tools, 'qq-agent-full');
});

test('校验：非法 id / 缺能力被丢弃，未知行为回落 none', () => {
  assert.equal(normalizePlan({ id: 'Bad Id', tools: 'x' }), null);
  assert.equal(normalizePlan({ id: 'ok-plan' }), null, '没有能力预设的方案没有意义');
  const plan = normalizePlan({ id: 'ok-plan', tools: 'qq-chat', behavior: '不存在 的 行为' });
  assert.equal(plan.behavior, 'none');
  assert.equal(plan.audience, 'access');
  assert.equal(normalizePlans('not-an-array').length, BUILTIN_PLANS.length);
});

test('激活指针：首次迁移只写一次，之后 set/get 持久化', () => {
  const file = tmpFile();
  const rt = createRuntimeState({ file, platform: 'qq', fallbackPlanId: 'social-v2' });
  assert.equal(rt.get(), null);
  const first = rt.migrateOnce('chat');
  assert.deepEqual(first, { migrated: true, planId: 'chat' });
  const second = rt.migrateOnce('reserved2');
  assert.deepEqual(second, { migrated: false, planId: 'chat' }, '已有指针时不再迁移');
  rt.set('qq', 'agent-readonly');
  const again = createRuntimeState({ file, platform: 'qq', fallbackPlanId: 'social-v2' });
  assert.equal(again.get(), 'agent-readonly');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(raw.version, RUNTIME_STATE_VERSION);
  assert.deepEqual(raw.active, { qq: 'agent-readonly' });
  again.set('qq', '');
  assert.equal(again.get(), null, '空串 = 清掉指针');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).active, {});
});

test('自定义方案：新增/更新落盘字段、内置 id 拒绝、删除保护', () => {
  const created = upsertCustomPlan([], {
    id: 'my-agent', label: '我的 Agent', tools: 'qq-agent-full', behavior: 'social-v2', audience: 'owner', note: '带人格进群',
  });
  assert.equal(created.plans.length, 1);
  assert.deepEqual(created.plans[0], {
    id: 'my-agent', label: '我的 Agent', tools: 'qq-agent-full', behavior: 'social-v2', audience: 'owner', note: '带人格进群',
  });
  const updated = upsertCustomPlan(created.plans, { ...created.plans[0], label: '改名后', builtin: true });
  assert.equal(updated.plans.length, 1);
  assert.equal(updated.plans[0].label, '改名后');
  assert.equal(planToConfig(updated.plans[0]).builtin, undefined);
  assert.throws(() => upsertCustomPlan([], { id: 'chat', tools: 'qq-chat' }), /内置方案/);
  assert.throws(() => removeCustomPlan(updated.plans, 'chat'), /内置方案/);
  const afterDelete = removeCustomPlan(updated.plans, 'my-agent');
  assert.deepEqual(afterDelete, []);
  assert.throws(() => removeCustomPlan(afterDelete, 'my-agent'), /没有这个方案/);
});
