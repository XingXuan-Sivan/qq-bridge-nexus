// Agent 平台适配器发现（P1）。
//
// 约定：每个 Agent 平台的构建/安装能力放在自己的目录下，文件名固定
//   profiles/agent-platforms/<id>/adapters/build.mjs
//   profiles/agent-platforms/<id>/adapters/install.mjs
//
// 这是「约定优于声明」：不在脚本里维护一份平台清单，也不 import src/profiles/paths.mjs
// （那会把 scripts/ 和 src/ 绑在一起，离线夹具只需要拷 scripts/ 的子集）。
// 新增一个平台 = 在 profiles/agent-platforms/<id>/ 下放这两个文件，调度器自动发现。
//
// 注意：这里刻意不读 profiles/agent-platforms/<id>/agent-platform.yml。
// 该文件是给控制台/校验用的数据，不是给调度器用的配置——读取它会引入「平台目录存在但
// yml 写坏 ⇒ 整个构建链挂掉」的耦合。适配器文件存在本身就是最可靠的存在性证明。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ADAPTER_KINDS = Object.freeze(['build', 'install']);

/** 与 src/platforms/adapter-registry.mjs 的 ID_RE 保持一致：平台 id 只能是目录名，不能是路径。 */
const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

export function agentPlatformsRoot(repoRoot) {
  return path.join(repoRoot, 'profiles', 'agent-platforms');
}

export function adapterFile(repoRoot, agentPlatform, kind) {
  if (!ID_RE.test(agentPlatform)) throw new Error(`agent 平台 id 不合法：${JSON.stringify(agentPlatform)}`);
  if (!ADAPTER_KINDS.includes(kind)) throw new Error(`未知适配器类型：${kind}`);
  return path.join(agentPlatformsRoot(repoRoot), agentPlatform, 'adapters', `${kind}.mjs`);
}

/**
 * 列出提供某个适配器的 Agent 平台（按目录名排序，结果稳定便于测试与日志比对）。
 * 目录里没有适配器文件不算错误——那是「这个平台还没实现这项能力」。
 */
export function listAgentPlatforms(repoRoot, kind = 'build') {
  const root = agentPlatformsRoot(repoRoot);
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && ID_RE.test(entry.name))
    .filter((entry) => fs.existsSync(path.join(root, entry.name, 'adapters', `${kind}.mjs`)))
    .map((entry) => entry.name)
    .sort();
}

/**
 * 加载并校验一个适配器。
 *
 * 校验是刻意严格的：`agentPlatform` 必须等于目录名（否则日志里会把产物归到错误平台），
 * 必需导出缺失则在加载期就报错，而不是等到跑到一半。
 */
export async function loadAdapter(repoRoot, agentPlatform, kind) {
  const file = adapterFile(repoRoot, agentPlatform, kind);
  if (!fs.existsSync(file)) {
    const known = listAgentPlatforms(repoRoot, kind);
    throw new Error(`agent 平台 ${agentPlatform} 没有 ${kind} 适配器（${path.relative(repoRoot, file)}）；`
      + `已实现 ${kind} 适配器的平台：${known.join(', ') || '（无）'}`);
  }
  const mod = await import(pathToFileURL(file).href);
  if (mod.agentPlatform !== agentPlatform) {
    throw new Error(`${path.relative(repoRoot, file)} 导出的 agentPlatform=`
      + `${JSON.stringify(mod.agentPlatform)} 与目录名 ${JSON.stringify(agentPlatform)} 不一致`);
  }
  if (kind === 'build' && typeof mod.planArtifacts !== 'function') {
    throw new Error(`${path.relative(repoRoot, file)} 缺少必需导出 planArtifacts(ctx)`);
  }
  if (kind === 'install' && typeof mod.install !== 'function') {
    throw new Error(`${path.relative(repoRoot, file)} 缺少必需导出 install(ctx)`);
  }
  return { mod, file };
}

/**
 * 归一化并校验 planArtifacts 的返回值。
 *
 * 三条硬约束，任何一条不满足都直接报错而不是「尽量写」：
 *   1. files 必须是非空数组，每项有字符串 path / content
 *   2. path 必须是绝对路径且落在 repoRoot 之内（适配器不许写穿仓库）
 *   3. 同一路径不得出现两次（后写的会静默覆盖先写的，那是数据丢失）
 */
export function normalizeArtifactFiles(files, repoRoot) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('planArtifacts 必须返回非空的 files 数组');
  }
  const root = path.resolve(repoRoot);
  const seen = new Set();
  return files.map((file, index) => {
    const label = `files[${index}]`;
    if (!file || typeof file !== 'object') throw new Error(`${label} 不是对象`);
    if (typeof file.path !== 'string' || !file.path) throw new Error(`${label}.path 缺失`);
    if (typeof file.content !== 'string') throw new Error(`${label}.content 必须是字符串`);
    const abs = path.resolve(file.path);
    const rel = path.relative(root, abs);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`${label}.path 落在仓库之外或等于仓库根：${file.path}`);
    }
    const key = process.platform === 'win32' ? abs.toLowerCase() : abs;
    if (seen.has(key)) throw new Error(`${label}.path 重复：${file.path}`);
    seen.add(key);
    return { path: abs, content: file.content };
  });
}
