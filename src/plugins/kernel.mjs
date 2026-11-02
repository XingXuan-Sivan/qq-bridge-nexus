// 插件内核（docs/PLUGIN_KERNEL.md §2/§5/§6/§12）。
//
// 内核的职责只有四件事：发现并校验插件、把钩子分发给它们、给人格 provider 一个注册表、
// 在出错时保证主链不受影响。它**不认识**任何具体插件，也不解释插件的配置字段。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest, resolveMainPath, KNOWN_HOOKS } from './manifest.mjs';
import { loadConfig, PLUGIN_CONFIG_FILE } from './config.mjs';
import { createAuditLog } from './audit.mjs';
import { createPersonaRegistry } from './persona.mjs';
import { createHostApi } from './host-api.mjs';

const DISPOSE_TIMEOUT_MS = 2000;

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

  const audit = createAuditLog({
    file: path.join(stateDir, 'plugin-audit.jsonl'),
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

  function addEntry(id) {
    const entry = {
      id,
      name: id,
      version: null,
      status: 'invalid',
      error: null,
      manifest: null,
      hooks: [],
      stats: { hookCalls: 0, hookErrors: 0, lastHookAt: null, lastErrorAt: null },
      dispose: null,
    };
    entries.push(entry);
    entryById.set(id, entry);
    return entry;
  }

  async function loadOne(pluginRoot, dirName) {
    const entry = addEntry(dirName);
    const pluginDir = path.join(pluginRoot, dirName);
    const manifestFile = path.join(pluginDir, 'plugin.json');

    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch (error) {
      entry.error = `读取 plugin.json 失败: ${error?.message ?? error}`;
      audit.append('error', { plugin: dirName, error: entry.error });
      return;
    }

    const checked = validateManifest(raw, dirName);
    if (!checked.ok) {
      entry.error = checked.errors.join('；');
      audit.append('error', { plugin: dirName, error: entry.error });
      logLine(`⚠️ [plugins] ${dirName} 清单不合法：${entry.error}`);
      return;
    }

    const manifest = checked.manifest;
    entry.manifest = manifest;
    entry.name = manifest.name;
    entry.version = manifest.version;

    if (config.plugins[dirName]?.enabled === false) {
      entry.status = 'disabled';
      return;
    }

    let mainPath;
    try {
      mainPath = resolveMainPath(pluginDir, manifest.main);
    } catch (error) {
      entry.error = error.message;
      return;
    }
    if (!fs.existsSync(mainPath)) {
      entry.error = `入口不存在: ${manifest.main}`;
      return;
    }

    let mod;
    try {
      mod = await import(pathToFileURL(mainPath).href);
    } catch (error) {
      entry.status = 'failed';
      entry.error = `import 失败: ${error?.message ?? error}`;
      audit.append('error', { plugin: dirName, error: entry.error });
      logLine(`⚠️ [plugins] ${dirName} 加载失败：${entry.error}`);
      return;
    }

    const activate = mod.activate ?? mod.default?.activate;
    if (typeof activate !== 'function') {
      entry.status = 'failed';
      entry.error = '入口必须导出 activate(ctx)';
      audit.append('error', { plugin: dirName, error: entry.error });
      return;
    }

    const ctx = createHostApi({
      id: dirName,
      version: manifest.version,
      permissions: manifest.permissions,
      config: config.plugins[dirName]?.config ?? {},
      stateDir,
      log: logLine,
      deps: {
        // provider 白名单：plugins.json 里指定了 persona.provider 时，只接受那一个 id。
        // 多个插件都声明 persona:provide 是允许的，但同一时刻只能有一个生效。
        registerPersona: (provider, pluginId) => {
          const wanted = config.persona.provider;
          if (wanted && wanted !== provider?.id) {
            logLine(`[plugins] ${pluginId} 的人格 provider "${provider?.id}" 未在 plugins.json 的 persona.provider 中启用，已忽略`);
            return;
          }
          persona.register(provider, pluginId);
        },
        unregisterPersona: (pluginId) => persona.unregister(pluginId),
        sendToQQ: deps.sendToQQ,
        hasSession: deps.hasSession,
        fetch: deps.fetch,
        now: deps.now,
        random: deps.random,
      },
    });

    try {
      const result = await activate(ctx);
      entry.status = 'active';

      if (result && typeof result === 'object') {
        if (typeof result.dispose === 'function') entry.dispose = result.dispose;
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
          // 同一插件同名钩子只允许注册一次：重复注册会让审计里的调用计数失真。
          if (entry.hooks.includes(hookName)) continue;
          hookIndex.get(hookName).push({ id: dirName, handler });
          entry.hooks.push(hookName);
        }
      }

      audit.append('activate', { plugin: dirName, version: manifest.version });
      logLine(`[plugins] 已加载 ${dirName}@${manifest.version}${entry.hooks.length ? `（${entry.hooks.join('/')}）` : ''}`);
    } catch (error) {
      entry.status = 'failed';
      entry.error = `activate 失败: ${error?.message ?? error}`;
      audit.append('error', { plugin: dirName, error: entry.error });
      logLine(`⚠️ [plugins] ${dirName} 启用失败：${entry.error}`);
    }
  }

  async function init() {
    for (const warning of warnings) logLine(`⚠️ [plugins] ${warning}`);
    if (!config.enabled) {
      logLine('[plugins] 已在 plugins.json 中禁用，不加载任何插件');
      return;
    }

    const pluginRoot = path.join(rootDir, config.dir);
    let names;
    try {
      names = fs.readdirSync(pluginRoot, { withFileTypes: true })
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
      await loadOne(pluginRoot, name);
    }
  }

  /** 分发一个钩子；每个钩子独立超时 + 捕获，返回各插件的结果（失败的不返回）。 */
  async function callHook(hookName, payload) {
    const list = hookIndex.get(hookName) ?? [];
    const results = [];
    for (const { id, handler } of list) {
      const entry = entryById.get(id);
      if (entry) {
        entry.stats.hookCalls += 1;
        entry.stats.lastHookAt = new Date().toISOString();
      }
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
          entry.stats.lastErrorAt = new Date().toISOString();
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
      plugins: entries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        version: entry.version,
        status: entry.status,
        error: entry.error,
        hooks: [...entry.hooks],
        counters: { ...entry.stats },
      })),
    };
  }

  async function shutdown() {
    for (const entry of entries) {
      if (entry.status !== 'active') continue;
      try {
        if (entry.dispose) {
          await withTimeout(Promise.resolve().then(() => entry.dispose()), DISPOSE_TIMEOUT_MS, `${entry.id}.dispose`);
        }
      } catch (error) {
        logLine(`⚠️ [plugins] ${entry.id} 清理失败：${error?.message ?? error}`);
      }
      entry.status = 'stopped';
    }
    await callHook('onShutdown', {});
    audit.append('deactivate', { plugins: entries.filter((entry) => entry.status === 'stopped').map((entry) => entry.id) });
  }

  return {
    init,
    notify,
    promptAdditions,
    personaResolve,
    personaWarm,
    status,
    shutdown,
    config,
  };
}
