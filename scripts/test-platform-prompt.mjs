import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../profiles/platforms/qq/prompt.md');

test('platform prompt file carries the QQ section and nothing else', () => {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  // P10.9.7 起身份底稿归能力层，平台层只剩平台话术，体量约 5k。
  assert.ok(text.length > 4000, `prompt too short: ${text.length}`);
  for (const heading of ['【二代仿真模式 —— 工具协议', '【等、回与沉睡前观察】', '【发送与汇报禁令']) {
    assert.ok(text.includes(heading), `missing heading: ${heading}`);
  }
  assert.ok(!text.includes('id: persona'), 'persona 键不应出现在平台提示词里');
  assert.ok(!text.includes('{{model}}'), '模型变量不应出现在平台提示词里');
  assert.ok(!/^\s*You are a coding agent/m.test(text), '身份底稿不应出现在平台提示词里');
  assert.ok(!text.trimEnd().endsWith('config:'), '文件尾部不应混入 YAML 键');
});
