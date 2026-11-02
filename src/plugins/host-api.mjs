// 每个插件拿到的 ctx（docs/PLUGIN_KERNEL.md §7）。
//
// 权限在这里收口：没申请的权限，ctx 上**根本不存在**对应属性。
// 这样插件越权时是 `TypeError`，而不是「调用成功但被内核忽略」——后者会让插件作者
// 以为能力可用，直到线上才发现没生效。
import fs from 'node:fs';
import path from 'node:path';

const STATE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const MAX_HTTP_BYTES = 256 * 1024;

export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertSafeUrl(rawUrl) {
  const url = new URL(String(rawUrl));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`只允许 http/https，收到 ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  // 云元数据与链路本地：插件没有理由访问，直接拒绝（环回地址仍然允许，soulkit 就在本机）。
  if (host === 'metadata.google.internal' || host === 'metadata' || /^169\.254\./.test(host)) {
    throw new Error(`拒绝访问链路本地/元数据地址: ${host}`);
  }
  return url;
}

/**
 * @param {object} options
 * @param {string} options.id
 * @param {string} options.version
 * @param {string[]} options.permissions
 * @param {object} options.config
 * @param {string} options.stateDir      桥接的 state 根目录
 * @param {(message: string) => void} options.log
 * @param {object} options.deps          { registerPersona, unregisterPersona, sendToQQ, hasSession, fetch, now, random }
 */
export function createHostApi({ id, version, permissions, config, stateDir, log, deps }) {
  const granted = new Set(permissions);
  const pluginStateDir = path.join(stateDir, 'plugins', id);
  const fetchImpl = deps.fetch ?? globalThis.fetch;

  const ctx = {
    id,
    version,
    log: (message) => log(`[plugin:${id}] ${message}`),
    config: deepFreeze(structuredClone(config ?? {})),
    now: () => (typeof deps.now === 'function' ? deps.now() : Date.now()),
    random: () => (typeof deps.random === 'function' ? deps.random() : Math.random()),
  };

  if (granted.has('state')) {
    ctx.state = {
      read(name) {
        if (!STATE_NAME_RE.test(String(name))) throw new Error(`非法状态名: ${name}`);
        const file = path.join(pluginStateDir, `${name}.json`);
        try {
          return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (error) {
          if (error?.code === 'ENOENT') return null;
          throw error;
        }
      },
      write(name, value) {
        if (!STATE_NAME_RE.test(String(name))) throw new Error(`非法状态名: ${name}`);
        fs.mkdirSync(pluginStateDir, { recursive: true });
        const file = path.join(pluginStateDir, `${name}.json`);
        const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
        fs.renameSync(temporary, file);
      },
    };
  }

  if (granted.has('persona:provide')) {
    ctx.persona = {
      register: (provider) => deps.registerPersona(provider, id),
      unregister: () => deps.unregisterPersona(id),
    };
  }

  if (granted.has('send:qq')) {
    ctx.qq = {
      async send(key, text) {
        const target = String(key ?? '');
        if (!deps.hasSession?.(target)) throw new Error(`未知会话: ${target}`);
        if (!text) return;
        await deps.sendToQQ(target, String(text));
      },
    };
  }

  if (granted.has('net:http')) {
    ctx.http = {
      async fetchJson(rawUrl, options = {}) {
        const url = assertSafeUrl(rawUrl);
        const timeoutMs = Math.max(200, Math.min(10000, Number(options.timeoutMs) || 2000));
        const response = await fetchImpl(url.href, {
          method: options.method ?? 'GET',
          headers: options.headers,
          body: options.body,
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
        // 重定向目标也可能落在被禁网段，落地后再查一次。
        if (response.url) assertSafeUrl(response.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = Buffer.from(await response.arrayBuffer());
        if (body.length > MAX_HTTP_BYTES) throw new Error(`响应超过 ${MAX_HTTP_BYTES} 字节`);
        return JSON.parse(body.toString('utf8'));
      },
    };
  }

  return ctx;
}
