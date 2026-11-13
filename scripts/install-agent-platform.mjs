#!/usr/bin/env node
// install-agent-platform.mjs — Agent 平台安装的通用调度器（P1）。
//
// 与 build-artifacts.mjs 的分工：
//   build-artifacts      源 → 产物（零副作用，可 --check，CI 友好）
//   install-agent-platform  产物 → 运行时（碰 ~/.dsh、调 dsh CLI、幂等）
//
// 本脚本同样**不知道**任何 DSH 细节：装到哪里、怎么装、要不要调 CLI，全在
// profiles/agent-platforms/<id>/adapters/install.mjs 的 install(ctx) 里。
//
// 顺序是刻意的：先 build 再 install。这样「改了源但忘了重建产物」不会装进一份过期配置，
// 也不会出现「安装成功但 DSH 里还是旧人格」这种最难排查的失败形态。
//
// 用法：
//   node scripts/install-agent-platform.mjs dsh            # profile 自动识别
//   node scripts/install-agent-platform.mjs dsh web        # 指定 profile
//   QQ_BRIDGE_SKIP_DSH_INSTALL=1 node scripts/install-agent-platform.mjs dsh   # 跳过 dsh plugin install
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArtifacts } from './build-artifacts.mjs';
import { loadAdapter } from './agent-platform-adapters.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 构建该平台的产物，然后调用它的 install 适配器。
 * @param {{repoRoot?: string, agentPlatform: string, profile?: string, env?: NodeJS.ProcessEnv, log?: (msg: string) => void}} options
 */
export async function installAgentPlatform({
  repoRoot = REPO_ROOT,
  agentPlatform,
  profile,
  env = process.env,
  log = () => {},
} = {}) {
  if (!agentPlatform) throw new Error('install-agent-platform: 缺少 agentPlatform 参数');
  // 先重建产物（幂等）：源改了但产物没重建时，安装会装进过期配置。
  await buildArtifacts({ repoRoot, targets: [agentPlatform], log });
  const { mod } = await loadAdapter(repoRoot, agentPlatform, 'install');
  return mod.install({ repoRoot, agentPlatform, profile, env, log });
}

// 直接执行时走 CLI；被 import 时只导出函数。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [agentPlatform, profile, ...rest] = process.argv.slice(2);
  if (!agentPlatform || agentPlatform.startsWith('--') || rest.length > 0) {
    console.error('用法: node scripts/install-agent-platform.mjs <agentPlatform> [profile]');
    process.exit(1);
  }
  const log = (msg) => console.log(`[install-${agentPlatform}] ${msg}`);
  installAgentPlatform({ agentPlatform, profile, log })
    .then((result) => {
      log(`安装完成：profile=${result?.profile ?? profile ?? '(自动)'}，runtimeHome=${result?.runtimeHome ?? '(适配器未返回)'}`);
    })
    .catch((error) => {
      console.error(`[install-${agentPlatform}] ERROR: ${error?.message ?? error}`);
      process.exit(1);
    });
}
