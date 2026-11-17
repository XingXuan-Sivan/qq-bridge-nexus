// 中立消息段（docs/PLATFORM_DECOUPLING.md §3.4）。
//
// 内核只构造这 11 种段，「怎么变成某个平台的报文」由该平台的传输实现负责。
// 降级只看 capabilities，不看平台名 —— 这是发送收口的验收点：换平台时行为自动
// 正确，内核里不会长出 `if (platform === 'qq')`。
//
// 入参同时接受中立写法与 OneBot 写法（`at` / `record` 是 QQ 的历史名，出现在
// 既有发送路径上），出口统一成中立名；适配器再把中立名映射回自己的报文。
//
// 为什么降级策略必须写在这里而不是各适配器里：同一个段在 A 平台能发、在 B 平台
// 只能降级，这个判断如果各写一份，口径迟早会漂移；而且插件能注册 transport，
// 让插件自己决定降级等于让它扩大能力。

/** 内核认识的全部段类型（顺序即文档表格顺序）。 */
export const SEGMENT_TYPES = Object.freeze([
  'text', 'mention', 'reply', 'image', 'voice', 'video', 'file', 'sticker', 'forward', 'poke', 'ext',
]);

/** 平台侧历史名 → 中立名。 */
const NEUTRAL_ALIASES = Object.freeze({ at: 'mention', record: 'voice' });

/** 段类型 → 需要的能力名。能力名与平台声明用同一套词，缺省即「没有这项能力」。 */
const CAPABILITY_OF = Object.freeze({
  text: null,          // 文本是底线能力，任何平台都有
  mention: 'mention',
  reply: 'reply',
  image: 'image',
  voice: 'voice',
  video: 'video',
  file: 'file',
  sticker: 'sticker',
  forward: 'forward',
  poke: 'poke',
  ext: 'ext',
});

/**
 * 某个段需要哪项能力（`null` = 文本，任何平台都有）。
 *
 * 注册表用它在「声明了哪些能力」与「内核认识的段」之间求交，算出平台详情页那句
 * 「能发什么 / 不支持什么」——不在控制台另维一份段与能力的对应表。
 */
export function segmentCapability(type) {
  return CAPABILITY_OF[String(type ?? '')] ?? null;
}

/**
 * 缺能力时的文本替身。
 * `null` = 直接丢掉（引用没有文本语义）；数组 = 一条或多条文本段。
 */
const DEGRADE_TEXT = Object.freeze({
  mention: '@{target}',
  reply: null,
  image: '[图片]',
  voice: '[语音]',
  video: '[视频]',
  file: '[文件]',
  sticker: '[表情]',
  forward: '[合并转发]',
});

/** 带错误码的段错误：调用方按 code 分流（能力缺失 vs 结构非法）。 */
export function segmentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireField(value, label, type) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (!text) {
    throw segmentError('invalid_segment', `${type} 段缺少 ${label}`);
  }
  return text;
}

function optionalField(value) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text || '';
}

/** 类型归一：`at` → `mention`、`record` → `voice`；未知类型抛错。 */
export function neutralType(type) {
  const raw = String(type ?? '').trim().toLowerCase();
  const mapped = NEUTRAL_ALIASES[raw] ?? raw;
  if (!SEGMENT_TYPES.includes(mapped)) {
    throw segmentError('unsupported_segment', `未知消息段类型：${raw || '(空)'}`);
  }
  return mapped;
}

/**
 * 归一单段：`{ type, data }` 与扁平写法都收，出口是 `{ type, data }`（中立名）。
 *
 * 只做形状规范化，不做能力判断 —— 能力判断在 degradeSegments 里，两件事分开
 * 才能在「结构非法」与「能力缺失」之间给出不同的错误码。
 */
