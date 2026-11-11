import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PERMISSION_LEVELS,
  DSH_PERMISSION_PRESET,
  normalizePermissionConfig,
  normalizeSessionPermission,
  resolvePermission,
  canPinLevel,
  presetForLevel,
} from '../src/session/permission.mjs';

test('四档与预设映射唯一', () => {
  assert.deepEqual(PERMISSION_LEVELS, ['read-only', 'workspace-write', 'full-ask', 'full']);
  assert.equal(DSH_PERMISSION_PRESET.full, 'danger-full-access');
  assert.equal(DSH_PERMISSION_PRESET['full-ask'], 'qq-full-ask');
  for (const level of PERMISSION_LEVELS) assert.ok(DSH_PERMISSION_PRESET[level]);
});

test('配置归一：默认只读、不能把 full 设成默认、TTL 只认 10/30/60', () => {
  const a = normalizePermissionConfig(null);
  assert.deepEqual(a, { default: 'read-only', allowFull: false, fullTtlMin: 30 });
  const b = normalizePermissionConfig({ default: 'full', allowFull: 'yes', fullTtlMin: 45 });
  assert.equal(b.default, 'read-only');
  assert.equal(b.allowFull, false);
  assert.equal(b.fullTtlMin, 30);
  const c = normalizePermissionConfig({ default: 'full-ask', allowFull: true, fullTtlMin: 10 });
  assert.deepEqual(c, { default: 'full-ask', allowFull: true, fullTtlMin: 10 });
});

test('会话级值：非法回落 inherit，chat 恒只读', () => {
  assert.equal(normalizeSessionPermission('full'), 'full');
  assert.equal(normalizeSessionPermission('bad'), 'inherit');
  assert.equal(resolvePermission({ profile: { permission: 'full' }, global: { default: 'read-only' }, chat: true }), 'read-only');
  assert.equal(resolvePermission({ profile: { permission: 'inherit' }, global: { default: 'workspace-write' }, chat: false }), 'workspace-write');
  assert.equal(resolvePermission({ profile: { permission: 'full' }, global: { default: 'read-only' }, chat: false }), 'full');
});

test('full 需要 allowFull 且授权窗口内才允许钉', () => {
  assert.equal(canPinLevel('workspace-write', { allowFull: false, grantActive: false }), true);
  assert.equal(canPinLevel('full', { allowFull: false, grantActive: true }), false);
  assert.equal(canPinLevel('full', { allowFull: true, grantActive: false }), false);
  assert.equal(canPinLevel('full', { allowFull: true, grantActive: true }), true);
});

test('不允许 full 时降级为 full-ask', () => {
  assert.equal(presetForLevel('full', { allowFull: false }).level, 'full-ask');
  assert.equal(presetForLevel('full', { allowFull: false }).preset, 'qq-full-ask');
  assert.equal(presetForLevel('full', { allowFull: true, grantActive: true }).preset, 'danger-full-access');
  assert.equal(presetForLevel('read-only').level, 'read-only');
});
