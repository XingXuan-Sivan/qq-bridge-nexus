// Only the model-facing view is compacted. Stored messages and console/API data
// retain the original fields for display, media retrieval and troubleshooting.
const DEFAULT_FALSE_FIELDS = new Set([
  'quoteTargetIsSelf', 'isSelf', 'hasMedia', 'hasForward'
]);
const OPTIONAL_FIELDS = new Set([
  'seq', 'messageId', 'sender', 'userId', 'text', 'plain', 'tail', 'kind',
  'role', 'media', 'forwardIds', 'nestedForwardIds'
]);

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isEmpty(value) {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

function compactMedia(media, canResolveByMessage) {
  return media.map((item, index) => {
    if (!isRecord(item)) return item;
    const result = { ...item };
    // A local seq is a bridge message handle accepted by qq_get_message_images.
    // Forwarded nodes only have messageSeq, and may not be locally resolvable:
    // keep their transport references, even when they happen to have messageId.
    if (canResolveByMessage) {
      delete result.file;
      delete result.url;
      // Match the image tool's one-based ordering; never filter/reorder items.
      if (result.index == null) result.index = index + 1;
    } else if (result.file === result.url) {
      delete result.file;
    }
    for (const key of ['file', 'url', 'faceId']) {
      if (isEmpty(result[key])) delete result[key];
    }
    return result;
  });
}

export function compactModelMessage(message) {
  if (!isRecord(message)) return message;
  const result = { ...message };
  // 身份只有一个字段：role（owner/admin/member）。isOwner/isAdmin/ownerLabel 是旧字段，
  // 存量消息若只有 isOwner，这里映射一次 role，之后模型只按 role 判断。
  if (!result.role && message.isOwner === true) result.role = 'owner';
  delete result.isOwner;
  delete result.isAdmin;
  delete result.ownerLabel;
  // No trimming or truncation: differing plain text can contain resolved quote
  // context, and tail can carry the end of a long message absent from text.
  const seenText = new Set();
  for (const key of ['text', 'plain', 'tail']) {
    if (typeof result[key] !== 'string') continue;
    if (seenText.has(result[key])) delete result[key];
    else seenText.add(result[key]);
  }
  for (const key of OPTIONAL_FIELDS) {
    if (isEmpty(result[key])) delete result[key];
  }
  for (const key of DEFAULT_FALSE_FIELDS) {
    if (result[key] === false) delete result[key];
  }
  if (Array.isArray(result.media)) {
    const canResolveByMessage = Number.isSafeInteger(message.seq) && message.seq > 0;
    result.media = compactMedia(result.media, canResolveByMessage);
  }
  return result;
}

export function compactModelData(data) {
  if (Array.isArray(data)) return data.map(compactModelData);
  if (!isRecord(data)) return data;
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key,
    (key === 'messages' || key === 'newMessages') && Array.isArray(value)
      ? value.map(compactModelMessage)
      : compactModelData(value)
  ]));
}

export function serializeModelData(data) {
  return JSON.stringify(compactModelData(data));
}
