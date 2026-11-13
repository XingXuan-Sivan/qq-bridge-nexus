// 清理测试留在系统临时目录里的夹具。
//
// 前缀从**测试类源码**里抽取（test- / probe- / verify- / scan- / audit- / clean- 开头的文件，
// 以及 *-test.js），不维护清单：新写测试写完就被覆盖。非测试文件里出现的 os.tmpdir() 路径
// 不算我们的夹具——例如 src/voice-core.js 只是读 voice-probe，那是同生态另一个项目写的。
//
// 安全约束：只在 os.tmpdir() 下删；前缀必须 ≥4 字符且含 '-'；逐个打印被删路径。
// 用法：--dry-run 只报告不删除。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['scripts', 'src', 'dsh-bundles'];
const dryRun = process.argv.includes('--dry-run');

/** 只有测试/探针/审计类文件才被当成「夹具的持有者」。 */
const FIXTURE_FILE_RE = /(^|[\\/])(test-|probe-|verify-|scan-|audit-|clean-)|-test\.(js|mjs|cjs)$/;

/** 从源码里抽取 `os.tmpdir()` 二级参数里的字面前缀。 */
function collectPrefixes() {
  const prefixes = new Set();
  const re = /os\.tmpdir\(\)\s*,\s*[`'"]([A-Za-z0-9._-]+)/g;
  for (const dir of SCAN_DIRS) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const entry of fs.readdirSync(full, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !/\.(mjs|cjs|js)$/.test(entry.name)) continue;
      const file = path.join(entry.parentPath ?? entry.path, entry.name);
      if (!FIXTURE_FILE_RE.test(path.relative(ROOT, file))) continue;
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
      for (const m of text.matchAll(re)) {
        const p = m[1];
        // 太短的前缀（如 'qq-'）会误伤；要求 ≥4 字符且含分隔符。
        if (p.length < 4 || !p.includes('-')) continue;
        prefixes.add(p);
      }
    }
  }
  return [...prefixes].sort();
}

const tmp = os.tmpdir();
const prefixes = collectPrefixes();
if (prefixes.length === 0) {
  console.log('未从源码里找到任何 os.tmpdir() 前缀，什么也不做。');
  process.exit(0);
}

const hits = fs.readdirSync(tmp, { withFileTypes: true })
  .filter((e) => prefixes.some((p) => e.name.startsWith(p)))
  .map((e) => ({ name: e.name, dir: e.isDirectory() }))
  .sort((a, b) => a.name.localeCompare(b.name));

console.log(`临时目录：${tmp}`);
console.log(`源码里的夹具前缀：${prefixes.length} 个`);
console.log(`命中 ${hits.length} 项${dryRun ? '（dry-run，不删除）' : ''}\n`);

let removed = 0;
let failed = 0;
for (const h of hits) {
  const full = path.join(tmp, h.name);
  if (dryRun) {
    console.log(`  [dry-run] ${h.name}${h.dir ? '/' : ''}`);
    continue;
  }
  try {
    fs.rmSync(full, { recursive: true, force: true, maxRetries: 3 });
    removed += 1;
    console.log(`  已删除 ${h.name}${h.dir ? '/' : ''}`);
  } catch (error) {
    failed += 1;
    console.log(`  删除失败 ${h.name}：${error?.message ?? error}`);
  }
}

if (dryRun) {
  console.log('\n（dry-run 结束）');
} else {
  console.log(`\n${failed === 0 ? '✅' : '⚠'} 已删除 ${removed} 项${failed ? `，${failed} 项删除失败（可能被进程占用）` : ''}`);
  process.exitCode = failed === 0 ? 0 : 1;
}
