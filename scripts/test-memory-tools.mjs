// 记忆工具（S4）：主动回忆的联邦查询与写回路由。
// 这里只测注册表本身（纯函数 + 假 provider），HTTP/MCP 层由桥接重启后的真机探针覆盖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRegistry, normalizeMemoryConfig } from '../src/memory/registry.mjs';

function provider(id, { text = '', sync = false, write = false, delay = 0, fail = false, note } = {}) {
  const calls = [];
  const p = {
    id,
    label: `源-${id}`,
    contract: 'memory-provider/1',
    capabilities: { sync, write, listable: true },
    calls,
  };
  if (sync) {
    p.fetchSync = ({ key, query }) => {
      calls.push({ key, query });
      if (fail) throw new Error(`${id} 挂了`);
      return { text };
    };
  } else {
    p.fetch = async ({ key, query }) => {
      calls.push({ key, query });
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (fail) throw new Error(`${id} 挂了`);
      return { text };
    };
  }
  if (write) p.note = note ?? ((payload) => ({ ok: true, echo: payload.text }));
  return p;
}

function registryWith(providers, memory = {}) {
  const registry = createMemoryRegistry({
    config: normalizeMemoryConfig({ inject: { provider: providers[0].id, timeoutMs: 50 }, ...memory }),
  });
  for (const p of providers) registry.register(p, 'test-plugin');
  return registry;
}

test('recall：联邦查询所有启用的源，标注 provider，按 limit 截断', async () => {
  const a = provider('local-digest', { text: '本机记忆', sync: true });
  const b = provider('soulkit', { text: '长期记忆 A' });
  const registry = registryWith([a, b]);
  const out = await registry.recall({ key: 'qq:group:1', query: '杭州', limit: 2 });
  assert.equal(out.results.length, 2);
  assert.deepEqual(out.results.map((r) => r.provider), ['local-digest', 'soulkit']);
  assert.equal(out.results[0].text, '本机记忆');
  assert.equal(out.results[1].text, '长期记忆 A');
  assert.equal(out.totalChars, 10);
  assert.equal(b.calls.length, 1);
  assert.equal(b.calls[0].query, '杭州');
});

test('recall：limit=1 只查第一个源；provider 过滤只查指定源', async () => {
  const a = provider('local-digest', { text: 'A', sync: true });
  const b = provider('soulkit', { text: 'B' });
  const registry = registryWith([a, b]);
  const one = await registry.recall({ key: 'k', query: 'q', limit: 1 });
  assert.deepEqual(one.results.map((r) => r.provider), ['local-digest']);
  assert.equal(b.calls.length, 0);

  const only = await registry.recall({ key: 'k', query: 'q', provider: 'soulkit' });
  assert.deepEqual(only.results.map((r) => r.provider), ['soulkit']);
  assert.equal(only.results[0].text, 'B');
});

test('recall：单个源失败只影响自己，结果里带 error', async () => {
  const ok = provider('local-digest', { text: '还在', sync: true });
  const bad = provider('soulkit', { fail: true });
  const registry = registryWith([ok, bad]);
  const out = await registry.recall({ key: 'k', query: 'q' });
  assert.equal(out.results.length, 2);
  assert.equal(out.results[0].status, 'injected');
  assert.equal(out.results[1].status, 'error');
  assert.match(out.results[1].error, /挂了/);
  assert.equal(registry.status().providers[1].failures, 1);
});

test('recall：超出单源与总预算时截断', async () => {
  const big = '记'.repeat(100);
  const a = provider('local-digest', { text: big, sync: true });
  const b = provider('soulkit', { text: big });
  const registry = registryWith([a, b]);
  const out = await registry.recall({ key: 'k', query: 'q', maxCharsPerProvider: 30, maxTotalChars: 50 });
  assert.equal(out.results[0].chars, 30);
  assert.equal(out.results[0].truncated, true);
  assert.equal(out.results[1].chars, 20, '第二个源只能拿剩余预算');
  assert.equal(out.totalChars, 50);
});

test('note：写主 provider；主源不可写时退到第一个可写的并说明', async () => {
  const readonly = provider('soulkit', { text: 'x' });
  const writable = provider('local-digest', { text: 'y', sync: true, write: true });
  const registry = registryWith([readonly, writable]);
  const wrote = await registry.note({ key: 'k', text: '他下周三去杭州' });
  assert.equal(wrote.ok, true);
  assert.equal(wrote.provider, 'local-digest');
  assert.equal(wrote.result.echo, '他下周三去杭州');

  const primaryWritable = provider('soulkit', { text: 'x', write: true });
  const registry2 = registryWith([provider('local-digest', { text: 'y', sync: true }), primaryWritable]);
  const second = await registry2.note({ key: 'k', text: '记住这个' });
  assert.equal(second.provider, 'soulkit', '主源可写就写主源');
});

test('note：没有可写 provider 时明确报错，空文本直接拒绝', async () => {
  const registry = registryWith([provider('soulkit', { text: 'x' })]);
  const failed = await registry.note({ key: 'k', text: '记住' });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /不支持写入/);

  const empty = await registry.note({ key: 'k', text: '   ' });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /不能为空/);
});
