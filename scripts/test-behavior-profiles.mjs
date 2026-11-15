import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  loadBehaviorProfiles,
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
platform: qq
kind: social-v1
label: 测试 v1
prompt: 一代话术
config:
  triggerProbability: 0.1
  burstEnabled: true
`;
const V2 = `version: 1
platform: qq
kind: social-v2
label: 测试 v2
prompt: 二代话术
config:
  wake:
    preSleepWaitMs: 300000
  send:
    burstEnabled: true
`;

test('normalizeBehavior 按类型解析引擎，并拒绝未注册类型与未知键', () => {
  const v1 = normalizeBehavior('v1', {
    version: 1, platform: 'qq', kind: 'social-v1', label: 'x', prompt: 'p', config: { triggerProbability: 0.1 },
  });
  assert.equal(v1.kind, 'social-v1');
  assert.equal(v1.engine, 'v1');
  assert.equal(v1.config.triggerProbability, 0.1);
  assert.equal(typeof v1.config.contextWindow, 'number', '缺的键铺引擎默认值（全量快照）');
  assert.throws(() => normalizeBehavior('x', { version: 1, platform: 'qq', kind: 'v3', label: 'x', config: {} }), /未注册/);
  assert.throws(() => normalizeBehavior('x', { version: 1, platform: 'qq', kind: 'social-v1', label: 'x', config: {}, extra: 1 }), /未知顶层字段/);
  assert.throws(() => normalizeBehavior('x', { version: 1, platform: 'qq', kind: 'social-v1', label: 'x', config: { triggerProbability: Number.NaN } }), /有限数字/);
  assert.throws(() => normalizeBehavior('x', { version: 1, platform: 'qq', kind: 'social-v1', label: 'x', config: {}, v2: {} }), /未知顶层字段：v2/);
  assert.throws(() => normalizeBehavior('x', { version: 1, kind: 'social-v1', label: 'x', config: {} }), /platform/);
});

test('loadBehaviorProfiles reads files and fails closed on broken YAML', () => {
  const root = tempDir();
  write(path.join(root, 'social-v1.yml'), V1);
  write(path.join(root, 'social-v2.yml'), V2);
  const map = loadBehaviorProfiles({ root });
  assert.deepEqual([...map.keys()], ['social-v1', 'social-v2']);
  assert.equal(map.get('social-v2').kind, 'social-v2');
  assert.equal(map.get('social-v2').prompt, '二代话术');
  write(path.join(root, 'broken.yml'), 'version: [');
  assert.throws(() => loadBehaviorProfiles({ root }), /YAML 解析失败/);
});

test('resolveBehavior returns the archive or throws with the id', () => {
  const behaviors = new Map([
    ['social-v1', normalizeBehavior('social-v1', {
      version: 1, platform: 'qq', kind: 'social-v1', label: 'v1', config: {},
    })],
  ]);
  assert.equal(resolveBehavior(behaviors, 'social-v1').id, 'social-v1');
  assert.throws(() => resolveBehavior(behaviors, ''), /缺少 behavior/);
  assert.throws(() => resolveBehavior(behaviors, 'missing'), /行为档案不存在：missing/);
});

test('repo 自带的两份平台行为档案符合新 schema', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../profiles/platforms/qq/behaviors');
  const map = loadBehaviorProfiles({ root });
  assert.deepEqual([...map.keys()].sort(), ['social-v1', 'social-v2']);
  for (const behavior of map.values()) {
    assert.equal(behavior.platform, 'qq');
    assert.ok(behavior.prompt.length > 0, `${behavior.id} 应带行为提示词`);
  }
});
