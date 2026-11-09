// 构建唯一一套控制台代码编辑器 vendor（CodeMirror 6 + YAML 语言）。
// 产出提交到 public/console/vendor/codemirror.js，运行时不需要 node_modules。
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['scripts/console-codemirror-entry.mjs'],
  bundle: true,
  format: 'iife',
  globalName: 'ConsoleCM',
  outfile: 'public/console/vendor/codemirror.js',
  minify: true,
  sourcemap: false,
  target: ['es2020'],
  legalComments: 'none',
});
console.log('built public/console/vendor/codemirror.js');
