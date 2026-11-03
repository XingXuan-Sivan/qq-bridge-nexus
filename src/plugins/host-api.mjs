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
 * @param {object} options.deps          { registerPersona, unregisterPersona, registerPluginCommand, sendToQQ, hasSession, fetch, now, random }
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

  if (granted.has('commands')) {
    // 插件命令统一打上来源与 pluginId：内置永远优先，插件之间按 pluginId 字典序；
    // 卸载/重载时内核按 pluginId 批量注销，插件不需要自己清。
    ctx.commands = {
      register: (definition) => deps.registerPluginCommand(definition, id),
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
    // requestJson 暴露状态码与 ETag，304 也算正常返回——人格 provider 的条件请求必需；
    // fetchJson 保持「只给 JSON」的旧签名，老插件不用改。
    async function requestJson(rawUrl, options = {}) {
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
      const etag = typeof response.headers?.get === 'function' ? response.headers.get('etag') : null;
      if (response.status === 304) return { status: 304, etag, json: null };
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > MAX_HTTP_BYTES) throw new Error(`响应超过 ${MAX_HTTP_BYTES} 字节`);
      return { status: response.status, etag, json: JSON.parse(body.toString('utf8')) };
    }
    ctx.http = {
      requestJson,
      async fetchJson(rawUrl, options = {}) {
        const { json } = await requestJson(rawUrl, options);
        return json;
      },
    };
  }

  return ctx;
}
