// DSH 产物构建适配器（P1）。
//
// 把 profiles/agent-platforms/dsh/agents/<preset>/ 的 preset 源文件渲染成 DSH 0.1.7 的
// bundle patch（artifacts/dsh/qq-agent-presets/presets/<preset>.patch.yml）。
//
// 为什么需要「生成」这一步：
//   0.1.5：preset = ~/.dsh/.agent-presets/<preset>/{preset.yml,agent.cordis.yml} 目录，DSH 扫目录。
//   0.1.7：注册表既不扫目录也不接受 preset 路径，preset 变成一条普通 loader 行
//          （@deepseek-ai/dsh-agent-preset），它的 config.plugins 必须是**内联的行列表**，
//          只能由 bundle 的 patch 文件插入。于是同一份行列表必然存在两种表示：
//            源（人写/控制台改）：profiles/agent-platforms/dsh/agents/<preset>/{preset.yml,agent.cordis.yml}
//            装（DSH 读）：      artifacts/dsh/qq-agent-presets/presets/<preset>.patch.yml
//          本适配器是两者之间**唯一**的转换器：源是唯一权威，产物是纯生成物（文件头写明「请勿手工编辑」）。
//          scripts/build-artifacts.mjs 负责调度；test-agent-preset-patches.mjs 用 --check 钉住不漂移。
//
// ── 适配器契约（scripts/build-artifacts.mjs 消费，新增 agent 平台照此实现）────────
//   export const agentPlatform = '<id>'          必须与 profiles/agent-platforms/<id>/ 目录名一致
//   export function planArtifacts({ repoRoot })  返回 { files: [{ path, content }] }
//
// planArtifacts 必须**纯**：不写盘、不读 process.env、不依赖当前工作目录。
// 这样 `--check`（只比对）与实际写入共用同一份实现，否则「校验通过但产物不同」会变成常态。
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { composeRows, readPlatformPromptFromConfig } from '../../../../src/runtime/prompt-compose.mjs';
import { AGENT_PRESET_IDS } from './runtime.mjs';

export const agentPlatform = 'dsh';

/**
 * 由桥接托管的 preset（顺序即 patch 层顺序）。
 *
 * 权威清单在 adapters/runtime.mjs 的 AGENT_PRESET_IDS：build / install / 控制台
 * 都读同一份，避免「构建产物多一个、内核不认」这类漂移。
 */
export const PRESETS = [...AGENT_PRESET_IDS];

/** preset 行 id：与 config.id（桥接解析的 preset 名）区分开，方便在 profile patch 里按行定位。 */
export function presetRowId(name) {
  return `preset-${name}`;
}

/**
 * 守卫行的引用方式：从 profile 目录可解析的裸说明符。
 *
 * 子行 name 按声明它的 loader 上下文解析（profile 目录），不是按 patch 文件或 preset 目录；
 * bundle patch 的「相对路径锚定」只作用于 insert 行自身（见 dsh-app-boot 的
 * anchorInsertedPluginNames），走不进 preset 行的 config.plugins。因此这里用
 * `<bundle 包名>/<子路径>`：profile package.json 以 link: 依赖声明该包，
 * node_modules junction 由 install.mjs 或 dev_heal_links 维护。
 */
export const GUARD_SPECIFIER = 'qq-agent-presets/qq-tool-restrict.mjs';

/** 源里允许出现的相对行名 → 新机制下的等价引用。其它相对名一律报错（避免静默装不上）。 */
export const RELATIVE_ROW_REWRITES = new Map([
  ['./qq-tool-restrict.mjs', GUARD_SPECIFIER],
  // v0.3.0：L2/L3 运维 preset 的审批闸门（同一个 bundle 内的唯一实现）。
  ['./qq-approval-gate.mjs', 'qq-agent-presets/qq-approval-gate.mjs'],
]);

/** 本平台产物落盘的 bundle 包目录。路径按 repoRoot 计算，不依赖 cwd。 */
export function bundleDir(repoRoot) {
  return path.join(repoRoot, 'artifacts/dsh', 'qq-agent-presets');
}

export function patchFileFor(repoRoot, name) {
  return path.join(bundleDir(repoRoot), 'presets', `${name}.patch.yml`);
}

function sourceDirFor(repoRoot, name) {
  return path.join(repoRoot, 'profiles', 'agent-platforms', 'dsh', 'agents', name);
}

/** 能力预设里的平台提示词（config.json > capabilities[id].prompt.personaPrefix）。 */
function capabilityPlatformPrompt(repoRoot, name) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config.json'), 'utf8'));
    return readPlatformPromptFromConfig(config, name);
  } catch {
    return '';
  }
}

function readYaml(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`读取失败 ${file}：${error?.message ?? error}`);
  }
  try {
    return parseYaml(text);
  } catch (error) {
    throw new Error(`${file} 不是合法 YAML：${error?.message ?? error}`);
  }
}

/**
 * 平台提示词变量：config.json 的 platform.id → profiles/platforms/<id>/platform.yml 的 label。
 * 没有 config.json（干净克隆）时，若仓库里只有一个平台目录就用它；都没有则返回空。
 * 空对象不是错误：{platform} 占位符会原样留在产物里，比写成错的平台名安全。
 */
