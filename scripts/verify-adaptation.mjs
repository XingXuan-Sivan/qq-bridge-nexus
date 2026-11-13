// DSH 适配验证，按判据性质分三层，各自独立的通过/失败/跳过计数与退出码：
//
//   repo   （默认）仓库不变式：patch 与源一致、守卫 fail-closed、版本号一致、适配基线未过期、
//          语法。与这台机器装成什么样无关 ⇒ 必须 0 红，可进 CI gate。
//   deploy        本机部署状态：profile 探测、MCP 配置、bundles、link、persona schema、
//          已部署的守卫是不是仓库件。环境不符时跳过而不是失败。
//   live          活 DSH 协议契约：鉴权、preset 列表、session/create、projections、
//          control baseline 形状、stopSessionWork、$events、modelCatalog。需要运行中的 DSH。
//
// 用法：--layer repo|deploy|live|all；npm 入口 verify:repo / verify:deploy / verify:live /
// verify:adaptation(=all)。不依赖 SnowLuma；live 层的探测会话会被 archive，工作区建在系统临时目录。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import YAML from 'yaml';
import { dshHome, candidateProfiles, directoryModulesDir } from './dsh-package-source.mjs';
import { discoverDshSessionCookie, NodeApiClient, unwrap } from '../src/dsh-client.js';

const ROOT = process.cwd();
const DSH_HOME = dshHome();
const PRESET_IDS = ['qq-chat', 'qq-chat-v2'];

// ── 层选择 ──────────────────────────────────────────────────────────────────
function parseLayer() {
  const i = process.argv.indexOf('--layer');
  const raw = (i >= 0 ? process.argv[i + 1] : process.env.VERIFY_LAYER) || 'repo';
  const valid = ['repo', 'deploy', 'live', 'all'];
  if (!valid.includes(raw)) {
    console.error(`未知的 --layer "${raw}"，可选：${valid.join(' / ')}`);
    process.exit(2);
  }
  return raw;
}
const LAYER = parseLayer();
const want = (layer) => LAYER === 'all' || LAYER === layer;

let pass = 0, fail = 0, skipped = 0;
const results = [];

/** 只统计被选中的层；未选中的层完全不执行（配合调用点的 want() 判断）。 */
function check(layer, label, cond, extra = '') {
  if (!want(layer)) return cond;
  if (cond) { pass += 1; results.push(`✅ [${layer}] ${label}${extra ? ' — ' + extra : ''}`); }
  else { fail += 1; results.push(`❌ [${layer}] ${label}${extra ? ' — ' + extra : ''}`); }
  return cond;
}
/** 环境不允许断言时显式记为跳过，而不是假装通过。 */
function skip(layer, label, why) {
  if (!want(layer)) return;
  skipped += 1;
  results.push(`⏭ [${layer}] ${label} — ${why}`);
}

// ── 公共工具 ────────────────────────────────────────────────────────────────
/** 只看可执行代码（注释里会提到旧名字做历史说明，直接扫原文会误报）。 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');

/**
 * 尽量加载「DSH 自带的模块」（用于拿 DSH 自己的解析器 / schema 做对照）。
 *
 * 这是刻意的：用 DSH 的 js-yaml 解析 DSH 要读的文件，才能捕捉两个 YAML 实现之间
 * 的行为差异；换成仓库自己的 `yaml` 会失去对照意义（见 PLAN_DEVIATIONS D24）。
 *
 * 但 0.2.2 把全部 @deepseek-ai/* 内联进 app.asar，磁盘上已经没有 node_modules，
 * 而 Node 无法从 asar 里 import 模块 ⇒ 这里在桌面上**会返回 null**，调用方按跳过处理。
 * 想启用对照：设置 DSH_INSTALL_MODULES=<含 @deepseek-ai 的 node_modules>。
 */
async function loadDshModule(spec) {
  try {
    const mods = directoryModulesDir();
    if (!mods) return null;
    const file = path.join(mods, spec);
    if (!fs.existsSync(file)) return null;
    return await import(pathToFileURL(file).href);
  } catch {
    return null;
  }
}

/** 探测哪个 profile 才是"当前这份部署"：判据是 bundles 里有 qq-agent-presets。 */
function detectDeployedProfile() {
  const explicit = process.env.DSH_PROFILE;
  const names = explicit ? [explicit] : candidateProfiles(DSH_HOME);
  for (const name of names) {
    const dir = path.join(DSH_HOME, 'profiles', name);
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const bundles = pkg?.dsh?.profile?.bundles ?? [];
      if (bundles.includes('qq-agent-presets')) return { name, dir, pkg };
    } catch { /* 损坏的 profile 跳过 */ }
  }
  return null;
}

