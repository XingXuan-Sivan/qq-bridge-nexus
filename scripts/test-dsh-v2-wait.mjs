// 二代等待逻辑的「实时」端到端测试：真建一个 chat-v2 会话并向 DSH 提问，
// 断言 qq_wait_for_messages 出现在该 preset 的可用工具面里。需要 DSH 正在运行。
// （纯逻辑单测见 scripts/test-v2-wait.mjs，两者不重复。）
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { NodeApiClient, unwrap, discoverDshLaunchToken } from '../src/agent-side/adapters/dsh/client.mjs';
import { createDshEventPlane } from '../src/agent-side/adapters/dsh/events-plane.mjs';
import { createAgentTurnCollector } from '../src/agent-side/collector.mjs';
import { configViews } from '../src/config/platforms.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function main() {
  let auth;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
    // 配置 v2：DSH 的鉴权在 platforms.agents.<active>.endpoint，经扁平视图读。
    const { agentPlatform } = configViews(cfg);
    auth = {
      token: agentPlatform.authToken || discoverDshLaunchToken(),
      header: agentPlatform.authHeader,
      prefix: agentPlatform.authPrefix
    };
  } catch {}
  const api = new NodeApiClient('http://127.0.0.1:3080', undefined, auth);
  // 探测会话的 cwd 用系统临时目录：state/ 的 ACL 被 harden-state-acl.mjs 收紧过，
  // 沙箱里写不进去（见 scripts/probe-auth.mjs 的同款说明）。
  const cwd = path.join(os.tmpdir(), 'qq-bridge-self-test-v2-wait');
  fs.mkdirSync(cwd, { recursive: true });
  const created = unwrap(await api.sessions.create({ cwd, agentPreset: 'chat-v2' }), 'session.create');
  const sessionId = created.sessionId;
  console.log('SESSION_CREATED', sessionId);

  // 走桥接自己的那条路：事件面把 wire 帧翻成归一事件，收集器按回合攒文本。
  // 这样这份「实时」测试才能验证线上真正跑的那两层，而不是另写一份 wire 解析。
  const plane = createDshEventPlane({ getClient: () => api, approvals: new Map() });
  const events = plane.mux({});
  const collector = createAgentTurnCollector();
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待回复超时（120s）')), 120_000);
    (async () => {
      for await (const event of events) {
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

  plane.follow(sessionId);
  const accepted = unwrap(await api.sessions.prompt({ sessionId, mode: 'queue', content: [{ type: 'text', text: '请只输出你当前可用的工具名列表（JSON 数组），不要调用任何工具，不要发送消息。只输出 JSON。' }] }), 'session.prompt');
  console.log('PROMPT_ACCEPTED', JSON.stringify(accepted).slice(0, 120));
  const ended = await done;
  const text = ended.text || '';
  console.log('TOOLS_TEXT_START');
  console.log(text.slice(0, 3000));
  console.log('TOOLS_TEXT_END');
  const hasWait = text.includes('qq_wait_for_messages');
  console.log('HAS_qq_wait_for_messages=' + hasWait);
  console.log('RESULT=' + (hasWait ? 'WAIT_TOOL_VISIBLE' : 'CHECK_FAILED'));
}

main().catch((e) => { console.error(e); process.exit(1); });
