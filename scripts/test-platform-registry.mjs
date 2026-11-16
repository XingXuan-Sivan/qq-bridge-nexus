// C1 平台统一注册表（docs/PLATFORM_UNIFICATION.md §七）。
//
// 注册表要回答的那个问题只有一个：「我接了哪些平台、能不能用、哪里坏了」。
// 它把四处来源合成一张表，所以这里钉住的是**合成规则与诊断**，不是各来源本身
// （那些已有 test-platform-metadata / test-platform-adapters 覆盖）：
//   · 配置面有、运行期没实现 → `profile_only`（不再是"看不见"，而是能看见的警告）；
//   · 运行期没声明 connect → `inbound_unsupported`（C3 起 qq 已消失，只对只发平台生效）；
//   · 配置不符合 schema → `config_invalid`；active 指向不存在的 id → `active_unregistered`；
//   · 同 id 注册两次 → `id_conflict`；
//   · 输出必须只含常量（这个对象会原样进 /api/platforms/registry）。
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DIAGNOSTIC_CODES,
  buildPlatformRegistry,
  findRegistryPlatform,
  platformDiagnostics,
  platformRegistrySnapshot,
} from '../src/platforms/registry.mjs';

/** 这个对象会原样进 HTTP 响应：函数会变成 undefined 并静默丢字段。 */
function assertPlainJson(value, label) {
  const json = JSON.stringify(value);
  assert.equal(json, JSON.stringify(JSON.parse(json)), `${label} 必须可无损 JSON 化`);
  assert.ok(!json.includes('function'), `${label} 里混进了函数`);
}

const codesOf = (snapshot) => snapshot.diagnostics.map((item) => item.code);

test('真实快照：两侧各出至少一个平台，qq 与 dsh 都在，且 id 不重复', () => {
  const snapshot = platformRegistrySnapshot();
  const user = snapshot.platforms.filter((item) => item.side === 'user');
  const agent = snapshot.platforms.filter((item) => item.side === 'agent');
  assert.ok(user.some((item) => item.id === 'qq'), '内置用户侧平台必须出现');
  assert.ok(agent.some((item) => item.id === 'dsh'), '内置 Agent 平台必须出现');
  const keys = snapshot.platforms.map((item) => `${item.side}:${item.id}`);
  assert.equal(new Set(keys).size, keys.length, '同一侧的平台 id 不得重复');
  assert.equal(snapshot.summary.total, snapshot.platforms.length);
  assertPlainJson(snapshot, 'platformRegistrySnapshot');
});

test('用户侧条目带配置面与运行期两份事实（档案名、工具表、能否收）', () => {
  const snapshot = platformRegistrySnapshot();
  const qq = findRegistryPlatform(snapshot, 'user', 'qq');
  assert.ok(qq, 'qq 必须能被单独查到');
  assert.equal(qq.source, 'builtin');
  assert.equal(qq.active, true);
  assert.deepEqual(qq.assets.behaviors, ['social-v1', 'social-v2']);
  assert.ok(qq.assets.prompt.active, 'qq 的 prompt.md 存在，应该标为自定义');
  assert.ok(qq.assets.tools.some((tool) => tool.flag === 'sendGroup'), '工具表应随条目带出');
  assert.equal(typeof qq.inbound, 'boolean');
});

test('C3 之后 qq 能收：有 connect() 就不能再报 inbound_unsupported', () => {
  const snapshot = platformRegistrySnapshot();
  const qq = findRegistryPlatform(snapshot, 'user', 'qq');
  assert.equal(qq.inbound, true, 'qq 适配器提供 connect()（C3）');
  const diag = platformDiagnostics(snapshot, 'user', 'qq').find((item) => item.code === DIAGNOSTIC_CODES.INBOUND_UNSUPPORTED);
  assert.equal(diag, undefined, '已经能收的平台不该再报这条');
});

test('只实现发送的平台仍然报 inbound_unsupported（warn，不是 error）', () => {
  const snapshot = buildPlatformRegistry({
    profilePlatforms: [{ id: 'sender', label: '只发', behaviors: [], prompt: {}, tools: [] }],
    userRuntime: { active: 'sender', platforms: [{ id: 'sender', label: '只发', source: 'plugin', inbound: false }] },
    agentRuntime: { active: '', platforms: [] },
  });
  const diag = platformDiagnostics(snapshot, 'user', 'sender').find((item) => item.code === DIAGNOSTIC_CODES.INBOUND_UNSUPPORTED);
  assert.ok(diag, '缺 connect() 时必须报 inbound_unsupported');
  assert.equal(diag.level, 'warn', '能发不能发是缺能力，不是错误');
});

