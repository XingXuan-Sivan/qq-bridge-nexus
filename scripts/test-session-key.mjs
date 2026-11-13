// 会话标识的基础形态：`<platform>[@<account>]:<type>:<id>`，同时兼容旧的 `group:<id>`。
// 地址维度（账号、非数字 id、跨平台隔离）的回归在 test-session-key-address.mjs。
// 跑 `node scripts/test-session-key.mjs`。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PLATFORM,
  configureKeys,
  formatKey,
  idOfKey,
  isSessionKey,
  key,
  keyFormat,
  kindOfKey,
  legacyToKey,
  parseKey,
  platformOfConfig,
  platformOfKey,
  sameSession,
} from '../src/session/key.mjs';

test('formatKey：正常组装，id 支持数字与数字字符串', () => {
  assert.equal(formatKey('qq', 'group', 100000003), 'qq:group:100000003');
  assert.equal(formatKey('tg', 'private', '1000000002'), 'tg:private:1000000002');
});

test('formatKey：类型是开放的，平台名/id 不合法时抛错，不产出半成品 key', () => {
  // 类型不再枚举：平台自有类型（channel / thread / live）原样写进 key。
  assert.equal(formatKey('tg', 'channel', '@some_channel'), 'tg:channel:@some_channel');
  assert.equal(formatKey('qq', 'group', '100000003', 'napcat'), 'qq@napcat:group:100000003');
  assert.throws(() => formatKey('', 'group', 1), /平台名不合法/);
  assert.throws(() => formatKey('QQ!', 'group', 1), /平台名不合法/);
  assert.throws(() => formatKey('qq', '1group', 1), /类型不合法/);
  assert.throws(() => formatKey('qq', 'group', 'a/b'), /id 不合法/);
  assert.throws(() => formatKey('qq', 'group', ''), /id 不合法/);
});

test('parseKey：新旧形态都能解析，旧形态按默认平台算', () => {
  const modern = parseKey('qq:group:100000003');
  assert.equal(modern.platform, 'qq');
  assert.equal(modern.account, '');
  assert.equal(modern.kind, 'group');
  assert.equal(modern.id, '100000003');
  assert.equal(modern.idNum, 100000003);
  assert.equal(modern.key, 'qq:group:100000003');

  const legacy = parseKey('group:100000003');
  assert.equal(legacy.platform, DEFAULT_PLATFORM);
  assert.equal(legacy.kind, 'group');
  assert.equal(legacy.id, '100000003');

  const legacyPrivate = parseKey('private:1000000002');
  assert.equal(legacyPrivate.platform, DEFAULT_PLATFORM);
  assert.equal(legacyPrivate.kind, 'private');
  assert.equal(legacyPrivate.id, '1000000002');
});

test('parseKey：乱七八糟的输入返回 null（不抛错）', () => {
  for (const bad of ['', 'qq', 'qq:group', 'group:', ':group:1', 'qq:group:a b', 'qq:group:a/b', null, 42, {}]) {
    assert.equal(parseKey(bad), null, `应拒绝 ${JSON.stringify(bad)}`);
  }
});

test('isSessionKey：只认新形态', () => {
  assert.equal(isSessionKey('qq:group:1'), true);
  assert.equal(isSessionKey('group:1'), false);
});

test('legacyToKey：旧的加平台前缀，新的原样，坏的返回 null', () => {
  assert.equal(legacyToKey('group:100000003'), 'qq:group:100000003');
  assert.equal(legacyToKey('private:1', 'tg'), 'tg:private:1');
  assert.equal(legacyToKey('qq:group:1'), 'qq:group:1');
  assert.equal(legacyToKey('nonsense'), null);
});

test('platformOfKey / kindOfKey / idOfKey：新旧一致，id 是字符串', () => {
  assert.equal(platformOfKey('qq:private:12'), 'qq');
  assert.equal(platformOfKey('private:12'), 'qq');
  assert.equal(kindOfKey('group:12'), 'group');
  assert.equal(idOfKey('qq:group:12'), '12');
});

test('platformOfConfig：缺省 / 非法回落 qq，合法值小写化', () => {
  assert.equal(platformOfConfig(undefined), 'qq');
  assert.equal(platformOfConfig({}), 'qq');
  assert.equal(platformOfConfig({ platform: { id: 'TG' } }), 'tg');
  assert.equal(platformOfConfig({ platform: { id: 'QQ!' } }), 'qq');
  assert.equal(platformOfConfig({ platform: { id: '' } }, 'tg'), 'tg');
});

test('sameSession：同一会话的新旧写法视为相同，不同平台视为不同', () => {
  assert.equal(sameSession('qq:group:1', 'group:1'), true);
  assert.equal(sameSession('qq:group:1', 'tg:group:1'), false);
  assert.equal(sameSession('qq:group:1', null), false);
});

test('key()：一律带平台前缀，平台非法回落 qq，参数非法抛错', () => {
  try {
    assert.equal(key('group', 7), 'qq:group:7');
    assert.equal(key('private', '42'), 'qq:private:42');
    configureKeys({ platform: 'tg' });
    assert.equal(key('group', 7), 'tg:group:7');
    assert.deepEqual(keyFormat(), { platform: 'tg', account: '', strict: false });
    configureKeys({ platform: 'BAD NAME' });
    assert.equal(key('group', 7), 'qq:group:7', '非法平台名回落 qq');
    assert.throws(() => key('1group', 1), /类型不合法/);
    assert.throws(() => key('group', 'a b'), /id 不合法/);
  } finally {
    configureKeys({});
  }
});

test('读取侧兼容：旧形态的缓存键仍能被 parseKey / sameSession 认出', () => {
  // 磁盘上还有迁移前写下的 `group:<id>`（prompt-blocks / role-seen 等），读取时不能当垃圾丢掉。
  assert.equal(parseKey('group:100000003')?.platform, 'qq');
  assert.equal(sameSession('qq:group:100000003', 'group:100000003'), true);
});