export function normalizeSegment(segment) {
  if (!segment || typeof segment !== 'object' || Array.isArray(segment)) {
    throw segmentError('invalid_segment', '消息段必须是对象');
  }
  const type = neutralType(segment.type);
  // 既接受 { type, data:{...} }，也接受 { type, ...字段 }（后者手写插件常用）。
  const data = segment.data && typeof segment.data === 'object' && !Array.isArray(segment.data)
    ? segment.data
    : segment;

  switch (type) {
    case 'text': {
      const text = segment.data ? data.text : segment.text;
      return { type, data: { text: text === null || text === undefined ? '' : String(text) } };
    }
    case 'mention':
      return { type, data: { target: requireField(data.target ?? data.qq, 'target', type) } };
    case 'reply':
      return { type, data: { messageId: requireField(data.messageId ?? data.id, 'messageId', type) } };
    case 'image':
    case 'voice':
    case 'video':
    case 'file': {
      const file = optionalField(data.file);
      const url = optionalField(data.url);
      if (!file && !url) throw segmentError('invalid_segment', `${type} 段必须有 file 或 url`);
      const out = { ...(file ? { file } : {}), ...(url ? { url } : {}) };
      const name = optionalField(data.name);
      if (name) out.name = name;
      return { type, data: out };
    }
    case 'sticker': {
      const id = optionalField(data.id);
      const url = optionalField(data.url);
      if (!id && !url) throw segmentError('invalid_segment', 'sticker 段必须有 id 或 url');
      return { type, data: { ...(id ? { id } : {}), ...(url ? { url } : {}) } };
    }
    case 'forward': {
      const id = optionalField(data.id);
      const messages = Array.isArray(data.messages) ? data.messages : null;
      if (!id && !messages) throw segmentError('invalid_segment', 'forward 段必须有 id 或 messages');
      return { type, data: { ...(id ? { id } : {}), ...(messages ? { messages } : {}) } };
    }
    case 'poke':
      return { type, data: { target: requireField(data.target, 'target', type) } };
    case 'ext':
      return {
        type,
        data: {
          platform: requireField(data.platform, 'platform', type),
          kind: requireField(data.kind, 'kind', type),
          data: data.data ?? null,
        },
      };
    default:
      throw segmentError('unsupported_segment', `未知消息段类型：${type}`);
  }
}

/** 归一一组段（保持顺序）；不是数组时抛错。 */
export function normalizeSegments(segments) {
  if (!Array.isArray(segments)) throw segmentError('invalid_segment', '消息段必须是数组');
  return segments.map((segment) => normalizeSegment(segment));
}

/**
 * 按能力降级：返回 `{ segments, degraded }`。
 *
 * 规则（与 §3.4 表格一一对应）：
 *   · 有能力 → 原样保留；
 *   · 无能力且有文本替身 → 换成一条 text 段，记一次 degraded；
 *   · 无能力且不许降级（poke / ext）→ **抛错**，不静默丢弃。
 *     拍一拍降级成「拍了拍你」会误伤群友；ext 是平台私有报文，别的平台拿到只能算编译错误。
 */
export function degradeSegments(segments, capabilities = []) {
  const list = normalizeSegments(segments);
  const caps = new Set((capabilities ?? []).map((item) => String(item ?? '').trim().toLowerCase()).filter(Boolean));
  const out = [];
  const degraded = [];

  for (const segment of list) {
    const capability = CAPABILITY_OF[segment.type];
    const supported = capability === null || caps.has(capability);
    if (supported) {
      out.push(segment);
      continue;
    }
    if (segment.type === 'poke') {
      throw segmentError('capability_unsupported', `当前平台不支持 poke（拍一拍），不能降级为文本`);
    }
    if (segment.type === 'ext') {
      throw segmentError('unsupported_segment', `ext 段只能发给 ${segment.data.platform}，当前平台不支持`);
    }
    const template = DEGRADE_TEXT[segment.type];
    if (template === null) {
      degraded.push({ type: segment.type, reason: `capability_unsupported:${capability}` });
      continue;
    }
    if (typeof template === 'string') {
      const text = template.replace('{target}', segment.data.target ?? '');
      out.push({ type: 'text', data: { text } });
      degraded.push({ type: segment.type, reason: `capability_unsupported:${capability}` });
      continue;
    }
    throw segmentError('capability_unsupported', `无法降级的段类型：${segment.type}`);
  }

  return { segments: out, degraded };
}

/** 段数组 → 纯文本（日志、回填、事件 message.text 用）。 */
export function segmentsToText(segments = []) {
  const parts = [];
  for (const segment of normalizeSegments(segments)) {
    switch (segment.type) {
      case 'text': parts.push(segment.data.text); break;
      case 'mention': parts.push(`@${segment.data.target}`); break;
      case 'reply': break;
      case 'image': parts.push('[图片]'); break;
      case 'voice': parts.push('[语音]'); break;
      case 'video': parts.push('[视频]'); break;
      case 'file': parts.push(`[文件${segment.data.name ? `:${segment.data.name}` : ''}]`); break;
      case 'sticker': parts.push('[表情]'); break;
      case 'forward': parts.push('[合并转发]'); break;
      case 'poke': parts.push('[拍一拍]'); break;
      case 'ext': parts.push(`[${segment.data.kind}]`); break;
      default: break;
    }
  }
  return parts.join('');
}
