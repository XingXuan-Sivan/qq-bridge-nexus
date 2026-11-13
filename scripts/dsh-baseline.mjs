// 适配基线：把「这套脚本验证过的宿主版本与其工具集」固化成可机械比对的资产。
//
// 宿主版本没变而工具集变了 ⇒ 漂移，exit 1（要么包源指错了安装，要么抽取逻辑退化）。
// 宿主版本变了 ⇒ 只打印增删差异并提示复核，exit 2（升级本来就该变，需要人看一眼）。
//
// 只记录宿主自身包的工具名，不含用户插件目录——否则装个插件基线就过期，最后没人看。
//
// 用法：--check（与基线比对）/ --update（复核后刷新）/ --json（机器可读）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectDshToolNames } from './dsh-tool-names.mjs';
import { dshVersion } from './dsh-package-source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);
export const BASELINE_FILE = path.join(ROOT, 'dsh-baseline.json');
const GUARD_FILE = path.join(ROOT, 'dsh-bundles', 'qq-agent-presets', 'qq-tool-restrict.mjs');

/** 读基线；不存在返回 null。 */
export function readBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`${BASELINE_FILE} 不是合法 JSON：${error.message}`);
  }
}

/** 采集当前快照。工具名只取宿主自身包，不含用户插件目录。 */
export async function currentSnapshot() {
  const { names, packages, source } = collectDshToolNames({ pluginDirs: [] });
  const guard = await import(pathToFileURL(GUARD_FILE).href);
  const tools = [...names.keys()].sort();
  return {
    dshVersion: dshVersion(),
    source,
    packageCount: packages.length,
    toolCount: tools.length,
    tools,
    guarded: [...guard.RESTRICTED_TOOL_NAMES].sort(),
    injectorTools: [...guard.RUNTIME_INJECTOR_TOOLS].sort(),
  };
}

function difference(before = [], after = []) {
  const a = new Set(before);
  const b = new Set(after);
  return {
    added: after.filter((x) => !a.has(x)).sort(),
    removed: before.filter((x) => !b.has(x)).sort(),
  };
}

/**
 * 与基线比对。
 * @returns `{ status, baseline, current, tools, guarded, versionChanged }`
 *   status: `ok` | `drift`（同版本漂移） | `stale`（宿主换版本） | `missing`（没有基线）
 */
export async function checkBaseline() {
  const baseline = readBaseline();
  const current = await currentSnapshot();
  if (!baseline) return { status: 'missing', baseline: null, current, tools: difference([], current.tools), guarded: difference() };

  const versionChanged = baseline.dshVersion !== current.dshVersion;
  const tools = difference(baseline.tools, current.tools);
  const guarded = difference(baseline.guarded, current.guarded);
  const drifted = tools.added.length > 0 || tools.removed.length > 0;
  const status = versionChanged ? 'stale' : drifted ? 'drift' : 'ok';
  return { status, baseline, current, tools, guarded, versionChanged };
}

function printList(label, items) {
  if (items.length === 0) {
    console.log(`  ${label}: (无)`);
    return;
  }
  console.log(`  ${label} ${items.length} 个：`);
  for (const n of items) console.log(`    ${n}`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(SELF)) {
  const isUpdate = process.argv.includes('--update');
  const isJson = process.argv.includes('--json');

  if (isUpdate) {
    const snapshot = await currentSnapshot();
    const body = {
      $comment:
        '适配基线：记录本套脚本验证过的宿主版本与其工具集。不要手改——用 npm run baseline:update 生成。'
        + ' 宿主升级后先跑 npm run baseline:check 看增删差异，复核守卫再刷新。',
      ...snapshot,
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    console.log(`✅ 基线已写入 ${path.relative(ROOT, BASELINE_FILE)}`);
    console.log(`   宿主 ${snapshot.dshVersion ?? '(未识别)'}；包 ${snapshot.packageCount}；工具名 ${snapshot.toolCount}；守卫 ${snapshot.guarded.length}`);
    process.exit(0);
  }

  const result = await checkBaseline();
  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'ok' ? 0 : result.status === 'drift' ? 1 : 2;
  } else {
    const { status, baseline, current, tools, guarded } = result;
    if (status === 'missing') {
      console.log('⚠ 没有 dsh-baseline.json（或无法解析）。首次使用请跑：npm run baseline:update');
      process.exitCode = 3;
    } else if (status === 'ok') {
      console.log(`✅ 与基线一致：宿主 ${current.dshVersion ?? '(未识别)'}，${current.toolCount} 个工具名，守卫 ${current.guarded.length} 个`);
      if (guarded.added.length || guarded.removed.length) {
        console.log('   （注：守卫名单相对基线有变化，属代码改动，不计入漂移）');
        printList('新增', guarded.added);
        printList('移除', guarded.removed);
      }
      process.exitCode = 0;
    } else {
      if (status === 'stale') {
        console.log(`⚠ 宿主版本已变：基线 ${baseline.dshVersion ?? '(未识别)'} → 当前 ${current.dshVersion ?? '(未识别)'}`);
        console.log(`  基线包数 ${baseline.packageCount} → 当前 ${current.packageCount}；工具名 ${baseline.toolCount} → ${current.toolCount}`);
      } else {
        console.log(`❌ 宿主版本未变（${current.dshVersion ?? '(未识别)'}），但工具集发生漂移`);
      }
      printList('新增工具名', tools.added);
      printList('消失工具名', tools.removed);
      printList('守卫名单新增', guarded.added);
      printList('守卫名单移除', guarded.removed);
      if (status === 'stale') {
        console.log('\n下一步：把「消失的名字」从守卫删掉、「新增的危险名字」补进守卫，');
        console.log('        跑 npm run test:preset-local-tools 与 npm run verify:repo 确认后，');
        console.log('        再跑 npm run baseline:update 刷新基线。');
        process.exitCode = 2;
      } else {
        console.log('\n同一宿主版本下工具集不该变。先确认包源是否指向了同一份安装（打印的环境变量 / 路径），再决定是修脚本还是刷基线。');
        process.exitCode = 1;
      }
    }
  }
}
