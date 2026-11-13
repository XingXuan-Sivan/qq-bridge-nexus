// 兼容门面：实现已迁到 dsh-package-source.mjs，这里只做 re-export。
//
// dshModulesDir() 仅在磁盘上真有 node_modules 时可用（服务「用 Node 真实 import 宿主模块」
// 这类必须落盘的需求，拿不到就抛错并在信息里给替代方案）；只读源码文本的场合一律用
// dshPackagesCollection()，它在包内联进 app.asar 时也能工作。

export {
  dshHome,
  candidateProfiles,
  directoryModulesDir,
  dshAppAsar,
  dshVersion,
  dshPackagesCollection,
  dshPluginCollections,
  AsarArchive,
  asarCollection,
  directoryCollection,
} from './dsh-package-source.mjs';

import { directoryModulesDir, candidateProfiles, dshHome } from './dsh-package-source.mjs';

export function dshModulesDir() {
  const dir = directoryModulesDir();
  if (dir) return dir;

  throw new Error(
    '无法定位 DSH 安装目录下的 node_modules。\n'
    + '  DSH 0.2.2 起把 @deepseek-ai/* 内联进 app.asar，磁盘上不再有这些包：\n'
    + '  · 只需要读源码文本（工具名抽取、配置对账）→ 改用 dsh-package-source.mjs 的 dshPackagesCollection()；\n'
    + '  · 需要真实 import 宿主模块 → 设置 DSH_INSTALL_MODULES=<含 @deepseek-ai 的 node_modules>；\n'
    + `  · 或设置 DSH_HOME 指向 DSH 根目录（当前解析为 ${dshHome()}，候选 profile：${candidateProfiles().join(', ')}）。`
  );
}
