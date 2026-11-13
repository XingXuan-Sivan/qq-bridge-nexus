// soulkit 记忆 provider 的单元测试（S3）。
//
// 只测两件事：
// 1. 适配器把桥接的会话 key / 检索词翻译成 soulkit `POST /api/recall` 的形态，并能消化几代返回形状；
// 2. 接进内核的记忆注册表后，预热 → 注入 → 截断/状态这条链路成立。
import test from 'node:test';
import assert from 'node:assert/strict';
import { activate } from '../plugins/soulkit-memory/index.mjs';
import { createMemoryRegistry, normalizeMemoryConfig } from '../src/memory/registry.mjs';

const TEXT = '<记忆片段>\n## 你还记得的事\n- 他周末去了杭州\n</记忆片段>';

function makeCtx({ payload = { ok: true, text: TEXT }, status = 200, config = {} } = {}) {
  const calls = [];
  let provider = null;
  const ctx = {
    config,
    memory: {
      registerProvider(p) {
        provider = p;
      },
    },
    http: {
      async requestJson(url, options = {}) {
        calls.push({ url, options });
        return { status, json: payload };
      },
    },
  };
  return { ctx, calls, provider: () => provider };
}

async function setup(options) {
  const harness = makeCtx(options);
  await activate(harness.ctx);
  return { ...harness, provider: harness.provider() };
}

test('soulkit-memory：注册 memory-provider/1，key 削平台前缀，query 取尾部 600 字', async () => {
  const { provider, calls } = await setup();
  assert.equal(provider.id, 'soulkit');
  assert.equal(provider.contract, 'memory-provider/1');
  assert.deepEqual(provider.capabilities, { sync: false, write: false, listable: true });

  const longQuery = '问'.repeat(700);
  const result = await provider.fetch({ key: 'qq:group:100000003', query: longQuery });
  assert.equal(result.text, TEXT);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/recall$/);
  assert.equal(calls[0].options.method, 'POST');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.platform, 'qq');
  assert.equal(body.chat, 'group:100000003');
  assert.equal(body.view, 'self');
  assert.equal(body.query.length, 600);
  assert.equal('limit' in body, false, '字符预算不是条数预算，不应透传成 limit');
});

test('soulkit-memory：私聊 key 与认不出的 key 都按 soulkit 形态传', async () => {
  const { provider, calls } = await setup();
  await provider.fetch({ key: 'qq:private:1000000002' });
  await provider.fetch({ key: 'custom:key' });
  assert.equal(JSON.parse(calls[0].options.body).chat, 'private:1000000002');
  assert.equal(JSON.parse(calls[1].options.body).chat, 'custom:key');
  assert.equal('query' in JSON.parse(calls[0].options.body), false, '空 query 不传');
});

test('soulkit-memory：兼容旧版 block / block.text，空结果不报错', async () => {
  const legacy = await setup({ payload: { ok: true, block: { text: `  ${TEXT}  ` } } });
  assert.equal((await legacy.provider.fetch({ key: 'qq:group:1' })).text, TEXT);

  const abstained = await setup({ payload: { ok: true, text: '', abstained: true, reason: 'no_match' } });
  assert.equal((await abstained.provider.fetch({ key: 'qq:group:1' })).text, '');

  const stringBlock = await setup({ payload: { block: TEXT } });
  assert.equal((await stringBlock.provider.fetch({ key: 'qq:group:1' })).text, TEXT);
});

test('soulkit-memory：非 200 抛错，交给注册表记失败', async () => {
  const { provider } = await setup({ status: 500, payload: {} });
  await assert.rejects(() => provider.fetch({ key: 'qq:group:1' }), /HTTP 500/);
});

test('记忆注册表：soulkit 预热后注入，超出上限记 truncated', async () => {
  const { provider } = await setup();
  const config = normalizeMemoryConfig({
    inject: { provider: 'soulkit', maxChars: 20 },
    providers: { soulkit: { enabled: true, maxChars: 20 } },
  });
  const registry = createMemoryRegistry({ config });
  registry.register(provider, 'soulkit-memory');

  assert.equal(registry.injectionSync({ key: 'qq:group:1', query: 'q' }).status, 'empty', '预热前没有缓存，注入为空');
  await registry.warm({ key: 'qq:group:1', query: 'q' });
  const injected = registry.injectionSync({ key: 'qq:group:1', query: 'q' });
  assert.equal(injected.status, 'truncated');
  assert.equal(injected.chars, 20);
  assert.equal(injected.text.length, 20);

  const status = registry.status();
  assert.equal(status.inject.provider, 'soulkit');
  assert.equal(status.providers[0].lastStatus, 'truncated');
  assert.equal(status.providers[0].calls, 2, '两次注入各记一次调用');
});

test('记忆注册表：soulkit 报错时静默为空，状态记 error', async () => {
  const { provider } = await setup({ status: 503 });
  const config = normalizeMemoryConfig({ inject: { provider: 'soulkit' }, providers: { soulkit: { enabled: true } } });
  const registry = createMemoryRegistry({ config });
  registry.register(provider, 'soulkit-memory');

  await registry.warm({ key: 'qq:group:1', query: 'q' });
  // 先看预热失败的状态：注入是同步读缓存，随后会把 lastStatus 覆写成 empty，
  // 所以失败证据（failures / lastError）要在注入之前取。
  const failed = registry.status().providers[0];
  assert.equal(failed.lastStatus, 'error');
  assert.equal(failed.failures, 1);
  const injected = registry.injectionSync({ key: 'qq:group:1', query: 'q' });
  assert.equal(injected.text, '');
  assert.equal(injected.status, 'empty');
});
