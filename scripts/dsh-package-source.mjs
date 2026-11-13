// DSH 包源统一抽象：把「包在磁盘目录里」与「包内联在 app.asar 里」收成同一个接口。
//
// 上层（工具名抽取、配置校验、基线采集）只依赖 listPackages / listFiles / readFile 三件事，
// 不必知道宿主是怎么打包的；宿主换打包方式时只加一个后端，不动调用方。
//
// 后端优先级：DSH_TOOL_PACKAGES 显式覆盖 → 磁盘 node_modules → app.asar。
// asar 只读：数据起点 8 + UInt32LE(4)，header JSON 在 offset 16、长度 UInt32LE(12)，
// 且 header 里每个文件的 offset 可能是字符串。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

// ---------------------------------------------------------------------------
// 目录后端
// ---------------------------------------------------------------------------

function walkFiles(dir, rel = '', out = [], depth = 0, maxDepth = 6) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    // node_modules / .git 永远跳过：包内嵌套依赖与工具名无关，扫进去只会变慢。
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (depth < maxDepth) walkFiles(path.join(dir, e.name), childRel, out, depth + 1, maxDepth);
    } else out.push(childRel);
  }
  return out;
}

/** @returns 包集合：rootDir 下每个子目录是一个包。 */
export function directoryCollection(rootDir, { filter = null, label = rootDir } = {}) {
  return {
    kind: 'directory',
    label,
    root: rootDir,
    describe() { return `directory:${rootDir}`; },
    listPackages() {
      let entries = [];
      try { entries = fs.readdirSync(rootDir, { withFileTypes: true }); } catch { return []; }
      return entries
        .filter((e) => e.isDirectory() && (!filter || filter.test(e.name)))
        .map((e) => e.name)
        .sort();
    },
    listFiles(pkg) { return walkFiles(path.join(rootDir, pkg)); },
    readFile(pkg, rel) {
      try { return fs.readFileSync(path.join(rootDir, pkg, rel), 'utf8'); } catch { return null; }
    },
  };
}

// ---------------------------------------------------------------------------
// asar 后端（只读，按需读单文件，不解压整包）
// ---------------------------------------------------------------------------

/** Electron asar 归档的只读访问器。header 常驻内存（约 1.6 MB），文件按需 seek 读取。 */
export class AsarArchive {
  constructor(file) {
    this.file = file;
    this.fd = null;
    this.header = null;
    this.dataStart = 0;
  }

  _ensure() {
    if (this.header) return;
    const fd = fs.openSync(this.file, 'r');
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const picklesSize = head.readUInt32LE(4); // header pickle 长度（含自身 4 字节）
    const jsonLen = head.readUInt32LE(12);
    if (!picklesSize || !jsonLen || jsonLen > 64 * 1024 * 1024) {
      fs.closeSync(fd);
      throw new Error(`不是有效的 asar 归档（header 尺寸异常）：${this.file}`);
    }
    const hj = Buffer.alloc(jsonLen);
    fs.readSync(fd, hj, 0, jsonLen, 16);
    this.fd = fd;
    this.dataStart = 8 + picklesSize;
    this.header = JSON.parse(hj.toString('utf8'));
  }

  close() {
    if (this.fd !== null) { try { fs.closeSync(this.fd); } catch { /* 已关闭 */ } this.fd = null; }
  }

  /** 沿 posix 路径下钻；找不到返回 null。 */
  node(relPath) {
    this._ensure();
    let node = this.header;
    for (const seg of relPath.split('/').filter(Boolean)) {
      node = node?.files?.[seg];
      if (!node) return null;
    }
    return node;
  }

  listDir(relPath) {
    const node = this.node(relPath);
    return node?.files ? Object.keys(node.files).sort() : [];
  }

  /** 递归列出目录下的全部文件（相对该目录），跳过子 node_modules。 */
  walkDir(relPath) {
    this._ensure();
    const out = [];
    const visit = (node, rel, depth) => {
      if (!node?.files) return;
      for (const [name, child] of Object.entries(node.files)) {
        if (name === 'node_modules' || name === '.git') continue;
        const childRel = rel ? `${rel}/${name}` : name;
        if (child.files) { if (depth < 6) visit(child, childRel, depth + 1); }
        else out.push(childRel);
      }
    };
    visit(this.node(relPath), '', 0);
    return out;
  }

  /** 读单个文件；`unpacked` 回落到 `.unpacked` 目录。 */
  readFile(relPath) {
    this._ensure();
    const node = this.node(relPath);
    if (!node) return null;
    if (node.unpacked) {
      try { return fs.readFileSync(`${this.file}.unpacked/${relPath}`, 'utf8'); } catch { return null; }
    }
    if (node.offset === undefined) return null;
    const offset = Number(node.offset); // 0.2.2 实测为字符串
    const size = Number(node.size);
    if (!Number.isFinite(offset) || !Number.isFinite(size)) return null;
    const buf = Buffer.alloc(size);
    fs.readSync(this.fd, buf, 0, size, this.dataStart + offset);
    return buf.toString('utf8');
  }
}

/** @returns 包集合：asar 内 innerDir 下每个子目录是一个包。 */
export function asarCollection(archive, innerDir, { filter = null, label = innerDir } = {}) {
  return {
    kind: 'asar',
    label,
    root: innerDir,
    archive,
    describe() { return `asar:${archive.file}|${innerDir}`; },
    listPackages() {
      return archive.listDir(innerDir)
        .filter((n) => !filter || filter.test(n))
        .filter((n) => archive.node(`${innerDir}/${n}`)?.files);
    },
    listFiles(pkg) { return archive.walkDir(`${innerDir}/${pkg}`); },
    readFile(pkg, rel) { return archive.readFile(`${innerDir}/${pkg}/${rel}`); },
  };
}