/**
 * 运行中的 DSH 监听的本地端口。
 *
 * 历史坑：0.2.1 起桌面版**每次启动都换随机端口**（实测 65137），脚本写死 :3080
 * 只会在桌面版上拿到 ECONNREFUSED —— 而活 DSH 段里的鉴权、投影、退役会话回归，
 * 恰恰是升级时最该看的信号。
 *
 * 另一个坑：`Select-Object -First 1` 取到的 DeepSeek Harness 进程（本机有 5 个）
 * 往往不是监听 HTTP 的那个，所以必须**遍历全部进程**再取交集。
 */
function dshListeningPorts() {
  if (process.platform !== 'win32') return [];
  try {
    const ps = spawnSync('powershell', ['-NoProfile', '-Command',
      "Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue "
      + '| ForEach-Object { Get-NetTCPConnection -State Listen -OwningProcess $_.Id -ErrorAction SilentlyContinue } '
      + '| Select-Object -ExpandProperty LocalPort -Unique',
    ], { encoding: 'utf8', timeout: 20_000 });
    return String(ps.stdout ?? '')
      .split(/\r?\n/).map((s) => Number(s.trim()))
      .filter((p) => Number.isInteger(p) && p > 0);
  } catch { return []; }
}

/** 候选基址：显式 → 探测到的端口 → 传统 :3080。 */
function candidateBaseUrls() {
  const list = [];
  if (process.env.DSH_BASE_URL) list.push(process.env.DSH_BASE_URL.replace(/\/$/, ''));
  for (const port of dshListeningPorts()) list.push(`http://127.0.0.1:${port}`);
  list.push('http://127.0.0.1:3080');
  return [...new Set(list)];
}

