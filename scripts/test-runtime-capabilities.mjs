#!/usr/bin/env node
// 能力预设补丁：工具可见集的归一、迁移与注册表行为。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCapabilityRegistry,
  normalizeCapability,
  normalizeVisible,
  visibleAllows,
} from '../src/runtime/capabilities.mjs';
import {
  AGENT_MODULES,
  LEVEL_ALLOWS,
  PLATFORM_TOOLS,
  capabilityCovers,
  platformToolFlags,
  platformToolRisk,
  toolCatalogSnapshot,
} from '../src/tools/catalog.mjs';

const ALL = platformToolFlags();
const GATED = PLATFORM_TOOLS.filter((tool) => capabilityCovers(tool.flag)).map((tool) => tool.flag);

test('工具目录：平台工具与 Agent 模块都有风险等级', () => {
  assert.ok(PLATFORM_TOOLS.length >= 30);
  assert.equal(new Set(ALL).size, ALL.length, 'flag 不能重复');
  for (const tool of PLATFORM_TOOLS) {
    assert.ok(tool.label, `${tool.flag} 缺 label`);
    assert.ok(tool.names.length >= 1, `${tool.flag} 缺宿主工具名`);
    assert.ok(['read', 'send', 'state', 'admin'].includes(tool.risk), `${tool.flag} 风险等级不合法`);
  }
  assert.deepEqual(platformToolRisk('nope'), 'admin', '未知工具按 admin 处理');
  for (const module of AGENT_MODULES) assert.ok(module.risk);
  assert.ok(GATED.includes('sendMessage'));
  assert.ok(!GATED.includes('getUnread'), '读类不进能力收紧范围');
});

test('权限级别的准入矩阵与文档一致', () => {
  assert.deepEqual([...LEVEL_ALLOWS['read-only']].sort(), ['read', 'send', 'state']);
  assert.ok(LEVEL_ALLOWS['workspace-write'].includes('write'));
  assert.ok(LEVEL_ALLOWS['full'].includes('exec'));
  assert.ok(LEVEL_ALLOWS['full'].includes('admin'));
  assert.ok(!LEVEL_ALLOWS['full-ask'].includes('read') === false);
});

test('visible 归一：null/全部、过滤未知、去重', () => {
  assert.equal(normalizeVisible(null), null);
  assert.equal(normalizeVisible('all'), null);
  assert.deepEqual(normalizeVisible(['sendMessage', 'sendMessage', 'nope']), ['sendMessage']);
  assert.equal(visibleAllows(null, 'sendMessage'), true);
  assert.equal(visibleAllows(['sendPoke'], 'sendMessage'), false);
});

test('capability 归一：旧 grants.disable 迁移成 visible，沙箱字段被丢掉', () => {
  const migrated = normalizeCapability({ sandbox: 'danger-full-access', grants: { disable: ['sendPoke', 'schedule'] }, note: '旧数据' }, 'qq-chat');
  assert.equal(migrated.sandbox, undefined);
  assert.ok(migrated.tools.visible.includes('sendMessage'));
  assert.ok(!migrated.tools.visible.includes('sendPoke'));
  assert.ok(!migrated.tools.visible.includes('schedule'));
  assert.equal(migrated.note, '旧数据');
  const blank = normalizeCapability({}, 'qq-chat-v2');
  assert.equal(blank.tools.visible, null);
  assert.equal(blank.suggestedPermission, '');
  assert.equal(normalizeCapability({}, 'Bad Id'), null);
});

test('注册表：合并目录、保存触发 onChange、allows 只收紧副作用工具', () => {
  const changes = [];
  const registry = createCapabilityRegistry({
    catalog: [{ id: 'qq-chat', label: '聊天', builtin: true }],
    config: { 'qq-chat': { tools: { visible: ['sendMessage'] }, suggestedPermission: 'read-only' } },
    onChange: (next) => changes.push(next),
  });
  const chat = registry.get('qq-chat');
  assert.equal(chat.builtin, true);
  assert.equal(chat.tools.visible.length, 1);
  assert.equal(chat.suggestedPermission, 'read-only');
  assert.equal(registry.allows('qq-chat', 'sendMessage'), true);
  assert.equal(registry.allows('qq-chat', 'sendPoke'), false);
  assert.equal(registry.allows('qq-chat', 'getUnread'), true, '读类不受可见集影响');
  const saved = registry.save('qq-chat', { tools: { visible: GATED }, prompt: { personaPrefix: '你是 QQ 上的 {displayName}。' } });
  assert.equal(saved.tools.visible.length, GATED.length);
  assert.equal(saved.prompt.personaPrefix, '你是 QQ 上的 {displayName}。');
  assert.equal(changes.length, 1);
  assert.ok(changes[0]['qq-chat'].tools.visible.length === GATED.length);
  assert.throws(() => registry.save('nope', {}), /没有这个能力预设/);
  assert.deepEqual(Object.keys(toolCatalogSnapshot()).sort(), ['agent', 'gatedRisks', 'levelAllows', 'levelAsks', 'levels', 'platform', 'risks']);
});
