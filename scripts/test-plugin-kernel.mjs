// 插件内核回归（docs/PLUGIN_KERNEL.md §13）。
//
// 目标不是覆盖每一行，而是钉住四类**只在集成时才会炸**的契约：
//   1. 清单/配置的坏输入只降级、不阻断桥接启动；
//   2. 钩子超时与抛错被隔离，主链拿到的是「没有这个插件」而不是异常；
//   3. 人格 provider 的 resolve 必须同步，且能被 bridge 的注入点直接消费；
//   4. 关闭流程先 dispose、再 onShutdown、最后写停机审计。
//
// 全部离线：插件夹具写在临时目录，状态与审计也落在临时目录，不碰仓库 state/。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateManifest, resolveMainPath } from '../src/plugins/manifest.mjs';
import { normalizeConfig, defaultConfig } from '../src/plugins/config.mjs';
import { createAuditLog } from '../src/plugins/audit.mjs';
import { createPluginKernel, pluginIdFromPath } from '../src/plugins/kernel.mjs';

const DEMO_INDEX = `
export function activate(ctx) {
  ctx.persona.register({
    id: 'demo-persona',
    contract: 'persona-provider/1',
    capabilities: { perSession: true, conditional: false, listable: false },
    async get(key) {
      return key === 'group:123'
        ? { status: 'card', card: { name: '星苒', text: '这是人格卡正文' } }
        : { status: 'none', reason: 'unbound' };
    },
  });
  return {
    hooks: {
      onInbound: (payload) => { ctx.state.write('inbound', { key: payload.key, text: payload.text }); },
      onPromptBuild: (payload) => ({ prependText: 'PRE:' + payload.mode, appendText: 'APP' }),
      onAfterSend: (payload) => { ctx.state.write('sent', payload); },
      onShutdown: () => { ctx.state.write('shutdown', { ok: true }); },
    },
    dispose: () => { ctx.state.write('disposed', { ok: true }); },
  };
}
`;

const SLOW_INDEX = `
export function activate() {
  return {
    hooks: {
      onInbound: () => new Promise(() => {}),
    },
  };
}
`;

const UNDECLARED_INDEX = `
export function activate() {
  return {
    hooks: {
      onInbound: () => {},
    },
  };
}
`;

function manifest(overrides = {}) {
  return {
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    main: 'index.mjs',
    apiVersion: 1,
    permissions: ['state', 'persona:provide'],
    hooks: ['onInbound', 'onPromptBuild', 'onAfterSend', 'onShutdown'],
    description: '测试插件',
    ...overrides,
  };
}

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-kernel-'));
  const pluginsDir = path.join(root, 'plugins');
  fs.mkdirSync(pluginsDir, { recursive: true });
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  return { root, pluginsDir, stateDir };
}

function writePlugin(pluginsDir, id, indexSource, overrides = {}) {
  const dir = path.join(pluginsDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(manifest({ id, ...overrides }), null, 2));
  if (indexSource) fs.writeFileSync(path.join(dir, 'index.mjs'), indexSource);
  return dir;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('清单校验：id 必须等于目录名，权限与钩子必须在白名单内', () => {
  const ok = validateManifest(manifest(), 'demo');
  assert.equal(ok.ok, true);
  assert.equal(ok.manifest.id, 'demo');

  const mismatch = validateManifest(manifest({ id: 'other' }), 'demo');
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.errors.join('；'), /id/);

  const badPermission = validateManifest(manifest({ permissions: ['root'] }), 'demo');
  assert.equal(badPermission.ok, false);
  assert.match(badPermission.errors.join('；'), /未知权限|permissions/);

  const badHook = validateManifest(manifest({ hooks: ['onEverything'] }), 'demo');
  assert.equal(badHook.ok, false);

  const badVersion = validateManifest(manifest({ version: '1.0' }), 'demo');
  assert.equal(badVersion.ok, false);
});

test('清单校验：入口路径不允许跳出插件目录', () => {
  const dir = path.join(os.tmpdir(), 'plugin-path-check');
  assert.throws(() => resolveMainPath(dir, '../escape.mjs'), /越界|目录/);
  assert.equal(resolveMainPath(dir, 'index.mjs'), path.join(dir, 'index.mjs'));
});

test('配置：缺省即默认值，越界只回落而不是报错', () => {
  const defaults = normalizeConfig(null);
  assert.deepEqual(defaults.config, defaultConfig());

  const { config, warnings } = normalizeConfig({
    dir: '../outside',
    limits: { hookTimeoutMs: 1, maxPlugins: 999, maxPromptAppendChars: -5 },
    audit: { keep: 99 },
    plugins: { demo: { enabled: false, config: { a: 1 } }, 'Bad_Id': {} },
  });
  assert.equal(config.dir, 'plugins');
  assert.equal(config.limits.hookTimeoutMs, 2000);
  assert.equal(config.limits.maxPlugins, 32);
  assert.equal(config.limits.maxPromptAppendChars, 4000);
  assert.equal(config.audit.keep, 3);
  assert.equal(config.plugins.demo.enabled, false);
  assert.deepEqual(config.plugins.demo.config, { a: 1 });
  assert.equal(config.plugins.Bad_Id, undefined);
  assert.ok(warnings.length >= 5);
});

