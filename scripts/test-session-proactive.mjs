// 主动检查点：调度器跳过通知（纯函数 + 引擎去重/落盘）与 v1 主动轴门禁。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScheduler } from '../src/scheduler/engine.js';
import { buildSkipNotice } from '../src/scheduler/skip-notice.js';
import { WAKE_REASON_AXES, wakeAccessAxis } from '../src/session/access.mjs';
import { bridgeHarness } from './audit-bridge-harness.mjs';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qqb-proactive-')), 'scheduler.json');

test('① 跳过通知：只对非手动、未授权主动行为的 skipped 结果生成', () => {
  const task = { id: 7, name: '早安播报', targets: ['qq:group:456'] };
  const skipped = [{ target: 'qq:group:456', status: 'skipped', reason: '目标会话未授权主动行为（会话详情 → 准入）' }];
  const notice = buildSkipNotice({ task, outcomes: skipped, manual: false });
  assert.ok(notice, '应生成通知');
  assert.match(notice.text, /#7/);
  assert.match(notice.text, /早安播报/);
  assert.match(notice.text, /qq:group:456/);
  assert.match(notice.text, /控制台 → 会话与审批/);
  assert.match(notice.text, /当天/);
  assert.deepEqual(notice.targets, ['qq:group:456']);

  assert.equal(buildSkipNotice({ task, outcomes: skipped, manual: true }), null, '手动执行不提醒');
  assert.equal(buildSkipNotice({ task, outcomes: [{ target: 'qq:group:456', status: 'sent' }], manual: false }), null, '成功不提醒');
  assert.equal(buildSkipNotice({ task, outcomes: [{ target: 'qq:group:456', status: 'skipped', reason: '目标不在白名单' }], manual: false }), null, '别的跳过原因不提醒');
});

test('② 引擎：同一任务同一天只通知一次，skipNoticeDay 随任务落盘', () => {
  const file = tmpFile();
  const make = () => {
    const sch = createScheduler({
      file,
      now: () => Date.parse('2026-11-08T01:00:00Z'),
      deliver: async () => ({ status: 'sent' }),
      validateTarget: () => null,
      ownerKey: () => 'qq:private:1',
    });
    sch.load();
    return sch;
  };
  const sch = make();
  const task = sch.createTask({
    kind: 'text',
    text: 'hi',
    schedule: { type: 'daily', times: ['09:00'] },
    targets: ['qq:group:456'],
  }, { source: 'console' });
  assert.equal(sch.noteSkipNotice(task.id, '2026-11-08'), true, '当天首次');
  assert.equal(sch.noteSkipNotice(task.id, '2026-11-08'), false, '当天第二次不再提醒');
  assert.equal(sch.noteSkipNotice(9999, '2026-11-08'), false, '任务不存在');

  const reloaded = make();
  assert.equal(reloaded.noteSkipNotice(task.id, '2026-11-08'), false, '重启后仍记得当天已通知');
  assert.equal(reloaded.noteSkipNotice(task.id, '2026-11-09'), true, '换一天可以再提醒');
});

test('③ v1 仿真：循环按会话判启用，并在主动轴上拦截', () => {
  const src = fs.readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8');
  assert.match(src, /function socialEnabledForKey\(key\)/);
  assert.match(src, /effectiveMode\(key\) === 'reserved'/, '按会话有效模式判断');
  const start = src.indexOf('function socialLoopTick()');
  const end = src.indexOf('function startSocialLoop()', start);
  assert.ok(start > 0 && end > start, '能找到 socialLoopTick');
  const tick = src.slice(start, end);
  assert.match(tick, /socialEnabledForKey\(key\)/, '逐会话跳过未启用会话');
  assert.match(tick, /proactiveAllowed\(key\)/, '主动参与受主动轴约束');
  assert.match(tick, /leaveActive\(key\)/, '主动被拒时退出活跃');
  assert.match(src, /const randomTrigger = proactiveAllowed\(key\) && Math\.random\(\)/, '随机触发也走主动轴');
});

const BRIDGE = fs.readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8');
const sliceBetween = (from, to) => {
  const start = BRIDGE.indexOf(from);
  const end = BRIDGE.indexOf(to, start + from.length);
  assert.ok(start > 0 && end > start, `能找到 ${from}`);
  return BRIDGE.slice(start, end);
};

test('④ 唤醒原因 → 准入轴：被动/主动/操作者三分，未知原因失败关闭', () => {
  // 入站消息与它的触发条件 → 被动轴（闸门里由 isSessionAllowedInCurrentMode 拦）
  for (const reason of ['private', 'anyMessage', 'atMention', 'nameMention', 'keyword:小鲸鱼', 'question', 'speaker:某人', 'probability', 'poke']) {
    assert.equal(wakeAccessAxis(reason), 'passive', reason);
  }
  // 没有新消息、由 bot 自己或定时器发起 → 主动轴
  for (const reason of ['timeout', 'replyCheck', 'proactiveCheck', 'memberJoin', 'memberJoin:member_start', 'memberLeave', 'roleRefresh']) {
    assert.equal(wakeAccessAxis(reason), 'proactive', reason);
  }
  // 操作者/系统通道 → 不受会话准入约束
  for (const reason of ['bootstrap', 'admin', 'scheduled', 'ownerRelay']) {
    assert.equal(wakeAccessAxis(reason), 'operator', reason);
  }
  // 未知原因失败关闭：宁可拦住 bot 自发的唤醒，也不让新路径悄悄绕过准入
  assert.equal(wakeAccessAxis('someFutureReason'), 'proactive');
  assert.equal(wakeAccessAxis('someFutureReason:sub'), 'proactive');
  assert.equal(wakeAccessAxis(''), 'proactive', '空原因按主动处理');
  assert.equal(wakeAccessAxis(null), 'proactive');
});

test('⑤ 新增唤醒原因必须登记，否则闸门分类表会漏判', () => {
  const reasons = new Set();
  for (const m of BRIDGE.matchAll(/(?:sendWakePromptV2|scheduleWakeV2)\([^,()]+,\s*'([a-zA-Z]+)'/g)) reasons.add(m[1]);
  // evaluateWakeTriggerV2 的返回值（私聊/任意消息/@/名字/关键词/提问/指定成员/概率）
  const evalBody = sliceBetween('function evaluateWakeTriggerV2(', '\n  }\n');
  for (const m of evalBody.matchAll(/return [`']([a-zA-Z]+)/g)) reasons.add(m[1]);
  // 群事件桥接的 wakeReason（memberJoin / memberLeave）
  const groupEvents = fs.readFileSync(new URL('../src/social/group-events.js', import.meta.url), 'utf8');
  for (const m of groupEvents.matchAll(/wakeReason:\s*[`']([a-zA-Z]+)/g)) reasons.add(m[1]);
  assert.ok(reasons.size >= 10, `应扫描到足够多的原因，实际 ${reasons.size}`);
  for (const reason of reasons) {
    assert.ok(Object.hasOwn(WAKE_REASON_AXES, reason), `唤醒原因「${reason}」没有登记到 WAKE_REASON_AXES（src/session/access.mjs）`);
  }
});

test('⑦ 真实投递：关掉主动后 timeout/replyCheck 不再叫醒，被动 @ 与操作者通道照常', async () => {
  const KEY = 'qq:group:456';
  const DENY = { mode: 'allow', entries: [] };
  const mk = () => bridgeHarness({
    behavior: { v2: { wake: {}, wait: { minMs: 100, maxMs: 500, minQuietAfterNewMs: 0 }, proactive: { enabled: false }, sticker: { enabled: false } } },
  });
  // 基线：主动开着时被动唤醒能投递
  const base = await mk();
  base.setMode('reserved2');
  try {
    await base.sendWakePromptV2(KEY, 'question');
    assert.equal(base.calls.prompts.length, 1, '基线：被动唤醒照常投递');
  } finally { await base.close(); }
  // 主动轴切成 allow + 空名单（= 全部拒绝）
  const denied = await mk();
  denied.setMode('reserved2');
  denied.state.defaults.proactive = DENY;
  try {
    for (const reason of ['timeout', 'replyCheck', 'memberJoin:member_start', 'roleRefresh']) {
      await denied.sendWakePromptV2(KEY, reason);
      assert.equal(denied.calls.prompts.length, 0, `主动被拒时 ${reason} 不投递`);
    }
  } finally { await denied.close(); }
  // 被动轴不受影响
  const passive = await mk();
  passive.setMode('reserved2');
  passive.state.defaults.proactive = DENY;
  try {
    await passive.sendWakePromptV2(KEY, 'question');
    assert.equal(passive.calls.prompts.length, 1, '主动被拒不影响被动唤醒');
  } finally { await passive.close(); }
  // 操作者通道不受会话准入约束
  const operator = await mk();
  operator.setMode('reserved2');
  operator.state.defaults.proactive = DENY;
  try {
    await operator.sendWakePromptV2(KEY, 'ownerRelay');
    assert.equal(operator.calls.prompts.length, 1, 'ownerRelay 是操作者通道，照常投递');
  } finally { await operator.close(); }
});
test('⑥ 三条投递/排程路径都过主动轴，改名单后立刻重排', () => {
  // 唯一投递闸门：主动轴判定必须在
  const impl = sliceBetween('async function sendWakePromptV2Impl(', 'const st = getSocialV2State(key);');
  assert.match(impl, /wakeAccessAxis\(reason\) === 'proactive' && !proactiveAllowed\(key\)/, '投递闸门按原因判主动轴');
  // 计划唤醒：排程阶段也判一次，别给被拒会话挂定时器
  const schedule = sliceBetween('function scheduleWakeV2(', 'function replayPendingWakeReasonsV2(');
  assert.match(schedule, /wakeAccessAxis\(reason\) === 'proactive' && !proactiveAllowed\(key\)/, '排程阶段判主动轴');
  // 回复检查与潜水到期是两条不走 scheduleWakeV2 的定时唤醒
  assert.match(sliceBetween('function scheduleReplyCheckV2(', 'function busyBreakdownV2('),
    /if \(!proactiveAllowed\(key\)\) return;/, '回复检查排程前判主动轴');
  assert.match(sliceBetween('function setupSleepTimerV2Impl(', 'function cancelProactiveCheckV2('),
    /if \(!proactiveAllowed\(key\)\) return;/, '潜水定时器排程前判主动轴');
  // DSH 断线补投是第二条投递路径
  assert.match(BRIDGE, /const flushQueue = async \(\) => \{[\s\S]*?wakeAccessAxis\(item\.wakeReason\) === 'proactive' && !proactiveAllowed\(key\)/,
    '补投前判主动轴');
  // 准入名单热更新：撤主动机会 + 撤回复检查 + 补回未到期的潜水定时器
  const resched = sliceBetween('function rescheduleProactiveChecksAfterAccessChange(', 'function scheduleProactiveCheckV2(');
  assert.match(resched, /cancelProactiveCheckV2\(key\)/);
  assert.match(resched, /cancelReplyCheckV2\(key\)/);
  assert.match(resched, /setupSleepTimerV2\(key\)/);
  // 会话详情保存准入后必须重排（此前只有 /api/access 会重排，详情卡不会）
  const patch = sliceBetween("if (req.method === 'PATCH') {\n            if (!profile)", "if (req.method === 'DELETE') {");
  assert.match(patch, /if \(accessChanged\) rescheduleProactiveChecksAfterAccessChange\(\);/);
});
