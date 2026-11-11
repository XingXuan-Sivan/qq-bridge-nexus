// 行为提示词与平台话术的读写（P10.9.1）+ 注入模式归一。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeBehavior, writeBehaviorData, readBehaviorDocument,
  duplicateBehavior, removeBehaviorFile, listBehaviorFiles,
} from '../src/behaviors/index.mjs';
import {
  readPlatformPrompt, writePlatformPrompt, restorePlatformPrompt,
  listPlatformPrompts, renderPlatformText,
} from '../src/platform/prompt.mjs';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cap-prompt-'));
}

test('行为档案带 prompt：写入、读回、列表', () => {
  const root = tmpRoot();
  writeBehaviorData({
    root, id: 'b1',
    data: { version: 1, kind: 'v2', label: '测试行为', description: '', prompt: '【引擎】先说结论。', config: { wake: { defaultMode: 'diving' } } },
  });
  const doc = readBehaviorDocument({ root, id: 'b1' });
  assert.equal(doc.prompt, '【引擎】先说结论。');
  assert.deepEqual(listBehaviorFiles({ root }).map((item) => item.id), ['b1']);
});

test('prompt 超长与未知字段被拒', () => {
  assert.throws(() => normalizeBehavior('x', { version: 1, kind: 'v1', label: 'x', prompt: 'a'.repeat(20001), v1: {} }), /prompt/);
  assert.throws(() => normalizeBehavior('x', { version: 1, kind: 'v1', label: 'x', unknown: 1, v1: {} }), /未知顶层字段/);
});

test('克隆与删除：目标重名拒绝、删除后文件消失', () => {
  const root = tmpRoot();
  writeBehaviorData({ root, id: 'src', data: { version: 1, kind: 'v2', label: '源', description: '', prompt: 'P', config: {} } });
  duplicateBehavior({ root, fromId: 'src', toId: 'copy' });
  assert.equal(readBehaviorDocument({ root, id: 'copy' }).prompt, 'P');
  assert.throws(() => duplicateBehavior({ root, fromId: 'src', toId: 'copy' }), /已存在/);
  removeBehaviorFile({ root, id: 'copy' });
  assert.throws(() => readBehaviorDocument({ root, id: 'copy' }));
});

test('平台话术：写入带备份、出厂副本可还原、占位符渲染', () => {
  const root = tmpRoot();
  writePlatformPrompt({ root, id: 'qq', text: '你好 {displayName}' });
  const first = readPlatformPrompt({ root, id: 'qq' });
  assert.equal(first.text, '你好 {displayName}');
  assert.equal(first.isFactory, true);
  writePlatformPrompt({ root, id: 'qq', text: '改过的正文' });
  assert.equal(readPlatformPrompt({ root, id: 'qq' }).isFactory, false);
  const restored = restorePlatformPrompt({ root, id: 'qq' });
  assert.equal(restored.text, '你好 {displayName}');
  assert.deepEqual(listPlatformPrompts({ root }).map((item) => item.id), ['qq']);
  assert.equal(renderPlatformText('{platform}·{owner}', { platform: 'QQ', owner: '管理员' }), 'QQ·管理员');
});

test('平台话术 id 与正文长度受限', () => {
  const root = tmpRoot();
  assert.throws(() => writePlatformPrompt({ root, id: 'Bad Id', text: 'x' }), /id 不合法/);
  assert.throws(() => writePlatformPrompt({ root, id: 'qq', text: 'x'.repeat(40001) }), /超过/);
});
