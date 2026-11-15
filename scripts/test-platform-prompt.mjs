import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../profiles/platforms/qq/prompt.md');

test('platform prompt file carries the QQ sections and nothing from the other two layers', () => {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  // 平台层只有平台话术：QQ 场景规则、认人、工具协议、操作即动作、群管禁令、发送禁令，约 6k。
  assert.ok(text.length > 4000, `prompt too short: ${text.length}`);
  for (const heading of [
    '【QQ 场景规则】',
    '【认人：只认 QQ 号】',
    '【QQ 工具协议',
    '【操作即动作，不是 API】',
    '【群聊不是客服队列】',
    '【不要当群管家/主持人】',
    '【发送与汇报禁令',
  ]) {
    assert.ok(text.includes(heading), `missing heading: ${heading}`);
  }
  // 安全边界与送达方式归能力档，节奏与等待归行为档案：写进这里就会在会话里出现两份。
  for (const foreign of ['【安全边界', '【送达方式：', '【等、回与沉睡前观察】', '【反 AI 味', '【记忆卫生】']) {
    assert.ok(!text.includes(foreign), `能力档/行为档案段落不应出现在平台提示词里: ${foreign}`);
  }
  assert.ok(!text.includes('id: persona'), 'persona 键不应出现在平台提示词里');
  assert.ok(!text.includes('{{model}}'), '模型变量不应出现在平台提示词里');
  assert.ok(!/^\s*You are a coding agent/m.test(text), '身份底稿不应出现在平台提示词里');
  assert.ok(!text.trimEnd().endsWith('config:'), '文件尾部不应混入 YAML 键');
});
