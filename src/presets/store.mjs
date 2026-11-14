// 预设视图的读写层（P3 预设编辑器，C4 起数据源是能力档）。
//
// 权威源只有一份：profiles/agent-platforms/dsh/capabilities/<id>.yml
//   preset      元信息（name / description / order / behavior）
//   extensions  扩展授权（mcp / skills）
//   rows        插件行列表（人格、工具面、compaction）
//
// 「预设」不再是独立目录：能力档 id 就是预设 id。结构化保存只改对应段（yaml Document
// 局部更新，未改动的部分连注释一起留着）；YAML 高级保存整段覆盖 rows。
// 任何写入先备份到 state/preset-editor-backups/<id>/<timestamp>/，再由 applyPreset()
// 调 build-agent-preset-patches + setup-dsh 安装。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse, stringify } from 'yaml';
import { agentPresetIds } from '../agent-side/runtime-registry.mjs';
// 副作用：确保内置 Agent 平台已注册（agentPresetIds() 未注册时抛错）。
import '../agent-side/builtin.mjs';
import {
  createCapabilityStore, normalizeExtensions, normalizePreset, CAPABILITIES_ROOT,
} from '../capabilities/store.mjs';
import { BUILTIN_CAPABILITY_IDS } from '../tools/catalog.mjs';

const execFileAsync = promisify(execFile);
const CAPABILITY_FILE = 'capability.yml';
// 由 Agent 平台适配器声明（AGENT_PRESET_IDS）；测试会与构建适配器的 PRESETS 比对。
export const PRESET_IDS = agentPresetIds();

const ROWS_HEADER = '# 预设正文（能力档的 rows 段）：高级编辑会整段覆盖，这里写的注释不保留；'
  + '要留注释请直接改 capabilities/<id>.yml 的 rows 段。';

