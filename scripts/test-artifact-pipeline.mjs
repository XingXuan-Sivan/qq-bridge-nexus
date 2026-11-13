// 钉住 P1 的「适配器调度」契约（纯离线，不碰 ~/.dsh，不需要 DSH 在跑）：
//   1. 发现：profiles/agent-platforms/<id>/adapters/build.mjs 会被自动发现，不需要在脚本里维护平台清单；
//   2. 校验：adapter 导出的 agentPlatform 必须等于目录名，planArtifacts 返回值必须落在仓库内；
//   3. 幂等：build 两次，第二次必须「全部已是最新」；
//   4. 隔离：加一个 mock 平台不会让 dsh 的产物发生任何变化（这是「多平台」真正的验收标准）。
//
// 第 4 条是重点：它证明「新增一个 agent 平台 = 只加一个目录」，不需要改任何 scripts/ 或 src/。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  adapterFile, listAgentPlatforms, loadAdapter, normalizeArtifactFiles,
} from './agent-platform-adapters.mjs';
import { buildArtifacts, hasStale, REPO_ROOT } from './build-artifacts.mjs';

let failures = 0;
function ok(cond, label) {
  if (cond) console.log(`✅ ${label}`);
  else { failures += 1; console.error(`❌ ${label}`); }
}
function throws(fn, pattern, label) {
  try {
    fn();
    failures += 1;
    console.error(`❌ ${label}（没有抛错）`);
  } catch (error) {
    const hit = pattern.test(String(error?.message ?? error));
    if (hit) console.log(`✅ ${label}`);
    else { failures += 1; console.error(`❌ ${label}（错误信息不含 ${pattern}：${error?.message ?? error}）`); }
  }
}

console.log('## 1. 发现与校验');
{
  const builds = listAgentPlatforms(REPO_ROOT, 'build');
  ok(builds.includes('dsh'), `build 适配器里能发现 dsh（发现：${builds.join(', ')}）`);
  ok(!builds.some((id) => /[\\/]/.test(id)), '发现的平台 id 都是目录名（不含路径分隔符）');

  const { mod } = await loadAdapter(REPO_ROOT, 'dsh', 'build');
  ok(mod.agentPlatform === 'dsh', 'dsh build 适配器导出的 agentPlatform 与目录名一致');
  ok(typeof mod.planArtifacts === 'function', 'dsh build 适配器导出 planArtifacts');

  throws(() => adapterFile(REPO_ROOT, '../evil', 'build'), /id 不合法/, '平台 id 拒绝路径穿越');
  await assert.rejects(
    () => loadAdapter(REPO_ROOT, 'no-such-platform', 'build'),
    /没有 build 适配器/,
  ).then(() => ok(true, '加载不存在的平台给出「没有适配器 + 已实现的平台清单」'))
    .catch((error) => { failures += 1; console.error(`❌ 加载不存在的平台应报错：${error?.message ?? error}`); });
}

console.log('## 2. planArtifacts 返回值校验');
{
  throws(() => normalizeArtifactFiles([], REPO_ROOT), /非空/, '空 files 被拒绝');
  throws(
    () => normalizeArtifactFiles([{ path: path.join(REPO_ROOT, '..', 'escape.txt'), content: 'x' }], REPO_ROOT),
    /仓库之外/,
    '落在仓库外的产物路径被拒绝',
  );
  throws(
    () => normalizeArtifactFiles([
      { path: path.join(REPO_ROOT, 'a.txt'), content: '1' },
      { path: path.join(REPO_ROOT, 'a.txt'), content: '2' },
    ], REPO_ROOT),
    /重复/,
    '重复产物路径被拒绝（避免静默覆盖）',
  );
  const normalized = normalizeArtifactFiles([{ path: path.join(REPO_ROOT, 'x.txt'), content: '' }], REPO_ROOT);
  ok(normalized.length === 1 && normalized[0].content === '', '空 content 合法（允许生成空文件）');
}

console.log('## 3. dsh 产物幂等、与源不漂移');
{
  const first = await buildArtifacts({ repoRoot: REPO_ROOT, targets: ['dsh'], log: () => {} });
  ok(!hasStale(first), 'dsh 产物与源一致（若不一致请跑 node scripts/build-artifacts.mjs dsh）');
  ok(first.every((r) => r.files.length > 0), 'dsh 至少产出一个文件');

  const second = await buildArtifacts({ repoRoot: REPO_ROOT, targets: ['dsh'], check: true, log: () => {} });
  ok(!hasStale(second), '连续第二次 --check 仍然一致（幂等）');
}

