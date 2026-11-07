// 记忆写回队列：关闭时零外发、开启后批量发送与失败保留。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemoryIngest, ingestChat, normalizeIngestConfig } from '../src/memory/ingest.mjs';

function tempState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-ingest-'));
  return { dir, file: path.join(dir, 'pending.json') };
}

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return handler(url, init, calls.length);
  };
  return { fn, calls };
}

test('关闭时 enqueue 返回 false，不落盘也不发请求', async () => {
  const state = tempState();
  const { fn, calls } = fakeFetch(() => new Response('{}'));
  const ingest = createMemoryIngest({ config: { enabled: false }, stateFile: state.file, fetchImpl: fn });
  assert.equal(ingest.enqueue({ key: 'qq:group:1', role: 'user', text: '你好', id: 'a' }), false);
  const result = await ingest.flush();
  assert.equal(result.skipped, true);
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(state.file), false);
  assert.equal(ingest.status().pending, 0);
  fs.rmSync(state.dir, { recursive: true, force: true });
});

test('开启后 enqueue 入队、flush 批量发送并出队', async () => {
  const state = tempState();
  const { fn, calls } = fakeFetch(() => new Response(JSON.stringify({ accepted: 2 }), { status: 200 }));
  const ingest = createMemoryIngest({ config: { enabled: true, batchSize: 10 }, stateFile: state.file, fetchImpl: fn });
  assert.equal(ingest.enqueue({ key: 'qq:group:1', role: 'user', text: '在吗', id: 'a' }), true);
  assert.equal(ingest.enqueue({ key: 'qq:group:1', role: 'assistant', text: '在', id: 'b' }), true);
  assert.equal(ingest.status().pending, 2);
  const result = await ingest.flush();
  assert.equal(result.ok, true);
  assert.equal(result.sent, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:3110/api/ingest');
  assert.equal(calls[0].body.events.length, 2);
  assert.deepEqual(calls[0].body.events[0].chat, 'group:1');
  assert.equal(calls[0].body.events[0].role, 'user');
  assert.equal(ingest.status().pending, 0);
  assert.equal(fs.existsSync(state.file), false);
  fs.rmSync(state.dir, { recursive: true, force: true });
});

test('发送失败保留队列并记录错误', async () => {
  const state = tempState();
  const { fn } = fakeFetch(() => new Response('nope', { status: 503 }));
  const ingest = createMemoryIngest({ config: { enabled: true }, stateFile: state.file, fetchImpl: fn });
  ingest.enqueue({ key: 'qq:private:2', role: 'user', text: '喂', id: 'c' });
  const result = await ingest.flush();
  assert.equal(result.ok, false);
  assert.match(result.error, /503/);
  assert.equal(ingest.status().pending, 1);
  assert.equal(ingest.status().failed, 1);
  assert.equal(fs.existsSync(state.file), true);
  fs.rmSync(state.dir, { recursive: true, force: true });
});

test('重启后从落盘队列恢复', async () => {
  const state = tempState();
  const first = createMemoryIngest({ config: { enabled: true }, stateFile: state.file, fetchImpl: async () => new Response('{}') });
  first.enqueue({ key: 'qq:group:3', role: 'user', text: '记住这句', id: 'd' });
  const second = createMemoryIngest({ config: { enabled: true }, stateFile: state.file, fetchImpl: async () => new Response('{}') });
  assert.equal(second.restore(), 1);
  assert.equal(second.status().pending, 1);
  fs.rmSync(state.dir, { recursive: true, force: true });
});

test('关闭时清空队列并删除落盘文件', async () => {
  const state = tempState();
  const ingest = createMemoryIngest({ config: { enabled: true }, stateFile: state.file, fetchImpl: async () => new Response('{}') });
  ingest.enqueue({ key: 'qq:group:4', role: 'user', text: 'x', id: 'e' });
  assert.equal(fs.existsSync(state.file), true);
  ingest.setConfig({ enabled: false });
  assert.equal(ingest.status().pending, 0);
  assert.equal(fs.existsSync(state.file), false);
  fs.rmSync(state.dir, { recursive: true, force: true });
});

test('chat 键映射与会话键解析', () => {
  assert.equal(ingestChat('qq:group:123'), 'group:123');
  assert.equal(ingestChat('tg:private:456'), 'private:456');
  assert.equal(ingestChat('weird-key'), 'weird-key');
  const config = normalizeIngestConfig({ enabled: true, maxQueue: 0, batchSize: 9999, baseUrl: 'ftp://x', timeoutMs: 10 });
  assert.equal(config.maxQueue, 10);
  assert.equal(config.batchSize, 200);
  assert.equal(config.baseUrl, 'http://127.0.0.1:3110');
  assert.equal(config.timeoutMs, 300);
});
