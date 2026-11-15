#!/usr/bin/env node
// 能力预设（profiles/agent-platforms/dsh/capabilities/<id>.yml）单测：读写往返、工具可见集与出厂副本契约。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { createCapabilityStore, visiblePlatformFlags, capabilityAllowsFlag } from '../src/capabilities/store.mjs';
import { PLATFORM_TOOLS } from '../src/tools/catalog.mjs';

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

const CHAT = { label: '聊天', note: '', tools: { platform: { sendMessage: true }, agent: {}, mcp: [], skills: [] } };

test('store lists only capability files', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'README.md'), '# 说明\n', 'utf8');
  writeCapability(root, 'chat', CHAT);
  const store = createCapabilityStore({ root });
  const items = store.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'chat');
  assert.equal(items[0].builtin, false, '没有出厂副本即不是内置');
  assert.ok(Array.isArray(items[0].platformVisible));
});

test('platform visibility: 只认显式 true，缺键即不可见', () => {
  const capability = {
    id: 'chat',
    tools: { platform: { sendMessage: true, sendVoice: false }, agent: {} },
  };
  assert.deepEqual(visiblePlatformFlags(capability), ['sendMessage']);
  assert.equal(capabilityAllowsFlag(capability, 'sendMessage'), true);
  assert.equal(capabilityAllowsFlag(capability, 'sendVoice'), false);
  // 空工具面 = 全部不可见：白名单不猜默认，也不回落到某条内置档的模板。
  assert.deepEqual(visiblePlatformFlags({ id: 'fresh', tools: { platform: {} } }), []);
  // 读类工具不归能力管（动态挑一个 risk=read 的平台工具，避免写死名字）
  const readTool = PLATFORM_TOOLS.find((tool) => tool.risk === 'read');
  assert.ok(readTool, '至少有一个读类平台工具');
  assert.equal(capabilityAllowsFlag(capability, readTool.flag), true);
  // 没有能力时按宽松处理
  assert.equal(capabilityAllowsFlag(null, 'sendVoice'), true);
});

test('save writes back the capability file without artifacts', () => {
  const root = tempRoot();
  writeCapability(root, 'chat', CHAT);
  writeFactory(root, 'chat', CHAT);
  const store = createCapabilityStore({ root });
  const saved = store.save('chat', {
    label: '聊天（改）',
    note: '只读工具全开',
    tools: { platform: { sendPoke: false }, agent: {}, mcp: [], skills: [] },
  });
  assert.equal(saved.label, '聊天', '内置能力的名称不可改，保存时保留原值');
  assert.equal(saved.note, '', '内置能力的备注同样不可改');
  assert.ok(!saved.platformVisible.includes('sendPoke'));
  const onDisk = YAML.parse(fs.readFileSync(path.join(root, 'chat.yml'), 'utf8'));
  assert.equal(onDisk.label, '聊天');
  assert.equal(onDisk.tools.platform.sendPoke, false);
  assert.ok(!fs.existsSync(path.join(root, 'chat', 'agent.cordis.yml')), '不应再生成产物文件');
});

test('重置 = 抄回出厂副本；没有副本的能力档不可重置、内置档不可删', () => {
  const root = tempRoot();
  writeCapability(root, 'chat', CHAT);
  writeFactory(root, 'chat', CHAT);
  const store = createCapabilityStore({ root });
  store.save('chat', { tools: { platform: { sendMessage: false }, agent: {}, mcp: [], skills: [] } });
  assert.deepEqual(store.get('chat').platformVisible, []);
  store.reset('chat');
  assert.deepEqual(store.get('chat').platformVisible, ['sendMessage']);

  writeCapability(root, 'mine', { label: '我的', note: '', tools: { platform: {}, agent: {}, mcp: [], skills: [] } });
  assert.throws(() => store.reset('mine'), /出厂副本/);
  assert.throws(() => store.remove('chat'), /内置能力档只读/);
  store.remove('mine');
  assert.equal(store.get('mine'), null);
});

test('unknown capability returns null instead of throwing', () => {
  const store = createCapabilityStore({ root: tempRoot() });
  assert.equal(store.get('nope'), null);
});