function platformPromptVars(repoRoot) {
  const root = path.join(repoRoot, 'profiles', 'platforms');
  let id = '';
  try {
    const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config.json'), 'utf8'));
    id = String(config?.platform?.id ?? '').trim();
  } catch {
    id = '';
  }
  if (!id) {
    try {
      const dirs = fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      if (dirs.length === 1) id = dirs[0];
    } catch {
      return {};
    }
  }
  if (!id) return {};
  try {
    const meta = readYaml(path.join(root, id, 'platform.yml'));
    const label = String(meta?.label ?? meta?.id ?? id).trim();
    return label ? { platform: label, displayName: label } : {};
  } catch {
    return {};
  }
}

/**
 * 校验并改写行列表：只允许已知的相对行名（守卫），其余相对名视为错误。
 * @param {unknown} rows agent.cordis.yml 解析出的行列表
 * @param {string} preset preset 名（诊断用）
 * @returns {object[]} 可写进 patch 的行列表（深拷贝后的新对象）
 */
function normalizeRows(rows, preset) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${preset}: agent.cordis.yml 必须是「非空的插件行列表」（顶层数组）`);
  }
  const seen = new Set();
  const walk = (list, at) => list.map((row, index) => {
    const label = `${preset}: ${at} 第 ${index + 1} 行`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${label} 不是插件行（应为带 name 的映射）`);
    if (typeof row.name !== 'string' || row.name === '') throw new Error(`${label} 缺少 name`);
    if (typeof row.id !== 'string' || row.id === '') throw new Error(`${label} 缺少 id`);
    if (seen.has(row.id)) throw new Error(`${preset}: 行 id 重复：${row.id}`);
    seen.add(row.id);
    const next = { ...row };
    if (next.name.startsWith('.') || path.isAbsolute(next.name)) {
      const rewrite = RELATIVE_ROW_REWRITES.get(next.name);
      if (rewrite === undefined) {
        throw new Error(`${label}: 相对/绝对插件名 ${JSON.stringify(next.name)} 在 0.1.7 下会按 profile 目录解析，`
          + '必须改写为「bundle 包名/子路径」或去掉；请在本适配器的 RELATIVE_ROW_REWRITES 里显式登记改写规则');
      }
      next.name = rewrite;
    }
    if (row.group === true) {
      if (!Array.isArray(row.config)) throw new Error(`${label} 是 group 行但 config 不是行列表`);
      next.config = walk(row.config, `${at}/${row.id}`);
    }
    return next;
  });
  const normalized = walk(rows, 'plugins');
  for (const required of ['persona', 'qq-tool-restrict']) {
    if (!seen.has(required)) throw new Error(`${preset}: 行列表缺少 ${required} 行（安全/人格边界不允许缺失）`);
  }
  return normalized;
}

/** 渲染一个 preset 的 patch 文件内容。 */
export function renderPatch(repoRoot, name) {
  const dir = sourceDirFor(repoRoot, name);
  const meta = readYaml(path.join(dir, 'preset.yml'));
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error(`${name}: preset.yml 必须是映射`);
  for (const field of ['name', 'description', 'order']) {
    if (meta[field] === undefined) throw new Error(`${name}: preset.yml 缺少 ${field}`);
  }
  const plugins = composeRows(
    normalizeRows(readYaml(path.join(dir, 'agent.cordis.yml')), name),
    { platformText: capabilityPlatformPrompt(repoRoot, name), vars: platformPromptVars(repoRoot) },
  );
  const row = {
    id: presetRowId(name),
    name: '@deepseek-ai/dsh-agent-preset',
    config: {
      id: name,
      name: meta.name,
      description: meta.description,
      order: meta.order,
      plugins,
    },
  };
  const header = [
    `# 本文件由 scripts/build-artifacts.mjs 生成，请勿手工编辑。`,
    `# 源：profiles/agent-platforms/dsh/agents/${name}/preset.yml + agent.cordis.yml（人格正文与工具面都在那里改）。`,
    `# 作用：把 ${name} 作为一条 @deepseek-ai/dsh-agent-preset 行插入 profile（DSH 0.1.7+ 的 preset 机制）。`,
    `# 守卫行 qq-tool-restrict 用裸说明符 ${GUARD_SPECIFIER}：子行 name 按 profile 目录解析，`,
    `# 该包以 link: 依赖注册在 profile package.json（node_modules junction 由 install.mjs 维护）。`,
    '',
  ].join('\n');
  // lineWidth: 0 —— 长行不折行；aliasDuplicateObjects: false —— 不生成锚点/别名（等价 js-yaml 的 noRefs）；
  // singleQuote: true —— 尽量用单引号，保持与旧产出（js-yaml）逐字一致，diff 只反映真实改动。
  return `${header}${stringifyYaml([{ insert: [row] }], { lineWidth: 0, aliasDuplicateObjects: false, singleQuote: true })}`;
}

/**
 * 计划本平台的全部产物（纯函数，不写盘）。
 * @param {{repoRoot: string}} ctx
 * @returns {{files: {path: string, content: string}[]}}
 */
export function planArtifacts({ repoRoot }) {
  return {
    files: PRESETS.map((name) => ({
      path: patchFileFor(repoRoot, name),
      content: renderPatch(repoRoot, name),
    })),
  };
}
