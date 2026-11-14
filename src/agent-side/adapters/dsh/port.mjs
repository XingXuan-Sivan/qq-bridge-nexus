// DSH 的 `AgentPort` 实现：把 DeepSeek Harness 的 RPC 面翻成中立动词。
//
// 这里是 `src/agent-side/` 里**唯一**允许出现 `session/*`、`workspace/*`、`settings/*`
// 这些方法名的地方（连同同目录的 client.mjs 与 endpoint.mjs）。内核只经
// src/agent-side/runtime.mjs 取到 port，看不到任何一个 DSH 动词。
//
// 形状约定（C5 起统一）：
//   · 返回值里的语义字段（`sessions` / `sessionId` / `preset` / `text` …）是**已解包**的，
//     `raw` 永远是平台返回的**原始响应**（调用方需要在日志里看一眼平台原话时用它）；
//   · **不判断策略**：`applyPermission` 不告诉调用方「成功没有」，只把回执交回去，
//     判定留给桥接（§5.3 规则 2）。`readPermission` 是纯只读核对，绝不写回；
//     同理 `respondPermission` 只转发内核的决定。
//   · `prompt` 从 C6 起返回**中立受理形状**（见 port.mjs 的说明）：DSH 的
//     `{result:{ok,value,error}}` 信封在这里拍平，不外泄给内核。
import {
  normalizeSessionRef,
  normalizePermissionRef,
  AgentCapabilityError,
} from '../../port.mjs';
import { unwrap } from './client.mjs';

/**
 * 把 `{code, message}` 或裸字符串归一成中立错误形状。
 * 内核侧（agentErrorCode / isSessionNotFoundError / describeAgentError）只读这两个字段，
 * 因此必须保证它们是字符串而不是 DSH 的 error 对象本身。
 */
function normalizeAgentError(error) {
  if (!error) return null;
  if (typeof error === 'string') return { code: '', message: error };
  const code = String(error.code ?? '');
  return { code, message: String(error.message ?? code ?? '') };
}

/**
 * 拍平 `session/prompt` 的受理回执。
 *
 * 三种可能：
 *   1. `{result:{ok:true, value}}`    —— 已受理；`isCommand` 看 `value.command` 是否存在
 *      （存在即「斜杠命令已直接执行，不会有模型回合」），`commandText` 取它的回执文本；
 *   2. `{result:{ok:false, error}}`   —— DSH 拒绝受理（会话丢失、队列满等），**不抛错**：
 *      这类失败要走桥接的自愈路径，抛异常会把「可恢复」和「真故障」混成一种；
 *   3. 形状不认识（协议变更/网关拦截）—— 显式报 `UNEXPECTED_RESPONSE`，不静默当成功。
 */
function toPromptResult(response) {
  const result = response?.result;
  if (result && typeof result === 'object' && 'ok' in result) {
    if (result.ok === true) {
      const command = result.value?.command;
      return {
        ok: true,
        isCommand: command !== undefined && command !== null,
        commandText: String(command?.text ?? ''),
        error: null,
        raw: response,
      };
    }
    return {
      ok: false,
      isCommand: false,
      commandText: '',
      error: normalizeAgentError(result.error) ?? { code: '', message: 'session/prompt 被拒绝，未给出原因' },
      raw: response,
    };
  }
  return {
    ok: false,
    isCommand: false,
    commandText: '',
    error: { code: 'UNEXPECTED_RESPONSE', message: 'session/prompt 返回了无法识别的受理回执' },
    raw: response,
  };
}

/**
 * DSH 声明支持的能力位。
 *
 * 没有 `maintenance`：DSH 的 0.2.0 API 里没有「重建/自愈会话」的 RPC —— 桥接现在的
 * 重建是「停止 + 归档 + 新建」三步组合，属于桥接策略而不是平台能力。声明了会让
 * `CapabilityError` 永远等不到，控制台也会画出不存在的按钮。
 *
 * `compact` 在榜上：它对应 DSH 的 `/compact` 斜杠命令，是真实存在的平台操作。
 */
export const DSH_AGENT_CAPABILITIES = Object.freeze([
  'session',
  'rename',
  'permission',
  'models',
  'settings',
  'workspace',
  'compact',
]);

