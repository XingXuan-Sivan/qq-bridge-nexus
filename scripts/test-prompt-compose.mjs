#!/usr/bin/env node
// 平台提示词组装：占位符、空值不改变产物、只动 persona 行。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendPlatformPrompt,
  composeRows,
  readPlatformPromptFromConfig,
  renderPlatformPrompt,
} from '../src/runtime/prompt-compose.mjs';
import { PRESETS, buildPatches } from '../scripts/build-agent-preset-patches.mjs';

test('占位符：认识的替换、不认识的保留', () => {
  assert.equal(renderPlatformPrompt('你在 {platform} 上叫 {displayName}。'), '你在 QQ 上叫 QQ。');
  assert.equal(renderPlatformPrompt('{platform}/{qq?}', { platform: 'B站' }), 'B站/{qq?}');
  assert.equal(renderPlatformPrompt('', {}), '');
  assert.equal(renderPlatformPrompt(null), '');
});

test('拼接：空值不接入、正文尾部空白被清掉', () => {
  assert.equal(appendPlatformPrompt('正文', ''), '正文');
  assert.equal(appendPlatformPrompt('正文', '   '), '正文');
  assert.equal(appendPlatformPrompt('正文\n\n', '补充'), '正文\n\n补充');
  assert.equal(appendPlatformPrompt('', '补充'), '补充');
  assert.equal(appendPlatformPrompt('正文', '补充'), '正文\n\n补充');
});

test('composeRows：只改 persona 行，其余行与顺序不动', () => {
  const rows = [
    { id: 'persona', config: { prefix: '原始人格' } },
    { id: 'qq-tool-restrict', config: { profile: 'chat' } },
  ];
  const same = composeRows(rows, { platformText: '' });
  assert.equal(same, rows, '空补充应原样返回（保证生成物逐字节不变）');
  const next = composeRows(rows, { platformText: '你在 {platform} 上。' });
  assert.equal(next[0].config.prefix, '原始人格\n\n你在 QQ 上。');
  assert.equal(next[1], rows[1]);
  assert.equal(rows[0].config.prefix, '原始人格', '不能改到原数组');
  assert.equal(next[0].id, 'persona');
});

test('从 config 读平台提示词', () => {
  const config = { capabilities: { 'qq-chat': { prompt: { personaPrefix: '你是 QQ 机器人。' } } } };
  assert.equal(readPlatformPromptFromConfig(config, 'qq-chat'), '你是 QQ 机器人。');
  assert.equal(readPlatformPromptFromConfig(config, 'qq-chat-v2'), '');
  assert.equal(readPlatformPromptFromConfig({}, 'qq-chat'), '');
  assert.equal(readPlatformPromptFromConfig(null, 'qq-chat'), '');
});

test('内置预设：没有平台提示词时，生成的 patch 与仓库产物逐字一致', () => {
  const results = buildPatches({ check: true });
  assert.equal(results.length, PRESETS.length);
  for (const result of results) {
    assert.equal(result.changed, false, `${result.file} 与源不一致`);
  }
});