function stamp(now = Date.now()) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${String(now % 1000).padStart(3, '0')}`;
}

export { normalizeExtensions };

export function normalizeMeta(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const name = String(source.name ?? '').trim();
  if (!name) throw new Error('预设元信息缺少 name');
  const description = String(source.description ?? '').trim();
  if (!description) throw new Error('预设元信息缺少 description');
  const order = Number(source.order);
  if (!Number.isFinite(order) || !Number.isInteger(order)) throw new Error('预设的 order 必须是整数');
  const behavior = String(source.behavior ?? '').trim();
  if (behavior && !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(behavior)) {
    throw new Error('预设的 behavior 必须是行为档案 id');
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
    return { ok: false, error: '插件行列表必须是非空数组' };
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

function rowsToYaml(rows) {
  return `${ROWS_HEADER}\n\n${stringify(rows, { lineWidth: 0, singleQuote: true })}`;
}

function rowsView(rows) {
  return rows.map((row) => ({
    id: String(row?.id ?? ''),
    name: String(row?.name ?? ''),
    config: Object.fromEntries(Object.entries(row ?? {}).filter(([key]) => key !== 'id' && key !== 'name')),
  }));
}

// 空白预设的最小骨架：人格 + 提问/待办 + QQ 工具边界，不含任何本地工具。
const BLANK_ROWS = [
  { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: '（在这里写人格与行为提示词。）\n' } },
  { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
  { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
  { id: 'qq-tool-restrict', name: 'qq-agent-presets/qq-tool-restrict.mjs', config: {} },
];

export function createPresetStore({
  root = CAPABILITIES_ROOT, backupRoot, scriptsDir, nodeExecutable = process.execPath, log = () => {}, now = Date.now,
} = {}) {
  const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const capabilities = createCapabilityStore({ root, log });

  function presetId(id) {
    const value = String(id ?? '');
    if (!ID_RE.test(value)) throw new Error(`非法预设 id：${value}`);
    if (!capabilities.get(value)) throw new Error(`未知预设：${value}`);
    return value;
  }

  const fileFor = (id) => path.join(root, `${presetId(id)}.yml`);

  function list() {
    return capabilities.list()
      .filter((item) => item.preset)
      .map((item) => ({
        id: item.id,
        name: item.preset.name,
        description: item.preset.description,
        order: item.preset.order,
        behavior: item.preset.behavior,
        editable: true,
        builtin: BUILTIN_CAPABILITY_IDS.includes(item.id),
        error: null,
        hasExtensions: Boolean(item.extensions.mcp.allow.length
          || item.extensions.mcp.tools.allow.length
          || item.extensions.mcp.tools.deny.length
          || item.extensions.skills.allow.length),
        extensions: item.extensions,
      }))
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.id.localeCompare(b.id));
  }

  function read(id) {
    const name = presetId(id);
    const capability = capabilities.get(name);
    const meta = normalizeMeta(capability.preset);
    const rows = capability.rows ?? [];
    const agentYaml = rowsToYaml(rows);
    return {
      id: name,
      meta,
      extensions: capability.extensions,
      extensionsExists: list().find((item) => item.id === name)?.hasExtensions ?? false,
      agentYaml,
      validation: validateAgentYaml(agentYaml),
      // 插件配置表单要按行渲染：详情接口一次给全，页面不必再单独请求 /agent。
      agent: rowsView(rows),
      files: { [CAPABILITY_FILE]: true },
    };
  }

  function backup(id, reason = 'edit') {
    const name = presetId(id);
    const dir = path.join(backupRoot, name, `${stamp(now())}-${reason}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(fileFor(name), path.join(dir, CAPABILITY_FILE));
    return { dir, files: [CAPABILITY_FILE] };
  }

  function writeMeta(id, raw) {
    const meta = normalizeMeta(raw);
    const backupInfo = backup(id, 'meta');
    const capability = capabilities.setPreset(presetId(id), meta);
    log(`控制台：${id} 预设元信息已更新`);
    return { meta, backup: backupInfo, capability };
  }

  function writeExtensions(id, raw) {
    const extensions = normalizeExtensions(raw);
    const backupInfo = backup(id, 'extensions');
    const capability = capabilities.setExtensions(presetId(id), extensions);
    log(`控制台：${id} 扩展授权已更新`);
    return { extensions, backup: backupInfo, capability };
  }

  function writeAgentYaml(id, text) {
    const validation = validateAgentYaml(text);
    if (!validation.ok) {
      const error = new Error(validation.error);
      error.code = 'invalid_yaml';
      throw error;
    }
    const backupInfo = backup(id, 'yaml');
    const capability = capabilities.setRows(presetId(id), parse(String(text ?? '')));
    log(`控制台：${id} 预设正文已更新`);
    return { validation, backup: backupInfo, capability };
  }

  // 结构化读：把插件行拆成 {id, name, config}，config 是除 id/name 外的键。
  function readAgent(id) {
    const capability = capabilities.get(presetId(id));
    const rows = capability.rows ?? [];
    const agentYaml = rowsToYaml(rows);
    return { id, rows: rowsView(rows), agentYaml, validation: validateAgentYaml(agentYaml) };
  }

  // 结构化写：按插件 id 定位行，只覆盖表单提交的键。
  function writeAgentConfig(id, patchRows) {
    const patches = Array.isArray(patchRows) ? patchRows : [];
    if (patches.length === 0) throw new Error('没有要保存的插件行');
    const name = presetId(id);
    const rows = (capabilities.get(name).rows ?? []).map((row) => ({ ...row }));
    for (const patch of patches) {
      const pluginId = String(patch?.id ?? '').trim();
      const index = rows.findIndex((row) => String(row?.id ?? '') === pluginId);
      if (index < 0) throw new Error(`插件行列表缺少：${pluginId}`);
      if (patch.name !== undefined) rows[index].name = String(patch.name);
      const config = patch.config && typeof patch.config === 'object' ? patch.config : {};
      for (const [key, value] of Object.entries(config)) rows[index][key] = value;
    }
    const validation = validateAgentYaml(stringify(rows, { lineWidth: 0, singleQuote: true }));
    if (!validation.ok) throw new Error(validation.error);
    const backupInfo = backup(id, 'agent-config');
    const capability = capabilities.setRows(name, rows);
    log(`控制台：${id} 预设正文已按表单保存`);
    return { rows: validation.rows, backup: backupInfo, capability };
  }

  function nextOrder() {
    return Math.max(0, ...list().map((item) => Number(item.order) || 0)) + 1;
  }

  function createPreset({ id, from, name, description } = {}) {
    const value = String(id ?? '').trim();
    if (!ID_RE.test(value)) throw new Error('预设 id 只能用小写字母、数字和连字符，且以字母/数字开头');
    if (capabilities.get(value)) throw new Error(`预设已存在：${value}`);
    const source = String(from ?? '').trim();
    const displayName = String(name ?? '').trim();
    if (source) {
      const base = capabilities.get(presetId(source));
      if (!base) throw new Error(`模板预设不存在：${source}`);
      capabilities.save(value, {
        label: displayName || `${base.label}（副本）`,
        note: String(description ?? '').trim() || `从「${base.label}」复制`,
        tools: base.tools,
      });
      capabilities.setPreset(value, {
        name: displayName || `${base.preset.name}（副本）`,
        description: String(description ?? '').trim() || `从「${base.preset.name}」复制`,
        order: nextOrder(),
        behavior: base.preset.behavior,
      });
      if (base.rows.length) capabilities.setRows(value, base.rows);
      capabilities.setExtensions(value, base.extensions);
      log(`控制台：已新建预设 ${value}（复制自 ${source}）`);
      return { id: value, from: source };
    }
    if (!displayName) throw new Error('空白预设需要填写名称');
    capabilities.save(value, { label: displayName, note: String(description ?? '').trim() || '手工创建', tools: {} });
    capabilities.setPreset(value, {
      name: displayName,
      description: String(description ?? '').trim() || '手工创建',
      order: nextOrder(),
    });
    capabilities.setRows(value, BLANK_ROWS);
    log(`控制台：已新建空白预设 ${value}`);
    return { id: value, from: '' };
  }

  // 删除自建预设：出厂预设只能改不能删；删前先整份备份，误删还能从备份目录恢复。
  function deletePreset(id) {
    const name = presetId(id);
    if (BUILTIN_CAPABILITY_IDS.includes(name)) {
      throw new Error('系统自带预设不能删除，只能修改或还原出厂');
    }
    const backupInfo = backup(name, 'before-delete');
    capabilities.remove(name);
    return { id: name, backup: backupInfo };
  }

  // 还原出厂：用能力档目录里的 .defaults/<id>.yml 覆盖，覆盖前先整份备份。
  function restoreFactory(id) {
    const name = presetId(id);
    if (!BUILTIN_CAPABILITY_IDS.includes(name)) throw new Error(`没有该预设的出厂副本：${name}`);
    const source = path.join(root, '.defaults', `${name}.yml`);
    if (!fs.existsSync(source)) throw new Error(`没有该预设的出厂副本：${name}`);
    const backupInfo = backup(name, 'before-factory');
    fs.copyFileSync(source, fileFor(name));
    log(`控制台：${name} 已还原为出厂版本`);
    return { id: name, backup: backupInfo };
  }

  function listBackups(id) {
    const dir = path.join(backupRoot, String(id ?? ''));
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const full = path.join(dir, entry.name);
        return {
          id: entry.name,
          at: fs.statSync(full).mtimeMs,
          files: fs.readdirSync(full).filter((name) => name === CAPABILITY_FILE),
        };
      })
      .sort((a, b) => b.at - a.at);
  }

  function restore(id, backupId = null) {
    const name = presetId(id);
    const backups = listBackups(name);
    if (backups.length === 0) throw new Error(`${name} 没有可回滚的备份`);
    const target = backupId ? backups.find((item) => item.id === backupId) : backups[0];
    if (!target) throw new Error(`备份不存在：${backupId}`);
    backup(name, 'before-rollback');
    const from = path.join(backupRoot, name, target.id, CAPABILITY_FILE);
    if (!fs.existsSync(from)) throw new Error(`备份里没有 ${CAPABILITY_FILE}：${target.id}`);
    fs.copyFileSync(from, fileFor(name));
    log(`控制台：${name} 已回滚到 ${target.id}`);
    return { restored: target.id };
  }

  async function apply(id) {
    const name = presetId(id);
    backup(name, 'before-apply');
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
      const state = restore(name);
      try {
        await execFileAsync(nodeExecutable, [build], { cwd: path.dirname(scriptsDir), timeout: 60_000, windowsHide: true });
      } catch {}
      const wrapped = new Error(`应用失败，已回滚到 ${state.restored}：${error?.message ?? error}`);
      wrapped.code = 'apply_failed';
      throw wrapped;
    }
  }

  return {
    root,
    list,
    read,
    readAgent,
    backup,
    writeMeta,
    writeExtensions,
    writeAgentYaml,
    writeAgentConfig,
    createPreset,
    deletePreset,
    restoreFactory,
    listBackups,
    restore,
    apply,
  };
}
