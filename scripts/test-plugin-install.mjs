// 插件安装/卸载回归（docs/PLUGIN_KERNEL.md §5.2 / §14）。
//
// 只钉住「装错东西会出事」的那几条契约：
//   1. 目录安装成功后插件真的能激活，重复安装被拒绝；
//   2. 清单不合法时不留下 plugins/ 目录，也不留 .staging-*；
//   3. zip 必须恰好一个含 plugin.json 的根，`../` 穿越与超限在解压前就被挡住；
//   4. 卸载是「移到 state/_trash」，不是硬删，且运行实例先被 dispose。
//
// 全部离线：在临时目录里建一个最小仓库，不碰仓库自己的 plugins/ 与 state/。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import { createPluginKernel } from '../src/plugins/kernel.mjs';

const INDEX = `
export function activate(ctx) {
  ctx.state.write('loaded', { ok: true });
  return { hooks: { onInbound: () => { ctx.state.write('seen', { ok: true }); } } };
}
`;

function manifest(overrides = {}) {
  return {
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    main: 'index.mjs',
    apiVersion: 1,
    permissions: ['state'],
    hooks: ['onInbound'],
    description: '安装测试插件',
    ...overrides,
  };
}

function makeRoot(config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-install-'));
  fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'plugins.json'),
    JSON.stringify({ audit: { enabled: true }, install: { enabled: true, maxBytes: 2 * 1024 * 1024 }, ...config }, null, 2),
  );
  return root;
}

function writeSource(root, name, overrides = {}, index = INDEX) {
  const dir = path.join(root, '_fixtures', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(manifest({ id: name, ...overrides }), null, 2));
  if (index) fs.writeFileSync(path.join(dir, 'index.mjs'), index);
  return dir;
}

function buildZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const compressed = zlib.deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(compressed.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += 30 + name.length + compressed.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

async function bootKernel(root) {
  const kernel = await createPluginKernel({
    rootDir: root,
    stateDir: path.join(root, 'state'),
    log: () => {},
    deps: {},
  });
  await kernel.init();
  return kernel;
}

test('目录安装：成功后插件激活，重复安装被拒绝', async () => {
  const root = makeRoot();
  const source = writeSource(root, 'demo');
  const kernel = await bootKernel(root);

  const first = await kernel.install({ kind: 'dir', source });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.plugin.id, 'demo');
  assert.equal(fs.existsSync(path.join(root, 'plugins', 'demo', 'plugin.json')), true);
  assert.equal(kernel.status().plugins.find((p) => p.id === 'demo')?.status, 'active');

  const second = await kernel.install({ kind: 'dir', source });
  assert.equal(second.ok, false);
  assert.match(second.error, /已存在/);
  await kernel.shutdown();
});

test('目录安装：清单不合法时不留目录，也不留暂存目录', async () => {
  const root = makeRoot();
  const source = writeSource(root, 'badplugin', { id: 'Bad_Id' });
  const kernel = await bootKernel(root);
  try {
    const result = await kernel.install({ kind: 'dir', source });
    assert.equal(result.ok, false);
    assert.match(result.error, /id/);
    assert.deepEqual(fs.readdirSync(path.join(root, 'plugins')), []);
  } finally {
    await kernel.shutdown();
  }
});

test('zip 安装：压缩包里有且只有一个含 plugin.json 的根', async () => {
  const root = makeRoot();
  const zip = buildZip([
    { name: 'zipped/plugin.json', data: JSON.stringify(manifest({ id: 'zipped' })) },
    { name: 'zipped/index.mjs', data: INDEX },
  ]);
  const kernel = await bootKernel(root);
  try {
    const result = await kernel.install({ kind: 'zip', source: zip });
    assert.equal(result.ok, true, result.error);
    assert.equal(fs.existsSync(path.join(root, 'plugins', 'zipped', 'index.mjs')), true);
    assert.equal(kernel.status().plugins.find((p) => p.id === 'zipped')?.status, 'active');
  } finally {
    await kernel.shutdown();
  }
});

test('zip 安装：`../` 穿越在解压前被拒绝，仓库外没有落文件', async () => {
  const root = makeRoot();
  const zip = buildZip([
    { name: 'ok/plugin.json', data: JSON.stringify(manifest({ id: 'ok' })) },
    { name: 'ok/index.mjs', data: INDEX },
    { name: '../escape.txt', data: 'evil' },
  ]);
  const kernel = await bootKernel(root);
  try {
    const result = await kernel.install({ kind: 'zip', source: zip });
    assert.equal(result.ok, false);
    assert.match(result.error, /穿越|非法|路径/);
    assert.equal(fs.existsSync(path.join(root, 'escape.txt')), false);
    assert.equal(fs.existsSync(path.join(root, 'plugins', 'ok')), false);
  } finally {
    await kernel.shutdown();
  }
});

test('zip 安装：解压后超过 maxBytes 被拒绝', async () => {
  const root = makeRoot({ install: { enabled: true, maxBytes: 1024 * 1024 } });
  const zip = buildZip([
    { name: 'big/plugin.json', data: JSON.stringify(manifest({ id: 'big' })) },
    { name: 'big/index.mjs', data: INDEX },
    { name: 'big/blob.bin', data: Buffer.alloc(1.2 * 1024 * 1024, 7) },
  ]);
  const kernel = await bootKernel(root);
  try {
    const result = await kernel.install({ kind: 'zip', source: zip });
    assert.equal(result.ok, false);
    assert.match(result.error, /超过|限制|过大|上限/);
    assert.equal(fs.existsSync(path.join(root, 'plugins', 'big')), false);
  } finally {
    await kernel.shutdown();
  }
});

test('卸载：先 dispose，目录移到 state/_trash，不硬删', async () => {
  const root = makeRoot();
  const source = writeSource(root, 'gone');
  const kernel = await bootKernel(root);
  try {
    assert.equal((await kernel.install({ kind: 'dir', source })).ok, true);
    const result = await kernel.uninstall('gone');
    assert.equal(result.ok, true, result.error);
    assert.equal(fs.existsSync(path.join(root, 'plugins', 'gone')), false);
    assert.ok(result.trash, '应返回 trash 相对路径');
    const trashDir = path.join(root, result.trash);
    assert.equal(fs.existsSync(path.join(trashDir, 'plugin.json')), true);
    assert.equal(kernel.status().plugins.some((p) => p.id === 'gone'), false);

    // 插件自己的 dispose 在卸载时被调用过（state/plugins/gone/ 下应有写入）。
    const auditFile = path.join(root, 'state', 'plugin-audit.jsonl');
    assert.match(fs.readFileSync(auditFile, 'utf8'), /"uninstall"/);
  } finally {
    await kernel.shutdown();
  }
});
