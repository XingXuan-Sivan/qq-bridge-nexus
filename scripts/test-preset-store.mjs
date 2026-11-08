// 预设源读写（P3）：只测 store 的文件/校验/备份契约，不跑 build/setup。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPresetStore, normalizeExtensions, validateAgentYaml } from '../src/presets/store.mjs';

const GOOD_YAML = `- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    prefix: hi\n- id: qq-tool-restrict\n  name: 'qq-agent-presets/qq-tool-restrict.mjs'\n`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-store-'));
  const dir = path.join(root, 'qq-chat');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'preset.yml'), 'name: QQ 聊天\ndescription: 默认聊天预设\norder: 10\n');
  fs.writeFileSync(path.join(dir, 'agent.cordis.yml'), GOOD_YAML);
  return {
    root,
    backupRoot: path.join(root, 'backups'),
    scriptsDir: path.join(root, 'scripts'),
    presetIds: ['qq-chat'],
  };
}

test('list/read 归一化元数据与缺失的 extensions', () => {
  const f = fixture();
  const store = createPresetStore(f);
  assert.equal(store.list()[0].name, 'QQ 聊天');
  const preset = store.read('qq-chat');
  assert.equal(preset.meta.order, 10);
  assert.equal(preset.extensionsExists, false);
  assert.deepEqual(preset.extensions, { mcp: { allow: [], tools: { allow: [], deny: [] } }, skills: { allow: [] } });
  assert.equal(preset.validation.ok, true);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('writeMeta/writeExtensions 写回并留备份，agent YAML 不动', () => {
  const f = fixture();
  const store = createPresetStore(f);
  store.writeMeta('qq-chat', { name: '新名字', description: '新说明', order: 3 });
  store.writeExtensions('qq-chat', { mcp: { allow: ['test-ext'], tools: { allow: ['tool_a'], deny: ['tool_b'] } }, skills: { allow: ['demo'] } });
  const preset = store.read('qq-chat');
  assert.equal(preset.meta.name, '新名字');
  assert.deepEqual(preset.extensions.mcp.tools.deny, ['tool_b']);
  assert.equal(fs.readFileSync(path.join(f.root, 'qq-chat', 'agent.cordis.yml'), 'utf8'), GOOD_YAML);
  assert.ok(store.listBackups('qq-chat').length >= 2);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('validateAgentYaml 拒绝空列表/缺 persona/缺 guard/重复 id', () => {
  assert.equal(validateAgentYaml('[]').ok, false);
  assert.equal(validateAgentYaml('- id: qq-tool-restrict\n  name: x\n').ok, false);
  assert.equal(validateAgentYaml('- id: persona\n  name: x\n').ok, false);
  assert.equal(validateAgentYaml('- id: persona\n  name: x\n- id: persona\n  name: y\n- id: qq-tool-restrict\n  name: z\n').ok, false);
  assert.equal(validateAgentYaml(GOOD_YAML).ok, true);
});

test('restore 回滚到最近一次备份', () => {
  const f = fixture();
  const store = createPresetStore(f);
  store.writeMeta('qq-chat', { name: '改过', description: '临时', order: 9 });
  store.restore('qq-chat');
  assert.equal(store.read('qq-chat').meta.name, 'QQ 聊天');
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('normalizeExtensions 去重/去空/补默认', () => {
  const value = normalizeExtensions({ mcp: { allow: ['a', 'a', ''], tools: { deny: ['x', 'x'] } } });
  assert.deepEqual(value.mcp.allow, ['a']);
  assert.deepEqual(value.mcp.tools.deny, ['x']);
  assert.deepEqual(value.skills.allow, []);
});
