// 控制台源码的统一读取口：拆分后前端在 public/console/ 下，旧测试仍按「一个字符串」断言。
// 这里把 index.html + css/app.css + js/app.js 拼起来，让正则断言继续按文档顺序匹配。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function consoleSourcePaths(root = ROOT) {
  const dir = path.join(root, 'public', 'console');
  return {
    dir,
    index: path.join(dir, 'index.html'),
    css: path.join(dir, 'css', 'app.css'),
    js: path.join(dir, 'js', 'app.js'),
  };
}

/** 拼接顺序：index.html → app.css → app.js（与拆分前的单文件阅读顺序一致）。 */
export function readConsoleSource(root = ROOT) {
  const paths = consoleSourcePaths(root);
  const read = (file, label) => {
    try { return fs.readFileSync(file, 'utf8'); } catch (error) {
      throw new Error(`控制台源码缺失：${label}（${file}）：${error?.message ?? error}`);
    }
  };
  return [read(paths.index, 'index.html'), read(paths.css, 'app.css'), read(paths.js, 'app.js')].join('\n');
}
