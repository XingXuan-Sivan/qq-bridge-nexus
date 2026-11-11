#!/usr/bin/env node
// build-capability-artifacts.mjs — 把 dsh/agent-presets/<id>/capability.yml 渲染成
// 同目录的 preset.yml / agent.cordis.yml / extensions.yml（三份都是生成物，勿手改）。
//
// 链路：
//   capability.yml（人写/控制台改）
//     → 本脚本 → preset.yml + agent.cordis.yml + extensions.yml
//       → build-agent-preset-patches.mjs → dsh-bundles/qq-agent-presets/presets/<id>.patch.yml
//         → setup-dsh 安装进 profile
//
// 用法：
//   node scripts/build-capability-artifacts.mjs            # 生成/刷新
//   node scripts/build-capability-artifacts.mjs --check     # 只校验，不一致 exit 1
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { loadCapabilityFile } from '../src/capabilities/file.mjs';
import { writeArtifacts } from '../src/capabilities/build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');
export const PRESET_ROOT = path.join(REPO_ROOT, 'dsh', 'agent-presets');

/** 找出所有带 capability.yml 的预设目录。 */
export function capabilityDirs() {
  if (!fs.existsSync(PRESET_ROOT)) return [];
  return fs.readdirSync(PRESET_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(PRESET_ROOT, name, 'capability.yml')));
}

/** 保留既有的展示顺序：读旧 preset.yml 的 order，读不到用 100。 */
function existingOrder(dir) {
  const file = path.join(dir, 'preset.yml');
  if (!fs.existsSync(file)) return 100;
  try {
    const value = parseYaml(fs.readFileSync(file, 'utf8')) ?? {};
    const order = Number(value.order);
    return Number.isFinite(order) ? order : 100;
  } catch {
    return 100;
  }
}

/** 生成（或校验）全部能力目录的产物。 */
export function buildCapabilityArtifacts({ check = false, log = () => {} } = {}) {
  const results = [];
  for (const name of capabilityDirs()) {
    const dir = path.join(PRESET_ROOT, name);
    const loaded = loadCapabilityFile(dir, { id: name });
    if (!loaded) continue;
    const order = existingOrder(dir);
    const files = writeArtifacts(dir, loaded.capability, { check, order });
    for (const item of files) {
      if (item.skipped) continue;
      log(`${item.changed ? (check ? '✗ 需重新生成' : '✓ 已生成') : '· 已是最新'} ${path.relative(REPO_ROOT, item.file)}`);
    }
    results.push({ name, changed: files.some((item) => item.changed) });
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const results = buildCapabilityArtifacts({ check, log: (line) => console.log(`[capability-artifacts] ${line}`) });
  const stale = results.filter((item) => item.changed);
  if (!results.length) console.log('[capability-artifacts] 没有 capability.yml，跳过');
  else if (check && stale.length > 0) {
    console.error(`[capability-artifacts] ERROR: ${stale.length} 个预设的产物与 capability.yml 不一致；请运行 node scripts/build-capability-artifacts.mjs`);
    process.exit(1);
  }
  console.log('[capability-artifacts] Done');
}
