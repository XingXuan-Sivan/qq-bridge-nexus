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
import * as dshAuthHintLib from '../src/dsh-auth-hint.js';
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
import { createPresetStore, PRESET_IDS, validateAgentYaml } from '../src/presets/store.mjs';
import { formatKey, parseKey, platformOfConfig } from '../src/session/key.mjs';
import { configureKeys, key as buildKey, isGroupKey, isPrivateKey, idOfKey } from '../src/session/key.mjs';
import { createCommandRegistry } from '../src/commands/registry.mjs';
// 内置命令的壳与 /api/commands 组装：夹具剥掉 import，所以要在 sandbox 里补这两项（P7 抽层后新增）。
import { createBuiltinCommands } from '../src/commands/builtin.mjs';
// 命令层、会话重置与会话准入闸门都是真实现（纯内存 + 注入依赖），夹具剥掉 import 后要在这里补回同名符号。
import { createSessionResetter } from '../src/session/reset.mjs';
import { loadSessionState, saveSessionState } from '../src/session/store.mjs';
// 会话档案目录（P1）：bridge 直接 import，夹具剥 import 后按同名补回。
import { applyPatch, createProfile, createSessionDirectoryWriter, loadSessionDirectory, normalizeProfile } from '../src/session/directory.mjs';
import { createAccessConfig, normalizeAccessConfig, normalizeAccessEntries, resolveAccess, resolveAccessSummary } from '../src/session/access.mjs';
import { migrateAccessModel, summarizeAccessConfig } from '../src/session/access-migrate.mjs';
import { migrateSessionProfiles } from '../src/session/migrate.mjs';
import { isUsableMode, resolveEffectiveMode } from '../src/session/mode.mjs';
// 多管理员（P3）：bridge 直接 import，夹具按同名补回。
import { actorForQQ, normalizeAdmins, closedAgentMaxLevel, canOpenLevel } from '../src/admin/admins.mjs';
import { createSessionRegistry } from '../src/session/registry.mjs';
import { createSessionPolicy } from '../src/session/policy.mjs';
// 上游适配（P7 第四步）：SnowLuma 健康探测同样是真实现，夹具要补回。
import { createSnowlumaHealth } from '../src/upstream/snowluma-health.mjs';
// 上游编排的纯策略（P7 第四步）：bridge 的 import 会被本夹具剥掉，必须逐个注入。
import { createDshProbe } from '../src/upstream/dsh-probe.mjs';
import { resolveConnectionUpdate } from '../src/upstream/snowluma-conn-update.mjs';
import { buildCommandsPayload } from '../src/commands/payload.mjs';
import { createPromptBlockRegistry } from '../src/plugins/prompt-blocks.mjs';
import * as tokenLedger from '../src/token-ledger.js';
import * as voiceLib from '../src/send-voice-lib.js';
import * as presetPrompt from '../src/preset-prompt.js';
import * as stateAcl from '../src/state-acl.mjs';
import * as bridgeExt from '../src/bridge-extensions.js';
import * as memoryRegistry from '../src/memory/registry.mjs';
import * as memoryDefaults from '../src/memory/defaults.mjs';
import * as memoryIngest from '../src/memory/ingest.mjs';
import * as memoryLocalStore from '../src/memory/local-store.mjs';
import { SECURITY_HEADERS } from '../src/http/security.mjs';
import { unwrap, createTurnCollector } from '../src/dsh-client.js';

