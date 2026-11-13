// P3 多管理员：纯函数契约（名单归一化、actor、capability、closed-agent 级别、私聊被动豁免）。
import assert from 'node:assert/strict';
import {
  ADMIN_CAPS, normalizeCaps, normalizeAdmins, findAdmin, actorForQQ, actorForAddress,
  normalizeOwner, isAdminQQ, isPrivilegedPrivate, closedAgentMaxLevel, canOpenLevel, levelRank,
} from '../src/admin/admins.mjs';

// ① 名单归一化：默认值、owner 不入表、非法 cap 丢弃、缺名兜底。
{
  const admins = normalizeAdmins([
    { qq: '100001', caps: ['approve', 'approve', 'nope'], maxLevel: 'l2' },
    { qq: '1000000002', name: '  ', caps: [], maxLevel: 'L9', notify: false, exemptPassive: false },
  ], { ownerQQ: '100001' });
  assert.equal(admins.length, 1, 'owner 不应出现在管理员名单里');
  assert.equal(admins[0].qq, '1000000002');
  assert.equal(admins[0].name, '管理员 0002');
  assert.equal(admins[0].maxLevel, 'L2', '非法级别回退 L2');
  assert.equal(admins[0].notify, false);
  assert.equal(admins[0].exemptPassive, false);
  assert.deepEqual(admins[0].caps, []);
}

// ② 非法配置 fail-fast，不静默丢人。
assert.throws(() => normalizeAdmins('nope'), /admins 必须是数组/);
// id 不再要求是 QQ 号（B2 地址模型），但地址结构必须合法：空 id、群地址、含空白都不行。
assert.throws(() => normalizeAdmins([{ qq: '' }]), /地址不合法/);
assert.throws(() => normalizeAdmins([{ address: 'qq:group:100' }]), /地址不合法/);
assert.throws(() => normalizeAdmins([{ qq: 'a b' }]), /地址不合法/);
assert.throws(() => normalizeAdmins([{ qq: '100001' }, { qq: '100001' }]), /重复/);

// ③ caps 归一化。
assert.deepEqual(normalizeCaps(['approve', 'scheduler', 'approve', 'x']), ['approve', 'scheduler']);
assert.deepEqual(normalizeCaps('approve'), []);

// ④ actor：owner 全能力、admin 只认 caps、user 全拒绝。
{
  const admins = normalizeAdmins([{ qq: '1000000002', caps: ['approve', 'memory'], maxLevel: 'L2' }], { ownerQQ: '100001' });
  const owner = actorForQQ({ ownerQQ: '100001', admins, qq: '100001' });
  assert.equal(owner.role, 'owner');
  assert.equal(owner.maxLevel, 'L3');
  for (const cap of ADMIN_CAPS) assert.equal(owner.can(cap), true);
  const admin = actorForQQ({ ownerQQ: '100001', admins, qq: '1000000002' });
  assert.equal(admin.role, 'admin');
  assert.equal(admin.can('approve'), true);
  assert.equal(admin.can('sessions'), false);
  const user = actorForQQ({ ownerQQ: '100001', admins, qq: '55555' });
  assert.equal(user.role, 'user');
  assert.equal(user.can('approve'), false);
  assert.equal(isAdminQQ({ ownerQQ: '100001', admins, qq: '55555' }), false);
  assert.equal(findAdmin(admins, '1000000002')?.name, '管理员 0002');
}

// ⑤ closed-agent 级别：admin 不超过 maxLevel，owner 永远 L3。
{
  const admin = actorForQQ({ ownerQQ: '100001', admins: [{ qq: '1000000002', name: 'A', caps: [], maxLevel: 'L2', notify: true, exemptPassive: true }], qq: '1000000002' });
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
    { qq: '1000000002', name: 'A', caps: [], maxLevel: 'L2', notify: true, exemptPassive: true },
    { qq: '2897715887', name: 'B', caps: [], maxLevel: 'L2', notify: true, exemptPassive: false },
  ];
  assert.equal(isPrivilegedPrivate({ ownerQQ, admins, qq: ownerQQ, kind: 'private', id: ownerQQ }), true);
  assert.equal(isPrivilegedPrivate({ ownerQQ, admins, qq: '1000000002', kind: 'private', id: '1000000002' }), true);
  assert.equal(isPrivilegedPrivate({ ownerQQ, admins, qq: '2897715887', kind: 'private', id: '2897715887' }), false);
  assert.equal(isPrivilegedPrivate({ ownerQQ, admins, qq: '1000000002', kind: 'group', id: '1000000002' }), false);
}

// ⑦ 地址维度：同名 id 在不同账号/平台下是两个人（B3）。
{
  const ctx = { platform: 'qq', account: 'napcat' };
  // 裸 id 默认挂在当前平台 + 当前账号下。
  const [a] = normalizeAdmins([{ qq: '1000000002', caps: ['approve'] }], ctx);
  assert.equal(a.platform, 'qq');
  assert.equal(a.account, 'napcat');
  assert.equal(a.id, '1000000002');
  assert.equal(a.qq, '1000000002', '旧字段名继续可用');

  // 显式写地址可以跨账号 / 跨平台。
  const list = normalizeAdmins([
    { qq: '1000000002' },
    { address: 'qq@snowluma:private:1000000002' },
    { address: 'telegram:private:1000000002' },
  ], ctx);
  assert.equal(list.length, 3, '同一个 id 在不同地址下是三个人，不应被判重复');
  assert.deepEqual(list.map((x) => `${x.platform}@${x.account}:${x.id}`), [
    'qq@napcat:1000000002', 'qq@snowluma:1000000002', 'telegram@:1000000002',
  ]);

  // owner 只在同一个地址下才算本人；换账号就不是了。
  const owner = normalizeOwner('qq@napcat:private:1000000002', ctx);
  assert.equal(actorForAddress({ owner, admins: [], address: '1000000002', ...ctx }).role, 'owner');
  assert.equal(actorForAddress({ owner, admins: [], address: 'qq@snowluma:private:1000000002', ...ctx }).role, 'user', '换账号就不该继承 owner');
  assert.equal(actorForAddress({ owner, admins: list, address: '1000000002', ...ctx }).role, 'owner', 'owner 同时出现在名单里时仍算 owner');

  // 群地址不能当人：既不能当管理员，也不会产生私聊豁免。
  assert.equal(actorForAddress({ owner, admins: [], address: 'qq:group:1000000002', ...ctx }).role, 'user');
  assert.equal(isPrivilegedPrivate({ owner, admins: [], address: 'qq:group:1000000002', ...ctx }), false);
}

// ⑧ owner 归一化：裸 id / 完整 key / 对象三种写法等价。
{
  const ctx = { platform: 'qq', account: '' };
  const shapes = ['100001', 'qq:private:100001', 'qq:direct:100001', { id: '100001' }, { qq: 100001 }, { platform: 'qq', account: '', id: '100001' }];
  for (const raw of shapes) {
    assert.deepEqual(normalizeOwner(raw, ctx), { platform: 'qq', account: '', id: '100001' }, JSON.stringify(raw));
  }
  assert.equal(normalizeOwner('', ctx), null);
  assert.equal(normalizeOwner(null, ctx), null);
  assert.throws(() => normalizeOwner('qq:group:100001', ctx), /直达地址/);
  assert.throws(() => normalizeOwner({ id: '' }, ctx), /直达地址/);
}

console.log('test-admins: 8/8 通过');
