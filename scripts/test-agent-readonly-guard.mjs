// 运维 Agent 三个能力档（readonly / workspace / full）的硬边界：
//   · 编译出来的预设行里没有任何 shell / 子代理 / 工作流 / 任务类行；
//   · 守卫按能力档分别以 profile: readonly-agent / operator 运行；
//   · 审批闸门按 policy: workspace / full 决策，缺少配置时按更严的 full 处理；
//   · 不带 profile 时守卫行为与原版完全一致（群友会话不因此多出读文件能力）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const presetsDir = path.join(root, 'artifacts', 'dsh', 'qq-agent-presets', 'presets');
const guardUrl = pathToFileURL(path.join(root, 'artifacts/dsh', 'qq-agent-presets', 'qq-tool-restrict.mjs')).href;

/**
 * 预设编译出来的插件行：能力档只声明效果，行由 dsh/render.yml 编译进产物。
 * 断言落在产物上，是因为装配到 DSH 里的就是它；产物与意图的一致性由 build --check 与
 * test-agent-preset-patches 保证。
 */
function capabilityRows(id) {
  const file = path.join(presetsDir, `${id}.patch.yml`);
  assert.ok(fs.existsSync(file), `${id} 的产物存在（${path.relative(root, file)}）`);
  const patch = parseYaml(fs.readFileSync(file, 'utf8'));
  const rows = patch?.[0]?.insert?.[0]?.config?.plugins;
  assert.ok(Array.isArray(rows) && rows.length > 0, `${id} 的产物应含插件行`);
  return flatten(rows);
}

function flatten(rows) {
  const out = [];
  for (const r of rows) {
    out.push(r);
    if (r.group && Array.isArray(r.config)) out.push(...flatten(r.config));
  }
  return out;
}

function makeGuard(mod, config) {
  const restricted = [];
  let guard;
  mod.apply({ tools: { restrict: ({ deny }) => restricted.push(...deny), guard: (fn) => { guard = fn; } } }, config);
  return { guard, restricted };
}

test('L1 能力档不挂载任何执行/派生类工具行', () => {
  const rows = capabilityRows('readonly');
  const names = rows.map((r) => r.name);
  for (const forbidden of ['dsh-tool-pwsh', 'dsh-tool-bash', 'dsh-tool-subagent', 'dsh-tool-workflow', 'dsh-tool-jobs', 'dsh-workflow-ptc', 'dsh-tool-ralph', 'dsh-tool-str-replace-editor', 'dsh-tool-goal', 'dsh-plan-mode', 'dsh-tool-workspace-dependencies']) {
    assert.ok(!names.some((n) => String(n).includes(forbidden)), `不应挂载 ${forbidden}`);
  }
  const guardRow = rows.find((r) => r.id === 'qq-tool-restrict');
  assert.equal(guardRow?.config?.profile, 'readonly-agent');
});

test('readonly-agent 守卫：放行只读工具与 QQ MCP，拒绝写入/执行/未知工具', async () => {
  const mod = await import(guardUrl);
  const { guard, restricted } = makeGuard(mod, { profile: 'readonly-agent' });
  for (const name of ['read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch', 'todo_write', 'ask_user_question', 'mcp__snowluma__read_messages']) {
    assert.equal(guard({ name }), undefined, `应放行 ${name}`);
  }
  for (const name of ['write', 'edit', 'str_replace_editor', 'pwsh', 'bash', 'subagent', 'workflow', 'job_kill', 'plugin_manager', 'load_workspace_dependencies', 'schedule_create', 'mcp__filesystem__write', 'unknown_tool', '', null]) {
    assert.equal(typeof guard({ name }), 'string', `应拒绝 ${JSON.stringify(name)}`);
  }
  assert.ok(!restricted.includes('read'), '只读工具不从 schema 隐藏');
  assert.ok(restricted.includes('pwsh') && restricted.includes('write'));
});

test('不带 profile 时守卫与原版一致：群友会话依旧不能读文件', async () => {
  const mod = await import(guardUrl);
  const { guard, restricted } = makeGuard(mod, undefined);
  for (const name of ['read', 'glob', 'grep', 'web_fetch', 'write', 'pwsh']) {
    assert.equal(typeof guard({ name }), 'string', `群友会话应拒绝 ${name}`);
  }
  assert.ok(restricted.includes('read'));
  assert.deepEqual([...mod.READONLY_AGENT_TOOLS].sort(), ['glob', 'grep', 'read', 'read_image', 'web_fetch', 'web_search']);
});

test('桥接的对端权限档预设与能力档一致，完全访问仍保留审批', async () => {
  // 对端权限档的取值域由能力档 runtime.peerPermission 选用，三项都在安装期写进 DSH profile。
  const runtime = await import(pathToFileURL(path.join(root, 'profiles', 'agent-platforms', 'dsh', 'adapters', 'runtime.mjs')).href);
  assert.deepEqual([...runtime.PEER_PERMISSIONS], ['read-only', 'workspace-write', 'qq-full-ask']);
  assert.equal(runtime.PERMISSION_PRESETS['qq-full-ask'].approval, 'ask', '完全访问必须保留审批');
  assert.equal(runtime.PERMISSION_PRESETS['qq-full-ask'].sandbox, 'danger-full-access');
  // preset id 不带用户平台前缀：同一个 readonly 对任何用户侧平台都成立；旧名归一即可。
  assert.ok(runtime.AGENT_PRESET_IDS.includes('readonly'));
  assert.equal(runtime.normalizeAgentPreset('qq-agent-readonly'), 'readonly');
});

