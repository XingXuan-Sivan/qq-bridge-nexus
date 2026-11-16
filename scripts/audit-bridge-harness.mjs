// Execute the real bridge initialization/functions against temporary files and fake peers.
// No production config, QQ connection, DSH process, or persistent home is accessed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as markdown from '../src/md-to-plain.js';
import * as sensitive from '../src/sensitive.js';
import * as wait from '../src/v2-wait.js';
import * as safeFetch from '../src/safe-fetch.js';
import * as forward from '../src/forward.js';
import * as slang from '../src/slang-learner.js';
import * as sticker from '../src/sticker-lib.js';
import * as stickerLimits from '../src/lib/sticker-limits.mjs';
import * as modelPrices from '../src/model-prices.js';
import * as dshModel from '../src/dsh-model.js';
import * as quoteForward from '../src/quote-forward.js';
import * as modeHandover from '../src/mode-handover.js';
import * as roleCard from '../src/role-card.js';
import { createScheduler } from '../src/scheduler/engine.js';
import { parseRemindCommand, REMIND_HELP, formatTaskList } from '../src/scheduler/commands.js';
import { createScheduledNoteStore, scheduledPromptBlock, scheduledDirectPrompt } from '../src/scheduler/notes.js';
import { buildSkipNotice } from '../src/scheduler/skip-notice.js';
import { describeInstant } from '../src/scheduler/time.js';
import { createSilenceSchedule, peakPresetRanges, describeRange, DIRECT_PASS_MS } from '../src/silence-schedule.js';
import * as roleRefreshLib from '../src/role-refresh.js';
import * as stickerDescribeLib from '../src/sticker-describe.js';
import * as webImageLib from '../src/web-image.js';
import * as tokenGuardLib from '../src/agent-token-guard.js';
import * as promptBlocksLib from '../src/prompt-blocks.js';
import * as autoCompactLib from '../src/auto-compact.js';
import * as defaultRolesLib from '../src/default-roles.js';
import * as backfillLib from '../src/backfill.js';
import * as rolePerKeyLib from '../src/role-per-key.js';
// 手动静默是 bridge.js 的新 import；夹具剥掉 import 后要补回同名函数。
import * as manualSilenceLib from '../src/manual-silence.mjs';
// 人格三层解析是纯函数模块（不读盘、不联网），直接用真实现：夹具要验证它读到的本地卡是否正确。
import { createPersonaResolver } from '../src/persona-resolve.mjs';
import { createSkillIndex } from '../src/skills/index.mjs';
// P3 外部技能：bridge 直接 import；夹具剥掉 import 后要补回同名符号。
import { createSkillStore, validateSkillText } from '../src/extensions/skill-store.mjs';
// 扩展 catalog（P1）：bridge.js 新 import；夹具剥掉 import 后补回同名符号。
// 这里注入的是构造器本身，测试不读 /api/extensions 时不会启动 MCP 子进程。
import { createMcpInventory } from '../src/extensions/mcp-inventory.mjs';
import { createExtensionCatalog } from '../src/extensions/catalog.mjs';
// P2 外部 MCP/Hub：bridge 直接 import，夹具按同名补回。
import { createMcpStore } from '../src/extensions/mcp-store.mjs';
import { createSecretStore } from '../src/extensions/secrets.mjs';
import { createMcpRuntime } from '../src/extensions/mcp-runtime.mjs';
import { createPresetPolicy } from '../src/extensions/preset-policy.mjs';
import { createExtensionHub } from '../src/extensions/hub.mjs';
import { ensureHubToken, hubTokenMatches } from '../src/extensions/hub-token.mjs';
// P3 预设编辑器：bridge 直接 import，夹具按同名补回。
import { createPresetStore, validateAgentYaml } from '../src/presets/store.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as behaviorProfileLib from '../src/behaviors/index.mjs';
import * as behaviorTypeLib from '../src/behaviors/types.mjs';
import * as behaviorEngineLib from '../src/behaviors/engines.mjs';
import * as factoryLib from '../src/profiles/factory.mjs';
import YAML, { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { formatKey, parseKey, platformOfConfig } from '../src/session/key.mjs';
import { accountOfConfig, configureKeys, key as buildKey, defaultAddress, isGroupKey, isPrivateKey, idOfKey, withAddress } from '../src/session/key.mjs';
import { createCommandRegistry } from '../src/commands/registry.mjs';
// 内置命令的壳与 /api/commands 组装：夹具剥掉 import，所以要在 sandbox 里补这两项（P7 抽层后新增）。
import { createBuiltinCommands } from '../src/commands/builtin.mjs';
// 命令层、会话重置与会话准入闸门都是真实现（纯内存 + 注入依赖），夹具剥掉 import 后要在这里补回同名符号。
import { createSessionResetter } from '../src/session/reset.mjs';
import { loadSessionState, saveSessionState } from '../src/session/store.mjs';
// 会话档案目录（P1）：bridge 直接 import，夹具剥 import 后按同名补回。
import { applyPatch, createProfile, createSessionDirectoryWriter, loadSessionDirectory, normalizeProfile } from '../src/session/directory.mjs';
import { createAccessConfig, normalizeAccessConfig, normalizeAccessEntries, resolveAccess, resolveAccessSummary, wakeAccessAxis } from '../src/session/access.mjs';
import { normalizePlan, createPlanStore, legacyModeOfPlan, legacyLevelOfPlan, planIdForLegacy, findPlan } from '../src/runtime/plans.mjs';
import { createRuntimeState } from '../src/runtime/active.mjs';
import { createCapabilityStore, capabilityAllowsFlag, visiblePlatformFlags, platformFlags, normalizeCapability, CAPABILITY_RUNTIME_DEFAULTS } from '../src/capabilities/store.mjs';
import { listPlatforms, loadPlatform, readPlatformTools, PLATFORM_TOOL_RISKS } from '../src/platforms/index.mjs';
// 配置 v2（C2）：bridge.js 在 loadConfig 里做迁移与派生视图，夹具剥 import 后要按同名补回。
// P2 又进了三个：写口按 id 打补丁要用扁平条目，切换默认执行体要用 setActivePlatform，
// 「改完要不要重启」靠端点白名单判定 —— 都是纯函数，用真实现。
import { AGENT_ENDPOINT_KEYS, CONFIG_VERSION, flatPlatformEntry, migrateConfigToV2, patchPlatformConfig, platformViews, platformsForWrite, readPlatforms, setActivePlatform } from '../src/config/platforms.mjs';
// 发送调用构造与后端称呼（B5）：bridge.js 只经 src/user-side/user-platform.mjs 门面调用，
// 夹具剥 import 后必须按门面的名字补回。实现本身在 adapters/qq/ 里。
// B6 又从这里进了三个名字：统一出站、后端配置注入、插件平台注册表。
// B7 再加两个：控制台的平台元数据与 HTTP 发送端点的目标解析。
import {
  buildSendCall,
  describeBackend,
  readBackendInfo,
  sendAction as dispatchSend,
  configureUserPlatformBackend,
  transportRegistry,
  userPlatformMetadata,
  resolveSendTarget,
} from '../src/user-side/user-platform.mjs';
// Agent 侧的连接层在 VM 里换成离线桩（见下面的 runtimeStub）：真实的地址发现会查本机进程
// （lsof/netstat），装了 DSH 的机器上会摸到真 DSH。
// 调用面与健康度用真实现：假 api 的方法名与 DSH 同名，createDshPort 能直接吃下，
// 能力闸门与解包逻辑照常生效；health 是纯状态机，能验证「连续 2 次失败才判不可用」。
// agentPlatformMetadata 是纯注册表查询，用真实现。
import { agentPlatformMetadata } from '../src/agent-side/metadata.mjs';
import { createAgentPort } from '../src/agent-side/port.mjs';
// 平台注册表：快照拼装、单条查找、写口校验都是纯函数，用真实现。
import { findRegistryPlatform, platformRegistrySnapshot, vetPlatformConfig } from '../src/platforms/registry.mjs';
// 提示注入通道与平台实现查询都是注册表的纯查询（声明面来自 profiles/…/adapters/runtime.mjs），直接用真实现。
import { agentPlatform, agentPlatformPromptChannels } from '../src/agent-side/runtime-registry.mjs';
// 平台话术的读写（唤醒前缀、控制台提示词编辑器、还原出厂）：真实现，纯 fs。
// 整体注入命名空间：以后那边新增导出不必再回来补一行，也不会出现「函数在 VM 里未定义、
// 读话术静默变空串」这种看不出问题的夹具失真。
import * as platformPromptLib from '../src/user-side/prompt.mjs';
import { DSH_AGENT_CAPABILITIES, createDshPort } from '../src/agent-side/adapters/dsh/port.mjs';
import { createDshHealth } from '../src/agent-side/adapters/dsh/health.mjs';
import { normalizePermissionConfig, normalizeSessionPermission, presetForLevel, resolvePermission, FORBIDDEN_PERMISSION_PRESETS, PERMISSION_LABEL, PERMISSION_LEVELS, SESSION_PERMISSIONS } from '../src/session/permission.mjs';
import { capabilityCovers, toolCatalogSnapshot } from '../src/tools/catalog.mjs';
import { createAdapterRegistry } from '../src/platforms/adapter-registry.mjs';

import { migrateAccessModel, summarizeAccessConfig } from '../src/session/access-migrate.mjs';
import { migrateSessionProfiles } from '../src/session/migrate.mjs';
import { isUsableMode, resolveEffectiveMode } from '../src/session/mode.mjs';
// 多管理员（P3）：bridge 直接 import，夹具按同名补回。
import { actorForQQ, actorForAddress, addressKey, normalizeOwner, normalizeAdmins, closedAgentMaxLevel, canOpenLevel } from '../src/admin/admins.mjs';
import { createSessionRegistry } from '../src/session/registry.mjs';
import { createSessionPolicy } from '../src/session/policy.mjs';
// 上游适配（P7 第四步）：SnowLuma 健康探测同样是真实现，夹具要补回。
import { createSnowlumaHealth } from '../src/upstream/snowluma-health.mjs';
// 上游编排的纯策略（P7 第四步）：bridge 的 import 会被本夹具剥掉，必须逐个注入。
import { resolveConnectionUpdate } from '../src/upstream/snowluma-conn-update.mjs';
import { buildCommandsPayload } from '../src/commands/payload.mjs';
import { createPromptBlockRegistry } from '../src/plugins/prompt-blocks.mjs';
import * as tokenLedger from '../src/token-ledger.js';
import * as voiceLib from '../src/send-voice-lib.js';
import * as presetPrompt from '../src/preset-prompt.js';
// 仿真提示词的初始版本：bridge 直接 import，夹具剥掉 import 后要补回同名符号。
import * as presetDefaults from '../src/preset-defaults.js';
import * as stateAcl from '../src/state-acl.mjs';
import * as bridgeExt from '../src/bridge-extensions.js';
import * as memoryRegistry from '../src/memory/registry.mjs';
import * as memoryDefaults from '../src/memory/defaults.mjs';
import * as memoryIngest from '../src/memory/ingest.mjs';
import * as memoryLocalStore from '../src/memory/local-store.mjs';
import { SECURITY_HEADERS } from '../src/http/security.mjs';
import { createAgentTurnCollector } from '../src/agent-side/collector.mjs';
import { createDshEventPlane } from '../src/agent-side/adapters/dsh/events-plane.mjs';
// P3 模式持久化：bridge 直接 import；夹具剥掉 import 后要按同名补回（否则 main() 里
// createModeStore 会 ReferenceError）。夹具跑的是真实实现，两个后端都是纯存取，不联网。
import { createModeStore, createLocalModeFileBackend, createDshModeBackend } from '../src/runtime/mode-store.mjs';
// 调度内核（src/scheduling/）：bridge 直接 import 这些纯函数，
// 夹具剥掉 import 后按顶层名补回。整体注入命名空间，内核新增导出不必回来补行。
import * as schedulingBatching from '../src/scheduling/batching.mjs';
import * as schedulingPacing from '../src/scheduling/pacing.mjs';
import * as schedulingCursor from '../src/scheduling/cursor.mjs';
import * as schedulingPolicy from '../src/scheduling/policy.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export async function bridgeHarness({ config = {}, savedState, files = {}, globals = {}, botRequest = null, behavior = {}, platformTools = {}, plans = [],
  // fetchDelay：按网关动作人为拖慢一条请求（目前只用于 get_msg），构造「入站还在解析」的窗口。
  fetchDelay = {} } = {}) {
  // 取 realpath：macOS 默认的 /var/folders 是 /private/var/folders 的软链接，而语音库解析会返回 realpath（挡 symlink 逃逸），
  // 不先归一的话「库内路径」断言在真实 Mac 上会因为前缀不同而失败。
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-audit-bridge-')));
  fs.mkdirSync(path.join(temp, 'src'));
  fs.mkdirSync(path.join(temp, 'state'));
  // 平台声明面（C2b）：提示词变量与配置面都从 profiles/platforms/<id>/platform.yml 读，
  // 夹具把真实声明抄进 temp —— 否则身份句里的平台名会退化成中性说法，
  // 夹具与真实现的差异就只会在一句提示词里静默存在。
  fs.mkdirSync(path.join(temp, 'profiles', 'platforms', 'qq'), { recursive: true });
  fs.copyFileSync(
    path.join(root, 'profiles', 'platforms', 'qq', 'platform.yml'),
    path.join(temp, 'profiles', 'platforms', 'qq', 'platform.yml'),
  );
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({
    dsh: { authToken: 'fixture-only' }, ownerQQ: 123,
    allow: { private: ['123'], groups: ['456'] }, consolePort: 0,
    consoleToken: 'fixture-console-token', slang: { enabled: false }, ...config,
  }));
  if (savedState) fs.writeFileSync(path.join(temp, 'state/sessions.json'), JSON.stringify(savedState));
  // 四层模型（profiles/）整份复制：平台、Agent 平台、能力预设、运行方案、行为档案都在这里，
  // 只复制单个文件会让平台话术、工具表或方案列表缺项，测试就会读到空目录。
  fs.cpSync(path.join(root, 'profiles'), path.join(temp, 'profiles'), { recursive: true });
  const merge = (base, patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base;
    const out = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === 'object' && !Array.isArray(value)
        && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
        out[key] = merge(base[key], value);
      } else {
        out[key] = value;
      }
    }
    return out;
  };
  // 行为档案：测试传入的 behavior 合并进 config 段（兼容旧的 {v1:{...}} / {v2:{...}} 形状）。
  for (const id of ['social-v1', 'social-v2']) {
    const file = path.join(temp, 'profiles/platforms/qq/behaviors', `${id}.yml`);
    const source = parseYaml(fs.readFileSync(file, 'utf8'));
    // kind 已改为 social-v1/social-v2，旧的 {v1:{...}} / {v2:{...}} 入参按引擎名兜底。
    const patch = behavior.config ?? behavior[source.kind] ?? behavior[String(source.kind).replace(/^social-/, '')] ?? {};
    source.config = merge(source.config ?? {}, patch);
    fs.writeFileSync(file, stringifyYaml(source));
  }
  // 注册面由能力预设的平台工具表推导，测试要开某个工具就改预设，而不是往 config.tools 塞键。
  if (Object.keys(platformTools).length) {
    const file = path.join(temp, 'profiles/agent-platforms/dsh/capabilities/chat.yml');
    const doc = parseYaml(fs.readFileSync(file, 'utf8'));
    doc.tools = { ...(doc.tools ?? {}), platform: { ...(doc.tools?.platform ?? {}), ...platformTools } };
    fs.writeFileSync(file, stringifyYaml(doc));
  }
  // 自定义方案：写进同一套 profiles/plans，内置方案继续只读。
  for (const plan of plans) {
    if (!plan?.id) continue;
    fs.writeFileSync(
      path.join(temp, 'profiles/plans', `${plan.id}.yml`),
      stringifyYaml({ version: 1, builtin: false, platform: 'qq', agentPlatform: 'dsh', behavior: 'none', audience: 'access', ...plan }),
    );
  }
  // r4：额外状态文件（用于测试"启动时读到损坏/旧版文件"这类路径）。
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(temp, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content));
  }
  const calls = { created: [], archived: [], sent: [], prompts: [], follows: [], forgets: [], cancelled: [], images: [], faces: [], http: [], commands: [], settings: [], responds: [], renames: [], selectModels: [] };
  // 语音发送在桥接里是**直接 fetch 网关**（与文本/表情共用 sendChain，但要自己带 record 段），
  // 所以这里给 VM 注入一个记录型 fetch：既不让测试真的发 QQ 消息，又能断言发出的段内容。
  const fakeFetch = async (url, init = {}) => {
    const body = (() => { try { return JSON.parse(init.body ?? '{}'); } catch { return init.body; } })();
    calls.http.push({ url: String(url), body });
    const action = String(url).split('/').pop();
    if (action === 'fetch_ptt_text') {
      return { ok: true, status: 200, json: async () => ({ status: 'ok', retcode: 0, data: { text: 'fixture-transcript' } }) };
    }
    // get_msg：语音落地校验用 —— 回一个带 record 段的消息，模拟真实网关
    if (action === 'get_msg') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          retcode: 0,
          data: { message_id: 9001, message: [{ type: 'record', data: { file: 'fixture-record.amr', duration: 3 } }] }
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({ status: 'ok', retcode: 0, data: { message_id: 9001 } }) };
  };
  const success = (value) => ({ result: { ok: true, value } });
  const api = {
    events: { follow: (id) => calls.follows.push(id), forget: (id) => calls.forgets.push(id) },
    // settings.describe 的默认桩：没有 qq-mode 命名空间 ⇒ refreshMode() 回退到本地 mode.json。
    // 测试可覆盖它来验证「DSH 设置里的空 ownerQQ 不得覆盖 config.json」等契约。
    settings: {
      describe: async () => success({ namespaces: [] }),
      update: async () => success({ updated: true })
    },
    workspace: {
      create: async () => success({ created: false, workspace: { workspaceId: 'fixture-workspace' } }),
      rename: async (params) => { calls.renames.push(params); return success({}); },
      archiveSession: async ({ sessionId }) => { calls.archived.push(sessionId); return success({}); },
    },
    sessions: {
      create: async (params) => { calls.created.push(params); return success({ sessionId: `fixture-${calls.created.length}` }); },
      // P0 对账：默认把本进程创建过的会话都算在线；测试可覆盖成空列表模拟 DSH 侧丢失。
      list: async () => success({ items: calls.created.map((_, index) => ({ sessionId: `fixture-${index + 1}` })) }),
      selectModel: async (params) => { calls.selectModels.push(params); return success({ selected: { provider: params?.provider ?? 'fixture', model: params?.model ?? 'fixture' } }); },
      prompt: async (params) => { calls.prompts.push(params); return success({}); },
    },
    respond: async (msg) => { calls.responds.push(msg); return success({}); },
    // v0.3.0：会话斜杠命令（/permission）与权限预设目录、设置写穿。
    commands: { execute: async (sessionId, line) => { calls.commands.push({ sessionId, line }); const name = String(line).split(' ')[1] ?? ''; return success({ commandId: 'c', result: { kind: 'success', text: name ? `preset ${name}` : 'current preset workspace-write' } }); } },
    permissionPresets: { catalog: async () => success({ options: [{ value: 'read-only' }, { value: 'workspace-write' }, { value: 'danger-full-access' }, { value: 'qq-full-ask' }], defaultPreset: 'workspace-write' }) },
    settings: { update: async (p) => { calls.settings.push(p); return success({}); }, describe: async () => success({ namespaces: [] }) },
    agentPresets: { list: async () => success({ presets: [] }) },
    stopSessionWork: async (sessionId) => { calls.cancelled.push(sessionId); return { removed: 0 }; },
    callUnary: async (method, params) => {
      if (method === 'session.rename') calls.renames.push(params);
      else calls.cancelled.push({ method, params });
      return success({ accepted: true });
    },
  };
  // 连接层桩：bridge 只经 agentRuntime()（地址 / 凭据 / 客户端 / 事件 / 端口 / 收集器 / 健康 / 探活）。
  // 地址发现与客户端必须离线：真实现会扫本机进程；端口用真实现，能力闸门与解包逻辑照常生效。
  // 审批 / 提问的挂起表由事件面写入、端口读出：两者必须共用同一份。
  const approvals = new Map();
  const agentPortStub = createAgentPort({
    id: 'dsh',
    label: 'DeepSeek Harness',
    capabilities: DSH_AGENT_CAPABILITIES,
    impl: createDshPort({ client: api, approvals }),
  });
  // 事件面用真实现：测试要模拟平台的审批请求，走的就是线上那条翻译路径
  // （`requestEvent()` 同时把回执键记进挂起表）。
  const eventsPlane = createDshEventPlane({ getClient: () => api, approvals });
  const runtimeStub = {
    id: 'dsh',
    label: 'DeepSeek Harness',
    mode: 'http',
    prepareAuth: () => ({ authToken: '', tokenExplicit: false }),
    prepareEndpoint: async (agentConfig = {}) => {
      const configured = String(agentConfig.baseUrl ?? '');
      return { baseUrl: configured || 'http://127.0.0.1:3080', auto: !configured, discovered: false, reachable: false };
    },
    client: () => api,
    events: () => eventsPlane,
    port: () => agentPortStub,
    collector: () => createAgentTurnCollector(),
    health: (options) => createDshHealth(options),
    // 探活只在 startDshWatch 里跑，而它在切片点之后：这里只要求形状成立。
    probe: () => ({ check: async () => ({ ok: true, error: null, rediscovered: false, url: null }) }),
    authHint: () => null,
    authRecentlyFailed: () => false,
    resetAuthHint: () => {},
    close: async () => {},
  };
  const agentRuntime = () => runtimeStub;
  class FakeBot {
    async sendPrivateMessage(id, text) { calls.sent.push({ kind: 'private', id, text }); }
    async sendGroupMessage(id, text) { calls.sent.push({ kind: 'group', id, text }); }
    async getImage({ file }) {
      calls.images.push(file);
      // Valid 1 × 1 PNG, supplied entirely in memory by the fixture gateway.
      return { base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k3ioAAAAASUVORK5CYII=' };
    }
    async fetchFaceEntity(id) { calls.faces.push(id); return null; }
    // get_msg：引用原文解析（resolveReplyInfo → replyRawCache）走的是这个口。
    // 只提供时序与「能取到一条消息」；归属校验用的字段一律不给，于是内容仍然被拒，
    // 与真网关取不到归属时的结果一致。fetchDelay.get_msg 用来把这条请求拖慢。
    async getMessage(messageId) {
      calls.messages = calls.messages ?? [];
      calls.messages.push(messageId);
      const delayMs = Number(fetchDelay?.get_msg ?? 0);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { message_id: Number(messageId), message: [{ type: 'text', data: { text: 'fixture-quoted' } }] };
    }
    async request(action, params) {
      // botRequest：按动作名模拟网关回执（例如 NapCat 与 SnowLuma 对 add_custom_face 的不同行为）
      calls.requests = calls.requests ?? [];
      calls.requests.push({ action, params });
      if (typeof botRequest === 'function') return botRequest(action, params);
      return { status: 'ok', retcode: 0, data: [{ emoji_id: 'fixture-sticker', url: 'https://public.invalid/sticker' }] };
    }
  }
  let source = fs.readFileSync(path.join(root, 'src/bridge.js'), 'utf8');
  // 去掉顶层 import（VM 里靠 context 注入提供这些绑定）。
  // 必须按行处理：这些 import 有**多行**写法，用单行正则（/^import[\s\S]*?;/gm）会在
  // 第一个分号处停下，把紧跟其后的正常代码一起删掉（曾把 `cfg.socialV2.voice = {…}`
  // 整段吞掉，导致语音相关断言在虚拟环境里悄悄失真）。
  source = source.split(/\r?\n/).reduce((acc, line) => {
    if (acc.droppingImport) {
      if (/;\s*$/.test(line)) acc.droppingImport = false;
      return acc;
    }
    if (/^import[\s{*]/.test(line) || /^import\s+['"]/.test(line)) {
      if (!/;\s*$/.test(line)) acc.droppingImport = true;
      return acc;
    }
    acc.out.push(line);
    return acc;
  }, { out: [], droppingImport: false }).out.join('\n');
  source = source.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(temp, 'src/bridge.js')).href));
  source = source.slice(0, source.indexOf("process.on('SIGINT'"));
  // 切片锚点：入站接管的第一行（C3 起不再是 bot.onPrivateMessage —— 收消息改经
  // 统一入站管线，这一行之后全是连接与订阅，夹具不需要那一段）。
  source = source.replace('  configureUserPlatformInbound(() => bot);', `
  return {
    ensureSession, ensureSlangLearnerSession, resolvePresetName, deliverPrompt, drainPromptQueue,
    sendToQQ, sendStickerV2, collectStickerV2, handleIncoming, startConsoleServer, cfg, state, api, promptQueues,
    getSocialV2State, appendSocialV2Message, recordSentMessagesV2, localMemory,
    buildWakePromptV2, buildWakeSnapshotV2, sendWakePromptV2, socialV2,
    refreshMode, trackTurnEvent, replayPendingWakeReasonsV2,
    collectors, setupSleepTimerV2,
    getInitialPrompt, setInitialPrompt, loadInitialPrompts, formatInitialPromptV2,
    initialPrompts, initialPromptMaxChars,
    extractMediaFromSegments, segmentsToText, fetchOneBotImage, fetchMediaData, resolveMediaList,
    resolveReplyInfo, seenForwardIds, forwardRawCache,
    ownerTranscript, pendingHandover, reconcileSessionPolicies, recordOwnerTranscript, recordSentMessagesV2,
    scheduler, scheduledNotes, handleRemindCommand, silence, scheduledSilenceFor, silenceTick, shouldBlockSilentReply,
    roleRefresh, currentRoleFingerprintV2, roleRefreshBlockV2, refreshRoleNowV2, currentRoleHintV2, currentRoleHint, roleNameForKey, readRoleState,
    writeRoleStateFull,
    stickerDescribeJob, learnerWaiters, stickerDescribeBlocker,
    tokenMiss, rotateAgentTokenV2, promptBlocks, stickerBlockTextV2, slangBlockText,
    sessionLastInput, maybeAutoCompact, compactConversation, compactAttemptAt, recordSessionUsage, noteSendLimitedV2, sendLimitSummaryV2, runBackfill, scheduleBackfill, backfillNotices, seenMsgIds, backfillUnfinished, upstreamGap, noteUpstreamPacket,
    getStickerDescriberSessionId() { return stickerDescriberSessionId; },
    getStickerEntries() { return stickerEntries; },
    emojiCdnCandidates, getImageDimensions, acceptImageBuffer, MAX_MEDIA_BYTES, bot,
    isConversationBusyV2, v2TurnStartAt, turnLeaseNoted, TURN_BUSY_LEASE_MS,
    settingFromDshNamespace, selfIdentityTextV2, buildWakeReminderPromptV2,
    getMode() { return currentMode; },
    setSelfIdentity(display, id) {
      selfDisplayName = String(display ?? '');
      selfUserId = String(id ?? '');
      selfNickname = selfDisplayName.toLowerCase() || 'deepseek';
    },
    flushQueue, retireSession, sessions, getDshHealth, reconcileDshSessions, rebuildSession,
    profileModelOf, profileModelSignature, modelLabelForKey, sessionCanSeeImages, ensureChatModel,
    effectiveMode, passiveAllowed, proactiveAllowed,
    runtimeOf, promptChannelOf, permissionAuthorityOf, applySessionPermission, readAgentPermission, describeAgentPermission,
    agentPermissionOptions, sessionAgentPayload,
    // 提示注入四条：通道解析、首轮前缀的「带过没有」、记账与档案写入。
    // 投递路径（deliverPrompt / ensureSession）在切片点之外，测试用它们直接钉语义。
    platformPromptTextFor, promptInjectedFor, markPromptInjected, ensureSessionProfile,
    ext, handleMemberNotice, reconcileConversationMembers, applyModeChange, sendOwnerDirect, tryHandleApprovalReply, initControllerOnce, looksLikeAdminChannelText,
    setLevel(value) { currentLevel = value; },
    getMode() { return { mode: currentMode, level: currentLevel }; },
    voiceCfg, voiceLibrary, resolveVoicePathForV2, resolveVoicePathForOperator,
    voiceBudgetCheck, sendVoiceV2, sendVoiceForV2, assertOutboundAuditOk,
    setMode(value) { currentMode = value; },
    setReady(value) { agentReady = value; },
    setPresets(value) { dshPresetIds = value; dshDefaultPreset = 'standard'; },
    resetEpoch() { sessionEpoch++; },
  };
  configureUserPlatformInbound(() => bot);`);
  const timers = new Set();
  const context = vm.createContext({
    fs, os, path, http, crypto, fileURLToPath, URL, Buffer, AbortSignal, AsyncLocalStorage,
    // bridge.js 的 `import YAML from 'yaml'` 在 VM 里被剥掉，必须按同名补回：
    // 预设编辑器读/写能力档（readPresetCapability / writePresetRows）全走这个默认导出。
    YAML,
    // 行为档案、行为类型、引擎定义与出厂副本：bridge 直接 import，夹具剥 import 后按同名补回。
    listBehaviorFiles: behaviorProfileLib.listBehaviorFiles,
    readBehaviorDocument: behaviorProfileLib.readBehaviorDocument,
    writeBehaviorData: behaviorProfileLib.writeBehaviorData,
    duplicateBehavior: behaviorProfileLib.duplicateBehavior,
    removeBehaviorFile: behaviorProfileLib.removeBehaviorFile,
    loadBehaviorProfiles: behaviorProfileLib.loadBehaviorProfiles,
    readBehaviorFile: behaviorProfileLib.readBehaviorFile,
    resetBehavior: behaviorProfileLib.resetBehavior,
    resolveBehavior: behaviorProfileLib.resolveBehavior,
    validateBehaviorText: behaviorProfileLib.validateBehaviorText,
    writeBehaviorFile: behaviorProfileLib.writeBehaviorFile,
    listBehaviorTypes: behaviorTypeLib.listBehaviorTypes,
    loadBehaviorTypes: behaviorTypeLib.loadBehaviorTypes,
    groupDefaults: behaviorEngineLib.groupDefaults,
    hasFactory: factoryLib.hasFactory,
    readFactoryText: factoryLib.readFactoryText,
    console: { log() {}, error() {} },
    fetch: fakeFetch,
    // 四层模型的根目录在 src/profiles/paths.mjs 里按仓库根算；夹具把 bridge 搬到 temp 执行，
    // 这里注入 temp 版本，避免测试写到真实 profiles/ 或读到不存在的目录。
    PLATFORMS_ROOT: path.join(temp, 'profiles', 'platforms'),
    AGENT_PLATFORMS_ROOT: path.join(temp, 'profiles', 'agent-platforms'),
    PLANS_ROOT: path.join(temp, 'profiles', 'plans'),
    SCHEMAS_ROOT: path.join(temp, 'profiles', 'schemas'),
    CAPABILITIES_ROOT: path.join(temp, 'profiles', 'agent-platforms', 'dsh', 'capabilities'),
    // 预设编辑器读能力档时要归一（C4 起 preset 正文住在 rows 段）。
    normalizeCapability,
    // 能力档 runtime 段的缺省值（旧会话/未迁移方案按它处理）与提示通道查询。
    CAPABILITY_RUNTIME_DEFAULTS,
    agentPlatform,
    agentPlatformPromptChannels,
    ...schedulingBatching,
    ...schedulingPacing,
    ...schedulingCursor,
    ...schedulingPolicy,
    ...platformPromptLib,
    createPlanStore, listPlatforms, loadPlatform, readPlatformTools, PLATFORM_TOOL_RISKS,
    // 配置 v2（C2）：迁移、读归一与派生视图都是纯函数，用真实现。
    AGENT_ENDPOINT_KEYS, CONFIG_VERSION, flatPlatformEntry, migrateConfigToV2, patchPlatformConfig, platformViews, platformsForWrite, readPlatforms, setActivePlatform,
    // `platforms.active` 的落地要真注册表；VM 里没有装配内置平台，桩掉。
    // 激活语义（fail-closed、可用 id 列表）由 scripts/test-platform-activate.mjs 覆盖。
    activatePlatforms: () => {},
    // 发送调用构造与后端称呼（B5）：bridge.js 只经门面调用，夹具剥 import 后按门面名补回。
    buildSendCall, describeBackend, readBackendInfo,
    // 统一出站与插件平台（B6）：sendAction 在 bridge 里改名 dispatchSend，
    // 因为 bridge 自己有个同名包装（先过 onOutbound 再落到这里）。
    dispatchSend, configureUserPlatformBackend, transportRegistry,
    // 平台元数据与发送目标解析（B7）：都是纯注册表查询，真实现即可。
    userPlatformMetadata, resolveSendTarget, agentPlatformMetadata,
    // 平台注册表：声明面读模块级 root（真实 profiles），配置面由 VM 传入，与 bridge.js 的调用一致。
    findRegistryPlatform, platformRegistrySnapshot, vetPlatformConfig,
    // 锁文件探测用（bridge.js 顶层的 consolePortInUse）；
    // 固定桩掉：测试不应该真去 netstat 宿主机。
    execFileSync: () => '',
    // process 桩要带 env：voice-core / bridge 会读 process.env.FFMPEG_PATH、FFPROBE_PATH 等。
    // 之前只给 pid/platform/kill/exit，导致 `process.env.FFMPEG_PATH` 直接抛 TypeError。
    process: { pid: process.pid, platform: process.platform, kill: process.kill, env: {}, exit: (code) => { throw new Error('unexpected exit ' + code); } },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; },
    clearTimeout, setInterval: () => ({ unref() {} }), clearInterval: () => {},
    agentRuntime,
    // 当前执行体 id：与上面的 runtimeStub 同一份事实（真实现会建连接层句柄，夹具不需要）。
    agentRuntimeId: () => runtimeStub.id,
    // 假对端本身：测试直接改它的方法（h.api.sessions.prompt = …）来模拟服务端行为。
    api,
    SnowLumaWebSocketClient: FakeBot, text: (s) => s,
    // bridge.js 从 src/http/security.mjs 导入（夹具会剥掉 import），这里给同名常量。
    SECURITY_HEADERS,
    ...markdown, ...sensitive, ...wait, ...safeFetch, ...forward, ...slang, ...sticker, ...stickerLimits,
    ...modelPrices, ...dshModel, ...quoteForward, ...modeHandover, ...roleCard, ...tokenLedger,
    createScheduler, parseRemindCommand, REMIND_HELP, formatTaskList, createScheduledNoteStore, scheduledPromptBlock, scheduledDirectPrompt, buildSkipNotice, describeInstant, createSilenceSchedule, peakPresetRanges, describeRange, DIRECT_PASS_MS, ...roleRefreshLib, ...stickerDescribeLib, ...webImageLib, ...tokenGuardLib, ...promptBlocksLib, ...autoCompactLib, ...defaultRolesLib, ...backfillLib, ...rolePerKeyLib, ...manualSilenceLib, ...voiceLib, ...stateAcl, ...presetPrompt, ...presetDefaults, ...bridgeExt, ...memoryRegistry, ...memoryDefaults, ...memoryIngest, ...memoryLocalStore,
    // 插件内核与人格解析在 VM 里桩掉：这个夹具只验证 bridge.js 的接线与主链，不加载真插件、不连 soulkit。
    // 命令注册表用真实现（纯内存、无 IO），命令迁移后的行为才能在 VM 里验证。
    createPersonaResolver,
    createCommandRegistry,
    createBuiltinCommands,
    buildCommandsPayload,
    createSessionResetter,
    // sessions.json 读写（P7 第三步续）：同样被 bridge.js import，夹具剥 import 后要补回。
    loadSessionState,
    saveSessionState,
    createProfile,
    applyPatch,
    normalizeProfile,
    createSessionDirectoryWriter,
    loadSessionDirectory,
    createAccessConfig,
    normalizeAccessConfig,
    normalizeAccessEntries,
    resolveAccess,
    resolveAccessSummary,
    wakeAccessAxis,
    BUILTIN_PLANS: undefined,
    normalizePlans: undefined,
    normalizePlan,
    legacyModeOfPlan,
    legacyLevelOfPlan,
    planIdForLegacy,
    findPlan,
    createRuntimeState,
  normalizePermissionConfig,
  normalizeSessionPermission,
  FORBIDDEN_PERMISSION_PRESETS,
  presetForLevel,
  resolvePermission,
  PERMISSION_LABEL,
  PERMISSION_LEVELS,
  SESSION_PERMISSIONS,
    createCapabilityStore,
    capabilityAllowsFlag,
    visiblePlatformFlags,
    platformFlags,
    capabilityCovers,
    createAdapterRegistry,
    toolCatalogSnapshot,
    migrateAccessModel,
    summarizeAccessConfig,
    migrateSessionProfiles,
    resolveEffectiveMode,
    isUsableMode,
    actorForQQ,
    actorForAddress,
    addressKey,
    normalizeOwner,
    normalizeAdmins,
    closedAgentMaxLevel,
    canOpenLevel,
    createSessionRegistry,
    createSessionPolicy,
    createSnowlumaHealth,
    resolveConnectionUpdate,
createPromptBlockRegistry,
createSkillIndex,
createSkillStore,
validateSkillText,
createMcpInventory,
createExtensionCatalog,
    createMcpStore,
    createSecretStore,
    createMcpRuntime,
    createPresetPolicy,
    createExtensionHub,
    createPresetStore,
    validateAgentYaml,
    createModeStore,
    createLocalModeFileBackend,
    createDshModeBackend,
    ensureHubToken,
    hubTokenMatches,
    formatKey,
    parseKey,
    platformOfConfig,
    configureKeys,
    accountOfConfig,
    defaultAddress,
    withAddress,
    buildKey,
    isGroupKey,
    isPrivateKey,
    idOfKey,
    createPluginKernel: async () => ({
      init: async () => {},
      notify: () => {},
      promptAdditions: async () => ({ prependText: '', appendText: '' }),
      // B6：出站两道改造钩子的默认行为是「什么都不改」。夹具默认没有插件，
      // 返回原段才能保证收口前后的报文逐字节一致。
      decorateOutbound: async ({ segments }) => ({ segments, dropped: false, changedBy: null }),
      decorateReply: async ({ text }) => ({ text, dropped: false, changedBy: null }),
      personaResolve: () => null,
      personaWarm: async () => null,
      // 默认没有任何插件任务类型：bridge 的调度器适配层要能容忍这一点。
      taskTypes: () => [],
      hasTaskType: () => false,
      validateTaskType: () => null,
      runTaskType: async () => ({ status: 'sent' }),
      status: () => ({ enabled: true, plugins: [], persona: { id: null } }),
      shutdown: async () => {},
    }),
    // ACL 收紧会 spawn icacls 去改**真实**文件系统；测试不该做这件事（同理见下面的
    // cleanupTemp / processAudioVolume 桩）。桩成成功，让 hardenStateDirAcl 走正常分支。
    hardenDir: () => ({ ok: true, detail: 'stub' }),
    // 音量靠 ffmpeg；测试环境不该真跑 ffmpeg（也不该在沙箱里 spawn）。
    // 默认桩成"按倍数记账但不转码"，调用方可用 globals 覆盖来断言真实行为。
    processAudioVolume: async (file, { volume = 1, normalize = false, loudness = 'normal' } = {}) => {
      const v = Number(volume);
      const changed = normalize === true || Math.abs(v - 1) > 1e-9;
      return {
        path: changed ? `${file}.vol` : file,
        converted: changed,
        applied: changed,
        volume: normalize ? 1 : v,
        loudness: normalize ? -16 : null,
        mode: normalize ? 'loudnorm' : (changed ? 'volume' : 'original'),
        detail: normalize ? `智能音量（响度归一 ${loudness === 'loud' ? -13 : loudness === 'quiet' ? -20 : -16} LUFS）`
          : (changed ? `音量 ${Math.round(v * 100)}%` : '原始音量')
      };
    },
    cleanupTemp: () => {},
    ...globals,
  });
  // Execute the pure model view in the bridge realm. Its plain-object checks
  // should see the same prototypes as real bridge messages, just as in Node.
  const modelViewSource = fs.readFileSync(path.join(root, 'src/qq-model-view.js'), 'utf8').replace(/^export /gm, '');
  vm.runInContext(`Object.assign(globalThis, (() => { ${modelViewSource}\nreturn { compactModelMessage, compactModelData, serializeModelData }; })());`, context);
  vm.runInContext(source + '\nglobalThis.auditReady = main();', context);
  const bridge = await context.auditReady;
  bridge.setPresets(['standard', 'chat', 'chat-v2', 'readonly', 'workspace', 'full']);
  bridge.setReady(true);
  return { ...bridge, calls, temp, agentEvents: eventsPlane, agentApprovals: approvals, agentPort: agentPortStub, async close() {
    for (const timer of timers) clearTimeout(timer);
    fs.rmSync(temp, { recursive: true, force: true });
  } };
}