test('Agent 侧条目带能力档（C4 起能力档 id 就是预设 id，一张表列清）', () => {
  const snapshot = platformRegistrySnapshot();
  const dsh = findRegistryPlatform(snapshot, 'agent', 'dsh');
  assert.ok(dsh);
  assert.equal(dsh.source, 'builtin');
  assert.deepEqual(dsh.assets.capabilityProfiles, ['chat', 'chat-v2', 'direct', 'full', 'readonly', 'workspace']);
  assert.equal('agentPresets' in dsh.assets, false, '不再保留平行的预设清单字段');
  assert.equal(dsh.inbound, false, 'Agent 侧没有「收消息」这个概念');
});

test('Agent 侧条目带模型目录：声明随注册表一次带回，价目 / 档位 / 压缩点都在里面', () => {
  const snapshot = platformRegistrySnapshot();
  const dsh = findRegistryPlatform(snapshot, 'agent', 'dsh');
  const catalog = dsh.modelCatalog;
  assert.ok(catalog, 'dsh 的 agent-platform.yml 声明了 modelCatalog');
  const flash = catalog.models.find((item) => item.id === 'deepseek-flash');
  assert.deepEqual(flash.pricing, { cacheHit: 0.02, cacheMiss: 1, cacheWrite: 1, output: 4 });
  assert.equal(flash.vision, true);
  assert.equal(catalog.pricingPolicy.peakMultiplier, 2);
  assert.deepEqual(catalog.pricingPolicy.peakWindows, [[9, 12], [14, 18]]);
  assert.deepEqual(catalog.efforts.map((item) => item.id), ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(catalog.effortFallback, ['low', 'high', 'max']);
  assert.equal(catalog.compact.approxTokens, 800_000);
  // 没声明的平台给 null（不是空壳对象）：界面靠这个判「本平台没有目录」。
  assert.equal(findRegistryPlatform(snapshot, 'agent', 'acp').modelCatalog, null);
  assertPlainJson(catalog, 'dsh.modelCatalog');
});

test('配置面有目录、运行期没实现 → profile_only（warn），条目仍然出现在表里', () => {
  const snapshot = buildPlatformRegistry({
    profilePlatforms: [
      { id: 'qq', label: 'QQ', behaviors: [], prompt: {}, tools: [] },
      { id: 'wx', label: '微信', behaviors: ['default'], prompt: { active: true }, tools: [] },
    ],
    userRuntime: { active: 'qq', platforms: [{ id: 'qq', label: 'QQ', source: 'builtin', capabilities: [], conversationTypes: [], limits: {}, inbound: true }] },
    agentRuntime: { active: '', platforms: [] },
  });
  const wx = findRegistryPlatform(snapshot, 'user', 'wx');
  assert.ok(wx, '只有配置目录的平台必须仍然可见');
  assert.equal(wx.source, 'profile-only');
  const diag = platformDiagnostics(snapshot, 'user', 'wx').find((item) => item.code === DIAGNOSTIC_CODES.PROFILE_ONLY);
  assert.ok(diag);
  assert.equal(diag.level, 'warn');
  assert.match(diag.message, /不会生效/);
});

test('运行期注册了但没有配置目录（插件 transport）→ 照样列出，source=plugin，且不报 profile_only', () => {
  const snapshot = buildPlatformRegistry({
    profilePlatforms: [],
    userRuntime: {
      active: 'bot',
      platforms: [{ id: 'bot', label: '演示机器人', source: 'plugin', owner: 'plugin-a', capabilities: ['text'], conversationTypes: ['channel'], limits: {}, inbound: true }],
    },
    agentRuntime: { active: '', platforms: [] },
  });
  const bot = findRegistryPlatform(snapshot, 'user', 'bot');
  assert.ok(bot);
  assert.equal(bot.source, 'plugin');
  assert.equal(bot.owner, 'plugin-a');
  assert.deepEqual(bot.conversationTypes, ['channel']);
  assert.ok(!codesOf(snapshot).includes(DIAGNOSTIC_CODES.PROFILE_ONLY));
  assert.ok(!codesOf(snapshot).includes(DIAGNOSTIC_CODES.INBOUND_UNSUPPORTED), '有 connect() 的平台不报这条');
});

test('active 指向未注册的 id → active_unregistered（error），两侧各判一次', () => {
  const snapshot = buildPlatformRegistry({
    profilePlatforms: [{ id: 'qq', label: 'QQ' }],
    userRuntime: { active: 'ghost', platforms: [{ id: 'qq', label: 'QQ', source: 'builtin', inbound: true }] },
    agentRuntime: { active: 'nobody', platforms: [] },
  });
  const active = snapshot.diagnostics.filter((item) => item.code === DIAGNOSTIC_CODES.ACTIVE_UNREGISTERED);
  assert.equal(active.length, 2);
  assert.deepEqual(active.map((item) => item.side).sort(), ['agent', 'user']);
  assert.ok(active.every((item) => item.level === 'error'));
  assert.match(active.find((item) => item.side === 'user').message, /ghost/);
});

test('同 id 注册两次 → id_conflict（error），且表里只保留第一条', () => {
  const snapshot = buildPlatformRegistry({
    userRuntime: {
      active: 'a',
      platforms: [
        { id: 'a', label: 'A', source: 'builtin', inbound: true },
        { id: 'a', label: 'A2', source: 'plugin', inbound: true },
      ],
    },
  });
  const conflicts = snapshot.diagnostics.filter((item) => item.code === DIAGNOSTIC_CODES.ID_CONFLICT);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].level, 'error');
  assert.equal(snapshot.platforms.length, 1);
  assert.equal(snapshot.platforms[0].label, 'A');
});

