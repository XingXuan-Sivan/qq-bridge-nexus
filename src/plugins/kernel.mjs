// 插件内核（docs/PLUGIN_KERNEL.md §2/§5/§6/§12，P2a）。
//
// 内核的职责只有四件事：发现并校验插件、把钩子分发给它们、给人格 provider 一个注册表、
// 在出错时保证主链不受影响。它**不认识**任何具体插件，也不解释插件的配置字段。
//
// P2a 起多了三个管理动作：enable / disable / reload。它们都只改运行态，不写 plugins.json——
// 配置文件的改动仍然要重启（或等文件监听，见路线图 P2c），避免出现「界面和文件各说一套」。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest, resolveMainPath, KNOWN_HOOKS, PLUGIN_ID_RE } from './manifest.mjs';
import { loadConfig, normalizeConfig, serializeConfig, writeConfigFile, PLUGIN_CONFIG_FILE, LIMIT_SPECS } from './config.mjs';
import { createAuditLog } from './audit.mjs';
import { createPersonaRegistry } from './persona.mjs';
import { createPromptBlockRegistry } from './prompt-blocks.mjs';
import { createHostApi } from './host-api.mjs';
import { stageFromDirectory, stageFromZip, discardStaging, moveDirToTrash } from './install.mjs';

const DISPOSE_TIMEOUT_MS = 2000;
const AUDIT_TAIL_BYTES = 64 * 1024;
const AUDIT_TAIL_LINES = 200;
// 入站替换文本上限：防止插件把一条短消息换成一大段，把后面的处理撑坏。
const INBOUND_TEXT_MAX = 4000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} 超时 ${timeoutMs}ms`);
      error.code = 'PLUGIN_HOOK_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isoNow() {
  return new Date().toISOString();
}

/**
 * Windows 记事本等编辑器会给 JSON 加 BOM，`JSON.parse` 会把 BOM 当成非法字符。
 * 插件清单是用户手写的，读的时候统一剥掉，避免「文件看着没错但插件装不上」。
 */
function readJsonFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

/**
 * 把监听事件的绝对路径翻译成插件 id；不在 plugins/ 下或不是合法 id 的一律忽略。
 * 提成顶层函数是为了单测能直接覆盖路径边界（不依赖 fs.watch 的平台行为）。
 */
export function pluginIdFromPath(pluginDir, filePath) {
  const relative = path.relative(pluginDir, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const [top] = relative.split(path.sep);
  if (!top || top.startsWith('.') || !PLUGIN_ID_RE.test(top)) return null;
  return top;
}

/**
 * @param {object} options
 * @param {string} options.rootDir   仓库根目录（plugins.json 与插件目录都在这里）
 * @param {string} options.stateDir  桥接 state 目录
 * @param {(message: string) => void} options.log
 * @param {object} [options.deps]    { sendToQQ, hasSession, fetch, now, random }
 */
export async function createPluginKernel({ rootDir, stateDir, log, deps = {} }) {
  const logLine = (message) => log?.(message);
  const loaded = loadConfig(path.join(rootDir, PLUGIN_CONFIG_FILE));
  const config = loaded.config;
  const warnings = [...(loaded.warnings ?? [])];
  if (loaded.error) warnings.push(loaded.error);

  const auditFile = path.join(stateDir, 'plugin-audit.jsonl');
  const audit = createAuditLog({
    file: auditFile,
    maxBytes: config.audit.maxBytes,
    keep: config.audit.keep,
    enabled: config.audit.enabled,
    log: logLine,
  });
  const persona = createPersonaRegistry({
    log: logLine,
    stateFile: path.join(stateDir, 'persona-cache.json'),
    ttlMs: config.persona.cache.ttlMs,
    minRefreshGapMs: config.persona.cache.minRefreshGapMs,
    staleMaxMs: config.persona.cache.staleMaxMs,
    now: deps.now,
  });
  // 具名注入块：总预算与 promptAdditions 共用 limits.maxPromptAppendChars，避免两个口子各算一套。
  const promptBlockRegistry = createPromptBlockRegistry({
    log: logLine,
    maxTotalChars: config.limits.maxPromptAppendChars,
  });

  const entries = [];
  const entryById = new Map();
  const hookIndex = new Map(KNOWN_HOOKS.map((hook) => [hook, []]));
  // 运行态开关：只在本次进程内有效；没有记录时以 plugins.json 的 plugins.<id>.enabled 为准。
  const runtimeEnabled = new Map();
  // 管理动作串行化：reload 期间不能让另一个 reload/enable 插进来，否则 hookIndex 会被写乱。
  let queue = Promise.resolve();

  function pluginRoot() {
    return path.join(rootDir, config.dir);
  }

  // ── 文件监听（P2c）─────────────────────────────────────────────
  // 默认关。开启后只重载「变更文件所属的那一个插件」，其余插件不受影响；
  // 同一个插件 500ms 内的多次事件合并成一次重载（编辑器保存经常连发好几个）。
  const WATCH_DEBOUNCE_MS = 500;
  let watcher = null;
  const watchTimers = new Map();

  /** 把监听事件的绝对路径翻译成插件 id；不在 plugins/ 下或不是合法 id 的一律忽略。 */
  function pluginIdForEvent(filePath) {
    return pluginIdFromPath(pluginRoot(), filePath);
  }

  function stopWatching() {
    for (const timer of watchTimers.values()) clearTimeout(timer);
    watchTimers.clear();
    if (!watcher) return;
    try { watcher.close(); } catch { /* 关不掉也不影响退出 */ }
    watcher = null;
  }

  function startWatching() {
    if (!config.watch || watcher) return;
    try {
      watcher = fs.watch(pluginRoot(), { recursive: true }, (_event, filename) => {
        const id = pluginIdForEvent(path.join(pluginRoot(), String(filename ?? '')));
        if (!id) return;
        const existing = watchTimers.get(id);
        if (existing) clearTimeout(existing);
        watchTimers.set(id, setTimeout(() => {
          watchTimers.delete(id);
          const entry = entryById.get(id);
          // 已卸载/停用/本身坏掉的插件不自动重载：避免「删目录」把 failed 状态反复刷成 reload-failed。
          if (!entry || entry.status === 'disabled' || entry.status === 'invalid') return;
          withLock(() => doReload(id)).catch((error) => logLine(`⚠️ [plugins] 监听重载 ${id} 失败：${error?.message ?? error}`));
        }, WATCH_DEBOUNCE_MS));
      });
      watcher.on('error', (error) => {
        logLine(`⚠️ [plugins] 文件监听出错，已停止（后续只能手动重载）：${error?.message ?? error}`);
        stopWatching();
      });
      logLine(`[plugins] 文件监听已开启（${config.dir}，默认关，仅开发时建议开）`);
    } catch (error) {
      watcher = null;
      logLine(`⚠️ [plugins] 文件监听不可用，已降级为手动重载：${error?.message ?? error}`);
    }
  }

  function withLock(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  function createEntry(id, previous) {
    const entry = {
      id,
      name: previous?.name ?? id,
      version: previous?.version ?? null,
      status: 'invalid',
      error: null,
      manifest: null,
      hooks: [],
      commands: [],
      dispose: null,
      config: config.plugins[id]?.config ?? {},
      updatedAt: null,
      stats: {
        hookCalls: 0,
        hookErrors: 0,
        lastHookAt: null,
        lastErrorAt: null,
        reloads: 0,
        ...(previous?.stats ?? {}),
      },
    };
    return entry;
  }

  function indexEntry(entry) {
    const existing = entryById.get(entry.id);
    if (!existing) entries.push(entry);
    else entries[entries.indexOf(existing)] = entry;
    entryById.set(entry.id, entry);
  }

  function removeHookEntries(id) {
    for (const list of hookIndex.values()) {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i].id === id) list.splice(i, 1);
      }
    }
  }

  /** 把 persona 注册真正落到注册表（manifest 声明的 provider 白名单也在这里判）。 */
  function commitPersona(provider, pluginId) {
    const wanted = config.persona.provider;
    if (wanted && wanted !== provider?.id) {
      logLine(`[plugins] ${pluginId} 的人格 provider "${provider?.id}" 未在 plugins.json 的 persona.provider 中启用，已忽略`);
      return;
    }
    persona.register(provider, pluginId);
  }

  async function disposeEntry(entry) {
    removeHookEntries(entry.id);
    if (entry.dispose) {
      try {
        await withTimeout(Promise.resolve().then(() => entry.dispose()), DISPOSE_TIMEOUT_MS, `${entry.id}.dispose`);
      } catch (error) {
        logLine(`⚠️ [plugins] ${entry.id} 清理失败：${error?.message ?? error}`);
      }
      entry.dispose = null;
    }
    persona.unregister(entry.id);
    // 命令与注入块按 pluginId 批量注销：卸载/停用/重载后旧内容不能继续进 prompt。
    deps.commandRegistry?.unregisterPlugin?.(entry.id);
    promptBlockRegistry.unregisterPlugin(entry.id);
    entry.commands = [];
    entry.blocks = [];
    entry.hooks = [];
    if (entry.status === 'active') entry.status = 'stopped';
    entry.updatedAt = isoNow();
  }

  /**
   * 构建一个新实例：读清单 → 校验 →（未禁用时）import + activate。
   * 关键点：钩子与 persona 都先收在 `pending` 里，**不碰全局索引**；调用方确认成功后再 commit。
   * 这样 reload 失败时旧实例原封不动，persona 也不会被半成品 provider 顶掉。
   */
  async function buildInstance(dirName) {
    const pluginDir = path.join(pluginRoot(), dirName);
    const manifestFile = path.join(pluginDir, 'plugin.json');

    let raw;
    try {
      raw = readJsonFile(manifestFile);
    } catch (error) {
      return { ok: false, error: `读取 plugin.json 失败: ${error?.message ?? error}` };
    }

    const checked = validateManifest(raw, dirName);
    if (!checked.ok) return { ok: false, error: checked.errors.join('；') };
    const manifest = checked.manifest;

    const runtime = runtimeEnabled.get(dirName);
    const enabled = runtime !== undefined ? runtime : config.plugins[dirName]?.enabled !== false;
    if (!enabled) {
      return { ok: true, status: 'disabled', manifest, hooks: [], personas: [], dispose: null };
    }

    let mainPath;
    try {
      mainPath = resolveMainPath(pluginDir, manifest.main);
    } catch (error) {
      return { ok: false, error: error.message, manifest };
    }
    if (!fs.existsSync(mainPath)) {
      return { ok: false, error: `入口不存在: ${manifest.main}`, manifest };
    }

    let mod;
    try {
      // ESM 有 import 缓存：不换 URL 的话，改了磁盘上的文件重载还是旧代码。
      const stat = fs.statSync(mainPath);
      mod = await import(`${pathToFileURL(mainPath).href}?v=${stat.mtimeMs}`);
    } catch (error) {
      return { ok: false, error: `import 失败: ${error?.message ?? error}`, manifest };
    }

    const activate = mod.activate ?? mod.default?.activate;
    if (typeof activate !== 'function') {
      return { ok: false, error: '入口必须导出 activate(ctx)', manifest };
    }

    const pending = { hooks: [], personas: [], commands: [], blocks: [] };
    const ctx = createHostApi({
      id: dirName,
      version: manifest.version,
      permissions: manifest.permissions,
      config: config.plugins[dirName]?.config ?? {},
      stateDir,
      log: logLine,
      deps: {
        registerPersona: (provider, pluginId) => pending.personas.push({ provider, pluginId }),
        registerPromptBlock: (definition, pluginId) => {
          pending.blocks.push({ definition, pluginId });
          return true;
        },
        unregisterPersona: (pluginId) => persona.unregister(pluginId),
        registerPluginCommand: (definition, pluginId) => {
          pending.commands.push({ definition, pluginId });
          return true;
        },
        sendToQQ: deps.sendToQQ,
        hasSession: deps.hasSession,
        fetch: deps.fetch,
        now: deps.now,
        random: deps.random,
      },
    });

    let result;
    try {
      result = await activate(ctx);
    } catch (error) {
      return { ok: false, error: `activate 失败: ${error?.message ?? error}`, manifest };
    }

    let dispose = null;
    if (result && typeof result === 'object') {
      if (typeof result.dispose === 'function') dispose = result.dispose;
      const hooks = result.hooks ?? {};
      for (const [hookName, handler] of Object.entries(hooks)) {
        if (!KNOWN_HOOKS.includes(hookName)) {
          logLine(`⚠️ [plugins] ${dirName} 注册了未知钩子 "${hookName}"，已忽略`);
          continue;
        }
        if (!manifest.hooks.includes(hookName)) {
          logLine(`⚠️ [plugins] ${dirName} 注册了未在清单声明的钩子 "${hookName}"，已忽略`);
          continue;
        }
        if (typeof handler !== 'function') continue;
        if (pending.hooks.some((item) => item.name === hookName)) continue;
        pending.hooks.push({ name: hookName, handler });
      }
    }

    return { ok: true, status: 'active', manifest, hooks: pending.hooks, personas: pending.personas, commands: pending.commands, blocks: pending.blocks, dispose };
  }

  /** 提交实例：替换元数据、挂钩子、注册 provider。调用前必须已经 dispose 旧实例。 */
  function commit(entry, desc) {
    entry.manifest = desc.manifest;
    entry.name = desc.manifest.name;
    entry.version = desc.manifest.version;
    entry.status = desc.status;
    entry.error = null;
    entry.hooks = [];
    entry.commands = [];
    entry.blocks = [];
    entry.dispose = desc.dispose ?? null;
    entry.updatedAt = isoNow();

    if (desc.status === 'active') {
      for (const { name, handler } of desc.hooks) {
        hookIndex.get(name).push({ id: entry.id, handler });
        entry.hooks.push(name);
      }
      for (const { provider, pluginId } of desc.personas) commitPersona(provider, pluginId);
      for (const { definition, pluginId } of desc.commands ?? []) {
        try {
          // 插件不强制写 id：用 pluginId:name 兜底，既唯一又能在审计里看出归属。
          const registered = deps.commandRegistry?.register?.({
            ...definition,
            id: definition.id ?? `${pluginId}:${definition.name}`,
            source: 'plugin',
            pluginId,
          });
          if (registered) entry.commands.push(definition.name);
        } catch (error) {
          logLine(`⚠️ [plugins] ${entry.id} 注册命令 ${definition?.name ?? '?'} 失败：${error?.message ?? error}`);
        }
      }
      for (const { definition, pluginId } of desc.blocks ?? []) {
        try {
          if (promptBlockRegistry.register(definition, pluginId)) entry.blocks.push(definition.id);
        } catch (error) {
          logLine(`⚠️ [plugins] ${entry.id} 注册注入块 ${definition?.id ?? '?'} 失败：${error?.message ?? error}`);
        }
      }
      audit.append('activate', { plugin: entry.id, version: entry.version });
      logLine(`[plugins] 已加载 ${entry.id}@${entry.version}${entry.hooks.length ? `（${entry.hooks.join('/')}）` : ''}`);
    } else {
      audit.append('disable', { plugin: entry.id, reason: 'config-or-runtime' });
      logLine(`[plugins] ${entry.id} 处于停用状态`);
    }
  }

  async function loadOne(dirName) {
    const desc = await buildInstance(dirName);
    const entry = createEntry(dirName, entryById.get(dirName));
    if (!desc.ok) {
      entry.status = 'invalid';
      entry.error = desc.error;
      entry.manifest = desc.manifest ?? null;
      entry.updatedAt = isoNow();
      audit.append('error', { plugin: dirName, error: entry.error });
      logLine(`⚠️ [plugins] ${dirName} 加载失败：${entry.error}`);
      indexEntry(entry);
      return entry;
    }
    commit(entry, desc);
    indexEntry(entry);
    return entry;
  }

  function summarize(entry) {
    return {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      description: entry.manifest?.description ?? '',
      permissions: [...(entry.manifest?.permissions ?? [])],
      status: entry.status,
      error: entry.error,
      hooks: [...entry.hooks],
      commands: [...entry.commands],
      blocks: [...(entry.blocks ?? [])],
      updatedAt: entry.updatedAt,
      counters: { ...entry.stats },
    };
  }

  function readAuditTail() {
    try {
      const stat = fs.statSync(auditFile);
      const start = Math.max(0, stat.size - AUDIT_TAIL_BYTES);
      const fd = fs.openSync(auditFile, 'r');
      try {
        const buffer = Buffer.alloc(stat.size - start);
        fs.readSync(fd, buffer, 0, buffer.length, start);
        const lines = buffer.toString('utf8').split('\n').filter(Boolean);
        return lines.slice(-AUDIT_TAIL_LINES).map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return { raw: line };
          }
        });
      } finally {
        fs.closeSync(fd);
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function init() {
    for (const warning of warnings) logLine(`⚠️ [plugins] ${warning}`);
    if (!config.enabled) {
      logLine('[plugins] 已在 plugins.json 中禁用，不加载任何插件');
      return;
    }

    let names;
    try {
      names = fs.readdirSync(pluginRoot(), { withFileTypes: true })
        // 跳过暂存目录（.staging-*）：安装中途崩掉时残留的目录不能被当成插件扫描。
        .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('.'))
        .map((dirent) => dirent.name)
        .sort();
    } catch (error) {
      if (error?.code === 'ENOENT') {
        logLine(`[plugins] 插件目录不存在（${config.dir}），跳过`);
        return;
      }
      throw error;
    }

    if (names.length > config.limits.maxPlugins) {
      logLine(`⚠️ [plugins] 插件目录有 ${names.length} 个，超过上限 ${config.limits.maxPlugins}，其余忽略`);
      names = names.slice(0, config.limits.maxPlugins);
    }

    for (const name of names) {
      await loadOne(name);
    }
    startWatching();
  }

  /** 分发一个钩子；每个钩子独立超时 + 捕获，返回各插件的结果（失败的不返回）。 */
  /** 调用单个插件的钩子：超时与异常在这里收口，调用方只关心返回值。 */
  async function invokeHook(hookName, id, handler, payload) {
    const entry = entryById.get(id);
    if (!entry || entry.status !== 'active') return { ok: false, skipped: true };
    entry.stats.hookCalls += 1;
    entry.stats.lastHookAt = isoNow();
    const startedAt = Date.now();
    try {
      const value = await withTimeout(
        Promise.resolve().then(() => handler(payload)),
        config.limits.hookTimeoutMs,
        `${id}.${hookName}`,
      );
      return { ok: true, value };
    } catch (error) {
      const timedOut = error?.code === 'PLUGIN_HOOK_TIMEOUT';
      const message = `${hookName}: ${error?.message ?? error}`;
      if (entry) {
        entry.stats.hookErrors += 1;
        entry.stats.lastErrorAt = isoNow();
        entry.error = message;
      }
      audit.append(timedOut ? 'timeout' : 'error', {
        plugin: id,
        hook: hookName,
        durationMs: Date.now() - startedAt,
        error: error?.message ?? String(error),
      });
      logLine(`⚠️ [plugins] ${id}.${hookName} ${timedOut ? '超时' : '失败'}：${error?.message ?? error}`);
      return { ok: false, error };
    }
  }

  async function callHook(hookName, payload) {
    // 快照：管理动作可能在分发过程中改 hookIndex，直接遍历会漏掉或重复调用。
    const list = [...(hookIndex.get(hookName) ?? [])];
    const results = [];
    for (const { id, handler } of list) {
      const result = await invokeHook(hookName, id, handler, payload);
      if (result.ok && result.value !== undefined) results.push({ id, value: result.value });
    }
    return results;
  }

  /**
   * 出站装饰：按注册顺序链式执行，后一个插件拿到前一个改过的文本。
   * 任何一步抛错/超时都保留上一步的结果（最差是原文）——装饰失败绝不能让消息发不出去。
   * 返回值 { text, dropped, changedBy }；`dropped` 表示这一段不发了。
   */
  async function decorateReply(payload) {
    const list = [...(hookIndex.get('onReplyDecorate') ?? [])];
    let text = String(payload?.text ?? '');
    let dropped = false;
    let changedBy = null;
    for (const { id, handler } of list) {
      const result = await invokeHook('onReplyDecorate', id, handler, { ...payload, text });
      if (!result.ok || result.value === undefined || result.value === null) continue;
      const value = result.value;
      if (typeof value === 'string') {
        if (value !== text) { text = value; changedBy = id; }
        continue;
      }
      if (typeof value !== 'object') continue;
      if (value.drop === true) { dropped = true; changedBy = id; break; }
      if (typeof value.text === 'string' && value.text !== text) { text = value.text; changedBy = id; }
    }
    return { text, dropped, changedBy };
  }

  /**
   * 入站过滤：`{ drop:true }` 丢掉整条消息，`{ text }` 替换正文。
   * 只有申请了 `inbound:filter` 的插件允许返回这两种动作；只观察的插件不受影响。
   * `filters.inbound` 默认 false —— 关着时完全不调用钩子，行为与没有插件时一致。
   */
  async function filterInbound(payload) {
    if (!config.filters?.inbound) return { dropped: false, text: null, changedBy: null };
    const list = [...(hookIndex.get('onInbound') ?? [])];
    let text = typeof payload?.text === 'string' ? payload.text : '';
    let changedBy = null;
    for (const { id, handler } of list) {
      const entry = entryById.get(id);
      const permissions = entry?.manifest?.permissions ?? [];
      const allowed = Array.isArray(permissions) && permissions.includes('inbound:filter');
      const result = await invokeHook('onInbound', id, handler, { ...payload, text });
      if (!result.ok || result.value === undefined || result.value === null) continue;
      const value = result.value;
      if (typeof value !== 'object') continue;
      const wantsDrop = value.drop === true;
      const wantsText = typeof value.text === 'string' && value.text !== text;
      if (!wantsDrop && !wantsText) continue;
      if (!allowed) {
        audit.append('inbound-denied', { plugin: id, reason: '缺少 inbound:filter 权限' });
        logLine(`⚠️ [plugins] ${id} 返回了入站过滤动作，但未申请 inbound:filter，已忽略`);
        continue;
      }
      if (wantsText && value.text.length > INBOUND_TEXT_MAX) {
        audit.append('inbound-denied', { plugin: id, reason: `替换文本超过 ${INBOUND_TEXT_MAX} 字` });
        logLine(`⚠️ [plugins] ${id} 的入站替换文本超过 ${INBOUND_TEXT_MAX} 字，已忽略`);
        continue;
      }
      if (wantsDrop) return { dropped: true, text, changedBy: id };
      text = value.text;
      changedBy = id;
    }
    return { dropped: false, text: changedBy ? text : null, changedBy };
  }

  /** 观察型钩子：不等待、不向主链抛错。 */
  function notify(hookName, payload) {
    if (!(hookIndex.get(hookName)?.length)) return;
    void callHook(hookName, payload).catch(() => {});
  }

  /** prompt 追加：多个插件按 id 顺序拼接，总量受 maxPromptAppendChars 限制。 */
  async function promptAdditions(payload) {
    const results = await callHook('onPromptBuild', payload);
    const prepends = [];
    const appends = [];
    for (const { value } of results) {
      if (!value || typeof value !== 'object') continue;
      if (typeof value.prependText === 'string' && value.prependText.trim()) prepends.push(value.prependText);
      if (typeof value.appendText === 'string' && value.appendText.trim()) appends.push(value.appendText);
    }

    let prependText = prepends.join('\n\n');
    let appendText = appends.join('\n\n');
    const cap = config.limits.maxPromptAppendChars;
    if (cap > 0 && prependText.length + appendText.length > cap) {
      const prependBudget = Math.min(prependText.length, cap);
      prependText = prependText.slice(0, prependBudget);
      appendText = appendText.slice(0, Math.max(0, cap - prependText.length));
      logLine(`⚠️ [plugins] onPromptBuild 追加超过 ${cap} 字符，已截断`);
    }
    return { prependText, appendText };
  }

  function personaResolve(key) {
    return persona.resolve(key);
  }

  /**
   * 渲染插件注册的具名注入块（P4）。与 promptAdditions 的区别：这里是「内容」，
   * 按 priority 排序、按块限额、按总预算跳块；返回的 blocks 报告给控制台看占比。
   */
  function promptBlocks(context = {}) {
    return promptBlockRegistry.render(context);
  }

  /** 唤醒时把人格卡刷新一次（异步、有超时、失败保留旧缓存）。 */
  function personaWarm(key, options) {
    return persona.warm(key, options);
  }

  function status() {
    const personaStatus = persona.status();
    // 没有 provider 时 persona 直接为 null：否则控制台会看到一个只有缓存统计、没有 id 的「半个人格来源」。
    const personaInfo = personaStatus.provider
      ? {
          ...personaStatus.provider,
          keys: personaStatus.keys,
          cards: personaStatus.cards,
          stale: personaStatus.stale,
          degraded: personaStatus.degraded,
          lastError: personaStatus.lastError,
          lastErrorAt: personaStatus.lastErrorAt,
          lastRefreshAt: personaStatus.lastRefreshAt,
          failures: personaStatus.failures,
        }
      : null;
    return {
      enabled: config.enabled,
      dir: config.dir,
      watch: config.watch,
      watching: Boolean(watcher),
      filters: { inbound: config.filters.inbound },
      install: { enabled: config.install.enabled, maxBytes: config.install.maxBytes },
      limits: { ...config.limits },
      audit: { enabled: config.audit.enabled, file: 'state/plugin-audit.jsonl', maxBytes: config.audit.maxBytes, keep: config.audit.keep },
      // provider 的基本信息平铺在 persona 下（控制台不用再往下挖一层），但不再保留一份嵌套副本。
      persona: personaInfo,
      promptBlocks: promptBlockRegistry.status(),
      plugins: entries.map(summarize),
    };
  }

  /** 单插件详情：manifest、权限、钩子、计数、审计尾部。 */
  function detail(id) {
    const entry = entryById.get(id);
    if (!entry) return null;
    return {
      ...summarize(entry),
      manifest: entry.manifest,
      permissions: entry.manifest?.permissions ?? [],
      apiVersion: entry.manifest?.apiVersion ?? null,
      config: entry.config,
      source: {
        dir: path.join(config.dir, id),
        main: entry.manifest?.main ?? null,
      },
      audit: readAuditTail().filter((item) => item.plugin === id).slice(-20),
    };
  }

  async function doReload(id) {
    const existing = entryById.get(id);
    if (!existing && !fs.existsSync(path.join(pluginRoot(), id, 'plugin.json'))) {
      return { ok: false, error: `插件不存在: ${id}` };
    }
    const desc = await buildInstance(id);
    if (!desc.ok) {
      if (existing) {
        existing.error = desc.error;
        existing.stats.lastErrorAt = isoNow();
      }
      audit.append('reload-failed', { plugin: id, error: desc.error });
      logLine(`⚠️ [plugins] ${id} 重载失败，保留旧实例：${desc.error}`);
      return { ok: false, error: desc.error, plugin: existing ? summarize(existing) : null };
    }

    const entry = existing ?? createEntry(id);
    if (existing) await disposeEntry(existing);
    commit(entry, desc);
    entry.stats.reloads += 1;
    indexEntry(entry);
    audit.append('reload', { plugin: id, version: entry.version, status: entry.status });
    return { ok: true, plugin: summarize(entry) };
  }

  /** 安装：暂存 → 读清单 → 校验 → 原子改名到 plugins/<id> → 加载；任何一步失败都回滚。 */
  async function doInstall({ kind, source }) {
    if (!config.enabled) return { ok: false, error: '插件内核已在 plugins.json 中禁用' };
    if (!config.install.enabled) return { ok: false, error: '安装已在 plugins.json 中关闭（install.enabled=false）' };

    let staged;
    try {
      staged = kind === 'zip'
        ? stageFromZip({ pluginsDir: pluginRoot(), buffer: source, maxBytes: config.install.maxBytes })
        : stageFromDirectory({ pluginsDir: pluginRoot(), sourcePath: source, maxBytes: config.install.maxBytes });
    } catch (error) {
      const message = error?.message ?? String(error);
      audit.append('install-failed', { plugin: null, error: message });
      logLine(`⚠️ [plugins] 安装失败：${message}`);
      return { ok: false, error: message };
    }

    let installedId = null;
    try {
      let raw;
      try {
        raw = readJsonFile(path.join(staged.dir, 'plugin.json'));
      } catch (error) {
        throw new Error(`plugin.json 不可读：${error?.message ?? error}`);
      }
      const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
      if (!PLUGIN_ID_RE.test(id)) throw new Error(`plugin.json 的 id 不合法：${id || '(空)'}`);
      const checked = validateManifest(raw, id);
      if (!checked.ok) throw new Error(`清单校验失败：${checked.errors.join('；')}`);
      const target = path.join(pluginRoot(), id);
      if (fs.existsSync(target)) throw new Error(`插件 "${id}" 已存在`);

      fs.renameSync(staged.dir, target);
      installedId = id;
      const desc = await buildInstance(id);
      if (!desc.ok) throw new Error(`加载失败：${desc.error}`);

      const entry = createEntry(id);
      commit(entry, desc);
      indexEntry(entry);
      audit.append('install', { plugin: id, version: entry.version, kind });
      logLine(`[plugins] 已安装 ${id}@${entry.version}`);
      return { ok: true, plugin: summarize(entry) };
    } catch (error) {
      const message = error?.message ?? String(error);
      if (installedId) {
        try {
          moveDirToTrash({ pluginsDir: pluginRoot(), trashRoot: path.join(stateDir, '_trash'), id: installedId });
        } catch (rollbackError) {
          logLine(`⚠️ [plugins] 回滚 ${installedId} 失败：${rollbackError?.message ?? rollbackError}`);
        }
      }
      audit.append('install-failed', { plugin: installedId, error: message });
      logLine(`⚠️ [plugins] 安装失败：${message}`);
      return { ok: false, error: message };
    } finally {
      discardStaging(staged.staging);
    }
  }

  /** 卸载：先把目录移到 state/_trash（不硬删），失败则不动运行中的实例。 */
  async function doUninstall(id) {
    if (!PLUGIN_ID_RE.test(id)) return { ok: false, error: `非法插件 id：${id}` };
    const entry = entryById.get(id);
    const dir = path.join(pluginRoot(), id);
    if (!entry && !fs.existsSync(dir)) return { ok: false, error: `插件不存在: ${id}` };

    let trashPath = null;
    if (fs.existsSync(dir)) {
      try {
        trashPath = moveDirToTrash({ pluginsDir: pluginRoot(), trashRoot: path.join(stateDir, '_trash'), id });
      } catch (error) {
        const message = `移动插件目录失败：${error?.message ?? error}`;
        audit.append('uninstall-failed', { plugin: id, error: message });
        return { ok: false, error: message };
      }
    }
    if (entry) {
      await disposeEntry(entry);
      const index = entries.indexOf(entry);
      if (index >= 0) entries.splice(index, 1);
      entryById.delete(id);
    }
    runtimeEnabled.delete(id);
    const relativeTrash = trashPath ? path.relative(rootDir, trashPath) : null;
    audit.append('uninstall', { plugin: id, detail: relativeTrash });
    logLine(`[plugins] 已卸载 ${id}${relativeTrash ? `（移到 ${relativeTrash}）` : ''}`);
    return { ok: true, id, trash: relativeTrash };
  }

  async function shutdown() {
    // 先停监听：退出过程中触发的文件事件不应该再排队重载。
    stopWatching();
    // 再发 onShutdown、拆实例：钩子还挂在索引上，插件才能在退出前做最后一次清理。
    await callHook('onShutdown', {});
    for (const entry of entries) {
      if (entry.status !== 'active') continue;
      await disposeEntry(entry);
    }
    audit.append('deactivate', { plugins: entries.filter((entry) => entry.status === 'stopped').map((entry) => entry.id) });
  }

  return {
    init,
    notify,
    promptAdditions,
    promptBlocks,
    decorateReply,
    filterInbound,
    personaResolve,
    personaWarm,
    status,
    detail,
    shutdown,

    /** 重载单个插件：新实例构建成功才替换旧的；失败时旧实例继续跑。 */
    reload(id) {
      return withLock(() => doReload(String(id)));
    },

    /** 重载全部（顺序执行，任一失败不影响其它）。 */
    reloadAll() {
      return withLock(async () => {
        const results = [];
        for (const entry of [...entries]) {
          const result = await doReload(entry.id);
          results.push({ id: entry.id, ok: result.ok, error: result.error ?? null });
        }
        return { ok: results.every((item) => item.ok), results };
      });
    },

    /** 启用：只改本次进程的运行态，不写 plugins.json。 */
    enable(id) {
      const key = String(id);
      return withLock(async () => {
        if (!config.enabled) return { ok: false, error: '插件内核已在 plugins.json 中禁用' };
        runtimeEnabled.set(key, true);
        const existing = entryById.get(key);
        if (existing?.status === 'active') return { ok: true, plugin: summarize(existing) };
        const desc = await buildInstance(key);
        if (!desc.ok) {
          audit.append('enable-failed', { plugin: key, error: desc.error });
          return { ok: false, error: desc.error };
        }
        const entry = existing ?? createEntry(key);
        if (existing) await disposeEntry(existing);
        commit(entry, desc);
        indexEntry(entry);
        audit.append('enable', { plugin: key, status: entry.status });
        return { ok: true, plugin: summarize(entry) };
      });
    },

    /** 停用：只改本次进程的运行态，不写 plugins.json。 */
    disable(id) {
      const key = String(id);
      return withLock(async () => {
        const existing = entryById.get(key);
        if (!existing) return { ok: false, error: `插件不存在: ${key}` };
        runtimeEnabled.set(key, false);
        await disposeEntry(existing);
        existing.status = 'disabled';
        existing.updatedAt = isoNow();
        audit.append('disable', { plugin: key });
        return { ok: true, plugin: summarize(existing) };
      });
    },

    /** 安装插件：kind='dir' 传本地目录，kind='zip' 传 Buffer。 */
    install({ kind = 'dir', source } = {}) {
      return withLock(() => doInstall({ kind, source }));
    },

    /** 卸载插件：目录进 state/_trash，实例被拆掉。 */
    uninstall(id) {
      return withLock(() => doUninstall(String(id)));
    },

    /**
     * 控制台改配置：只接受白名单字段（watch / filters.inbound / limits / install.enabled /
     * persona.provider / plugins.<id>.enabled），校验失败整份不落盘。
     * 生效边界：watch、filters、limits、install 立即生效；persona.provider 与插件 enabled 需重启。
     */
    async updateSettings(patch = {}) {
      if (!isPlainObject(patch)) return { ok: false, error: '请求体必须是对象' };
      const raw = serializeConfig(config);
      if (patch.watch !== undefined) raw.watch = patch.watch;
      if (isPlainObject(patch.filters) && patch.filters.inbound !== undefined) raw.filters.inbound = patch.filters.inbound;
      if (isPlainObject(patch.limits)) {
        for (const key of Object.keys(LIMIT_SPECS)) {
          if (patch.limits[key] !== undefined) raw.limits[key] = patch.limits[key];
        }
      }
      if (isPlainObject(patch.install) && patch.install.enabled !== undefined) raw.install.enabled = patch.install.enabled;
      if (isPlainObject(patch.persona) && patch.persona.provider !== undefined) raw.persona.provider = patch.persona.provider;
      if (isPlainObject(patch.plugins)) {
        for (const [id, entry] of Object.entries(patch.plugins)) {
          if (!isPlainObject(entry) || entry.enabled === undefined) continue;
          raw.plugins[id] = { ...(raw.plugins[id] ?? { config: {} }), enabled: entry.enabled };
        }
      }

      const { config: next, warnings } = normalizeConfig(raw);
      if (warnings.length) return { ok: false, error: warnings.join('；'), warnings };
      const file = path.join(rootDir, PLUGIN_CONFIG_FILE);
      try {
        writeConfigFile(file, next);
      } catch (error) {
        return { ok: false, error: `写入 ${PLUGIN_CONFIG_FILE} 失败：${error?.message ?? error}` };
      }

      const watchChanged = next.watch !== config.watch;
      Object.assign(config, next);
      if (watchChanged) {
        if (config.watch) startWatching();
        else stopWatching();
      }
      const restartRequired = Boolean(patch.persona || patch.plugins);
      audit.append('settings', { detail: Object.keys(patch).join(',') });
      return { ok: true, config: serializeConfig(config), restartRequired, warnings: [] };
    },

    config,
  };
}
