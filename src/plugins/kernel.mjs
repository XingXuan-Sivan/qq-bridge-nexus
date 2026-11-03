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
import { validateManifest, resolveMainPath, KNOWN_HOOKS } from './manifest.mjs';
import { loadConfig, PLUGIN_CONFIG_FILE } from './config.mjs';
import { createAuditLog } from './audit.mjs';
import { createPersonaRegistry } from './persona.mjs';
import { createHostApi } from './host-api.mjs';

const DISPOSE_TIMEOUT_MS = 2000;
const AUDIT_TAIL_BYTES = 64 * 1024;
const AUDIT_TAIL_LINES = 200;

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
      raw = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
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

    const pending = { hooks: [], personas: [] };
    const ctx = createHostApi({
      id: dirName,
      version: manifest.version,
      permissions: manifest.permissions,
      config: config.plugins[dirName]?.config ?? {},
      stateDir,
      log: logLine,
      deps: {
        registerPersona: (provider, pluginId) => pending.personas.push({ provider, pluginId }),
        unregisterPersona: (pluginId) => persona.unregister(pluginId),
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

    return { ok: true, status: 'active', manifest, hooks: pending.hooks, personas: pending.personas, dispose };
  }

  /** 提交实例：替换元数据、挂钩子、注册 provider。调用前必须已经 dispose 旧实例。 */
  function commit(entry, desc) {
    entry.manifest = desc.manifest;
    entry.name = desc.manifest.name;
    entry.version = desc.manifest.version;
    entry.status = desc.status;
    entry.error = null;
    entry.hooks = [];
    entry.dispose = desc.dispose ?? null;
    entry.updatedAt = isoNow();

    if (desc.status === 'active') {
      for (const { name, handler } of desc.hooks) {
        hookIndex.get(name).push({ id: entry.id, handler });
        entry.hooks.push(name);
      }
      for (const { provider, pluginId } of desc.personas) commitPersona(provider, pluginId);
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
      status: entry.status,
      error: entry.error,
      hooks: [...entry.hooks],
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
        .filter((dirent) => dirent.isDirectory())
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
  }

  /** 分发一个钩子；每个钩子独立超时 + 捕获，返回各插件的结果（失败的不返回）。 */
  async function callHook(hookName, payload) {
    // 快照：管理动作可能在分发过程中改 hookIndex，直接遍历会漏掉或重复调用。
    const list = [...(hookIndex.get(hookName) ?? [])];
    const results = [];
    for (const { id, handler } of list) {
      const entry = entryById.get(id);
      if (!entry || entry.status !== 'active') continue;
      entry.stats.hookCalls += 1;
      entry.stats.lastHookAt = isoNow();
      const startedAt = Date.now();
      try {
        const value = await withTimeout(
          Promise.resolve().then(() => handler(payload)),
          config.limits.hookTimeoutMs,
          `${id}.${hookName}`,
        );
        if (value !== undefined) results.push({ id, value });
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
      }
    }
    return results;
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

  /** 唤醒时把人格卡刷新一次（异步、有超时、失败保留旧缓存）。 */
  function personaWarm(key, options) {
    return persona.warm(key, options);
  }

  function status() {
    const personaStatus = persona.status();
    return {
      enabled: config.enabled,
      dir: config.dir,
      limits: { ...config.limits },
      audit: { enabled: config.audit.enabled, file: 'state/plugin-audit.jsonl', maxBytes: config.audit.maxBytes, keep: config.audit.keep },
      // provider 的基本信息平铺在 persona 下（控制台不用再往下挖一层），但不再保留一份嵌套副本。
      persona: {
        ...(personaStatus.provider ?? {}),
        keys: personaStatus.keys,
        cards: personaStatus.cards,
        stale: personaStatus.stale,
        degraded: personaStatus.degraded,
        lastError: personaStatus.lastError,
        lastErrorAt: personaStatus.lastErrorAt,
        lastRefreshAt: personaStatus.lastRefreshAt,
        failures: personaStatus.failures,
      },
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

  async function shutdown() {
    // 先发 onShutdown 再拆实例：钩子还挂在索引上，插件才能在退出前做最后一次清理。
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

    config,
  };
}
