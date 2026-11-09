// 构建控制台代码编辑器 vendor（CodeMirror 6 + YAML 语言）。
// 源码入口与产物都放在组件目录里：public/console/components/code-editor/
//   entry.mjs            胶水（只暴露能力，不写死主题）
//   vendor/codemirror.js 产物（已入库，运行时不需要 node_modules）
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['public/console/components/code-editor/entry.mjs'],
  bundle: true,
  format: 'iife',
  globalName: 'ConsoleCM',
  outfile: 'public/console/components/code-editor/vendor/codemirror.js',
  minify: true,
  sourcemap: false,
  target: ['es2020'],
  legalComments: 'none',
});
console.log('built public/console/components/code-editor/vendor/codemirror.js');
