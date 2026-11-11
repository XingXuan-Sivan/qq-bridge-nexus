// P10.3 验收：4 个能力目录由 capability.yml 生成，且生成规则与 SPEC 一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { CAPABILITIES } from './migrate-capability-unify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = (id) => path.join(ROOT, 'dsh', 'agent-presets', id);
const read = (id, name) => fs.readFileSync(path.join(DIR(id), name), 'utf8');

test('4 个能力目录齐全，且每一份 capability.yml 都能被加载', () => {
  for (const spec of CAPABILITIES) {
    assert.ok(fs.existsSync(path.join(DIR(spec.id), 'capability.yml')), `${spec.id} 缺 capability.yml`);
    const meta = parseYaml(read(spec.id, 'preset.yml'));
    assert.equal(meta.name, spec.label);
    assert.equal(meta.order, spec.order);
    assert.equal(meta.behavior, undefined, `${spec.id} 的 preset.yml 不应再有 behavior`);
  }
});

test('产物带「勿手改」头，extensions 显式写 allow（Hub 缺文件＝全拒）', () => {
  for (const spec of CAPABILITIES) {
    for (const name of ['preset.yml', 'agent.cordis.yml', 'extensions.yml']) {
      assert.match(read(spec.id, name), /由 scripts\/build-capability-artifacts\.mjs/, `${spec.id}/${name} 缺生成头`);
    }
    const ext = parseYaml(read(spec.id, 'extensions.yml'));
    assert.deepEqual(ext.mcp.allow, ['*']);
    assert.equal(ext.mcp.tools.allow, '*');
    assert.deepEqual(ext.skills.allow, ['*']);
  }
});

test('聊天能力：没有本地执行行，守卫行带 allow；Agent 能力：有本地行、没有守卫', () => {
  const chatRows = parseYaml(read('agent-chat', 'agent.cordis.yml'));
  const chatIds = chatRows.map((row) => row.id);
  assert.ok(!chatIds.includes('tool-pwsh') && !chatIds.includes('tool-fs') && !chatIds.includes('tool-jobs'));
  const guard = chatRows.find((row) => row.id === 'qq-tool-restrict');
  assert.ok(guard, '聊天能力必须挂守卫行');
  assert.ok(guard.config.allow.includes('qq_send_message'));
  assert.equal(guard.config.profile, 'simulation');

  for (const id of ['agent-readonly', 'agent-workspace', 'agent-full']) {
    const rows = parseYaml(read(id, 'agent.cordis.yml'));
    assert.ok(!rows.some((row) => row.id === 'qq-tool-restrict'), `${id} 不应挂仿真守卫`);
  }
  assert.ok(parseYaml(read('agent-full', 'agent.cordis.yml')).some((row) => row.id === 'tool-pwsh'));
});

test('persona 顺序：安全边界在前、平台无关 base 在后', () => {
  const rows = parseYaml(read('agent-chat', 'agent.cordis.yml'));
  const prefix = rows.find((row) => row.id === 'persona').config.prefix;
  assert.match(prefix, /^【安全边界/);
  assert.match(prefix, /You are a coding agent powered by the \{\{model\}\} model\./);
  assert.ok(prefix.indexOf('【安全边界') < prefix.indexOf('You are a coding agent'));
});