// ── workspace / full 运维 preset 的审批闸门与凭据保护（独立安全审查后新增）─────────
const gateUrl = pathToFileURL(path.join(root, 'artifacts/dsh', 'qq-agent-presets', 'qq-approval-gate.mjs')).href;
const ppUrl = pathToFileURL(path.join(root, 'artifacts/dsh', 'qq-agent-presets', 'protected-paths.mjs')).href;

test('审批闸门：workspace 执行命令要审批、工作区写入放行；full 除只读外全部要审批；派生类直接拒绝', async () => {
  const { decide } = await import(gateUrl);
  assert.equal(decide({ name: 'pwsh', arguments: { command: 'dir' } }, 'workspace'), 'ask');
  assert.equal(decide({ name: 'write', arguments: { file_path: 'C:/work/a.txt' } }, 'workspace'), 'allow');
  assert.equal(decide({ name: 'write', arguments: { file_path: 'C:/work/a.txt' } }, 'full'), 'ask');
  assert.equal(decide({ name: 'pwsh', arguments: { command: 'dir' } }, 'full'), 'ask');
  assert.equal(decide({ name: 'read', arguments: { file_path: 'C:/work/a.txt' } }, 'full'), 'allow');
  assert.equal(decide({ name: 'mcp__snowluma__read_messages' }, 'full'), 'allow');
  assert.equal(decide({ name: 'brand_new_tool' }, 'workspace'), 'ask', '未知工具按需审批处理');
  for (const t of ['subagent', 'workflow', 'plugin_manager', 'schedule_create']) assert.ok(decide({ name: t }, 'full').deny, t);
});

test('审批闸门：apply 注册 tools/pre-execute，返回 ask；上游拒绝时不放宽', async () => {
  const mod = await import(gateUrl);
  let handler;
  mod.apply({ on: (ev, fn) => { assert.equal(ev, 'tools/pre-execute'); handler = fn; } }, { policy: 'full' });
  assert.equal((await handler({ name: 'pwsh', arguments: { command: 'x' } }, async () => ({ kind: 'allow' }))).kind, 'ask');
  assert.equal((await handler({ name: 'read', arguments: { file_path: 'C:/w/a' } }, async () => ({ kind: 'allow' }))).kind, 'allow');
  assert.equal((await handler({ name: 'pwsh' }, async () => ({ kind: 'deny', reason: 'sandbox' }))).kind, 'deny');
  let h2;
  mod.apply({ on: (ev, fn) => { h2 = fn; } }, {});
  assert.equal((await h2({ name: 'write', arguments: { file_path: 'C:/w/a' } }, async () => ({ kind: 'allow' }))).kind, 'ask', '缺省 policy 按更严的 full');
});

test('凭据保护：桥接 state/、config.json、DSH 凭据与向上跳出的相对路径都被拒绝', async () => {
  const { touchesProtected, protectedFileReason, PROTECTED_PATHS } = await import(ppUrl);
  for (const p of PROTECTED_PATHS) assert.equal(touchesProtected(p), true, p);
  assert.equal(touchesProtected(path.join(root, 'state', 'admin', 'audit.jsonl')), true);
  assert.equal(touchesProtected('../console-token'), true);
  assert.equal(touchesProtected(['..', '..', 'config.json'].join(path.sep)), true);
  assert.equal(touchesProtected('D:/anything/.credentials.yaml'), true);
  assert.equal(touchesProtected('C:/Users/someone/project/readme.md'), false);
  assert.ok(protectedFileReason({ name: 'grep', arguments: { pattern: 'token', path: path.join(root, 'state') } }));
  assert.equal(protectedFileReason({ name: 'read', arguments: { file_path: 'C:/proj/a.txt' } }), undefined);
});

test('operator 守卫：拒绝派生/编排类与凭据读取，其余交给审批闸门', async () => {
  const mod = await import(guardUrl);
  const { guard, restricted } = makeGuard(mod, { profile: 'operator' });
  assert.equal(guard({ name: 'pwsh', arguments: { command: 'dir' } }), undefined, 'pwsh 由闸门审批，不由守卫拒绝');
  assert.equal(typeof guard({ name: 'subagent' }), 'string');
  assert.equal(typeof guard({ name: 'dev_install_package' }), 'string');
  assert.equal(typeof guard({ name: 'read', arguments: { file_path: path.join(root, 'state', 'console-token') } }), 'string');
  assert.ok(!restricted.includes('pwsh'));
});

test('workspace / full 能力档：挂了闸门与 operator 守卫，没有子代理/工作流/插件管理行', () => {
  for (const [id, policy] of [['workspace', 'workspace'], ['full', 'full']]) {
    const rows = capabilityRows(id);
    assert.equal(rows.find((r) => r.id === 'qq-approval-gate')?.config?.policy, policy, id);
    assert.equal(rows.find((r) => r.id === 'qq-tool-restrict')?.config?.profile, 'operator', id);
    for (const forbidden of ['dsh-tool-subagent', 'dsh-tool-workflow', 'dsh-workflow-ptc', 'dsh-plugin-manager', 'dsh-tool-skill', 'dsh-plan-mode', 'dsh-tool-goal']) {
      assert.ok(!rows.some((r) => String(r.name).includes(forbidden)), `${id} 不应挂 ${forbidden}`);
    }
  }
});
