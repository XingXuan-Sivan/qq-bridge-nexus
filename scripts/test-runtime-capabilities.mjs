#!/usr/bin/env node
// 能力预设（profiles/agent-platforms/dsh/capabilities/<id>.yml）单测：读写往返与出厂副本契约。
// 工具面不在这里：它归平台声明（profiles/platforms/<id>/tools.yml），覆盖见 test-tool-catalog。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { createCapabilityStore, platformFlags } from '../src/capabilities/store.mjs';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cap-store-'));
}

function writeCapability(root, id, data) {
  fs.writeFileSync(path.join(root, `${id}.yml`), YAML.stringify({ version: 1, id, ...data }), 'utf8');
}

/** 出厂副本：副本存在即内置。 */
function writeFactory(root, id, data) {
  const dir = path.join(root, '.defaults');
  fs.mkdirSync(dir, { recursive: true });
  writeCapability(dir, id, data);
}

const CHAT = {
  label: '聊天',
  note: '',
  effects: { 'user.ask': true, 'todo.manage': true },
  runtime: { peerPermission: 'read-only' },
};

test('store lists only capability files', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'README.md'), '# 说明\n', 'utf8');
  writeCapability(root, 'chat', CHAT);
  const store = createCapabilityStore({ root });
  const items = store.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'chat');
  assert.equal(items[0].builtin, false, '没有出厂副本即不是内置');
  assert.deepEqual(items[0].effects, { 'user.ask': true, 'todo.manage': true }, '能力档只声明效果，不存插件行');
  assert.equal(items[0].tools, undefined, '能力档不存平台工具面');
});

test('平台工具开关只看平台声明：声明了就是有，defaultOff 不默认注册', () => {
  assert.deepEqual(platformFlags([
    { flag: 'sendMessage' },
    { flag: 'sendVoice', defaultOff: true },
    { flag: 'sendPoke' },
  ]), { sendMessage: true, sendVoice: false, sendPoke: true });
  assert.deepEqual(platformFlags([]), {}, '没有声明 = 一个都不注册');
  assert.deepEqual(platformFlags([{ label: '没有 flag 的条目' }]), {}, '没有 flag 的条目被忽略');
});

test('save writes back the capability file without artifacts', () => {
  const root = tempRoot();
  writeCapability(root, 'chat', CHAT);
  writeFactory(root, 'chat', CHAT);
  const store = createCapabilityStore({ root });
  const saved = store.save('chat', {
    label: '聊天（改）',
    note: '只留全部 MCP',
    mcp: { allow: ['*'], tools: { allow: ['*'] } },
    skills: { allow: ['*'] },
  });
  assert.equal(saved.label, '聊天', '内置能力的名称不可改，保存时保留原值');
  assert.equal(saved.note, '', '内置能力的备注同样不可改');
  assert.deepEqual(saved.mcp.allow, ['*']);
  assert.deepEqual(saved.mcp.tools.allow, ['*']);
  const onDisk = YAML.parse(fs.readFileSync(path.join(root, 'chat.yml'), 'utf8'));
  assert.equal(onDisk.label, '聊天');
  assert.equal(onDisk.tools, undefined, '保存不得写回 tools 段（工具面归平台声明）');
  assert.equal(onDisk.rows, undefined, '保存不得写回插件行（行由渲染层生成）');
  assert.equal(onDisk.effects['user.ask'], true, '效果随能力档落盘');
  assert.ok(!fs.existsSync(path.join(root, 'chat', 'agent.cordis.yml')), '不应再生成产物文件');
});

test('重置 = 抄回出厂副本；没有副本的能力档不可重置、内置档不可删', () => {
  const root = tempRoot();
  writeCapability(root, 'chat', CHAT);
  writeFactory(root, 'chat', CHAT);
  const store = createCapabilityStore({ root });
  store.save('chat', { mcp: { allow: ['x'], tools: { allow: ['*'] } } });
  assert.deepEqual(store.get('chat').mcp.allow, ['x']);
  store.reset('chat');
  assert.deepEqual(store.get('chat').mcp.allow, []);

  writeCapability(root, 'mine', { label: '我的', note: '' });
  assert.throws(() => store.reset('mine'), /出厂副本/);
  assert.throws(() => store.remove('chat'), /内置能力档只读/);
  store.remove('mine');
  assert.equal(store.get('mine'), null);
});

test('unknown capability returns null instead of throwing', () => {
  const store = createCapabilityStore({ root: tempRoot() });
  assert.equal(store.get('nope'), null);
});
