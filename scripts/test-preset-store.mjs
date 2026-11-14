// 预设源读写（P3）：只测 store 的文件/校验/备份契约，不跑 build/setup。
//
// C4 起「预设」不是独立目录，而是能力档里的 preset + rows + extensions 三段，
// 所以 fixture 直接就是一份 capabilities/<id>.yml。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPresetStore, normalizeExtensions, validateAgentYaml } from '../src/presets/store.mjs';

const GOOD_YAML = `- id: persona\n  name: '@deepseek-ai/dsh-persona'\n  config:\n    prefix: hi\n- id: qq-tool-restrict\n  name: 'qq-agent-presets/qq-tool-restrict.mjs'\n`;

const CAPABILITY_YAML = `# 手写注释：不要丢
version: 1
label: 聊天
note: 无本地工具，只做对话与问答
tools:
  platform: {}
  agent: {}
  mcp: []
  skills: []
preset:
  name: QQ 聊天
  description: 默认聊天预设
  order: 10
rows:
  - id: persona
    name: '@deepseek-ai/dsh-persona'
    config:
      prefix: hi
  - id: qq-tool-restrict
    name: qq-agent-presets/qq-tool-restrict.mjs
`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-store-'));
  fs.writeFileSync(path.join(root, 'chat.yml'), CAPABILITY_YAML);
  return {
    root,
    backupRoot: path.join(root, 'backups'),
    scriptsDir: path.join(root, 'scripts'),
  };
}

const capabilityPath = (f, id = 'chat') => path.join(f.root, `${id}.yml`);

test('list/read 归一化元数据与缺失的 extensions', () => {
  const f = fixture();
  const store = createPresetStore(f);
  assert.equal(store.list()[0].name, 'QQ 聊天');
  const preset = store.read('chat');
  assert.equal(preset.meta.order, 10);
  assert.equal(preset.extensionsExists, false);
  assert.deepEqual(preset.extensions, { mcp: { allow: [], tools: { allow: [], deny: [] } }, skills: { allow: [] } });
  assert.equal(preset.validation.ok, true);
  assert.deepEqual(preset.files, { 'capability.yml': true });
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('writeMeta/writeExtensions 只改对应段并留备份，rows 原样不动', () => {
  const f = fixture();
  const store = createPresetStore(f);
  store.writeMeta('chat', { name: '新名字', description: '新说明', order: 3 });
  store.writeExtensions('chat', { mcp: { allow: ['test-ext'], tools: { allow: ['tool_a'], deny: ['tool_b'] } }, skills: { allow: ['demo'] } });
  const preset = store.read('chat');
  assert.equal(preset.meta.name, '新名字');
  assert.deepEqual(preset.extensions.mcp.tools.deny, ['tool_b']);
  // rows 段是预设正文，写元信息/扩展授权不得碰它。
  assert.equal(preset.agentYaml.includes("prefix: hi"), true);
  assert.equal(preset.validation.rows, 2);
  assert.ok(store.listBackups('chat').length >= 2);
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
  store.writeMeta('chat', { name: '改过', description: '临时', order: 9 });
  store.restore('chat');
  assert.equal(store.read('chat').meta.name, 'QQ 聊天');
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('Document 局部写回保留未改段的注释与文件头', () => {
  const f = fixture();
  const store = createPresetStore(f);
  store.writeMeta('chat', { name: '新名字', description: '新说明', order: 3 });
  const metaText = fs.readFileSync(capabilityPath(f), 'utf8');
  // 顶部手写注释与 rows 段都不在本次写入范围内，必须逐字留着。
  assert.match(metaText, /手写注释：不要丢/);
  assert.match(metaText, /prefix: hi/);
  assert.equal((metaText.match(/手写注释：不要丢/g) ?? []).length, 1);

  store.writeExtensions('chat', { mcp: { allow: ['new'], tools: { allow: [], deny: [] } }, skills: { allow: [] } });
  const extText = fs.readFileSync(capabilityPath(f), 'utf8');
  assert.match(extText, /手写注释：不要丢/);
  assert.match(extText, /allow:\s*\n?\s*- new/);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('normalizeExtensions 去重/去空/补默认', () => {
  const value = normalizeExtensions({ mcp: { allow: ['a', 'a', ''], tools: { deny: ['x', 'x'] } } });
  assert.deepEqual(value.mcp.allow, ['a']);
  assert.deepEqual(value.mcp.tools.deny, ['x']);
  assert.deepEqual(value.skills.allow, []);
});
