// 插件清单校验（docs/PLUGIN_KERNEL.md §3）。
//
// 纯函数、不碰文件系统：这样单测不需要造目录，桥接启动时也只在「读文件」这一层失败。
// 校验原则是「宁可拒绝，也不半加载」——清单有一处不合法，插件就不该跑起来。
import path from 'node:path';

export const API_VERSION = 1;

export const KNOWN_PERMISSIONS = Object.freeze(['state', 'persona:provide', 'prompt:provide', 'send:qq', 'net:http', 'commands']);

export const KNOWN_HOOKS = Object.freeze(['onInbound', 'onPromptBuild', 'onAfterSend', 'onShutdown']);

// id 同时是目录名与审计里的标识，限制得窄一点：避免大小写不敏感文件系统上的歧义。
export const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

const VERSION_RE = /^\d+\.\d+\.\d+$/;

/**
 * @param {unknown} raw    plugin.json 解析后的对象
 * @param {string} dirName 插件目录名（必须与 id 一致）
 * @returns {{ ok: true, errors: string[], manifest: object } | { ok: false, errors: string[], manifest: null }}
 */
export function validateManifest(raw, dirName) {
  const errors = [];
  const fail = (message) => errors.push(message);

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['plugin.json 必须是 JSON 对象'], manifest: null };
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!PLUGIN_ID_RE.test(id)) {
    fail('id 必须是 2–40 位小写字母/数字/连字符，且以字母开头');
  } else if (id !== dirName) {
    fail(`id "${id}" 与目录名 "${dirName}" 不一致`);
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name || name.length > 60) fail('name 必须是 1–60 字符');

  const version = typeof raw.version === 'string' ? raw.version.trim() : '';
  if (!VERSION_RE.test(version)) fail('version 必须是 x.y.z');

  const main = typeof raw.main === 'string' ? raw.main.trim() : '';
  if (!main) {
    fail('main 不能为空');
  } else if (path.isAbsolute(main) || main.split(/[\\/]+/).includes('..')) {
    fail('main 必须是插件目录内的相对路径');
  } else if (!/\.(mjs|js)$/i.test(main)) {
    fail('main 必须是 .mjs 或 .js');
  }

  if (raw.apiVersion !== API_VERSION) fail(`apiVersion 只接受 ${API_VERSION}`);

  const permissions = raw.permissions;
  if (!Array.isArray(permissions)) {
    fail('permissions 必须是数组');
  } else {
    for (const permission of permissions) {
      if (!KNOWN_PERMISSIONS.includes(permission)) fail(`未知权限 "${permission}"`);
    }
  }

  const hooks = raw.hooks === undefined ? [] : raw.hooks;
  if (!Array.isArray(hooks)) {
    fail('hooks 必须是数组');
  } else {
    for (const hook of hooks) {
      if (!KNOWN_HOOKS.includes(hook)) fail(`未知钩子 "${hook}"`);
    }
  }

  const description = raw.description === undefined ? '' : raw.description;
  if (typeof description !== 'string' || description.length > 200) {
    fail('description 必须是不超过 200 字符的字符串');
  }

  if (errors.length) return { ok: false, errors, manifest: null };

  return {
    ok: true,
    errors: [],
    manifest: Object.freeze({
      id,
      name,
      version,
      main,
      apiVersion: API_VERSION,
      permissions: Object.freeze([...new Set(permissions)]),
      hooks: Object.freeze([...new Set(hooks)]),
      description,
    }),
  };
}

/** 把清单里的 main 解析成绝对路径，并保证它没有越出插件目录。 */
export function resolveMainPath(pluginDir, main) {
  const absolute = path.resolve(pluginDir, main);
  const relative = path.relative(pluginDir, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`main 越出插件目录: ${main}`);
  }
  return absolute;
}
