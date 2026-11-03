// 插件安装/卸载的文件系统部分（docs/PLUGIN_KERNEL.md §5.2）。
//
// 内核只负责「装哪个、什么时候装」；这里负责「怎么安全地把目录放进 plugins/」：
// 暂存 → 校验 → 原子改名。校验失败时只清理暂存目录，不碰已有插件。
//
// 安全边界：
// - 源路径必须是真实目录，不接受符号链接；
// - 目录内任何符号链接都拒绝（避免把仓库外的文件带进来）；
// - 解压/复制后的总大小与文件数有上限（默认 5MB / 500 个）；
// - 目标目录已存在就拒绝，不覆盖。
import fs from 'node:fs';
import path from 'node:path';
import { extractZip } from './zip.mjs';

export const DEFAULT_MAX_PLUGIN_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 500;

function fail(message) {
  const error = new Error(message);
  error.code = 'PLUGIN_INSTALL_INVALID';
  return error;
}

export function isInsideParent(base, target) {
  const root = path.resolve(base);
  const abs = path.resolve(target);
  return abs === root || abs.startsWith(root + path.sep);
}

/** 递归检查：拒绝符号链接/非常规文件，统计大小。 */
function inspectTree(root, maxBytes) {
  const base = path.resolve(root);
  let files = 0;
  let bytes = 0;
  const walk = (dir) => {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, dirent.name);
      if (dirent.isSymbolicLink()) throw fail(`不允许符号链接：${path.relative(base, abs)}`);
      if (dirent.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!dirent.isFile()) throw fail(`不支持的文件类型：${path.relative(base, abs)}`);
      files += 1;
      if (files > MAX_FILES) throw fail(`文件数超过 ${MAX_FILES}`);
      bytes += fs.statSync(abs).size;
      if (bytes > maxBytes) throw fail(`插件超过 ${Math.round(maxBytes / 1024 / 1024)}MB`);
    }
  };
  walk(base);
  return { files, bytes };
}

export function createStaging(pluginsDir) {
  fs.mkdirSync(pluginsDir, { recursive: true });
  return fs.mkdtempSync(path.join(pluginsDir, '.staging-'));
}

export function discardStaging(staging) {
  if (!staging) return;
  fs.rmSync(staging, { recursive: true, force: true });
}

/** 从服务器本地目录暂存一份副本。 */
export function stageFromDirectory({ pluginsDir, sourcePath, maxBytes = DEFAULT_MAX_PLUGIN_BYTES }) {
  const source = path.resolve(String(sourcePath ?? ''));
  let stat;
  try {
    stat = fs.lstatSync(source);
  } catch {
    throw fail('源目录不存在');
  }
  if (stat.isSymbolicLink()) throw fail('源路径不能是符号链接');
  if (!stat.isDirectory()) throw fail('源路径必须是目录');
  inspectTree(source, maxBytes);
  const staging = createStaging(pluginsDir);
  try {
    const dir = path.join(staging, 'plugin');
    fs.cpSync(source, dir, { recursive: true, dereference: false });
    return { staging, dir };
  } catch (error) {
    discardStaging(staging);
    throw error;
  }
}

/** 从 zip 字节流解压并定位插件根目录。 */
export function stageFromZip({ pluginsDir, buffer, maxBytes = DEFAULT_MAX_PLUGIN_BYTES }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw fail('没有收到 zip 内容');
  const staging = createStaging(pluginsDir);
  const unpacked = path.join(staging, 'unzip');
  try {
    fs.mkdirSync(unpacked, { recursive: true });
    extractZip(buffer, unpacked, { maxBytes, maxEntries: MAX_FILES });
    const roots = [];
    if (fs.existsSync(path.join(unpacked, 'plugin.json'))) roots.push(unpacked);
    else {
      for (const dirent of fs.readdirSync(unpacked, { withFileTypes: true })) {
        if (!dirent.isDirectory()) continue;
        const candidate = path.join(unpacked, dirent.name);
        if (fs.existsSync(path.join(candidate, 'plugin.json'))) roots.push(candidate);
      }
    }
    if (roots.length !== 1) throw fail('zip 里必须恰好有一个含 plugin.json 的插件目录');
    inspectTree(roots[0], maxBytes);
    return { staging, dir: roots[0] };
  } catch (error) {
    discardStaging(staging);
    throw error;
  }
}

/** 卸载时把插件目录移到 state/_trash（不硬删）。 */
export function moveDirToTrash({ pluginsDir, trashRoot, id }) {
  const source = path.join(pluginsDir, id);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(trashRoot, { recursive: true });
  const target = path.join(trashRoot, `plugins-${id}-${stamp}`);
  try {
    fs.renameSync(source, target);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    fs.cpSync(source, target, { recursive: true, dereference: false });
    fs.rmSync(source, { recursive: true, force: true });
  }
  return target;
}
