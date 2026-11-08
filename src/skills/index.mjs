// 技能清单（路线图 §9.2）：把「角色能用哪些技能」做成一份可注入的索引。
//
// 为什么需要独立模块：
// - 以前技能只出现在控制台「技能」页，AI 自己完全不知道有哪些技能可用；
// - 全量塞进提示词会随技能数量线性膨胀，所以这里只产出**固定行数**的清单（每条一行、总条目数与总字数双上限），
//   真正的 SKILL.md 全文由 AI 在需要时自己读——这也是 AstrBot SkillManager 的渐进式披露口径。
//
// 安全边界：只读扫描目录 + 只读 SKILL.md 前 600 字，不执行任何脚本、不跟随符号链接；
// 目录不存在、无权限、文件损坏都只跳过并记一条日志，绝不影响唤醒提示的其余部分。

const DEFAULT_HEAD_BYTES = 600;

/** 解析 SKILL.md 开头几行的 frontmatter 字段（name / description）。 */
export function parseSkillHead(head) {
  const field = (raw) => String(raw ?? '').trim().replace(/^["']|["']$/g, '');
  return {
    name: field(String(head ?? '').match(/^name:\s*(.+)$/m)?.[1]),
    description: field(String(head ?? '').match(/^description:\s*(.+)$/m)?.[1]),
  };
}

/** 一条技能在提示词里的单行文本；描述按字数截断，避免一条描述吃掉整块预算。 */
export function formatSkillLine(entry, { maxDescriptionChars = 40 } = {}) {
  const name = String(entry?.name ?? entry?.id ?? '').trim();
  if (!name) return '';
  const description = String(entry?.description ?? '').replace(/\s+/g, ' ').trim();
  if (!description) return `- ${name}`;
  const clipped = description.length > maxDescriptionChars
    ? `${description.slice(0, Math.max(1, maxDescriptionChars - 1))}…`
    : description;
  return `- ${name}：${clipped}`;
}

/**
 * @param {object} opts
 * @param {string[]} opts.roots 技能根目录，按优先级排列（同名技能取第一个）
 * @param {Array<{dir:string,source?:string,editable?:boolean}>} [opts.rootMeta] 每个根目录的来源/可编辑元数据
 * @param {() => Array<object>} [opts.extraSkills] 额外技能（用户目录；active=false 的不注入）
 * @param {number} [opts.maxEntries] 最多列几条（默认 12）
 * @param {number} [opts.maxDescriptionChars] 每条描述最多几个字（默认 40）
 * @param {number} [opts.ttlMs] 扫描结果缓存时长（默认 60s；技能目录变化不频繁，避免每轮唤醒都读盘）
 * @param {object} [opts.fs] 注入 fs（测试用）：readdirSync / readFileSync / statSync
 * @param {() => number} [opts.now]
 */
export function createSkillIndex({
  roots = [],
  rootMeta = [],
  extraSkills = null,
  maxEntries = 12,
  maxDescriptionChars = 40,
  ttlMs = 60000,
  headBytes = DEFAULT_HEAD_BYTES,
  fs,
  now = Date.now,
  log = () => {},
} = {}) {
  if (!fs) throw new Error('createSkillIndex 需要注入 fs（readdirSync / readFileSync）');
  let cache = null; // { at, entries }

  function scan() {
    const entries = [];
    const seen = new Set();
    // 用户管理的技能优先于所有只读来源；同名时只保留优先级最高的一个，并在 UI 标注来源。
    if (typeof extraSkills === 'function') {
      let extra = [];
      try {
        extra = extraSkills() ?? [];
      } catch (error) {
        log(`⚠️ 外部技能清单读取失败，本次按空处理：${error?.message ?? error}`);
      }
      for (const item of Array.isArray(extra) ? extra : []) {
        const id = String(item?.id ?? '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        entries.push({
          id,
          name: String(item?.name ?? id),
          description: String(item?.description ?? ''),
          dir: String(item?.path ?? item?.dir ?? ''),
          source: String(item?.source ?? 'user'),
          editable: item?.editable !== false,
          active: item?.active !== false,
        });
      }
    }
    for (const root of roots) {
      const dir = String(root ?? '').trim();
      if (!dir) continue;
      const meta = rootMeta.find((entry) => String(entry?.dir ?? '') === dir) ?? {};
      let names = [];
      try {
        names = fs.readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink?.())
          .map((entry) => entry.name)
          .sort();
      } catch {
        continue; // 目录不存在 / 无权限：跳过即可，不打扰主链
      }
      for (const name of names) {
        const skillDir = `${dir}\\${name}`.replace(/\\/g, '/');
        let head = '';
        try {
          head = String(fs.readFileSync(`${skillDir}/SKILL.md`, 'utf8')).slice(0, headBytes);
        } catch {
          continue; // 没有 SKILL.md 的目录不算技能
        }
        const parsed = parseSkillHead(head);
        const id = name;
        if (seen.has(id)) continue; // 同名只认优先级更高的那个根
        seen.add(id);
        entries.push({
          id,
          name: parsed.name || id,
          description: parsed.description,
          dir: skillDir,
          source: String(meta.source ?? 'builtin'),
          editable: meta.editable === true,
          active: true,
        });
      }
    }
    return entries;
  }

  function list({ includeInactive = false } = {}) {
    const at = now();
    if (!cache || at - cache.at >= ttlMs) {
      try {
        cache = { at, entries: scan() };
      } catch (error) {
        log(`⚠️ 技能索引扫描失败，本次按空清单处理：${error?.message ?? error}`);
        cache = { at, entries: [] };
      }
    }
    return includeInactive ? cache.entries : cache.entries.filter((entry) => entry.active !== false);
  }

  /**
   * 生成注入块文本。行数有上限（标题 1 行 + maxEntries 行 + 溢出提示 1 行），字数再兜一层。
   * 返回空串表示「没有可用技能」，调用方据此整块跳过。
   */
  function render({ maxChars = 1200, limit = maxEntries, ids = null } = {}) {
    const only = Array.isArray(ids) ? new Set(ids) : null;
    const entries = list().filter((entry) => !only || only.has(entry.id));
    if (!entries.length) return '';
    const budget = Number(maxChars) > 0 ? Number(maxChars) : 1200;
    const cap = Number.isInteger(limit) && limit > 0 ? limit : maxEntries;
    const header = '可用技能（需要时用文件工具读对应 SKILL.md 看全文，不要凭名字猜）：';
    if (header.length >= budget) return '';
    const lines = [];
    let used = header.length + 1; // 换行也算预算，宁可少一句也不要让块被外层硬截
    let dropped = 0;
    for (const entry of entries) {
      if (lines.length >= cap) { dropped += 1; continue; }
      const line = formatSkillLine(entry, { maxDescriptionChars });
      if (!line) continue;
      if (used + line.length + 1 > budget) { dropped += 1; continue; }
      lines.push(line);
      used += line.length + 1;
    }
    if (!lines.length) return '';
    const tail = dropped > 0 ? `- 另有 ${dropped} 个技能未列出（见控制台「技能」页）` : '';
    return [header, ...lines, ...(tail ? [tail] : [])].join('\n');
  }

  function status() {
    const entries = list({ includeInactive: true });
    return {
      roots: roots.filter(Boolean),
      count: entries.filter((entry) => entry.active !== false).length,
      entries: entries.map(({ id, name, dir, source, editable, active }) => ({ id, name, dir, source, editable, active })),
    };
  }

  function invalidate() { cache = null; }

  return { list, render, status, invalidate };
}
