// 工具目录单测：8 个中立工具组、组内 flag、风险分级、旧名解析、描述生成，
// 以及 Agent 侧条目按活动执行体的 tools.yml 并入（不再有写死的模块表）。
// 这层是「工具只有一份定义」的地基，任何一处漂移都会在这里暴露。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPABILITY_GATED_RISKS,
  CATALOG_ENTRIES,
  LEVEL_ALLOWS,
  PLATFORM_TOOLS,
  TOOL_GROUPS,
  TOOL_RISKS,
  capabilityCovers,
  catalogEntry,
  catalogFromAdapters,
  describeToolGroups,
  platformToolAllowedAt,
  platformToolFlags,
  platformToolMap,
  platformToolRisk,
  toolCatalogSnapshot,
  toolGroup,
  opNamesOf,
} from '../src/tools/catalog.mjs';
import { readAgentPlatformTools, readPlatformTools } from '../src/platforms/index.mjs';
import { sessionToolsCard } from '../src/session/tools.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Agent 侧条目跟着活动执行体走：这里取 dsh 的 tools.yml，与控制台拿到的就是同一份。
const DSH_TOOLS = readAgentPlatformTools({
  root: path.join(ROOT, 'profiles', 'agent-platforms'),
  id: 'dsh',
});
const ENTRIES = toolCatalogSnapshot({ agentPlatform: 'dsh', agentTools: DSH_TOOLS }).entries;
// 用户平台的工具声明（qq/tools.yml）：会话工具卡的求交输入。
const QQ_TOOLS = readPlatformTools({ root: path.join(ROOT, 'profiles', 'platforms'), id: 'qq' });

test('模型可见 8 组，组内 flag 与目录一一对应，Agent 侧 8 个模块并入后共 16 条', () => {
  assert.equal(PLATFORM_TOOLS.length, 37);
  assert.equal(TOOL_GROUPS.length, 8);
  assert.equal(CATALOG_ENTRIES.length, 8, '静态目录只有平台侧八组，Agent 侧由执行体声明');
  assert.equal(DSH_TOOLS.length, 8, 'dsh 的 tools.yml 应声明八个模块');
  assert.equal(ENTRIES.length, 16);
  const ids = ENTRIES.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(platformToolFlags(), PLATFORM_TOOLS.map((tool) => tool.flag));
});

test('每个 flag 只属于一组，组内 ops / 宿主名与单项定义同源', () => {
  const seen = new Map();
  for (const group of TOOL_GROUPS) {
    assert.ok(group.ops.length > 0, group.id);
    for (const flag of group.covers) {
      assert.equal(seen.has(flag), false, `${flag} 出现在两组：${seen.get(flag)} / ${group.id}`);
      seen.set(flag, group.id);
    }
    const tool = PLATFORM_TOOLS.find((item) => item.flag === group.covers[0]);
    assert.deepEqual(group.ops[0].names, tool.names, group.id);
    assert.deepEqual(group.names, group.ops.flatMap((op) => op.names), group.id);
  }
  assert.deepEqual([...seen.keys()].sort(), PLATFORM_TOOLS.map((tool) => tool.flag).sort());
  assert.equal(toolGroup('qq_send_message').id, 'send');
  assert.equal(toolGroup('sendMessage').id, 'send');
  assert.equal(toolGroup('read_messages').id, 'read_messages');
  assert.equal(toolGroup('nope'), null);
  // 组风险取组内最高一档：admin 组里有读类工具，仍按 admin 显示。
  assert.equal(toolGroup('admin').risk, 'admin');
  assert.equal(toolGroup('read_messages').risk, 'read');
});

