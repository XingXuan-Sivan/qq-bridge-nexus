// 最小 ZIP 读取器（只服务于插件安装，不追求完整 ZIP 规范）。
//
// 为什么不用第三方库：桥接运行时零依赖，安装插件是低频管理操作，一个 120 行的
// 中央目录解析足够覆盖「打包好的插件 zip」。明确不支持：zip64、加密、分卷、BZIP2/LZMA。
//
// 安全边界（docs/PLUGIN_KERNEL.md §5.2）：
// - 只接受普通文件；目录条目直接跳过。
// - 拒绝绝对路径、盘符、反斜杠、`..` 段、空名与重复名；解压前先规范化再校验。
// - 解压后总字节数不超过调用方给的 maxBytes（默认 5MB），条目数不超过 maxEntries。
// - 解压用 inflateRawSync 的 maxOutputLength 兜底，避免 zip bomb 把内存吃满。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function fail(message) {
  const error = new Error(message);
  error.code = 'PLUGIN_ZIP_INVALID';
  return error;
}

/** 把 zip 内的条目名规范化成安全的相对路径；不安全就抛错。 */
export function safeEntryName(rawName) {
  const name = String(rawName ?? '').replace(/\\/g, '/');
  if (!name || name === '/') throw fail('zip 内包含空文件名');
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) throw fail(`zip 内包含绝对路径：${name}`);
  const parts = name.split('/');
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') throw fail(`zip 内包含越界路径：${name}`);
  }
  const cleaned = parts.filter((part) => part && part !== '.').join('/');
  if (!cleaned) throw fail(`zip 内包含无效路径：${name}`);
  return cleaned;
}

function findEndOfCentralDirectory(buffer) {
  const min = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIG) return offset;
  }
  throw fail('不是有效的 zip 文件（找不到中央目录结尾）');
}

/**
 * 读取 zip 的条目表（不写盘）。
 * @returns {Array<{name: string, method: number, compressedSize: number, uncompressedSize: number, localOffset: number, crc32: number}>}
 */
export function listZipEntries(buffer, { maxBytes = 5 * 1024 * 1024, maxEntries = 500 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw fail('zip 内容为空或过短');
  const eocd = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const cdDisk = buffer.readUInt16LE(eocd + 6);
  if (diskNumber !== 0 || cdDisk !== 0) throw fail('不支持分卷 zip');
  const count = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw fail('不支持 zip64');
  if (count > maxEntries) throw fail(`zip 条目过多（${count} > ${maxEntries}）`);
  if (cdOffset + cdSize > buffer.length) throw fail('zip 中央目录越界');

  const entries = [];
  const seen = new Set();
  let total = 0;
  let cursor = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CD_SIG) throw fail('zip 中央目录损坏');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const crc32 = buffer.readUInt32LE(cursor + 16);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    if (nameStart + nameLen > buffer.length) throw fail('zip 条目名越界');
    const rawName = buffer.toString('utf8', nameStart, nameStart + nameLen);
    cursor = nameStart + nameLen + extraLen + commentLen;

    if (flags & 0x0001) throw fail(`zip 包含加密条目：${rawName}`);
    if (method !== 0 && method !== 8) throw fail(`zip 使用了不支持的压缩方式 ${method}：${rawName}`);
    const name = safeEntryName(rawName);
    if (name.endsWith('/')) continue;
    if (seen.has(name)) throw fail(`zip 内有重复文件：${name}`);
    seen.add(name);
    total += uncompressedSize;
    if (total > maxBytes) throw fail(`zip 解压后超过 ${Math.round(maxBytes / 1024 / 1024)}MB 限制`);
    if (compressedSize > buffer.length || localOffset + 30 > buffer.length) throw fail(`zip 条目数据越界：${name}`);
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset, crc32 });
  }
  return entries;
}

function readEntryData(buffer, entry) {
  const header = entry.localOffset;
  if (buffer.readUInt32LE(header) !== LOCAL_SIG) throw fail(`zip 本地头损坏：${entry.name}`);
  const nameLen = buffer.readUInt16LE(header + 26);
  const extraLen = buffer.readUInt16LE(header + 28);
  const start = header + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > buffer.length) throw fail(`zip 条目数据越界：${entry.name}`);
  const raw = buffer.subarray(start, end);
  if (entry.method === 0) return Buffer.from(raw);
  try {
    return zlib.inflateRawSync(raw, { maxOutputLength: Math.max(entry.uncompressedSize, 1) });
  } catch (error) {
    throw fail(`解压失败（${entry.name}）：${error?.message ?? error}`);
  }
}

/**
 * 解压到 targetDir（调用方负责创建并清理临时目录）。
 * @returns {{ files: string[], bytes: number }}
 */
export function extractZip(buffer, targetDir, options = {}) {
  const entries = listZipEntries(buffer, options);
  const root = path.resolve(targetDir);
  const files = [];
  let bytes = 0;
  for (const entry of entries) {
    const data = readEntryData(buffer, entry);
    if (data.length !== entry.uncompressedSize) throw fail(`条目长度不符：${entry.name}`);
    bytes += data.length;
    const target = path.resolve(root, entry.name);
    if (target !== root && !target.startsWith(root + path.sep)) throw fail(`zip 路径越界：${entry.name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    files.push(entry.name);
  }
  return { files, bytes };
}
