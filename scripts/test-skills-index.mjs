// 技能清单（路线图 §9.2）：只验「扫描 + 固定行数渲染 + 缓存」这三件事，
// 不碰真实文件系统——真机由 test-core-prompt-blocks 的注入断言覆盖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSkillIndex, formatSkillLine, parseSkillHead } from '../src/skills/index.mjs';

const dirent = (name, { dir = true, link = false } = {}) => ({
  name,
  isDirectory: () => dir,
  isSymbolicLink: () => link,
});

function fakeFs(tree) {
  const calls = { readdir: 0, readFile: 0 };
  return {
    calls,
    readdirSync(dir) {
      calls.readdir += 1;
      if (!(dir in tree)) throw new Error(`ENOENT ${dir}`);
      return Object.keys(tree[dir]).map((name) => dirent(name, tree[dir][name]));
    },
    readFileSync(file) {
      calls.readFile += 1;
      const match = file.match(/^(.*)\/([^/]+)\/SKILL\.md$/);
      const content = match ? tree[match[1]]?.[match[2]]?.content : undefined;
      if (content === undefined) throw new Error(`ENOENT ${file}`);
      return content;
    },
  };
}

test('parseSkillHead 去掉引号、缺字段返回空串', () => {
  assert.deepEqual(parseSkillHead('---\nname: "humanizer-zh"\ndescription: \'中文润色\'\n---\n'), {
    name: 'humanizer-zh',
    description: '中文润色',
  });
  assert.deepEqual(parseSkillHead('没有 frontmatter'), { name: '', description: '' });
});

test('formatSkillLine 单行、按字数截断描述、无描述只留名字', () => {
  assert.equal(formatSkillLine({ name: 'a', description: '短' }), '- a：短');
  const long = formatSkillLine({ name: 'b', description: 'x'.repeat(100) }, { maxDescriptionChars: 10 });
  assert.equal(long.length, '- b：'.length + 10);
  assert.ok(long.endsWith('…'));
  assert.equal(formatSkillLine({ name: 'c', description: '' }), '- c');
});

test('扫描跳过没有 SKILL.md 的目录与符号链接目录，同名只认先出现的根', () => {
  const fs = fakeFs({
    'C:/a': {
      one: { content: 'name: one\ndescription: 一号' },
      none: {},
    },
    'C:/b': {
      one: { content: 'name: one\ndescription: 被覆盖' },
      two: { content: 'name: two\ndescription: 二号' },
      linked: { link: true, content: 'name: linked' },
    },
  });
  const index = createSkillIndex({ roots: ['C:/a', 'C:/b'], fs, ttlMs: 0 });
  const entries = index.list();
  assert.deepEqual(entries.map((e) => e.id), ['one', 'two']);
  assert.equal(entries[0].description, '一号');
});

test('根目录不存在时只当空清单，不抛错', () => {
  const fs = fakeFs({});
  const index = createSkillIndex({ roots: ['C:/missing'], fs, ttlMs: 0, log: () => {} });
  assert.deepEqual(index.list(), []);
  assert.equal(index.render(), '');
});

test('渲染行数固定：1 行标题 + maxEntries + 1 行溢出提示', () => {
  const tree = { 'C:/s': {} };
  for (let i = 0; i < 20; i += 1) tree['C:/s'][`s${String(i).padStart(2, '0')}`] = { content: `name: s${i}\ndescription: 描述${i}` };
  const index = createSkillIndex({ roots: ['C:/s'], maxEntries: 5, fs: fakeFs(tree), ttlMs: 0 });
  const text = index.render();
  const lines = text.split('\n');
  assert.equal(lines.length, 7);
  assert.match(lines[0], /可用技能/);
  assert.match(lines[6], /另有 15 个技能未列出/);
});

test('字数预算收紧时先丢尾部条目、并计入溢出提示', () => {
  const tree = {
    'C:/s': {
      a: { content: 'name: a\ndescription: 甲' },
      b: { content: 'name: b\ndescription: 乙' },
      c: { content: 'name: c\ndescription: 丙' },
    },
  };
  const index = createSkillIndex({ roots: ['C:/s'], fs: fakeFs(tree), ttlMs: 0 });
  const full = index.render();
  const header = full.split('\n')[0];
  // 预算只够放下标题 + 第一条，第二条起必须计入溢出提示
  const text = index.render({ maxChars: header.length + 8 });
  const lines = text.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^- a：甲$/);
  assert.match(lines[2], /未列出/);
});

test('缓存：ttl 内只扫一次，invalidate 后重扫', () => {
  const fs = fakeFs({ 'C:/s': { a: { content: 'name: a\ndescription: 甲' } } });
  let clock = 1000;
  const index = createSkillIndex({ roots: ['C:/s'], fs, ttlMs: 5000, now: () => clock });
  index.list();
  index.list();
  assert.equal(fs.calls.readdir, 1);
  clock += 6000;
  index.list();
  assert.equal(fs.calls.readdir, 2);
  index.invalidate();
  index.list();
  assert.equal(fs.calls.readdir, 3);
});

test('status 给出根目录与条目摘要', () => {
  const fs = fakeFs({ 'C:/s': { a: { content: 'name: a\ndescription: 甲' } } });
  const index = createSkillIndex({ roots: ['C:/s'], fs, ttlMs: 0 });
  assert.deepEqual(index.status(), {
    roots: ['C:/s'],
    count: 1,
    entries: [{ id: 'a', name: 'a', dir: 'C:/s/a' }],
  });
});
