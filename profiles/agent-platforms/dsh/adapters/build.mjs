// DSH 产物构建适配器。
//
// 把能力档（profiles/agent-platforms/dsh/capabilities/<id>.yml）的**意图**，经本平台的
// 渲染层（render.yml + render.mjs）编译成 DSH 的 bundle patch
// （artifacts/dsh/qq-agent-presets/presets/<id>.patch.yml）。
//
// 为什么需要「生成」这一步：
//   0.1.7 起注册表既不扫目录也不接受 preset 路径，preset 变成一条普通 loader 行
//   （@deepseek-ai/dsh-agent-preset），它的 config.plugins 必须是**内联的行列表**，
//   只能由 bundle 的 patch 文件插入。于是同一份意图必然有两种表示：
//     源（人写）：   capabilities/<id>.yml 的效果声明
//     装（DSH 读）： artifacts/dsh/qq-agent-presets/presets/<id>.patch.yml
//   本适配器是两者之间的转换器：意图是唯一权威，产物是纯生成物（文件头写明「请勿手工编辑」）。
//   scripts/build-artifacts.mjs 负责调度；test-agent-preset-patches.mjs 用 --check 钉住不漂移。
//
// 平台话术不在这里拼：`profiles/platforms/<id>/prompt.md` 由运行期的 core-platform-prompt
// 注入块交给会话，构建期只负责预设正文。
//
// ── 适配器契约（scripts/build-artifacts.mjs 消费，新增 agent 平台照此实现）────────
//   export const agentPlatform = '<id>'          必须与 profiles/agent-platforms/<id>/ 目录名一致
//   export function planArtifacts({ repoRoot })  返回 { files: [{ path, content }], notes }
//
// planArtifacts 必须**纯**：不写盘、不读 process.env、不依赖当前工作目录。
// 这样 `--check`（只比对）与实际写入共用同一份实现，否则「校验通过但产物不同」会变成常态。
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
// 能力档的归一化与内核同一份实现（缺段/脏值的宽容度一致，不在构建期再写一套）。
import { appliesPreset, normalizeCapability } from '../../../../src/capabilities/store.mjs';
import { renderPresetMeta, renderPresetRows } from './render.mjs';
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

/** 审批闸门（工作区 / 完全访问预设）同样走 bundle 裸说明符。 */
export const GATE_SPECIFIER = 'qq-agent-presets/qq-approval-gate.mjs';

/** 本平台产物落盘的 bundle 包目录。路径按 repoRoot 计算，不依赖 cwd。 */
export function bundleDir(repoRoot) {
  return path.join(repoRoot, 'artifacts/dsh', 'qq-agent-presets');
}

export function patchFileFor(repoRoot, name) {
  return path.join(bundleDir(repoRoot), 'presets', `${name}.patch.yml`);
}

function renderFileFor(repoRoot) {
  return path.join(repoRoot, 'profiles', 'agent-platforms', 'dsh', 'render.yml');
}

function sourceFileFor(repoRoot, name) {
  return path.join(repoRoot, 'profiles', 'agent-platforms', 'dsh', 'capabilities', `${name}.yml`);
}

/** 读本平台的渲染层配置（纯读，不缓存：--check 与写入共用同一份）。 */
export function readRenderConfig(repoRoot) {
  const file = renderFileFor(repoRoot);
  try {
    return parseYaml(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`读取渲染层失败 ${file}：${error?.message ?? error}`);
  }
}

/** 读一个能力档。id 即 preset id。 */
function readCapability(repoRoot, name) {
  const file = sourceFileFor(repoRoot, name);
  let raw;
  try {
    raw = parseYaml(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`读取失败 ${file}：${error?.message ?? error}`);
  }
  return normalizeCapability(raw, { id: name, source: `capabilities/${name}.yml` });
}

/**
 * 校验渲染出来的行列表。
 *
 * 不做好事式的「相对名改写」：子行 name 按 profile 目录解析，相对/绝对路径一定会装不上，
 * 而错误会跑到 DSH 启动日志里。因此渲染层给出相对名直接构建失败，让作者在 render.yml 里就写裸说明符。
 * @param {object[]} rows 渲染结果
 * @param {string} preset preset 名（诊断用）
 * @returns {object[]} 可写进 patch 的行列表
 */
function normalizeRows(rows, preset) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${preset}: 渲染结果必须是「非空的插件行列表」`);
  }
  const seen = new Set();
  const walk = (list, at) => list.map((row, index) => {
    const label = `${preset}: ${at} 第 ${index + 1} 行`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${label} 不是插件行（应为带 name 的映射）`);
    if (typeof row.name !== 'string' || row.name === '') throw new Error(`${label} 缺少 name`);
    if (typeof row.id !== 'string' || row.id === '') throw new Error(`${label} 缺少 id`);
    if (seen.has(row.id)) throw new Error(`${preset}: 行 id 重复：${row.id}`);
    seen.add(row.id);
    if (row.name.startsWith('.') || path.isAbsolute(row.name)) {
      throw new Error(`${label}: 插件名 ${JSON.stringify(row.name)} 是相对/绝对路径，会按 profile 目录解析而装不上；`
        + `请改成「bundle 包名/子路径」（如 ${GUARD_SPECIFIER}）`);
    }
    const next = { ...row };
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

/** 渲染一个 preset 的行列表与降级结论（运行期也要用同一份）。 */
export function renderPreset(repoRoot, name) {
  const capability = readCapability(repoRoot, name);
  if (!appliesPreset(capability)) throw new Error(`${name}: runtime.apply 是 passthrough，不产 patch`);
  const config = readRenderConfig(repoRoot);
  const rendered = renderPresetRows(capability, config);
  return {
    capability,
    meta: renderPresetMeta(name, config),
    rows: normalizeRows(rendered.rows, name),
    degraded: rendered.degraded,
  };
}

/** 渲染一个 preset 的 patch 文件内容。 */
export function renderPatch(repoRoot, name) {
  const { meta, rows } = renderPreset(repoRoot, name);
  const row = {
    id: presetRowId(name),
    name: '@deepseek-ai/dsh-agent-preset',
    config: {
      id: name,
      name: meta.name,
      description: meta.description,
      order: meta.order,
      plugins: rows,
    },
  };
  const header = [
    `# 本文件由 scripts/build-artifacts.mjs 生成，请勿手工编辑。`,
    `# 源：profiles/agent-platforms/dsh/capabilities/${name}.yml（效果声明）+ dsh/render.yml（行模板）。`,
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
 * 直通能力档不装预设，因此不在此列；`--check` 也不会为它找文件。
 * @param {{repoRoot: string}} ctx
 * @returns {{files: {path: string, content: string}[], notes: string[]}}
 */
export function planArtifacts({ repoRoot }) {
  const files = [];
  const notes = [];
  for (const name of PRESETS) {
    if (!appliesPreset(readCapability(repoRoot, name))) continue;
    const { degraded } = renderPreset(repoRoot, name);
    for (const item of degraded) notes.push(`${name}: 效果 ${item.effect} 未生效（${item.reason}）`);
    files.push({ path: patchFileFor(repoRoot, name), content: renderPatch(repoRoot, name) });
  }
  return { files, notes };
}
