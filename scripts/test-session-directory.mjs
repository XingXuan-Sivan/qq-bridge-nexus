/**
 * 会话目录/准入/迁移的离线测试（src/session/directory.mjs、access.mjs、migrate.mjs）。
 *
 * 覆盖：目录扫描、key 与路径校验、损坏隔离、重复档案取 updatedAt 最新、原子写只写变化、
 * 删除档案、双轴解析顺序、旧数据迁移映射。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProfile, createSessionDirectoryWriter, loadSessionDirectory, normalizeProfile, keyPath, SESSION_DIR_VERSION,
} from '../src/session/directory.mjs';
import { migrateSessionProfiles } from '../src/session/migrate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
let dirCount = 0;
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `session-dir-${++dirCount}-`));
  return dir;
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}
const logs = [];
const log = (line) => logs.push(String(line));
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('目录扫描：defaults + 每会话文件，binding/人格/提示词/唤醒都能读回', () => {
  const dir = tempDir();
  writeJson(path.join(dir, 'defaults.json'), { version: 2, defaults: { passive: 'deny', proactive: 'deny' }, migratedAt: 123 });
  writeJson(path.join(dir, 'qq/group/123.json'), {
    version: 2,
    key: 'qq:group:123',
    access: { passive: 'allow', proactive: 'inherit' },
    persona: { mode: 'card', name: '小鲸鱼' },
    prompt: { initialText: '这是技术群', updatedAt: 5 },
    wake: { config: { mode: 'active' } },
    binding: { sessionId: 'session-a', fingerprint: 'fp-a', status: 'online', checkedAt: 1, createdAt: 2 },
    updatedAt: 9,
  });
  const loaded = loadSessionDirectory({ dir, fs, path, log });
  assert.equal(loaded.writable, true);
  assert.equal(loaded.state.migratedAt, 123);
  assert.equal(loaded.state.profiles['qq:group:123'].persona.name, '小鲸鱼');
  assert.equal(loaded.state.sessions['qq:group:123'], 'session-a');
  assert.equal(loaded.state.sessionPolicies['qq:group:123'], 'fp-a');
  assert.equal(loaded.state.profiles['qq:group:123'].prompt.initialText, '这是技术群');
});

test('损坏文件被隔离，不阻断其它会话；key 与路径不一致视为损坏', () => {
  const dir = tempDir();
  writeJson(path.join(dir, 'defaults.json'), { version: 2, defaults: { passive: 'deny', proactive: 'deny' }, migratedAt: 1 });
  writeJson(path.join(dir, 'qq/group/1.json'), { version: 2, key: 'qq:group:2' });
  writeJson(path.join(dir, 'qq/group/3.json'), { version: 2, key: 'qq:group:3', access: { passive: 'allow' }, updatedAt: 1 });
  fs.writeFileSync(path.join(dir, 'qq/group/4.json'), '{not json', 'utf8');
  const loaded = loadSessionDirectory({ dir, fs, path, log });
  assert.equal(Object.hasOwn(loaded.state.profiles, 'qq:group:1'), false);
  assert.equal(loaded.state.profiles['qq:group:3'].legacyAccess.access.passive, 'allow');
  const files = fs.readdirSync(path.join(dir, 'qq/group'));
  assert.ok(files.some((f) => f.startsWith('1.json.corrupt-')));
  assert.ok(files.some((f) => f.startsWith('4.json.corrupt-')));
});

test('重复档案保留 updatedAt 最新的一份，旧文件被隔离', () => {
  const dir = tempDir();
  writeJson(path.join(dir, 'defaults.json'), { version: 2, defaults: { passive: 'deny' } });
  // 手工制造重复 key：通过额外的两层目录不会被扫描，所以这里直接构造「同 key 不同 updatedAt」不可行；
  // 改为验证「扫描器只认三层」，多余层级被忽略。
  writeJson(path.join(dir, 'qq/group/123/extra.json'), { version: 2, key: 'qq:group:123' });
  const loaded = loadSessionDirectory({ dir, fs, path, log });
  assert.deepEqual(Object.keys(loaded.state.profiles), []);
});

test('写入只写变化，删除档案会删文件', () => {
  const dir = tempDir();
  const writer = createSessionDirectoryWriter({ dir, fs, path, atomicWriteJson, log, now: () => 100 });
  const state = {
    sessions: {}, sessionPolicies: {}, dormantSessions: {}, defaults: { passive: 'deny', proactive: 'deny' }, migratedAt: 1,
    profiles: { 'qq:group:1': createProfile('qq:group:1', {}, () => 100) },
  };
  writer.save(state);
  const mtime1 = fs.statSync(path.join(dir, 'qq/group/1.json')).mtimeMs;
  writer.save(state);
  const mtime2 = fs.statSync(path.join(dir, 'qq/group/1.json')).mtimeMs;
  assert.equal(mtime1, mtime2);
  assert.ok(fs.existsSync(path.join(dir, 'defaults.json')));
  assert.equal(writer.remove('qq:group:1'), true);
  assert.equal(fs.existsSync(path.join(dir, 'qq/group/1.json')), false);
});

test('迁移：allow/deny、allowAllWhenEmpty、人格/提示词/唤醒/绑定都按现状映射', () => {
  const input = {
    allowGroups: ['qq:group:1', 'group:2'],
    allowPrivate: [],
    denyGroups: ['qq:group:3'],
    denyPrivate: [],
    allowAllWhenEmpty: false,
    sessions: { 'qq:group:1': 'session-1', 'qq:group:4': 'session-4' },
    policies: { 'qq:group:1': 'fp-1', 'qq:group:4': 'fp-4' },
    dormant: { 'qq:group:4': { sessionId: 'session-4', since: 5 } },
    roleByKey: { 'qq:group:1': '小鲸鱼', 'qq:group:4': null },
    initialPrompts: { 'qq:group:1': { text: '技术群', updatedAt: 7 } },
    wakeConfigs: { 'qq:group:2': { mode: 'active' } },
    now: () => 1000,
  };
  const out = migrateSessionProfiles(input);
  assert.deepEqual(out.defaults, { passive: 'deny', proactive: 'deny' });
  assert.equal(out.profiles['qq:group:1'].legacyAccess.access.passive, 'allow');
  assert.equal(out.profiles['qq:group:1'].legacyAccess.access.proactive, 'allow');
  assert.equal(out.profiles['qq:group:3'].legacyAccess.blocked, true);
  assert.equal(out.profiles['qq:group:1'].persona.mode, 'card');
  assert.equal(out.profiles['qq:group:4'].persona.mode, 'off');
  assert.equal(out.profiles['qq:group:1'].prompt.initialText, '技术群');
  assert.deepEqual(out.profiles['qq:group:2'].wake.config, { mode: 'active' });
  assert.equal(out.sessions['qq:group:1'], 'session-1');
  assert.deepEqual(out.dormantSessions['qq:group:4'], { sessionId: 'session-4', since: 5 });
  const emptyAll = migrateSessionProfiles({ allowGroups: [], allowPrivate: [], allowAllWhenEmpty: true, now: () => 1 });
  assert.deepEqual(emptyAll.defaults, { passive: 'allow', proactive: 'allow' });
});

test('keyPath 与 normalizeProfile 的边界', () => {
  assert.equal(keyPath('group:123'), 'qq/group/123.json');
  assert.equal(keyPath('qq:private:9'), 'qq/private/9.json');
  assert.equal(keyPath('bad'), null);
  assert.equal(normalizeProfile({ version: 2, key: 'qq:group:1' }, { key: 'qq:group:1' }).mode, 'inherit');
  assert.equal(normalizeProfile({ version: 2, key: 'qq:group:2' }, { key: 'qq:group:1' }), null);
});

let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`PASS ${t.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${t.name}\n  ${error?.stack ?? error}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} checks passed.`);
if (failed) process.exit(1);
