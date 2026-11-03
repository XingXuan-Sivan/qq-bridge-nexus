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

test('注入块（P4）：按 priority 排序、按块截断、超总预算整块跳过，停用后不再注入', async () => {
  const { root, pluginsDir, stateDir } = makeTempRoot();
  fs.writeFileSync(path.join(root, 'plugins.json'), JSON.stringify({ limits: { maxPromptAppendChars: 10 } }, null, 2));
  const blockIndex = `
export function activate(ctx) {
  ctx.prompt.registerBlock({ id: 'alpha', priority: 10, maxChars: 5, render: () => 'AAAAAA' });
  ctx.prompt.registerBlock({ id: 'beta', priority: 20, render: () => 'BBBBB' });
  ctx.prompt.registerBlock({ id: 'gamma', priority: 30, render: () => 'CCCCCC' });
  ctx.prompt.registerBlock({ id: 'boom', priority: 40, render: () => { throw new Error('nope'); } });
  return {};
}
`;
  writePlugin(pluginsDir, 'blocktap', blockIndex, { permissions: ['prompt:provide'], hooks: [] });
  const kernel = await createPluginKernel({ rootDir: root, stateDir, log: () => {} });
  await kernel.init();
  try {
    const entry = kernel.status().plugins.find((item) => item.id === 'blocktap');
    assert.deepEqual(entry.blocks, ['alpha', 'beta', 'gamma', 'boom']);
    assert.equal(kernel.status().promptBlocks.total, 4);

    const rendered = await kernel.promptBlocks({ key: 'group:1' });
    assert.equal(rendered.text, 'AAAAA\n\nBBBBB', '先按 priority 排序，再逐块限额');
    assert.equal(rendered.chars, 10);
    const byId = Object.fromEntries(rendered.blocks.map((item) => [item.id, item.status]));
    assert.equal(byId.alpha, 'truncated');
    assert.equal(byId.beta, 'injected');
    assert.equal(byId.gamma, 'budget', '超出总预算的块整块跳过，不截半句');
    assert.equal(byId.boom, 'error', '单块抛错不影响其它块');

    assert.equal((await kernel.disable('blocktap')).ok, true);
    const afterDisable = await kernel.promptBlocks({ key: 'group:1' });
    assert.equal(afterDisable.text, '', '停用后旧块必须消失');
    assert.equal(kernel.status().promptBlocks.total, 0);

    assert.equal((await kernel.enable('blocktap')).ok, true);
    assert.equal((await kernel.promptBlocks({ key: 'group:1' })).chars, 10, '启用后恢复');
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

const DECORATE_A = `
export function activate() {
  return { hooks: { onReplyDecorate: ({ text }) => ({ text: text + ' 🐳' }) } };
}
`;

const DECORATE_B = `
export function activate() {
  return {
    hooks: {
      onReplyDecorate: ({ text }) => (text.includes('删掉我') ? { drop: true } : text.toUpperCase()),
    },
  };
}
`;

const DECORATE_BOOM = `
export function activate() {
  return { hooks: { onReplyDecorate: () => { throw new Error('decorate boom'); } } };
}
`;

test('出站装饰：链式改写、drop 取消、抛错保留上一步结果', async () => {
  const { root, pluginsDir, stateDir } = makeTempRoot();
  const hooks = { permissions: [], hooks: ['onReplyDecorate'] };
  writePlugin(pluginsDir, 'deco-a', DECORATE_A, hooks);
  writePlugin(pluginsDir, 'deco-b', DECORATE_B, hooks);
  writePlugin(pluginsDir, 'deco-boom', DECORATE_BOOM, hooks);
  const kernel = await createPluginKernel({ rootDir: root, stateDir, log: () => {} });
  await kernel.init();
  try {
    // 按 id 顺序链式执行：a 追加 → b 大写 → boom 抛错但不回滚前面的结果。
    const chained = await kernel.decorateReply({ key: 'group:1', text: 'hi', partIndex: 0, totalParts: 1 });
    assert.equal(chained.dropped, false);
    assert.equal(chained.text, 'HI 🐳');
    assert.equal(chained.changedBy, 'deco-b');
    const boom = kernel.status().plugins.find((entry) => entry.id === 'deco-boom');
    assert.equal(boom.counters.hookErrors, 1);

    const dropped = await kernel.decorateReply({ key: 'group:1', text: '请删掉我', partIndex: 0, totalParts: 1 });
    assert.equal(dropped.dropped, true);

    // 停用中间那个：装饰链只剩 a，说明链是按实时 active 集合走的。
    kernel.disable('deco-b');
    const onlyA = await kernel.decorateReply({ key: 'group:1', text: 'hi', partIndex: 0, totalParts: 1 });
    assert.equal(onlyA.text, 'hi 🐳');
    assert.equal(onlyA.changedBy, 'deco-a');
  } finally {
    await kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const FILTER_DROP = `
export function activate() {
  return { hooks: { onInbound: ({ text }) => (text.includes('广告') ? { drop: true } : undefined) } };
}
`;

const FILTER_REWRITE = `
export function activate() {
  return { hooks: { onInbound: ({ text }) => (text.includes('坏词') ? { text: text.replace('坏词', '***') } : undefined) } };
}
`;

const FILTER_NOPERM = `
export function activate() {
  return { hooks: { onInbound: ({ text }) => (text.includes('敏感词') ? { text: text.replace('敏感词', '***') } : undefined) } };
}
`;

test('入站过滤：默认关不生效、开关打开后可丢可改、无权限动作被忽略', async () => {
  const { root, pluginsDir, stateDir } = makeTempRoot();
  const withPerm = { permissions: ['inbound:filter'], hooks: ['onInbound'] };
  writePlugin(pluginsDir, 'filter-drop', FILTER_DROP, withPerm);
  writePlugin(pluginsDir, 'filter-rewrite', FILTER_REWRITE, withPerm);
  writePlugin(pluginsDir, 'filter-noperm', FILTER_NOPERM, { permissions: [], hooks: ['onInbound'] });
  const kernel = await createPluginKernel({ rootDir: root, stateDir, log: () => {} });
  await kernel.init();
  try {
    // 默认 filters.inbound=false：钩子不参与过滤，返回值原样。
    const off = await kernel.filterInbound({ key: 'group:1', text: '这是广告' });
    assert.equal(off.dropped, false);
    assert.equal(off.text, null);
  } finally {
    await kernel.shutdown();
  }

  fs.writeFileSync(path.join(root, 'plugins.json'), JSON.stringify({ filters: { inbound: true } }, null, 2));
  const kernel2 = await createPluginKernel({ rootDir: root, stateDir, log: () => {} });
  await kernel2.init();
  try {
    const dropped = await kernel2.filterInbound({ key: 'group:1', text: '这是广告' });
    assert.equal(dropped.dropped, true);
    assert.equal(dropped.changedBy, 'filter-drop');

    const rewritten = await kernel2.filterInbound({ key: 'group:1', text: '这句有坏词' });
    assert.equal(rewritten.dropped, false);
    assert.equal(rewritten.text, '这句有***');
    assert.equal(rewritten.changedBy, 'filter-rewrite');

    // filter-noperm 没有 inbound:filter：它想改的文字必须被忽略，原文继续。
    const plain = await kernel2.filterInbound({ key: 'group:1', text: '含敏感词的消息' });
    assert.equal(plain.text, null);
  } finally {
    await kernel2.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('设置接口：白名单字段校验、写回 plugins.json、watch 即时生效', async () => {
  const { root, pluginsDir, stateDir } = makeTempRoot();
  writePlugin(pluginsDir, 'demo', DEMO_INDEX);
  const kernel = await createPluginKernel({ rootDir: root, stateDir, log: () => {} });
  await kernel.init();
  try {
    // 越界值会被 normalizeConfig 降级并产生 warning：整份拒绝，不落盘。
    const rejected = await kernel.updateSettings({ limits: { hookTimeoutMs: 999999 } });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /hookTimeoutMs/);
    assert.equal(fs.existsSync(path.join(root, 'plugins.json')), false);

    const ok = await kernel.updateSettings({
      watch: true,
      filters: { inbound: true },
      limits: { hookTimeoutMs: 1500 },
      plugins: { demo: { enabled: false } },
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.restartRequired, true);
    const file = JSON.parse(fs.readFileSync(path.join(root, 'plugins.json'), 'utf8'));
    assert.equal(file.watch, true);
    assert.equal(file.filters.inbound, true);
    assert.equal(file.limits.hookTimeoutMs, 1500);
    assert.equal(file.plugins.demo.enabled, false);
    assert.equal(kernel.status().watch, true);
    assert.equal(kernel.status().watching, true);

    // 不在白名单里的字段直接忽略：audit 不能被界面改掉。
    const ignored = await kernel.updateSettings({ nope: 1, audit: { enabled: false } });
    assert.equal(ignored.ok, true);
    const file2 = JSON.parse(fs.readFileSync(path.join(root, 'plugins.json'), 'utf8'));
    assert.equal(file2.audit.enabled, true);
  } finally {
    await kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const TASK_INDEX = `
export function activate(ctx) {
  ctx.scheduler.registerTaskType({
    id: 'pig-latin',
    label: '倒着念',
    description: '把 payload.text 倒过来发（测试用）',
    validate(input) {
      const text = String(input?.payload?.text ?? '').trim();
      if (!text) throw new Error('text 必填');
      return { text };
    },
    async run(task, context) {
      ctx.state.write('last-run', { text: task.payload.text, target: context.target, when: context.whenText ?? null });
      return { status: 'sent', reason: 'ok' };
    },
  });
  return {};
}
`;

test('定时任务类型（P8）：注册、校验、执行、停用后消失，重复 id 被忽略', async () => {
  const { root, pluginsDir, stateDir } = makeTempRoot();
  writePlugin(pluginsDir, 'tasktap', TASK_INDEX, { permissions: ['state', 'task-type:provide'], hooks: [] });
  writePlugin(pluginsDir, 'taskcopy', TASK_INDEX, { permissions: ['state', 'task-type:provide'], hooks: [] });
  const kernel = await createPluginKernel({ rootDir: root, stateDir, log: () => {} });
  await kernel.init();
  try {
    // 两个插件注册同一个 id：只保留先注册的，后一个只记日志。
    const types = kernel.status().taskTypes;
    assert.equal(types.length, 1);
    assert.equal(types[0].id, 'pig-latin');
    assert.equal(types[0].label, '倒着念');
    assert.equal(types[0].pluginId, 'taskcopy');
    assert.equal(kernel.hasTaskType('pig-latin'), true);

    assert.deepEqual(kernel.validateTaskType('pig-latin', { payload: { text: ' abc ' } }), { text: 'abc' });
    assert.throws(() => kernel.validateTaskType('pig-latin', { payload: { text: '' } }), /text 必填/);
    assert.throws(() => kernel.validateTaskType('nope', {}), /未知任务类型/);

    const result = await kernel.runTaskType('pig-latin', { id: 1, kind: 'pig-latin', payload: { text: 'abc' }, target: 'group:1' }, { target: 'group:1', whenText: '今天' });
    assert.equal(result.status, 'sent');
    const saved = JSON.parse(fs.readFileSync(path.join(stateDir, 'plugins', 'taskcopy', 'last-run.json'), 'utf8'));
    assert.deepEqual(saved, { text: 'abc', target: 'group:1', when: '今天' });

    await kernel.disable('taskcopy');
    assert.equal(kernel.hasTaskType('pig-latin'), false);
    assert.equal(kernel.status().taskTypes.length, 0);
    await assert.rejects(() => kernel.runTaskType('pig-latin', { kind: 'pig-latin' }, {}), /未注册/);

    await kernel.enable('taskcopy');
    assert.equal(kernel.hasTaskType('pig-latin'), true);
  } finally {
    await kernel.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
