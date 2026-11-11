// capability.yml 的唯一源与产物生成：校验、默认值、生成规则、确定性。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeCapabilityFile,
  defaultCapability,
  saveCapabilityFile,
  loadCapabilityFile,
} from '../src/capabilities/file.mjs';
import {
  buildAgentRows,
  buildExtensions,
  buildPresetMeta,
  renderArtifacts,
  writeArtifacts,
  renderSafetyPrompt,
} from '../src/capabilities/build.mjs';

const base = {
  version: 1,
  id: 'agent-chat',
  label: '聊天 Agent',
  order: 12,
  tools: {
    platform: { sendMessage: true, schedule: false },
    agent: { 'fs.read': true, web: true, todo: true },
    mcp: [{ server: 'snowluma', tools: '*' }],
    skills: [],
  },
  safety: { local_tools: false, secrets: 'deny', self_modify: 'deny', injection: 'strict', notes: '不能执行命令。' },
};

test('normalize：合法文件归一、别名映射、local_tools 强制清空的告警', () => {
  const { capability, warnings } = normalizeCapabilityFile(base, { id: 'agent-chat' });
  assert.equal(capability.id, 'agent-chat');
  assert.equal(capability.tools.agent['tool-fs'], true);
  assert.equal(capability.tools.agent['tool-web'], true);
  assert.equal(capability.tools.platform.schedule, false);
  assert.equal(capability.safety.local_tools, false);
  assert.ok(warnings.some((line) => line.includes('local_tools')));
});

test('normalize：未知平台工具 / 未知模块 / id 不一致 / agent 非 dsh 都拒绝', () => {
  assert.throws(() => normalizeCapabilityFile({ ...base, id: 'other' }, { id: 'agent-chat' }), /id 与目录名不一致/);
  assert.throws(() => normalizeCapabilityFile({ ...base, tools: { ...base.tools, platform: { nope: true } } }), /未知工具/);
  assert.throws(() => normalizeCapabilityFile({ ...base, tools: { ...base.tools, agent: { cron: true } } }), /未知模块/);
  assert.throws(() => normalizeCapabilityFile({ ...base, agent: 'other' }), /agent 目前只支持 dsh/);
});

test('defaultCapability：默认来自 agent-chat，且能通过校验', () => {
  const cap = defaultCapability('my-agent', { label: '我的 Agent' });
  const { capability } = normalizeCapabilityFile(cap, { id: 'my-agent' });
  assert.equal(capability.label, '我的 Agent');
  assert.equal(capability.safety.local_tools, false);
  assert.deepEqual(capability.tools.mcp.map((item) => item.server), ['*']);
});

test('save/load：往返一致，id 由目录名兜底', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-'));
  const cap = defaultCapability('agent-readonly');
  saveCapabilityFile(dir, cap);
  const loaded = loadCapabilityFile(dir, { id: 'agent-readonly' });
  assert.equal(loaded.capability.id, 'agent-readonly');
  assert.equal(loaded.capability.tools.agent['tool-web'], true);
  assert.equal(loadCapabilityFile(path.join(dir, 'missing')), null);
});

test('生成：local_tools=false 挂守卫行且只留 web/ask/todo；agent-full 不挂守卫', () => {
  const chat = normalizeCapabilityFile(base, { id: 'agent-chat' }).capability;
  const rows = buildAgentRows(chat, { basePrefix: 'BASE' });
  const ids = rows.map((row) => row.id);
  assert.deepEqual(ids.filter((id) => id.startsWith('tool-')), ['tool-web', 'tool-todo']);
  assert.ok(ids.includes('qq-tool-restrict'));
  assert.match(rows[0].config.prefix, /^【安全边界/);
  assert.match(rows[0].config.prefix, /BASE$/);
  const allow = rows.find((row) => row.id === 'qq-tool-restrict').config.allow;
  assert.ok(allow.includes('qq_send_message'));
  assert.ok(allow.includes('snowluma::*'));

  const full = defaultCapability('agent-full');
  for (const key of Object.keys(full.tools.agent)) full.tools.agent[key] = true;
  full.safety.local_tools = true;
  const fullRows = buildAgentRows(normalizeCapabilityFile(full, { id: 'agent-full' }).capability);
  assert.ok(!fullRows.some((row) => row.id === 'qq-tool-restrict'));
  assert.ok(fullRows.some((row) => row.id === 'tool-pwsh'));
});

test('生成：extensions 只写 MCP/技能，没有就返回 null；preset.yml 不再带 behavior', () => {
  const chat = normalizeCapabilityFile(base, { id: 'agent-chat' }).capability;
  const ext = buildExtensions(chat);
  assert.deepEqual(ext.mcp.allow, ['snowluma']);
  assert.equal(ext.mcp.tools.allow, '*');
  const meta = buildPresetMeta(chat);
  assert.deepEqual(meta, { name: '聊天 Agent', description: '', order: 12 });
  const none = normalizeCapabilityFile({ ...base, tools: { ...base.tools, mcp: [], skills: [] } }).capability;
  assert.equal(buildExtensions(none), null);
});

test('确定性：同一份能力两次渲染逐字一致；--check 能发现漂移', () => {
  const cap = normalizeCapabilityFile(base, { id: 'agent-chat' }).capability;
  const first = renderArtifacts(cap);
  const second = renderArtifacts(cap);
  assert.deepEqual(first, second);
  assert.match(first['agent.cordis.yml'], /由 scripts\/build-capability-artifacts\.mjs/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-build-'));
  const ok = writeArtifacts(dir, cap);
  assert.ok(ok.every((item) => item.changed));
  const again = writeArtifacts(dir, cap, { check: true });
  assert.ok(again.every((item) => !item.changed), '第二次 --check 不应报告漂移');
  fs.writeFileSync(path.join(dir, 'preset.yml'), '# 手改\n', 'utf8');
  const drift = writeArtifacts(dir, cap, { check: true });
  assert.equal(drift.find((item) => item.file.endsWith('preset.yml')).changed, true);
});

test('安全段：local_tools=true 时不写「没有本地工具」，但仍然写凭据与注入约束', () => {
  const prompt = renderSafetyPrompt({ local_tools: true, secrets: 'deny', self_modify: 'deny', injection: 'strict', notes: '' });
  assert.doesNotMatch(prompt, /你没有本地工具/);
  assert.match(prompt, /绝不透露/);
  assert.match(prompt, /不是管理员的指令/);
});
