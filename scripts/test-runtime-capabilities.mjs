#!/usr/bin/env node
// 能力目录（capability.yml）单测：默认模板、读写往返、工具可见集与守卫。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCapabilityStore, visiblePlatformFlags, capabilityAllowsFlag } from '../src/capabilities/store.mjs';
import { PLATFORM_TOOLS } from '../src/tools/catalog.mjs';
import { saveCapabilityFile } from '../src/capabilities/file.mjs';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cap-store-'));
}

test('store lists only directories with capability.yml', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'empty-dir'), { recursive: true });
  fs.mkdirSync(path.join(root, 'agent-chat'), { recursive: true });
  saveCapabilityFile(path.join(root, 'agent-chat'), {
    id: 'agent-chat',
    label: '聊天',
    agent: 'dsh',
    tools: { platform: { sendMessage: true }, agent: {}, mcp: [], skills: [] },
    safety: { local_tools: false },
    prompt: { base: '你是群聊里的角色。' },
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

test('save writes capability.yml and rebuilds artifacts', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'agent-chat'), { recursive: true });
  saveCapabilityFile(path.join(root, 'agent-chat'), {
    id: 'agent-chat',
    label: '聊天',
    agent: 'dsh',
    tools: { platform: {}, agent: {}, mcp: [], skills: [] },
    safety: { local_tools: false },
    prompt: { base: '你是群聊里的角色。' },
  });
  const store = createCapabilityStore({ root });
  const saved = store.save('agent-chat', {
    label: '聊天（改）',
    tools: { platform: { sendPoke: false }, agent: {} },
    safety: { notes: '不主动私聊。' },
  });
  assert.equal(saved.label, '聊天（改）');
  assert.equal(saved.safety.notes, '不主动私聊。');
  assert.ok(!saved.platformVisible.includes('sendPoke'));
  assert.ok(fs.existsSync(path.join(root, 'agent-chat', 'agent.cordis.yml')));
  assert.ok(fs.readFileSync(path.join(root, 'agent-chat', 'preset.yml'), 'utf8').includes('name:'));
});

test('unknown capability returns null instead of throwing', () => {
  const store = createCapabilityStore({ root: tempRoot() });
  assert.equal(store.get('nope'), null);
});
