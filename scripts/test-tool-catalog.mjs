// 工具目录单测：四类来源、风险分级、能力默认集。
// 这层是「工具只有一份定义」的地基，任何一处漂移都会在这里暴露。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_MODULES,
  CAPABILITY_DEFAULTS,
  CAPABILITY_GATED_RISKS,
  CATALOG_ENTRIES,
  LEVEL_ALLOWS,
  PLATFORM_TOOLS,
  TOOL_RISKS,
  capabilityDefaults,
  capabilityCovers,
  catalogEntry,
  catalogFromAdapters,
  platformToolAllowedAt,
  platformToolFlags,
  platformToolRisk,
  toolCatalogSnapshot,
} from '../src/tools/catalog.mjs';

test('平台工具与 Agent 模块数量固定，id 不重复', () => {
  assert.equal(PLATFORM_TOOLS.length, 37);
  assert.equal(AGENT_MODULES.length, 8);
  assert.equal(CATALOG_ENTRIES.length, 45);
  const ids = CATALOG_ENTRIES.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(platformToolFlags(), PLATFORM_TOOLS.map((tool) => tool.flag));
});

test('每个条目都有 side/provider/source/risk，风险取值在分级表内', () => {
  for (const entry of CATALOG_ENTRIES) {
    assert.ok(['platform', 'agent'].includes(entry.side), entry.id);
    assert.ok(entry.provider, entry.id);
    assert.ok(entry.source, entry.id);
    assert.ok(TOOL_RISKS.includes(entry.risk), `${entry.id} risk=${entry.risk}`);
    assert.equal(typeof entry.gated, 'boolean', entry.id);
    assert.equal(entry.alwaysAllowed, !entry.gated, entry.id);
  }
  assert.equal(catalogEntry('qq_send_message').flag, 'sendMessage');
  assert.equal(catalogEntry('sendMessage').risk, 'send');
  assert.equal(catalogEntry('tool-pwsh').side, 'agent');
  assert.equal(catalogEntry('nope'), null);
});

test('读类不受能力收紧，副作用类受收紧', () => {
  for (const tool of PLATFORM_TOOLS) {
    const gated = CAPABILITY_GATED_RISKS.includes(tool.risk);
    assert.equal(capabilityCovers(tool.flag), gated, tool.flag);
    assert.equal(platformToolRisk(tool.flag), tool.risk);
  }
  assert.equal(platformToolRisk('unknown_flag'), 'admin');
  assert.equal(platformToolAllowedAt('read-only', 'sendMessage'), true);
  assert.equal(platformToolAllowedAt('read-only', 'memory'), true);
  assert.equal(platformToolAllowedAt('read-only', 'schedule'), false);
  assert.equal(platformToolAllowedAt('workspace-write', 'ownerRelay'), false);
  assert.equal(platformToolAllowedAt('full-ask', 'ownerRelay'), true);
  assert.equal(platformToolAllowedAt('bogus-level', 'sendMessage'), false);
});

test('四个内置能力的默认工具集递增且引用真实条目', () => {
  const ids = Object.keys(CAPABILITY_DEFAULTS);
  assert.deepEqual(ids, ['agent-chat', 'agent-readonly', 'agent-workspace', 'agent-full']);
  const agentIds = new Set(AGENT_MODULES.map((module) => module.id));
  let previous = 0;
  for (const id of ids) {
    const defaults = capabilityDefaults(id);
    assert.ok(defaults, id);
    assert.equal(defaults.platform, true, id);
    for (const moduleId of defaults.agent) assert.ok(agentIds.has(moduleId), `${id} → ${moduleId}`);
    assert.ok(defaults.agent.length >= previous, `${id} 不应比上一个能力更窄`);
    previous = defaults.agent.length;
  }
  assert.deepEqual([...capabilityDefaults('agent-chat').agent], ['tool-web', 'tool-ask-user', 'tool-todo']);
  assert.deepEqual([...capabilityDefaults('agent-full').agent], AGENT_MODULES.map((module) => module.id));
  assert.equal(capabilityDefaults('nope'), null);
});

test('适配器声明的工具能并入目录，未知风险按 admin 兜底', () => {
  const merged = catalogFromAdapters({
    platform: [{ id: 'customQuery', label: '自定义查询', risk: 'read' }, { id: 'customDanger', label: '危险操作', risk: 'nonsense' }],
    agent: [{ id: 'tool-pwsh', label: '执行命令（覆盖）', risk: 'exec' }],
  });
  assert.equal(merged.length, 47);
  const custom = merged.find((entry) => entry.id === 'customQuery');
  assert.equal(custom.side, 'platform');
  assert.equal(custom.gated, false);
  assert.equal(custom.alwaysAllowed, true);
  const danger = merged.find((entry) => entry.id === 'customDanger');
  assert.equal(danger.risk, 'admin');
  assert.equal(danger.gated, true);
  const pwsh = merged.find((entry) => entry.id === 'tool-pwsh');
  assert.equal(pwsh.label, '执行命令（覆盖）');
  assert.equal(pwsh.side, 'agent');
});

test('目录快照字段齐全，权限矩阵覆盖四档', () => {
  const snapshot = toolCatalogSnapshot();
  assert.deepEqual(snapshot.risks, TOOL_RISKS);
  assert.deepEqual(Object.keys(LEVEL_ALLOWS), ['read-only', 'workspace-write', 'full-ask', 'full']);
  assert.equal(snapshot.entries.length, 45);
  assert.equal(snapshot.platform.length, 37);
  assert.equal(snapshot.agent.length, 8);
  assert.deepEqual(snapshot.defaultAgents['agent-chat'], ['tool-web', 'tool-ask-user', 'tool-todo']);
  assert.ok(snapshot.levelAllows['read-only'].includes('send'));
  assert.ok(!snapshot.levelAllows['read-only'].includes('exec'));
  assert.deepEqual([...snapshot.levelAsks['full-ask']], ['exec', 'admin']);
});
