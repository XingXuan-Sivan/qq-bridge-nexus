// HTTP 边界回归（docs/HTTP_BOUNDARY.md §1/§2/§6）：
// 锁住「静态资源只允许根内白名单扩展名的真实文件」，以及穿越失败一律 404、不回显路径。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveStaticPath, serveStaticFile, sendNotFound, STATIC_MIME } from '../src/http/static.mjs';
import { SECURITY_HEADERS } from '../src/http/security.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqb-http-'));
fs.mkdirSync(path.join(root, 'js'), { recursive: true });
fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>t</title>');
fs.writeFileSync(path.join(root, 'js', 'app.js'), 'export const x = 1;\n');
fs.writeFileSync(path.join(root, 'notes.md'), '# nope\n'); // 白名单外扩展名
fs.mkdirSync(path.join(root, 'sub'), { recursive: true });

const opts = { prefix: '/console/' };
const resolve = (p) => resolveStaticPath(root, p, opts);

function mockRes() {
  const calls = [];
  return {
    calls,
    writeHead(status, headers) { calls.push({ status, headers }); },
    end(body) { calls.push({ body: String(body) }); },
  };
}

test('正常文件与目录尾斜杠都能命中', () => {
  const index = resolve('/console/');
  assert.equal(index.ok, true);
  assert.equal(index.mime, STATIC_MIME['.html']);
  const js = resolve('/console/js/app.js');
  assert.equal(js.ok, true);
  assert.equal(js.mime, STATIC_MIME['.js']);
});

test('路径穿越的各种编码都拒绝', () => {
  const vectors = [
    '/console/../state/console-token',
    '/console/%2e%2e/state/console-token',
    '/console/..%2fstate%2fconsole-token',
    '/console/js/../../state/console-token',
    '/console/..\\state\\console-token',
    '/console/%252e%252e/state/console-token', // 双编码：只解码一次，落到字面文件名上 → missing
  ];
  for (const vector of vectors) {
    const result = resolve(vector);
    assert.equal(result.ok, false, `应当拒绝：${vector}`);
    assert.ok(['traversal', 'charset', 'missing', 'segments', 'type'].includes(result.reason), `${vector} → ${result.reason}`);
  }
});

test('盘符、NTFS 备用流、空字节一律拒绝', () => {
  for (const vector of ['/console/C:/Windows/win.ini', '/console/js/app.js::$DATA', '/console/index%00.html']) {
    const result = resolve(vector);
    assert.equal(result.ok, false, vector);
    assert.ok(['colon', 'charset'].includes(result.reason), `${vector} → ${result.reason}`);
  }
});

test('前缀外与白名单外扩展名拒绝', () => {
  assert.equal(resolve('/api/status').reason, 'prefix');
  assert.equal(resolve('/console/notes.md').reason, 'type');
});

test('目录与不存在的文件分别报 not-file / missing', () => {
  assert.equal(resolve('/console/sub').reason, 'not-file');
  assert.equal(resolve('/console/js/nope.js').reason, 'missing');
});

test('符号链接拒绝（Windows 无权限建链时跳过）', (t) => {
  const outside = path.join(root, '..', `qqb-outside-${process.pid}.txt`);
  fs.writeFileSync(outside, 'secret');
  const link = path.join(root, 'linked.txt');
  try {
    fs.symlinkSync(outside, link, 'file');
  } catch {
    fs.rmSync(outside, { force: true });
    t.skip('当前环境无创建符号链接的权限');
    return;
  }
  try {
    const result = resolve('/console/linked.txt');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'symlink');
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(outside, { force: true });
  }
});

test('serveStaticFile 带安全头，失败与未知端点都是 404', () => {
  const res = mockRes();
  assert.equal(serveStaticFile(res, resolve('/console/index.html')), true);
  assert.equal(res.calls[0].status, 200);
  assert.equal(res.calls[0].headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.calls[0].headers['Content-Security-Policy'], SECURITY_HEADERS['Content-Security-Policy']);
  // 控制台已完全外置（无内联 <style>/<script>、无 style 属性），所以不允许再回退到 unsafe-inline。
  const csp = res.calls[0].headers['Content-Security-Policy'];
  assert.equal(csp.includes("'unsafe-inline'"), false, `CSP 不应含 unsafe-inline：${csp}`);
  assert.match(csp, /script-src 'self'/, 'script-src 只允许同源脚本');
  assert.match(csp, /style-src 'self'/, 'style-src 只允许同源样式');

  const miss = mockRes();
  assert.equal(serveStaticFile(miss, resolve('/console/../x.html')), false);
  assert.equal(miss.calls[0].status, 404);
  assert.equal(JSON.parse(miss.calls[1].body).error, 'not found');
  assert.equal(miss.calls[1].body.includes(root), false, '404 不得回显路径');

  const notFound = mockRes();
  sendNotFound(notFound);
  assert.equal(notFound.calls[0].status, 404);
  assert.equal(JSON.parse(notFound.calls[1].body).ok, false);
});

test('清理夹具', () => {
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(fs.existsSync(root), false);
});