/** 权限预设相关的两条斜杠命令（设置 / 只读查询）。 */
const permissionCommand = (preset) => `/permission ${String(preset ?? '').trim()}`;
const PERMISSION_QUERY = '/permission';
const COMPACT_COMMAND = '/compact';

/** DSH 的 `/permission` 回执形如 `current preset workspace-write`。 */
const CURRENT_PRESET_RE = /current preset (\S+)/;

/**
 * 建一份 DSH port。
 *
 * @param {{client: object, instance?: string, approvals?: Map<string, object>}} spec
 *   `client` 是 NodeApiClient 实例（或测试里的替身）；`instance` 写进会话引用，
 *   形如 `dsh`（将来 ACP 是 `acp:claude`）；`approvals` 是与事件面共享的挂起表
 *   （`requestId -> { clientId, eventId }`），回执靠它找回平台自己的键。
 */
export function createDshPort({ client, instance = 'dsh', approvals = new Map() } = {}) {
  if (!client || typeof client !== 'object') {
    throw new Error('createDshPort: 缺少 RPC 客户端');
  }
  if (!(approvals instanceof Map)) throw new Error('createDshPort: approvals 必须是 Map');
  const agentId = String(instance ?? 'dsh');
  const sessionIdOf = (ref) => normalizeSessionRef(ref, agentId).sessionId;
  /** 斜杠命令通道缺失时的话术统一在这里，免得每个方法各写一遍。 */
  const requireCommands = (method) => {
    if (typeof client.commands?.execute !== 'function') {
      throw new AgentCapabilityError(agentId, method === 'compactSession' ? 'compact' : 'permission', method);
    }
  };

  return {
    // ── 核心（任何平台都必须有）────────────────────────────────────────────

    /**
     * 探活：settings/describe 能通就算活着。`version` 由 DSH 侧回执给出（不一定有）。
     *
     * **不抛错**：探活是查询，不是操作。失败信息放进 `detail`，由调用方决定要不要
     * 当成「平台不可用」（dsh-probe 需要的是「抛错即失败」，那边自己包一层）。
     */
    async probe() {
      let response = null;
      try {
        response = await client.settings.describe({});
        const value = unwrap(response, 'settings.describe');
        const version = String(value?.version ?? value?.serverVersion ?? '').trim();
        return { ok: true, version, detail: '', raw: response };
      } catch (error) {
        return { ok: false, version: '', detail: String(error?.message ?? error), raw: response };
      }
    },

    /** 列出会话。只暴露内核要用到的字段，DSH 的 `items` 名字不外泄。 */
    async listSessions() {
      const response = await client.sessions.list({});
      const value = unwrap(response, 'sessions.list');
      const items = Array.isArray(value?.items) ? value.items : [];
      return {
        sessions: items.map((item) => ({
          sessionId: String(item?.sessionId ?? ''),
          title: String(item?.title ?? ''),
          cwd: String(item?.cwd ?? ''),
          origin: String(item?.origin ?? ''),
          parentSessionId: item?.parentSessionId ? String(item.parentSessionId) : '',
          // 归档判断要用：DSH 用「还在清单里但有 archivedAt」表示已归档，
          // 与「清单里根本没有」是两种不同的失效原因（日志要能分清）。
          archivedAt: item?.archivedAt ?? null,
        })),
        raw: response,
      };
    },

    /**
     * 建会话（幂等由调用方保证，本方法只建一次）。
     *
     * `params` 原样透传：`workspaceId` / `agentPreset` / `cwd` / `mcpServers` 都是
     * 建会话时的合法输入，内核里没有哪一项是 DSH 专属的。
     */
    async ensureSession(params = {}) {
      const response = await client.sessions.create(params ?? {});
      const value = unwrap(response, 'sessions.create');
      return { sessionId: String(value?.sessionId ?? ''), raw: response };
    },

    /**
     * 投递一次提示。返回中立受理形状 `{ ok, isCommand, commandText, error, raw }`。
     *
     * 传输级失败（401、网络、超时）照旧抛异常 —— 那不是「平台拒绝受理」，
     * 而是「这次调用根本没到」。两者的处理路径不同，不能混在同一个 `ok` 里。
     */
    async prompt(ref, { content, mode = 'queue', requestId } = {}) {
      const payload = { sessionId: sessionIdOf(ref), mode, content };
      if (requestId) payload.requestId = String(requestId);
      return toPromptResult(await client.sessions.prompt(payload));
    },

    /** 取消当前回合并清空排队工作。 */
    async cancel(ref) {
      const raw = await client.stopSessionWork(sessionIdOf(ref));
      return { raw };
    },

    // ── session ───────────────────────────────────────────────────────────

    /** 归档会话（DSH 挂在 workspace 命名空间下，但语义是「会话归档」）。 */
    async archiveSession(ref) {
      const raw = await client.workspace.archiveSession({ sessionId: sessionIdOf(ref) });
      return { raw };
    },

    /** 可用的 preset 清单（`agentPresets/list`）。 */
    async listPresets() {
      const response = await client.agentPresets.list({});
      const value = unwrap(response, 'agentPresets.list');
      return { presets: Array.isArray(value?.presets) ? value.presets : [], raw: response };
    },

    // ── rename ────────────────────────────────────────────────────────────

    /** 改会话标题。DSH 的 rename 只在 `callUnary` 上（旧 SDK 的 sessions 门面没有它）。 */
    async renameSession(ref, title) {
      const raw = await client.callUnary('session.rename', {
        sessionId: sessionIdOf(ref),
        title: String(title ?? ''),
      });
      return { raw };
    },

    // ── permission ────────────────────────────────────────────────────────

    /**
     * 改会话的权限预设：DSH 用 `/permission <preset>` 斜杠命令完成。
     *
     * 返回**已解包**的回执（`{ commandId, result: { kind, text } }`），`ok` 由桥接用
     * `permissionCommandSucceeded` 判定 —— 「这个回执算不算成功」是策略，不是平台能力。
     * 这里只负责把包装拆掉：判定函数吃的是解包值，让它再拆一层就变成两处都知道包长什么样。
     */
    async applyPermission(ref, preset) {
      requireCommands('applyPermission');
      const response = await client.commands.execute(sessionIdOf(ref), permissionCommand(preset));
      return { value: unwrap(response, 'commands.execute'), raw: response };
    },

    /**
     * 只读核对会话当前的权限预设（`/permission` 无参查询）。
     *
     * `preset` 解不出来时是空串，**不抛错**：调用方（外部漂移检测）要区分
     * 「读到了别的值」（真的被改了）与「读不出来」（格式变了/持续失败），
     * 后者要按 fail-closed 处理但日志理由不同。
     */
    async readPermission(ref) {
      requireCommands('readPermission');
      const response = await client.commands.execute(sessionIdOf(ref), PERMISSION_QUERY);
      const value = unwrap(response, 'commands.execute');
      const text = String(value?.result?.text ?? value?.text ?? '');
      const match = CURRENT_PRESET_RE.exec(text);
      return { preset: match ? match[1] : '', text, raw: response };
    },

    /**
     * 回执一个挂起的审批 / 提问。
     *
     * `ref` 是归一引用 `{ instance, sessionId, requestId }`；`decision` 由内核给：
     * 审批是 `allowed-once` / `rejected`，提问是 `{ answers }`。
     * DSH 回执需要 `clientId` + `eventId`，两者从挂起表取 —— 内核不持有平台键。
     * 包装成 `{ kind: 'result', value }` 是本平台的事。
     */
    async respondPermission(ref, decision) {
      const { sessionId, requestId } = normalizePermissionRef(ref, agentId);
      const waiting = approvals.get(requestId);
      if (!waiting) {
        throw new Error(`respondPermission: 没有挂起的请求 ${requestId}（连接已断开或已回执）`);
      }
      if (waiting.sessionId && waiting.sessionId !== sessionId) {
        throw new Error(`respondPermission: 请求 ${requestId} 属于会话 ${waiting.sessionId}，不是 ${sessionId}`);
      }
      const raw = await client.respond({
        clientId: waiting.clientId,
        eventId: waiting.eventId,
        outcome: { kind: 'result', value: decision },
      });
      approvals.delete(requestId);
      return { raw };
    },

    /** 权限预设目录（`qq-full-ask` 之类是否存在，决定 L3 能不能开）。 */
    async listPermissionPresets() {
      const response = await client.permissionPresets.catalog();
      const value = unwrap(response, 'permissionPresets.catalog');
      return {
        options: Array.isArray(value?.options) ? value.options : [],
        defaultPreset: String(value?.defaultPreset ?? ''),
        raw: response,
      };
    },

    // ── models ────────────────────────────────────────────────────────────

    /**
     * 模型目录。
     *
     * 先 `session/modelCatalog`，老版本回 `not found` 时回落 `session/models`。
     * **不能**用 `client.sessions.modelCatalog`：桥接钉住的 SDK 里 sessions 门面没有
     * 这个方法（只有已下线的 `models`），调用会抛 “is not a function”，让思考强度
     * 静默退回内置清单。
     */
    async listModels() {
      let raw;
      try {
        raw = await client.callUnary('session.modelCatalog', {});
      } catch (error) {
        const message = String(error?.message ?? error);
        if (!/not.?found|unknown|unsupported|404|invalid server-response/i.test(message)) throw error;
        raw = await client.callUnary('session.models', {});
      }
      // unwrap 放在回落判断**之外**：老版本“回了 not found”才回落，“回了 ok:false”
      // 是真故障，不能被当成版本差异吞掉。
      return { catalog: unwrap(raw, 'session.modelCatalog'), raw };
    },

    /** 给会话套模型（provider / model / reasoningEffort）。 */
    async selectModel(ref, params = {}) {
      const response = await client.sessions.selectModel({ sessionId: sessionIdOf(ref), ...params });
      const value = unwrap(response, 'session.selectModel');
      return { selected: value?.selected ?? null, raw: response };
    },

    // ── settings ──────────────────────────────────────────────────────────

    /**
     * 读设置。
     *
     * 不传 `ns` 时返回 describe 的**解包值**：桥接的模式同步要一次性读多个命名空间
     * （`agent-presets` / 模式后端自己的 ns），逐个查会多打几次 RPC，而它们本来就
     * 在同一次响应里。传 `ns` 时返回该命名空间对象或 `null`。
     */
    async readSettings(ns = '') {
      const response = await client.settings.describe({});
      const value = unwrap(response, 'settings.describe');
      const name = String(ns ?? '').trim();
      if (!name) return { value, raw: response };
      const namespaces = Array.isArray(value?.namespaces) ? value.namespaces : [];
      return { value: namespaces.find((n) => n?.ns === name) ?? null, raw: response };
    },

    /** 写设置（payload 形状是命名空间补丁表，由调用方拼）。 */
    async writeSettings(patch) {
      const response = await client.settings.update(patch ?? {});
      return { value: unwrap(response, 'settings.update'), raw: response };
    },

    // ── workspace ─────────────────────────────────────────────────────────

    /** 建（或取回）工作区；`created` 决定要不要顺手改名。 */
    async createWorkspace({ path: dir } = {}) {
      const response = await client.workspace.create({ path: dir });
      const value = unwrap(response, 'workspace.create');
      return {
        workspaceId: String(value?.workspace?.workspaceId ?? ''),
        created: value?.created === true,
        raw: response,
      };
    },

    /** 改工作区标题。 */
    async renameWorkspace({ workspaceId, title } = {}) {
      const raw = await client.workspace.rename({ workspaceId, title: String(title ?? '') });
      return { raw };
    },

    // ── compact ───────────────────────────────────────────────────────────

    /**
     * 压缩会话上下文（`/compact`）。
     *
     * `ok` 只看回执的 `kind`（缺省视为成功，DSH 老版本不回 kind）；失败原因在 `text`
     * 或 `kind` 里，桥接负责拼成给用户看的话术。
     */
    async compactSession(ref) {
      requireCommands('compactSession');
      const response = await client.commands.execute(sessionIdOf(ref), COMPACT_COMMAND);
      const value = unwrap(response, 'commands.execute');
      const kind = String(value?.result?.kind ?? '');
      const text = String(value?.result?.text ?? value?.text ?? '').trim();
      return { ok: !kind || kind === 'success', kind, text, raw: response };
    },
  };
}
