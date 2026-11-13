// 地址模型（B2）：账号维度、非数字 id、开放类型、以及「跨平台串号必须失败」。
//
// 这一组回归护着主键。key 同时是 sessions.json / 档案目录 / 白名单 / 定时目标的主键，
// 一旦在这里静默拼错，症状是「数据看起来在，但就是对不上」——比抛错难查得多。
// 跑 `node scripts/test-session-key-address.mjs`。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  accountOfConfig,
  accountOfKey,
  configureKeys,
  currentAddress,
  defaultAddress,
  formatAddress,
  formatKey,
  isGroupKey,
  isPrivateKey,
  key,
  keyFor,
  normalizeKey,
  parseKey,
  sameSession,
  shapeOfKey,
  shapeOfType,
  withAddress,
} from '../src/session/key.mjs';

test('账号维度：同名群号在两个账号下是两条会话', () => {
  const a = formatKey('qq', 'group', '100000003', 'luma');
  const b = formatKey('qq', 'group', '100000003', 'napcat');
  const dflt = formatKey('qq', 'group', '100000003');
  assert.equal(a, 'qq@luma:group:100000003');
  assert.equal(b, 'qq@napcat:group:100000003');
  assert.equal(dflt, 'qq:group:100000003');
  assert.notEqual(a, b);
  assert.notEqual(a, dflt);
  assert.equal(sameSession(a, b), false);
  assert.equal(sameSession(a, dflt), false);
  assert.equal(accountOfKey(a), 'luma');
  assert.equal(accountOfKey(dflt), '');
});

test('账号名参与解析与回写，地址大小写归一（key 本身大小写敏感）', () => {
  // 写入侧（formatKey/configureKeys）一律小写化，所以磁盘上的 key 永远只有一种写法；
  // 读取侧不再做模糊匹配：`QQ:group:1` 不是合法 key（避免 Admin 与 admin 歧义）。
  assert.equal(formatKey('QQ', 'group', '123', 'NapCat'), 'qq@napcat:group:123');
  assert.equal(parseKey('QQ:group:1'), null);
  assert.equal(parseKey('qq:GROUP:1'), null);
  const parsed = parseKey('qq@napcat:group:123');
  assert.equal(parsed.platform, 'qq');
  assert.equal(parsed.account, 'napcat');
  assert.equal(parsed.key, 'qq@napcat:group:123');
  assert.equal(formatAddress({ platform: 'qq', account: 'napcat' }), 'qq@napcat');
  assert.equal(formatAddress({ platform: 'qq' }), 'qq');
});

test('id 一律字符串：超过 2^53 的 int64 不会被截断', () => {
  const parsed = parseKey('qq:group:9007199254740993');
  assert.equal(parsed.id, '9007199254740993');
  assert.equal(parsed.key, 'qq:group:9007199254740993', '回写必须与读入逐字相同');
  // 数值形态只作为过渡期的辅助字段存在，它确实会丢精度 —— 所以任何主键都不能用它。
  assert.notEqual(String(parsed.idNum), '9007199254740993');
});

test('非数字 id 与平台自有类型：telegram 频道 / 线程', () => {
  const channel = parseKey('telegram:channel:@some_channel');
  assert.equal(channel.id, '@some_channel');
  assert.equal(channel.kind, 'channel');
  assert.equal(channel.idNum, null);
  assert.equal(channel.shape, 'group', '平台自有类型按多方会话处理');
  assert.equal(channel.key, 'telegram:channel:@some_channel');

  const thread = parseKey('discord:thread:1234567890123456789');
  assert.equal(thread.shape, 'group');
  assert.equal(thread.idNum, 1234567890123456789);
});

test('内核语义：group / direct / temp，private 是 direct 的别名', () => {
  assert.equal(shapeOfKey('qq:private:1'), 'direct');
  assert.equal(shapeOfKey('qq:direct:1'), 'direct');
  assert.equal(shapeOfKey('qq:group:1'), 'group');
  assert.equal(shapeOfKey('qq:temp:1'), 'temp');
  assert.equal(shapeOfType('dm'), 'direct');
  assert.equal(shapeOfType('live'), 'group');
  assert.equal(shapeOfType(''), null);
  assert.equal(isGroupKey('qq:group:1'), true);
  assert.equal(isPrivateKey('qq:private:1'), true);
  assert.equal(isPrivateKey('qq:direct:1'), true);
  assert.equal(isGroupKey('qq:temp:1'), false);
  assert.equal(isPrivateKey('qq:temp:1'), false);
  assert.equal(sameSession('qq:private:1', 'qq:direct:1'), true);
  assert.equal(sameSession('qq:private:1', 'qq@napcat:private:1'), false);
});

