// 会话级配置（`continuity.*`）的唯一读取入口。
//
// 0.2.0 把社交模型的容器词从「群」改成中立的「会话」：配置键也随之变成
// `continuity.conversations.<会话 id>`。旧键 `continuity.groups` 仍然可读 ——
// 它出现在已经发出去的 config.json 里，改名不能让老部署静默丢掉「不记录」「更严的共享档」
// 这类**安全相关**设置，所以这里是双读，不是改名 + 迁移。
//
// 双读只允许出现在这一个文件里。到处各写一遍 `conversations ?? groups` 迟早会漂移成
// 「有的路径读新键、有的路径读旧键」，而这类配置一旦漏读就是静默放宽记录边界。
//
// 注意这一层只管**配置**；会话本身的地址（`qq:group:123`）在 src/session/key.mjs，
// 它的第二段是会话类型 `group`，属于 key 的文法，不是社交模型的容器词汇。

/** 合并新旧两个键：新键逐条覆盖旧键（同一条会话两边都写了，以新键为准）。 */
export function conversationConfigs(continuityCfg = {}) {
  const legacy = continuityCfg?.groups;
  const current = continuityCfg?.conversations;
  const hasLegacy = legacy && typeof legacy === 'object' && !Array.isArray(legacy);
  const hasCurrent = current && typeof current === 'object' && !Array.isArray(current);
  if (!hasCurrent) return hasLegacy ? legacy : {};
  if (!hasLegacy) return current;
  return { ...legacy, ...current };
}

/** 某个会话的配置项；没有配置返回空对象（不是 null —— 调用方一律按默认值语义处理）。 */
export function conversationConfig(continuityCfg, conversationId) {
  const id = String(conversationId ?? '').trim();
  if (!id) return {};
  const one = conversationConfigs(continuityCfg)[id];
  return one && typeof one === 'object' && !Array.isArray(one) ? one : {};
}

/**
 * 这个会话是否允许被记录（进人物库、被别的会话看见）。
 * `recordable: false` 是**唯一**的关闭方式：缺省、写错类型、写成字符串 'false' 都算允许，
 * 因为配置项写坏时应当退回「按默认行为走」，而不是悄悄关掉记录。
 */
export function conversationRecordable(continuityCfg, conversationId) {
  return conversationConfig(continuityCfg, conversationId).recordable !== false;
}
