// 全局配置：行为档案（behavior profiles）。
//
// 行为档案描述“QQ 里怎么说话/怎么等待”，不描述运行模式、模型、准入或安全上限。
// 权威源：config/behaviors/<id>.yml；由 dsh/agent-presets/<id>/preset.yml 的
// `behavior` 字段引用。缺失或 kind 不匹配一律失败关闭，不做隐式兜底。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const BEHAVIOR_KINDS = ['v1', 'v2'];
const TOP_KEYS = new Set(['version', 'kind', 'label', 'description', 'v1', 'v2']);
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
  const kind = String(source.kind ?? '').trim();
  if (!BEHAVIOR_KINDS.includes(kind)) throw new Error(`${value}.kind 必须是 ${BEHAVIOR_KINDS.join(' / ')}`);
  const label = String(source.label ?? '').trim();
  if (!label) throw new Error(`${value}.label 不能为空`);
  const description = String(source.description ?? '').trim();
  const bodyKey = kind;
  const config = assertPlainObject(source[bodyKey], `${value}.${bodyKey}`);
  const otherKey = kind === 'v1' ? 'v2' : 'v1';
  if (source[otherKey] !== undefined) throw new Error(`${value} 是 ${kind} 档案，不能同时包含 ${otherKey}`);
  walkNumbers(config, `${value}.${bodyKey}`);
  return { id: value, version, kind, label, description, config, [bodyKey]: config };
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

/** 读取 dsh/agent-presets/<id>/preset.yml 的 behavior 绑定。 */
export function loadPresetBehaviorBindings({ root, presetIds = null, log = () => {} } = {}) {
  if (!fs.existsSync(root)) throw new Error(`预设目录不存在：${root}`);
  const ids = Array.isArray(presetIds) && presetIds.length
    ? presetIds
    : fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const bindings = new Map();
  for (const id of ids) {
    const file = path.join(root, id, 'preset.yml');
    if (!fs.existsSync(file)) continue;
    const raw = YAML.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const behavior = String(raw?.behavior ?? '').trim();
    if (behavior) bindings.set(id, behavior);
  }
  log(`预设行为绑定：${[...bindings.entries()].map(([id, behavior]) => `${id}→${behavior}`).join('、') || '(无)'}`);
  return bindings;
}

/** 校验“聊天预设必须有 behavior、运维预设不得有”的启动契约。 */
export function assertPresetBehaviorBindings({ bindings, behaviors, chatPresetIds = ['qq-chat', 'qq-chat-v2'] }) {
  for (const id of chatPresetIds) {
    if (!bindings.has(id)) throw new Error(`聊天预设 ${id} 未绑定 behavior，拒绝启动`);
    const behavior = behaviors.get(bindings.get(id));
    if (!behavior) throw new Error(`预设 ${id} 引用的行为档案不存在：${bindings.get(id)}`);
  }
  for (const [id, behaviorId] of bindings) {
    if (!behaviors.has(behaviorId)) throw new Error(`预设 ${id} 引用的行为档案不存在：${behaviorId}`);
  }
  return true;
}

/** 按 preset 的 behavior 字段解析；缺失直接报错，不猜测默认值。 */
export function resolveBehavior(behaviors, behaviorId, { presetId = '' } = {}) {
  const id = String(behaviorId ?? '').trim();
  if (!id) {
    const hint = presetId ? `预设 ${presetId}` : '预设';
    throw new Error(`${hint} 未绑定 behavior（行为档案），拒绝启动`);
  }
  const behavior = behaviors?.get?.(id);
  if (!behavior) {
    const hint = presetId ? `预设 ${presetId}` : '预设';
    throw new Error(`${hint} 引用的行为档案不存在：${id}`);
  }
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
    kind: data.kind,
    label: data.label,
    description: data.description ?? '',
    [data.kind]: data.config,
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
    label: behavior.label,
    description: behavior.description,
    data: { version: behavior.version, kind: behavior.kind, label: behavior.label, description: behavior.description, config: behavior.config },
  };
}

/** 结构化写：先按 schema 校验，再保留头部注释重排 YAML；写前备份旧文件。 */
export function writeBehaviorData({ root, id, data } = {}) {
  const file = behaviorFile(root, id);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') : '';
  const header = existing ? splitHeader(existing).header : '';
  const normalized = normalizeBehavior(String(id), {
    version: data?.version ?? 1,
    kind: data?.kind,
    label: data?.label,
    description: data?.description ?? '',
    [String(data?.kind)]: data?.config,
  });
  const text = behaviorDocumentText(header, {
    version: normalized.version,
    kind: normalized.kind,
    label: normalized.label,
    description: normalized.description,
    config: normalized.config,
  });
  fs.mkdirSync(root, { recursive: true });
  const backupRoot = path.join(path.dirname(root), '..', 'state', 'behavior-backups', String(id));
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
