// 铁律 L7 的登记期断言：仿真会话的 preset 不得包含本地执行能力。
//
// QQ 动作闸门全部跑在桥接进程内，而 OneBot 的 HTTP 接口可被本机任意进程调用 ⇒
// 「仿真会话拿不到 shell」是分层安全模型唯一的真边界。
//
// 本文件从真实 preset 文件解析组成，断言守卫被挂载、restrict 名单覆盖每个已知危险工具。
// 名单与分组一律**从守卫导入**，不在本文件手抄。
//
// 唯一的豁免是 RUNTIME_INJECTOR_TOOLS（dev_* 运行时注入器，静态扫不到），并受两条约束：
// 注入器名字必须以 dev_ 开头（防止任意名字混进来绕过对账），执行期必须按 dev_ 前缀拒绝。

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectDshToolNames as collectDshToolNamesShared } from './dsh-tool-names.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PRESETS_DIR = path.join(ROOT, 'profiles', 'agent-platforms', 'dsh', 'agents');

/** 仿真模式使用的 preset（不允许有任何本地执行能力）。 */
const SIMULATION_PRESETS = ['qq-chat', 'qq-chat-v2'];

/** 封闭 agent 的 preset：按设计**允许**完整本地工具面。 */
const CLOSED_AGENT_PRESETS = ['qsh-closed'];

/** 允许出现的 MCP 命名空间前缀（QQ 动作面）。 */
const EXPECTED_SAFE_PREFIXES = [
  'mcp__snowluma__',
  'mcp__snowluma-host__',
  'mcp__web-search-safe__',
];

function readPreset(id) {
  const dir = path.join(PRESETS_DIR, id);
  assert.ok(fs.existsSync(dir), `preset 目录存在：${id}`);
  const cordis = path.join(dir, 'agent.cordis.yml');
  assert.ok(fs.existsSync(cordis), `preset 有 agent.cordis.yml：${id}`);
  return { dir, yml: fs.readFileSync(cordis, 'utf8'), cordis };
}

/**
 * 导入 preset 目录下的守卫（它是个 `export *` 壳，指向 bundle 里的唯一实现）。
 *
 * 走壳而不是直接 import 实现，是为了顺带证明壳本身没坏——部署到 profile 的是壳，
 * 壳断了等于守卫没挂上。
 */
async function guardFor(id) {
  const { dir } = readPreset(id);
  const guardPath = path.join(dir, 'qq-tool-restrict.mjs');
  assert.ok(fs.existsSync(guardPath), `${id} 的守卫文件存在`);
  return import(pathToFileURL(guardPath).href);
}

const guardMain = await guardFor('qq-chat');

/** 权威名单（来自守卫，不是本文件手抄）。 */
const DANGEROUS = guardMain.LOCAL_EXECUTION_TOOLS;
const RESTRICTED = guardMain.RESTRICTED_TOOL_NAMES;
const INJECTOR = guardMain.RUNTIME_INJECTOR_TOOLS;
const GROUPS = guardMain.TOOL_GROUPS;

/** 带假 tools 服务跑一遍真实守卫，捕获它实际下发的 restrict 与 guard。 */
async function applyGuard(id) {
  const mod = await guardFor(id);
  const restricted = new Set();
  const fakeTools = {
    restrict({ deny }) { for (const n of deny ?? []) restricted.add(n); },
    guard(fn) { this._guard = fn; },
  };
  mod.apply({ tools: fakeTools });
  return { mod, restricted, fakeTools };
}

// ---------------------------------------------------------------------------
test('模拟会话的 preset 都挂了工具守卫（否则 L7 没有任何载体）', () => {
  for (const id of SIMULATION_PRESETS) {
    const { yml } = readPreset(id);
    assert.match(
      yml,
      /qq-tool-restrict/,
      `${id} 必须挂载 qq-tool-restrict（L7 的落点），否则本地工具会随全局层继承进来`,
    );
    // 源文件里仍是 preset 目录内的相对名；DSH 0.1.7 下真正装进 DSH 的是 bundle patch
    // （scripts/build-agent-preset-patches.mjs 生成），那里会把它改写成从 profile 目录
    // 可解析的 `qq-agent-presets/qq-tool-restrict.mjs`——这条断言钉的是"源里必须有守卫行"，
    // 改写结果由 test-agent-preset-patches.mjs 钉住。
    assert.match(yml, /\.\/qq-tool-restrict\.mjs/, `${id} 的守卫要指向本目录的 .mjs`);
  }
});