/** 从 preset 源文件里取出一行。 */
function readPresetRow(id) {
  const f = path.join(ROOT, 'profiles/agent-platforms/dsh/agents', id, 'agent.cordis.yml');
  return YAML.parse(fs.readFileSync(f, 'utf8')).find((r) => r.id === 'persona');
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. repo 层：仓库不变式
// ═══════════════════════════════════════════════════════════════════════════
if (want('repo')) {
  // ── 1a. preset persona 的结构 ───────────────────────────────────────────
  // 2026-11-13 修正：0.2.1 起提示词变量只剩 provider / model，
  // `{{cwd}}` 属于 **unknown prompt variable**，会让每一轮直接报错。所以这里的
  // 方向是「**不得**出现 {{cwd}}」，与上一版（断言必须有）正好相反。
  // 旧断言之所以一直红着没被发现，是因为运行时错误被桥接的重试吞掉了。
  for (const p of PRESET_IDS) {
    const row = readPresetRow(p);
    check('repo', `preset ${p}: 有 persona 行且带 prefix`, typeof row?.config?.prefix === 'string' && row.config.prefix.length > 0);
    check('repo', `preset ${p}: prefix 保留 {{model}} 变量`, /\{\{model\}\}/.test(row?.config?.prefix ?? ''));
    check('repo', `preset ${p}: 不写入 {{cwd}} 变量（0.2.1 起非法）`,
      !/\{\{cwd\}\}/.test(String(row?.config?.suffix ?? '')),
      'cwd 已不是合法提示词变量，出现会让每一轮报 unknown prompt variable');
    check('repo', `preset ${p}: 不再使用已废弃的 text 字段`, !Object.hasOwn(row?.config ?? {}, 'text'));
  }

  // ── 1b. bundle patch 与仓库源一致 ───────────────────────────────────────
  const presetPatches = await import(pathToFileURL(path.join(ROOT, 'scripts/build-agent-preset-patches.mjs')).href);
  for (const { file, changed } of presetPatches.buildPatches({ check: true, log: () => {} })) {
    check('repo', `${path.relative(ROOT, file)} 与仓库源一致（未漂移）`, !changed);
  }
  const norm = (s) => String(s ?? '').replace(/\r\n/g, '\n');
  for (const p of PRESET_IDS) {
    const doc = YAML.parse(fs.readFileSync(presetPatches.patchFileFor(p), 'utf8'));
    const row = doc?.[0]?.insert?.[0];
    check('repo', `patch ${p}: 是 @deepseek-ai/dsh-agent-preset 行`, row?.name === '@deepseek-ai/dsh-agent-preset');
    check('repo', `patch ${p}: config.id = ${p}`, row?.config?.id === p);
    const srcPersona = readPresetRow(p);
    const patchPersona = (row?.config?.plugins ?? []).find((r) => r.id === 'persona');
    check('repo', `patch ${p}: persona.prefix 与源逐字一致`, norm(srcPersona?.config?.prefix) === norm(patchPersona?.config?.prefix));
    const guardRow = (row?.config?.plugins ?? []).find((r) => r.id === 'qq-tool-restrict');
    check('repo', `patch ${p}: 守卫行用 Profile 目录可解析的裸说明符`, guardRow?.name === presetPatches.GUARD_SPECIFIER);
  }

  // ── 1c. 守卫行为（不再用正则读源码）────────────────────────────────────
  // 旧实现是读守卫源码做正则匹配（`!/'(?:web_search|web_fetch)'/`）。那种断言测的是
  // **代码的样子**，一重构就红：0.2.x 把只读白名单提成导出的 READONLY_AGENT_TOOLS 后，
  // 它立刻误报"守卫放行了 web_search"。现在改成**喂假 tools 服务跑真实 apply()**，
  // 断言的是行为。
  const canonicalGuardPath = path.join(ROOT, 'dsh-bundles', 'qq-agent-presets', 'qq-tool-restrict.mjs');
  const guardMod = await import(pathToFileURL(canonicalGuardPath).href);
  const runGuard = (config) => {
    const fakeTools = { restrict() {}, guard(fn) { this._guard = fn; } };
    guardMod.apply({ tools: fakeTools }, config);
    return (name) => fakeTools._guard({ name });
  };
  const defaultGuard = runGuard(undefined);
  const readonlyGuard = runGuard({ profile: 'readonly-agent' });

  check('repo', '守卫：默认 profile 拒绝 web_search / web_fetch',
    typeof defaultGuard('web_search') === 'string' && typeof defaultGuard('web_fetch') === 'string');
  check('repo', '守卫：readonly profile 放行 web_search / web_fetch（L1 只读联网）',
    readonlyGuard('web_search') === undefined && readonlyGuard('web_fetch') === undefined);
  check('repo', '守卫：默认 profile 放行无害模型侧工具',
    ['ask_user_question', 'todo_write', 'compress'].every((n) => defaultGuard(n) === undefined));
  check('repo', '守卫：非法工具名 fail-closed',
    ['', null, undefined, 'totally_new_tool'].every((n) => typeof defaultGuard(n) === 'string'));
  check('repo', '守卫：未导出 0.1.7 已删除的 cordis 工具名', guardMod.RESTRICTED_TOOL_NAMES.every((n) => !/cordis_(?:define|undefine|run|stop)/.test(n)));

  // 守卫名单与真实工具对账（0.2.2 起包在 app.asar 里也能扫）。
  let scanned = null;
  try {
    const { collectDshToolNames } = await import(pathToFileURL(path.join(ROOT, 'scripts/dsh-tool-names.mjs')).href);
    scanned = collectDshToolNames();
  } catch (error) {
    skip('repo', '守卫名单与 DSH 真实工具名对账', `无法读取 DSH 工具包：${error?.message ?? error}`);
  }
  if (scanned && scanned.names.size === 0) {
    skip('repo', '守卫名单与 DSH 真实工具名对账', '未扫到任何 DSH 包（DSH 未安装？）');
  } else if (scanned) {
    const injector = new Set(guardMod.RUNTIME_INJECTOR_TOOLS ?? []);
    const fabricated = guardMod.RESTRICTED_TOOL_NAMES
      .filter((n) => !injector.has(n) && !scanned.names.has(n));
    check('repo', '守卫名单无拼错的假名（restrict 不会静默失效）', fabricated.length === 0,
      fabricated.join(', ') || `扫过 ${scanned.packages.length} 个包`);
  }

  // ── 1c-2. 适配基线（宿主版本 ↔ 工具集）───────────────────────────────
  // 同一宿主版本下工具集漂移 ⇒ 硬红：要么包源指错了安装，要么抽取逻辑退化。
  // 宿主换版本 ⇒ 只提示「基线过期」不红：升级本来就该变，需要人复核新增的危险名字
  // 之后跑 `npm run baseline:update`。这条是整套「不留技术债」方案的关键卡点：
  // 它把「升级后记得人肉对账」变成了脚本会主动提醒的事实。
  try {
    const { checkBaseline } = await import(pathToFileURL(path.join(ROOT, 'scripts/dsh-baseline.mjs')).href);
    const base = await checkBaseline();
    if (base.status === 'ok') {
      check('repo', `适配基线未过期（宿主 ${base.current.dshVersion ?? '未识别'}，${base.current.toolCount} 个工具名）`, true);
    } else if (base.status === 'stale') {
      skip('repo', '适配基线', `宿主已从 ${base.baseline?.dshVersion ?? '(未识别)'} 变为 ${base.current.dshVersion ?? '(未识别)'}；`
        + `工具名 ${base.baseline?.toolCount ?? '?'} → ${base.current.toolCount}`
        + `（新增 ${base.tools.added.length} / 消失 ${base.tools.removed.length}）。复核守卫后跑 npm run baseline:update`);
    } else if (base.status === 'missing') {
      skip('repo', '适配基线', '没有 dsh-baseline.json；首次使用请跑 npm run baseline:update');
    } else {
      check('repo', '适配基线与当前工具集一致（同一宿主版本下不应漂移）', false,
        `新增：${base.tools.added.join(', ') || '(无)'}；消失：${base.tools.removed.join(', ') || '(无)'}`);
    }
  } catch (error) {
    skip('repo', '适配基线', `无法读取基线脚本：${error?.message ?? error}`);
  }

  // ── 1d. 桥接侧不变式 ────────────────────────────────────────────────────
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  check('repo', 'config.json dsh.model = deepseek-flash', cfg.dsh?.model === 'deepseek-flash', `当前 ${cfg.dsh?.model}`);
  const bridgeSrc = fs.readFileSync(path.join(ROOT, 'src/bridge.js'), 'utf8');
  const bridgeCode = stripComments(bridgeSrc);
  const setupCode = stripComments(fs.readFileSync(path.join(ROOT, 'scripts/setup-dsh.mjs'), 'utf8'));
  check('repo', 'bridge.js 可执行代码无 deepseek-v4-flash-vision-exp 残留', !bridgeCode.includes('deepseek-v4-flash-vision-exp'));
  check('repo', 'bridge.js 可执行代码无 router-standard 残留', !bridgeCode.includes('router-standard'));
  check('repo', 'setup-dsh.mjs 可执行代码无 router-standard 残留', !setupCode.includes('router-standard'));
  check('repo', 'setup-dsh.mjs 新装默认 closedAgentPreset 留空（交给 DSH 默认 preset）', /closedAgentPreset:\s*''/.test(setupCode));
  check('repo', 'bridge.js 默认模型为 deepseek-flash', /model:\s*'deepseek-flash'/.test(bridgeCode));
  check('repo', 'bridge.js 不再有「无参创建会话」兜底', !/sessions\.create\(\{\}\)/.test(bridgeCode));
  check('repo', 'bridge.js 含 preset 清单/默认 preset 解析', bridgeSrc.includes('resolvePresetName') && bridgeSrc.includes('refreshPresetList'));

  // 安全不变量：群聊/仿真会话在 preset 缺失时必须 fail-closed。
  // 旧实现会在 preset 不在 DSH 清单里时静默回退到 DSH 默认 preset（standard，含 bash/
  // 文件读写），把本地工具暴露给 QQ 群 —— 与 RULES.md「无本地工具」的承诺直接矛盾。
  check('repo', 'preset 解析带 strict 开关', /resolvePresetName\(name, \{ strict = false \} = \{\}\)/.test(bridgeCode));
  check('repo', '非 closed-agent 模式以 strict 解析 preset', /resolvePresetName\(wanted, \{ strict: true \}\)/.test(bridgeCode));
  check('repo', '群聊模式缺少 preset 时拒绝建会话（fail-closed）', /strictPreset && !preset/.test(bridgeCode));
  // 2026-11-13 替换：旧断言 `/strictPreset \? \[true\] : \[true, false\]/` 钉的是
  // 「不重试无 preset 建会话」这个**实现细节**。0.2.x 把它重构成 agentPlan / closedAgentPlan
  // （closed-agent 也 fail-closed，比原来更严），正则立刻失效。现在钉的是行为契约：
  // agentPlan 失败必须直接抛错，不能落到"再试一次"的分支。
  check('repo', 'closed-agent 计划失败时直接抛错（不再重试建会话）',
    /if \(agentPlan && !agentPlan\.ok\)\s*\{\s*throw/.test(bridgeCode));

  // ── 1e. 版本身份一致性 ──────────────────────────────────────────────────
  // v0.1.5 曾带着自称 0.1.2-alpha.1 的 package-lock.json 发布出去（package.json 却是
  // 0.1.5），三个 MCP server 的 serverInfo.version 也停在 0.1.0。版本漂移没有防线就会
  // 复发，这里把「所有对外自称的版本号必须等于 package.json」固定下来。
  const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lockJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const pluginPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'dsh-bundles/qq-mode-console/package.json'), 'utf8'));
  check('repo', 'package-lock.json 顶层 version 与 package.json 一致', lockJson.version === pkgJson.version, `lock=${lockJson.version} pkg=${pkgJson.version}`);
  check('repo', 'package-lock.json packages[""] version 与 package.json 一致', lockJson.packages?.['']?.version === pkgJson.version, `lock=${lockJson.packages?.['']?.version}`);
  check('repo', 'qq-mode-console 插件版本与主包一致', pluginPkg.version === pkgJson.version, `plugin=${pluginPkg.version}`);
  for (const f of ['src/mcp-snowluma-safe.js', 'src/mcp-host-server.js', 'src/mcp-web-search-safe.js']) {
    const m = /new McpServer\(\{[^}]*version:\s*'([^']+)'/.exec(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    check('repo', `${f} 的 MCP serverInfo.version 与主包一致`, m?.[1] === pkgJson.version, `声明=${m?.[1]} 主包=${pkgJson.version}`);
  }

  // ── 1f. 语法检查 ────────────────────────────────────────────────────────
  // spawnSync 在受限环境（DSH 沙箱的 workspace-write）会以 EPERM 失败——那是**环境**
  // 不允许起子进程，不是文件有语法错。显式记为跳过，否则会输出一串假失败。
  const SYNTAX_FILES = ['src/bridge.js', 'src/dsh-client.js', 'src/mcp-snowluma-safe.js', 'src/mcp-host-server.js', 'src/mcp-web-search-safe.js', 'src/slang-learner.js', 'src/self-test.js', 'scripts/setup-dsh.mjs'];
  const probe = spawnSync(process.execPath, ['--check', path.join(ROOT, 'src/dsh-client.js')], { encoding: 'utf8' });
  if (probe.error?.code === 'EPERM') {
    skip('repo', `${SYNTAX_FILES.length} 个文件的语法检查`, '本环境不允许 spawn 子进程（EPERM）；请在普通终端重跑');
  } else {
    for (const f of SYNTAX_FILES) {
      const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' });
      check('repo', `${f} 语法正确`, r.status === 0, (r.stderr || '').split('\n')[0]);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. deploy 层：本机部署状态
// ═══════════════════════════════════════════════════════════════════════════
if (want('deploy')) {
  // 2026-11-13 修正：原来硬编码 `profiles/web`，而桌面版的 profile 叫 `desktop`。
  // 结果是 5 条假失败（patch 读不到、bundles 缺、junction 不存在），把唯一的真失败
  // 淹掉了。现在按「bundles 里有 qq-agent-presets」自动探测，探不到就整体跳过。
  const deployed = detectDeployedProfile();
  if (!deployed) {
    skip('deploy', 'profile 部署状态（patch / bundles / link / junction）',
      `未找到部署了 qq-agent-presets 的 profile（已试：${candidateProfiles(DSH_HOME).join(', ')}）；先跑 npm run setup 再验`);
  } else {
    const { name: profileName, dir: profileDir } = deployed;
    results.push(`ℹ [deploy] 校验的 profile = ${profileName}（${profileDir}）`);

    // persona schema：用 DSH 自己的 schema 校验（拿不到模块就跳过，不算失败）。
    const persona = await loadDshModule('@deepseek-ai/dsh-persona/lib/index.js');
    if (!persona) {
      skip('deploy', 'persona.config 通过 DSH 真实 schema',
        '磁盘上没有 @deepseek-ai/dsh-persona（0.2.2 已内联进 app.asar）；设 DSH_INSTALL_MODULES 可启用对照');
    } else {
      check('deploy', 'dsh-persona 仍拒绝旧字段 text（故障前提成立）', (() => {
        try { persona.Config({ text: 'x' }); return false; } catch { return true; }
      })());
      for (const p of PRESET_IDS) {
        const row = readPresetRow(p);
        let ok = false;
        try { persona.Config(row.config); ok = true; } catch { /* 下面记失败 */ }
        check('deploy', `preset ${p}: persona.config 通过 DSH schema`, ok);
      }
    }

    const patchPath = path.join(profileDir, 'cordis.patch.yml');
    if (!fs.existsSync(patchPath)) {
      skip('deploy', 'profile patch 的 MCP 配置', `${patchPath} 不存在`);
    } else {
      const patchDoc = YAML.parse(fs.readFileSync(patchPath, 'utf8')) ?? [];
      const inserts = patchDoc.filter((e) => e?.insert).flatMap((e) => e.insert);
      const mcpEntries = inserts.filter((x) => String(x?.id ?? '').startsWith('mcp-'));
      // 不断言"恰好 3 个"：那是旧实现的快照，每加一个 MCP 就会红一次（本机现在有 5 个，
      // 包括 qq-ext 与 bridge-ext）。钉住的是**契约**：必需的三个在、且 id 不重复。
      const REQUIRED_MCPS = ['mcp-snowluma', 'mcp-snowluma-host', 'mcp-web-search-safe'];
      const mcpIds = mcpEntries.map((x) => x.id);
      check('deploy', 'profile patch 含桥接必需的 MCP 且 id 无重复',
        REQUIRED_MCPS.every((id) => mcpIds.includes(id)) && new Set(mcpIds).size === mcpIds.length,
        mcpIds.join(', '));
      const snowluma = inserts.find((x) => x.id === 'mcp-snowluma');
      check('deploy', 'mcp-snowluma 带 toolCallTimeoutMs=725000', snowluma?.config?.toolCallTimeoutMs === 725000);
      check('deploy', 'mcp 路径指向本仓库',
        mcpEntries.every((e) => String(e?.config?.args?.[0] ?? '').includes('qq-bridge')));
    }

    const bundles = deployed.pkg?.dsh?.profile?.bundles ?? [];
    check('deploy', 'profile bundles 含 qq-mode-console', bundles.includes('qq-mode-console'));
    check('deploy', 'profile bundles 含 qq-agent-presets', bundles.includes('qq-agent-presets'));
    check('deploy', 'qq-mode-console link 依赖已注册', String(deployed.pkg?.dependencies?.['qq-mode-console'] ?? '').startsWith('link:'));
    check('deploy', 'qq-agent-presets link 依赖已注册', String(deployed.pkg?.dependencies?.['qq-agent-presets'] ?? '').startsWith('link:'));
    // junction 检查：pnpm 的 link: 依赖会建指向仓库的 junction，守卫行的裸说明符靠它解析。
    for (const pkgName of ['qq-mode-console', 'qq-agent-presets']) {
      check('deploy', `${pkgName} 已 link 进 profile node_modules`,
        fs.existsSync(path.join(profileDir, 'node_modules', pkgName)));
    }

    // 部署件就是仓库件（junction），但「磁盘上改了」不等于「DSH 已经加载了」。
    // 这条从 **profile 的 node_modules 解析路径**加载守卫，断言这台机器上会被 DSH 加载的
    // 那份代码是新结构——避免出现「仓库修好了，运行中的还是旧名单」这种假绿。
    const deployedGuard = path.join(profileDir, 'node_modules', 'qq-agent-presets', 'qq-tool-restrict.mjs');
    if (!fs.existsSync(deployedGuard)) {
      skip('deploy', '已部署的守卫是新版（能力分组派生）', `${path.relative(ROOT, deployedGuard)} 不存在`);
    } else {
      try {
        const mod = await import(`${pathToFileURL(deployedGuard).href}?t=${Date.now()}`);
        const groups = mod.TOOL_GROUPS ? Object.keys(mod.TOOL_GROUPS).length : 0;
        const local = mod.LOCAL_EXECUTION_TOOLS ?? [];
        const derived = new Set(Object.values(mod.TOOL_GROUPS ?? {}).flat()).size;
        check('deploy', '已部署的守卫是新版（分组派生 / 无 dev_mode_* 假名）',
          groups >= 8 && local.length === derived
            && !(mod.RESTRICTED_TOOL_NAMES ?? []).some((n) => n.startsWith('dev_mode_')),
          `分组 ${groups}；派生 ${local.length}/${derived}；名单 ${mod.RESTRICTED_TOOL_NAMES?.length ?? 0}`);
      } catch (error) {
        check('deploy', '已部署的守卫可被加载', false, String(error?.message ?? error));
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. live 层：运行中的 DSH
// ═══════════════════════════════════════════════════════════════════════════
if (want('live')) {
  // 先找到"能握手成功的那个端口"，再谈断言：
  //   · 0.2.1 起桌面版端口随机 ⇒ 必须探测；
  //   · 探测可能拿到别的本机服务 ⇒ 必须用 settings/describe 成功来确认身份；
  //   · 一个都连不上时，这一层要**干净地失败**，不能抛 undici 栈（上一版实测会崩在
  //     discoverDshSessionCookie 里，连"没找到 DSH"这句话都打印不出来）。
  let BASE = null;
  let cookie = null;
  for (const base of candidateBaseUrls()) {
    let candidateCookie = null;
    try { candidateCookie = discoverDshSessionCookie(base); } catch { continue; }
    if (!candidateCookie) continue;
    try {
      const res = await fetch(`${base}/api/settings/describe`, {
        method: 'POST',
        headers: { cookie: candidateCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'probe', method: 'settings/describe', payload: { args: {} } }),
        signal: AbortSignal.timeout(3000),
      });
      const body = await res.json();
      if (body?.result) { BASE = base; cookie = candidateCookie; break; }
    } catch { /* 端口不通或不响应 DSH 协议，试下一个 */ }
  }

  if (!BASE) {
    check('live', '找到运行中的 DSH 并通过鉴权', false,
      `候选：${candidateBaseUrls().join(', ')}；可用 DSH_BASE_URL 指定`);
  } else {
    results.push(`ℹ [live] DSH 基址 = ${BASE}${process.env.DSH_BASE_URL ? '（来自 DSH_BASE_URL）' : '（自动探测）'}`);
    check('live', '本机签名密钥 → 铸造会话 Cookie 成功', Boolean(cookie), cookie ? `${cookie.length} 字节` : '读不到 browser-session 密钥');

    // 鉴权走与桥接生产代码同一条路：用 ~/.dsh 里持久化的签名密钥离线铸造会话 Cookie。
    // 旧写法（从 ~/.dsh/guard/logs/server-*.out.log 里抓 `?token=`）在 0.1.7 已经死了：
    //   · 进程启动 token 是现生成的 32 字节随机数，只存在内存 WeakMap 里，不落盘；
    //   · guard 插件退役后也没有启动器再把 `dsh web` 的 stdout 重定向到那个目录。
    async function rpc(endpoint, args) {
      const r = await fetch(`${BASE}/api/${endpoint}`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'v' + Math.random().toString(36).slice(2, 8), method: endpoint, payload: { args } }),
      });
      return (await r.json()).result;
    }

    const st = await rpc('settings/describe', {});
    check('live', 'settings/describe 可用', st.ok === true);
    const dm = st.value?.namespaces?.find((n) => n.ns === 'agent-default-model');
    check('live', 'DSH 全局默认模型 = deepseek-flash', dm?.value?.model === 'deepseek-flash', `当前 ${dm?.value?.model}`);
    const ap = await rpc('agentPresets/list', {});
    const presetIds = ap.value?.presets?.map((p) => p.id) ?? [];
    check('live', 'agentPresets/list 含 qq-chat 与 qq-chat-v2', presetIds.includes('qq-chat') && presetIds.includes('qq-chat-v2'), presetIds.join(', '));
    // 0.1.7 把设置命名空间从 `agent-presets` 改名为 `agent-preset-registry`，而且「用户默认」
    // 是易失字段 selectedDefault，不会出现在 describe 的 value 里。部署默认由 registry 行的
    // config.default 决定（dsh-web-app 的 patch 写的是 standard）。桥接在 closedAgentPreset
    // 留空时依赖的正是它，所以这里断言「注册表已装载」+「standard 预设存在」这两件可观测的事。
    check('live', 'preset 注册表命名空间已装载',
      st.value?.namespaces?.some((n) => n.ns === 'agent-preset-registry'));
    check('live', 'closed-agent 兜底所需的 standard 预设可用', presetIds.includes('standard'), presetIds.join(', '));

    // ── qq-mode 命名空间（0.2.0 删除了 ctx.settings.register()）─────────────
    // 0.2.0 里命名空间**不再需要注册**：它由 profile 里 id 恰好等于命名空间名的 loader
    // entry + 该插件导出的 Config（含 volatile 字段）推导出来。这条断言把「模式能写穿
    // DSH 设置」的可观测结果钉住 —— 它一旦坏掉，控制台改模式只在本地生效，
    // 下一次 DSH 轮询就回滚，而且不会有任何提示。
    const qqMode = st.value?.namespaces?.find((n) => n.ns === 'qq-mode');
    check('live', 'settings/describe 列出 qq-mode 命名空间', qqMode !== undefined,
      `${st.value?.namespaces?.length ?? 0} 个命名空间`);
    if (qqMode) {
      check('live', 'qq-mode 带 mode 字段', typeof qqMode.value?.mode === 'string', JSON.stringify(qqMode.value));
      check('live', 'qq-mode 带 revision（写入所需）', Number.isInteger(qqMode.revision), String(qqMode.revision));
      // settings/update 是**多参数** RPC：args 是 { ns, patch, expectedRevision } 平铺，
      // 不是 { request: {...} }（传 request 会被网关拒为
      // `gateway/arguments-invalid: missing "ns", "patch"; unexpected "request"`）。
      const writeBack = await rpc('settings/update', {
        ns: 'qq-mode', patch: { mode: qqMode.value.mode }, expectedRevision: qqMode.revision,
      });
      check('live', 'settings/update 可写 qq-mode（参数为平铺多参数，非 request 包装）', writeBack.ok === true,
        writeBack.ok ? `mode=${writeBack.value?.value?.mode}` : `${writeBack.error?.code}: ${writeBack.error?.message}`);
    }

    // ── session/projections：读会话队列的主路径 ────────────────────────────
    const probeDir = path.join(os.tmpdir(), 'qq-bridge-verify-live');
    fs.rmSync(probeDir, { recursive: true, force: true });
    fs.mkdirSync(probeDir, { recursive: true });
    const api = new NodeApiClient(BASE, undefined, {});
    let probeSessionId = null;
    try {
      await api.ensureAuth();
      const created = unwrap(await api.sessions.create({ cwd: probeDir, agentPreset: 'qq-chat-v2' }), 'session.create');
      probeSessionId = created.sessionId;
      check('live', 'session/create 挂 qq-chat-v2 preset 成功', typeof probeSessionId === 'string' && probeSessionId.length > 0, probeSessionId);
      unwrap(await api.sessions.selectModel({
        sessionId: probeSessionId, provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max',
      }), 'session.selectModel');
      check('live', 'session/selectModel(deepseek-flash) 被接受', true);

      const projections = await api.callUnary('session/projections', { sessionId: probeSessionId });
      check('live', 'session/projections 一元 RPC 可用', projections.result?.ok === true,
        projections.result?.ok ? '' : `${projections.result?.error?.code}: ${projections.result?.error?.message}`);
      const values = projections.result?.value?.values;
      check('live', 'session/projections 返回 values.inbox（next-turn / next-step）',
        values?.inbox !== undefined && Array.isArray(values.inbox['next-turn']) && Array.isArray(values.inbox['next-step']),
        Object.keys(values ?? {}).slice(0, 6).join(','));

      // ── control baseline 形状（0.2.0 的核心断裂点）──────────────────────
      const url = new URL('/api/remote.mux', BASE);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const baseline = await new Promise((resolve, reject) => {
        const socket = new WebSocket(url, { headers: { cookie: api.cookie } });
        const streamId = randomUUID();
        const timer = setTimeout(() => { try { socket.close(); } catch {} reject(new Error('control baseline 超时')); }, 15_000);
        const finish = (err, value) => { clearTimeout(timer); try { socket.close(); } catch {} err ? reject(err) : resolve(value); };
        socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'session/control', payload: { args: {} } })));
        socket.addEventListener('message', (ev) => {
          let m; try { m = JSON.parse(ev.data); } catch { return; }
          if (m.streamId !== streamId) return;
          if (m.type === 'item' && m.value?.type === 'baseline') finish(null, m.value);
          else if (m.type === 'error' || m.type === 'end') finish(new Error(`control ${m.type}${m.error?.code ? ` (${m.error.code})` : ''}`));
        });
        socket.addEventListener('error', () => finish(new Error('control socket error')));
      }).catch((error) => { skip('live', 'session/control 开场 baseline 形状', error.message); return null; });
      if (baseline) {
        const bv = baseline.value;
        check('live', 'control baseline 是 value.projections（0.2.0 形状）',
          bv !== null && typeof bv?.projections === 'object' && bv.projections !== null);
        check('live', 'control baseline 不再有 value.queues（0.1.7 形状已废弃）',
          bv !== null && !Object.hasOwn(bv ?? {}, 'queues'));
        const sample = bv?.projections?.[probeSessionId]?.values;
        check('live', 'baseline 里探测会话的投影带 inbox', sample?.inbox !== undefined,
          Object.keys(sample ?? {}).slice(0, 6).join(','));
      }

      // ── 核心回归：退役会话不再抛 baseline 结构错 ────────────────────────
      // 0.2.0 之前这段代码读 `value.queues[<id>]`，形状一变就**每次**退役都抛
      // "invalid session/control baseline"，队列清不掉、旧任务继续在 DSH 里跑，
      // 而桥接日志里只有一行警告。这条断言就是那次断裂的回归网。
      let retireError = null;
      let retired = null;
      try { retired = await api.stopSessionWork(probeSessionId); } catch (error) { retireError = error; }
      check('live', 'stopSessionWork 在真实会话上成功返回（不再抛 baseline 结构错）',
        retireError === null, retireError?.message ?? `removed=${retired?.removed}`);

      // ── $events ready 帧 ────────────────────────────────────────────────
      const readyFrame = await new Promise((resolve) => {
        const socket = new WebSocket(url, { headers: { cookie: api.cookie } });
        const streamId = randomUUID();
        const timer = setTimeout(() => { try { socket.close(); } catch {} resolve(null); }, 10_000);
        const finish = (value) => { clearTimeout(timer); try { socket.close(); } catch {} resolve(value); };
        socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'open', streamId, endpoint: '$events', payload: { args: {} } })));
        socket.addEventListener('message', (ev) => {
          let m; try { m = JSON.parse(ev.data); } catch { return; }
          if (m.streamId !== streamId || m.type !== 'item') return;
          if (m.value?.type === 'ready') finish(m.value);
        });
        socket.addEventListener('error', () => finish(null));
      });
      check('live', '$events 下发 ready 帧并带 clientId',
        typeof readyFrame?.clientId === 'string' && readyFrame.clientId.length > 0,
        readyFrame ? `${String(readyFrame.clientId).slice(0, 8)}…` : '未收到 ready 帧');

      // ── session/modelCatalog 形状 ───────────────────────────────────────
      const catalog = await api.callUnary('session/modelCatalog', {});
      check('live', 'session/modelCatalog 可用且给出模型分组',
        catalog.result?.ok === true && Array.isArray(catalog.result?.value?.groups),
        catalog.result?.ok ? `${catalog.result.value.groups.length} 组` : `${catalog.result?.error?.code}`);
    } catch (error) {
      check('live', 'DSH 实测段无未捕获异常', false, error?.message ?? String(error));
    } finally {
      if (probeSessionId) {
        try { await api.callUnary('session/cancel', { sessionId: probeSessionId }); } catch {}
        try { await api.callUnary('workspace/archiveSession', { sessionId: probeSessionId }); } catch {}
      }
      try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch {}
    }

    // 点号 endpoint（旧协议）应返回纯文本 404（不是 JSON 信封）——证明协议确为斜杠式
    const dotRes = await fetch(`${BASE}/api/session.list`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'v-dot', method: 'session.list', payload: { args: { _request: {} } } }),
    });
    const dotBody = await dotRes.text();
    check('live', '点号 endpoint /api/session.list 不可用（旧协议已废弃）', dotRes.status === 404 && /not found/i.test(dotBody), `HTTP ${dotRes.status}`);
  }
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
console.log(results.join('\n'));
console.log(`\n[${LAYER}] 总计: ${pass} 通过, ${fail} 失败, ${skipped} 跳过`);
// 用 process.exitCode 而不是 process.exit()：后者会在 undici 的 keep-alive socket
// 仍在关闭途中强行拆掉事件循环，在 Windows 上触发 libuv 断言
// （Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c）。
// 结果是「断言全过但退出码非 0」，CI 会误判失败。设 exitCode 让循环自然排空即可。
process.exitCode = fail === 0 ? 0 : 1;
