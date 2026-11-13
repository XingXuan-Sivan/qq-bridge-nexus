// DSH 工具名对账 CLI：从已安装的宿主包/插件里抽真实工具名，与 QQ 守卫的 restrict 名单双向求差。
//
// tools.restrict 对不存在的名字会抛错，而守卫逐条 try/catch ⇒ 拼错/过期的名字是静默 no-op；
// 宿主新增工具而守卫没跟上则等于没隐藏。两类漂移都只能靠重新对账发现。
//
// 抽取在 dsh-tool-names.mjs，包来源在 dsh-package-source.mjs；本文件只打印与给退出码，只读。
// 用法：--missing 只打印值得补进守卫的名字；--json 机器可读。

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  collectDshToolNames, DANGER_TOOL_RE, SAFE_MODEL_TOOLS, TOOL_NAME_RE,
} from './dsh-tool-names.mjs';
import { dshVersion } from './dsh-package-source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { names, packages, source } = collectDshToolNames();
const guardPath = path.join(ROOT, 'dsh-bundles', 'qq-agent-presets', 'qq-tool-restrict.mjs');
const guard = await import(pathToFileURL(guardPath).href);
const guarded = new Set(guard.RESTRICTED_TOOL_NAMES);
const version = dshVersion();

const sorted = [...names.keys()].sort();
const onlyFlag = process.argv.includes('--missing');
const jsonFlag = process.argv.includes('--json');

/** ① 守卫名单里的名字必须真实存在，否则 restrict 抛错被吞、限制静默失效。 */
const fabricated = [...guarded]
  .filter((n) => TOOL_NAME_RE.test(n) && !n.startsWith('dev_') && !names.has(n));

/** ② 安装包里有、守卫没覆盖的危险语义名字（可能是新版本新增的能力）。 */
const missing = sorted.filter((n) => DANGER_TOOL_RE.test(n) && !guarded.has(n) && !SAFE_MODEL_TOOLS.has(n));

if (jsonFlag) {
  console.log(JSON.stringify({
    dshVersion: version,
    source,
    packages: packages.length,
    tools: sorted,
    guarded: [...guarded].sort(),
    fabricated,
    missing,
  }, null, 2));
  process.exitCode = (fabricated.length === 0 && missing.length === 0) ? 0 : 1;
} else {
  console.log(`包源：${source}`);
  console.log(`DSH 版本：${version ?? '(未识别)'}`);
  console.log(`扫描包数：${packages.length}；抽到工具名候选：${sorted.length}\n`);

  console.log('=== ① 守卫名单里、但安装包中找不到的名字（restrict 会抛错并静默失效） ===');
  console.log(fabricated.length ? fabricated.map((n) => `  ${n}`).join('\n') : '  (无)');

  console.log('\n=== ② 安装包里有、守卫名单里没有的「危险语义」名字（可能漏隐藏） ===');
  console.log(missing.length ? missing.map((n) => `  ${n}  ← ${[...names.get(n)].join(', ')}`).join('\n') : '  (无)');

  if (!onlyFlag) {
    console.log('\n=== ③ 全部候选名字（含来源包） ===');
    for (const n of sorted) {
      console.log(`  ${guarded.has(n) ? '[在名单]' : '[      ]'} ${n}  ← ${[...names.get(n)].join(', ')}`);
    }
  }

  console.log(`\n守卫名单 ${guarded.size} 个名字；其中悬空（假名）${fabricated.length} 个；候选里未覆盖的危险名 ${missing.length} 个。`);
  process.exitCode = (fabricated.length === 0 && missing.length === 0) ? 0 : 1;
}
