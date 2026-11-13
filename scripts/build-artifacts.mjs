#!/usr/bin/env node
// build-artifacts.mjs — Agent 平台产物的通用构建调度器（P1）。
//
// 只做两件事：发现适配器、把 planArtifacts 的结果写盘（或只比对）。它**不知道**任何 DSH 细节：
// 「产物长什么样」全在 profiles/agent-platforms/<id>/adapters/build.mjs 里。
//
// 用法：
//   node scripts/build-artifacts.mjs                # 构建所有已实现 build 适配器的平台
//   node scripts/build-artifacts.mjs dsh            # 只构建指定平台
//   node scripts/build-artifacts.mjs all --check    # 只校验（与产物不一致 → exit 1，不写盘）
//   node scripts/build-artifacts.mjs --quiet        # 只输出错误（供 CI 的 verify 步骤用）
//
// 为什么要有这一层（P1 的动机）：
//   原本「生成 preset patch」是 scripts/setup-dsh.mjs 的一个环节，而 setup 会去碰 ~/.dsh、
//   调 dsh CLI。结果是**离线 CI 想校验产物就必须先伪装一台装好 DSH 的机器**，
//   于是这条校验没人跑。拆开之后本脚本零副作用（除了写仓库内的产物文件），
//   可以放心放进任何 CI 步骤。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAgentPlatforms, loadAdapter, normalizeArtifactFiles } from './agent-platform-adapters.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 构建（或校验）产物。
 * @param {{repoRoot?: string, targets?: string[]|null, check?: boolean, log?: (msg: string) => void}} options
 * @returns {Promise<{agentPlatform: string, files: {path: string, changed: boolean}[]}[]>}
 */
export async function buildArtifacts({
  repoRoot = REPO_ROOT,
  targets = null,
  check = false,
  log = () => {},
} = {}) {
  const platforms = targets ?? listAgentPlatforms(repoRoot, 'build');
  if (platforms.length === 0) {
    throw new Error(`没有发现任何 build 适配器（查找位置：profiles/agent-platforms/<id>/adapters/build.mjs，仓库根 ${repoRoot}）`);
  }
  const results = [];
  for (const agentPlatform of platforms) {
    const { mod } = await loadAdapter(repoRoot, agentPlatform, 'build');
    const planned = mod.planArtifacts({ repoRoot });
    const files = normalizeArtifactFiles(planned?.files, repoRoot);
    const platformResult = { agentPlatform, files: [] };
    for (const { path: file, content } of files) {
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      const changed = current !== content;
      if (changed && !check) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content, 'utf8');
      }
      platformResult.files.push({ path: file, changed });
      log(`${changed ? (check ? '✗ 需重新生成' : '✓ 已生成') : '· 已是最新'} [${agentPlatform}] ${path.relative(repoRoot, file)}`);
    }
    results.push(platformResult);
  }
  return results;
}

/** 是否存在与源不一致的产物（--check 的判定依据，也供测试直接调用）。 */
export function hasStale(results) {
  return results.some((result) => result.files.some((file) => file.changed));
}

// 直接执行时走 CLI；被 import 时只导出函数（测试需要后者）。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const quiet = args.includes('--quiet');
  const positional = args.filter((arg) => !arg.startsWith('--'));
  if (positional.length > 1) {
    console.error(`[build-artifacts] ERROR: 只接受一个平台参数（或用 all），收到：${positional.join(' ')}`);
    process.exit(1);
  }
  const requested = positional[0] ?? 'all';
  const targets = requested === 'all' ? null : [requested];
  buildArtifacts({ check, targets, log: quiet ? () => {} : (line) => console.log(`[build-artifacts] ${line}`) })
    .then((results) => {
      const stale = results.reduce((n, r) => n + r.files.filter((f) => f.changed).length, 0);
      if (check && stale > 0) {
        console.error(`[build-artifacts] ERROR: ${stale} 个产物与源不一致；请运行 node scripts/build-artifacts.mjs ${requested === 'all' ? '' : requested}`.trimEnd());
        process.exit(1);
      }
      console.log(`[build-artifacts] Done（${results.map((r) => r.agentPlatform).join(', ')}）`);
    })
    .catch((error) => {
      console.error(`[build-artifacts] ERROR: ${error?.message ?? error}`);
      process.exit(1);
    });
}
