// 外部扩展秘密：server.json 只存 secret:<name> 引用，真实值集中在这个 0600 文件里，
// 避免把 token/header 明文写进可被控制台/日志读到的扩展描述。
import fs from 'node:fs';
import path from 'node:path';

const NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const MAX_VALUE_CHARS = 8192;

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

export function createSecretStore({ file, log = () => {} }) {
  if (!file) throw new Error('createSecretStore: 缺少文件路径');
  let loaded = null;

  function readAll() {
    if (loaded) return loaded;
    try {
      const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      const parsed = JSON.parse(text);
      loaded = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      if (error?.code !== 'ENOENT') log(`[extensions] secrets 读取失败: ${error?.message ?? error}`);
      loaded = {};
    }
    return loaded;
  }

  function persist() {
    writeAtomic(file, JSON.stringify(loaded ?? {}, null, 2) + '\n');
  }

  function set(name, value) {
    if (!NAME_RE.test(String(name))) throw new Error('secret 名称不合法');
    const text = String(value ?? '');
    if (!text || text.length > MAX_VALUE_CHARS) throw new Error('secret 值不能为空或过长');
    const all = readAll();
    all[name] = text;
    persist();
    return name;
  }

  function setMany(map) {
    if (!map || typeof map !== 'object') return [];
    const names = [];
    for (const [key, value] of Object.entries(map)) names.push(set(key, value));
    return names;
  }

  function get(name) {
    const value = readAll()[name];
    return typeof value === 'string' ? value : null;
  }

  function has(name) {
    return typeof get(name) === 'string';
  }

  function names() {
    return Object.keys(readAll()).sort();
  }

  function resolve(value) {
    if (typeof value !== 'string') throw new Error('secret 引用必须是字符串');
    if (!value.startsWith('secret:')) throw new Error('秘密字段只能填写 secret:<name> 引用');
    const name = value.slice('secret:'.length);
    if (!NAME_RE.test(name)) throw new Error('secret 名称不合法');
    const found = get(name);
    if (found == null) throw new Error(`secret 未配置：${name}`);
    return found;
  }

  function materialize(map) {
    if (!map || typeof map !== 'object') return {};
    const out = {};
    for (const [key, value] of Object.entries(map)) out[key] = resolve(value);
    return out;
  }

  return { readAll, get, has, names, set, setMany, resolve, materialize };
}