console.log('## 4. 加一个 mock 平台：只加目录，不动任何脚本');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-bridge-adapters-'));
  try {
    // 只有目录 + 一个 adapter 文件 —— 不写 package.json、不改 scripts/、不改 src/。
    const adapterDir = path.join(tmp, 'profiles', 'agent-platforms', 'mock', 'adapters');
    fs.mkdirSync(adapterDir, { recursive: true });
    fs.writeFileSync(path.join(adapterDir, 'build.mjs'), [
      "import path from 'node:path';",
      "export const agentPlatform = 'mock';",
      'export function planArtifacts({ repoRoot }) {',
      "  return { files: [{ path: path.join(repoRoot, 'artifacts', 'mock', 'out.txt'), content: 'hello\\n' }] };",
      '}',
      '',
    ].join('\n'), 'utf8');

    const mockBuilds = listAgentPlatforms(tmp, 'build');
    ok(mockBuilds.length === 1 && mockBuilds[0] === 'mock', '临时仓库里只发现 mock 一个平台');
    ok(!listAgentPlatforms(tmp, 'install').includes('mock'), 'mock 没有 install 适配器时不会被列进 install');

    const results = await buildArtifacts({ repoRoot: tmp, log: () => {} });
    ok(results.length === 1 && results[0].agentPlatform === 'mock', 'buildArtifacts 调度到 mock');
    const outFile = path.join(tmp, 'artifacts', 'mock', 'out.txt');
    ok(fs.existsSync(outFile) && fs.readFileSync(outFile, 'utf8') === 'hello\n', 'mock 产物按 planArtifacts 写盘');

    const again = await buildArtifacts({ repoRoot: tmp, check: true, log: () => {} });
    ok(!hasStale(again), 'mock 产物第二次 --check 一致');

    // 隔离性：真实仓库的 dsh 产物不受影响（同一次进程、同一份实现）。
    const dshAgain = await buildArtifacts({ repoRoot: REPO_ROOT, targets: ['dsh'], check: true, log: () => {} });
    ok(!hasStale(dshAgain), '新增 mock 平台后 dsh 产物 diff 为空');

    // agentPlatform 与目录名不一致必须报错（否则日志会把产物归到错误平台）。
    // 用另一个目录而不是覆写 mock 的适配器：ESM 按路径缓存模块，覆写后 import 拿到的仍是旧模块。
    const badDir = path.join(tmp, 'profiles', 'agent-platforms', 'bad', 'adapters');
    fs.mkdirSync(badDir, { recursive: true });
    fs.writeFileSync(path.join(badDir, 'build.mjs'), [
      "export const agentPlatform = 'other';",
      'export function planArtifacts() { return { files: [] }; }',
      '',
    ].join('\n'), 'utf8');
    await assert.rejects(
      () => loadAdapter(tmp, 'bad', 'build'),
      /与目录名/,
    ).then(() => ok(true, 'agentPlatform 与目录名不一致时报错'))
      .catch((error) => { failures += 1; console.error(`❌ agentPlatform 不一致应报错：${error?.message ?? error}`); });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('## 5. 调度器入口存在且可被引用');
{
  for (const name of ['build-artifacts.mjs', 'install-agent-platform.mjs', 'agent-platform-adapters.mjs']) {
    ok(fs.existsSync(path.join(REPO_ROOT, 'scripts', name)), `scripts/${name} 存在`);
  }
  ok(
    fs.existsSync(path.join(REPO_ROOT, 'profiles', 'agent-platforms', 'dsh', 'adapters', 'install.mjs')),
    'dsh install 适配器存在于平台目录下（安装逻辑不再住在 scripts/）',
  );
  // setup-dsh 是兼容壳：必须仍然存在且指向新的调度器。
  const shell = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'setup-dsh.mjs'), 'utf8');
  ok(shell.includes('install-agent-platform.mjs'), 'setup-dsh.mjs 是薄壳（转发到 install-agent-platform）');
  ok(!shell.includes('@deepseek-ai/dsh-agent-preset'), 'setup-dsh.mjs 不再包含 DSH preset 装配细节');
}

console.log(failures === 0 ? '\n✅ artifact pipeline 测试全部通过' : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
