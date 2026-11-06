// 会话标识：新形态 `<platform>:<kind>:<id>`，同时兼容旧的 `group:<id>` / `private:<id>`。
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
  assert.equal(formatKey('qq', 'group', 903621673), 'qq:group:903621673');
  assert.equal(formatKey('tg', 'private', '2897715886'), 'tg:private:2897715886');
});

test('formatKey：平台/类型/id 不合法时抛错，不产出半成品 key', () => {
  assert.throws(() => formatKey('', 'group', 1), /平台名不合法/);
  assert.throws(() => formatKey('QQ!', 'group', 1), /平台名不合法/);
  assert.throws(() => formatKey('qq', 'channel', 1), /类型不合法/);
  assert.throws(() => formatKey('qq', 'group', 'abc'), /id 不合法/);
  assert.throws(() => formatKey('qq', 'group', ''), /id 不合法/);
});

test('parseKey：新旧形态都能解析，旧形态按默认平台算', () => {
  assert.deepEqual(parseKey('qq:group:903621673'), { platform: 'qq', kind: 'group', id: 903621673 });
  assert.deepEqual(parseKey('group:903621673'), { platform: DEFAULT_PLATFORM, kind: 'group', id: 903621673 });
  assert.deepEqual(parseKey('private:2897715886'), { platform: DEFAULT_PLATFORM, kind: 'private', id: 2897715886 });
});

test('parseKey：乱七八糟的输入返回 null（不抛错）', () => {
  for (const bad of ['', 'qq', 'qq:group', 'qq:group:abc', 'group:', ':group:1', null, 42, {}]) {
    assert.equal(parseKey(bad), null, `应拒绝 ${JSON.stringify(bad)}`);
  }
});

test('isSessionKey：只认新形态', () => {
  assert.equal(isSessionKey('qq:group:1'), true);
  assert.equal(isSessionKey('group:1'), false);
});

test('legacyToKey：旧的加平台前缀，新的原样，坏的返回 null', () => {
  assert.equal(legacyToKey('group:903621673'), 'qq:group:903621673');
  assert.equal(legacyToKey('private:1', 'tg'), 'tg:private:1');
  assert.equal(legacyToKey('qq:group:1'), 'qq:group:1');
  assert.equal(legacyToKey('nonsense'), null);
});

test('platformOfKey / kindOfKey / idOfKey：新旧一致', () => {
  assert.equal(platformOfKey('qq:private:12'), 'qq');
  assert.equal(platformOfKey('private:12'), 'qq');
  assert.equal(kindOfKey('group:12'), 'group');
  assert.equal(idOfKey('qq:group:12'), 12);
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
    assert.deepEqual(keyFormat(), { platform: 'tg' });
    configureKeys({ platform: 'BAD NAME' });
    assert.equal(key('group', 7), 'qq:group:7', '非法平台名回落 qq');
    assert.throws(() => key('channel', 1), /类型不合法/);
    assert.throws(() => key('group', 'abc'), /id 不合法/);
  } finally {
    configureKeys({});
  }
});

test('读取侧兼容：旧形态的缓存键仍能被 parseKey / sameSession 认出', () => {
  // 磁盘上还有迁移前写下的 `group:<id>`（prompt-blocks / role-seen 等），读取时不能当垃圾丢掉。
  assert.deepEqual(parseKey('group:903621673'), { platform: 'qq', kind: 'group', id: 903621673 });
  assert.equal(sameSession('qq:group:903621673', 'group:903621673'), true);
});
