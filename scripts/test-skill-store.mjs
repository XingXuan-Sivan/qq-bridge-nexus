import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSkillStore, parseSkillDocument, readZip, validateSkillText } from '../src/extensions/skill-store.mjs';

function tempRoot() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-store-'));
  return {
    base,
    root: path.join(base, 'skills'),
    state: path.join(base, 'state', 'skills-state.json'),
    cleanup() { fs.rmSync(base, { recursive: true, force: true }); },
  };
}

function skillText(name, description = '测试技能') {
  return `---\nname: ${name}\ndescription: ${description}\nversion: 1.0.0\ntags: [test]\n---\n\n正文 ${name}\n`;
}

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(value);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

test('frontmatter 校验与字段解析', () => {
  const parsed = parseSkillDocument(skillText('alpha', '甲'));
  assert.equal(parsed.name, 'alpha');
  assert.equal(parsed.description, '甲');
  assert.equal(parsed.version, '1.0.0');
  assert.deepEqual(parsed.tags, ['test']);
  assert.match(parsed.body, /正文 alpha/);
  assert.throws(() => parseSkillDocument('no frontmatter'), /frontmatter/);
  assert.throws(() => validateSkillText('---\nname: x\n---\nbody'), /description/);
  assert.equal(validateSkillText(skillText('alpha')).size > 0, true);
});

test('外部技能写入、读取、启停、删除与备份', () => {
  const tmp = tempRoot();
  try {
    const store = createSkillStore({ root: tmp.root, stateFile: tmp.state, fs });
    const created = store.write('alpha', skillText('alpha'));
    assert.equal(created.id, 'alpha');
    assert.equal(store.list()[0].active, true);
    assert.equal(store.read('alpha').name, 'alpha');
    assert.equal(store.setActive('alpha', false).active, false);
    assert.equal(store.list()[0].active, false);
    store.write('alpha', skillText('alpha', '第二版'));
    assert.equal(store.read('alpha').description, '第二版');
    const backups = fs.readdirSync(path.join(path.dirname(tmp.state), 'skill-backups'));
    assert.equal(backups.some((name) => name.startsWith('alpha.')), true);
    assert.deepEqual(store.remove('alpha'), { id: 'alpha', deleted: true });
    assert.equal(store.list().length, 0);
  } finally {
    tmp.cleanup();
  }
});

test('zip 导入根目录与一级目录，并拒绝多 SKILL', () => {
  const tmp = tempRoot();
  try {
    const store = createSkillStore({ root: tmp.root, stateFile: tmp.state, fs });
    const files = readZip(zip({ 'SKILL.md': skillText('root-skill'), 'notes.txt': 'x' }));
    assert.deepEqual(files.map((entry) => entry.name), ['SKILL.md', 'notes.txt']);
    const imported = store.importZip(zip({ 'alpha/SKILL.md': skillText('alpha'), 'alpha/refs/tip.txt': 'tip' }), { id: 'alpha' });
    assert.equal(imported.id, 'alpha');
    assert.equal(store.read('alpha').name, 'alpha');
    assert.equal(fs.existsSync(path.join(tmp.root, 'alpha', 'refs', 'tip.txt')), true);
    assert.throws(() => store.importZip(zip({
      'a/SKILL.md': skillText('a'),
      'b/SKILL.md': skillText('b'),
    })), /多个 SKILL/);
    assert.throws(() => store.importZip(zip({ 'a/SKILL.md': skillText('a') }), { id: 'alpha' }), /已存在/);
    assert.throws(() => readZip(Buffer.from('not zip')), /不是有效的 zip/);
  } finally {
    tmp.cleanup();
  }
});
