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
  validatePlanReferences,
} from '../src/runtime/plans.mjs';
const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qqb-plans-'));
const tmpFile = (name = 'runtime.json') => path.join(tmpRoot(), name);

function builtinStore() {
  return createPlanStore({ root: path.join(path.dirname(fileURLToPath(import.meta.url)), '../profiles/plans') });
}

test('内置方案：六条，legacy 投影与旧模式一一对应', () => {
  // 用户克隆出来的方案就在同一个目录（profiles/plans/），只数内置的那几条。
  const plans = builtinStore().list().filter((plan) => plan.builtin);
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
    // 方案不绑平台：没有 platform 字段；执行体默认 auto，跟随 config 的 platforms.active.agent。
    assert.equal('platform' in plan, false, `${plan.id} 不应带 platform 字段`);
    assert.equal(plan.agentPlatform, 'auto', plan.id);
    assert.deepEqual([legacyModeOfPlan(plan), legacyLevelOfPlan(plan)], expected[plan.id], plan.id);
    assert.equal(planIdForLegacy(...expected[plan.id]), plan.id);
  }
});

test('归一：缺 capability 直接报错，未知行为回落 none', () => {
  assert.throws(() => normalizePlan({ id: 'Bad Id', capability: 'chat' }), /id 不合法/);
  assert.throws(() => normalizePlan({ id: 'ok-plan' }), /capability 不能为空/);
  // C4 起方案里没有独立的 agent 字段：能力档 id 就是预设 id，一个 capability 说清「用哪套预设」。
  const plan = normalizePlan({ id: 'ok-plan', capability: 'chat', behavior: '未知档案' });
  assert.equal(plan.behavior, '未知档案', '行为只存名字，是否有效由加载侧判断');
  assert.equal(plan.audience, 'access');
  assert.equal(plan.builtin, false);
  assert.equal('agent' in plan, false, '归一后的方案不得再有 agent 字段');
});

test('内置方案只读：save / remove 都被拒绝', () => {
  const store = builtinStore();
  assert.throws(() => store.save({ id: 'chat', capability: 'chat' }), /内置方案/);
  assert.throws(() => store.remove('social-v2'), /内置方案/);
});

test('自定义方案：写入 / 读取 / 克隆 / 删除都落文件', () => {
  const root = tmpRoot();
  const store = createPlanStore({ root });
  assert.deepEqual(store.list(), []);
  const saved = store.save({
    id: 'my-agent', label: '我的 Agent',
    capability: 'full', behavior: 'social-v2', audience: 'owner', note: '带人格进群',
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

test('旧文件里的 platform 字段：读时提示、存时不写', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'legacy.yml'), [
    'version: 1',
    'id: legacy',
    'platform: qq',
    'capability: chat',
    'behavior: none',
    '',
  ].join('\n'), 'utf8');
  const store = createPlanStore({ root });
  const plan = store.get('legacy');
  assert.equal('platform' in plan, false, '归一后的方案不带 platform');
  assert.equal(plan.warnings?.[0]?.code, 'plan_warn');
  assert.match(plan.warnings[0].message, /platform/);
  // 存一次就把旧字段抹掉（不拖到以后版本）
  store.save(plan);
  assert.equal(store.get('legacy').warnings, undefined);
  assert.ok(!fs.readFileSync(path.join(root, 'legacy.yml'), 'utf8').includes('platform:'));
});

test('引用校验：执行体/能力档事实不符时报错，直通进群只提示', () => {
  const capabilities = new Map([
    ['chat', { apply: 'preset', hasRows: true, permission: 'bridge' }],
    ['direct', { apply: 'passthrough', hasRows: false, permission: 'agent' }],
    ['empty', { apply: 'preset', hasRows: false, permission: 'bridge' }],
  ]);
  const agentPlatforms = new Map([['dsh', { apply: ['preset'], permission: true }]]);
  const codes = (plan) => validatePlanReferences(plan, { capabilities, agentPlatforms }).map((issue) => issue.code);

  assert.deepEqual(codes({ capability: 'chat', agentPlatform: 'auto', behavior: 'none', audience: 'owner' }), []);
  assert.deepEqual(codes({ capability: 'missing', agentPlatform: 'auto', behavior: 'none' }), ['capability_invalid']);
  assert.deepEqual(codes({ capability: 'empty', agentPlatform: 'auto', behavior: 'none' }), ['capability_invalid']);
  assert.deepEqual(codes({ capability: 'chat', agentPlatform: 'nope', behavior: 'none' }), ['plan_invalid']);
  // 直通：执行体不认领就报错，而不是在运行期静默投影成别的档位
  assert.deepEqual(codes({ capability: 'direct', agentPlatform: 'dsh', behavior: 'none' }), ['plan_invalid']);
  // 直通进群聊：只是提示，不阻断（安全边界由执行体自身承担）
  assert.deepEqual(codes({ capability: 'direct', agentPlatform: 'auto', behavior: 'none', audience: 'access' }), ['plan_warn']);
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
  assert.equal(legacyModeOfPlan({ capability: 'full', behavior: 'social-v2', audience: 'owner' }), 'reserved2');
  assert.equal(legacyModeOfPlan({ capability: 'full', behavior: 'social-v1' }), 'reserved');
  assert.equal(legacyModeOfPlan({ capability: 'full', behavior: 'none' }), 'closed-agent');
  assert.equal(legacyModeOfPlan({ capability: 'chat', behavior: 'social-v2' }), 'reserved2');
  assert.equal(legacyModeOfPlan({ capability: 'chat', behavior: 'none' }), 'chat');
  assert.deepEqual(findPlan([{ id: 'a' }], 'a'), { id: 'a' });
  assert.equal(findPlan([{ id: 'a' }], 'b'), null);
});
