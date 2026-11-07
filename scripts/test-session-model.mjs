// P2b：会话级模型的最小回归。
//   ① 档案模型签名只在真的指定了模型时进入会话指纹（升级不能把旧会话全重建）；
//   ② 档案模型优先于全局，标签与看图能力跟着该会话的模型走；
//   ③ 未指定模型时仍用全局 DSH 参数，选模型请求带的是全局值。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionPolicy } from '../src/session/policy.mjs';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const GROUP = 'qq:group:456';

function policyWith(getModel) {
  return createSessionPolicy({
    getMode: () => 'reserved2',
    modePreset: () => 'qq-chat-v2',
    getModel,
    getOwnerQQ: () => 123,
    getLevel: () => 'L0',
    getClosedAgentPlan: () => null,
  });
}

test('会话模型签名：空签名不进指纹，模型变化会改变指纹', () => {
  const base = policyWith(() => '');
  const withModel = policyWith(() => 'deepseek-official/deepseek-flash/high');
  assert.equal(JSON.parse(base.policyOf(GROUP)).length, 3);
  assert.deepEqual(withModel.policyOf(GROUP), `["reserved2","qq-chat-v2",null,"deepseek-official/deepseek-flash/high"]`);
  assert.notEqual(base.policyOf(GROUP), withModel.policyOf(GROUP));
});

test('档案模型优先于全局，签名与标签跟着档案走', async () => {
  const h = await bridgeHarness();
  try {
    h.state.profiles[GROUP] = { key: GROUP, model: { provider: 'deepseek-official', model: 'deepseek-pro', reasoning: 'high' } };
    const model = h.profileModelOf(GROUP);
    assert.equal(model?.provider, 'deepseek-official');
    assert.equal(model?.model, 'deepseek-pro');
    assert.equal(model?.reasoning, 'high');
    assert.equal(h.profileModelSignature(GROUP), 'deepseek-official/deepseek-pro/high');
    assert.match(h.modelLabelForKey(GROUP), /deepseek-pro/);
    delete h.state.profiles[GROUP].model;
    assert.equal(h.profileModelOf(GROUP), null);
    assert.equal(h.profileModelSignature(GROUP), '');
  } finally {
    await h.close();
  }
});

test('看图能力按会话模型：全局 vision=no 时一律不能看图，yes 时放行', async () => {
  const h = await bridgeHarness();
  try {
    h.cfg.dsh = { ...(h.cfg.dsh || {}), vision: 'no' };
    assert.equal(h.sessionCanSeeImages(GROUP), false);
    h.cfg.dsh.vision = 'yes';
    assert.equal(h.sessionCanSeeImages(GROUP), true);
    h.cfg.dsh.vision = 'auto';
    h.state.profiles[GROUP] = {
      key: GROUP,
      model: { provider: 'fixture', model: 'unknown-fixture-model', reasoning: null },
    };
    assert.equal(h.sessionCanSeeImages(GROUP), false);
  } finally {
    await h.close();
  }
});

test('未指定会话模型时 ensureChatModel 提交全局参数', async () => {
  const h = await bridgeHarness();
  try {
    h.cfg.dsh = { ...(h.cfg.dsh || {}), provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'low' };
    delete h.state.profiles[GROUP];
    await h.ensureChatModel('sess-fixture', GROUP);
    const last = h.calls.selectModels.at(-1);
    assert.equal(last?.provider, 'deepseek-official');
    assert.equal(last?.model, 'deepseek-flash');
    assert.equal(last?.reasoningEffort, 'low');
  } finally {
    await h.close();
  }
});

test('指定会话模型后 ensureChatModel 提交档案里的模型', async () => {
  const h = await bridgeHarness();
  try {
    h.cfg.dsh = { ...(h.cfg.dsh || {}), provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'low' };
    h.state.profiles[GROUP] = {
      key: GROUP,
      model: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoning: 'high' },
    };
    await h.ensureChatModel('sess-profile', GROUP);
    const last = h.calls.selectModels.at(-1);
    assert.equal(last?.provider, 'deepseek-official');
    assert.equal(last?.model, 'deepseek-v4-pro');
    assert.equal(last?.reasoningEffort, 'high');
  } finally {
    await h.close();
  }
});
