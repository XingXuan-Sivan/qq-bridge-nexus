// 校验入库的编辑器 vendor 是否与源码一致：重建到 vendor 目录里的临时文件，比 sha256。
// 只报警、不失败——vendor 只在「新增 CM6 能力」时才需要重建，平时不会变。
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const vendorDir = 'public/console/components/code-editor/vendor';
const committed = join(vendorDir, 'codemirror.js');
// 写到仓库内而不是系统临时目录：沙箱下 %TEMP% 可能不可写，工作区一定可写。
const temp = join(vendorDir, `.verify-${process.pid}.js`);

try {
  await esbuild.build({
    entryPoints: ['public/console/components/code-editor/entry.mjs'],
    bundle: true,
    format: 'iife',
    globalName: 'ConsoleCM',
    outfile: temp,
    minify: true,
    sourcemap: false,
    target: ['es2020'],
    legalComments: 'none',
    logLevel: 'silent',
  });
  const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const a = sha(committed);
  const b = sha(temp);
  if (a === b) {
    console.log(`console vendor OK (${a.slice(0, 12)})`);
  } else {
    console.warn(`[warn] 编辑器 vendor 与源码不一致：入库 ${a.slice(0, 12)} / 重建 ${b.slice(0, 12)}`);
    console.warn('       新增或修改了 CM6 能力时请运行 npm run build:console-vendor');
  }
} finally {
  rmSync(temp, { force: true });
}