// ---------------------------------------------------------------------------
// 定位：优先级 & 顺序
// ---------------------------------------------------------------------------

/**
 * 候选 profile 名，按"最可能是当前这份安装"排序。
 *
 * 历史坑：这里原本是 `web → default`，在本机（桌面版，profile 名 `desktop`）会先命中
 * 一个**有 package.json 但没有 node_modules** 的空壳 web profile，于是解析失败。
 * 现在把 `desktop` 排到 `web` 前面，并让调用方打印实际选中的 profile。
 */
export function candidateProfiles(home = dshHome()) {
  const names = [];
  const add = (n) => { if (n && !names.includes(n)) names.push(n); };
  add(process.env.DSH_PROFILE);
  add('desktop');
  add('web');
  add('default');
  try {
    for (const e of fs.readdirSync(path.join(home, 'profiles'), { withFileTypes: true })) {
      if (e.isDirectory()) add(e.name);
    }
  } catch { /* 没有 profiles 目录 */ }
  return names;
}

// 这些脚本需要加载的包，任意一个能解析成功即可反推出 node_modules 位置。
const PROBE_SPECIFIERS = ['@deepseek-ai/dsh-persona', 'js-yaml'];

function findNodeModules(resolvedFile) {
  let dir = path.dirname(resolvedFile);
  for (;;) {
    if (path.basename(dir) === 'node_modules') return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** 目录后端：返回 `<profile>/node_modules`；一个都没有时返回 null（不抛错）。 */
export function directoryModulesDir() {
  const override = process.env.DSH_INSTALL_MODULES || process.env.DSH_MODULES;
  if (override) return override;

  const home = dshHome();
  for (const profile of candidateProfiles(home)) {
    const anchor = path.join(home, 'profiles', profile, 'package.json');
    if (!fs.existsSync(anchor)) continue;
    let req;
    try { req = createRequire(anchor); } catch { continue; }
    for (const spec of PROBE_SPECIFIERS) {
      try {
        const dir = findNodeModules(req.resolve(spec));
        if (dir) return dir;
      } catch { /* 换 specifier / 换 profile */ }
    }
  }
  return null;
}

/** DSH 桌面安装目录下的 app.asar 候选路径（只认存在的那一个）。 */
export function dshAppAsar() {
  const list = [
    process.env.DSH_APP_ASAR,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'DeepSeek Harness', 'resources', 'app.asar'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'DeepSeek Harness', 'resources', 'app.asar'),
  ].filter(Boolean);
  for (const p of list) {
    try { if (fs.statSync(p).isFile()) return p; } catch { /* 下一个 */ }
  }
  return null;
}

// asar 里 `@deepseek-ai` 可能出现在这两个位置（0.2.2 实测是前者）。
const ASAR_PACKAGE_ROOTS = ['dsh/node_modules/@deepseek-ai', 'node_modules/@deepseek-ai'];

/**
 * 主入口：定位 DSH 自带包的集合。
 *
 * 顺序：显式 override（DSH_TOOL_PACKAGES / 参数）→ 目录后端 → asar 后端。
 * 全失败返回 null，由调用方决定是报错还是跳过（离线 CI 应跳过而不是失败）。
 */
export function dshPackagesCollection({ packagesDir } = {}) {
  const explicit = packagesDir || process.env.DSH_TOOL_PACKAGES;
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw new Error(`DSH_TOOL_PACKAGES 指向的目录不存在：${explicit}`);
    }
    return directoryCollection(explicit, { filter: /^dsh-/, label: 'explicit' });
  }

  const mods = directoryModulesDir();
  if (mods) {
    const pkgs = path.join(mods, '@deepseek-ai');
    if (fs.existsSync(pkgs)) return directoryCollection(pkgs, { filter: /^dsh-/, label: 'profile' });
  }

  const asarFile = dshAppAsar();
  if (asarFile) {
    const archive = new AsarArchive(asarFile);
    archive._ensure();
    for (const inner of ASAR_PACKAGE_ROOTS) {
      if (archive.node(inner)?.files) {
        return asarCollection(archive, inner, { filter: /^dsh-/, label: 'app.asar' });
      }
    }
    archive.close();
  }
  return null;
}

/** 用户安装的第三方插件（也会注册工具），目录后端。 */
export function dshPluginCollections() {
  const dirs = (process.env.DSH_PLUGIN_DIRS ? process.env.DSH_PLUGIN_DIRS.split(path.delimiter) : [])
    .concat([path.join(dshHome(), 'plugins')]);
  return dirs
    .filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } })
    .map((d) => directoryCollection(d, { filter: null, label: `plugins:${d}` }));
}

/** 宿主版本：优先从 asar 里的 `dsh/package.json` 读，其次从目录后端的安装根读。 */
export function dshVersion() {
  const asarFile = dshAppAsar();
  if (asarFile) {
    try {
      const archive = new AsarArchive(asarFile);
      const text = archive.readFile('dsh/package.json');
      archive.close();
      const v = text && JSON.parse(text).version;
      if (v) return String(v);
    } catch { /* 回落 */ }
  }
  const mods = directoryModulesDir();
  if (mods) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(mods, '..', 'package.json'), 'utf8'));
      if (pkg.version) return String(pkg.version);
    } catch { /* 放弃 */ }
  }
  return null;
}
