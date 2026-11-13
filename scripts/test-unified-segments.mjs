#!/usr/bin/env node
// B6 中立消息段（docs/PLATFORM_DECOUPLING.md §3.4）。
//
// 这条回归钉住三件事：
//   1. 段类型恰好 11 种，且 OneBot 的历史写法（at / record）在边界处被归一；
//   2. 降级只看 capabilities —— 同一个段在一份能力声明下降级、在另一份下原样通过，
//      断言里不出现平台名；
//   3. 不许降级的段（poke / ext）必须抛错，不能静默变成一句「拍了拍」发进群里。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SEGMENT_TYPES,
  normalizeSegment,
  normalizeSegments,
  degradeSegments,
  segmentsToText,
  neutralType,
} from '../src/user-side/segments.mjs';

const ALL = [...SEGMENT_TYPES];

test('段类型恰好 11 种，顺序与文档一致', () => {
  assert.deepEqual(ALL, ['text', 'mention', 'reply', 'image', 'voice', 'video', 'file', 'sticker', 'forward', 'poke', 'ext']);
});

test('历史写法在边界处归一：at → mention，record → voice', () => {
  assert.equal(neutralType('at'), 'mention');
  assert.equal(neutralType('record'), 'voice');
  assert.equal(neutralType('TEXT'), 'text');
  assert.throws(() => neutralType('json'), (error) => error.code === 'unsupported_segment');
  assert.deepEqual(normalizeSegment({ type: 'at', data: { qq: '123' } }), { type: 'mention', data: { target: '123' } });
  assert.deepEqual(normalizeSegment({ type: 'record', data: { file: 'a.silk' } }), { type: 'voice', data: { file: 'a.silk' } });
  assert.deepEqual(normalizeSegment({ type: 'reply', data: { id: '99' } }), { type: 'reply', data: { messageId: '99' } });
});

test('扁平写法也收：{ type, target } 等价于 { type, data:{ target } }', () => {
  assert.deepEqual(normalizeSegment({ type: 'mention', target: '42' }), { type: 'mention', data: { target: '42' } });
  assert.deepEqual(normalizeSegment({ type: 'text', text: 'hi' }), { type: 'text', data: { text: 'hi' } });
});

test('结构非法抛 invalid_segment：缺字段、缺媒体源、非数组、未知类型', () => {
  assert.throws(() => normalizeSegment({ type: 'mention', data: {} }), (error) => error.code === 'invalid_segment');
  assert.throws(() => normalizeSegment({ type: 'image', data: {} }), /必须有 file 或 url/);
  assert.throws(() => normalizeSegments('nope'), (error) => error.code === 'invalid_segment');
  assert.throws(() => normalizeSegment({ type: 'hologram' }), /未知消息段类型/);
});

test('有能力时原样保留，不增删字段', () => {
  const segments = [
    { type: 'text', data: { text: 'hi' } },
    { type: 'mention', data: { target: '42' } },
    { type: 'image', data: { file: 'base64://x' } },
    { type: 'voice', data: { file: 'a.silk' } },
  ];
  const { segments: out, degraded } = degradeSegments(segments, ['mention', 'image', 'voice']);
  assert.deepEqual(out, segments);
  assert.deepEqual(degraded, []);
});

test('缺能力时按表降级为文本，并逐段记账', () => {
  const { segments: out, degraded } = degradeSegments([
    { type: 'mention', data: { target: '42' } },
    { type: 'image', data: { file: 'x' } },
    { type: 'voice', data: { file: 'a.silk' } },
    { type: 'sticker', data: { id: '1' } },
    { type: 'forward', data: { id: 'f1' } },
  ], []);
  assert.deepEqual(out.map((segment) => segment.data.text), ['@42', '[图片]', '[语音]', '[表情]', '[合并转发]']);
  assert.equal(degraded.length, 5);
  assert.ok(degraded.every((item) => item.reason.startsWith('capability_unsupported')));
});

test('引用缺能力时直接丢弃（不占位），正文照旧', () => {
  const { segments: out, degraded } = degradeSegments([
    { type: 'reply', data: { messageId: '9' } },
    { type: 'text', data: { text: '正文' } },
  ], []);
  assert.deepEqual(out, [{ type: 'text', data: { text: '正文' } }]);
  assert.deepEqual(degraded.map((item) => item.type), ['reply']);
});

test('poke 与 ext 不许降级：抛错而不是静默变成文本', () => {
  assert.throws(
    () => degradeSegments([{ type: 'poke', data: { target: '42' } }], []),
    (error) => error.code === 'capability_unsupported',
  );
  assert.throws(
    () => degradeSegments([{ type: 'ext', data: { platform: 'qq', kind: 'ark', data: {} } }], []),
    (error) => error.code === 'unsupported_segment',
  );
});

test('能力判定不看平台名：同一份段在两套能力下得到不同结果', () => {
  const segments = [{ type: 'sticker', data: { id: '1' } }];
  assert.equal(degradeSegments(segments, ['sticker']).segments[0].type, 'sticker');
  assert.equal(degradeSegments(segments, ['image']).segments[0].type, 'text');
});

test('segmentsToText：供日志与 event.message.text 使用', () => {
  assert.equal(segmentsToText([
    { type: 'reply', data: { messageId: '1' } },
    { type: 'text', data: { text: '看这个' } },
    { type: 'image', data: { file: 'x' } },
  ]), '看这个[图片]');
});