test('模拟会话的 preset 不得挂载 tool-web 的 search/fetch', () => {
  for (const id of SIMULATION_PRESETS) {
    const { yml } = readPreset(id);
    const webRow = /id:\s*tool-web[\s\S]{0,200}/.exec(yml);
    assert.ok(webRow, `${id} 应有 tool-web 条目`);
    assert.match(webRow[0], /search:\s*false/, `${id}: tool-web.search 必须为 false`);
    assert.match(webRow[0], /fetch:\s*false/, `${id}: tool-web.fetch 必须为 false`);
  }
});

test('守卫导出的名单与自己声明的分组自洽', () => {
  // 结构约束：RESTRICTED = 危险工具 ∪ 注入器族，且两者不相交。
  const union = new Set([...DANGEROUS, ...INJECTOR]);
  assert.deepEqual(
    [...RESTRICTED].sort(), [...union].sort(),
    'RESTRICTED_TOOL_NAMES 必须恰好等于「危险工具 ∪ 注入器族」——多出来的名字没有人知道它属于哪一类',
  );
  assert.equal(new Set(RESTRICTED).size, RESTRICTED.length, '名单里不允许有重复名字');

  // 每个分组都必须非空：空分组通常是删名字时忘了改结构，会让下面"按组派生"悄悄失效。
  for (const [group, names] of Object.entries(GROUPS)) {
    assert.ok(Array.isArray(names) && names.length > 0, `分组 ${group} 不能为空`);
    for (const n of names) {
      assert.match(n, /^[a-z][a-z0-9_]*$/, `分组 ${group} 里的 "${n}" 不像工具名`);
    }
  }

  // 无害工具不得混进危险名单（否则与执行期白名单自相矛盾）。
  for (const allowed of ['ask_user_question', 'todo_write', 'compress']) {
    assert.ok(!RESTRICTED.includes(allowed),
      `${allowed} 是无害模型侧工具，不应出现在 restrict 名单里（会与 SAFE_EXACT 自相矛盾）`);
  }
});

test('守卫的 restrict 名单覆盖每一个已知危险工具', async () => {
  for (const id of SIMULATION_PRESETS) {
    const { restricted, fakeTools } = await applyGuard(id);

    const violations = DANGEROUS.filter((t) => !restricted.has(t));
    assert.deepEqual(
      violations, [],
      `${id}: 以下危险工具未出现在 restrict 名单里，会留在模型的工具清单中：`
      + `${violations.join(', ')}。注册期隐藏失败 ⇒ §5.2 的 L7 断言不成立。`,
    );

    // 执行期白名单也必须拒绝它们（restrict 与 guard 是两道，不能只靠一道）。
    assert.equal(typeof fakeTools._guard, 'function', `${id}: 守卫注册了执行期白名单`);
    for (const tool of DANGEROUS) {
      const verdict = fakeTools._guard({ name: tool });
      assert.ok(
        typeof verdict === 'string' && verdict.length > 0,
        `${id}: 危险工具 "${tool}" 必须在执行期被拒绝，实际返回 ${JSON.stringify(verdict)}`,
      );
    }
  }
});

test('注入器族只能是 dev_ 前缀，且执行期按前缀拒绝', async () => {
  for (const n of INJECTOR) {
    assert.ok(n.startsWith('dev_'),
      `注入器族里的 "${n}" 不以 dev_ 开头：这一族享有"静态扫不到也算正常"的豁免，`
      + '不能用来装别的名字');
  }
  // 前缀兜底：将来注入器改了具体名字（枚举必然过期），执行期仍然挡住。
  for (const id of SIMULATION_PRESETS) {
    const { fakeTools } = await applyGuard(id);
    for (const name of ['dev_inject_plugin', 'dev_some_future_tool', 'dev_']) {
      const verdict = fakeTools._guard({ name });
      assert.ok(typeof verdict === 'string' && verdict.length > 0,
        `${id}: dev_ 前缀的 "${name}" 必须在执行期被拒绝（不依赖枚举完整性）`);
    }
  }
});

test('守卫名单里的每个危险名字都是 DSH 真实注册的工具（防拼错假名静默失效）', async () => {
  // 为什么必须测：`tools.restrict()` 对未知名字会抛错，而守卫逐个 try/catch
  // 只打日志 ⇒ 拼错的名字 = **静默 no-op**。历史上两次真事故都是这样：
  // 0.1.7 的 pwsh_persistent 等 5 个假名、0.2.1 起消失却从未被断言的 dev_mode_* 3 个。
  let names;
  try { ({ names } = collectDshToolNamesShared()); } catch (error) {
    // 离线环境（未安装 DSH / 定位失败）按「跳过」处理，不能把「没装 DSH」误报成假名。
    console.log(`  ⏭  跳过：无法读取 DSH 工具包（${error?.message ?? error}）`);
    return;
  }
  if (names.size === 0) {
    console.log('  ⏭  跳过：未扫到任何 DSH 包');
    return;
  }

  for (const id of SIMULATION_PRESETS) {
    const mod = await guardFor(id);
    const fabricated = mod.RESTRICTED_TOOL_NAMES
      .filter((n) => !mod.RUNTIME_INJECTOR_TOOLS.includes(n))
      .filter((n) => !names.has(n));
    assert.deepEqual(fabricated, [],
      `${id}: 以下名字在 DSH 已安装的工具包里找不到 ⇒ restrict 会抛错并被吞掉，`
      + `限制静默失效：${fabricated.join(', ')}。`
      + '（若该名字属于运行时注入器，应放进 RUNTIME_INJECTOR_TOOLS；'
      + '若它属于可选插件，请先确认插件确实会注册它。）');
  }
});

