// 测试安全版 QQ MCP server：工具清单 + 二代工具令牌闸门 + 发送前的参数/引用校验
//
// 需要桥接与 OneBot 在线（qq_status 会真的去问 OneBot），所以不进 test:audit。
// 默认模式没有落盘文件：与 bridge.js 的 defaultMode() 同口径 —— 当前用户平台条目的
// `defaultBehavior` 解析出的行为档案引擎，engine=v2 即二代（reserved2）。
//
// 这里所有发送调用都刻意只传「注定被拒」的参数（不存在/非法的引用 id、白名单外目标），
// 所以跑它不会真的往群里发东西。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadBehaviorProfiles, resolveBehavior } from '../src/behaviors/index.mjs';
import { migrateConfig, readPlatforms } from '../src/config/platforms.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** 无会话上下文的默认模式：平台条目 defaultBehavior → 行为档案引擎（空 = 纯聊天）。 */
function defaultMode() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  const platforms = readPlatforms(migrateConfig(raw).config);
  const platformId = platforms.active.user;
  const behaviorId = String(platforms.users?.[platformId]?.defaultBehavior ?? '');
  if (!behaviorId) return 'chat';
  const behaviors = loadBehaviorProfiles({ root: path.join(ROOT, 'profiles', 'platforms', platformId, 'behaviors') });
  const engine = resolveBehavior(behaviors, behaviorId).engine;
  if (engine === 'v2') return 'reserved2';
  if (engine === 'v1') return 'reserved';
  return 'chat';
}

const MODE = (() => {
  try {
    return defaultMode();
  } catch (error) {
    console.log('⚠️ 默认行为解析失败，按聊天模式处理：', error?.message ?? error);
    return 'chat';
  }
})();

/** 二代会话令牌：发送端点按 target key 校验令牌，所以只能拿「同一个群会话」的令牌试参数层。 */
function pickAgentSession() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'state', 'social-v2.json'), 'utf8'));
    for (const [key, st] of Object.entries(raw.conversations ?? {})) {
      const token = String(st?.agentToken ?? '');
      const matched = /(?:^|:)group:(\d+)$/.exec(key);
      if (token && matched) return { key, token, groupId: matched[1] };
    }
  } catch {}
  return null;
}

const entry = fileURLToPath(new URL('../src/mcp-snowluma-safe.js', import.meta.url));

const transport = new StdioClientTransport({ command: process.execPath, args: [entry] });
const client = new Client({ name: 'bridge-test', version: '0.1.0' });

/** 被拒可能以 JSON-RPC 错误抛出，也可能回 isError：两种都算「被拒绝」。 */
async function call(name, args) {
  try {
    return await client.callTool({ name, arguments: args });
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: `调用被拒绝：${error?.message ?? error}` }] };
  }
}
const textOf = (result) => result.content?.[0]?.text ?? '';
const verdict = (result) => (result.isError ? '被拒绝 ✓' : '⚠️ 未被拒绝（异常！）');

try {
  await client.connect(transport);
  console.log('✅ 安全 MCP 连接成功 | 默认模式:', MODE);
  const tools = await client.listTools();
  const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
  console.log('工具:', [...byName.keys()].join(', '));

  const status = await call('qq_status', {});
  console.log('✅ qq_status:', textOf(status).slice(0, 150));

  // 二代工具一律把 key + token 声明成必填：漏掉任一个都不该退化成控制台会话。
  const v2Tools = ['qq_get_prompt', 'qq_send_message', 'qq_wait_for_messages'];
  const uncovered = v2Tools.filter((name) => {
    const required = byName.get(name)?.inputSchema?.required ?? [];
    return !(required.includes('key') && required.includes('token'));
  });
  console.log('✅ 二代工具 key + token 必填:', uncovered.length ? `缺失 ✗ ${uncovered.join('、')}` : '全部 ✓');

  const noToken = await call('qq_get_prompt', { key: 'group:123456789' });
  console.log('🚫 无 token 的 qq_get_prompt:', verdict(noToken), textOf(noToken).slice(0, 120));

  const sendSchema = JSON.stringify(byName.get('qq_send_group_message')?.inputSchema ?? {});
  console.log('✅ replyToMessageId 参数:', sendSchema.includes('replyToMessageId') ? '存在 ✓' : '缺失 ✗');
  console.log('✅ qq_reply 工具:', byName.has('qq_reply') ? '存在 ✓' : '缺失 ✗');

  const agent = pickAgentSession();
  console.log('二代会话令牌:', agent ? agent.key : '未找到（只验证令牌闸门）');

  if (agent) {
    // 同一个群 + 真令牌：令牌闸门放行后才轮得到下面的参数校验与引用解析。
    const base = { groupId: agent.groupId, message: '测试', token: agent.token };
    const badId = await call('qq_send_group_message', { ...base, replyToMessageId: 'abc' });
    console.log('🚫 非法引用 id(abc):', verdict(badId), textOf(badId).slice(0, 120));

    const zeroId = await call('qq_send_group_message', { ...base, replyToMessageId: 0 });
    console.log('🚫 非法引用 id(0):', verdict(zeroId), textOf(zeroId).slice(0, 120));

    // 真实 QQ 消息 id 可能是负数：负数应通过整数校验，再由「查不到这条消息」拒绝。
    const missingId = await call('qq_send_group_message', { ...base, replyToMessageId: -123456789 });
    console.log('🚫 负 id 但消息不存在:', verdict(missingId), textOf(missingId).slice(0, 120));

    const replyDenied = await call('qq_reply', { ...base, replyToMessageId: -123456789 });
    console.log('🚫 qq_reply 负 id 但消息不存在:', verdict(replyDenied), textOf(replyDenied).slice(0, 120));
  } else {
    // 没有令牌可用时，只剩令牌闸门本身可证：漏传 token 的发送必须被拒。
    const noTokenSend = await call('qq_send_group_message', { groupId: 100003, message: '测试' });
    console.log(`🚫 无 token 发送（${MODE}）:`, verdict(noTokenSend), textOf(noTokenSend).slice(0, 120));
  }

  process.exit(0);
} catch (error) {
  console.error('❌ 测试失败:', error?.message ?? error);
  process.exit(1);
}
