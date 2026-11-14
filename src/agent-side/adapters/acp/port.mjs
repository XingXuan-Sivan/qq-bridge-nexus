// ACP 的 `AgentPort` 实现（C6-d）：把 ACP v1 的方法面翻成中立动词。
//
// 与 DSH 的三处**结构性**差异（PLATFORM_UNIFICATION §9.1），都是必须处理而不是绕过的：
//
//   1. **v1 的 `session/prompt` 阻塞到回合结束**才回 `stopReason`。直接 await 会把整轮
//      卡在投递里，所以这里把它当后台任务，用「首个信号」判受理（见 prompt 的注释）。
//      回合边界由响应给出 → `turn-end` 事件 —— 内核不再靠「多久没动静」猜回合结束。
//   2. **权限是反向请求**：Agent 问过来、内核答回去。`session/request_permission` 必须
//      挂起（`DEFERRED`），回执按 `requestId` 找挂起项；自动回复会把 Agent 的等待判死。
//   3. **没有工作区 / 设置 / 压缩 / 改名**：不伪造。能力位不声明，调用 fail-closed 报
//      `capability_unsupported`（§十 第 3 条：不为 ACP 的缺口造伪能力）。
//
// 名单是**会话级**的：`modes` 与 `configOptions` 只出现在 `session/new` 的回执里，协议
// 没有「全局目录」这种东西。所以 `listPresets` / `listPermissionPresets` / `listModels`
// 在任何会话都还没有时**建一个探测会话**去读 —— 这不是偷偷改状态，而是协议决定的唯一读法；
// 替代方案是返回空表，那会让控制台在第一条消息之前什么都看不到（L3 也就永远开不起来）。
//
// **能力位回答的是「这个适配器现在能不能做这组事」，不是「这个会话暴露了哪些选项」。**
// 会话选项（modes / configOptions）是运行期数据，有的 Agent 根本不发；把它塞进能力位会让
// 控制台在第一个会话建立前永远看不到按钮。
//
// 未连接时按 ACP v1 的固定方法面**乐观**声明，连接后按对端回执**收缩**（只影响 `session`
// 组的 `close`）。这不是猜对端：闸门本身挡在初始化之前，若未连接时返回空集，
// `listPermissionPresets` 这类「启动时就要读」的方法会被闸门永久挡住 —— 而闸门背后
// 正是唯一能做初始化与探测会话的地方，会形成一个打不开的死锁。

import { createRequire } from 'node:module';

import {
  AgentCapabilityError,
  CAPABILITY_UNSUPPORTED,
  normalizeSessionRef,
} from '../../port.mjs';
import { DEFERRED } from './client.mjs';
import { mapPermissionRequest, mapSessionUpdate } from './events.mjs';

/** 实施目标是 v1（stable）；v2 仍是 Draft，等转正再评估（§9.1）。 */
export const ACP_PROTOCOL_VERSION = 1;

/**
 * ACP 实现**可能**提供的能力位（上限）。
 *
 * 声明面（profiles/agent-platforms/acp/adapters/runtime.mjs）与这里共用一份，避免
 * 「控制台画了按钮、port 却不声明」的漂移。真正声明什么由 `capabilities()` 在
 * `initialize` 之后按对端回执裁。
 */
export const ACP_PORT_CAPABILITIES = Object.freeze(['session', 'permission', 'models']);

/** 受理判定的宽限期：见 prompt()。0 = 只等首条信号（测试用）。 */
const DEFAULT_ACCEPT_GRACE_MS = 800;

/** `session/list` 的翻页上限：游标实现有 bug 时不能变成死循环。 */
const MAX_LIST_PAGES = 100;

/** `session/prompt` 的 `stopReason` 缺失时的兜底值（协议要求必须有）。 */
const DEFAULT_STOP_REASON = 'end_turn';

const require = createRequire(import.meta.url);

/** 客户端版本（`initialize.clientInfo`）：报错了才看得出是哪个版本的桥接在连。 */
function clientVersion() {
  try {
    return String(require('../../../../package.json').version ?? '');
  } catch {
    return '';
  }
}

const clean = (value) => String(value ?? '').trim();

/** 选项的取值清单（`configOptions[].options` 是 `[{value, name}]`）。 */
const optionValues = (option) => (Array.isArray(option?.options) ? option.options : [])
  .map((item) => clean(item?.value))
  .filter(Boolean);

/** 某个取值的显示名；取不到就用取值本身（控制台不该显示空白项）。 */
function optionName(option, value) {
  const hit = (Array.isArray(option?.options) ? option.options : []).find((item) => clean(item?.value) === value);
  return clean(hit?.name) || value;
}

