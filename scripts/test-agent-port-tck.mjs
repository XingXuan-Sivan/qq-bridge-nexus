// 执行体契约测试（TCK）：接一个新平台时先过这一套，再看它自己的适配器细节。
//
// 钉的是**内核依赖的不变量**，不是平台特性（那些在 test-agent-port / test-acp-port）：
//   1. 归一事件的形状：`kind` 必须在 AGENT_EVENT_KINDS 里，且带 sessionId；
//   2. 一轮的边界：turn-start 建立回合、text 累加、turn-end 收口 —— 两家的翻译产物都必须
//      能喂进**同一个**收集器；同一会话的两个回合不能混成一条回复；
//   3. 审批引用：内核只持 `{ instance, sessionId, requestId }`，平台键留在适配器挂起表；
//   4. 快照是独立 kind，绝不混进事件流（混进去 = 历史回合被当成新回合回一条消息）；
//   5. 连接层成员：两家 `createRuntime()` 都给出 RUNTIME_MEMBERS 全集。
//
// 不需要网络也不需要子进程：两家的「平台事件 → 归一事件」都是纯函数。
import assert from 'node:assert/strict';
import test from 'node:test';

import { AGENT_EVENT_KINDS, normalizePermissionRef } from '../src/agent-side/port.mjs';
import { RUNTIME_MEMBERS } from '../src/agent-side/runtime.mjs';
import { createAgentTurnCollector } from '../src/agent-side/collector.mjs';
import { createDshEventPlane } from '../src/agent-side/adapters/dsh/events-plane.mjs';
import { createRuntime as createDshRuntime } from '../src/agent-side/adapters/dsh/runtime.mjs';
import { createRuntime as createAcpRuntime } from '../src/agent-side/adapters/acp/runtime.mjs';
import { mapPermissionRequest, mapSessionUpdate } from '../src/agent-side/adapters/acp/events.mjs';

const SID = 'sess-1';

/** TCK 不连平台：事件面的连接部分被访问到就是测试写错了。 */
const dshPlane = () => createDshEventPlane({
  getClient: () => { throw new Error('TCK 不应访问连接'); },
  approvals: new Map(),
});

function assertContract(event) {
  assert.ok(event, '事件不得为空');
  assert.ok(AGENT_EVENT_KINDS.includes(event.kind), `kind 不在契约里：${event.kind}`);
  assert.equal(typeof event.sessionId, 'string', '每个事件都必须带 sessionId');
}

/** 把一串事件喂进收集器，返回收口结果（没有收口时为 null）。 */
function collect(events) {
  const collector = createAgentTurnCollector();
  let ended = null;
  for (const event of events) {
    const result = collector.push(event);
    if (result) ended = result;
  }
  return ended;
}

test('事件形状：两家的翻译产物都落在契约的 kind 集合里', () => {
  const plane = dshPlane();
  const dshEvents = [
    ...plane.sessionEvents(SID, { type: 'turn/start', data: { turn: 1 } }),
    ...plane.sessionEvents(SID, { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '你好' }] } } }),
    ...plane.sessionEvents(SID, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }),
  ];
  for (const event of dshEvents) assertContract(event);

  const acpEvents = [
    mapSessionUpdate(SID, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '你好' } }),
    mapSessionUpdate(SID, { sessionUpdate: 'plan', entries: [{ content: '第一步', priority: 'high', status: 'pending' }] }),
    mapSessionUpdate(SID, { sessionUpdate: 'from_the_future', payload: 1 }),
  ];
  for (const event of acpEvents) assertContract(event);
});

test('回合边界：同一个收集器能吃两家的回合（turn-start → text → turn-end）', () => {
  const plane = dshPlane();
  const dsh = collect([
    ...plane.sessionEvents(SID, { type: 'turn/start', data: { turn: 3 } }),
    ...plane.sessionEvents(SID, { type: 'assistant/message', data: { turn: 3, message: { content: [{ type: 'text', text: '来自 DSH' }] } } }),
    ...plane.sessionEvents(SID, { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } }),
  ]);
  assert.ok(dsh, 'DSH 的回合必须能收口');
  assert.equal(dsh.text, '来自 DSH');

  const acp = collect([
    { kind: 'turn-start', sessionId: SID, turn: 1 },
    mapSessionUpdate(SID, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '来自 ACP' } }),
    { kind: 'turn-end', sessionId: SID, turn: 1, stopReason: 'end_turn' },
  ]);
  assert.ok(acp, 'ACP 的回合必须能收口');
  assert.equal(acp.text, '来自 ACP');
});