test('守卫仍放行 QQ MCP 命名空间与无害模型侧工具', async () => {
  for (const id of SIMULATION_PRESETS) {
    const { fakeTools } = await applyGuard(id);

    for (const prefix of EXPECTED_SAFE_PREFIXES) {
      assert.equal(
        fakeTools._guard({ name: `${prefix}some_tool` }), undefined,
        `${id}: MCP 前缀 ${prefix} 应放行`,
      );
    }
    for (const name of ['ask_user_question', 'todo_write', 'compress']) {
      assert.equal(fakeTools._guard({ name }), undefined, `${id}: ${name} 应放行`);
    }
    // 未知工具名必须 fail-closed。
    for (const name of ['', null, undefined, 'mcp__unknown__x', 'totally_new_tool']) {
      assert.ok(
        typeof fakeTools._guard({ name }) === 'string',
        `${id}: 未知工具 ${JSON.stringify(name)} 必须被拒绝（fail-closed）`,
      );
    }
  }
});

test('operator / readonly 两个 profile 的名单从分组派生，不各自手抄', () => {
  const operatorDeny = new Set(guardMain.OPERATOR_DENY_TOOLS);
  // operator 明确要拒绝的组：派生 / 编排 / 插件 / 调度 / 跨会话 / MCP 资源。
  for (const group of ['agents', 'plugins', 'schedule', 'sessionQuery', 'mcpResources']) {
    for (const name of GROUPS[group]) {
      assert.ok(operatorDeny.has(name), `OPERATOR_DENY_TOOLS 漏了 ${group} 组的 "${name}"`);
    }
  }
  // operator 需要保留的能力：shell 与文件读写（由审批闸门管），不能被误禁。
  for (const name of ['pwsh', 'bash', 'read', 'write', 'edit']) {
    assert.ok(!operatorDeny.has(name), `operator 需要 "${name}"（审批闸门负责），不应被拒绝`);
  }
  // readonly 白名单只允许只读能力。
  for (const name of guardMain.READONLY_AGENT_TOOLS) {
    assert.ok(
      ['read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch'].includes(name),
      `READONLY_AGENT_TOOLS 里的 "${name}" 超出"只读"范围`,
    );
  }
});

test('封闭 agent 的预设在创建后必须与仿真 preset 明确区分', () => {
  // qsh-closed 由 ADR 0003 定义为**故意**拥有完整本地工具面：它的守卫只负责
  // "哪些 QQ 动作可见"，不负责"本地工具权限边界"。
  //
  // ⚠️ 这条断言初版是**恒真**的：qsh-closed 还不存在，`if (!exists) continue`
  // 直接跳过整个函数体，永远不会失败——一个永远不会失败的测试不如没有。
  // 现在改为显式记录"尚未创建"，并且一旦创建就执行真实断言。
  const present = CLOSED_AGENT_PRESETS.filter((id) => fs.existsSync(path.join(PRESETS_DIR, id)));
  if (present.length === 0) {
    // 不是失败，但必须让人看见"这条闸门还没被真正覆盖"。
    console.log('  ⏭  qsh-closed 尚未创建（ADR 0003 待落地）；此项覆盖暂为空，不是通过。');
    return;
  }
  for (const id of present) {
    const yml = fs.readFileSync(path.join(PRESETS_DIR, id, 'agent.cordis.yml'), 'utf8');
    assert.match(yml, /qq-tool-restrict/, `${id} 也应挂守卫（用于 QQ 动作可见性）`);
    // 与仿真 preset 的关键区别：封闭 agent 必须能拿到本地工具 ⇒
    // 它的守卫不得把本地执行工具写进 restrict 名单。
    const guard = fs.readFileSync(path.join(PRESETS_DIR, id, 'qq-tool-restrict.mjs'), 'utf8');
    for (const tool of ['pwsh', 'read', 'write']) {
      assert.ok(
        !new RegExp(`['"]${tool}['"]`).test(guard),
        `${id}: 封闭 agent 需要本地工具，守卫不应把 "${tool}" 列入 restrict`,
      );
    }
  }
});
