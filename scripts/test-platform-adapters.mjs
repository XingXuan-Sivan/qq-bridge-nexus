#!/usr/bin/env node
// B5 运行期适配器契约：两侧注册表 + 中立门面 + 目录不变式。
//
// 这条回归钉住「内核不认识具体平台」这件事的可执行部分：
//   · 用户侧：内核只调 buildSendCall / describeBackend，实现住在 adapters/qq/；
//   · Agent 侧：内核只调 agentRuntime()，实现住在 adapters/dsh/；
//   · 两侧注册表未注册时都必须 **抛错（fail-closed）**，不能猜一个默认平台 ——
//     猜错的后果是把消息发到错误通道，或把权限映射成另一个平台的名字。
//   · 目录不变式：平台专属实现不得回流到 src/ 根与 src/lib/。
//
// 为什么用 assert.throws 而不是「返回 null 就当不支持」：内核里这些查询都在发送
// 热路径上，返回空值会一路飘到几百行之外才现形，且错误信息里没有平台上下文。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  registerUserPlatform,
  resetUserPlatforms,
  useUserPlatform,
  activeUserPlatformId,
  listUserPlatforms,
  requireUserPlatform,
  buildSendCall,
  readBackendInfo,
  describeBackend,
  supportsUserCapability,
  userPlatformLimits,
} from '../src/user-side/runtime-registry.mjs';
import { BUILTIN_USER_PLATFORMS, registerBuiltinUserPlatforms } from '../src/user-side/builtin.mjs';

import {
  resetAgentPlatforms,
  activeAgentPlatformId,
  listAgentPlatforms,
  requireAgentPlatform,
} from '../src/agent-side/runtime-registry.mjs';
import { BUILTIN_AGENT_PLATFORMS, registerBuiltinAgentPlatforms } from '../src/agent-side/builtin.mjs';
// 连接层契约在模块初始化时就会求值：缺成员的平台在这里就报错，而不是等第一轮对话。
import { RUNTIME_MEMBERS, agentRuntime, resetAgentRuntime } from '../src/agent-side/runtime.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// ── 用户侧 ──────────────────────────────────────────────────────────────────

test('内置用户平台已注册，且描述里没有平台实现细节', () => {
  assert.equal(activeUserPlatformId(), 'qq');
  const list = listUserPlatforms();
  const qq = list.find((p) => p.id === 'qq');
  assert.ok(qq, 'qq 必须在内置清单里');
  assert.deepEqual(qq.conversationTypes.sort(), ['group', 'private']);
  assert.ok(qq.capabilities.includes('sticker'), '声明了 sticker 才能按能力降级');
  assert.ok(qq.capabilities.includes('forward'));
  // 描述里只允许静态元数据：任何函数都说明实现泄漏进了控制台可见的部分。
  // limits 自 B7 起也在这里（控制台按它画表单，不再自己写死 4000）；
  // inbound 自 C3 起也是布尔值（有没有 connect()，函数本身不出口）；
  // rawEvent 是正文契约：声明了才有业务体入口（见 src/user-side/inbound.mjs 的 deliver 契约）。
  assert.deepEqual(Object.keys(qq).sort(), ['capabilities', 'conversationTypes', 'id', 'inbound', 'label', 'limits', 'rawEvent']);
  assert.equal(typeof qq.inbound, 'boolean');
  assert.equal(qq.rawEvent, true, 'QQ 的业务体吃 OneBot 报文：rawEvent 必须是静态布尔');
  assert.equal(qq.limits.chunkChars, 4000);
});

test('buildSendCall 委托到 QQ 适配器（group / private 两种动作）', () => {
  const message = [{ type: 'text', data: { text: 'hi' } }];
  assert.deepEqual(buildSendCall('group', '123456', message), {
    action: 'send_group_msg',
    params: { group_id: 123456, message },
  });
  assert.deepEqual(buildSendCall('private', 987654, []), {
    action: 'send_private_msg',
    params: { user_id: 987654, message: [] },
  });
});

test('门面不吞适配器的抛错：未知类型与空 id 仍然抛', () => {
  assert.throws(() => buildSendCall('channel', '1', []), /未知会话类型/);
  assert.throws(() => buildSendCall('group', '', []), /需要数字 id/);
});

test('后端称呼与能力查询按声明委托，不自作判断', () => {
  assert.deepEqual(readBackendInfo({ app_name: 'NapCat.Onebot', app_version: '4.18.38' }), {
    name: 'NapCat',
    version: '4.18.38',
  });
  assert.match(describeBackend({ viaPlatform: true, backend: { name: 'NapCat', version: '4.18.38' } }), /NapCat/);
  assert.equal(supportsUserCapability('sticker'), true);
  assert.equal(supportsUserCapability('nonexistent-capability'), false, '未声明即不支持，不猜');
  assert.equal(userPlatformLimits().chunkChars, 4000);
});

