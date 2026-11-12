// 全局配置：行为档案（behavior profiles）。
//
// 行为档案描述“这个平台里怎么说话/怎么等待”，不描述运行模式、模型、准入或安全上限。
// 权威源：profiles/platforms/<platform>/behaviors/<id>.yml（用户侧平台自己提供），
// 由 profiles/plans/<id>.yml 的 `behavior` 字段引用。缺失或 kind 不匹配一律失败关闭。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { REPO_ROOT } from '../profiles/paths.mjs';

// 行为类型 = profiles/platforms/<platform>/behavior-types/<kind>.yml 的 id；
// 旧档案里的 `v1`/`v2` 仍按引擎别名接受（迁移期兜底）。校验与默认值由引擎模块负责。
const ENGINE_BY_KIND = { 'social-v1': 'v1', 'social-v2': 'v2', v1: 'v1', v2: 'v2' };
export const BEHAVIOR_KINDS = Object.keys(ENGINE_BY_KIND);

/** kind → 引擎名；未知类型返回 ''，调用方据此报错。 */
export function engineOfKind(kind) {
  return ENGINE_BY_KIND[String(kind ?? '').trim()] ?? '';
}
const TOP_KEYS = new Set(['version', 'platform', 'kind', 'label', 'description', 'prompt', 'config']);
const PROMPT_MAX = 20000;
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) throw new Error(`${label} 必须是对象`);
  return value;
}

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} 必须是有限数字`);
}

function walkNumbers(value, label) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} 含非法数字`);
    return;
  }
  if (typeof value === 'boolean' || typeof value === 'string') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkNumbers(item, `${label}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) walkNumbers(item, `${label}.${key}`);
    return;
  }
  throw new Error(`${label} 含不支持的值类型`);
}

/** 校验单个行为档案。id 来自文件名，必须与内容分离。 */
export function normalizeBehavior(id, raw) {
  const value = String(id ?? '').trim();
  if (!ID_RE.test(value)) throw new Error(`行为档案 id 不合法：${value || '(空)'}`);
  const source = assertPlainObject(raw, `${value} 行为档案`);
  for (const key of Object.keys(source)) {
    if (!TOP_KEYS.has(key)) throw new Error(`${value} 含未知顶层字段：${key}`);
  }
  const version = Number(source.version);
  if (!Number.isInteger(version) || version < 1) throw new Error(`${value}.version 必须是正整数`);
  const platform = String(source.platform ?? '').trim();
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(platform)) throw new Error(`${value}.platform 不合法：${platform || '(空)'}`);
  const kind = String(source.kind ?? '').trim();
  const engine = engineOfKind(kind);
  if (!engine) throw new Error(`${value}.kind 未注册：${kind || '(空)'}（在 behavior-types/ 里加类型）`);
  const label = String(source.label ?? '').trim();
  if (!label) throw new Error(`${value}.label 不能为空`);
  const description = String(source.description ?? '').trim();
  const config = assertPlainObject(source.config, `${value}.config`);
  for (const otherKey of ['v1', 'v2']) {
    if (otherKey !== engine && source[otherKey] !== undefined) throw new Error(`${value} 是 ${kind} 档案，旧版 ${otherKey} 段已废弃，请写进 config`);
  }
  walkNumbers(config, `${value}.config`);
  const prompt = String(source.prompt ?? '').trim();
  if (prompt.length > PROMPT_MAX) throw new Error(`${value}.prompt 超过 ${PROMPT_MAX} 字`);
  return { id: value, version, platform, kind, label, description, prompt, config };
}

/** 读取 config/behaviors 下所有 .yml 档案；任何损坏都让启动失败。 */
export function loadBehaviorProfiles({ root, log = () => {} } = {}) {
  const dir = root;
  if (!fs.existsSync(dir)) throw new Error(`行为档案目录不存在：${dir}`);
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) throw new Error(`行为档案目录为空：${dir}`);
  const map = new Map();
  for (const file of files) {
    const id = file.replace(/\.ya?ml$/i, '');
    const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/^\uFEFF/, '');
    let raw;
    try {
      raw = YAML.parse(text);
    } catch (error) {
      throw new Error(`行为档案 ${file} YAML 解析失败：${error?.message ?? error}`);
    }
    map.set(id, normalizeBehavior(id, raw));
  }
  log(`行为档案已加载：${[...map.keys()].join('、')}`);
  return map;
}

/** 按方案引用解析行为档案；缺失直接报错，不猜测默认值。 */
export function resolveBehavior(behaviors, behaviorId) {
  const id = String(behaviorId ?? '').trim();
  if (!id) throw new Error('缺少 behavior（行为档案）引用');
  const behavior = behaviors?.get?.(id);
  if (!behavior) throw new Error(`行为档案不存在：${id}`);
  return behavior;
}

function behaviorFile(root, id) {
  const value = String(id ?? '').trim();
  if (!ID_RE.test(value)) throw new Error(`behavior id 不合法：${value}`);
  return path.join(root, `${value}.yml`);
}

export function listBehaviorFiles({ root } = {}) {
  if (!fs.existsSync(root)) throw new Error(`行为档案目录不存在：${root}`);
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => {
      const id = entry.name.replace(/\.ya?ml$/i, '');
      const text = fs.readFileSync(path.join(root, entry.name), 'utf8').replace(/^\uFEFF/, '');
      let parsed = null;
      try { parsed = normalizeBehavior(id, YAML.parse(text)); } catch {}
      return { id, file: entry.name, label: parsed?.label ?? '', kind: parsed?.kind ?? '', valid: !!parsed };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function readBehaviorFile({ root, id } = {}) {
  const file = behaviorFile(root, id);
  if (!fs.existsSync(file)) throw new Error(`行为档案不存在：${id}`);
  return { id: String(id), text: fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') };
}

/** 把文件开头的注释块（# …）原样留下，序列化时只重写 YAML 主体。 */
function splitHeader(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  let index = 0;
  while (index < lines.length && (/^\s*#/.test(lines[index]) || lines[index].trim() === '')) index += 1;
  const header = lines.slice(0, index).join('\n').replace(/\s+$/, '');
  return { header, body: lines.slice(index).join('\n') };
}

function behaviorDocumentText(header, data) {
  const body = YAML.stringify({
    version: data.version,
    platform: data.platform,
    kind: data.kind,
    label: data.label,
    description: data.description ?? '',
    ...(data.prompt ? { prompt: data.prompt } : {}),
    config: data.config,
  }, { lineWidth: 0, aliasDuplicateObjects: false, singleQuote: true }).replace(/\n+$/, '');
  const head = String(header ?? '').replace(/\s+$/, '');
  return `${head ? `${head}\n\n` : ''}${body}\n`;
}

/** 结构化读：给控制台表单用。保留原文与头部注释，避免表单保存吃掉注释。 */
export function readBehaviorDocument({ root, id } = {}) {
  const { text } = readBehaviorFile({ root, id });
  const { header } = splitHeader(text);
  const behavior = validateBehaviorText({ id, text });
  return {
    id: behavior.id,
    text,
    header,
    kind: behavior.kind,
    platform: behavior.platform,
    label: behavior.label,
    description: behavior.description,
    prompt: behavior.prompt ?? '',
    data: { version: behavior.version, platform: behavior.platform, kind: behavior.kind, label: behavior.label, description: behavior.description, prompt: behavior.prompt ?? '', config: behavior.config },
  };
}

/** 结构化写：先按 schema 校验，再保留头部注释重排 YAML；写前备份旧文件。 */
export function writeBehaviorData({ root, id, data } = {}) {
  const file = behaviorFile(root, id);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') : '';
  const header = existing ? splitHeader(existing).header : '';
  // 档案按平台分目录存放，platform 默认取目录上一级（profiles/platforms/<platform>/behaviors）。
  const inferredPlatform = path.basename(path.dirname(path.resolve(root)));
  const normalized = normalizeBehavior(String(id), {
    version: data?.version ?? 1,
    platform: data?.platform ?? inferredPlatform,
    kind: data?.kind,
    label: data?.label,
    description: data?.description ?? '',
    prompt: data?.prompt ?? '',
    config: data?.config,
  });
  const text = behaviorDocumentText(header, {
    version: normalized.version,
    platform: normalized.platform,
    kind: normalized.kind,
    label: normalized.label,
    description: normalized.description,
    prompt: normalized.prompt,
    config: normalized.config,
  });
  fs.mkdirSync(root, { recursive: true });
  const backupRoot = path.join(REPO_ROOT, 'state', 'behavior-backups', String(id));
  fs.mkdirSync(backupRoot, { recursive: true });
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, path.join(backupRoot, `${stamp}.yml`));
  }
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, text, 'utf8');
  fs.renameSync(temp, file);
  return { id: normalized.id, behavior: normalized, text };
}

/** 原样保存 YAML，保存前按行为档案 schema 校验；不重排文本，注释保留。 */
export function validateBehaviorText({ id, text } = {}) {
  const source = String(text ?? '').replace(/\r\n/g, '\n');
  if (!source.trim()) throw new Error('YAML 不能为空');
  let raw;
  try { raw = YAML.parse(source); } catch (error) { throw new Error(`YAML 解析失败：${error?.message ?? error}`); }
  return normalizeBehavior(String(id), raw);
}

export function writeBehaviorFile({ root, id, text } = {}) {
  const file = behaviorFile(root, id);
  const source = String(text ?? '').replace(/\r\n/g, '\n');
  if (!source.trim()) throw new Error('YAML 不能为空');
  let raw;
  try { raw = YAML.parse(source); } catch (error) { throw new Error(`YAML 解析失败：${error?.message ?? error}`); }
  const normalized = normalizeBehavior(String(id), raw);
  fs.mkdirSync(root, { recursive: true });
  const backupRoot = path.join(path.dirname(root), '..', 'state', 'behavior-backups', String(id));
  fs.mkdirSync(backupRoot, { recursive: true });
  if (fs.existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, path.join(backupRoot, `${stamp}.yml`));
  }
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, source, 'utf8');
  fs.renameSync(temp, file);
  return { id: String(id), behavior: normalized, text: source };
}

export function behaviorSummary(behavior) {
  if (!behavior) return '';
  return `${behavior.label}（${behavior.kind}）`;
}


/** 克隆一份行为档案：目标 id 必须不存在；label 可覆盖。 */
export function duplicateBehavior({ root, fromId, toId, label } = {}) {
  const source = readBehaviorDocument({ root, id: fromId });
  const target = String(toId ?? '').trim();
  if (!ID_RE.test(target)) throw new Error(`行为档案 id 不合法：${target || '(空)'}`);
  const file = behaviorFile(root, target);
  if (fs.existsSync(file)) throw new Error(`${target} 已存在`);
  const result = writeBehaviorData({
    root,
    id: target,
    data: {
      version: source.data.version,
      platform: source.data.platform,
      kind: source.data.kind,
      label: String(label ?? '').trim() || `${source.label}（副本）`,
      description: source.data.description,
      prompt: source.data.prompt,
      config: source.data.config,
    },
  });
  return result;
}

/** 删除一份行为档案；调用方负责确认没有方案在引用。 */
export function removeBehaviorFile({ root, id } = {}) {
  const file = behaviorFile(root, id);
  if (!fs.existsSync(file)) throw new Error('没有这个行为档案');
  const backupRoot = path.join(path.dirname(root), '..', 'state', 'behavior-backups', String(id));
  fs.mkdirSync(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(file, path.join(backupRoot, `${stamp}.yml`));
  fs.rmSync(file);
  return { id: String(id) };
}
