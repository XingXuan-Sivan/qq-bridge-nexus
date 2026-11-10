// 注入块注册表 v2：槽位顺序、时机筛选、档案筛选、单块上限、总预算、插件块豁免默认上限。
// 纯单元测试，不启动桥接。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromptBlockRegistry } from '../src/plugins/prompt-blocks.mjs';

const silentLog = () => {};

function registry(defs, { overrides = {}, perBlockDefault = 0 } = {}) {
  const reg = createPromptBlockRegistry({ log: silentLog, maxTotalChars: 0 });
  for (const def of defs) reg.register({ owner: 'core', ...def }, 'core');
  reg.setOverrides(overrides, { perBlockDefault });
  return reg;
}

test('按 slot 顺序、同 slot 按 priority 拼装，块之间统一空一行', () => {
  const reg = registry([
    { id: 'core-b', slot: 'tail', priority: 10, render: () => 'tail-10' },
    { id: 'core-a', slot: 'head', priority: 50, render: () => 'head-50' },
    { id: 'core-c', slot: 'head', priority: 10, render: () => 'head-10' },
  ]);
  const out = reg.renderProfileSync('wake', {});
  assert.equal(out.text, 'head-10\n\nhead-50\n\ntail-10');
  assert.deepEqual(out.blocks.map((b) => b.id), ['core-c', 'core-a', 'core-b']);
});

test('timing=reason 只在该原因（含前缀）出现，其它原因整块跳过', () => {
  const reg = registry([
    { id: 'core-always', slot: 'action', priority: 10, render: () => 'always' },
    { id: 'core-join', slot: 'action', priority: 20, timing: 'reason', reasons: ['memberJoin'], render: () => 'join' },
    { id: 'core-timeout', slot: 'action', priority: 30, timing: 'reason', reasons: ['timeout'], render: () => 'timeout' },
  ]);
  assert.equal(reg.renderProfileSync('wake', { reason: 'memberJoin:member_start' }).text, 'always\n\njoin');
  assert.equal(reg.renderProfileSync('wake', { reason: 'timeout' }).text, 'always\n\ntimeout');
  assert.equal(reg.renderProfileSync('wake', { reason: 'atMention' }).text, 'always');
});

test('profiles 决定块出现在哪个提示词档案', () => {
  const reg = registry([
    { id: 'core-wake', slot: 'head', priority: 10, profiles: ['wake'], render: () => 'wake-only' },
    { id: 'core-ctx', slot: 'head', priority: 10, profiles: ['context'], render: () => 'ctx-only' },
    { id: 'core-both', slot: 'head', priority: 20, profiles: ['wake', 'reminder'], render: () => 'both' },
  ]);
  assert.equal(reg.renderProfileSync('wake', {}).text, 'wake-only\n\nboth');
  assert.equal(reg.renderProfileSync('reminder', {}).text, 'both');
  assert.equal(reg.renderProfileSync('context', {}).text, 'ctx-only');
});

test('关掉的块不出现，空串块不出现', () => {
  const reg = registry(
    [
      { id: 'core-on', slot: 'head', priority: 10, render: () => 'on' },
      { id: 'core-off', slot: 'head', priority: 20, render: () => 'off' },
      { id: 'core-empty', slot: 'head', priority: 30, render: () => '' },
    ],
    { overrides: { 'core-off': { enabled: false } } },
  );
  const out = reg.renderProfileSync('wake', {});
  assert.equal(out.text, 'on');
  assert.equal(out.blocks.find((b) => b.id === 'core-empty').status, 'empty');
});

test('单块上限截断记 truncated；perBlockDefault 只兜底没配上限的 core 块', () => {
  const reg = registry(
    [
      { id: 'core-long', slot: 'head', priority: 10, render: () => 'x'.repeat(50) },
      { id: 'core-own', slot: 'head', priority: 20, maxChars: 8, render: () => 'y'.repeat(50) },
      { id: 'plugin-block', slot: 'head', priority: 30, owner: 'plugin:demo', render: () => 'z'.repeat(50) },
    ],
    { perBlockDefault: 20 },
  );
  const out = reg.renderProfileSync('wake', {});
  const byId = Object.fromEntries(out.blocks.map((b) => [b.id, b]));
  assert.equal(byId['core-long'].chars, 20);
  assert.equal(byId['core-long'].status, 'truncated');
  assert.equal(byId['core-own'].chars, 8);
  assert.equal(byId['plugin-block'].chars, 50, '插件块不吃 perBlockDefault');
});

test('总预算用完时整块跳过记 budget，不是截断', () => {
  const reg = registry([
    { id: 'core-a', slot: 'head', priority: 10, render: () => 'a'.repeat(10) },
    { id: 'core-b', slot: 'head', priority: 20, render: () => 'b'.repeat(10) },
  ]);
  const out = reg.renderProfileSync('wake', {}, { maxTotalChars: 15 });
  assert.equal(out.text, 'a'.repeat(10));
  assert.equal(out.blocks.find((b) => b.id === 'core-b').status, 'budget');
});

test('块抛错只影响自己，status 记 error', () => {
  const reg = registry([
    { id: 'core-ok', slot: 'head', priority: 10, render: () => 'ok' },
    { id: 'core-bad', slot: 'head', priority: 20, render: () => { throw new Error('boom'); } },
  ]);
  const out = reg.renderProfileSync('wake', {});
  assert.equal(out.text, 'ok');
  assert.equal(out.blocks.find((b) => b.id === 'core-bad').status, 'error');
});
