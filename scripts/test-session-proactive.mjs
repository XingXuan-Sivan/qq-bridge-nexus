// 主动检查点：调度器跳过通知（纯函数 + 引擎去重/落盘）与 v1 主动轴门禁。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScheduler } from '../src/scheduler/engine.js';
import { buildSkipNotice } from '../src/scheduler/skip-notice.js';

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
