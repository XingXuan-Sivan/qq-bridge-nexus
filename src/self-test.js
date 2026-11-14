// 自测脚本：不依赖 SnowLuma / QQ，只验证 DSH 侧链路——
//   1. 连接 DSH Web API
//   2. 创建一个独立测试会话（不会碰现有会话）
//   3. 通过事件面订阅归一事件流
//   4. 端口注入一条消息
//   5. 等回合结束并打印回复
// 用法：node src/self-test.js [baseUrl]
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
// Agent 侧连接层只经 agentRuntime()（具体实现在 src/agent-side/adapters/<id>/）。
// 调用面走 AgentPort，本脚本不出现平台动词。
import { agentRuntime } from './agent-side/runtime.mjs';
// 平台配置的读法跟桥接一致（配置 v2：platforms.agents.<active>.endpoint），不自建一套。
import { configViews } from './config/platforms.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// 自测会话的清理句柄（见 cleanupSelfTestSession）。
let selfTestPort = null;
let selfTestSessionId = null;

/**
 * 归档自测会话。本脚本刻意不指定 agentPreset —— 它必须在跑过 setup-dsh.mjs 之前
 * 也能用来诊断 DSH 链路；正因如此这个会话会带上 DSH 默认 preset（含 bash/文件工具），
 * 更不能留在用户的 DSH 里累积。
 */
async function cleanupSelfTestSession() {
  if (!selfTestPort || !selfTestSessionId) return;
  const sid = selfTestSessionId;
  selfTestSessionId = null;
  try {
    await selfTestPort.archiveSession(sid);
    console.log('🧹 已归档自测会话:', sid);
  } catch (error) {
    console.log('⚠️ 自测会话归档失败（可在 DSH 里手动删除）:', sid, error?.message ?? error);
  }
}

async function main() {
  // 未给参数时按 config.json 的 platforms.agents.<active>.endpoint.baseUrl；
  // 留空则自动识别（桌面版 19387 / 命令行版 3080）
  let file = null;
  try { file = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch {}
  const { agentPlatform } = configViews(file ?? {});
  if (process.argv[2]) agentPlatform.baseUrl = process.argv[2];
  const runtime = agentRuntime({ config: agentPlatform, log: console.log });
  // 凭据与地址的补全由连接层负责：判断规则随执行体变化（stdio 没有地址，也没有 launch token）。
  const auth = runtime.prepareAuth(agentPlatform);
  Object.assign(agentPlatform, { authToken: auth.authToken, authTokenExplicit: auth.tokenExplicit });
  const endpoint = await runtime.prepareEndpoint(agentPlatform);
  if (endpoint.baseUrl) console.log(`${runtime.label} 地址: ${endpoint.baseUrl}${endpoint.auto ? '（自动识别）' : ''}`);
  const agentPort = runtime.port();
  selfTestPort = agentPort;
  const promptText = process.argv[3] ?? '只回复两个字：收到';

  const { value: desc } = await agentPort.readSettings();
  console.log('✅ DSH 连接成功:', JSON.stringify(desc).slice(0, 200));

  // 独立测试会话，cwd 用**系统临时目录**（不是仓库的 state/）：
  // state/ 被 scripts/harden-state-acl.mjs 收紧了 ACL（去掉继承 ACE，只留当前用户 /
  // SYSTEM / Administrators），DSH 沙箱的能力 SID 不在 ACL 里 ⇒ 在沙箱内跑自检
  // 会直接 EPERM 建目录。自检是一次性探针，产物本来也不该落进仓库状态目录。
  const cwd = path.join(os.tmpdir(), 'qq-bridge-self-test');
  fs.mkdirSync(cwd, { recursive: true });
  const created = await agentPort.ensureSession({ cwd });
  const sessionId = created.sessionId;
  selfTestSessionId = sessionId;
  console.log('✅ 测试会话已创建:', sessionId);

  // 先订阅事件流（在 prompt 之前），再注入消息。
  // 必须等 WebSocket 真正 open 后再 prompt，否则 turn 事件可能在连接建立前产生而被漏掉。
  const collector = runtime.collector();
  let resolveOpened;
  let openTimer;
  const opened = new Promise((resolve, reject) => {
    openTimer = setTimeout(() => reject(new Error('等待 WebSocket open 超时（10s）')), 10_000);
    resolveOpened = () => { clearTimeout(openTimer); resolve(); };
  });
  const stream = runtime.events().mux({}, undefined, () => resolveOpened());
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待回复超时（60s）')), 60_000);
    (async () => {
      for await (const event of stream) {
        if (event.sessionId === sessionId) {
          const ended = collector.push(event);
          if (ended) {
            clearTimeout(timer);
            resolve(ended);
            return;
          }
        }
        if (event.kind === 'notice' && event.notice === 'stream-error') {
          clearTimeout(timer);
          reject(new Error('事件流错误: ' + JSON.stringify(event.error)));
          return;
        }
      }
    })().catch((error) => { clearTimeout(timer); reject(error); });
  });
  await opened;
  // 事件流需要显式 follow 该会话，事件才会通过 mux 推过来。
  runtime.events().follow(sessionId);

  const prompted = await agentPort.prompt(sessionId, { content: [{ type: 'text', text: promptText }] });
  if (!prompted.ok) throw new Error(`prompt 未被接受：${prompted.error?.code}: ${prompted.error?.message}`);
  console.log('✅ prompt 已接受');

  const ended = await done;
  console.log('✅ 回合结束 reason =', ended.reason.kind);
  console.log('🤖 agent 回复:');
  console.log(ended.text || '（无文本）');
  await cleanupSelfTestSession();
  console.log('🎉 自测通过 —— 执行体链路可用');
  process.exit(0);
}

main().catch(async (error) => {
  console.error('❌ 自测失败:', error?.message ?? error);
  await cleanupSelfTestSession();
  process.exit(1);
});