test('注册表拒绝没有 id 的实现', () => {
  assert.throws(() => registerUserPlatform({ buildSendCall() {} }), /缺少 id/);
});

test('未注册即抛错（fail-closed），注册后恢复', () => {
  resetUserPlatforms();
  assert.throws(() => buildSendCall('group', '1', []), /用户平台未注册/);
  assert.throws(() => describeBackend({}), /用户平台未注册/);
  assert.throws(() => useUserPlatform('nope'), /用户平台未注册/);
  assert.equal(listUserPlatforms().length, 0);
  registerBuiltinUserPlatforms();
  assert.equal(activeUserPlatformId(), 'qq');
  assert.equal(requireUserPlatform().id, 'qq');
});

// ── Agent 侧 ────────────────────────────────────────────────────────────────

test('内置 Agent 平台已注册，且装配点提供连接层', () => {
  assert.equal(activeAgentPlatformId(), 'dsh');
  const impl = requireAgentPlatform();
  assert.equal(typeof impl.createRuntime, 'function', 'builtin.mjs 必须把连接层接上 createRuntime');
  // 声明面仍然只由 profiles/ 提供：preset 清单在声明里，连接方式在连接层里。
  assert.deepEqual(impl.AGENT_PRESET_IDS, ['chat', 'chat-v2', 'readonly', 'workspace', 'full']);
});

test('连接层契约：成员齐备，且不齐就 fail-closed', async () => {
  const dsh = BUILTIN_AGENT_PLATFORMS.find((impl) => impl.id === 'dsh');
  const runtime = dsh.createRuntime({ config: {}, log: () => {} });
  const missing = RUNTIME_MEMBERS.filter((name) => typeof runtime[name] !== 'function');
  assert.deepEqual(missing, [], `DSH 连接层缺 ${missing.join(' / ')}`);
  assert.deepEqual([runtime.id, runtime.label, runtime.mode], ['dsh', 'DeepSeek Harness', 'http']);
  // ACP 走 stdio：没有地址可识别，但成员同样要齐 —— 少一个就 fail-closed。
  const acp = BUILTIN_AGENT_PLATFORMS.find((impl) => impl.id === 'acp');
  const acpRuntime = acp.createRuntime({ config: {}, log: () => {} });
  const acpMissing = RUNTIME_MEMBERS.filter((name) => typeof acpRuntime[name] !== 'function');
  assert.deepEqual(acpMissing, [], `ACP 连接层缺 ${acpMissing.join(' / ')}`);
  assert.deepEqual([acpRuntime.id, acpRuntime.mode], ['acp', 'stdio']);
  await resetAgentRuntime();
  const singleton = agentRuntime({ config: {} });
  assert.equal(singleton.id, 'dsh');
  assert.equal(agentRuntime(), singleton, '进程内同一时刻只有一个活动执行体');
  await resetAgentRuntime();
});

test('控制台可见的平台列表不泄漏连接层对象', () => {
  const json = JSON.stringify(listAgentPlatforms());
  assert.ok(!json.includes('NodeApiClient'), 'protocol 不该出现在 /api 响应里');
  // 描述里只允许静态元数据：出现函数就说明实现漏进了控制台可见的部分。
  // owner / source 是「谁注册的、来自内置还是插件」，configSchema / issues 是
  // 插件平台要的配置模型与装配结论 —— 与用户侧描述对象同一口径（B7、P1）。
  for (const item of listAgentPlatforms()) {
    assert.deepEqual(Object.keys(item).sort(),
      ['capabilities', 'configSchema', 'id', 'issues', 'label', 'owner', 'source']);
  }
});

test('Agent 侧未注册即抛错（fail-closed），注册后恢复', () => {
  resetAgentPlatforms();
  assert.throws(() => requireAgentPlatform(), /Agent 平台未注册/);
  assert.equal(listAgentPlatforms().length, 0);
  registerBuiltinAgentPlatforms();
  assert.equal(activeAgentPlatformId(), 'dsh');
});

// ── 目录不变式 ──────────────────────────────────────────────────────────────

const PLATFORM_TOKENS = /(?:^|[-_.])(qq|dsh|snowluma|napcat)(?:[-_.]|$)/i;

// src/ 根下仍带平台名的业务模块。B5 的边界是「怎么连上平台」（传输层）；
// 这些都是「连上之后用它做什么」的业务逻辑，归 B7（控制台元数据化）与后续批次，
// 但因为它们与传输层住在同一个目录，必须逐项登记：新增一个就说明有人把新平台
// 实现又写回了 src/ 根，本用例会红。
const KNOWN_ROOT_PLATFORM_MODULES = new Set([
  // 目录不变式里不该再出现 Agent 连接层：它现在住在 src/agent-side/adapters/ 下。
  // 控制台「选模型」的业务规则（提供方 / 模型 / 思考强度联动）。
  'src/dsh-model.js',
  // MCP server 入口：被 .mcp.json 与 package.json 按固定路径引用，改名会断外部配置。
  'src/mcp-snowluma-safe.js',
  // 控制台的模型视图（把 DSH 模型目录渲染成 QQ 侧可选项）。
  'src/qq-model-view.js',
  // **外部契约**：仓库外独立工具直接引用这个路径（见 scripts/test-snowluma-conn.mjs），
  // 改名会打断 voice-tool/ 等外部调用方。
  'src/snowluma-conn.js',
]);

