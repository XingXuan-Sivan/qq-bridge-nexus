#!/usr/bin/env node
/**
 * sessions.json 读写（src/session/store.mjs）。
 *
 * 重点不是「能读能写」，而是两条安全不变量：
 *   - 读不了 / 内容损坏 ⇒ writable:false，之后任何一次 save 都不得覆盖原文件；
 *   - 老文件缺字段要就地补齐，不能因为少一个键就整份判成不可用。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSessionState, saveSessionState } from '../src/session/store.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'qqb-store-'));
const logs = [];
const log = (msg) => logs.push(msg);

test('文件不存在时给空状态且可写', () => {
  const file = join(dir(), 'sessions.json');
  const r = loadSessionState({ file, readFile: (f) => readFileSync(f, 'utf8'), log });
  assert.deepEqual(r.state, { sessions: {}, sessionPolicies: {}, dormantSessions: {} });
  assert.equal(r.writable, true);
});

test('正常文件（含 BOM）解析成功，缺字段就地补齐', () => {
  const file = join(dir(), 'sessions.json');
  writeFileSync(file, `\uFEFF${JSON.stringify({ sessions: { 'group:1': 'abc' } })}`);
  const r = loadSessionState({ file, readFile: (f) => readFileSync(f, 'utf8'), log });
  assert.equal(r.writable, true);
  assert.equal(r.state.sessions['group:1'], 'abc');
  assert.deepEqual(r.state.sessionPolicies, {});
  assert.deepEqual(r.state.dormantSessions, {});
});

test('sessionPolicies 是数组或非对象时被重置', () => {
  const file = join(dir(), 'sessions.json');
  writeFileSync(file, JSON.stringify({ sessions: {}, sessionPolicies: [] }));
  const r = loadSessionState({ file, readFile: (f) => readFileSync(f, 'utf8'), log });
  assert.deepEqual(r.state.sessionPolicies, {});
});

test('dormantSessions 交给注入的 normalizeDormant 清洗', () => {
  const file = join(dir(), 'sessions.json');
  writeFileSync(file, JSON.stringify({ sessions: {}, dormantSessions: { bad: true } }));
  const r = loadSessionState({
    file,
    readFile: (f) => readFileSync(f, 'utf8'),
    log,
    normalizeDormant: (x) => (x && typeof x === 'object' ? { kept: 1 } : {}),
  });
  assert.deepEqual(r.state.dormantSessions, { kept: 1 });
});

test('内容损坏 ⇒ writable:false、状态为空、记日志', () => {
  const file = join(dir(), 'sessions.json');
  writeFileSync(file, '{ 半截');
  logs.length = 0;
  const r = loadSessionState({ file, readFile: (f) => readFileSync(f, 'utf8'), log });
  assert.equal(r.writable, false);
  assert.deepEqual(r.state.sessions, {});
  assert.match(logs.join('\n'), /内容损坏/);
});

test('读取抛非 ENOENT 错误（权限/占用）⇒ writable:false', () => {
  const file = join(dir(), 'sessions.json');
  logs.length = 0;
  const r = loadSessionState({
    file,
    readFile: () => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; },
    log,
  });
  assert.equal(r.writable, false);
  assert.match(logs.join('\n'), /读取失败/);
});

test('writable:false 时 save 不写盘、不覆盖原文件', () => {
  const file = join(dir(), 'sessions.json');
  const original = '{ 坏文件，必须保留 }';
  writeFileSync(file, original);
  const writes = [];
  const wrote = saveSessionState({ file, atomicWriteJson: (f, s) => writes.push([f, s]), state: { sessions: {} }, writable: false });
  assert.equal(wrote, false);
  assert.deepEqual(writes, []);
  assert.equal(readFileSync(file, 'utf8'), original);
});

test('writable:true 时 save 走注入的原子写', () => {
  const file = join(dir(), 'sessions.json');
  const writes = [];
  const state = { sessions: { 'private:7': 'x' }, sessionPolicies: {}, dormantSessions: {} };
  const wrote = saveSessionState({ file, atomicWriteJson: (f, s) => writes.push([f, s]), state, writable: true });
  assert.equal(wrote, true);
  assert.deepEqual(writes, [[file, state]]);
  assert.equal(existsSync(file), false, '原子写由注入函数负责，store 自己不该落盘');
  rmSync(join(file, '..'), { recursive: true, force: true });
});
