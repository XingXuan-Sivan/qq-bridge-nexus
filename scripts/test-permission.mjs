import assert from 'node:assert/strict';
import test from 'node:test';
import * as permissionModule from '../src/session/permission.mjs';
import {
  PERMISSION_LEVELS,
  SESSION_PERMISSIONS,
  PERMISSION_LABEL,
  normalizePermissionConfig,
  normalizeSessionPermission,
  resolvePermission,
  permissionText,
} from '../src/session/permission.mjs';

test('四档与继承值', () => {
  assert.deepEqual(PERMISSION_LEVELS, ['read-only', 'workspace-write', 'full-ask', 'full']);
  assert.deepEqual(SESSION_PERMISSIONS, ['inherit', ...PERMISSION_LEVELS]);
  for (const level of PERMISSION_LEVELS) assert.ok(PERMISSION_LABEL[level], `${level} 必须有可读标签`);
  assert.equal(permissionText('full-ask'), '完全访问 · 每次确认');
  assert.equal(permissionText('unknown'), 'unknown', '未知值原样返回，不造伪标签');
});

test('配置归一：默认只读，非法值回落只读', () => {
  assert.deepEqual(normalizePermissionConfig(null), { default: 'read-only' });
  assert.deepEqual(normalizePermissionConfig({ default: 'bad' }), { default: 'read-only' });
  assert.deepEqual(normalizePermissionConfig({ default: 'full' }), { default: 'full' });
  // 旧字段（allowFull / fullTtlMin）不再有任何语义：级别不绑平台、不再有短时授权窗口。
  assert.deepEqual(normalizePermissionConfig({ default: 'full', allowFull: true, fullTtlMin: 10 }), { default: 'full' });
});

test('会话级值：非法回落 inherit，纯聊天会话恒只读', () => {
  assert.equal(normalizeSessionPermission('full'), 'full');
  assert.equal(normalizeSessionPermission('bad'), 'inherit');
  assert.equal(resolvePermission({ profile: { permission: 'full' }, global: { default: 'read-only' }, chat: true }), 'read-only');
  assert.equal(resolvePermission({ profile: { permission: 'inherit' }, global: { default: 'workspace-write' }, chat: false }), 'workspace-write');
  assert.equal(resolvePermission({ profile: { permission: 'full' }, global: { default: 'read-only' }, chat: false }), 'full');
  assert.equal(resolvePermission({ profile: null, global: { default: 'workspace-write' } }), 'workspace-write');
});

test('级别不与平台预设绑定：没有 canPinLevel / presetForLevel 这类入口', () => {
  // 对端权限档由能力档的 runtime.peerPermission 在建会话时一次性钉住，级别只过滤桥接工具表。
  assert.equal(permissionModule.canPinLevel, undefined);
  assert.equal(permissionModule.presetForLevel, undefined);
});
