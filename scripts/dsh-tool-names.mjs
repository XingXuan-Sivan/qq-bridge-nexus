// DSH 工具名抽取的唯一实现，供 scan-dsh-tool-names.mjs（对账）与
// test-preset-local-tools.mjs（登记期断言）共用。两处各写一份必然会漂移。
//
// 抽取规则，都要求就近锚定，不把 systemPrompt 的 name 当工具名：
//   ① .register(defineTool({ … name: "X" … }))
//   ② toolName: "X" / toolName: z.string().default("X")
//   ③ YAML patch 里的 toolName: X 行（含 presets/ 子目录）
//
// 数据来源是 dsh-package-source.mjs 的包集合：目录后端与 asar 后端走同一套抽取逻辑。

import { dshPackagesCollection, dshPluginCollections, directoryCollection } from './dsh-package-source.mjs';

/** 名字形态：小写字母开头，允许下划线与连字符，长度合理。 */
export const TOOL_NAME_RE = /^[a-z][a-z0-9_-]{1,40}$/;

/** 从一个 JS/TS 源文件里抽取工具名。 */
function extractFromSource(text, source, add) {
  for (const m of text.matchAll(/\.register\(\s*defineTool\(\{[\s\S]{0,400}?\bname:\s*["']([^"']+)["']/g)) {
    add(m[1], source);
  }
  for (const m of text.matchAll(/\btoolName:\s*["']([^"']+)["']/g)) add(m[1], source);
  for (const m of text.matchAll(/\btoolName:\s*[^;\n]*?\.default\(\s*["']([^"']+)["']/g)) add(m[1], source);
  // 独立的一次性工具文件（defineTool 不挂在 .register( 上时的兜底）
  for (const m of text.matchAll(/defineTool\(\{[\s\S]{0,200}?\bname:\s*["']([^"']+)["']/g)) {
    add(m[1], source);
  }
}

/** 从 YAML patch 里抽取配置化的工具名。 */
function extractFromPatch(text, source, add) {
  for (const m of text.matchAll(/^\s*(?:-\s*)?toolName:\s*([^\s#]+)\s*$/gm)) {
    add(m[1].replace(/^['"]|['"]$/g, ''), source);
  }
}

/**
 * 抽取已安装 DSH（及其插件）里出现的全部工具名。
 *
 * @param options.packagesDir - `@deepseek-ai` 目录；缺省自动定位（目录 → app.asar）。
 * @param options.pluginDirs - 第三方插件目录列表；缺省用 `$DSH_HOME/plugins`。
 * @returns `{ names: Map<name, Set<source>>, packages: string[], source: string }`。
 *          `packages` 是实际扫过的包/插件名，`source` 是数据来源描述，便于诊断
 *          「一个都没扫到」。
 */
export function collectDshToolNames({ packagesDir, pluginDirs } = {}) {
  const names = new Map();
  const packages = [];
  const add = (name, source) => {
    if (!TOOL_NAME_RE.test(name)) return;
    if (!names.has(name)) names.set(name, new Set());
    names.get(name).add(source);
  };

  const collections = [];
  const dsh = dshPackagesCollection({ packagesDir });
  if (dsh) collections.push(dsh);
  if (pluginDirs) {
    // 用户的插件目录里全是插件包（含 .bak-* 备份，也一起扫：备份里的旧名字
    // 仍然说明这个名字曾经真实存在）。
    for (const dir of pluginDirs) collections.push(directoryCollection(dir, { label: `plugins:${dir}` }));
  } else {
    collections.push(...dshPluginCollections());
  }

  for (const col of collections) {
    for (const pkg of col.listPackages()) {
      packages.push(pkg);
      for (const rel of col.listFiles(pkg)) {
        const isJs = /\.(js|mjs|cjs)$/.test(rel) || rel.endsWith('.d.ts');
        const isPatch = /\.patch\.ya?ml$/.test(rel);
        if (!isJs && !isPatch) continue;
        const text = col.readFile(pkg, rel);
        if (!text) continue;
        if (isJs) extractFromSource(text, pkg, add);
        else extractFromPatch(text, pkg, add);
      }
    }
  }
  return { names, packages, source: collections.map((c) => c.describe()).join(' + ') || '(none)' };
}

/** 便利包装：只要名字集合。 */
export function dshToolNameSet(options) {
  return new Set(collectDshToolNames(options).names.keys());
}

/**
 * 「危险语义」判定：与本地执行 / 文件 / 进程 / 派生 agent / 宿主运行期相关的名字。
 * 守卫**必须**覆盖它们。纯模型侧无害工具由 {@link SAFE_MODEL_TOOLS} 显式排除。
 *
 * 这是**发现用**的启发式（宁可多报，人工再判），不是安全边界本身；
 * 边界是守卫的 restrict 名单 + 执行期白名单。
 */
export const DANGER_TOOL_RE = /(pwsh|bash|shell|exec|spawn|process|terminal|pty|read|write|edit|file|fs_|glob|grep|patch|str_replace|subagent|agent_|teammate|workflow|ralph|job|skill|present|goal|plan|todo|memory|snapshot|rollback|incident|plugin|cordis|dsh_|dev_|import|install|reload|inject|stage|config|workspace|session|export|office|slash|command|schedule|voice|speech|team|mcp_resource)/;

/** 明确无害、允许出现在仿真会话 schema 里的模型侧工具。 */
export const SAFE_MODEL_TOOLS = new Set(['ask_user_question', 'todo_write']);