test('平台专属实现只在 src/{user,agent}-side/adapters/ 下', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'dsh-client.js')), 'src/dsh-client.js 必须已下沉');
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'platform')), 'src/platform/ 已搬空（onebot → user-side/adapters/qq）');

  const stray = [];
  for (const entry of fs.readdirSync(path.join(ROOT, 'src'), { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (PLATFORM_TOKENS.test(entry.name)) stray.push(`src/${entry.name}`);
  }
  for (const entry of fs.readdirSync(path.join(ROOT, 'src', 'lib'), { withFileTypes: true })) {
    if (entry.isFile() && PLATFORM_TOKENS.test(entry.name)) stray.push(`src/lib/${entry.name}`);
  }
  const unexpected = stray.filter((f) => !KNOWN_ROOT_PLATFORM_MODULES.has(f));
  assert.deepEqual(unexpected, [], `这些平台专属文件应移入 src/user-side/adapters/ 或 src/agent-side/adapters/：${unexpected.join(', ')}`);
  // 反向校验：登记表不能腐烂成永久赦免 —— 搬走一项就要删一行。
  for (const known of KNOWN_ROOT_PLATFORM_MODULES) {
    assert.ok(fs.existsSync(path.join(ROOT, known)), `${known} 已不存在，请从例外清单里删掉`);
  }
});

test('主程序不直接 import 具体平台适配器', () => {
  for (const rel of ['src/bridge.js', 'src/self-test.js', 'src/bridge-extensions.js']) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!/from '\.\/(?:dsh-client|platform\/onebot|platform\/prompt|lib\/qq-backend-label|lib\/dsh-)/.test(code),
      `${rel} 仍引用已搬迁的路径`);
  }
  // 主程序必须经门面（user-platform.mjs / agent-side/runtime.mjs）。
  for (const rel of ['src/bridge.js', 'src/self-test.js']) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!/from '\.\/(?:user|agent)-side\/adapters\//.test(code),
      `${rel} 必须经门面（user-platform.mjs / agent-side/runtime.mjs），不得直连 adapters/`);
  }
  // bridge-extensions 是「公开 API 聚合层」：只允许一个例外（0.1.x 的旧导出名与文件名契约）。
  const ext = fs.readFileSync(path.join(ROOT, 'src', 'bridge-extensions.js'), 'utf8');
  const direct = [...ext.matchAll(/from '\.\/(?:user|agent)-side\/adapters\/[^']+'/g)].map((m) => m[0]);
  assert.deepEqual(direct, [
    "from './user-side/adapters/qq/qq-backend-label.js'",
  ], `bridge-extensions 只允许为公开导出名保留一处直连（实际：${direct.join(' | ') || '无'}）`);
});

test('装配点各自只有一处，且都列在内置清单里', () => {
  assert.deepEqual(BUILTIN_USER_PLATFORMS.map((p) => p.id), ['qq']);
  // 顺序即默认 active：dsh 首位不是排版偏好，注册表把第一个注册的当当前平台。
  assert.deepEqual(BUILTIN_AGENT_PLATFORMS.map((p) => p.id), ['dsh', 'acp']);
});

// 夹具的坑：改名后注入表还钉着老符号，bridge 于是拿不到桩、落到真实现上——
// 真地址发现会扫本机进程找 DSH，单次桥接启动多花约 0.8 秒，把「记原始发送时间」那条
// 2 秒容差断言顶成随机失败。这里钉住：连接层必须整体换成离线桩，注入表里不能留旧符号。
test('审计夹具：连接层整体离线桩，旧注入名不残留', () => {
  const harness = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-bridge-harness.mjs'), 'utf8');
  assert.match(harness, /\n\s+agentRuntime,\n/, '夹具必须把 agentRuntime 注入 VM');
  assert.match(harness, /prepareEndpoint: async \(agentConfig = \{\}\) => \{/, '地址发现必须离线桩掉');
  assert.ok(!/from '\.\.\/src\/agent-side\/adapters\/dsh\/endpoint\.mjs'/.test(harness),
    '夹具不得引用真地址发现：它会扫本机进程，装了 DSH 的机器上会摸到真 DSH');
  for (const stale of ['agent-client', 'AgentApiClient:', 'discoverLaunchToken:', 'resolveAgentHome:', 'createDshProbe,']) {
    assert.ok(!harness.includes(stale), `夹具注入表还留着旧符号：${stale}（bridge 已经不按这个名字取绑定）`);
  }
});
