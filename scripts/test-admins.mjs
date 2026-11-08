// P3 多管理员：纯函数契约（名单归一化、actor、capability、closed-agent 级别、私聊被动豁免）。
import assert from 'node:assert/strict';
import {
  ADMIN_CAPS, normalizeCaps, normalizeAdmins, findAdmin, actorForQQ,
  isAdminQQ, isPrivilegedPrivate, closedAgentMaxLevel, canOpenLevel, levelRank,
} from '../src/admin/admins.mjs';

// ① 名单归一化：默认值、owner 不入表、非法 cap 丢弃、缺名兜底。
{
  const admins = normalizeAdmins([
    { qq: '100001', caps: ['approve', 'approve', 'nope'], maxLevel: 'l2' },
    { qq: '2897715886', name: '  ', caps: [], maxLevel: 'L9', notify: false, exemptPassive: false },
  ], { ownerQQ: '100001' });
  assert.equal(admins.length, 1, 'owner 不应出现在管理员名单里');
  assert.equal(admins[0].qq, '2897715886');
  assert.equal(admins[0].name, '管理员 5886');
  assert.equal(admins[0].maxLevel, 'L2', '非法级别回退 L2');
  assert.equal(admins[0].notify, false);
  assert.equal(admins[0].exemptPassive, false);
  assert.deepEqual(admins[0].caps, []);
}

// ② 非法配置 fail-fast，不静默丢人。
assert.throws(() => normalizeAdmins('nope'), /admins 必须是数组/);
assert.throws(() => normalizeAdmins([{ qq: 'abc' }]), /qq 必须是 QQ 号/);
assert.throws(() => normalizeAdmins([{ qq: '100001' }, { qq: '100001' }]), /重复/);

// ③ caps 归一化。
assert.deepEqual(normalizeCaps(['approve', 'scheduler', 'approve', 'x']), ['approve', 'scheduler']);
assert.deepEqual(normalizeCaps('approve'), []);

// ④ actor：owner 全能力、admin 只认 caps、user 全拒绝。
{
  const admins = normalizeAdmins([{ qq: '2897715886', caps: ['approve', 'memory'], maxLevel: 'L2' }], { ownerQQ: '100001' });
  const owner = actorForQQ({ ownerQQ: '100001', admins, qq: '100001' });
  assert.equal(owner.role, 'owner');
  assert.equal(owner.maxLevel, 'L3');
  for (const cap of ADMIN_CAPS) assert.equal(owner.can(cap), true);
  const admin = actorForQQ({ ownerQQ: '100001', admins, qq: '2897715886' });
  assert.equal(admin.role, 'admin');
  assert.equal(admin.can('approve'), true);
  assert.equal(admin.can('sessions'), false);
  const user = actorForQQ({ ownerQQ: '100001', admins, qq: '55555' });
  assert.equal(user.role, 'user');
  assert.equal(user.can('approve'), false);
  assert.equal(isAdminQQ({ ownerQQ: '100001', admins, qq: '55555' }), false);
  assert.equal(findAdmin(admins, '2897715886')?.name, '管理员 5886');
}

// ⑤ closed-agent 级别：admin 不超过 maxLevel，owner 永远 L3。
{
  const admin = actorForQQ({ ownerQQ: '100001', admins: [{ qq: '2897715886', name: 'A', caps: [], maxLevel: 'L2', notify: true, exemptPassive: true }], qq: '2897715886' });
  const owner = actorForQQ({ ownerQQ: '100001', admins: [], qq: '100001' });
  assert.equal(closedAgentMaxLevel(admin), 'L2');
  assert.equal(canOpenLevel(admin, 'L1'), true);
  assert.equal(canOpenLevel(admin, 'L2'), true);
  assert.equal(canOpenLevel(admin, 'L3'), false);
  assert.equal(canOpenLevel(owner, 'L3'), true);
  assert.equal(canOpenLevel(actorForQQ({ qq: '55555' }), 'L1'), false);
  assert.equal(levelRank('L3'), 2);
}

// ⑥ 管理员私聊被动豁免：只对 private，exemptPassive 可关；owner 永远开。
{
  const ownerQQ = '100001';
  const admins = [
    { qq: '2897715886', name: 'A', caps: [], maxLevel: 'L2', notify: true, exemptPassive: true },
    { qq: '2897715887', name: 'B', caps: [], maxLevel: 'L2', notify: true, exemptPassive: false },
  ];
  assert.equal(isPrivilegedPrivate({ ownerQQ, admins, qq: ownerQQ, kind: 'private', id: ownerQQ }), true);
  assert.equal(isPrivilegedPrivate({ ownerQQ, admins, qq: '2897715886', kind: 'private', id: '2897715886' }), true);
  assert.equal(isPrivilegedPrivate({ ownerQQ, admins, qq: '2897715887', kind: 'private', id: '2897715887' }), false);
  assert.equal(isPrivilegedPrivate({ ownerQQ, admins, qq: '2897715886', kind: 'group', id: '2897715886' }), false);
}

console.log('test-admins: 6/6 通过');
