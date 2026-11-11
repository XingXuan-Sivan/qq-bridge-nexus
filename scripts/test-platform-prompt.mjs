import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import YAML from 'yaml';

const file = 'config/platform/qq.yml';

test('platform prompt file carries the QQ section and nothing else', () => {
  const raw = YAML.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(raw.version, 1);
  assert.equal(raw.platform, 'qq');
  const text = String(raw.prompt ?? '');
  assert.ok(text.length > 5000, `prompt too short: ${text.length}`);
  for (const heading of ['【二代仿真模式 —— 工具协议', '【等、回与沉睡前观察】', '【发送与汇报禁令']) {
    assert.ok(text.includes(heading), `missing heading: ${heading}`);
  }
  assert.ok(!text.includes('id: persona'), 'persona 键不应出现在平台提示词里');
  assert.ok(!text.includes('{{model}}'), '模型变量不应出现在平台提示词里');
  assert.ok(!text.trimEnd().endsWith('config:'), '文件尾部不应混入后续 YAML 键');
});