test('id 的字符集：路径分隔符、空白、key 分隔符一律拒绝', () => {
  for (const bad of ['a/b', 'a\\b', 'a:b', 'a b', 'a\tb', 'a<b', 'a|b', 'x'.repeat(129), '']) {
    assert.throws(() => formatKey('qq', 'group', bad), /id 不合法/, `应拒绝 ${JSON.stringify(bad)}`);
    assert.equal(parseKey(`qq:group:${bad}`), null, `parseKey 应拒绝 ${JSON.stringify(bad)}`);
  }
  // 允许：@ / 中文 / 点 / 下划线（别的平台的 id 需要）
  assert.equal(formatKey('telegram', 'channel', '@a_channel.1'), 'telegram:channel:@a_channel.1');
  assert.equal(formatKey('qq', 'group', '群-①'), 'qq:group:群-①');
});

test('纯数字 id 去前导零：同一个会话只允许一种写法', () => {
  assert.equal(formatKey('qq', 'group', '0456'), 'qq:group:456');
  assert.equal(parseKey('qq:group:0456').key, 'qq:group:456');
  assert.equal(sameSession('qq:group:0456', 'qq:group:456'), true);
  assert.equal(parseKey('group:0456').key, 'qq:group:456');
  assert.equal(formatKey('qq', 'group', '0'), 'qq:group:0', '只去前导零，不改其它值');
  assert.equal(formatKey('qq', 'group', '0012a'), 'qq:group:0012a', '非纯数字 id 不动');
});

test('withAddress：上下文优先于进程默认，嵌套可覆盖', async () => {
  try {
    configureKeys({ platform: 'qq' });
    assert.deepEqual(currentAddress(), null, '不在上下文里就是 null');
    assert.deepEqual(defaultAddress(), { platform: 'qq', account: '' });

    const inner = await withAddress({ platform: 'tg', account: 'bot1' }, async () => {
      assert.deepEqual(currentAddress(), { platform: 'tg', account: 'bot1' });
      const here = key('group', '1');
      // 显式给地址就按地址来（调用方知情，允许跨平台）
      const explicit = keyFor('qq', 'group', '1');
      const nested = await withAddress({ platform: 'qq' }, () => key('group', '1'));
      return { here, explicit, nested };
    });
    assert.equal(inner.here, 'tg@bot1:group:1');
    assert.equal(inner.explicit, 'qq:group:1');
    assert.equal(inner.nested, 'qq:group:1');
    assert.deepEqual(currentAddress(), null, '上下文不泄漏到外面');
    assert.equal(key('group', '1'), 'qq:group:1', '上下文结束后回到进程默认');
  } finally {
    configureKeys({});
  }
});

test('strict：多平台部署下没有地址就构造 key 必须抛错', () => {
  try {
    configureKeys({ platform: 'qq', account: 'luma', strict: true });
    assert.throws(() => key('group', '1'), /必须先确定地址/);
    // 在上下文里就合法
    assert.equal(withAddress({ platform: 'tg' }, () => key('group', '1')), 'tg:group:1');
    // 显式传地址也合法
    assert.equal(key('group', '1', { platform: 'qq', account: 'luma' }), 'qq@luma:group:1');
  } finally {
    configureKeys({});
  }
});

test('地址对象本身要合法：平台名/账号名不合法时抛错', () => {
  assert.throws(() => withAddress({ platform: 'QQ!' }, () => {}), /平台名不合法/);
  assert.throws(() => withAddress({}, () => {}), /平台名不合法/);
  assert.throws(() => withAddress({ platform: 'qq', account: 'a b' }, () => {}), /账号名不合法/);
  assert.throws(() => withAddress(null, () => {}), /地址必须是/);
  assert.throws(() => withAddress({ platform: 'qq' }, 'not a function'), /需要一个函数/);
});

test('normalizeKey：旧形态进、规范形态出；坏输入返回 null', () => {
  assert.equal(normalizeKey('group:123'), 'qq:group:123');
  assert.equal(normalizeKey('private:123'), 'qq:private:123');
  assert.equal(normalizeKey('qq:group:123'), 'qq:group:123');
  assert.equal(normalizeKey('qq@napcat:group:123'), 'qq@napcat:group:123');
  assert.equal(normalizeKey('nonsense'), null);
  assert.equal(normalizeKey(null), null);
});

test('accountOfConfig：缺省为空，非法回落空，合法小写化', () => {
  assert.equal(accountOfConfig(undefined), '');
  assert.equal(accountOfConfig({}), '');
  assert.equal(accountOfConfig({ platform: { id: 'qq', account: 'NapCat' } }), 'napcat');
  assert.equal(accountOfConfig({ platform: { account: 'a b' } }), '');
});