/**
 * 决策 → ACP 的 `RequestPermissionOutcome`。
 *
 * **不映射 `allow_always`**（§5.3 规则 2）：让 Agent 记住授权，桥接就无法审计与回收。
 * 没有「允许一次」这一项时回 `cancelled` 而不是退到 `allow_always` —— 宁可拒绝，
 * 不能把「只批这一次」悄悄升级成「以后都批」。
 */
function outcomeFor(options, decision) {
  const list = Array.isArray(options) ? options : [];
  const text = typeof decision === 'string' ? decision.trim().toLowerCase() : '';
  if (text === 'allowed-once' || text === 'allowed' || text === 'allow') {
    const hit = list.find((option) => option.kind === 'allow_once');
    return hit ? { outcome: 'selected', optionId: hit.optionId } : { outcome: 'cancelled' };
  }
  if (text === 'rejected' || text === 'reject' || text === 'denied' || text === 'deny') {
    const hit = list.find((option) => option.kind === 'reject_once');
    return hit ? { outcome: 'selected', optionId: hit.optionId } : { outcome: 'cancelled' };
  }
  // 提问通道（`{ answers }`）是 DSH 的；ACP v1 只有权限请求。报错而不是猜一个拒绝：
  // 猜错的代价是「用户以为答了，其实没答」。
  throw new Error(`respondPermission: ACP 没有提问通道，不认识的决策 ${JSON.stringify(decision)}`);
}

/**
 * 建一份 ACP port。
 *
 * @param {object} spec
 * @param {object} spec.client       `createAcpClient()` 的产物（传输层）
 * @param {string} [spec.instance]   会话引用里的平台标识，形如 `acp` / `acp:claude`
 * @param {string} [spec.cwd]        建会话时缺省的工作目录（`session/new` 的 `cwd`）
 * @param {(level:string,text:string)=>void} [spec.logger]
 * @param {(event:object)=>void} [spec.onEvent]  归一事件出口（§5.2）。事件流不属于操作
 *   动词，所以不挂在 port 上（port 是冻结的）——在装配时注入，与「怎么连上」同层。
 * @param {number} [spec.acceptGraceMs]
 * @returns {{impl: object, capabilities: () => string[]}}
 *   协商制平台的能力位只能在 `initialize` 之后求值，所以工厂把能力位函数一起交出去；
 *   `createAgentPort({ capabilities })` 每次查询都会重新调用它（C6-b 的延迟求值）。
 */