test('审计：超过 maxBytes 轮转到 .1，旧文件内容不丢', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-audit-'));
  const file = path.join(dir, 'audit.jsonl');
  const audit = createAuditLog({ file, maxBytes: 260, keep: 3, enabled: true, log: () => {} });
  for (let i = 0; i < 5; i += 1) audit.append('hook', { i, pad: 'x'.repeat(60) });
  assert.ok(fs.existsSync(file));
  // 每行约 110 字节：260 字节 ≈ 两行，5 条会触发至少一次轮转；老内容落在 .1/.2/.3 之一。
  const rotated = ['.1', '.2', '.3']
    .map((suffix) => `${file}${suffix}`)
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => fs.readFileSync(candidate, 'utf8'))
    .join('\n');
  assert.match(rotated, /"i":0/);
  assert.match(rotated, /"i":2/);
});

test('内核：加载/禁用/坏清单的状态与人格 provider', async () => {
  const { root, pluginsDir, stateDir } = makeTempRoot();
  writePlugin(pluginsDir, 'demo', DEMO_INDEX);
  writePlugin(pluginsDir, 'off', DEMO_INDEX, { permissions: [], hooks: [] });
  fs.writeFileSync(path.join(root, 'plugins.json'), JSON.stringify({
    plugins: { off: { enabled: false } },
  }, null, 2));
  // 坏清单：id 与目录名不一致
  const badDir = path.join(pluginsDir, 'bad');
  fs.mkdirSync(badDir, { recursive: true });
  fs.writeFileSync(path.join(badDir, 'plugin.json'), JSON.stringify(manifest({ id: 'not-bad', hooks: [] })));

  const kernel = await createPluginKernel({ rootDir: root, stateDir, log: () => {} });
  await kernel.init();
  const status = kernel.status();
  const byId = Object.fromEntries(status.plugins.map((entry) => [entry.id, entry]));
  assert.equal(byId.demo.status, 'active');
  assert.deepEqual(byId.demo.hooks.sort(), ['onAfterSend', 'onInbound', 'onPromptBuild', 'onShutdown']);
  assert.equal(byId.off.status, 'disabled');
  assert.equal(byId.bad.status, 'invalid');
  assert.match(byId.bad.error, /id/);

  // 注册表不再同步 resolve：先 warm 拿卡，再同步读缓存（bridge 的注入点只做后者）。
  assert.equal(kernel.personaResolve('group:123'), null);
  const card = await kernel.personaWarm('group:123');
  assert.equal(card.name, '星苒');
  assert.match(card.fingerprint, /^[0-9a-f]{16}$/);
  assert.equal(kernel.personaResolve('group:123').text, '这是人格卡正文');
  assert.equal(await kernel.personaWarm('group:999'), null);
  assert.equal(kernel.personaResolve('group:999'), null);
  assert.equal(kernel.status().persona.plugin, 'demo');
  assert.equal(kernel.status().persona.cards, 1);

  const additions = await kernel.promptAdditions({ key: 'group:123', mode: 'reserved2', text: '原始提示词' });
  assert.equal(additions.prependText, 'PRE:reserved2');
  assert.equal(additions.appendText, 'APP');

  kernel.notify('onInbound', { key: 'group:123', text: '你好' });
  await sleep(120);
  const inbound = JSON.parse(fs.readFileSync(path.join(stateDir, 'plugins', 'demo', 'inbound.json'), 'utf8'));
  assert.deepEqual(inbound, { key: 'group:123', text: '你好' });

  await kernel.shutdown();
  const after = kernel.status();
  assert.equal(after.plugins.find((entry) => entry.id === 'demo').status, 'stopped');
  assert.ok(fs.existsSync(path.join(stateDir, 'plugins', 'demo', 'disposed.json')));
  assert.ok(fs.existsSync(path.join(stateDir, 'plugins', 'demo', 'shutdown.json')));

  const auditLines = fs.readFileSync(path.join(stateDir, 'plugin-audit.jsonl'), 'utf8').trim().split('\n');
  assert.ok(auditLines.some((line) => line.includes('"activate"')));
  assert.ok(auditLines.some((line) => line.includes('"deactivate"')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('内核：钩子超时被隔离，且不阻塞 notify 调用方', async () => {
  const { root, pluginsDir, stateDir } = makeTempRoot();
  writePlugin(pluginsDir, 'slow', SLOW_INDEX, { permissions: [], hooks: ['onInbound'] });
  fs.writeFileSync(path.join(root, 'plugins.json'), JSON.stringify({ limits: { hookTimeoutMs: 120 } }, null, 2));

  const kernel = await createPluginKernel({ rootDir: root, stateDir, log: () => {} });
  await kernel.init();
  const startedAt = Date.now();
  kernel.notify('onInbound', { text: 'x' });
  assert.ok(Date.now() - startedAt < 50, 'notify 必须是即发即忘');

  await sleep(400);
  const entry = kernel.status().plugins.find((plugin) => plugin.id === 'slow');
  assert.equal(entry.counters.hookErrors, 1);
  assert.match(entry.error, /超时/);
  const auditText = fs.readFileSync(path.join(stateDir, 'plugin-audit.jsonl'), 'utf8');
  assert.match(auditText, /"timeout"/);
  await kernel.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

test('内核：未在清单声明的钩子被忽略（防止插件绕过声明偷偷接主链）', async () => {
  const { root, pluginsDir, stateDir } = makeTempRoot();
  writePlugin(pluginsDir, 'sneaky', UNDECLARED_INDEX, { permissions: [], hooks: [] });
  const logs = [];
  const kernel = await createPluginKernel({ rootDir: root, stateDir, log: (line) => logs.push(line) });
  await kernel.init();
  const entry = kernel.status().plugins.find((plugin) => plugin.id === 'sneaky');
  assert.equal(entry.status, 'active');
  assert.deepEqual(entry.hooks, []);
  assert.ok(logs.some((line) => line.includes('未在清单声明')));
  await kernel.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

const NEXT_INDEX = `
export function activate(ctx) {
  return {
    hooks: {
      onInbound: (payload) => { ctx.state.write('inbound', { key: payload.key, text: 'v2:' + payload.text }); },
    },
    dispose: () => { ctx.state.write('disposed', { ok: true }); },
  };
}
`;

const BROKEN_INDEX = `
export function activate() {
  throw new Error('boom');
}
`;

test('管理动作：disable / enable / reload / detail，重载失败保留旧实例', async () => {
  const { root, pluginsDir, stateDir } = makeTempRoot();
  writePlugin(pluginsDir, 'demo', DEMO_INDEX);
  const kernel = await createPluginKernel({ rootDir: root, stateDir, log: () => {} });
  await kernel.init();

  const stateFile = (name) => path.join(stateDir, 'plugins', 'demo', `${name}.json`);

  const detail = kernel.detail('demo');
  assert.equal(detail.manifest.id, 'demo');
  assert.deepEqual([...detail.permissions].sort(), ['persona:provide', 'state']);
  assert.ok(Array.isArray(detail.audit));
  assert.equal(kernel.detail('missing'), null);

  // 停用：钩子不再调用，provider 也不再解析
  assert.equal((await kernel.disable('demo')).ok, true);
  assert.equal(kernel.status().plugins.find((p) => p.id === 'demo').status, 'disabled');
  kernel.notify('onInbound', { key: 'g', text: 'disabled' });
  await sleep(80);
  assert.equal(fs.existsSync(stateFile('inbound')), false);
  assert.equal(kernel.personaResolve('group:123'), null);

  // 启用：从磁盘重新加载
  assert.equal((await kernel.enable('demo')).ok, true);
  assert.equal(kernel.status().plugins.find((p) => p.id === 'demo').status, 'active');

  // 重载：换一份实现，验证读到新版本、新行为
  await sleep(20);
  fs.writeFileSync(path.join(pluginsDir, 'demo', 'index.mjs'), NEXT_INDEX);
  fs.writeFileSync(path.join(pluginsDir, 'demo', 'plugin.json'), JSON.stringify(manifest({ version: '1.1.0' }), null, 2));
  const reloaded = await kernel.reload('demo');
  assert.equal(reloaded.ok, true);
  assert.equal(reloaded.plugin.version, '1.1.0');
  kernel.notify('onInbound', { key: 'g', text: 'hello' });
  await sleep(120);
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile('inbound'), 'utf8')), { key: 'g', text: 'v2:hello' });

  // 重载失败：旧实例继续跑，错误可见
  await sleep(20);
  fs.writeFileSync(path.join(pluginsDir, 'demo', 'index.mjs'), BROKEN_INDEX);
  const failed = await kernel.reload('demo');
  assert.equal(failed.ok, false);
  assert.match(failed.error, /boom/);
  const entry = kernel.status().plugins.find((p) => p.id === 'demo');
  assert.equal(entry.status, 'active');
  assert.match(entry.error, /boom/);
  kernel.notify('onInbound', { key: 'g', text: 'still' });
  await sleep(120);
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile('inbound'), 'utf8')), { key: 'g', text: 'v2:still' });

  // 不存在的插件
  assert.equal((await kernel.reload('nope')).ok, false);
  assert.equal((await kernel.enable('nope')).ok, false);

  const auditText = fs.readFileSync(path.join(stateDir, 'plugin-audit.jsonl'), 'utf8');
  assert.match(auditText, /"disable"/);
  assert.match(auditText, /"enable"/);
  assert.match(auditText, /"reload"/);
  assert.match(auditText, /"reload-failed"/);

  await kernel.shutdown();
  fs.rmSync(root, { recursive: true, force: true });
});

test('文件监听：路径到插件 id 只认 plugins/<id>/… 下的变更', () => {
  const dir = path.join(os.tmpdir(), 'plugin-watch-map');
  assert.equal(pluginIdFromPath(dir, path.join(dir, 'demo', 'index.mjs')), 'demo');
  assert.equal(pluginIdFromPath(dir, path.join(dir, '.staging-x', 'plugin', 'plugin.json')), null);
  assert.equal(pluginIdFromPath(dir, path.join(dir, '..', 'evil.mjs')), null);
  assert.equal(pluginIdFromPath(dir, path.join(dir, 'Bad_Id', 'x.mjs')), null);
  assert.equal(pluginIdFromPath(dir, dir), null);
});

test('配置：watch 只接受布尔值，默认关闭', () => {
  assert.equal(defaultConfig().watch, false);
  const on = normalizeConfig({ watch: true });
  assert.equal(on.config.watch, true);
  assert.equal(on.warnings.length, 0);

  const bad = normalizeConfig({ watch: 'yes' });
  assert.equal(bad.config.watch, false);
  assert.match(bad.warnings.join('；'), /watch/);
});

test('插件命令（P3b）：注册的命令可派发，停用后按 pluginId 注销，启用后恢复', async () => {
  const { root, pluginsDir, stateDir } = makeTempRoot();
  const { createCommandRegistry } = await import('../src/commands/registry.mjs');
  const registry = createCommandRegistry({ log: () => {} });
  const commandIndex = `
export function activate(ctx) {
  ctx.commands.register({
    name: '/hello',
    aliases: ['/hi'],
    scope: 'all',
    permission: 'all',
    help: '插件命令测试',
    handler: async (call) => ({ echoed: call.arg }),
  });
  return {};
}
`;
  writePlugin(pluginsDir, 'cmdtap', commandIndex, { permissions: ['commands'], hooks: [] });
  const kernel = await createPluginKernel({ rootDir: root, stateDir, log: () => {}, deps: { commandRegistry: registry } });
  await kernel.init();
  try {
    const entry = kernel.status().plugins.find((item) => item.id === 'cmdtap');
    assert.deepEqual(entry.commands, ['/hello']);

    const hit = await registry.dispatch('/hi 世界', { key: 'group:1', kind: 'group' });
    assert.equal(hit.handled, true);
    assert.equal(hit.result.echoed, '世界');

    assert.equal((await kernel.disable('cmdtap')).ok, true);
    assert.equal(registry.match('/hello'), null, '停用后插件命令必须消失');
    assert.equal((await registry.dispatch('/hello', { key: 'group:1', kind: 'group' })).handled, false);

    assert.equal((await kernel.enable('cmdtap')).ok, true);
    assert.ok(registry.match('/hello'), '启用后命令恢复');
  } finally {
    await kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('文件监听（P2c）：开启后 watching 为真，改入口文件会在 5 秒内重载该插件', async () => {
  const { root, pluginsDir, stateDir } = makeTempRoot();
  fs.writeFileSync(path.join(root, 'plugins.json'), JSON.stringify({ watch: true }, null, 2));
  writePlugin(pluginsDir, 'watchme', DEMO_INDEX);
  const kernel = await createPluginKernel({ rootDir: root, stateDir, log: () => {} });
  await kernel.init();
  try {
    assert.equal(kernel.status().watch, true);
    assert.equal(kernel.status().watching, true);
    assert.equal(kernel.status().plugins.find((entry) => entry.id === 'watchme').counters.reloads, 0);

    // 20ms 后再写：避免与首次 import 落在同一毫秒，导致 ?v=<mtime> 命中同一缓存。
    await sleep(20);
    fs.writeFileSync(path.join(pluginsDir, 'watchme', 'index.mjs'), DEMO_INDEX.replace('PRE:', 'PRE2:'));
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const reloads = kernel.status().plugins.find((entry) => entry.id === 'watchme')?.counters.reloads ?? 0;
      if (reloads >= 1) break;
      await sleep(100);
    }
    const entry = kernel.status().plugins.find((item) => item.id === 'watchme');
    assert.ok(entry.counters.reloads >= 1, '改文件后应自动重载，实际 reloads=' + entry.counters.reloads);
    assert.equal(entry.status, 'active');
  } finally {
    await kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
