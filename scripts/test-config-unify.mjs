// P3 配置归一：设置的新家是 config.json 的对应段，状态文件只留运行态。
// 覆盖四个适配点：定时任务设置、定时静默、插件配置、手动静默（手工部分由 bridge 负责，这里测前三个纯模块）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createScheduler, DEFAULT_SETTINGS } from '../src/scheduler/engine.js';
import { createSilenceSchedule, peakPresetRanges } from '../src/silence-schedule.js';
import { createPluginKernel } from '../src/plugins/kernel.mjs';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qqb-config-unify-'));

function schedulerAt(file, extra = {}) {
  return createScheduler({
    file,
    deliver: async () => ({ ok: true }),
    validateTarget: () => null,
    ownerKey: () => 'private:1',
    ...extra,
  });
}

test('定时任务：设置走 config（onSettingsChange），状态文件不再写 settings；首次读旧文件会迁移', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'scheduler.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, settings: { ...DEFAULT_SETTINGS, enabled: false }, tasks: [], history: [], counters: {}, nextId: 1 }));
  const seen = [];
  const s = schedulerAt(file, { settings: null, onSettingsChange: (next) => seen.push(next) });
  s.load();
  // 旧文件里的 settings 迁到 config 一次
  assert.equal(seen.length, 1);
  assert.equal(seen[0].enabled, false);
  s.updateSettings({ enabled: true }, { source: 'console' });
  assert.equal(seen.at(-1).enabled, true);
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(state.settings, undefined, '状态文件不应再存 settings');
  assert.equal(state.tasks.length, 0);
});

test('定时静默：时间段配置走 config，状态文件只留 override', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'silence-schedule.json');
  fs.writeFileSync(file, JSON.stringify({ config: { enabled: true, ranges: [{ id: 'r1', start: '23:00', end: '07:00', days: [1, 2, 3, 4, 5, 6, 7] }] } }));
  const seen = [];
  const sil = createSilenceSchedule({ file, config: null, onChange: (next) => seen.push(next) });
  assert.equal(seen.length, 1, '首次读旧文件应迁移到 config');
  sil.update({ enabled: false, ranges: [] });
  assert.equal(seen.at(-1).enabled, false);
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(state.config, undefined, '状态文件不应再存 config');
  // peakPresetRanges 仍可用来生成默认段（避免导入被摇树后忘了用）
  assert.ok(Array.isArray(peakPresetRanges([])));
});

test('插件配置：传入 config 时不再读写 plugins.json，保存走 saveConfig', async () => {
  const dir = tmpDir();
  const legacy = path.join(dir, 'plugins.json');
  fs.writeFileSync(legacy, JSON.stringify({ enabled: false }));
  const saved = [];
  const kernel = await createPluginKernel({
    rootDir: dir,
    stateDir: path.join(dir, 'state'),
    log: () => {},
    config: { enabled: true, plugins: {} },
    saveConfig: (next) => saved.push(next),
  });
  await kernel.init();
  assert.equal(kernel.status().enabled, true, '以传入的 config 为准，而不是 plugins.json');
  await kernel.close?.();
  assert.equal(fs.existsSync(legacy), true, '不应删除旧文件（迁移由 bridge 负责）');
  assert.equal(saved.length, 0, '初始化不写配置');
});
