// 平台提示词的组装：DSH 预设负责安全与工具边界，平台补充（说话场景、礼仪）
// 由能力预设携带，安装时拼进 persona.prefix。
//
// 这样同一个能力可以换平台、同一个平台可以换能力，而不用复制整段人格正文。
// 值为空时等价于没接这一层（逐字节不改变生成结果）。
const VAR_RE = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

export const DEFAULT_PROMPT_VARS = Object.freeze({
  platform: 'QQ',
  displayName: 'QQ',
  owner: '管理员',
});

/** 渲染 {platform} 这类占位符；未知占位符原样保留，方便作者发现拼错。 */
export function renderPlatformPrompt(template, vars = {}) {
  const text = String(template ?? '');
  if (!text) return '';
  const merged = { ...DEFAULT_PROMPT_VARS, ...(vars ?? {}) };
  return text.replace(VAR_RE, (match, name) => (
    Object.prototype.hasOwnProperty.call(merged, name) ? String(merged[name]) : match
  ));
}

/** 把平台补充接在预设正文后面；空串/空白不接。 */
export function appendPlatformPrompt(prefix, platformText) {
  const base = String(prefix ?? '');
  const extra = String(platformText ?? '').trim();
  if (!extra) return base;
  return base ? `${base.replace(/\s+$/, '')}\n\n${extra}` : extra;
}

/** 在 agent.cordis.yml 的行列表上拼平台提示词：只动 persona 行的 config.prefix。 */
export function composeRows(rows, { platformText = '', vars = {} } = {}) {
  const text = renderPlatformPrompt(platformText, vars);
  if (!text.trim()) return rows;
  let touched = false;
  const next = rows.map((row) => {
    if (touched || row?.id !== 'persona') return row;
    const config = row.config ?? {};
    touched = true;
    return { ...row, config: { ...config, prefix: appendPlatformPrompt(config.prefix, text) } };
  });
  return touched ? next : rows;
}

/** 从 config.json 读某个能力预设的平台提示词（读不到就当没有）。 */
export function readPlatformPromptFromConfig(config, presetId) {
  const prompt = config?.capabilities?.[presetId]?.prompt?.personaPrefix;
  return typeof prompt === 'string' ? prompt : '';
}
