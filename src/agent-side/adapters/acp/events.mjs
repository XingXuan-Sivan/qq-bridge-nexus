// ACP 的 `session/update` → 归一事件（`AGENT_EVENT_KINDS`）。
//
// 单开一个文件而不是塞进 port.mjs：这里全是**判别值表的翻译**，纯函数、无状态，可以单独
// 钉住；port.mjs 已经要管会话快照、受理制与权限挂起表，再混进来就只能整体测。
//
// 三条约定：
//   1. 不认识的判别值**不猜也不丢**：翻成 `notice`（`notice: 'unknown-update'`），让内核
//      看得见「Agent 说了一件我们不认识的事」。静默丢弃会在换 Agent 实现时表现为
//      「它不回话」，那是最难查的一类故障；
//   2. `user_message_chunk` 是明确的丢弃项：那是桥接自己发出去的回声，内核不需要；
//   3. 只认 v1 的判别值。v2 的 `agent_message` / `state_update` 是另一套（PLATFORM_UNIFICATION
//      §9.1），两套混用会得到「有的 chunk 进来了、有的静默消失」的假象。

/**
 * v1 的 `sessionUpdate` 判别值 → 归一 kind。
 * 空串 = **确定丢弃**（与「不认识」区分开：后者要发 notice）。
 */
export const UPDATE_KINDS = Object.freeze({
  agent_message_chunk: 'text',
  agent_thought_chunk: 'reasoning',
  tool_call: 'tool',
  tool_call_update: 'tool',
  plan: 'plan',
  current_mode_update: 'notice',
  available_commands_update: 'notice',
  session_info_update: 'notice',
  user_message_chunk: '',
});

/** 工具调用的两个阶段：ACP 用 `status` 表达，内核只关心「开始 / 结束」。 */
const TOOL_START = Object.freeze(['pending', 'in_progress']);
const TOOL_END = Object.freeze(['completed', 'failed']);

/** 摘要截断：工具内容可能是一整份文件 diff，日志与事件里不该带全文。 */
const SUMMARY_LIMIT = 400;

const trim = (value) => String(value ?? '').trim();

/** 从内容块里取纯文本（ACP 的 `content` 是 `{type:'text',text}` 或数组）。 */
function textOf(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(textOf).join('');
  if (content.type === 'text') return String(content.text ?? '');
  return '';
}

/**
 * 工具调用的摘要。
 *
 * ACP 的 `content` 是 `[{type:'content'|'diff'|'terminal', …}]`，桥接只需要一行能读的话；
 * diff 带上路径就够（正文太长且可能含敏感内容），终端带上 id。
 */
function summaryOf(content) {
  if (!Array.isArray(content)) return textOf(content).slice(0, SUMMARY_LIMIT);
  const parts = [];
  for (const item of content) {
    const type = String(item?.type ?? '');
    if (type === 'content') parts.push(textOf(item.content));
    else if (type === 'diff') parts.push(`diff ${trim(item.path)}`.trim());
    else if (type === 'terminal') parts.push(`终端 ${trim(item.terminalId)}`.trim());
    else parts.push(textOf(item));
  }
  return parts.filter(Boolean).join('\n').slice(0, SUMMARY_LIMIT);
}

/**
 * 一条 `session/update` → 一条归一事件（或 `null` 表示确定丢弃）。
 *
 * @param {string} sessionId
 * @param {object} update  `session/update` 的 `params.update`
 * @returns {object|null}
 */
export function mapSessionUpdate(sessionId, update) {
  const raw = update && typeof update === 'object' ? update : null;
  if (!raw) return null;
  const name = String(raw.sessionUpdate ?? '');
  const known = Object.prototype.hasOwnProperty.call(UPDATE_KINDS, name);
  const kind = known ? UPDATE_KINDS[name] : 'notice';
  if (known && kind === '') return null;

  if (!known) {
    return { kind: 'notice', sessionId, notice: 'unknown-update', sessionUpdate: name, payload: raw };
  }

  switch (kind) {
    case 'text':
    case 'reasoning':
      return { kind, sessionId, delta: textOf(raw.content) };
    case 'tool': {
      const status = trim(raw.status);
      const phase = TOOL_START.includes(status) ? 'start' : (TOOL_END.includes(status) ? 'end' : 'update');
      return {
        kind: 'tool',
        sessionId,
        callId: trim(raw.toolCallId),
        name: trim(raw.title ?? raw.kind),
        toolKind: trim(raw.kind),
        phase,
        status,
        summary: summaryOf(raw.content),
      };
    }
    case 'plan':
      return {
        kind: 'plan',
        sessionId,
        entries: (Array.isArray(raw.entries) ? raw.entries : []).map((entry) => ({
          content: trim(entry?.content),
          priority: trim(entry?.priority),
          status: trim(entry?.status),
        })),
      };
    default: {
      // notice 三种：模式变了 / 命令清单变了 / 会话信息变了。原始载荷照带，
      // 内核要展示细节时不必回头再问 Agent（那会多打一次 RPC）。
      const event = { kind: 'notice', sessionId, notice: name, payload: raw };
      if (name === 'current_mode_update') event.modeId = trim(raw.currentModeId);
      if (name === 'session_info_update') event.title = trim(raw.title);
      return event;
    }
  }
}

/**
 * 反向请求 `session/request_permission` → `kind: 'permission'` 事件。
 *
 * 这不是 `session/update`：它是一条**独立的 JSON-RPC 请求**，必须由内核决策后回执
 * （见 port.mjs 的挂起表）。`requestId` 就是 JSON-RPC 的 id —— 回执按它找挂起项。
 *
 * §5.3 规则 2：`allow_always` 的 `optionId` 照实报给内核，但**不会**被选用（见
 * port.mjs 的 `outcomeFor`）：让 Agent 记住授权，桥接就无法审计回收。
 */
export function mapPermissionRequest(requestId, params) {
  const toolCall = params?.toolCall ?? {};
  return {
    kind: 'permission',
    sessionId: trim(params?.sessionId),
    requestId: trim(requestId),
    callId: trim(toolCall.toolCallId),
    name: trim(toolCall.title ?? toolCall.kind),
    toolKind: trim(toolCall.kind),
    options: (Array.isArray(params?.options) ? params.options : []).map((option) => ({
      optionId: trim(option?.optionId),
      name: trim(option?.name ?? option?.optionId),
      kind: trim(option?.kind),
    })),
  };
}
