// 每个插件拿到的 ctx（docs/PLUGIN_KERNEL.md §7）。
//
// 权限在这里收口：没申请的权限，ctx 上**根本不存在**对应属性。
// 这样插件越权时是 `TypeError`，而不是「调用成功但被内核忽略」——后者会让插件作者
// 以为能力可用，直到线上才发现没生效。
import fs from 'node:fs';
import path from 'node:path';

import { normalizeSegments } from '../user-side/segments.mjs';

const STATE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const MAX_HTTP_BYTES = 256 * 1024;

/** 出参只收「字符串 / 单个段 / 段数组」，出口统一成中立段数组。 */
function toSegments(payload) {
  if (typeof payload === 'string') return normalizeSegments([{ type: 'text', data: { text: payload } }]);
  if (Array.isArray(payload)) return normalizeSegments(payload);
  if (payload && typeof payload === 'object' && typeof payload.type === 'string') return normalizeSegments([payload]);
  if (payload === null || payload === undefined) return [];
  throw new Error('send 只接受字符串、单个消息段或消息段数组');
}

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

  if (granted.has('memory:provide')) {
    // 记忆 provider：与 persona 同构，注册先进 staging，activate 成功后才入表；
    // 内核按 pluginId 批量注销，插件不需要自己清。
    ctx.memory = {
      registerProvider: (provider) => deps.registerMemory(provider, id),
      unregisterProvider: () => deps.unregisterMemory(id),
    };
  }

  if (granted.has('commands')) {
    // 插件命令统一打上来源与 pluginId：内置永远优先，插件之间按 pluginId 字典序；
    // 卸载/重载时内核按 pluginId 批量注销，插件不需要自己清。
    ctx.commands = {
      register: (definition) => deps.registerPluginCommand(definition, id),
    };
  }

  if (granted.has('prompt:provide')) {
    // 具名注入块：与 persona 一样，注册先进 staging，activate 成功后才入表。
    ctx.prompt = {
      registerBlock: (definition) => deps.registerPromptBlock(definition, id),
    };
  }

  if (granted.has('task-type:provide')) {
    // 定时任务类型：注册后控制台能选到，执行时由内核把任务交给插件的 run()。
    ctx.scheduler = {
      registerTaskType: (definition) => deps.registerTaskType(definition, id),
    };
  }

  if (granted.has('adapters:provide')) {
    // 两端适配器：平台/Agent 的描述性注册，卸载时内核按 pluginId 批量清。
    ctx.adapters = {
      register: (kind, adapter) => deps.registerAdapter?.(kind, adapter, id),
      unregister: () => deps.unregisterAdapters?.(id),
    };
  }

  if (granted.has('transport:provide')) {
    // 插件提供 UserPlatform 实现（连接/发送）。内核只把**已校验、已降级**的段
    // 交给它的 send；能力声明由它自己报，内核不允许它扩大已声明能力（§5.3）。
    ctx.userPlatforms = {
      register: (definition) => deps.registerTransport?.(definition, id),
      list: () => deps.listTransports?.() ?? [],
    };
  }

  if (granted.has('agent-provider:provide')) {
    // 插件提供 Agent 平台（执行体）。与 transport 同形，但多一道校验：注册时要给出
    // `resolveLevelPlan`（级别 → 权限档）与 `createRuntime`（连接层），少了就直接拒 ——
    // 「能被选为当前执行体」是个承诺，不能等到被选中的那一刻才验。
    // 能力位同理不由插件自证：它声明的 `capabilities` 只是描述，真正的闸门是 port 装配。
    ctx.agentPlatforms = {
      register: (definition) => deps.registerAgentProvider?.(definition, id),
      list: () => deps.listAgentPlatforms?.() ?? [],
    };
  }

  if (granted.has('send:message')) {
    // 出站：插件只能给「文本或中立段」，准入、段校验、能力降级全在内核里。
    // 旧名 ctx.qq 指向同一对象：0.1.x 插件按 send:qq 申请的就是这段能力。
    const message = {
      async send(key, payload, options = {}) {
        const target = String(key ?? '').trim();
        if (!target) throw new Error('send: 会话 key 不能为空');
        if (!deps.hasSession?.(target)) throw new Error(`未知会话: ${target}`);
        const segments = toSegments(payload);
        if (!segments.length) return null;
        const result = await deps.sendMessage(target, segments, options);
        return result?.messageId ?? null;
      },
    };
    ctx.message = message;
    ctx.qq = message;
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
