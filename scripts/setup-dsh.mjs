#!/usr/bin/env node
// setup-dsh.mjs — **兼容入口**（P1 起）。
//
// 等价于：node scripts/install-agent-platform.mjs dsh [profile]
//
// 之所以还留着这个名字：文档、控制台提示、src/presets/store.mjs 与一批测试都按
// `node scripts/setup-dsh.mjs` 调用。实际安装逻辑已在
// profiles/agent-platforms/dsh/adapters/install.mjs（DSH 平台适配器），
// 产物生成在 profiles/agent-platforms/dsh/adapters/build.mjs。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installAgentPlatform } from './install-agent-platform.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [profile] = process.argv.slice(2);

installAgentPlatform({
  repoRoot: REPO_ROOT,
  agentPlatform: 'dsh',
  profile,
  log: (msg) => console.log(`[setup-dsh] ${msg}`),
})
  // 成功时不再补一句 Done：适配器已经打印了「Done. Restart DSH…」，重复打只会让日志变噪。
  .catch((error) => {
    console.error(`[setup-dsh] ERROR: ${error?.message ?? error}`);
    process.exit(1);
  });