export function createAcpPort({
  client,
  instance = 'acp',
  cwd = '',
  logger = () => {},
  onEvent = () => {},
  acceptGraceMs = DEFAULT_ACCEPT_GRACE_MS,
} = {}) {
  for (const name of ['request', 'notify', 'handle', 'on', 'respond']) {
    if (typeof client?.[name] !== 'function') throw new Error(`createAcpPort: 传输层缺少 ${name}()`);
  }

  const agentId = clean(instance) || 'acp';
  const sessionIdOf = (ref) => normalizeSessionRef(ref, agentId).sessionId;

  // ── 连接态 ────────────────────────────────────────────────────────────────
  let initializing = null;
  let agentCapabilities = null; // `initialize` 回执的 agentCapabilities
  let agentInfo = {};           // `initialize` 回执的 info（name / version）

  // ── 会话快照：ACP 的 modes / configOptions 是会话级的 ──────────────────────
  const snapshots = new Map(); // sessionId -> snapshot
  let lastSessionId = '';      // 最近一个建过 / 用过的会话：全局名单从这里取
  let discovery = null;        // Promise<snapshot|null>：探测会话（只建一次）

  // ── 反向请求与受理信号 ────────────────────────────────────────────────────
  const pendingPermissions = new Map(); // requestId -> { rpcId, sessionId, options, at }
  const signalWaiters = new Map();      // sessionId -> Set<fn>：首条 update 的等待者

  const notedOnce = new Set();
  /** 同一类提示只记一次：这些不是错误，是「该平台没有这个语义」的说明。 */
  function noteOnce(key, text) {
    if (notedOnce.has(key)) return;
    notedOnce.add(key);
    logger('notice', text);
  }

  function safeEmit(event) {
    if (!event) return;
    try {
      onEvent(event);
    } catch (error) {
      logger('error', `ACP 事件处理抛错（${event.kind}）：${error?.message ?? error}`);
    }
  }

  /** 能力位缺位但方法本身存在（核心方法）时的错误：与 port 的闸门同一个错误码。 */
  const unsupported = (method, detail) => Object.assign(
    new Error(`ACP 对端未声明 ${detail}，${method} 不可用`),
    { code: CAPABILITY_UNSUPPORTED, method },
  );

  // ── 初始化 ────────────────────────────────────────────────────────────────

  /**
   * `initialize` 只做一次；失败**不永久判死**（进程被杀掉还能重拉），下次调用重试。
   */
  const ensureReady = () => {
    if (!initializing) {
      initializing = (async () => {
        const result = await client.request('initialize', {
          protocolVersion: ACP_PROTOCOL_VERSION,
          // 不支持 fs / terminal 就**不声明**：声明了却收不到回执，Agent 会卡在等我们写文件。
          clientCapabilities: {},
          clientInfo: { name: 'qq-bridge-nexus', version: clientVersion() },
        });
        const version = Number(result?.protocolVersion);
        if (version !== ACP_PROTOCOL_VERSION) {
          // 协议要求对端回选「≤ 请求版本」。回了更高版本说明它按另一套报文说话，
          // 继续猜着解析比直接报错更贵（会得到「有的字段有、有的字段没有」的假象）。
          throw new Error(`ACP 协议版本不匹配：请求 v${ACP_PROTOCOL_VERSION}，对端回 ${result?.protocolVersion ?? '(空)'}`);
        }
        agentCapabilities = result?.agentCapabilities ?? {};
        agentInfo = result?.info ?? {};
        logger('info', `ACP 已连接：${clean(agentInfo.name) || '(未命名)'} ${clean(agentInfo.version)}`.trim());
        return result;
      })();
      initializing.catch(() => { initializing = null; });
    }
    return initializing;
  };

  /**
   * 能力位：未连接时按 v1 的固定方法面乐观声明，`initialize` 之后按对端回执收缩。
   *
   * 未连接就返回空集的写法看起来更「诚实」，但它把初始化本身锁死了：闸门在方法之前执行，
   * 而初始化只可能发生在方法里 —— `listPermissionPresets()` 会被永久拒绝，控制台永远
   * 读不到模式名单，L3 也永远开不起来。对端的真实差异只有 `session` 组（`close`），
   * 连接后立即收缩，其余规则不变。
   */
  const capabilities = () => {
    if (!agentCapabilities) return [...ACP_PORT_CAPABILITIES];
    const list = ['permission', 'models'];
    // `session` 组含 archiveSession（`session/close`），没声明 close 就不该给按钮。
    if (agentCapabilities.sessionCapabilities?.close === true) list.unshift('session');
    return list;
  };

  // ── 会话快照 ──────────────────────────────────────────────────────────────

  function snapshotFrom(sessionId, result) {
    const modes = result?.modes ?? {};
    return {
      sessionId,
      title: clean(result?.title),
      cwd: clean(result?.cwd) || clean(cwd) || process.cwd(),
      modes: {
        currentModeId: clean(modes.currentModeId),
        availableModes: (Array.isArray(modes.availableModes) ? modes.availableModes : [])
          .map((mode) => ({ id: clean(mode?.id), name: clean(mode?.name) || clean(mode?.id) }))
          .filter((mode) => mode.id),
      },
      // 深拷贝一份：后面 selectModel / set_config_option 会把 currentValue 改成本地镜像，
      // 直接改对端回执里的对象等于篡改了 `raw`（排查时看到的就不是平台原话了）。
      configOptions: (Array.isArray(result?.configOptions) ? result.configOptions : []).map((option) => ({
        ...option,
        options: (Array.isArray(option?.options) ? option.options : []).map((item) => ({ ...item })),
      })),
      updatedAt: new Date().toISOString(),
    };
  }

  const modelOptionOf = (snapshot) => (snapshot?.configOptions ?? [])
    .find((option) => clean(option?.category) === 'model' && clean(option?.type) === 'select')
    ?? (snapshot?.configOptions ?? []).find((option) => clean(option?.id) === 'model');
  const modeOptionOf = (snapshot) => (snapshot?.configOptions ?? [])
    .find((option) => clean(option?.category) === 'mode' && clean(option?.type) === 'select');
  /** 无分类的 `agent` option：DSH 的 ACP 实现用它暴露 agent 名单（§9.1）。 */
  const agentOptionOf = (snapshot) => (snapshot?.configOptions ?? [])
    .find((option) => clean(option?.id) === 'agent' || clean(option?.category) === 'agent');

  /** 读全局名单用的快照：优先最近使用的会话，没有就建一个探测会话。 */
  async function snapshotForRead() {
    const existing = snapshots.get(lastSessionId);
    if (existing) return existing;
    // 只建一次；失败也不重试（否则每次读名单都多一次失败 RPC 与一条日志）。
    if (!discovery) {
      discovery = (async () => {
        logger('notice', 'ACP 的 modes / configOptions 是会话级的：建一个探测会话用于读取名单');
        try {
          const created = await createSession({});
          return snapshots.get(created.sessionId) ?? null;
        } catch (error) {
          logger('warn', `ACP 探测会话创建失败，名单按空处理：${error?.message ?? error}`);
          return null;
        }
      })();
    }
    return discovery;
  }

  // ── 发请求的小封装 ────────────────────────────────────────────────────────

  async function setOption(sessionId, option, value) {
    const raw = await client.request('session/set_config_option', {
      sessionId,
      configId: clean(option.id),
      value,
    });
    // 本地镜像：控制台立刻再读一次名单时应看到新值（协议不会主动推完整名单）。
    option.currentValue = value;
    return raw;
  }

  /** 选 agent（无分类 config option）。不在清单里就抛 —— 错的 agent 意味着错的工具面。 */
  async function selectAgent(sessionId, snapshot, name) {
    const option = agentOptionOf(snapshot);
    const wanted = clean(name);
    if (!option) {
      noteOnce('agent-option-missing', 'ACP 对端没有 agent 选项：agentPreset 被忽略（该平台没有 agent 概念）');
      return null;
    }
    const values = optionValues(option);
    if (!values.includes(wanted)) {
      throw new Error(`ACP 的 agent 清单里没有 ${wanted}（可选 ${values.join(' / ')}）`);
    }
    return setOption(sessionId, option, wanted);
  }

  /** 建会话（`session/new`）：ensureSession 与探测会话共用。 */
  async function createSession(params = {}) {
    await ensureReady();
    if (params.workspaceId) {
      // 明知会被忽略却静默丢弃，会让「换了工作区」在日志里查不出来。
      noteOnce('workspace-ignored', 'ACP 没有工作区概念：workspaceId 被忽略，会话目录由 cwd 决定');
    }
    const dir = clean(params.cwd) || clean(cwd) || process.cwd();
    const payload = {
      cwd: dir,
      mcpServers: Array.isArray(params.mcpServers) ? params.mcpServers : [],
    };
    if (params.systemPrompt) payload.systemPrompt = String(params.systemPrompt);
    const raw = await client.request('session/new', payload);
    const sessionId = clean(raw?.sessionId);
    if (!sessionId) throw new Error('session/new 没有返回 sessionId');
    const snapshot = snapshotFrom(sessionId, raw);
    snapshots.set(sessionId, snapshot);
    lastSessionId = sessionId;
    if (params.agentPreset) await selectAgent(sessionId, snapshot, params.agentPreset);
    return { sessionId, raw, snapshot };
  }

  // ── 反向请求：session/update 与 session/request_permission ─────────────────

  client.handle('session/update', (params) => {
    const sessionId = clean(params?.sessionId);
    const update = params?.update;
    if (!sessionId || !update || typeof update !== 'object') return;

    // 先更新快照（模式 / 标题），再翻译事件：事件里的 notice 用的是 update 原文，
    // 但后续 applyPermission 读的是快照里的 currentModeId。
    const snapshot = snapshots.get(sessionId);
    if (snapshot) {
      const name = clean(update.sessionUpdate);
      if (name === 'current_mode_update' && clean(update.currentModeId)) {
        snapshot.modes.currentModeId = clean(update.currentModeId);
      } else if (name === 'session_info_update') {
        if (update.title !== undefined) snapshot.title = clean(update.title);
        if (update.updatedAt !== undefined) snapshot.updatedAt = clean(update.updatedAt);
      }
    }

    // 受理信号：任何一条 update 都说明 Agent 已经在干活（见 prompt 的判定顺序）。
    const waiters = signalWaiters.get(sessionId);
    if (waiters) {
      signalWaiters.delete(sessionId);
      for (const resolve of waiters) resolve();
    }

    safeEmit(mapSessionUpdate(sessionId, update));
  });

  client.handle('session/request_permission', (params, ctx) => {
    const event = mapPermissionRequest(clean(ctx?.id), params);
    if (!event.sessionId) throw new Error('session/request_permission 缺少 sessionId');
    pendingPermissions.set(event.requestId, {
      rpcId: ctx?.id,
      sessionId: event.sessionId,
      options: event.options,
      at: Date.now(),
    });
    safeEmit(event);
    // 不能自动回：这一步可能要等几十秒（QQ 侧 owner 批）。自动回复会把等待判死。
    return DEFERRED;
  });

  // 进程没了，挂起项也回不去了：留着只会让下一次同 id 命中陈旧状态。
  client.on('exit', () => pendingPermissions.clear());

  // ── 受理判定 ──────────────────────────────────────────────────────────────

  /** 等本会话的首条 `session/update`，最多 `acceptGraceMs` 毫秒。 */
  function waitFirstSignal(sessionId, ms) {
    return new Promise((resolve) => {
      if (!(ms > 0)) { resolve('timeout'); return; }
      let timer = null;
      const waiters = signalWaiters.get(sessionId) ?? new Set();
      const done = (reason) => {
        if (timer) clearTimeout(timer);
        waiters.delete(entry);
        if (waiters.size === 0 && signalWaiters.get(sessionId) === waiters) signalWaiters.delete(sessionId);
        resolve(reason);
      };
      const entry = () => done('signal');
      waiters.add(entry);
      signalWaiters.set(sessionId, waiters);
      timer = setTimeout(() => done('timeout'), ms);
      timer.unref?.();
    });
  }

  function emitTurnEnd(sessionId, stopReason, error) {
    const event = {
      kind: 'turn-end',
      sessionId,
      stopReason: clean(stopReason) || (error ? 'error' : DEFAULT_STOP_REASON),
    };
    if (error) {
      event.error = { code: clean(error?.code), message: clean(error?.message ?? error) };
    }
    safeEmit(event);
  }

  // ── 内容块 ────────────────────────────────────────────────────────────────

  /**
   * 内核的 content（`{type:'text'}` / `{type:'image',mediaType,data}`）→ ACP 的 prompt 块。
   *
   * 图片能力按 `promptCapabilities.image === true` 判：**不声明就是不支持**（协议语义）。
   * 不支持时换成文字占位而不是静默丢弃 —— 模型该知道「这里本来有图」。
   */
  function toPromptBlocks(content) {
    const parts = Array.isArray(content) ? content : (content ? [content] : []);
    const imageSupported = agentCapabilities?.promptCapabilities?.image === true;
    const blocks = [];
    for (const part of parts) {
      const type = clean(part?.type);
      if (type === 'text') {
        const text = String(part?.text ?? '');
        if (text) blocks.push({ type: 'text', text });
        continue;
      }
      if (type === 'image') {
        const data = String(part?.data ?? '');
        if (!data) continue;
        if (!imageSupported) {
          noteOnce('image-unsupported', 'ACP 对端未声明 image 输入能力：图片降级成文字占位');
          blocks.push({ type: 'text', text: '[图片：当前 Agent 未声明图片输入能力]' });
          continue;
        }
        blocks.push({
          type: 'image',
          mimeType: clean(part?.mediaType) || clean(part?.mimeType) || 'image/png',
          data,
        });
        continue;
      }
      noteOnce(`block-${type}`, `ACP 不认识内容块 ${type || '(空)'}，已丢弃`);
    }
    return blocks;
  }

  // ── impl ──────────────────────────────────────────────────────────────────

  const impl = {
    // ── 核心 ───────────────────────────────────────────────────────────────

    /**
     * 探活：`initialize` 成功即活。**不抛错**（查询语义，与 DSH 实现一致）：
     * 「什么算不可用」由调用方判定（bridge 的 dsh-probe 自己包一层）。
     */
    async probe() {
      try {
        const result = await ensureReady();
        return { ok: true, version: clean(agentInfo.version), detail: '', raw: result };
      } catch (error) {
        return { ok: false, version: '', detail: clean(error?.message ?? error), raw: null };
      }
    },

    /**
     * 列会话（游标分页）。
     *
     * 对端没声明 `sessionCapabilities.list` 就抛 —— **不能返回空数组**：桥接拿空表做
     * 会话对账，会把所有映射判成「DSH 侧已不存在」然后批量退役，比报错贵得多。
     */
    async listSessions() {
      await ensureReady();
      if (agentCapabilities?.sessionCapabilities?.list !== true) {
        throw unsupported('listSessions', 'sessionCapabilities.list');
      }
      const seen = new Set();
      const sessions = [];
      let cursor = '';
      let raw = null;
      for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
        raw = await client.request('session/list', cursor ? { cursor } : {});
        const items = Array.isArray(raw?.sessions) ? raw.sessions : [];
        for (const item of items) {
          const sessionId = clean(item?.sessionId);
          if (!sessionId || seen.has(sessionId)) continue;
          seen.add(sessionId);
          sessions.push({
            sessionId,
            title: clean(item?.title),
            cwd: clean(item?.cwd),
            // ACP 没有「来源 / 父会话」这两个概念：给空串而不是编一个值，
            // 桥接的判据（`cwd` 在 state/ 下、是否子会话）就不会被假数据带偏。
            origin: '',
            parentSessionId: '',
            archivedAt: null,
          });
        }
        cursor = clean(raw?.nextCursor);
        if (!cursor) break;
        if (page === MAX_LIST_PAGES - 1) logger('warn', `ACP session/list 超过 ${MAX_LIST_PAGES} 页，已截断`);
      }
      return { sessions, raw };
    },

    async ensureSession(params = {}) {
      const created = await createSession(params ?? {});
      return { sessionId: created.sessionId, raw: created.raw };
    },

    /**
     * 投递一次提示，返回中立受理形状 `{ ok, isCommand, commandText, error, raw }`。
     *
     * v1 没有「受理回执」这一步（`session/prompt` 阻塞到回合结束），所以受理靠三条信号里
     * 先到的那个判定：
     *   · 本会话的第一条 `session/update` —— Agent 已经在干活，必然受理了；
     *   · `session/prompt` 的响应 —— 短回合（或命令式回合）直接结束；
     *   · 宽限期 `acceptGraceMs` 到期 —— Agent 可能正在读上下文、还没吐任何 chunk。
     * 三条都不改变回合的真实边界：响应到达时**一律**补一条 `turn-end`（含失败），
     * 否则内核会永久判忙（issue #11/#23/#26/#19 的同一类故障）。
     *
     * 失败分两类：JSON-RPC 错误（对端拒绝受理，如会话没了 / 参数不对）→ `ok:false`，
     * 走桥接的自愈路径；传输级错误（进程不在、管道断了）→ 抛 —— 那不是「拒绝受理」，
     * 而是「这次调用根本没到」。
     *
     * `isCommand` 恒为 false：斜杠命令直通是 DSH 的能力（`value.command` 回执），
     * ACP 的 `session/prompt` 响应只有 `stopReason`，没有命令回执可给。
     */
    async prompt(ref, { content, mode = '', requestId } = {}) {
      const sessionId = sessionIdOf(ref);
      await ensureReady();
      lastSessionId = sessionId;
      if (mode) noteOnce('mode-ignored', 'ACP v1 的 session/prompt 没有排队语义：mode 参数被忽略');
      if (requestId) noteOnce('request-id-ignored', 'ACP v1 没有幂等键：requestId 被忽略（重发会产生第二个回合）');
      const blocks = toPromptBlocks(content);
      if (!blocks.length) throw new Error('prompt: 提示内容为空');

      const turn = client.request('session/prompt', { sessionId, prompt: blocks });
      turn.then(
        (result) => emitTurnEnd(sessionId, clean(result?.stopReason), null),
        (error) => emitTurnEnd(sessionId, 'error', error),
      );

      const first = await Promise.race([
        turn.then((result) => ({ kind: 'done', result }), (error) => ({ kind: 'failed', error })),
        waitFirstSignal(sessionId, acceptGraceMs).then((reason) => ({ kind: 'running', reason })),
      ]);

      if (first.kind !== 'failed') {
        return { ok: true, isCommand: false, commandText: '', error: null, raw: first.result ?? null };
      }
      const error = first.error;
      if (typeof error?.code === 'number') {
        // JSON-RPC 错误码：对端明确拒绝了这次投递。
        return {
          ok: false,
          isCommand: false,
          commandText: '',
          error: { code: String(error.code), message: clean(error.message) },
          raw: null,
        };
      }
      throw error;
    },

    /** 取消当前回合（`session/cancel` 是通知，没有响应）。回合边界由 `turn-end` 给。 */
    async cancel(ref) {
      const sessionId = sessionIdOf(ref);
      const notified = client.notify('session/cancel', { sessionId });
      return { raw: { sessionId, notified } };
    },

    // ── session ───────────────────────────────────────────────────────────

    /** 归档 = `session/close`（close 不等于 delete，与 DSH 的 archive 语义接近）。 */
    async archiveSession(ref) {
      const sessionId = sessionIdOf(ref);
      if (agentCapabilities?.sessionCapabilities?.close !== true) {
        throw new AgentCapabilityError(agentId, 'session', 'archiveSession');
      }
      const raw = await client.request('session/close', { sessionId });
      snapshots.delete(sessionId);
      // 挂起表的键是 requestId，得按会话扫：留着一个已关闭会话的挂起项，
      // 之后同 id 的回执会打到一个谁也等不到的请求上。
      for (const [requestId, entry] of pendingPermissions) {
        if (entry.sessionId === sessionId) pendingPermissions.delete(requestId);
      }
      if (lastSessionId === sessionId) lastSessionId = '';
      return { raw };
    },

    /**
     * agent 名单（无分类的 `agent` config option）。
     *
     * 没有这个选项就返回空表 —— 桥接据此知道「这个平台没有 agent 档」，由声明面决定
     * 是忽略 agentPreset 还是 fail-closed（见 profiles/agent-platforms/acp）。
     */
    async listPresets() {
      const snapshot = await snapshotForRead();
      if (!snapshot) return { presets: [], raw: null };
      const option = agentOptionOf(snapshot);
      if (!option) return { presets: [], raw: option ?? null };
      const current = clean(option.currentValue);
      return {
        presets: optionValues(option).map((value) => ({
          id: value,
          name: optionName(option, value),
          isDefault: value === current,
        })),
        raw: option,
      };
    },

    // ── permission ────────────────────────────────────────────────────────

    /**
     * 改会话的权限档：优先 config option（`category: 'mode'`），否则 v1 专用
     * `session/set_mode`（§9.1：两条路都要认）。
     *
     * 返回**已解包的回执** `{ value: { ok, modeId } }`；「这算不算成功」由声明面的纯函数
     * 判定（`modeId === wanted`）—— ACP 的 set_mode 没有回执值，能确认的只有「RPC 成功」，
     * `current_mode_update` 只是事件，不保证先于响应到达。这一点比 DSH 弱，但不假装更强。
     */
    async applyPermission(ref, preset) {
      const sessionId = sessionIdOf(ref);
      const wanted = clean(preset);
      if (!wanted) throw new Error('applyPermission: 缺少预设名');

      const own = snapshots.get(sessionId);
      // 名单可能只在别的会话（或探测会话）里读到过：模式表是 Agent 级的，借用可以，
      // 写回不行 —— 下面仍然发到目标会话，对端不接受就该报错。
      const catalogue = own ?? (await snapshotForRead());
      if (!catalogue) throw new Error(`applyPermission: 读不到 ACP 的模式名单（会话 ${sessionId}）`);

      const option = modeOptionOf(catalogue);
      const known = option ? optionValues(option) : catalogue.modes.availableModes.map((mode) => mode.id);
      if (known.length && !known.includes(wanted)) {
        throw new Error(`ACP 没有模式 ${wanted}（可选 ${known.join(' / ')}）`);
      }

      const raw = option
        ? await client.request('session/set_config_option', { sessionId, configId: clean(option.id), value: wanted })
        : await client.request('session/set_mode', { sessionId, modeId: wanted });

      if (own) own.modes.currentModeId = wanted;
      return { value: { ok: true, modeId: wanted }, raw };
    },

    /**
     * 只读核对会话当前的权限档。
     *
     * ACP **没有「读当前模式」的方法**（只有 `current_mode_update` 事件），所以重启后
     * 对还没产生事件的会话只能回空串。桥接的外部漂移检测把它当「读不出来」fail-closed，
     * 理由与「读到了别的值」不同 —— 这正是 `preset` / `text` 两个字段分开的意义。
     */
    async readPermission(ref) {
      const sessionId = sessionIdOf(ref);
      const snapshot = snapshots.get(sessionId) ?? null;
      const preset = clean(snapshot?.modes?.currentModeId);
      return { preset, text: preset, raw: snapshot?.modes ?? null };
    },

    /**
     * 回执一个挂起的权限请求（语义与 DSH 相反：这里是**答** Agent 的问）。
     *
     * `ref` 的 id 取 `requestId`，`eventId` 兜底 —— 后者不是别名双读：内核的挂起表
     * 统一用 `eventId` 记「平台事件 id」（bridge 就是拿它拼回执引用的），ACP 的
     * JSON-RPC id 正好放在那里；`clientId` 那一层 ACP 没有。
     */
    async respondPermission(ref, decision) {
      const requestId = clean(ref?.requestId) || clean(ref?.eventId);
      if (!requestId) throw new Error('respondPermission: 缺少 requestId / eventId');
      const waiting = pendingPermissions.get(requestId);
      if (!waiting) throw new Error(`respondPermission: 没有挂起的权限请求 ${requestId}`);
      const outcome = outcomeFor(waiting.options, decision);
      // 先摘表再回执：回执写失败也不该留下一个「以为还能再答一次」的挂起项。
      pendingPermissions.delete(requestId);
      client.respond(waiting.rpcId, outcome);
      return { raw: { requestId, sessionId: waiting.sessionId, ...outcome } };
    },

    /** 权限档目录（模式清单）。控制台据此决定 L3 能不能开。 */
    async listPermissionPresets() {
      const snapshot = await snapshotForRead();
      if (!snapshot) return { options: [], defaultPreset: '', raw: null };
      const option = modeOptionOf(snapshot);
      if (option) {
        return {
          options: optionValues(option).map((value) => ({ value, name: optionName(option, value) })),
          defaultPreset: clean(option.currentValue),
          raw: option,
        };
      }
      return {
        options: snapshot.modes.availableModes.map((mode) => ({ value: mode.id, name: mode.name })),
        defaultPreset: snapshot.modes.currentModeId,
        raw: snapshot.modes,
      };
    },

    // ── models ────────────────────────────────────────────────────────────

    /**
     * 模型目录。
     *
     * ACP 没有「目录 RPC」，模型是会话 config option（`category: 'model'`）的一个取值表。
     * 这里把它拼成内核认识的 `{ groups, ... }` 形状：`provider` 用 Agent 自己的名字 ——
     * ACP 没有提供方这一层，编一个 `deepseek-official` 只会让「控制台的 provider 校验」
     * 永远对不上。没有模型选项的平台返回空 `groups`（内核按「目录为空」降级，不阻塞聊天）。
     */
    async listModels() {
      const snapshot = await snapshotForRead();
      const provider = clean(agentInfo.name) || agentId;
      if (!snapshot) return { catalog: { default: null, routableProviders: [], groups: [], failures: [] }, raw: null };
      const option = modelOptionOf(snapshot);
      if (!option) return { catalog: { default: null, routableProviders: [], groups: [], failures: [] }, raw: snapshot };
      const models = optionValues(option).map((value) => ({ id: value, name: optionName(option, value) }));
      const current = clean(option.currentValue);
      return {
        catalog: {
          default: current ? { provider, model: current } : null,
          routableProviders: [provider],
          groups: [{ id: provider, name: clean(agentInfo.name) || agentId, models }],
          failures: [],
        },
        raw: option,
      };
    },

    /**
     * 套模型：写模型 config option。
     *
     * `provider` 是 **DSH 的概念**（ACP 只有模型值），只在目录里出现一次，这里不校验它；
     * 模型值不在 option 的取值表里就抛 —— 静默忽略会让「设置成功」变成假象。
     * `reasoningEffort` 若有对应的 `model_config` 选项就一起写，没有就当该模型只有一档。
     */
    async selectModel(ref, params = {}) {
      const sessionId = sessionIdOf(ref);
      const snapshot = snapshots.get(sessionId) ?? (await snapshotForRead());
      if (!snapshot) throw new Error(`selectModel: 读不到 ACP 的模型目录（会话 ${sessionId}）`);
      const option = modelOptionOf(snapshot);
      if (!option) throw new Error('selectModel: ACP 的会话没有模型 config option');

      const wanted = clean(params.model);
      if (!wanted) throw new Error('selectModel: 缺少 model');
      const values = optionValues(option);
      if (!values.includes(wanted)) {
        throw new Error(`ACP 的模型目录里没有 ${wanted}（可选 ${values.join(' / ')}）`);
      }
      const raw = await setOption(sessionId, option, wanted);

      let effort = '';
      const wantedEffort = clean(params.reasoningEffort);
      if (wantedEffort) {
        const effortOption = (snapshot.configOptions ?? []).find((item) => clean(item?.category) === 'model_config');
        const efforts = effortOption ? optionValues(effortOption) : [];
        if (efforts.includes(wantedEffort)) {
          await setOption(sessionId, effortOption, wantedEffort);
          effort = wantedEffort;
        } else if (effortOption) {
          throw new Error(`ACP 的 ${wanted} 没有思考强度 ${wantedEffort}（可选 ${efforts.join(' / ') || '无'}）`);
        } else {
          noteOnce('effort-unsupported', 'ACP 没有 model_config 选项：reasoningEffort 被忽略');
        }
      }

      const provider = clean(params.provider) || clean(agentInfo.name) || agentId;
      return { selected: { provider, model: wanted, reasoningEffort: effort }, raw };
    },
  };

  return { impl, capabilities };
}
