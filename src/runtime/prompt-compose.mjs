// 平台提示词的渲染：`profiles/platforms/<id>/prompt.md` 里的 {platform} / {displayName} /
// {owner} 占位符→平台实际取值。
//
// 平台话术只在运行期注入（bridge.js 的 core-platform-prompt 块）：构建期再拼一次
// 会让同一段规则进两次会话。这里只做纯渲染，不读配置、不改行列表。
const VAR_RE = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

// 变量来源：profiles/platforms/<id>/platform.yml 的 vars 是唯一声源；
// 插件经 adapters:provide 注册的同 id 适配器可以覆盖它。
// 这里只留与平台无关的默认值：缺 {platform}/{displayName} 时占位符原样保留，
// 作者能一眼看到，而不是被悄悄渲染成某一个具体平台名。
export const DEFAULT_PROMPT_VARS = Object.freeze({
  owner: '管理员',
});

/**
 * 允许出现在提示词里的变量键。
 *
 * 声明面（platform.yml 的 vars）与插件适配器的 vars 共用这一份白名单：两边各自加键
 * 就会出现「某条路径渲染了、另一条没渲染」的分歧，而这种分歧只在换平台时才看得见。
 */
export const PROMPT_VAR_KEYS = Object.freeze(['platform', 'displayName', 'owner']);

/** 按白名单裁剪变量：非对象给空表，空值/非字符串丢掉，超长截断（与配置字段同一口径）。 */
export function normalizePromptVars(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const key of PROMPT_VAR_KEYS) {
    const value = String(raw[key] ?? '').trim().slice(0, 200);
    if (value) out[key] = value;
  }
  return out;
}

/** 渲染 {platform} 这类占位符；未知占位符原样保留，方便作者发现拼错。 */
export function renderPlatformPrompt(template, vars = {}) {
  const text = String(template ?? '');
  if (!text) return '';
  const merged = { ...DEFAULT_PROMPT_VARS, ...(vars ?? {}) };
  return text.replace(VAR_RE, (match, name) => (
    Object.prototype.hasOwnProperty.call(merged, name) ? String(merged[name]) : match
  ));
}
