/**
 * 两态单源准入的离线测试：名单解析、白/黑生效、旧三态迁移、幂等。
 *
 * 语义：白名单 = 默认拒绝 + 名单内允许；黑名单 = 默认允许 + 名单内拒绝。
 * 空名单同样是有效输入：白名单空 = 全拒，黑名单空 = 全允。
 */
import assert from 'node:assert/strict';
import {
  createAccessConfig, normalizeAccessEntries, normalizeAccessConfig, parseAccessEntry, resolveAccess, resolveAccessSummary,
} from '../src/session/access.mjs';
import { migrateAccessModel, summarizeAccessConfig } from '../src/session/access-migrate.mjs';

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n  ${error?.stack ?? error}`);
  }
}

await test('名单条目：补平台前缀、拒绝裸 ID、去重保序', () => {
  assert.equal(parseAccessEntry('group:123'), 'qq:group:123');
  assert.equal(parseAccessEntry('private:456'), 'qq:private:456');
  assert.equal(parseAccessEntry('qq:group:9'), 'qq:group:9');
  assert.equal(parseAccessEntry('123'), null);
  assert.equal(parseAccessEntry('group:abc'), null);
  const got = normalizeAccessEntries(['group:1', 'qq:group:1', 'private:2', 'bad', '  ']);
  assert.deepEqual(got.entries, ['qq:group:1', 'qq:private:2']);
  assert.deepEqual(got.invalid, ['bad']);
});

await test('白名单空=全拒，黑名单空=全允；名单成员翻转生效值', () => {
  const white = createAccessConfig();
  assert.equal(resolveAccess('passive', 'qq:group:1', { defaults: white }), 'deny');
  white.passive.entries.push('qq:group:1');
  assert.equal(resolveAccess('passive', 'qq:group:1', { defaults: white }), 'allow');
  assert.equal(resolveAccess('passive', 'qq:group:2', { defaults: white }), 'deny');

  const black = { version: 2, passive: { mode: 'deny', entries: [] }, proactive: { mode: 'allow', entries: [] } };
  assert.equal(resolveAccess('passive', 'qq:group:1', { defaults: black }), 'allow');
  black.passive.entries.push('qq:group:1');
  assert.equal(resolveAccess('passive', 'qq:group:1', { defaults: black }), 'deny');
});

await test('迁移：旧默认 deny→白名单、旧默认 allow→黑名单，并清掉三态字段', () => {
  const state = {
    defaults: { passive: 'deny', proactive: 'allow' },
    profiles: {
      'qq:group:1': { access: { passive: 'allow', proactive: 'inherit' } },
      'qq:group:2': { access: { passive: 'deny', proactive: 'deny' } },
      'qq:group:3': { blocked: true, access: { passive: 'allow', proactive: 'allow' } },
      'qq:private:99': { access: { passive: 'inherit', proactive: 'inherit' } },
      'qq:private:88': { access: { passive: 'inherit', proactive: 'inherit' } },
    },
  };
  const out = migrateAccessModel(state, {
    ownerKey: 'qq:private:99',
    adminPassiveKeys: ['qq:private:88'],
  });
  assert.equal(out.changed, true);
  assert.equal(out.defaults.passive.mode, 'allow');
  assert.deepEqual(out.defaults.passive.entries.sort(), ['qq:group:1', 'qq:private:88', 'qq:private:99']);
  assert.equal(out.defaults.proactive.mode, 'deny');
  assert.deepEqual(out.defaults.proactive.entries.sort(), ['qq:group:2', 'qq:group:3']);
  for (const profile of Object.values(out.profiles)) {
    assert.equal(Object.hasOwn(profile, 'access'), false);
    assert.equal(Object.hasOwn(profile, 'blocked'), false);
    assert.equal(Object.hasOwn(profile, 'legacyAccess'), false);
  }
  const again = migrateAccessModel({ ...state, defaults: out.defaults, profiles: out.profiles }, {});
  assert.equal(again.changed, false);
});

await test('汇总：模式、条数、成员关系与生效值', () => {
  const defaults = createAccessConfig();
  defaults.passive.entries.push('qq:group:1');
  defaults.proactive.mode = 'deny';
  defaults.proactive.entries.push('qq:group:2');
  const summary = resolveAccessSummary('qq:group:1', { defaults });
  assert.equal(summary.passive, 'allow');
  assert.equal(summary.passiveMode, 'allow');
  assert.equal(summary.passiveMember, true);
  assert.equal(summary.proactive, 'allow');
  assert.equal(summary.proactiveMode, 'deny');
  assert.equal(summary.proactiveMember, false);
  const s = summarizeAccessConfig(defaults);
  assert.equal(s.passive.mode, 'allow');
  assert.equal(s.passive.count, 1);
  assert.equal(s.proactive.mode, 'deny');
});

await test('配置规范化：只认 v2，旧形状不冒充新配置', () => {
  assert.equal(normalizeAccessConfig({ passive: 'deny', proactive: 'deny' }), null);
  const v2 = normalizeAccessConfig({ version: 2, passive: { mode: 'deny', entries: ['group:1'] }, proactive: { mode: 'allow', entries: [] } });
  assert.equal(v2.passive.mode, 'deny');
  assert.deepEqual(v2.passive.entries, ['qq:group:1']);
});

if (failed) process.exitCode = 1;
