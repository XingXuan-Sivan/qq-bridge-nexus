// 外部技能存储（P3）：extensions/skills/<id>/SKILL.md 的导入、编辑、启停、删除。
//
// 设计边界：
// - 只管理用户目录 extensions/skills；DSH_HOME/skills、仓库 skills/、插件自带技能仍是只读来源。
// - 技能是提示词资产，不执行 SKILL.md 里的脚本；导入只接受文本与 zip 内的静态文件。
// - 所有写入先校验 frontmatter，再备份旧文件；路径必须落在技能根内，拒绝穿越。
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import zlib from 'node:zlib';

const SKILL_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_SKILL_BYTES = 256 * 1024;
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 200;

export class SkillStoreError extends Error {
  constructor(message, code = 'skill_error') {
    super(message);
    this.name = 'SkillStoreError';
    this.code = code;
  }
}

function assertSkillId(id) {
  const text = String(id ?? '').trim();
  if (!SKILL_ID_RE.test(text)) throw new SkillStoreError('技能 id 只能是小写字母/数字/点/下划线/短横线（1–64 位）', 'invalid_id');
  return text;
}

function safeRelPath(name) {
  const text = String(name ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = text.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '..' || part === '.')) {
    throw new SkillStoreError('压缩包包含非法路径', 'invalid_path');
  }
  return parts.join('/');
}

/** 解析 SKILL.md 的 YAML frontmatter（只认文件开头），返回元数据与正文。 */
export function parseSkillDocument(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  if (!source.startsWith('---')) throw new SkillStoreError('SKILL.md 必须以 --- frontmatter 开头', 'invalid_frontmatter');
  const end = source.indexOf('\n---', 3);
  if (end < 0) throw new SkillStoreError('SKILL.md 的 frontmatter 没有结束标记', 'invalid_frontmatter');
  let meta;
  try {
    meta = yaml.load(source.slice(3, end)) ?? {};
  } catch (error) {
    throw new SkillStoreError(`frontmatter YAML 解析失败：${error?.message ?? error}`, 'invalid_frontmatter');
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new SkillStoreError('frontmatter 必须是对象', 'invalid_frontmatter');
  const name = String(meta.name ?? '').trim();
  const description = String(meta.description ?? '').trim();
  if (!name) throw new SkillStoreError('frontmatter 缺少 name', 'invalid_frontmatter');
  if (!description) throw new SkillStoreError('frontmatter 缺少 description', 'invalid_frontmatter');
  const tags = Array.isArray(meta.tags) ? meta.tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
  return {
    name,
    description,
    version: String(meta.version ?? '').trim(),
    tags,
    body: source.slice(end + 4),
  };
}

export function validateSkillText(text) {
  const source = String(text ?? '');
  if (Buffer.byteLength(source, 'utf8') > MAX_SKILL_BYTES) throw new SkillStoreError('SKILL.md 超过 256KB', 'too_large');
  const parsed = parseSkillDocument(source);
  return { ...parsed, size: Buffer.byteLength(source, 'utf8') };
}

/** 极简 ZIP 读取：只支持 store/deflate，够导入 SKILL.md 包使用；拒绝加密与可疑路径。 */
export function readZip(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
  if (!buf.length) throw new SkillStoreError('压缩包为空', 'invalid_zip');
  if (buf.length > MAX_ARCHIVE_BYTES) throw new SkillStoreError('压缩包超过 4MB', 'too_large');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new SkillStoreError('不是有效的 zip 文件', 'invalid_zip');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ARCHIVE_ENTRIES) throw new SkillStoreError('压缩包条目过多', 'too_many_entries');
  const files = [];
  let offset = cdOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) throw new SkillStoreError('zip 目录损坏', 'invalid_zip');
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const uncompressed = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    offset += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new SkillStoreError('不支持加密 zip', 'invalid_zip');
    if (!name || name.endsWith('/')) continue;
    if (uncompressed > MAX_ARCHIVE_BYTES || compressed > MAX_ARCHIVE_BYTES) throw new SkillStoreError('zip 条目过大', 'too_large');
    const local = localOffset;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new SkillStoreError('zip 本地头损坏', 'invalid_zip');
    const localNameLen = buf.readUInt16LE(local + 26);
    const localExtraLen = buf.readUInt16LE(local + 28);
    const dataStart = local + 30 + localNameLen + localExtraLen;
    if (dataStart + compressed > buf.length) throw new SkillStoreError('zip 数据截断', 'invalid_zip');
    const raw = buf.subarray(dataStart, dataStart + compressed);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new SkillStoreError(`不支持的 zip 压缩方式 ${method}`, 'invalid_zip');
    files.push({ name: safeRelPath(name), data });
  }
  return files;
}

