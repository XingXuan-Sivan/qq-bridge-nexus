// soulkit 人格适配器回归（docs/PLUGIN_KERNEL.md §9.3）。
//
// 这个插件只做三件事：拉卡、缓存、同步供人格注入点读取。测试钉住的也是这三件事的
// 边界条件——**网络永远可能失败**，适配器任何时候都不该让 prompt 组装拿到异常或空卡：
//   1. 启动即拉一次，成功后 resolve 同步给出 { name, text, fingerprint }；
//   2. 拉取失败保留旧缓存，且只告警一次（避免每 5 分钟刷屏）；
//   3. TTL 过期由 onInbound 触发刷新，30 秒内不重复打网络；
//   4. 返回缺 name/text 视为坏卡，不覆盖旧缓存；
//   5. 上次进程留下的缓存，启动时先可读，不用等网络；
//   6. 配置的 baseUrl 非法时直接抛错（内核会把它标成 failed，主链不受影响）。
//
// 全部离线：fetchJson 是注入的假实现，状态目录只在内存里。
import assert from 'node:assert/strict';
import test from 'node:test';

const CARD = { name: '星苒', text: '我是星苒。今天也想和你说说话。' };

function makeCtx({ config = {}, card = CARD, nowValue = 0, preloaded = null, failWith = null } = {}) {
  const clock = { now: nowValue };
  const state = new Map();
  if (preloaded) state.set('card', preloaded);

  const calls = [];
  const logs = [];
  let provider = null;

  const ctx = {
    config: { holder: 'group:123', ...config },
    state: {
      read: (name) => state.get(name) ?? null,
      write: (name, value) => { state.set(name, value); },
    },
    persona: {
      register: (p) => { provider = p; },
      unregister: () => { provider = null; },
    },
    http: {
      fetchJson: async (url, opts) => {
        calls.push({ url, opts });
        if (failWith) throw new Error(failWith);
        return card;
      },
    },
    log: (line) => { logs.push(String(line)); },
    now: () => clock.now,
  };

  return {
    ctx,
    clock,
    calls,
    logs,
    get provider() { return provider; },
    advance: (ms) => { clock.now += ms; },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('启动即拉卡，resolve 同步返回人格卡', async () => {
  const harness = makeCtx();
  const { activate } = await import('../plugins/soulkit-persona/index.mjs');
  await activate(harness.ctx);
  await tick();

  assert.equal(harness.calls.length, 1);
  const url = new URL(harness.calls[0].url);
  assert.equal(url.pathname, '/api/persona/card');
  assert.equal(url.searchParams.get('holder'), 'group:123');
  assert.equal(harness.provider.id, 'soulkit');

  const resolved = harness.provider.resolve('group:123');
  assert.equal(resolved.name, CARD.name);
  assert.equal(resolved.text, CARD.text);
  assert.match(resolved.fingerprint, /^sha256:[0-9a-f]{64}$/);
  // 缓存必须落盘，供下次进程启动先读
  assert.equal(harness.ctx.state.read('card').name, CARD.name);
});

test('拉取失败保留旧卡，且只告警一次', async () => {
  const harness = makeCtx();
  const { activate } = await import('../plugins/soulkit-persona/index.mjs');
  const plugin = await activate(harness.ctx);
  await tick();
  assert.equal(harness.provider.resolve('group:123').name, CARD.name);

  // 让下一次刷新失败
  harness.ctx.http.fetchJson = async () => { throw new Error('ECONNREFUSED'); };
  harness.advance(6 * 60 * 1000); // 过 TTL
  plugin.hooks.onInbound({});
  await tick();

  assert.equal(harness.provider.resolve('group:123').name, CARD.name, '旧卡必须保留');
  const failures = harness.logs.filter((line) => line.includes('刷新失败'));
  assert.equal(failures.length, 1, '第一次失败要留日志');

  // 第二次失败不再告警（warned 置位）
  harness.advance(60 * 1000);
  plugin.hooks.onInbound({});
  await tick();
  assert.equal(harness.logs.filter((line) => line.includes('刷新失败')).length, 1);
});

test('TTL 过期由 onInbound 触发刷新，30 秒内不重复打网络', async () => {
  const harness = makeCtx();
  const { activate } = await import('../plugins/soulkit-persona/index.mjs');
  const plugin = await activate(harness.ctx);
  await tick();
  assert.equal(harness.calls.length, 1);

  plugin.hooks.onInbound({});
  await tick();
  assert.equal(harness.calls.length, 1, '未过期不刷新');

  harness.advance(6 * 60 * 1000);
  plugin.hooks.onInbound({});
  await tick();
  assert.equal(harness.calls.length, 2);

  plugin.hooks.onInbound({});
  await tick();
  assert.equal(harness.calls.length, 2, '30 秒最小间隔内不重复请求');
});

test('返回缺 name/text 的坏卡不覆盖旧缓存', async () => {
  const harness = makeCtx();
  const { activate } = await import('../plugins/soulkit-persona/index.mjs');
  const plugin = await activate(harness.ctx);
  await tick();

  harness.ctx.http.fetchJson = async () => ({ name: '  ', text: '' });
  harness.advance(6 * 60 * 1000);
  plugin.hooks.onInbound({});
  await tick();

  assert.equal(harness.provider.resolve('group:123').text, CARD.text);
  assert.equal(harness.ctx.state.read('card').name, CARD.name);
});

test('上次进程留下的缓存启动即可用，不等网络', async () => {
  const preloaded = {
    name: '魅魔',
    text: '旧缓存里的人格卡。',
    holder: 'group:123',
    baseUrl: 'http://127.0.0.1:3110/',
    fetchedAt: 0,
    fingerprint: 'sha256:deadbeef',
  };
  const harness = makeCtx({ preloaded, card: CARD, failWith: 'ECONNRESET' });
  const { activate } = await import('../plugins/soulkit-persona/index.mjs');
  await activate(harness.ctx);

  const resolved = harness.provider.resolve('group:123');
  assert.equal(resolved.name, '魅魔', '网络失败时用缓存');
  await tick();
  assert.equal(harness.provider.resolve('group:123').name, '魅魔', '刷新失败后仍是缓存');
});

test('baseUrl 非法时 activate 直接抛错（由内核标 failed）', async () => {
  const harness = makeCtx({ config: { baseUrl: 'ftp://soulkit.local' } });
  const { activate } = await import('../plugins/soulkit-persona/index.mjs');
  await assert.rejects(() => activate(harness.ctx), /baseUrl/);
});
