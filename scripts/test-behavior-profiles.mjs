import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertPresetBehaviorBindings,
  loadBehaviorProfiles,
  loadPresetBehaviorBindings,
  normalizeBehavior,
  resolveBehavior,
} from '../src/behaviors/index.mjs';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qq-behavior-'));
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

const V1 = `version: 1
kind: v1
label: 测试 v1
v1:
  triggerProbability: 0.1
  burstEnabled: true
`;
const V2 = `version: 1
kind: v2
label: 测试 v2
v2:
  wake:
    preSleepWaitMs: 300000
  send:
    burstEnabled: true
`;

test('normalizeBehavior accepts v1/v2 and rejects wrong kind or unknown keys', () => {
  assert.equal(normalizeBehavior('v1', {
    version: 1, kind: 'v1', label: 'x', v1: { triggerProbability: 0.1 },
  }).kind, 'v1');
  assert.throws(() => normalizeBehavior('x', { version: 1, kind: 'v3', label: 'x' }), /kind/);
  assert.throws(() => normalizeBehavior('x', { version: 1, kind: 'v1', label: 'x', v1: {}, extra: 1 }), /未知顶层字段/);
  assert.throws(() => normalizeBehavior('x', { version: 1, kind: 'v1', label: 'x', v1: { n: Number.NaN } }), /非法数字/);
  assert.throws(() => normalizeBehavior('x', { version: 1, kind: 'v1', label: 'x', v1: {}, v2: {} }), /不能同时包含/);
});

test('loadBehaviorProfiles reads files and fails closed on broken YAML', () => {
  const root = tempDir();
  write(path.join(root, 'default-v1.yml'), V1);
  write(path.join(root, 'default-v2.yml'), V2);
  const map = loadBehaviorProfiles({ root });
  assert.deepEqual([...map.keys()], ['default-v1', 'default-v2']);
  assert.equal(map.get('default-v2').kind, 'v2');
  write(path.join(root, 'broken.yml'), 'version: [');
  assert.throws(() => loadBehaviorProfiles({ root }), /YAML 解析失败/);
});

test('preset bindings must exist and chat presets must bind one', () => {
  const root = tempDir();
  write(path.join(root, 'qq-chat', 'preset.yml'), 'name: a\ndescription: b\norder: 1\nbehavior: default-v1\n');
  write(path.join(root, 'qq-chat-v2', 'preset.yml'), 'name: a\ndescription: b\norder: 2\nbehavior: default-v2\n');
  write(path.join(root, 'qq-agent-full', 'preset.yml'), 'name: a\ndescription: b\norder: 3\n');
  const bindings = loadPresetBehaviorBindings({ root });
  assert.equal(bindings.get('qq-chat'), 'default-v1');
  assert.equal(bindings.has('qq-agent-full'), false);
  const behaviors = new Map([
    ['default-v1', normalizeBehavior('default-v1', {
      version: 1, kind: 'v1', label: 'v1', v1: {},
    })],
    ['default-v2', normalizeBehavior('default-v2', {
      version: 1, kind: 'v2', label: 'v2', v2: {},
    })],
  ]);
  assert.equal(assertPresetBehaviorBindings({ bindings, behaviors }), true);
  assert.throws(() => resolveBehavior(behaviors, '', { presetId: 'qq-chat' }), /未绑定 behavior/);
  assert.throws(() => resolveBehavior(behaviors, 'missing', { presetId: 'qq-chat' }), /不存在/);
  assert.throws(() => assertPresetBehaviorBindings({
    bindings: new Map([['qq-chat', 'default-v1']]), behaviors,
  }), /qq-chat-v2 未绑定 behavior/);
});