function skillIdFromFiles(files) {
  const skills = files.filter((entry) => /^skill\.md$/i.test(entry.name.split('/').pop() ?? ''));
  if (!skills.length) throw new SkillStoreError('压缩包内没有 SKILL.md', 'missing_skill');
  if (skills.length > 1) throw new SkillStoreError('压缩包内有多个 SKILL.md，请只放一个技能', 'multiple_skills');
  const parts = skills[0].name.split('/');
  if (parts.length > 2) throw new SkillStoreError('SKILL.md 只能位于压缩包根或一级目录', 'invalid_path');
  return { id: parts.length === 1 ? '' : parts[0], prefix: parts.length === 1 ? '' : `${parts[0]}/`, files };
}

/**
 * @param {object} opts
 * @param {string} opts.root 外部技能根 extensions/skills
 * @param {string} opts.stateFile 启停状态 state/extensions/skills-state.json
 * @param {object} [opts.fs]
 * @param {(line:string)=>void} [opts.log]
 * @param {()=>number} [opts.now]
 */
export function createSkillStore({ root, stateFile, fs: fsImpl = fs, log = () => {}, now = Date.now } = {}) {
  if (!root || !stateFile) throw new SkillStoreError('缺少技能根目录或状态文件', 'misconfigured');
  const rootDir = path.resolve(root);
  const statePath = path.resolve(stateFile);
  const backupDir = path.join(path.dirname(statePath), 'skill-backups');

  function ensureRoot() {
    fsImpl.mkdirSync(rootDir, { recursive: true });
  }

  function dirFor(id) {
    const safe = assertSkillId(id);
    const dir = path.resolve(rootDir, safe);
    if (!dir.startsWith(rootDir + path.sep)) throw new SkillStoreError('技能路径越界', 'invalid_id');
    return dir;
  }

  function readState() {
    try {
      const parsed = JSON.parse(fsImpl.readFileSync(statePath, 'utf8'));
      return {
        active: parsed?.active && typeof parsed.active === 'object' ? parsed.active : {},
      };
    } catch {
      return { active: {} };
    }
  }

  function writeState(state) {
    fsImpl.mkdirSync(path.dirname(statePath), { recursive: true });
    const tmp = `${statePath}.${process.pid}.tmp`;
    fsImpl.writeFileSync(tmp, `${JSON.stringify({ active: state.active }, null, 2)}\n`, 'utf8');
    fsImpl.renameSync(tmp, statePath);
  }

  function list() {
    ensureRoot();
    const state = readState();
    let names = [];
    try {
      names = fsImpl.readdirSync(rootDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink?.())
        .map((entry) => entry.name)
        .filter((name) => SKILL_ID_RE.test(name))
        .sort();
    } catch (error) {
      log(`[skills] 读取外部技能目录失败：${error?.message ?? error}`);
      return [];
    }
    const out = [];
    for (const id of names) {
      const file = path.join(rootDir, id, 'SKILL.md');
      let text;
      try {
        text = fsImpl.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      try {
        const meta = parseSkillDocument(text);
        out.push({
          id,
          name: meta.name,
          description: meta.description,
          version: meta.version,
          tags: meta.tags,
          path: path.join(rootDir, id).replace(/\\/g, '/'),
          source: 'user',
          editable: true,
          active: state.active[id] !== false,
          size: Buffer.byteLength(text, 'utf8'),
        });
      } catch (error) {
        log(`[skills] 跳过损坏技能 ${id}：${error?.message ?? error}`);
      }
    }
    return out;
  }

  function read(id) {
    const dir = dirFor(id);
    const file = path.join(dir, 'SKILL.md');
    const text = fsImpl.readFileSync(file, 'utf8');
    const meta = validateSkillText(text);
    const state = readState();
    return {
      id: assertSkillId(id),
      ...meta,
      source: 'user',
      editable: true,
      active: state.active[id] !== false,
      path: dir.replace(/\\/g, '/'),
      content: text,
    };
  }

  function backup(id, content) {
    try {
      fsImpl.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
      const file = path.join(backupDir, `${assertSkillId(id)}.${stamp}.md`);
      fsImpl.writeFileSync(file, content, 'utf8');
      return file;
    } catch (error) {
      log(`[skills] 备份 ${id} 失败：${error?.message ?? error}`);
      return '';
    }
  }

  function write(id, content) {
    const safe = assertSkillId(id);
    const text = String(content ?? '');
    const meta = validateSkillText(text);
    const dir = dirFor(safe);
    const file = path.join(dir, 'SKILL.md');
    if (fsImpl.existsSync(file)) backup(safe, fsImpl.readFileSync(file, 'utf8'));
    fsImpl.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fsImpl.writeFileSync(tmp, text, 'utf8');
    fsImpl.renameSync(tmp, file);
    const state = readState();
    if (state.active[safe] === false) state.active[safe] = true;
    writeState(state);
    return { id: safe, ...meta, active: true, path: dir.replace(/\\/g, '/'), content: text };
  }

  function remove(id) {
    const dir = dirFor(id);
    if (!fsImpl.existsSync(dir)) throw new SkillStoreError('技能不存在', 'not_found');
    fsImpl.rmSync(dir, { recursive: true, force: true });
    const state = readState();
    if (Object.hasOwn(state.active, id)) {
      delete state.active[id];
      writeState(state);
    }
    return { id, deleted: true };
  }

  function setActive(id, active) {
    const safe = assertSkillId(id);
    if (!fsImpl.existsSync(path.join(dirFor(safe), 'SKILL.md'))) throw new SkillStoreError('技能不存在', 'not_found');
    const state = readState();
    state.active[safe] = active !== false;
    writeState(state);
    return { id: safe, active: state.active[safe] };
  }

  /**
   * 导入 zip：只接受一个 SKILL.md（根或一级目录），整体解压到 extensions/skills/<id>。
   * 已存在同名技能时拒绝，避免静默覆盖；调用方需显式删除后再导入。
   */
  function importZip(buffer, { id = '' } = {}) {
    const files = readZip(buffer);
    const found = skillIdFromFiles(files);
    const targetId = assertSkillId(id || found.id || '');
    if (fsImpl.existsSync(dirFor(targetId))) throw new SkillStoreError(`技能 ${targetId} 已存在`, 'exists');
    for (const entry of files) {
      if (!entry.name.startsWith(found.prefix)) continue;
      const rel = entry.name.slice(found.prefix.length);
      if (!rel) continue;
      const dest = path.resolve(dirFor(targetId), rel);
      if (!dest.startsWith(path.resolve(dirFor(targetId)) + path.sep)) throw new SkillStoreError('技能路径越界', 'invalid_path');
      fsImpl.mkdirSync(path.dirname(dest), { recursive: true });
      fsImpl.writeFileSync(dest, entry.data);
    }
    const meta = validateSkillText(fsImpl.readFileSync(path.join(dirFor(targetId), 'SKILL.md'), 'utf8'));
    const state = readState();
    state.active[targetId] = true;
    writeState(state);
    return { id: targetId, ...meta, active: true, path: dirFor(targetId).replace(/\\/g, '/') };
  }

  return { root: rootDir, list, read, write, remove, setActive, importZip };
}
