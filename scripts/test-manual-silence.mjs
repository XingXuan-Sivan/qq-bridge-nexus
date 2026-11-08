/**
 * 手动静默的离线测试：策略归一化、owner/管理员/普通目标矩阵、
 * 五阶段开关、只静默发送、摘要与旧 role state 兼容。
 *
 * 语义：owner 私聊始终例外；管理员在 adminApplies=false 时例外。
 * 勾选的阶段停普通目标；未勾选的阶段照常。
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_MANUAL_SILENCE_POLICY, MANUAL_SILENCE_STAGES,
  normalizeManualSilence, normalizeManualSilencePolicy, manualSilenceOfState,
  stageSuppressed, audienceRole, silenceAllowsStage, silenceAllowsSend,
  manualSilenceStageForReason, manualSilenceSummary,
} from '../src/manual-silence.mjs';
import { normalizeRoleState, serializeRoleState } from '../src/role-per-key.js';

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n  ${error?.stack ?? error}`);
  }
}

await test('默认策略：完全静默、五阶段全开、owner 例外、管理员默认不受影响', () => {
  assert.deepEqual(normalizeManualSilencePolicy({}), DEFAULT_MANUAL_SILENCE_POLICY);
  const s = normalizeManualSilence({});
  assert.equal(s.mode, 'full');
  assert.equal(s.indefinite, true);
  assert.equal(s.locked, true);
  for (const stage of MANUAL_SILENCE_STAGES) assert.equal(stageSuppressed(s, stage), true);
});

await test('非法策略字段回落默认值，不抛错', () => {
  const s = normalizeManualSilencePolicy({ mode: 'off', stages: { passive: false, proactive: 'no' }, adminApplies: 'yes', recordMessages: 0, catchUp: null });
  assert.equal(s.mode, 'full');
  assert.equal(s.stages.passive, false);
  assert.equal(s.stages.proactive, true);
  assert.equal(s.adminApplies, false);
  assert.equal(s.recordMessages, true);
  assert.equal(s.catchUp, true);
});

await test('目标角色：owner / 管理员 / 普通私聊 / 群聊', () => {
  const cfg = { ownerQQ: '10001', admins: [{ qq: '20002' }] };
  assert.equal(audienceRole('qq:private:10001', cfg), 'owner');
  assert.equal(audienceRole('qq:private:20002', cfg), 'admin');
  assert.equal(audienceRole('qq:private:30003', cfg), 'other');
  assert.equal(audienceRole('qq:group:10001', cfg), 'other');
});

await test('阶段矩阵：owner 始终允许；管理员看 adminApplies；普通目标看阶段开关', () => {
  const base = normalizeManualSilence({ mode: 'full', adminApplies: false });
  assert.equal(silenceAllowsStage(base, 'passive', 'owner'), true);
  assert.equal(silenceAllowsStage(base, 'passive', 'admin'), true);
  assert.equal(silenceAllowsStage(base, 'passive', 'other'), false);
  const adminStrict = normalizeManualSilence({ mode: 'full', adminApplies: true });
  assert.equal(silenceAllowsStage(adminStrict, 'passive', 'admin'), false);
  assert.equal(silenceAllowsStage(adminStrict, 'passive', 'owner'), true);
  const passiveOff = normalizeManualSilence({ stages: { passive: false } });
  assert.equal(silenceAllowsStage(passiveOff, 'passive', 'other'), true);
  assert.equal(silenceAllowsStage(passiveOff, 'proactive', 'other'), false);
});

await test('只静默发送：所有阶段允许活动；发送只放 owner / 例外管理员', () => {
  const s = normalizeManualSilence({ mode: 'sendOnly', adminApplies: false });
  for (const stage of MANUAL_SILENCE_STAGES) assert.equal(silenceAllowsStage(s, stage, 'other'), true);
  assert.equal(silenceAllowsSend(s, 'owner', false), true);
  assert.equal(silenceAllowsSend(s, 'admin', false), true);
  assert.equal(silenceAllowsSend(s, 'other', true), false);
  const strict = normalizeManualSilence({ mode: 'sendOnly', adminApplies: true });
  assert.equal(silenceAllowsSend(strict, 'admin', false), false);
});

await test('完全静默：owner/例外管理员不看通行证；普通目标需要本轮通行证', () => {
  const s = normalizeManualSilence({ mode: 'full', adminApplies: false });
  assert.equal(silenceAllowsSend(s, 'owner', false), true);
  assert.equal(silenceAllowsSend(s, 'admin', false), true);
  assert.equal(silenceAllowsSend(s, 'other', false), false);
  assert.equal(silenceAllowsSend(s, 'other', true), true);
});

await test('唤醒原因归阶段：被动、主动、定时 AI', () => {
  assert.equal(manualSilenceStageForReason('private'), 'passive');
  assert.equal(manualSilenceStageForReason('atMention:123'), 'passive');
  assert.equal(manualSilenceStageForReason('timeout'), 'proactive');
  assert.equal(manualSilenceStageForReason('proactiveCheck'), 'proactive');
  assert.equal(manualSilenceStageForReason('scheduled'), 'scheduledAi');
  assert.equal(manualSilenceStageForReason(undefined), 'passive');
});

await test('摘要含模式、阶段标签、开始时间与锁定状态', () => {
  const s = normalizeManualSilence({ mode: 'full', startedAt: 1_000, stages: { pluginTasks: false } });
  const sum = manualSilenceSummary(s, 61_000);
  assert.equal(sum.mode, 'full');
  assert.equal(sum.modeLabel, '完全静默');
  assert.deepEqual(sum.stages, ['passive', 'proactive', 'scheduledAi', 'scheduledText']);
  assert.equal(sum.elapsedMs, 60_000);
  assert.equal(sum.locked, true);
  assert.equal(sum.indefinite, true);
  assert.equal(sum.adminApplies, false);
});

await test('role state：旧 silent 补默认策略；active 不写 silent；序列化保留策略', () => {
  const legacy = normalizeRoleState({ role: '猫娘', mode: 'silent' });
  assert.equal(legacy.mode, 'silent');
  assert.equal(legacy.silent.locked, true);
  assert.equal(legacy.silent.startedAt, 0);
  assert.equal(legacy.silent.stages.passive, true);
  assert.deepEqual(Object.keys(serializeRoleState({ role: 'x', mode: 'active' })), ['role', 'mode']);
  const silent = normalizeManualSilence({ startedAt: 123, mode: 'sendOnly', stages: { passive: false } });
  const out = serializeRoleState({ role: 'x', mode: 'silent', silent });
  assert.equal(out.mode, 'silent');
  assert.equal(out.silent.startedAt, 123);
  assert.equal(out.silent.mode, 'sendOnly');
  assert.equal(out.silent.stages.passive, false);
  assert.equal(manualSilenceOfState({ mode: 'active' }), null);
});

if (failed > 0) {
  console.error(`\n${failed} checks failed.`);
  process.exit(1);
}
console.log('\n9/9 checks passed.');