const root = fileURLToPath(new URL('..', import.meta.url));
export async function bridgeHarness({ config = {}, savedState, files = {}, globals = {}, botRequest = null } = {}) {
  // 取 realpath：macOS 默认的 /var/folders 是 /private/var/folders 的软链接，而语音库解析会返回 realpath（挡 symlink 逃逸），
  // 不先归一的话「库内路径」断言在真实 Mac 上会因为前缀不同而失败。
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qq-audit-bridge-')));
  fs.mkdirSync(path.join(temp, 'src'));
  fs.mkdirSync(path.join(temp, 'state'));
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({
    dsh: { authToken: 'fixture-only' }, ownerQQ: 123,
    allow: { private: ['123'], groups: ['456'] }, consolePort: 0,
    consoleToken: 'fixture-console-token', slang: { enabled: false }, ...config,
  }));
  if (savedState) fs.writeFileSync(path.join(temp, 'state/sessions.json'), JSON.stringify(savedState));
  // r4：额外状态文件（用于测试"启动时读到损坏/旧版文件"这类路径）。
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(temp, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content));
  }
  const calls = { created: [], archived: [], sent: [], prompts: [], follows: [], cancelled: [], images: [], faces: [], http: [], commands: [], settings: [], responds: [], renames: [], selectModels: [] };
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
    events: { follow: (id) => calls.follows.push(id) },
    // settings.describe 的默认桩：没有 qq-mode 命名空间 ⇒ refreshMode() 回退到本地 mode.json。
    // 测试可覆盖它来验证「DSH 设置里的空 ownerQQ 不得覆盖 config.json」等契约。
    settings: {
      describe: async () => success({ namespaces: [] }),
      update: async () => success({ updated: true })
    },
    workspace: {
      create: async () => success({ created: false, workspace: { workspaceId: 'fixture-workspace' } }),
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
  class FakeBot {
    async sendPrivateMessage(id, text) { calls.sent.push({ kind: 'private', id, text }); }
    async sendGroupMessage(id, text) { calls.sent.push({ kind: 'group', id, text }); }
    async getImage({ file }) {
      calls.images.push(file);
      // Valid 1 × 1 PNG, supplied entirely in memory by the fixture gateway.
      return { base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k3ioAAAAASUVORK5CYII=' };
    }
    async fetchFaceEntity(id) { calls.faces.push(id); return null; }
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
  source = source.replace('  bot.onPrivateMessage(async (event) => {', `
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
    ext, handleMemberNotice, reconcileGroupMembers, applyModeChange, sendOwnerDirect, tryHandleApprovalReply, initControllerOnce, looksLikeAdminChannelText,
    setLevel(value) { currentLevel = value; },
    getMode() { return { mode: currentMode, level: currentLevel }; },
    voiceCfg, voiceLibrary, resolveVoicePathForV2, resolveVoicePathForOperator,
    voiceBudgetCheck, sendVoiceV2, sendVoiceForV2, assertOutboundAuditOk,
    setMode(value) { currentMode = value; },
    setReady(value) { dshReady = value; },
    setPresets(value) { dshPresetIds = value; dshDefaultPreset = 'standard'; },
    resetEpoch() { sessionEpoch++; },
  };
  bot.onPrivateMessage(async (event) => {`);
  const timers = new Set();
  const context = vm.createContext({
    fs, os, path, http, crypto, fileURLToPath, URL, Buffer, AbortSignal, console: { log() {}, error() {} },
    fetch: fakeFetch,
    // 锁文件探测用（bridge.js 顶层的 consolePortInUse）；
    // 固定桩掉：测试不应该真去 netstat 宿主机。
    execFileSync: () => '',
    // process 桩要带 env：voice-core / bridge 会读 process.env.FFMPEG_PATH、FFPROBE_PATH 等。
    // 之前只给 pid/platform/kill/exit，导致 `process.env.FFMPEG_PATH` 直接抛 TypeError。
    process: { pid: process.pid, platform: process.platform, kill: process.kill, env: {}, exit: (code) => { throw new Error('unexpected exit ' + code); } },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; },
    clearTimeout, setInterval: () => ({ unref() {} }), clearInterval: () => {},
    NodeApiClient: class { constructor() { return api; } },
    SnowLumaWebSocketClient: FakeBot, text: (s) => s,
    // bridge.js 从 src/http/security.mjs 导入（夹具会剥掉 import），这里给同名常量。
    SECURITY_HEADERS,
    discoverDshLaunchToken: () => '', resolveDshHome: () => path.join(os.tmpdir(), 'qq-bridge-audit-no-dsh-home'), unwrap, createTurnCollector,
    ...markdown, ...sensitive, ...wait, ...safeFetch, ...forward, ...slang, ...sticker, ...stickerLimits,
    ...modelPrices, ...dshModel, ...quoteForward, ...modeHandover, ...roleCard, ...tokenLedger,
    createScheduler, parseRemindCommand, REMIND_HELP, formatTaskList, createScheduledNoteStore, scheduledPromptBlock, scheduledDirectPrompt, buildSkipNotice, describeInstant, createSilenceSchedule, peakPresetRanges, describeRange, DIRECT_PASS_MS, ...roleRefreshLib, ...stickerDescribeLib, ...webImageLib, ...tokenGuardLib, ...promptBlocksLib, ...autoCompactLib, ...defaultRolesLib, ...backfillLib, ...rolePerKeyLib, ...manualSilenceLib, ...dshAuthHintLib, ...voiceLib, ...stateAcl, ...presetPrompt, ...bridgeExt, ...memoryRegistry, ...memoryDefaults, ...memoryIngest, ...memoryLocalStore,
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
    migrateAccessModel,
    summarizeAccessConfig,
    migrateSessionProfiles,
    resolveEffectiveMode,
    isUsableMode,
    actorForQQ,
    normalizeAdmins,
    closedAgentMaxLevel,
    canOpenLevel,
    createSessionRegistry,
    createSessionPolicy,
    createSnowlumaHealth,
    createDshProbe,
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
    PRESET_IDS,
    validateAgentYaml,
    ensureHubToken,
    hubTokenMatches,
    formatKey,
    parseKey,
    platformOfConfig,
    configureKeys,
    buildKey,
    isGroupKey,
    isPrivateKey,
    idOfKey,
    createPluginKernel: async () => ({
      init: async () => {},
      notify: () => {},
      promptAdditions: async () => ({ prependText: '', appendText: '' }),
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
    // DSH 地址识别桩成离线：真实实现会查本机进程（lsof/netstat），装了 DSH 的机器上会找到真 DSH。
    resolveDshBaseUrl: async (configured) => ({ url: String(configured || '') || 'http://127.0.0.1:3080', auto: !configured, reachable: false, candidates: [] }),
    ...globals,
  });
  // Execute the pure model view in the bridge realm. Its plain-object checks
  // should see the same prototypes as real bridge messages, just as in Node.
  const modelViewSource = fs.readFileSync(path.join(root, 'src/qq-model-view.js'), 'utf8').replace(/^export /gm, '');
  vm.runInContext(`Object.assign(globalThis, (() => { ${modelViewSource}\nreturn { compactModelMessage, compactModelData, serializeModelData }; })());`, context);
  vm.runInContext(source + '\nglobalThis.auditReady = main();', context);
  const bridge = await context.auditReady;
  bridge.setPresets(['standard', 'qq-chat', 'qq-chat-v2', 'qq-agent-readonly', 'qq-agent-workspace', 'qq-agent-full']);
  bridge.setReady(true);
  return { ...bridge, calls, temp, async close() {
    for (const timer of timers) clearTimeout(timer);
    fs.rmSync(temp, { recursive: true, force: true });
  } };
}
