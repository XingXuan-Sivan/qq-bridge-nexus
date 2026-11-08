import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMcpStore } from '../src/extensions/mcp-store.mjs';
import { createMcpRuntime, validateToolArgs } from '../src/extensions/mcp-runtime.mjs';

function tempRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `qqbridge-${label}-`));
}

function fakeConnection({ tools = [], call = null, fail = null } = {}) {
  return async () => {
    if (fail) throw new Error(fail);
    return {
      client: {
        connect: async () => {},
        listTools: async () => ({ tools }),
        callTool: async ({ name, arguments: args }) => (call ? call(name, args) : { content: [{ type: 'text', text: name }] }),
        close: async () => {},
      },
      transport: { close: async () => {} },
    };
  };
}

test('MCP runtime：状态机、调用与参数校验、错误隔离', async () => {
  const root = tempRoot('runtime');
  const store = createMcpStore({ root: path.join(root, 'mcp') });
  store.save('demo', { name: '演示', transport: 'stdio', command: 'node', args: ['demo.mjs'] });
  store.save('broken', { name: '坏掉', transport: 'stdio', command: 'node', args: ['broken.mjs'] });
  const createConnection = fakeConnection({
    tools: [{
      name: 'echo',
      description: '回显',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    }],
  });
  const runtime = createMcpRuntime({
    store,
    logsDir: path.join(root, 'logs'),
    createConnection: async (config) => {
      if (config.id === 'broken') throw new Error('连接被拒绝');
      return createConnection(config);
    },
  });

  const started = await runtime.start('demo');
  assert.equal(started.status, 'running');
  assert.equal(runtime.list().find((item) => item.id === 'demo').toolCount, 1);

  const result = await runtime.call('demo', 'echo', { text: '你好' });
  assert.equal(result.content[0].text, 'echo');
  await assert.rejects(() => runtime.call('demo', 'echo', {}), /必填项/);
  await assert.rejects(() => runtime.call('demo', 'missing', {}), /没有工具/);

  await assert.rejects(() => runtime.start('broken'), /连接失败/);
  assert.equal(runtime.list().find((item) => item.id === 'broken').status, 'error');

  const refreshed = await runtime.listTools('demo', { refresh: true });
  assert.equal(refreshed.length, 1);
  assert.ok(runtime.logs('demo').some((line) => line.includes('connected')));

  await runtime.shutdown();
  assert.equal(runtime.list().find((item) => item.id === 'demo').status, 'stopped');
  fs.rmSync(root, { recursive: true, force: true });
});

test('MCP runtime：test() 不落运行态，超时转为可读错误', async () => {
  const root = tempRoot('runtime-timeout');
  const store = createMcpStore({ root: path.join(root, 'mcp') });
  store.save('slow', { name: '慢', transport: 'stdio', command: 'node', args: ['slow.mjs'], timeoutMs: 1000 });
  const runtime = createMcpRuntime({
    store,
    logsDir: path.join(root, 'logs'),
    createConnection: fakeConnection({
      tools: [{ name: 'wait', description: '', inputSchema: { type: 'object', properties: {} } }],
      call: () => new Promise(() => {}),
    }),
  });
  const tested = await runtime.test(store.get('slow'));
  assert.equal(tested.ok, true);
  assert.equal(tested.tools.length, 1);
  assert.equal(runtime.list().find((item) => item.id === 'slow').status, 'stopped');

  const startedAt = Date.now();
  await assert.rejects(() => runtime.call('slow', 'wait', {}), /超时/);
  assert.ok(Date.now() - startedAt >= 900, '应等待配置的 1s 超时');
  fs.rmSync(root, { recursive: true, force: true });
});

test('validateToolArgs 支持 required/type/enum 与 anyOf', () => {
  const schema = {
    type: 'object',
    required: ['mode'],
    properties: {
      mode: { type: 'string', enum: ['a', 'b'] },
      count: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
    },
  };
  assert.doesNotThrow(() => validateToolArgs(schema, { mode: 'a', count: 1 }));
  assert.doesNotThrow(() => validateToolArgs(schema, { mode: 'b', count: 'x' }));
  assert.throws(() => validateToolArgs(schema, { mode: 'c' }), /枚举/);
  assert.throws(() => validateToolArgs(schema, { count: 1 }), /必填/);
});
