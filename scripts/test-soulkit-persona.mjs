// soulkit 人格适配器回归（docs/PERSONA_PROVIDER.md）。
//
// 适配器只做协议翻译：端点、参数、三态映射、标题行剥离、ETag 透传。
// 这里用假 ctx，不连 soulkit、不碰磁盘——真实网络行为由 soulkit 自己的测试覆盖。
import assert from 'node:assert/strict';
import test from 'node:test';

import { activate } from '../plugins/soulkit-persona/index.mjs';

function makeCtx({ requestJson, config = {} } = {}) {
  const registered = [];
  const calls = [];
  const ctx = {
    id: 'soulkit-persona',
    config,
    log: () => {},
    persona: { register: (provider) => registered.push(provider), unregister: () => {} },
    http: {
      async requestJson(url, options = {}) {
        calls.push({ url, options });
        return requestJson(url, options);
      },
    },
  };
  return { ctx, registered, calls };
}

test('注册：契约、能力与无钩子', async () => {
  const { ctx, registered } = makeCtx({ requestJson: async () => ({ status: 200, etag: null, json: { mode: 'none' } }) });
  const result = await activate(ctx);
  assert.equal(registered.length, 1);
  const provider = registered[0];
  assert.equal(provider.id, 'soulkit');
  assert.equal(provider.contract, 'persona-provider/1');
  assert.deepEqual(provider.capabilities, { perSession: true, conditional: true, listable: false });
  assert.equal(typeof provider.get, 'function');
  // 刷新时机由内核决定，插件不再自己挂在 onInbound 上。
  assert.deepEqual(result, {});
});

test('卡片：platform+key 参数、剥掉标题行、ETag 透传', async () => {
  const seen = [];
  const { ctx, registered, calls } = makeCtx({
    requestJson: async (url, options) => {
      seen.push({ url, options });
      return {
        status: 200,
        etag: 'W/"1"',
        json: { mode: 'card', name: '星苒', sha: '257399a91c', text: '【人格卡：星苒｜257399a91c】\n# 星苒\n\n正文第一段' },
      };
    },
  });
  await activate(ctx);
  const result = await registered[0].get('group:1047096216', { etag: 'W/"0"' });

  assert.equal(result.status, 'card');
  assert.equal(result.card.name, '星苒');
  assert.equal(result.card.text, '# 星苒\n\n正文第一段');
  assert.equal(result.etag, 'W/"1"');
  assert.equal(result.card.fingerprint, undefined, '指纹交给内核算，适配器不透传 soulkit 的 sha');

  assert.equal(calls.length, 1);
  const url = new URL(seen[0].url);
  assert.equal(url.pathname, '/api/persona/card');
  assert.equal(url.searchParams.get('platform'), 'qq');
  assert.equal(url.searchParams.get('key'), 'group:1047096216');
  assert.deepEqual(seen[0].options.headers, { 'if-none-match': 'W/"0"' });
});

test('304：条件请求命中，返回 not-modified 并带新 ETag', async () => {
  const { ctx, registered } = makeCtx({ requestJson: async () => ({ status: 304, etag: 'W/"9"', json: null }) });
  await activate(ctx);
  const result = await registered[0].get('group:1', { etag: 'W/"8"' });
  assert.deepEqual(result, { status: 'not-modified', etag: 'W/"9"' });
});

test('未绑定：none + reason；没有 key 时不发请求', async () => {
  let calls = 0;
  const { ctx, registered } = makeCtx({
    requestJson: async () => { calls += 1; return { status: 200, etag: null, json: { ok: true, mode: 'none', reason: 'unbound' } }; },
  });
  await activate(ctx);
  assert.deepEqual(await registered[0].get('group:999'), { status: 'none', reason: 'unbound' });
  assert.deepEqual(await registered[0].get(''), { status: 'none', reason: 'no-key' });
  assert.equal(calls, 1, '空 key 不应该打到 soulkit');
});

test('坏响应：未知 mode / 缺 name / 缺正文都抛错（由注册表降级，不在这里吞）', async () => {
  const { ctx, registered } = makeCtx({ requestJson: async () => ({ status: 200, etag: null, json: { mode: 'weird' } }) });
  await activate(ctx);
  await assert.rejects(() => registered[0].get('group:1'), /未知 mode/);

  const missing = makeCtx({ requestJson: async () => ({ status: 200, etag: null, json: { mode: 'card', name: '', text: 'x' } }) });
  await activate(missing.ctx);
  await assert.rejects(() => missing.registered[0].get('group:1'), /缺少 name/);

  const emptyText = makeCtx({ requestJson: async () => ({ status: 200, etag: null, json: { mode: 'card', name: '星苒', text: '【人格卡：星苒｜abc】' } }) });
  await activate(emptyText.ctx);
  await assert.rejects(() => emptyText.registered[0].get('group:1'), /正文/);
});

test('配置：baseUrl 末尾斜杠与协议、timeoutMs 边界', async () => {
  const seen = [];
  const { ctx, registered } = makeCtx({
    config: { baseUrl: 'http://127.0.0.1:3110/', timeoutMs: 99 },
    requestJson: async (url, options) => { seen.push({ url, options }); return { status: 200, etag: null, json: { mode: 'none' } }; },
  });
  await activate(ctx);
  await registered[0].get('private:1');
  assert.match(seen[0].url, /^http:\/\/127\.0\.0\.1:3110\/api\/persona\/card\?/);
  assert.equal(seen[0].options.timeoutMs, 200);

  const badBase = makeCtx({
    config: { baseUrl: 'ftp://example.com' },
    requestJson: async (url) => { seen.push({ url }); return { status: 200, etag: null, json: { mode: 'none' } }; },
  });
  await activate(badBase.ctx);
  await badBase.registered[0].get('group:1');
  assert.match(seen[1].url, /^http:\/\/127\.0\.0\.1:3110\//);
});
