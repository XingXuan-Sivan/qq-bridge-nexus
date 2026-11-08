import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionCatalog } from '../src/extensions/catalog.mjs';
import { createMcpInventory } from '../src/extensions/mcp-inventory.mjs';

test('catalog 汇总技能与真实 MCP 工具，并保留 server 错误状态', async () => {
  const skillIndex = {
    list: () => [
      { id: 'alpha', name: 'alpha-skill', description: '第一个技能', dir: 'C:/skills/alpha' },
      { id: '', name: '', description: '', dir: '' },
    ],
  };
  const mcpInventory = {
    snapshot: async () => ({
      at: 123,
      servers: [
        { id: 'one', name: 'one', file: 'src/mcp-one.js', note: '正常', status: 'online', toolCount: 2, tools: [{ name: 'a', description: 'A' }, { name: 'b' }] },
        { id: 'two', name: 'two', file: 'src/mcp-two.js', note: '坏了', status: 'error', error: 'connect timeout', toolCount: 0, tools: [] },
      ],
    }),
  };
  const catalog = createExtensionCatalog({ skillIndex, mcpInventory, now: () => 999 });
  const data = await catalog.snapshot();
  assert.equal(data.version, 2);
  assert.equal(data.generatedAt, 999);
  assert.equal(data.scannedAt, 123);
  assert.deepEqual(data.skills, [{ id: 'alpha', name: 'alpha-skill', description: '第一个技能', path: 'C:/skills/alpha' }]);
  assert.equal(data.mcp.length, 2);
  assert.equal(data.mcp[0].toolCount, 2);
  assert.equal(data.mcp[0].tools[1].description, '');
  assert.equal(data.mcp[1].status, 'error');
  assert.equal(data.mcp[1].error, 'connect timeout');
  assert.deepEqual(data.summary, { servers: 2, online: 1, errors: 1, tools: 2, skills: 1 });
});

test('catalog refresh 透传给 inventory', async () => {
  let calls = [];
  const catalog = createExtensionCatalog({
    skillIndex: { list: () => [] },
    mcpInventory: { snapshot: async (opts) => { calls.push(opts); return { at: 1, servers: [] }; } },
  });
  await catalog.snapshot({ refresh: true });
  assert.deepEqual(calls, [{ refresh: true }]);
});

test('inventory 5 分钟缓存，refresh 强制重扫，错误按 server 隔离', async () => {
  let now = 0;
  let scans = 0;
  const inventory = createMcpInventory({
    root: 'C:/repo',
    servers: [{ id: 'one', name: 'one', file: 'src/mcp-one.js' }, { id: 'two', name: 'two', file: 'src/mcp-two.js' }],
    now: () => now,
    readServer: async (server) => {
      scans += 1;
      if (server.name === 'two') throw new Error('boom');
      return { ...server, status: 'online', toolCount: 1, tools: [{ name: 'x', description: 'X' }] };
    },
  });
  const first = await inventory.snapshot();
  assert.equal(scans, 2);
  assert.equal(first.servers[0].toolCount, 1);
  assert.equal(first.servers[1].status, 'error');
  assert.match(first.servers[1].error, /boom/);
  await inventory.snapshot();
  assert.equal(scans, 2, 'TTL 内不重扫');
  now = 5 * 60_000;
  await inventory.snapshot();
  assert.equal(scans, 4, '过期后重扫');
  await inventory.snapshot({ refresh: true });
  assert.equal(scans, 6, 'refresh 强制重扫');
});

test('inventory 并发 snapshot 只扫描一次', async () => {
  let scans = 0;
  const inventory = createMcpInventory({
    root: 'C:/repo',
    servers: [{ id: 'one', name: 'one', file: 'src/mcp-one.js' }],
    readServer: async (server) => {
      scans += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { ...server, status: 'online', toolCount: 0, tools: [] };
    },
  });
  const [a, b] = await Promise.all([inventory.snapshot(), inventory.snapshot()]);
  assert.equal(scans, 1);
  assert.deepEqual(a, b);
});
