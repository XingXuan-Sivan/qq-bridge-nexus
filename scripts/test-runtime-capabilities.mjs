#!/usr/bin/env node
// 能力预设（profiles/agent-platforms/dsh/capabilities/<id>.yml）单测：读写往返、工具可见集与守卫。
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

test('store lists only capability files', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'README.md'), '# 说明\n', 'utf8');
  writeCapability(root, 'agent-chat', {
    label: '聊天',
    tools: { platform: { sendMessage: true }, agent: {}, mcp: [], skills: [] },
  });
  const store = createCapabilityStore({ root });
  const items = store.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'agent-chat');
  assert.equal(items[0].builtin, true);
  assert.ok(Array.isArray(items[0].platformVisible));
});

test('platform visibility: explicit flags win, defaults fill the rest', () => {
  const capability = {
    id: 'agent-chat',
    tools: { platform: { sendMessage: true, sendVoice: false }, agent: {} },
  };
  const visible = visiblePlatformFlags(capability);
  assert.ok(visible.includes('sendMessage'));
  assert.ok(!visible.includes('sendVoice'));
  assert.equal(capabilityAllowsFlag(capability, 'sendMessage'), true);
  assert.equal(capabilityAllowsFlag(capability, 'sendVoice'), false);
  // 读类工具不归能力管（动态挑一个 risk=read 的平台工具，避免写死名字）
  const readTool = PLATFORM_TOOLS.find((tool) => tool.risk === 'read');
  assert.ok(readTool, '至少有一个读类平台工具');
  assert.equal(capabilityAllowsFlag(capability, readTool.flag), true);
  // 没有能力时按宽松处理
  assert.equal(capabilityAllowsFlag(null, 'sendVoice'), true);
});

test('save writes back the capability file without artifacts', () => {
  const root = tempRoot();
  writeCapability(root, 'agent-chat', {
    label: '聊天',
    tools: { platform: {}, agent: {}, mcp: [], skills: [] },
  });
  const store = createCapabilityStore({ root });
  const saved = store.save('agent-chat', {
    label: '聊天（改）',
    note: '只读工具全开',
    tools: { platform: { sendPoke: false }, agent: {}, mcp: [], skills: [] },
  });
  assert.equal(saved.label, '聊天', '内置能力的名称不可改，保存时保留原值');
  assert.equal(saved.note, '', '内置能力的备注同样不可改');
  assert.ok(!saved.platformVisible.includes('sendPoke'));
  const onDisk = YAML.parse(fs.readFileSync(path.join(root, 'agent-chat.yml'), 'utf8'));
  assert.equal(onDisk.label, '聊天');
  assert.equal(onDisk.tools.platform.sendPoke, false);
  assert.ok(!fs.existsSync(path.join(root, 'agent-chat', 'agent.cordis.yml')), '不应再生成产物文件');
});

test('unknown capability returns null instead of throwing', () => {
  const store = createCapabilityStore({ root: tempRoot() });
  assert.equal(store.get('nope'), null);
});
