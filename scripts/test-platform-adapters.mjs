#!/usr/bin/env node
// B5 运行期适配器契约：两侧注册表 + 中立门面 + 目录不变式。
//
// 这条回归钉住「内核不认识具体平台」这件事的可执行部分：
//   · 用户侧：内核只调 buildSendCall / describeBackend，实现住在 adapters/qq/；
//   · Agent 侧：内核只调 AgentApiClient / discoverLaunchToken，实现住在 adapters/dsh/；
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
// 顶层 import 即求值：门面在模块初始化时就绑定协议实现，这一步本身就是断言之一。
import {
  AgentApiClient,
  discoverLaunchToken,
  resolveAgentHome,
  unwrap,
  createTurnCollector,
} from '../src/agent-side/agent-client.mjs';

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
  // limits 自 B7 起也在这里（控制台按它画表单，不再自己写死 4000）。
  assert.deepEqual(Object.keys(qq).sort(), ['capabilities', 'conversationTypes', 'id', 'label', 'limits']);
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

test('内置 Agent 平台已注册，且 protocol 由 builtin 装配', () => {
  assert.equal(activeAgentPlatformId(), 'dsh');
  const impl = requireAgentPlatform();
  assert.ok(impl.protocol, 'builtin.mjs 必须把 client.mjs 装配进 protocol');
  assert.equal(typeof impl.protocol.NodeApiClient, 'function');
  assert.equal(typeof impl.protocol.unwrap, 'function');
  // 声明面仍然只由 profiles/ 提供：preset 清单在声明里，协议在 protocol 里。
  assert.deepEqual(impl.AGENT_PRESET_IDS, ['chat', 'chat-v2', 'readonly', 'workspace', 'full']);
});

test('agent-client 门面的常量就是适配器 protocol 的成员（不是另一份实现）', () => {
  const protocol = requireAgentPlatform().protocol;
  assert.equal(AgentApiClient, protocol.NodeApiClient);
  assert.equal(discoverLaunchToken, protocol.discoverDshLaunchToken);
  assert.equal(resolveAgentHome, protocol.resolveDshHome);
  assert.deepEqual(unwrap({ result: { ok: true, value: 42 } }, 'demo'), 42);
  assert.throws(() => unwrap({ result: { ok: false, error: { code: 'x', message: 'y' } } }, 'demo'), /demo failed: x: y/);
  assert.equal(typeof createTurnCollector, 'function');
});

test('控制台可见的平台列表不泄漏协议对象', () => {
  const json = JSON.stringify(listAgentPlatforms());
  assert.ok(!json.includes('NodeApiClient'), 'protocol 不该出现在 /api 响应里');
  for (const item of listAgentPlatforms()) {
    assert.deepEqual(Object.keys(item).sort(), ['capabilities', 'id', 'label']);
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
  // Agent 平台鉴权失败的提示文案（给用户看的恢复指引，不是协议）。
  'src/dsh-auth-hint.js',
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
  // 主程序必须经门面（user-platform.mjs / agent-client.mjs）。
  for (const rel of ['src/bridge.js', 'src/self-test.js']) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(!/from '\.\/(?:user|agent)-side\/adapters\//.test(code),
      `${rel} 必须经门面（user-platform.mjs / agent-client.mjs），不得直连 adapters/`);
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
  assert.deepEqual(BUILTIN_AGENT_PLATFORMS.map((p) => p.id), ['dsh']);
});

// B5 踩过的坑：改名后夹具的注入表还钉着老符号（resolveDshBaseUrl），bridge 于是拿不到桩、
// 落到门面的真实现上 —— 真实现会扫本机进程找 DSH，单次桥接启动多花约 0.8 秒，
// 把 test-backfill 里「记原始发送时间」那条 2 秒容差断言顶成随机失败。
// 这里钉住两件事：地址发现必须离线桩掉；注入表里不能残留改名前的旧符号。
test('审计夹具的平台桩用中立名，且地址发现强制离线', () => {
  const harness = fs.readFileSync(path.join(ROOT, 'scripts', 'audit-bridge-harness.mjs'), 'utf8');
  assert.match(harness, /\n\s+resolveAgentBaseUrl: async \(configured\) =>/, '夹具必须按中立名离线桩掉 resolveAgentBaseUrl');
  assert.ok(!/import \{[^}]*\bresolveAgentBaseUrl\b[^}]*\} from '\.\.\/src\/agent-side\/agent-client\.mjs'/.test(harness),
    '夹具不得注入真地址发现：它会扫本机进程，装了 DSH 的机器上会摸到真 DSH');
  for (const stale of ['oneBotSendCall,', 'NodeApiClient: class', 'discoverDshLaunchToken:', 'resolveDshHome:', 'resolveDshBaseUrl: async']) {
    assert.ok(!harness.includes(stale), `夹具注入表还留着改名前的旧符号：${stale}（bridge 已经按中立名调用，旧键不会有任何绑定）`);
  }
});