test('每个条目都有 side/source/risk，风险取值在分级表内', () => {
  for (const entry of ENTRIES) {
    assert.ok(['platform', 'agent'].includes(entry.side), entry.id);
    assert.ok(entry.provider, entry.id);
    assert.ok(entry.source, entry.id);
    assert.ok(TOOL_RISKS.includes(entry.risk), `${entry.id} risk=${entry.risk}`);
    assert.equal(typeof entry.gated, 'boolean', entry.id);
    assert.equal(entry.alwaysAllowed, !entry.gated, entry.id);
  }
  // 旧名仍可解析：宿主工具名与组内 flag 都落到它所属的那一组。
  assert.equal(catalogEntry('qq_send_message').id, 'send');
  assert.equal(catalogEntry('qq_send_message').flag, 'sendMessage');
  assert.equal(catalogEntry('sendMessage').risk, 'send');
  assert.equal(catalogEntry('read_messages').id, 'read_messages');
  assert.equal(ENTRIES.find((entry) => entry.id === 'tool-pwsh').side, 'agent');
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

test('平台工具白名单：键齐、值统一，新建能力档无需猜默认', () => {
  const off = platformToolMap();
  assert.deepEqual(Object.keys(off), PLATFORM_TOOLS.map((tool) => tool.flag));
  assert.ok(Object.values(off).every((value) => value === false));
  const on = platformToolMap(true);
  assert.deepEqual(Object.keys(on), Object.keys(off));
  assert.ok(Object.values(on).every((value) => value === true));
});

test('适配器声明的工具能并入目录，未知风险按 admin 兜底', () => {
  const merged = catalogFromAdapters({
    platform: [{ id: 'customQuery', label: '自定义查询', risk: 'read' }, { id: 'customDanger', label: '危险操作', risk: 'nonsense' }],
    agent: [{ id: 'tool-pwsh', label: '执行命令（覆盖）', risk: 'exec' }],
  });
  // 起点只有平台侧八组；适配器声明的三条（两个平台 + 一个 Agent）全部并入。
  assert.equal(merged.length, 8 + 2 + 1);
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

test('工具描述由平台声明生成：声明里没有的 flag 写进「不支持」', () => {
  const docs = describeToolGroups([
    { flag: 'getUnread' },
    { flag: 'getRecent' },
    { flag: 'sendMessage' },
  ]);
  assert.equal(docs.length, 8);
  const read = docs.find((item) => item.id === 'read_messages');
  assert.deepEqual(read.supported, ['getUnread', 'getRecent']);
  assert.ok(read.missing.includes('getForwardMsg'));
  assert.match(read.description, /本平台支持：读取未读消息、读取最近消息/);
  assert.match(read.description, /不支持：/);
  // 一个 flag 都没声明 = 这组能力平台做不到，描述直说别去试。
  const memory = docs.find((item) => item.id === 'memory');
  assert.equal(memory.supported.length, 0);
  assert.match(memory.description, /capability_unsupported/);
  // 全部声明 = 描述里不出现「不支持」。
  const full = describeToolGroups(PLATFORM_TOOLS.map((tool) => ({ flag: tool.flag })));
  assert.ok(full.every((item) => item.missing.length === 0));
  assert.ok(full.every((item) => !item.description.includes('不支持')));
});

test('目录快照字段齐全，权限矩阵覆盖四档，Agent 侧跟着执行体走', () => {
  const snapshot = toolCatalogSnapshot({ agentPlatform: 'dsh', agentTools: DSH_TOOLS });
  assert.deepEqual(snapshot.risks, TOOL_RISKS);
  assert.deepEqual(Object.keys(LEVEL_ALLOWS), ['read-only', 'workspace-write', 'full-ask', 'full']);
  assert.equal(snapshot.entries.length, 16);
  assert.equal(snapshot.groups.length, 8);
  assert.equal(snapshot.platform.length, 37);
  assert.ok(snapshot.platform.every((tool) => snapshot.groups.some((group) => group.id === tool.group)), '每个 flag 都能落到一组');
  assert.equal(snapshot.agent.length, 8);
  // 每个模块都带着它承担的效果：控制台靠它把「效果」对到具体模块上。
  assert.ok(snapshot.agent.every((tool) => Array.isArray(tool.effects) && tool.effects.length > 0), '模块要声明效果');
  assert.ok(
    snapshot.entries.filter((entry) => entry.side === 'agent').every((entry) => entry.provider === 'dsh'),
    'Agent 侧条目的 provider 就是活动执行体',
  );
  // 不传执行体就不猜：只有平台侧八组，免得回落到某个写死的模块表。
  assert.equal(toolCatalogSnapshot().entries.length, 8);
  assert.deepEqual(toolCatalogSnapshot().agent, []);
  assert.ok(snapshot.levelAllows['read-only'].includes('send'));
  assert.ok(!snapshot.levelAllows['read-only'].includes('exec'));
  assert.deepEqual([...snapshot.levelAsks['full-ask']], ['exec', 'admin']);
});

test('提示面点到的 op 都真的注册在对应的组里', () => {
  const valid = new Map(TOOL_GROUPS.map((group) => [group.id, new Set(group.ops.flatMap(opNamesOf))]));
  const bad = [];
  const skipDir = /node_modules|\.git/;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDir.test(full)) walk(full);
        continue;
      }
      if (!/\.(js|mjs|yml|yaml|md)$/.test(entry.name)) continue;
      fs.readFileSync(full, 'utf8').split(/\r?\n/).forEach((line, index) => {
        for (const [, group, op] of line.matchAll(/([a-z_]+)（op=([A-Za-z0-9_]+)/g)) {
          const ops = valid.get(group);
          if (!ops) continue;
          // 允许 `admin（op=schedule_*）` 这种前缀写法
          if (op.endsWith('_') ? [...ops].some((name) => name.startsWith(op)) : ops.has(op)) continue;
          bad.push(`${path.relative(ROOT, full)}:${index + 1} ${group}（op=${op}）不存在，合法值：${[...ops].join(' / ')}`);
        }
      });
    }
  };
  for (const dir of ['src', 'profiles', 'public', 'artifacts']) walk(path.join(ROOT, dir));
  assert.deepEqual(bad, [], `提示面点到了不存在的 op：\n${bad.join('\n')}`);
});