test('分组：同一会话的两个回合交错到达也不混成一条回复', () => {
  const collector = createAgentTurnCollector();
  collector.push({ kind: 'turn-start', sessionId: SID, turn: 1 });
  collector.push({ kind: 'turn-start', sessionId: SID, turn: 2 });
  collector.push({ kind: 'text', sessionId: SID, turn: 1, delta: 'A' });
  collector.push({ kind: 'text', sessionId: SID, turn: 2, delta: 'B' });
  assert.equal(collector.push({ kind: 'turn-end', sessionId: SID, turn: 1 }).text, 'A');
  assert.equal(collector.push({ kind: 'turn-end', sessionId: SID, turn: 2 }).text, 'B');
  assert.equal(collector.size(), 0, '两个回合都收口后不得留下空壳');
});

test('分组：平台没有回合号时按会话累加（ACP 之外的执行体也可能不给）', () => {
  const collector = createAgentTurnCollector();
  collector.push({ kind: 'turn-start', sessionId: SID });
  collector.push({ kind: 'text', sessionId: SID, delta: '甲' });
  collector.push({ kind: 'text', sessionId: SID, delta: '乙' });
  assert.equal(collector.push({ kind: 'turn-end', sessionId: SID }).text, '甲乙');
});

test('孤儿事件：没有 turn-start 的 text / turn-end 不建回复', () => {
  const collector = createAgentTurnCollector();
  assert.equal(collector.push({ kind: 'text', sessionId: SID, delta: 'x' }), null);
  assert.equal(collector.push({ kind: 'turn-end', sessionId: SID }), null);
  assert.equal(collector.size(), 0, '孤儿事件不得留下 collector');
});

test('审批引用：两家只交出 requestId，平台键留在挂起表', () => {
  const approvals = new Map();
  const plane = createDshEventPlane({ getClient: () => { throw new Error('TCK 不应访问连接'); }, approvals });
  const fromDsh = plane.requestEvent({
    type: 'approval/requested', clientId: 'c-1', sessionId: SID, eventId: 'e-1', toolName: 'pwsh', callId: 'call-1',
  });
  assert.equal(fromDsh.kind, 'permission');
  assert.equal(fromDsh.requestId, 'e-1');
  assert.equal(approvals.get('e-1').clientId, 'c-1', 'DSH 的 clientId 只活在挂起表里');

  const fromAcp = mapPermissionRequest('rpc-7', {
    sessionId: SID,
    toolCall: { toolCallId: 't-1', title: '改文件', kind: 'edit' },
    options: [{ optionId: 'allow-once', name: '允许一次', kind: 'allow_once' }],
  });
  assert.equal(fromAcp.kind, 'permission');
  assert.equal(fromAcp.requestId, 'rpc-7');

  // 内核拼引用只用到这三样；两家的引用形状因此完全相同。
  assert.deepEqual(
    normalizePermissionRef({ instance: 'acp', sessionId: SID, requestId: fromAcp.requestId }, 'acp'),
    { instance: 'acp', sessionId: SID, requestId: 'rpc-7' },
  );
  assert.throws(() => normalizePermissionRef({ sessionId: SID }), /缺少 requestId/);
  assert.throws(() => normalizePermissionRef({ requestId: 'e-1' }), /缺少 sessionId/);
});

test('快照：独立 kind，不混进事件流', () => {
  const plane = dshPlane();
  const snapshot = plane.snapshotEvent(SID, {
    records: [
      { type: 'event', event: { type: 'turn/start', data: { turn: 1 } } },
      { type: 'event', event: { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } },
    ],
    projections: { asOfSeq: 9, values: { tokenUsage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  });
  assert.equal(snapshot.kind, 'snapshot');
  assert.equal(snapshot.baseline.asOfSeq, 9);
  assert.deepEqual(snapshot.records.map((event) => event.kind), ['turn-start', 'turn-end']);
  // 历史回合的 turn-start 也在这里：把它当普通事件喂给收集器就会多发一条消息。
  assert.notEqual(snapshot.kind, 'turn-start');
});

test('连接层：两家 createRuntime() 都给出契约成员', async () => {
  for (const [id, createRuntime] of [['dsh', createDshRuntime], ['acp', createAcpRuntime]]) {
    const runtime = createRuntime({ config: {}, log: () => {} });
    for (const name of RUNTIME_MEMBERS) {
      assert.equal(typeof runtime[name], 'function', `${id} 的连接层缺少 ${name}()`);
    }
    assert.ok(runtime.id && runtime.label && runtime.mode, `${id} 必须声明 id / label / mode`);
    await runtime.close();
  }
});
