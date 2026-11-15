#!/usr/bin/env node
// 平台提示词渲染：占位符、变量白名单，以及「产物与能力档源文件逐字一致」。
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePromptVars, renderPlatformPrompt } from '../src/runtime/prompt-compose.mjs';
import { PRESETS, buildPatches } from '../scripts/build-agent-preset-patches.mjs';

test('占位符：认识的替换、不认识的保留', () => {
  assert.equal(renderPlatformPrompt('你在 {platform} 上叫 {displayName}。', { platform: 'QQ', displayName: 'QQ' }), '你在 QQ 上叫 QQ。');
  assert.equal(renderPlatformPrompt('{platform}/{qq?}', { platform: 'B站' }), 'B站/{qq?}');
  assert.equal(renderPlatformPrompt('', {}), '');
  assert.equal(renderPlatformPrompt(null), '');
  // 平台名没有代码级默认值：缺 vars 时占位符原样保留，免得被悄悄写成某一个平台。
  assert.equal(renderPlatformPrompt('你在 {platform} 上。'), '你在 {platform} 上。');
  // 与平台无关的默认值仍然保留。
  assert.equal(renderPlatformPrompt('{owner}', {}), '管理员');
});

test('变量白名单：只留三个键，空值丢掉、超长截断', () => {
  assert.deepEqual(
    normalizePromptVars({ platform: 'QQ', displayName: '', owner: ' 老张 ', 额外: 'x' }),
    { platform: 'QQ', owner: '老张' },
  );
  assert.deepEqual(normalizePromptVars(null), {});
  assert.deepEqual(normalizePromptVars(['QQ']), {});
  assert.equal(normalizePromptVars({ platform: 'x'.repeat(300) }).platform.length, 200);
});

test('内置预设：生成的 patch 与仓库产物逐字一致', () => {
  const results = buildPatches({ check: true });
  assert.equal(results.length, PRESETS.length);
  for (const result of results) {
    assert.equal(result.changed, false, `${result.file} 与源不一致`);
  }
});
