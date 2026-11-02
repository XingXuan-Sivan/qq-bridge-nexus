// plugins.json 的读取、默认值与边界校验（docs/PLUGIN_KERNEL.md §4）。
//
// 三条规矩：
//   1. 文件不存在 = 用默认值，不是错误（新克隆的仓库不该因此启动失败）。
//   2. 任何一处越界都只影响那一项：取默认值 + 一条告警，不阻断其它配置。
//   3. 插件自己的字段内核不解释，原样交给插件（深拷贝，防止插件之间共享引用）。
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ID_RE } from './manifest.mjs';

export const PLUGIN_CONFIG_FILE = 'plugins.json';

const LIMIT_SPECS = Object.freeze({
  hookTimeoutMs: { min: 100, max: 10000, def: 2000 },
  maxPlugins: { min: 1, max: 128, def: 32 },
  maxPromptAppendChars: { min: 0, max: 20000, def: 4000 },
});

const AUDIT_SPECS = Object.freeze({
  maxBytes: { min: 64 * 1024, max: 50 * 1024 * 1024, def: 5 * 1024 * 1024 },
  keep: { min: 1, max: 10, def: 3 },
});

// provider 只决定「用哪个外部人格源」；TTL/间隔/旧卡上限是缓存策略，属于内核，不属于单个 provider。
const PERSONA_SPECS = Object.freeze({
  ttlMs: { min: 60 * 1000, max: 60 * 60 * 1000, def: 5 * 60 * 1000 },
  minRefreshGapMs: { min: 5 * 1000, max: 5 * 60 * 1000, def: 30 * 1000 },
  staleMaxMs: { min: 60 * 60 * 1000, max: 7 * 24 * 60 * 60 * 1000, def: 24 * 60 * 60 * 1000 },
});

export function defaultConfig() {
  return {
    enabled: true,
    dir: 'plugins',
    limits: {
      hookTimeoutMs: LIMIT_SPECS.hookTimeoutMs.def,
      maxPlugins: LIMIT_SPECS.maxPlugins.def,
      maxPromptAppendChars: LIMIT_SPECS.maxPromptAppendChars.def,
    },
    audit: {
      enabled: true,
      maxBytes: AUDIT_SPECS.maxBytes.def,
      keep: AUDIT_SPECS.keep.def,
    },
    // 外部人格源：null = 用第一个注册成功的 provider；填 id = 只启用该 provider（其余注册被内核忽略）。
    persona: {
      provider: null,
      cache: {
        ttlMs: PERSONA_SPECS.ttlMs.def,
        minRefreshGapMs: PERSONA_SPECS.minRefreshGapMs.def,
        staleMaxMs: PERSONA_SPECS.staleMaxMs.def,
      },
    },
    plugins: {},
  };
}

function clampInteger(value, spec, label, warnings) {
  if (value === undefined) return spec.def;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    warnings.push(`${label} 不是数字，用默认值 ${spec.def}`);
    return spec.def;
  }
  const integer = Math.trunc(number);
  if (integer < spec.min || integer > spec.max) {
    warnings.push(`${label}=${integer} 越界（${spec.min}–${spec.max}），用默认值 ${spec.def}`);
    return spec.def;
  }
  return integer;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 把任意输入（可能是 null / 坏结构）规范成可用的配置对象。
 * @returns {{ config: object, warnings: string[] }}
 */
export function normalizeConfig(raw) {
  const warnings = [];
  const config = defaultConfig();

  if (raw === null || raw === undefined) return { config, warnings };
  if (!isPlainObject(raw)) {
    warnings.push('plugins.json 必须是 JSON 对象，已用默认配置');
    return { config, warnings };
  }

  if (raw.enabled !== undefined) {
    if (typeof raw.enabled === 'boolean') config.enabled = raw.enabled;
    else warnings.push('enabled 必须是布尔值，已按 true 处理');
  }

  if (raw.dir !== undefined) {
    const dir = typeof raw.dir === 'string' ? raw.dir.trim() : '';
    if (!dir || path.isAbsolute(dir) || dir.split(/[\\/]+/).includes('..')) {
      warnings.push(`dir "${raw.dir}" 不是安全的相对目录，已用默认 plugins`);
    } else {
      config.dir = dir;
    }
  }

  const rawLimits = isPlainObject(raw.limits) ? raw.limits : {};
  for (const [key, spec] of Object.entries(LIMIT_SPECS)) {
    config.limits[key] = clampInteger(rawLimits[key], spec, `limits.${key}`, warnings);
  }

  const rawAudit = isPlainObject(raw.audit) ? raw.audit : {};
  for (const [key, spec] of Object.entries(AUDIT_SPECS)) {
    config.audit[key] = clampInteger(rawAudit[key], spec, `audit.${key}`, warnings);
  }
  if (rawAudit.enabled !== undefined) {
    if (typeof rawAudit.enabled === 'boolean') config.audit.enabled = rawAudit.enabled;
    else warnings.push('audit.enabled 必须是布尔值，已按 true 处理');
  }

  if (raw.plugins !== undefined) {
    if (!isPlainObject(raw.plugins)) {
      warnings.push('plugins 必须是对象，已忽略');
    } else {
      for (const [id, entry] of Object.entries(raw.plugins)) {
        if (!PLUGIN_ID_RE.test(id)) {
          warnings.push(`plugins 里的 "${id}" 不是合法插件 id，已忽略`);
          continue;
        }
        if (!isPlainObject(entry)) {
          warnings.push(`plugins.${id} 必须是对象，已忽略`);
          continue;
        }
        if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
          warnings.push(`plugins.${id}.enabled 必须是布尔值，已按 true 处理`);
        }
        if (entry.config !== undefined && !isPlainObject(entry.config)) {
          warnings.push(`plugins.${id}.config 必须是对象，已忽略该项`);
          continue;
        }
        config.plugins[id] = {
          enabled: entry.enabled === undefined ? true : entry.enabled !== false,
          config: structuredClone(entry.config ?? {}),
        };
      }
    }
  }

  const rawPersona = isPlainObject(raw.persona) ? raw.persona : {};
  if (rawPersona.provider !== undefined && rawPersona.provider !== null) {
    const provider = typeof rawPersona.provider === 'string' ? rawPersona.provider.trim() : '';
    if (!provider) warnings.push('persona.provider 必须是非空字符串或 null，已忽略');
    else config.persona.provider = provider;
  }
  const rawCache = isPlainObject(rawPersona.cache) ? rawPersona.cache : {};
  for (const [key, spec] of Object.entries(PERSONA_SPECS)) {
    config.persona.cache[key] = clampInteger(rawCache[key], spec, `persona.cache.${key}`, warnings);
  }

  return { config, warnings };
}

/**
 * 读文件并规范化。文件不存在不算失败；JSON 损坏会返回默认配置 + 一条告警。
 * @returns {{ config: object, warnings: string[], error?: string }}
 */
export function loadConfig(file) {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return normalizeConfig(null);
    return { ...normalizeConfig(null), error: `plugins.json 解析失败，已用默认配置：${error?.message ?? error}` };
  }
  return normalizeConfig(raw);
}
