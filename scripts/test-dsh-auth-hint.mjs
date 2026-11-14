// DSH 401 诊断提示（src/agent-side/adapters/dsh/auth-hint.mjs）的离线测试。
//   ① 识别 401；
//   ② 凭据文件缺失 / 存在但对不上 两种说法；发现另一个有凭据的目录；
//   ③ 路径里的用户目录显示成 ~，不输出任何密钥内容；
//   ④ 限频：10 分钟一次，恢复后立即可再提示；recentlyFailed 窗口；
//   ⑤ 接线：诊断与限频都归 DSH 连接层，桥接只决定写不写日志。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isDshAuthError, buildDshAuthHint, createAuthHintGate, displayPath, candidateDshHomes, AUTH_HINT_INTERVAL_MS,
} from '../src/agent-side/adapters/dsh/auth-hint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = path.resolve('/home/fixture-user');

test('① 识别 401', () => {
  assert.equal(isDshAuthError(new Error('transport failure for /api/session/modelCatalog: HTTP 401')), true);
  assert.equal(isDshAuthError('unauthorized'), true);
  assert.equal(isDshAuthError(new Error('transport failure: HTTP 404')), false);
  assert.equal(isDshAuthError(new Error('connect ECONNREFUSED 127.0.0.1:3080')), false);
  assert.equal(isDshAuthError(null), false);
});

test('② 凭据缺失 / 对不上 / 另一个目录', () => {
  const dshHome = path.join(HOME, '.dsh');
  const missing = buildDshAuthHint({ dshHome, env: {}, platform: 'linux', home: HOME, exists: () => false });
  assert.match(missing, /HTTP 401/);
  assert.match(missing, /没找到 DSH 的凭据文件/);
  assert.match(missing, /默认值，没有设置 DSH_HOME/);
  assert.match(missing, /export DSH_HOME/);
  assert.match(missing, /setup-dsh\.mjs/);
  assert.match(missing, /不是 DSH 版本或协议的问题/);

  const appData = path.join(HOME, 'AppData', 'Roaming');
  const other = path.join(appData, 'dsh-desktop', 'harness');
  const has = new Set([path.join(dshHome, '.credentials.yaml'), path.join(other, '.credentials.yaml')]);
  const win = buildDshAuthHint({ dshHome, env: { APPDATA: appData }, platform: 'win32', home: HOME, exists: (p) => has.has(p) });
  assert.match(win, /对不上/);
  assert.match(win, /setx DSH_HOME/);
  assert.ok(win.includes('另一个有凭据的目录：~' + other.slice(HOME.length)), win);

  // 设了 DSH_HOME 时说明来源；当前目录不会被当成「另一个目录」重复列出
  const fromEnv = buildDshAuthHint({ dshHome: other, env: { DSH_HOME: other, APPDATA: appData }, platform: 'win32', home: HOME, exists: (p) => has.has(p) });
  assert.match(fromEnv, /来自环境变量 DSH_HOME/);
  assert.equal((fromEnv.match(/另一个有凭据的目录/g) || []).length, 1, '只列出 ~/.dsh 一个');

  assert.deepEqual(candidateDshHomes({ env: {}, platform: 'darwin', home: HOME }), [path.join(HOME, '.dsh')]);
});

test('③ 用户目录显示成 ~，不带密钥', () => {
  assert.equal(displayPath(path.join(HOME, '.dsh'), HOME), '~' + path.sep + '.dsh');
  assert.equal(displayPath('/opt/dsh', HOME), '/opt/dsh');
  const hint = buildDshAuthHint({ dshHome: path.join(HOME, '.dsh'), env: {}, platform: 'linux', home: HOME, exists: () => true });
  assert.ok(!hint.includes(HOME), '日志里不出现用户目录的绝对路径');
  assert.doesNotMatch(hint, /secret|grant|browser-session/i);
});

test('④ 限频', () => {
  let t = 1_000_000;
  const gate = createAuthHintGate({ now: () => t });
  assert.equal(gate.recentlyFailed(), false);
  assert.equal(gate.fail(), true);
  assert.equal(gate.recentlyFailed(), true);
  t += 5000;
  assert.equal(gate.fail(), false, '10 分钟内不重复');
  t += AUTH_HINT_INTERVAL_MS;
  assert.equal(gate.fail(), true, '过了间隔再提示');
  t += 3 * 60 * 1000;
  assert.equal(gate.recentlyFailed(), false, '超过 2 分钟窗口');
  gate.fail();
  gate.reset();
  assert.equal(gate.recentlyFailed(), false);
  assert.equal(gate.fail(), true, '恢复后再 401 立即提示');
});

test('⑤ 接线：诊断与限频归连接层，桥接不直连提示模块', () => {
  const bridge = fs.readFileSync(path.join(ROOT, 'src/bridge.js'), 'utf8');
  assert.ok(!/dsh-auth-hint/.test(bridge), '401 诊断的实现归 DSH 连接层，桥接不直连');
  const fail = bridge.indexOf('const v = agentHealth.fail(lastErr);');
  assert.ok(fail > 0);
  const after = bridge.slice(fail, fail + 400);
  // 提示不能放在 `if (agentReady && v.unavailable)` 里面：启动时就 401 的情况 agentReady 从来不是 true
  assert.ok(after.indexOf('agentRuntime().authHint(lastErr)') < after.indexOf('if (agentReady && v.unavailable)'));
  assert.match(after, /if \(hint\) log\(hint\);/);
  assert.match(bridge, /if \(ok\) \{\n\s+agentRuntime\(\)\.resetAuthHint\(\);/);
  assert.match(bridge, /agentRuntime\(\)\.authRecentlyFailed\(\)/);
  // 「最近刚提示过」的窗口在连接层里：限频与诊断同源，不会各算一份。
  const runtime = fs.readFileSync(path.join(ROOT, 'src/agent-side/adapters/dsh/runtime.mjs'), 'utf8');
  assert.match(runtime, /if \(!authHintGate\.fail\(\)\) return null;/);
  assert.match(runtime, /return authHintGate\.recentlyFailed\(\);/);
});
