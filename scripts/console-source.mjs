// 控制台源码的统一读取口：拆分后前端在 public/console/ 下，旧测试仍按「一个字符串」断言。
// 这里把 index.html + css/app.css + js/*.js 拼起来，让正则断言继续按文档顺序匹配。
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
    jsDir: path.join(dir, 'js'),
    js: path.join(dir, 'js', 'app.js'),
  };
}

/** js/ 下所有模块（按文件名排序，入口 app.js 排在最前）：拆模块后测试仍能一次读到全部源码。 */
export function consoleScriptPaths(root = ROOT) {
  const { jsDir } = consoleSourcePaths(root);
  let names = [];
  try { names = fs.readdirSync(jsDir); } catch (error) {
    throw new Error(`控制台脚本目录缺失：${jsDir}：${error?.message ?? error}`);
  }
  const modules = names.filter((name) => name.endsWith('.js')).sort();
  const entry = 'app.js';
  const ordered = [entry, ...modules.filter((name) => name !== entry)];
  return ordered.map((name) => path.join(jsDir, name));
}

/** 拼接顺序：index.html → app.css → js/app.js → 其它 js 模块（与拆分前的单文件阅读顺序接近）。 */
export function readConsoleSource(root = ROOT) {
  const paths = consoleSourcePaths(root);
  const read = (file, label) => {
    try { return fs.readFileSync(file, 'utf8'); } catch (error) {
      throw new Error(`控制台源码缺失：${label}（${file}）：${error?.message ?? error}`);
    }
  };
  const scripts = consoleScriptPaths(root).map((file) => read(file, path.basename(file)));
  return [read(paths.index, 'index.html'), read(paths.css, 'app.css'), ...scripts].join('\n');
}