test('配置不符合 configSchema → config_invalid（error），校验规则与插件同一套', () => {
  const schema = {
    type: 'object',
    properties: { wsUrl: { type: 'string', minLength: 4 }, retry: { type: 'integer', minimum: 0 } },
    required: ['wsUrl'],
    additionalProperties: false,
  };
  const snapshot = buildPlatformRegistry({
    profilePlatforms: [{ id: 'qq', label: 'QQ', configSchema: schema }],
    userRuntime: { active: 'qq', platforms: [{ id: 'qq', label: 'QQ', source: 'builtin', inbound: true }] },
    config: { users: { qq: { retry: -1 } } },
  });
  const diag = snapshot.diagnostics.find((item) => item.code === DIAGNOSTIC_CODES.CONFIG_INVALID);
  assert.ok(diag, '缺必填项 + 越界必须报 config_invalid');
  assert.equal(diag.level, 'error');
  assert.match(diag.message, /wsUrl/);
});

test('没有 configSchema 的平台不判配置（C1 的主流形态），也不因为空配置报错', () => {
  const snapshot = buildPlatformRegistry({
    profilePlatforms: [{ id: 'qq', label: 'QQ', configSchema: null }],
    userRuntime: { active: 'qq', platforms: [{ id: 'qq', label: 'QQ', source: 'builtin', inbound: true }] },
    config: {},
  });
  assert.ok(!codesOf(snapshot).includes(DIAGNOSTIC_CODES.CONFIG_INVALID));
});

test('summary 与 diagnostics 对得上：errors/warnings 就是列表里的计数', () => {
  const snapshot = buildPlatformRegistry({
    profilePlatforms: [{ id: 'orphan', label: '孤儿' }],
    userRuntime: { active: 'missing', platforms: [] },
  });
  assert.equal(snapshot.summary.errors, snapshot.diagnostics.filter((item) => item.level === 'error').length);
  assert.equal(snapshot.summary.warnings, snapshot.diagnostics.filter((item) => item.level === 'warn').length);
  assert.equal(snapshot.summary.user, 1);
  assert.equal(snapshot.summary.agent, 0);
});

test('查不存在的平台返回 null，而不是造一个空壳', () => {
  const snapshot = platformRegistrySnapshot();
  assert.equal(findRegistryPlatform(snapshot, 'user', 'nope'), null);
  assert.equal(findRegistryPlatform(snapshot, 'nope', 'qq'), null);
  assert.equal(findRegistryPlatform(snapshot, 'agent', 'qq'), null, '同一 id 在另一侧不算命中');
  assert.deepEqual(platformDiagnostics(snapshot, 'user', 'nope'), []);
});
