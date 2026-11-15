// 出厂副本：`<dir>/<id>.yml`（生效文件）与 `<dir>/.defaults/<id>.yml`（出厂内容）成对存在。
//
// 「是不是内置」只由副本是否存在决定，不看 id 名单：新平台 / 新方案 / 新能力档把副本放进
// `.defaults/` 就拿到同一套语义（只读、可克隆、可重置、界面显示重置按钮），不需要改代码。
import fs from 'node:fs';
import path from 'node:path';

export const FACTORY_DIR = '.defaults';

export function factoryDir(dir) {
  return path.join(dir, FACTORY_DIR);
}

export function factoryFile(dir, id) {
  return path.join(factoryDir(dir), `${id}.yml`);
}

/** 出厂副本是否存在 —— 即这个资源是不是内置。 */
export function hasFactory(dir, id) {
  const value = String(id ?? '').trim();
  return Boolean(value) && fs.existsSync(factoryFile(dir, value));
}

/** 副本目录里的全部 id：内置资源的清单由此得来，不再另写常量。 */
export function listFactoryIds(dir) {
  const target = factoryDir(dir);
  if (!fs.existsSync(target)) return [];
  return fs.readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => entry.name.replace(/\.ya?ml$/i, ''))
    .sort();
}

export function readFactoryText(dir, id) {
  const file = factoryFile(dir, id);
  if (!fs.existsSync(file)) throw new Error(`没有出厂副本：${id}`);
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}

/** 把出厂副本抄回生效文件；调用方负责备份与 id 校验。 */
export function copyFactory(dir, id) {
  const value = String(id ?? '').trim();
  if (!value) throw new Error('缺少资源 id');
  const target = path.join(dir, `${value}.yml`);
  fs.copyFileSync(factoryFile(dir, value), target);
  return target;
}
