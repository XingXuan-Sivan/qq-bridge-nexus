// 控制台源码的统一读取口：拆分后前端在 public/console/ 下，旧测试仍按「一个字符串」断言。
// 这里把骨架 + 公用样式 + 模块 + 各页片段拼起来，让正则断言继续按文档顺序匹配。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function consoleSourcePaths(root = ROOT) {
  const dir = path.join(root, 'public', 'console');
  const cssDir = path.join(dir, 'css');
  return {
    dir,
    index: path.join(dir, 'index.html'),
    cssDir,
    // 样式按加载顺序列出：tokens → base → layout → components（3.3 第二步拆分后的四件）。
    css: ['tokens.css', 'base.css', 'layout.css', 'components.css'].map((name) => path.join(cssDir, name)),
    jsDir: path.join(dir, 'js'),
    js: path.join(dir, 'js', 'app.js'),
    pagesDir: path.join(dir, 'pages'),
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

/** 页面目录：pages/<id>/page.{html,css,js}（page.css 可缺，工具参考页连 page.js 都没有）。 */
export function consolePageDirs(root = ROOT) {
  const { pagesDir } = consoleSourcePaths(root);
  let names = [];
  try { names = fs.readdirSync(pagesDir, { withFileTypes: true }); } catch { return []; }
  return names
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((id) => {
      const dir = path.join(pagesDir, id);
      const pick = (name) => (fs.existsSync(path.join(dir, name)) ? path.join(dir, name) : null);
      return { id, dir, html: pick('page.html'), css: pick('page.css'), js: pick('page.js') };
    });
}

/** 拼接顺序：index.html → css/{tokens,base,layout,components} → js/（app.js 优先）→ pages/<id>/{page.html,page.css,page.js}。 */
export function readConsoleSource(root = ROOT) {
  const paths = consoleSourcePaths(root);
  const read = (file, label) => {
    try { return fs.readFileSync(file, 'utf8'); } catch (error) {
      throw new Error(`控制台源码缺失：${label}（${file}）：${error?.message ?? error}`);
    }
  };
  const styles = paths.css.map((file) => read(file, path.relative(paths.dir, file)));
  const scripts = consoleScriptPaths(root).map((file) => read(file, path.basename(file)));
  const pages = consolePageDirs(root).flatMap((page) => [page.html, page.css, page.js]
    .filter(Boolean)
    .map((file) => read(file, path.relative(paths.dir, file))));
  return [read(paths.index, 'index.html'), ...styles, ...scripts, ...pages].join('\n');
}
