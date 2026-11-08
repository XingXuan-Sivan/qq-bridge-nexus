import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMcpStore, McpStoreError, normalizeMcpConfig } from '../src/extensions/mcp-store.mjs';
import { createSecretStore } from '../src/extensions/secrets.mjs';

function tempRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `qqbridge-${label}-`));
}

test('外部 MCP 配置校验：stdio/HTTP/秘密引用', () => {
  const now = () => 1000;
  const base = normalizeMcpConfig({
    name: '演示',
    transport: 'stdio',
    command: 'node',
    args: ['server.mjs'],
    env: { TOKEN: 'secret:demo-token' },
  }, { id: 'demo', now });
  assert.equal(base.id, 'demo');
  assert.equal(base.command, 'node');
  assert.equal(base.env.TOKEN, 'secret:demo-token');

  assert.throws(() => normalizeMcpConfig({ transport: 'stdio', command: 'cmd.exe' }, { id: 'bad', now }), /不在允许列表/);
  assert.equal(normalizeMcpConfig({ transport: 'stdio', command: 'cmd.exe', allowArbitraryCommand: true }, { id: 'bad', now }).allowArbitraryCommand, true);
  assert.throws(() => normalizeMcpConfig({ transport: 'stdio', command: 'node', env: { TOKEN: 'plain' } }, { id: 'bad', now }), /secret:<name>/);

  assert.equal(normalizeMcpConfig({ transport: 'streamable_http', url: 'https://example.com/mcp' }, { id: 'net', now }).transport, 'streamable_http');
  assert.throws(() => normalizeMcpConfig({ transport: 'streamable_http', url: 'http://example.com/mcp' }, { id: 'net', now }), /allowPrivateNetwork/);
  assert.throws(() => normalizeMcpConfig({ transport: 'streamable_http', url: 'https://10.0.0.8/mcp' }, { id: 'net', now }), /私网地址/);
  assert.equal(normalizeMcpConfig({ transport: 'streamable_http', url: 'https://10.0.0.8/mcp', allowPrivateNetwork: true }, { id: 'net', now }).allowPrivateNetwork, true);
  assert.equal(normalizeMcpConfig({ transport: 'streamable_http', url: 'http://127.0.0.1:3000/mcp', allowPrivateNetwork: true }, { id: 'net', now }).allowPrivateNetwork, true);
  assert.throws(() => normalizeMcpConfig({ transport: 'streamable_http', url: 'https://169.254.169.254/latest' }, { id: 'net', now }), /元数据/);
});

test('外部 MCP 存储：CRUD、更新保留创建时间、删除', () => {
  const root = tempRoot('mcp-store');
  const store = createMcpStore({ root, now: (() => { let t = 100; return () => (t += 10); })() });
  const created = store.save('demo', { name: '演示', transport: 'stdio', command: 'node', args: ['a.mjs'] });
  assert.equal(created.id, 'demo');
  assert.ok(fs.existsSync(store.fileFor('demo')));
  assert.throws(() => store.save('demo', { name: '重复' }), (error) => error instanceof McpStoreError && error.code === 'exists');

  const updated = store.save('demo', { name: '改名' }, { create: false });
  assert.equal(updated.name, '改名');
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(store.list().length, 1);

  store.remove('demo');
  assert.equal(store.list().length, 0);
  assert.throws(() => store.get('demo'), (error) => error.code === 'not_found');
  fs.rmSync(root, { recursive: true, force: true });
});

test('秘密存储：引用解析、只写引用、未知秘密拒绝', () => {
  const root = tempRoot('secrets');
  const file = path.join(root, 'secrets.json');
  const secrets = createSecretStore({ file });
  secrets.set('demo-token', 'value-123');
  assert.equal(secrets.get('demo-token'), 'value-123');
  assert.deepEqual(secrets.materialize({ TOKEN: 'secret:demo-token' }), { TOKEN: 'value-123' });
  assert.throws(() => secrets.resolve('plain-value'), /secret:<name>/);
  assert.throws(() => secrets.resolve('secret:missing'), /未配置/);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))['demo-token'], 'value-123');
  fs.rmSync(root, { recursive: true, force: true });
});
