// DSH 预设源的读写层（P3 预设编辑器）。
//
// 权威源仍然是 dsh/agent-presets/<id>/ 下的三个文件：
// - preset.yml        元数据（name/description/order）
// - extensions.yml    Hub 授权（mcp / skills），可选
// - agent.cordis.yml  插件行（人格、工具面、compaction）
//
// 结构化保存只改元数据/授权；YAML 高级保存原样改 agent.cordis.yml。
// 任何写入先备份到 state/preset-editor-backups/<id>/<timestamp>/，再由
// applyPreset() 调 build-agent-preset-patches + setup-dsh 安装。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Document, parse, parseDocument } from 'yaml';

const execFileAsync = promisify(execFile);
const PRESET_FILES = ['preset.yml', 'extensions.yml', 'agent.cordis.yml'];
// 与 scripts/build-agent-preset-patches.mjs 的 PRESETS 保持一致；测试会比对。
export const PRESET_IDS = ['qq-chat', 'qq-chat-v2', 'qq-agent-readonly', 'qq-agent-workspace', 'qq-agent-full'];

function stamp(now = Date.now()) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${String(now % 1000).padStart(3, '0')}`;
}

function readYamlFile(file) {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (!raw.trim()) return null;
  return parse(raw);
}

const EXTENSIONS_HEADER = '# 扩展授权：由控制台预设编辑器维护；缺文件或空文件 = 全部拒绝。\n';

function readYamlDocument(file) {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (!raw.trim()) return null;
  const doc = parseDocument(raw);
  if (doc.errors.length) throw new Error(`YAML 解析失败：${doc.errors[0].message}`);
  return doc;
}

function writeDocument(file, doc, header = '') {
  let text = String(doc);
  if (header && !text.startsWith(header)) text = header + text;
  fs.writeFileSync(file, text, 'utf8');
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))];
}

export function normalizeExtensions(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const mcp = source.mcp && typeof source.mcp === 'object' ? source.mcp : {};
  const tools = mcp.tools && typeof mcp.tools === 'object' ? mcp.tools : {};
  const skills = source.skills && typeof source.skills === 'object' ? source.skills : {};
  return {
    mcp: {
      allow: normalizeList(mcp.allow),
      tools: {
        allow: normalizeList(tools.allow),
        deny: normalizeList(tools.deny),
      },
    },
    skills: { allow: normalizeList(skills.allow) },
  };
}

export function normalizeMeta(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const name = String(source.name ?? '').trim();
  if (!name) throw new Error('preset.yml 缺少 name');
  const description = String(source.description ?? '').trim();
  if (!description) throw new Error('preset.yml 缺少 description');
  const order = Number(source.order);
  if (!Number.isFinite(order) || !Number.isInteger(order)) throw new Error('preset.yml 的 order 必须是整数');
  const behavior = String(source.behavior ?? '').trim();
  if (behavior && !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(behavior)) {
    throw new Error('preset.yml 的 behavior 必须是行为档案 id');
  }
  return { name, description, order, behavior };
}

export function validateAgentYaml(text) {
  let parsed;
  try {
    parsed = parse(String(text ?? ''));
  } catch (error) {
    return { ok: false, error: `YAML 解析失败：${error?.message ?? error}` };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { ok: false, error: 'agent.cordis.yml 必须是非空的插件行列表' };
  }
  const seen = new Set();
  for (let index = 0; index < parsed.length; index += 1) {
    const row = parsed[index];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { ok: false, error: `第 ${index + 1} 行不是对象` };
    }
    const id = String(row.id ?? '').trim();
    if (!id) return { ok: false, error: `第 ${index + 1} 行缺少 id` };
    if (seen.has(id)) return { ok: false, error: `行 id 重复：${id}` };
    seen.add(id);
    if (typeof row.name !== 'string' || !row.name.trim()) {
      return { ok: false, error: `第 ${index + 1} 行缺少 name` };
    }
  }
  const required = ['persona', 'qq-tool-restrict'];
  for (const id of required) {
    if (!seen.has(id)) return { ok: false, error: `插件行列表缺少 ${id}（安全/人格边界不允许缺失）` };
  }
  return { ok: true, rows: parsed.length };
}

export function createPresetStore({ root, backupRoot, presetIds, scriptsDir, nodeExecutable = process.execPath, log = () => {}, now = Date.now }) {
  const ids = Array.isArray(presetIds) ? presetIds : [];
  const presetDir = (id) => {
    const value = String(id ?? '');
    if (!ids.includes(value)) throw new Error(`未知预设：${value}`);
    return path.join(root, value);
  };
  const fileFor = (id, name) => path.join(presetDir(id), name);

  function list() {
    return ids.map((id) => {
      let meta = null;
      let error = null;
      try {
        meta = normalizeMeta(readYamlFile(fileFor(id, 'preset.yml')));
      } catch (e) {
        error = e?.message ?? String(e);
      }
      let extensions = normalizeExtensions(null);
      try {
        if (fs.existsSync(fileFor(id, 'extensions.yml'))) {
          extensions = normalizeExtensions(readYamlFile(fileFor(id, 'extensions.yml')));
        }
      } catch (e) {
        if (!error) error = e?.message ?? String(e);
      }
      return {
        id,
        name: meta?.name ?? id,
        description: meta?.description ?? '',
        order: meta?.order ?? null,
        behavior: meta?.behavior ?? '',
        editable: true,
        error,
        hasExtensions: fs.existsSync(fileFor(id, 'extensions.yml')),
        extensions,
      };
    }).sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.id.localeCompare(b.id));
  }

  function read(id) {
    presetDir(id);
    const meta = normalizeMeta(readYamlFile(fileFor(id, 'preset.yml')));
    const extensionsExists = fs.existsSync(fileFor(id, 'extensions.yml'));
    const extensions = extensionsExists ? normalizeExtensions(readYamlFile(fileFor(id, 'extensions.yml'))) : normalizeExtensions(null);
    const agentYaml = fs.existsSync(fileFor(id, 'agent.cordis.yml'))
      ? fs.readFileSync(fileFor(id, 'agent.cordis.yml'), 'utf8')
      : '';
    const validation = validateAgentYaml(agentYaml);
    return {
      id,
      meta,
      extensions,
      extensionsExists,
      agentYaml,
      validation,
      files: Object.fromEntries(PRESET_FILES.map((name) => [name, fs.existsSync(fileFor(id, name))])),
    };
  }

  function backup(id, reason = 'edit') {
    presetDir(id);
    const dir = path.join(backupRoot, id, `${stamp(now())}-${reason}`);
    fs.mkdirSync(dir, { recursive: true });
    const copied = [];
    for (const name of PRESET_FILES) {
      const from = fileFor(id, name);
      if (!fs.existsSync(from)) continue;
      fs.copyFileSync(from, path.join(dir, name));
      copied.push(name);
    }
    return { dir, files: copied };
  }

  function writeMeta(id, raw) {
    const meta = normalizeMeta(raw);
    const backupInfo = backup(id, 'meta');
    const file = fileFor(id, 'preset.yml');
    let doc;
    try {
      doc = readYamlDocument(file);
    } catch (error) {
      throw error;
    }
    if (!doc || !doc.contents) doc = new Document({});
    const keys = ['name', 'description', 'order', 'behavior'];
    for (const key of keys) {
      if (key === 'behavior' && !meta.behavior) doc.delete(key);
      else doc.set(key, meta[key]);
    }
    for (const key of Object.keys(doc.toJS() ?? {})) {
      if (!keys.includes(key)) doc.delete(key);
    }
    writeDocument(file, doc);
    log(`控制台：${id} preset.yml 已更新`);
    return { meta, backup: backupInfo };
  }

  function writeExtensions(id, raw) {
    const extensions = normalizeExtensions(raw);
    const backupInfo = backup(id, 'extensions');
    const file = fileFor(id, 'extensions.yml');
    const doc = readYamlDocument(file) || new Document({});
    if (!doc.contents) doc.contents = doc.createNode({});
    doc.setIn(['mcp', 'allow'], extensions.mcp.allow);
    doc.setIn(['mcp', 'tools', 'allow'], extensions.mcp.tools.allow);
    doc.setIn(['mcp', 'tools', 'deny'], extensions.mcp.tools.deny);
    doc.setIn(['skills', 'allow'], extensions.skills.allow);
    writeDocument(file, doc, EXTENSIONS_HEADER);
    log(`控制台：${id} extensions.yml 已更新`);
    return { extensions, backup: backupInfo };
  }

  function writeAgentYaml(id, text) {
    const validation = validateAgentYaml(text);
    if (!validation.ok) {
      const error = new Error(validation.error);
      error.code = 'invalid_yaml';
      throw error;
    }
    const backupInfo = backup(id, 'yaml');
    fs.writeFileSync(fileFor(id, 'agent.cordis.yml'), String(text ?? ''), 'utf8');
    log(`控制台：${id} agent.cordis.yml 已更新`);
    return { validation, backup: backupInfo };
  }

  function listBackups(id) {
    const dir = path.join(backupRoot, id);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const full = path.join(dir, entry.name);
        return {
          id: entry.name,
          at: fs.statSync(full).mtimeMs,
          files: fs.readdirSync(full).filter((name) => PRESET_FILES.includes(name)),
        };
      })
      .sort((a, b) => b.at - a.at);
  }

  function restore(id, backupId = null) {
    const backups = listBackups(id);
    if (backups.length === 0) throw new Error(`${id} 没有可回滚的备份`);
    const target = backupId ? backups.find((item) => item.id === backupId) : backups[0];
    if (!target) throw new Error(`备份不存在：${backupId}`);
    backup(id, 'before-rollback');
    const dir = path.join(backupRoot, id, target.id);
    for (const name of PRESET_FILES) {
      const from = path.join(dir, name);
      if (fs.existsSync(from)) fs.copyFileSync(from, fileFor(id, name));
    }
    log(`控制台：${id} 已回滚到 ${target.id}`);
    return { restored: target.id };
  }

  async function apply(id) {
    presetDir(id);
    backup(id, 'before-apply');
    const build = path.join(scriptsDir, 'build-agent-preset-patches.mjs');
    const setup = path.join(scriptsDir, 'setup-dsh.mjs');
    try {
      const a = await execFileAsync(nodeExecutable, [build], { cwd: path.dirname(scriptsDir), timeout: 60_000, windowsHide: true });
      const b = await execFileAsync(nodeExecutable, [setup], { cwd: path.dirname(scriptsDir), timeout: 120_000, windowsHide: true });
      return {
        ok: true,
        build: String(a.stdout ?? '').trim().split(/\r?\n/).filter(Boolean).slice(-3),
        setup: String(b.stdout ?? '').trim().split(/\r?\n/).filter(Boolean).slice(-3),
      };
    } catch (error) {
      const state = restore(id);
      try {
        await execFileAsync(nodeExecutable, [build], { cwd: path.dirname(scriptsDir), timeout: 60_000, windowsHide: true });
      } catch {}
      const wrapped = new Error(`应用失败，已回滚到 ${state.restored}：${error?.message ?? error}`);
      wrapped.code = 'apply_failed';
      throw wrapped;
    }
  }

  return { list, read, backup, writeMeta, writeExtensions, writeAgentYaml, listBackups, restore, apply, presetDir };
}