test('会话工具卡：平台声明 ∩ 权限级别，原因写在每一项上', () => {
  // qq 声明了 37 项里的大部分，但 sendVoice / webImage 这类默认关闭。
  const card = sessionToolsCard({ declared: QQ_TOOLS, level: 'read-only', platform: 'QQ' });
  assert.equal(card.level, 'read-only');
  assert.equal(card.groups.length, TOOL_GROUPS.length);
  const flat = card.groups.flatMap((group) => [...group.available, ...group.unavailable]);
  // 每个 flag 恰好出现一次，总数 = 可用 + 不可用。
  assert.equal(flat.length, PLATFORM_TOOLS.length);
  assert.equal(new Set(flat.map((item) => item.id)).size, PLATFORM_TOOLS.length);
  assert.equal(card.total, flat.filter((item) => !item.reason).length);
  // 只读级别：发送与读类都能用，admin 类被收紧，且原因写明是哪一级收的。
  assert.equal(flat.find((item) => item.id === 'sendMessage').reason, '');
  const schedule = flat.find((item) => item.id === 'schedule');
  assert.match(schedule.reason, /权限「只读」不含管理类工具/);
  // 平台声明里默认关闭的，原因归声明，不归权限。
  if (QQ_TOOLS.some((tool) => tool.flag === 'sendVoice' && tool.defaultOff)) {
    assert.equal(flat.find((item) => item.id === 'sendVoice').reason, '平台声明里默认关闭');
  }
  // 全权限时，声明过的都能用；声明里没有的直接省略。
  const full = sessionToolsCard({ declared: QQ_TOOLS, level: 'full', platform: 'QQ' });
  assert.ok(full.total >= card.total, '放宽权限不会减少可用工具');
  assert.equal(full.groups.flatMap((group) => group.unavailable).filter((item) => item.id === 'schedule').length, 0);
  const empty = sessionToolsCard({ declared: [], level: 'full', platform: 'QQ' });
  assert.equal(empty.total, 0);
  assert.ok(empty.groups.every((group) => group.available.length === 0));
  assert.ok(empty.groups.flatMap((group) => group.unavailable).every((item) => item.reason === '平台没有声明这项'));
  // 没有能力档的会话：note 必须写出「权限恒只读」，不假装还能按档案调。
  assert.match(empty.note, /纯聊天/);
  assert.match(card.note, /平台声明（QQ）\s*∩\s*权限「只读」/);
});
