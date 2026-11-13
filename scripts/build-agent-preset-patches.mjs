#!/usr/bin/env node
// build-agent-preset-patches.mjs — **兼容入口**（P1 起）。
//
// 真正的实现在 profiles/agent-platforms/dsh/adapters/build.mjs（DSH 平台适配器），
// 通用调度在 scripts/build-artifacts.mjs。本文件只保留旧的导出与 CLI 行为，
// 因为仓库里仍有一批脚本/测试按这个名字 import（test-agent-preset-patches、
// test-prompt-compose、verify-adaptation）。
//
// 新代码请直接用：
//   node scripts/build-artifacts.mjs [dsh] [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dsh from '../profiles/agent-platforms/dsh/adapters/build.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PRESETS = dsh.PRESETS;
export const GUARD_SPECIFIER = dsh.GUARD_SPECIFIER;
export const RELATIVE_ROW_REWRITES = dsh.RELATIVE_ROW_REWRITES;
export const presetRowId = dsh.presetRowId;
export const BUNDLE_DIR = dsh.bundleDir(REPO_ROOT);

/** 旧签名 patchFileFor(name) —— 新代码用 adapter 的 patchFileFor(repoRoot, name)。 */
export function patchFileFor(name) {
  return dsh.patchFileFor(REPO_ROOT, name);
}

/** 旧签名 renderPatch(name) —— 新代码用 adapter 的 renderPatch(repoRoot, name)。 */
export function renderPatch(name) {
  return dsh.renderPatch(REPO_ROOT, name);
}

/**
 * 旧签名 buildPatches({check, log}) —— 同步返回 [{file, changed}]。
 *
 * 直接调纯函数 planArtifacts 而不是 scripts/build-artifacts.mjs（那个是 async 的），
 * 这样老调用方不用改成 await。写盘/比对语义与通用调度器一致。
 */
export function buildPatches({ check = false, log = () => {} } = {}) {
  const { files } = dsh.planArtifacts({ repoRoot: REPO_ROOT });
  const results = [];
  for (const { path: file, content } of files) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const changed = current !== content;
    if (changed && !check) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf8');
    }
    log(`${changed ? (check ? '✗ 需重新生成' : '✓ 已生成') : '· 已是最新'} ${path.relative(REPO_ROOT, file)}`);
    results.push({ file, changed });
  }
  return results;
}

// 直接执行时：默认生成，--check 只校验。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const results = buildPatches({ check, log: (line) => console.log(`[preset-patches] ${line}`) });
  const stale = results.filter((r) => r.changed);
  if (check && stale.length > 0) {
    console.error(`[preset-patches] ERROR: ${stale.length} 个 patch 文件与源不一致；请运行 node scripts/build-artifacts.mjs dsh`);
    process.exit(1);
  }
  console.log('[preset-patches] Done');
}
